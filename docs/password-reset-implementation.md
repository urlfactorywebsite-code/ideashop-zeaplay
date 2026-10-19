# Password Recovery Fix and Activation

Checked locally on 2026-10-19. Application containers, existing account passwords and the application database were **not** changed or redeployed. This supersedes the defects recorded in [the original audit](password-reset-check.md), not its historical test results. Local implementation validation is not proof of live mailbox delivery or VPS readiness.

## What Changed

- Forgot Password accepts the email-only request the existing UI sends, rather than requiring a login password. Failures are visible instead of being presented as successful delivery.
- Recovery uses the existing SMTP profiles, notification outbox, worker, Redis and audit services. There is no second mail worker or reset-token table.
- Purpose-specific, expiring recovery tokens include tenant and credential fingerprints. Tokens are encrypted in the pending outbox; plaintext reset URLs/passwords are not persisted in audit metadata. Successful or permanently unauthorized delivery removes the encrypted token.
- Redemption atomically compares the existing password hash and credential version before replacing them. Concurrent requests cannot consume the same credential state twice; audit and password-change notification writes share the transaction. A failed audit rolls back the password update.
- Administrative reset and the alternate user-update password field now reject foreign-tenant targets. Existing Owner/Admin/Manager role policy is retained, not replaced with a new role model.
- Password changes increment `users.credentials_version`. Existing access/refresh tokens default to version zero for unchanged users; stale HTTP credentials are rejected after a password change. Native chat/task/ticket WebSockets check the counter at handshake and their existing authorization rechecks. This is **not** immediate all-channel logout: Socket.IO presence/call/meeting connections are outside this change.
- New reset/change passwords must contain 8-72 Unicode characters and fit within bcrypt's 72 UTF-8 byte limit. Shared frontend validation matches the new-password API rules. Existing registration's six-character minimum is unchanged; a broader password-policy migration is not claimed.
- The public `/#/reset-password` screen keeps the token in component memory and removes it from the address bar. Refreshing that page requires reopening the email link. A second link opened in the same tab replaces the first target. No automatic login follows recovery.
- Scoped, bundled recovery styles work without the app's external CSS script; the modal has focus trapping/Escape support and a tested mobile layout.
- SMTP operations have a 15-second timeout and explicitly verify TLS certificates. Production recovery refuses unencrypted SMTP. Credential-email provider failures use generic audit messages, including providers that echo message content.

The design follows the [OWASP Forgot Password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) for account-enumeration responses, short-lived single-use credentials, rate limits and a configured trusted reset origin. No claim of a complete OWASP security assessment is made.

## API Contracts

| Endpoint | Request | Successful response | Failure behavior |
| --- | --- | --- | --- |
| `POST /api/auth/forgot-password` | `{"email":"person@example.com"}` | 202, same generic message for active, unknown and inactive accounts | 422 invalid input; 429 rate limit with Retry-After; 503 missing/unsafe configuration or Redis unavailable |
| `POST /api/auth/reset-password` | `{"token":"<email-link-token>","new_password":"<new-password>"}` | 204; no automatic session issuance | 400 expired/invalid/used link; 409 concurrent credential change; 422 password validation; 429/503 abuse-control failure |
| `POST /api/users/{id}/reset-password` | Existing `new_password` field | Existing 204 | Existing roles retained; foreign tenant now 404; stricter password validation 422 |
| `POST /api/users/me/change-password` | Existing `old_password`, `new_password` fields | Existing 204 | Existing old-password check retained; stricter validation; stale sessions require sign-in |
| `PATCH /api/users/{id}` | Existing optional `password` field | Existing user response | Same tenant boundary, password validation and credential counter as administrative reset |

Defaults: recovery lifetime 15 minutes (configurable 5-60); three requests per email and 100 per peer IP per 15 minutes; ten redemption attempts per token plus the IP limit. Redis keys HMAC identities instead of storing raw emails. These are fixed-window limits, not CAPTCHA, distributed denial-of-service protection or an account lockout. The 150ms response floor is not a constant-time guarantee under load.

Several outstanding links may exist for an unchanged account; successfully changing credentials invalidates all of them. No reset request itself invalidates the account's current password or changes XP.

## Configuration Needed to Activate

1. Use an approved frontend origin, with HTTPS in production. Set these in the **private backend environment**:

   ```dotenv
   # Replace the placeholder with the actual approved frontend origin, not the API host.
   VEE_PASSWORD_RESET_URL=<actual-https-frontend-origin>/#/reset-password
   VEE_PASSWORD_RESET_EXPIRE_MINUTES=15
   VEE_PASSWORD_RESET_REQUESTS_PER_EMAIL=3
   VEE_PASSWORD_RESET_REQUESTS_PER_IP=100
   VEE_BOOTSTRAP_SCHEMA=false
   ```

   Include that exact origin in `VEE_CORS_ALLOW_ORIGINS`. Use an existing strong `VEE_JWT_SECRET_KEY` of at least 32 characters. Secret rotation invalidates recovery links and encrypted pending mail as well as existing JWTs; do not rotate silently during this release. Never commit the private env file or paste real keys into reports.

   Production Compose already passes its private env file to the backend. Development Compose does **not** load `backend/.env` into the container: pass additional settings through an approved Compose override if needed. The development default reset URL is `http://localhost:6300/#/reset-password`, which must also be allowed by CORS. A dev Vite preview on port 6302 is not the default email-link destination.

