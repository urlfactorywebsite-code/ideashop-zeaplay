import asyncio

from ..cache import get_cache_prefix, invalidate_prefix
from ..realtime import transport
from ..realtime.contracts import Event, durable_enabled

TASK_EVENT_CHANNEL = transport.channel("task")


def publish_task_event(payload):
    if durable_enabled("task") and payload.get("type") == "task.changed":
        return
    tenant = payload.get("tenant_id")
    if not tenant:
        return
    resource_id = payload.get("task_id") or tenant
    transport.publish(Event(event_type=payload.get("type", "task.changed"), tenant_id=str(tenant),
                            resource_type="task", resource_id=str(resource_id), payload=payload))


def start_task_event_listener(*, loop, handler, on_gap=None):
    async def adapt(event):
        if event.event_type == "task.changed":
            for view in ("list", "kanban", "calendar"):
                await asyncio.to_thread(invalidate_prefix, f"{get_cache_prefix()}:tasks:{view}:tenant:{event.tenant_id}:")
        await handler({**event.payload, "tenant_id": event.tenant_id, "event_id": event.event_id})
    transport.start("task", loop, adapt, on_gap)


async def stop_task_event_listener():
    await transport.stop("task")
