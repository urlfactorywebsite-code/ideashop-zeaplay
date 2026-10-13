from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import audit_logger

router = APIRouter(prefix="/tool-library", tags=["tool-library"])


def _assert_admin_or_owner(user: models.User) -> None:
    if user.role not in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")


def _parse_csv(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _build_category_response(
    *,
    items: list[models.ToolCategory],
    page: int,
    page_size: int,
    total: int,
) -> schemas.ToolCategoryListResponse:
    total_pages = max(1, (total + page_size - 1) // page_size)
    payload = [schemas.ToolCategoryRead.model_validate(item) for item in items]
    return schemas.ToolCategoryListResponse(
        items=payload,
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )


def _build_tool_response(
    *,
    items: list[models.Tool],
    favorite_ids: set[str],
    page: int,
    page_size: int,
    total: int,
) -> schemas.ToolListResponse:
    total_pages = max(1, (total + page_size - 1) // page_size)
    payload: list[schemas.ToolRead] = []
    for tool in items:
        tool_payload = schemas.ToolRead.model_validate(tool)
        payload.append(tool_payload.model_copy(update={"is_favorite": tool.id in favorite_ids}))
    return schemas.ToolListResponse(
        items=payload,
        page=page,
        total=total,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/categories", response_model=schemas.ToolCategoryListResponse)
def list_categories(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status_filter: Optional[models.ToolCategoryStatusEnum] = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    stmt = select(models.ToolCategory)
    if current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}:
        if status_filter:
            stmt = stmt.where(models.ToolCategory.status == status_filter)
    else:
        stmt = stmt.where(models.ToolCategory.status == models.ToolCategoryStatusEnum.ACTIVE)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    items = (
        db.execute(
            stmt.order_by(models.ToolCategory.display_order.asc(), models.ToolCategory.name.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return _build_category_response(items=items, page=page, page_size=page_size, total=total)


@router.post("/categories", response_model=schemas.ToolCategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: schemas.ToolCategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    existing = (
        db.execute(select(models.ToolCategory).where(models.ToolCategory.name == payload.name))
        .scalar_one_or_none()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category already exists")

    category = models.ToolCategory(
        name=payload.name,
        description=payload.description,
        display_order=payload.display_order,
        status=payload.status,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_CATEGORY_CREATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool_category",
            entity_id=str(category.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": category.name},
        )
    )
    return category


@router.put("/categories/{category_id}", response_model=schemas.ToolCategoryRead)
def update_category(
    category_id: str,
    payload: schemas.ToolCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    category = db.get(models.ToolCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    update = payload.model_dump(exclude_unset=True)
    if "name" in update:
        existing = (
            db.execute(select(models.ToolCategory).where(models.ToolCategory.name == update["name"]))
            .scalar_one_or_none()
        )
        if existing and existing.id != category_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category already exists")
        category.name = update["name"]
    if "description" in update:
        category.description = update["description"]
    if "display_order" in update:
        category.display_order = update["display_order"]
    if "status" in update:
        category.status = update["status"]

    db.commit()
    db.refresh(category)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_CATEGORY_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool_category",
            entity_id=str(category.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata=update,
        )
    )
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_category(
    category_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    category = db.get(models.ToolCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    category.status = models.ToolCategoryStatusEnum.ARCHIVED
    db.commit()
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_CATEGORY_ARCHIVED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool_category",
            entity_id=str(category.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": category.name},
        )
    )
    return None


@router.get("/tools", response_model=schemas.ToolListResponse)
def list_tools(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: Optional[str] = Query(default=None),
    category_id: Optional[str] = Query(default=None),
    pricing_type: Optional[models.ToolPricingTypeEnum] = Query(default=None),
    status_filter: Optional[models.ToolStatusEnum] = Query(default=None, alias="status"),
    tags: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    is_admin = current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}
    stmt = select(models.Tool).options(selectinload(models.Tool.category))

    if is_admin:
        if status_filter:
            stmt = stmt.where(models.Tool.status == status_filter)
    else:
        stmt = stmt.where(
            (models.Tool.status == models.ToolStatusEnum.APPROVED)
            | (models.Tool.created_by == str(current_user.id))
        )

    if category_id:
        stmt = stmt.where(models.Tool.category_id == category_id)
    if pricing_type:
        stmt = stmt.where(models.Tool.pricing_type == pricing_type)
    if q:
        query_value = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                models.Tool.name.ilike(query_value),
                models.Tool.description.ilike(query_value),
            )
        )

    parsed_tags = _parse_csv(tags)
    if parsed_tags:
        if db.bind.dialect.name == "postgresql":
            for tag in parsed_tags:
                stmt = stmt.where(models.Tool.tags.contains([tag]))
        else:
            for tag in parsed_tags:
                stmt = stmt.where(models.Tool.tags.like(f'%\"{tag}\"%'))

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    items = (
        db.execute(
            stmt.order_by(models.Tool.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    favorite_ids = set(
        db.execute(
            select(models.UserFavoriteTool.tool_id).where(
                models.UserFavoriteTool.user_id == str(current_user.id)
            )
        )
        .scalars()
        .all()
    )
    return _build_tool_response(items=items, favorite_ids=favorite_ids, page=page, page_size=page_size, total=total)


@router.post("/tools", response_model=schemas.ToolRead, status_code=status.HTTP_201_CREATED)
def create_tool(
    payload: schemas.ToolCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    is_admin = current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}
    tool = models.Tool(
        name=payload.name,
        description=payload.description,
        website_url=payload.website_url,
        preview_image_url=payload.preview_image_url,
        category_id=payload.category_id,
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
        pricing_type=payload.pricing_type,
        is_internal=payload.is_internal if is_admin else False,
        status=models.ToolStatusEnum.PENDING,
        created_by=str(current_user.id),
    )
    db.add(tool)
    db.commit()
    db.refresh(tool)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_SUBMITTED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool",
            entity_id=str(tool.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": tool.name, "status": tool.status.value},
        )
    )
    tool_payload = schemas.ToolRead.model_validate(tool)
    return tool_payload.model_copy(update={"is_favorite": False})


@router.put("/tools/{tool_id}", response_model=schemas.ToolRead)
def update_tool(
    tool_id: str,
    payload: schemas.ToolUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    is_admin = current_user.role in {models.RoleEnum.ADMIN, models.RoleEnum.OWNER}
    tool = db.execute(
        select(models.Tool).options(selectinload(models.Tool.category)).where(models.Tool.id == tool_id)
    ).scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found")

    if not is_admin:
        if tool.created_by != str(current_user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to update tool")
        if tool.status != models.ToolStatusEnum.PENDING:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tool cannot be edited after review")

    update = payload.model_dump(exclude_unset=True)
    if "name" in update:
        tool.name = update["name"]
    if "description" in update:
        tool.description = update["description"]
    if "website_url" in update:
        tool.website_url = update["website_url"]
    if "preview_image_url" in update:
        tool.preview_image_url = update["preview_image_url"]
    if "category_id" in update:
        tool.category_id = update["category_id"]
    if "tags" in update and update["tags"] is not None:
        tool.tags = [tag.strip() for tag in update["tags"] if tag.strip()]
    if "pricing_type" in update and update["pricing_type"] is not None:
        tool.pricing_type = update["pricing_type"]
    if "is_internal" in update and is_admin:
        tool.is_internal = update["is_internal"]
    if "status" in update and is_admin and update["status"] is not None:
        tool.status = update["status"]

    db.commit()
    db.refresh(tool)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool",
            entity_id=str(tool.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata=update,
        )
    )
    favorite = db.execute(
        select(models.UserFavoriteTool).where(
            models.UserFavoriteTool.user_id == str(current_user.id),
            models.UserFavoriteTool.tool_id == tool.id,
        )
    ).scalar_one_or_none()
    tool_payload = schemas.ToolRead.model_validate(tool)
    return tool_payload.model_copy(update={"is_favorite": favorite is not None})


@router.post("/tools/{tool_id}/approve", response_model=schemas.ToolRead)
def approve_tool(
    tool_id: str,
    payload: schemas.ToolDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    tool = db.execute(
        select(models.Tool).options(selectinload(models.Tool.category)).where(models.Tool.id == tool_id)
    ).scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found")

    tool.status = models.ToolStatusEnum.APPROVED
    tool.approved_by = str(current_user.id)
    tool.review_reason = payload.reason
    db.commit()
    db.refresh(tool)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_APPROVED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool",
            entity_id=str(tool.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"reason": payload.reason},
        )
    )
    tool_payload = schemas.ToolRead.model_validate(tool)
    return tool_payload.model_copy(update={"is_favorite": False})


@router.post("/tools/{tool_id}/reject", response_model=schemas.ToolRead)
def reject_tool(
    tool_id: str,
    payload: schemas.ToolDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    _assert_admin_or_owner(current_user)

    tool = db.execute(
        select(models.Tool).options(selectinload(models.Tool.category)).where(models.Tool.id == tool_id)
    ).scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found")

    tool.status = models.ToolStatusEnum.REJECTED
    tool.approved_by = str(current_user.id)
    tool.review_reason = payload.reason
    db.commit()
    db.refresh(tool)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="TOOL_REJECTED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="tool",
            entity_id=str(tool.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"reason": payload.reason},
        )
    )
    tool_payload = schemas.ToolRead.model_validate(tool)
    return tool_payload.model_copy(update={"is_favorite": False})


@router.post("/tools/{tool_id}/favorite", response_model=schemas.ToolRead)
def toggle_favorite(
    tool_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    tool = db.execute(
        select(models.Tool).options(selectinload(models.Tool.category)).where(models.Tool.id == tool_id)
    ).scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found")

    favorite = db.execute(
        select(models.UserFavoriteTool).where(
            models.UserFavoriteTool.user_id == str(current_user.id),
            models.UserFavoriteTool.tool_id == tool_id,
        )
    ).scalar_one_or_none()
    is_favorite = False
    if favorite:
        db.delete(favorite)
    else:
        favorite = models.UserFavoriteTool(user_id=str(current_user.id), tool_id=tool_id)
        db.add(favorite)
        is_favorite = True
    db.commit()
    tool_payload = schemas.ToolRead.model_validate(tool)
    return tool_payload.model_copy(update={"is_favorite": is_favorite})


@router.get("/tools/favorites", response_model=schemas.ToolFavoriteListResponse)
def list_favorites(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    stmt = (
        select(models.UserFavoriteTool)
        .options(selectinload(models.UserFavoriteTool.tool).selectinload(models.Tool.category))
        .where(models.UserFavoriteTool.user_id == str(current_user.id))
    )
    favorites = db.execute(stmt).scalars().all()
    payload: list[schemas.ToolRead] = []
    for favorite in favorites:
        tool_payload = schemas.ToolRead.model_validate(favorite.tool)
        payload.append(tool_payload.model_copy(update={"is_favorite": True}))
    return schemas.ToolFavoriteListResponse(items=payload)
