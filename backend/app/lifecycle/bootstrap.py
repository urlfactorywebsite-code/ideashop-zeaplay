"""Additive compatibility for existing development metadata-bootstrap installs.

Production installations must use the reviewed Alembic migration procedure.
This does not adopt/stamp Alembic or alter existing history/coverage timestamps.
"""
import argparse
import json

from sqlalchemy import Column, Index, MetaData, String, Table, create_engine, inspect, text
from sqlalchemy.schema import CreateColumn, CreateIndex


COLUMNS = {"continued_from_id": 36, "start_kind": 16, "stop_reason": 16}


def missing_columns(connection):
    inspector = inspect(connection)
    if not inspector.has_table("time_entries"):
        return []
    existing = {column["name"] for column in inspector.get_columns("time_entries")}
    return [name for name in COLUMNS if name not in existing]


def ensure_execution_columns(connection):
    """Run before metadata creates lifecycle triggers or seed code loads timers."""
    if connection.dialect.name not in {"sqlite", "postgresql"}:
        raise RuntimeError("Lifecycle bootstrap supports PostgreSQL and SQLite only")
    if connection.dialect.name == "sqlite" and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    if not inspect(connection).has_table("time_entries"):
        return []
    # Serialize development workers before inspecting/altering the same table.
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(741906241)"))
    table = Table("time_entries", MetaData(), *[
        Column(name, String(length), nullable=True) for name, length in COLUMNS.items()
    ])
    missing = missing_columns(connection)
    for name in missing:
        definition = CreateColumn(table.c[name]).compile(dialect=connection.dialect)
        connection.exec_driver_sql(f"ALTER TABLE time_entries ADD COLUMN {definition}")
    index = Index("uq_time_entries_continued_from_id", table.c.continued_from_id, unique=True,
                  postgresql_where=text("continued_from_id IS NOT NULL"),
                  sqlite_where=text("continued_from_id IS NOT NULL"))
    connection.execute(CreateIndex(index, if_not_exists=True))
    return missing


def main(argv=None):
    from ..config import get_settings
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repair", action="store_true", help="Add missing development timer columns/index")
    args = parser.parse_args(argv)
    settings = get_settings()
    if args.repair and settings.environment.lower() not in {"development", "dev", "local", "test", "testing"}:
        parser.error("Production repair requires the reviewed migration procedure; no changes made")
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            columns = ensure_execution_columns(connection) if args.repair else missing_columns(connection)
            print(json.dumps({"mode": "repair" if args.repair else "read-only", "columns": columns}))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
