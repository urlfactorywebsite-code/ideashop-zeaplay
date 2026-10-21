"""Actual Chrome logins + policy/API scenario on a disposable database only."""
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI

from backend.app import models
from backend.app.auth import hash_password
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.routers import (
    auth,
    config,
    n8n,
    navigation,
    oauth_management,
    users,
    webhooks,
)
from backend.app.services import audit_logger
from backend.app.services import navigation as policies
from backend.tests import test_task_lifecycle as lifecycle_fixtures

# Explicit aliases register the shared disposable-database pytest fixtures.
data = lifecycle_fixtures.data
engine = lifecycle_fixtures.engine
from backend.tests.test_navigation import page, payload


def test_real_browser_role_matrix_login_logout_and_policy_lifecycle(data, engine, monkeypatch, tmp_path):
    module = os.environ.get('ZEAPLAY_PLAYWRIGHT_MODULE')
    frontend = os.environ.get('ZEAPLAY_NAVIGATION_FRONTEND_URL')
    if not module or not frontend:
        pytest.skip('Requires explicit local Vite URL and installed Playwright module')
    assert frontend.startswith(('http://127.0.0.1:', 'http://localhost:'))
    monkeypatch.setattr(audit_logger, 'log_event', lambda *args, **kwargs: None)
    monkeypatch.setattr(users, 'trigger_n8n_event', lambda *args, **kwargs: None)
    monkeypatch.setattr(get_settings(), 'enable_n8n_forwarding', False)
    monkeypatch.setattr(get_settings(), 'environment', 'development')
    monkeypatch.setattr(get_settings(), 'cors_allow_origins', [frontend])
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    password = 'Synthetic-navigation-review-2026!'
    hashed = hash_password(password)
    accounts = {}
    with data.factory() as db:
        for role in models.RoleEnum:
            member = models.User(tenant_id=data.owner.tenant_id, name='Navigation ' + role.value,
                email='navigation.' + role.value + '@example.com', hashed_password=hashed,
                role=role, status=models.UserStatusEnum.ACTIVE)
            db.add(member)
            accounts[role.value] = {'email': member.email, 'password': password}
        db.commit()
        change = payload(policies.document(db, data.owner))
        page(change, 'settings.api').update(enabled=False, allowedRoles=['owner'])
        policies.save(db, data.owner, navigation.PolicyUpdate.model_validate(change))
    app = FastAPI()
    for router in (auth.router, navigation.router, config.router, oauth_management.router, n8n.router, webhooks.router):
        app.include_router(router, prefix='/api')
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    backend_url = 'http://127.0.0.1:' + str(listener.getsockname()[1])
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False))
    thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
    thread.start()
    for _ in range(200):
        if server.started: break
        time.sleep(0.02)
    assert server.started
    destination = Path(os.environ.get('ZEAPLAY_NAVIGATION_BROWSER_OUTPUT', str(tmp_path)))
    destination.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'ZEAPLAY_SECURITY_FRONTEND_URL': frontend, 'ZEAPLAY_SECURITY_BACKEND_URL': backend_url,
           'ZEAPLAY_SECURITY_ACCOUNTS': json.dumps(accounts), 'ZEAPLAY_SECURITY_OUTPUT': str(destination / engine.dialect.name)}
    try:
        result = subprocess.run(['node', 'frontend/e2e/navigation-security.mjs'], cwd=Path(__file__).resolve().parents[2], env=env, capture_output=True, text=True, timeout=300, check=False)
        (destination / ('browser-' + engine.dialect.name + '.log')).write_text(result.stdout + result.stderr, encoding='utf-8')
        assert result.returncode == 0, (result.stdout + result.stderr)[-5000:]
        with data.factory() as db:
            saved = policies.document(db, data.owner)
            assert saved['revision'] >= 4
            assert page(saved, 'settings.api')['enabled']
            assert set(page(saved, 'settings.api')['allowedRoles']) == {'owner', 'admin'}
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
