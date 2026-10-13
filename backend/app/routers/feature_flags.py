from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_owner

router = APIRouter(prefix="/feature-flags", tags=["feature-flags"])

DEFAULT_FEATURE_FLAGS: list[dict[str, object]] = [
    {"key": "page.dashboard", "label": "Dashboard Page", "group": "Pages", "description": "Show the dashboard page.", "enabled": True},
    {"key": "page.tasks", "label": "Tasks Page", "group": "Pages", "description": "Show the task list page.", "enabled": True},
    {"key": "page.kanban", "label": "Kanban Board Page", "group": "Pages", "description": "Show the kanban board.", "enabled": True},
    {"key": "page.calendar", "label": "Calendar Page", "group": "Pages", "description": "Show the calendar view.", "enabled": True},
    {"key": "page.gantt", "label": "Gantt Page", "group": "Pages", "description": "Show the gantt chart.", "enabled": True},
    {"key": "page.reports", "label": "Reports Page", "group": "Pages", "description": "Show the reports hub.", "enabled": True},
    {"key": "page.logs", "label": "Logs Page", "group": "Pages", "description": "Show system logs.", "enabled": True},
    {"key": "page.media", "label": "Media Library Page", "group": "Pages", "description": "Show the media library.", "enabled": True},
    {"key": "page.tool_library", "label": "Tool Library Page", "group": "Pages", "description": "Show the tool library.", "enabled": True},
    {"key": "page.tickets", "label": "Tickets Page", "group": "Pages", "description": "Show ticket management.", "enabled": True},
    {"key": "page.achievements", "label": "Achievements Page", "group": "Pages", "description": "Show achievements.", "enabled": True},
    {"key": "page.levels", "label": "Levels Page", "group": "Pages", "description": "Show levels manager.", "enabled": True},
    {"key": "page.rewards", "label": "Rewards Page", "group": "Pages", "description": "Show rewards hub.", "enabled": True},
    {"key": "page.points_table", "label": "Points Table Page", "group": "Pages", "description": "Show points table.", "enabled": True},
    {"key": "page.template_editor", "label": "Template Editor Page", "group": "Pages", "description": "Show template editor.", "enabled": True},
    {"key": "page.api_overview", "label": "API Overview Page", "group": "Pages", "description": "Show API overview.", "enabled": True},
    {"key": "page.users_admin", "label": "Users Admin Page", "group": "Pages", "description": "Show user administration.", "enabled": True},
    {"key": "page.settings", "label": "Settings Page", "group": "Pages", "description": "Show settings page.", "enabled": True},
    {"key": "page.master_control", "label": "Master Control Page", "group": "Pages", "description": "Show master control.", "enabled": True},
    {"key": "tasks.create", "label": "Create Tasks", "group": "Tasks", "description": "Allow creating new tasks.", "enabled": True},
    {"key": "tasks.edit", "label": "Edit Tasks", "group": "Tasks", "description": "Allow editing tasks.", "enabled": True},
    {"key": "tasks.delete", "label": "Delete Tasks", "group": "Tasks", "description": "Allow deleting tasks.", "enabled": True},
    {"key": "tasks.assign", "label": "Assign Tasks", "group": "Tasks", "description": "Allow assigning tasks.", "enabled": True},
    {"key": "tasks.bulk_actions", "label": "Bulk Actions", "group": "Tasks", "description": "Allow bulk task actions.", "enabled": True},
    {"key": "tasks.priorities", "label": "Priority Controls", "group": "Tasks", "description": "Allow setting priorities.", "enabled": True},
    {"key": "tasks.statuses", "label": "Status Controls", "group": "Tasks", "description": "Allow status changes.", "enabled": True},
    {"key": "tasks.tags", "label": "Tag Filters", "group": "Tasks", "description": "Allow tagging and tag filters.", "enabled": True},
    {"key": "tasks.due_dates", "label": "Due Dates", "group": "Tasks", "description": "Allow due dates.", "enabled": True},
    {"key": "tasks.recurring", "label": "Recurring Tasks", "group": "Tasks", "description": "Allow recurring rules.", "enabled": True},
    {"key": "tasks.approvals", "label": "Task Approvals", "group": "Tasks", "description": "Enable task approvals.", "enabled": True},
    {"key": "tasks.points", "label": "Task Points", "group": "Tasks", "description": "Enable points for tasks.", "enabled": True},
    {"key": "tasks.templates", "label": "Task Templates", "group": "Tasks", "description": "Enable templates module.", "enabled": True},
    {"key": "tasks.template_create_button", "label": "Template Create Button", "group": "Tasks", "description": "Show template create button.", "enabled": True},
    {"key": "tasks.attachments", "label": "Attachments", "group": "Tasks", "description": "Allow file attachments.", "enabled": True},
    {"key": "tasks.comments", "label": "Task Comments", "group": "Tasks", "description": "Enable comments.", "enabled": True},
    {"key": "tasks.time_tracking", "label": "Time Tracking", "group": "Tasks", "description": "Enable time tracking.", "enabled": True},
    {"key": "tasks.checklists", "label": "Checklists", "group": "Tasks", "description": "Enable checklists.", "enabled": True},
    {"key": "tasks.subtasks", "label": "Subtasks", "group": "Tasks", "description": "Enable subtasks.", "enabled": True},
    {"key": "tasks.export", "label": "Export Tasks", "group": "Tasks", "description": "Allow export.", "enabled": True},
    {"key": "tasks.import", "label": "Import Tasks", "group": "Tasks", "description": "Allow import.", "enabled": True},
    {"key": "kanban.drag_drop", "label": "Drag & Drop", "group": "Kanban", "description": "Enable drag and drop.", "enabled": True},
    {"key": "kanban.create_columns", "label": "Create Columns", "group": "Kanban", "description": "Allow creating columns.", "enabled": True},
    {"key": "kanban.edit_columns", "label": "Edit Columns", "group": "Kanban", "description": "Allow editing columns.", "enabled": True},
    {"key": "kanban.wip_limits", "label": "WIP Limits", "group": "Kanban", "description": "Enable WIP limits.", "enabled": True},
    {"key": "kanban.quick_filters", "label": "Quick Filters", "group": "Kanban", "description": "Show quick filters.", "enabled": True},
    {"key": "kanban.status_tooltips", "label": "Status Tooltips", "group": "Kanban", "description": "Show status tooltips.", "enabled": True},
    {"key": "kanban.view_modes", "label": "View Modes", "group": "Kanban", "description": "Enable list/grid/kanban modes.", "enabled": True},
    {"key": "kanban.bulk_move", "label": "Bulk Move", "group": "Kanban", "description": "Enable bulk move.", "enabled": True},
    {"key": "tickets.create", "label": "Create Tickets", "group": "Tickets", "description": "Allow creating tickets.", "enabled": True},
    {"key": "tickets.assign", "label": "Assign Tickets", "group": "Tickets", "description": "Allow assigning tickets.", "enabled": True},
    {"key": "tickets.close", "label": "Close Tickets", "group": "Tickets", "description": "Allow closing tickets.", "enabled": True},
    {"key": "tickets.reopen", "label": "Reopen Tickets", "group": "Tickets", "description": "Allow reopening tickets.", "enabled": True},
    {"key": "tickets.sla", "label": "SLA Tracking", "group": "Tickets", "description": "Enable SLA tracking.", "enabled": True},
    {"key": "tickets.attachments", "label": "Ticket Attachments", "group": "Tickets", "description": "Enable attachments.", "enabled": True},
    {"key": "tickets.chat", "label": "Ticket Chat", "group": "Tickets", "description": "Enable ticket chat.", "enabled": True},
    {"key": "tickets.priority", "label": "Ticket Priority", "group": "Tickets", "description": "Allow priorities.", "enabled": True},
    {"key": "tickets.categories", "label": "Ticket Categories", "group": "Tickets", "description": "Allow categories.", "enabled": True},
    {"key": "tickets.approvals", "label": "Ticket Approvals", "group": "Tickets", "description": "Enable approvals.", "enabled": True},
    {"key": "rewards.redeem", "label": "Redeem Rewards", "group": "Rewards", "description": "Allow redeeming rewards.", "enabled": True},
    {"key": "rewards.seasonal", "label": "Seasonal Rewards", "group": "Rewards", "description": "Enable seasonal rewards.", "enabled": True},
    {"key": "rewards.badges", "label": "Badges", "group": "Rewards", "description": "Enable badges.", "enabled": True},
    {"key": "rewards.achievements", "label": "Achievements", "group": "Rewards", "description": "Enable achievements.", "enabled": True},
    {"key": "rewards.points_table", "label": "Points Table", "group": "Rewards", "description": "Show points table.", "enabled": True},
    {"key": "rewards.leaderboard", "label": "Leaderboard", "group": "Rewards", "description": "Show leaderboard.", "enabled": True},
    {"key": "rewards.daily_bonus", "label": "Daily Bonus", "group": "Rewards", "description": "Enable daily bonus.", "enabled": True},
    {"key": "admin.user_management", "label": "User Management", "group": "Admin", "description": "Enable user management.", "enabled": True},
    {"key": "admin.role_management", "label": "Role Management", "group": "Admin", "description": "Enable role management.", "enabled": True},
    {"key": "admin.permissions_matrix", "label": "Permissions Matrix", "group": "Admin", "description": "Enable permissions matrix.", "enabled": True},
    {"key": "admin.audit_logs", "label": "Audit Logs", "group": "Admin", "description": "Enable audit logs.", "enabled": True},
    {"key": "admin.data_admin", "label": "Data Admin", "group": "Admin", "description": "Enable data admin tools.", "enabled": True},
    {"key": "admin.integrations", "label": "Integrations", "group": "Admin", "description": "Enable integrations.", "enabled": True},
    {"key": "admin.webhooks", "label": "Webhooks", "group": "Admin", "description": "Enable webhooks.", "enabled": True},
    {"key": "admin.api_keys", "label": "API Keys", "group": "Admin", "description": "Enable API keys.", "enabled": True},
    {"key": "admin.sso", "label": "SSO", "group": "Admin", "description": "Enable SSO.", "enabled": True},
    {"key": "permissions.user_active", "label": "User Active", "group": "User Permissions", "description": "Allow active users.", "enabled": True},
    {"key": "permissions.user_deactivated", "label": "User Deactivated", "group": "User Permissions", "description": "Allow deactivated users.", "enabled": True},
    {"key": "permissions.manager_access", "label": "Manager Access", "group": "User Permissions", "description": "Enable manager access.", "enabled": True},
    {"key": "permissions.admin_access", "label": "Admin Access", "group": "User Permissions", "description": "Enable admin access.", "enabled": True},
    {"key": "permissions.owner_access", "label": "Owner Access", "group": "User Permissions", "description": "Enable owner access.", "enabled": True},
    {"key": "permissions.export", "label": "Export Permission", "group": "User Permissions", "description": "Allow exports.", "enabled": True},
    {"key": "permissions.import", "label": "Import Permission", "group": "User Permissions", "description": "Allow imports.", "enabled": True},
    {"key": "comm.notifications", "label": "In-App Notifications", "group": "Communication", "description": "Enable in-app notifications.", "enabled": True},
    {"key": "comm.email", "label": "Email Notifications", "group": "Communication", "description": "Enable email alerts.", "enabled": True},
    {"key": "comm.sms", "label": "SMS Alerts", "group": "Communication", "description": "Enable SMS alerts.", "enabled": True},
    {"key": "comm.in_app", "label": "In-App Messages", "group": "Communication", "description": "Enable in-app messaging.", "enabled": True},
]


