# Sidebar Management production-readiness review

Reviewed locally on 2026-10-21. **No deployment, production migration, application-container rebuild, or production-data modification was performed.**

**Release gate: FAIL.** The critical Sidebar Management security checks pass, including safeguards around inherited global Settings operations. Repository-wide typecheck and integrated backend lint fail, and frontend lint is not configured. Passing Vite's production build does not replace those release gates.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| Frontend role lists and navigation visibility could become a second permission authority. | Immutable backend page and API-section ceilings drive the client. Existing resource authorization remains mandatory. Hidden-only changes presentation; disabling a module or removing a permitted role adds a server-side restriction. Default policies preserve independently authorized shared reads. |
| Nested API routes and case/encoded route aliases could escape parent checks. | Canonical path matching and guards protect the entire API subtree. Subsections intersect parent state with their independent backend ceilings. Ordinary users' own OAuth grants remain separately authorized. |
| Legacy singleton API/n8n configuration could be exposed to another tenant's administrators. | Installation configuration additionally requires the installation tenant. Tenant-owned SMTP/OAuth permissions retain their existing authorization. |
| Inherited global backup/import/reset and retention could affect other tenants. | A shared installation-data guard rejects these operations when any persisted tenant-aware table contains a foreign workspace. Rejection precedes serialization, mutation, OTP generation and outbound email. Single-tenant imports bind users to the authenticated tenant. |
| General audit/export/retry and reward logs could expose foreign records. | Tenant scope now precedes role-specific scope. Records lacking trusted attribution are hidden; a foreign actor cannot become visible by naming an own-tenant target. Foreign retries return 404. Unreachable duplicate audit code was removed. |
| Webhook configuration and delivery queries were insufficiently tenant scoped. | Ownership checks, listings, mutations, delivery logs and queued subscriptions use the authenticated/trusted tenant. Unattributed background events queue nothing; there is no installation-tenant fallback. |
| A manager could promote an account or reset a more privileged account's password. | A shared account-management guard now rejects creating, assigning or managing a role above the actor's authority. It is used by user creation, update, deletion, password reset and registration. |
| Legacy public registration accepted a caller-selected privileged role and derived tenant. | Registration now requires authorized staff, enforces the shared role ceiling and assigns the authenticated actor's tenant. Initial installation provisioning must use the existing trusted bootstrap/seed path. Token tests now seed trusted accounts in disposable databases rather than depending on public privileged signup. |
| Last-write-wins policy saves and unaudited changes could lose configuration. | Complete validated documents use tenant + revision compare-and-swap, including first-save conflicts. Stale writers receive 409. Audit and policy updates commit or roll back together. |
| Personal preference migration or account switching could lose or misapply layout. | Original account/tenant storage keys remain. Stable-ID migration is read-only until an explicit save, unknown preferences survive, and async results from a previous identity are discarded. |
| Unsaved browser Back navigation did not reliably retain the editor draft. | The application now uses the data router's blocker and a leave confirmation. Mouse, keyboard and real browser Back cancellation are covered. Hash URLs remain supported. |

Duplicated frontend role lists and duplicate sidebar presentation transformations were removed. Server metadata is the permission authority; desktop, mobile and Settings navigation use the same preference/visibility transformation. The test-only registry snapshots have an automated parity check against backend definitions.

## Critical requirement evidence

Tests cited below are in [test_navigation.py](../../backend/tests/test_navigation.py), unless another file is named. They run against disposable SQLite and PostgreSQL databases. Browser artifacts contain assertions and HTTP status evidence, never authentication tokens or account passwords.

