"""add tenant_id to users

Revision ID: 8f4b2c6a1d3e
Revises: 6c2f1a9d5b7e
Create Date: 2026-02-02 13:05:00.000000
"""

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "8f4b2c6a1d3e"
down_revision = "6c2f1a9d5b7e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    bind = op.get_bind()
    users_table = sa.table(
        "users",
        sa.column("id", sa.String(length=36)),
        sa.column("employer_id", sa.String(length=255)),
        sa.column("tenant_id", postgresql.UUID(as_uuid=True)),
    )

    rows = bind.execute(
        sa.select(users_table.c.id, users_table.c.employer_id, users_table.c.tenant_id)
    ).all()
    default_tenant = uuid.uuid5(uuid.NAMESPACE_URL, "zea-play-tenant:default")

    for row in rows:
        if row.tenant_id:
            continue
        if row.employer_id:
            try:
                tenant_uuid = uuid.UUID(str(row.employer_id))
            except ValueError:
                tenant_uuid = uuid.uuid5(uuid.NAMESPACE_URL, f"zea-play-tenant:{row.employer_id}")
        else:
            tenant_uuid = default_tenant

        bind.execute(
            users_table.update()
            .where(users_table.c.id == row.id)
            .values(tenant_id=tenant_uuid)
        )

    op.alter_column("users", "tenant_id", nullable=False)


def downgrade() -> None:
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_column("users", "tenant_id")
