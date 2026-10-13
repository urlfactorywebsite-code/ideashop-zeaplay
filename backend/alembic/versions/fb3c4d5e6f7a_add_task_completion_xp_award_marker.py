"""add task xp award markers

Revision ID: fb3c4d5e6f7a
Revises: fa2b3c4d5e6f
Create Date: 2026-10-13 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "fb3c4d5e6f7a"
down_revision = "fa2b3c4d5e6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "tasks" not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns("tasks")}
    with op.batch_alter_table("tasks") as batch:
        if "completion_xp_awarded_at" not in columns:
            batch.add_column(sa.Column("completion_xp_awarded_at", sa.DateTime(timezone=True), nullable=True))
        if "completion_xp_awarded_to_id" not in columns:
            batch.add_column(sa.Column("completion_xp_awarded_to_id", sa.String(length=36), nullable=True))
        if "completion_xp_points_awarded" not in columns:
            batch.add_column(sa.Column("completion_xp_points_awarded", sa.Integer(), nullable=True))
        if "clarity_xp_awarded_at" not in columns:
            batch.add_column(sa.Column("clarity_xp_awarded_at", sa.DateTime(timezone=True), nullable=True))
        if "clarity_xp_awarded_to_id" not in columns:
            batch.add_column(sa.Column("clarity_xp_awarded_to_id", sa.String(length=36), nullable=True))
        if "clarity_xp_points_awarded" not in columns:
            batch.add_column(sa.Column("clarity_xp_points_awarded", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "tasks" not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns("tasks")}
    with op.batch_alter_table("tasks") as batch:
        if "clarity_xp_points_awarded" in columns:
            batch.drop_column("clarity_xp_points_awarded")
        if "clarity_xp_awarded_to_id" in columns:
            batch.drop_column("clarity_xp_awarded_to_id")
        if "clarity_xp_awarded_at" in columns:
            batch.drop_column("clarity_xp_awarded_at")
        if "completion_xp_points_awarded" in columns:
            batch.drop_column("completion_xp_points_awarded")
        if "completion_xp_awarded_to_id" in columns:
            batch.drop_column("completion_xp_awarded_to_id")
        if "completion_xp_awarded_at" in columns:
            batch.drop_column("completion_xp_awarded_at")
