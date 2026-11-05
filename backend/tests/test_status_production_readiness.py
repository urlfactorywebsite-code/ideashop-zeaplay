"""Status release gates on real SQLite and isolated PostgreSQL connections."""
from datetime import datetime, timedelta
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
import sqlalchemy as sa

from backend.app import models as m
from backend.app.services import gamification, subtask_workflow
from backend.app.services import badge_engine, status_integrity
from backend.tests.test_task_status_management import client, data, engine, document, headers, payload, add  # noqa: F401


def test_scoring_refreshes_shared_account_across_different_tasks(data):
    with data.factory() as db:
        tasks=[m.Task(title=f'Award {i}',status=m.TaskStatusEnum.DONE,completed_at=datetime.utcnow(),
                      created_by_id=data.owner.id,assigned_to_id=data.owner.id) for i in range(2)]
        db.add_all(tasks);db.commit()
        ids=[task.id for task in tasks]
        expected=gamification.resolve_task_points(db,team=tasks[0].team,priority=tasks[0].priority)['base']
    with data.factory() as stale:
        account=stale.get(m.User,data.owner.id)  # Request began before another task completed.
        assert account.points==125
        with data.factory() as writer:
            assert gamification.award_task_completion_points(writer,writer.get(m.Task,ids[0]),notify_creator=False)
            writer.commit()
        assert gamification.award_task_completion_points(stale,stale.get(m.Task,ids[1]),notify_creator=False)
        stale.commit()
    with data.factory() as db:
        assert db.get(m.User,data.owner.id).points==125+2*expected
        assert db.get(m.User,data.owner.id).tasks_completed==2


def test_subtask_reopen_refreshes_parent_after_another_request_completed_it(data):
    with data.factory() as stale:
        parent=stale.get(m.Task,data.task.id)
        assert parent.status==m.TaskStatusEnum.TODO
        with data.factory() as writer:
            writer.get(m.Task,parent.id).status=m.TaskStatusEnum.DONE
            child=writer.get(m.Subtask,data.child.id)
            child.status=m.SubtaskStatusEnum.DONE;child.completed=True
            writer.commit()
        subtask_workflow.transition_subtask(stale,parent,actor=data.owner,subtask_id=data.child.id,
                                            target_status=m.SubtaskStatusEnum.TODO)
        stale.commit()
    with data.factory() as db:
        assert db.get(m.Task,data.task.id).status==m.TaskStatusEnum.IN_PROGRESS
        assert db.get(m.Task,data.task.id).completed_at is None


def test_stale_kanban_configuration_cannot_change_business_meaning(client,data):
    doc,custom=add(client,data.owner,'Awaiting customer')
    draft=payload(doc)
    draft['statuses'][-1]['workflow_behavior']='HOLD'
    changed=client.put('/api/task-statuses',headers=headers(data.owner),json=draft)
    assert changed.status_code==200,changed.text
    response=client.patch(f'/api/tasks/{data.task.id}/kanban-status',headers=headers(data.owner),json={
        'status_id':custom['id'],'configuration_revision':doc['revision']})
    assert response.status_code==409,response.text
    with data.factory() as db:
        assert db.get(m.Task,data.task.id).status==m.TaskStatusEnum.TODO
        assert db.scalar(sa.select(sa.func.count()).select_from(m.TaskHoldInterval))==0


def test_hold_and_audit_queries_have_composite_indexes(engine):
    with engine.connect() as connection:
        indexes={item['name']:item for table in ('tasks','task_hold_intervals','status_configuration_audits')
                 for item in sa.inspect(connection).get_indexes(table)}
    assert indexes['ix_tasks_status_custom_updated_id']['column_names']==['status','custom_status_id','updated_at','id']
    assert indexes['ix_status_audit_tenant_created_id']['column_names']==['tenant_id','created_at','id']
    assert indexes['ix_task_hold_task_started_id']['column_names']==['task_id','started_at','id']


