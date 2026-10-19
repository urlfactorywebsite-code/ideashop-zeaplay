from __future__ import annotations

from uuid import uuid4

from ..realtime.contracts import Event
from ..realtime import transport

CHAT_EVENT_CHANNEL = transport.channel("chat")
EVENT_VERSION = "v1"
INSTANCE_ID = uuid4().hex


def build_event(event_type, payload):
    from datetime import datetime, timezone
    return {"version": EVENT_VERSION, "type": event_type, "payload": payload,
            "sent_at": datetime.now(timezone.utc).isoformat(), "origin": INSTANCE_ID}


def publish_chat_event(event_type, payload):
    from ..database import SessionLocal
    from ..models import ChatConversation, User
    resource_id = payload.get("conversation_id") or payload.get("user_id") or payload.get("tenant_id")
    tenant = payload.get("tenant_id")
    if not tenant:
        with SessionLocal() as db:
            obj = db.get(ChatConversation, resource_id) if payload.get("conversation_id") else db.get(User, resource_id)
            tenant = getattr(obj, "tenant_id", None)
    if not tenant or not resource_id:
        return
    transport.publish(Event(event_type=event_type, tenant_id=str(tenant), resource_type="chat", resource_id=str(resource_id),
                            payload={"browser": build_event(event_type, payload)}))


def start_chat_event_listener(*, loop, handler, on_gap=None):
    async def adapt(event):
        browser = event.payload.get("browser")
        if browser:
            if browser["type"] in {"message:new", "message:updated", "message:deleted", "reaction:added", "reaction:removed"}:
                message_id = browser["payload"].get("message", {}).get("id")
                await handler(event.model_copy(update={"payload": {"message_id": message_id, "origin": browser.get("origin")}}))
                return
            await handler({**browser, "event_id": event.event_id, "trusted_tenant_id": event.tenant_id})
        else:
            await handler(event)
    transport.start("chat", loop, adapt, on_gap)


async def stop_chat_event_listener():
    await transport.stop("chat")
