"""Group assignment isolation through real HTTP routes and delivery policies."""
import asyncio
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from backend.app import models
from backend.app.reporting.scope import authorized_tasks
from backend.app.dependencies import get_current_active_user
from backend.app.routers import auth as auth_routes, comments, notifications, projects, task_lifecycle
from backend.app.services import notification_dispatcher, notification_outbox, time_tracking
from backend.app.ws import tasks as task_ws
from backend.tests.test_task_groups import grouped, isolated_engine  # noqa: F401


@pytest.mark.parametrize("index", [0, 1, 2])
def test_project_assignees_receive_only_own_rows_across_views(grouped, index):
    data = grouped
    actor, own = data.members[index], data.rows[index]
    headers = {"x-actor": actor.id}
    with data.factory() as db:
        for row in db.scalars(select(models.Task).where(models.Task.project_id == data.projects[0].id)):
            row.due_at = datetime(2026, 1, 2, 12)
        db.commit()
    for grouped_mode in (False, True):
        response = data.client.get("/api/tasks/page", headers=headers, params={
            "grouped": grouped_mode, "project_id": data.projects[0].id, "page_size": 1})
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["total"] == 1
        assert sum(payload["status_counts"].values()) == 1
        response = data.client.get("/api/tasks/page", headers=headers, params={
            "grouped": grouped_mode, "project_id": data.projects[0].id, "search": "mission"})
        assert response.status_code == 200, response.text
        item = next(item for item in response.json()["items"] if item["task_group_id"] == data.group_id)
        assert item["id"] == own.id
        if grouped_mode:
            assert [member["id"] for member in item["group_assignments"]] == [own.id]
        raw = response.text
        for peer in data.rows:
            if peer.id != own.id:
                assert peer.id not in raw and peer.assigned_to_id not in raw
    detail = data.client.get(f"/api/tasks/{own.id}/group", headers=headers)
    assert detail.status_code == 200, detail.text
    assert [row["id"] for row in detail.json()] == [own.id]
    own_detail = data.client.get(f"/api/tasks/{own.id}", headers=headers)
    assert own_detail.status_code == 200 and own_detail.json()["can_edit"]
    flat = data.client.get("/api/tasks", headers=headers, params={"project_id": data.projects[0].id})
    assert flat.status_code == 200, flat.text
    assert {row["id"] for row in flat.json()} == {own.id}
    board = data.client.get("/api/tasks/kanban", headers=headers, params={"project_id": data.projects[0].id})
    assert board.status_code == 200, board.text
    columns = board.json()["columns"] + board.json()["outside_columns"]
    assert sum(column["count"] for column in columns) == 1
    assert {row["id"] for column in columns for row in column["items"]} == {own.id}
    dates = {"start_date": "2026-01-02", "end_date": "2026-01-02", "project_id": data.projects[0].id}
    calendar = data.client.get("/api/tasks/calendar/tasks", headers=headers, params=dates)
    assert calendar.status_code == 200, calendar.text
    assert {row["id"] for row in calendar.json()} == {own.id}
    summary = data.client.get("/api/tasks/calendar/summary", headers=headers, params=dates)
    assert summary.status_code == 200, summary.text
    assert sum(day["total"] for day in summary.json()["days"]) == 1
    filtered = data.client.get("/api/tasks/page", headers=headers, params={
        "grouped": True, "assignee_id": data.members[(index + 1) % 3].id})
    assert filtered.status_code == 200 and filtered.json()["total"] == 0


