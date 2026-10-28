import asyncio
from pathlib import Path
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from .avatar_static import AvatarSafeStaticFiles as StaticFiles
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import ProgrammingError

from .config import get_settings
from .database import Base, SessionLocal, engine
from . import models
from .dependencies import _decode_access_token, get_current_admin
from .services import audit_logger
from .seed import seed_database, seed_badges_from_achievements
from .avatar_utils import ensure_avatar_dirs
from .routers import (
    achievements,
    badges,
    avatars,
    auth,
    clients,
    contacts,
    comments,
    config as config_router,
    feature_flags,
    data_admin,
    departments,
    kanban,
    levels,
    n8n,
    notifications,
    navigation,
    support,
    notification_preferences,
    oauth2_server,
    projects,
    reports,
    rewards,
    media,
    tasks,
    time_entries,
    users,
    logs,
    updates,
    tool_library,
    push,
    webhooks,
)
from .tickets import router as tickets_router
from .tickets import workflow_router as tickets_workflow_router
from .tickets import attachments_router as ticket_attachments_router
from .chat import router as chat_router
from .chat.schema import ensure_chat_schema
from .ws import chat as chat_ws, ticket_chat, tasks as tasks_ws
from .services import notification_outbox, task_events
from .services.notification_schema import ensure_notification_enum_values
from .realtime import transport as realtime_transport
from .observability import RealtimeMetricsMiddleware
from .lifecycle.bootstrap import ensure_execution_columns
from .chat import realtime as chat_realtime
from .webhooks.dispatcher import start_webhook_retry_worker, stop_webhook_retry_worker
from .webhooks.schema import ensure_webhook_schema

settings = get_settings()

# Debug logging for CORS origins
print(f"CORS allow origins: {settings.cors_allow_origins}")





def ensure_task_status_enum() -> None:
    """Ensure the Postgres enum for task statuses includes all defined values."""
    if engine.dialect.name != "postgresql":
        return

    enum_type = models.Task.__table__.c.status.type
    enum_name = getattr(enum_type, "name", None) or "taskstatusenum"

    try:
        with engine.connect() as connection:
            existing_values = connection.execute(
                text(
                    """
                    SELECT e.enumlabel
                    FROM pg_type t
                    JOIN pg_enum e ON t.oid = e.enumtypid
                    WHERE t.typname = :enum_name
                    """
                ),
                {"enum_name": enum_name},
            ).scalars().all()
    except ProgrammingError:
        # If the enum type is missing entirely, metadata.create_all will create it later
        return

    missing_values = [
        status.value
        for status in models.TaskStatusEnum
        if status.value not in existing_values
    ]

    if not missing_values:
        return

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as autocommit_conn:
        for value in missing_values:
            try:
                autocommit_conn.exec_driver_sql(
                    f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS '{value}'"
                )
            except ProgrammingError as exc:
                lower_msg = str(exc).lower()
                if ("already exists" not in lower_msg and
                    "duplicate" not in lower_msg and
                    "does not exist" not in lower_msg):
                    raise


def normalize_legacy_task_status_values() -> None:
    """Repair legacy display-label task statuses stored as enum values."""
    inspector = inspect(engine)
    if "tasks" not in inspector.get_table_names():
        return

    legacy_status_map = {
        "BATTLE_PLAN": models.TaskStatusEnum.WAITING_FOR_REQUIREMENT.value,
        "CASE_FILED": models.TaskStatusEnum.TODO.value,
        "TACTICAL_SHIFT": models.TaskStatusEnum.IN_REVIEW.value,
        "CONQUERED": models.TaskStatusEnum.DONE.value,
        "FALLEN": models.TaskStatusEnum.FAILED.value,
    }

    if engine.dialect.name == "postgresql":
        enum_type = models.Task.__table__.c.status.type
        enum_name = getattr(enum_type, "name", None) or "taskstatusenum"
        update_sql = text(
            f"""
            UPDATE tasks
            SET status = CAST(:current_status AS {enum_name})
            WHERE status::text = :legacy_status
            """
        )
    else:
        update_sql = text(
            """
            UPDATE tasks
            SET status = :current_status
            WHERE status = :legacy_status
            """
        )

    with engine.begin() as connection:
        for legacy_status, current_status in legacy_status_map.items():
            connection.execute(
                update_sql,
                {
                    "legacy_status": legacy_status,
                    "current_status": current_status,
                },
            )


