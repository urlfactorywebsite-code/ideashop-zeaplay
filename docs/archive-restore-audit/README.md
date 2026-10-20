# Archive and Restore regression audit — 2026-10-20

The existing modules were audited and refined. **Both project and client restore now have passing browser-to-API-to-PostgreSQL evidence**, including Owner and assigned Manager journeys. The existing feature was retained; four production files were refined, with no schema migration or new archive state.

**Production-ready: NO.** The feature's local critical checks pass, but repository-wide TypeScript still reports 130 diagnostics and frontend linting is not configured. No production/VPS release was performed. This work did not migrate application data or restart application services. Verification used separate scratch databases, containers and loopback ports.

## Defects found and fixed

| Defect | Verified behavior and fix |
| --- | --- |
| Cached manager membership could authorize an edit after the manager was revoked. | Update and membership-replacement services reused previously loaded project membership. Both now lock/reload the project, refresh the principal and enforce current project visibility/management permissions. SQLite and PostgreSQL cached-revocation tests now reject with 403. |
| Project create/update could accept a client archived while the database write waited. | Previously client validation was an unlocked read; the later FK write could wait and then commit after client archive. Active-client validation now holds a PostgreSQL shared row lock. SQLite explicitly acquires its writer lock because it ignores `FOR SHARE`. Tests cover both archive-winning validation and a later archive waiting until project creation commits. A later client archive remains permitted under the existing non-cascading policy. |
| A principal demoted while waiting on the client dependency could still create, edit or restore a project. | Fresh authorization is now checked after the dependency lock for all three operations. Three held-lock PostgreSQL tests prove the demoted request gets 403 instead of committing. Existing credential/account checks remain in the shared principal validator. |
| Archive/restore audit timestamps were shifted by the PostgreSQL session timezone. | A naive UTC Python timestamp was interpreted as local database-session time. Asia/Kolkata tests reproduced a 19,800-second error for both entities and actions. Transition events now assign an aware UTC timestamp. Historical entries are not rewritten. |
| Contacts from an archived client could appear under the next selected client. | The archive handler fetched the old client's contacts after list refresh had selected another record, overriding the selection-scoped effect. Removed this redundant unscoped fetch. Delayed-response component integration and the real API journey now show only the next client's contacts. |
| The accessible confirmation description omitted the selected record's name. | The name was visible but outside the node referenced by `aria-describedby`. It is now included in the shared dialog description for both entities. Tests inspect the actual ARIA relationship; the real browser also checks tab containment and Escape focus restoration. |

Before-fix evidence: [backend](checks/backend-reproduction.txt), [dependency-wait authorization](checks/role-wait-reproduction.txt), [SQLite creation race](checks/sqlite-create-reproduction.txt), [contact association](checks/browser-reproduction.txt), and [accessible description](checks/a11y-reproduction.txt). These are intentionally failing reproductions, not final verification results.

The stale client-name/normalization check passed before changes, so client update logic was retained. No duplicate timer ledger, cascading restore, role redesign, historical rewrite or module rebuild was introduced.

## Audit coverage

| Requested area | Evidence |
| --- | --- |
| Restore visibility and Active/Archived/All | Real Owner/Manager restore controls, ordinary-user action hiding; component coverage of all filters, search, sorting inputs and pagination. |
| Create/update/archive/restore transitions | Existing client/project suites plus new client-lock and current-permission checks. Existing Edit/Archive browser flows still pass after restore. |
| Repeated and simultaneous restore | Repeated real HTTP restores create no further events. Six simultaneous transitions per entity/action are covered on SQLite/PostgreSQL; rebuilt Linux API smoke also runs six concurrent client and six concurrent project restores. |
| Authorization/tenant isolation | Real unauthenticated 401, regular-user 403 and foreign-tenant 404; assigned Manager success; cached membership revocation and demotion during real dependency waits. Existing manager permission matrix and tenant/BOLA suites remain in the broad run. |
| IDs, metadata and relationships | Exact before/after business-row snapshots retain original client/project IDs, company/GST/address/notes, memberships, tasks, subtasks, dependency edges, contacts and links. |
| Timers, work logs, attachments, comments and history | Real snapshot includes a paused interval, comment, completion submission, nonempty attachment, four lifecycle events and coverage. All rows remain equal; the synthetic attachment file checksum is unchanged. Restore does not activate the completed or waiting subtask or resume the paused interval. |
| Archived linked client and no cascade | Actual project restore returns 409 while the client is archived. After client restore, the project remains ARCHIVED until its separate restore. |
| Dashboard/list counts | Actual restored dashboard: 1 task, 2 subtasks, 1 completed subtask, 45 tracked seconds and 0 active timers. Active/Archived counts and filtered last-page clamping are covered without browser reload. |
| Audit integrity | Archive then restore events retain actor, tenant, before/after state and timestamps. Repeats add no event. Audit failure/uniqueness conflict rollbacks retain archive state and prior history. UTC tests use a non-UTC PostgreSQL session. |
| Loading/confirmation/errors/success | Real named confirmation, real 409 and confirmed success; component tests cover loading/duplicate clicks, cancel, 403/404/409/503 and transport failure without premature success. |
| Accessibility/mobile | Selected name is programmatically described; keyboard tab containment, Escape/focus recovery, reduced motion; visible panel bounds at 320px and actual styled Owner/Manager flows at 390px. |
| Transaction safety | Per-project row locking, shared client validation lock and refreshed authorization across waits; SQLite writer fallback; existing unique active-client constraints, audit and state in one transaction. |

