from datetime import datetime, timedelta
import json
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_admin, get_current_active_user
from ..services import rewards as reward_service
from ..services import audit_logger

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("", response_model=schemas.RewardLogListResponse)
def list_logs(
    subject_type: str | None = Query(default="reward"),
    subject_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    action_enum = None
    if action:
        try:
            action_enum = models.RewardLogActionEnum(action)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unknown action filter",
            ) from exc
    return reward_service.list_logs(
        db,
        subject_type=subject_type,
        subject_id=subject_id,
        action=action_enum,
        page=page,
        page_size=page_size,
    )


def _parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _get_or_create_retention_config(db: Session) -> models.AuditRetentionConfig:
    models.AuditRetentionConfig.__table__.create(bind=db.bind, checkfirst=True)
    config = db.get(models.AuditRetentionConfig, 1)
    if not config:
        config = models.AuditRetentionConfig(id=1, retention_days=90)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def _apply_scope_filters(
    stmt,
    *,
    current_user: models.User,
    db: Session,
):
    if current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        return stmt
    if current_user.role == models.RoleEnum.MANAGER:
        if current_user.department_id:
            department_user_ids = (
                select(models.User.id)
                .where(models.User.department_id == current_user.department_id)
                .subquery()
            )
            return stmt.where(
                models.AuditLog.actor_id.in_(select(department_user_ids))
                | models.AuditLog.target_user_id.in_(select(department_user_ids))
            )
        return stmt.where(models.AuditLog.actor_id == str(current_user.id))
    return stmt.where(
        (models.AuditLog.actor_id == str(current_user.id))
        | (models.AuditLog.target_user_id == str(current_user.id))
    )


def _build_audit_log_query(
    *,
    db: Session,
    current_user: models.User,
    categories: list[str],
    entity_types: list[str],
    actions: list[str],
    actor_ids: list[str],
    severity: list[str],
    source: list[str],
    status_values: list[str],
    start_at: datetime | None,
    end_at: datetime | None,
    include_deleted: bool,
):
    stmt = (
        select(models.AuditLog)
        .options(selectinload(models.AuditLog.actor))
        .order_by(models.AuditLog.created_at.desc())
    )
    if not include_deleted:
        stmt = stmt.where(models.AuditLog.deleted_at.is_(None))
    if categories:
        stmt = stmt.where(models.AuditLog.category.in_(categories))
    if entity_types:
        stmt = stmt.where(models.AuditLog.entity_type.in_(entity_types))
    if actions:
        stmt = stmt.where(models.AuditLog.action.in_(actions))
    if actor_ids:
        stmt = stmt.where(models.AuditLog.actor_id.in_(actor_ids))
    if severity:
        stmt = stmt.where(models.AuditLog.severity.in_(severity))
    if source:
        stmt = stmt.where(models.AuditLog.source.in_(source))
    if status_values:
        stmt = stmt.where(models.AuditLog.status.in_(status_values))
    if start_at:
        stmt = stmt.where(models.AuditLog.created_at >= start_at)
    if end_at:
        stmt = stmt.where(models.AuditLog.created_at <= end_at)
    stmt = _apply_scope_filters(stmt, current_user=current_user, db=db)
    return stmt


