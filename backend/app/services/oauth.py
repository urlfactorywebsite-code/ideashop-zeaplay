"""OAuthlib adapter: existing identities, opaque verifiers, transactional rotation."""
import base64
import hashlib
import logging
import re
from secrets import compare_digest, token_urlsafe
from urllib.parse import unquote_plus

from fastapi import HTTPException
from oauthlib.oauth2 import RequestValidator, Server
from oauthlib.oauth2.rfc6749.errors import InvalidGrantError, OAuth2Error
from sqlalchemy import delete, select, update

from ..auth import hash_password, verify_password
from ..config import get_settings
from ..models import User, UserStatusEnum
from ..oauth_models import (
    OAuthClient,
    OAuthCode,
    OAuthConsent,
    OAuthEvent,
    OAuthGrant,
    OAuthRateLimit,
    OAuthToken,
    epoch,
)

# OAuthlib debug logs include protocol credentials. Never enable those loggers.
for _name in list(logging.Logger.manager.loggerDict):
    if _name.startswith('oauthlib'):
        logging.getLogger(_name).disabled = True
logging.getLogger('oauthlib').disabled = True
for _logger in ('oauthlib.oauth2.rfc6749.grant_types.authorization_code',
                'oauthlib.oauth2.rfc6749.grant_types.refresh_token',
                'oauthlib.oauth2.rfc6749.grant_types.client_credentials',
                'oauthlib.oauth2.rfc6749.endpoints.token',
                'oauthlib.oauth2.rfc6749.endpoints.authorization',
                'oauthlib.oauth2.rfc6749.tokens'):
    logging.getLogger(_logger).disabled = True

ACCESS_SECONDS = 600
REFRESH_SECONDS = 7 * 86400
GRANT_SECONDS = 30 * 86400


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def settings():
    return get_settings()


def configured():
    if not settings().oauth_issuer or not settings().oauth_ui_url:
        raise HTTPException(503, 'OAuth is not configured. Set VEE_OAUTH_ISSUER and VEE_OAUTH_UI_URL after migrating the database.')


def secure_transport(request):
    return settings().environment != 'production' or request.url.scheme == 'https'


def event(db, client, action, actor=None):
    db.add(OAuthEvent(tenant_id=client.tenant_id, client_id=client.id, action=action, actor_id=actor))


def revoke_grant(db, grant, action='grant_revoked', actor_id=None):
    db.execute(update(OAuthGrant).where(OAuthGrant.id == grant.id, OAuthGrant.revoked_at.is_(None)).values(revoked_at=epoch()))
    event(db, db.get(OAuthClient, grant.client_id), action, actor_id or grant.user_id)


def revoke_client(db, client, action, actor_id=None):
    db.execute(update(OAuthGrant).where(OAuthGrant.client_id == client.id, OAuthGrant.revoked_at.is_(None)).values(revoked_at=epoch()))
    db.execute(update(OAuthConsent).where(OAuthConsent.client_id == client.id, OAuthConsent.consumed_at.is_(None)).values(consumed_at=epoch()))
    event(db, client, action, actor_id)


def active_client(db, client):
    if not client or not client.enabled or client.archived:
        return False
    if client.client_type == 'confidential' and (not client.secret_hash or (client.secret_expires_at or 0) <= epoch()):
        return False
    owner = db.get(User, client.owner_id)
    return bool(owner and owner.tenant_id == client.tenant_id and owner.status == UserStatusEnum.ACTIVE)


def active_grant(db, grant):
    if not grant or grant.revoked_at or grant.expires_at <= epoch():
        return False
    client = db.get(OAuthClient, grant.client_id)
    if not active_client(db, client) or client.tenant_id != grant.tenant_id:
        return False
    if not set(grant.scopes) <= set(client.scopes):
        return False
    if grant.user_id:
        user = db.get(User, grant.user_id)
        return bool(user and user.tenant_id == grant.tenant_id and user.status == UserStatusEnum.ACTIVE
                    and user.credentials_version == grant.credentials_version)
    return True


