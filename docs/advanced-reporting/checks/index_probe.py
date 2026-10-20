"""Reproducible in-memory SQLite query-shape probe; never connects to application data."""
import json
import sqlite3
from datetime import datetime, timedelta
from time import perf_counter


db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL);
CREATE INDEX ix_tasks_project_id ON tasks(project_id);
CREATE INDEX ix_tasks_created_at ON tasks(created_at);
CREATE TABLE task_lifecycle_events (id INTEGER PRIMARY KEY, tenant_id TEXT, task_id TEXT, occurred_at TEXT);
CREATE INDEX ix_task_lifecycle_tenant_task_id ON task_lifecycle_events(tenant_id,task_id,id);
""")
base = datetime(2020, 1, 1)
rows = [(str(i), f"project-{i % 10}", (base + timedelta(days=i // 100)).isoformat(), "TODO")
        for i in range(100000)]
db.executemany("INSERT INTO tasks VALUES (?,?,?,?)", rows)
db.executemany("INSERT INTO task_lifecycle_events VALUES (?,?,?,?)",
               [(i + 1, f"tenant-{i % 2}", str(i), row[2]) for i, row in enumerate(rows)])
db.execute("ANALYZE")


def probe(query, args):
    plan = [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query, args)]
    start = perf_counter()
    result = db.execute(query, args).fetchall()
    return {"plan": plan, "matched_rows": sum(row[1] if len(row) > 1 else row[0] for row in result),
            "elapsed_ms": round((perf_counter() - start) * 1000, 3)}


task_query = "SELECT status, COUNT(*) FROM tasks WHERE project_id=? AND created_at>=? AND created_at<? GROUP BY status"
task_args = ("project-0", "2022-01-01", "2022-01-03")
event_query = "SELECT COUNT(*) FROM task_lifecycle_events WHERE tenant_id=? AND occurred_at>=? AND occurred_at<?"
event_args = ("tenant-0", "2022-01-01", "2022-01-03")
before = {"tasks": probe(task_query, task_args), "events": probe(event_query, event_args)}
db.executescript("""
CREATE INDEX ix_tasks_reporting_project_created ON tasks(project_id,created_at,id);
CREATE INDEX ix_task_lifecycle_reporting_period ON task_lifecycle_events(tenant_id,occurred_at,task_id);
ANALYZE;
""")
after = {"tasks": probe(task_query, task_args), "events": probe(event_query, event_args)}
print(json.dumps({"engine": "SQLite in-memory synthetic query shape only", "synthetic_tasks": len(rows),
                  "synthetic_events": len(rows), "before": before, "after": after}, indent=2))
db.close()
