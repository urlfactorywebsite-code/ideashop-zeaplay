"""Exercise the actual app routes after the frontend proxy rewrites /api/."""
import os
from pathlib import Path
import re
import subprocess
import sys
from textwrap import dedent
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]


def test_time_entries_reach_auth_and_active_work_through_frontend_proxy(tmp_path):
    config = (ROOT / "frontend/nginx.conf").read_text()
    location = re.search(r"location /api/ \{([^}]+)\}", config)
    assert location, "The frontend API proxy location is missing"
    upstream = re.search(r"proxy_pass\s+(\S+);", location.group(1))
    assert upstream, "The frontend API proxy upstream is missing"
    upstream_prefix = urlsplit(upstream.group(1)).path

    # A fresh process avoids cached settings from other tests. No lifespan,
    # database reads, background workers, or application environment file.
    (tmp_path / "assets").mkdir()
    environment = {
        key: value for key, value in os.environ.items()
        if not key.startswith(("VEE_", "VAPID_", "ZEAPLAY_", "PROMETHEUS_"))
    }
    environment.update(
        PYTHONPATH=str(ROOT),
        VEE_DATABASE_URL="sqlite:///:memory:",
        VEE_BOOTSTRAP_SCHEMA="false",
        VEE_MEDIA_ROOT=str(tmp_path / "media"),
    )
    script = dedent("""
        import sys
        from fastapi.testclient import TestClient
        from backend.app.main import app
        from backend.app.database import get_db
        from backend.app.dependencies import get_current_active_user
        from backend.app.routers.time_entries import work_read_db
        from backend.app.services import audit_logger, work_history

        app.dependency_overrides[get_db] = lambda: None
        app.dependency_overrides[work_read_db] = lambda: None
        audit_logger.log_event = lambda *_: None
        client = TestClient(app)
        paths = [
            ("GET", "work/active"), ("GET", "work/history"),
            ("GET", "work/example/history"), ("GET", "active"),
            ("POST", "start"), ("POST", "stop"),
            ("POST", "example/pause"), ("POST", "example/resume"),
            ("POST", "example/stop"), ("POST", "example/restart"),
            ("PATCH", "example/correction"),
        ]
        # Nginx replaces its /api/ location prefix with the proxy_pass URI.
        for prefix in (sys.argv[1], "/api/"):
            for method, suffix in paths:
                path = prefix + "time-entries/" + suffix
                response = client.request(method, path, json={})
                assert response.status_code == 401, (method, path, response.status_code)
                assert response.headers["www-authenticate"] == "Bearer"

        snapshot = {
            "items": [], "user_id": "route-test-user", "tenant_id": "route-test-tenant",
            "server_time": "2026-10-20T00:00:00Z", "limit": 3,
            "running_count": 0, "next_offset": None,
        }
        app.dependency_overrides[get_current_active_user] = lambda: object()
        work_history.read = lambda *_args, **_kwargs: snapshot
        for prefix in (sys.argv[1], "/api/"):
            response = client.get(prefix + "time-entries/work/active")
            assert response.status_code == 200, response.text
            assert response.json() == snapshot
        client.close()
    """)
    result = subprocess.run(
        [sys.executable, "-c", script, upstream_prefix],
        cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