def test_real_concurrent_awards_for_different_tasks_preserve_totals(data):
    with data.factory() as db:
        tasks=[m.Task(title=f'Concurrent award {i}',status=m.TaskStatusEnum.DONE,completed_at=datetime.utcnow(),
            created_by_id=data.owner.id,assigned_to_id=data.owner.id) for i in range(2)]
        db.add_all(tasks);db.commit();ids=[task.id for task in tasks]
        points=gamification.resolve_task_points(db,team=tasks[0].team,priority=tasks[0].priority)['base']
    def complete(task_id):
        with data.factory() as db:
            result=gamification.award_task_completion_points(db,db.get(m.Task,task_id),notify_creator=False)
            db.commit();return result
    with ThreadPoolExecutor(max_workers=2) as pool:assert all(pool.map(complete,ids))
    with data.factory() as db:
        assert db.get(m.User,data.owner.id).points==125+2*points
        assert db.get(m.User,data.owner.id).tasks_completed==2


def test_badge_progress_refreshes_after_another_task_completion(data):
    with data.factory() as db:
        badge=m.Badge(id='readiness-badge',name='Two conquests',description='Synthetic',tier='common',bonus_xp=99,state=m.BadgeStateEnum.ACTIVE)
        badge.ruleset=m.BadgeRule(rules={'operator':'AND','rules':[{'entity':'task','event':'completed','conditions':{'assigned_to':'self'},'count':{'type':'>=','value':2}}]})
        db.add(badge);db.flush()
        db.add(m.UserBadgeProgress(user_id=data.owner.id,badge_id=badge.id,progress_state={'rules':[{'count':0,'window_started_at':None,'last_event_at':None}]}))
        db.commit()
    event=badge_engine.BadgeEvent(entity='task',event='completed',actor_id=data.owner.id,assigned_to_id=data.owner.id,created_by_id=data.owner.id)
    with data.factory() as stale:
        progress=stale.scalar(sa.select(m.UserBadgeProgress))
        account=stale.get(m.User,data.owner.id)
        assert progress.progress_state['rules'][0]['count']==0 and account.points==125
        with data.factory() as writer:
            badge_engine.process_badge_event(writer,event=event);writer.commit()
        badge_engine.process_badge_event(stale,event=event);stale.commit()
    with data.factory() as db:
        progress=db.scalar(sa.select(m.UserBadgeProgress))
        assert progress.progress_state['rules'][0]['count']==2
        assert progress.status==m.BadgeProgressStatusEnum.EARNED
        assert db.get(m.User,data.owner.id).points==224


def test_integrity_check_detects_summary_corruption_and_disabled_guards(client,data,engine):
    document(client,data.owner)
    with engine.connect() as connection:
        assert status_integrity.schema_issues(connection)==[]
        assert status_integrity.audit_data(connection)['errors']=={}
    with engine.begin() as connection:
        connection.execute(sa.text('UPDATE tasks SET hold_paused_seconds=86400 WHERE id=:id'),{'id':data.task.id})
        assert status_integrity.audit_data(connection)['errors']['closed_hold_summary']==1
        connection.execute(sa.text('UPDATE tasks SET hold_paused_seconds=0 WHERE id=:id'),{'id':data.task.id})
        if engine.dialect.name=='postgresql':
            connection.execute(sa.text('ALTER TABLE tasks DISABLE TRIGGER zea_hold_capture'))
            assert 'missing_guard:zea_hold_capture' in status_integrity.schema_issues(connection)
            connection.execute(sa.text('ALTER TABLE tasks ENABLE TRIGGER zea_hold_capture'))
        else:
            definition=connection.scalar(sa.text("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='zea_hold_exit'"))
            connection.execute(sa.text('DROP TRIGGER zea_hold_exit'))
            assert 'missing_guard:zea_hold_exit' in status_integrity.schema_issues(connection)
            connection.execute(sa.text(definition))
        assert status_integrity.schema_issues(connection)==[]
        assert status_integrity.audit_data(connection)['errors']=={}


