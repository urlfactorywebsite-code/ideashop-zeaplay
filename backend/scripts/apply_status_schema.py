"""Repair an unversioned development status schema after a verified full backup.

Default mode is read-only. Stop writers before --apply. Versioned installations
must use Alembic; production installations require their reviewed deployment plan.
This runs the status revisions atomically without stamping history.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ["VEE_BOOTSTRAP_SCHEMA"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from app.config import get_settings
from app.database import engine
from app.services.status_integrity import audit_data, schema_issues
from app.tickets import (
    models as ticket_models,  # noqa: F401 - register Task relationships
)

STATUS_TABLES = {"task_status_scopes", "task_statuses", "status_configuration_audits", "task_hold_intervals"}
TASK_COLUMNS = {"custom_status_id", "hold_started_at", "hold_paused_seconds", "hold_previous_status",
                "hold_reason", "status_transitioned_at", "status_transition_version"}
REVISIONS = ("f006d7e8f9a0", "f117e8f9a0b1", "f228f9a0b1c2", "f339a0b1c2d3", "f44ab1c2d3e4")


def plan(connection):
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())
    if "alembic_version" in tables:
        raise RuntimeError("Versioned database: use the reviewed Alembic upgrade procedure")
    required = {"tasks", "users", "projects", "subtasks", "time_entries",
                "task_lifecycle_events", "task_lifecycle_coverage"}
    if not required <= tables:
        raise RuntimeError("Missing prerequisite tables: " + ", ".join(sorted(required - tables)))
    issues = schema_issues(connection)
    if not issues:
        return []
    columns = {column["name"] for column in inspector.get_columns("tasks")}
    if STATUS_TABLES & tables or TASK_COLUMNS & columns:
        raise RuntimeError("Partial status schema: requires a reviewed repair; no changes made")
    if any("zea_lifecycle" in issue for issue in issues):
        raise RuntimeError("Missing lifecycle guards: repair prerequisites first")
    return list(REVISIONS)


def snapshot(connection, columns):
    """Hash every pre-existing column/row, without exporting any record contents."""
    result = {}
    quote = connection.dialect.identifier_preparer.quote
    for table, names in columns.items():
        rows = []
        query = "SELECT " + ", ".join(map(quote, names)) + " FROM " + quote(table)
        for row in connection.execute(sa.text(query)):
            rows.append(hashlib.sha256(json.dumps(list(row), default=str, sort_keys=True).encode()).digest())
        result[table] = {"rows": len(rows), "sha256": hashlib.sha256(b"".join(sorted(rows))).hexdigest()}
    return result


def repair(connection):
    pending = plan(connection)
    inspector = sa.inspect(connection)
    columns = {table: [column["name"] for column in inspector.get_columns(table)]
               for table in inspector.get_table_names()}
    # All writers must already be stopped. Locks also prevent a concurrent write
    # from being mistaken for a migration data change during verification.
    quote = connection.dialect.identifier_preparer.quote
    connection.exec_driver_sql("LOCK TABLE " + ", ".join(map(quote, sorted(columns))) + " IN SHARE ROW EXCLUSIVE MODE")
    before = snapshot(connection, columns)
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    scripts = ScriptDirectory.from_config(config)
    with Operations.context(MigrationContext.configure(connection)):
        for revision in pending:
            scripts.get_revision(revision).module.upgrade()
    issues = schema_issues(connection)
    if issues:
        raise RuntimeError("Schema verification failed: " + ", ".join(issues))
    integrity = audit_data(connection)
    if integrity["errors"]:
        raise RuntimeError("Data verification failed: " + json.dumps(integrity["errors"]))
    after = snapshot(connection, columns)
    if before != after:
        raise RuntimeError("Existing records changed: transaction rolled back")
    return {"status": "applied" if pending else "already_compatible", "revisions_executed": pending,
            "migration_history_changed": False, "existing_records_unchanged": True,
            "existing_tables": after, "integrity": integrity}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if engine.dialect.name != "postgresql":
        parser.error("This development repair supports PostgreSQL only")
    if args.apply and get_settings().environment.lower() not in {"development", "dev", "local", "test", "testing"}:
        parser.error("Production repair requires the reviewed deployment procedure")
    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout = '10s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout = '120s'")
        if args.apply:
            connection.execute(sa.text("SELECT pg_advisory_xact_lock(741906245)"))
            result = repair(connection)
        else:
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            pending = plan(connection)
            result = {"status": "repair_required" if pending else "already_compatible", "pending_revisions": pending,
                      "migration_history_changed": False}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
