"""Tenant-owned display workflow layered over the unchanged task business enum."""
import unicodedata
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException
from sqlalchemy import String, cast, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm.attributes import flag_modified

from .. import models as m
from .task_access import task_tenant_predicate

BLUEPRINT = (
    ("WAITING_FOR_REQUIREMENT", "BATTLE_PLAN", "Battle Plan"),
    ("TODO", "TODO", "Case Filed"),
    ("IN_PROGRESS", "IN_PROGRESS", "In Progress"),
    ("BUG_FIXING", "BUG_FIXING", "Bug Fixing"),
    ("BLOCKED", "BLOCKED", "Boss Encounter"),
    ("IN_REVIEW", "IN_REVIEW", "Tactical Shift"),
    ("ON_HOLD", "ON_HOLD", "On Hold"),
    ("DONE", "CONQUERED", "Conquered"),
    ("DEPLOYED", "DEPLOYED", "Deployed"),
    ("FAILED", "FAILED", "Fallen"),
    ("GRAVEYARD", "GRAVEYARD", "Graveyard"),
)
COLORS = {'WAITING_FOR_REQUIREMENT': '#7DD3FC', 'TODO': '#93C5FD', 'IN_PROGRESS': '#818CF8', 'BUG_FIXING': '#E11D48', 'BLOCKED': '#F472B6', 'IN_REVIEW': '#2DD4BF', 'ON_HOLD': '#F59E0B', 'DONE': '#22C55E', 'DEPLOYED': '#14B8A6', 'FAILED': '#F43F5E', 'GRAVEYARD': '#64748B'}
CORE_CODES = frozenset({'BATTLE_PLAN', 'IN_PROGRESS', 'ON_HOLD', 'CONQUERED'})
ICONS = {"default", "circle", "flag", "play", "pause", "check", "star", "bolt", "clock"}
FIELDS = ("id", "code", "system_name", "display_label", "legacy_status", "legacy_column_id", "description", "color", "icon",
          "is_system", "is_active", "kanban_visible", "sort_order", "workflow_behavior")


def system_behavior(legacy):
    return 'PENDING' if legacy in ('WAITING_FOR_REQUIREMENT','TODO') else 'HOLD' if legacy == 'ON_HOLD' else 'COMPLETED' if legacy in ('DONE','DEPLOYED') else 'ACTIVE'


def native_status(row):
    return row.legacy_status or {'PENDING':'WAITING_FOR_REQUIREMENT','ACTIVE':'IN_PROGRESS','HOLD':'ON_HOLD'}[row.workflow_behavior]


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def clean_legacy_label(value):
    value = " ".join(unicodedata.normalize("NFKC", value).split())
    if not value or len(value) > 80 or any(unicodedata.category(char).startswith("C") for char in value):
        raise HTTPException(409, "Legacy Kanban labels require review before creating this workspace workflow")
    return value


def require_manager(user):
    if user.role not in {m.RoleEnum.OWNER, m.RoleEnum.ADMIN}:
        raise HTTPException(403, "Only owners and administrators can view task status configuration")


def require_owner(user):
    if user.role != m.RoleEnum.OWNER:
        raise HTTPException(403, "Only owners can change task status configuration")


