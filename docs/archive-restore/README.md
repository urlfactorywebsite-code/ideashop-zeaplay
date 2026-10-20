# Restore archived projects and clients

The subsequent [regression audit](../archive-restore-audit/README.md) records refinements and real browser-to-API-to-PostgreSQL verification. The implementation evidence below is retained as history.

Implemented in the existing FastAPI/React modules on 2026-10-20. The implementation updates the original records and preserves their relationships. This work added no migration or duplicate archive flag and did not modify application data, restart application containers, or deploy to production.

The feature checks below pass locally on Windows and in a rebuilt Linux backend image. **Repository release certification remains blocked by 130 existing TypeScript errors and the missing frontend lint command.** This report does not claim a production deployment or unrestricted production readiness.

## Architecture findings and approach

| Existing behavior | Restore integration |
| --- | --- |
| `Client.status` and `Project.status` hold `ACTIVE`/`ARCHIVED`; `archived_at` and `archived_by_id` describe the current archive state. | Reuse those fields. Restore changes status to ACTIVE and clears current archive metadata. The previous archive timestamp/actor are retained in the restore audit payload. |
| Both lists already have Active, Archived and All filters, search, sort and pagination. Archived rows already open the existing details panels. | Keep those flows and add a visible Restore action for authorized users. Restore invalidates relevant adapter caches and refreshes lists/counters without a browser reload. |
| `get_current_admin` permits Owner/Admin/Manager. Project editing/archiving additionally requires an assigned active project-manager membership for a Manager. | Restore follows the same server policy. Regular users are rejected; frontend actions follow the matching role/membership checks. Owner/Admin retain their existing project scope. |
| Active projects require an active linked client and a project manager. | Project restore returns 409 until the linked client is active and at least one assigned manager is active. Assignments are preserved; restoration does not select replacement managers. |
| Active client names and GST values have tenant-scoped partial unique indexes; archived duplicates are permitted. | Restore checks for active conflicts and catches database uniqueness conflicts from simultaneous requests. It returns 409 without renaming or duplicating the client. |
| Archive writes an existing security `AuditEvent`. Neither entity details panel has its own archive activity timeline; task status timelines are separate. | Keep the existing ledger and append `client.restored`/`project.restored`; enrich new archive events with tenant and before/after state. Existing events and task timelines remain intact. |
| Client archive does not cascade into project/contact archive. | Client restore does not cascade. Project restore is a separate operation and validates the client at its own transaction boundary. |

## User-visible behavior

Open Projects or Clients, choose **Archived**, and select the record. Authorized users see a teal Restore button with a restore icon. The confirmation names the record and explains the preserved information. Cancel/Escape returns focus to the invoking button. Confirm disables controls and displays a loading state until the backend responds. Failures remain in the dialog for retry/cancel; success is shown only after the confirmed response.

Archived clients expose Restore in place of Archive/Edit, with linked contacts readable. Active client Edit/Archive remain available. Project Edit remains available to authorized managers on archived projects, allowing the existing assignment editor to repair a missing active manager before restoring. Archived project task-status override controls are hidden; existing backend workflow authorization remains authoritative.

After success, the original ID appears in Active and disappears from Archived. Search/status/sort state is retained; an emptied last page moves to the last valid page. Duplicate clicks are guarded. List responses are generation checked, and delayed task-dashboard responses cannot populate a different selected project. The latter race was reproduced in browser integration and fixed; [reproduction log](checks/dashboard-reproduction.txt).

A second reproduced race allowed an older list request to refill a cache after restore invalidated it, making a later All-filter visit show the old archive state. Client/project list caches now track invalidation generations and reject those old cache writes; [reproduction log](checks/cache-reproduction.txt). Both modules pass the delayed-request/restore/filter-revisit check.

No task status, completed subtask, dependency, assignment, contact, comment, attachment, paused timer, interval, note, report history, or other linked record is reactivated or rebuilt by restore.

## API and transactions

| Endpoint | Result |
| --- | --- |
| `POST /api/clients/{client_id}/restore` | Current `ClientRead`, HTTP 200. |
| `POST /api/projects/{project_id}/restore` | Current `ProjectRead`, including task count, HTTP 200. |

These follow the existing `/api` router convention and need no request body. Existing archive endpoints/contracts remain available. Standard authentication and tenant checks apply: 401 unauthenticated/revoked identity, 403 insufficient management access, 404 missing/cross-tenant record or hidden project, 409 conflicting client uniqueness or project dependency.