@router.get("/audit", response_model=schemas.AuditLogListResponse)
def list_audit_logs(
    category: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor_id: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    source: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.AuditLogListResponse:
    categories = _parse_csv(category)
    entity_types = _parse_csv(entity_type)
    actions = _parse_csv(action)
    actor_ids = _parse_csv(actor_id)
    severity_values = _parse_csv(severity)
    source_values = _parse_csv(source)
    status_values = _parse_csv(status_filter)

    stmt = _build_audit_log_query(
        db=db,
        current_user=current_user,
        categories=categories,
        entity_types=entity_types,
        actions=actions,
        actor_ids=actor_ids,
        severity=severity_values,
        source=source_values,
        status_values=status_values,
        start_at=start_at,
        end_at=end_at,
        include_deleted=include_deleted,
    )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    items = (
        db.execute(stmt.offset((page - 1) * page_size).limit(page_size))
        .scalars()
        .all()
    )
    total_pages = max(1, (total + page_size - 1) // page_size)
    return schemas.AuditLogListResponse(
        items=[schemas.AuditLogRead.model_validate(item) for item in items],
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/audit/export")
def export_audit_logs(
    format: str = Query(default="csv"),
    category: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor_id: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    source: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Response:
    if format not in {"csv", "json"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported export format")

    stmt = _build_audit_log_query(
        db=db,
        current_user=current_user,
        categories=_parse_csv(category),
        entity_types=_parse_csv(entity_type),
        actions=_parse_csv(action),
        actor_ids=_parse_csv(actor_id),
        severity=_parse_csv(severity),
        source=_parse_csv(source),
        status_values=_parse_csv(status_filter),
        start_at=start_at,
        end_at=end_at,
        include_deleted=include_deleted,
    )
    items = db.execute(stmt).scalars().all()

    if format == "json":
        payload = [schemas.AuditLogRead.model_validate(item).model_dump() for item in items]
        return Response(
            content=json.dumps(payload, default=str),
            media_type="application/json",
        )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "created_at",
            "actor_id",
            "actor_role",
            "action",
            "category",
            "entity_type",
            "entity_id",
            "target_user_id",
            "severity",
            "source",
            "status",
            "ip_address",
            "user_agent",
            "old_value",
            "new_value",
        ]
    )
    for item in items:
        writer.writerow(
            [
                item.id,
                item.created_at.isoformat(),
                item.actor_id or "",
                item.actor_role or "",
                item.action,
                item.category.value if item.category else "",
                item.entity_type or "",
                item.entity_id or "",
                item.target_user_id or "",
                item.severity.value if item.severity else "",
                item.source.value if item.source else "",
                item.status.value if item.status else "",
                item.ip_address or "",
                item.user_agent or "",
                item.old_value or "",
                item.new_value or "",
            ]
        )
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit-logs.csv"},
    )


@router.get("/retention", response_model=schemas.AuditRetentionConfigRead)
def get_retention_config(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.AuditRetentionConfigRead:
    config = _get_or_create_retention_config(db)
    return schemas.AuditRetentionConfigRead.model_validate(config)


@router.patch("/retention", response_model=schemas.AuditRetentionConfigRead)
def update_retention_config(
    payload: schemas.AuditRetentionConfigUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.AuditRetentionConfigRead:
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    config = _get_or_create_retention_config(db)
    if payload.retention_days not in {30, 90, 180}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Retention must be 30, 90, or 180 days")
    config.retention_days = payload.retention_days
    db.commit()
    db.refresh(config)
    return schemas.AuditRetentionConfigRead.model_validate(config)


@router.post("/retention/apply", response_model=schemas.AuditRetentionApplyResponse)
def apply_retention_policy(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
) -> schemas.AuditRetentionApplyResponse:
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    config = _get_or_create_retention_config(db)
    cutoff = datetime.utcnow() - timedelta(days=config.retention_days)
    stmt = (
        update(models.AuditLog)
        .where(models.AuditLog.created_at < cutoff, models.AuditLog.deleted_at.is_(None))
        .values(deleted_at=datetime.utcnow())
    )
    result = db.execute(stmt)
    config.last_applied_at = datetime.utcnow()
    db.commit()
    return schemas.AuditRetentionApplyResponse(
        updated=result.rowcount or 0,
        cutoff_at=cutoff,
        retention_days=config.retention_days,
    )


@router.post("/audit/{log_id}/retry")
def retry_audit_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    log = db.get(models.AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log not found")
    if log.category != models.AuditLogCategoryEnum.AUTOMATION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Retry supported for automation logs only")
    if current_user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER, models.RoleEnum.MANAGER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient privileges")

    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="AUTOMATION_RETRY_REQUESTED",
            category=models.AuditLogCategoryEnum.AUTOMATION,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"retry_log_id": log_id, "original_action": log.action},
        )
    )
    return {"status": "queued"}
    def parse_csv(value: str | None) -> list[str]:
        if not value:
            return []
        return [item.strip() for item in value.split(",") if item.strip()]

    entity_types = parse_csv(entity_type)
    event_types = parse_csv(event_type)

    stmt = (
        select(models.AuditEvent)
        .options(selectinload(models.AuditEvent.actor))
        .order_by(models.AuditEvent.created_at.desc())
    )
    if entity_types:
        stmt = stmt.where(models.AuditEvent.entity_type.in_(entity_types))
    if event_types:
        stmt = stmt.where(models.AuditEvent.event_type.in_(event_types))
    if actor_id:
        stmt = stmt.where(models.AuditEvent.actor_id == actor_id)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    items = (
        db.execute(stmt.offset((page - 1) * page_size).limit(page_size))
        .scalars()
        .all()
    )
    total_pages = max(1, (total + page_size - 1) // page_size)
    return schemas.AuditEventListResponse(
        items=[schemas.AuditEventRead.model_validate(item) for item in items],
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )
