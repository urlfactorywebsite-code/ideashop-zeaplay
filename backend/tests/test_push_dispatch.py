"""Push dispatch uses committed, tenant-authorized notification history only.

No provider requests are made: delivery is captured at the push service boundary.
The imported engine fixture owns a disposable SQLite file or an explicitly named
rt3_test PostgreSQL schema.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import sessionmaker

from backend.app import models
from backend.app.chat.services import MessageService
from backend.app.realtime import capture
from backend.app.routers.departments import _get_admin_ids
from backend.app.services import notification_dispatcher as dispatcher
from backend.tests.test_task_lifecycle import engine


@pytest.fixture
def fixture(engine, monkeypatch):
    sent = []
    monkeypatch.setattr(dispatcher, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(dispatcher.audit_logger, "log_event", lambda *_args: None)
    monkeypatch.setattr(capture, "publish", lambda *_args: None)

    def send(db, *, user_ids, payload):
        # A separately opened session must see history before any external send.
        persisted = db.get(models.Notification, payload["notification_id"])
        assert persisted is not None
        sent.append((list(user_ids), dict(payload)))
        return 1

    monkeypatch.setattr(dispatcher.push_service, "send_push", send)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        tenant = uuid4()
        actor = models.User(id=str(uuid4()), tenant_id=tenant, name="Actor",
            email=f"{uuid4()}@example.com", hashed_password="synthetic",
            role=models.RoleEnum.OWNER, status=models.UserStatusEnum.ACTIVE)
        recipient = models.User(id=str(uuid4()), tenant_id=tenant, name="Recipient",
            email=f"{uuid4()}@example.com", hashed_password="synthetic",
            role=models.RoleEnum.ADMIN, status=models.UserStatusEnum.ACTIVE)
        foreign = models.User(id=str(uuid4()), tenant_id=uuid4(), name="Foreign",
            email=f"{uuid4()}@example.com", hashed_password="synthetic",
            role=models.RoleEnum.OWNER, status=models.UserStatusEnum.ACTIVE)
        db.add_all([actor, recipient, foreign])
        db.commit()
        task = models.Task(title="Private task", created_by_id=actor.id, assigned_to_id=recipient.id)
        db.add(task)
        db.commit()
    return SimpleNamespace(factory=factory, actor=actor, recipient=recipient,
                           foreign=foreign, task=task, sent=sent)


def notify(db, fixture, **kwargs):
    values = dict(user_id=fixture.recipient.id, actor_id=fixture.actor.id,
                  notification_type=models.NotificationTypeEnum.TASK_ASSIGNED,
                  message="Private task assigned", related_task_id=fixture.task.id)
    values.update(kwargs)
    return dispatcher.dispatch_notification(db, **values)


def test_push_waits_for_committed_history_and_released_business_transaction(fixture, monkeypatch):
    with fixture.factory() as db:
        original_send = dispatcher.push_service.send_push

        def send(delivery_db, **kwargs):
            assert db.get_transaction() is None
            assert delivery_db is not db
            return original_send(delivery_db, **kwargs)

        monkeypatch.setattr(dispatcher.push_service, "send_push", send)
        notification = notify(db, fixture)
        assert notification and fixture.sent == []
        db.commit()
        assert len(fixture.sent) == 1
        assert fixture.sent[0][1]["notification_id"] == notification.id
        assert fixture.sent[0][1]["url"] == f"/#/tasks?taskId={fixture.task.id}"


def test_outer_rollback_and_close_never_send_or_leak_to_session_reuse(fixture):
    db = fixture.factory()
    notify(db, fixture)
    db.rollback()
    notify(db, fixture)
    db.close()
    db.commit()
    assert fixture.sent == []
    assert list(db.scalars(select(models.Notification))) == []
    db.close()


def test_savepoint_commit_still_waits_for_outer_commit(fixture):
    with fixture.factory() as db:
        outer = notify(db, fixture, dedupe_key="outer")
        with db.begin_nested():
            inner = notify(db, fixture, dedupe_key="inner")
        assert fixture.sent == []
        db.commit()
        assert {payload["notification_id"] for _, payload in fixture.sent} == {outer.id, inner.id}


def test_savepoint_rollback_discards_only_its_push(fixture):
    with fixture.factory() as db:
        outer = notify(db, fixture, dedupe_key="outer")
        nested = db.begin_nested()
        notify(db, fixture, dedupe_key="inner")
        nested.rollback()
        db.commit()
        assert [payload["notification_id"] for _, payload in fixture.sent] == [outer.id]


def test_outer_rollback_discards_committed_savepoint_push(fixture):
    with fixture.factory() as db:
        notify(db, fixture, dedupe_key="outer")
        with db.begin_nested():
            notify(db, fixture, dedupe_key="inner")
        db.rollback()
        db.commit()
        assert fixture.sent == []
        assert list(db.scalars(select(models.Notification))) == []


def test_provider_exception_cannot_undo_domain_commit(fixture, monkeypatch, caplog):
    def fail(*_args, **_kwargs):
        raise RuntimeError("do not log sensitive provider information")

    monkeypatch.setattr(dispatcher.push_service, "send_push", fail)
    with fixture.factory() as db:
        notification = notify(db, fixture)
        db.commit()
    with fixture.factory() as db:
        assert db.get(models.Notification, notification.id) is not None
    assert "Post-commit push failed" in caplog.text
    assert "sensitive provider information" not in caplog.text


def test_deduplicated_notification_is_sent_once_across_commits(fixture):
    with fixture.factory() as db:
        original = notify(db, fixture, dedupe_key="same-event")
        assert notify(db, fixture, dedupe_key="same-event").id == original.id
        db.commit()
        assert notify(db, fixture, dedupe_key="same-event").id == original.id
        db.commit()
    assert len(fixture.sent) == 1


@pytest.mark.parametrize("module,kind", [
    ("tasks", models.NotificationTypeEnum.TASK_ASSIGNED),
    ("tickets", models.NotificationTypeEnum.TICKET_UPDATED),
    ("users", models.NotificationTypeEnum.USER_UPDATED),
    ("departments", models.NotificationTypeEnum.DEPARTMENT_UPDATED),
    ("comments", models.NotificationTypeEnum.COMMENT_ADDED),
])
def test_muted_categories_preserve_history_without_push(fixture, module, kind):
    with fixture.factory() as db:
        db.add(models.NotificationPreference(user_id=fixture.recipient.id, module=module, push_enabled=False))
        notification = notify(db, fixture, notification_type=kind)
        db.commit()
        assert db.get(models.Notification, notification.id) is not None
    assert fixture.sent == []


@pytest.mark.parametrize("case", ["actor-tenant", "explicit-tenant", "inactive", "missing-actor", "entity-tenant"])
def test_invalid_recipient_context_creates_neither_history_nor_push(fixture, case):
    with fixture.factory() as db:
        values = {}
        if case == "actor-tenant":
            values = {"actor_id": fixture.foreign.id}
        elif case == "explicit-tenant":
            values = {"tenant_id": fixture.foreign.tenant_id}
        elif case == "inactive":
            db.get(models.User, fixture.recipient.id).status = models.UserStatusEnum.DEACTIVATED
        elif case == "missing-actor":
            values = {"actor_id": str(uuid4())}
        else:
            # An automated notification without an actor must still match the task tenant.
            values = {"user_id": fixture.foreign.id, "actor_id": None}
        assert notify(db, fixture, **values) is None
        db.commit()
        assert list(db.scalars(select(models.Notification))) == []
    assert fixture.sent == []


def test_department_recipients_are_active_admins_in_actor_tenant(fixture):
    with fixture.factory() as db:
        assert set(_get_admin_ids(db, fixture.actor.tenant_id)) == {fixture.actor.id, fixture.recipient.id}
        db.get(models.User, fixture.recipient.id).status = models.UserStatusEnum.DEACTIVATED
        db.commit()
        assert _get_admin_ids(db, fixture.actor.tenant_id) == [fixture.actor.id]


def make_chat(db, fixture, *, cross_tenant=False, kind=models.ChatConversationTypeEnum.DIRECT, muted=False):
    recipient = db.get(models.User, fixture.foreign.id if cross_tenant else fixture.recipient.id)
    conversation = models.ChatConversation(tenant_id=fixture.actor.tenant_id, type=kind,
                                           created_by_id=fixture.actor.id, name="Private conversation")
    db.add(conversation)
    db.flush()
    db.add_all([
        models.ChatParticipant(conversation_id=conversation.id, user_id=fixture.actor.id),
        models.ChatParticipant(conversation_id=conversation.id, user_id=recipient.id, is_muted=muted),
    ])
    db.commit()
    message = models.ChatMessage(conversation_id=conversation.id, sender_id=fixture.actor.id,
                                 content=f"Hello @{recipient.name}")
    db.add(message)
    db.flush()
    return conversation, message, recipient


@pytest.mark.parametrize("kind", [models.ChatConversationTypeEnum.DIRECT, models.ChatConversationTypeEnum.GROUP])
@pytest.mark.parametrize("muted", [False, True])
def test_chat_mentions_deliver_once_and_honor_conversation_mute(fixture, kind, muted):
    with fixture.factory() as db:
        conversation, message, recipient = make_chat(db, fixture, kind=kind, muted=muted)
        service = MessageService(db)
        mentions = service._process_mentions(conversation, message, fixture.actor)
        assert mentions == [recipient.id]
        service._notify_recipients(conversation, message, fixture.actor, mentions)
        assert fixture.sent == []
        db.commit()
        history = list(db.scalars(select(models.Notification)))
        assert len(history) == (0 if muted else 1)
        assert len(list(db.scalars(select(models.MessageMention)))) == 1
    assert len(fixture.sent) == (0 if muted else 1)


@pytest.mark.parametrize("remove_membership", [False, True])
def test_existing_cross_tenant_chat_requires_actor_and_recipient_membership(fixture, remove_membership):
    with fixture.factory() as db:
        conversation, message, recipient = make_chat(db, fixture, cross_tenant=True)
        if remove_membership:
            db.execute(delete(models.ChatParticipant).where(
                models.ChatParticipant.conversation_id == conversation.id,
                models.ChatParticipant.user_id == recipient.id,
            ))
        notification = dispatcher.dispatch_notification(db, user_id=recipient.id, actor_id=fixture.actor.id,
            notification_type=models.NotificationTypeEnum.CHAT_MESSAGE,
            message=message.content, related_chat_id=conversation.id)
        db.commit()
        assert (notification is None) == remove_membership
    assert len(fixture.sent) == (0 if remove_membership else 1)


def test_chat_category_mute_preserves_history(fixture):
    with fixture.factory() as db:
        conversation, message, recipient = make_chat(db, fixture)
        db.add(models.NotificationPreference(user_id=recipient.id, module="chat", push_enabled=False))
        notification = dispatcher.dispatch_notification(db, user_id=recipient.id, actor_id=fixture.actor.id,
            notification_type=models.NotificationTypeEnum.CHAT_MESSAGE,
            message=message.content, related_chat_id=conversation.id)
        db.commit()
        assert db.get(models.Notification, notification.id) is not None
    assert fixture.sent == []


def test_rewards_and_achievements_deliver_push_and_history(fixture):
    with fixture.factory() as db:
        for kind in (models.NotificationTypeEnum.REWARD_CLAIMED, models.NotificationTypeEnum.ACHIEVEMENT_UNLOCKED):
            assert notify(db, fixture, notification_type=kind) is not None
        db.commit()
        assert len(list(db.scalars(select(models.Notification)))) == 2
    assert len(fixture.sent) == 2
    assert all(payload["module"] == "rewards" for _, payload in fixture.sent)


@pytest.mark.parametrize("change", ["deactivate", "mute-category", "change-tenant"])
def test_delivery_rechecks_current_recipient_and_preferences(fixture, change):
    with fixture.factory() as db:
        notification = notify(db, fixture)
        recipient = db.get(models.User, fixture.recipient.id)
        if change == "deactivate":
            recipient.status = models.UserStatusEnum.DEACTIVATED
        elif change == "change-tenant":
            recipient.tenant_id = fixture.foreign.tenant_id
        else:
            db.add(models.NotificationPreference(user_id=recipient.id, module="tasks", push_enabled=False))
        db.commit()
        assert db.get(models.Notification, notification.id) is not None
    assert fixture.sent == []


def test_delivery_rechecks_chat_membership_removed_after_queueing(fixture):
    with fixture.factory() as db:
        conversation, message, recipient = make_chat(db, fixture, cross_tenant=True)
        notification = dispatcher.dispatch_notification(db, user_id=recipient.id, actor_id=fixture.actor.id,
            notification_type=models.NotificationTypeEnum.CHAT_MESSAGE,
            message=message.content, related_chat_id=conversation.id)
        assert notification is not None
        db.execute(delete(models.ChatParticipant).where(
            models.ChatParticipant.conversation_id == conversation.id,
            models.ChatParticipant.user_id == recipient.id,
        ))
        db.commit()
    assert fixture.sent == []


def test_ticket_overdue_alert_obeys_ticket_category():
    assert dispatcher.resolve_module(
        models.NotificationTypeEnum.TASK_OVERDUE, models.NotificationEntityTypeEnum.TICKET,
    ) == "tickets"
    assert dispatcher.resolve_module(
        models.NotificationTypeEnum.TASK_OVERDUE, models.NotificationEntityTypeEnum.TASK,
    ) == "tasks"


@pytest.mark.parametrize("source,expected", [
    ("/tasks/task-1", "/#/tasks?taskId=task-1"),
    ("/tasks/task-1?subtaskId=step-2", "/#/tasks?taskId=task-1&subtaskId=step-2"),
    ("/projects/project-1", "/#/projects?projectId=project-1"),
    ("/clients/client-1", "/#/clients?clientId=client-1"),
    ("/achievements?tab=rewards", "/#/achievements?tab=rewards"),
    ("/#/tasks?taskId=task-1", "/#/tasks?taskId=task-1"),
    ("#/tasks?taskId=task-1", "/#/tasks?taskId=task-1"),
    ("/tickets/ticket-1", "/#/tickets?ticketId=ticket-1"),
    ("/tickets?status=CLOSED&ticketId=ticket-1", "/#/tickets?ticketId=ticket-1"),
    ("/chat/conversation-1?message=message-1", "/#/chat/conversation-1?message=message-1"),
    ("/users/person-1", "/#/admin/users"),
    ("/departments/team-1", "/#/admin/users"),
    ("/departments", "/#/admin/users"),
    ("/settings?tab=push", "/#/settings?tab=push"),
    ("/achievements", "/#/achievements"),
    ("/tasks?redirect=https://outside.invalid", "/#/tasks"),
    ("https://outside.invalid/tasks/private", None),
    ("//outside.invalid/tasks/private", None),
    ("javascript:alert(1)", None),
    ("/\\outside.invalid", None),
    ("http://[", None),
    ("/tasks/../../private", None),
    ("/tasks/task%2Fprivate", None),
    ("/api/config", None),
    ("/unknown", None),
])
def test_push_urls_target_known_hash_routes_only(source, expected):
    assert dispatcher._canonical_push_url(source) == expected


def test_push_url_normalization_preserves_history_deep_link(fixture):
    with fixture.factory() as db:
        original = f"/tasks/{fixture.task.id}"
        notification = notify(db, fixture, deep_link=original)
        db.commit()
        assert db.get(models.Notification, notification.id).deep_link == original
        assert fixture.sent[0][1]["url"] == f"/#/tasks?taskId={fixture.task.id}"


def test_invalid_deep_link_falls_back_to_authorized_entity():
    notification = models.Notification(deep_link="https://outside.invalid", related_task_id="task-1")
    assert dispatcher._resolve_url(notification) == "/#/tasks?taskId=task-1"
