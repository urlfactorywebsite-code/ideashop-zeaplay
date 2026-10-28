"""A saturated database pool must not prevent unrelated HTTP requests completing."""
import asyncio
import threading
import time
from typing import Annotated

import httpx
import pytest
from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.exc import TimeoutError as PoolTimeout
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from backend.app import models
from backend.app.auth import create_access_token
from backend.app.database import get_db
from backend.app.dependencies import get_current_active_user
from backend.app.oauth_models import OAuthRateLimit
from backend.app.routers import auth


@pytest.mark.parametrize("operation", [
    "authenticated-request", "login", "login-form", "login-multipart", "browser-login", "readiness",
])
def test_pool_wait_does_not_block_health_and_recovers(tmp_path, monkeypatch, operation):
    from backend.app import main

    waiting = threading.Event()

    class ObservedPool(QueuePool):
        def _do_get(self):
            if self.checkedout() == 1:
                waiting.set()
            return super()._do_get()

    engine = create_engine(
        "sqlite:///" + (tmp_path / "pool.db").as_posix(),
        connect_args={"check_same_thread": False},
        poolclass=ObservedPool, pool_size=1, max_overflow=0, pool_timeout=2,
    )
    # No accounts or production tables are read; a missing user gives a real 401.
    models.User.__table__.create(engine)
    models.NavigationPolicy.__table__.create(engine)
    OAuthRateLimit.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(main, "SessionLocal", factory)
    monkeypatch.setattr(main.realtime_transport, "health", lambda: {
        "subscribers": {name: {"connected": True, "alive": True} for name in ("chat", "tasks", "tickets")},
    })
    monkeypatch.setattr(auth.audit_logger, "log_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(auth.settings, "cors_allow_origins", ["https://app.example.test"])

    app = FastAPI()
    app.include_router(auth.router)
    app.add_api_route("/health", main.health_check)
    app.add_api_route("/ready", main.readiness)

    def database():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = database

    @app.exception_handler(PoolTimeout)
    async def exhausted(_request, _error):
        return JSONResponse(status_code=503, content={"detail": "Test pool exhausted"})

    @app.get("/protected")
    def protected(user: Annotated[models.User, Depends(get_current_active_user)]):
        return {"id": user.id}

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            held = engine.connect()
            if operation == "authenticated-request":
                token = create_access_token("missing-user", extra_claims={"tenant_id": "unused"})
                request = client.get("/protected", headers={"Authorization": "Bearer " + token})
                expected = 401
            elif operation in {"login", "browser-login"}:
                headers = {"X-Zea-Browser": "1", "Origin": "https://app.example.test"} if operation == "browser-login" else {}
                request = client.post("/auth/login", headers=headers,
                                      json={"email": "missing@example.test", "password": "synthetic"})
                expected = 401
            elif operation == "login-form":
                request = client.post("/auth/login", data={"username": "missing@example.test", "password": "synthetic"})
                expected = 401
            elif operation == "login-multipart":
                request = client.post("/auth/login", files={
                    "email": (None, "missing@example.test"), "password": (None, "synthetic"),
                })
                expected = 401
            else:
                request, expected = client.get("/ready"), 200
            started = time.monotonic()
            blocked = asyncio.create_task(request)
            try:
                assert await asyncio.to_thread(waiting.wait, 3), "Request never reached the exhausted pool"
                health = await client.get("/health")
                assert health.status_code == 200
                assert time.monotonic() - started < 1, "Pool checkout blocked the API event loop"
                assert not blocked.done(), "Database request must still be waiting for a connection"
            finally:
                held.close()
                result = await blocked
            assert result.status_code == expected, result.text
            assert engine.pool.checkedout() == 0
            assert (await client.get("/health")).status_code == 200

    try:
        asyncio.run(scenario())
    finally:
        engine.dispose()
