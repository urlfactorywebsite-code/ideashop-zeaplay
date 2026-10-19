"""Bounded, payload-free instrumentation. No business writes or scrape-time SQL."""
import asyncio
import contextlib
import hmac
import os
import time
from pathlib import Path

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest, multiprocess
from starlette.responses import Response

REGISTRY = CollectorRegistry()
ATTEMPTS = Counter("zea_ws_attempts", "Native handshake attempts", ["feature"], registry=REGISTRY)
RESULTS = Counter("zea_ws_handshakes", "Handshake outcomes; policy includes origin, auth and limits", ["feature", "result"], registry=REGISTRY)
REJECTIONS = Counter("zea_ws_rejections", "Explicit pre-handshake rejection checks; not all object permission failures", ["feature", "reason"], registry=REGISTRY)
ACTIVE = Gauge("zea_ws_active", "Accepted sockets owned by live workers", ["feature"], multiprocess_mode="livesum", registry=REGISTRY)
CLOSES = Counter("zea_ws_disconnects", "Connection endings", ["feature", "reason"], registry=REGISTRY)
MESSAGES = Counter("zea_ws_messages", "ASGI messages successfully transferred", ["feature", "direction"], registry=REGISTRY)
BYTES = Histogram("zea_ws_payload_bytes", "UTF-8 or binary ASGI message payload size, excluding wire overhead", ["feature", "direction"], buckets=(64, 256, 1024, 4096, 16384, 65536, 262144), registry=REGISTRY)
SEND = Histogram("zea_ws_send_seconds", "ASGI send duration, not business handler duration", ["feature"], registry=REGISTRY)
FANOUT_FAILURES = Counter("zea_ws_fanout_failures", "Recipient sends removed by the existing manager error path", ["feature", "reason"], registry=REGISTRY)
TRANSPORT = Counter("zea_rt_events", "Transport outcomes", ["category", "outcome"], registry=REGISTRY)
PROCESSING = Histogram("zea_rt_handler_seconds", "Local fanout handler duration, monotonic", ["category"], registry=REGISTRY)
QUEUE = Gauge("zea_rt_queue", "Local queued envelopes", ["category"], multiprocess_mode="livesum", registry=REGISTRY)
SUBSCRIBER = Gauge("zea_rt_subscriber_up", "Every live worker must be subscribed", ["category"], multiprocess_mode="livemin", registry=REGISTRY)
LAG = Gauge("zea_event_loop_lag_seconds", "Worst worker scheduling delay", multiprocess_mode="livemax", registry=REGISTRY)
DEPENDENCY = Gauge("zea_dependency_up", "Latest periodic dependency probe", ["dependency"], multiprocess_mode="livemin", registry=REGISTRY)
REDIS_PING = Histogram("zea_redis_ping_seconds", "Periodic Redis ping duration", registry=REGISTRY)
POOL = Gauge("zea_db_pool_connections", "Worker pool usage", ["state"], multiprocess_mode="livesum", registry=REGISTRY)
OUTBOX = Gauge("zea_outbox_records", "Database-wide sampled counts; max avoids worker duplication", ["status"], multiprocess_mode="livemax", registry=REGISTRY)
OUTBOX_AGE = Gauge("zea_outbox_oldest_seconds", "Oldest unresolved event, including DEAD", multiprocess_mode="livemax", registry=REGISTRY)
OUTBOX_ATTEMPTS = Gauge("zea_outbox_retained_attempts", "Attempts across retained outbox rows; pruning can reduce this gauge", multiprocess_mode="livemax", registry=REGISTRY)
SAMPLED = Gauge("zea_dependency_sample_timestamp_seconds", "Last completed dependency sample", multiprocess_mode="livemin", registry=REGISTRY)
OUTBOX_ENABLED = Gauge("zea_outbox_enabled", "Whether the durable outbox is configured", multiprocess_mode="livemax", registry=REGISTRY)


def transport_event(category, outcome):
    if category in {"chat", "task", "ticket"} and outcome in {
        "published", "publish_error", "duplicate", "invalid", "queue_overflow", "handoff_overflow",
        "subscriber_error", "reconciliation_error", "consumer_restart", "processed", "processing_error",
    }:
        TRANSPORT.labels(category, outcome).inc()


