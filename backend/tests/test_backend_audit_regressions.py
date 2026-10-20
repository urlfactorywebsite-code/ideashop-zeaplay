"""Regression checks for failures found by the complete backend audit."""
import pytest

from backend.app import models
from backend.app.routers.data_admin import _serialize_tasks
from backend.app.tickets import service
from backend.app.tickets.models import Ticket
from backend.app.tickets.schemas import TicketUpdate
from backend.tests.test_task_lifecycle import data, engine  # noqa: F401


@pytest.mark.parametrize("changed", [True, False])
def test_ticket_update_commits_and_only_notifies_when_changed(data, monkeypatch, changed):
    sent = []
    monkeypatch.setattr(service.audit_logger, "log_event", lambda *_: None)
    monkeypatch.setattr(service, "notify_ticket_change", lambda *args, **kwargs: sent.append(kwargs))
    with data.factory() as db:
        ticket = Ticket(tenant_id=data.owner.tenant_id, created_by=data.owner.id,
                        owner_id=data.owner.id, title="Original ticket", description="Audit")
        db.add(ticket)
        db.commit()
        result = service.update_ticket(db, tenant_id=data.owner.tenant_id, ticket_id=ticket.id,
                                       current_user=data.owner, roles=["owner"],
                                       payload=TicketUpdate(title="Updated ticket") if changed else TicketUpdate())
        db.expire_all()
        assert db.get(Ticket, result.id).title == ("Updated ticket" if changed else "Original ticket")
        assert len(sent) == int(changed)


@pytest.mark.parametrize("linked_project", [True, False])
def test_task_backup_preserves_project_reference(data, linked_project):
    with data.factory() as db:
        task = db.get(models.Task, data.task.id)
        project_id = None
        if linked_project:
            client = models.Client(tenant_id=data.owner.tenant_id, company_name="Audit client", normalized_company_name="audit client")
            db.add(client)
            db.flush()
            project = models.Project(tenant_id=data.owner.tenant_id, client_id=client.id,
                                     name="Audit project", normalized_name="audit project")
            db.add(project)
            db.flush()
            task.project_id = project_id = project.id
        task.task_group_id = "audit-backup"
        db.commit()
        backup = _serialize_tasks([task])[0]
        assert backup.project_id == project_id
        assert backup.id == task.id
        assert [row.id for row in backup.subtasks] == [data.child.id]
