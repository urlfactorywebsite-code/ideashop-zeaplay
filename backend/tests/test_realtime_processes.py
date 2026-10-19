"""Opt-in, real Redis + two independent Uvicorn processes. No FLUSHDB or shared DB writes."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx
from jose import jwt
import pytest
import redis
from redis.backoff import NoBackoff
from redis.retry import Retry
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed

from backend.app import models
from backend.app.realtime.contracts import Event
from backend.app.tickets.models import Ticket, TicketParticipant, TicketParticipantRoleEnum

pytestmark = pytest.mark.skipif(not os.environ.get("ZEAPLAY_RT_REDIS_TEST_URL"), reason="Requires explicit isolated ZEAPLAY_RT_REDIS_TEST_URL")
ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as bound:
        bound.bind(("127.0.0.1", 0))
        return bound.getsockname()[1]


def receive(ws, expected):
    for _ in range(30):
        message = json.loads(ws.recv(timeout=8))
        if message.get("type") == "ping":
            ws.send(json.dumps({"type": "pong"}))
        if message.get("type") == expected:
            return message
    raise AssertionError(f"Expected {expected}")


@pytest.fixture
def workers(tmp_path, request):
    load_proof = bool(getattr(request, "param", {}).get("load_proof"))
    redis_url = os.environ["ZEAPLAY_RT_REDIS_TEST_URL"]
    broker = redis.Redis.from_url(redis_url, decode_responses=True, socket_timeout=3, socket_connect_timeout=3, retry=Retry(NoBackoff(), 0))
    broker.ping()  # A configured but unavailable test service is a failure, never a silent skip.
    prefix = "rt3-test-" + uuid4().hex
    db_path = tmp_path / "business.db"
    database_url = f"sqlite:///{db_path.as_posix()}"
    pg_url = os.environ.get("ZEAPLAY_RT_WORKER_POSTGRES_TEST_URL")
    schema, admin = None, None
    if pg_url:
        assert "rt3_test" in (make_url(pg_url).database or ""), "Refusing non-scratch worker database"
        schema = "rt3_workers_" + uuid4().hex
        admin = create_engine(pg_url)
        with admin.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"))
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        database_url = make_url(pg_url).update_query_dict({"options": f"-csearch_path={schema},public"}).render_as_string(hide_password=False)
    engine = create_engine(database_url)
    def cleanup_database():
        engine.dispose()
        if admin is not None:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
    request.addfinalizer(cleanup_database)
    computed = models.Task.__table__.c.search_vector.computed
    models.Task.__table__.c.search_vector.computed = None
    try:
        models.Base.metadata.create_all(engine)
    finally:
        models.Task.__table__.c.search_vector.computed = computed
    tenant = uuid4()
    with Session(engine) as db:
        db.add_all([models.User(id=id_, tenant_id=tenant, name=id_, email=f"{id_}@example.com", hashed_password="test",
                                role=models.RoleEnum.ADMIN if id_ == "a" else models.RoleEnum.USER, status=models.UserStatusEnum.ACTIVE)
                    for id_ in ("a", "b")])
        db.flush()
        conversation = models.ChatConversation(tenant_id=tenant, type=models.ChatConversationTypeEnum.DIRECT, created_by_id="a")
        db.add(conversation)
        db.flush()
        db.add_all([models.ChatParticipant(conversation_id=conversation.id, user_id=id_, role=models.ChatMemberRoleEnum.MEMBER) for id_ in ("a", "b")])
        task = models.Task(title="Cross worker", description="", created_by_id="a", assigned_to_id="b", team="General")
        ticket = Ticket(tenant_id=tenant, created_by="a", owner_id="a", title="Cross worker ticket", description="")
        db.add_all([task, ticket])
        db.flush()
        db.add(TicketParticipant(tenant_id=tenant, ticket_id=ticket.id, user_id="b", role=TicketParticipantRoleEnum.ASSIGNEE))
        db.commit()
        ids = dict(conversation=conversation.id, task=task.id, ticket=str(ticket.id))
        if load_proof:
            second = models.Task(title="Owned synthetic task b", description="", created_by_id="a", assigned_to_id="b", team="General")
            db.add(second)
            db.commit()
            ids["second_task"] = second.id
    if load_proof:
        proof = {"runId": "review-" + uuid4().hex, "nonce": uuid4().hex,
                 "accounts": [{"userId": user, "tenantId": str(tenant), "conversationId": ids["conversation"],
                               "taskId": ids["task"] if user == "a" else ids["second_task"], "ticketId": ids["ticket"]}
                              for user in ("a", "b")]}
        proof_file = tmp_path / "load-proof.json"
        proof_file.write_text(json.dumps(proof))
        ids["proof_file"] = str(proof_file)
    ports = [free_port(), free_port()]
    processes, logs = [], []
    env = {**os.environ, "PYTHONPATH": str(ROOT), "VEE_DATABASE_URL": database_url,
           "VEE_REDIS_URL": redis_url, "VEE_CACHE_REDIS_URL": redis_url, "VEE_CACHE_PREFIX": prefix,
           "VEE_JWT_SECRET_KEY": "isolated-realtime-integration-key", "VEE_MEDIA_ROOT": str(tmp_path / "media"),
           "VEE_REALTIME_OUTBOX_ENABLED": "false", "VEE_ENABLE_N8N_FORWARDING": "false", "VEE_BOOTSTRAP_SCHEMA": "false"}
    if load_proof:
        env["ZEAPLAY_RT_LOAD_ISOLATION_FILE"] = str(proof_file)
        env["VEE_WEBSOCKET_TRUSTED_ORIGINS"] = json.dumps([f"http://127.0.0.1:{ports[0]}"])
        env["VEE_WEBSOCKET_REQUIRE_ORIGIN"] = "true"
    try:
        for index, port in enumerate(ports):
            log = (tmp_path / f"worker-{index}.log").open("w")
            logs.append(log)
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.tests.realtime_worker:app", "--host", "127.0.0.1", "--port", str(port), "--no-access-log"], cwd=tmp_path, env=env, stdout=log, stderr=log)
            processes.append(process)
        deadline = time.monotonic() + 25
        for port in ports:
            while True:
                try:
                    state = httpx.get(f"http://127.0.0.1:{port}/health", timeout=1).json()
                    if len(state["subscribers"]) == 3 and all(sub["connected"] for sub in state["subscribers"].values()):
                        break
                except (httpx.HTTPError, KeyError):
                    pass
                if time.monotonic() > deadline:
                    raise AssertionError("Isolated workers did not become ready; inspect worker logs")
                time.sleep(0.1)
        def token(user_id):
            return jwt.encode({"sub": user_id, "user_id": user_id, "tenant_id": str(tenant), "token_type": "access"}, env["VEE_JWT_SECRET_KEY"], algorithm="HS256")
        yield ports, ids, token, broker, prefix, processes, engine
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for log in logs:
            log.close()
        # Remove only this fixture's explicitly namespaced cache keys.
        keys = list(broker.scan_iter(match=prefix + ":*"))
        if keys:
            broker.delete(*keys)
        broker.close()


@pytest.mark.parametrize("feature", ["chat", "task", "ticket"])
def test_two_process_fanout_preserves_browser_contract(workers, feature):
    ports, ids, token, _, _, _, _ = workers
    path = f"chat" if feature == "chat" else "tasks" if feature == "task" else f"tickets/{ids['ticket']}"
    url = lambda index, user: f"ws://127.0.0.1:{ports[index]}/api/ws/{path}?token={token(user)}"
    with connect(url(1, "b")) as receiver:
        if feature != "chat":
            receive(receiver, "realtime:ready")
        if feature == "chat":
            receiver.send(json.dumps({"type": "chat:join", "payload": {"conversation_id": ids["conversation"]}}))
            receive(receiver, "chat:joined")
            response = httpx.post(f"http://127.0.0.1:{ports[0]}/api/chat/conversations/{ids['conversation']}/messages", headers={"Authorization": f"Bearer {token('a')}"}, json={"content": "Across processes", "client_id": "one-send"}, timeout=10)
            assert response.status_code == 201, response.text
            assert receive(receiver, "message:new")["payload"]["message"]["id"] == response.json()["id"]
        elif feature == "task":
            response = httpx.patch(f"http://127.0.0.1:{ports[0]}/api/tasks/{ids['task']}", headers={"Authorization": f"Bearer {token('a')}"}, json={"title": "Updated across workers"}, timeout=10)
            assert response.status_code == 200, response.text
            assert receive(receiver, "task.changed")["task_id"] == ids["task"]
        else:
            with connect(url(0, "a")) as sender:
                receive(sender, "realtime:ready")
                sender.send(json.dumps({"type": "comment", "body": "Across processes"}))
                comment = receive(receiver, "comment")["comment"]
                assert comment["body"] == "Across processes"
                assert receive(sender, "comment")["comment"]["id"] == comment["id"]
            response = httpx.get(f"http://127.0.0.1:{ports[1]}/api/ws/tickets/{ids['ticket']}/snapshot", headers={"Authorization": f"Bearer {token('b')}"})
            assert response.status_code == 200
            assert response.json()["comments"][-1]["id"] == comment["id"]


def test_redis_fanout_rejects_tenant_injection_and_duplicate_envelopes(workers):
    ports, ids, token, broker, prefix, _, _ = workers
    with connect(f"ws://127.0.0.1:{ports[1]}/api/ws/tickets/{ids['ticket']}?token={token('b')}") as receiver:
        receive(receiver, "realtime:ready")
        forged = Event(tenant_id=str(uuid4()), resource_type="ticket", resource_id=ids["ticket"], event_type="ticket.changed")
        broker.publish(prefix + ":ticket:events", forged.encode())
        # Get the trusted tenant from the credential minted by the fixture.
        tenant = jwt.get_unverified_claims(token("b"))["tenant_id"]
        valid = forged.model_copy(update={"event_id": str(uuid4()), "tenant_id": tenant})
        broker.publish(prefix + ":ticket:events", valid.encode())
        broker.publish(prefix + ":ticket:events", valid.encode())
        marker = valid.model_copy(update={"event_id": str(uuid4())})
        broker.publish(prefix + ":ticket:events", marker.encode())
        assert receive(receiver, "ticket.changed")["event_id"] == valid.event_id
        assert receive(receiver, "ticket.changed")["event_id"] == marker.event_id


def test_targeted_subscriber_disconnect_recovers_without_touching_other_redis_users(workers):
    ports, _, _, broker, prefix, processes, _ = workers
    # Windows venv launchers may have a different PID from the Python worker.
    # The random fixture prefix remains the ownership boundary, not a guessed PID.
    clients = [item for item in broker.client_list() if item.get("name", "").startswith(prefix + ":rt:") and "P" in item.get("flags", "")]
    assert len(clients) == 6
    assert len({item["name"] for item in clients}) == 2
    for item in clients:
        broker.client_kill_filter(_id=item["id"])
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        states = [httpx.get(f"http://127.0.0.1:{port}/health").json() for port in ports]
        if all(state["metrics"].get("subscriber_errors", 0) > 0 and all(sub["connected"] for sub in state["subscribers"].values()) for state in states):
            return
        time.sleep(0.1)
    raise AssertionError("Subscribers did not recover after losing their Redis connections")


def test_worker_restart_and_missed_ticket_state_recovery(workers, tmp_path):
    ports, ids, token, _, prefix, processes, engine = workers
    url = lambda index, user: f"ws://127.0.0.1:{ports[index]}/api/ws/tickets/{ids['ticket']}?token={token(user)}"
    with connect(url(1, "b")) as old_receiver:
        receive(old_receiver, "realtime:ready")
        processes[1].terminate()
        processes[1].wait(timeout=8)
        with pytest.raises(ConnectionClosed):
            old_receiver.recv(timeout=5)
    with connect(url(0, "a")) as sender:
        receive(sender, "realtime:ready")
        sender.send(json.dumps({"type": "comment", "body": "Persisted while receiver worker was down"}))
        comment_id = receive(sender, "comment")["comment"]["id"]
    env = {**os.environ, "PYTHONPATH": str(ROOT), "VEE_DATABASE_URL": engine.url.render_as_string(hide_password=False),
           "VEE_REDIS_URL": os.environ["ZEAPLAY_RT_REDIS_TEST_URL"], "VEE_CACHE_PREFIX": prefix,
           "VEE_JWT_SECRET_KEY": "isolated-realtime-integration-key", "VEE_MEDIA_ROOT": str(tmp_path / "media"),
           "VEE_REALTIME_OUTBOX_ENABLED": "false", "VEE_ENABLE_N8N_FORWARDING": "false", "VEE_BOOTSTRAP_SCHEMA": "false"}
    processes[1] = subprocess.Popen(processes[1].args, cwd=tmp_path, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            state = httpx.get(f"http://127.0.0.1:{ports[1]}/health").json()
            if len(state["subscribers"]) == 3 and all(sub["connected"] for sub in state["subscribers"].values()):
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    else:
        pytest.fail("Replacement worker did not become ready")
    with connect(url(1, "b")):
        response = httpx.get(f"http://127.0.0.1:{ports[1]}/api/ws/tickets/{ids['ticket']}/snapshot", headers={"Authorization": f"Bearer {token('b')}"})
        assert response.status_code == 200
        assert comment_id in {row["id"] for row in response.json()["comments"]}


def test_multiple_devices_for_one_user_receive_the_same_ticket_comment(workers):
    ports, ids, token, _, _, _, _ = workers
    url = lambda index, user: f"ws://127.0.0.1:{ports[index]}/api/ws/tickets/{ids['ticket']}?token={token(user)}"
    with connect(url(0, "b")) as first, connect(url(1, "b")) as second, connect(url(0, "a")) as sender:
        for socket in (first, second, sender):
            receive(socket, "realtime:ready")
        sender.send(json.dumps({"type": "comment", "body": "Delivered to both devices"}))
        one, two = receive(first, "comment"), receive(second, "comment")
        assert one["comment"]["id"] == two["comment"]["id"]


@pytest.fixture
def managed_redis(monkeypatch, tmp_path):
    command = os.environ.get("ZEAPLAY_RT_REDIS_SERVER_ARGV")
    if not command:
        pytest.skip("Requires explicit Redis server argv to start an owned, restartable test instance")
    argv = json.loads(command)
    assert isinstance(argv, list) and argv and all(isinstance(item, str) and item for item in argv)
    port = free_port()
    broker = redis.Redis(host="127.0.0.1", port=port, socket_timeout=2, socket_connect_timeout=2, retry=Retry(NoBackoff(), 0))
    process, run_id = None, None
    def start():
        nonlocal process, run_id
        process = subprocess.Popen([*argv, "--bind", "127.0.0.1", "--port", str(port), "--save", "", "--appendonly", "no"],
                                   cwd=tmp_path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                run_id = broker.info("server")["run_id"]
                return
            except redis.RedisError:
                if process.poll() is not None:
                    pytest.fail("Owned Redis process exited before becoming ready")
                time.sleep(0.1)
        pytest.fail("Owned Redis did not become ready")
    def stop():
        if process is None or process.poll() is not None:
            return
        assert broker.info("server")["run_id"] == run_id, "Refusing to stop an unrecognized Redis instance"
        broker.shutdown(nosave=True)
        process.wait(timeout=10)
    def restart():
        previous = run_id
        stop()
        start()
        assert run_id != previous
    try:
        start()
        monkeypatch.setenv("ZEAPLAY_RT_REDIS_TEST_URL", f"redis://127.0.0.1:{port}/15")
        yield restart
    finally:
        stop()
        broker.close()


def test_owned_redis_server_restart_recovers_both_workers(managed_redis, request):
    workers = request.getfixturevalue("workers")
    ports, ids, token, _, _, _, _ = workers
    url = lambda index, user: f"ws://127.0.0.1:{ports[index]}/api/ws/tickets/{ids['ticket']}?token={token(user)}"
    with connect(url(1, "b")) as old_receiver:
        receive(old_receiver, "realtime:ready")
        managed_redis()
        with pytest.raises(ConnectionClosed):
            old_receiver.recv(timeout=10)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        states = [httpx.get(f"http://127.0.0.1:{port}/health").json() for port in ports]
        if all(all(sub["connected"] and sub["alive"] for sub in state["subscribers"].values()) for state in states):
            break
        time.sleep(0.1)
    else:
        pytest.fail("Workers did not recover after a full Redis restart")
    with connect(url(1, "b")) as receiver, connect(url(0, "a")) as sender:
        receive(receiver, "realtime:ready")
        receive(sender, "realtime:ready")
        sender.send(json.dumps({"type": "comment", "body": "Persisted and delivered after Redis restart"}))
        assert receive(receiver, "comment")["comment"]["id"] == receive(sender, "comment")["comment"]["id"]
