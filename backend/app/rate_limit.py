"""Lightweight in-memory rate limiting helpers."""

from __future__ import annotations

from collections import deque
from threading import Lock
from time import monotonic, time

from fastapi import HTTPException, status

from .config import get_settings

_BUCKETS: dict[str, deque[float]] = {}
_LOCK = Lock()

try:
    import redis
except ModuleNotFoundError:
    redis = None

_REDIS_CLIENT = None
_REDIS_LOCK = Lock()

def _cleanup(bucket: deque[float], cutoff: float) -> None:
    while bucket and bucket[0] < cutoff:
        bucket.popleft()


def _get_redis_client():
    settings = get_settings()
    if not settings.media_presign_rate_redis_url or redis is None:
        return None
    global _REDIS_CLIENT
    if _REDIS_CLIENT is None:
        with _REDIS_LOCK:
            if _REDIS_CLIENT is None:
                _REDIS_CLIENT = redis.Redis.from_url(settings.media_presign_rate_redis_url)
    return _REDIS_CLIENT


def _check_rate_limit_redis(key: str, *, limit: int, window_seconds: int) -> bool:
    client = _get_redis_client()
    if client is None:
        return False
    window = int(time() // window_seconds)
    redis_key = f"rl:{key}:{window}"
    try:
        count = client.incr(redis_key)
        if count == 1:
            client.expire(redis_key, window_seconds + 1)
        if count <= limit:
            return True
        retry_after = client.ttl(redis_key)
        if retry_after is None or retry_after < 0:
            retry_after = max(1, int(window_seconds - (time() % window_seconds)))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests, please slow down",
            headers={"Retry-After": str(retry_after)},
        )
    except redis.RedisError:
        return False


def check_rate_limit(key: str, *, limit: int, window_seconds: int) -> None:
    if limit <= 0 or window_seconds <= 0:
        return
    if _check_rate_limit_redis(key, limit=limit, window_seconds=window_seconds):
        return
    now = monotonic()
    cutoff = now - window_seconds
    with _LOCK:
        bucket = _BUCKETS.setdefault(key, deque())
        _cleanup(bucket, cutoff)
        if len(bucket) >= limit:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests, please slow down",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


def enforce_presign_rate_limit(user_id: str) -> None:
    settings = get_settings()
    check_rate_limit(
        f"presign:{user_id}",
        limit=settings.media_presign_rate_limit,
        window_seconds=settings.media_presign_rate_window_seconds,
    )
