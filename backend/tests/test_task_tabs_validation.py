"""Read-only task view contracts on disposable SQLite/PostgreSQL fixtures."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from backend.app import models
from backend.app.routers import tasks as task_routes
from backend.tests import test_task_lifecycle as lifecycle

api = lifecycle.api
auth = lifecycle.auth
data = lifecycle.data
engine = lifecycle.engine
history = lifecycle.history


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch, data):
    monkeypatch.setattr(task_routes, 'get_cached_json', lambda key: None)
    monkeypatch.setattr(task_routes, 'set_cached_json', lambda *args, **kwargs: None)
    with data.factory() as db:
        for actor in (data.owner, data.outsider):
            db.get(models.User, actor.id).email = f'{uuid4()}@example.com'
        db.commit()


def seed(data, times):
    with data.factory() as db:
        ids = []
        for value in times:
            task = models.Task(id=str(uuid4()), title=value, created_by_id=data.owner.id,
                assigned_to_id=data.owner.id, status=models.TaskStatusEnum.TODO,
                due_at=datetime.fromisoformat(value), created_at=datetime(2026, 1, 1, tzinfo=timezone.utc).replace(tzinfo=None))
            db.add(task)
            ids.append(task.id)
        foreign = models.Task(title='Foreign', created_by_id=data.outsider.id,
            assigned_to_id=data.outsider.id, due_at=datetime.fromisoformat(times[0]))
        db.add(foreign)
        db.commit()
        return ids


@pytest.mark.parametrize('zone,day,times,indices', [
    ('Asia/Kolkata', '2026-10-22', ['2026-10-21T18:29:59.999999', '2026-10-21T18:30:00', '2026-10-22T18:29:59.999999', '2026-10-22T18:30:00'], [1, 2]),
    ('America/New_York', '2026-03-08', ['2026-03-08T04:59:59.999999', '2026-03-08T05:00:00', '2026-03-09T03:59:59.999999', '2026-03-09T04:00:00'], [1, 2]),
    ('America/New_York', '2026-11-01', ['2026-11-01T03:59:59.999999', '2026-11-01T04:00:00', '2026-11-02T04:59:59.999999', '2026-11-02T05:00:00'], [1, 2]),
])
def test_calendar_summaries_and_selected_day_agree_at_timezone_boundaries(api, data, zone, day, times, indices):
    ids = seed(data, times)
    params = {'start_date': day, 'end_date': day, 'timezone': zone}
    summary = api.get('/api/tasks/calendar/summary', params=params, headers=auth(data.owner))
    assert summary.status_code == 200, summary.text
    assert summary.json()['days'][0]['date'] == day
    assert summary.json()['days'][0]['total'] == len(indices)
    tasks = api.get('/api/tasks/calendar/tasks', params=params, headers=auth(data.owner))
    assert tasks.status_code == 200, tasks.text
    assert {row['id'] for row in tasks.json()} == {ids[index] for index in indices}
    params['due_date'] = day
    assert {row['id'] for row in api.get('/api/tasks/calendar/tasks', params=params, headers=auth(data.owner)).json()} == {ids[index] for index in indices}
    with data.factory() as db:
        db.add(models.KanbanColumn(id='TODO', title='Case Filed', order=0))
        db.commit()
    listing = api.get('/api/tasks/page', params={'due_date': day, 'timezone': zone}, headers=auth(data.owner))
    assert listing.status_code == 200, listing.text
    assert {row['id'] for row in listing.json()['items']} == {ids[index] for index in indices}
    board = api.get('/api/tasks/kanban', params={'due_date': day, 'timezone': zone}, headers=auth(data.owner))
    assert board.status_code == 200, board.text
    assert {row['id'] for row in board.json()['columns'][0]['items']} == {ids[index] for index in indices}


def test_calendar_profile_default_invalid_zone_and_bounded_range(api, data):
    seed(data, ['2026-10-21T19:00:00'])
    with data.factory() as db:
        db.get(models.User, data.owner.id).timezone = 'Asia/Kolkata'
        db.commit()
    params = {'start_date': '2026-10-22', 'end_date': '2026-10-22'}
    assert api.get('/api/tasks/calendar/summary', params=params, headers=auth(data.owner)).json()['days'][0]['total'] == 1
    for suffix in ('summary', 'tasks'):
        assert api.get('/api/tasks/calendar/' + suffix, params={**params, 'timezone': 'Invalid/Timezone'}, headers=auth(data.owner)).status_code == 400
        assert api.get('/api/tasks/calendar/' + suffix, params={**params, 'end_date': '2030-01-01'}, headers=auth(data.owner)).status_code == 400


def test_calendar_cache_separates_timezone_boundaries(api, data, monkeypatch):
    seed(data, ['2026-10-21T19:00:00'])
    store = {}
    monkeypatch.setattr(task_routes, 'get_cached_json', store.get)
    monkeypatch.setattr(task_routes, 'set_cached_json', lambda key, value, **kwargs: store.__setitem__(key, value))
    params = {'start_date': '2026-10-22', 'end_date': '2026-10-22'}
    for zone, total in [('Asia/Kolkata', 1), ('UTC', 0), ('Asia/Kolkata', 1)]:
        response = api.get('/api/tasks/calendar/summary', params={**params, 'timezone': zone}, headers=auth(data.owner))
        assert response.status_code == 200, response.text
        assert response.json()['days'][0]['total'] == total
    assert len(store) == 2


def test_view_reads_preserve_task_history_comments_attachments_dependencies_and_timers(api, data):
    from backend.app import schemas
    from backend.app.services import time_tracking
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        task.status = models.TaskStatusEnum.IN_PROGRESS
        task.attachments = ['uploads/proof.png']
        task.due_at = datetime(2026, 10, 22, 10, tzinfo=timezone.utc).replace(tzinfo=None)
        predecessor = models.Task(title='Predecessor', created_by_id=data.owner.id)
        task.dependencies.append(predecessor)
        db.add(models.Comment(task_id=task.id, user_id=data.owner.id, content='Preserved comment'))
        db.commit()
        time_tracking.start_timer(db, data.owner, schemas.TimeEntryStart(task_id=task.id))

    def snapshot():
        with data.factory() as db:
            task = db.get(models.Task, data.task.id)
            return (task.status, task.due_at, task.updated_at, task.attachments,
                [dependency.id for dependency in task.dependencies],
                [(comment.id, comment.content) for comment in task.comments],
                [(row.id, row.event_type) for row in history(db, task.id)],
                [(row.id, row.status, row.started_at, row.stopped_at) for row in db.scalars(select(models.TimeEntry).where(models.TimeEntry.task_id == task.id))])
    before = snapshot()
    for route in ('/api/tasks/page', '/api/tasks/kanban', '/api/tasks',
                  '/api/tasks/calendar/summary?start_date=2026-10-22&end_date=2026-10-22&timezone=Asia/Kolkata',
                  '/api/tasks/calendar/tasks?start_date=2026-10-22&timezone=Asia/Kolkata'):
        response = api.get(route, headers=auth(data.owner))
        assert response.status_code == 200, response.text
    detail = api.get('/api/tasks/' + data.task.id, headers=auth(data.owner)).json()
    assert detail['attachments'] == ['uploads/proof.png']
    assert detail['dependencies'][0]['title'] == 'Predecessor'
    assert snapshot() == before


def test_task_and_kanban_pages_are_complete_stable_and_disjoint(api, data):
    ids = seed(data, ['2026-10-22T10:00:00'] * 5)
    with data.factory() as db:
        for task_id in ids:
            task = db.get(models.Task, task_id)
            task.title = 'Page check'
            task.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc).replace(tzinfo=None)
        db.add(models.KanbanColumn(id='TODO', title='Custom owner stage', order=0))
        db.commit()
    pages = []
    board_pages = []
    for number in (1, 2, 3):
        params = {'search': 'Page check', 'page_size': 2, 'page': number}
        response = api.get('/api/tasks/page', params=params, headers=auth(data.owner))
        assert response.status_code == 200, response.text
        assert response.json()['total_pages'] == 3
        pages.extend(row['id'] for row in response.json()['items'])
        board = api.get('/api/tasks/kanban', params=params, headers=auth(data.owner))
        assert board.status_code == 200, board.text
        column = board.json()['columns'][0]
        assert column['title'] == 'Custom owner stage'
        assert column['count'] == 5
        board_pages.extend(row['id'] for row in column['items'])
    assert pages == sorted(ids, reverse=True)
    assert len(set(board_pages)) == 5
    assert set(board_pages) == set(ids)


def test_kanban_api_cannot_bypass_completion_dependency_or_tenant_rules(api, data):
    with data.factory() as db:
        successor = models.Subtask(task_id=data.task.id, title='Blocked successor',
            assigned_to_id=data.owner.id, status=models.SubtaskStatusEnum.WAITING)
        db.add(successor)
        db.flush()
        successor_id = successor.id
        db.add(models.SubtaskDependency(task_id=data.task.id, subtask_id=successor_id,
            depends_on_subtask_id=data.child.id))
        db.commit()
        original_status = db.get(models.Task, data.task.id).status
        original_history = [(row.id, row.event_type) for row in history(db, data.task.id)]
    blocked = api.patch('/api/tasks/' + data.task.id, json={'status': 'DONE'}, headers=auth(data.owner))
    assert blocked.status_code == 409, blocked.text
    waiting = api.patch(f'/api/tasks/{data.task.id}/subtasks/{successor_id}',
        json={'status': 'IN_PROGRESS'}, headers=auth(data.owner))
    assert waiting.status_code == 422, waiting.text
    assert waiting.json()['detail'] == 'Force-start requires a reason'
    foreign = api.patch('/api/tasks/' + data.task.id, json={'status': 'IN_PROGRESS'}, headers=auth(data.outsider))
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()['detail'] == 'Task not found'
    with data.factory() as db:
        assert db.get(models.Task, data.task.id).status == original_status
        assert db.get(models.Subtask, successor_id).status == models.SubtaskStatusEnum.WAITING
        assert [(row.id, row.event_type) for row in history(db, data.task.id)] == original_history