def test_guessed_assignment_ids_cannot_read_or_mutate_peers(grouped):
    data = grouped
    own, peer = data.rows[2], data.rows[3]
    headers = {"x-actor": data.members[2].id}
    for suffix in ("", "/group", "/summary", "/holds", "/transfer-requests"):
        response = data.client.get(f"/api/tasks/{peer.id}{suffix}", headers=headers)
        assert response.status_code == 403, response.text
    for method, suffix, body in (("patch", "", {"status": "BLOCKED"}),
                                 ("post", "/complete", None), ("delete", "", None)):
        response = getattr(data.client, method)(f"/api/tasks/{peer.id}{suffix}", headers=headers,
            **({"json": body} if body else {}))
        assert response.status_code == 403, response.text
    with data.factory() as db:
        for check in (comments._ensure_comment_access, time_tracking.ensure_task_visible):
            with pytest.raises(HTTPException) as denied:
                check(db.get(models.Task, peer.id), db.get(models.User, data.members[2].id))
            assert denied.value.status_code == 403
        with pytest.raises(HTTPException) as denied:
            task_lifecycle._authorized(db, peer.id, db.get(models.User, data.members[2].id))
        assert denied.value.status_code == 403
    response = data.client.patch(f"/api/tasks/{own.id}", headers=headers, json={"status": "BLOCKED"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "BLOCKED"
    with data.factory() as db:
        assert db.get(models.Task, peer.id).status == models.TaskStatusEnum.IN_PROGRESS
    creator = data.client.get(f"/api/tasks/{own.id}/group")
    assert len(creator.json()) == len(data.rows)


def test_creator_is_not_required_to_have_a_privileged_role(grouped):
    data = grouped
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = models.RoleEnum.USER
        db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=data.projects[0].id,
            user_id=data.owner.id, role=models.ProjectMemberRoleEnum.MEMBER))
        db.commit()
    detail = data.client.get(f"/api/tasks/{data.rows[0].id}/group")
    assert detail.status_code == 200, detail.text
    assert {item["id"] for item in detail.json()} == {row.id for row in data.rows}
    for _ in range(2):
        response = data.client.get("/api/tasks/page", params={"grouped": True, "project_id": data.projects[0].id})
        assert response.status_code == 200, response.text
        cards = [item for item in response.json()["items"] if item["task_group_id"] == data.group_id]
        assert len(cards) == 1 and len(cards[0]["group_assignments"]) == len(data.rows)


def test_creator_keeps_members_added_by_an_authorized_project_manager(grouped):
    data = grouped
    created = data.client.post("/api/tasks", json={"title": "Manager-extended quest",
        "project_id": data.projects[0].id, "assigned_to_ids": [user.id for user in data.members[:2]]})
    assert created.status_code == 201, created.text
    original = created.json()
    with data.factory() as db:
        db.get(models.User, data.owner.id).role = models.RoleEnum.USER
        db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=data.projects[0].id,
            user_id=data.owner.id, role=models.ProjectMemberRoleEnum.MEMBER))
        manager = db.get(models.User, data.members[7].id)
        manager.role = models.RoleEnum.MANAGER
        membership = db.scalar(select(models.ProjectMember).where(
            models.ProjectMember.project_id == data.projects[0].id, models.ProjectMember.user_id == manager.id))
        membership.role = models.ProjectMemberRoleEnum.MANAGER
        db.commit()
    added = data.client.post("/api/tasks", headers={"x-actor": data.members[7].id}, json={
        "title": "Manager-extended quest", "project_id": data.projects[0].id,
        "task_group_id": original[0]["task_group_id"], "assigned_to_ids": [data.members[2].id]})
    assert added.status_code == 201, added.text
    assert added.json()[0]["created_by_id"] == data.members[7].id
    expected_ids = {item["id"] for item in original + added.json()}
    detail = data.client.get(f"/api/tasks/{original[0]['id']}/group")
    assert detail.status_code == 200, detail.text
    assert {item["id"] for item in detail.json()} == expected_ids
    page = data.client.get("/api/tasks/page", params={"grouped": True, "search": "Manager-extended"})
    assert len(page.json()["items"]) == 1
    assert {item["id"] for item in page.json()["items"][0]["group_assignments"]} == expected_ids
    # Group creator read access does not grant management of another actor's row.
    assert data.client.patch(f"/api/tasks/{added.json()[0]['id']}", json={"status": "DONE"}).status_code == 403
    assignee = data.client.get(f"/api/tasks/{original[0]['id']}/group", headers={"x-actor": data.members[0].id})
    assert [item["id"] for item in assignee.json()] == [original[0]["id"]]
    forged = data.client.post("/api/tasks", headers={"x-actor": data.members[0].id}, json={
        "title": "Forged creator membership", "project_id": data.projects[0].id,
        "task_group_id": original[0]["task_group_id"], "assigned_to_ids": [data.members[3].id],
        "created_by_id": data.owner.id})
    assert forged.status_code == 403, forged.text
    def measured(expected_count):
        statements = []
        def capture(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)
        event.listen(data.engine, "before_cursor_execute", capture)
        try:
            response = data.client.get(f"/api/tasks/{original[0]['id']}/group")
        finally:
            event.remove(data.engine, "before_cursor_execute", capture)
        assert response.status_code == 200, response.text
        assert len(response.json()) == expected_count
        assert sum(item["can_edit"] for item in response.json()) == 2
        return len(statements)
    before = measured(3)
    with data.factory() as db:
        people = [models.User(tenant_id=data.owner.tenant_id, name=f"Added member {index}",
            email=f"added-{index}@example.com", hashed_password="synthetic", role=models.RoleEnum.USER,
            status=models.UserStatusEnum.ACTIVE) for index in range(15)]
        db.add_all(people)
        db.flush()
        for person in people:
            db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=data.projects[0].id,
                user_id=person.id, role=models.ProjectMemberRoleEnum.MEMBER))
            db.add(models.Task(title="Manager-extended quest", project_id=data.projects[0].id,
                task_group_id=original[0]["task_group_id"], created_by_id=data.members[7].id, assigned_to_id=person.id))
        db.commit()
    assert measured(18) == before
    with data.factory() as db:
        membership = db.scalar(select(models.ProjectMember).where(
            models.ProjectMember.project_id == data.projects[0].id, models.ProjectMember.user_id == data.owner.id))
        db.delete(membership)
        db.commit()
    assert data.client.get(f"/api/tasks/{added.json()[0]['id']}").status_code == 403


