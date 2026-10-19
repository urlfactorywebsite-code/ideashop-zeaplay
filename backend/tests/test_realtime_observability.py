import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from prometheus_client.parser import text_string_to_metric_families

from backend.app import observability as metrics


def value(name, **labels):
    return metrics.REGISTRY.get_sample_value(name, labels) or 0


def test_metrics_endpoint_is_fail_closed_and_duplicate_headers_denied(monkeypatch):
    app = FastAPI()
    app.add_middleware(metrics.RealtimeMetricsMiddleware)
    monkeypatch.delenv("ZEAPLAY_METRICS_TOKEN_FILE", raising=False)
    monkeypatch.delenv("ZEAPLAY_METRICS_TOKEN", raising=False)
    client = TestClient(app)
    assert client.get("/internal/metrics").status_code == 404
    monkeypatch.setenv("ZEAPLAY_METRICS_TOKEN", "test-metrics-credential-" * 3)
    auth = "Bearer " + os.environ["ZEAPLAY_METRICS_TOKEN"]
    assert client.get("/internal/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 404
    assert client.get("/internal/metrics", headers=[("Authorization", auth), ("Authorization", auth)]).status_code == 404
    result = client.get("/internal/metrics", headers={"Authorization": auth})
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert client.post("/internal/metrics", headers={"Authorization": auth}).status_code == 404
    assert list(text_string_to_metric_families(result.text))
    assert os.environ["ZEAPLAY_METRICS_TOKEN"] not in result.text


@pytest.mark.parametrize("path,feature", [("/ws/chat", "chat"), ("/api/ws/tasks", "tasks"), ("/ws/tickets/example", "tickets")])
def test_connection_counts_cleanup_and_utf8_payloads(path, feature):
    app = FastAPI()
    app.add_middleware(metrics.RealtimeMetricsMiddleware)
    @app.websocket(path)
    async def echo(ws: WebSocket):
        await ws.accept()
        await ws.send_text(await ws.receive_text())
        await ws.close()
    before = value("zea_ws_active", feature=feature)
    sent = value("zea_ws_payload_bytes_sum", feature=feature, direction="out")
    with TestClient(app).websocket_connect(path) as ws:
        ws.send_text("\u00e9")
        assert ws.receive_text() == "\u00e9"
    assert value("zea_ws_active", feature=feature) == before
    assert value("zea_ws_payload_bytes_sum", feature=feature, direction="out") == sent + 2


def test_abnormal_termination_never_leaks_active_socket():
    async def scenario():
        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})
            raise RuntimeError("synthetic failure")
        async def noop(*args): pass
        before = value("zea_ws_active", feature="chat")
        with pytest.raises(RuntimeError):
            await metrics.RealtimeMetricsMiddleware(app)({"type": "websocket", "path": "/ws/chat"}, noop, noop)
        assert value("zea_ws_active", feature="chat") == before
    asyncio.run(scenario())


@pytest.mark.parametrize("direction,code,reason", [("send", 1013, "retry"), ("receive", 1008, "policy")])
def test_closed_socket_is_released_before_handler_cleanup(direction, code, reason):
    async def scenario():
        before = value("zea_ws_active", feature="chat")
        count = value("zea_ws_disconnects_total", feature="chat", reason=reason)
        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})
            assert value("zea_ws_active", feature="chat") == before + 1
            if direction == "send":
                await send({"type": "websocket.close", "code": code})
            await receive()
            assert value("zea_ws_active", feature="chat") == before
        async def receive(): return {"type": "websocket.disconnect", "code": code}
        async def send(message): pass
        await metrics.RealtimeMetricsMiddleware(app)({"type": "websocket", "path": "/ws/chat"}, receive, send)
        assert value("zea_ws_active", feature="chat") == before
        assert value("zea_ws_disconnects_total", feature="chat", reason=reason) == count + 1
    asyncio.run(scenario())


def test_metrics_collector_failure_returns_service_unavailable(monkeypatch):
    monkeypatch.setenv("ZEAPLAY_METRICS_TOKEN", "test-metrics-collector-failure-0000000000")
    monkeypatch.setattr(metrics, "scrape", lambda: (_ for _ in ()).throw(RuntimeError("not exposed")))
    app = FastAPI()
    app.add_middleware(metrics.RealtimeMetricsMiddleware)
    result = TestClient(app).get("/internal/metrics", headers={"Authorization": "Bearer " + os.environ["ZEAPLAY_METRICS_TOKEN"]})
    assert result.status_code == 503 and not result.content


