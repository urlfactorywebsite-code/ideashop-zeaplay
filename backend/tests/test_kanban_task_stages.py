"""Task/stage grouping keeps assignment visibility, identities and paging intact."""
from sqlalchemy import select

from backend.app import models as m
from backend.app.services import task_statuses
from backend.tests.test_task_groups import grouped, isolated_engine  # noqa: F401


def board(data, actor=None, **params):
    response = data.client.get('/api/tasks/kanban', headers={'x-actor': (actor or data.owner).id}, params=params)
    assert response.status_code == 200, response.text
    result = response.json()
    return result['columns'] + result['outside_columns']


def test_one_card_per_task_and_stage_with_complete_assignment_lists(grouped):  # noqa: F811
    data = grouped
    columns = board(data, project_id=data.projects[0].id, page_size=1)
    done = next(col for col in columns if col['status'] == 'DONE')
    active = next(col for col in columns if col['status'] == 'IN_PROGRESS')
    assert done['count'] == 1 and len(done['items']) == 1
    assert active['count'] == 1 and len(active['items']) == 1
    for column, expected in ((done, data.rows[:2]), (active, data.rows[2:])):
        members = column['items'][0]['group_assignments']
        assert {member['id'] for member in members} == {row.id for row in expected}
        assert all(member['status'] == column['status'] for member in members)
        assert all(member['can_edit'] for member in members)
        assert {member['assigned_member']['id'] for member in members} == {row.assigned_to_id for row in expected}
        assert all(member['group_assignments'] is None for member in members)
    second_page = board(data, project_id=data.projects[0].id, page_size=1, page=2)
    assert all(not col['items'] for col in second_page)


def test_same_title_different_tasks_and_scopes_remain_separate(grouped):  # noqa: F811
    data = grouped
    with data.factory() as db:
        db.get(m.Task, data.unrelated.id).status = m.TaskStatusEnum.IN_PROGRESS
        db.commit()
    params = {'project_id': data.projects[0].id, 'page_size': 1}
    first = next(col for col in board(data, **params) if col['status'] == 'IN_PROGRESS')
    second = next(col for col in board(data, page=2, **params) if col['status'] == 'IN_PROGRESS')
    assert first['count'] == second['count'] == 2
    cards = first['items'] + second['items']
    assert len(cards) == 2 and len({card['id'] for card in cards}) == 2
    assert sorted(len(card['group_assignments']) for card in cards) == [1, 6]
    assert all(card['title'] == 'Shared mission' for card in cards)
    all_cards = [item for col in board(data) for item in col['items']]
    collision = next(item for item in all_cards if item['id'] == data.collision.id)
    assert [member['id'] for member in collision['group_assignments']] == [data.collision.id]
    assert data.foreign.id not in str(all_cards)


def test_assignee_filter_and_permissions_apply_to_nested_assignments(grouped):  # noqa: F811
    data = grouped
    for index in (0, 2):
        own = data.rows[index]
        for actor, params in ((data.members[index], {}), (data.owner, {'assignee_id': own.assigned_to_id})):
            columns = board(data, actor, project_id=data.projects[0].id, **params)
            assert sum(col['count'] for col in columns) == 1
            members = [member for col in columns for item in col['items'] for member in item['group_assignments']]
            assert [member['id'] for member in members] == [own.id]
            for peer in data.rows:
                if peer.id != own.id:
                    assert peer.id not in str(columns) and peer.assigned_to_id not in str(columns)
    denied = data.client.get('/api/tasks/kanban', headers={'x-actor': data.outsider.id},
                             params={'project_id': data.projects[0].id})
    assert denied.status_code == 404


def test_custom_hidden_stage_does_not_merge_with_native_active_stage(grouped):  # noqa: F811
    data = grouped
    board(data)  # Provision the tenant status registry.
    with data.factory() as db:
        actor = db.get(m.User, data.owner.id)
        scope = task_statuses.scope(db, actor)
        from backend.app.routers.task_statuses import StatusDraft, StatusUpdate
        drafts = [StatusDraft(**{name: getattr(row, name) for name in StatusDraft.model_fields})
                  for row in task_statuses.rows(db, actor)]
        drafts.append(StatusDraft(system_name='Client Review', display_label='Client Review', kanban_visible=False))
        task_statuses.save(db, actor, StatusUpdate(revision=scope.revision, statuses=drafts))
        custom = next(row for row in task_statuses.rows(db, actor) if row.display_label == 'Client Review')
        for row in db.scalars(select(m.Task).where(m.Task.id.in_([item.id for item in data.rows[2:4]]))):
            row.custom_status_id = custom.id
        custom_id = custom.id
        db.commit()
    columns = board(data, project_id=data.projects[0].id, page_size=1)
    hidden = next(col for col in columns if col['status'] == custom_id)
    active = next(col for col in columns if col['status'] == 'IN_PROGRESS')
    assert hidden['outside_reason'] == 'hidden' and hidden['count'] == active['count'] == 1
    assert {member['id'] for member in hidden['items'][0]['group_assignments']} == {row.id for row in data.rows[2:4]}
    assert {member['id'] for member in active['items'][0]['group_assignments']} == {row.id for row in data.rows[4:]}
