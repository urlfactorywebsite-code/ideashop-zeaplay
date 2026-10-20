"""Tenant routing, durable attempt reservations and consistent SMTP metrics."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from .. import models
from .smtp_categories import category_for
from .smtp_security import PREFIX, SmtpError


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def profile_key(profile):
    return ('primary:' if isinstance(profile, models.SmtpConfig) else 'multi:') + str(profile.id)


def complete(profile, require_enabled=True):
    return bool(profile and profile.tenant_id and (profile.is_enabled or not require_enabled) and profile.host and profile.port and profile.username
                and profile.auth_method != 'oauth2' and
                (profile.auth_method == 'none' or profile.password and profile.password.startswith(PREFIX)))


def owned_profiles(db, tenant_id):
    if tenant_id is None:
        return []
    tenant_id = UUID(str(tenant_id))
    rows = list(db.scalars(select(models.MultipleSmtpConfig).where(models.MultipleSmtpConfig.tenant_id == tenant_id)))
    rows.extend(db.scalars(select(models.SmtpConfig).where(models.SmtpConfig.tenant_id == tenant_id)))
    return sorted(rows, key=lambda row: (row.priority, profile_key(row)))


def candidates(db, tenant_id, category):
    category = category_for(category)
    available = [row for row in owned_profiles(db, tenant_id) if complete(row)]
    exact = [row for row in available if category in {category_for(v) for v in row.notification_types}]
    # OTP never falls back to a general/default profile, including the legacy primary.
    fallback = [] if category == 'otp' else [row for row in available if 'general' in row.notification_types and row not in exact]
    return exact + fallback


def load_profile(db, tenant_id, identifier, *, lock=False):
    primary = str(identifier).startswith('primary:')
    try:
        identifier = int(str(identifier).split(':')[1]) if primary else str(identifier)
    except (ValueError, IndexError):
        return None
    model = models.SmtpConfig if primary else models.MultipleSmtpConfig
    query = select(model).where(model.id == identifier, model.tenant_id == UUID(str(tenant_id)))
    return db.scalar(query.with_for_update() if lock else query)


def dto(row):
    fields = ('name', 'host', 'port', 'username', 'encryption', 'provider', 'priority', 'is_enabled', 'auth_method',
              'sender_name', 'sender_email', 'reply_to', 'rate_limit_per_minute', 'daily_limit', 'notification_types',
              'created_at', 'updated_at', 'last_test_at', 'last_test_ok', 'last_test_code')
    result = {field: getattr(row, field) for field in fields}
    result.update(id='primary:' + str(row.id) if isinstance(row, models.SmtpConfig) else row.id,
                  has_password=bool(row.password), secret_encrypted=bool(row.password and row.password.startswith(PREFIX)), health=health(row))
    return result


def health(profile):
    if not profile.is_enabled:
        return 'disabled'
    tested = aware(profile.last_test_at)
    if not tested or now() - tested > timedelta(hours=1):
        return 'untested'
    if not profile.last_test_ok:
        return 'unhealthy'
    return 'degraded' if now() - tested > timedelta(minutes=15) else 'healthy'


def reserve(db, profile, *, category, kind='message', outbox_id=None, allow_disabled=False):
    """A separate transaction locks the profile through quota-check + reservation.

    It never commits the caller's business transaction. PostgreSQL row locks serialize
    workers. SQLite's first no-op UPDATE obtains its equivalent single-writer lock.
    All message reservations count toward UTC minute/day attempt quotas, including failures.
    """
    with Session(bind=db.get_bind(), expire_on_commit=False) as ledger:
        if ledger.bind.dialect.name == 'sqlite':
            model = type(profile)
            ledger.execute(update(model).where(model.id == profile.id).values(priority=model.priority, updated_at=model.updated_at))
        primary_id = 'primary:' + str(profile.id) if isinstance(profile, models.SmtpConfig) else profile.id
        current = load_profile(ledger, profile.tenant_id, primary_id, lock=True)
        if not current or kind != 'connection' and not complete(current, require_enabled=not allow_disabled):
            raise SmtpError('configuration')
        if kind == 'message' and not allow_disabled:
            categories = {category_for(value) for value in current.notification_types or []}
            requested = category_for(category)
            if requested not in categories and (requested == 'otp' or 'general' not in categories):
                raise SmtpError('configuration', retryable=True)
        instant = now()
        key = profile_key(current)
        if kind == 'connection':
            used = ledger.scalar(select(func.count()).select_from(models.SmtpDeliveryAttempt).where(
                models.SmtpDeliveryAttempt.profile_key == key, models.SmtpDeliveryAttempt.kind == 'connection',
                models.SmtpDeliveryAttempt.started_at >= instant - timedelta(minutes=1)))
            if used >= min(10, current.rate_limit_per_minute):
                raise SmtpError('rate_limited', retryable=True)
        if kind == 'message':
            blocked_until = []
            for since, period, maximum in [(instant.replace(second=0, microsecond=0), timedelta(minutes=1), current.rate_limit_per_minute),
                                           (instant.replace(hour=0, minute=0, second=0, microsecond=0), timedelta(days=1), current.daily_limit)]:
                used = ledger.scalar(select(func.count()).select_from(models.SmtpDeliveryAttempt).where(
                    models.SmtpDeliveryAttempt.profile_key == key, models.SmtpDeliveryAttempt.kind == 'message',
                    models.SmtpDeliveryAttempt.started_at >= since))
                if used >= maximum:
                    blocked_until.append(since + period)
            if blocked_until:
                raise SmtpError('rate_limited', retryable=True, retry_at=max(blocked_until))
        attempt = models.SmtpDeliveryAttempt(tenant_id=current.tenant_id, profile_key=key, category=category_for(category),
            kind=kind, outbox_id=outbox_id, started_at=instant, outcome='reserved')
        ledger.add(attempt)
        ledger.commit()
        return attempt.id, current


def finish(db, attempt_id, error=None):
    with Session(bind=db.get_bind()) as ledger:
        attempt = ledger.get(models.SmtpDeliveryAttempt, attempt_id)
        connected = attempt is not None and attempt.kind == 'connection'
        outcome = ('connected' if connected else 'accepted') if error is None else ('unknown' if error.uncertain else 'temporary_failure' if error.retryable else 'permanent_failure')
        ledger.execute(update(models.SmtpDeliveryAttempt).where(models.SmtpDeliveryAttempt.id == attempt_id)
                       .values(outcome=outcome, code=error.code if error else 'connection_ok' if connected else 'smtp_accepted', finished_at=now()))
        ledger.commit()


def deliver(db, *, tenant_id, category, recipient, subject, body, outbox_id=None, selected=None):
    from .. import email_utils
    category = category_for(category)
    rows = [selected] if selected else candidates(db, tenant_id, category)
    if not rows:
        raise SmtpError('configuration', retryable=True)
    last_error = None
    quota_waits = []
    made_attempt = False
    for row in rows:
        try:
            attempt_id, current = reserve(db, row, category=category, outbox_id=outbox_id, allow_disabled=selected is not None)
        except SmtpError as exc:
            last_error = exc
            if exc.retry_at:
                quota_waits.append(exc.retry_at)
            continue
        made_attempt = True
        try:
            email_utils._send_email_with_config(smtp_config=current, to_address=recipient, subject=subject, body=body,
                message_id=f'<zea-{outbox_id}@notifications.invalid>' if outbox_id else None)
        except SmtpError as exc:
            finish(db, attempt_id, exc)
            last_error = exc
            # Never fail over after ambiguous acceptance or a recipient/content rejection.
            if exc.uncertain or exc.code in {'recipient_rejected', 'permanent_failure'}:
                raise
        except Exception:
            # Unknown transport/provider errors can contain message content: never persist them.
            error = SmtpError('acceptance_unknown', uncertain=True)
            finish(db, attempt_id, error)
            raise error from None
        else:
            finish(db, attempt_id)
            return
    if not made_attempt and quota_waits:
        raise SmtpError('rate_limited', retryable=True, retry_at=min(quota_waits))
    # A real provider attempt must retain its retry-budget cost, even if a later
    # fallback has no quota. Only all-quota-blocked cycles qualify for deferral.
    if made_attempt and last_error and last_error.retry_at:
        raise SmtpError(last_error.code, retryable=last_error.retryable)
    raise last_error or SmtpError('configuration', retryable=True)


def metrics(db, tenant_id, hours=24):
    # Separate read snapshot avoids changing the request's authorization/business transaction.
    with Session(bind=db.get_bind()) as snapshot:
        if snapshot.bind.dialect.name == 'postgresql':
            snapshot.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
        elif not snapshot.connection().connection.driver_connection.in_transaction:
            snapshot.connection().exec_driver_sql('BEGIN')
        return _metrics(snapshot, tenant_id, hours)


def _metrics(db, tenant_id, hours):
    profiles = owned_profiles(db, tenant_id)
    instant = now()
    since = instant - timedelta(hours=hours)
    attempt = models.SmtpDeliveryAttempt
    duration = ((func.julianday(attempt.finished_at) - func.julianday(attempt.started_at)) * 86400000
                if db.bind.dialect.name == 'sqlite' else func.extract('epoch', attempt.finished_at - attempt.started_at) * 1000)
    groups = db.execute(select(attempt.profile_key, attempt.outcome, func.count().label('n'),
        func.sum(case((attempt.started_at >= instant - timedelta(minutes=1), 1), else_=0)).label('recent'),
        func.sum(duration).label('duration_sum'), func.count(attempt.finished_at).label('finished')).where(
        attempt.tenant_id == tenant_id, attempt.kind == 'message', attempt.started_at >= since)
        .group_by(attempt.profile_key, attempt.outcome)).all()
    states = dict(db.execute(select(models.NotificationOutbox.delivery_state, func.count()).where(
        models.NotificationOutbox.tenant_id == tenant_id).group_by(models.NotificationOutbox.delivery_state)).all())
    def counts(rows):
        sent = sum(row.n for row in rows if row.outcome == 'accepted')
        failed = sum(row.n for row in rows if row.outcome in {'temporary_failure', 'permanent_failure'})
        finished = sum(row.finished for row in rows)
        return {'smtp_accepted': sent, 'failed_attempts': failed, 'uncertain_attempts': sum(row.n for row in rows if row.outcome == 'unknown'),
            'success_percentage': round(sent / (sent + failed) * 100, 2) if sent + failed else None,
            'average_processing_ms': round(sum(float(row.duration_sum or 0) for row in rows) / finished, 2) if finished else None,
            'attempts_last_minute': sum(row.recent for row in rows)}
    current_keys = {profile_key(profile) for profile in profiles}
    observed_keys = {group.profile_key for group in groups}
    return {'window_hours': hours, 'window_start': since, 'as_of': instant, 'profiles': len(profiles),
        'enabled_profiles': sum(row.is_enabled for row in profiles), 'healthy_profiles': sum(health(row) == 'healthy' for row in profiles),
        'queue': {state: states.get(state, 0) for state in ('queued', 'sending', 'retrying', 'sent', 'failed', 'uncertain')},
        **counts(groups), 'profile_stats': {key: counts([group for group in groups if group.profile_key == key]) for key in sorted(current_keys | observed_keys)},
        'retired_profile_keys': sorted(observed_keys - current_keys),
        'definitions': {'queue': 'Current tenant job states across all time; not failed SMTP attempt totals.',
            'smtp_accepted': 'Message received a final SMTP 250 response; inbox delivery is not confirmed. Includes explicit tests and retired profile history.',
            'failed_attempts': 'Failed message transport attempts within the selected UTC window; a job may have several.',
            'success_percentage': 'Accepted / (accepted + failed attempts), excluding connections, pending and uncertain attempts.',
            'health': 'Real connection/auth test: <=15m healthy; 15-60m degraded; failed <=60m unhealthy; older/missing untested; disabled overrides.',
            'quotas': 'All reserved message attempts count per UTC minute/day, including failures and explicit test emails.'}}
