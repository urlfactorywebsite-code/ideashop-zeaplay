"""Real client/project mutations produce tenant- and access-scoped committed history."""
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from backend.app import models, schemas
from backend.app.realtime import capture
from backend.app.services import clients, entity_notifications, notification_dispatcher, projects
from backend.tests.test_task_lifecycle import engine


@pytest.fixture
def roster(engine, monkeypatch):
    sent = []
    monkeypatch.setattr(notification_dispatcher, "trigger_n8n_event", lambda *_args: None)
    monkeypatch.setattr(notification_dispatcher.audit_logger, "log_event", lambda *_args: None)
    monkeypatch.setattr(capture, "publish", lambda *_args: None)
    monkeypatch.setattr(notification_dispatcher.push_service, "send_push",
        lambda db, *, user_ids, payload: sent.extend(user_ids) or len(user_ids))
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    tenant = uuid4()
    users = {}
    with factory() as db:
        for name, role in [("actor", models.RoleEnum.OWNER), ("owner", models.RoleEnum.OWNER),
                           ("admin", models.RoleEnum.ADMIN), ("manager", models.RoleEnum.MANAGER),
                           ("member", models.RoleEnum.USER), ("unassigned_manager", models.RoleEnum.MANAGER),
                           ("unassigned_user", models.RoleEnum.USER), ("inactive", models.RoleEnum.USER),
                           ("foreign", models.RoleEnum.OWNER)]:
            user = models.User(id=str(uuid4()), tenant_id=uuid4() if name == "foreign" else tenant,
                name=name, email=f"{uuid4()}@example.com", hashed_password="synthetic",
                role=role, status=models.UserStatusEnum.DEACTIVATED if name == "inactive" else models.UserStatusEnum.ACTIVE)
            db.add(user)
            users[name] = user
        db.commit()
    return SimpleNamespace(factory=factory, tenant=tenant, users=users, actor=users["actor"], sent=sent)


def customer(db, roster):
    return clients.create_client(db, tenant_id=roster.tenant, actor=roster.actor,
        payload=schemas.ClientCreate(company_name="Visible client", notes="Private notes"))


def project(db, roster, client):
    return projects.create_project(db, tenant_id=roster.tenant, actor=roster.actor,
        payload=schemas.ProjectCreate(name="Scoped project", client_id=client.id,
            manager_ids=[roster.users["manager"].id], member_ids=[roster.users["member"].id]))


def notifications(db, kind):
    return list(db.scalars(select(models.Notification).where(models.Notification.entity_type == kind)))


def test_client_management_roles_receive_create_update_archive_restore_once(roster):
    expected = {roster.users[name].id for name in ("owner", "admin", "manager", "unassigned_manager")}
    with roster.factory() as db:
        record = customer(db, roster)
        rows = notifications(db, models.NotificationEntityTypeEnum.CLIENT)
        assert {row.user_id for row in rows} == expected
        assert {row.type for row in rows} == {models.NotificationTypeEnum.CLIENT_CREATED}
        assert all("Private notes" not in row.message and row.tenant_id == roster.tenant for row in rows)
        clients.update_client(db, tenant_id=roster.tenant, client_id=record.id, actor=roster.actor,
            payload=schemas.ClientUpdate(company_name="Changed client"))
        clients.update_client(db, tenant_id=roster.tenant, client_id=record.id, actor=roster.actor,
            payload=schemas.ClientUpdate(company_name="Changed client"))
        clients.archive_client(db, tenant_id=roster.tenant, client_id=record.id, actor=roster.actor,
            payload=schemas.ClientArchive())
        clients.archive_client(db, tenant_id=roster.tenant, client_id=record.id, actor=roster.actor,
            payload=schemas.ClientArchive())
        clients.restore_client(db, tenant_id=roster.tenant, client_id=record.id, actor=roster.actor)
        clients.restore_client(db, tenant_id=roster.tenant, client_id=record.id, actor=roster.actor)
        assert len(notifications(db, models.NotificationEntityTypeEnum.CLIENT)) == len(expected) * 4
    assert set(roster.sent) == expected


