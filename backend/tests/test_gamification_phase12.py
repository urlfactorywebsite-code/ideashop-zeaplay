from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from importlib import import_module

import pytest
from fastapi import HTTPException
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from backend.app import models
from backend.app.services import gamification as gamification_service
from backend.app.services import rewards as reward_service
from backend.app.services.gamification import award_task_completion_points
from backend.tests import test_tasks_phase5 as phase5


TestingSessionLocal = phase5.TestingSessionLocal
client = phase5.client


def setup_function():
    db = TestingSessionLocal()
    try:
        for model in [
            models.RewardLog,
            models.RewardClaim,
            models.Reward,
            models.UserBadgeProgress,
            models.BadgeRule,
            models.Badge,
            models.UserAchievement,
            models.Achievement,
            models.Notification,
            models.AuditEvent,
            models.TaskTransferRequest,
            models.TimeEntry,
            models.CompletionAttachment,
            models.CompletionSubmission,
            models.SubtaskWorkflowEvent,
            models.SubtaskDependency,
            models.Subtask,
            models.Task,
            models.ProjectMember,
            models.Project,
            models.Client,
            models.PointsTableConfig,
            models.User,
        ]:
            db.query(model).delete()
        db.commit()
    finally:
        db.close()


def _noop_notification(db, **kwargs):
    notification = models.Notification(
        user_id=kwargs["user_id"],
        type=kwargs["notification_type"],
        message=kwargs.get("message") or kwargs.get("title") or "",
        title=kwargs.get("title"),
        body=kwargs.get("body"),
        entity_type=kwargs.get("entity_type"),
        entity_id=kwargs.get("entity_id"),
        related_task_id=kwargs.get("related_task_id"),
        related_reward_id=kwargs.get("related_reward_id"),
    )
    db.add(notification)
    db.flush()
    return notification


@pytest.fixture(autouse=True)
def disable_external_gamification_side_effects(monkeypatch):
    monkeypatch.setattr(gamification_service, "create_notification", _noop_notification)
    monkeypatch.setattr(reward_service.notification_service, "create_notification", _noop_notification)
    monkeypatch.setattr(phase5.tasks_module.task_link_service, "handle_task_completion", lambda *args, **kwargs: None)


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_project_with_member():
    tenant = uuid.uuid4()
    owner, owner_token = phase5._create_user(models.RoleEnum.OWNER, tenant)
    manager, _ = phase5._create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = phase5._create_user(models.RoleEnum.USER, tenant)
    project = phase5._create_client_and_project(
        tenant_id=tenant,
        manager_ids=[manager.id],
        member_ids=[member.id],
    )
    return tenant, owner, owner_token, manager, member, member_token, project


def _task_payload(project_id: str, assignee_id: str, *, clarity_rating: int | None = None) -> dict:
    payload = phase5._task_payload(project_id, [assignee_id])
    payload.update(
        {
            "title": "Phase 12 XP task",
            "team": "Data Team",
            "priority": models.TaskPriorityEnum.HIGH.value,
            "due_at": (datetime.utcnow() + timedelta(days=1)).isoformat(),
        }
    )
    if clarity_rating is not None:
        payload["clarity_rating"] = clarity_rating
    return payload


