"""add project id to tasks

Revision ID: d5e7f9a1b2c3
Revises: c4d6e8f0a2b3
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa


revision = "d5e7f9a1b2c3"
down_revision = "c4d6e8f0a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("project_id", sa.String(length=36), nullable=True))
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    op.create_index("ix_tasks_project_status_updated", "tasks", ["project_id", "status", "updated_at"])
    op.create_foreign_key(
        "fk_tasks_project_id_projects",
        "tasks",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_tasks_project_id_projects", "tasks", type_="foreignkey")
    op.drop_index("ix_tasks_project_status_updated", table_name="tasks")
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_column("tasks", "project_id")
