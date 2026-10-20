"""Additive timer upgrade shared by Alembic and development bootstrap."""
from sqlalchemy import inspect, text


def upgrade(connection):
    if not inspect(connection).has_table("time_entries"):
        return
    if connection.dialect.name == "postgresql":
        connection.execute(text("LOCK TABLE time_entries IN ACCESS EXCLUSIVE MODE"))
    elif not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    columns = {column["name"] for column in inspect(connection).get_columns("time_entries")}
    if "finalized_at" not in columns:
        kind = "TIMESTAMP WITH TIME ZONE" if connection.dialect.name == "postgresql" else "DATETIME"
        connection.execute(text(f"ALTER TABLE time_entries ADD COLUMN finalized_at {kind}"))
    for name, target in (("uq_time_entries_running_task", "task_id"),
                         ("uq_time_entries_running_subtask", "subtask_id")):
        connection.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON time_entries "
                                f"(tenant_id, user_id, {target}) WHERE stopped_at IS NULL AND {target} IS NOT NULL"))
    connection.execute(text("DROP INDEX IF EXISTS uq_time_entries_one_active_per_user"))


def downgrade(connection):
    if connection.dialect.name == "postgresql":
        connection.execute(text("LOCK TABLE time_entries IN ACCESS EXCLUSIVE MODE"))
    elif not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    if connection.scalar(text("SELECT 1 FROM time_entries WHERE finalized_at IS NOT NULL LIMIT 1")):
        raise RuntimeError("Finalized history exists; retain schema and use a forward application fix")
    if connection.scalar(text("SELECT 1 FROM time_entries WHERE stopped_at IS NULL GROUP BY tenant_id, user_id HAVING count(*) > 1 LIMIT 1")):
        raise RuntimeError("Multiple running timers exist; pause/stop extras before rollback")
    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_time_entries_one_active_per_user "
                            "ON time_entries (tenant_id, user_id) WHERE stopped_at IS NULL"))
    for name in ("uq_time_entries_running_task", "uq_time_entries_running_subtask"):
        connection.execute(text(f"DROP INDEX IF EXISTS {name}"))
    # Retain the nullable column to avoid SQLite trigger/table-rebuild data loss.
