from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from fastapi import WebSocket, status

from ..config import get_settings
from ..dependencies import _decode_access_token

WEBSOCKET_POLICY_VIOLATION = status.WS_1008_POLICY_VIOLATION
WEBSOCKET_MESSAGE_TOO_BIG = 1009


def _normalize_origin(origin: str) -> str | None:
    if not origin or any(char.isspace() or ord(char) < 32 or char in "\\,?#" for char in origin):
        return None
    try:
        parsed = urlparse(origin)
        scheme = parsed.scheme.lower()
        host = (parsed.hostname or "").lower()
        port = parsed.port
        if (scheme not in {"http", "https"} or not host or parsed.username is not None
                or parsed.password is not None or parsed.path or parsed.params
                or parsed.netloc.endswith(":")):
            return None
    except ValueError:
        return None
    if ":" in host:
        host = f"[{host}]"
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    port_part = "" if port is None or default_port else f":{port}"
    return f"{scheme}://{host}{port_part}"


def websocket_allowed_origins() -> set[str]:
    settings = get_settings()
    configured = settings.websocket_trusted_origins or settings.cors_allow_origins
    return {normalized for origin in configured if origin and origin != "*"
            if (normalized := _normalize_origin(origin.rstrip("/"))) is not None}


def _validate_websocket_origin(websocket: WebSocket) -> bool:
    settings = get_settings()
    origins = websocket.headers.getlist("origin")
    if not origins:
        return not settings.websocket_require_origin
    if len(origins) != 1:
        return False
    normalized = _normalize_origin(origins[0])
    if normalized is None:
        return False
    configured = settings.websocket_trusted_origins or settings.cors_allow_origins
    if "*" in configured:
        return settings.environment.lower() != "production"
    return normalized in websocket_allowed_origins()


def validate_websocket_origin(websocket: WebSocket) -> bool:
    allowed = _validate_websocket_origin(websocket)
    if not allowed:
        from ..observability import rejection
        path = getattr(getattr(websocket, "url", None), "path", "")
        rejection("chat" if path.endswith("/chat") else "tasks" if path.endswith("/tasks") else "tickets", "origin")
    return allowed


def extract_websocket_token(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if token:
        return token
    auth_header = websocket.headers.get("authorization")
    if auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
    from ..observability import rejection
    path = getattr(getattr(websocket, "url", None), "path", "")
    rejection("chat" if path.endswith("/chat") else "tasks" if path.endswith("/tasks") else "tickets", "auth")
    return None


def _decode_websocket_token(token: str, *, required_scope: str | None = None) -> dict[str, Any]:
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


def decode_websocket_token(token: str, *, required_scope: str | None = None) -> dict[str, Any]:
    try:
        return _decode_websocket_token(token, required_scope=required_scope)
    except Exception:
        from ..observability import rejection
        rejection(required_scope, "auth")
        raise


async def close_policy_violation(websocket: WebSocket) -> None:
    getattr(websocket, "scope", {})["_zea_ws_policy"] = True
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