def token_record(db, value, kind=None):
    row = db.scalar(select(OAuthToken).where(OAuthToken.verifier == digest(value)))
    if not row or row.kind not in {'access', 'refresh'} or (kind and row.kind != kind) or row.revoked_at or row.consumed_at or row.expires_at <= epoch():
        return None
    if row.issuer != settings().oauth_issuer or row.audience != settings().oauth_audience:
        return None
    grant = db.get(OAuthGrant, row.grant_id)
    if not active_grant(db, grant) or row.tenant_id != grant.tenant_id:
        return None
    if not set(row.scopes) <= set(grant.scopes):
        return None
    return row


def delegated_user(db, value, request):
    """Deny by default: OAuth tokens never acquire the full first-party JWT surface."""
    path = request.url.path.removeprefix('/api')
    scope = None
    if request.method == 'GET':
        if path == '/oauth2/profile':
            scope = 'profile:read'
        elif re.fullmatch(r'/projects(?:/[0-9a-fA-F-]{36})?', path):
            scope = 'projects:read'
        elif re.fullmatch(r'/tasks(?:/[0-9a-fA-F-]{36})?', path):
            scope = 'tasks:read'
    record = token_record(db, value, 'access')
    if not record:
        raise HTTPException(401, 'Invalid OAuth access token', headers={'WWW-Authenticate': 'Bearer error="invalid_token"'})
    grant = db.get(OAuthGrant, record.grant_id)
    if not scope or scope not in record.scopes or not grant.user_id:
        raise HTTPException(403, 'OAuth scope does not permit this operation', headers={'WWW-Authenticate': 'Bearer error="insufficient_scope"'})
    user = db.get(User, grant.user_id)
    record.last_used_at = grant.last_used_at = epoch()
    db.commit()
    from ..lifecycle.context import bind_actor
    bind_actor(db, user)
    return user


class IssuanceRateExceeded(OAuth2Error):
    error = 'temporarily_unavailable'
    status_code = 429


def _rate_statement(db, subject):
    window = epoch() // 60
    if db.bind.dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    statement = insert(OAuthRateLimit).values(key=digest(subject), window=window, count=1)
    return statement.on_conflict_do_update(index_elements=['key', 'window'], set_={'count': OAuthRateLimit.count + 1}).returning(OAuthRateLimit.count)


def rate_limit(db, request):
    """Shared atomic fixed-window IP limiter; proxy must supply the real peer safely."""
    peer = request.client.host if request.client else 'unknown'
    window = epoch() // 60
    count = db.scalar(_rate_statement(db, 'ip:' + peer))
    db.execute(delete(OAuthRateLimit).where(OAuthRateLimit.window < window - 5))
    db.commit()
    if count > 120:
        raise HTTPException(429, 'OAuth request rate exceeded', headers={'Retry-After': '60'})


def client_metadata(client):
    return {key: getattr(client, key) for key in (
        'id', 'client_id', 'tenant_id', 'owner_id', 'name', 'description', 'category',
        'client_type', 'redirect_uris', 'grant_types', 'scopes', 'enabled', 'archived',
        'secret_expires_at', 'created_at', 'updated_at')}


def rotate_secret(client):
    secret = token_urlsafe(48)
    client.secret_hash = hash_password(secret)
    client.secret_expires_at = epoch() + 90 * 86400
    return secret


