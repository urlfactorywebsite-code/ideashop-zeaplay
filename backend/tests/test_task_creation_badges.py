"""Multi-assignee creation must reuse badge progress within one transaction."""
from uuid import uuid4

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from backend.app import models
from backend.app.database import get_db
from backend.app.dependencies import get_current_active_user
from backend.app.realtime import capture
from backend.app.routers import tasks
from backend.app.services import notification_dispatcher
from backend.app.services.points_table import get_task_creation_points
from backend.tests.test_task_lifecycle import engine  # noqa: F401


@pytest.mark.parametrize("assignee_count,target", [(1, 5), (2, 5), (3, 2)])
def test_task_creation_with_active_badge(engine, monkeypatch, assignee_count, target):
    # Match the production session: pending inserts are not automatically flushed.
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(tasks.audit_logger, "log_event", lambda *_args: None)
    monkeypatch.setattr(tasks, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(notification_dispatcher, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(notification_dispatcher, "push_if_enabled", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(capture, "publish", lambda *_args: None)
    monkeypatch.setattr(tasks, "_invalidate_task_cache", lambda *_args, **_kwargs: None)
    tenant = uuid4()
    with factory() as db:
        owner = models.User(id=str(uuid4()), tenant_id=tenant, name="Creator",
            email=f"{uuid4()}@example.com", hashed_password="synthetic",
            role=models.RoleEnum.OWNER, status=models.UserStatusEnum.ACTIVE)
        members = [models.User(id=str(uuid4()), tenant_id=tenant, name=f"Member {index}",
            email=f"{uuid4()}@example.com", hashed_password="synthetic",
            role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
            for index in range(assignee_count)]
        customer = models.Client(tenant_id=tenant, company_name="Test customer",
            normalized_company_name=str(uuid4()), country="India")
        db.add_all([owner, customer, *members])
        db.flush()
        project = models.Project(tenant_id=tenant, client_id=customer.id,
            name="Test project", normalized_name=str(uuid4()), status=models.ProjectStatusEnum.ACTIVE)
        badge = models.Badge(name="Architect", description="Create tasks", tier="Bronze",
            state=models.BadgeStateEnum.ACTIVE, bonus_xp=25,
            ruleset=models.BadgeRule(rules={"operator": "AND", "rules": [{
                "entity": "task", "event": "created", "conditions": {"created_by": "self"},
                "count": {"type": ">=", "value": target}}]}))
        db.add_all([project, badge])
        db.flush()
        db.add_all([models.ProjectMember(tenant_id=tenant, project_id=project.id,
            user_id=member.id, role=models.ProjectMemberRoleEnum.MEMBER) for member in members])
        creation_points = get_task_creation_points(db)
        db.commit()

    def session():
        with factory() as db:
            yield db

    app = FastAPI()
    app.include_router(tasks.router, prefix="/api")
    app.dependency_overrides[get_db] = session
    # Resolve the actor in the same session used for the mutation.
    def current_actor(db=Depends(get_db)):
        return db.get(models.User, owner.id)
    app.dependency_overrides[get_current_active_user] = current_actor
    with TestClient(app) as client:
        response = client.post("/api/tasks", json={"title": "Multi-user task", "project_id": project.id,
            "assigned_to_ids": [member.id for member in members], "priority": "LOW", "status": "TODO"})
        assert response.status_code == 201, response.text
        created = response.json()
        assert len(created) == assignee_count
        assert {task["assigned_to_id"] for task in created} == {member.id for member in members}
        assert len({task["task_group_id"] for task in created}) == 1
        for task in created:
            detail = client.get(f"/api/tasks/{task['id']}")
            assert detail.status_code == 200, detail.text

    with factory() as db:
        progress = db.scalars(select(models.UserBadgeProgress).where(
            models.UserBadgeProgress.user_id == owner.id,
            models.UserBadgeProgress.badge_id == badge.id)).one()
        earned = assignee_count >= target
        assert progress.progress_state["rules"][0]["count"] == min(assignee_count, target)
        assert progress.status == (models.BadgeProgressStatusEnum.EARNED if earned
            else models.BadgeProgressStatusEnum.IN_PROGRESS)
        saved_owner = db.get(models.User, owner.id)
        assert saved_owner.tasks_created == assignee_count
        assert saved_owner.points == creation_points * assignee_count + (25 if earned else 0)
        notices = list(db.scalars(select(models.Notification).where(
            models.Notification.type == models.NotificationTypeEnum.TASK_CREATED)))
        assert {notice.user_id for notice in notices} == {member.id for member in members}
        unlocked = list(db.scalars(select(models.Notification).where(
            models.Notification.type == models.NotificationTypeEnum.ACHIEVEMENT_UNLOCKED)))
        assert len(unlocked) == int(earned)
