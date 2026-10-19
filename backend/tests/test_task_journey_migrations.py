"""Real Alembic CLI and pg_dump/pg_restore checks on an owned synthetic schema."""
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from backend.app import models
from backend.app.lifecycle.schema_v1 import uninstall
from backend.tests.test_task_lifecycle import NOW, engine

BACKEND = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=60, **kwargs)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    return result.stdout


def test_cli_upgrade_restore_and_guarded_rollback_preserve_synthetic_business_data(engine):
    if engine.dialect.name != "postgresql":
        pytest.skip("Real PostgreSQL CLI/backup test; SQLite migration checks run in lifecycle suite")
    container = os.environ.get("ZEAPLAY_RT_BACKUP_CONTAINER")
    if not container:
        pytest.skip("Requires explicitly owned ZEAPLAY_RT_BACKUP_CONTAINER")
    project = run(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container]).decode().strip()
    assert project == "zeaplay-journey-review", "Refusing non-review backup container"
    with engine.begin() as connection:
        schema = connection.scalar(text("SELECT current_schema()"))
        assert schema.startswith("lifecycle_") and schema[10:].isalnum()
        uninstall(connection)
        models.TaskLifecycleEvent.__table__.drop(connection)
        models.TaskLifecycleCoverage.__table__.drop(connection)
        connection.exec_driver_sql("DROP INDEX uq_time_entries_continued_from_id")
        for column in ("continued_from_id", "start_kind", "stop_reason"):
            connection.exec_driver_sql(f"ALTER TABLE time_entries DROP COLUMN {column}")
    with Session(engine) as db:
        user = models.User(name="Synthetic legacy", tenant_id=uuid4(), email=f"{uuid4()}@example.com",
                           hashed_password="not-a-login-password", points=555, tasks_created=9, tasks_completed=4)
        db.add(user)
        db.flush()
        reward = models.Reward(title="Synthetic retained reward", description="Migration fixture", xp_required=77, created_by_id=user.id)
        task = models.Task(title="Legacy retained", created_by_id=user.id, created_at=datetime(2020, 1, 1),
                           completed_at=datetime(2020, 1, 2), status=models.TaskStatusEnum.DONE)
        db.add_all([reward, task])
        db.flush()
        child = models.Subtask(task_id=task.id, title="Legacy completed", status=models.SubtaskStatusEnum.DONE, completed=True)
        db.add(child)
        db.flush()
        db.add(models.RewardClaim(reward_id=reward.id, user_id=user.id, xp_spent=77))
        db.execute(models.TimeEntry.__table__.insert().values(tenant_id=user.tenant_id, user_id=user.id,
            subtask_id=child.id, started_at=NOW, stopped_at=NOW, duration_seconds=0, status=models.TimeEntryStatusEnum.STOPPED))
        db.commit()
        task_id = task.id
    url = engine.url.update_query_dict({"options": f"-csearch_path={schema},public"})
    environment = {**os.environ, "VEE_BOOTSTRAP_SCHEMA": "false", "VEE_DATABASE_URL": url.render_as_string(hide_password=False)}
    def alembic(*args, success=True):
        result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=environment,
                                capture_output=True, text=True, timeout=60)
        if success:
            assert result.returncode == 0, result.stderr
        return result
    tables = ("users", "rewards", "reward_claims", "tasks", "subtasks")
    def snapshot(bind, names):
        with bind.connect() as connection:
            return {table: connection.scalar(text(f"SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]') FROM {table} t")) for table in names}
    before = snapshot(engine, tables)
    timer_before = json.loads(snapshot(engine, ("time_entries",))["time_entries"])
    alembic("stamp", "fc4d5e6f7a8b")
    alembic("upgrade", "fd5e6f7a8b9c")
    assert snapshot(engine, tables) == before
    timer_after = json.loads(snapshot(engine, ("time_entries",))["time_entries"])
    assert [{key: value for key, value in row.items() if key not in
             {"continued_from_id", "start_kind", "stop_reason"}} for row in timer_after] == timer_before
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM task_lifecycle_events")) == 0
        assert connection.scalar(text("SELECT duration_seconds FROM time_entries")) == 0
    alembic("downgrade", "fc4d5e6f7a8b")  # Empty history only, owned schema.
    alembic("upgrade", "fd5e6f7a8b9c")
    with engine.begin() as connection:
        connection.execute(text("UPDATE tasks SET status='TODO' WHERE id=:id"), {"id": task_id})
    rejected = alembic("downgrade", "fc4d5e6f7a8b", success=False)
    assert rejected.returncode != 0 and "retain schema" in rejected.stderr
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "fd5e6f7a8b9c"
    names = (*tables, "time_entries", "task_lifecycle_events", "task_lifecycle_coverage")
    original = snapshot(engine, names)
    dump = run(["docker", "exec", container, "pg_dump", "-U", "rt_test", "-d", "zeaplay_rt3_test",
                "--schema", schema, "--format=custom", "--no-owner", "--no-acl"])
    restored_name = "rt3_test_restore_" + uuid4().hex
    restored = None
    run(["docker", "exec", container, "createdb", "-U", "rt_test", restored_name])
    try:
        run(["docker", "exec", container, "psql", "-U", "rt_test", "-d", restored_name, "-c", "CREATE EXTENSION pg_trgm"])
        run(["docker", "exec", "-i", container, "pg_restore", "-U", "rt_test", "-d", restored_name,
             "--exit-on-error", "--no-owner", "--no-acl"], input=dump)
        restored = create_engine(url.set(database=restored_name))
        assert snapshot(restored, names) == original
        print(f"MIGRATION_RESTORE_PASS: real Alembic upgrade/downgrade guard; pg_dump/pg_restore; {len(names)} retained table snapshots identical")
    finally:
        if restored:
            restored.dispose()
        run(["docker", "exec", container, "dropdb", "-U", "rt_test", restored_name])
