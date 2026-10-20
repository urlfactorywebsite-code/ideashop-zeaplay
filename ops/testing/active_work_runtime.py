"""Smoke rebuilt Linux application code against an explicit disposable test database.

Run inside the backend image, mounting only this script read-only. Never seed or
start the main app against an application's database. This owns a random schema.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import json
import os
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app import models, schemas
from app.config import get_settings
from app.database import Base, get_db
from app.routers.time_entries import router
from app.services import time_tracking, task_events
from app.ws import tasks
from app.tickets import models as ticket_models  # noqa

url = os.environ["ZEAPLAY_RT_POSTGRES_TEST_URL"]
assert "rt3_test" in (make_url(url).database or ""), "Only a disposable test database is allowed"
schema = "work_runtime_" + uuid4().hex
admin = create_engine(url)
engine = create_engine(url)
with admin.begin() as connection:
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"))
    connection.execute(text(f'CREATE SCHEMA "{schema}"'))


@event.listens_for(engine, "connect")
def search_path(connection, _):
    cursor = connection.cursor()
    cursor.execute(f'SET search_path TO "{schema}", public')
    cursor.close(); connection.commit()


factory = sessionmaker(bind=engine, expire_on_commit=False)
def database():
    with factory() as db: yield db


@asynccontextmanager
async def lifespan(app):
    task_events.start_task_event_listener(loop=asyncio.get_running_loop(), handler=tasks.broadcast_task_event)
    yield
    await tasks.manager.close_all()
    await task_events.stop_task_event_listener()


try:
    Base.metadata.create_all(engine)
    tenant = uuid4()
    with factory() as db:
        user = models.User(id=str(uuid4()), tenant_id=tenant, name="Runtime worker", email=f"{uuid4()}@example.test",
            hashed_password="synthetic-unusable-password", role=models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
        db.add(user); db.flush()
        task = models.Task(id=str(uuid4()), title="Runtime task", created_by_id=user.id, assigned_to_id=user.id)
        db.add(task); db.flush()
        children = [models.Subtask(id=str(uuid4()), task_id=task.id, title=f"Subtask {i}", assigned_to_id=user.id) for i in range(7)]
        db.add_all(children); db.commit()
    def start(child):
        with factory() as db:
            try: return time_tracking.start_timer(db, db.get(models.User, user.id), schemas.TimeEntryStart(subtask_id=child.id)).id
            except HTTPException as error:
                assert error.status_code == 409
                return None
    with ThreadPoolExecutor(max_workers=7) as pool:
        ids = [id for id in pool.map(start, children) if id]
    assert len(ids) == 3
    app = FastAPI(lifespan=lifespan)
    app.include_router(router, prefix="/api")
    app.include_router(tasks.router, prefix="/api")
    app.dependency_overrides[get_db] = database
    tasks.SessionLocal = factory
    token = jwt.encode({"sub": user.id, "tenant_id": str(tenant), "token_type": "access", "credentials_version": 0},
                      get_settings().jwt_secret_key, algorithm=get_settings().jwt_algorithm)
    headers = {"Authorization": "Bearer " + token}
    with TestClient(app) as client:
        with client.websocket_connect("/api/ws/tasks?token=" + token) as socket_a, client.websocket_connect("/api/ws/tasks?token=" + token) as socket_b:
            assert socket_a.receive_json()["type"] == "realtime:ready"
            assert socket_b.receive_json()["type"] == "realtime:ready"
            response = client.post(f"/api/time-entries/{ids[0]}/pause", headers=headers)
            assert response.status_code == 200, response.text
            for socket in (socket_a, socket_b):
                notice = socket.receive_json()
                assert notice["type"] == "timer.changed" and notice["user_id"] == user.id, notice
                assert "items" not in notice
            snapshot = client.get("/api/time-entries/work/active", headers=headers)
            assert snapshot.status_code == 200, snapshot.text
            assert snapshot.json()["running_count"] == 2
            assert "no-store" in snapshot.headers["cache-control"]
            assert client.post(f"/api/time-entries/{ids[0]}/resume", headers=headers).status_code == 201
            history = client.get("/api/time-entries/work/history", headers=headers)
            assert history.status_code == 200, history.text
            assert len(history.json()["items"]) == 3
    print(json.dumps({"platform": "Linux backend image", "database": "isolated PostgreSQL schema", "parallel_starts": 7,
                      "running_limit_enforced": 3, "real_websockets": 2, "pause_resume_history": "PASS", "result": "PASS"}))
finally:
    engine.dispose()
    with admin.begin() as connection:
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()