Already-active records return their current state without a restore event or metadata change. PostgreSQL locks the scoped entity row for the transaction. SQLite obtains its writer lock with a metadata-preserving no-op update. Archive and restore share this locking policy, making concurrent retries produce one transition event. The principal is revalidated after waiting for the lock; project membership authorization is then checked. A project restore also holds a shared lock on its current client while checking that it is active. Client archive/restore cannot change that row between the check and project commit.

State changes and the domain audit event share the same commit. Audit failures roll back the restore. A client uniqueness failure rolls back both state and event. New archive/restore events contain event type, entity type/ID, actor ID, tenant ID, server timestamp, previous state and new state. Existing archive reason handling is preserved.

The client row lock protects the restore dependency check, not a new global cascading policy: a later client archive remains allowed under the existing application's behavior. This enhancement does not change client archival policy or automatically archive/restore linked projects.

## Files changed

Production code:

- `backend/app/services/archive_state.py` — shared row locking, current-principal checks and transition audit payloads.
- `backend/app/services/clients.py` — restore and serialized archive, uniqueness conflicts.
- `backend/app/services/projects.py` — restore and serialized archive, client/manager dependency checks.
- `backend/app/routers/clients.py`, `backend/app/routers/projects.py` — authenticated restore endpoints.
- `frontend/services/mockApi.ts` — API adapter methods and cache invalidation.
- `frontend/pages/Clients.tsx`, `frontend/pages/Projects.tsx` — actions, feedback, filtering/pagination refresh and stale-response guards.
- `frontend/components/RestoreConfirmation.tsx`, `RestoreConfirmation.css` — shared accessible confirmation, loading/error states, responsive dark/light styles and reduced motion.

Verification/documentation:

- `backend/tests/test_archive_restore.py` — SQLite/PostgreSQL API, RBAC, concurrency, conflict, rollback and preservation tests.
- `frontend/e2e/archiveRestoreFixture.tsx`, `archive-restore.mjs` — actual pages, adapter and dialog integration with mocked HTTP.
- `ops/testing/archive_restore_runtime.py` — real rebuilt Linux API/PostgreSQL smoke, isolated schema only.
- This report and `checks/` evidence, including [results.json](checks/results.json).

Prior timer refinement edits and unrelated workspace changes were preserved. No staging, commit, reset, restore, broad cleanup or unrelated feature rewrite was performed.

## Verification evidence

| Check | Result |
| --- | --- |
| Client/contact/project/task-dashboard/security regression suite | **PASS: 81 tests, 1 SQLite skip**, 106.03 seconds; [backend-regression.txt](checks/backend-regression.txt). |
| Restore plus existing Active Work and task lifecycle integrity matrix | **PASS: 99 tests, 2 engine-specific skips**, 312.14 seconds; [backend-integrity.txt](checks/backend-integrity.txt). This overlaps the feature cases in the regression suite above. |
| Frontend Node suite | **PASS: 85 tests**; [frontend-tests.txt](checks/frontend-tests.txt). |
| Restore browser integration | **PASS: 19 scenarios**, zero browser exceptions; [browser.json](checks/browser.json), [browser-run.txt](checks/browser-run.txt). |
| Rebuilt Linux backend against isolated PostgreSQL | **PASS:** six concurrent client restores and six concurrent project restores, original IDs, two transition events per entity (archive then restore), auth/tenant denial and preserved stopped time entry/completed subtask; [linux-runtime.txt](checks/linux-runtime.txt). |
| Production frontend build | **PASS: 24.11 seconds**; [build.txt](checks/build.txt). Existing minification annotation/large-chunk warnings remain. |
| TypeScript (`npx tsc --noEmit`) | **FAIL: 130 existing errors**; [typescript.txt](checks/typescript.txt). No diagnostics in the changed pages or new dialog. Existing adapter diagnostics occur outside the added methods. |
| Frontend lint (`npm run lint`) | **UNAVAILABLE:** no lint script/configuration; [lint.txt](checks/lint.txt). |
| Scoped whitespace/diff check | **PASS**; existing Git LF/CRLF notices are not lint results. |

The new feature tests cover preservation of entity metadata plus complete row snapshots for project memberships, tasks, subtasks, dependencies, comments, time entries, contacts/contact links, completion attachments and lifecycle history/coverage. Fixtures contain linked contacts, task/subtask/dependency/comment rows and a paused interval. The attachment table is included in snapshots, but binary attachment storage/provider delivery is not exercised by these tests.

