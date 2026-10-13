# Redis Cache Notes

Workloads to cache (TTL 15-60s):
- GET /tasks list per tenant/user
- GET /tickets list per tenant/user
- Dashboard summary cards
- Static lookup tables (departments, levels, kanban columns)

Python cache helper usage:
from app.cache import build_cache_key, get_cached_json, set_cached_json

cache_key = build_cache_key(
    resource="tasks:list",
    tenant_id=str(current_user.tenant_id),
    user_id=str(current_user.id),
    path=request.url.path,
    params=request.query_params.multi_items(),
)
cached = get_cached_json(cache_key)
if cached is not None:
    return cached

set_cached_json(cache_key, payload, ttl_seconds=30)

Invalidation:
from app.cache import invalidate_prefix, tenant_prefix
invalidate_prefix(tenant_prefix(resource="tasks:list", tenant_id=str(current_user.tenant_id)))
