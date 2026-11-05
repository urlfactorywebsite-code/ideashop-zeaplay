"""Repair the unversioned, empty status registry left by metadata bootstrap.

Default is read-only. Apply only with writers stopped and a restored full backup
rehearsed first. This accepts exactly seven absent task columns plus the absent
board index, with all four new status tables empty. It never stamps Alembic.
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

os.environ["VEE_BOOTSTRAP_SCHEMA"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path.cwd()))  # Also supports a recovery file mounted at /repair.py.

import sqlalchemy as sa
from app import models as m
from app.database import engine
from app.services import task_statuses
from app.services.status_integrity import audit_data, schema_issues
from app.tickets import models as ticket_models  # noqa: F401
from sqlalchemy.orm import Session

STATUS_TABLES = ("task_status_scopes", "task_statuses", "status_configuration_audits", "task_hold_intervals")
COLUMNS = {
    "custom_status_id": "VARCHAR(36) CONSTRAINT fk_tasks_custom_status REFERENCES task_statuses(id) ON DELETE RESTRICT",
    "hold_started_at": "TIMESTAMP WITHOUT TIME ZONE",
    "hold_paused_seconds": "DOUBLE PRECISION NOT NULL DEFAULT 0",
    "hold_previous_status": "VARCHAR(40)",
    "hold_reason": "VARCHAR(500)",
    "status_transitioned_at": "TIMESTAMP WITHOUT TIME ZONE",
    "status_transition_version": "INTEGER NOT NULL DEFAULT 0",
}
EXPECTED_ISSUES = {"missing_column:tasks." + name for name in COLUMNS} | {
    "missing_index:ix_tasks_status_custom_updated_id"
}


def fingerprint(connection, columns):
    """Compare old values without printing/exporting their contents."""
    quote = connection.dialect.identifier_preparer.quote
    result = {}
    for table, names in columns.items():
        query = "SELECT " + ", ".join(map(quote, names)) + " FROM " + quote(table)
        hashes = [hashlib.sha256(json.dumps(list(row), default=str, sort_keys=True).encode()).digest()
                  for row in connection.execute(sa.text(query))]
        result[table] = {"rows": len(hashes), "sha256": hashlib.sha256(b"".join(sorted(hashes))).hexdigest()}
    return result


def plan(connection):
    if connection.dialect.name != "postgresql":
        raise RuntimeError("This recovery supports PostgreSQL only")
    inspector = sa.inspect(connection)
    if inspector.has_table("alembic_version") and connection.scalar(sa.text("SELECT count(*) FROM alembic_version")):
        raise RuntimeError("Versioned database: use its reviewed migration procedure")
    issues = set(schema_issues(connection))
    if not issues:
        return "already_compatible"
    if issues != EXPECTED_ISSUES:
        raise RuntimeError("Schema differs from the reviewed partial state: " + json.dumps(sorted(issues)))
    # The reported gate checks only selected columns; also require every ORM
    # column needed by provisioning and the final audit before making changes.
    for table in (*STATUS_TABLES, "tasks", "users", "projects"):
        actual = {column["name"] for column in inspector.get_columns(table)}
        expected = set(m.Base.metadata.tables[table].columns.keys())
        if table == "tasks":
            expected -= COLUMNS.keys()
        if expected - actual:
            raise RuntimeError("Additional missing columns in " + table + ": " + ", ".join(sorted(expected - actual)))
    for table in STATUS_TABLES:
        if connection.scalar(sa.text('SELECT count(*) FROM "' + table + '"')):
            raise RuntimeError("Existing status/hold records require a separate reviewed repair: " + table)
    return "repair_required"


def verify(connection):
    issues = schema_issues(connection)
    if issues:
        raise RuntimeError("Schema verification failed: " + json.dumps(issues))
    integrity = audit_data(connection)
    if integrity["errors"]:
        raise RuntimeError("Data verification failed: " + json.dumps(integrity["errors"]))
    return integrity


def repair(connection):
    # Caller owns the transaction. Recheck under locks before inspecting rows.
    inspector = sa.inspect(connection)
    tables = inspector.get_table_names()
    quote = connection.dialect.identifier_preparer.quote
    connection.exec_driver_sql("LOCK TABLE " + ", ".join(map(quote, sorted(tables))) + " IN SHARE ROW EXCLUSIVE MODE")
    state = plan(connection)
    if state == "already_compatible":
        return {"status": state, "migration_history_changed": False, "integrity": verify(connection)}
    old_columns = {table: [column["name"] for column in inspector.get_columns(table)]
                   for table in tables if table not in STATUS_TABLES}
    before = fingerprint(connection, old_columns)
    for name, definition in COLUMNS.items():
        connection.exec_driver_sql(f'ALTER TABLE tasks ADD COLUMN "{name}" {definition}')
    connection.exec_driver_sql("CREATE INDEX ix_tasks_custom_status_id ON tasks (custom_status_id)")
    connection.exec_driver_sql("CREATE INDEX ix_tasks_status_custom_updated_id ON tasks (status, custom_status_id, updated_at DESC, id)")

    # Provision through the existing canonical registry, retaining legacy labels,
    # IDs and workflow mappings. Commit the session savepoint, not the outer txn.
    with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
        tenants = set(db.scalars(sa.select(m.User.tenant_id).where(m.User.tenant_id.is_not(None))))
        tenants.update(db.scalars(sa.select(m.Project.tenant_id).where(m.Project.tenant_id.is_not(None))))
        for tenant in sorted(tenants, key=str):
            task_statuses.scope(db, SimpleNamespace(tenant_id=tenant))
        db.commit()

    # Match the Phase 3 migration's cutover policy for legacy ON_HOLD tasks.
    # Only new summary columns change; no historical hold credit is fabricated.
    cutover = datetime.now(timezone.utc).replace(tzinfo=None)
    held = connection.scalar(sa.text("SELECT count(*) FROM tasks WHERE status::text='ON_HOLD'"))
    connection.execute(sa.text("""INSERT INTO task_hold_intervals
        (id, tenant_id, task_id, started_at, previous_status, original_due_at, reason, source)
        SELECT md5(random()::text || clock_timestamp()::text || t.id),
          CASE WHEN t.project_id IS NOT NULL THEN p.tenant_id ELSE u.tenant_id END,
          t.id, :cutover, 'ON_HOLD', t.due_at,
          'Legacy hold: eligible pause begins at repair cutover; prior duration requires review.',
          'repair:partial_status_v1'
        FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.created_by_id
        WHERE t.status::text='ON_HOLD'"""), {"cutover": cutover})
    connection.execute(sa.text("""UPDATE tasks SET hold_started_at=:cutover,
        hold_previous_status='ON_HOLD', status_transitioned_at=:cutover
        WHERE status::text='ON_HOLD'"""), {"cutover": cutover})
    integrity = verify(connection)
    if before != fingerprint(connection, old_columns):
        raise RuntimeError("Pre-existing records changed; rolling back the entire repair")
    return {"status": "applied", "migration_history_changed": False,
            "existing_records_unchanged": True, "existing_tables": before,
            "legacy_holds_started_at_cutover": held, "integrity": integrity}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--database", help="Override only the database name for a restored rehearsal")
    args = parser.parse_args()
    target = sa.create_engine(engine.url.set(database=args.database)) if args.database else engine
    if target.dialect.name != "postgresql":
        parser.error("PostgreSQL only")
    try:
        with target.begin() as connection:
            connection.exec_driver_sql("SET LOCAL lock_timeout='10s'")
            connection.exec_driver_sql("SET LOCAL statement_timeout='120s'")
            if args.apply:
                connection.execute(sa.text("SELECT pg_advisory_xact_lock(741906245)"))
                result = repair(connection)
            else:
                connection.exec_driver_sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                state = plan(connection)
                result = {"status": state, "migration_history_changed": False}
                if state == "already_compatible":
                    result["integrity"] = verify(connection)
        print(json.dumps(result, indent=2))
    finally:
        if target is not engine:
            target.dispose()


if __name__ == "__main__":
    main()
