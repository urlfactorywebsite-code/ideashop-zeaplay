-- PostgreSQL only. Run against a restored staging copy first, then as a read-only
-- deployment preflight. Returns counts and index definitions, never work titles.
-- This script does not repair or delete records. Expected schema: ff8b9c0d1e2f.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT version_num FROM alembic_version;

SELECT i.relname AS index_name, x.indisvalid, pg_get_indexdef(i.oid) AS definition
FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = current_schema() AND t.relname = 'time_entries'
  AND i.relname IN ('ix_time_entries_tenant_user_started',
    'uq_time_entries_continued_from_id', 'uq_time_entries_running_task',
    'uq_time_entries_running_subtask', 'uq_time_entries_one_active_per_user')
ORDER BY i.relname;

-- Must be zero: duplicate running targets, duplicate continuations, invalid spans.
SELECT 'duplicate_running_targets' AS finding, count(*) AS groups
FROM (
  SELECT tenant_id, user_id, task_id, subtask_id FROM time_entries
  WHERE stopped_at IS NULL GROUP BY tenant_id, user_id, task_id, subtask_id
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'duplicate_continuations', count(*) FROM (
  SELECT continued_from_id FROM time_entries WHERE continued_from_id IS NOT NULL
  GROUP BY continued_from_id HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'invalid_stored_intervals', count(*) FROM time_entries
WHERE (stopped_at IS NOT NULL AND (stopped_at < started_at OR duration_seconds < 0))
   OR (finalized_at IS NOT NULL AND (stopped_at IS NULL OR finalized_at < stopped_at))
UNION ALL
SELECT 'inverted_or_mismatched_continuations', count(*)
FROM time_entries child JOIN time_entries parent ON parent.id = child.continued_from_id
WHERE child.tenant_id <> parent.tenant_id OR child.user_id <> parent.user_id
   OR child.task_id IS DISTINCT FROM parent.task_id
   OR child.subtask_id IS DISTINCT FROM parent.subtask_id
   OR parent.stopped_at IS NULL OR child.started_at < parent.stopped_at;

-- Review rather than auto-stop: role demotion may legitimately leave 5 running
-- sessions for a user now limited to 3. Future starts/resumes must be denied.
-- ADMIN/OWNER limits are deployment configuration, so inspect them separately.
SELECT u.role::text AS role, count(*) AS users_over_current_limit
FROM users u JOIN (
  SELECT user_id, count(*) AS running FROM time_entries
  WHERE stopped_at IS NULL GROUP BY user_id
) r ON r.user_id = u.id
WHERE (u.role::text = 'USER' AND r.running > 3)
   OR (u.role::text = 'MANAGER' AND r.running > 5)
GROUP BY u.role;

SELECT count(*) AS running_entries_with_changed_owner_tenant
FROM time_entries e JOIN users u ON u.id = e.user_id
WHERE e.stopped_at IS NULL AND e.tenant_id <> u.tenant_id;

ROLLBACK;