def test_task_creation_completion_clarity_and_reopen_do_not_duplicate_xp():
    _, owner, owner_token, _, member, member_token, project = _create_project_with_member()

    create_response = client.post(
        "/api/tasks",
        json=_task_payload(project.id, member.id),
        headers=_auth_header(owner_token),
    )
    assert create_response.status_code == 201, create_response.text
    task_id = create_response.json()[0]["id"]

    db = TestingSessionLocal()
    creator = db.get(models.User, owner.id)
    assignee = db.get(models.User, member.id)
    assert creator.points == 10
    assert creator.tasks_created == 1
    assert assignee.points == 0
    db.close()

    clarity_response = client.patch(
        f"/api/tasks/{task_id}",
        json={"clarity_rating": 4},
        headers=_auth_header(owner_token),
    )
    assert clarity_response.status_code == 200, clarity_response.text
    retry_clarity_response = client.patch(
        f"/api/tasks/{task_id}",
        json={"clarity_rating": 4},
        headers=_auth_header(owner_token),
    )
    assert retry_clarity_response.status_code == 200, retry_clarity_response.text

    complete_response = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=_auth_header(member_token),
    )
    assert complete_response.status_code == 200, complete_response.text
    retry_complete_response = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=_auth_header(member_token),
    )
    assert retry_complete_response.status_code == 200, retry_complete_response.text

    reopen_response = client.patch(
        f"/api/tasks/{task_id}",
        json={"status": models.TaskStatusEnum.TODO.value},
        headers=_auth_header(owner_token),
    )
    assert reopen_response.status_code == 200, reopen_response.text
    recomplete_response = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=_auth_header(member_token),
    )
    assert recomplete_response.status_code == 200, recomplete_response.text

    db = TestingSessionLocal()
    task = db.get(models.Task, task_id)
    creator = db.get(models.User, owner.id)
    assignee = db.get(models.User, member.id)
    assert creator.points == 30
    assert creator.clarity_scores == [4]
    assert assignee.points == 40
    assert assignee.tasks_completed == 1
    assert task.clarity_xp_awarded_at is not None
    assert task.clarity_xp_awarded_to_id == owner.id
    assert task.clarity_xp_points_awarded == 20
    assert task.completion_xp_awarded_at is not None
    assert task.completion_xp_awarded_to_id == member.id
    assert task.completion_xp_points_awarded == 40
    db.close()


def test_completion_award_service_is_idempotent_under_concurrent_callbacks():
    tenant = uuid.uuid4()
    creator, _ = phase5._create_user(models.RoleEnum.OWNER, tenant)
    assignee, _ = phase5._create_user(models.RoleEnum.USER, tenant)

    db = TestingSessionLocal()
    task = models.Task(
        id=str(uuid.uuid4()),
        title="Concurrent completion",
        description="",
        status=models.TaskStatusEnum.DONE,
        priority=models.TaskPriorityEnum.HIGH,
        team="Data Team",
        assigned_to_id=assignee.id,
        created_by_id=creator.id,
        due_at=datetime.utcnow() + timedelta(days=1),
        completed_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()
    task_id = task.id
    db.close()

    def worker() -> bool:
        local_db = TestingSessionLocal()
        try:
            local_task = local_db.get(models.Task, task_id)
            awarded = award_task_completion_points(local_db, local_task)
            local_db.commit()
            return awarded
        finally:
            local_db.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: worker(), range(2)))

    db = TestingSessionLocal()
    stored_task = db.get(models.Task, task_id)
    stored_assignee = db.get(models.User, assignee.id)
    assert sorted(results) == [False, True]
    assert stored_assignee.points == 40
    assert stored_assignee.tasks_completed == 1
    assert stored_task.completion_xp_points_awarded == 40
    db.close()


def test_completion_timing_and_missing_points_config_use_phase1_defaults():
    tenant = uuid.uuid4()
    creator, _ = phase5._create_user(models.RoleEnum.OWNER, tenant)
    assignee, _ = phase5._create_user(models.RoleEnum.USER, tenant)
    due_at = datetime.utcnow() + timedelta(days=1)

    scenarios = [
        ("early", due_at - timedelta(minutes=1), 40),
        ("on-time", due_at, 40),
        ("overdue", due_at + timedelta(minutes=1), 10),
    ]

    db = TestingSessionLocal()
    assert db.get(models.PointsTableConfig, 1) is None
    for label, completed_at, expected_points in scenarios:
        task = models.Task(
            id=str(uuid.uuid4()),
            title=f"{label} completion",
            description="",
            status=models.TaskStatusEnum.DONE,
            priority=models.TaskPriorityEnum.HIGH,
            team="Data Team",
            assigned_to_id=assignee.id,
            created_by_id=creator.id,
            due_at=due_at,
            completed_at=completed_at,
        )
        db.add(task)
        db.commit()
        task_id = task.id
        db.close()

        db = TestingSessionLocal()
        award_task = db.get(models.Task, task_id)
        assert award_task_completion_points(db, award_task) is True
        db.commit()
        stored_task = db.get(models.Task, task_id)
        assert stored_task.completion_xp_points_awarded == expected_points

    stored_assignee = db.get(models.User, assignee.id)
    assert stored_assignee.points == 90
    assert stored_assignee.tasks_completed == 3
    db.close()


