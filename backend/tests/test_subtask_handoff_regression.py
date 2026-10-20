"""Real endpoint coverage for ordered handoff, permissions, approvals and parent XP."""
from types import SimpleNamespace
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from backend.app import models
from backend.app.routers import tasks as tasks_module
from backend.app.services import notification_dispatcher, subtask_notifications
from backend.tests.test_task_lifecycle import api, auth, data, engine  # noqa: F401


@pytest.fixture(autouse=True)
def no_external_delivery(monkeypatch, data):
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(notification_dispatcher, "trigger_n8n_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module, "_schedule_notification_outbox_delivery", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module, "_invalidate_task_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(tasks_module, "_publish_subtask_workflow_events", lambda *args, **kwargs: None)
    monkeypatch.setattr(notification_dispatcher.push_service, "send_push", lambda *args, **kwargs: 0)
    with data.factory() as db:
        for user in db.scalars(select(models.User)):
            user.email = user.email.replace("@example.test", "@example.com")
        db.commit()


@pytest.fixture
def chain(data):
    with data.factory() as db:
        users = [
            models.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name=name,
                        email=f"{uuid4()}@example.com", hashed_password="not-used",
                        role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
            for name in ("Alice", "Bob", "Carla")
        ]
        db.add_all(users)
        db.flush()
        task = db.get(models.Task, data.task.id)
        task.assigned_to_id = users[0].id
        first = db.get(models.Subtask, data.child.id)
        first.title, first.assigned_to_id, first.sort_order = "Design", users[0].id, 0
        children = [first]
        for index, title in enumerate(("Build", "Review"), start=1):
            child = models.Subtask(id=str(uuid4()), task_id=task.id, title=title,
                                   assigned_to_id=users[index].id, sort_order=index)
            db.add(child)
            children.append(child)
        db.commit()
        return SimpleNamespace(users=users, children=children)


def patch_child(api, data, child, user, state):
    return api.patch(f"/api/tasks/{data.task.id}/subtasks/{child.id}",
                     json={"status": state}, headers=auth(user))


def activations(data, user):
    with data.factory() as db:
        return db.scalars(select(models.Notification).where(
            models.Notification.user_id == user.id,
            models.Notification.type == models.NotificationTypeEnum.SUBTASK_ACTIVATED,
        )).all()


def test_three_assignees_receive_named_handoff_and_parent_completes_once(api, data, chain):
    first = patch_child(api, data, chain.children[0], chain.users[0], "DONE")
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "TODO"
    notice = activations(data, chain.users[1])
    assert len(notice) == 1
    assert "Alice completed 'Design'" in notice[0].message
    assert "You can start 'Build' now" in notice[0].message
    assert not activations(data, chain.users[2])
    with data.factory() as db:
        outbox = db.scalars(select(models.NotificationOutbox).where(
            models.NotificationOutbox.recipient_user_id == chain.users[1].id,
            models.NotificationOutbox.event_type == "SUBTASK_ACTIVATED",
        )).all()
        assert len(outbox) == 1
        assert outbox[0].notification_id == notice[0].id

    duplicate = patch_child(api, data, chain.children[0], chain.users[0], "DONE")
    assert duplicate.status_code == 200
    assert len(activations(data, chain.users[1])) == 1
    second = patch_child(api, data, chain.children[1], chain.users[1], "DONE")
    assert second.status_code == 200, second.text
    assert "Bob completed 'Build'" in activations(data, chain.users[2])[0].message
    last = patch_child(api, data, chain.children[2], chain.users[2], "DONE")
    assert last.status_code == 200, last.text
    assert last.json()["status"] == "DONE"
    assert last.json()["completed_at"]
    with data.factory() as db:
        first_points = db.get(models.User, chain.users[0].id).points
        assert db.get(models.User, chain.users[0].id).tasks_completed == 1
        completed_recipients = db.scalars(select(models.Notification.user_id).where(
            models.Notification.related_task_id == data.task.id,
            models.Notification.type == models.NotificationTypeEnum.TASK_COMPLETED,
        )).all()
        assert sorted(completed_recipients) == sorted([data.owner.id, *(user.id for user in chain.users)])

    reopened = patch_child(api, data, chain.children[1], chain.users[1], "TODO")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "IN_PROGRESS"
    assert reopened.json()["completed_at"] is None
    assert patch_child(api, data, chain.children[1], chain.users[1], "DONE").json()["status"] == "DONE"
    with data.factory() as db:
        assert db.get(models.User, chain.users[0].id).points == first_points
        assert db.get(models.User, chain.users[0].id).tasks_completed == 1


def test_concurrent_retries_emit_one_ordered_handoff_and_one_parent_reward(api, data, chain):
    with ThreadPoolExecutor(max_workers=2) as workers:
        first_results = list(workers.map(
            lambda _: patch_child(api, data, chain.children[0], chain.users[0], "DONE"), range(2),
        ))
    assert [result.status_code for result in first_results] == [200, 200]
    assert len(activations(data, chain.users[1])) == 1
    with ThreadPoolExecutor(max_workers=2) as workers:
        remaining = list(workers.map(
            lambda index: patch_child(api, data, chain.children[index], chain.users[index], "DONE"), (1, 2),
        ))
    assert [result.status_code for result in remaining] == [200, 200]
    with data.factory() as db:
        assert db.get(models.Task, data.task.id).status == models.TaskStatusEnum.DONE
        assert db.get(models.User, chain.users[0].id).tasks_completed == 1
        events = db.scalars(select(models.SubtaskWorkflowEvent).where(
            models.SubtaskWorkflowEvent.task_id == data.task.id,
            models.SubtaskWorkflowEvent.event_type == "SUBTASK_COMPLETED",
        )).all()
        assert len(events) == 3


def test_other_assignee_cannot_change_status_title_order_or_remove_child(api, data, chain):
    child = chain.children[0]
    endpoint = f"/api/tasks/{data.task.id}/subtasks/{child.id}"
    for payload in ({"status": "DONE"}, {"title": "Hijacked"}, {"sort_order": 12}):
        response = api.patch(endpoint, json=payload, headers=auth(chain.users[1]))
        assert response.status_code == 403, response.text
    response = api.patch(f"/api/tasks/{data.task.id}", json={"subtasks": []}, headers=auth(chain.users[1]))
    assert response.status_code == 403
    with data.factory() as db:
        assert len(db.get(models.Task, data.task.id).subtasks) == 3
        assert db.get(models.Subtask, child.id).status == models.SubtaskStatusEnum.TODO


def test_follower_and_subtask_only_assignee_can_read_but_not_mutate_parent(api, data, chain):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        task.followers.append(db.get(models.User, chain.users[2].id))
        db.commit()
    for viewer in chain.users[1:]:
        path = f"/api/tasks/{data.task.id}"
        detail = api.get(path, headers=auth(viewer))
        assert detail.status_code == 200
        assert not detail.json()["can_edit"]
        assert not detail.json()["can_manage_subtasks"]
        assert not detail.json()["can_review_subtasks"]
        assert api.patch(path, json={"title": "Unauthorized"}, headers=auth(viewer)).status_code == 403
        assert api.post(f"{path}/complete", headers=auth(viewer)).status_code == 403
        assert api.delete(path, headers=auth(viewer)).status_code == 403


def test_task_capabilities_use_creator_and_project_membership_permissions(api, data, chain):
    with data.factory() as db:
        creator = db.get(models.User, data.owner.id)
        creator.role = models.RoleEnum.USER
        db.commit()
    own = api.get(f"/api/tasks/{data.task.id}", headers=auth(creator))
    assert own.status_code == 200
    assert all(own.json()[key] for key in ("can_edit", "can_manage_subtasks", "can_review_subtasks"))
    with data.factory() as db:
        client_row = models.Client(tenant_id=data.owner.tenant_id, company_name="Test client",
                                  normalized_company_name="test-client")
        db.add(client_row)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=client_row.id,
                                 name="Delivery", normalized_name="delivery")
        db.add(project)
        db.flush()
        manager = db.get(models.User, chain.users[1].id)
        manager.role = models.RoleEnum.MANAGER
        db.get(models.Task, data.task.id).project_id = project.id
        for user, member_role in (
            (manager, models.ProjectMemberRoleEnum.MANAGER),
            (chain.users[2], models.ProjectMemberRoleEnum.MEMBER),
        ):
            db.add(models.ProjectMember(tenant_id=data.owner.tenant_id, project_id=project.id,
                                        user_id=user.id, role=member_role))
        db.commit()
    managed = api.get(f"/api/tasks/{data.task.id}", headers=auth(manager))
    assert managed.status_code == 200, managed.text
    assert all(managed.json()[key] for key in ("can_edit", "can_manage_subtasks", "can_review_subtasks"))
    member = api.get(f"/api/tasks/{data.task.id}", headers=auth(chain.users[2]))
    assert member.status_code == 200
    assert not any(member.json()[key] for key in ("can_edit", "can_manage_subtasks", "can_review_subtasks"))


