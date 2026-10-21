"""Tenant policy persistence and restrictive authorization, without a policy cache."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .. import models
from ..navigation_registry import API_SECTIONS, PAGES, REGISTRY, api_pages


def load(db, tenant_id):
    try:
        return db.get(models.NavigationPolicy, str(tenant_id))
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(503, 'Navigation policy storage unavailable. Apply the navigation migration before enabling this release.') from exc


def decision(page_id, role, rules):
    page = REGISTRY[page_id]
    role = getattr(role, 'value', role)
    rule = rules.get(page_id, {})
    if role not in page.roles:
        return 'forbidden'
    if page.parent:
        parent = decision(page.parent, role, rules)
        if parent in {'disabled', 'forbidden'}:
            return parent
    if not rule.get('enabled', True):
        return 'disabled'
    if role not in rule.get('allowedRoles', page.roles):
        return 'forbidden'
    if rule.get('hidden', False) or (page.parent and decision(page.parent, role, rules) == 'hidden'):
        return 'hidden'
    return 'allowed'


def oauth_management_access(role, rules):
    """Keep saved API restrictions until an owner explicitly saves OAuth rules.

    Own authorized-app connections retain their separate existing policy.
    """
    role = getattr(role, 'value', role)
    if role not in {'owner', 'admin'}:
        return 'forbidden'
    access = decision('settings.oauth', role, rules)
    if access in {'disabled', 'forbidden'}:
        return access
    if 'settings.oauth' not in rules and 'settings.api' in rules:
        return decision('settings.api', role, rules)
    return access


def document(db, user):
    row = load(db, user.tenant_id)
    rules = row.rules if row else {}
    return {
        'revision': row.revision if row else 0,
        'updatedAt': row.updated_at if row else None,
        'updatedBy': row.updated_by if row else None,
        'canManageGlobal': user.role == models.RoleEnum.OWNER,
        'canManagePersonal': user.role in {models.RoleEnum.OWNER, models.RoleEnum.ADMIN},
        'roles': [role.value for role in models.RoleEnum],
        'actorRole': user.role.value,
        'oauthManagementAccess': oauth_management_access(user.role, rules),
        'apiSections': [{'key': key, 'label': label, 'access':
            'forbidden' if user.role.value not in roles else decision('settings.api', user.role, rules)}
            for key, label, roles in API_SECTIONS],
        'pages': [{
            'id': page.id, 'parentId': page.parent, 'defaultLabel': page.label,
            'route': page.route, 'navigationLocation': page.location,
            'enabled': rules.get(page.id, {}).get('enabled', True),
            'hidden': rules.get(page.id, {}).get('hidden', False),
            'allowedRoles': rules.get(page.id, {}).get('allowedRoles', list(page.roles)),
            'permittedRoles': list(page.roles), 'isSystemProtected': page.protected,
            'sortOrder': rules.get(page.id, {}).get('sortOrder', index),
            'access': decision(page.id, user.role, rules),
        } for index, page in enumerate(PAGES)],
    }


def enforce_request(db, user, path, method):
    normalized = path.removeprefix('/api').rstrip('/')
    if normalized == f'/users/{user.id}/avatar':
        return  # Existing own-avatar authorization is a profile recovery action.
    pages = api_pages(path, method)
    if not pages:
        return
    row = load(db, user.tenant_id)
    rules = row.rules if row else {}
    for page_id in pages:
        access = oauth_management_access(user.role, rules) if page_id == 'settings.oauth' else api_decision(page_id, user.role, rules)
        if access in {'disabled', 'forbidden'}:
            code = 'MODULE_DISABLED' if access == 'disabled' else 'PAGE_FORBIDDEN'
            raise HTTPException(403, {'code': code, 'pageId': page_id,
                                     'message': 'This module is disabled for this workspace.' if access == 'disabled' else 'Your role is not permitted to access this page.'})


def api_decision(page_id, role, rules):
    """Navigation is not a grant of API permission. Preserve independent shared
    reads by default; explicit module shutdowns and role revocations narrow them.
    Existing endpoint authorization always runs after this additional check.
    """
    page = REGISTRY[page_id]
    role = getattr(role, 'value', role)
    if page_id.startswith('settings.'):
        return decision(page_id, role, rules)
    if page.parent:
        parent = api_decision(page.parent, role, rules)
        if parent in {'disabled', 'forbidden'}:
            return parent
    rule = rules.get(page_id, {})
    if not rule.get('enabled', True):
        return 'disabled'
    # A navigation role ceiling does not replace the authorization on a shared
    # endpoint (for example a scoped client lookup used by an ordinary task user).
    if role in page.roles and role not in rule.get('allowedRoles', page.roles):
        return 'forbidden'
    return 'allowed'


def socket_allowed(db, user, page_id):
    """Recheck at handshake, incoming messages and fanout; no stale socket grants."""
    try:
        row = load(db, user.tenant_id)
        return decision(page_id, user.role, row.rules if row else {}) in {'allowed', 'hidden'}
    except HTTPException:
        return False


def save(db, user, payload, request=None):
    if user.role != models.RoleEnum.OWNER:
        raise HTTPException(403, 'Only owners may change workspace access policies. Admins may customize their personal layout.')
    rules = {}
    for entry in payload.pages:
        if entry.id in rules or entry.id not in REGISTRY:
            raise HTTPException(422, 'Unknown or duplicate page identifier.')
        page = REGISTRY[entry.id]
        roles = [role.value for role in entry.allowedRoles]
        if len(set(roles)) != len(roles) or not set(roles) <= set(page.roles):
            raise HTTPException(422, f'Roles exceed established permissions for {entry.id}.')
        if page.protected and (not entry.enabled or entry.hidden or set(roles) != set(page.roles)):
            raise HTTPException(422, f'{entry.id} is a protected recovery page.')
        rules[entry.id] = {'enabled': entry.enabled, 'hidden': entry.hidden, 'allowedRoles': roles, 'sortOrder': entry.sortOrder}
    if set(rules) != set(REGISTRY):
        raise HTTPException(422, 'A complete page configuration is required.')
    current = load(db, user.tenant_id)
    before = current.rules if current else {}
    now = datetime.now(timezone.utc)
    values = {'rules': rules, 'revision': payload.revision + 1, 'updated_by': str(user.id), 'updated_at': now}
    try:
        if payload.revision == 0:
            if current:
                raise HTTPException(409, 'Configuration changed. Reload the latest version before saving.')
            db.add(models.NavigationPolicy(tenant_id=str(user.tenant_id), **values))
            db.flush()
        else:
            result = db.execute(update(models.NavigationPolicy).where(
                models.NavigationPolicy.tenant_id == str(user.tenant_id),
                models.NavigationPolicy.revision == payload.revision).values(**values))
            if result.rowcount != 1:
                raise HTTPException(409, 'Configuration changed. Reload the latest version before saving.')
        # Audit and configuration are committed together, so neither can be lost alone.
        db.add(models.AuditLog(actor_id=str(user.id), actor_role=user.role.value,
            action='navigation.policy.updated', category=models.AuditLogCategoryEnum.SECURITY,
            entity_type='navigation_policy', entity_id=str(user.tenant_id),
            before=before, after=rules, metadata_payload={'tenant_id': str(user.tenant_id), 'revision': values['revision']},
            route=request.url.path if request else None, method='PUT'))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, 'Configuration changed. Reload the latest version before saving.') from exc
    except Exception:
        db.rollback()
        raise
    db.expire_all()
    return document(db, user)