| # | Requirement | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Visibility is separate from authorization | **PASS** | `test_hidden_only_remains_independently_authorized_and_disabled_parent_blocks_children`, `test_default_navigation_save_does_not_replace_independent_api_permissions`, `test_role_narrowing_is_enforced_by_api_not_just_navigation`. Hidden pages remain directly accessible only under independent permissions; policy checks never grant access. |
| 2 | OWNER/ADMIN respect existing permission architecture | **PASS** | `test_non_owner_cannot_modify_global_policy`, `test_sensitive_credentials_cannot_be_exposed_by_policy`, `test_account_mutations_cannot_escalate_navigation_authority`, registration regression. Only OWNER writes tenant access policy. ADMIN saves personal presentation and sees only authorized API subsections, including SMTP/OAuth rather than Owner-only credentials or webhooks. |
| 3 | USER/MANAGER cannot bypass routes or API permissions | **PASS** | Real-login browser checks for both roles in [SQLite](checks/real-sqlite.json) and [PostgreSQL](checks/real-postgresql.json); config, SMTP, n8n, webhook and OAuth management calls return 403. Direct root/nested API pages show Access forbidden before protected content loads. Anonymous and forged-role/tenant tests also reject access. |
| 4 | Nested tabs inherit parent state and retain independent restrictions | **PASS** | `test_nested_api_permissions_inherit_parent_state_without_becoming_grants`, `test_defaults_use_server_roles_and_restrict_nested_settings`, frontend unit tests and [Settings browser](checks/settings-browser.json). Parent hidden/disabled/forbidden states propagate; independent ceilings remain. |
| 5 | Authorized recovery administrators retain access | **PASS** | `test_protected_recovery_pages_cannot_be_restricted`, `test_profile_recovery_remains_available_when_users_module_disabled`, browser protected-control assertions. Dashboard, Settings, Profile and Sidebar Management cannot be hidden, disabled or narrowed below their immutable recovery roles. Own profile/password/avatar recovery remains independently authorized. Master Control stays removed. |
| 6 | Tenant configuration cannot leak or affect another tenant | **PASS** | `test_owner_policy_persists_across_sessions_and_is_tenant_scoped`, `test_navigation_audit_reads_do_not_cross_tenants`, `test_legacy_installation_configuration_is_not_exposed_to_other_tenant_owners`, `test_webhook_management_and_delivery_queue_are_tenant_scoped`, `test_unattributed_webhook_event_cannot_leak_to_installation_tenant`. Caller-supplied tenant fields are rejected; foreign records are 404/403 as appropriate. `test_legacy_global_data_and_retention_fail_closed_in_multitenant_settings` and `test_general_audit_exports_retries_and_reward_logs_cannot_cross_tenants` additionally cover inherited global operations and general logs. |
| 7 | Concurrent updates cannot silently overwrite | **PASS** | `test_stale_save_is_409_and_never_overwrites_newer_policy`, concurrent initial and existing revision writer tests on both databases; [editor browser](checks/sidebar-browser.json) confirms conflict display, retained draft and explicit discard/reload. Exactly one writer wins each competing revision. |
| 8 | Existing personal preferences survive migration | **PASS** | [Editor browser](checks/sidebar-browser.json) verifies old key migration without writes, labels/order, obsolete entries, refresh and account switching. [Unit tests](checks/frontend-unit.txt) include pure migration and route mapping checks. |
| 9 | Global settings survive logout/refresh/browser changes | **PASS** | [Real-session browsers](checks/real-postgresql.json) exercise logout/login, actual HttpOnly refresh and a fresh browser context against the same isolated backend. Tenant policy persists server-side; personal labels/order intentionally retain their prior browser-local scope. |
| 10 | Changes do not delete/reset/expose application data | **PASS** | `test_disabled_tasks_reject_real_api_calls_and_preserve_records`, `test_audit_failure_rolls_back_policy`, additive migration round trip with task retention, foreign webhook and installation-credential rejection. Policy writes touch the policy row and audit record; they do not delete module records. Inherited legacy global operations are rejected before entering their handlers in multi-tenant databases. Single-tenant backup/import retains its positive test, with imported identities bound to the authenticated tenant. No live email, webhook, push or support delivery was sent by these checks. |
| 11 | Active-session updates are authenticated and tenant scoped | **PASS** | [Real-session browser](checks/real-postgresql.json) waits for polling in a second active session without synthetic focus. Updates use authenticated, non-cached `/navigation` reads on navigation/focus and every 15 seconds while visible. No new unauthenticated configuration socket exists. Task socket handshake, live-message and tenant fanout tests verify policy rechecks; chat/ticket sockets use the same restrictive service. |
| 12 | Reset Defaults cannot bypass safeguards | **PASS** | [Editor browser](checks/sidebar-browser.json) verifies staged reset, explicit save and retained role ceilings. Reset submits the same validated, revision-checked policy PUT as normal saves; non-owner writes, protected-page tampering, unknown/duplicate IDs and role broadening remain rejected. ADMIN resets only personal layout. |

