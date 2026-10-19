from __future__ import annotations

import asyncio
import logging
import random
import threading
import time
from collections import Counter, OrderedDict

from ..cache import get_cache_prefix, get_redis_client
from ..config import get_settings
from .contracts import Event
from ..observability import PROCESSING, transport_event

logger = logging.getLogger("zeaplay.realtime")
metrics = Counter()
subscriptions: dict[str, "Subscription"] = {}


def channel(category: str) -> str:
    return f"{get_cache_prefix()}:{'tasks' if category == 'task' else category}:events"


class Subscription:
    def __init__(self, category, loop, handler, on_gap=None):
        self.category, self.loop, self.handler, self.on_gap = category, loop, handler, on_gap
        self.queue = asyncio.Queue(maxsize=get_settings().realtime_queue_size)
        self.seen = OrderedDict()
        self.stop_event = threading.Event()
        self.connected = False
        self.pubsub = None
        self.gap_task = None
        self.handoff_lock = threading.Lock()
        self.handoff_pending = 0
        self.handoff_overflow = False
        self.consumer = loop.create_task(self.consume())
        self.consumer.add_done_callback(self.supervise)
        self.thread = threading.Thread(target=self.listen, name=f"realtime-{category}", daemon=True)
        self.thread.start()

    def offer(self, event: Event):
        if self.stop_event.is_set():
            return
        if event.resource_type != self.category:
            metrics["invalid_events"] += 1
            transport_event(self.category, "invalid")
            return
        if event.event_id in self.seen:
            metrics["duplicate_events"] += 1
            transport_event(self.category, "duplicate")
            return
        try:
            self.queue.put_nowait(event)
        except asyncio.QueueFull:
            metrics["queue_overflows"] += 1
            transport_event(self.category, "queue_overflow")
            # Closing owned sockets makes their existing reconnect logic fetch persisted state.
            self.request_reconciliation()

    def submit(self, event: Event):
        try:
            if asyncio.get_running_loop() is self.loop:
                self.offer(event)
                return
        except RuntimeError:
            pass
        with self.handoff_lock:
            if self.stop_event.is_set():
                return
            if self.handoff_pending >= self.queue.maxsize:
                self.handoff_overflow = True
                metrics["handoff_overflows"] += 1
                transport_event(self.category, "handoff_overflow")
                return
            self.handoff_pending += 1

        def deliver():
            with self.handoff_lock:
                self.handoff_pending -= 1
                overflow = self.handoff_overflow
                self.handoff_overflow = False
            if overflow:
                self.request_reconciliation()
            self.offer(event)
        try:
            self.loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            with self.handoff_lock:
                self.handoff_pending -= 1

    def request_reconciliation(self):
        if self.on_gap and not self.stop_event.is_set() and (self.gap_task is None or self.gap_task.done()):
            self.gap_task = self.loop.create_task(self.reconcile_gap())

    async def reconcile_gap(self):
        try:
            if self.on_gap:
                await self.on_gap()
        except Exception as exc:
            metrics["reconciliation_errors"] += 1
            transport_event(self.category, "reconciliation_error")
            logger.warning("realtime.reconciliation_failed category=%s error=%s", self.category, type(exc).__name__)

    def supervise(self, task):
        if self.stop_event.is_set():
            return
        if not task.cancelled():
            task.exception()
        metrics["consumer_restarts"] += 1
        transport_event(self.category, "consumer_restart")
        self.consumer = self.loop.create_task(self.consume())
        self.consumer.add_done_callback(self.supervise)
        self.request_reconciliation()

    async def consume(self):
        while True:
            event = await self.queue.get()
            started = time.perf_counter()
            try:
                if event.event_id in self.seen:
                    metrics["duplicate_events"] += 1
                    transport_event(self.category, "duplicate")
                    continue
                await self.handler(event)
                self.seen[event.event_id] = time.monotonic()
                while len(self.seen) > 4096:
                    self.seen.popitem(last=False)
                metrics["fanout_events"] += 1
                transport_event(self.category, "processed")
                metrics["delivery_latency_ms_total"] += max(0, int((time.time() - event.occurred_at.timestamp()) * 1000))
            except Exception as exc:
                metrics["processing_errors"] += 1
                transport_event(self.category, "processing_error")
                logger.warning("realtime.processing_failed category=%s error=%s", self.category, type(exc).__name__)
                await self.reconcile_gap()
            finally:
                PROCESSING.labels(self.category).observe(time.perf_counter() - started)
                self.queue.task_done()

    async def receive(self, event):
        self.offer(event)

    def listen(self):
        attempts = 0
        while not self.stop_event.is_set():
            try:
                client = get_redis_client()
                if client is None:
                    raise ConnectionError("Redis unconfigured")
                self.pubsub = client.pubsub()
                self.pubsub.subscribe(channel(self.category))
                while not self.stop_event.is_set():
                    message = self.pubsub.get_message(timeout=1)
                    if not message:
                        continue
                    if message.get("type") == "subscribe":
                        self.connected = True
                        attempts = 0
                        if self.on_gap:
                            self.loop.call_soon_threadsafe(self.request_reconciliation)
                    elif message.get("type") == "message":
                        try:
                            event = Event.decode(message["data"])
                            pending = asyncio.run_coroutine_threadsafe(self.receive(event), self.loop)
                            try:
                                pending.result(timeout=2)
                            except TimeoutError:
                                pending.cancel()
                                raise ConnectionError("Subscriber loop stalled") from None
                        except (ValueError, TypeError):
                            metrics["invalid_events"] += 1
                            transport_event(self.category, "invalid")
            except Exception as exc:
                if not self.stop_event.is_set():
                    metrics["subscriber_errors"] += 1
                    transport_event(self.category, "subscriber_error")
                    logger.warning("realtime.subscription_retry category=%s error=%s", self.category, type(exc).__name__)
            finally:
                self.connected = False
                if self.pubsub is not None:
                    try:
                        self.pubsub.close()
                    except Exception:
                        pass
                    self.pubsub = None
            attempts += 1
            self.stop_event.wait(min(30, 0.5 * 2 ** min(attempts, 6)) * random.uniform(0.7, 1.3))

    async def close(self):
        self.stop_event.set()
        await asyncio.to_thread(self.thread.join, 4)
        self.consumer.cancel()
        gap = getattr(self, "gap_task", None)
        if gap:
            gap.cancel()
        await asyncio.gather(self.consumer, *([gap] if gap else []), return_exceptions=True)