The existing client archive policy can archive a client linked to an already-active project. This audit preserves that policy. It ensures an operation does not validate an active client, wait for its archive, and then newly activate/reassign/create a project against that archived client. It does not silently cascade changes to existing projects.

## Validation results

Exact final counts and source hashes are in [results.json](checks/results.json).

| Check | Result |
| --- | --- |
| Focused new backend regression matrix | **PASS: 19 passed, 9 SQLite skips** before adding the final cross-engine creation-order test; [backend-refinement-final.txt](checks/backend-refinement-final.txt). Final broad run includes that test as well. |
| Final broad backend suite | **PASS: 151 passed, 11 engine-specific skips**, 223.44 seconds; [backend-final.txt](checks/backend-final.txt). Includes archive/restore, client/contact/project management, task editing/timers/dashboard, security and execution reports. |
| Frontend Node tests | **PASS: 85**; [frontend-tests.txt](checks/frontend-tests.txt). |
| Component/browser regression | **PASS: 20 scenarios**, no browser exceptions; [browser.json](checks/browser.json), [browser-run.txt](checks/browser-run.txt). HTTP responses are mocked for controlled failures and races. |
| Real browser end to end | **PASS: 7 scenarios**, no API mocking; [live-browser.json](checks/live-browser.json), [live-browser-run.txt](checks/live-browser-run.txt). Actual pages/adapter/authentication, Vite proxy, rebuilt Linux API and isolated PostgreSQL. |
| Rebuilt Linux concurrent API smoke | **PASS:** 6 concurrent restores per entity, one restore event per entity, auth/tenant/integrity checks; [linux-runtime.txt](checks/linux-runtime.txt). |
| Production frontend build | **PASS: 13.30 seconds**; [build.txt](checks/build.txt). Existing minification/large-chunk warnings remain. |
| Type checking | **FAIL: 130 diagnostics outside the changed production UI**; [typescript.txt](checks/typescript.txt). The previous implementation also reported 130. |
| Frontend lint | **UNAVAILABLE:** `npm run lint` reports a missing script; [lint.txt](checks/lint.txt). No lint pass is claimed. |
| Scoped diff/whitespace review | **PASS**; existing Git line-ending notices remain. |

The real-browser fixture uses seeded signed sessions through the genuine authentication dependencies; it does not test the password-login UI. It mounts the actual client/project pages and confirmation component and uses the application's Tailwind runtime. Only the fixture HTML and local stylesheet runtime are supplied by the harness; API requests continue through the real proxy. The synthetic API lives only in `ops/testing`, is explicitly mounted into a disposable container and is not added to the application entry point.

The live data set contains 2 clients, 1 project, 2 project memberships, 2 contacts/links, 1 task, 2 subtasks, 1 dependency, 1 comment, 1 time entry, 1 completion submission/attachment, 4 lifecycle events and 1 coverage row. [Before](checks/live-before.json) and [after Owner restore](checks/live-after-owner.json) snapshots preserve all business rows; only current entity update metadata and new audit events differ as expected. Manager journeys repeat both restores on mobile and recheck preservation in the harness.

Snapshots and tokens are synthetic. Credential material is kept in a caller-owned temporary mount and removed on test-server shutdown; it is not included in the report. Desktop and mobile evidence: [restored project](checks/live-project-desktop.png), [client confirmation](checks/live-client-mobile.png).

Initial live-harness attempts exposed fixture issues rather than product defects: the synthetic `.test` email domain was rejected by the real `EmailStr` validator, and a visibility assertion targeted the zero-height semantic dialog wrapper rather than its fixed visible panel. The fixture now uses valid synthetic example.com addresses and inspects the actual panel. Passing evidence uses the corrected harness.

## Files modified by this audit

Production:

- `backend/app/services/projects.py` — serialize current management checks, lock client validation on PostgreSQL/SQLite, recheck principal after dependency waits.
- `backend/app/services/archive_state.py` — aware UTC domain audit timestamps.
- `frontend/pages/Clients.tsx` — remove stale old-client contact fetch after archive.
- `frontend/components/RestoreConfirmation.tsx` — selected entity in accessible description.