def scope(db, user, *, lock=False):
    """Provision new tenants idempotently; serialize every configuration/assignment write."""
    if not lock:
        found = db.get(m.TaskStatusScope, user.tenant_id)
        if found and db.scalar(select(m.TaskStatus.id).where(m.TaskStatus.tenant_id == user.tenant_id).limit(1)):
            assert_systems(db, user)
            return found
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    # The no-op conflict write also serializes SQLite transactions before reading.
    db.execute(insert(m.TaskStatusScope).values(tenant_id=user.tenant_id, revision=0)
               .on_conflict_do_nothing(index_elements=["tenant_id"]))
    stmt = select(m.TaskStatusScope).where(m.TaskStatusScope.tenant_id == user.tenant_id)
    row = db.scalar(stmt.with_for_update().execution_options(populate_existing=True) if lock else stmt)
    existing = db.scalar(select(func.count()).select_from(m.TaskStatus).where(m.TaskStatus.tenant_id == user.tenant_id))
    if not existing:
        legacy = {col.id: col for col in db.scalars(select(m.KanbanColumn))}
        for index, (value, code, name) in enumerate(BLUEPRINT):
            old = legacy.get(value)
            label = clean_legacy_label(old.title) if old else name
            db.add(m.TaskStatus(id=str(uuid5(NAMESPACE_URL, f"zeaplay:{user.tenant_id}:status:{code}")),
                tenant_id=user.tenant_id, code=code, system_name=name, normalized_name=normalize(name),
                display_label=label, normalized_label=normalize(label), legacy_status=value,
                is_system=True, is_active=True, kanban_visible=True,
                workflow_behavior=system_behavior(value),
                sort_order=old.order if old else index, description="", color=COLORS[value], icon="default"))
        # Legacy UUID columns never extended the PostgreSQL enum. Preserve their
        # labels/order as usable custom columns without altering any task enum.
        known = {entry[0] for entry in BLUEPRINT}
        for old in legacy.values():
            if old.id in known:
                continue
            db.add(m.TaskStatus(id=str(uuid5(NAMESPACE_URL, f"zeaplay:{user.tenant_id}:column:{old.id}")),
                tenant_id=user.tenant_id, code="CUSTOM_" + uuid4().hex,
                system_name=clean_legacy_label(old.title), normalized_name=normalize(old.title), display_label=clean_legacy_label(old.title),
                normalized_label=normalize(old.title), legacy_column_id=old.id, is_system=False, sort_order=old.order))
        validate_names([row for row in db.new if isinstance(row, m.TaskStatus) and row.tenant_id == user.tenant_id])
        db.flush()
    assert_systems(db, user)
    return row


def assert_systems(db, user):
    configured = rows(db, user)
    expected = {(code, name, value, system_behavior(value)) for value, code, name in BLUEPRINT}
    actual = {(row.code, row.system_name, row.legacy_status, row.workflow_behavior) for row in configured if row.is_system}
    if actual != expected or any(row.code in CORE_CODES and (not row.is_active or not row.kanban_visible) for row in configured):
        raise HTTPException(409, "The workspace system statuses require a reviewed integrity repair")


def rows(db, user):
    return list(db.scalars(select(m.TaskStatus).where(m.TaskStatus.tenant_id == user.tenant_id)
                          .order_by(m.TaskStatus.sort_order, m.TaskStatus.id)))


def key(row):
    return row.legacy_status or row.id


def task_column_predicate(row):
    if row.legacy_status:
        return (m.Task.status == row.legacy_status) & m.Task.custom_status_id.is_(None)
    return (m.Task.custom_status_id == row.id) & (m.Task.status == native_status(row))


def snapshot(row):
    return {field: getattr(row, field) for field in FIELDS}


def audit(db, user, row, action, previous, new):
    db.add(m.StatusConfigurationAudit(tenant_id=user.tenant_id, status_id=row.id,
        actor_id=user.id, action=action, previous_values=previous, new_values=new))


def document(db, user, current_scope=None):
    current_scope = current_scope or scope(db, user)
    counts = dict(db.execute(select(m.Task.custom_status_id, func.count()).where(task_tenant_predicate(user),
        m.Task.custom_status_id.is_not(None))
        .group_by(m.Task.custom_status_id)).all())
    legacy_counts = dict(db.execute(select(cast(m.Task.status, String), func.count()).where(task_tenant_predicate(user),
        m.Task.custom_status_id.is_(None)).group_by(cast(m.Task.status, String))).all())
    configured = rows(db, user)
    defaults = {code: (index, name, COLORS[value]) for index, (value, code, name) in enumerate(BLUEPRINT)}
    custom_order = {row.id: len(BLUEPRINT) + index for index, row in enumerate(
        sorted((row for row in configured if not row.is_system), key=lambda row: (row.created_at, row.id)))}
    return {"revision": current_scope.revision, "hold_reason_required": current_scope.hold_reason_required,
        "can_manage": user.role == m.RoleEnum.OWNER,
        "statuses": [{**snapshot(row), "task_count": legacy_counts.get(row.legacy_status, 0)
                      if row.legacy_status else counts.get(row.id, 0),
                      "is_core": row.is_system and row.code in CORE_CODES,
                      "can_hide": row.code not in CORE_CODES,
                      "default_sort_order": defaults[row.code][0] if row.is_system else custom_order[row.id],
                      "default_display_label": defaults[row.code][1] if row.is_system else row.system_name,
                      "default_color": defaults[row.code][2] if row.is_system else "#6366f1",
                      "default_icon": "default" if row.is_system else "circle"} for row in configured]}


def check_revision(current_scope, revision):
    if current_scope.revision != revision:
        raise HTTPException(409, "Status configuration changed. Cancel or reset to load the latest version.")


