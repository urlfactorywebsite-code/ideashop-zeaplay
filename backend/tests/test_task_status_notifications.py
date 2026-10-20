"""Creation and every task status transition reach history and committed push."""
from uuid import uuid4

import pytest
from sqlalchemy import select

from backend.app import models
from backend.app.realtime import capture
from backend.app.routers import tasks
from backend.app.services import notification_dispatcher as dispatcher
from backend.tests.test_task_lifecycle import api, auth, data, engine  # noqa: F401


@pytest.fixture(autouse=True)
def delivery(data, monkeypatch):
    sent = []
    data.factory.configure(autoflush=False)
    monkeypatch.setattr(tasks, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(dispatcher, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(dispatcher.audit_logger, "log_event", lambda *_args: None)
    monkeypatch.setattr(tasks, "_invalidate_task_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(tasks, "_schedule_notification_outbox_delivery", lambda *_args: None)
    monkeypatch.setattr(tasks, "_publish_subtask_workflow_events", lambda *_args: None)
    monkeypatch.setattr(capture, "publish", lambda *_args: None)

    def send(db, *, user_ids, payload):
        # Delivery must see the committed bell history in a separate session.
        assert db.get(models.Notification, payload["notification_id"]) is not None
        sent.append((user_ids, payload))
        return len(user_ids)

    monkeypatch.setattr(dispatcher.push_service, "send_push", send)
    with data.factory() as db:
        for user in db.scalars(select(models.User)):
            user.email = user.email.replace("@example.test", "@example.com")
        db.get(models.Subtask, data.child.id).status = models.SubtaskStatusEnum.DONE
        db.commit()
    return sent


def notices(data, task_id=None):
    with data.factory() as db:
        return list(db.scalars(select(models.Notification).where(
            models.Notification.related_task_id == (task_id or data.task.id))))


def test_self_assigned_creation_generates_history_and_push(api, data, delivery):
    with data.factory() as db:
        customer = models.Client(tenant_id=data.owner.tenant_id, company_name="Notification test",
            normalized_company_name=str(uuid4()), country="India")
        db.add(customer)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=customer.id,
            name="Self assigned", normalized_name=str(uuid4()))
        db.add(project)
        db.flush()
        db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=project.id,
            user_id=data.owner.id, role=models.ProjectMemberRoleEnum.MANAGER))
        db.commit()
    response = api.post("/api/tasks", headers=auth(data.owner), json={
        "title": "My own task", "project_id": project.id, "assigned_to_ids": [data.owner.id]})
    assert response.status_code == 201, response.text
    rows = notices(data, response.json()[0]["id"])
    assert len(rows) == 1
    assert rows[0].type == models.NotificationTypeEnum.TASK_CREATED
    assert rows[0].user_id == data.owner.id
    assert len(delivery) == 1 and delivery[0][0] == [data.owner.id]
    assert delivery[0][1]["notification_id"] == rows[0].id


def test_every_status_notifies_self_once_and_same_status_is_silent(api, data, delivery):
    for target in models.TaskStatusEnum:
        previous = models.TaskStatusEnum.IN_PROGRESS if target == models.TaskStatusEnum.TODO else models.TaskStatusEnum.TODO
        with data.factory() as db:
            db.get(models.Task, data.task.id).status = previous
            db.commit()
        before = len(notices(data))
        pushes_before = len(delivery)
        response = api.patch(f"/api/tasks/{data.task.id}", json={"status": target.value}, headers=auth(data.owner))
        assert response.status_code == 200, response.text
        rows = notices(data)
        assert len(rows) == before + 1, target.value
        row = next(row for row in rows if row.id not in {item[1]["notification_id"] for item in delivery[:pushes_before]})
        assert row.user_id == data.owner.id
        assert previous.value.replace("_", " ").title() in row.message
        assert target.value.replace("_", " ").title() in row.message
        assert len(delivery) == pushes_before + 1
        assert delivery[-1][0] == [data.owner.id]
        assert delivery[-1][1]["notification_id"] == row.id
        assert delivery[-1][1]["url"] == f"/#/tasks?taskId={data.task.id}"
        repeat = api.patch(f"/api/tasks/{data.task.id}", json={"status": target.value}, headers=auth(data.owner))
        assert repeat.status_code == 200, repeat.text
        assert len(notices(data)) == before + 1
        assert len(delivery) == pushes_before + 1


