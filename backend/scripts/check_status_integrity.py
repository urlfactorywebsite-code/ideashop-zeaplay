"""Read-only deployment gate. Prints counts/codes, never task text or credentials."""
import json
import os
from pathlib import Path
import sys

if os.environ.get('VEE_BOOTSTRAP_SCHEMA','').lower() not in ('0','false','no','off'):
    raise SystemExit('Set VEE_BOOTSTRAP_SCHEMA=false before running the read-only integrity check.')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa
from app.database import engine
from app.tickets import models as ticket_models  # Register existing Task relationships; no startup/bootstrap.
from app.services.status_integrity import schema_issues, audit_data

with engine.connect() as connection:
    with connection.begin():
        if connection.dialect.name=='postgresql':
            connection.exec_driver_sql('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            connection.exec_driver_sql("SET LOCAL statement_timeout='120s'")
        elif connection.dialect.name=='sqlite':
            connection.exec_driver_sql('PRAGMA query_only=ON')
            connection.exec_driver_sql('BEGIN')
        issues=schema_issues(connection)
        revisions=(list(connection.scalars(sa.text('SELECT version_num FROM alembic_version')))
                   if sa.inspect(connection).has_table('alembic_version') else [])
        if revisions!=['f339a0b1c2d3']:issues.append('migration_revision_not_f339a0b1c2d3')
        integrity=audit_data(connection) if not issues else None
        result={'ok':not issues and not integrity['errors'],'schema_issues':issues,'revisions':revisions,'integrity':integrity}
        print(json.dumps(result,indent=2))
        connection.rollback()
raise SystemExit(0 if result['ok'] else 1)
