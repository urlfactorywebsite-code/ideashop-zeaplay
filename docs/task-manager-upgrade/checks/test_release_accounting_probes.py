from datetime import datetime, timedelta
import uuid

from backend.app import models
from backend.app.services import rewards
from backend.tests import test_tasks_phase5 as phase5


def test_historical_completed_task_reopen_preserves_already_awarded_xp(monkeypatch):
    monkeypatch.setattr(phase5.tasks_module.notification_service, 'create_notification', phase5._noop_notification)
    monkeypatch.setattr(phase5.tasks_module, 'trigger_n8n_event', lambda *args, **kwargs: None)
    monkeypatch.setattr(phase5.tasks_module.task_link_service, 'handle_task_completion', lambda *args, **kwargs: None)
    tenant = uuid.uuid4()
    owner, owner_token = phase5._create_user(models.RoleEnum.OWNER, tenant)
    member, _ = phase5._create_user(models.RoleEnum.USER, tenant)
    project = phase5._create_client_and_project(tenant_id=tenant, manager_ids=[owner.id], member_ids=[member.id])
    with phase5.TestingSessionLocal() as db:
        user = db.get(models.User, member.id)
        user.points = 40
        user.tasks_completed = 1
        task = models.Task(id=str(uuid.uuid4()), project_id=project.id, title='Historical awarded task',
                           description='', status=models.TaskStatusEnum.DONE, priority=models.TaskPriorityEnum.HIGH,
                           team='Data Team', assigned_to_id=member.id, created_by_id=owner.id,
                           completed_at=datetime.utcnow(), due_at=datetime.utcnow() + timedelta(days=1))
        db.add(task)
        db.commit()
        task_id = task.id
    headers = {'Authorization': f'Bearer {owner_token}'}
    reopened = phase5.client.patch(f'/api/tasks/{task_id}', json={'status': 'TODO'}, headers=headers)
    assert reopened.status_code == 200, reopened.text
    completed = phase5.client.post(f'/api/tasks/{task_id}/complete', headers=headers)
    assert completed.status_code == 200, completed.text
    with phase5.TestingSessionLocal() as db:
        user = db.get(models.User, member.id)
        assert (user.points, user.tasks_completed) == (40, 1)


def test_stale_pending_claim_cannot_be_refunded_twice():
    tenant = uuid.uuid4()
    admin, _ = phase5._create_user(models.RoleEnum.ADMIN, tenant)
    user, _ = phase5._create_user(models.RoleEnum.USER, tenant)
    with phase5.TestingSessionLocal() as db:
        claimant = db.get(models.User, user.id)
        claimant.points = 60
        reward = models.Reward(title='Refund probe', description='', xp_required=40,
                               status=models.RewardStatusEnum.ACTIVE, created_by_id=admin.id, updated_by_id=admin.id)
        db.add(reward)
        db.flush()
        claim = models.RewardClaim(reward_id=reward.id, user_id=user.id,
                                   status=models.RewardClaimStatusEnum.PENDING, xp_spent=40)
        db.add(claim)
        db.commit()
        claim_id = claim.id
    with phase5.TestingSessionLocal() as first, phase5.TestingSessionLocal() as second:
        first_claim = first.get(models.RewardClaim, claim_id)
        stale_claim = second.get(models.RewardClaim, claim_id)
        assert first_claim.status == stale_claim.status == models.RewardClaimStatusEnum.PENDING
        rewards.reject_claim(first, claim_id=claim_id, actor=admin)
        try:
            rewards.reject_claim(second, claim_id=claim_id, actor=admin)
        except Exception:
            second.rollback()
            raise
    with phase5.TestingSessionLocal() as db:
        assert db.get(models.User, user.id).points == 100