2. Configure the existing SMTP infrastructure with the provider's real host, port, username/sender, app password and `tls` or `ssl` encryption. A valid certificate chain is required; install an approved CA for private SMTP rather than disabling verification. Existing self-signed/untrusted SMTP setups may now fail explicitly.

   Existing protected configuration APIs are `GET/PATCH /api/config/smtp`, or `GET/POST /api/config/smtp/multiple` and `PATCH /api/config/smtp/multiple/{config_id}`. A multi-profile setup can map `notification_types` to `welcome_password`; otherwise the primary profile is used. Use the existing authenticated API documentation/private admin client to supply credentials. There is no verified SMTP settings panel in the current Settings UI, so no menu path is promised. These existing infrastructure settings are global, not a new tenant-specific mail configuration system.

3. Redis must be reachable through the existing `VEE_CACHE_REDIS_URL` configuration. Recovery fails closed when abuse-control storage is unavailable. Check trusted-proxy forwarding configuration: limits use the ASGI peer IP, not an untrusted header parsed by recovery. Shared proxy/NAT addresses can hit the IP cap; measure before changing it.

4. Keep the existing notification outbox worker running. It starts in backend lifespan, polls approximately every 30 seconds and sends after transaction commit. Inspect existing outbox status/attempts/next-attempt/error fields without printing payloads. Delivery is at least once: an SMTP success followed by a process crash may resend a link, but cannot produce a second password mutation. Expired/deactivated/revoked links are cancelled, not sent.

## Migration and Deployment

New revision: `fe6f7a8b9c0d`; predecessor: `fd5e6f7a8b9c`.

The only schema addition is `users.credentials_version INTEGER NOT NULL DEFAULT 0`. Existing hashes, balances, reward claims and task history are not rewritten. No new indexes or business-data backfills are needed. Measure the user-table lock on an actual restored backup before production.

**Important for this checkout:** the earlier local database inspection found a bootstrap-managed schema without Alembic version metadata. Do not stamp it at head or blindly run the entire migration chain. Reconcile its actual schema and rehearse a reviewed adoption procedure first. The CLI tests below stamp only explicitly owned synthetic schemas.

Follow the backup, image retention, maintenance and media-adoption procedures in [the Journey deployment runbook](task-status-journey-production-review/runbook.md), sections 2-4. In particular, the existing backend container has not been proven to have persistent private media: preserve and verify its entire media directory before any recreation. A plain `docker compose up --build` is not a safe substitute for that procedure.

After approval, on the Linux release checkout with the runbook's private environment and verified `DC` Compose array already established:

```bash
# Build only; retain old images and verify media first. No automatic deployment was done here.
"${DC[@]}" build backend frontend
# Drain all writers as described in the runbook before migration.
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic current
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic heads
# STOP unless current is the verified fd predecessor (or fe is already applied).
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic upgrade fe6f7a8b9c0d
"${DC[@]}" run --rm --no-deps -e VEE_BOOTSTRAP_SCHEMA=false backend python -m alembic current
"${DC[@]}" up -d --no-build --no-deps backend
curl --fail --silent --show-error http://127.0.0.1:6311/health
curl --fail --silent --show-error http://127.0.0.1:6311/ready
"${DC[@]}" up -d --no-build --no-deps frontend
```

These are conditional deployment instructions, not executed commands. Keep existing proxy/media/image overrides and any separately managed workers; deploy compatible API workers together. Do not change worker counts, reset user records, seed the database or alter JWT secrets implicitly. After deployment use an explicitly authorized test account to verify actual email receipt, link expiry/replay, new login, old HTTP/refresh rejection and foreign-tenant denial through the approved HTTPS origin. Never log the link/password. Check delivery after waiting for the worker; accepted 202 means queued-if-eligible, not delivered.

## Verification Evidence

| Check | Result and scope |
| --- | --- |
| Auth, recovery, SMTP, workflow email, security and native-WebSocket regression suite | **101 passed, 2 skipped**, 118.20s; skips are SQLite variants of PostgreSQL-only CLI/backup tests, whose PostgreSQL variants passed. See `password-reset-backend-tests.txt` and JUnit XML; synthetic SQLite/PostgreSQL users, isolated Redis, mocked SMTP, no existing account changes |
| Real migration CLI and restoration | Owned PostgreSQL schema: fd-to-fe CLI upgrade retained IDs/hashes/points/timestamps; downgrade with revocations refused. Existing Journey pg_dump/pg_restore test also passed; it remains pinned to its original fd revision, not falsely relabeled as testing fe restoration |
| Password transaction failure | Two checks passed on SQLite/PostgreSQL: audit failure rolled back hash/version/outbox; original token remained usable |
| Two-process realtime regression | Five passed, three deselected: two independent FastAPI processes, shared isolated PostgreSQL/Redis; cross-worker fanout/tenant injection/targeted subscriber checks. Not Socket.IO/media-call validation |
| Frontend unit/contracts | `npm test`: 70 passed, zero skipped |
| Browser interactions | Eight passed, actual Chrome on loopback Vite; all API and external-provider traffic intercepted. Mobile screenshots in `password-reset-checks/`; no actual mail or password mutation |
| Frontend production build | `npm run build`: PASS. Existing Lottie eval warning and ~3.37MB main JS chunk warning remain |
| TypeScript | **FAIL**, exit 2: 131 diagnostics, identical normalized messages to `task-status-journey-production-review/checks/typescript.txt`; zero added/removed diagnostics. Full log `password-reset-typescript.txt` |
| Lint | No configured frontend lint script; no lint pass claimed |
| Linux production image / actual SMTP / VPS | NOT EXECUTED; local Python is Windows 3.14, production image uses Python 3.11 |