def ensure_employer_id_column() -> None:
    """Add the employer_id column to the users table when missing."""
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("users")}
    if "employer_id" in column_names:
        return

    ddl = None
    if engine.dialect.name == "sqlite":
        ddl = "ALTER TABLE users ADD COLUMN employer_id VARCHAR(255)"
    elif engine.dialect.name == "postgresql":
        ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS employer_id VARCHAR(255)"
    else:
        return

    with engine.begin() as connection:
        connection.exec_driver_sql(ddl)


def ensure_user_profile_columns() -> None:
    """Add profile-related columns to the users table when missing."""
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("users")}
    added_columns: set[str] = set()
    statements: list[str] = []

    def add_column(name: str, sqlite_sql: str, pg_sql: str) -> None:
        if name in column_names:
            return
        if engine.dialect.name == "sqlite":
            statements.append(sqlite_sql)
        elif engine.dialect.name == "postgresql":
            statements.append(pg_sql)
        else:
            return
        added_columns.add(name)

    add_column("manager_id", "ALTER TABLE users ADD COLUMN manager_id VARCHAR(36)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id VARCHAR(36)")
    add_column("credentials_version", "ALTER TABLE users ADD COLUMN credentials_version INTEGER NOT NULL DEFAULT 0",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials_version INTEGER NOT NULL DEFAULT 0")
    add_column("manager_email", "ALTER TABLE users ADD COLUMN manager_email VARCHAR(255)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_email VARCHAR(255)")
    add_column("webex_person_id", "ALTER TABLE users ADD COLUMN webex_person_id VARCHAR(120)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS webex_person_id VARCHAR(120)")
    add_column("title", "ALTER TABLE users ADD COLUMN title VARCHAR(255)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(255)")
    add_column("phone", "ALTER TABLE users ADD COLUMN phone VARCHAR(50)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)")
    add_column("location", "ALTER TABLE users ADD COLUMN location VARCHAR(255)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(255)")
    add_column("timezone", "ALTER TABLE users ADD COLUMN timezone VARCHAR(64)",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)")
    add_column("notes", "ALTER TABLE users ADD COLUMN notes TEXT",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT")
    add_column("skills", "ALTER TABLE users ADD COLUMN skills TEXT",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS skills JSON")
    add_column("projects", "ALTER TABLE users ADD COLUMN projects TEXT",
               "ALTER TABLE users ADD COLUMN IF NOT EXISTS projects JSON")
    add_column(
        "profile_image_key",
        "ALTER TABLE users ADD COLUMN profile_image_key VARCHAR(1024)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_key VARCHAR(1024)",
    )
    add_column(
        "profile_image_url",
        "ALTER TABLE users ADD COLUMN profile_image_url VARCHAR(1024)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(1024)",
    )

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)

        final_columns = column_names | added_columns
        if "skills" in final_columns:
            if engine.dialect.name == "postgresql":
                connection.exec_driver_sql("UPDATE users SET skills = '[]'::json WHERE skills IS NULL")
            else:
                connection.exec_driver_sql("UPDATE users SET skills = '[]' WHERE skills IS NULL")
        if "projects" in final_columns:
            if engine.dialect.name == "postgresql":
                connection.exec_driver_sql("UPDATE users SET projects = '[]'::json WHERE projects IS NULL")
            else:
                connection.exec_driver_sql("UPDATE users SET projects = '[]' WHERE projects IS NULL")


def ensure_pg_trgm_extension() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def ensure_composite_fk_reference_constraints() -> None:
    """Repair partial Postgres schemas before creating tenant-safe FK tables."""
    if engine.dialect.name != "postgresql":
        return

    expected_constraints = {
        "users": ("uq_users_id_tenant", ("id", "tenant_id")),
        "clients": ("uq_clients_id_tenant", ("id", "tenant_id")),
        "contacts": ("uq_contacts_id_tenant", ("id", "tenant_id")),
        "projects": ("uq_projects_id_tenant", ("id", "tenant_id")),
        "subtasks": ("uq_subtasks_id_task_id", ("id", "task_id")),
    }

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    missing_constraints: list[tuple[str, str, tuple[str, ...]]] = []
    for table_name, (constraint_name, columns) in expected_constraints.items():
        if table_name not in existing_tables:
            continue
        unique_constraints = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints(table_name)
            if constraint.get("name")
        }
        if constraint_name not in unique_constraints:
            missing_constraints.append((table_name, constraint_name, columns))

    if not missing_constraints:
        return

    with engine.begin() as connection:
        for table_name, constraint_name, columns in missing_constraints:
            quoted_columns = ", ".join(columns)
            connection.exec_driver_sql(
                f"""
                ALTER TABLE {table_name}
                ADD CONSTRAINT {constraint_name} UNIQUE ({quoted_columns})
                """
            )


def ensure_notification_table_schema() -> None:
    """Bring legacy notification tables up to the current additive schema."""
    if engine.dialect.name != "postgresql":
        return

    # PostgreSQL requires a commit before newly added enum labels can be used.
    with engine.begin() as connection:
        ensure_notification_enum_values(connection)

    inspector = inspect(engine)
    if "notifications" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("notifications")}
    indexes = {index["name"] for index in inspector.get_indexes("notifications") if index.get("name")}

    with engine.begin() as connection:
        if "tenant_id" not in columns:
            connection.exec_driver_sql("ALTER TABLE notifications ADD COLUMN tenant_id UUID")
        if "dedupe_key" not in columns:
            connection.exec_driver_sql("ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(255)")

        connection.exec_driver_sql(
            """
            UPDATE notifications
            SET tenant_id = users.tenant_id
            FROM users
            WHERE notifications.user_id = users.id
              AND notifications.tenant_id IS NULL
            """
        )

        if "ix_notifications_tenant_user_created" not in indexes:
            connection.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS ix_notifications_tenant_user_created
                ON notifications (tenant_id, user_id, created_at)
                """
            )
        if "uq_notifications_user_dedupe_key" not in indexes:
            connection.exec_driver_sql(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_dedupe_key
                ON notifications (user_id, dedupe_key)
                WHERE dedupe_key IS NOT NULL
                """
            )