class Validator(RequestValidator):
    def __init__(self, db):
        self.db = db

    def client(self, client_id, lock=False):
        query = select(OAuthClient).where(OAuthClient.client_id == client_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)

    def validate_client_id(self, client_id, request, *args, **kwargs):
        request.client = self.client(client_id)
        return active_client(self.db, request.client)

    def validate_redirect_uri(self, client_id, redirect_uri, request, *args, **kwargs):
        return redirect_uri in request.client.redirect_uris

    def get_default_redirect_uri(self, client_id, request, *args, **kwargs):
        return None  # Explicit registered redirect required on both legs.

    def validate_response_type(self, client_id, response_type, client, request, *args, **kwargs):
        return response_type == 'code' and 'authorization_code' in client.grant_types

    def validate_scopes(self, client_id, scopes, client, request, *args, **kwargs):
        allowed = set(client.scopes)
        if request.grant_type == 'client_credentials':
            allowed &= {'service:read'}
        else:
            allowed -= {'service:read'}
        return bool(scopes) and set(scopes) <= allowed

    def get_default_scopes(self, client_id, request, *args, **kwargs):
        return []

    def is_pkce_required(self, client_id, request):
        return True

    def client_authentication_required(self, request, *args, **kwargs):
        if request.headers.get('Authorization', '').lower().startswith('basic '):
            return True
        client = self.client(request.client_id)
        return not client or client.client_type == 'confidential'

    def authenticate_client(self, request, *args, **kwargs):
        client_id, secret = request.client_id, request.client_secret
        auth = request.headers.get('Authorization', '')
        if auth:
            try:
                if not auth.lower().startswith('basic ') or secret is not None:
                    return False
                raw = base64.b64decode(auth[6:], validate=True).decode()
                basic_id, basic_secret = map(unquote_plus, raw.split(':', 1))
                if client_id and client_id != basic_id:
                    return False
                client_id, secret = basic_id, basic_secret
            except (ValueError, UnicodeError):
                return False
        # Expensive bcrypt verification must not hold the client serialization lock.
        client = self.client(client_id)
        self.attempted_client = client
        if (not active_client(self.db, client) or client.client_type != 'confidential'
                or not secret or len(secret.encode()) > 72 or not verify_password(secret, client.secret_hash)):
            return False
        checked_hash = client.secret_hash
        client = self.client(client_id, lock=True)
        if not active_client(self.db, client) or not compare_digest(client.secret_hash or '', checked_hash):
            return False  # Rotation/disable during authentication must take effect.
        request.client, request.client_id = client, client.client_id
        return True

    def authenticate_client_id(self, client_id, request, *args, **kwargs):
        client = self.client(client_id, lock=True)
        if not active_client(self.db, client) or client.client_type != 'public' or request.client_secret or request.headers.get('Authorization'):
            return False
        request.client = client
        return True

    def validate_grant_type(self, client_id, grant_type, client, request, *args, **kwargs):
        return grant_type in client.grant_types and (grant_type != 'client_credentials' or client.client_type == 'confidential')

    def save_authorization_code(self, client_id, code, request, *args, **kwargs):
        grant = OAuthGrant(client_id=request.client.id, tenant_id=request.user.tenant_id,
            user_id=request.user.id, credentials_version=request.user.credentials_version,
            scopes=request.scopes, expires_at=epoch() + GRANT_SECONDS)
        self.db.add(grant)
        self.db.flush()
        self.db.add(OAuthCode(verifier=digest(code['code']), grant_id=grant.id,
            tenant_id=grant.tenant_id, redirect_uri=request.redirect_uri,
            challenge=request.code_challenge, expires_at=epoch() + 120))
        event(self.db, request.client, 'consent_allowed', request.user.id)

    def validate_code(self, client_id, code, client, request, *args, **kwargs):
        row = self.db.get(OAuthCode, digest(code))
        if not row:
            return False
        grant = self.db.get(OAuthGrant, row.grant_id)
        if not grant or grant.client_id != client.id:
            return False
        if row.consumed_at:
            revoke_grant(self.db, grant, 'code_reuse')
            return False
        if row.expires_at <= epoch() or not active_grant(self.db, grant):
            return False
        request.code_row, request.grant = row, grant
        request.user, request.scopes = self.db.get(User, grant.user_id), grant.scopes
        return True

    def get_code_challenge(self, code, request):
        return request.code_row.challenge

    def get_code_challenge_method(self, code, request):
        return 'S256'

    def confirm_redirect_uri(self, client_id, code, redirect_uri, client, request, *args, **kwargs):
        return redirect_uri == request.code_row.redirect_uri and redirect_uri in client.redirect_uris

    def invalidate_authorization_code(self, client_id, code, request, *args, **kwargs):
        pass  # Consumed atomically in save_bearer_token before tokens are persisted.

    def validate_refresh_token(self, refresh_token, client, request, *args, **kwargs):
        row = self.db.scalar(select(OAuthToken).where(OAuthToken.verifier == digest(refresh_token), OAuthToken.kind == 'refresh'))
        grant = self.db.get(OAuthGrant, row.grant_id) if row else None
        if not grant or grant.client_id != client.id:
            return False
        if row.consumed_at:
            revoke_grant(self.db, grant, 'refresh_reuse')
            return False
        if not token_record(self.db, refresh_token, 'refresh'):
            return False
        request.refresh_row, request.grant = row, grant
        request.user = self.db.get(User, grant.user_id)
        return True

    def get_original_scopes(self, refresh_token, request, *args, **kwargs):
        return request.refresh_row.scopes

    def rotate_refresh_token(self, request):
        return True

    def save_bearer_token(self, token, request, *args, **kwargs):
        # Charge a client only after authentication + grant/PKCE validation.
        # A forged public client_id must not lock out a legitimate integration.
        count = self.db.scalar(_rate_statement(self.db, 'authenticated-client:' + request.client.id))
        if count > 120:
            raise IssuanceRateExceeded(description='Token issuance rate exceeded; retry after the current minute')
        if request.grant_type == 'client_credentials':
            grant = OAuthGrant(client_id=request.client.id, tenant_id=request.client.tenant_id,
                scopes=request.scopes, expires_at=epoch() + ACCESS_SECONDS)
            self.db.add(grant)
            self.db.flush()
        else:
            grant = request.grant
            if grant.expires_at <= epoch():
                raise InvalidGrantError()
            model, row = (OAuthCode, request.code_row) if request.grant_type == 'authorization_code' else (OAuthToken, request.refresh_row)
            key = model.verifier == row.verifier
            consumed = self.db.execute(update(model).where(key, model.consumed_at.is_(None)).values(consumed_at=epoch()))
            if consumed.rowcount != 1:
                revoke_grant(self.db, grant, 'credential_reuse')
                raise InvalidGrantError()
        if ('offline_access' not in request.scopes or 'refresh_token' not in request.client.grant_types
                or request.grant_type == 'client_credentials'):
            token.pop('refresh_token', None)
        now = epoch()
        token['expires_in'] = min(ACCESS_SECONDS, grant.expires_at - now)
        for name, kind, lifetime in [('access_token', 'access', ACCESS_SECONDS), ('refresh_token', 'refresh', REFRESH_SECONDS)]:
            if name in token:
                self.db.add(OAuthToken(verifier=digest(token[name]), kind=kind, grant_id=grant.id,
                    tenant_id=grant.tenant_id, issuer=settings().oauth_issuer, audience=settings().oauth_audience,
                    scopes=request.scopes, expires_at=min(now + lifetime, grant.expires_at)))
        event(self.db, request.client, 'token_issued', grant.user_id)

    def revoke_token(self, token, token_type_hint, request, *args, **kwargs):
        row = self.db.scalar(select(OAuthToken).where(OAuthToken.verifier == digest(token)))
        if row:
            grant = self.db.get(OAuthGrant, row.grant_id)
            if grant.client_id == request.client.id:
                revoke_grant(self.db, grant)

    def introspect_token(self, token, token_type_hint, request, *args, **kwargs):
        row = token_record(self.db, token)
        if not row:
            return None
        grant = self.db.get(OAuthGrant, row.grant_id)
        if grant.client_id != request.client.id:
            return None
        return dict(scope=' '.join(row.scopes), client_id=request.client.client_id,
            token_type='Bearer', exp=row.expires_at, iat=row.created_at,
            sub=grant.user_id or 'service:' + request.client.client_id,
            aud=row.audience, iss=row.issuer, jti=row.id, tenant_id=str(row.tenant_id))


def server(db):
    instance = Server(Validator(db), token_expires_in=ACCESS_SECONDS,
        token_generator=lambda _: 'zoa_' + token_urlsafe(48),
        refresh_token_generator=lambda _: 'zor_' + token_urlsafe(48))
    # Remove unwanted grants rather than relying on unimplemented callbacks.
    instance._grant_types = {key: value for key, value in instance._grant_types.items()
                             if key in {'authorization_code', 'refresh_token', 'client_credentials'}}
    instance._response_types = {'code': instance.auth_grant}
    instance.auth_grant._code_challenge_methods = {'S256': instance.auth_grant._code_challenge_methods['S256']}
    return instance
