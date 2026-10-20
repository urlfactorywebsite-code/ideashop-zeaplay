# Reporting deployment and verification

Implementation and validation are local. The running application containers have not been replaced, and the application database has not been migrated by this work.

## Local verification

From the repository root with Docker and the installed backend virtual environment:

```powershell
backend/venv/Scripts/python.exe -m pip install -r backend/requirements.txt
powershell.exe -NoProfile -File ops/verify-reporting.ps1
```

The verification script owns a randomly named, disposable PostgreSQL 16 container/database on a loopback-only dynamic port. It generates temporary credentials without printing them, creates isolated fixture schemas, runs reporting/compatibility checks and cleans up only that container. It does not use the application's PostgreSQL container. See `checks/backend-postgres-combined.txt` and the JUnit XML for actual results.

The completed verification manifest is `checks/backend-verification-final.json`. It distinguishes the 119-test combined run from final overlapping SQLite/PostgreSQL lifecycle/time reruns, and records cleanup. The backend production image also built successfully; a read-only container with no network passed `ops/reporting_image_smoke.py` against Python 3.11.17.

From `frontend`, run sequentially:

```powershell
npm.cmd test
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm.cmd run build
```

Browser reproduction and fixture limitations are in [frontend-validation.md](frontend-validation.md). A passing Vite build does not mean the repository-wide TypeScript check passed. There is no configured frontend lint script.

## Release preparation

1. Include only the reporting paths listed in this directory; preserve unrelated uncommitted task/notification changes.
2. Build the backend with updated `requirements.txt` (`openpyxl` and `tzdata`) and the frontend from the same reviewed source. Retain previous image identifiers.
3. Inspect the deployment's actual schema/version on an isolated restored backup before applying migrations. The application has legacy startup schema helpers, so do not assume `alembic_version` matches merely because the UI runs.
4. Reporting requires the existing lifecycle/history and active-work schema. Missing lifecycle coverage returns a 503 for event reports; it must not be hidden by invented data or `alembic stamp head`.
5. On a **versioned database already at `ff9c0d1e2f3a`**, the only new reporting migration is `ffa0d1e2f3a4`. It adds the index `(tenant_id, occurred_at, task_id)` on `task_lifecycle_events`; no business rows or status values change.

For a prepared, versioned deployment using its private database environment, from `backend`:

```text
python -m alembic current
python -m alembic upgrade ffa0d1e2f3a4
```

Do not run this upgrade blindly against an unversioned legacy database or one with unreviewed pending revisions. Restore and rehearse its actual path first. The index uses concurrent creation on PostgreSQL; after an interrupted build, inspect index validity before retrying.

An unversioned legacy installation with existing lifecycle tables can continue using reporting without the optional performance index. A DBA may install that one index after schema/plan verification:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_task_lifecycle_reporting_period
ON task_lifecycle_events (tenant_id, occurred_at, task_id);
```

The synthetic plan probe justified this event-period index only. No task index was added because its measured synthetic plan did not improve. Production plans, data volume and lock/runtime costs still require deployment-specific measurement.

## Deploy and smoke-check

Use the environment's existing Compose/runbook and private configuration. For the local development Compose stack, an operator can build and replace only application services:

```powershell
docker compose build backend frontend
docker compose up -d --no-deps backend frontend
```

For VPS deployment use the established production Compose files instead of the development command. Set `VEE_BOOTSTRAP_SCHEMA=false` once a controlled migration process is established; never treat automatic schema bootstrap as a reporting migration.

After replacement, inspect the live `/openapi.json` or configured OpenAPI path for `/api/reports/overview`, `/api/reports/time`, and `/api/reports/export`. Sign in with authorized owner, manager and regular-user test accounts. Reconcile a small known task population against its reports and exports, test an archived project, verify manager project restrictions, and confirm two overlapping timers produce larger recorded effort than unique time.

Rollback uses the retained backend/frontend images. The reporting index is additive and can remain during application rollback; dropping it is unnecessary for correctness. No business data rollback or task-status rewrite is part of this release.

## Release limits

Repository-wide type-check/lint status and live deployment validation must be reported separately from reporting fixture/build success. The separate backend image build and network-isolated Linux smoke check verify imports, reporting-route registration, unauthenticated rejection and an XLSX round-trip; they are not full application-startup, VPS or production proof. Deployment should also measure its expected data volume; synchronous export/time limits deliberately return an error instead of partial or misleading totals.
