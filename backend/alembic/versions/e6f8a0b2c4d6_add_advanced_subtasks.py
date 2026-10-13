"""add advanced subtask foundations

Revision ID: e6f8a0b2c4d6
Revises: d5e7f9a1b2c3
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa


revision = "e6f8a0b2c4d6"
down_revision = "d5e7f9a1b2c3"
branch_labels = None
depends_on = None


subtask_status_enum = sa.Enum(
    "WAITING",
    "TODO",
    "IN_PROGRESS",
    "BLOCKED",
    "IN_REVIEW",
    "DONE",
    name="subtaskstatusenum",
)


def upgrade() -> None:
    bind = op.get_bind()
    subtask_status_enum.create(bind, checkfirst=True)

    op.add_column("subtasks", sa.Column("assigned_to_id", sa.String(length=36), nullable=True))
    op.add_column("subtasks", sa.Column("status", subtask_status_enum, nullable=True))
    op.add_column("subtasks", sa.Column("sort_order", sa.Integer(), nullable=True))

    op.execute("UPDATE subtasks SET status = CASE WHEN completed THEN 'DONE' ELSE 'TODO' END WHERE status IS NULL")
    op.execute("UPDATE subtasks SET sort_order = 0 WHERE sort_order IS NULL")

    op.alter_column("subtasks", "status", existing_type=subtask_status_enum, nullable=False)
    op.alter_column("subtasks", "sort_order", existing_type=sa.Integer(), nullable=False)

    op.create_foreign_key(
        "fk_subtasks_assigned_to_id_users",
        "subtasks",
        "users",
        ["assigned_to_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_subtasks_id_task_id", "subtasks", ["id", "task_id"])
    op.create_index("ix_subtasks_task_status", "subtasks", ["task_id", "status"])
    op.create_index("ix_subtasks_assigned_to_id", "subtasks", ["assigned_to_id"])

    op.create_table(
        "subtask_dependencies",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("subtask_id", sa.String(length=36), nullable=False),
        sa.Column("depends_on_subtask_id", sa.String(length=36), nullable=False),
        sa.Column("dependency_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("branch_key", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["subtask_id", "task_id"],
            ["subtasks.id", "subtasks.task_id"],
            ondelete="CASCADE",
            name="fk_subtask_dependencies_child_same_task",
        ),
        sa.ForeignKeyConstraint(
            ["depends_on_subtask_id", "task_id"],
            ["subtasks.id", "subtasks.task_id"],
            ondelete="CASCADE",
            name="fk_subtask_dependencies_parent_same_task",
        ),
        sa.UniqueConstraint(
            "task_id",
            "subtask_id",
            "depends_on_subtask_id",
            name="uq_subtask_dependencies_edge",
        ),
    )
    op.create_index("ix_subtask_dependencies_task_child", "subtask_dependencies", ["task_id", "subtask_id"])
    op.create_index(
        "ix_subtask_dependencies_task_parent",
        "subtask_dependencies",
        ["task_id", "depends_on_subtask_id"],
    )
    op.alter_column("subtask_dependencies", "dependency_order", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_subtask_dependencies_task_parent", table_name="subtask_dependencies")
    op.drop_index("ix_subtask_dependencies_task_child", table_name="subtask_dependencies")
    op.drop_table("subtask_dependencies")
    op.drop_index("ix_subtasks_assigned_to_id", table_name="subtasks")
    op.drop_index("ix_subtasks_task_status", table_name="subtasks")
    op.drop_constraint("uq_subtasks_id_task_id", "subtasks", type_="unique")
    op.drop_constraint("fk_subtasks_assigned_to_id_users", "subtasks", type_="foreignkey")
    op.drop_column("subtasks", "sort_order")
    op.drop_column("subtasks", "status")
    op.drop_column("subtasks", "assigned_to_id")
    subtask_status_enum.drop(op.get_bind(), checkfirst=True)