def validate_names(statuses):
    used = {}
    for row in statuses:
        for value in (row.system_name, row.display_label, row.code, row.legacy_status or row.code):
            token = normalize(value)
            if token in used and used[token] != row.id:
                raise HTTPException(422, "Status names, labels and codes must be unambiguous within this workspace")
            used[token] = row.id


def save(db, user, payload):
    with db.no_autoflush:
        return _save(db, user, payload)


def require_configuration_schema(db):
    # Settings writes are rare. Check the actual guards before touching data so
    # an incomplete deployment cannot masquerade as a duplicate-name conflict.
    from .status_integrity import schema_issues
    if schema_issues(db.connection()):
        raise HTTPException(503, 'Status configuration database upgrade required. Ask the server administrator to complete the status migration before saving.')


def _save(db, user, payload):
    require_owner(user)
    require_configuration_schema(db)
    current_scope = scope(db, user, lock=True)
    check_revision(current_scope, payload.revision)
    existing = {row.id: row for row in rows(db, user)}
    supplied = [item.id for item in payload.statuses if item.id]
    if len(supplied) != len(set(supplied)) or set(supplied) != set(existing):
        raise HTTPException(409, "Include every existing status exactly once; use the removal workflow to delete")
    changed = []
    for index, item in enumerate(payload.statuses):
        row = existing.get(item.id)
        before = snapshot(row) if row else {}
        if row is None:
            row = m.TaskStatus(id=str(uuid4()), tenant_id=user.tenant_id, code="CUSTOM_" + uuid4().hex,
                              is_system=False, legacy_status=None)
            db.add(row)
        elif row.is_system:
            if item.system_name != row.system_name:
                raise HTTPException(422, "System status identities are protected")
            if row.code in CORE_CODES and (not item.is_active or not item.kanban_visible):
                raise HTTPException(422, "Core system statuses must remain active and visible on the Kanban board")
            if row.is_active and not item.is_active:
                raise HTTPException(409, "Use the confirmed deactivation workflow for legacy statuses")
        desired_behavior = item.workflow_behavior or (row.workflow_behavior if before else 'ACTIVE')
        if row.is_system and desired_behavior != row.workflow_behavior:
            raise HTTPException(422, 'System workflow behavior is protected')
        if not row.is_system and desired_behavior == 'COMPLETED':
            raise HTTPException(422, 'Custom Completed behavior requires an approved completion-policy migration; use Conquered')
        if before and desired_behavior != row.workflow_behavior and db.scalar(select(func.count()).select_from(m.Task).where(m.Task.custom_status_id == row.id)):
            raise HTTPException(409, 'Reassign referenced tasks before changing workflow behavior')
        row.workflow_behavior = desired_behavior
        row.system_name = item.system_name
        row.normalized_name = normalize(item.system_name)
        row.display_label = item.display_label
        row.normalized_label = normalize(item.display_label)
        row.description, row.color, row.icon = item.description, item.color, item.icon
        row.is_active, row.kanban_visible, row.sort_order = item.is_active, item.kanban_visible, index
        if not row.is_active and db.scalar(select(func.count()).select_from(m.Task).where(m.Task.custom_status_id == row.id)):
            raise HTTPException(409, "Reassign referenced tasks before archiving this status")
        changed.append((row, before))
    validate_names([row for row, _ in changed])
    # Release only changed uniqueness tokens, allowing atomic name/label swaps.
    staging = "__staging__" + uuid4().hex
    any_changed = False
    if payload.hold_reason_required is not None and payload.hold_reason_required != current_scope.hold_reason_required:
        hold = next(row for row in existing.values() if row.code == 'ON_HOLD')
        audit(db, user, hold, 'hold_policy_updated', {'hold_reason_required':current_scope.hold_reason_required}, {'hold_reason_required':payload.hold_reason_required})
        current_scope.hold_reason_required = payload.hold_reason_required
        any_changed = True
    for row, before in changed:
        token_change = before and (normalize(before["system_name"]) != row.normalized_name
                                   or normalize(before["display_label"]) != row.normalized_label)
        if token_change:
            db.execute(update(m.TaskStatus).where(m.TaskStatus.id == row.id).values(
                normalized_name=staging + row.id, normalized_label=staging + row.id),
                execution_options={"synchronize_session": False})
            flag_modified(row, "normalized_name")
            flag_modified(row, "normalized_label")
    for row, before in changed:
        after = snapshot(row)
        if before != after:
            any_changed = True
            audit(db, user, row, "updated" if before else "created", before, after)
    if any_changed:
        current_scope.revision += 1
    db.flush()
    return document(db, user, current_scope)