The SPA serves an HTML shell, so a denied frontend hash route is an accessible **Access forbidden** screen rather than an HTTP 403 document. Its underlying protected API requests return HTTP 403. This is intentional and covered by the browser checks.

## Requested real-login scenario

[navigation-security.mjs](../../frontend/e2e/navigation-security.mjs) runs with the actual login form, signed sessions, navigation editor, backend policy persistence and backend configuration/OAuth endpoints. Only unrelated dashboard/layout data and outbound transports are synthetic. The harness is [test_navigation_browser.py](../../backend/tests/test_navigation_browser.py).

| Action | Expected and observed |
| --- | --- |
| OWNER enables Settings and API, selecting OWNER + ADMIN, then saves | Settings is already enabled and system protected. A real authenticated policy PUT enables API and persists exactly those two roles. |
| OWNER logs in | API tab visible; OAuth management 200. |
| ADMIN logs in | API tab visible; authorized OAuth management 200. Owner-only API sections remain denied. |
| MANAGER logs in | No API tab; root/nested API routes denied; configuration endpoints 403. |
| USER logs in and directly opens `/settings/api` | No API tab; Access forbidden; protected configuration endpoints 403. |
| OWNER disables API | API navigation disappears for every role; even OWNER/ADMIN receive 403 from disabled management endpoints. Recovery Settings remains available. |
| OWNER re-enables API | Only OWNER/ADMIN regain visibility and independently permitted operations. USER/MANAGER remain denied. |
| Refresh/logout/fresh browser | Persisted policy and role restrictions survive. |

Both real-session reports contain **15 passing assertion groups**, including authenticated polling and no application console/page errors. Editor coverage has **20 passing groups**; Settings navigation has **22 passing groups**. These are browser assertion groups, not additional pytest test counts.

## Validation gates

See [validation.json](checks/validation.json) for exact final counts, commands, scope and statuses. Relevant backend suites, frontend unit tests, browser integration, migration round trip, Python compilation and production build were executed locally. PostgreSQL tests used a uniquely named `rt3_test_...` database, with per-test schemas and cleanup. Existing application databases/volumes were not migrated or reset.

- **FAIL: TypeScript.** Existing repository diagnostics remain outside the new navigation modules. [Current diagnostics](checks/typecheck.txt), [comparison](checks/typecheck-comparison.json). Typecheck must pass before a production release. The comparison excludes source coordinates so moved lines do not masquerade as new errors.
- **PASS: new backend module lint.** The new policy/registry/router/migration/test files pass the globally installed Ruff tool. [Core lint](checks/ruff-core.json). FastAPI dependency defaults have narrow documented B008 exclusions; unused imports, fixture aliases and style findings were cleaned up.
- **FAIL: integrated backend lint / frontend lint.** Ruff reports remaining findings in the reviewed shared backend files. [Integrated lint](checks/ruff-integrated.json). `npm run lint` reports a missing frontend script. [Command output](checks/lint.txt). Python compilation and `git diff --check` pass but do not substitute for lint.
- **PASS: production build.** [Vite build](checks/production-build.txt). Existing bundle-size/eval warnings are retained in the log.
- **Not certified:** deployment, production reverse proxy, live tenant data, production migration execution, external provider delivery or other concurrently edited avatar/profile features. The additive navigation migration itself is tested independently on both databases; a single current Alembic head is confirmed offline.

### Legacy Settings safeguards and operational limits