def test_manager_requires_existing_project_or_department_scope_and_tenant(grouped):
    data = grouped
    actor = data.members[0]
    with data.factory() as db:
        db.get(models.User, actor.id).role = models.RoleEnum.MANAGER
        db.commit()
    headers = {"x-actor": actor.id}
    detail = data.client.get(f"/api/tasks/{data.rows[0].id}/group", headers=headers)
    assert [row["id"] for row in detail.json()] == [data.rows[0].id]
    with data.factory() as db:
        membership = db.scalar(select(models.ProjectMember).where(
            models.ProjectMember.project_id == data.projects[0].id, models.ProjectMember.user_id == actor.id))
        membership.role = models.ProjectMemberRoleEnum.MANAGER
        db.commit()
    detail = data.client.get(f"/api/tasks/{data.rows[0].id}/group", headers=headers)
    assert len(detail.json()) == len(data.rows)
    with data.factory() as db:
        membership = db.scalar(select(models.ProjectMember).where(
            models.ProjectMember.project_id == data.projects[0].id, models.ProjectMember.user_id == actor.id))
        membership.role = models.ProjectMemberRoleEnum.MEMBER
        db.commit()
    # Revocation takes effect immediately, even after an authorized group read.
    assert len(data.client.get(f"/api/tasks/{data.rows[0].id}/group", headers=headers).json()) == 1
    for role in (models.RoleEnum.ADMIN, models.RoleEnum.OWNER):
        with data.factory() as db:
            db.get(models.User, actor.id).role = role
            db.commit()
        assert len(data.client.get(f"/api/tasks/{data.rows[0].id}/group", headers=headers).json()) == len(data.rows)
        assert data.client.get(f"/api/tasks/{data.foreign.id}", headers=headers).status_code == 404
    assert data.client.get(f"/api/tasks/{data.rows[0].id}", headers={"x-actor": data.outsider.id}).status_code == 404


def test_report_and_notification_dispatch_do_not_expose_siblings(grouped):
    data = grouped
    with data.factory() as db:
        actor = db.get(models.User, data.members[0].id)
        peer = db.get(models.Task, data.rows[1].id)
        # Explicit observers do not inherit other assignees' private rows.
        peer.followers.append(actor)
        db.commit()
        assert {row.id for row in db.scalars(authorized_tasks(actor))} == {data.rows[0].id, data.private[0].id}
        assert not notification_dispatcher._entity_matches_recipient(db, recipient=actor,
            entity_type=models.NotificationEntityTypeEnum.TASK, entity_id=peer.id, related_task_id=peer.id)
        assert notification_dispatcher._entity_matches_recipient(db, recipient=actor,
            entity_type=models.NotificationEntityTypeEnum.TASK, entity_id=data.rows[0].id, related_task_id=data.rows[0].id)