def test_completion_badge_bonus_does_not_progress_from_duplicate_recompletion():
    _, owner, owner_token, _, member, member_token, project = _create_project_with_member()

    db = TestingSessionLocal()
    badge = models.Badge(
        id="two-completions",
        name="Two completions",
        description="Complete two tasks",
        tier="common",
        bonus_xp=99,
        state=models.BadgeStateEnum.ACTIVE,
    )
    badge.ruleset = models.BadgeRule(
        rules={
            "operator": "AND",
            "rules": [
                {
                    "entity": "task",
                    "event": "completed",
                    "conditions": {"assigned_to": "self"},
                    "count": {"type": ">=", "value": 2},
                }
            ],
        }
    )
    db.add(badge)
    db.commit()
    db.close()

    create_response = client.post(
        "/api/tasks",
        json=_task_payload(project.id, member.id),
        headers=_auth_header(owner_token),
    )
    assert create_response.status_code == 201, create_response.text
    task_id = create_response.json()[0]["id"]

    for _ in range(2):
        complete_response = client.post(f"/api/tasks/{task_id}/complete", headers=_auth_header(member_token))
        assert complete_response.status_code == 200, complete_response.text
    reopen_response = client.patch(
        f"/api/tasks/{task_id}",
        json={"status": models.TaskStatusEnum.TODO.value},
        headers=_auth_header(owner_token),
    )
    assert reopen_response.status_code == 200, reopen_response.text
    recomplete_response = client.post(f"/api/tasks/{task_id}/complete", headers=_auth_header(member_token))
    assert recomplete_response.status_code == 200, recomplete_response.text

    db = TestingSessionLocal()
    assignee = db.get(models.User, member.id)
    progress = (
        db.query(models.UserBadgeProgress)
        .filter(models.UserBadgeProgress.user_id == member.id, models.UserBadgeProgress.badge_id == "two-completions")
        .one()
    )
    assert assignee.points == 40
    assert progress.status == models.BadgeProgressStatusEnum.IN_PROGRESS
    assert progress.progress_state["rules"][0]["count"] == 1
    db.close()


def test_partial_subtask_completion_does_not_award_task_completion_xp():
    _, owner, owner_token, _, member, member_token, project = _create_project_with_member()
    payload = _task_payload(project.id, member.id)
    payload["subtasks"] = [
        {
            "title": "Evidence review",
            "completed": False,
            "assigned_to_id": member.id,
            "status": models.SubtaskStatusEnum.TODO.value,
            "sort_order": 0,
        },
        {
            "title": "Remaining work",
            "completed": False,
            "assigned_to_id": member.id,
            "status": models.SubtaskStatusEnum.TODO.value,
            "sort_order": 1,
        },
    ]

    create_response = client.post("/api/tasks", json=payload, headers=_auth_header(owner_token))
    assert create_response.status_code == 201, create_response.text
    created_task = create_response.json()[0]
    subtask_id = created_task["subtasks"][0]["id"]

    subtask_response = client.patch(
        f"/api/tasks/{created_task['id']}/subtasks/{subtask_id}",
        json={"status": models.SubtaskStatusEnum.DONE.value},
        headers=_auth_header(member_token),
    )
    assert subtask_response.status_code == 200, subtask_response.text

    db = TestingSessionLocal()
    assignee = db.get(models.User, member.id)
    task = db.get(models.Task, created_task["id"])
    assert assignee.points == 0
    assert assignee.tasks_completed == 0
    assert task.completion_xp_awarded_at is None
    db.close()


def test_reward_spend_refund_and_overall_xp_preserve_claim_accounting():
    tenant = uuid.uuid4()
    admin, _ = phase5._create_user(models.RoleEnum.ADMIN, tenant)
    user, _ = phase5._create_user(models.RoleEnum.USER, tenant)

    db = TestingSessionLocal()
    claimant = db.get(models.User, user.id)
    claimant.points = 100
    reward = models.Reward(
        title="Manual reward",
        description="Needs approval",
        xp_required=40,
        auto_redeem=False,
        allow_multiple_claims=False,
        status=models.RewardStatusEnum.ACTIVE,
        created_by_id=admin.id,
        updated_by_id=admin.id,
    )
    db.add(reward)
    db.commit()
    reward_id = reward.id
    db.close()

    db = TestingSessionLocal()
    claimant = db.get(models.User, user.id)
    claim = reward_service.claim_reward(db, reward_id=reward_id, user=claimant)
    db.refresh(claimant)
    assert claimant.points == 60
    assert claimant.overall_xp_points == 100
    assert claim.status == models.RewardClaimStatusEnum.PENDING
    claim_id = claim.id
    db.close()

    db = TestingSessionLocal()
    rejected = reward_service.reject_claim(db, claim_id=claim_id, actor=db.get(models.User, admin.id))
    claimant = db.get(models.User, user.id)
    assert rejected.status == models.RewardClaimStatusEnum.REJECTED
    assert claimant.points == 100
    assert claimant.overall_xp_points == 100
    with pytest.raises(HTTPException):
        reward_service.reject_claim(db, claim_id=claim_id, actor=db.get(models.User, admin.id))
    db.rollback()
    claimant = db.get(models.User, user.id)
    assert claimant.points == 100
    db.close()


