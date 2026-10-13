import json
from typing import Any, Iterable, Optional
from urllib.parse import urlencode

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None

from .config import get_settings


_REDIS_CLIENT: Optional[Any] = None


def _get_client() -> Optional[Any]:
    global _REDIS_CLIENT
    if redis is None:
        return None
    settings = get_settings()
    redis_url = settings.redis_url or settings.cache_redis_url
    if not redis_url:
        return None
    if _REDIS_CLIENT is None:
        _REDIS_CLIENT = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
        )
    return _REDIS_CLIENT


def _cache_prefix() -> str:
    return get_settings().cache_prefix


def get_cache_prefix() -> str:
    return _cache_prefix()


def get_redis_client() -> Optional[Any]:
    return _get_client()


def build_cache_key(
    *,
    resource: str,
    tenant_id: str,
    user_id: str,
    path: str,
    params: Iterable[tuple[str, str]],
) -> str:
    query = urlencode(list(params), doseq=True)
    return f"{_cache_prefix()}:{resource}:tenant:{tenant_id}:user:{user_id}:path:{path}?{query}"


def tenant_prefix(*, resource: str, tenant_id: str) -> str:
    return f"{_cache_prefix()}:{resource}:tenant:{tenant_id}:"


def get_cached_json(cache_key: str) -> Optional[Any]:
    client = _get_client()
    if client is None:
        return None
    payload = client.get(cache_key)
    if not payload:
        return None
    return json.loads(payload)


def set_cached_json(cache_key: str, value: Any, *, ttl_seconds: int) -> None:
    client = _get_client()
    if client is None:
        return
    client.setex(cache_key, ttl_seconds, json.dumps(value))


def invalidate_prefix(prefix: str) -> None:
    client = _get_client()
    if client is None:
        return
    keys = list(client.scan_iter(match=f"{prefix}*"))
    if keys:
        client.delete(*keys)
