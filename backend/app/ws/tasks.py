from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from ..config import get_settings
from ..database import SessionLocal
from ..models import User, UserStatusEnum
from .security import (
    WEBSOCKET_MESSAGE_TOO_BIG,
    close_policy_violation,
    decode_websocket_token,
    extract_websocket_token,
    validate_websocket_message_size,
    validate_websocket_origin,
)


router = APIRouter()
logger = logging.getLogger("zeaplay.tasks.ws")


class TaskConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._socket_users: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    def snapshot(self) -> dict[str, int]:
        return {
            "sockets": len(self._socket_users),
            "tenants": len(self._connections),
        }

    async def user_connection_count(self, user_id: str) -> int:
        async with self._lock:
            return sum(1 for socket_user_id in self._socket_users.values() if socket_user_id == user_id)

    async def connect(self, tenant_id: str, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(tenant_id, set()).add(websocket)
            self._socket_users[websocket] = user_id
        logger.info("tasks.ws.connected user_id=%s tenant_id=%s active=%s", user_id, tenant_id, self.snapshot())

    async def disconnect(self, tenant_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._socket_users.pop(websocket, None)
            connections = self._connections.get(tenant_id)
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(tenant_id, None)
        logger.info("tasks.ws.disconnected tenant_id=%s active=%s", tenant_id, self.snapshot())

    async def broadcast(self, tenant_id: Optional[str], message: dict[str, Any]) -> None:
        async with self._lock:
            if tenant_id:
                recipients = list(self._connections.get(tenant_id, set()))
            else:
                recipients = [socket for sockets in self._connections.values() for socket in sockets]
        for socket in recipients:
            try:
                await socket.send_json(message)
            except Exception:
                if tenant_id:
                    await self.disconnect(tenant_id, socket)


manager = TaskConnectionManager()


async def _heartbeat(websocket: WebSocket, interval_seconds: int = 25) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await websocket.send_json({"type": "ping"})
        except Exception:
            return


async def broadcast_task_event(payload: dict[str, Any]) -> None:
    tenant_id = payload.get("tenant_id")
    await manager.broadcast(tenant_id, payload)


@router.websocket("/ws/tasks")
async def tasks_ws(websocket: WebSocket) -> None:
    if not validate_websocket_origin(websocket):
        await close_policy_violation(websocket)
        return

    token = extract_websocket_token(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        payload = decode_websocket_token(token, required_scope="tasks")
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = payload.get("user_id") or payload.get("sub")
    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.id == str(user_id))).scalar_one_or_none()
        if not user or user.status != UserStatusEnum.ACTIVE:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        token_tenant_id = str(payload.get("tenant_id") or "")
        if token_tenant_id and token_tenant_id != str(user.tenant_id):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        tenant_id = str(user.tenant_id) if user.tenant_id else "default"

    max_connections = get_settings().websocket_max_connections_per_user
    if max_connections > 0 and await manager.user_connection_count(str(user_id)) >= max_connections:
        await close_policy_violation(websocket)
        return

    await manager.connect(tenant_id, str(user_id), websocket)
    heartbeat_task = asyncio.create_task(_heartbeat(websocket))
    try:
        while True:
            raw_text = await websocket.receive_text()
            if not validate_websocket_message_size(raw_text):
                await websocket.close(code=WEBSOCKET_MESSAGE_TOO_BIG)
                break
            try:
                message = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "pong":
                continue
    except WebSocketDisconnect:
        pass
    finally:
        heartbeat_task.cancel()
        await manager.disconnect(tenant_id, websocket)
