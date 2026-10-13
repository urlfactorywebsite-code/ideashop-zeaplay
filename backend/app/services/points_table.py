from __future__ import annotations

from typing import Any, Dict, Tuple

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from .. import models

PointsConfig = Dict[str, Dict[str, Dict[str, int]]]

DEFAULT_TASK_CREATION_POINTS = 10
DEFAULT_CLARITY_POINTS_PER_STAR = 5
DEFAULT_MANAGER_OVERDUE_PENALTY = 0

DEFAULT_POINTS_CONFIG: PointsConfig = {
    "Data Team": {
        "LOW": {"base": 10, "beforeDueBonus": 5, "overduePenalty": -5},
        "MEDIUM": {"base": 15, "beforeDueBonus": 10, "overduePenalty": -10},
        "HIGH": {"base": 25, "beforeDueBonus": 15, "overduePenalty": -15},
        "URGENT": {"base": 40, "beforeDueBonus": 20, "overduePenalty": -20},
    },
    "Lead Generation": {
        "LOW": {"base": 15, "beforeDueBonus": 5, "overduePenalty": -10},
        "MEDIUM": {"base": 25, "beforeDueBonus": 10, "overduePenalty": -15},
        "HIGH": {"base": 40, "beforeDueBonus": 15, "overduePenalty": -20},
        "URGENT": {"base": 60, "beforeDueBonus": 20, "overduePenalty": -25},
    },
    "Marketing Team": {
        "LOW": {"base": 15, "beforeDueBonus": 5, "overduePenalty": -10},
        "MEDIUM": {"base": 25, "beforeDueBonus": 10, "overduePenalty": -15},
        "HIGH": {"base": 35, "beforeDueBonus": 15, "overduePenalty": -20},
        "URGENT": {"base": 55, "beforeDueBonus": 20, "overduePenalty": -25},
    },
    "IT Support": {
        "LOW": {"base": 10, "beforeDueBonus": 5, "overduePenalty": -5},
        "MEDIUM": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -10},
        "HIGH": {"base": 30, "beforeDueBonus": 15, "overduePenalty": -15},
        "URGENT": {"base": 50, "beforeDueBonus": 20, "overduePenalty": -20},
    },
    "Sales Team": {
        "LOW": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -15},
        "MEDIUM": {"base": 35, "beforeDueBonus": 15, "overduePenalty": -20},
        "HIGH": {"base": 50, "beforeDueBonus": 20, "overduePenalty": -25},
        "URGENT": {"base": 70, "beforeDueBonus": 25, "overduePenalty": -30},
    },
    "Management": {
        "LOW": {"base": 10, "beforeDueBonus": 5, "overduePenalty": -5},
        "MEDIUM": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -10},
        "HIGH": {"base": 30, "beforeDueBonus": 15, "overduePenalty": -15},
        "URGENT": {"base": 45, "beforeDueBonus": 20, "overduePenalty": -20},
    },
    "Finance Team": {
        "LOW": {"base": 15, "beforeDueBonus": 5, "overduePenalty": -10},
        "MEDIUM": {"base": 25, "beforeDueBonus": 10, "overduePenalty": -15},
        "HIGH": {"base": 40, "beforeDueBonus": 15, "overduePenalty": -20},
        "URGENT": {"base": 55, "beforeDueBonus": 20, "overduePenalty": -25},
    },
    "Hyper Automation": {
        "LOW": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -15},
        "MEDIUM": {"base": 35, "beforeDueBonus": 15, "overduePenalty": -20},
        "HIGH": {"base": 50, "beforeDueBonus": 20, "overduePenalty": -25},
        "URGENT": {"base": 75, "beforeDueBonus": 25, "overduePenalty": -30},
    },
    "ZeaCRM": {
        "LOW": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -15},
        "MEDIUM": {"base": 35, "beforeDueBonus": 15, "overduePenalty": -20},
        "HIGH": {"base": 55, "beforeDueBonus": 20, "overduePenalty": -25},
        "URGENT": {"base": 80, "beforeDueBonus": 25, "overduePenalty": -30},
    },
    "URL Factory": {
        "LOW": {"base": 25, "beforeDueBonus": 10, "overduePenalty": -20},
        "MEDIUM": {"base": 40, "beforeDueBonus": 15, "overduePenalty": -25},
        "HIGH": {"base": 60, "beforeDueBonus": 20, "overduePenalty": -30},
        "URGENT": {"base": 85, "beforeDueBonus": 25, "overduePenalty": -35},
    },
    "Target Access Hub": {
        "LOW": {"base": 15, "beforeDueBonus": 5, "overduePenalty": -10},
        "MEDIUM": {"base": 25, "beforeDueBonus": 10, "overduePenalty": -15},
        "HIGH": {"base": 40, "beforeDueBonus": 15, "overduePenalty": -20},
        "URGENT": {"base": 60, "beforeDueBonus": 20, "overduePenalty": -25},
    },
    "Client": {
        "LOW": {"base": 10, "beforeDueBonus": 5, "overduePenalty": -10},
        "MEDIUM": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -15},
        "HIGH": {"base": 35, "beforeDueBonus": 15, "overduePenalty": -20},
        "URGENT": {"base": 50, "beforeDueBonus": 20, "overduePenalty": -25},
    },
    "Other": {
        "LOW": {"base": 10, "beforeDueBonus": 5, "overduePenalty": -5},
        "MEDIUM": {"base": 20, "beforeDueBonus": 10, "overduePenalty": -10},
        "HIGH": {"base": 30, "beforeDueBonus": 15, "overduePenalty": -15},
        "URGENT": {"base": 45, "beforeDueBonus": 20, "overduePenalty": -20},
    },
}


