from __future__ import annotations

import asyncio
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from ..database import SessionLocal
from ..dependencies import _decode_access_token
from ..models import User, UserStatusEnum


router = APIRouter()


class TaskConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, tenant_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(tenant_id, set()).add(websocket)

    async def disconnect(self, tenant_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(tenant_id)
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(tenant_id, None)

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


def _extract_token(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if token:
        return token
    auth_header = websocket.headers.get("authorization")
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
    return None


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
    token = _extract_token(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        payload = _decode_access_token(token)
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
        tenant_id = str(user.tenant_id) if user.tenant_id else "default"

    await manager.connect(tenant_id, websocket)
    heartbeat_task = asyncio.create_task(_heartbeat(websocket))
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "pong":
                continue
    except WebSocketDisconnect:
        pass
    finally:
        heartbeat_task.cancel()
        await manager.disconnect(tenant_id, websocket)
