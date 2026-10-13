from __future__ import annotations

from sqlalchemy import inspect

from ..database import engine


def ensure_webhook_schema() -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "webhook_subscriptions" not in table_names or "webhook_delivery_logs" not in table_names:
        return

    sub_columns = {column["name"] for column in inspector.get_columns("webhook_subscriptions")}
    log_columns = {column["name"] for column in inspector.get_columns("webhook_delivery_logs")}
    statements: list[str] = []
    post_updates: list[str] = []
    dialect = engine.dialect.name

    def add_statement(sqlite_sql: str, pg_sql: str) -> None:
        if dialect == "sqlite":
            statements.append(sqlite_sql)
        elif dialect == "postgresql":
            statements.append(pg_sql)

    if "name" not in sub_columns:
        add_statement(
            "ALTER TABLE webhook_subscriptions ADD COLUMN name VARCHAR(255) NOT NULL DEFAULT 'Webhook'",
            "ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT 'Webhook'",
        )
    if "subscribed_events" not in sub_columns:
        add_statement(
            "ALTER TABLE webhook_subscriptions ADD COLUMN subscribed_events TEXT NOT NULL DEFAULT '[]'",
            "ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS subscribed_events JSONB NOT NULL DEFAULT '[]'::jsonb",
        )
    if "custom_headers" not in sub_columns:
        add_statement(
            "ALTER TABLE webhook_subscriptions ADD COLUMN custom_headers TEXT",
            "ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS custom_headers JSONB",
        )
    if dialect == "postgresql" and "event_type" in sub_columns:
        statements.append("ALTER TABLE webhook_subscriptions ALTER COLUMN event_type DROP NOT NULL")

    if "response_status" not in log_columns:
        add_statement(
            "ALTER TABLE webhook_delivery_logs ADD COLUMN response_status INTEGER",
            "ALTER TABLE webhook_delivery_logs ADD COLUMN IF NOT EXISTS response_status INTEGER",
        )
    if "response_body" not in log_columns:
        add_statement(
            "ALTER TABLE webhook_delivery_logs ADD COLUMN response_body TEXT",
            "ALTER TABLE webhook_delivery_logs ADD COLUMN IF NOT EXISTS response_body TEXT",
        )
    if "response_time_ms" not in log_columns:
        add_statement(
            "ALTER TABLE webhook_delivery_logs ADD COLUMN response_time_ms INTEGER",
            "ALTER TABLE webhook_delivery_logs ADD COLUMN IF NOT EXISTS response_time_ms INTEGER",
        )
    if "error_message" not in log_columns:
        add_statement(
            "ALTER TABLE webhook_delivery_logs ADD COLUMN error_message TEXT",
            "ALTER TABLE webhook_delivery_logs ADD COLUMN IF NOT EXISTS error_message TEXT",
        )

    if dialect == "postgresql":
        post_updates.append(
            """
            UPDATE webhook_subscriptions
            SET subscribed_events = jsonb_build_array(event_type)
            WHERE (subscribed_events IS NULL OR subscribed_events = '[]'::jsonb)
              AND event_type IS NOT NULL
            """
        )
    elif dialect == "sqlite":
        post_updates.append(
            """
            UPDATE webhook_subscriptions
            SET subscribed_events = '["' || event_type || '"]'
            WHERE (subscribed_events IS NULL OR subscribed_events = '[]')
              AND event_type IS NOT NULL
            """
        )

    if not statements and not post_updates:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)
        for statement in post_updates:
            connection.exec_driver_sql(statement)