def rejection(feature, reason):
    feature = {"task": "tasks", "ticket": "tickets"}.get(feature, feature)
    if feature in {"chat", "tasks", "tickets"} and reason in {"auth", "origin"}:
        REJECTIONS.labels(feature, reason).inc()


def metrics_token():
    token = os.environ.get("ZEAPLAY_METRICS_TOKEN", "")
    if not token and os.environ.get("ZEAPLAY_METRICS_TOKEN_FILE"):
        try:
            token = Path(os.environ["ZEAPLAY_METRICS_TOKEN_FILE"]).read_text().strip()
        except OSError:
            return ""
    return token


def process_alive(pid):
    if os.name == "nt":
        # os.kill(pid, 0) is not a safe POSIX-style probe on Windows.
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() != 87  # access denied is not proof of death
        try:
            code = wintypes.DWORD()
            kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            return not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
        finally:
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def scrape():
    directory = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if not directory:
        return generate_latest(REGISTRY)
    # Uvicorn has no Gunicorn child_exit hook. Reap killed workers in the same PID
    # namespace as well as cleaning gracefully exiting workers in lifespan shutdown.
    for file in Path(directory).glob("gauge_live*_*.db"):
        pid = int(file.stem.rsplit("_", 1)[1])
        if not process_alive(pid):
            with contextlib.suppress(FileNotFoundError):
                multiprocess.mark_process_dead(pid)
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    return generate_latest(registry)