def custom_for_assignment(db, user, status_id):
    scope(db, user, lock=True)
    row = db.scalar(select(m.TaskStatus).where(or_(m.TaskStatus.id == status_id, m.TaskStatus.legacy_column_id == status_id),
        m.TaskStatus.tenant_id == user.tenant_id, m.TaskStatus.is_system.is_(False), m.TaskStatus.is_active.is_(True)))
    if row is None:
        raise HTTPException(409, "Task status is not available for this workspace")
    return row


def validate_native_assignment(db, user, native):
    """Caller holds the workflow scope lock; existing inactive tasks remain readable."""
    configured = db.scalar(select(m.TaskStatus).where(m.TaskStatus.tenant_id == user.tenant_id,
        m.TaskStatus.legacy_status == native))
    if configured is not None and not configured.is_active:
        raise HTTPException(409, 'Task status is inactive for this workspace')


def remove(db, user, status_id, payload):
    require_owner(user)
    require_configuration_schema(db)
    current_scope = scope(db, user, lock=True)
    check_revision(current_scope, payload.revision)
    row = db.scalar(select(m.TaskStatus).where(m.TaskStatus.id == status_id, m.TaskStatus.tenant_id == user.tenant_id))
    if row is None:
        raise HTTPException(404, "Status not found")
    if row.is_system:
        # Native assignment guards take SHARE on this row. Lock before counting
        # so even writers outside the scope API are included in confirmation.
        db.refresh(row, with_for_update=True)
    if row.is_system and (row.code in CORE_CODES or payload.action == 'delete'):
        raise HTTPException(422, "Core statuses cannot be deactivated; legacy identities cannot be deleted")
    if payload.confirmation != row.display_label:
        raise HTTPException(422, "Type the current display label to confirm removal")
    if row.is_system:
        if payload.destination_id:
            raise HTTPException(422, "Legacy deactivation retains task statuses; no reassignment destination is allowed")
        count = db.scalar(select(func.count()).select_from(m.Task).where(task_tenant_predicate(user), task_column_predicate(row)))
        if count != payload.expected_task_count:
            raise HTTPException(409, "Task count changed. Reload and review the deactivation again")
        before = snapshot(row)
        row.is_active = False
        row.kanban_visible = False
        audit(db, user, row, 'deactivated', before, {**snapshot(row), 'retained_task_count': count})
        current_scope.revision += 1
        db.flush()
        return document(db, user, current_scope)
    tasks = list(db.scalars(select(m.Task).where(m.Task.custom_status_id == row.id).with_for_update()))
    if len(tasks) != payload.expected_task_count:
        raise HTTPException(409, "Task count changed. Reload and review the reassignment again")
    destination = None
    if tasks or payload.destination_id:
        destination = db.scalar(select(m.TaskStatus).where(m.TaskStatus.id == payload.destination_id,
            m.TaskStatus.tenant_id == user.tenant_id, m.TaskStatus.is_active.is_(True)))
        if destination is None or destination.id == row.id or destination.legacy_status not in (None, "IN_PROGRESS") or destination.workflow_behavior == 'HOLD':
            raise HTTPException(422, "Choose In Progress or an active custom status as the reassignment destination")
    for task in tasks:
        from .task_access import task_belongs_to_user_tenant
        if not task_belongs_to_user_tenant(task, user):
            raise HTTPException(409, "Inconsistent task ownership; removal requires repair")
        from . import task_transitions
        task_transitions.apply(db, task, native_status(destination), actor=user,
            custom_status_id=None if destination.is_system else destination.id, source='status_reassignment')
    before = snapshot(row)
    audit(db, user, row, payload.action, before, {"destination_id": destination.id if destination else None,
        "task_ids": [task.id for task in tasks], "task_count": len(tasks)})
    db.flush()  # Reassign before the FK-protected delete.
    if payload.action == "delete":
        db.delete(row)
    else:
        row.is_active = False
    current_scope.revision += 1
    db.flush()
    return document(db, user, current_scope)


def invalidate(tenant_id):
    from ..cache import invalidate_prefix
    from ..config import get_settings
    settings = get_settings()
    for kind in ("kanban", "list", "calendar"):
        invalidate_prefix(f"{settings.cache_prefix}:tasks:{kind}:tenant:{tenant_id}:")
