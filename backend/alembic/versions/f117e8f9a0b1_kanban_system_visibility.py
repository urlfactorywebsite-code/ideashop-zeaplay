"""Keep every registered system column visible, preserving task data and audits."""
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "f117e8f9a0b1"
down_revision = "f006d7e8f9a0"
branch_labels = None
depends_on = None


def schema():
    try:
        from app import kanban_schema_v2
    except ModuleNotFoundError:
        from backend.app import kanban_schema_v2
    return kanban_schema_v2


def upgrade():
    connection = op.get_bind()
    statuses = sa.Table("task_statuses", sa.MetaData(), sa.Column("tenant_id", sa.Uuid()), autoload_with=connection)
    audits = sa.Table("status_configuration_audits", sa.MetaData(), sa.Column("tenant_id", sa.Uuid()), autoload_with=connection)
    scopes = sa.Table("task_status_scopes", sa.MetaData(), sa.Column("tenant_id", sa.Uuid(), primary_key=True), autoload_with=connection)
    affected = set()
    for row in connection.execute(sa.select(statuses).where(statuses.c.is_system.is_(True),
                                     statuses.c.kanban_visible.is_(False))).mappings():
        connection.execute(audits.insert().values(id=str(uuid4()), tenant_id=row["tenant_id"], status_id=row["id"],
            actor_id="migration:f117e8f9a0b1", action="system_visibility_backfill",
            previous_values={"kanban_visible": False}, new_values={"kanban_visible": True, "source": revision},
            created_at=datetime.utcnow()))
        connection.execute(statuses.update().where(statuses.c.id == row["id"]).values(kanban_visible=True,
                                                                                   updated_at=datetime.utcnow()))
        affected.add(row["tenant_id"])
    if affected:
        connection.execute(scopes.update().where(scopes.c.tenant_id.in_(affected)).values(revision=scopes.c.revision + 1))
    schema().install(connection)


def downgrade():
    # Retain the visible arrangement and append-only audit records. Older code
    # can still read all configuration; no task or status identities are changed.
    schema().uninstall(op.get_bind())