def start_relay_metrics_server(port):
    """Optional relay-only exporter; caller owns shutdown, no database work here."""
    from threading import Thread
    from wsgiref.simple_server import WSGIRequestHandler, make_server
    if len(metrics_token()) < 32:
        raise ValueError("A metrics secret is required for the relay exporter")

    def application(environ, start_response):
        token = metrics_token()
        valid = (environ.get("PATH_INFO") == "/internal/metrics" and environ.get("REQUEST_METHOD") == "GET"
                 and len(token) >= 32 and hmac.compare_digest(environ.get("HTTP_AUTHORIZATION", "").encode(), ("Bearer " + token).encode()))
        start_response("200 OK" if valid else "404 Not Found", [("Content-Type", "text/plain; version=0.0.4"), ("Cache-Control", "no-store")])
        return [scrape() if valid else b""]

    class QuietHandler(WSGIRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def log_message(self, *args):
            pass

    server = make_server("0.0.0.0", port, application, handler_class=QuietHandler)
    worker = Thread(target=server.serve_forever, name="relay-metrics", daemon=True)
    worker.start()
    return server, worker


def sample_dependencies():
    from sqlalchemy import text
    from .cache import get_redis_client
    from .config import get_settings
    from .database import SessionLocal, engine
    OUTBOX_ENABLED.set(int(get_settings().realtime_outbox_enabled))
    try:
        started = time.perf_counter()
        client = get_redis_client()
        if client is None:
            raise ConnectionError()
        client.ping()
        REDIS_PING.observe(time.perf_counter() - started)
        DEPENDENCY.labels("redis").set(1)
    except Exception:
        DEPENDENCY.labels("redis").set(0)
    try:
        with SessionLocal() as db:
            if engine.dialect.name == "postgresql":
                db.execute(text("SET TRANSACTION READ ONLY"))
                db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
            db.execute(text("SELECT 1"))
            if get_settings().realtime_outbox_enabled:
                from .realtime.outbox import backlog
                state = backlog(db)
                for status in ("PENDING", "DEAD", "PUBLISHED"):
                    OUTBOX.labels(status).set(state["counts"].get(status, 0))
                OUTBOX_AGE.set(state["oldest_pending_age_seconds"])
                OUTBOX_ATTEMPTS.set(state["attempts"])
        DEPENDENCY.labels("postgres").set(1)
    except Exception:
        DEPENDENCY.labels("postgres").set(0)
    pool = engine.pool
    for name, method in (("checked_out", "checkedout"), ("idle", "checkedin")):
        if hasattr(pool, method):
            POOL.labels(name).set(getattr(pool, method)())
    SAMPLED.set(time.time())


class RealtimeMetricsMiddleware:
    def __init__(self, app):
        self.app = app
        self.probe = None
        self.dependency_probe = None

    async def observe_dependencies(self):
        while True:
            await asyncio.to_thread(sample_dependencies)
            await asyncio.sleep(30)

    async def observe_loop(self):
        while True:
            started = time.perf_counter()
            await asyncio.sleep(1)
            LAG.set(max(0, time.perf_counter() - started - 1))
            from .realtime.transport import subscriptions
            for category in ("chat", "task", "ticket"):
                sub = subscriptions.get(category)
                SUBSCRIBER.labels(category).set(int(bool(sub and sub.connected and sub.thread.is_alive() and not sub.consumer.done())))
                QUEUE.labels(category).set(sub.queue.qsize() if sub else 0)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] in {"/internal/metrics", "/api/internal/metrics"}:
            token = metrics_token()
            headers = [v for k, v in scope.get("headers", []) if k.lower() == b"authorization"]
            valid = scope.get("method") == "GET" and len(token) >= 32 and len(headers) == 1 and hmac.compare_digest(headers[0], ("Bearer " + token).encode())
            try:
                body, code = (scrape(), 200) if valid else (b"", 404)
            except Exception:
                body, code = b"", 503
            response = Response(body, status_code=code,
                                media_type="text/plain; version=0.0.4", headers={"Cache-Control": "no-store"})
            await response(scope, receive, send)
            return
        if scope["type"] == "lifespan":
            async def lifespan_send(message):
                if message["type"] == "lifespan.startup.complete" and len(metrics_token()) >= 32:
                    self.probe = asyncio.create_task(self.observe_loop())
                    self.dependency_probe = asyncio.create_task(self.observe_dependencies())
                if message["type"] in {"lifespan.shutdown.complete", "lifespan.shutdown.failed"}:
                    jobs = [job for job in (self.probe, self.dependency_probe) if job]
                    for job in jobs:
                        job.cancel()
                    await asyncio.gather(*jobs, return_exceptions=True)
                    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
                        multiprocess.mark_process_dead(os.getpid())
                await send(message)
            try:
                await self.app(scope, receive, lifespan_send)
            finally:
                jobs = [job for job in (self.probe, self.dependency_probe) if job]
                for job in jobs:
                    job.cancel()
                await asyncio.gather(*jobs, return_exceptions=True)
            return
        path = scope.get("path", "").removeprefix("/api")
        feature = "chat" if path == "/ws/chat" else "tasks" if path == "/ws/tasks" else "tickets" if path.startswith("/ws/tickets/") else None
        if scope["type"] != "websocket" or not feature:
            await self.app(scope, receive, send)
            return
        ATTEMPTS.labels(feature).inc()
        accepted, ended, released, reason = False, False, False, "normal"

        def close_reason(code):
            return "policy" if code == 1008 else "retry" if code == 1013 else "normal" if code in {1000, 1001} else "abnormal"

        def release():
            nonlocal released
            if accepted and not released:
                released = True
                ACTIVE.labels(feature).dec()
                CLOSES.labels(feature, reason).inc()

        async def observed_receive():
            nonlocal reason
            message = await receive()
            if message["type"] == "websocket.receive":
                record(message, "in")
            elif message["type"] == "websocket.disconnect":
                if not released:
                    reason = close_reason(message.get("code", 1006))
                release()
            return message

        def record(message, direction):
            MESSAGES.labels(feature, direction).inc()
            size = len(message.get("bytes") or (message.get("text") or "").encode("utf-8"))
            BYTES.labels(feature, direction).observe(size)

        async def observed_send(message):
            nonlocal accepted, ended, reason
            started = time.perf_counter()
            await send(message)
            if message["type"] == "websocket.accept" and not accepted:
                accepted = True
                ACTIVE.labels(feature).inc()
                RESULTS.labels(feature, "policy" if scope.get("_zea_ws_policy") else "accepted").inc()
            elif message["type"] == "websocket.send":
                record(message, "out")
                SEND.labels(feature).observe(time.perf_counter() - started)
            elif message["type"] == "websocket.close":
                ended = True
                code = message.get("code", 1000)
                reason = close_reason(code)
                release()
        try:
            await self.app(scope, observed_receive, observed_send)
        except BaseException:
            reason = "abnormal"
            raise
        finally:
            if accepted:
                release()
            else:
                RESULTS.labels(feature, "policy" if ended and reason == "policy" else "failed").inc()
