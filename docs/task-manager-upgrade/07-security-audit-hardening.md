# Phase 13 Security and Audit Hardening

## Status

PHASE 13 COMPLETE locally. The phase stayed within security/audit hardening and did not redesign authentication, change role semantics, or begin Phase 14.

## Permission Matrix

| Area | Read | Mutate | Object/Tenant Boundary |
| --- | --- | --- | --- |
| Clients | Authenticated users in the tenant. | Owner, Admin, Manager. | Every lookup filters by `tenant_id`; archive is soft-only. |
| Contacts | Authenticated users in the tenant. | Owner, Admin, Manager. | Contact/client links require both records in the same tenant; shared contacts are not deleted by unlinking. |
| Projects | Owner/Admin see tenant projects; Managers/Members see scoped projects per membership policy. | Owner/Admin, and authorized project Managers for projects they manage. | Project client and member IDs must belong to the project tenant; duplicate membership and final-manager removal are rejected. |
| Tasks | Tenant-scoped task queries with project/member visibility filters where applicable. | Existing task permissions plus project membership checks for project-linked work. | Project assignment, assignees, subtasks and dependencies are validated against tenant/project scope. |
| Subtasks | Visible through authorized parent task/project access; WAITING subtasks are visible to assignees. | Assigned users may act within workflow rules; Owner/Admin/authorized Managers may override where allowed. | Dependencies must remain within the same parent task; cycle and cross-tenant/task attacks are rejected. |
| Timers | User can read own active timer and authorized task/subtask totals. | User can start/stop authorized work; corrections require Owner/Admin/Manager authorization. | One active timer per user is enforced with database constraints and transaction checks. |
| Completion Evidence | Authorized task/subtask participants and reviewers. | Assigned actionable users submit; authorized reviewers approve/reject. | Files are stored privately with opaque keys; download checks tenant, task access and attachment access. |
| Notifications | Recipient-scoped tenant notifications. | Recipient can mark own notifications read/delete; Owner/Admin can inspect outbox visibility where exposed. | Notification and outbox reads filter by tenant and recipient. |
| Media Library | Users read their own media; tenant Owner/Admin read tenant media; Managers follow existing department/user scoping. | Upload/confirm/delete follows owner and tenant boundaries; storage provider status requires Owner/Admin. | Media items/files are scoped through their owning user's tenant. |
| Rewards/XP | Existing tenant/user reward and gamification policy. | Existing reward admin/claim flows. | Phase 13 did not alter XP, reward claim, or refund rules. |

## Audit Event Catalog

Append-only `audit_events` rows now cover the critical Phase 2-13 business operations below. Payloads are redacted for password, token, secret, credential, cookie, API key, access key, private key, hashed password and VAPID-style keys.

| Event | Source | Notes |
| --- | --- | --- |
| `client.created`, `client.updated`, `client.archived` | Client service | Tenant-scoped lifecycle audit. |
| `contact.created`, `contact.updated`, `contact.archived` | Contact service | Contact identity lifecycle audit. |
| `contact.client_link.added`, `contact.client_link.updated`, `contact.client_link.removed` | Contact service | Client/contact junction history without deleting shared contacts. |
| `project.created`, `project.updated`, `project.members_replaced`, `project.archived` | Project service | Includes manager/member counts, not sensitive member metadata. |
| `task.created`, `task.updated`, `task.completed`, `task.approval`, `task.deleted` | Task router | Existing task lifecycle audit preserved. |
| `task.status_overridden` | Project dashboard service | Records manual parent-task override reason presence and confirms no XP award. |
| `subtask.reassigned` | Task router | Records previous and new assignee IDs for both task patch and subtask patch paths. |
| `SUBTASK_ACTIVATED`, `SUBTASK_FORCE_STARTED`, transition events, `SUBTASK_DOWNSTREAM_REVIEW_REQUIRED` | Workflow service | Durable workflow history and Phase 10 notification event preparation. |
| Completion submission approval/rejection history | Completion submission tables and task routes | Immutable evidence attempts and review decisions are preserved. |
| `time_entry.corrected` | Time tracking service | Records correction audit with original values preserved. |
| `notifications.read_all`, `notifications.read`, `notifications.deleted` | Notification router | Recipient-scoped notification actions. |
| `user.created`, `user.updated`, `user.deleted` | User router | Existing user lifecycle audit. |
| `SECURITY_*` / `PERMISSION_DENIED` style AuditLog rows | Security middleware/logger | 401/403/429 and app audit logging are redacted before persistence/queueing. |
| Reward log actions | Rewards service | Existing claim, approval, rejection/refund and reward lifecycle log behavior preserved. |

## Security Controls Verified

