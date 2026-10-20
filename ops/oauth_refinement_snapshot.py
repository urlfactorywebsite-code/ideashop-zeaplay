"""Read-only business-data hashes; never print row contents or credentials."""
import hashlib
import json

from sqlalchemy import text

from app.database import engine

result = {}
with engine.connect() as connection:
    connection.execute(text('SET TRANSACTION READ ONLY'))
    for table in ['projects', 'smtp_config', 'tasks', 'users', 'webhook_subscriptions']:
        rows = list(connection.scalars(text(f'SELECT row_to_json(t)::text FROM {table} t ORDER BY id')))
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
print(json.dumps(result, sort_keys=True))
