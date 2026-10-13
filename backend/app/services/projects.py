from __future__ import annotations

import math
import uuid
from datetime import date, datetime, time
from typing import Any, Literal

from fastapi import HTTPException, status
from sqlalchemy import func, inspect, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from . import security_audit


SortField = Literal["name", "created_at", "updated_at", "status", "client"]
SortOrder = Literal["asc", "desc"]

SORT_FIELDS: dict[str, Any] = {
    "name": models.Project.name,
    "created_at": models.Project.created_at,
    "updated_at": models.Project.updated_at,
    "status": models.Project.status,
    "client": models.Client.company_name,
}


def normalize_project_name(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _tenant_uuid(value: uuid.UUID | str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _as_datetime(value: date | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, time.min)


def _is_admin(actor: models.User) -> bool:
    return actor.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}


def _project_query(tenant_id: uuid.UUID):
    return (
        select(models.Project)
        .options(
            selectinload(models.Project.client),
            selectinload(models.Project.members).selectinload(models.ProjectMember.user),
        )
        .where(models.Project.tenant_id == tenant_id)
    )


def _get_active_client(db: Session, *, tenant_id: uuid.UUID, client_id: str) -> models.Client:
    client = (
        db.execute(
            select(models.Client)
            .where(models.Client.tenant_id == tenant_id)
            .where(models.Client.id == client_id)
            .where(models.Client.status == models.ClientStatusEnum.ACTIVE)
        )
        .scalars()
        .first()
    )
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active client not found")
    return client


def _get_active_users(db: Session, *, tenant_id: uuid.UUID, user_ids: set[str]) -> dict[str, models.User]:
    if not user_ids:
        return {}
    users = (
        db.execute(
            select(models.User)
            .where(models.User.tenant_id == tenant_id)
            .where(models.User.id.in_(user_ids))
            .where(models.User.status == models.UserStatusEnum.ACTIVE)
        )
        .scalars()
        .all()
    )
    found = {user.id: user for user in users}
    missing = sorted(user_ids - set(found))
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more active users were not found")
    return found


def _manager_ids(project: models.Project) -> set[str]:
    return {
        member.user_id
        for member in project.members
        if member.role == models.ProjectMemberRoleEnum.MANAGER
        and member.user is not None
        and member.user.status == models.UserStatusEnum.ACTIVE
    }


def _ensure_project_manager(project: models.Project, actor: models.User) -> None:
    if _is_admin(actor):
        return
    if actor.role != models.RoleEnum.MANAGER or actor.id not in _manager_ids(project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project manager access required")


def _ensure_can_read(project: models.Project, actor: models.User) -> None:
    if _is_admin(actor):
        return
    if actor.id not in {member.user_id for member in project.members}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")


def _apply_visibility(stmt, actor: models.User):
    if _is_admin(actor):
        return stmt
    return stmt.join(models.ProjectMember).where(
        models.ProjectMember.tenant_id == actor.tenant_id,
        models.ProjectMember.user_id == actor.id,
    )


def _membership_payload(
    *,
    manager_ids: list[str] | None,
    member_ids: list[str] | None,
    actor: models.User,
    require_actor_manager: bool = False,
) -> dict[str, models.ProjectMemberRoleEnum]:
    membership: dict[str, models.ProjectMemberRoleEnum] = {}
    for user_id in member_ids or []:
        membership[user_id] = models.ProjectMemberRoleEnum.MEMBER
    for user_id in manager_ids or []:
        membership[user_id] = models.ProjectMemberRoleEnum.MANAGER
    if require_actor_manager and actor.role == models.RoleEnum.MANAGER:
        membership[actor.id] = models.ProjectMemberRoleEnum.MANAGER
    if not any(role == models.ProjectMemberRoleEnum.MANAGER for role in membership.values()):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Active projects require at least one manager")
    return membership


def _replace_members(
    db: Session,
    *,
    project: models.Project,
    membership: dict[str, models.ProjectMemberRoleEnum],
    actor: models.User,
) -> None:
    _get_active_users(db, tenant_id=project.tenant_id, user_ids=set(membership))
    if project.status == models.ProjectStatusEnum.ACTIVE and not any(
        role == models.ProjectMemberRoleEnum.MANAGER for role in membership.values()
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Active projects require at least one manager")

    existing = {member.user_id: member for member in project.members}
    for user_id, role in membership.items():
        member = existing.pop(user_id, None)
        if member:
            member.role = role
            member.updated_by_id = actor.id
        else:
            project.members.append(
                models.ProjectMember(
                    tenant_id=project.tenant_id,
                    project_id=project.id,
                    user_id=user_id,
                    role=role,
                    created_by_id=actor.id,
                    updated_by_id=actor.id,
                )
            )
    for stale in existing.values():
        db.delete(stale)


def _to_read(project: models.Project, *, task_count: int = 0) -> schemas.ProjectRead:
    members = sorted(
        (member for member in project.members if member.user is not None),
        key=lambda item: (item.role.value, item.user.name.casefold()),
    )
    return schemas.ProjectRead(
        id=project.id,
        tenant_id=project.tenant_id,
        client_id=project.client_id,
        name=project.name,
        normalized_name=project.normalized_name,
        description=project.description,
        status=project.status,
        start_date=project.start_date,
        end_date=project.end_date,
        client=schemas.ProjectClientSummary(
            id=project.client.id,
            company_name=project.client.company_name,
            status=project.client.status,
        ),
        members=[
            schemas.ProjectMemberRead(
                id=member.id,
                user_id=member.user_id,
                name=member.user.name,
                email=member.user.email,
                role=member.role,
                user_role=member.user.role,
                status=member.user.status,
            )
            for member in members
        ],
        task_count=task_count,
        subtask_approval_required_default=project.subtask_approval_required_default,
        created_by_id=project.created_by_id,
        updated_by_id=project.updated_by_id,
        archived_by_id=project.archived_by_id,
        archived_at=project.archived_at,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def get_project(db: Session, *, tenant_id: uuid.UUID | str, project_id: str, actor: models.User) -> models.Project:
    tenant_uuid = _tenant_uuid(tenant_id)
    project = db.execute(_project_query(tenant_uuid).where(models.Project.id == project_id)).scalars().first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    _ensure_can_read(project, actor)
    return project


def list_projects(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    actor: models.User,
    page: int = 1,
    page_size: int = 20,
    search: str | None = None,
    status_filter: models.ProjectStatusEnum | None = None,
    client_id: str | None = None,
    mine: bool = False,
    sort_by: SortField = "name",
    sort_order: SortOrder = "asc",
) -> schemas.ProjectListResponse:
    tenant_uuid = _tenant_uuid(tenant_id)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    stmt = _project_query(tenant_uuid).join(models.Client, models.Project.client_id == models.Client.id)
    stmt = _apply_visibility(stmt, actor)

    if mine and _is_admin(actor):
        stmt = stmt.join(models.ProjectMember).where(
            models.ProjectMember.tenant_id == tenant_uuid,
            models.ProjectMember.user_id == actor.id,
        )
    if status_filter is not None:
        stmt = stmt.where(models.Project.status == status_filter)
    if client_id:
        stmt = stmt.where(models.Project.client_id == client_id)
    if search:
        needle = f"%{search.strip().casefold()}%"
        stmt = stmt.where(
            or_(
                func.lower(models.Project.name).like(needle),
                func.lower(models.Project.normalized_name).like(needle),
                func.lower(models.Project.description).like(needle),
                func.lower(models.Client.company_name).like(needle),
            )
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    sort_column = SORT_FIELDS.get(sort_by, models.Project.name)
    order_expr = sort_column.desc() if sort_order == "desc" else sort_column.asc()
    rows = (
        db.execute(
            stmt.order_by(order_expr, models.Project.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .unique()
        .all()
    )
    project_ids = [row.id for row in rows]
    task_counts = {}
    tasks_table_exists = True
    try:
        tasks_table_exists = "tasks" in inspect(db.bind).get_table_names()
    except Exception:
        tasks_table_exists = False
    if project_ids and tasks_table_exists:
        task_counts = dict(
            db.execute(
                select(models.Task.project_id, func.count(models.Task.id))
                .where(models.Task.project_id.in_(project_ids))
                .group_by(models.Task.project_id)
            ).all()
        )
    return schemas.ProjectListResponse(
        items=[_to_read(row, task_count=int(task_counts.get(row.id, 0))) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        total_pages=max(1, math.ceil(total / page_size)) if total else 1,
    )


def create_project(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    payload: schemas.ProjectCreate,
    actor: models.User,
) -> models.Project:
    tenant_uuid = _tenant_uuid(tenant_id)
    _get_active_client(db, tenant_id=tenant_uuid, client_id=payload.client_id)
    membership = _membership_payload(
        manager_ids=payload.manager_ids,
        member_ids=payload.member_ids,
        actor=actor,
        require_actor_manager=True,
    )
    _get_active_users(db, tenant_id=tenant_uuid, user_ids=set(membership))
    project = models.Project(
        tenant_id=tenant_uuid,
        client_id=payload.client_id,
        name=payload.name,
        normalized_name=normalize_project_name(payload.name),
        description=payload.description,
        status=models.ProjectStatusEnum.ACTIVE,
        start_date=_as_datetime(payload.start_date),
        end_date=_as_datetime(payload.end_date),
        subtask_approval_required_default=payload.subtask_approval_required_default,
        created_by_id=actor.id,
        updated_by_id=actor.id,
    )
    db.add(project)
    db.flush()
    _replace_members(db, project=project, membership=membership, actor=actor)
    security_audit.append_event(
        db,
        actor=actor,
        event_type="project.created",
        entity_type="project",
        entity_id=project.id,
        payload={
            "client_id": project.client_id,
            "manager_count": sum(1 for role in membership.values() if role == models.ProjectMemberRoleEnum.MANAGER),
            "member_count": sum(1 for role in membership.values() if role == models.ProjectMemberRoleEnum.MEMBER),
        },
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Duplicate project membership") from exc
    db.refresh(project)
    return db.execute(_project_query(tenant_uuid).where(models.Project.id == project.id)).scalars().first()


def update_project(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    project_id: str,
    payload: schemas.ProjectUpdate,
    actor: models.User,
) -> models.Project:
    project = get_project(db, tenant_id=tenant_id, project_id=project_id, actor=actor)
    _ensure_project_manager(project, actor)
    update_data = payload.model_dump(exclude_unset=True)
    if "client_id" in update_data:
        _get_active_client(db, tenant_id=project.tenant_id, client_id=update_data["client_id"])
        project.client_id = update_data["client_id"]
    if "name" in update_data:
        project.name = update_data["name"]
        project.normalized_name = normalize_project_name(update_data["name"])
    if "description" in update_data:
        project.description = update_data["description"]
    if "start_date" in update_data:
        project.start_date = _as_datetime(update_data["start_date"])
    if "end_date" in update_data:
        project.end_date = _as_datetime(update_data["end_date"])
    if "subtask_approval_required_default" in update_data:
        project.subtask_approval_required_default = bool(update_data["subtask_approval_required_default"])
    if project.start_date and project.end_date and project.end_date < project.start_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="End date cannot be before start date")
    if "manager_ids" in update_data or "member_ids" in update_data:
        current_managers = [member.user_id for member in project.members if member.role == models.ProjectMemberRoleEnum.MANAGER]
        current_members = [member.user_id for member in project.members if member.role == models.ProjectMemberRoleEnum.MEMBER]
        membership = _membership_payload(
            manager_ids=update_data.get("manager_ids", current_managers),
            member_ids=update_data.get("member_ids", current_members),
            actor=actor,
        )
        _replace_members(db, project=project, membership=membership, actor=actor)
    project.updated_by_id = actor.id
    security_audit.append_event(
        db,
        actor=actor,
        event_type="project.updated",
        entity_type="project",
        entity_id=project.id,
        payload={"fields": sorted(update_data.keys())},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Duplicate project membership") from exc
    return db.execute(_project_query(project.tenant_id).where(models.Project.id == project.id)).scalars().first()


def replace_project_members(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    project_id: str,
    payload: schemas.ProjectMembershipInput,
    actor: models.User,
) -> models.Project:
    project = get_project(db, tenant_id=tenant_id, project_id=project_id, actor=actor)
    _ensure_project_manager(project, actor)
    membership = _membership_payload(manager_ids=payload.manager_ids, member_ids=payload.member_ids, actor=actor)
    _replace_members(db, project=project, membership=membership, actor=actor)
    project.updated_by_id = actor.id
    security_audit.append_event(
        db,
        actor=actor,
        event_type="project.members_replaced",
        entity_type="project",
        entity_id=project.id,
        payload={
            "manager_count": sum(1 for role in membership.values() if role == models.ProjectMemberRoleEnum.MANAGER),
            "member_count": sum(1 for role in membership.values() if role == models.ProjectMemberRoleEnum.MEMBER),
        },
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Duplicate project membership") from exc
    return db.execute(_project_query(project.tenant_id).where(models.Project.id == project.id)).scalars().first()


def archive_project(
    db: Session,
    *,
    tenant_id: uuid.UUID | str,
    project_id: str,
    payload: schemas.ProjectArchive,
    actor: models.User,
) -> models.Project:
    project = get_project(db, tenant_id=tenant_id, project_id=project_id, actor=actor)
    _ensure_project_manager(project, actor)
    if project.status == models.ProjectStatusEnum.ARCHIVED:
        return project
    project.status = models.ProjectStatusEnum.ARCHIVED
    project.archived_at = datetime.utcnow()
    project.archived_by_id = actor.id
    project.updated_by_id = actor.id
    if payload.reason:
        existing = project.description or ""
        note = f"Archive reason: {payload.reason}"
        project.description = f"{existing}\n{note}".strip() if existing else note
    security_audit.append_event(
        db,
        actor=actor,
        event_type="project.archived",
        entity_type="project",
        entity_id=project.id,
        payload={"reason_provided": bool(payload.reason)},
    )
    db.commit()
    return db.execute(_project_query(project.tenant_id).where(models.Project.id == project.id)).scalars().first()


def count_project_tasks(db: Session, *, project_id: str) -> int:
    try:
        if "tasks" not in inspect(db.bind).get_table_names():
            return 0
    except Exception:
        return 0
    return int(
        db.execute(select(func.count(models.Task.id)).where(models.Task.project_id == project_id)).scalar_one()
    )


def to_read(project: models.Project, *, task_count: int = 0) -> schemas.ProjectRead:
    return _to_read(project, task_count=task_count)
