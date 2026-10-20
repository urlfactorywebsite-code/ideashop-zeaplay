"""Synthetic browser E2E API. Never import into the application entry point.

Requires an explicit rt3_test database, creates a random schema and only seeds
that schema. Token material is written to a caller-owned temporary mount.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import os
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from jose import jwt
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app import models
from app.config import get_settings
from app.database import Base, get_db
from app.dependencies import get_current_active_user
from app.routers.auth import router as auth_router
from app.routers.clients import router as clients_router
from app.routers.contacts import router as contacts_router, client_contacts_router
from app.routers.projects import router as projects_router
from app.routers.users import router as users_router
from app.tickets import models as ticket_models  # noqa: F401

url = os.environ['ZEAPLAY_RT_POSTGRES_TEST_URL']
assert 'rt3_test' in (make_url(url).database or ''), 'Scratch database required'
scratch = Path(os.environ['ZEAPLAY_E2E_OUTPUT'])
assert scratch.is_dir(), 'Caller-owned temporary output directory required'
schema = 'restore_browser_' + uuid4().hex
admin = create_engine(url)
engine = create_engine(url)
factory = sessionmaker(bind=engine, expire_on_commit=False)
actors = {}


@event.listens_for(engine, 'connect')
def scope(connection, _):
    cursor = connection.cursor()
    cursor.execute(f'SET search_path TO "{schema}", public')
    cursor.execute("SET statement_timeout TO 15000")
    cursor.close(); connection.commit()


def database():
    with factory() as db: yield db


@asynccontextmanager
async def lifespan(app):
    with admin.begin() as connection:
        connection.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public'))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        Base.metadata.create_all(engine)
        tenant = uuid4()
        with factory() as db:
            for name, role in [('owner', models.RoleEnum.OWNER), ('manager', models.RoleEnum.MANAGER), ('user', models.RoleEnum.USER), ('foreign', models.RoleEnum.OWNER)]:
                user = models.User(tenant_id=uuid4() if name == 'foreign' else tenant, name=f'Synthetic {name}',
                    email=f'{uuid4()}@example.com', hashed_password='synthetic-unusable-password',
                    role=role, status=models.UserStatusEnum.ACTIVE)
                db.add(user); db.flush(); actors[name] = user.id
            customers = [models.Client(tenant_id=tenant, company_name=f'Audit Client {number}',
                normalized_company_name=f'audit client {number}', notes='Preserved notes',
                created_by_id=actors['owner']) for number in (1, 2)]
            db.add_all(customers); db.flush()
            project = models.Project(tenant_id=tenant, client_id=customers[0].id, name='Audit Project',
                normalized_name='audit project', description='Preserved project', created_by_id=actors['owner'])
            db.add(project); db.flush()
            db.add_all([models.ProjectMember(tenant_id=tenant, project_id=project.id, user_id=actors['manager'], role=models.ProjectMemberRoleEnum.MANAGER),
                models.ProjectMember(tenant_id=tenant, project_id=project.id, user_id=actors['user'], role=models.ProjectMemberRoleEnum.MEMBER)])
            task = models.Task(project_id=project.id, title='Preserved task', created_by_id=actors['owner'], assigned_to_id=actors['user'])
            db.add(task); db.flush()
            child = models.Subtask(task_id=task.id, title='Preserved complete child', status=models.SubtaskStatusEnum.DONE, assigned_to_id=actors['user'])
            other = models.Subtask(task_id=task.id, title='Preserved waiting child', status=models.SubtaskStatusEnum.WAITING, assigned_to_id=actors['manager'])
            db.add_all([child, other]); db.flush()
            db.add(models.SubtaskDependency(task_id=task.id, subtask_id=other.id, depends_on_subtask_id=child.id))
            db.add(models.Comment(task_id=task.id, user_id=actors['owner'], content='Preserved comment'))
            now = datetime.now(timezone.utc)
            db.add(models.TimeEntry(tenant_id=tenant, user_id=actors['user'], subtask_id=child.id,
                started_at=now-timedelta(seconds=45), stopped_at=now, duration_seconds=45,
                status=models.TimeEntryStatusEnum.STOPPED, stop_reason='paused'))
            submission = models.CompletionSubmission(tenant_id=tenant, task_id=task.id, subtask_id=child.id,
                submitted_by_id=actors['user'], description='Preserved evidence', description_word_count=2,
                status=models.CompletionSubmissionStatusEnum.APPROVED, approval_required=False, attempt_number=1)
            db.add(submission); db.flush()
            content = b'Synthetic browser evidence\n'; (scratch/'evidence.txt').write_bytes(content)
            db.add(models.CompletionAttachment(tenant_id=tenant, submission_id=submission.id, original_filename='evidence.txt',
                mime_type='text/plain', file_size=len(content), storage_key=f'synthetic/{schema}/evidence.txt',
                checksum_sha256=hashlib.sha256(content).hexdigest()))
            for index, customer in enumerate(customers, start=1):
                contact = models.Contact(tenant_id=tenant, first_name=f'Contact {index}', display_name=f'Audit Contact {index}',
                    normalized_name=f'audit contact {index}')
                db.add(contact); db.flush()
                db.add(models.ClientContact(tenant_id=tenant, client_id=customer.id, contact_id=contact.id, is_primary=True))
            db.commit()
            settings = get_settings()
            credentials = {}
            for name, identifier in actors.items():
                user = db.get(models.User, identifier)
                credentials[name] = jwt.encode({'user_id': user.id, 'tenant_id': str(user.tenant_id),
                    'token_type': 'access', 'credentials_version': 0, 'exp': datetime.now(timezone.utc)+timedelta(hours=1)},
                    settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
            (scratch/'ready.json').write_text(json.dumps({'tokens': credentials, 'client_id': customers[0].id,
                'other_client_id': customers[1].id, 'project_id': project.id, 'schema': schema}))
        yield
    finally:
        engine.dispose()
        with admin.begin() as connection: connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
        (scratch/'ready.json').unlink(missing_ok=True)


app = FastAPI(lifespan=lifespan)
for router in (auth_router, clients_router, contacts_router, client_contacts_router, projects_router, users_router):
    app.include_router(router, prefix='/api')
app.dependency_overrides[get_db] = database


@app.get('/__audit__/snapshot')
def snapshot(user=Depends(get_current_active_user)):
    if user.id != actors.get('owner'): raise HTTPException(403)
    names = (models.Client, models.Project, models.ProjectMember, models.Contact, models.ClientContact,
        models.Task, models.Subtask, models.SubtaskDependency, models.Comment, models.TimeEntry,
        models.CompletionSubmission, models.CompletionAttachment, models.TaskLifecycleEvent, models.TaskLifecycleCoverage,
        models.AuditEvent)
    with factory() as db:
        rows = {model.__tablename__: [dict(row) for row in db.execute(select(model.__table__).order_by(*model.__table__.primary_key.columns)).mappings()]
                for model in names}
    return jsonable_encoder({'tables': rows, 'blob_sha256': hashlib.sha256((scratch/'evidence.txt').read_bytes()).hexdigest()})