def test_policy_rejection_and_bounded_transport_labels():
    async def scenario():
        async def app(scope, receive, send): await send({"type": "websocket.close", "code": 1008})
        async def noop(*args): pass
        before = value("zea_ws_handshakes_total", feature="tasks", result="policy")
        await metrics.RealtimeMetricsMiddleware(app)({"type": "websocket", "path": "/ws/tasks"}, noop, noop)
        assert value("zea_ws_handshakes_total", feature="tasks", result="policy") == before + 1
    asyncio.run(scenario())
    metrics.transport_event("tenant-secret", "unknown-value")
    metrics.transport_event("chat", "publish_error")
    assert b"tenant-secret" not in metrics.scrape()
    for family in text_string_to_metric_families(metrics.scrape().decode()):
        for sample in family.samples:
            assert not {"user_id", "tenant_id", "token", "resource_id", "url"} & sample.labels.keys()


def test_multiprocess_counts_survive_worker_exit_and_dead_gauges_are_removed(tmp_path):
    env = {**os.environ, "PROMETHEUS_MULTIPROC_DIR": str(tmp_path)}
    root = Path(__file__).resolve().parents[2]
    script = "from backend.app.observability import ACTIVE, ATTEMPTS; ACTIVE.labels('chat').inc(); ATTEMPTS.labels('chat').inc()"
    for _ in range(2):
        subprocess.run([sys.executable, "-c", script], env=env, cwd=root, check=True, capture_output=True)
    result = subprocess.run([sys.executable, "-c", "from backend.app.observability import scrape; print(scrape().decode())"],
                            env=env, cwd=root, check=True, capture_output=True, text=True)
    samples = {sample.name: sample.value for family in text_string_to_metric_families(result.stdout)
               for sample in family.samples if sample.labels == {"feature": "chat"}}
    assert samples["zea_ws_attempts_total"] == 2
    assert samples.get("zea_ws_active", 0) == 0


def test_two_live_metric_processes_are_summed_then_reaped(tmp_path):
    env = {**os.environ, "PROMETHEUS_MULTIPROC_DIR": str(tmp_path)}
    root = Path(__file__).resolve().parents[2]
    script = "from backend.app.observability import ACTIVE; ACTIVE.labels('tasks').inc(); print('ready', flush=True); input()"
    children = [subprocess.Popen([sys.executable, "-c", script], env=env, cwd=root, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(2)]
    try:
        for child in children:
            assert child.stdout.readline().strip() == "ready"
        probe = subprocess.run([sys.executable, "-c", "from backend.app.observability import scrape; print(scrape().decode())"],
                               env=env, cwd=root, check=True, capture_output=True, text=True)
        assert 'zea_ws_active{feature="tasks"} 2.0' in probe.stdout
    finally:
        for child in children:
            child.communicate("\n", timeout=5)
    probe = subprocess.run([sys.executable, "-c", "from backend.app.observability import scrape; print(scrape().decode())"],
                           env=env, cwd=root, check=True, capture_output=True, text=True)
    assert 'zea_ws_active{feature="tasks"}' not in probe.stdout


def test_dashboard_generation_is_deterministic_and_has_bounded_refresh():
    root = Path(__file__).resolve().parents[2]
    directory = root / "ops/monitoring/grafana/dashboards"
    before = {path.name: path.read_bytes() for path in directory.glob("*.json")}
    subprocess.run([sys.executable, str(root / "ops/monitoring/generate_dashboards.py")], check=True)
    assert before == {path.name: path.read_bytes() for path in directory.glob("*.json")}
    assert len(before) == 5
    for raw in before.values():
        board = json.loads(raw)
        assert board["refresh"] == "30s" and board["panels"]
        for panel in board["panels"]:
            assert panel["datasource"]["uid"] == "zeaplay-prometheus"
            assert panel["fieldConfig"]["defaults"]["unit"]
            assert panel["fieldConfig"]["defaults"]["noValue"] == "No data"


def test_relay_exporter_requires_auth_and_shuts_down(monkeypatch):
    import urllib.error
    import urllib.request
    monkeypatch.setenv("ZEAPLAY_METRICS_TOKEN", "synthetic-relay-exporter-token-00000000000")
    server, worker = metrics.start_relay_metrics_server(0)
    url = f"http://127.0.0.1:{server.server_port}/internal/metrics"
    try:
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url, timeout=2)
        assert error.value.code == 404
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["ZEAPLAY_METRICS_TOKEN"]})
        with urllib.request.urlopen(request, timeout=2) as response:
            assert response.status == 200
            assert b"synthetic-relay-exporter-token" not in response.read()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
    assert not worker.is_alive()
