from app.database import SessionLocal
from app.models import TaskTemplate

session = SessionLocal()
template = session.query(TaskTemplate).first()
if template:
    print(f'Title: {template.title}')
    print(f'Recurrence: {template.recurrence_rule}')
else:
    print('No templates found')
session.close()
