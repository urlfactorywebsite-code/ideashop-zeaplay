from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload
from typing import List

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin
from ..services import audit_logger

router = APIRouter(prefix="/levels", tags=["levels"])


@router.get("", response_model=List[schemas.LevelRead])
def list_levels(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return db.execute(select(models.Level)).scalars().all()


@router.get("/{level_id}", response_model=schemas.LevelRead)
def get_level(
    level_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")
    return level


@router.post("", response_model=schemas.LevelRead, status_code=status.HTTP_201_CREATED)
def create_level(
    payload: schemas.LevelCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    level = models.Level(
        name=payload.name,
        bg_image=payload.bg_image,
        is_active=payload.is_active,
        created_by_id=current_user.id,
    )
    db.add(level)
    db.commit()
    db.refresh(level)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_CREATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level",
            entity_id=str(level.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": level.name},
        )
    )
    return level


@router.patch("/{level_id}", response_model=schemas.LevelRead)
def update_level(
    level_id: str,
    payload: schemas.LevelUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")

    if payload.name is not None:
        level.name = payload.name
    if payload.bg_image is not None:
        level.bg_image = payload.bg_image
    if payload.is_active is not None:
        level.is_active = payload.is_active

    db.commit()
    db.refresh(level)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level",
            entity_id=str(level.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"fields": list(payload.model_dump(exclude_unset=True).keys())},
        )
    )
    return level


@router.delete("/{level_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_level(
    level_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")
    db.delete(level)
    db.commit()
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_DELETED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level",
            entity_id=str(level_id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"name": level.name},
        )
    )


# Node CRUD
@router.get("/{level_id}/nodes", response_model=List[schemas.LevelNodeRead])
def list_level_nodes(
    level_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    return db.execute(
        select(models.LevelNode).where(models.LevelNode.level_id == level_id)
    ).scalars().all()


@router.post("/{level_id}/nodes", response_model=schemas.LevelNodeRead, status_code=status.HTTP_201_CREATED)
def create_level_node(
    level_id: str,
    payload: schemas.LevelNodeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    # Verify level exists
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")

    node = models.LevelNode(
        level_id=level_id,
        type=payload.type,
        x=payload.x,
        y=payload.y,
        width=payload.width,
        height=payload.height,
        title=payload.title,
        description=payload.description,
        xp_threshold=payload.xp_threshold,
        reward_id=payload.reward_id,
        require_confirm=payload.require_confirm,
        animation_key=payload.animation_key,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_NODE_CREATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level_node",
            entity_id=str(node.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"level_id": level_id, "type": node.type},
        )
    )
    return node


@router.patch("/{level_id}/nodes/{node_id}", response_model=schemas.LevelNodeRead)
def update_level_node(
    level_id: str,
    node_id: str,
    payload: schemas.LevelNodeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    node = db.get(models.LevelNode, node_id)
    if not node or node.level_id != level_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(node, field, value)

    db.commit()
    db.refresh(node)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_NODE_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level_node",
            entity_id=str(node.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"fields": list(payload.model_dump(exclude_unset=True).keys())},
        )
    )
    return node


@router.delete("/{level_id}/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_level_node(
    level_id: str,
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    node = db.get(models.LevelNode, node_id)
    if not node or node.level_id != level_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    db.delete(node)
    db.commit()
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_NODE_DELETED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level_node",
            entity_id=str(node_id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"level_id": level_id},
        )
    )


# Edge CRUD
@router.get("/{level_id}/edges", response_model=List[schemas.LevelEdgeRead])
def list_level_edges(
    level_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_active_user),
):
    return db.execute(
        select(models.LevelEdge).where(models.LevelEdge.level_id == level_id)
    ).scalars().all()


@router.post("/{level_id}/edges", response_model=schemas.LevelEdgeRead, status_code=status.HTTP_201_CREATED)
def create_level_edge(
    level_id: str,
    payload: schemas.LevelEdgeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    # Verify level exists
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")

    # Verify nodes exist and belong to this level
    source_node = db.get(models.LevelNode, payload.from_node)
    target_node = db.get(models.LevelNode, payload.to_node)
    if not source_node or not target_node or source_node.level_id != level_id or target_node.level_id != level_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid nodes")

    edge = models.LevelEdge(
        level_id=level_id,
        source_node_id=payload.from_node,
        target_node_id=payload.to_node,
        path=payload.path,
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_EDGE_CREATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level_edge",
            entity_id=str(edge.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"level_id": level_id},
        )
    )
    return edge


