"""Regression evidence for SMTP refinement; only synthetic tenants and local transport."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from jose import jwt
import pytest
from sqlalchemy import select

from backend.app import email_utils, models
from backend.app.config import get_settings
from backend.app.services import notification_outbox as outbox, smtp_management as service, smtp_security as security
from backend.tests.test_smtp_management import api, auth, data, engine, enqueue, profile, settings


def test_saved_secrets_never_appear_in_any_profile_response(data, api):
    row = profile(api)
    with data.factory() as db:
        encrypted = db.get(models.MultipleSmtpConfig, row['id']).password
    responses = [api.get('/api/config/smtp'), api.get('/api/config/smtp/multiple'),
                 api.get('/api/config/smtp/multiple/' + row['id']),
                 api.patch('/api/config/smtp/multiple/' + row['id'], json={'priority': 4}),
                 api.get('/api/config/smtp/attempts'), api.get('/api/config/smtp/queue')]
    for response in responses:
        assert response.status_code == 200
        assert 'synthetic-test-credential' not in response.text and encrypted not in response.text
        assert response.headers['cache-control'] == 'no-store'
    result = api.patch('/api/config/smtp', json={'host': 'smtp.example.com', 'username': 'sender@example.com',
        'password': 'synthetic-primary', 'is_enabled': True, 'notification_types': ['otp']})
    assert result.status_code == 200 and 'password' not in result.json()
    assert 'synthetic-primary' not in api.get('/api/config/smtp').text


@pytest.mark.parametrize('identity', ['user', 'inactive', 'wrong_tenant', 'refresh'])
def test_all_smtp_operations_reject_unauthorized_identities(data, api, identity):
    row = profile(api)
    config = get_settings()
    claims = {'sub': data.owner.id, 'tenant_id': str(data.owner.tenant_id), 'token_type': 'access'}
    with data.factory() as db:
        if identity == 'user':
            db.get(models.User, data.owner.id).role = models.RoleEnum.USER
            claims['roles'] = ['OWNER']  # Signed role claims cannot override database permissions.
        elif identity == 'inactive':
            db.get(models.User, data.owner.id).status = models.UserStatusEnum.DEACTIVATED
        elif identity == 'wrong_tenant':
            claims['tenant_id'] = str(data.outsider.tenant_id)
        else:
            claims['token_type'] = 'refresh'
        db.commit()
    headers = {'Authorization': 'Bearer ' + jwt.encode(claims, config.jwt_secret_key, algorithm=config.jwt_algorithm)}
    root = '/api/config/smtp'
    calls = [('GET', root, None), ('GET', root + '/multiple', None), ('GET', root + '/health', None),
             ('GET', root + '/queue', None), ('GET', root + '/attempts', None),
             ('PATCH', root + '/multiple/' + row['id'], {'is_enabled': False}),
             ('DELETE', root + '/multiple/' + row['id'], None),
             ('POST', root + '/multiple/' + row['id'] + '/connection', None),
             ('POST', root + '/multiple/' + row['id'] + '/test', {'to_address': 'synthetic@example.com'}),
             ('POST', root + '/queue/retry', {'ids': ['synthetic']})]
    for method, path, payload in calls:
        response = api.request(method, path, headers=headers, **({'json': payload} if payload else {}))
        assert response.status_code in {401, 403}, (method, path, response.status_code)
    assert api.sent == []


def test_emergency_disable_survives_dns_key_and_policy_revocation(api, settings, monkeypatch):
    settings.smtp_private_host_allowlist = ['smtp.example.com:587']
    settings.smtp_plaintext_host_allowlist = ['smtp.example.com:587']
    row = profile(api, auth_method='none', encryption='none')
    settings.smtp_secret_keys = []
    settings.smtp_private_host_allowlist = settings.smtp_plaintext_host_allowlist = []
    from backend.app.routers import smtp
    def unavailable(*_):
        raise security.SmtpError('dns_failure', retryable=True)
    monkeypatch.setattr(smtp, 'resolve_destination', unavailable)
    response = api.patch('/api/config/smtp/multiple/' + row['id'], json={'is_enabled': False})
    assert response.status_code == 200 and response.json()['health'] == 'disabled'
    assert api.patch('/api/config/smtp/multiple/' + row['id'], json={'is_enabled': True}).status_code == 422


def test_connection_throttling_preserves_real_health_result(api):
    row = profile(api, rate_limit_per_minute=1)
    endpoint = '/api/config/smtp/multiple/' + row['id'] + '/connection'
    assert api.post(endpoint).status_code == 200
    first = api.get('/api/config/smtp/multiple/' + row['id']).json()
    assert api.post(endpoint).status_code == 429
    second = api.get('/api/config/smtp/multiple/' + row['id']).json()
    assert second['health'] == 'healthy' and second['last_test_at'] == first['last_test_at']
    assert second['last_test_code'] == first['last_test_code'] == 'authenticated'


def test_category_removal_is_rechecked_before_reservation(data, api):
    row = profile(api, notification_types=['otp'])
    with data.factory() as db:
        stale = service.candidates(db, data.owner.tenant_id, 'otp')[0]
        with data.factory() as editor:
            editor.get(models.MultipleSmtpConfig, row['id']).notification_types = ['general']
            editor.commit()
        with pytest.raises(security.SmtpError):
            service.reserve(db, stale, category='otp')
    assert api.get('/api/config/smtp/attempts').json()['items'] == []


def test_quota_wait_defers_to_reset_without_spending_delivery_attempts(data, api, monkeypatch):
    profile(api, daily_limit=1)
    assert api.post('/api/config/smtp/multiple/' + api.get('/api/config/smtp/multiple').json()[0]['id'] + '/test',
                    json={'to_address': 'synthetic@example.com'}).status_code == 202
    job_id = enqueue(data)
    instant = datetime.now(timezone.utc)
    with data.factory() as db:
        assert outbox._attempt_email_delivery(db, job_id) == 1
        job = db.get(models.NotificationOutbox, job_id, populate_existing=True)
        assert job.delivery_state == 'retrying' and job.attempts == 0
        assert service.aware(job.next_attempt_at) >= instant.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        assert outbox._attempt_email_delivery(db, job_id) == 0
    assert len(api.sent) == 1  # Only the explicit test; quota waiting never opened transport.


def test_actual_failover_attempt_still_consumes_budget_when_fallback_is_quota_blocked(data, api, monkeypatch):
    first = profile(api, name='First', priority=0)
    second = profile(api, name='Limited fallback', priority=1, daily_limit=1)
    assert api.post('/api/config/smtp/multiple/' + second['id'] + '/test', json={'to_address': 'synthetic@example.com'}).status_code == 202
    def failed_provider(**kwargs):
        assert kwargs['smtp_config'].id == first['id']
        raise security.SmtpError('temporary_failure', retryable=True)
    monkeypatch.setattr(email_utils, '_send_email_with_config', failed_provider)
    job_id = enqueue(data)
    with data.factory() as db:
        outbox._attempt_email_delivery(db, job_id)
        row = db.get(models.NotificationOutbox, job_id, populate_existing=True)
        assert row.attempts == 1 and row.delivery_state == 'retrying'
        assert service.aware(row.next_attempt_at) < service.now() + timedelta(minutes=10)


def test_ambiguous_acceptance_never_fails_over_or_becomes_manually_retryable(data, api, monkeypatch):
    first = profile(api, name='First', priority=0)
    profile(api, name='Second', priority=1)
    calls = []
    def unknown(**kwargs):
        calls.append(kwargs['smtp_config'].id)
        raise security.SmtpError('acceptance_unknown', uncertain=True)
    monkeypatch.setattr(email_utils, '_send_email_with_config', unknown)
    job_id = enqueue(data)
    with data.factory() as db:
        outbox._attempt_email_delivery(db, job_id)
        assert db.get(models.NotificationOutbox, job_id, populate_existing=True).delivery_state == 'uncertain'
        assert outbox._attempt_email_delivery(db, job_id) == 0
    assert calls == [first['id']]
    assert api.post('/api/config/smtp/queue/retry', json={'ids': [job_id]}).json()['selected'] == 0


@pytest.mark.parametrize('failure', [False, True])
def test_audit_storage_failure_does_not_change_known_smtp_outcome(data, api, monkeypatch, failure):
    profile(api)
    job_id = enqueue(data)
    def broken_audit(*_):
        raise RuntimeError('Synthetic audit outage')
    monkeypatch.setattr(email_utils.audit_logger, 'log_event', broken_audit)
    if failure:
        def temporary(**_):
            raise security.SmtpError('temporary_failure', retryable=True)
        monkeypatch.setattr(email_utils, '_send_email_with_config', temporary)
    with data.factory() as db:
        assert outbox._attempt_email_delivery(db, job_id) == 1
        job = db.get(models.NotificationOutbox, job_id, populate_existing=True)
        assert job.delivery_state == ('retrying' if failure else 'sent')
        assert outbox._attempt_email_delivery(db, job_id) == 0


def test_totals_equal_current_plus_retired_profiles_with_exact_window_and_tenant_scope(data, api):
    row = profile(api)
    instant = datetime.now(timezone.utc)
    with data.factory() as db:
        for tenant, key, kind, outcome, when in [
            (data.owner.tenant_id, 'multi:' + row['id'], 'message', 'accepted', instant),
            (data.owner.tenant_id, 'multi:' + row['id'], 'message', 'temporary_failure', instant),
            (data.owner.tenant_id, 'multi:retired', 'message', 'accepted', instant),
            (data.owner.tenant_id, 'multi:retired', 'message', 'unknown', instant),
            (data.owner.tenant_id, 'multi:retired', 'message', 'accepted', instant - timedelta(hours=2)),
            (data.owner.tenant_id, 'multi:retired', 'connection', 'connected', instant),
            (data.outsider.tenant_id, 'multi:foreign', 'message', 'accepted', instant)]:
            db.add(models.SmtpDeliveryAttempt(tenant_id=tenant, profile_key=key, category='notifications', kind=kind,
                outcome=outcome, started_at=when, finished_at=when + timedelta(milliseconds=100)))
        db.commit()
    metrics = api.get('/api/config/smtp/health?hours=1').json()
    assert metrics['smtp_accepted'] == 2 and metrics['failed_attempts'] == 1 and metrics['uncertain_attempts'] == 1
    assert metrics['success_percentage'] == 66.67 and metrics['retired_profile_keys'] == ['multi:retired']
    for field in ('smtp_accepted', 'failed_attempts', 'uncertain_attempts'):
        assert metrics[field] == sum(item[field] for item in metrics['profile_stats'].values())
    assert api.get('/api/config/smtp/health?hours=24').json()['smtp_accepted'] == 3


def test_concurrent_manual_retry_selects_each_due_job_once(data, api):
    job_id = enqueue(data)
    with data.factory() as db:
        row = db.get(models.NotificationOutbox, job_id)
        row.delivery_state = 'retrying'; row.status = models.NotificationOutboxStatusEnum.FAILED
        row.attempts = 1; row.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    # Each concurrent request gets its own database session.
    def retry(_):
        return api.post('/api/config/smtp/queue/retry', json={'ids': [job_id]}).json()['selected']
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert sum(pool.map(retry, range(3))) == 1


def test_system_reset_otp_uses_only_the_owners_explicit_otp_profile(data, api, monkeypatch):
    from backend.app.routers import data_admin
    # Global legacy reset is available only in a single-tenant installation.
    monkeypatch.setattr(get_settings(), 'default_tenant_id', str(data.owner.tenant_id))
    with data.factory() as db:
        db.delete(db.get(models.User, data.outsider.id))
        db.commit()
    api.app.include_router(data_admin.router, prefix='/api')
    profile(api, name='General only', notification_types=['general'])
    # Requesting a code does not perform a reset; confirm/reset execution is never invoked.
    assert api.post('/api/admin/data/reset/request').status_code == 400
    assert api.sent == []
    otp = profile(api, name='Owner OTP', notification_types=['otp'])
    response = api.post('/api/admin/data/reset/request')
    assert response.status_code == 202 and response.json() == {'status': 'otp_sent'}
    assert len(api.sent) == 1 and api.sent[0]['smtp_config'].id == otp['id']
    assert api.sent[0]['to_address'] == data.owner.email
    with data.factory() as db:
        token = db.get(models.OwnerResetToken, data.owner.id)
        assert token and token.otp_hash and service.aware(token.expires_at) > service.now()


def test_user_creation_welcome_notification_remains_durable_without_inline_smtp(data, api, monkeypatch):
    from backend.app.routers import users
    monkeypatch.setattr(users, 'trigger_n8n_event', lambda *_args, **_kwargs: None)
    api.app.include_router(users.router, prefix='/api')
    response = api.post('/api/users', json={'name': 'Synthetic welcome', 'email': 'welcome@example.com', 'password': 'Synthetic-only-123'})
    assert response.status_code == 201, response.text
    assert api.sent == []
    with data.factory() as db:
        job = db.scalar(select(models.NotificationOutbox).where(models.NotificationOutbox.recipient_user_id == response.json()['id']))
        assert job and job.tenant_id == data.owner.tenant_id and job.payload['notification_type'] == 'welcome'
        assert 'Synthetic-only-123' not in str(job.payload)