def test_concurrent_reward_claims_cannot_overspend_spendable_xp():
    tenant = uuid.uuid4()
    admin, _ = phase5._create_user(models.RoleEnum.ADMIN, tenant)
    user, _ = phase5._create_user(models.RoleEnum.USER, tenant)

    db = TestingSessionLocal()
    claimant = db.get(models.User, user.id)
    claimant.points = 50
    rewards = [
        models.Reward(
            title=f"Reward {index}",
            description="Costs most of the balance",
            xp_required=40,
            auto_redeem=True,
            allow_multiple_claims=False,
            status=models.RewardStatusEnum.ACTIVE,
            created_by_id=admin.id,
            updated_by_id=admin.id,
        )
        for index in range(2)
    ]
    db.add_all(rewards)
    db.commit()
    reward_ids = [reward.id for reward in rewards]
    db.close()

    def claim(reward_id: str) -> str:
        local_db = TestingSessionLocal()
        try:
            local_user = local_db.get(models.User, user.id)
            try:
                reward_service.claim_reward(local_db, reward_id=reward_id, user=local_user)
                return "claimed"
            except HTTPException as exc:
                local_db.rollback()
                return f"failed:{exc.status_code}"
        finally:
            local_db.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(claim, reward_ids))

    db = TestingSessionLocal()
    claimant = db.get(models.User, user.id)
    claim_count = db.query(models.RewardClaim).filter(models.RewardClaim.user_id == user.id).count()
    assert sorted(results) == ["claimed", "failed:400"]
    assert claimant.points == 10
    assert claimant.overall_xp_points == 50
    assert claim_count == 1
    db.close()


def test_phase12_migration_preserves_existing_balances_and_claim_totals():
    migration = import_module("backend.alembic.versions.fb3c4d5e6f7a_add_task_completion_xp_award_marker")
    engine = create_engine("sqlite://")
    conn = engine.connect()
    conn.execute(text("create table tasks (id varchar(36) primary key, title varchar(255))"))
    conn.execute(text("create table users (id varchar(36) primary key, points integer not null)"))
    conn.execute(text("create table reward_claims (id varchar(36) primary key, user_id varchar(36), status varchar(20), xp_spent integer not null)"))
    conn.execute(text("insert into tasks (id, title) values ('task-1', 'historical')"))
    conn.execute(text("insert into users (id, points) values ('user-1', 125)"))
    conn.execute(text("insert into reward_claims (id, user_id, status, xp_spent) values ('claim-1', 'user-1', 'REDEEMED', 40)"))
    before = conn.execute(text("select users.points, sum(reward_claims.xp_spent) from users join reward_claims on reward_claims.user_id = users.id group by users.points")).one()

    ctx = MigrationContext.configure(conn)
    migration.op = Operations(ctx)
    migration.upgrade()

    after = conn.execute(text("select users.points, sum(reward_claims.xp_spent) from users join reward_claims on reward_claims.user_id = users.id group by users.points")).one()
    task_marker = conn.execute(
        text(
            "select completion_xp_awarded_at, completion_xp_awarded_to_id, completion_xp_points_awarded, "
            "clarity_xp_awarded_at, clarity_xp_awarded_to_id, clarity_xp_points_awarded "
            "from tasks where id = 'task-1'"
        )
    ).one()
    assert after == before
    assert task_marker == (None, None, None, None, None, None)

    migration.downgrade()
    columns = [column["name"] for column in migration.sa.inspect(conn).get_columns("tasks")]
    assert columns == ["id", "title"]
    final = conn.execute(text("select users.points, sum(reward_claims.xp_spent) from users join reward_claims on reward_claims.user_id = users.id group by users.points")).one()
    assert final == before
    conn.close()