def test_index_migration_round_trip_preserves_tasks_and_history(client,data,engine,monkeypatch):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    document(client,data.owner)
    migration=import_module('backend.alembic.versions.f339a0b1c2d3_status_query_indexes')
    with engine.begin() as connection:
        monkeypatch.setattr(migration,'op',Operations(MigrationContext.configure(connection)))
        before=connection.execute(sa.text('SELECT id,status,created_at,due_at FROM tasks ORDER BY id')).all()
        history=connection.scalar(sa.text('SELECT count(*) FROM task_lifecycle_events'))
        migration.downgrade()
        assert any(issue.startswith('missing_index:') for issue in status_integrity.schema_issues(connection))
        migration.upgrade();migration.upgrade()
        assert connection.execute(sa.text('SELECT id,status,created_at,due_at FROM tasks ORDER BY id')).all()==before
        assert connection.scalar(sa.text('SELECT count(*) FROM task_lifecycle_events'))==history
        assert status_integrity.schema_issues(connection)==[]
        connection.exec_driver_sql('DROP INDEX ix_tasks_status_custom_updated_id')
        connection.exec_driver_sql('CREATE INDEX ix_tasks_status_custom_updated_id ON tasks (id)')
        assert 'index_definition:ix_tasks_status_custom_updated_id' in status_integrity.schema_issues(connection)
        with pytest.raises(RuntimeError,match='reviewed repair'):migration.upgrade()
        connection.exec_driver_sql('DROP INDEX ix_tasks_status_custom_updated_id')
        migration.upgrade()
        assert status_integrity.schema_issues(connection)==[]


