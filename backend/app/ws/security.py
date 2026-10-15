from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from fastapi import WebSocket, status

from ..config import get_settings
from ..dependencies import _decode_access_token

WEBSOCKET_POLICY_VIOLATION = status.WS_1008_POLICY_VIOLATION
WEBSOCKET_MESSAGE_TOO_BIG = 1009


def _normalize_origin(origin: str) -> str:
    parsed = urlparse(origin.strip())
    if not parsed.scheme or not parsed.netloc:
        return origin.strip().rstrip("/")
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    port = parsed.port
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    port_part = "" if port is None or default_port else f":{port}"
    return f"{scheme}://{host}{port_part}"


def websocket_allowed_origins() -> set[str]:
    settings = get_settings()
    configured = settings.websocket_trusted_origins or settings.cors_allow_origins
    return {_normalize_origin(origin) for origin in configured if origin and origin != "*"}


def validate_websocket_origin(websocket: WebSocket) -> bool:
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if not origin:
        return not settings.websocket_require_origin

    configured = settings.websocket_trusted_origins or settings.cors_allow_origins
    if "*" in configured:
        return True
    return _normalize_origin(origin) in websocket_allowed_origins()


def extract_websocket_token(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if token:
        return token
    auth_header = websocket.headers.get("authorization")
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
    return None


def decode_websocket_token(token: str, *, required_scope: str | None = None) -> dict[str, Any]:
    payload = _decode_access_token(token)
    settings = get_settings()
    purpose = payload.get("purpose")
    scopes = {str(scope) for scope in payload.get("scopes") or []}

    if settings.websocket_require_ticket and purpose != "websocket":
        raise ValueError("WebSocket ticket required")
    if purpose == "websocket" and required_scope:
        accepted_scopes = {f"websocket:{required_scope}", "websocket:realtime"}
        if scopes.isdisjoint(accepted_scopes):
            raise ValueError("WebSocket ticket scope mismatch")
    return payload


async def close_policy_violation(websocket: WebSocket) -> None:
    try:
        await websocket.accept()
    except RuntimeError:
        pass
    await websocket.close(code=WEBSOCKET_POLICY_VIOLATION)


def validate_websocket_message_size(raw: str | bytes) -> bool:
    settings = get_settings()
    if settings.websocket_max_message_bytes <= 0:
        return True
    if isinstance(raw, str):
        size = len(raw.encode("utf-8"))
    else:
        size = len(raw)
    return size <= settings.websocket_max_message_bytes