Verification/documentation:

- `backend/tests/test_archive_restore_audit.py` (new).
- `frontend/e2e/archive-restore.mjs` — output override, contact race and actual panel/accessible-description checks.
- `frontend/e2e/archiveRestoreFixture.tsx` — authenticated fixture guard.
- `frontend/e2e/archive-restore-live.mjs` (new real API harness).
- `ops/testing/archive_restore_e2e_server.py` (new disposable seeded server).
- This audit directory and a link in the original feature report.

The pre-audit snapshot and checksums are recorded in `checks/baseline.json`; the audit-only diff is [refinement.patch](checks/refinement.patch). Earlier implementation and timer work, including unrelated dirty files, were preserved. No files were staged or committed.

## Remaining risks and release gates

1. Repository-wide TypeScript errors and missing lint configuration still block full production certification. Passing Vite build and end-to-end restoration do not remove those gates.
2. No VPS/proxy deployment, sustained load benchmark, physical-device, Safari/Firefox or screen-reader certification was performed. Automated Chrome keyboard and viewport checks are distinct from those results.
3. Previously written audit events under a non-UTC database session may require review against independent evidence. No historical timestamps were guessed or rewritten.
4. Attachment rows and a real synthetic file's bytes were preserved. Upload/download authorization and external object-storage provider behavior were not exercised by this audit.
5. Existing cache freshness/realtime behavior across other browsers and hard-delete retention policy remain unchanged. Restore recovers archived records, not previously deleted records.
6. Row locks are transaction scoped. Different project writes sharing a client can hold compatible PostgreSQL read locks; client archive waits. SQLite serializes writers at database level. Production lock latency and large-list volume need deployment-specific measurements.

## Deployment and rollback

No migration, backfill, new status or index is required. Review only the four production paths above for this refinement, preserving separately approved feature changes and unrelated work. Record known-good image digests and use the normal database backup/restore procedure.

Build matching backend/frontend images from the reviewed source. Resolve type/lint gates and run this audit against the release candidate. In staging, verify both restore journeys, 401/403/404 denial, repeated/concurrent requests, linked-client 409, create/update under an archive race, manager revocation during a lock wait, and audit times with a non-UTC session. Confirm IDs, assignments, time entries and attachment checksums remain unchanged and the dashboard counts agree with the retained records.

Deploy through the existing release process; verify the running image and live OpenAPI routes before accepting deployment proof. The local test server on 6315 is a disposable fixture and must not be deployed as the application.

Rollback this refinement by redeploying the prior compatible backend/frontend image pair or reversing only the four production files' audit hunks against the captured pre-audit snapshot. Do not restore whole files from HEAD: they also contain the earlier working feature. Keep all entity and audit rows; no schema downgrade is needed. Existing restored records remain ACTIVE. A business reversal uses the authorized Archive action and appends its event. Rollback reintroduces the fixed authorization/race/timestamp issues, so prefer a forward fix when possible.

## Reproduction

Use `ops/testing/compose.realtime.yml` with a dedicated project name and explicit `zeaplay_rt3_test` PostgreSQL URL. Windows uses a disposable file-based global SQLite URL with `VEE_BOOTSTRAP_SCHEMA=false` to avoid the earlier Python 3.14 shared in-memory audit-worker issue. The broad test command and explicit scratch service setup are in [reproduce.ps1](reproduce.ps1).

For live UI verification, build the backend image, mount `archive_restore_e2e_server.py` read-only, attach to the disposable network, and bind host 6315 to container 6311. Supply the scratch PostgreSQL URL, isolated Redis URL, schema bootstrap disabled and a temporary `/audit` output mount. The server requires an `rt3_test` database, creates a random schema and drops it on graceful shutdown. Its ready file contains synthetic session material; pass its directory through `ZEAPLAY_RESTORE_RUNTIME` without printing the contents.

Run a separate Vite on loopback 6302 with `VITE_API_URL=/api`, `VITE_API_BASE_URL=/api` and `VITE_API_PROXY_TARGET=http://127.0.0.1:6315`. Point `ZEAPLAY_PLAYWRIGHT_MODULE` to an existing Playwright installation and run `node frontend/e2e/archive-restore-live.mjs`. The temporary mount also needs the Tailwind runtime already used by the application, saved as `tailwind.js`.

After verification, stop the synthetic API gracefully before removing PostgreSQL so its schema and credential file are removed. Stop only the audit project and owned Vite process. Application services and data are outside this cleanup scope; the local audit image may remain for review.

Cleanup completed: the scratch schema count was 0, the synthetic credential file was removed, the owned API/PostgreSQL/Redis containers were removed and Vite port 6302 was stopped. [Cleanup evidence](checks/cleanup.txt). The audit image remains available for review.