@router.patch("/{level_id}/edges/{edge_id}", response_model=schemas.LevelEdgeRead)
def update_level_edge(
    level_id: str,
    edge_id: str,
    payload: schemas.LevelEdgeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    edge = db.get(models.LevelEdge, edge_id)
    if not edge or edge.level_id != level_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "from_node":
            setattr(edge, "source_node_id", value)
        elif field == "to_node":
            setattr(edge, "target_node_id", value)
        else:
            setattr(edge, field, value)

    db.commit()
    db.refresh(edge)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_EDGE_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level_edge",
            entity_id=str(edge.id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"fields": list(payload.model_dump(exclude_unset=True).keys())},
        )
    )
    return edge


@router.delete("/{level_id}/edges/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_level_edge(
    level_id: str,
    edge_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_admin),
):
    edge = db.get(models.LevelEdge, edge_id)
    if not edge or edge.level_id != level_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    db.delete(edge)
    db.commit()
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="LEVEL_EDGE_DELETED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else None,
            entity_type="level_edge",
            entity_id=str(edge_id),
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"level_id": level_id},
        )
    )


# Preview endpoint
@router.get("/{level_id}/preview", response_model=schemas.LevelPreviewResponse)
def get_level_preview(
    level_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")

    nodes = db.execute(
        select(models.LevelNode).where(models.LevelNode.level_id == level_id)
    ).scalars().all()

    edges = db.execute(
        select(models.LevelEdge).where(models.LevelEdge.level_id == level_id)
    ).scalars().all()

    # Calculate reachable nodes based on user XP
    user_xp = current_user.points
    reachable_nodes = []
    visited = set()

    def dfs(node_id):
        if node_id in visited:
            return
        visited.add(node_id)
        node = next((n for n in nodes if n.id == node_id), None)
        if node and user_xp >= node.xp_threshold:
            reachable_nodes.append(node_id)
            # Find connected nodes
            for edge in edges:
                if edge.source_node_id == node_id:
                    dfs(edge.target_node_id)

    # Start from nodes with xp_threshold = 0
    start_nodes = [n.id for n in nodes if n.xp_threshold == 0]
    for start_node in start_nodes:
        dfs(start_node)

    return schemas.LevelPreviewResponse(
        level=level,
        nodes=nodes,
        edges=edges,
        user_xp=user_xp,
        reachable_nodes=reachable_nodes,
    )


# Claim reward at node
@router.post("/{level_id}/nodes/{node_id}/claim", status_code=status.HTTP_200_OK)
def claim_node_reward(
    level_id: str,
    node_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    node = db.get(models.LevelNode, node_id)
    if not node or node.level_id != level_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    if not node.reward_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Node has no reward")

    # Check if user has enough XP
    if current_user.points < node.xp_threshold:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient XP")

    # Check if already claimed
    existing_event = db.execute(
        select(models.LevelEvent).where(
            models.LevelEvent.level_id == level_id,
            models.LevelEvent.node_id == node_id,
            models.LevelEvent.user_id == current_user.id,
            models.LevelEvent.event_type == models.EventTypeEnum.CLAIMED,
        )
    ).scalar_one_or_none()
    if existing_event:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already claimed")

    # Create claim event
    event = models.LevelEvent(
        level_id=level_id,
        node_id=node_id,
        event_type=models.EventTypeEnum.CLAIMED,
        user_id=current_user.id,
    )
    db.add(event)

    # Handle reward claiming logic here (integrate with rewards service)
    # For now, just log the event

    db.commit()
    return {"message": "Reward claimed successfully"}


@router.get("/{level_id}/progress", response_model=schemas.UserProgressRead)
def get_user_progress(
    level_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Verify level exists
    level = db.get(models.Level, level_id)
    if not level:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Level not found")

    # Query for existing progress
    progress = db.execute(
        select(models.UserProgress).where(
            models.UserProgress.user_id == current_user.id,
            models.UserProgress.level_id == level_id,
        )
    ).scalar_one_or_none()

    if progress:
        return progress

    # Create new progress if not exists
    progress = models.UserProgress(
        user_id=current_user.id,
        level_id=level_id,
        season_id=None,  # Can be set later if needed
        current_points=0,
        total_points_earned=0,
        level_unlocked_at=datetime.utcnow(),
    )
    db.add(progress)
    db.commit()
    db.refresh(progress)
    return progress
