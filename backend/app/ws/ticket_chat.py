from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Iterable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from ..config import get_settings
from ..database import SessionLocal
from ..events.bus import emit_ticket_event
from ..models import User, UserStatusEnum
from ..tickets.models import (
    Ticket,
    TicketComment,
    TicketCommentMention,
    TicketParticipant,
    TicketParticipantRoleEnum,
)
from .security import (
    WEBSOCKET_MESSAGE_TOO_BIG,
    close_policy_violation,
    decode_websocket_token,
    extract_websocket_token,
    validate_websocket_message_size,
    validate_websocket_origin,
)


router = APIRouter()
logger = logging.getLogger("zeaplay.tickets.ws")

MENTION_ID_PATTERN = re.compile(r"@([A-Za-z0-9_-]{3,64})")


class TicketConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = {}
        self._socket_users: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    def snapshot(self) -> dict[str, int]:
        return {
            "sockets": len(self._socket_users),
            "tickets": len(self._connections),
        }

    async def user_connection_count(self, user_id: str) -> int:
        async with self._lock:
            return sum(1 for socket_user_id in self._socket_users.values() if socket_user_id == user_id)

    async def connect(self, ticket_id: uuid.UUID, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(ticket_id, set()).add(websocket)
            self._socket_users[websocket] = user_id
        logger.info("tickets.ws.connected user_id=%s ticket_id=%s active=%s", user_id, ticket_id, self.snapshot())

    async def disconnect(self, ticket_id: uuid.UUID, websocket: WebSocket) -> None:
        async with self._lock:
            self._socket_users.pop(websocket, None)
            connections = self._connections.get(ticket_id)
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(ticket_id, None)
        logger.info("tickets.ws.disconnected ticket_id=%s active=%s", ticket_id, self.snapshot())

    async def broadcast(self, ticket_id: uuid.UUID, message: dict[str, Any]) -> None:
        async with self._lock:
            recipients = list(self._connections.get(ticket_id, set()))
        for socket in recipients:
            try:
                await socket.send_json(message)
            except Exception:
                await self.disconnect(ticket_id, socket)


manager = TicketConnectionManager()


def _extract_user_id(payload: dict[str, Any]) -> str:
    raw_user_id = payload.get("user_id") or payload.get("sub")
    if not raw_user_id:
        raise ValueError("Missing user_id")
    return str(raw_user_id)


def _extract_tenant_id(payload: dict[str, Any]) -> uuid.UUID:
    raw_tenant_id = payload.get("tenant_id")
    if not raw_tenant_id:
        raise ValueError("Missing tenant_id")
    return uuid.UUID(str(raw_tenant_id))


def _normalize_roles(raw_roles: Any) -> set[str]:
    if raw_roles is None:
        return set()
    if isinstance(raw_roles, str):
        return {raw_roles.lower()}
    if isinstance(raw_roles, Iterable):
        return {str(role).lower() for role in raw_roles}
    return set()


def _user_can_access_ticket(
    *,
    db,
    ticket: Ticket,
    user_id: str,
    user_department_id: str | None,
    roles: set[str],
) -> bool:
    if roles.intersection({"admin", "owner"}):
        return True
    if "manager" in roles and user_department_id and str(ticket.department_id) == str(user_department_id):
        return True
    if ticket.owner_id == user_id or ticket.created_by == user_id:
        return True
    participant = db.execute(
        select(TicketParticipant)
        .where(
            TicketParticipant.tenant_id == ticket.tenant_id,
            TicketParticipant.ticket_id == ticket.id,
            TicketParticipant.user_id == user_id,
            TicketParticipant.deleted_at.is_(None),
        )
        .limit(1)
    ).scalar_one_or_none()
    if not participant:
        return False
    return participant.role in {TicketParticipantRoleEnum.OWNER, TicketParticipantRoleEnum.ASSIGNEE, TicketParticipantRoleEnum.FOLLOWER}


def _parse_mentions(body: str) -> list[str]:
    matches = MENTION_ID_PATTERN.findall(body)
    seen: set[str] = set()
    mentions: list[str] = []
    for raw in matches:
        if raw in seen:
            continue
        seen.add(raw)
        mentions.append(raw)
    return mentions


def _comment_payload(comment: TicketComment, mention_ids: list[str]) -> dict[str, Any]:
    return {
        "id": str(comment.id),
        "ticket_id": str(comment.ticket_id),
        "tenant_id": str(comment.tenant_id),
        "user_id": str(comment.user_id),
        "body": comment.body,
        "is_internal": comment.is_internal,
        "created_at": comment.created_at.isoformat(),
        "mentions": [str(user_id) for user_id in mention_ids],
    }


@router.websocket("/ws/tickets/{ticket_id}")
async def ticket_chat_ws(websocket: WebSocket, ticket_id: str) -> None:
    if not validate_websocket_origin(websocket):
        await close_policy_violation(websocket)
        return

    token = extract_websocket_token(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_websocket_token(token, required_scope="tickets")
        user_id = _extract_user_id(payload)
        tenant_id = _extract_tenant_id(payload)
        roles = _normalize_roles(payload.get("roles"))
        ticket_uuid = uuid.UUID(ticket_id)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    db = SessionLocal()
    try:
        user = db.get(User, str(user_id))
        if not user or user.status != UserStatusEnum.ACTIVE:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        if not user.tenant_id or user.tenant_id != tenant_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        ticket = db.execute(
            select(Ticket)
            .where(
                Ticket.id == ticket_uuid,
                Ticket.tenant_id == tenant_id,
                Ticket.deleted_at.is_(None),
            )
            .limit(1)
        ).scalar_one_or_none()
        if not ticket:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if not _user_can_access_ticket(
            db=db,
            ticket=ticket,
            user_id=user_id,
            user_department_id=user.department_id,
            roles=roles,
        ):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    finally:
        db.close()

    max_connections = get_settings().websocket_max_connections_per_user
    if max_connections > 0 and await manager.user_connection_count(str(user_id)) >= max_connections:
        await close_policy_violation(websocket)
        return

    await manager.connect(ticket_uuid, str(user_id), websocket)

    try:
        while True:
            raw_text = await websocket.receive_text()
            if not validate_websocket_message_size(raw_text):
                await websocket.close(code=WEBSOCKET_MESSAGE_TOO_BIG)
                break
            try:
                message = json.loads(raw_text)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Unsupported message type"})
                continue
            if not isinstance(message, dict):
                await websocket.send_json({"type": "error", "message": "Unsupported message type"})
                continue
            message_type = message.get("type")
            body = message.get("body") if isinstance(message, dict) else None

            if message_type == "typing":
                await manager.broadcast(
                    ticket_uuid,
                    {
                        "type": "typing",
                        "ticket_id": str(ticket_uuid),
                        "user_id": str(user_id),
                        "body": body or "",
                    },
                )
                continue

            if message_type != "comment":
                await websocket.send_json({"type": "error", "message": "Unsupported message type"})
                continue

            if not isinstance(body, str) or not body.strip():
                await websocket.send_json({"type": "error", "message": "Comment body is required"})
                continue

            is_internal = bool(message.get("is_internal"))
            now = datetime.utcnow()

            db = SessionLocal()
            try:
                comment = TicketComment(
                    tenant_id=tenant_id,
                    ticket_id=ticket_uuid,
                    user_id=user_id,
                    body=body.strip(),
                    is_internal=is_internal,
                    created_at=now,
                )
                db.add(comment)
                db.flush()

                mentions = _parse_mentions(comment.body)
                for mentioned_user_id in mentions:
                    db.add(
                        TicketCommentMention(
                            tenant_id=tenant_id,
                            comment_id=comment.id,
                            mentioned_user_id=mentioned_user_id,
                            created_at=now,
                        )
                    )

                db.commit()
                db.refresh(comment)

                if mentions:
                    ticket = db.execute(
                        select(Ticket)
                        .where(
                            Ticket.id == ticket_uuid,
                            Ticket.tenant_id == tenant_id,
                            Ticket.deleted_at.is_(None),
                        )
                        .limit(1)
                    ).scalar_one_or_none()
                    if ticket:
                        emit_ticket_event(
                            db,
                            event_type="ticket.mentioned",
                            tenant_id=tenant_id,
                            ticket=ticket,
                            actor_id=user_id,
                            payload={
                                "comment_id": str(comment.id),
                                "comment_body": comment.body,
                                "mentioned_user_ids": [str(uid) for uid in mentions],
                            },
                            recipient_ids=mentions,
                            include_participants=False,
                        )
            finally:
                db.close()

            await manager.broadcast(
                ticket_uuid,
                {"type": "comment", "comment": _comment_payload(comment, mentions)},
            )
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(ticket_uuid, websocket)