def test_nested_dependencies_do_not_reveal_private_assignment_ids(grouped):
    data = grouped
    with data.factory() as db:
        task = db.get(models.Task, data.rows[0].id)
        task.dependencies.append(db.get(models.Task, data.rows[1].id))
        db.commit()
    headers = {"x-actor": data.members[0].id}
    response = data.client.get(f"/api/tasks/{data.rows[0].id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["dependencies"] == []
    assert data.rows[1].id not in response.text
    creator = data.client.get(f"/api/tasks/{data.rows[0].id}")
    assert [dependency["id"] for dependency in creator.json()["dependencies"]] == [data.rows[1].id]
    response = data.client.patch(f"/api/tasks/{data.rows[0].id}", headers=headers,
        json={"dependencies": [data.rows[1].id]})
    assert response.status_code == 404, response.text


def test_existing_notification_history_and_counts_hide_private_assignments(grouped):
    data = grouped
    data.client.app.include_router(notifications.router, prefix="/api")
    with data.factory() as db:
        for task in data.rows[:2]:
            db.add(models.Notification(user_id=data.members[0].id, tenant_id=data.owner.tenant_id,
                type=models.NotificationTypeEnum.TASK_UPDATED, message=f"Private status {task.id}",
                related_task_id=task.id, entity_type=models.NotificationEntityTypeEnum.TASK, entity_id=task.id))
        db.commit()
    headers = {"x-actor": data.members[0].id}
    response = data.client.get("/api/notifications", headers=headers)
    assert response.status_code == 200, response.text
    assert [notice["related_task_id"] for notice in response.json()] == [data.rows[0].id]
    count = data.client.get("/api/notifications/unread-count", headers=headers)
    assert count.status_code == 200 and count.json()["unread_count"] == 1


def test_last_surviving_assignment_remains_private(grouped):
    data = grouped
    with data.factory() as db:
        for task_id in [row.id for row in data.rows[:-1]]:
            db.delete(db.get(models.Task, task_id))
        db.commit()
    headers = {"x-actor": data.members[0].id}
    response = data.client.get(f"/api/tasks/{data.rows[-1].id}", headers=headers)
    assert response.status_code == 403, response.text
    response = data.client.get("/api/tasks/page", headers=headers, params={"project_id": data.projects[0].id})
    assert response.status_code == 200 and response.json()["total"] == 0


def test_queued_email_rechecks_assignment_scope_before_delivery(grouped, monkeypatch):
    data = grouped
    sent = []
    monkeypatch.setattr(notification_outbox.email_utils, "send_notification_email", lambda **kw: sent.append(kw))
    with data.factory() as db:
        job = notification_outbox.enqueue_email(db, tenant_id=data.owner.tenant_id,
            recipient_user_id=data.members[0].id, event_type="task.updated", event_id=data.rows[1].id,
            dedupe_key="legacy-private-job", subject="Private assignment", body="Private peer status",
            related_task_id=data.rows[1].id)
        db.commit()
        assert job is not None
        assert notification_outbox._attempt_email_delivery(db, job.id) == 1
        db.refresh(job)
        assert job.status == models.NotificationOutboxStatusEnum.FAILED
        assert job.last_error == "recipient_rejected" and job.next_attempt_at is None
        assert sent == []


def test_manager_outbox_respects_assignment_scope(grouped):
    data = grouped
    data.client.app.include_router(notifications.router, prefix="/api")
    with data.factory() as db:
        db.get(models.User, data.members[0].id).role = models.RoleEnum.MANAGER
        for task in data.rows[:2]:
            notification_outbox.enqueue_email(db, tenant_id=data.owner.tenant_id,
                recipient_user_id=data.owner.id, event_type="task.updated", event_id=task.id,
                dedupe_key=f"outbox-{task.id}", subject="Assignment", body="Status", related_task_id=task.id)
        db.commit()
    response = data.client.get("/api/notifications/outbox", headers={"x-actor": data.members[0].id})
    assert response.status_code == 200, response.text
    assert [job["event_id"] for job in response.json()] == [data.rows[0].id]


def test_realtime_single_and_batch_payloads_are_filtered_per_recipient(grouped, monkeypatch):
    data = grouped
    monkeypatch.setattr(task_ws, "SessionLocal", data.factory)
    monkeypatch.setattr(task_ws, "socket_allowed", lambda *_a: True)
    monkeypatch.setattr(task_ws, "credentials_match", lambda *_a: True)

    class Socket:
        scope = {}
        def __init__(self):
            self.messages = []
        async def send_json(self, message):
            self.messages.append(message)

    async def deliver():
        manager = task_ws.TaskConnectionManager()
        owner, member = Socket(), Socket()
        tenant = str(data.owner.tenant_id)
        manager._connections[tenant] = {owner, member}
        manager._socket_users = {owner: data.owner.id, member: data.members[0].id}
        ids = [row.id for row in data.rows]
        await manager.broadcast(tenant, {"type": "task.changed", "tenant_id": tenant,
            "task_ids": ids, "action": "created"})
        assert owner.messages[-1]["task_ids"] == ids
        assert member.messages[-1]["task_ids"] == [ids[0]]
        # An authorized primary task must not authorize sibling IDs in a batch.
        statements = []
        def capture(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)
        event.listen(data.engine, "before_cursor_execute", capture)
        try:
            await manager.broadcast(tenant, {"type": "task.changed", "tenant_id": tenant,
                "task_id": ids[0], "task_ids": ids, "action": "updated"})
        finally:
            event.remove(data.engine, "before_cursor_execute", capture)
        assert len(statements) == 4  # One principal and one batched ID query per socket.
        assert owner.messages[-1]["task_ids"] == ids
        assert member.messages[-1]["task_ids"] == [ids[0]]
        await manager.broadcast(tenant, {"type": "subtask.workflow", "tenant_id": tenant,
            "task_id": ids[1], "to_status": "DONE", "actor_id": data.members[1].id, "payload": {"private": True}})
        assert owner.messages[-1]["to_status"] == "DONE"
        assert member.messages[-1]["action"] == "invalidate"
        assert not ({"task_id", "payload", "actor_id", "to_status"} & member.messages[-1].keys())
    asyncio.run(deliver())


def test_linked_notification_cannot_bypass_queued_email_authorization(grouped, monkeypatch):
    data = grouped
    sent = []
    monkeypatch.setattr(notification_outbox.email_utils, "send_notification_email", lambda **kw: sent.append(kw))
    with data.factory() as db:
        notice = models.Notification(user_id=data.members[0].id, tenant_id=data.owner.tenant_id,
            type=models.NotificationTypeEnum.TASK_UPDATED, message="Peer assignment update",
            entity_type=models.NotificationEntityTypeEnum.TASK, entity_id=data.rows[1].id,
            related_task_id=data.rows[1].id)
        db.add(notice)
        db.flush()
        job = notification_outbox.enqueue_email(db, tenant_id=data.owner.tenant_id,
            recipient_user_id=data.members[0].id, event_type="task.updated", event_id=data.rows[1].id,
            dedupe_key="legacy-linked-private-job", subject="Private assignment", body="Private peer status",
            notification_id=notice.id)
        db.commit()
        assert job is not None and job.payload.get("related_task_id") is None
        assert notification_outbox._attempt_email_delivery(db, job.id) == 1
        db.refresh(job)
        assert job.status == models.NotificationOutboxStatusEnum.FAILED
        assert job.last_error == "recipient_rejected"
        assert sent == []
        own_notice = models.Notification(user_id=data.members[0].id, tenant_id=data.owner.tenant_id,
            type=models.NotificationTypeEnum.TASK_UPDATED, message="Own assignment update",
            entity_type=models.NotificationEntityTypeEnum.TASK, entity_id=data.rows[0].id,
            related_task_id=data.rows[0].id)
        db.add(own_notice)
        db.flush()
        own_job = notification_outbox.enqueue_email(db, tenant_id=data.owner.tenant_id,
            recipient_user_id=data.members[0].id, event_type="task.updated", event_id=data.rows[0].id,
            dedupe_key="linked-own-job", subject="Own assignment", body="Own status", notification_id=own_notice.id)
        db.commit()
        assert own_job is not None
        assert notification_outbox._attempt_email_delivery(db, own_job.id) == 1
        db.refresh(own_job)
        assert own_job.status == models.NotificationOutboxStatusEnum.SENT
        assert len(sent) == 1


def test_real_login_three_assignees_and_creator_use_server_identity(grouped, monkeypatch):
    data = grouped
    data.client.app.include_router(auth_routes.router, prefix="/api")
    password = "Synthetic-group-review-only-123!"
    with data.factory() as db:
        hashed = auth_routes.hash_password(password)
        for user in [data.owner, data.outsider, *data.members[:3]]:
            db.get(models.User, user.id).hashed_password = hashed
        db.commit()
    created = data.client.post("/api/tasks", json={"title": "Three-person security acceptance",
        "project_id": data.projects[0].id, "assigned_to_ids": [user.id for user in data.members[:3]], "status": "TODO"})
    assert created.status_code == 201, created.text
    rows = created.json()
    assert len(rows) == 3 and len({row["task_group_id"] for row in rows}) == 1
    data.client.app.dependency_overrides.pop(get_current_active_user)

    def login(user):
        response = data.client.post("/api/auth/login", json={"email": user.email, "password": password})
        assert response.status_code == 200, response.text
        assert response.json()["user"]["id"] == user.id
        return {"Authorization": "Bearer " + response.json()["token"]["access_token"]}

    creator = login(data.owner)
    query = {"grouped": True, "search": "Three-person security acceptance"}
    response = data.client.get("/api/tasks/page", headers=creator, params=query)
    assert response.status_code == 200 and len(response.json()["items"]) == 1
    assert len(response.json()["items"][0]["group_assignments"]) == 3
    by_assignee = {row["assigned_to_id"]: row for row in rows}
    for index, user in enumerate(data.members[:3]):
        headers = login(user)
        own = by_assignee[user.id]
        peer = by_assignee[data.members[(index + 1) % 3].id]
        # Repeat across accounts on the same client and query to exercise cache separation.
        for grouped_mode in (True, False):
            response = data.client.get("/api/tasks/page", headers=headers, params={**query, "grouped": grouped_mode})
            assert response.status_code == 200, response.text
            assert response.json()["total"] == 1
            assert [item["id"] for item in response.json()["items"]] == [own["id"]]
        for suffix in ("", "/group", "/summary"):
            denied = data.client.get(f"/api/tasks/{peer['id']}{suffix}", headers=headers,
                params={"user_id": data.owner.id, "assigned_to_id": user.id})
            assert denied.status_code == 403, denied.text
        denied = data.client.patch(f"/api/tasks/{peer['id']}", headers=headers,
            json={"assigned_to_id": user.id, "status": "DONE"})
        assert denied.status_code == 403, denied.text
        allowed = data.client.patch(f"/api/tasks/{own['id']}", headers=headers, json={"status": "IN_PROGRESS"})
        assert allowed.status_code == 200, allowed.text
        complete = data.client.post(f"/api/tasks/{own['id']}/complete", headers=headers)
        assert complete.status_code == 200 and complete.json()["status"] == "DONE", complete.text
    foreign = login(data.outsider)
    assert data.client.get(f"/api/tasks/{rows[0]['id']}", headers=foreign).status_code == 404
    refreshed = data.client.get("/api/tasks/page", headers=creator, params=query)
    assert len(refreshed.json()["items"]) == 1
    members = refreshed.json()["items"][0]["group_assignments"]
    assert len(members) == 3 and all(member["status"] == "DONE" for member in members)
    assert data.client.get(f"/api/tasks/{rows[0]['id']}/group").status_code == 401


def test_assignee_group_page_query_count_is_bounded(grouped):
    data = grouped
    with data.factory() as db:
        for index in range(24):
            for user in data.members[:3]:
                db.add(models.Task(title=f"Batched group {index}", task_group_id=f"bounded-{index}",
                    project_id=data.projects[0].id, created_by_id=data.owner.id, assigned_to_id=user.id))
        db.commit()
    def measured(size):
        statements = []
        def capture(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)
        event.listen(data.engine, "before_cursor_execute", capture)
        try:
            response = data.client.get("/api/tasks/page", headers={"x-actor": data.members[0].id},
                params={"grouped": True, "search": "Batched", "page_size": size})
        finally:
            event.remove(data.engine, "before_cursor_execute", capture)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["total"] == 24 and len(payload["items"]) == size
        assert all(len(item["group_assignments"]) == 1 for item in payload["items"])
        return len(statements)
    assert measured(1) == measured(20) <= 12


def test_project_dashboard_and_project_counts_do_not_bypass_assignment_isolation(grouped):
    data = grouped
    data.client.app.include_router(projects.router, prefix="/api")
    headers = {"x-actor": data.members[0].id}
    path = f"/api/projects/{data.projects[0].id}"
    response = data.client.get(path + "/task-dashboard", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body["items"]] == [data.rows[0].id]
    assert body["total"] == body["summary"]["task_total"] == body["project"]["task_count"] == 1
    assert [item["user_id"] for item in body["summary"]["workload"]] == [data.members[0].id]
    for peer in data.rows[1:]:
        assert peer.id not in response.text and peer.assigned_to_id not in response.text
    assert data.client.get(path, headers=headers).json()["task_count"] == 1
    response = data.client.get("/api/projects", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["task_count"] == 1
    filtered = data.client.get(path + "/task-dashboard", headers=headers, params={"member_id": data.members[1].id})
    assert filtered.status_code == 200 and filtered.json()["total"] == 0
    creator = data.client.get(path + "/task-dashboard")
    assert creator.status_code == 200, creator.text
    assert creator.json()["total"] == 9
    assert {item["id"] for item in creator.json()["items"]} == {row.id for row in data.rows} | {data.unrelated.id}