def test_approver_can_read_and_list_but_cannot_edit_task(api, data):
    with data.factory() as db:
        approver = db.get(models.User, data.outsider.id)
        approver.tenant_id = data.owner.tenant_id
        approver.role = models.RoleEnum.USER
        db.get(models.Task, data.task.id).approver_id = approver.id
        db.commit()
    assert api.get(f"/api/tasks/{data.task.id}", headers=auth(approver)).status_code == 200
    listing = api.get("/api/tasks", headers=auth(approver))
    assert listing.status_code == 200, listing.text
    assert data.task.id in str(listing.json())
    assert api.patch(f"/api/tasks/{data.task.id}", json={"title": "Unauthorized"}, headers=auth(approver)).status_code == 403


def test_parent_cannot_be_completed_with_unfinished_children(api, data, chain):
    for method, path, payload in (
        ("patch", f"/api/tasks/{data.task.id}", {"status": "DONE"}),
        ("post", f"/api/tasks/{data.task.id}/complete", None),
    ):
        response = getattr(api, method)(path, json=payload, headers=auth(data.owner))
        assert response.status_code == 409, response.text


def test_create_with_completed_children_initializes_completed_parent(api, data):
    with data.factory() as db:
        client_row = models.Client(tenant_id=data.owner.tenant_id, company_name="Completed work client",
                                  normalized_company_name="completed-work-client")
        db.add(client_row)
        db.flush()
        project = models.Project(tenant_id=data.owner.tenant_id, client_id=client_row.id,
                                 name="Completed work project", normalized_name="completed-work-project")
        db.add(project)
        db.commit()
    created = api.post("/api/tasks", headers=auth(data.owner), json={
        "title": "Completed work", "project_id": project.id,
        "subtasks": [{"title": "Finished", "completed": True}],
    })
    assert created.status_code == 201, created.text
    assert created.json()[0]["status"] == "DONE"
    assert created.json()[0]["completed_at"]
    invalid = api.post("/api/tasks", headers=auth(data.owner), json={
        "title": "Unfinished work", "project_id": project.id,
        "status": "DONE", "subtasks": [{"title": "Still open"}],
    })
    assert invalid.status_code == 409