def test_project_roles_and_membership_changes_exclude_removed_and_unrelated_users(roster):
    with roster.factory() as db:
        record = project(db, roster, customer(db, roster))
        expected = {roster.users[name].id for name in ("owner", "admin", "manager", "member")}
        rows = notifications(db, models.NotificationEntityTypeEnum.PROJECT)
        assert {row.user_id for row in rows} == expected
        assert {row.type for row in rows} == {models.NotificationTypeEnum.PROJECT_CREATED}
        projects.replace_project_members(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor,
            payload=schemas.ProjectMembershipInput(manager_ids=[roster.users["manager"].id],
                member_ids=[roster.users["unassigned_user"].id]))
        updated = [row for row in notifications(db, models.NotificationEntityTypeEnum.PROJECT)
                   if row.type == models.NotificationTypeEnum.PROJECT_UPDATED]
        next_expected = expected - {roster.users["member"].id} | {roster.users["unassigned_user"].id}
        assert {row.user_id for row in updated} == next_expected
        projects.update_project(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor,
            payload=schemas.ProjectUpdate(name=record.name))
        projects.replace_project_members(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor,
            payload=schemas.ProjectMembershipInput(manager_ids=[roster.users["manager"].id],
                member_ids=[roster.users["unassigned_user"].id]))
        assert len(notifications(db, models.NotificationEntityTypeEnum.PROJECT)) == len(expected) + len(next_expected)