- Tenant isolation is enforced by JWT tenant validation in dependencies and service-level `tenant_id` filters at read/write boundaries.
- Project-level object authorization handles multiple managers and rejects unauthorized manager/member mutation.
- Legacy projectless tasks are now explicitly scoped through the creator's tenant in direct task access, task list filters and task-group reads.
- Media library item/file access is tenant-scoped through the owning user, including Owner/Admin views and MinIO-backed file delete/confirm/list paths.
- Storage provider status checks require authentication and Owner/Admin privileges.
- Notification bulk-read audit payloads now record only notifications actually marked for the authenticated recipient.
- Cross-tenant timer stop/resume attempts return not found instead of confirming another tenant's timer entry exists.
- Global request body size checks reject oversized requests before route processing.
- Security headers are applied to normal and middleware-generated responses: `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`.
- Completion evidence upload limits remain enforced: 10 MB per file, fixed safe file-count and aggregate-size defaults, private storage keys, filename sanitization, MIME/signature checks where feasible, and authorized download.
- Media presign rate limiting uses Redis when configured and an in-process fallback otherwise.
- SQL access in the reviewed Phase 2-13 paths uses SQLAlchemy query builders and typed enum parsing rather than interpolating user input into raw SQL.
- Email notification delivery remains outside workflow transactions through the durable outbox; provider failures do not roll back committed workflow state.
- Production MinIO credentials no longer have hardcoded defaults; production examples now require explicit object-storage, push and request-size values.

## Deployment Secrets and Least Privilege

Production environments must set strong values for:

- `VEE_JWT_SECRET_KEY`, `VEE_JWT_REFRESH_SECRET_KEY` and matching `PRESENCE_JWT_SECRET`.
- `VEE_DATABASE_URL` with an application database user scoped to the app database.
- `VEE_REDIS_URL`, `VEE_CACHE_REDIS_URL` and `VEE_MEDIA_PRESIGN_RATE_REDIS_URL`.
- `VEE_MINIO_ENDPOINT`, `VEE_MINIO_ACCESS_KEY`, `VEE_MINIO_SECRET_KEY`, attachment buckets and public base URL.
- SMTP credentials stored through existing configuration surfaces.
- `VEE_VAPID_PUBLIC_KEY`, `VEE_VAPID_PRIVATE_KEY`, `VEE_VAPID_SUBJECT` if push is enabled.
- `VEE_CORS_ALLOW_ORIGINS` narrowed to the deployed frontend and API hosts.
- `VEE_MAX_REQUEST_BODY_MB` sized for legitimate upload paths and upstream proxy limits.

Object storage credentials should be limited to the configured attachment buckets. Redis credentials should be environment-specific. Database migrations should run with an explicitly selected environment so local tests never target production data.

## Security Test Report

| Check | Result |
| --- | --- |
| Python compile for touched backend services, router and tests | PASS |
| Phase 2-4 plus Phase 13 regression slice | PASS: 23 passed |
| Phase 6-12 plus Phase 13 backend regression slice | PASS: 74 passed |
| Phase 2-13 adversarial/widened backend regression slice | PASS: 105 passed |
| Frontend unit/contract tests | PASS: 25 passed |
| Security headers and request-size middleware | PASS |
| Sensitive audit metadata redaction | PASS |
| Multiple-manager project permission matrix | PASS |
| Cross-tenant project/client access denial | PASS |
| Legacy task IDOR/BOLA and task-group tenant leak attempts | PASS |
| Media tenant isolation and provider-status protection | PASS |
| Timer impersonation and cross-tenant existence hiding | PASS |
| Notification IDOR and bulk-read audit narrowing | PASS |
| Unauthorized project membership mutation denial | PASS |
| Append-only lifecycle audit events | PASS |
| XP/reward regression slice | PASS via Phase 12 tests in the widened run |

Warnings observed are pre-existing deprecations around `datetime.utcnow`, FastAPI `on_event`, Starlette HTTP constants/TestClient behavior, Pydantic class-based config, and one SQLAlchemy mapped-attribute warning on `Level.created_by`.

## Unresolved Risk Assessment

| Risk | Status | Recommendation |
| --- | --- | --- |
| CORS defaults remain broad for compatibility and development. | Open | Keep production `VEE_CORS_ALLOW_ORIGINS` explicit and environment-specific. |
| Legacy `/uploads` static mount can expose files intentionally stored as public media. | Open | Keep sensitive evidence on the private completion-evidence path only; review legacy public media before storing confidential client files there. |
| In-process rate-limit fallback is per process. | Open | Configure Redis-backed rate limiting in production. |
| `AuditLog` queue is asynchronous/best-effort, while `AuditEvent` is transaction-local. | Accepted | Use `audit_events` for critical business history; monitor queue failures for operational logs. |
| Startup still includes broad `Base.metadata.create_all` behavior. | Open | Keep Alembic as the production migration authority and avoid relying on startup DDL in controlled environments. |
| CSRF protections are not redesigned. | Accepted | Current API remains bearer-token based; revisit if cookie-based sessions are introduced. |
| Some historical tables derive tenant scope through related users/projects instead of storing tenant IDs directly, including legacy `tasks`, `media_items`, and `media_files`. | Open | Keep the app-layer tenant predicates in place; consider additive tenant columns/composite FKs in a future migration once historical backfill is planned. |
| `tasks.project_id` remains a nullable single-column FK for historical compatibility. | Open | Continue service-level tenant validation; consider a future additive tenant-aware constraint after a safe backfill strategy. |
| Deprecation warnings are noisy. | Open | Schedule a maintenance pass for timezone-aware datetimes, FastAPI lifespan, Starlette constants and Pydantic v2 config. |