def test_bulk_completion_with_new_unfinished_child_does_not_award_parent(api, data):
    response = api.patch(f"/api/tasks/{data.task.id}", headers=auth(data.owner), json={
        "subtasks": [
            {"id": data.child.id, "title": "Child", "status": "DONE"},
            {"title": "Added work", "completed": False},
        ],
    })
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "TODO"
    with data.factory() as db:
        assert db.get(models.Task, data.task.id).completion_xp_awarded_at is None


def test_explicit_dependencies_wait_for_all_predecessors_even_when_child_is_todo(api, data, chain):
    with data.factory() as db:
        for predecessor in chain.children[:2]:
            db.add(models.SubtaskDependency(task_id=data.task.id, subtask_id=chain.children[2].id,
                                            depends_on_subtask_id=predecessor.id))
        db.commit()
    blocked = patch_child(api, data, chain.children[2], chain.users[2], "DONE")
    assert blocked.status_code == 409
    assert patch_child(api, data, chain.children[0], chain.users[0], "DONE").status_code == 200
    assert not activations(data, chain.users[2])
    assert patch_child(api, data, chain.children[1], chain.users[1], "DONE").status_code == 200
    assert len(activations(data, chain.users[2])) == 1
    assert "Bob completed 'Build'" in activations(data, chain.users[2])[0].message


