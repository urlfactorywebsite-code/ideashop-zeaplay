from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from ..cache import get_cache_prefix, get_redis_client

logger = logging.getLogger("zeaplay.chat.realtime")

CHAT_EVENT_CHANNEL = f"{get_cache_prefix()}:chat:events"
EVENT_VERSION = "v1"
INSTANCE_ID = uuid4().hex

_listener_thread: threading.Thread | None = None
_stop_event = threading.Event()
_pubsub = None


def build_event(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": EVENT_VERSION,
        "type": event_type,
        "payload": payload,
        "sent_at": datetime.utcnow().isoformat(),
        "origin": INSTANCE_ID,
    }


def publish_chat_event(event_type: str, payload: dict[str, Any]) -> None:
    client = get_redis_client()
    if client is None:
        return
    client.publish(CHAT_EVENT_CHANNEL, json.dumps(build_event(event_type, payload)))


def start_chat_event_listener(
    *,
    loop: asyncio.AbstractEventLoop,
    handler: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    global _listener_thread, _pubsub
    if _listener_thread is not None:
        return
    client = get_redis_client()
    if client is None:
        return
    _stop_event.clear()
    _pubsub = client.pubsub()
    _pubsub.subscribe(CHAT_EVENT_CHANNEL)

    def _run() -> None:
        if _pubsub is None:
            return
        for message in _pubsub.listen():
            if _stop_event.is_set():
                break
            if message.get("type") != "message":
                continue
            raw = message.get("data")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else raw
            except json.JSONDecodeError:
                logger.warning("chat.redis.invalid_payload")
                continue
            asyncio.run_coroutine_threadsafe(handler(payload), loop)

    _listener_thread = threading.Thread(target=_run, name="chat-event-listener", daemon=True)
    _listener_thread.start()


def stop_chat_event_listener() -> None:
    global _listener_thread, _pubsub
    _stop_event.set()
    if _pubsub is not None:
        try:
            _pubsub.close()
        except Exception:
            pass
        _pubsub = None
    _listener_thread = None