def test_kanban_index_query_plan_and_bounded_population(client,data,engine):
    import time
    document(client,data.owner)
    with data.factory() as db:
        db.add_all([m.Task(title=f'Synthetic {i}',created_by_id=data.owner.id,
            status=m.TaskStatusEnum.IN_PROGRESS if i<100 else m.TaskStatusEnum.TODO,
            updated_at=datetime(2026,1,1)+timedelta(seconds=i)) for i in range(2000)])
        db.commit()
    query="SELECT id FROM tasks WHERE status='IN_PROGRESS' AND custom_status_id IS NULL ORDER BY updated_at DESC,id LIMIT 20"
    with engine.connect() as connection:
        if engine.dialect.name=='postgresql':
            connection.execute(sa.text('ANALYZE tasks'))
            plan=connection.scalar(sa.text('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query))
            assert 'ix_tasks_status_custom_updated_id' in json.dumps(plan)
            print('STATUS_INDEX_PLAN '+json.dumps(plan))
        else:
            plan=connection.execute(sa.text('EXPLAIN QUERY PLAN '+query)).all()
            assert 'ix_tasks_status_custom_updated_id' in str(plan)
    started=time.perf_counter()
    response=client.get('/api/tasks/kanban',headers=headers(data.owner))
    assert response.status_code==200,response.text
    assert sum(column['count'] for column in response.json()['columns'])==2001
    assert sum(len(column['items']) for column in response.json()['columns'])<=40
    print('STATUS_BOARD_SYNTHETIC '+json.dumps({'engine':engine.dialect.name,'tasks':2001,'milliseconds':round((time.perf_counter()-started)*1000,2)}))


def test_real_upgrade_cli_and_read_only_integrity_gate(client,data,engine,monkeypatch):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    document(client,data.owner)
    migration=import_module('backend.alembic.versions.f339a0b1c2d3_status_query_indexes')
    with engine.begin() as connection:
        monkeypatch.setattr(migration,'op',Operations(MigrationContext.configure(connection)))
        migration.downgrade()
        # Known disposable Phase 3 fixture only; never stamp a target deployment.
        connection.exec_driver_sql('CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)')
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('f228f9a0b1c2')")
        url=engine.url
        if engine.dialect.name=='postgresql':
            schema=connection.scalar(sa.text('SELECT current_schema()'))
            assert schema.startswith('lifecycle_')
            url=url.update_query_dict({'options':f'-csearch_path={schema},public'})
    environment={**os.environ,'VEE_BOOTSTRAP_SCHEMA':'false','VEE_DATABASE_URL':url.render_as_string(hide_password=False)}
    cwd=Path(__file__).resolve().parents[1]
    upgraded=subprocess.run([sys.executable,'-m','alembic','upgrade','f339a0b1c2d3'],cwd=cwd,env=environment,capture_output=True,text=True,timeout=60)
    assert upgraded.returncode==0,upgraded.stderr
    checked=subprocess.run([sys.executable,'scripts/check_status_integrity.py'],cwd=cwd,env=environment,capture_output=True,text=True,timeout=60)
    assert checked.returncode==0,checked.stderr+checked.stdout
    report=json.loads(checked.stdout)
    assert report['ok'] and report['integrity']['tasks_checked']==1
    assert report['integrity']['errors']=={}
    # The gate cannot be accidentally run through startup mutation helpers.
    environment['VEE_BOOTSTRAP_SCHEMA']='true'
    refused=subprocess.run([sys.executable,'scripts/check_status_integrity.py'],cwd=cwd,env=environment,capture_output=True,text=True,timeout=60)
    assert refused.returncode!=0 and 'read-only' in refused.stderr


def test_cross_process_completion_retries_award_once(data,engine):
    with data.factory() as db:
        task=m.Task(title='Multi-worker conquest',status=m.TaskStatusEnum.DONE,completed_at=datetime.utcnow(),
                    created_by_id=data.owner.id,assigned_to_id=data.owner.id)
        db.add(task);db.commit();task_id=task.id
        amount=gamification.resolve_task_points(db,team=task.team,priority=task.priority)['base']
    url=engine.url
    if engine.dialect.name=='postgresql':
        with engine.connect() as connection:schema=connection.scalar(sa.text('SELECT current_schema()'))
        url=url.update_query_dict({'options':f'-csearch_path={schema},public'})
    environment={**os.environ,'VEE_BOOTSTRAP_SCHEMA':'false','VEE_DATABASE_URL':url.render_as_string(hide_password=False),'STATUS_TEST_TASK_ID':task_id}
    script='''import os
from app.database import SessionLocal
from app import models as m
from app.tickets import models as tickets
from app.services.gamification import award_task_completion_points
with SessionLocal() as db:
    task=db.get(m.Task,os.environ['STATUS_TEST_TASK_ID'])
    print('READY',flush=True)
    input()
    awarded=award_task_completion_points(db,task,notify_creator=False)
    db.commit()
    print(int(awarded),flush=True)
'''
    processes=[]
    try:
        for _ in range(2):
            processes.append(subprocess.Popen([sys.executable,'-c',script],cwd=Path(__file__).resolve().parents[1],env=environment,
                                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
        for process in processes:assert process.stdout.readline().strip()=='READY'
        for process in processes:process.stdin.write('\n');process.stdin.flush()
        results=[]
        for process in processes:
            output,error=process.communicate(timeout=30)
            assert process.returncode==0,error
            results.append(int(output.strip()))
        assert sorted(results)==[0,1]
    finally:
        for process in processes:
            if process.poll() is None:process.terminate();process.wait(timeout=10)
    with data.factory() as db:
        assert db.get(m.User,data.owner.id).points==125+amount
        assert db.get(m.User,data.owner.id).tasks_completed==1


def test_membership_revocation_cannot_reuse_a_cached_kanban(client,data,monkeypatch):
    from backend.app.routers import tasks as router
    document(client,data.owner)
    with data.factory() as db:
        db.get(m.User,data.owner.id).role=m.RoleEnum.USER
        db.get(m.User,data.outsider.id).tenant_id=data.owner.tenant_id
        customer=m.Client(tenant_id=data.owner.tenant_id,company_name='Cache test client',normalized_company_name='cache test client')
        db.add(customer);db.flush()
        project=m.Project(tenant_id=data.owner.tenant_id,client_id=customer.id,name='Cache test project',normalized_name='cache test project')
        db.add(project);db.flush()
        db.add(m.ProjectMember(tenant_id=data.owner.tenant_id,project_id=project.id,user_id=data.owner.id,role=m.ProjectMemberRoleEnum.MEMBER))
        task=m.Task(title='Membership restricted quest',project_id=project.id,created_by_id=data.outsider.id)
        db.add(task);db.commit();task_id=task.id
    cache={}
    monkeypatch.setattr(router,'get_cached_json',lambda key:cache.get(key))
    monkeypatch.setattr(router,'set_cached_json',lambda key,value,**kwargs:cache.update({key:value}))
    before=client.get('/api/tasks/kanban',headers=headers(data.owner))
    assert before.status_code==200,before.text
    assert sum(column['count'] for column in before.json()['columns'])==2
    with data.factory() as db:
        db.execute(sa.delete(m.ProjectMember).where(m.ProjectMember.user_id==data.owner.id));db.commit()
    after=client.get('/api/tasks/kanban',headers=headers(data.owner))
    assert after.status_code==200,after.text
    assert sum(column['count'] for column in after.json()['columns'])==1
    assert task_id not in {task['id'] for column in after.json()['columns'] for task in column['items']}