def test_handoff_names_actor_for_direct_completion_and_submitter_for_approval(api, data, chain):
    direct = patch_child(api, data, chain.children[0], data.owner, "DONE")
    assert direct.status_code == 200, direct.text
    assert "Owner completed 'Design'" in activations(data, chain.users[1])[0].message
    with data.factory() as db:
        db.get(models.Task, data.task.id).subtask_approval_required = True
        db.commit()
    endpoint = f"/api/tasks/{data.task.id}/subtasks/{chain.children[1].id}/completion-submissions"
    submission = api.post(endpoint, data={"description": "Completed the requested build and validation"}, headers=auth(chain.users[1]))
    assert submission.status_code == 200, submission.text
    child = next(item for item in submission.json()["subtasks"] if item["id"] == chain.children[1].id)
    reviewed = api.post(f"{endpoint}/{child['latest_completion_submission']['id']}/approve", headers=auth(data.owner))
    assert reviewed.status_code == 200, reviewed.text
    assert "Bob completed 'Build'" in activations(data, chain.users[2])[0].message


def test_subtask_and_parent_approval_are_preserved(api, data):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        task.subtask_approval_required = True
        task.approval_required = True
        task.approver_id = data.owner.id
        db.commit()
    direct = patch_child(api, data, data.child, data.owner, "DONE")
    assert direct.status_code == 409
    endpoint = f"/api/tasks/{data.task.id}/subtasks/{data.child.id}/completion-submissions"
    submitted = api.post(endpoint, data={"description": "Completed all requested work with evidence"}, headers=auth(data.owner))
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "TODO"
    child = submitted.json()["subtasks"][0]
    assert child["status"] == "IN_REVIEW"
    assert patch_child(api, data, data.child, data.owner, "TODO").status_code == 409
    approved = api.post(f"{endpoint}/{child['latest_completion_submission']['id']}/approve", headers=auth(data.owner))
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "DONE"
    assert approved.json()["approval_status"] == "pending"


def test_reassignment_back_to_previous_user_is_a_new_notification(data, chain):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        child = db.get(models.Subtask, chain.children[0].id)
        for old, new in ((chain.users[0], chain.users[1]), (chain.users[1], chain.users[0]), (chain.users[0], chain.users[1])):
            child.assigned_to_id = new.id
            db.flush()
            subtask_notifications.enqueue_reassignment_notification(
                db, task=task, subtask=child, previous_assignee_id=old.id, actor_id=data.owner.id,
            )
        db.commit()
        notices = db.scalars(select(models.Notification).where(
            models.Notification.user_id == chain.users[1].id,
            models.Notification.type == models.NotificationTypeEnum.SUBTASK_REASSIGNED,
        )).all()
        assert len(notices) == 2


def test_removing_last_dependency_activates_waiting_child(api, data, chain):
    with data.factory() as db:
        child = db.get(models.Subtask, chain.children[1].id)
        child.status = models.SubtaskStatusEnum.WAITING
        edge = models.SubtaskDependency(id=str(uuid4()), task_id=data.task.id, subtask_id=child.id,
                                       depends_on_subtask_id=chain.children[0].id)
        db.add(edge)
        db.commit()
    response = api.delete(
        f"/api/tasks/{data.task.id}/subtasks/{child.id}/dependencies/{edge.id}", headers=auth(data.owner),
    )
    assert response.status_code == 204, response.text
    with data.factory() as db:
        assert db.get(models.Subtask, child.id).status == models.SubtaskStatusEnum.TODO