def test_project_update_archive_restore_recipients_and_atomic_failure(roster, monkeypatch):
    with roster.factory() as db:
        record = project(db, roster, customer(db, roster))
        projects.update_project(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor,
            payload=schemas.ProjectUpdate(description="Changed"))
        projects.archive_project(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor,
            payload=schemas.ProjectArchive())
        projects.restore_project(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor)
        rows = notifications(db, models.NotificationEntityTypeEnum.PROJECT)
        assert len(rows) == 16
        assert {row.user_id for row in rows} == {roster.users[name].id for name in ("owner", "admin", "manager", "member")}
        before_push = len(roster.sent)
        original = entity_notifications.create_notification
        def fail_after_history(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("synthetic failure before commit")
        monkeypatch.setattr(entity_notifications, "create_notification", fail_after_history)
        with pytest.raises(RuntimeError, match="synthetic"):
            projects.update_project(db, tenant_id=roster.tenant, project_id=record.id, actor=roster.actor,
                payload=schemas.ProjectUpdate(name="Must roll back"))
        db.rollback()
        assert db.get(models.Project, record.id).name == "Scoped project"
        assert len(notifications(db, models.NotificationEntityTypeEnum.PROJECT)) == 16
        assert len(roster.sent) == before_push


@pytest.fixture
def ticket_record(roster, monkeypatch):
    from backend.app.tickets import service, workflow_service
    from backend.app.tickets.models import Ticket, TicketParticipant, TicketParticipantRoleEnum
    from backend.app.notifications import service as legacy_notifications
    from backend.app.webhooks import service as webhooks

    monkeypatch.setattr(service, "process_badge_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(workflow_service, "_emit_webhook", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(legacy_notifications, "send_ticket_emails", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(webhooks, "queue_event", lambda *_args, **_kwargs: [])
    with roster.factory() as db:
        department = models.Department(name="Notification department")
        db.add(department)
        db.flush()
        for name in ("manager", "member", "unassigned_user", "inactive", "foreign"):
            db.get(models.User, roster.users[name].id).department_id = department.id
        ticket = Ticket(tenant_id=roster.tenant, title="Restricted ticket", description="Synthetic description",
            created_by=roster.actor.id, owner_id=roster.users["member"].id,
            assigned_user_id=roster.users["member"].id, department_id=UUID(department.id))
        db.add(ticket)
        db.flush()
        db.add(TicketParticipant(tenant_id=roster.tenant, ticket_id=ticket.id,
            user_id=roster.users["member"].id, role=TicketParticipantRoleEnum.ASSIGNEE))
        db.commit()
        return ticket


def test_ticket_legacy_bridge_and_dispatch_share_deduplication_and_read_scope(roster, ticket_record):
    from backend.app.notifications import service as legacy
    from backend.app.services.ticket_notification_access import notify_ticket_change
    from backend.app.tickets.models import Ticket, TicketNotification

    with roster.factory() as db:
        ticket = db.get(Ticket, ticket_record.id)
        notify_ticket_change(db, ticket=ticket, actor=roster.actor,
            kind=models.NotificationTypeEnum.TICKET_CREATED, title="Ticket created", message="Created")
        db.commit()
        context = {"ticket_id": str(ticket.id), "actor_id": roster.actor.id,
            "actor_name": roster.actor.name, "ticket_title": ticket.title}
        legacy.create_ticket_notifications(db, tenant_id=roster.tenant,
            recipient_ids=[user.id for user in roster.users.values()], event_type="ticket.created",
            context=context, data={})
        db.commit()
        expected = {roster.users[name].id for name in ("owner", "admin", "manager", "member")}
        rows = notifications(db, models.NotificationEntityTypeEnum.TICKET)
        assert len(rows) == len(expected)
        assert {row.user_id for row in rows} == expected
        assert {row.user_id for row in db.scalars(select(TicketNotification))} == expected
        assert len(roster.sent) == len(expected)


def test_ticket_status_transfer_and_delete_notify_only_authorized_active_users(roster, ticket_record):
    from backend.app.tickets import service, workflow_service
    from backend.app.tickets.models import Ticket, TicketNotification, TicketStatusEnum

    with roster.factory() as db:
        ticket = workflow_service.update_ticket_status(db, tenant_id=roster.tenant,
            ticket_id=ticket_record.id, current_user=roster.actor, roles=["owner"],
            next_status=TicketStatusEnum.IN_PROGRESS)
        expected = {roster.users[name].id for name in ("owner", "admin", "manager", "member")}
        assert {row.user_id for row in notifications(db, models.NotificationEntityTypeEnum.TICKET)} == expected
        service._notify_department_members(db, tenant_id=roster.tenant,
            department_id=ticket.department_id, ticket=ticket, actor_id=roster.actor.id)
        db.commit()
        assert {row.user_id for row in db.scalars(select(TicketNotification))} == {
            roster.users[name].id for name in ("manager", "member")}
        service.soft_delete_ticket(db, tenant_id=roster.tenant, ticket_id=ticket.id,
            current_user=roster.actor, roles=["owner"])
        deleted = [row for row in notifications(db, models.NotificationEntityTypeEnum.TICKET)
                   if row.type == models.NotificationTypeEnum.TICKET_DELETED]
        assert {row.user_id for row in deleted} == expected


def test_ticket_close_reopen_events_are_deduplicated_across_legacy_and_new_channels(roster, ticket_record):
    from backend.app.tickets import service

    with roster.factory() as db:
        kwargs = dict(tenant_id=roster.tenant, ticket_id=ticket_record.id,
            current_user=roster.actor, roles=["owner"])
        service.close_ticket(db, **kwargs)
        service.close_ticket(db, **kwargs)
        service.reopen_ticket(db, **kwargs)
        service.reopen_ticket(db, **kwargs)
        rows = notifications(db, models.NotificationEntityTypeEnum.TICKET)
        expected = {roster.users[name].id for name in ("owner", "admin", "manager", "member")}
        assert len(rows) == len(expected) * 2
        assert {row.user_id for row in rows} == expected
        assert len(roster.sent) == len(rows)


def test_user_delete_cannot_target_other_tenant(roster):
    from fastapi import BackgroundTasks, HTTPException, Request
    from backend.app.routers.users import delete_user

    with roster.factory() as db:
        with pytest.raises(HTTPException) as denied:
            delete_user(roster.users["foreign"].id, BackgroundTasks(),
                Request({"type": "http", "headers": []}), db=db, current_user=roster.actor)
        assert denied.value.status_code == 404
        assert db.get(models.User, roster.users["foreign"].id) is not None


def test_management_events_include_managers_and_only_target_user_gets_own_account_update(roster):
    from fastapi import BackgroundTasks, Request
    from backend.app.routers import departments, users

    expected = {roster.users[name].id for name in ("owner", "admin", "manager", "unassigned_manager")}
    with roster.factory() as db:
        db.get(models.User, roster.users["inactive"].id).role = models.RoleEnum.MANAGER
        db.commit()
        assert set(users._get_admin_ids(db, roster.tenant)) == expected | {roster.actor.id}
        assert set(departments._get_admin_ids(db, roster.tenant)) == expected | {roster.actor.id}
        department = departments.create_department(schemas.DepartmentCreate(name="Management events"),
            BackgroundTasks(), db=db, current_user=roster.actor)
        departments.update_department(department.id, schemas.DepartmentUpdate(name="Changed department"),
            db=db, current_user=roster.actor)
        departments.update_department(department.id, schemas.DepartmentUpdate(name="Changed department"),
            db=db, current_user=roster.actor)
        department_rows = notifications(db, models.NotificationEntityTypeEnum.DEPARTMENT)
        assert len(department_rows) == len(expected) * 2
        assert {row.user_id for row in department_rows} == expected
        users.update_user(roster.users["member"].id, schemas.UserUpdate(name="Updated member"),
            BackgroundTasks(), Request({"type": "http", "headers": []}), db=db, current_user=roster.actor)
        rows = notifications(db, models.NotificationEntityTypeEnum.USER)
        assert {row.user_id for row in rows} == expected | {roster.users["member"].id}
        assert next(row for row in rows if row.user_id == roster.users["member"].id).deep_link == "/settings"
