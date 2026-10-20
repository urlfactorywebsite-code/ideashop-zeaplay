"""OAuth protocol and tenant-scoped management using existing identities."""
import json
import re
from secrets import token_urlsafe
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.routing import APIRoute
from oauthlib.oauth2 import OAuth2Error
from oauthlib.oauth2.rfc6749.errors import FatalClientError
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session, aliased
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from ..dependencies import get_current_active_user
from ..models import RoleEnum, User, UserStatusEnum
from ..oauth_models import (
    OAuthClient,
    OAuthConsent,
    OAuthEvent,
    OAuthGrant,
    OAuthToken,
    epoch,
)
from ..oauth_schemas import SCOPES, AuthorizationInput, ClientInput, ConsentInput
from ..services import oauth


def no_store(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Referrer-Policy'] = 'no-referrer'


def secure_management(request: Request):
    if request.url.path.removeprefix('/api') not in {'/oauth2/token', '/oauth2/revoke', '/oauth2/introspect'} and not oauth.secure_transport(request):
        raise HTTPException(400, 'HTTPS is required in production')


class OAuthRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def validated(request):
            try:
                return await original(request)
            except RequestValidationError as error:
                # Pydantic's default 'input' can echo a mistakenly submitted secret.
                detail = [{key: item[key] for key in ('loc', 'msg', 'type')} for item in error.errors()]
                return JSONResponse({'detail': detail}, 422, headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'})
        return validated


router = APIRouter(prefix='/oauth2', tags=['OAuth'], route_class=OAuthRoute,
                   dependencies=[Depends(no_store), Depends(secure_management)])

AUTHORIZATION_SCHEMA = AuthorizationInput.model_json_schema()
AUTHORIZATION_DOC = {'parameters': [dict(name=key, **{'in': 'query'}, required=True, schema=value)
    for key, value in AUTHORIZATION_SCHEMA['properties'].items()]}
def form_document(properties, required):
    schema = {'type': 'object', 'required': required, 'properties': properties}
    content = {'application/x-www-form-urlencoded': {'schema': schema}}
    return {'requestBody': {'required': True, 'content': content}}


TOKEN_DOC = form_document({
    'grant_type': {'type': 'string', 'enum': ['authorization_code', 'refresh_token', 'client_credentials']},
    **{key: {'type': 'string', 'writeOnly': key in {'client_secret', 'code', 'code_verifier', 'refresh_token'}}
       for key in ['client_id', 'client_secret', 'code', 'code_verifier', 'redirect_uri', 'refresh_token', 'scope']}
}, ['grant_type'])
TOKEN_ACTION_DOC = form_document({key: {'type': 'string', 'writeOnly': True}
    for key in ['token', 'token_type_hint', 'client_id', 'client_secret']}, ['token'])


def administrator(user: User = Depends(get_current_active_user)):
    if user.role not in {RoleEnum.OWNER, RoleEnum.ADMIN}:
        raise HTTPException(403, 'OAuth administration requires owner or admin privileges')
    return user


def owned_client(db, user, client_id):
    client = db.scalar(select(OAuthClient).where(OAuthClient.id == client_id, OAuthClient.tenant_id == user.tenant_id).with_for_update())
    if not client:
        raise HTTPException(404, 'OAuth client not found')
    return client


@router.get('/scopes')
def scopes(user=Depends(get_current_active_user)):
    return [{'id': key, 'description': value, 'sensitive': key == 'offline_access'} for key, value in SCOPES.items()]


@router.get('/clients')
def clients(q: str = '', status: str = 'all', db: Session = Depends(get_db), user=Depends(administrator)):
    query = select(OAuthClient).where(OAuthClient.tenant_id == user.tenant_id)
    if q:
        query = query.where(OAuthClient.name.ilike('%' + q[:150].replace('%', '\\%').replace('_', '\\_') + '%', escape='\\'))
    if status in {'enabled', 'disabled'}:
        query = query.where(OAuthClient.enabled == (status == 'enabled'))
    return [oauth.client_metadata(c) for c in db.scalars(query.order_by(OAuthClient.created_at.desc()).limit(500))]


@router.post('/clients', status_code=201)
def create_client(payload: ClientInput, db: Session = Depends(get_db), user=Depends(administrator)):
    owner = db.get(User, payload.owner_id or user.id)
    if not owner or owner.tenant_id != user.tenant_id:
        raise HTTPException(422, 'Application owner must belong to your tenant')
    client = OAuthClient(id=token_urlsafe(24), client_id=token_urlsafe(32), tenant_id=user.tenant_id,
        owner_id=owner.id, **payload.model_dump(exclude={'owner_id'}))
    secret = oauth.rotate_secret(client) if client.client_type == 'confidential' else None
    db.add(client)
    db.flush()
    oauth.event(db, client, 'client_created', user.id)
    db.commit()
    return {'client': oauth.client_metadata(client), 'client_secret': secret}


@router.get('/clients/{client_id}')
def client_detail(client_id: str, db: Session = Depends(get_db), user=Depends(administrator)):
    return oauth.client_metadata(owned_client(db, user, client_id))


@router.patch('/clients/{client_id}')
def update_client(client_id: str, payload: ClientInput, db: Session = Depends(get_db), user=Depends(administrator)):
    client = owned_client(db, user, client_id)
    if client.archived or payload.client_type != client.client_type:
        raise HTTPException(409, 'Archived clients and client type cannot be changed; register a new client')
    owner = db.get(User, payload.owner_id or client.owner_id)
    if not owner or owner.tenant_id != user.tenant_id:
        raise HTTPException(422, 'Application owner must belong to your tenant')
    for key, value in payload.model_dump(exclude={'owner_id'}).items():
        setattr(client, key, value)
    client.owner_id, client.updated_at = owner.id, epoch()
    oauth.revoke_client(db, client, 'client_updated_grants_revoked', user.id)
    db.commit()
    return oauth.client_metadata(client)


@router.post('/clients/{client_id}/rotate')
def rotate_client(client_id: str, db: Session = Depends(get_db), user=Depends(administrator)):
    client = owned_client(db, user, client_id)
    if client.client_type != 'confidential' or client.archived:
        raise HTTPException(409, 'Only non-archived confidential clients have secrets')
    secret = oauth.rotate_secret(client)
    client.updated_at = epoch()
    oauth.revoke_client(db, client, 'secret_rotated_grants_revoked', user.id)
    db.commit()
    return {'client': oauth.client_metadata(client), 'client_secret': secret}


@router.post('/clients/{client_id}/revoke')
def deactivate_client(client_id: str, db: Session = Depends(get_db), user=Depends(administrator)):
    client = owned_client(db, user, client_id)
    client.enabled, client.updated_at = False, epoch()
    oauth.revoke_client(db, client, 'client_disabled', user.id)
    db.commit()
    return oauth.client_metadata(client)


@router.delete('/clients/{client_id}', status_code=204)
def archive_client(client_id: str, db: Session = Depends(get_db), user=Depends(administrator)):
    client = owned_client(db, user, client_id)
    client.enabled, client.archived, client.secret_hash = False, True, None
    client.updated_at = epoch()
    oauth.revoke_client(db, client, 'client_archived', user.id)
    db.commit()


def grant_metadata(db, grant):
    client = db.get(OAuthClient, grant.client_id)
    return dict(id=grant.id, client_id=client.client_id, client_name=client.name,
        tenant_id=str(grant.tenant_id), user_id=grant.user_id, scopes=grant.scopes,
        created_at=grant.created_at, expires_at=grant.expires_at, revoked_at=grant.revoked_at,
        active=oauth.active_grant(db, grant), last_used_at=grant.last_used_at)


@router.get('/grants')
def grants(db: Session = Depends(get_db), user=Depends(administrator)):
    return [grant_metadata(db, g) for g in db.scalars(select(OAuthGrant).where(OAuthGrant.tenant_id == user.tenant_id).order_by(OAuthGrant.created_at.desc()).limit(500))]


@router.get('/my-grants')
def my_grants(db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    return [grant_metadata(db, g) for g in db.scalars(select(OAuthGrant).where(OAuthGrant.tenant_id == user.tenant_id, OAuthGrant.user_id == user.id).order_by(OAuthGrant.created_at.desc()).limit(500))]


@router.post('/grants/{grant_id}/revoke')
def revoke(grant_id: str, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    grant = db.get(OAuthGrant, grant_id)
    if (not grant or grant.tenant_id != user.tenant_id
            or (grant.user_id != user.id and user.role not in {RoleEnum.OWNER, RoleEnum.ADMIN})):
        raise HTTPException(404, 'Grant not found')
    owned_client(db, user, grant.client_id)
    oauth.revoke_grant(db, grant, actor_id=user.id)
    db.commit()
    return {'revoked': True}


@router.get('/tokens')
def tokens(db: Session = Depends(get_db), user=Depends(administrator)):
    rows = db.execute(select(OAuthToken, OAuthGrant, OAuthClient).join(OAuthGrant, OAuthToken.grant_id == OAuthGrant.id)
        .join(OAuthClient, OAuthGrant.client_id == OAuthClient.id).where(OAuthToken.tenant_id == user.tenant_id)
        .order_by(OAuthToken.created_at.desc(), OAuthToken.id).limit(500))
    return [{**{key: getattr(t, key) for key in ('id', 'kind', 'grant_id', 'scopes', 'created_at', 'expires_at', 'consumed_at', 'last_used_at')},
        'revoked_at': t.revoked_at or g.revoked_at,
        'active': bool(not t.revoked_at and not t.consumed_at and t.expires_at > epoch() and oauth.active_grant(db, g)
                       and t.issuer == oauth.settings().oauth_issuer and t.audience == oauth.settings().oauth_audience),
        'client_id': c.client_id, 'client_name': c.name, 'user_id': g.user_id, 'tenant_id': str(t.tenant_id)} for t, g, c in rows]


@router.get('/events')
def events(db: Session = Depends(get_db), user=Depends(administrator)):
    return [{key: getattr(e, key) for key in ('id', 'client_id', 'actor_id', 'action', 'created_at')}
            for e in db.scalars(select(OAuthEvent).where(OAuthEvent.tenant_id == user.tenant_id).order_by(OAuthEvent.created_at.desc()).limit(100))]


@router.get('/dashboard')
def dashboard(db: Session = Depends(get_db), user=Depends(administrator)):
    now = epoch()
    tenant = user.tenant_id
    total, enabled = db.execute(select(func.count(), func.coalesce(func.sum(case((OAuthClient.enabled.is_(True), 1), else_=0)), 0))
        .where(OAuthClient.tenant_id == tenant)).one()
    owner, subject = aliased(User), aliased(User)
    active = db.scalar(select(func.count()).select_from(OAuthGrant)
        .join(OAuthClient, OAuthClient.id == OAuthGrant.client_id)
        .join(owner, owner.id == OAuthClient.owner_id)
        .outerjoin(subject, subject.id == OAuthGrant.user_id)
        .where(OAuthGrant.tenant_id == tenant, OAuthClient.tenant_id == tenant,
            OAuthGrant.revoked_at.is_(None), OAuthGrant.expires_at > now,
            OAuthClient.enabled.is_(True), OAuthClient.archived.is_(False),
            owner.tenant_id == tenant, owner.status == UserStatusEnum.ACTIVE,
            or_(OAuthClient.client_type == 'public', and_(OAuthClient.secret_hash.is_not(None), OAuthClient.secret_expires_at > now)),
            or_(OAuthGrant.user_id.is_(None), and_(subject.tenant_id == tenant, subject.status == UserStatusEnum.ACTIVE,
                subject.credentials_version == OAuthGrant.credentials_version))))
    revoked = db.scalar(select(func.count()).select_from(OAuthGrant).where(OAuthGrant.tenant_id == tenant, OAuthGrant.revoked_at.is_not(None)))
    day_expr = OAuthEvent.created_at - OAuthEvent.created_at % 86400
    buckets = db.execute(select(day_expr.label('day'), OAuthEvent.action, func.count()).where(
        OAuthEvent.tenant_id == tenant, OAuthEvent.created_at >= (now // 86400 - 6) * 86400).group_by(day_expr, OAuthEvent.action)).all()
    trends = []
    for offset in range(6, -1, -1):
        day = (now // 86400 - offset) * 86400
        trends.append(dict(day=day, issued=sum(count for when, action, count in buckets if when == day and action == 'token_issued'),
            errors=sum(count for when, action, count in buckets if when == day and action.startswith('protocol_error'))))
    recent = db.scalar(select(func.count()).select_from(OAuthEvent).where(OAuthEvent.tenant_id == tenant, OAuthEvent.created_at >= now - 7 * 86400))
    expiring = db.scalars(select(OAuthClient).where(OAuthClient.tenant_id == tenant, OAuthClient.archived.is_(False),
        OAuthClient.secret_expires_at <= now + 14 * 86400).order_by(OAuthClient.secret_expires_at).limit(100))
    usage = db.execute(select(OAuthClient.name, func.count(OAuthGrant.id)).outerjoin(OAuthGrant, OAuthGrant.client_id == OAuthClient.id)
        .where(OAuthClient.tenant_id == tenant).group_by(OAuthClient.id, OAuthClient.name).order_by(func.count(OAuthGrant.id).desc(), OAuthClient.id).limit(100)).all()
    return dict(configured=bool(oauth.settings().oauth_issuer and oauth.settings().oauth_ui_url), tenant_id=str(tenant),
        total_clients=total, enabled_clients=enabled, disabled_clients=total - enabled, active_grants=active,
        revoked_grants=revoked, recent_activity=recent, trends=trends,
        expiring_credentials=[oauth.client_metadata(c) for c in expiring],
        usage=[dict(client_name=name, grants=count) for name, count in usage])


def validate_authorization(db, params, user=None, redirect_errors=False):
    client = db.scalar(select(OAuthClient).where(OAuthClient.client_id == params.client_id).with_for_update())
    if not oauth.active_client(db, client) or (user and client.tenant_id != user.tenant_id):
        raise HTTPException(400, 'Invalid client or tenant')
    try:
        oauth.server(db).validate_authorization_request(oauth.settings().oauth_issuer + '/authorize?' + urlencode(params.model_dump()))
    except OAuth2Error as error:
        if redirect_errors and not isinstance(error, FatalClientError):
            location = error.in_uri(params.redirect_uri) + '&' + urlencode({'iss': oauth.settings().oauth_issuer})
            raise HTTPException(303, {'error': error.error}, headers={'Location': location,
                'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}) from None
        raise HTTPException(400, {'error': error.error}) from None
    return client


@router.get('/authorize', openapi_extra=AUTHORIZATION_DOC)
def authorize(request: Request, db: Session = Depends(get_db)):
    oauth.configured()
    oauth.rate_limit(db, request)
    try:
        if len(list(request.query_params.multi_items())) != len(dict(request.query_params)):
            raise ValueError('Duplicate parameter')
        params = AuthorizationInput.model_validate(dict(request.query_params))
    except ValueError:
        raise HTTPException(400, {'error': 'invalid_request'}) from None
    validate_authorization(db, params, redirect_errors=True)
    response = RedirectResponse(oauth.settings().oauth_ui_url + '?' + urlencode(params.model_dump()), status_code=303)
    no_store(response)
    return response


@router.post('/consent/prepare')
def prepare(payload: AuthorizationInput, request: Request, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    oauth.configured()
    oauth.rate_limit(db, request)
    client = validate_authorization(db, payload, user)
    ticket = token_urlsafe(32)
    db.add(OAuthConsent(verifier=oauth.digest(ticket), client_id=client.id, tenant_id=user.tenant_id,
        user_id=user.id, credentials_version=user.credentials_version, parameters=payload.model_dump(), expires_at=epoch() + 300))
    db.commit()
    return dict(ticket=ticket, application=client.name, description=client.description,
        tenant_id=str(user.tenant_id), redirect_uri=payload.redirect_uri,
        scopes=[dict(id=s, description=SCOPES[s], sensitive=s == 'offline_access') for s in payload.scope.split()], verified=False)


@router.post('/consent')
def consent(payload: ConsentInput, db: Session = Depends(get_db), user=Depends(get_current_active_user)):
    oauth.configured()
    row = db.get(OAuthConsent, oauth.digest(payload.ticket))
    if (not row or row.user_id != user.id or row.tenant_id != user.tenant_id or row.consumed_at
            or row.expires_at <= epoch() or row.credentials_version != user.credentials_version):
        raise HTTPException(400, 'Consent request expired or invalid')
    params = AuthorizationInput.model_validate(row.parameters)
    client = validate_authorization(db, params, user)
    claimed = db.execute(update(OAuthConsent).where(OAuthConsent.verifier == row.verifier, OAuthConsent.consumed_at.is_(None)).values(consumed_at=epoch()))
    if claimed.rowcount != 1:
        raise HTTPException(400, 'Consent request already used')
    if not payload.allow:
        oauth.event(db, client, 'consent_denied', user.id)
        redirect = params.redirect_uri + ('&' if urlsplit(params.redirect_uri).query else '?') + urlencode(dict(error='access_denied', state=params.state, iss=oauth.settings().oauth_issuer))
    else:
        headers, _body, code = oauth.server(db).create_authorization_response(
            oauth.settings().oauth_issuer + '/authorize?' + urlencode(params.model_dump()),
            scopes=params.scope.split(), credentials={'user': user})
        if code != 302:
            raise HTTPException(400, 'Authorization failed')
        redirect = headers['Location'] + '&' + urlencode({'iss': oauth.settings().oauth_issuer})
    db.commit()
    return {'redirect_to': redirect}


async def protocol(operation, request, db):
    oauth.configured()
    if request.query_params:
        return JSONResponse({'error': 'invalid_request', 'error_description': 'Send OAuth parameters in the form body, never in the URL'}, 400,
                            headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'})
    if not oauth.secure_transport(request):
        return JSONResponse({'error': 'invalid_request', 'error_description': 'HTTPS is required in production'}, 400,
                            headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'})
    if request.headers.get('content-type', '').split(';')[0] != 'application/x-www-form-urlencoded':
        return JSONResponse({'error': 'invalid_request'}, 400, headers={'Cache-Control': 'no-store'})
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > 8192:
            raise HTTPException(413, 'OAuth request too large')
    body = chunks.decode('utf-8', errors='replace')
    return await run_in_threadpool(protocol_response, operation, request, db, body)


def protocol_response(operation, request, db, body):
    pairs = parse_qsl(body, keep_blank_values=True)
    params = dict(pairs)
    oauth.rate_limit(db, request)
    if len(params) != len(pairs):
        return JSONResponse({'error': 'invalid_request'}, 400, headers={'Cache-Control': 'no-store'})
    if operation == 'token' and not params.get('grant_type'):
        return JSONResponse({'error': 'invalid_request'}, 400, headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'})
    if operation == 'token' and params.get('grant_type') not in {'authorization_code', 'refresh_token', 'client_credentials'}:
        return JSONResponse({'error': 'unsupported_grant_type'}, 400, headers={'Cache-Control': 'no-store'})
    if operation == 'token' and params.get('grant_type') == 'authorization_code' and not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}', params.get('code_verifier', '')):
        return JSONResponse({'error': 'invalid_grant'}, 400, headers={'Cache-Control': 'no-store'})
    engine = oauth.server(db)
    method = {'token': engine.create_token_response, 'revoke': engine.create_revocation_response, 'introspect': engine.create_introspect_response}[operation]
    try:
        headers, result, code = method(oauth.settings().oauth_issuer + '/' + operation,
            http_method='POST', body=body, headers={'Authorization': request.headers.get('authorization', ''), 'Content-Type': 'application/x-www-form-urlencoded'})
    except OAuth2Error as error:
        headers, result, code = {}, error.json, error.status_code
        if code == 429:
            headers['Retry-After'] = '60'
    if code >= 400:
        client = getattr(engine.request_validator, 'attempted_client', None) or engine.request_validator.client(params.get('client_id'))
        if client:
            oauth.event(db, client, 'protocol_error:' + str(json.loads(result).get('error', 'unknown'))[:40])
    db.commit()
    headers.update({'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer'})
    return Response(content=result, status_code=code, headers=headers, media_type='application/json')


@router.post('/token', openapi_extra=TOKEN_DOC)
async def token(request: Request, db: Session = Depends(get_db)):
    return await protocol('token', request, db)


@router.post('/revoke', openapi_extra=TOKEN_ACTION_DOC)
async def revocation(request: Request, db: Session = Depends(get_db)):
    return await protocol('revoke', request, db)


@router.post('/introspect', openapi_extra=TOKEN_ACTION_DOC)
async def introspection(request: Request, db: Session = Depends(get_db)):
    return await protocol('introspect', request, db)


@router.get('/profile')
def profile(user=Depends(get_current_active_user)):
    return dict(id=user.id, name=user.name, tenant_id=str(user.tenant_id))


@router.get('/service')
def service(request: Request, db: Session = Depends(get_db)):
    from fastapi.security.utils import get_authorization_scheme_param
    scheme, value = get_authorization_scheme_param(request.headers.get('authorization'))
    if scheme.lower() != 'bearer':
        value = ''
    record = oauth.token_record(db, value, 'access')
    grant = db.get(OAuthGrant, record.grant_id) if record else None
    if not grant:
        raise HTTPException(401, 'Invalid service token', headers={'WWW-Authenticate': 'Bearer error="invalid_token"'})
    if grant.user_id or 'service:read' not in record.scopes:
        raise HTTPException(403, 'Service scope required', headers={'WWW-Authenticate': 'Bearer error="insufficient_scope"'})
    client = db.get(OAuthClient, grant.client_id)
    record.last_used_at = grant.last_used_at = epoch()
    db.commit()
    return dict(sub='service:' + client.client_id, tenant_id=str(client.tenant_id), name=client.name)


@router.get('/.well-known/oauth-authorization-server')
def metadata():
    oauth.configured()
    issuer = oauth.settings().oauth_issuer
    return dict(issuer=issuer, authorization_endpoint=issuer + '/authorize', token_endpoint=issuer + '/token',
        revocation_endpoint=issuer + '/revoke', introspection_endpoint=issuer + '/introspect',
        response_types_supported=['code'], grant_types_supported=['authorization_code', 'refresh_token', 'client_credentials'],
        token_endpoint_auth_methods_supported=['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported=['S256'], scopes_supported=list(SCOPES), authorization_response_iss_parameter_supported=True)


discovery_router = APIRouter(tags=['OAuth'])


@discovery_router.get('/.well-known/oauth-authorization-server/{issuer_path:path}', dependencies=[Depends(no_store)])
def discovery(issuer_path: str):
    oauth.configured()
    if '/' + issuer_path != urlsplit(oauth.settings().oauth_issuer).path:
        raise HTTPException(404, 'Unknown OAuth issuer')
    return metadata()
