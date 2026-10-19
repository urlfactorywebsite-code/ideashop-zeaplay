"""Two synthetic identities only; owned services, guarded launcher, no stress profiles."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select
from backend.tests.test_realtime_processes import workers, free_port, ROOT
from backend.app.tickets.models import WebhookDeliveryLog

pytestmark = pytest.mark.skipif(not os.environ.get("ZEAPLAY_RT_REDIS_TEST_URL") or not os.environ.get("ZEAPLAY_RT_WORKER_POSTGRES_TEST_URL") or not os.environ.get("ZEAPLAY_RT_K6_BINARY"), reason="Requires explicitly isolated PG/Redis and local k6")


def fixture_files(workers, tmp_path):
    ports, ids, token, _, _, _, _ = workers
    proof = json.loads(Path(ids["proof_file"]).read_text())
    approval = {"environment": "local", "approvedBy": "isolated-review-fixture", "profiles": ["smoke"],
                "runId": proof["runId"], "isolationNonce": proof["nonce"], "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                "target": f"http://127.0.0.1:{ports[0]}", "origin": f"http://127.0.0.1:{ports[0]}",
                "workerTargets": [f"http://127.0.0.1:{port}" for port in ports],
                "weights": {"calls": 100}}
    accounts = [{**account, "synthetic": True, "accessToken": token(account["userId"])} for account in proof["accounts"]]
    approval_file, account_file = tmp_path / "approval.local.json", tmp_path / "accounts.local.json"
    approval_file.write_text(json.dumps(approval))
    account_file.write_text(json.dumps(accounts))
    base = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PATHEXT", "COMSPEC", "HOME", "LANG"}}
    env = {**base, "ZEAPLAY_LOAD_ENABLED": "I_APPROVE_ISOLATED_LOAD_TESTING", "LOAD_PROFILE": "smoke", "LOAD_SMOKE_USERS": "2",
           "LOAD_SECONDS": "10", "LOAD_EVENT_RATE": "1", "LOAD_REQUEST_RATE": "10", "ZEAPLAY_LOAD_APPROVAL_FILE": str(approval_file),
           "ZEAPLAY_LOAD_ACCOUNTS_FILE": str(account_file), "K6_BINARY": os.environ["ZEAPLAY_RT_K6_BINARY"],
           "LOAD_SUMMARY_FILE": str(tmp_path / "summary.json")}
    for key in ["LOAD_WATCHDOG_FILE", "LOAD_STOP_FILE", "ZEAPLAY_LOAD_CONFIG"]:
        env.pop(key, None)
    return approval, approval_file, env


def run_guarded(env, tool):
    __tracebackhide__ = True
    result = subprocess.run(["node", "benchmarks/realtime/run.mjs", tool, "--run"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=80)
    evidence = re.sub(r"token=[^\s\"&]+", "token=[REDACTED]", result.stdout + result.stderr)
    assert result.returncode == 0, evidence
    return result.stdout


@pytest.mark.parametrize("workers", [{"load_proof": True}], indirect=True)
@pytest.mark.parametrize("scenario", ["chat", "tasks", "tickets", "cross-worker", "reconnect"])
def test_guarded_native_two_identity_smoke(workers, tmp_path, scenario):
    _, _, env = fixture_files(workers, tmp_path)
    env["LOAD_SCENARIO"] = scenario
    run_guarded(env, "native")
    summary = json.loads((tmp_path / "summary.json").read_text())
    checks = summary["metrics"]["checks"]
    assert checks.get("values", checks).get("rate", checks.get("value")) == 1
    if scenario != "reconnect":
        deliveries = summary["metrics"]["realtime_verified_deliveries"]
        assert deliveries.get("values", deliveries)["count"] > 0
    with workers[-1].connect() as connection:
        assert connection.scalar(select(func.count()).select_from(WebhookDeliveryLog)) == 0


@pytest.mark.parametrize("workers", [{"load_proof": True}], indirect=True)
def test_guarded_socketio_two_instances_and_two_identities(workers, tmp_path):
    approval, approval_file, env = fixture_files(workers, tmp_path)
    approval["presenceTargets"] = [f"http://127.0.0.1:{free_port()}" for _ in range(2)]
    approval_file.write_text(json.dumps(approval))
    children = []
    try:
        for target in approval["presenceTargets"]:
            port = target.rsplit(":", 1)[1]
            child = subprocess.Popen(["node", "src/server.js"], cwd=ROOT / "presence-server", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     env={**os.environ, "NODE_ENV": "test", "PRESENCE_PORT": port, "PRESENCE_TEST_ISOLATION_FILE": workers[1]["proof_file"],
                                          "PRESENCE_JWT_SECRET": "isolated-realtime-integration-key", "PRESENCE_REDIS_URL": os.environ["ZEAPLAY_RT_REDIS_TEST_URL"],
                                          "PRESENCE_EVENTS_CHANNEL": approval["runId"], "PRESENCE_REQUIRE_ORIGIN": "true", "PRESENCE_ALLOW_LOCALHOST_ORIGINS": "false", "PRESENCE_CORS_ORIGINS": approval["origin"]})
            children.append(child)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    if httpx.get(target + "/health").is_success:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(.1)
            else:
                pytest.fail("Owned Socket.IO instance did not become healthy")
        env["LOAD_SCENARIO"] = "mixed"
        output = run_guarded(env, "socketio")
        assert '"peakConnections":2' in output and '"failures":0' in output
    finally:
        for child in children:
            child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