def start(category, loop, handler, on_gap=None):
    if category not in subscriptions:
        subscriptions[category] = Subscription(category, loop, handler, on_gap)


async def stop(category):
    subscription = subscriptions.pop(category, None)
    if subscription:
        await subscription.close()


def publish(event: Event, *, require_redis=False) -> bool:
    event = Event.model_validate(event.model_dump())
    raw = event.encode()
    local = subscriptions.get(event.resource_type)
    if local and not require_redis:
        local.submit(event)
    try:
        client = get_redis_client()
        if client is None:
            raise ConnectionError("Redis unconfigured")
        client.publish(channel(event.resource_type), raw)
        transport_event(event.resource_type, "published")
        return True
    except Exception as exc:
        metrics["publish_errors"] += 1
        transport_event(event.resource_type, "publish_error")
        if metrics["publish_errors"] <= 3 or metrics["publish_errors"] % 100 == 0:
            logger.warning("realtime.publish_failed category=%s error=%s", event.resource_type, type(exc).__name__)
        if require_redis:
            raise ConnectionError("Redis publication failed") from None
        return False


def health():
    return {
        "subscribers": {key: {"connected": sub.connected, "alive": sub.thread.is_alive() and not sub.consumer.done(), "queue_size": sub.queue.qsize()} for key, sub in subscriptions.items()},
        "metrics": dict(metrics),
    }
