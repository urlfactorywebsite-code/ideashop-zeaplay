"""Badge rule engine and progress tracking."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models
from . import notifications as notification_service


@dataclass(frozen=True)
class BadgeEvent:
    entity: str
    event: str
    actor_id: Optional[str] = None
    assigned_to_id: Optional[str] = None
    created_by_id: Optional[str] = None
    priority: Optional[str] = None
    project_id: Optional[str] = None
    pipeline_id: Optional[str] = None
    occurred_at: Optional[datetime] = None


def _window_delta(value: int, unit: str) -> timedelta:
    if unit == "minutes":
        return timedelta(minutes=value)
    if unit == "hours":
        return timedelta(hours=value)
    if unit == "days":
        return timedelta(days=value)
    if unit == "weeks":
        return timedelta(weeks=value)
    if unit == "months":
        return timedelta(days=value * 30)
    return timedelta(days=value)


def _parse_ts(value: Optional[str | datetime]) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _default_rule_state() -> dict:
    return {"count": 0, "window_started_at": None, "last_event_at": None}


def _normalize_progress_state(raw_state: dict | None, rule_count: int) -> dict:
    if not raw_state or not isinstance(raw_state, dict):
        return {"rules": [_default_rule_state() for _ in range(rule_count)]}
    rules = raw_state.get("rules")
    if not isinstance(rules, list) or len(rules) != rule_count:
        return {"rules": [_default_rule_state() for _ in range(rule_count)]}
    normalized = []
    for item in rules:
        if not isinstance(item, dict):
            normalized.append(_default_rule_state())
            continue
        normalized.append(
            {
                "count": int(item.get("count") or 0),
                "window_started_at": item.get("window_started_at"),
                "last_event_at": item.get("last_event_at"),
            }
        )
    return {"rules": normalized}


def _event_matches_rule(
    event: BadgeEvent,
    rule: dict,
    *,
    user: models.User,
    assigned_user: Optional[models.User],
    created_user: Optional[models.User],
) -> bool:
    if rule.get("entity") != event.entity or rule.get("event") != event.event:
        return False

    conditions = rule.get("conditions") or {}
    if not isinstance(conditions, dict):
        return False

    priorities = conditions.get("priority")
    if priorities:
        if not event.priority or str(event.priority) not in {str(item) for item in priorities}:
            return False

    assigned_to = conditions.get("assigned_to")
    if assigned_to == "self":
        if event.assigned_to_id != user.id:
            return False
    elif assigned_to == "team":
        if not user.department_id or not assigned_user or assigned_user.department_id != user.department_id:
            return False

    created_by = conditions.get("created_by")
    if created_by == "self":
        if event.created_by_id != user.id:
            return False
    elif created_by == "team":
        if not user.department_id or not created_user or created_user.department_id != user.department_id:
            return False

    project_id = conditions.get("project_id")
    if project_id is not None and str(project_id) != str(event.project_id):
        return False

    pipeline_id = conditions.get("pipeline_id")
    if pipeline_id is not None and str(pipeline_id) != str(event.pipeline_id):
        return False

    return True


def _rule_satisfied(count: int, count_type: str, target: int) -> bool:
    if count_type == ">=":
        return count >= target
    if count_type == "==":
        return count == target
    if count_type == "<=":
        return count <= target
    return False


def _rule_progress_ratio(count: int, count_type: str, target: int) -> float:
    if target <= 0:
        return 1.0
    if count_type == "<=":
        return 1.0 if count <= target else 0.0
    return min(count / target, 1.0)


def _tier_requirement_met(
    badge: models.Badge,
    progress_by_badge: dict[str, models.UserBadgeProgress],
    tiers_by_group: dict[str, list[models.Badge]],
) -> bool:
    if not badge.tier_group or badge.tier_order <= 1:
        return True
    group_badges = tiers_by_group.get(badge.tier_group) or []
    prior = [item for item in group_badges if item.tier_order < badge.tier_order]
    if not prior:
        return True
    required = max(prior, key=lambda item: item.tier_order)
    progress = progress_by_badge.get(required.id)
    return bool(progress and progress.status == models.BadgeProgressStatusEnum.EARNED)


def process_badge_event(db: Session, *, event: BadgeEvent) -> None:
    occurred_at = event.occurred_at or datetime.utcnow()
    badges = (
        db.execute(
            select(models.Badge)
            .options(selectinload(models.Badge.ruleset))
            .where(models.Badge.state == models.BadgeStateEnum.ACTIVE)
        )
        .scalars()
        .all()
    )
    if not badges:
        return

    candidate_ids = {event.actor_id, event.assigned_to_id, event.created_by_id}
    candidate_ids.discard(None)
    if not candidate_ids:
        return

    users = db.execute(select(models.User).where(models.User.id.in_(candidate_ids))).scalars().all()
    user_map = {user.id: user for user in users}
    assigned_user = user_map.get(event.assigned_to_id) if event.assigned_to_id else None
    if event.assigned_to_id and not assigned_user:
        assigned_user = db.get(models.User, event.assigned_to_id)
    created_user = user_map.get(event.created_by_id) if event.created_by_id else None
    if event.created_by_id and not created_user:
        created_user = db.get(models.User, event.created_by_id)

    tiers_by_group: dict[str, list[models.Badge]] = {}
    for badge in badges:
        if badge.tier_group:
            tiers_by_group.setdefault(badge.tier_group, []).append(badge)
    for group_badges in tiers_by_group.values():
        group_badges.sort(key=lambda item: item.tier_order)

    badge_ids = [badge.id for badge in badges]
    for user in user_map.values():
        existing_progress = (
            db.execute(
                select(models.UserBadgeProgress).where(
                    models.UserBadgeProgress.user_id == user.id,
                    models.UserBadgeProgress.badge_id.in_(badge_ids),
                )
            )
            .scalars()
            .all()
        )
        progress_by_badge = {item.badge_id: item for item in existing_progress}

        for badge in badges:
            ruleset = badge.ruleset.rules if badge.ruleset else None
            if not ruleset:
                continue
            rules = ruleset.get("rules") if isinstance(ruleset, dict) else None
            if not isinstance(rules, list) or not rules:
                continue

            progress = progress_by_badge.get(badge.id)
            if progress and progress.status == models.BadgeProgressStatusEnum.EARNED:
                continue

            progress_state = _normalize_progress_state(
                progress.progress_state if progress else None,
                len(rules),
            )

            reset_progress = False
            expired_reset = False
            for idx, rule in enumerate(rules):
                rule_state = progress_state["rules"][idx]
                time_window = rule.get("time_window")
                if isinstance(time_window, dict):
                    start_ts = _parse_ts(rule_state.get("window_started_at"))
                    window_value = int(time_window.get("value") or 0)
                    window_unit = str(time_window.get("unit") or "")
                    if start_ts and window_value > 0 and window_unit:
                        if occurred_at > start_ts + _window_delta(window_value, window_unit):
                            rule_state.update(_default_rule_state())
                            expired_reset = True

            for idx, rule in enumerate(rules):
                if not rule.get("negative"):
                    continue
                if _event_matches_rule(
                    event,
                    rule,
                    user=user,
                    assigned_user=assigned_user,
                    created_user=created_user,
                ):
                    reset_progress = True
                    break

            if reset_progress:
                progress_state = {"rules": [_default_rule_state() for _ in range(len(rules))]}
                progress_value = 0
                status = models.BadgeProgressStatusEnum.LOCKED
                if progress is None:
                    progress = models.UserBadgeProgress(user_id=user.id, badge_id=badge.id)
                progress.progress_state = progress_state
                progress.progress_value = progress_value
                progress.status = status
                progress.updated_at = occurred_at
                db.add(progress)
                continue

            matched_any = False
            for idx, rule in enumerate(rules):
                if not _event_matches_rule(
                    event,
                    rule,
                    user=user,
                    assigned_user=assigned_user,
                    created_user=created_user,
                ):
                    continue
                matched_any = True
                rule_state = progress_state["rules"][idx]
                count_value = int(rule_state.get("count") or 0)
                time_window = rule.get("time_window")
                if isinstance(time_window, dict):
                    if not rule_state.get("window_started_at"):
                        rule_state["window_started_at"] = occurred_at.isoformat()
                rule_state["count"] = count_value + 1
                rule_state["last_event_at"] = occurred_at.isoformat()

            if not matched_any and not expired_reset:
                continue

            rule_progress = []
            rule_satisfied = []
            for idx, rule in enumerate(rules):
                rule_state = progress_state["rules"][idx]
                count_value = int(rule_state.get("count") or 0)
                count_spec = rule.get("count") or {}
                count_type = str(count_spec.get("type") or ">=")
                count_target = int(count_spec.get("value") or 0)
                rule_progress.append(_rule_progress_ratio(count_value, count_type, count_target))
                rule_satisfied.append(_rule_satisfied(count_value, count_type, count_target))

            operator = str(ruleset.get("operator") or "AND")
            if operator == "OR":
                progress_ratio = max(rule_progress) if rule_progress else 0.0
                earned = any(rule_satisfied)
            else:
                progress_ratio = sum(rule_progress) / len(rule_progress) if rule_progress else 0.0
                earned = all(rule_satisfied)

            progress_percent = int(round(progress_ratio * 100))
            status = (
                models.BadgeProgressStatusEnum.IN_PROGRESS
                if progress_percent > 0
                else models.BadgeProgressStatusEnum.LOCKED
            )

            if progress is None:
                progress = models.UserBadgeProgress(user_id=user.id, badge_id=badge.id)

            if earned and _tier_requirement_met(badge, progress_by_badge, tiers_by_group):
                progress.status = models.BadgeProgressStatusEnum.EARNED
                progress.earned_at = progress.earned_at or occurred_at
                progress.progress_value = 100
                progress.progress_state = progress_state
                progress.updated_at = occurred_at
                user.points += badge.bonus_xp
                notification_service.create_notification(
                    db,
                    user_id=user.id,
                    notification_type=models.NotificationTypeEnum.ACHIEVEMENT_UNLOCKED,
                    message=f"Badge unlocked: {badge.name}!",
                )
            else:
                progress.status = status
                progress.progress_value = progress_percent
                progress.progress_state = progress_state
                progress.updated_at = occurred_at
            db.add(progress)
            progress_by_badge[badge.id] = progress
