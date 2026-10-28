"""Apply only the additive chat upload table after taking a database backup.

Run inside the backend container:
    python scripts/apply_chat_storage_schema.py --apply

This supports older installations without an alembic_version table. It does
not run other revisions, stamp migration history, or change existing records.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from sqlalchemy import inspect, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["VEE_BOOTSTRAP_SCHEMA"] = "false"

from app import models
from app.database import engine


def snapshot(connection):
    result = {}
    existing = set(inspect(connection).get_table_names())
    for table in ("users", "chat_conversations", "chat_messages", "message_attachments"):
        if table not in existing:
            continue
        digest = hashlib.sha256()
        count = 0
        for row in connection.execute(text(f'SELECT * FROM "{table}" ORDER BY id')).mappings():
            digest.update(json.dumps(dict(row), sort_keys=True, default=str).encode())
            digest.update(b"\n")
            count += 1
        result[table] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create the table; take a validated backup first")
    args = parser.parse_args()
    connection_options = {"isolation_level": "REPEATABLE READ"} if engine.dialect.name == "postgresql" else {}
    with engine.connect().execution_options(**connection_options) as connection, connection.begin():
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(2001028200)"))
        before = snapshot(connection)
        exists = inspect(connection).has_table("chat_uploads")
        if not exists and not args.apply:
            print(json.dumps({"status": "missing", "apply_required": True}))
            return 2
        if not exists:
            models.ChatUpload.__table__.create(connection, checkfirst=True)
        required = set(models.ChatUpload.__table__.columns.keys())
        actual = {column["name"] for column in inspect(connection).get_columns("chat_uploads")}
        if required - actual:
            raise RuntimeError("Existing chat_uploads table is incompatible; no existing table was altered")
        after = snapshot(connection)
        if before != after:
            raise RuntimeError("Existing-record verification failed; transaction rolled back")
        result = {"status": "already_compatible" if exists else "created", "existing_records_unchanged": True,
                  "existing_tables": after, "migration_history_changed": False}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
