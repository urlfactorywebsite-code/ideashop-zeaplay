from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from queue import Empty, Full, Queue
from threading import Lock, Thread
from typing import Any, Dict, Optional

from fastapi import Request

from .. import models
from ..database import SessionLocal
from .security_audit import redact


_QUEUE_MAX_SIZE = 2000
_queue: Queue[Dict[str, Any]] = Queue(maxsize=_QUEUE_MAX_SIZE)
_worker_lock = Lock()
_worker_started = False


def _now() -> datetime:
    return datetime.utcnow()


def _extract_ip(request: Request) -> Optional[str]:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _request_context(request: Optional[Request]) -> Dict[str, Optional[str]]:
    if not request:
        return {
            "ip_address": None,
            "user_agent": None,
            "accept_language": None,
            "sec_ch_ua": None,
            "sec_ch_platform": None,
            "route": None,
            "method": None,
        }
    return {
        "ip_address": _extract_ip(request),
        "user_agent": request.headers.get("user-agent"),
        "accept_language": request.headers.get("accept-language"),
        "sec_ch_ua": request.headers.get("sec-ch-ua"),
        "sec_ch_platform": request.headers.get("sec-ch-ua-platform"),
        "route": request.url.path if request.url else None,
        "method": request.method,
    }


def _parse_user_agent(value: Optional[str]) -> Dict[str, Optional[str]]:
    if not value:
        return {"browser": None, "browser_version": None, "os": None}
    ua = value.lower()
    browser = None
    version = None
    os_name = None
    if "edg/" in ua:
        browser = "Edge"
        version = ua.split("edg/")[-1].split(" ")[0]
    elif "chrome/" in ua and "safari/" in ua:
        browser = "Chrome"
        version = ua.split("chrome/")[-1].split(" ")[0]
    elif "firefox/" in ua:
        browser = "Firefox"
        version = ua.split("firefox/")[-1].split(" ")[0]
    elif "safari/" in ua:
        browser = "Safari"
        version = ua.split("version/")[-1].split(" ")[0] if "version/" in ua else None

    if "windows" in ua:
        os_name = "Windows"
    elif "mac os x" in ua or "macintosh" in ua:
        os_name = "macOS"
    elif "android" in ua:
        os_name = "Android"
    elif "iphone" in ua or "ipad" in ua:
        os_name = "iOS"
    elif "linux" in ua:
        os_name = "Linux"

    return {"browser": browser, "browser_version": version, "os": os_name}


def _write_log(payload: Dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        db.add(models.AuditLog(**payload))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _worker() -> None:
    while True:
        try:
            payload = _queue.get(timeout=0.5)
        except Empty:
            continue
        _write_log(payload)
        _queue.task_done()


def ensure_worker_started() -> None:
    global _worker_started
    if _worker_started:
        return
    with _worker_lock:
        if _worker_started:
            return
        thread = Thread(target=_worker, name="audit-log-worker", daemon=True)
        thread.start()
        _worker_started = True


def queue_log(payload: Dict[str, Any]) -> None:
    ensure_worker_started()
    try:
        _queue.put_nowait(payload)
    except Full:
        _write_log(payload)


@dataclass
class AuditLogInput:
    action: str
    category: models.AuditLogCategoryEnum
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    target_user_id: Optional[str] = None
    approval_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    before: Optional[Dict[str, Any]] = None
    after: Optional[Dict[str, Any]] = None
    source: models.AuditLogSourceEnum = models.AuditLogSourceEnum.MANUAL
    severity: models.AuditLogSeverityEnum = models.AuditLogSeverityEnum.INFO
    status: models.AuditLogStatusEnum = models.AuditLogStatusEnum.SUCCESS
    reason: Optional[str] = None
    trigger: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    request: Optional[Request] = None
    created_at: datetime = field(default_factory=_now)


def log_event(entry: AuditLogInput) -> None:
    context = _request_context(entry.request)
    client_meta = _parse_user_agent(context["user_agent"])
    metadata_payload = redact(dict(entry.metadata or {}))
    metadata_payload.setdefault(
        "client",
        {
            **client_meta,
            "accept_language": context["accept_language"],
            "sec_ch_ua": context["sec_ch_ua"],
            "sec_ch_platform": context["sec_ch_platform"],
        },
    )
    payload = {
        "actor_id": entry.actor_id,
        "actor_role": entry.actor_role,
        "action": entry.action,
        "category": entry.category,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "target_user_id": entry.target_user_id,
        "approval_id": entry.approval_id,
        "old_value": entry.old_value,
        "new_value": entry.new_value,
        "before": redact(entry.before),
        "after": redact(entry.after),
        "ip_address": context["ip_address"],
        "user_agent": context["user_agent"],
        "source": entry.source,
        "severity": entry.severity,
        "status": entry.status,
        "reason": entry.reason,
        "trigger": entry.trigger,
        "route": context["route"],
        "method": context["method"],
        "metadata_payload": metadata_payload,
        "created_at": entry.created_at,
    }
    queue_log(payload)
