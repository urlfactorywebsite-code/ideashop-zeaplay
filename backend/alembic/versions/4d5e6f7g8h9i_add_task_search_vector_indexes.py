"""add task search vector and indexes

Revision ID: 4d5e6f7g8h9i
Revises: 3c4d5e6f7g8h
Create Date: 2026-02-16 14:10:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "4d5e6f7g8h9i"
down_revision = "3c4d5e6f7g8h"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "tasks" not in tables:
        return

    columns = {col["name"] for col in inspector.get_columns("tasks")}
    indexes = {idx["name"] for idx in inspector.get_indexes("tasks")}

    if "search_vector" not in columns:
        op.add_column(
            "tasks",
            sa.Column(
                "search_vector",
                postgresql.TSVECTOR(),
                sa.Computed(
                    "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))",
                    persisted=True,
                ),
                nullable=True,
            ),
        )

    if "ix_tasks_search_vector" not in indexes:
        op.create_index(
            "ix_tasks_search_vector",
            "tasks",
            ["search_vector"],
            postgresql_using="gin",
        )
    if "ix_tasks_status" not in indexes:
        op.create_index("ix_tasks_status", "tasks", ["status"])
    if "ix_tasks_assigned_to_id" not in indexes:
        op.create_index("ix_tasks_assigned_to_id", "tasks", ["assigned_to_id"])
    if "ix_tasks_team" not in indexes:
        op.create_index("ix_tasks_team", "tasks", ["team"])
    if "ix_tasks_due_at" not in indexes:
        op.create_index("ix_tasks_due_at", "tasks", ["due_at"])
    if "ix_tasks_created_at" not in indexes:
        op.create_index("ix_tasks_created_at", "tasks", ["created_at"])
    if "ix_tasks_updated_at" not in indexes:
        op.create_index("ix_tasks_updated_at", "tasks", ["updated_at"])
    if "tenant_id" in columns and "ix_tasks_tenant_id" not in indexes:
        op.create_index("ix_tasks_tenant_id", "tasks", ["tenant_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "tasks" not in tables:
        return

    indexes = {idx["name"] for idx in inspector.get_indexes("tasks")}

    for index_name in [
        "ix_tasks_search_vector",
        "ix_tasks_status",
        "ix_tasks_assigned_to_id",
        "ix_tasks_team",
        "ix_tasks_due_at",
        "ix_tasks_created_at",
        "ix_tasks_updated_at",
        "ix_tasks_tenant_id",
    ]:
        if index_name in indexes:
            op.drop_index(index_name, table_name="tasks")

    columns = {col["name"] for col in inspector.get_columns("tasks")}
    if "search_vector" in columns:
        op.drop_column("tasks", "search_vector")