def test_complete_endpoint_and_subtask_completion_reopening_notify_self(api, data, delivery):
    response = api.post(f"/api/tasks/{data.task.id}/complete", headers=auth(data.owner))
    assert response.status_code == 200, response.text
    assert len(notices(data)) == 1 and len(delivery) == 1
    repeat = api.post(f"/api/tasks/{data.task.id}/complete", headers=auth(data.owner))
    assert repeat.status_code == 200 and len(notices(data)) == 1 and len(delivery) == 1
    for target, parent in [("TODO", "IN_PROGRESS"), ("DONE", "DONE")]:
        response = api.patch(f"/api/tasks/{data.task.id}/subtasks/{data.child.id}",
            json={"status": target}, headers=auth(data.owner))
        assert response.status_code == 200, response.text
        assert response.json()["status"] == parent
        parent_rows = [row for row in notices(data) if row.entity_type == models.NotificationEntityTypeEnum.TASK]
        assert parent_rows[-1].user_id == data.owner.id
        assert parent.replace("_", " ").title() in parent_rows[-1].message
        assert len(parent_rows) == (2 if target == "TODO" else 3)
    assert len(delivery) == len(notices(data))


def test_participants_receive_one_each_but_inactive_foreign_and_unrelated_do_not(api, data, delivery):
    with data.factory() as db:
        users = {}
        for name in ("assignee", "follower", "worker", "manager", "unrelated", "inactive", "foreign"):
            users[name] = models.User(id=str(uuid4()), tenant_id=uuid4() if name == "foreign" else data.owner.tenant_id,
                name=name, email=f"{uuid4()}@example.com", hashed_password="synthetic",
                role=models.RoleEnum.MANAGER if name == "manager" else models.RoleEnum.USER,
                status=models.UserStatusEnum.DEACTIVATED if name == "inactive" else models.UserStatusEnum.ACTIVE)
        db.add_all(users.values())
        customer = models.Client(tenant_id=data.owner.tenant_id, company_name="Participant test",
            normalized_company_name=str(uuid4()), country="India")
        db.add(customer)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=customer.id,
            name="Status notifications", normalized_name=str(uuid4()))
        db.add(project)
        db.flush()
        db.add_all([models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=project.id,
            user_id=user.id, role=models.ProjectMemberRoleEnum.MANAGER if name == "manager"
            else models.ProjectMemberRoleEnum.MEMBER) for name, user in users.items()
            if name in {"manager", "assignee", "follower", "worker"}])
        task = db.get(models.Task, data.task.id)
        task.project_id = project.id
        task.assigned_to_id = users["assignee"].id
        task.followers = [users[name] for name in ("follower", "inactive", "foreign")]
        db.get(models.Subtask, data.child.id).assigned_to_id = users["worker"].id
        db.commit()
    response = api.patch(f"/api/tasks/{data.task.id}", json={"status": "IN_PROGRESS"}, headers=auth(data.owner))
    assert response.status_code == 200, response.text
    expected = {data.owner.id, *(users[name].id for name in ("assignee", "follower", "worker", "manager"))}
    assert {row.user_id for row in notices(data)} == expected
    assert len(notices(data)) == len(expected)
    assert {recipient for recipients, _ in delivery for recipient in recipients} == expected


def test_disabled_task_push_still_records_self_status_history(api, data, delivery):
    with data.factory() as db:
        db.add(models.NotificationPreference(user_id=data.owner.id, module="tasks", push_enabled=False))
        db.commit()
    response = api.patch(f"/api/tasks/{data.task.id}", json={"status": "BLOCKED"}, headers=auth(data.owner))
    assert response.status_code == 200, response.text
    assert len(notices(data)) == 1
    assert delivery == []


def test_assigning_an_existing_task_to_self_notifies_once(api, data, delivery):
    with data.factory() as db:
        db.get(models.Task, data.task.id).assigned_to_id = None
        db.commit()
    response = api.patch(f"/api/tasks/{data.task.id}",
        json={"assigned_to_id": data.owner.id}, headers=auth(data.owner))
    assert response.status_code == 200, response.text
    rows = notices(data)
    assert len(rows) == 1 and rows[0].type == models.NotificationTypeEnum.TASK_ASSIGNED
    assert rows[0].user_id == data.owner.id
    assert len(delivery) == 1
    repeat = api.patch(f"/api/tasks/{data.task.id}",
        json={"assigned_to_id": data.owner.id}, headers=auth(data.owner))
    assert repeat.status_code == 200 and len(delivery) == 1
