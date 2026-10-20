"""SMTP-only management; existing /config/smtp paths are retained."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import get_current_admin
from ..smtp_schemas import ProfileCreate, ProfileFields, ProfileUpdate, RetryJobs, TestMail
from ..services import security_audit, smtp_management as service
from ..services.smtp_security import SmtpError, decrypt_secret, encrypt_secret, policy_name, resolve_destination, transport
from ..config import get_settings


class SecretSafeRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def safe_handler(request: Request):
            try:
                response = await handler(request)
                response.headers['Cache-Control'] = 'no-store'
                return response
            except RequestValidationError as exc:
                return JSONResponse(status_code=422, content={'detail': [
                    {'loc': error['loc'], 'msg': error['msg'], 'type': error['type']} for error in exc.errors()]},
                    headers={'Cache-Control': 'no-store'})
        return safe_handler


router = APIRouter(prefix='/smtp', tags=['SMTP'], route_class=SecretSafeRoute)


def admin(user=Depends(get_current_admin)):
    if user.role not in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN} or not user.tenant_id:
        raise HTTPException(403, 'Tenant Owner or Admin privileges required')
    return user


def found(db, user, identifier, lock=False):
    row = service.load_profile(db, user.tenant_id, identifier, lock=lock)
    if row is None:
        raise HTTPException(404, 'SMTP profile not found')
    return row


def failure(exc):
    return HTTPException(503 if exc.code in {'key_unavailable', 'delivery_disabled'} else 429 if exc.code == 'rate_limited' else 400,
                         detail={'code': exc.code, 'message': str(exc)})


def save(db, row, payload, user, *, creating=False):
    fields = payload.model_dump(exclude_unset=True)
    # Emergency disable must work even after DNS, key or relay policy is revoked.
    if not creating and fields == {'is_enabled': False}:
        row.is_enabled = False
        security_audit.append_event(db, actor=user, event_type='smtp.profile_updated', entity_type='smtp',
            entity_id=str(row.id), payload={'fields': ['is_enabled'], 'tenant_id': str(user.tenant_id)})
        db.commit()
        db.refresh(row)
        return service.dto(row)
    merged = {key: getattr(row, key, None) for key in ProfileFields.model_fields}
    merged.update({key: value for key, value in fields.items() if key not in {'name', 'password'}})
    try:
        validated = ProfileFields.model_validate(merged)
        raw_name = fields.get('name', getattr(row, 'name', 'Primary SMTP'))
        if not isinstance(raw_name, str):
            raise ValueError('Invalid name')
        name = ProfileCreate.name_valid(raw_name)
        TypeAdapter(EmailStr).validate_python(validated.sender_email or validated.username)
    except (ValidationError, ValueError):
        raise HTTPException(422, 'Invalid SMTP fields; verify host, port, security, sender email and categories') from None
    if validated.auth_method == 'oauth2' and validated.is_enabled:
        raise HTTPException(422, 'SMTP OAuth is not integrated; save disabled or use an approved SMTP relay')
    if validated.auth_method == 'none' and policy_name(validated.host, validated.port) not in get_settings().smtp_private_host_allowlist:
        raise HTTPException(422, 'Unauthenticated relay requires an explicit trusted server-side destination policy')
    if validated.encryption == 'none' and policy_name(validated.host, validated.port) not in get_settings().smtp_plaintext_host_allowlist:
        raise HTTPException(422, 'Plaintext SMTP is disabled for this destination')
    try:
        resolve_destination(validated.host, validated.port)
        supplied = fields.get('password')
        secret = supplied.get_secret_value() if supplied is not None else None
        if secret and secret.strip():
            row.password = encrypt_secret(secret)
        if validated.is_enabled and validated.auth_method == 'password':
            if not row.password:
                raise HTTPException(422, 'A password/app password is required for an enabled password-authenticated profile')
            decrypt_secret(row.password)
    except SmtpError as exc:
        raise failure(exc) from None
    for key, value in validated.model_dump().items():
        setattr(row, key, str(value) if key in {'sender_email', 'reply_to'} and value else value)
    row.name = name
    row.tenant_id = user.tenant_id
    row.last_test_at = row.last_test_ok = row.last_test_code = None
    db.add(row)
    security_audit.append_event(db, actor=user, event_type='smtp.profile_created' if creating else 'smtp.profile_updated',
        entity_type='smtp', entity_id=str(row.id or 'new'), payload={'fields': sorted(fields), 'tenant_id': str(user.tenant_id)})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'An SMTP profile with this name already exists') from None
    db.refresh(row)
    return service.dto(row)


@router.get('')
def primary(db: Session = Depends(get_db), user=Depends(admin)):
    row = db.scalar(select(models.SmtpConfig).where(models.SmtpConfig.tenant_id == user.tenant_id))
    return service.dto(row) if row else {'host': '', 'port': 587, 'username': '', 'encryption': 'tls',
                                       'has_password': False, 'is_enabled': False, 'health': 'untested'}


@router.patch('')
def update_primary(payload: ProfileUpdate, db: Session = Depends(get_db), user=Depends(admin)):
    row = db.scalar(select(models.SmtpConfig).where(models.SmtpConfig.tenant_id == user.tenant_id).with_for_update())
    creating = row is None
    if creating:
        row = models.SmtpConfig(name='Primary SMTP', **ProfileFields(host='smtp.example.com', port=587, username='noreply@example.com',
                                is_enabled=False, notification_types=['general']).model_dump())
    return save(db, row, payload, user, creating=creating)


@router.get('/multiple')
def profiles(db: Session = Depends(get_db), user=Depends(admin)):
    return [service.dto(row) for row in service.owned_profiles(db, user.tenant_id)]


@router.post('/multiple', status_code=201)
def create_profile(payload: ProfileCreate, db: Session = Depends(get_db), user=Depends(admin)):
    duplicate = db.scalar(select(models.MultipleSmtpConfig.id).where(models.MultipleSmtpConfig.tenant_id == user.tenant_id,
                           func.lower(models.MultipleSmtpConfig.name) == payload.name.lower()))
    if duplicate:
        raise HTTPException(409, 'An SMTP profile with this name already exists')
    row = models.MultipleSmtpConfig(**payload.model_dump(exclude={'password'}))
    return save(db, row, payload, user, creating=True)


@router.get('/multiple/{config_id}')
def read_profile(config_id: str, db: Session = Depends(get_db), user=Depends(admin)):
    return service.dto(found(db, user, config_id))


@router.patch('/multiple/{config_id}')
def update_profile(config_id: str, payload: ProfileUpdate, db: Session = Depends(get_db), user=Depends(admin)):
    return save(db, found(db, user, config_id, lock=True), payload, user)


@router.delete('/multiple/{config_id}')
def delete_profile(config_id: str, db: Session = Depends(get_db), user=Depends(admin)):
    row = found(db, user, config_id, lock=True)
    security_audit.append_event(db, actor=user, event_type='smtp.profile_deleted', entity_type='smtp', entity_id=config_id,
                               payload={'tenant_id': str(user.tenant_id)})
    db.delete(row)
    db.commit()
    return {'status': 'deleted'}


@router.post('/multiple/{config_id}/connection')
def connection_test(config_id: str, db: Session = Depends(get_db), user=Depends(admin)):
    row = found(db, user, config_id)
    revision = row.updated_at
    error = None
    try:
        attempt_id, current = service.reserve(db, row, category='general', kind='connection', allow_disabled=True)
    except SmtpError as exc:
        # A rejected reservation did not test the connection: preserve its last result.
        raise failure(exc) from None
    try:
        try:
            transport(current)
        except SmtpError as exc:
            service.finish(db, attempt_id, exc)
            raise
        service.finish(db, attempt_id)
    except SmtpError as exc:
        error = exc
    tested_at = service.now()
    test_code = error.code if error else 'authenticated' if current.auth_method == 'password' else 'connected'
    changed = db.execute(update(type(row)).where(type(row).id == row.id, type(row).tenant_id == user.tenant_id,
        type(row).updated_at == revision).values(last_test_at=tested_at, last_test_ok=error is None,
        last_test_code=test_code, updated_at=revision)).rowcount
    if changed != 1:
        db.rollback()
        raise HTTPException(409, 'Profile changed during the test; test its current settings again')
    security_audit.append_event(db, actor=user, event_type='smtp.connection_test', entity_type='smtp', entity_id=config_id,
                               payload={'ok': error is None, 'code': test_code})
    db.commit()
    if error:
        raise failure(error)
    return {'status': test_code, 'message': 'Connection established and authentication successful.' if current.auth_method == 'password'
            else 'Connection established to the approved unauthenticated relay.', 'tested_at': tested_at}


@router.get('/attempts')
def attempts(limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user=Depends(admin)):
    rows = db.scalars(select(models.SmtpDeliveryAttempt).where(models.SmtpDeliveryAttempt.tenant_id == user.tenant_id)
                      .order_by(models.SmtpDeliveryAttempt.started_at.desc(), models.SmtpDeliveryAttempt.id).limit(limit))
    return {'items': [{'id': row.id, 'profile_key': row.profile_key, 'outbox_id': row.outbox_id, 'category': row.category,
        'kind': row.kind, 'outcome': row.outcome, 'code': row.code, 'started_at': row.started_at, 'finished_at': row.finished_at} for row in rows]}


@router.post('/multiple/{config_id}/test', status_code=202)
def test_message(config_id: str, payload: TestMail, db: Session = Depends(get_db), user=Depends(admin)):
    row = found(db, user, config_id)
    try:
        service.deliver(db, tenant_id=user.tenant_id, category=payload.notification_type, selected=row,
                        recipient=str(payload.to_address), subject=payload.subject, body=payload.body)
    except SmtpError as exc:
        raise failure(exc) from None
    security_audit.append_event(db, actor=user, event_type='smtp.test_message_accepted', entity_type='smtp', entity_id=config_id,
                               payload={'tenant_id': str(user.tenant_id)})
    db.commit()
    return {'status': 'smtp_accepted', 'message': 'Message accepted by SMTP server; inbox delivery is not confirmed.'}


@router.get('/health')
def health(hours: int = Query(24, ge=1, le=168), db: Session = Depends(get_db), user=Depends(admin)):
    return service.metrics(db, user.tenant_id, hours)


def eligible(row):
    return row.delivery_state == 'retrying' and row.attempts < row.max_attempts and row.next_attempt_at is not None and service.aware(row.next_attempt_at) <= service.now()


@router.get('/queue')
def queue(state: str = Query('all', pattern='^(all|queued|sending|retrying|sent|failed|uncertain)$'),
          offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user=Depends(admin)):
    query = select(models.NotificationOutbox).where(models.NotificationOutbox.tenant_id == user.tenant_id)
    if state != 'all':
        query = query.where(models.NotificationOutbox.delivery_state == state)
    rows = db.scalars(query.order_by(models.NotificationOutbox.created_at.desc(), models.NotificationOutbox.id).offset(offset).limit(limit))
    return {'items': [{'id': row.id, 'category': row.payload.get('notification_type', row.event_type), 'state': row.delivery_state,
        'attempts': row.attempts, 'max_attempts': row.max_attempts, 'next_attempt_at': row.next_attempt_at,
        'created_at': row.created_at, 'can_retry': eligible(row)} for row in rows], 'offset': offset, 'limit': limit}


@router.post('/queue/retry')
def retry(payload: RetryJobs, db: Session = Depends(get_db), user=Depends(admin)):
    rows = db.scalars(select(models.NotificationOutbox).where(models.NotificationOutbox.tenant_id == user.tenant_id,
        models.NotificationOutbox.id.in_(payload.ids)).order_by(models.NotificationOutbox.id).with_for_update()).all()
    selected = 0
    for row in rows:
        if eligible(row):
            # Recheck atomically as SQLite ignores FOR UPDATE; do not report the
            # same selected job to concurrent retry requests.
            selected += db.execute(update(models.NotificationOutbox).where(
                models.NotificationOutbox.id == row.id, models.NotificationOutbox.tenant_id == user.tenant_id,
                models.NotificationOutbox.delivery_state == 'retrying',
                models.NotificationOutbox.attempts < models.NotificationOutbox.max_attempts,
                models.NotificationOutbox.next_attempt_at <= service.now())
                .values(delivery_state='queued', status=models.NotificationOutboxStatusEnum.PENDING,
                        next_attempt_at=service.now()).execution_options(synchronize_session=False)).rowcount
    security_audit.append_event(db, actor=user, event_type='smtp.jobs_requeued', entity_type='smtp', entity_id='queue',
                               payload={'selected': selected, 'requested': len(set(payload.ids))})
    db.commit()
    return {'requested': len(set(payload.ids)), 'selected': selected, 'skipped': len(set(payload.ids)) - selected}