def ensure_task_manager_table_schema() -> None:
    """Bring legacy task/subtask tables up to the current additive schema."""
    if engine.dialect.name != "postgresql":
        return

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as connection:
        if "tasks" in existing_tables:
            task_columns = {column["name"] for column in inspector.get_columns("tasks")}
            task_constraints = {
                constraint["name"]
                for constraint in inspector.get_foreign_keys("tasks")
                if constraint.get("name")
            }

            task_additions = {
                "project_id": "VARCHAR(36)",
                "subtask_approval_required": "BOOLEAN",
                "completion_xp_awarded_at": "TIMESTAMP WITH TIME ZONE",
                "completion_xp_awarded_to_id": "VARCHAR(36)",
                "completion_xp_points_awarded": "INTEGER",
                "clarity_xp_awarded_at": "TIMESTAMP WITH TIME ZONE",
                "clarity_xp_awarded_to_id": "VARCHAR(36)",
                "clarity_xp_points_awarded": "INTEGER",
            }
            for column_name, column_type in task_additions.items():
                if column_name not in task_columns:
                    connection.exec_driver_sql(f"ALTER TABLE tasks ADD COLUMN {column_name} {column_type}")

            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_tasks_project_id ON tasks (project_id)")
            connection.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS ix_tasks_project_status_updated
                ON tasks (project_id, status, updated_at)
                """
            )
            if "projects" in existing_tables and "fk_tasks_project_id_projects" not in task_constraints:
                connection.exec_driver_sql(
                    """
                    ALTER TABLE tasks
                    ADD CONSTRAINT fk_tasks_project_id_projects
                    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
                    """
                )

        if "subtasks" in existing_tables:
            connection.exec_driver_sql(
                """
                DO $$
                BEGIN
                    CREATE TYPE subtaskstatusenum AS ENUM (
                        'WAITING',
                        'TODO',
                        'IN_PROGRESS',
                        'BLOCKED',
                        'IN_REVIEW',
                        'DONE'
                    );
                EXCEPTION WHEN duplicate_object THEN NULL;
                END
                $$;
                """
            )

            subtask_columns = {column["name"] for column in inspector.get_columns("subtasks")}
            subtask_constraints = {
                constraint["name"]
                for constraint in inspector.get_foreign_keys("subtasks")
                if constraint.get("name")
            }

            if "assigned_to_id" not in subtask_columns:
                connection.exec_driver_sql("ALTER TABLE subtasks ADD COLUMN assigned_to_id VARCHAR(36)")
            if "status" not in subtask_columns:
                connection.exec_driver_sql("ALTER TABLE subtasks ADD COLUMN status subtaskstatusenum")
            if "sort_order" not in subtask_columns:
                connection.exec_driver_sql("ALTER TABLE subtasks ADD COLUMN sort_order INTEGER")

            connection.exec_driver_sql(
                """
                UPDATE subtasks
                SET status = CASE WHEN completed THEN 'DONE'::subtaskstatusenum ELSE 'TODO'::subtaskstatusenum END
                WHERE status IS NULL
                """
            )
            connection.exec_driver_sql("UPDATE subtasks SET sort_order = 0 WHERE sort_order IS NULL")
            connection.exec_driver_sql("ALTER TABLE subtasks ALTER COLUMN status SET NOT NULL")
            connection.exec_driver_sql("ALTER TABLE subtasks ALTER COLUMN sort_order SET NOT NULL")

            if "users" in existing_tables and "fk_subtasks_assigned_to_id_users" not in subtask_constraints:
                connection.exec_driver_sql(
                    """
                    ALTER TABLE subtasks
                    ADD CONSTRAINT fk_subtasks_assigned_to_id_users
                    FOREIGN KEY (assigned_to_id) REFERENCES users (id) ON DELETE SET NULL
                    """
                )

            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_subtasks_task_status ON subtasks (task_id, status)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_subtasks_assigned_to_id ON subtasks (assigned_to_id)"
            )


def ensure_reward_schema() -> None:
    inspector = inspect(engine)
    if "rewards" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("rewards")}
    dialect = engine.dialect.name
    statements: list[str] = []
    post_updates: list[str] = []

    def add_column(name: str, type_sql: str, default: str | None = None) -> None:
        if dialect == "sqlite":
            sql = f"ALTER TABLE rewards ADD COLUMN {name} {type_sql}"
            if default is not None:
                sql += f" DEFAULT {default}"
            statements.append(sql)
        elif dialect == "postgresql":
            sql = f"ALTER TABLE rewards ADD COLUMN IF NOT EXISTS {name} {type_sql}"
            if default is not None:
                sql += f" DEFAULT {default}"
            statements.append(sql)

    if "image_source" not in existing_columns:
        add_column("image_source", "TEXT", "'LIBRARY'")
    if "image_ref" not in existing_columns:
        add_column("image_ref", "TEXT")
    if "xp_required" not in existing_columns:
        add_column("xp_required", "INTEGER", "0")
        post_updates.append("UPDATE rewards SET xp_required = COALESCE(points_required, 0) WHERE xp_required IS NULL")
    if "dept_whitelist" not in existing_columns:
        json_type = "JSON" if dialect == "sqlite" else "JSONB"
        add_column("dept_whitelist", json_type)
        if dialect == "sqlite":
            post_updates.append("UPDATE rewards SET dept_whitelist = '[]' WHERE dept_whitelist IS NULL")
        else:
            post_updates.append("UPDATE rewards SET dept_whitelist = '[]'::jsonb WHERE dept_whitelist IS NULL")
    if "auto_redeem" not in existing_columns:
        default_flag = "1" if dialect == "sqlite" else "TRUE"
        add_column("auto_redeem", "BOOLEAN", default_flag)
    if "allow_multiple_claims" not in existing_columns:
        default_flag = "0" if dialect == "sqlite" else "FALSE"
        add_column("allow_multiple_claims", "BOOLEAN", default_flag)
    if "expires_at" not in existing_columns:
        column_type = "TIMESTAMP" if dialect == "sqlite" else "TIMESTAMPTZ"
        add_column("expires_at", column_type)
    if "status" not in existing_columns:
        add_column("status", "TEXT", "'ACTIVE'")
    if "created_by_id" not in existing_columns:
        add_column("created_by_id", "VARCHAR(36)")
    if "updated_by_id" not in existing_columns:
        add_column("updated_by_id", "VARCHAR(36)")
    if "created_at" not in existing_columns:
        default_timestamp = "CURRENT_TIMESTAMP"
        column_type = "TIMESTAMP" if dialect == "sqlite" else "TIMESTAMPTZ"
        add_column("created_at", column_type, default_timestamp)
    if "updated_at" not in existing_columns:
        default_timestamp = "CURRENT_TIMESTAMP"
        column_type = "TIMESTAMP" if dialect == "sqlite" else "TIMESTAMPTZ"
        add_column("updated_at", column_type, default_timestamp)

    if statements or post_updates:
        with engine.begin() as connection:
            for statement in statements:
                connection.exec_driver_sql(statement)
            for statement in post_updates:
                connection.exec_driver_sql(statement)

    if "reward_claims" in inspector.get_table_names():
        claim_columns = {column["name"] for column in inspector.get_columns("reward_claims")}
        if "xp_spent" not in claim_columns:
            with engine.begin() as connection:
                connection.exec_driver_sql("ALTER TABLE reward_claims ADD COLUMN xp_spent INTEGER DEFAULT 0")
                connection.exec_driver_sql(
                    """
                    UPDATE reward_claims
                    SET xp_spent = COALESCE(
                        (SELECT rewards.xp_required FROM rewards WHERE rewards.id = reward_claims.reward_id),
                        0
                    )
                    WHERE xp_spent IS NULL OR xp_spent = 0
                    """
                )
        if dialect == "postgresql":
            with engine.begin() as connection:
                connection.exec_driver_sql("ALTER TABLE reward_claims DROP CONSTRAINT IF EXISTS uq_reward_claim")
        elif dialect == "sqlite":
            claim_indexes = inspector.get_indexes("reward_claims")
            claim_constraints = inspector.get_unique_constraints("reward_claims")
            has_unique_claim_constraint = any(
                index.get("unique") and set(index.get("column_names") or []) == {"reward_id", "user_id"}
                for index in claim_indexes
            ) or any(
                set(constraint.get("column_names") or []) == {"reward_id", "user_id"}
                for constraint in claim_constraints
            )
            if has_unique_claim_constraint:
                with engine.begin() as connection:
                    connection.exec_driver_sql(
                        """
                        CREATE TABLE reward_claims_new (
                            id VARCHAR(36) NOT NULL PRIMARY KEY,
                            reward_id VARCHAR(36) NOT NULL,
                            user_id VARCHAR(36) NOT NULL,
                            status VARCHAR(8) NOT NULL,
                            xp_spent INTEGER NOT NULL DEFAULT 0,
                            claimed_at DATETIME NOT NULL,
                            resolved_at DATETIME,
                            approver_id VARCHAR(36),
                            FOREIGN KEY(reward_id) REFERENCES rewards (id) ON DELETE CASCADE,
                            FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
                            FOREIGN KEY(approver_id) REFERENCES users (id) ON DELETE SET NULL
                        )
                        """
                    )
                    connection.exec_driver_sql(
                        """
                        INSERT INTO reward_claims_new (
                            id, reward_id, user_id, status, xp_spent, claimed_at, resolved_at, approver_id
                        )
                        SELECT id, reward_id, user_id, status, xp_spent, claimed_at, resolved_at, approver_id
                        FROM reward_claims
                        """
                    )
                    connection.exec_driver_sql("DROP TABLE reward_claims")
                    connection.exec_driver_sql("ALTER TABLE reward_claims_new RENAME TO reward_claims")




def ensure_media_file_columns() -> None:
    inspector = inspect(engine)
    if "media_files" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("media_files")}
    dialect = engine.dialect.name
    statements: list[str] = []

    def add_column(name: str, sqlite_sql: str, pg_sql: str) -> None:
        if name in existing_columns:
            return
        if dialect == "sqlite":
            statements.append(sqlite_sql)
        elif dialect == "postgresql":
            statements.append(pg_sql)

    add_column(
        "crop_metadata",
        "ALTER TABLE media_files ADD COLUMN crop_metadata JSON",
        "ALTER TABLE media_files ADD COLUMN IF NOT EXISTS crop_metadata JSONB",
    )
    add_column(
        "deleted_at",
        "ALTER TABLE media_files ADD COLUMN deleted_at TIMESTAMP",
        "ALTER TABLE media_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    )

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)


def ensure_kanban_columns() -> None:
    inspector = inspect(engine)
    if "kanban_columns" not in inspector.get_table_names():
        return

    desired_columns = [
        (models.TaskStatusEnum.WAITING_FOR_REQUIREMENT.value, "Battle Plan", 0),
        (models.TaskStatusEnum.TODO.value, "Case Filed", 1),
        (models.TaskStatusEnum.IN_PROGRESS.value, "In Progress", 2),
        (models.TaskStatusEnum.BUG_FIXING.value, "Bug Fixing", 3),
        (models.TaskStatusEnum.BLOCKED.value, "Boss Encounter", 4),
        (models.TaskStatusEnum.IN_REVIEW.value, "Tactical Shift", 5),
        (models.TaskStatusEnum.ON_HOLD.value, "On Hold", 6),
        (models.TaskStatusEnum.DONE.value, "Conquered", 7),
        (models.TaskStatusEnum.DEPLOYED.value, "Deployed", 8),
        (models.TaskStatusEnum.FAILED.value, "Fallen", 9),
        (models.TaskStatusEnum.GRAVEYARD.value, "Graveyard", 10),
    ]
    legacy_ids = {"col-1", "col-2", "col-3", "col-4", "col-5", "col-6", "col-7", "col-8", "col-9"}
    legacy_titles = {
        "WAITING_FOR_REQUIREMENT",
        "TODO",
        "IN_PROGRESS",
        "BUG_FIXING",
        "IN_REVIEW",
        "BLOCKED",
        "ON_HOLD",
        "DONE",
        "DEPLOYED",
    }

    with SessionLocal() as session:
        existing = session.execute(select(models.KanbanColumn)).scalars().all()
        if any(col.id in legacy_ids or col.title in legacy_titles for col in existing):
            for col in existing:
                if col.id in legacy_ids or col.title in legacy_titles:
                    session.delete(col)
            session.flush()
            existing = session.execute(select(models.KanbanColumn)).scalars().all()

        existing_by_id = {col.id: col for col in existing}
        existing_by_title = {col.title: col for col in existing}
        desired_by_id = {column_id: (title, order) for column_id, title, order in desired_columns}
        desired_ids = set(desired_by_id)

        # Avoid transient unique-order collisions when existing rows are being
        # normalized or reordered under the uq_kanban_column_order constraint.
        for index, column in enumerate(existing):
            if column.id in desired_ids or column.title in {title for _, title, _ in desired_columns}:
                column.order = -1000 - index
        session.flush()

        for column_id, title, order in desired_columns:
            column = existing_by_id.get(column_id) or existing_by_title.get(title)
            if column:
                if column.id != column_id and column_id not in existing_by_id:
                    column.id = column_id
                column.title = title
                column.order = order
            else:
                session.add(models.KanbanColumn(id=column_id, title=title, order=order))

        session.commit()


class CorsFastAPI(FastAPI):
    def build_middleware_stack(self):
        # Keep FastAPI's public API while placing CORS outside its 500 handler.
        from .oauth_cors import build_cors_stack
        return build_cors_stack(super().build_middleware_stack(), settings)


app = CorsFastAPI(title=settings.app_name)
app.add_middleware(RealtimeMetricsMiddleware)


def _apply_security_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.exception_handler(Exception)
async def internal_server_error(request: Request, exc: Exception):
    return _apply_security_headers(JSONResponse(status_code=500, content={"detail": "Internal server error"}))


@app.middleware("http")
async def no_store_cache_headers(request, call_next):
    content_length = request.headers.get("content-length")
    max_body_bytes = max(settings.max_request_body_mb, 1) * 1024 * 1024
    if content_length:
        try:
            if int(content_length) > max_body_bytes:
                return _apply_security_headers(JSONResponse(
                    status_code=413,
                    content={"detail": "Request body too large"},
                ))
        except ValueError:
            return _apply_security_headers(JSONResponse(
                status_code=400,
                content={"detail": "Invalid Content-Length header"},
            ))
    response = await call_next(request)
    return _apply_security_headers(response)


@app.middleware("http")
async def audit_security_events(request: Request, call_next):
    response = await call_next(request)
    if response.status_code not in {401, 403, 429}:
        return response

    actor_id = None
    actor_role = None
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            payload = _decode_access_token(token)
            actor_id = payload.get("user_id") or payload.get("sub")
            roles = payload.get("roles") or []
            if isinstance(roles, list) and roles:
                actor_role = str(roles[0])
        except Exception:
            actor_id = None

    action_map = {
        401: "UNAUTHORIZED_ACCESS",
        403: "PERMISSION_DENIED",
        429: "RATE_LIMIT_HIT",
    }
    severity = models.AuditLogSeverityEnum.WARNING
    if response.status_code == 429:
        severity = models.AuditLogSeverityEnum.CRITICAL

    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action=action_map.get(response.status_code, "SECURITY_EVENT"),
            category=models.AuditLogCategoryEnum.SECURITY,
            actor_id=str(actor_id) if actor_id else None,
            actor_role=actor_role,
            entity_type="security",
            entity_id=request.url.path,
            source=models.AuditLogSourceEnum.API,
            severity=severity,
            status=models.AuditLogStatusEnum.FAILED,
            reason=f"HTTP {response.status_code}",
            request=request,
        )
    )
    return response
app.mount("/assets", StaticFiles(directory="assets"), name="assets")

uploads_directory = Path(settings.media_root) / "uploads"
uploads_directory.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_directory)), name="media-uploads")

def initialize_schema() -> None:
    ensure_pg_trgm_extension()
    ensure_composite_fk_reference_constraints()
    ensure_notification_table_schema()
    ensure_task_manager_table_schema()
    with engine.begin() as connection:
        ensure_execution_columns(connection)
        from .work_timer_schema import upgrade as upgrade_work_timers
        upgrade_work_timers(connection)
    Base.metadata.create_all(bind=engine, tables=[table for table in Base.metadata.sorted_tables if table.name not in {"realtime_outbox", "realtime_aggregates"}])
    ensure_task_status_enum()
    ensure_reward_schema()
    ensure_chat_schema()
    normalize_legacy_task_status_values()
    ensure_employer_id_column()
    ensure_user_profile_columns()
    ensure_media_file_columns()
    ensure_webhook_schema()
    seed_database()
    seed_badges_from_achievements()
    ensure_kanban_columns()
    ensure_avatar_dirs()


@app.on_event("startup")
async def startup_event() -> None:
    if settings.realtime_outbox_enabled and not {"realtime_outbox", "realtime_aggregates"}.issubset(inspect(engine).get_table_names()):
        raise RuntimeError("Apply realtime migration fc4d5e6f7a8b before enabling the outbox")
    if settings.bootstrap_schema:
        initialize_schema()
    start_webhook_retry_worker()
    notification_outbox.start_notification_outbox_worker()
    loop = asyncio.get_event_loop()
    task_events.start_task_event_listener(loop=loop, handler=tasks_ws.broadcast_task_event, on_gap=tasks_ws.manager.close_all)
    chat_realtime.start_chat_event_listener(loop=loop, handler=chat_ws.manager.dispatch_remote_event, on_gap=chat_ws.manager.close_all)
    realtime_transport.start("ticket", loop, ticket_chat.manager.dispatch, ticket_chat.manager.close_all)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    notification_outbox.stop_notification_outbox_worker()
    stop_webhook_retry_worker()
    await task_events.stop_task_event_listener()
    await chat_realtime.stop_chat_event_listener()
    await realtime_transport.stop("ticket")
    await tasks_ws.manager.close_all()
    await chat_ws.manager.close_all()
    await ticket_chat.manager.close_all()
    from .cache import close_redis_client
    close_redis_client()



app.include_router(auth.router)
app.include_router(clients.router)
app.include_router(contacts.router)
app.include_router(contacts.client_contacts_router)
app.include_router(projects.router)
app.include_router(reports.router)
app.include_router(users.router)
app.include_router(departments.router)
app.include_router(kanban.router)
app.include_router(levels.router)
app.include_router(tasks.router)
app.include_router(time_entries.router)
app.include_router(comments.router)
app.include_router(achievements.router)
app.include_router(badges.router)
app.include_router(rewards.router)
app.include_router(rewards.claims_router)
app.include_router(notifications.router)
app.include_router(notification_preferences.router)
app.include_router(push.router)
app.include_router(config_router.router)
app.include_router(feature_flags.router)
app.include_router(n8n.router)
app.include_router(data_admin.router)
app.include_router(oauth2_server.router)
from .oauth_logging import install as install_oauth_log_filter
install_oauth_log_filter()
from .routers.oauth_management import discovery_router
app.include_router(discovery_router)
app.include_router(avatars.router)
app.include_router(media.router)
app.include_router(media.router, prefix="/api")
app.include_router(logs.router)
app.include_router(updates.router)
app.include_router(tool_library.router)
app.include_router(chat_router.router)
app.include_router(tickets_router.router)
app.include_router(ticket_attachments_router.router)
app.include_router(ticket_chat.router)
app.include_router(ticket_chat.router, prefix="/api")
app.include_router(tasks_ws.router)
app.include_router(chat_ws.router)
app.include_router(webhooks.router)
app.include_router(webhooks.internal_router)

app.include_router(navigation.router)
app.include_router(navigation.router, prefix="/api")
app.include_router(support.router)
app.include_router(support.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(clients.router, prefix="/api")
app.include_router(contacts.router, prefix="/api")
app.include_router(contacts.client_contacts_router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(departments.router, prefix="/api")
app.include_router(kanban.router, prefix="/api")
app.include_router(levels.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(time_entries.router, prefix="/api")
app.include_router(comments.router, prefix="/api")
app.include_router(achievements.router, prefix="/api")
app.include_router(badges.router, prefix="/api")
app.include_router(rewards.router, prefix="/api")
app.include_router(rewards.claims_router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(notification_preferences.router, prefix="/api")
app.include_router(push.router, prefix="/api")
app.include_router(config_router.router, prefix="/api")
app.include_router(feature_flags.router, prefix="/api")
app.include_router(n8n.router, prefix="/api")
app.include_router(data_admin.router, prefix="/api")
app.include_router(oauth2_server.router, prefix="/api")
app.include_router(avatars.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(updates.router, prefix="/api")
app.include_router(tool_library.router, prefix="/api")
app.include_router(chat_router.router, prefix="/api")
app.include_router(tickets_router.router, prefix="/api")
app.include_router(tickets_workflow_router.router)
app.include_router(webhooks.router, prefix="/api")
app.include_router(webhooks.internal_router, prefix="/api")
app.include_router(tasks_ws.router, prefix="/api")
app.include_router(chat_ws.router, prefix="/api")


def _health_response() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name}


@app.get("/")
def root() -> dict[str, str]:
    response = _health_response()
    response.update(
        {
            "message": "Vee Task Manager API",
            "docs": "/docs",
            "health": "/health",
        }
    )
    return response


@app.get("/health")
def health_check() -> dict[str, str]:
    return _health_response()


@app.get("/ready")
def readiness():
    state = realtime_transport.health()
    redis_ok = len(state["subscribers"]) == 3 and all(item["connected"] and item["alive"] for item in state["subscribers"].values())
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            db.execute(select(models.NavigationPolicy.revision).limit(1))
        database_ok = True
    except Exception:
        database_ok = False
    return JSONResponse(status_code=200 if database_ok and redis_ok else 503,
                        content={"database": database_ok, "realtime": redis_ok})


@app.get("/realtime/metrics")
def realtime_metrics(user=Depends(get_current_admin)):
    from .realtime.outbox import backlog
    state = realtime_transport.health()
    state["connections"] = {"chat": chat_ws.manager.snapshot(), "tasks": tasks_ws.manager.snapshot(), "tickets": ticket_chat.manager.snapshot()}
    if settings.realtime_outbox_enabled:
        with SessionLocal() as db:
            state["outbox"] = backlog(db)
    return state


@app.get("/doc/health")
def doc_health_check() -> dict[str, str]:
    return _health_response()
