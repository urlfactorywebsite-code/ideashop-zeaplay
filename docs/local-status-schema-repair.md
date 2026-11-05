# Local status schema repair — 2026-11-05

The local Docker API returned HTTP 500 from `/api/tasks/page` because its
unversioned PostgreSQL database lacked `tasks.custom_status_id` and the status
tables. The packaged application expected the four status revisions through
`f339a0b1c2d3`. Rebuilding application code alone does not apply those revisions.

## Completed locally

- Saved full custom-format PostgreSQL backups outside the repository at
  `C:\Users\Lenovo\.codex\backups\ideashop-zeaplay-v5\20261105-status-repair`.
  `rehearsal.dump` was restored successfully into a disposable database;
  `before-repair.dump` was taken with the backend stopped and its archive list checked.
- Rehearsed the repair on the restored data, including an unchanged second run.
- Stopped the backend, applied the four existing revisions atomically using
  `backend/scripts/apply_status_schema.py`, and rebuilt/recreated only the backend.
- Compared hashes/counts for every pre-existing table and column inside the repair
  transaction: all existing records were unchanged, including all 9 tasks and 6 users.
  Status scopes/system statuses were added; no migration version was stamped.
- Schema/guard/index checks and data integrity checks passed with no errors or warnings.
- Authenticated HTTP reads passed for `/api/tasks/page` (9 tasks), `/api/tasks/kanban`,
  `/api/task-statuses`, `/api/kanban-columns` (11 columns), and the calendar summary
  with its required date range. `/ready` returned 200 with database/realtime true;
  the frontend's `/api/health` proxy returned 200. Browser login page loaded.
- Safeguard checks passed: versioned and partial schemas are refused; the production
  apply branch refuses before opening a transaction. An injected final verification
  failure on a separate restored database rolled back all four revisions and retained
  all 9 tasks. Ruff and whitespace checks passed.

No production/VPS changes were performed. Authenticated browser interaction and a
full application regression suite were not run for this repair. Earlier release
review limitations still apply; see `status-management-production-readiness.md`.

## Reusing the helper

This is an explicit PostgreSQL development repair for an **unversioned** installation
with the existing lifecycle prerequisites. It accepts either the complete pre-status
schema or an already compatible schema. It refuses partial/versioned schemas and
production applies. It never runs schema bootstrap, old unrelated migrations, or
Alembic stamp. Existing On Hold tasks use the Phase 3 revision's documented migration
cutover; no historical pause duration is guessed.

Check without changing records:

```powershell
docker compose run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python scripts/apply_status_schema.py
```

After stopping writers, validating a full backup, and rehearsing its restore, apply
the helper with `--apply`, then start the matching backend and verify `/ready` and
authenticated task/status reads. Keep bootstrap disabled on the existing installation.
Take a fresh backup for every apply; the helper does not create one itself.

The helper intentionally retains the absence of `alembic_version`. The strict
production `check_status_integrity.py` deployment gate still reports a missing
revision for this unversioned local database. Do not stamp head to suppress that
finding; adopting the historical migration baseline remains separate work.
