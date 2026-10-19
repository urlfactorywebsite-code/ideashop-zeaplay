"""Add opt-in realtime publication intent and aggregate ordering.

Revision ID: fc4d5e6f7a8b
Revises: fb3c4d5e6f7a
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "fc4d5e6f7a8b"
down_revision = "fb3c4d5e6f7a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("realtime_aggregates",
        sa.Column("tenant_id", sa.String(64), primary_key=True),
        sa.Column("aggregate_type", sa.String(16), primary_key=True),
        sa.Column("aggregate_id", sa.String(64), primary_key=True),
        sa.Column("version", sa.BigInteger(), nullable=False))
    op.create_table("realtime_outbox",
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("aggregate_type", sa.String(16), nullable=False),
        sa.Column("aggregate_id", sa.String(64), nullable=False),
        sa.Column("aggregate_version", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(96), nullable=False),
        sa.Column("payload", sa.JSON().with_variant(JSONB, "postgresql"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(128)),
        sa.CheckConstraint("status IN ('PENDING', 'PUBLISHED', 'DEAD')", name="ck_realtime_outbox_status"),
        sa.CheckConstraint("aggregate_version > 0 AND attempt_count >= 0", name="ck_realtime_outbox_counters"),
        sa.UniqueConstraint("tenant_id", "aggregate_type", "aggregate_id", "aggregate_version", name="uq_realtime_outbox_version"))
    op.create_index("ix_realtime_outbox_due", "realtime_outbox", ["status", "next_attempt_at", "created_at"])


def downgrade():
    # Never silently discard publication intent or reset a live ordering counter.
    if (op.get_bind().scalar(sa.text("SELECT count(*) FROM realtime_outbox"))
            or op.get_bind().scalar(sa.text("SELECT count(*) FROM realtime_aggregates"))):
        raise RuntimeError("Retain populated realtime tables; disable flags and use code rollback")
    op.drop_index("ix_realtime_outbox_due", table_name="realtime_outbox")
    op.drop_table("realtime_outbox")
    op.drop_table("realtime_aggregates")
