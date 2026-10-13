from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text('SELECT COUNT(*) FROM task_templates'))
    count = result.fetchone()[0]
    print(f'TaskTemplate count: {count}')

    if count > 0:
        result = conn.execute(text('SELECT id, title FROM task_templates LIMIT 5'))
        rows = result.fetchall()
        print('Sample templates:')
        for row in rows:
            print(f'  {row[0]}: {row[1]}')