For each entity and transition, six barrier-synchronized archive/restore requests return the same ID/state with one event. Two archived clients competing for the same active name produce one success and one 409, with one active record/event, on both database engines. The PostgreSQL-specific held-client-lock test verifies a project restore waits for a concurrent archive and then rejects the archived dependency. Its SQLite skip is explicit; SQLite transition races and preservation still run.

Browser coverage includes discovery/confirmation/cancel/loading, restore/filter/search refresh, existing Edit and Archive, 403/404/409/503 feedback, transport disconnect, no premature success, ordinary-user action hiding, unassigned-manager action hiding, last-page pagination, stale lists/dashboard responses, 320px dialog fit, Escape/focus restoration and reduced motion. The page fixture uses minimal shell styles; [client](checks/client-mobile.png) and [project](checks/project-mobile.png) captures validate the new dialog, not a full physical-device application audit. The fixture clears its synthetic persisted caches between role scenarios. Backend tests and Linux smoke verify real authorization; mocked browser responses do not certify the server.

## Deployment and rollback

1. Review only the feature paths listed above alongside any separately approved release work. Record previous backend/frontend image digests and take the normal database backup. No schema change or data backfill is required.
2. Build matching backend/frontend images from the reviewed source. Do not deploy unrelated dirty changes accidentally. The running application images were not replaced during this task.
3. Resolve the repository TypeScript failures and establish a passing lint command before claiming full production certification. Run the feature and regression checks against the release candidate.
4. Deploy through the existing application release procedure. Validate authenticated restore routes in the deployed OpenAPI, the correct running image, tenant/RBAC denial, archived filters, client-before-project dependency, repeated/concurrent requests, unchanged linked IDs/time logs and visible Active counts.
5. Roll back by redeploying the prior compatible backend/frontend image pair. Retain all existing entity rows and audit history. No migration downgrade is needed. Records restored before rollback remain ACTIVE; if a business reversal is required, use the existing authorized Archive action, preserving its new audit event. Do not delete or recreate restored records.

## Reproduction and remaining risks

All test DB URLs below are disposable. Do not substitute the application's DB or reuse a project name owned by another active test run.

```powershell
docker compose -p zeaplay-restore-tests -f ops/testing/compose.realtime.yml up -d --wait postgres redis
$env:VEE_BOOTSTRAP_SCHEMA='false'
$restoreScratchDb=Join-Path $env:TEMP ('restore-tests-'+[guid]::NewGuid().ToString('N')+'.db')
$env:VEE_DATABASE_URL='sqlite:///'+$restoreScratchDb.Replace([char]92,[char]47)
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
$env:ZEAPLAY_WORK_TEST_REDIS_URL='redis://127.0.0.1:56379/15'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_archive_restore.py backend/tests/test_clients_phase2.py backend/tests/test_contacts_phase3.py backend/tests/test_projects_phase4.py backend/tests/test_tasks_phase5.py backend/tests/test_tasks_phase11.py backend/tests/test_security_phase13.py -q -r s
# From frontend: npm test; npx tsc --noEmit; npm run lint; npm run build
# Browser harness: start a loopback Vite on 6302 with both VITE_API_URL and
# VITE_API_BASE_URL=/api, then set ZEAPLAY_PLAYWRIGHT_MODULE to an existing
# @playwright/test/index.mjs and run node frontend/e2e/archive-restore.mjs.
docker compose -p zeaplay-restore-tests -f ops/testing/compose.realtime.yml down
```

The Linux smoke mounts only `ops/testing/archive_restore_runtime.py` read-only into the rebuilt backend image on `zeaplay-restore-tests_default`, passing the explicit scratch PostgreSQL URL and `VEE_BOOTSTRAP_SCHEMA=false`. It asserts the database name contains `rt3_test`, owns a random schema, and drops that schema in `finally`.

No production proxy/VPS deployment, physical-device/screen-reader/cross-browser certification, or sustained load benchmark was performed. Existing list cache freshness/realtime behavior outside the current module remains unchanged; restore invalidates the relevant current-browser adapter cache and refetches its lists. Recovery of historical records already hard-deleted is outside archive restoration. Existing inactive manager assignments or duplicate active client names/GST must be resolved by an authorized manager before restoring; this feature does not silently repair business data.

Disposable test services and the loopback test server are stopped at the end of verification. The existing application Compose services and data are preserved.
