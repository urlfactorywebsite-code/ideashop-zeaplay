"""Synthetic tenant data and a loopback SMTP server only; never external mail."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
import base64
import hashlib
import ipaddress
import socket
import socketserver
import ssl
import threading
from types import SimpleNamespace
from uuid import uuid4

from cryptography.fernet import Fernet
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select

from backend.app import email_utils, models
from backend.app.auth import create_access_token
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.routers import smtp as smtp_router
from backend.app.services import audit_logger, notification_outbox as outbox, smtp_management as service, smtp_security as security
from backend.tests.test_task_lifecycle import data, engine


@pytest.fixture
def settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, 'smtp_secret_keys', [Fernet.generate_key().decode()])
    monkeypatch.setattr(settings, 'smtp_private_host_allowlist', [])
    monkeypatch.setattr(settings, 'smtp_plaintext_host_allowlist', [])
    monkeypatch.setattr(settings, 'smtp_delivery_enabled', True)
    monkeypatch.setattr(settings, 'smtp_ca_file', None)
    monkeypatch.setattr(audit_logger, 'log_event', lambda *_: None)
    return settings


@pytest.fixture
def api(data, settings, monkeypatch):
    original_dns = socket.getaddrinfo
    def dns(host, port, **kwargs):
        if host.endswith('.example.com'):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', port))]
        return original_dns(host, port, **kwargs)
    monkeypatch.setattr(security.socket, 'getaddrinfo', dns)
    sent = []
    monkeypatch.setattr(email_utils, '_send_email_with_config', lambda **kwargs: sent.append(kwargs))
    monkeypatch.setattr(smtp_router, 'transport', lambda *_: None)
    app = FastAPI()
    app.include_router(smtp_router.router, prefix='/api/config')
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    client = TestClient(app)
    client.sent = sent
    client.owner = data.owner
    client.headers.update(auth(data.owner))
    with client:
        yield client


def auth(user):
    return {'Authorization': 'Bearer ' + create_access_token(user.id, extra_claims={'tenant_id': str(user.tenant_id)})}


def profile(api, **changes):
    payload = dict(name='Synthetic SMTP', host='smtp.example.com', port=587, username='sender@example.com',
                   password='synthetic-test-credential', notification_types=['notifications'])
    payload.update(changes)
    response = api.post('/api/config/smtp/multiple', json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_edit_blank_password_replace_and_no_secret_response(data, api):
    result = profile(api)
    assert 'password' not in result and result['has_password'] and result['secret_encrypted']
    with data.factory() as db:
        stored = db.get(models.MultipleSmtpConfig, result['id']).password
        assert stored.startswith(security.PREFIX) and 'synthetic-test-credential' not in stored
        assert security.decrypt_secret(stored) == 'synthetic-test-credential'
    response = api.patch('/api/config/smtp/multiple/' + result['id'], json={'name': 'Edited', 'password': ''})
    assert response.status_code == 200
    with data.factory() as db:
        assert db.get(models.MultipleSmtpConfig, result['id']).password == stored
    response = api.patch('/api/config/smtp/multiple/' + result['id'], json={'password': 'replacement-synthetic'})
    assert response.status_code == 200
    assert 'replacement-synthetic' not in response.text and security.PREFIX not in response.text
    with data.factory() as db:
        assert security.decrypt_secret(db.get(models.MultipleSmtpConfig, result['id']).password) == 'replacement-synthetic'
    assert api.post('/api/config/smtp/multiple', json=dict(name='Edited', host='smtp.example.com', port=587, username='sender@example.com', password='new')).status_code == 409


@pytest.mark.parametrize('changes', [{'host': 'http://169.254.169.254'}, {'host': '127.0.0.1'}, {'port': 0}, {'port': 65536},
                                  {'encryption': 'none'}, {'sender_name': 'Bad\r\nBcc: other@example.com'}, {'notification_types': ['unknown']}, {'is_enabled': None}])
def test_invalid_settings_and_validation_errors_never_echo_credentials(api, changes):
    payload = dict(name='Invalid', host='smtp.example.com', port=587, username='sender@example.com', password='do-not-echo-this-credential')
    response = api.post('/api/config/smtp/multiple', json={**payload, **changes})
    assert response.status_code in {400, 422}, response.text
    assert 'do-not-echo-this-credential' not in response.text


def test_tenant_and_role_boundaries(data, api):
    row = profile(api)
    for method, path, payload in [('get', '/multiple', None), ('patch', '/multiple/' + row['id'], {'priority': 1}),
                                 ('post', '/multiple/' + row['id'] + '/connection', None), ('post', '/multiple/' + row['id'] + '/test', {'to_address': 'synthetic@example.com'})]:
        response = getattr(api, method)('/api/config/smtp' + path, headers=auth(data.outsider), **({'json': payload} if payload else {}))
        assert response.status_code == (200 if path == '/multiple' else 404)
        if path == '/multiple': assert response.json() == []
    with data.factory() as db:
        manager = models.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name='Synthetic manager', email='manager@example.com',
                              hashed_password='not-a-login', role=models.RoleEnum.MANAGER, status=models.UserStatusEnum.ACTIVE)
        db.add(manager); db.commit()
        manager_auth = auth(manager)
    assert api.get('/api/config/smtp/multiple', headers=manager_auth).status_code == 403
    assert api.get('/api/config/smtp/multiple', headers={'Authorization': ''}).status_code == 401
    assert api.get('/api/config/smtp/health', headers=auth(data.outsider)).json()['profiles'] == 0


def test_connection_health_is_real_fresh_and_separate_from_delivery(data, api, monkeypatch):
    row = profile(api)
    assert row['health'] == 'untested'
    assert api.post('/api/config/smtp/multiple/' + row['id'] + '/connection').status_code == 200
    assert api.get('/api/config/smtp/multiple').json()[0]['health'] == 'healthy'
    def fail(*_): raise security.SmtpError('authentication_failed')
    monkeypatch.setattr(smtp_router, 'transport', fail)
    response = api.post('/api/config/smtp/multiple/' + row['id'] + '/connection')
    assert response.status_code == 400 and response.json()['detail']['code'] == 'authentication_failed'
    health = api.get('/api/config/smtp/health').json()
    assert health['healthy_profiles'] == 0 and health['failed_attempts'] == 0
    with data.factory() as db:
        stored = db.get(models.MultipleSmtpConfig, row['id'])
        stored.last_test_at = datetime.now(timezone.utc) - timedelta(hours=2); db.commit()
    assert api.get('/api/config/smtp/multiple').json()[0]['health'] == 'untested'
    assert api.patch('/api/config/smtp/multiple/' + row['id'], json={'is_enabled': False}).json()['health'] == 'disabled'


def test_explicit_test_recipient_and_honest_acceptance_metrics(api):
    row = profile(api)
    url = '/api/config/smtp/multiple/' + row['id'] + '/test'
    assert api.post(url, json={}).status_code == 422
    assert api.sent == []
    assert api.post(url, json={'to_address': 'synthetic@example.com'}).json()['status'] == 'smtp_accepted'
    metrics = api.get('/api/config/smtp/health').json()
    assert metrics['smtp_accepted'] == 1 and metrics['success_percentage'] == 100
    assert api.get('/api/config/smtp/attempts').json()['items'][0]['outcome'] == 'accepted'


def test_connection_revision_and_admin_permissions(data, api, monkeypatch):
    row = profile(api)
    def concurrently_edit(_):
        with data.factory() as db:
            stored = db.get(models.MultipleSmtpConfig, row['id'])
            stored.updated_at = datetime.now(timezone.utc) + timedelta(seconds=1)
            stored.priority = 4
            db.commit()
    monkeypatch.setattr(smtp_router, 'transport', concurrently_edit)
    response = api.post('/api/config/smtp/multiple/' + row['id'] + '/connection')
    assert response.status_code == 409
    assert api.get('/api/config/smtp/multiple').json()[0]['health'] == 'untested'
    with data.factory() as db:
        user = db.get(models.User, data.owner.id)
        user.role = models.RoleEnum.ADMIN
        db.commit()
    assert api.get('/api/config/smtp/multiple').status_code == 200


def test_ticket_event_mail_is_durable_tenant_scoped_and_uses_the_existing_queue(data, settings, monkeypatch):
    from backend.app.events import bus
    from backend.app.tickets.models import Ticket, TicketStatusEnum, TicketPriorityEnum
    monkeypatch.setattr(bus.webhook_service, 'queue_event', lambda *_args, **_kwargs: [])
    with data.factory() as db:
        ticket = Ticket(id=uuid4(), tenant_id=data.owner.tenant_id, title='Synthetic SMTP ticket', description='Synthetic test only',
                        created_by=data.owner.id, owner_id=data.owner.id,
                        status=TicketStatusEnum.OPEN, priority=TicketPriorityEnum.MEDIUM)
        db.add(ticket); db.commit()
        bus.emit_ticket_event(db, event_type='ticket.created', tenant_id=data.owner.tenant_id, ticket=ticket,
            actor_id=None, recipient_ids=[data.owner.id, data.outsider.id], include_participants=False)
    with data.factory() as db:
        jobs = list(db.scalars(select(models.NotificationOutbox)))
        assert len(jobs) == 1 and jobs[0].tenant_id == data.owner.tenant_id
        assert jobs[0].recipient_user_id == data.owner.id and jobs[0].payload['notification_type'] == 'task_updates'
        assert 'Synthetic SMTP ticket' in jobs[0].payload['subject']


def test_category_priority_disabled_exclusion_fallback_and_otp_isolation(data, api, monkeypatch):
    disabled = profile(api, name='Disabled', priority=0, is_enabled=False)
    first = profile(api, name='First', priority=1)
    second = profile(api, name='Second', priority=2)
    profile(api, name='General', priority=0, notification_types=['general'])
    attempts = []
    def transport(**kwargs):
        attempts.append(kwargs['smtp_config'].id)
        if kwargs['smtp_config'].id == first['id']:
            raise security.SmtpError('authentication_failed')
    monkeypatch.setattr(email_utils, '_send_email_with_config', transport)
    with data.factory() as db:
        service.deliver(db, tenant_id=data.owner.tenant_id, category='notifications', recipient='synthetic@example.com', subject='Synthetic', body='Synthetic')
        assert attempts == [first['id'], second['id']] and disabled['id'] not in attempts
        with pytest.raises(security.SmtpError):
            service.deliver(db, tenant_id=data.owner.tenant_id, category='otp', recipient='synthetic@example.com', subject='Synthetic', body='Synthetic')
        assert service.candidates(db, data.outsider.tenant_id, 'notifications') == []


def test_quota_reservations_are_atomic_and_daily_limits_apply(data, api):
    row = profile(api, rate_limit_per_minute=1, daily_limit=1)
    def attempt(_):
        with data.factory() as db:
            current = db.get(models.MultipleSmtpConfig, row['id'])
            try: service.reserve(db, current, category='notifications'); return 'reserved'
            except security.SmtpError as error: return error.code
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert results.count('reserved') == 1 and results.count('rate_limited') == 3
    with data.factory() as db:
        record = db.scalar(select(models.SmtpDeliveryAttempt))
        record.started_at = datetime.now(timezone.utc) - timedelta(minutes=2); db.commit()
    assert attempt(0) == 'rate_limited'


def enqueue(data):
    with data.factory() as db:
        row = outbox.enqueue_email(db, tenant_id=data.owner.tenant_id, recipient_user_id=data.owner.id,
            event_type='notifications', event_id='synthetic-event', dedupe_key='synthetic-event', subject='Synthetic', body='Synthetic')
        same = outbox.enqueue_email(db, tenant_id=data.owner.tenant_id, recipient_user_id=data.owner.id,
            event_type='notifications', event_id='synthetic-event', dedupe_key='synthetic-event', subject='Synthetic', body='Synthetic')
        assert row.id == same.id
        db.commit(); return row.id


@pytest.mark.parametrize('error,expected', [(None, 'sent'), ('temporary_failure', 'retrying'), ('recipient_rejected', 'failed'), ('acceptance_unknown', 'uncertain')])
def test_worker_lifecycle_backoff_and_terminal_states(data, api, monkeypatch, error, expected):
    profile(api)
    job_id = enqueue(data)
    def send(**_):
        if error: raise security.SmtpError(error, retryable=error == 'temporary_failure', uncertain=error == 'acceptance_unknown')
    monkeypatch.setattr(email_utils, '_send_email_with_config', send)
    with data.factory() as db:
        assert outbox._attempt_email_delivery(db, job_id) == 1
        job = db.get(models.NotificationOutbox, job_id, populate_existing=True)
        assert job.delivery_state == expected and job.attempts == 1
        if expected == 'retrying': assert job.next_attempt_at is not None
        else: assert job.next_attempt_at is None
        assert outbox._attempt_email_delivery(db, job_id) == 0


def test_concurrent_workers_claim_once_and_stale_acceptance_is_held(data, api):
    profile(api)
    job_id = enqueue(data)
    def work(_):
        with data.factory() as db: return outbox._attempt_email_delivery(db, job_id)
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert sum(pool.map(work, range(3))) == 1
    assert len(api.sent) == 1
    with data.factory() as db:
        job = db.get(models.NotificationOutbox, job_id)
        job.status = models.NotificationOutboxStatusEnum.SENDING; job.delivery_state = 'sending'
        job.updated_at = datetime.now(timezone.utc) - timedelta(seconds=601); db.commit()
        outbox._recover_stale_sending(db, now=datetime.now(timezone.utc)); db.commit()
        assert db.get(models.NotificationOutbox, job_id, populate_existing=True).delivery_state == 'uncertain'
        assert outbox._attempt_email_delivery(db, job_id) == 0


def test_retry_is_tenant_scoped_due_only_and_does_not_reset_limits(data, api):
    job_id = enqueue(data)
    with data.factory() as db:
        job = db.get(models.NotificationOutbox, job_id)
        job.status = models.NotificationOutboxStatusEnum.FAILED; job.delivery_state = 'retrying'; job.attempts = 1
        job.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=2); db.commit()
    url = '/api/config/smtp/queue/retry'
    assert api.post(url, json={'ids': [job_id]}).json()['selected'] == 0
    with data.factory() as db:
        db.get(models.NotificationOutbox, job_id).next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    assert api.post(url, headers=auth(data.outsider), json={'ids': [job_id]}).json()['selected'] == 0
    assert api.post(url, json={'ids': [job_id]}).json()['selected'] == 1
    assert api.post(url, json={'ids': [job_id]}).json()['selected'] == 0
    with data.factory() as db: assert db.get(models.NotificationOutbox, job_id).attempts == 1


def test_acceptance_record_failure_is_held_and_not_resent(data, api, monkeypatch):
    profile(api)
    job_id = enqueue(data)
    def failed_commit(*_args, **_kwargs): raise RuntimeError('Synthetic ledger failure')
    monkeypatch.setattr(service, 'finish', failed_commit)
    with data.factory() as db:
        assert outbox._attempt_email_delivery(db, job_id) == 1
        assert db.get(models.NotificationOutbox, job_id, populate_existing=True).delivery_state == 'uncertain'
        assert outbox._attempt_email_delivery(db, job_id) == 0
    assert len(api.sent) == 1


def test_legacy_adoption_is_explicit_disabled_and_encrypted(data, settings, monkeypatch, capsys):
    from backend.app import database
    from backend.app.services import smtp_admin
    import sys
    with data.factory() as db:
        row = models.MultipleSmtpConfig(name='Legacy synthetic', host='smtp.example.com', port=587, username='sender@example.com', password='synthetic-legacy', notification_types=['welcome_password'])
        db.add(row); db.commit(); identifier = row.id
    monkeypatch.setattr(database, 'SessionLocal', data.factory)
    monkeypatch.setattr(sys, 'argv', ['smtp_admin', 'adopt', '--tenant', str(data.owner.tenant_id), '--profile-id', identifier, '--apply'])
    smtp_admin.main()
    with data.factory() as db:
        row = db.get(models.MultipleSmtpConfig, identifier)
        assert row.tenant_id == data.owner.tenant_id and not row.is_enabled
        assert security.decrypt_secret(row.password) == 'synthetic-legacy'
        assert row.notification_types == ['welcome']
        event = db.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == 'smtp.operator_adopted'))
        assert event and event.payload['tenant_id'] == str(data.owner.tenant_id)
        assert 'synthetic-legacy' not in str(event.payload)
    assert 'synthetic-legacy' not in capsys.readouterr().out


def test_operator_rotation_dry_run_then_apply_is_audited(data, api, settings, monkeypatch, capsys):
    from backend.app import database
    from backend.app.services import smtp_admin
    import sys
    row = profile(api)
    with data.factory() as db:
        original = db.get(models.MultipleSmtpConfig, row['id']).password
    settings.smtp_secret_keys = [Fernet.generate_key().decode(), *settings.smtp_secret_keys]
    monkeypatch.setattr(database, 'SessionLocal', data.factory)
    args = ['smtp_admin', 'rotate', '--tenant', str(data.owner.tenant_id)]
    monkeypatch.setattr(sys, 'argv', args)
    smtp_admin.main()
    with data.factory() as db:
        assert db.get(models.MultipleSmtpConfig, row['id']).password == original
    monkeypatch.setattr(sys, 'argv', [*args, '--apply'])
    smtp_admin.main()
    settings.smtp_secret_keys = settings.smtp_secret_keys[:1]
    with data.factory() as db:
        assert security.decrypt_secret(db.get(models.MultipleSmtpConfig, row['id']).password) == 'synthetic-test-credential'
        event = db.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == 'smtp.operator_rotated'))
        assert event and event.payload['rotated_profiles'] == 1
    assert 'synthetic-test-credential' not in capsys.readouterr().out


def test_key_rotation_reads_old_key_and_reencrypts_without_plaintext(settings):
    old = settings.smtp_secret_keys[0]
    encrypted = security.encrypt_secret('synthetic')
    settings.smtp_secret_keys = [Fernet.generate_key().decode(), old]
    assert security.decrypt_secret(encrypted) == 'synthetic'
    rotated = security.rotate_secret(encrypted)
    settings.smtp_secret_keys = settings.smtp_secret_keys[:1]
    assert security.decrypt_secret(rotated) == 'synthetic'
    with pytest.raises(security.SmtpError): security.decrypt_secret(encrypted)
    assert settings.smtp_secret_keys[0] not in repr(settings)


def test_invalid_ca_file_fails_safely(settings, tmp_path):
    settings.smtp_ca_file = str(tmp_path / 'missing-synthetic-ca.pem')
    with pytest.raises(security.SmtpError) as failure:
        security.tls_context()
    assert failure.value.code == 'tls_failure'


@pytest.mark.parametrize('address', ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fe80::1', '0.0.0.0',
                                   '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '::7f00:1', '2002:7f00:1::'])
def test_ssrf_rejects_nonpublic_and_mapped_addresses(settings, monkeypatch, address):
    family = socket.AF_INET6 if ':' in address else socket.AF_INET
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: [(family, socket.SOCK_STREAM, 6, '', (address, 587))])
    with pytest.raises(security.SmtpError, match='blocked'): security.resolve_destination('smtp.example.com', 587)


def test_mixed_dns_and_rebinding_cannot_change_the_socket_destination(settings, monkeypatch):
    calls, connected = [], []
    def dns(*_args, **_kwargs):
        calls.append(1)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8' if len(calls) == 1 else '169.254.169.254', 587))]
    class BlockedSocket:
        def settimeout(self, _): pass
        def connect(self, address): connected.append(address); raise ConnectionRefusedError()
        def close(self): pass
    monkeypatch.setattr(socket, 'getaddrinfo', dns)
    monkeypatch.setattr(socket, 'getfqdn', lambda: 'synthetic.example.com')
    monkeypatch.setattr(socket, 'socket', lambda *_: BlockedSocket())
    config = SimpleNamespace(host='smtp.example.com', port=587, encryption='tls', username='sender@example.com', password=security.encrypt_secret('synthetic'))
    with pytest.raises(security.SmtpError) as failure: security.transport(config)
    assert failure.value.code == 'connection_rejected'
    assert len(calls) == 1 and connected == [('8.8.8.8', 587)]
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (value, 587)) for value in ['8.8.8.8', '127.0.0.1']])
    with pytest.raises(security.SmtpError, match='blocked'): security.resolve_destination('smtp.example.com', 587)


@pytest.mark.parametrize('exception,code', [(TimeoutError, 'timeout'), (ConnectionRefusedError, 'connection_rejected')])
def test_connection_timeout_and_unavailable_server_are_safe(settings, monkeypatch, exception, code):
    class UnavailableSocket:
        def settimeout(self, _): pass
        def connect(self, _): raise exception('synthetic provider secret must not escape')
        def close(self): pass
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 587))])
    monkeypatch.setattr(socket, 'getfqdn', lambda: 'synthetic.example.com')
    monkeypatch.setattr(socket, 'socket', lambda *_: UnavailableSocket())
    config = SimpleNamespace(host='smtp.example.com', port=587, encryption='tls', username='sender@example.com', password=security.encrypt_secret('synthetic'))
    with pytest.raises(security.SmtpError) as failure: security.transport(config)
    assert failure.value.code == code and 'secret' not in str(failure.value)


class ControlledSMTP(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    def __init__(self, *, implicit=False, context=None, mode='ok'):
        self.context = context; self.implicit = implicit; self.mode = mode; self.messages = []; self.connections = 0
        super().__init__(('127.0.0.1', 0), SMTPHandler)
    def get_request(self):
        sock, addr = super().get_request()
        self.connections += 1
        if self.implicit: sock = self.context.wrap_socket(sock, server_side=True)
        return sock, addr


class SMTPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'220 controlled.example SMTP\r\n'); self.wfile.flush()
        while line := self.rfile.readline():
            command = line.decode(errors='replace').strip().upper()
            if command.startswith('EHLO'):
                self.wfile.write(b'550 Rejected\r\n' if self.server.mode == 'ehlo' else b'250-controlled\r\n250 STARTTLS\r\n' if self.server.mode == 'noauth' else b'250-controlled\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n')
            elif command == 'STARTTLS':
                self.wfile.write(b'220 Ready\r\n'); self.wfile.flush()
                self.connection = self.server.context.wrap_socket(self.connection, server_side=True)
                self.rfile = self.connection.makefile('rb'); self.wfile = self.connection.makefile('wb')
            elif command.startswith('AUTH'):
                self.wfile.write(b'535 synthetic credential echo forbidden\r\n' if self.server.mode == 'auth' else b'235 OK\r\n')
            elif command.startswith('RCPT') and self.server.mode == 'recipient': self.wfile.write(b'550 Rejected\r\n')
            elif command.startswith('MAIL') and self.server.mode == 'sender': self.wfile.write(b'550 Rejected\r\n')
            elif command == 'DATA':
                self.wfile.write(b'354 Go\r\n'); self.wfile.flush(); body = bytearray()
                while (part := self.rfile.readline()) not in (b'.\r\n', b''):
                    body.extend(part)
                self.server.messages.append(bytes(body))
                if self.server.mode == 'unknown': return
                self.wfile.write(b'250 Accepted\r\n')
            elif command == 'QUIT': self.wfile.write(b'221 Bye\r\n'); self.wfile.flush(); return
            else: self.wfile.write(b'250 OK\r\n')
            self.wfile.flush()


@pytest.fixture
def tls_files(tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Synthetic SMTP')])
    cert = x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
    cert = cert.not_valid_before(datetime.now(timezone.utc) - timedelta(days=1)).not_valid_after(datetime.now(timezone.utc) + timedelta(days=2))
    cert = cert.add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
    certificate = tmp_path / 'synthetic-ca.pem'; private = tmp_path / 'synthetic-key.pem'
    certificate.write_bytes(cert.sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM))
    private.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(certificate, private)
    return str(certificate), context


@pytest.mark.parametrize('mode,expected', [('ok', None), ('auth', 'authentication_failed'), ('recipient', 'recipient_rejected'),
                                        ('unknown', 'acceptance_unknown'), ('ehlo', 'connection_rejected'), ('sender', 'sender_rejected'),
                                        ('noauth', 'authentication_failed')])
@pytest.mark.parametrize('implicit', [False, True])
def test_real_controlled_smtp_tls_auth_explicit_message_and_uncertainty(settings, tls_files, mode, expected, implicit):
    certificate, context = tls_files
    server = ControlledSMTP(implicit=implicit, context=context, mode=mode)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    port = server.server_address[1]
    settings.smtp_private_host_allowlist = [f'127.0.0.1:{port}']; settings.smtp_ca_file = certificate
    config = SimpleNamespace(host='127.0.0.1', port=port, encryption='ssl' if implicit else 'tls', username='sender@example.com',
        password=security.encrypt_secret('synthetic'), auth_method='password', sender_name='Synthetic Sender', sender_email='sender@example.com', reply_to='reply@example.com')
    try:
        if expected:
            with pytest.raises(security.SmtpError) as failure:
                security.transport(config, recipient='synthetic@example.com', subject='Synthetic', body='Synthetic', message_id='<synthetic@example.com>')
            assert failure.value.code == expected and 'credential echo' not in str(failure.value)
        else:
            security.transport(config)
            assert server.messages == []  # Connection tests must not send mail.
            security.transport(config, recipient='synthetic@example.com', subject='Synthetic', body='Synthetic', message_id='<synthetic@example.com>')
            assert len(server.messages) == 1
            message = message_from_bytes(server.messages[0]); assert message['Reply-To'] == 'reply@example.com'
            assert message['Message-ID'] == '<synthetic@example.com>'
    finally: server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_untrusted_tls_certificate_is_rejected(settings, tls_files):
    _, context = tls_files
    server = ControlledSMTP(implicit=False, context=context)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    port = server.server_address[1]; settings.smtp_private_host_allowlist = [f'127.0.0.1:{port}']
    config = SimpleNamespace(host='127.0.0.1', port=port, encryption='tls', username='sender@example.com', password=security.encrypt_secret('synthetic'))
    try:
        with pytest.raises(security.SmtpError) as failure: security.transport(config)
        assert failure.value.code == 'tls_failure'
    finally: server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_management_api_sends_only_explicit_mail_through_real_controlled_tls_server(api, settings, tls_files, monkeypatch):
    certificate, context = tls_files
    server = ControlledSMTP(context=context)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    port = server.server_address[1]
    settings.smtp_private_host_allowlist = [f'127.0.0.1:{port}']; settings.smtp_ca_file = certificate
    monkeypatch.setattr(smtp_router, 'transport', security.transport)
    monkeypatch.setattr(email_utils, '_send_email_with_config', lambda **kwargs: security.transport(
        kwargs['smtp_config'], recipient=kwargs['to_address'], subject=kwargs['subject'], body=kwargs['body'], message_id=kwargs.get('message_id')))
    try:
        row = profile(api, host='127.0.0.1', port=port)
        assert server.messages == []
        assert api.post('/api/config/smtp/multiple/' + row['id'] + '/connection').status_code == 200
        assert server.messages == []
        response = api.post('/api/config/smtp/multiple/' + row['id'] + '/test', json={'to_address': 'explicit@example.com'})
        assert response.status_code == 202 and response.json()['status'] == 'smtp_accepted'
        assert len(server.messages) == 1
        assert message_from_bytes(server.messages[0])['To'] == 'explicit@example.com'
        health = api.get('/api/config/smtp/health').json()
        assert health['smtp_accepted'] == 1 and health['healthy_profiles'] == 1
        attempts = api.get('/api/config/smtp/attempts').json()['items']
        assert {row['outcome'] for row in attempts} == {'connected', 'accepted'}
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
