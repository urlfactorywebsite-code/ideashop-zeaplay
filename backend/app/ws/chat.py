from __future__ import annotations

from ..services.navigation import socket_allowed

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, WebSocket
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from .. import models, schemas
from ..config import get_settings
from ..auth import credentials_match
from ..database import SessionLocal
from ..rate_limit import check_rate_limit
from ..realtime.contracts import Event, durable_enabled
from ..observability import FANOUT_FAILURES
from ..chat.permissions import ChatPermissionService
from ..chat.repositories import ConversationRepository
from ..chat.realtime import INSTANCE_ID, build_event, publish_chat_event
from ..chat.serializers import serialize_conversation, serialize_message
from ..chat.services import MemberService, MessageService, ReactionService
from .security import (
    WEBSOCKET_MESSAGE_TOO_BIG,
    close_policy_violation,
    decode_websocket_token,
    extract_websocket_token,
    validate_websocket_message_size,
    validate_websocket_origin,
)

router = APIRouter()
logger = logging.getLogger("zeaplay.chat.ws")

class ChatConnectionManager:
    def __init__(self) -> None:
        self._users: dict[str, set[WebSocket]] = defaultdict(set)
        self._tenants: dict[str, set[WebSocket]] = defaultdict(set)
        self._conversations: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_meta: dict[WebSocket, dict[str, str]] = {}
        self._socket_conversations: dict[WebSocket, set[str]] = defaultdict(set)
        self._presence: dict[str, dict[str, Any]] = {}
        self._typing: dict[str, dict[str, asyncio.Task]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def close_all(self):
        async with self._lock:
            sockets = list(self._socket_meta)
            for timers in self._typing.values():
                for timer in timers.values():
                    timer.cancel()
            self._typing.clear()
            self._socket_meta.clear()
            self._socket_conversations.clear()
            self._users.clear()
            self._tenants.clear()
            self._conversations.clear()
            self._presence.clear()
        async def close(socket):
            try:
                await asyncio.wait_for(socket.close(code=1013), timeout=get_settings().realtime_send_timeout)
            except Exception:
                pass
        await asyncio.gather(*(close(socket) for socket in sockets))

    def snapshot(self) -> dict[str, int]:
        return {
            "sockets": len(self._socket_meta),
            "users": len(self._users),
            "tenants": len(self._tenants),
            "conversation_rooms": len(self._conversations),
        }

    async def user_connection_count(self, user_id: str) -> int:
        async with self._lock:
            return len(self._users.get(user_id, set()))

    async def connect(self, websocket: WebSocket, user: models.User) -> None:
        await websocket.accept()
        tenant_id = str(user.tenant_id)
        async with self._lock:
            self._socket_meta[websocket] = {"user_id": user.id, "tenant_id": tenant_id, "name": user.name}
            self._users[user.id].add(websocket)
            self._tenants[tenant_id].add(websocket)
            self._presence[user.id] = {
                "user_id": user.id,
                "tenant_id": tenant_id,
                "name": user.name,
                "status": "ONLINE",
                "last_seen": datetime.utcnow().isoformat(),
            }
        await self.broadcast_tenant(tenant_id, "presence:changed", self._presence[user.id])
        logger.info("chat.ws.connected user_id=%s tenant_id=%s active=%s", user.id, tenant_id, self.snapshot())

    async def disconnect(self, websocket: WebSocket) -> None:
        typing_stops: list[tuple[str, str, str]] = []
        async with self._lock:
            meta = self._socket_meta.pop(websocket, None)
            if not meta:
                return
            user_id = meta["user_id"]
            tenant_id = meta["tenant_id"]
            name = meta["name"]
            self._users[user_id].discard(websocket)
            user_still_connected = bool(self._users[user_id])
            if not user_still_connected:
                self._users.pop(user_id, None)
            self._tenants[tenant_id].discard(websocket)
            if not self._tenants[tenant_id]:
                self._tenants.pop(tenant_id, None)
            for conversation_id in self._socket_conversations.pop(websocket, set()):
                self._conversations[conversation_id].discard(websocket)
                if not self._conversations[conversation_id]:
                    self._conversations.pop(conversation_id, None)
                task = self._typing.get(conversation_id, {}).pop(user_id, None)
                if task:
                    task.cancel()
                    typing_stops.append((conversation_id, user_id, name))
                if conversation_id in self._typing and not self._typing[conversation_id]:
                    self._typing.pop(conversation_id, None)
            if not user_still_connected:
                presence = {
                    **self._presence.pop(user_id, {}),
                    "user_id": user_id,
                    "tenant_id": tenant_id,
                    "status": "OFFLINE",
                    "last_seen": datetime.utcnow().isoformat(),
                }
            else:
                presence = None
        if presence:
            await self.broadcast_tenant(tenant_id, "presence:changed", presence)
        logger.info("chat.ws.disconnected user_id=%s tenant_id=%s active=%s", user_id, tenant_id, self.snapshot())
        for conversation_id, stopped_user_id, stopped_name in typing_stops:
            await self.broadcast_conversation(
                conversation_id,
                "typing:stopped",
                {"conversation_id": conversation_id, "user_id": stopped_user_id, "name": stopped_name},
            )

    async def join_conversation(self, websocket: WebSocket, conversation_id: str) -> None:
        async with self._lock:
            self._conversations[conversation_id].add(websocket)
            self._socket_conversations[websocket].add(conversation_id)

    async def leave_conversation(self, websocket: WebSocket, conversation_id: str) -> None:
        typing_stop: tuple[str, str, str] | None = None
        async with self._lock:
            self._conversations[conversation_id].discard(websocket)
            if not self._conversations[conversation_id]:
                self._conversations.pop(conversation_id, None)
            self._socket_conversations[websocket].discard(conversation_id)
            meta = self._socket_meta.get(websocket)
            if meta:
                task = self._typing.get(conversation_id, {}).pop(meta["user_id"], None)
                if task:
                    task.cancel()
                    typing_stop = (conversation_id, meta["user_id"], meta["name"])
                if conversation_id in self._typing and not self._typing[conversation_id]:
                    self._typing.pop(conversation_id, None)
        if typing_stop:
            stopped_conversation_id, user_id, name = typing_stop
            await self.broadcast_conversation(
                stopped_conversation_id,
                "typing:stopped",
                {"conversation_id": stopped_conversation_id, "user_id": user_id, "name": name},
            )

    async def _send_many(self, recipients: list[WebSocket], event_type: str, payload: dict[str, Any], publish: bool) -> None:
        if publish and durable_enabled("chat") and event_type in {"message:new", "message:updated", "message:deleted"}:
            return
        payload = dict(payload)
        event_id = payload.pop("_event_id", None)
        event = build_event(event_type, payload)
        if event_id:
            event["event_id"] = event_id
        for socket in recipients:
            try:
                with SessionLocal() as db:
                    user = db.get(models.User, self._socket_meta.get(socket, {}).get("user_id"))
                    if (not user or user.status != models.UserStatusEnum.ACTIVE
                            or str(user.tenant_id) != self._socket_meta.get(socket, {}).get("tenant_id")
                            or not credentials_match(user, getattr(socket, "scope", {})) or not socket_allowed(db, user, 'chat')):
                        await self.disconnect(socket)
                        await socket.close(code=1008)
                        continue
                await asyncio.wait_for(socket.send_json(event), timeout=get_settings().realtime_send_timeout)
            except Exception as exc:
                FANOUT_FAILURES.labels("chat", "timeout" if isinstance(exc, TimeoutError) else "error").inc()
                await self.disconnect(socket)
                try:
                    await socket.close(code=1013)
                except Exception:
                    pass
        if publish:
            publish_chat_event(event_type, payload)

    async def broadcast_conversation(
        self,
        conversation_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        publish: bool = True,
    ) -> None:
        with SessionLocal() as db:
            conversation = db.get(models.ChatConversation, conversation_id)
            if not conversation or conversation.is_archived:
                return
            allowed_user_ids = set(
                db.execute(
                    select(models.ChatParticipant.user_id).where(models.ChatParticipant.conversation_id == conversation_id)
                ).scalars().all()
            )
        async with self._lock:
            sockets = self._conversations.get(conversation_id, set())
            stale = [socket for socket in sockets if self._socket_meta.get(socket, {}).get("user_id") not in allowed_user_ids]
            for socket in stale:
                sockets.discard(socket)
                self._socket_conversations[socket].discard(conversation_id)
            if conversation_id in self._conversations and not self._conversations[conversation_id]:
                self._conversations.pop(conversation_id, None)
            recipients = list(sockets)
        await self._send_many(recipients, event_type, payload, publish)

    async def broadcast_user(self, user_id: str, event_type: str, payload: dict[str, Any], *, publish: bool = True) -> None:
        async with self._lock:
            recipients = list(self._users.get(user_id, set()))
        await self._send_many(recipients, event_type, payload, publish)

    async def broadcast_tenant(self, tenant_id: str, event_type: str, payload: dict[str, Any], *, publish: bool = True) -> None:
        async with self._lock:
            recipients = list(self._tenants.get(tenant_id, set()))
        await self._send_many(recipients, event_type, payload, publish)

    async def dispatch_remote_event(self, event: dict[str, Any] | Event) -> None:
        if isinstance(event, Event):
            if event.payload.get("origin") == INSTANCE_ID:
                return
            with SessionLocal() as db:
                conversation = db.get(models.ChatConversation, event.resource_id)
                message = db.get(models.ChatMessage, event.payload.get("message_id"))
                if not conversation or str(conversation.tenant_id) != event.tenant_id or not message or message.conversation_id != conversation.id:
                    return
                payload = _message_payload(serialize_message(message), message.client_id)
                payload["_event_id"] = event.event_id
            await self.broadcast_conversation(event.resource_id, event.event_type, payload, publish=False)
            await _broadcast_unread(event.resource_id, publish=False)
            return
        if event.get("origin") == INSTANCE_ID:
            return
        event_type = event.get("type")
        payload = event.get("payload") or {}
        if not isinstance(event_type, str) or not isinstance(payload, dict):
            return
        conversation_id = payload.get("conversation_id")
        user_id = payload.get("user_id")
        tenant_id = payload.get("tenant_id")
        with SessionLocal() as db:
            conversation = db.get(models.ChatConversation, conversation_id) if conversation_id else None
            target_user = db.get(models.User, user_id) if user_id else None
            expected_tenant = str(conversation.tenant_id) if conversation else str(target_user.tenant_id) if target_user else str(tenant_id or "")
            if expected_tenant != event.get("trusted_tenant_id"):
                return
        payload = {**payload, "_event_id": event.get("event_id")}
        if event_type == "unread:updated" and user_id:
            await self.broadcast_user(str(user_id), event_type, payload, publish=False)
        elif conversation_id:
            await self.broadcast_conversation(str(conversation_id), event_type, payload, publish=False)
        elif user_id:
            await self.broadcast_user(str(user_id), event_type, payload, publish=False)
        elif tenant_id:
            await self.broadcast_tenant(str(tenant_id), event_type, payload, publish=False)

    async def heartbeat(self, user: models.User, status_value: str = "ONLINE") -> dict[str, Any]:
        presence = {
            "user_id": user.id,
            "tenant_id": str(user.tenant_id),
            "name": user.name,
            "status": status_value if status_value in {"ONLINE", "AWAY"} else "ONLINE",
            "last_seen": datetime.utcnow().isoformat(),
        }
        async with self._lock:
            self._presence[user.id] = presence
        return presence

    async def typing(self, conversation_id: str, user: models.User, started: bool) -> None:
        event_type = "typing:started" if started else "typing:stopped"
        payload = {"conversation_id": conversation_id, "user_id": user.id, "name": user.name}
        async with self._lock:
            existing = self._typing[conversation_id].pop(user.id, None)
            if existing:
                existing.cancel()
            if conversation_id in self._typing and not self._typing[conversation_id]:
                self._typing.pop(conversation_id, None)
        await self.broadcast_conversation(conversation_id, event_type, payload)
        if started:
            async def expire() -> None:
                await asyncio.sleep(6)
                async with self._lock:
                    self._typing[conversation_id].pop(user.id, None)
                    if conversation_id in self._typing and not self._typing[conversation_id]:
                        self._typing.pop(conversation_id, None)
                await self.broadcast_conversation(conversation_id, "typing:stopped", payload)

            async with self._lock:
                self._typing[conversation_id][user.id] = asyncio.create_task(expire())


manager = ChatConnectionManager()


def _socket_error(code: str, message: str) -> dict[str, Any]:
    return build_event("error", {"code": code, "message": message})


def _message_payload(message: schemas.ChatMessageRead, client_id: str | None = None) -> dict[str, Any]:
    payload = {"message": message.model_dump(mode="json"), "conversation_id": message.conversation_id}
    if client_id:
        payload["client_id"] = client_id
    return payload


async def _broadcast_unread(conversation_id: str, *, publish: bool = True) -> None:
    with SessionLocal() as db:
        conversation = db.get(models.ChatConversation, conversation_id)
        if not conversation:
            return
        counts = ConversationRepository(db).unread_counts_for_conversation_members(conversation_id)
        for user_id, count in counts.items():
            await manager.broadcast_user(
                user_id,
                "unread:updated",
                {"conversation_id": conversation_id, "user_id": user_id, "unread_count": count},
                publish=publish,
            )


@router.websocket("/ws/chat")
async def chat_ws(websocket: WebSocket) -> None:
    if not validate_websocket_origin(websocket):
        await close_policy_violation(websocket)
        return

    token = extract_websocket_token(websocket)
    if not token:
        await close_policy_violation(websocket)
        return
    try:
        payload = decode_websocket_token(token, required_scope="chat")
        user_id = str(payload.get("user_id") or payload.get("sub"))
    except Exception:
        await close_policy_violation(websocket)
        return

    with SessionLocal() as db:
        user = db.execute(select(models.User).where(models.User.id == user_id)).scalar_one_or_none()
        if not user or user.status != models.UserStatusEnum.ACTIVE or not credentials_match(user, payload) or not socket_allowed(db, user, 'chat'):
            await close_policy_violation(websocket)
            return
        token_tenant_id = str(payload.get("tenant_id") or "")
        if token_tenant_id and token_tenant_id != str(user.tenant_id):
            await close_policy_violation(websocket)
            return

    max_connections = get_settings().websocket_max_connections_per_user
    if max_connections > 0 and await manager.user_connection_count(user.id) >= max_connections:
        await close_policy_violation(websocket)
        return

    websocket.scope["credentials_version"] = payload.get("credentials_version", 0)
    await manager.connect(websocket, user)
    try:
        while True:
            raw_text = await websocket.receive_text()
            if not validate_websocket_message_size(raw_text):
                await websocket.close(code=WEBSOCKET_MESSAGE_TOO_BIG)
                break
            try:
                raw = json.loads(raw_text)
            except json.JSONDecodeError:
                await websocket.send_json(_socket_error("invalid_payload", "Expected a JSON object"))
                continue
            if not isinstance(raw, dict):
                await websocket.send_json(_socket_error("invalid_payload", "Expected a JSON object"))
                continue
            event_type = raw.get("type")
            data = raw.get("payload") or {}
            if not isinstance(data, dict):
                await websocket.send_json(_socket_error("invalid_payload", "Expected payload object"))
                continue
            conversation_id = str(data.get("conversation_id") or "")

            with SessionLocal() as db:
                live_user = db.get(models.User, user.id)
                if (not live_user or live_user.status != models.UserStatusEnum.ACTIVE
                        or live_user.tenant_id != user.tenant_id or not credentials_match(live_user, websocket.scope) or not socket_allowed(db, live_user, 'chat')):
                    await websocket.close(code=1008)
                    break
                user = live_user

            try:
                if event_type == "chat:join":
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        conversation = ChatPermissionService(db).get_conversation(conversation_id, db_user)
                        ChatPermissionService(db).require_member(conversation, db_user)
                        db.commit()
                    await manager.join_conversation(websocket, conversation_id)
                    await websocket.send_json(build_event("chat:joined", {"conversation_id": conversation_id}))
                    continue

                if event_type == "chat:leave":
                    await manager.leave_conversation(websocket, conversation_id)
                    await websocket.send_json(build_event("chat:left", {"conversation_id": conversation_id}))
                    continue

                if event_type in {"typing:start", "typing:stop"}:
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        conversation = ChatPermissionService(db).get_conversation(conversation_id, db_user)
                        ChatPermissionService(db).require_member(conversation, db_user)
                        db.commit()
                    await manager.typing(conversation_id, user, event_type == "typing:start")
                    continue

                if event_type == "presence:heartbeat":
                    presence = await manager.heartbeat(user, str(data.get("status") or "ONLINE"))
                    await manager.broadcast_tenant(str(user.tenant_id), "presence:changed", presence)
                    continue

                if event_type == "message:send":
                    check_rate_limit(f"chat:ws:message:{user.id}", limit=30, window_seconds=60)
                    started_at = datetime.utcnow()
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        service = MessageService(db)
                        message = service.create_message(
                            conversation_id,
                            schemas.ChatMessageCreate(
                                content=str(data.get("content") or ""),
                                client_id=data.get("client_id"),
                                reply_to_message_id=data.get("reply_to_message_id"),
                                attachments=data.get("attachments") or [],
                            ),
                            db_user,
                        )
                        inserted = service.last_create_inserted
                    if inserted:
                        await manager.broadcast_conversation(conversation_id, "message:new", _message_payload(message, data.get("client_id")))
                        await _broadcast_unread(conversation_id)
                    else:
                        await websocket.send_json(build_event("message:new", _message_payload(message, data.get("client_id"))))
                    latency_ms = int((datetime.utcnow() - started_at).total_seconds() * 1000)
                    logger.info(
                        "chat.ws.message_sent user_id=%s conversation_id=%s message_id=%s inserted=%s latency_ms=%s",
                        user.id,
                        conversation_id,
                        message.id,
                        inserted,
                        latency_ms,
                    )
                    continue

                if event_type == "message:edit":
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        message = MessageService(db).update_message(
                            str(data.get("message_id") or ""),
                            schemas.ChatMessageUpdate(content=str(data.get("content") or "")),
                            db_user,
                        )
                    await manager.broadcast_conversation(message.conversation_id, "message:updated", _message_payload(message))
                    continue

                if event_type == "message:delete":
                    message_id = str(data.get("message_id") or "")
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        message = MessageService(db).messages.get(message_id)
                        if not message:
                            raise ValueError("message not found")
                        conversation_id = message.conversation_id
                        MessageService(db).delete_message(message_id, db_user)
                        deleted = MessageService(db).messages.get(message_id)
                        payload = _message_payload(serialize_message(deleted))
                    await manager.broadcast_conversation(conversation_id, "message:deleted", payload)
                    await _broadcast_unread(conversation_id)
                    continue

                if event_type in {"reaction:add", "reaction:remove"}:
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        if event_type == "reaction:add":
                            message = ReactionService(db).add_reaction(
                                str(data.get("message_id") or ""),
                                schemas.ChatReactionCreate(emoji=str(data.get("emoji") or "")),
                                db_user,
                            )
                            outgoing = "reaction:added"
                        else:
                            message = ReactionService(db).remove_reaction(
                                str(data.get("message_id") or ""),
                                str(data.get("emoji") or ""),
                                db_user,
                            )
                            outgoing = "reaction:removed"
                    await manager.broadcast_conversation(message.conversation_id, outgoing, _message_payload(message))
                    continue

                if event_type == "message:read":
                    with SessionLocal() as db:
                        db_user = db.get(models.User, user.id)
                        member = MemberService(db).mark_read(
                            conversation_id,
                            schemas.ChatReadMarkerUpdate(last_read_message_id=data.get("last_read_message_id")),
                            db_user,
                        )
                    await manager.broadcast_conversation(
                        conversation_id,
                        "message:read",
                        {"conversation_id": conversation_id, "member": member.model_dump(mode="json")},
                    )
                    await _broadcast_unread(conversation_id)
                    continue

                await websocket.send_json(_socket_error("unsupported_event", "Unsupported chat event"))
            except Exception as exc:
                logger.warning("chat.ws.event_failed event=%s error=%s", event_type, type(exc).__name__)
                await websocket.send_json(_socket_error("event_failed", "Unable to process chat event"))
    except BaseException as exc:
        disconnect_name = exc.__class__.__name__ == "WebSocketDisconnect"
        disconnected_runtime = isinstance(exc, RuntimeError) and "WebSocket is not connected" in str(exc)
        if not disconnect_name and not disconnected_runtime:
            raise
        pass
    finally:
        await manager.disconnect(websocket)
