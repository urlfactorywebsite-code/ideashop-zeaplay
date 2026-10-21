"""Loopback-only browser fixture. All data and media are disposable."""
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app import models
from backend.app.auth import create_access_token
from backend.app.database import Base, get_db
from backend.app.routers import avatars, users
from backend.app.services import media_service
from backend.app.storage.local import LocalAdapter
from backend.app.tickets import models as ticket_models  # noqa: F401

root = Path(tempfile.mkdtemp(prefix='zea-avatar-browser-'))
engine = create_engine('sqlite:///' + (root / 'fixture.db').as_posix(), connect_args={'check_same_thread': False})
computed = models.Task.__table__.c.search_vector.computed
models.Task.__table__.c.search_vector.computed = None
Base.metadata.create_all(engine)
models.Task.__table__.c.search_vector.computed = computed
factory = sessionmaker(bind=engine, expire_on_commit=False)
adapter = LocalAdapter(str(root / 'media'), '/uploads')
media_service.get_default_adapter = lambda: adapter
media_service.get_adapter = lambda _: adapter
users.audit_logger.log_event = lambda *a, **kw: None
users.trigger_n8n_event = lambda *a, **kw: None
tenant = uuid4()
people = {}
with factory() as db:
    department = models.Department(name='Engineering')
    db.add(department)
    db.flush()
    for role, name in [(models.RoleEnum.OWNER, 'Alex Morgan'), (models.RoleEnum.USER, 'Priya Shah')]:
        person = models.User(id=str(uuid4()), tenant_id=tenant, name=name, email=f'{role.value}@example.com',
            hashed_password='not-a-password', role=role, department_id=department.id,
            employer_id='EMP-001' if role == models.RoleEnum.OWNER else 'EMP-002',
            title='Product Engineer', profile_bio='Building thoughtful tools.\nHelping teams collaborate.', skills=['React', 'Python'])
        db.add(person)
        people[role.value] = person
    for index in range(12):
        db.add(models.User(id=str(uuid4()), tenant_id=tenant, name=f'Test Employee {index:02}',
            email=f'employee{index}@example.com', hashed_password='not-a-password', role=models.RoleEnum.USER,
            department_id=department.id, employer_id=f'EMP-{index + 3:03}'))
    db.commit()

app = FastAPI()
app.include_router(users.router, prefix='/api')
app.include_router(avatars.router, prefix='/api')


def database():
    with factory() as db:
        yield db


app.dependency_overrides[get_db] = database


@app.get('/api/fixture/session')
def session(role: str = 'owner'):
    person = people[role]
    return {'id': person.id, 'token': create_access_token(person.id, extra_claims={
        'tenant_id': str(tenant), 'credentials_version': 0})}


@app.get('/api/departments')
def departments():
    return [{'id': department.id, 'name': department.name}]


@app.get('/api/fixture/health')
def health():
    return {'ok': True}
