import asyncio
import json
import threading
from typing import Any, Callable, Optional

from ..cache import get_cache_prefix, get_redis_client


TASK_EVENT_CHANNEL = f"{get_cache_prefix()}:tasks:events"

_listener_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_pubsub = None


def publish_task_event(payload: dict[str, Any]) -> None:
    client = get_redis_client()
    if client is None:
        return
    client.publish(TASK_EVENT_CHANNEL, json.dumps(payload))


def start_task_event_listener(
    *,
    loop: asyncio.AbstractEventLoop,
    handler: Callable[[dict[str, Any]], Any],
) -> None:
    global _listener_thread, _pubsub
    if _listener_thread is not None:
        return
    client = get_redis_client()
    if client is None:
        return

    _stop_event.clear()
    _pubsub = client.pubsub()
    _pubsub.subscribe(TASK_EVENT_CHANNEL)

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
                continue
            asyncio.run_coroutine_threadsafe(handler(payload), loop)

    _listener_thread = threading.Thread(target=_run, name="tasks-event-listener", daemon=True)
    _listener_thread.start()


def stop_task_event_listener() -> None:
    global _listener_thread, _pubsub
    _stop_event.set()
    if _pubsub is not None:
        try:
            _pubsub.close()
        except Exception:
            pass
        _pubsub = None
    _listener_thread = None
