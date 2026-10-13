"""add badges, badge rules, and progress tables

Revision ID: b7c2d9e1a0f4
Revises: 9b7c1a2e3d4f
Create Date: 2026-02-06 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b7c2d9e1a0f4"
down_revision = "9b7c1a2e3d4f"
branch_labels = None
depends_on = None


badge_state_enum = postgresql.ENUM(
    "draft",
    "active",
    "archived",
    name="badge_state_enum",
    create_type=False,
)
badge_progress_status_enum = postgresql.ENUM(
    "locked",
    "in_progress",
    "earned",
    name="badge_progress_status_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        badge_state_enum.create(bind, checkfirst=True)
        badge_progress_status_enum.create(bind, checkfirst=True)

    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "badges" not in existing_tables:
        op.create_table(
            "badges",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("tier", sa.String(length=50), nullable=False),
            sa.Column("tier_group", sa.String(length=100), nullable=True),
            sa.Column("tier_order", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("bonus_xp", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("image_url", sa.String(length=500), nullable=True),
            sa.Column("image_asset_path", sa.String(length=500), nullable=True),
            sa.Column(
                "state",
                badge_state_enum if bind.dialect.name == "postgresql" else sa.String(length=20),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_badges_tier_group", "badges", ["tier_group"])

    if "badge_rules" not in existing_tables:
        op.create_table(
            "badge_rules",
            sa.Column("badge_id", sa.String(length=36), nullable=False),
            sa.Column("rules", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["badge_id"], ["badges.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("badge_id"),
        )

    if "user_badge_progress" not in existing_tables:
        op.create_table(
            "user_badge_progress",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("badge_id", sa.String(length=36), nullable=False),
            sa.Column(
                "status",
                badge_progress_status_enum if bind.dialect.name == "postgresql" else sa.String(length=20),
                nullable=False,
                server_default="locked",
            ),
            sa.Column("progress_value", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("progress_state", sa.JSON(), nullable=False),
            sa.Column("earned_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["badge_id"], ["badges.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "badge_id", name="uq_user_badge_progress"),
        )


def downgrade() -> None:
    op.drop_table("user_badge_progress")
    op.drop_table("badge_rules")
    op.drop_index("ix_badges_tier_group", table_name="badges")
    op.drop_table("badges")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        badge_progress_status_enum.drop(bind, checkfirst=True)
        badge_state_enum.drop(bind, checkfirst=True)
