"""Disposable browser-test API. Refuses any database except the isolated rt3_test.

Run with python -m ops.oauth_smoke_server; never point at the application database.
"""
import os
from pathlib import Path
from uuid import uuid4

os.environ['VEE_BOOTSTRAP_SCHEMA'] = 'false'
sqlite_root = os.environ.get('ZEAPLAY_OAUTH_SMOKE_SQLITE_DIR')
if sqlite_root:
    scratch = Path(sqlite_root).resolve()
    assert scratch.is_relative_to(Path(__file__).resolve().parents[1] / '.pytest_cache'), 'SQLite fallback must be inside the workspace pytest cache'
    scratch.mkdir(parents=True, exist_ok=True)
    sqlite_file = scratch / ('oauth-browser-' + uuid4().hex + '.db')
    os.environ['VEE_DATABASE_URL'] = 'sqlite:///' + sqlite_file.as_posix()
else:
    os.environ['VEE_DATABASE_URL'] = 'postgresql+psycopg://postgres@127.0.0.1:6543/rt3_test'
os.environ['VEE_OAUTH_ISSUER'] = 'http://127.0.0.1:6321/api/oauth2'
os.environ['VEE_OAUTH_UI_URL'] = 'http://127.0.0.1:6304/#/oauth/authorize'
os.environ['VEE_CORS_ALLOW_ORIGINS'] = '["http://127.0.0.1:6304"]'

from fastapi import FastAPI
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
import uvicorn

from backend.app import models
from backend.app.auth import hash_password
from backend.app.database import Base, get_db
from backend.app.config import get_settings
from backend.app.oauth_cors import build_cors_stack
from backend.app.routers.auth import router as auth
from backend.app.routers.oauth_management import discovery_router, router
from backend.app.routers.projects import router as projects
from backend.app.routers.tasks import router as tasks
from backend.app.services import audit_logger
from backend.app.tickets import models as ticket_models  # noqa: F401

url = os.environ['VEE_DATABASE_URL']
assert sqlite_root or make_url(url).database == 'rt3_test'
schema = 'oauth_browser_' + uuid4().hex
admin = create_engine(url) if not sqlite_root else None
if admin:
    with admin.begin() as connection:
        connection.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public'))
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
engine = create_engine(url, **({'connect_args': {'check_same_thread': False}} if sqlite_root else {}))


@event.listens_for(engine, 'connect')
def search_path(connection, _):
    if sqlite_root:
        connection.execute('PRAGMA foreign_keys=ON')
        return
    with connection.cursor() as cursor:
        cursor.execute(f'SET search_path TO "{schema}", public')
    connection.commit()


computed = models.Task.__table__.c.search_vector.computed
if sqlite_root:
    models.Task.__table__.c.search_vector.computed = None
try:
    Base.metadata.create_all(engine)
finally:
    models.Task.__table__.c.search_vector.computed = computed
factory = sessionmaker(bind=engine)
with factory() as db:
    db.add(models.User(id='00000000-0000-4000-8000-000000000001', tenant_id=uuid4(), name='OAuth test owner',
        email='oauth-browser@example.com', hashed_password=hash_password('Synthetic-browser-only!'),
        role=models.RoleEnum.OWNER, status=models.UserStatusEnum.ACTIVE))
    db.commit()
audit_logger.log_event = lambda *args, **kwargs: None
app = FastAPI()


def database():
    with factory() as db:
        yield db


app.dependency_overrides[get_db] = database
for component in (auth, router, projects, tasks):
    app.include_router(component, prefix='/api')
app.include_router(discovery_router)

if __name__ == '__main__':
    try:
        uvicorn.run(build_cors_stack(app, get_settings()), host='127.0.0.1', port=6321, log_level='warning', access_log=False)
    finally:
        engine.dispose()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
        else:
            sqlite_file.unlink(missing_ok=True)