def _ensure_feature_flags(db: Session) -> None:
    inspector = inspect(db.bind)
    if "feature_flags" not in inspector.get_table_names():
        models.FeatureFlag.__table__.create(bind=db.bind, checkfirst=True)
    existing = {flag.key for flag in db.query(models.FeatureFlag.key).all()}
    created = False
    for entry in DEFAULT_FEATURE_FLAGS:
        if entry["key"] in existing:
            continue
        db.add(models.FeatureFlag(**entry))
        created = True
    legacy_keys = {"page.inbox"}
    removed_keys = {"page.chat", "comm.chat"}
    if legacy_keys & set(existing):
        db.query(models.FeatureFlag).filter(models.FeatureFlag.key.in_(legacy_keys)).delete(synchronize_session=False)
        created = True
    if removed_keys & set(existing):
        db.query(models.FeatureFlag).filter(models.FeatureFlag.key.in_(removed_keys)).delete(synchronize_session=False)
        created = True
    if created:
        db.commit()


@router.get("/", response_model=list[schemas.FeatureFlagRead])
def list_feature_flags(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_owner),
):
    _ensure_feature_flags(db)
    return (
        db.query(models.FeatureFlag)
        .order_by(models.FeatureFlag.group.asc(), models.FeatureFlag.label.asc())
        .all()
    )


@router.put("/", response_model=list[schemas.FeatureFlagRead])
def update_feature_flags(
    payload: schemas.FeatureFlagUpdateRequest,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_owner),
):
    _ensure_feature_flags(db)
    if not payload.flags:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No feature flags provided.")
    allowed_keys = {entry["key"] for entry in DEFAULT_FEATURE_FLAGS}
    for update in payload.flags:
        if update.key not in allowed_keys:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown feature flag: {update.key}",
            )
    for update in payload.flags:
        flag = db.get(models.FeatureFlag, update.key)
        if not flag:
            flag = models.FeatureFlag(
                key=update.key,
                label=update.key,
                group="Custom",
                description=None,
                enabled=update.enabled,
            )
            db.add(flag)
        else:
            flag.enabled = update.enabled
    db.commit()
    return (
        db.query(models.FeatureFlag)
        .order_by(models.FeatureFlag.group.asc(), models.FeatureFlag.label.asc())
        .all()
    )