Reproduction, repository-root PowerShell, using disposable services only:

```powershell
docker compose -p zeaplay-journey-review -f ops/testing/compose.realtime.yml up -d postgres redis
$env:VEE_BOOTSTRAP_SCHEMA='false'
$env:VEE_DATABASE_URL='sqlite:///'+($env:TEMP -replace '\\','/')+'/zeaplay-recovery-global.db'
$env:ZEAPLAY_RT_POSTGRES_TEST_URL='postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
$env:ZEAPLAY_RT_REDIS_TEST_URL='redis://127.0.0.1:56379/15'
$env:ZEAPLAY_RT_BACKUP_CONTAINER='zeaplay-journey-review-postgres-1'
backend/venv/Scripts/python.exe -m pytest backend/tests/test_password_recovery.py backend/tests/test_generate_token.py backend/tests/test_tasks_phase10.py backend/tests/test_security_phase13.py backend/tests/test_realtime_refinement.py backend/tests/test_task_journey_migrations.py -q
# Stop only the isolated test project, after tests have finished.
docker compose -p zeaplay-journey-review -f ops/testing/compose.realtime.yml down
```

From `frontend`, run `npm test`, `npx tsc --noEmit --pretty false`, then `npm run build` separately, retaining each exit code. For the browser harness reuse a loopback Vite instance at 6302, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`, and run `node frontend/e2e/password-reset.mjs` from the root. No dependencies were added.

## Rollback and Remaining Risks

- Prefer a compatible forward fix. Keep the credential column and its values. The online downgrade refuses to drop it once any revocation exists; offline downgrade is deliberately unsupported. An empty, never-used migration can be downgraded to fd only after rehearsal and explicit approval.
- Rolling back to an old backend that ignores credential versions may revive previously revoked JWTs. Such a rollback is **not safe** without an independently verified session-invalidation plan. Frontend-only fallback can retain the hardened backend and schema.
- Do not restore a pre-reset database to the only production copy: doing so restores old passwords/session versions and discards subsequent business writes. Use isolated restore plus incident reconciliation, matching media and approved endpoint switching.
- Socket.IO presence/call/meeting token revocation is not integrated with this counter. Existing connections are not forcibly closed by a password change. Native WebSockets revalidate on their existing authorization paths rather than an instantaneous global disconnect broadcast.
- Broader user administration remains a separate security review: for example, the legacy user-delete lookup is still unscoped. The tenant guarantee here covers the password mutation paths, not every user-management endpoint. Legacy alternate token tooling has not been certified by this change.
- Existing global SMTP-management authorization, production TLS/proxy/Redis controls, mailbox deliverability, monitoring, password strength beyond the existing eight-character UI policy and full application E2E remain release prerequisites. No real-provider result, full-suite green status or production-readiness certification is claimed.

## Files Changed for This Fix

Backend: `app/auth.py`, `app/config.py`, `app/database.py`, `app/dependencies.py`, `app/email_utils.py`, `app/main.py`, `app/models.py`, `app/schemas.py`, `app/routers/auth.py`, `app/routers/users.py`, `app/services/notification_outbox.py`, new `app/services/password_recovery.py`, `app/ws/chat.py`, `app/ws/tasks.py`, `app/ws/ticket_chat.py`, and new `alembic/versions/fe6f7a8b9c0d_password_credentials_version.py` (all under `backend/`).

Frontend: `App.tsx`, `components/ForgotPasswordModal.tsx`, `components/ResetPasswordModal.tsx`, new `components/PasswordRecovery.css`, new `pages/PasswordReset.tsx`, `pages/Settings.tsx`, `services/mockApi.ts`, new `utils/passwordReset.ts` (all under `frontend/`).

Tests/config/docs: new `backend/tests/test_password_recovery.py`, credential cases in `backend/tests/test_realtime_refinement.py`, fd revision pinning in `backend/tests/test_task_journey_migrations.py`, new `frontend/test/password-reset.test.ts`, new `frontend/e2e/password-reset.mjs`, `.env.production.example`, the original audit's follow-up link, this report and generated password-reset test logs/JUnit/mobile screenshots. Existing unrelated dirty changes, including other Settings work and task Journey implementation, were preserved.
