"""update webhook subscriptions and delivery logs

Revision ID: 9b7c1a2e3d4f
Revises: 8b9c2d6a4f1e, 8f4b2c6a1d3e
Create Date: 2026-02-05 01:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "9b7c1a2e3d4f"
down_revision = ("8b9c2d6a4f1e", "8f4b2c6a1d3e")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    subscription_cols = {col["name"] for col in inspector.get_columns("webhook_subscriptions")}
    delivery_cols = {col["name"] for col in inspector.get_columns("webhook_delivery_logs")}

    with op.batch_alter_table("webhook_subscriptions") as batch:
        if "name" not in subscription_cols:
            batch.add_column(
                sa.Column(
                    "name",
                    sa.String(length=255),
                    nullable=False,
                    server_default=sa.text("'Webhook'"),
                )
            )
        if "subscribed_events" not in subscription_cols:
            batch.add_column(
                sa.Column(
                    "subscribed_events",
                    sa.JSON(),
                    nullable=False,
                    server_default=sa.text("'[]'"),
                )
            )
        if "custom_headers" not in subscription_cols:
            batch.add_column(sa.Column("custom_headers", sa.JSON(), nullable=True))
        if "event_type" in subscription_cols:
            batch.alter_column("event_type", existing_type=sa.String(length=255), nullable=True)

    with op.batch_alter_table("webhook_delivery_logs") as batch:
        if "response_status" not in delivery_cols:
            batch.add_column(sa.Column("response_status", sa.Integer(), nullable=True))
        if "response_body" not in delivery_cols:
            batch.add_column(sa.Column("response_body", sa.Text(), nullable=True))
        if "response_time_ms" not in delivery_cols:
            batch.add_column(sa.Column("response_time_ms", sa.Integer(), nullable=True))
        if "error_message" not in delivery_cols:
            batch.add_column(sa.Column("error_message", sa.Text(), nullable=True))

    if "subscribed_events" not in subscription_cols:
        return

    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE webhook_subscriptions
            SET subscribed_events = jsonb_build_array(event_type)
            WHERE (subscribed_events IS NULL OR subscribed_events = '[]'::jsonb)
              AND event_type IS NOT NULL
            """
        )
    else:
        op.execute(
            """
            UPDATE webhook_subscriptions
            SET subscribed_events = json_array(event_type)
            WHERE (subscribed_events IS NULL OR subscribed_events = '[]')
              AND event_type IS NOT NULL
            """
        )


def downgrade() -> None:
    with op.batch_alter_table("webhook_delivery_logs") as batch:
        batch.drop_column("error_message")
        batch.drop_column("response_time_ms")
        batch.drop_column("response_body")
        batch.drop_column("response_status")

    with op.batch_alter_table("webhook_subscriptions") as batch:
        batch.alter_column("event_type", existing_type=sa.String(length=255), nullable=False)
        batch.drop_column("custom_headers")
        batch.drop_column("subscribed_events")
        batch.drop_column("name")