The separate [full-backend audit](../backend-audit-2026-10-21/README.md) identified unsafe global backup/export/reset and audit-log behavior. This review confirmed the source and added a bounded safeguard: these legacy global operations require the installation workspace and a database containing no other tenant's persisted records. The guard checks all present tenant-aware model tables, including foreign configuration left after members are deleted. It executes before export, import, OTP generation, reset confirmation or global retention configuration/application. Imports bind new users to the authenticated tenant rather than an employer-supplied tenant.

`test_legacy_global_data_and_retention_fail_closed_in_multitenant_settings` verifies rejection through both API aliases before entering the global session, sending email or initializing retention configuration. `test_single_tenant_export_and_import_retain_staff_permission_and_bound_tenant` verifies a positive backup/import flow on an isolated database. `test_legacy_global_guard_detects_foreign_configuration_without_members` covers orphaned tenant configuration. `test_general_audit_exports_retries_and_reward_logs_cannot_cross_tenants` covers lists, JSON export, retries, unattributed records, forged target attribution and reward logs. Audit records with no trusted tenant attribution are hidden rather than exposed to every Owner.

**Operational limitation:** web backup/import/reset and global retention are intentionally unavailable in multi-tenant installations. Use reviewed host-level administration until those legacy services have tenant-aware implementations. This is a security restriction, not certification of a new tenant backup/restore design. Existing physical/legacy database backups and concurrent host-level tenant provisioning require operator coordination; no destructive global reset was executed by this review. The historical full-backend audit is not otherwise superseded or certified by this module review.

## Reproduction and release boundary

From the repository root in PowerShell, with the existing dependencies installed:

```powershell
$env:VEE_BOOTSTRAP_SCHEMA='false'
# Optional: explicitly point to a disposable PostgreSQL database whose name contains rt3_test.
# Without it PostgreSQL cases skip; never substitute a production URL.
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='<isolated-test-database-url>'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_navigation.py backend/tests/test_generate_token.py backend/tests/test_security_phase13.py -q
backend/venv/Scripts/python.exe -m pytest backend/tests/test_oauth2_server.py backend/tests/test_password_recovery.py backend/tests/test_push_management.py -q -k sqlite
```

In `frontend`, run `npm test`, `node node_modules/typescript/bin/tsc --noEmit --pretty false`, `npm run lint`, and `npm run build`. Browser drivers require an explicitly supplied installed Playwright module, a disposable loopback Vite URL and cached Tailwind runtime; their environment variables and interception boundaries are declared at the top of each driver. The real-session pytest harness additionally requires `ZEAPLAY_NAVIGATION_FRONTEND_URL`, `ZEAPLAY_PLAYWRIGHT_MODULE`, `ZEAPLAY_TAILWIND_JS`, and optionally `ZEAPLAY_NAVIGATION_BROWSER_OUTPUT`.

For a future authorized release, review and apply the additive navigation migration before enabling the new backend. Missing policy storage fails closed with 503 and readiness reflects the missing table. Do not use runtime auto-creation or blind Alembic stamping. Review the repository's current migration head, including concurrent changes, separately. No deployment command was executed as part of this review.

## Source inventory

[source-inventory.json](checks/source-inventory.json) lists the reviewed implementation/test paths and their SHA-256 fingerprints at handoff. Shared files also contain other pre-existing/concurrent changes; they were not reset or broadly staged. The central implementation is:

- Backend: `app/navigation_registry.py`, `services/navigation.py`, `routers/navigation.py`, `models.NavigationPolicy`, migration `ffd3a4b5c6d7`; integration through authenticated dependencies, config/n8n/logs/support/users/auth/webhooks, global-data safety, legacy data-admin and reward-log reads and existing task/chat/ticket sockets.
- Frontend: `hooks/useNavigation.tsx`, `utils/navigationPreferences.ts`, `pages/SidebarManagement.tsx`, existing `SidebarEditor.tsx`, `NavigationGuard.tsx`, Settings/API/OAuth routes, desktop/mobile navigation and related module affordances.
- Tests: backend navigation/security/browser and trusted token fixtures; frontend migration/Settings unit tests and sidebar/Settings/real-session/push browser drivers.
