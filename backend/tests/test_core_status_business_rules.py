"""Protected business behavior through real task APIs and persisted SQL history."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import DatabaseError

from backend.app import models as m
from backend.app.services import task_transitions, task_deadlines
from backend.tests.test_task_status_management import client, data, engine, document, headers, payload, add  # noqa: F401


def move(client, data, status, **extra):
    result = client.patch(f'/api/tasks/{data.task.id}', headers=headers(data.owner),json={'status':status,**extra})
    assert result.status_code == 200, result.text
    return result.json()


def test_new_tasks_default_to_battle_plan_and_explicit_flow_keeps_status(client, data):
    with data.factory() as db:
        customer=m.Client(tenant_id=data.owner.tenant_id,company_name='Guild Client',normalized_company_name='guild client')
        db.add(customer);db.flush()
        project=m.Project(tenant_id=data.owner.tenant_id,client_id=customer.id,name='Guild Project',normalized_name='guild project')
        db.add(project);db.flush()
        db.add(m.ProjectMember(tenant_id=data.owner.tenant_id,project_id=project.id,user_id=data.owner.id,role=m.ProjectMemberRoleEnum.MANAGER))
        db.commit()
    created=client.post('/api/tasks',headers=headers(data.owner),json={'title':'New expedition','project_id':project.id,'assigned_to_id':data.owner.id})
    assert created.status_code == 201, created.text
    assert created.json()[0]['status']=='WAITING_FOR_REQUIREMENT'
    assert created.json()[0]['created_at'] and created.json()[0]['assigned_to_id']==data.owner.id
    explicit=client.post('/api/tasks',headers=headers(data.owner),json={'title':'Explicit active flow','project_id':project.id,'status':'IN_PROGRESS'})
    assert explicit.status_code == 201 and explicit.json()[0]['status']=='IN_PROGRESS'
    held=client.post('/api/tasks',headers=headers(data.owner),json={'title':'Explicit held expedition','project_id':project.id,'assigned_to_id':data.owner.id,
        'status':'ON_HOLD','hold_reason':'Awaiting release approval','subtasks':[{'title':'Prepared','status':'DONE','completed':True}]})
    assert held.status_code==201,held.text
    assert held.json()[0]['status']=='ON_HOLD' and held.json()[0]['completed_at'] is None
    with data.factory() as db:
        assert db.get(m.Task,held.json()[0]['id']).completion_xp_awarded_at is None
        assert db.get(m.User,data.owner.id).tasks_completed==0


def test_hold_across_deadline_multiday_resume_and_completion_use_effective_deadline(client,data,monkeypatch):
    from backend.app.services import badge_engine
    completion_badges=[]
    monkeypatch.setattr(badge_engine,'process_badge_event',lambda db,*,event:completion_badges.append(event))
    document(client,data.owner)
    start=datetime(2026,1,1,10)
    clock=[start]
    monkeypatch.setattr(task_transitions,'utc_now',lambda:clock[0])
    with data.factory() as db:
        task=db.get(m.Task,data.task.id);task.due_at=start+timedelta(hours=2)
        child=db.get(m.Subtask,data.child.id);child.status=m.SubtaskStatusEnum.DONE;child.completed=True
        db.commit()
    move(client,data,'WAITING_FOR_REQUIREMENT')
    active=move(client,data,'IN_PROGRESS')
    original=active['due_at'];assignee=active['assigned_to_id']
    held=move(client,data,'ON_HOLD',hold_reason='Waiting for client approval')
    assert held['hold_started_at'] and held['due_at']==original and held['assigned_to_id']==assignee
    during=start+timedelta(days=3)
    with data.factory() as db:
        task=db.get(m.Task,data.task.id)
        assert not task_deadlines.is_overdue(task,during)
        assert db.get(m.User,data.owner.id).points==125
    clock[0]=during
    resumed=move(client,data,'IN_PROGRESS')
    assert resumed['hold_started_at'] is None and resumed['hold_paused_seconds']==pytest.approx(3*86400,abs=.001)
    assert resumed['due_at']==original
    clock[0]=during+timedelta(hours=1)
    completed=move(client,data,'DONE')
    assert completed['completed_at'].startswith('2026-01-04T11:00:00')
    with data.factory() as db:
        awarded=db.get(m.User,data.owner.id).points
        from backend.app.services.points_table import resolve_task_points
        task=db.get(m.Task,data.task.id)
        points=resolve_task_points(db,team=task.team,priority=task.priority)
        assert awarded==125+points['base']+points['beforeDueBonus']
        marker=db.get(m.Task,data.task.id).completion_xp_awarded_at
        assert marker
    move(client,data,'DONE')
    move(client,data,'DONE')
    reopened=move(client,data,'IN_PROGRESS')
    assert reopened['completed_at'] is None
    move(client,data,'DONE')
    with data.factory() as db:
        assert db.get(m.User,data.owner.id).points==awarded
        assert db.get(m.Task,data.task.id).completion_xp_awarded_at==marker
        ledger=list(db.scalars(sa.select(m.TaskHoldInterval)))
        assert len(ledger)==1 and ledger[0].ended_at==during
        assert ledger[0].started_by_id==ledger[0].ended_by_id==data.owner.id
    assert len([event for event in completion_badges if event.entity=='task' and event.event=='completed'])==1
    history=client.get(f'/api/tasks/{data.task.id}/holds',headers=headers(data.owner))
    assert history.status_code==200 and history.json()[0]['reason']=='Waiting for client approval'
    assert client.get(f'/api/tasks/{data.task.id}/holds',headers=headers(data.outsider)).status_code in (403,404)


def test_preexisting_overdue_age_is_not_erased_and_repeated_holds_do_not_overlap(client,data,monkeypatch):
    document(client,data.owner)
    start=datetime(2026,1,1,10);clock=[start]
    monkeypatch.setattr(task_transitions,'utc_now',lambda:clock[0])
    with data.factory() as db:
        db.get(m.Task,data.task.id).due_at=start-timedelta(hours=1);db.commit()
    move(client,data,'IN_PROGRESS')
    for days in (1,2):
        move(client,data,'ON_HOLD',hold_reason='Authorized pause')
        move(client,data,'ON_HOLD',hold_reason='Authorized pause')
        clock[0]+=timedelta(days=days)
        with data.factory() as db:
            task=db.get(m.Task,data.task.id)
            assert task_deadlines.is_overdue(task,clock[0])
            assert (clock[0]-task_deadlines.effective_deadline(task,clock[0])).total_seconds()==pytest.approx(3600,abs=.001)
        move(client,data,'IN_PROGRESS')
    with data.factory() as db:
        holds=list(db.scalars(sa.select(m.TaskHoldInterval).order_by(m.TaskHoldInterval.started_at)))
        assert len(holds)==2 and holds[0].ended_at<=holds[1].started_at
        assert db.get(m.Task,data.task.id).hold_paused_seconds==pytest.approx(3*86400,abs=.001)
        with pytest.raises(DatabaseError):db.execute(sa.delete(m.TaskHoldInterval))
        db.rollback()


def test_custom_behavior_is_explicit_and_hold_reason_policy_is_tenant_scoped(client,data):
    doc,custom=add(client,data.owner,'Client pause')
    draft=payload(doc);draft['hold_reason_required']=True;draft['statuses'][-1]['workflow_behavior']='HOLD'
    updated=client.put('/api/task-statuses',headers=headers(data.owner),json=draft)
    assert updated.status_code==200,updated.text
    url=f'/api/tasks/{data.task.id}/kanban-status'
    assert client.patch(url,headers=headers(data.owner),json={'status_id':custom['id']}).status_code==422
    held=client.patch(url,headers=headers(data.owner),json={'status_id':custom['id'],'hold_reason':'Approval pending'})
    assert held.status_code==200,held.text
    assert held.json()['status']=='ON_HOLD' and held.json()['custom_status_id']==custom['id']
    draft=payload(updated.json());draft['statuses'][-1]['workflow_behavior']='ACTIVE'
    assert client.put('/api/task-statuses',headers=headers(data.owner),json=draft).status_code==409
    draft['statuses'][-1]['workflow_behavior']='HOLD';draft['statuses'][-1]['display_label']='Still waiting'
    assert client.put('/api/task-statuses',headers=headers(data.owner),json=draft).status_code==200
    with data.factory() as db:
        assert db.get(m.Task,data.task.id).status==m.TaskStatusEnum.ON_HOLD
        assert db.get(m.User,data.owner.id).points==125
        notifications=list(db.scalars(sa.select(m.Notification).where(m.Notification.related_task_id==data.task.id)))
        assert any('Still waiting' not in row.message and 'Client pause' in row.message for row in notifications)
    assert not document(client,data.outsider)['hold_reason_required']


def test_concurrent_hold_completion_retries_are_serialized(client,data):
    document(client,data.owner)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies=list(pool.map(lambda _:client.patch(f'/api/tasks/{data.task.id}',headers=headers(data.owner),json={'status':'ON_HOLD','hold_reason':'Concurrent hold'}),range(2)))
    assert all(reply.status_code==200 for reply in replies),[reply.text for reply in replies]
    with data.factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(m.TaskHoldInterval))==1
        db.get(m.Subtask,data.child.id).status=m.SubtaskStatusEnum.DONE;db.get(m.Subtask,data.child.id).completed=True;db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies=list(pool.map(lambda _:client.post(f'/api/tasks/{data.task.id}/complete',headers=headers(data.owner)),range(2)))
    assert all(reply.status_code==200 for reply in replies),[reply.text for reply in replies]
    with data.factory() as db:
        assert db.get(m.User,data.owner.id).tasks_completed==1
        assert db.scalar(sa.select(sa.func.count()).select_from(m.TaskHoldInterval).where(m.TaskHoldInterval.ended_at.is_(None)))==0


def test_sql_reports_and_overdue_penalty_exclude_only_authorized_hold_time(client,data,monkeypatch):
    from backend.app.reporting.inventory import overdue
    from backend.app.services.points_table import resolve_task_points
    start=datetime(2026,1,1,10);clock=[start]
    monkeypatch.setattr(task_transitions,'utc_now',lambda:clock[0])
    with data.factory() as db:
        db.get(m.Task,data.task.id).due_at=start-timedelta(hours=1)
        db.get(m.Subtask,data.child.id).status=m.SubtaskStatusEnum.DONE
        db.get(m.Subtask,data.child.id).completed=True;db.commit()
    move(client,data,'ON_HOLD')
    clock[0]+=timedelta(days=4)
    with data.factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(m.Task).where(overdue(m.Task,clock[0])))==1
        task=db.get(m.Task,data.task.id)
        assert (clock[0]-task_deadlines.effective_deadline(task,clock[0])).total_seconds()==3600
        assert db.get(m.User,data.owner.id).points==125
    move(client,data,'IN_PROGRESS')
    move(client,data,'DONE')
    with data.factory() as db:
        task=db.get(m.Task,data.task.id);points=resolve_task_points(db,team=task.team,priority=task.priority)
        assert db.get(m.User,data.owner.id).points==125+points['base']+points['overduePenalty']
        assert db.scalar(sa.select(sa.func.count()).select_from(m.Task).where(overdue(m.Task,clock[0])))==0


def test_pending_mapping_renamed_reordered_columns_and_protected_completion_timestamp(client,data):
    doc,custom=add(client,data.owner,'Awaiting specification')
    draft=payload(doc);draft['statuses'][-1]['workflow_behavior']='PENDING'
    draft['statuses'][-1]['display_label']='Ready for battle'
    draft['statuses'].reverse()
    result=client.put('/api/task-statuses',headers=headers(data.owner),json=draft)
    assert result.status_code==200,result.text
    url=f'/api/tasks/{data.task.id}/kanban-status'
    result=client.patch(url,headers=headers(data.owner),json={'status_id':custom['id']})
    assert result.status_code==200,result.text
    assert result.json()['status']=='WAITING_FOR_REQUIREMENT' and result.json()['custom_status_id']==custom['id']
    board=client.get('/api/tasks/kanban',headers=headers(data.owner)).json()
    column=next(col for col in board['columns'] if col['status_id']==custom['id'])
    assert column['count']==1 and column['title']=='Ready for battle' and column['workflow_behavior']=='PENDING'
    assert client.patch(f'/api/tasks/{data.task.id}',headers=headers(data.owner),json={'status':'DONE','completed_at':'2000-01-01T00:00:00Z'}).status_code==422
    assert client.patch(f'/api/tasks/{data.task.id}',headers=headers(data.owner),json={'status':'DONE'}).status_code==409
    draft=payload(document(client,data.owner));draft['statuses'][0]['workflow_behavior']='COMPLETED'
    assert client.put('/api/task-statuses',headers=headers(data.owner),json=draft).status_code==422
    move(client,data,'IN_PROGRESS')
    with data.factory() as db:
        assert db.get(m.Task,data.task.id).custom_status_id is None
        assert db.get(m.User,data.owner.id).points==125
        custom_events=list(db.scalars(sa.select(m.TaskLifecycleEvent).where(m.TaskLifecycleEvent.task_id==data.task.id,m.TaskLifecycleEvent.event_type=='task.custom_status_changed')))
        assert custom_events


def test_subtask_completion_closes_hold_and_retains_existing_one_time_reward(client,data,monkeypatch):
    from backend.app.services import subtask_workflow
    clock=[datetime(2026,1,1,10)]
    monkeypatch.setattr(task_transitions,'utc_now',lambda:clock[0])
    move(client,data,'ON_HOLD',hold_reason='Dependency blocked')
    clock[0]+=timedelta(hours=5)
    with data.factory() as db:
        task=db.get(m.Task,data.task.id)
        subtask_workflow.transition_subtask(db,task,actor=data.owner,subtask_id=data.child.id,target_status=m.SubtaskStatusEnum.DONE)
        db.commit()
        db.refresh(task)
        assert task.status==m.TaskStatusEnum.DONE and task.hold_started_at is None
        assert task.hold_paused_seconds==pytest.approx(5*3600,abs=.001)
        points=db.get(m.User,data.owner.id).points
        subtask_workflow.transition_subtask(db,task,actor=data.owner,subtask_id=data.child.id,target_status=m.SubtaskStatusEnum.TODO)
        db.commit()
        assert task.status==m.TaskStatusEnum.IN_PROGRESS and task.completed_at is None
        subtask_workflow.transition_subtask(db,task,actor=data.owner,subtask_id=data.child.id,target_status=m.SubtaskStatusEnum.DONE)
        db.commit()
        assert db.get(m.User,data.owner.id).points==points


def test_explicit_hold_with_completed_subtasks_cannot_award_transient_completion(client,data):
    response=client.patch(f'/api/tasks/{data.task.id}',headers=headers(data.owner),json={
        'status':'ON_HOLD','hold_reason':'Awaiting release approval',
        'subtasks':[{'id':data.child.id,'title':'Child','status':'DONE','completed':True,'assigned_to_id':data.owner.id}]})
    assert response.status_code==200,response.text
    assert response.json()['status']=='ON_HOLD' and response.json()['completed_at'] is None
    with data.factory() as db:
        task=db.get(m.Task,data.task.id)
        assert task.completion_xp_awarded_at is None
        assert db.get(m.User,data.owner.id).points==125
        assert db.get(m.User,data.owner.id).tasks_completed==0
        assert len(list(db.scalars(sa.select(m.TaskHoldInterval))))==1


def test_hold_ledger_rejects_cross_workspace_and_overlapping_sql_writes(client,data):
    move(client,data,'ON_HOLD')
    with data.factory() as db:
        original=db.scalar(sa.select(m.TaskHoldInterval))
        for tenant,task in ((data.outsider.tenant_id,data.task.id),(data.owner.tenant_id,str(uuid4())),(data.owner.tenant_id,data.task.id)):
            db.add(m.TaskHoldInterval(id=str(uuid4()),tenant_id=tenant,task_id=task,started_at=original.started_at,
                previous_status='TODO',source='untrusted'))
            with pytest.raises(DatabaseError):db.flush()
            db.rollback()


@pytest.mark.parametrize('legacy_hold',[False,True])
def test_phase3_migration_preserves_legacy_identity_history_and_cutover(client,data,legacy_hold,monkeypatch):
    from importlib import import_module
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from backend.app import status_business_schema_v3, task_status_schema, kanban_schema_v2
    document(client,data.owner)
    migration=import_module('backend.alembic.versions.f228f9a0b1c2_core_status_business_rules')
    with data.factory.begin() as db:
        connection=db.connection()
        status_business_schema_v3.uninstall(connection)
        connection.execute(sa.text('DROP TABLE task_hold_intervals'))
        for column in ('hold_started_at','hold_paused_seconds','hold_previous_status','hold_reason','status_transitioned_at','status_transition_version'):
            connection.execute(sa.text(f'ALTER TABLE tasks DROP COLUMN {column}'))
        connection.execute(sa.text('ALTER TABLE task_status_scopes DROP COLUMN hold_reason_required'))
        connection.execute(sa.text('ALTER TABLE task_statuses DROP COLUMN workflow_behavior'))
        task_status_schema.install(connection);kanban_schema_v2.install(connection)
        if legacy_hold:connection.execute(sa.text("UPDATE tasks SET status='ON_HOLD' WHERE id=:id"),{'id':data.task.id})
        before=dict(connection.execute(sa.text('SELECT id,status,due_at,created_at,updated_at,assigned_to_id FROM tasks WHERE id=:id'),{'id':data.task.id}).mappings().one())
        statuses=list(connection.execute(sa.text('SELECT id,code,legacy_status FROM task_statuses ORDER BY id')))
        history=list(connection.execute(sa.text('SELECT * FROM task_lifecycle_events ORDER BY id')))
        monkeypatch.setattr(migration,'op',Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        after=dict(connection.execute(sa.text('SELECT id,status,due_at,created_at,updated_at,assigned_to_id FROM tasks WHERE id=:id'),{'id':data.task.id}).mappings().one())
        assert before==after
        assert list(connection.execute(sa.text('SELECT id,code,legacy_status FROM task_statuses ORDER BY id')))==statuses
        assert list(connection.execute(sa.text('SELECT * FROM task_lifecycle_events ORDER BY id')))==history
        holds=list(connection.execute(sa.text('SELECT * FROM task_hold_intervals')).mappings())
        assert len(holds)==int(legacy_hold)
        if legacy_hold:
            assert holds[0]['source']=='migration:f228f9a0b1c2' and holds[0]['ended_at'] is None
            assert holds[0]['original_due_at']==before['due_at']
        assert connection.scalar(sa.text('SELECT hold_paused_seconds FROM tasks WHERE id=:id'),{'id':data.task.id})==0
        with pytest.raises(RuntimeError,match='Refusing'):migration.downgrade()
    move(client,data,'IN_PROGRESS')
    move(client,data,'ON_HOLD',hold_reason='After upgrade')
    with data.factory() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(m.TaskHoldInterval).where(m.TaskHoldInterval.ended_at.is_(None)))==1
