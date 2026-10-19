from fastapi.testclient import TestClient
import pytest

from backend.app.main import CorsFastAPI, internal_server_error, settings
from backend.app.services import audit_logger


@pytest.mark.parametrize("origin,allowed", [("http://localhost:6300", True), ("https://untrusted.example.test", False), (None, False)])
def test_unhandled_errors_are_generic_and_keep_trusted_cors(monkeypatch, origin, allowed):
    monkeypatch.setattr(settings, "cors_allow_origins", ["http://localhost:6300"])
    app = CorsFastAPI()
    app.add_exception_handler(Exception, internal_server_error)
    @app.get("/broken")
    def broken():
        raise RuntimeError("Synthetic database detail must not be exposed")
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/broken", headers={"Origin": origin} if origin else {})
        assert response.status_code == 500
        assert response.json() == {"detail": "Internal server error"}
        assert response.headers["Cache-Control"] == "no-store"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers.get("Access-Control-Allow-Origin") == (origin if allowed else None)
        if allowed:
            assert "origin" in response.headers["Vary"].lower()


def test_actual_app_preflight_auth_failure_and_size_limit_keep_cors(monkeypatch):
    from backend.app.main import app
    monkeypatch.setattr(audit_logger, "log_event", lambda *_args: None)
    with TestClient(app, raise_server_exceptions=False) as client:
        origin = "http://localhost:6300"
        preflight = client.options("/api/tasks/task-1/subtasks/sub-1-1", headers={
            "Origin": origin, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,content-type"})
        assert preflight.status_code == 200
        unauthorized = client.patch("/api/tasks/task-1/subtasks/sub-1-1", json={}, headers={"Origin": origin})
        assert unauthorized.status_code == 401
        large = client.post("/api/clients", content=b"", headers={"Origin": origin, "Content-Length": str((settings.max_request_body_mb + 1) * 1024 * 1024)})
        assert large.status_code == 413
        for response in (preflight, unauthorized, large):
            assert response.headers["Access-Control-Allow-Origin"] == origin
        untrusted = client.options("/api/tasks/task-1/subtasks/sub-1-1", headers={
            "Origin": "https://untrusted.example.test", "Access-Control-Request-Method": "PATCH"})
        assert untrusted.status_code == 400 and "Access-Control-Allow-Origin" not in untrusted.headers
