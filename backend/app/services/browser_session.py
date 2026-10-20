"""HttpOnly browser session transport for Zea.Play's existing user authentication."""
from hashlib import sha256
from secrets import token_urlsafe

from fastapi import HTTPException

from ..config import get_settings
from ..models import User, UserStatusEnum
from ..oauth_models import BrowserSession, epoch
from .oauth import digest

COOKIE = 'zea_browser_session'


def http_exception(request):
    return (request.url.scheme == 'http'
            and request.headers.get('origin') in get_settings().browser_session_http_origins)


def cookie_name(request):
    if http_exception(request):
        # Keep plaintext cookies separate from HTTPS and other IP/port deployments.
        suffix = sha256(request.headers['origin'].encode()).hexdigest()[:12]
        return f'{COOKIE}_http_{suffix}'
    return '__Host-' + COOKIE if get_settings().environment == 'production' else COOKIE


def check_origin(request):
    origin = request.headers.get('origin')
    allowed = set(get_settings().cors_allow_origins)
    if request.headers.get('x-zea-browser') != '1' or not origin or origin not in allowed:
        raise HTTPException(403, 'Browser session origin check failed')
    if (get_settings().environment == 'production' and request.url.scheme != 'https'
            and not http_exception(request)):
        raise HTTPException(400, 'HTTPS is required for browser sessions')


def cookie_path(request):
    # Both /api and root aliases exist, and legacy reverse proxies strip /api.
    # This cookie is accepted ONLY by the explicit CSRF-protected session routes.
    return '/'


def start(db, user, request, response):
    check_origin(request)
    old = request.cookies.get(cookie_name(request))
    if old:
        row = db.get(BrowserSession, digest(old))
        if row:
            row.revoked_at = epoch()
    value = token_urlsafe(48)
    lifetime = get_settings().refresh_token_expire_minutes * 60
    db.add(BrowserSession(verifier=digest(value), user_id=user.id, tenant_id=user.tenant_id,
        credentials_version=user.credentials_version, expires_at=epoch() + lifetime))
    db.commit()
    response.set_cookie(cookie_name(request), value, max_age=lifetime, httponly=True,
        secure=request.url.scheme == 'https' or (get_settings().environment == 'production' and not http_exception(request)),
        samesite='lax', path=cookie_path(request))
    response.headers['Cache-Control'] = 'no-store'


def current(db, request):
    check_origin(request)
    value = request.cookies.get(cookie_name(request))
    row = db.get(BrowserSession, digest(value)) if value else None
    user = db.get(User, row.user_id) if row else None
    if (not row or row.revoked_at or row.expires_at <= epoch() or not user
            or user.status != UserStatusEnum.ACTIVE or user.tenant_id != row.tenant_id
            or user.credentials_version != row.credentials_version):
        raise HTTPException(401, 'Browser session expired')
    return user


def end(db, request, response):
    check_origin(request)
    value = request.cookies.get(cookie_name(request))
    row = db.get(BrowserSession, digest(value)) if value else None
    if row:
        row.revoked_at = epoch()
        db.commit()
    # Do not emit a delayed cookie deletion that could erase a newer login's
    # cookie in another tab. The stored identifier is now unusable; login replaces it.
    response.headers['Cache-Control'] = 'no-store'
