from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import get_settings


settings = get_settings()
is_sqlite = settings.database_url.startswith("sqlite")
engine_kwargs = {"echo": False, "future": True, "pool_pre_ping": True}
if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_size"] = settings.db_pool_size
    engine_kwargs["max_overflow"] = settings.db_max_overflow
    engine_kwargs["pool_timeout"] = settings.db_pool_timeout
    engine_kwargs["pool_recycle"] = settings.db_pool_recycle

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

Base = declarative_base()


def _ensure_task_group_column() -> None:
    """
    Lightweight migration helper so older SQLite/Postgres installs gain the new task_group_id column automatically.
    This keeps local developer/test databases from breaking when the ORM expects the field.
    """
    try:
        inspector = inspect(engine)
        if "tasks" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("tasks")}
        if "task_group_id" in columns:
            return
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN task_group_id VARCHAR(36)"))
            conn.execute(
                text(
                    """
                    UPDATE tasks
                    SET task_group_id = id
                    WHERE task_group_id IS NULL OR task_group_id = ''
                    """
                )
            )
    except Exception:
        # Swallow errors so startup still succeeds; the API will surface a clearer DB error if this failed.
        pass


if settings.bootstrap_schema:
    _ensure_task_group_column()


def _ensure_task_followers_table() -> None:
    """
    Create task follower storage for existing installs.

    Followers are observers only: they can view task updates and receive task
    notifications, but they are intentionally separate from assignees so reward
    and completion logic remains tied to assigned users.
    """
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        if "task_followers" in existing_tables:
            return
        if not {"tasks", "users"}.issubset(existing_tables):
            return
        with engine.begin() as conn:
            if is_sqlite:
                conn.execute(
                    text(
                        """
                        CREATE TABLE IF NOT EXISTS task_followers (
                            task_id VARCHAR(36) NOT NULL,
                            user_id VARCHAR(36) NOT NULL,
                            created_at DATETIME NOT NULL,
                            PRIMARY KEY (task_id, user_id),
                            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                        )
                        """
                    )
                )
            else:
                conn.execute(
                    text(
                        """
                        CREATE TABLE IF NOT EXISTS task_followers (
                            task_id VARCHAR(36) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                            PRIMARY KEY (task_id, user_id)
                        )
                        """
                    )
                )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_task_followers_user_id ON task_followers (user_id)"))
    except Exception:
        # Swallow errors so startup still succeeds; the API will surface a clearer DB error if this failed.
        pass


if settings.bootstrap_schema:
    _ensure_task_followers_table()


def _ensure_user_profile_columns() -> None:
    """
    Add optional profile/shift columns to the users table for existing databases.
    """
    try:
        inspector = inspect(engine)
        if "users" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("users")}
        desired = {
            "credentials_version": "INTEGER NOT NULL DEFAULT 0",
            "manager_email": "VARCHAR(255)",
            "shift_name": "VARCHAR(255)",
            "shift_start": "VARCHAR(16)",
            "shift_end": "VARCHAR(16)",
            "morning_break_start": "VARCHAR(16)",
            "morning_break_end": "VARCHAR(16)",
            "lunch_break_start": "VARCHAR(16)",
            "lunch_break_end": "VARCHAR(16)",
            "evening_break_start": "VARCHAR(16)",
            "evening_break_end": "VARCHAR(16)",
        }
        missing = {name: col_type for name, col_type in desired.items() if name not in columns}
        if not missing:
            return
        with engine.begin() as conn:
            for name, col_type in missing.items():
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {col_type}"))
    except Exception:
        # Swallow errors so startup still succeeds; the API will surface a clearer DB error if this failed.
        pass


if settings.bootstrap_schema:
    _ensure_user_profile_columns()


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