def _ensure_points_table(db: Session) -> None:
    inspector = inspect(db.bind)
    if "points_table_config" not in inspector.get_table_names():
        models.PointsTableConfig.__table__.create(bind=db.bind, checkfirst=True)


def get_points_table_config(db: Session) -> models.PointsTableConfig:
    _ensure_points_table(db)
    points_config = db.get(models.PointsTableConfig, 1)
    if points_config:
        return points_config
    points_config = models.PointsTableConfig(id=1)
    db.add(points_config)
    db.flush()
    db.refresh(points_config)
    return points_config


def _normalize_number(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)) and int(value) == value:
        return int(value)
    if isinstance(value, str):
        try:
            parsed = int(value)
            return parsed
        except ValueError:
            return fallback
    return fallback


def _normalize_non_negative(value: Any, fallback: int) -> int:
    normalized = _normalize_number(value, fallback)
    return max(0, normalized)


def _normalize_penalty(value: Any, fallback: int) -> int:
    normalized = _normalize_number(value, fallback)
    if normalized > 0:
        return -abs(normalized)
    return normalized


def _normalize_priority_points(raw: Any, defaults: Dict[str, int]) -> Dict[str, int]:
    if not isinstance(raw, dict):
        return dict(defaults)
    return {
        "base": _normalize_number(raw.get("base"), defaults["base"]),
        "beforeDueBonus": _normalize_number(raw.get("beforeDueBonus"), defaults["beforeDueBonus"]),
        "overduePenalty": _normalize_penalty(raw.get("overduePenalty"), defaults["overduePenalty"]),
    }


def _clone_default_config() -> PointsConfig:
    config: PointsConfig = {}
    for department, priorities in DEFAULT_POINTS_CONFIG.items():
        config[department] = {priority: dict(values) for priority, values in priorities.items()}
    return config


def _normalize_points_config(raw: Any) -> PointsConfig:
    config = _clone_default_config()
    if not isinstance(raw, dict):
        return config

    for department, priorities in raw.items():
        defaults = config.get(department) or config.get("Other") or {}
        if not isinstance(priorities, dict):
            continue
        normalized_priority: Dict[str, Dict[str, int]] = {}
        for priority in ["LOW", "MEDIUM", "HIGH", "URGENT"]:
            normalized_priority[priority] = _normalize_priority_points(
                priorities.get(priority),
                defaults.get(priority, {"base": 0, "beforeDueBonus": 0, "overduePenalty": 0}),
            )
        config[department] = normalized_priority
    return config


def _normalize_department_key(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _find_department(config: PointsConfig, team: str) -> Tuple[str, bool]:
    if not team:
        fallback = "Other" if "Other" in config else next(iter(config.keys()), "Other")
        return fallback, True

    target = _normalize_department_key(team)
    for department in config.keys():
        if _normalize_department_key(department) == target:
            return department, False

    if "Other" in config:
        return "Other", True
    return next(iter(config.keys()), "Other"), True


def resolve_task_points(
    db: Session,
    *,
    team: str,
    priority: models.TaskPriorityEnum,
) -> Dict[str, int]:
    points_table = get_points_table_config(db)
    config = _normalize_points_config(points_table.points_config)
    department, _ = _find_department(config, team)
    priority_key = priority.value if isinstance(priority, models.TaskPriorityEnum) else str(priority)
    priority_points = config.get(department, {}).get(priority_key)
    if priority_points:
        return dict(priority_points)
    return dict(DEFAULT_POINTS_CONFIG.get("Other", {}).get(priority_key, {"base": 0, "beforeDueBonus": 0, "overduePenalty": 0}))


def get_task_creation_points(db: Session) -> int:
    points_table = get_points_table_config(db)
    return _normalize_non_negative(points_table.task_creation_points, DEFAULT_TASK_CREATION_POINTS)


def get_clarity_points_per_star(db: Session) -> int:
    points_table = get_points_table_config(db)
    return _normalize_non_negative(points_table.clarity_points_per_star, DEFAULT_CLARITY_POINTS_PER_STAR)


def get_manager_overdue_penalty(db: Session) -> int:
    points_table = get_points_table_config(db)
    return _normalize_penalty(points_table.manager_overdue_penalty, DEFAULT_MANAGER_OVERDUE_PENALTY)


def is_same_department(user: models.User, assignee: models.User | None) -> bool:
    if not user.department_id or not assignee or not assignee.department_id:
        return False
    return user.department_id == assignee.department_id
