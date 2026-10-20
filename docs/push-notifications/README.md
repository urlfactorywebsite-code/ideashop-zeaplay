# Push notifications: Settings management and system audit

Audit date: 2026-10-20. Workspace: `F:\Projects\ideashop-zeaplay-v5`.

The existing push pipeline has been reviewed from notification creation through browser display and click handling. Settings now has a separate **Push notifications** tab at `/#/settings?tab=push`, available to every authenticated role.

The updated local backend and frontend are running. Open [Settings → Push notifications](http://localhost:6300/#/settings?tab=push), sign in, and reload an existing tab to activate the updated worker. This is a verified local implementation, **not production certification**: repository type checking/linting and actual provider-to-OS display remain release limitations.

## Using the tab

- **Enable this browser** requests permission and registers this browser to the signed-in account. **Reconnect this browser** repairs registration after configuration changes. Permission, account registration and server readiness are displayed separately.
- **Disable this browser** stops its subscription. Signing out also clears the browser's account binding and attempts server revocation before invalidating the session.
- **Alert categories** manages Tasks, Tickets, Chat, Comments, Users and Departments across the account's registered devices. Individual changes update only that category. Enable all and Mute all are explicit batch actions. In-app history is retained.
- **Your registered devices** shows the account's devices, registration/activity times and the current browser. Send a test to a selected device, disable one device, or confirm disabling all devices.
- **Refresh status** reconciles browser permission, server registration and preferences. Visible Settings tabs also refresh on focus, shared-tab changes and periodically for device state.
- Owners and administrators can expand **Server configuration status** to see readiness flags. Signing keys are not displayed or edited by the browser.

A test accepted by a push service is reported as **accepted**, with instructions to check the target device. It does not certify that the OS displayed a notification. Last activity means registration or provider acceptance, not a delivery receipt.

Browser subscription requires a secure context and explicit user interaction. The implementation follows the [PushManager subscription guidance](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) and the [service worker notification API](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

## Defects addressed

| Finding | Change |
| --- | --- |
| Subscribe could transfer another account's endpoint; unsubscribe could revoke it. | Atomic subscription upsert retains ownership. Foreign ownership conflicts return 409. Revoke operations are scoped to the authenticated account. |
| Concurrent registration and preference updates could create duplicates or fail inconsistently. | Database conflict handling uses existing unique constraints, with independent-connection SQLite/PostgreSQL race tests. |
| Arbitrary endpoints could turn push delivery into server-side requests. | HTTPS provider host validation, valid P-256/auth keys, outbound legacy-record revalidation, disabled redirects and bounded network timeouts. |
| Public-key presence did not establish working configuration. | Status checks verify the public/private pair and subject without disclosing secrets or generating replacement keys. |
| Chat preferences were omitted from defaults; UI writes could overwrite other categories. | All six categories are returned, and the UI serializes saves and sends only the changed category. |
| Browser subscription alone was reported as enabled for the current account. | SHA-256 endpoint matching against authenticated device metadata and worker account acknowledgement establish current-account state. |
| Logout/account changes could expose notifications belonging to another user. | Persisted worker user/tenant binding, recipient-stamped payloads, stale-token guards, cross-tab session reconciliation and logout cleanup. No credentials are stored in the worker binding. |
| An originating tab could pair its stale authenticated user with a newly stored token. | Push writes and binding require a token recognized by the current Auth provider. The real API browser test proves stale-tab actions cannot rebind or mutate the new account. |
| A passive signed-out tab could unsubscribe the shared browser before the initiating tab revoked its server record. | Passive tabs clear only the worker binding. The initiating logout captures/revokes the endpoint before unsubscribing. The real API test confirms revocation while other devices remain registered. |
| Push could be sent before a transaction committed. | Per-session pending sends are delivered after outer commit and connection release, using a fresh session. Rollback, closed uncommitted sessions and savepoint rollback discard pending work. |
| Department alerts could cross tenant boundaries. | Active administrator selection is tenant-scoped; dispatcher also checks recipient, actor and relevant entity ownership. Existing explicitly authorized cross-tenant chat membership is preserved. |
| Chat mentions could generate duplicate alerts and bypass conversation mute. | One mention alert per intended recipient, with mute checks. |
| Ticket-overdue alerts could follow the Tasks preference. | Ticket entities use the Tickets category. |
| Malformed payloads and unsafe URLs could break notification handling or navigate away. | Typed payload handling, same-origin URL restrictions, stable notification tags and awaited click navigation. |
| Push URLs did not match the application's hash routes. | Canonical hash routes and authorized fresh task/ticket loading support notification clicks. |
| Provider acceptance was called delivery. | API/UI distinguish attempted, accepted, failed and expired registrations; ordinary users can test their own devices. |

## Verification and evidence

The final result manifest, source checksums and exact counts are recorded in [checks/results.json](checks/results.json). These runs overlap; counts below must not be added together as unique tests.

| Check | Result |
| --- | --- |
| Backend management, configuration, security and concurrency, SQLite + PostgreSQL | **95 passed**, no skips |
| Dispatcher, chat and workflow/history regression run | **103 passed**, no skips |
| Final dispatcher, notification schema and security run | **98 passed**, 2 SQLite-only enum checks skipped; PostgreSQL counterparts passed |
| Complete frontend Node suite | **110 passed**, no skips, including 14 worker-handler and 13 browser-lifecycle tests |
| Settings browser UI, keyboard and 320/390/768/1440px layouts | **14 scenario groups passed**, no page errors |
| Settings with real authentication/API/PostgreSQL | **10 scenario groups passed**, 54 recorded requests, no page errors |
| Actual Chrome service-worker activation, binding and native notification calls | **7 scenario groups passed**; physical display unverified |
| Task/ticket notification click regression UI | **5 scenario groups passed**, no page errors |
| Production Vite build and backend/frontend Docker builds | **Passed**; existing large-bundle warning remains |
| TypeScript | **Failed: 130 diagnostics**, identical to the prior archive audit after normalizing line/column locations |
| Frontend lint | **Unavailable**: no `lint` script |
| Whitespace check | **Passed** |
| Local deployment smoke checks | Backend/frontend/worker **200**; new routes present; protected push routes **401** without authentication; served worker exactly matches source |

Concurrency coverage uses separate database connections: eight simultaneous same-owner registrations retain one subscription ID; eight contested registrations from two owners produce exactly one owner, four successes and four ownership conflicts; eight concurrent preference writes retain one row per user/category. Transaction tests cover outer rollback/commit, savepoints, session close and fresh-session delivery. These are correctness checks, not sustained-load benchmarks.

- `checks/backend-management.txt`: isolated API, authorization, configuration, validation and concurrent-registration/preferences tests on SQLite and PostgreSQL.
- `checks/push-dispatch-regression.txt`: dispatcher, real transaction/savepoint behavior, tenant boundaries, category preferences, chat and existing workflow/history regression tests.
- `checks/browser-lifecycle-tests.txt`: browser lifecycle, stale-account guards, logout ordering/failure handling, key rotation and endpoint matching.
- `checks/frontend-tests.txt`: complete frontend Node suite, including actual service-worker handler tests.
- `checks/ui-browser.json`: real Settings/Auth/HashRouter/service worker with controlled API/PushManager responses for failure, concurrency, permissions, keyboard and responsive checks.
- `checks/worker-browser.json`: actual Chrome worker activation, MessageChannel binding, CDP push-event delivery and native `showNotification` calls.
- `checks/live-browser.json`: real Settings/auth/push/preferences APIs and PostgreSQL, with a transparent test proxy and synthetic browser/provider transport.
- `checks/live-app-readonly-status.json`: non-secret configuration and live-route inventory of the local application before deployment.
- `checks/typescript-comparison.json`: exact normalized comparison against the pre-existing 130 diagnostics.
- `checks/local-api-verification.json`, `checks/local-ui-verification.json`, `checks/local-after-images.txt`: deployed local routes, assets and image IDs.
- `checks/cleanup.json`, `checks/vite-cleanup.json`: removal of the disposable API, schemas, credential file, PostgreSQL/Redis project and Vite server.
- `checks/typescript.txt`, `checks/lint.txt`, `checks/build.txt`: repository checks and their exact results.

The disposable browser API is explicitly mounted from `ops/testing/push_e2e_server.py`; the normal application never imports it. Its PostgreSQL schema and signed synthetic sessions are isolated. Only its provider transport is replaced with a synthetic 201 response. This exercises actual authentication, authorization, routes, validation, SQL persistence and response handling without contacting another user's device.

Chrome's native `showNotification` promise resolved in the browser harness. Windows headless Chrome nevertheless returned an empty notification registry. OS toast visibility, sound, focus-assist behavior, physical-device delivery, and actual OS notification clicks are not certified by that result. VM tests separately exercise displayed-notification cleanup and click routing.

## Security and data boundaries

Device lists expose only ID, endpoint hash, label, user agent and registration/activity times. Subscription endpoints, authentication keys and private VAPID material are not returned. Diagnostics and failure logs exclude provider response bodies, endpoints and credentials.

The backend stamps the actual recipient user and tenant for every subscription, overriding caller-supplied fields. The worker rejects absent/mismatched binding, malformed messages and unsupported navigation. A shared browser therefore needs a fresh account binding before receiving private content.

Users manage their own subscriptions and preferences. This feature does not add workspace-wide broadcast or administrative access to other users' subscriptions. Configuration flags are readable to authenticated users; the detailed panel is shown to administrators/owners.

Existing subscription IDs and unique constraints are retained. No schema migration, table reset, new push ledger or changes to task/timer/archive history are required.

The existing unique endpoint and user/category constraints provide atomic conflict handling; no new indexes were required for these changes. Subscriber inventory is scoped by user and active status. Push network work happens after the business transaction releases its connection. Browser polling is limited to visible device state, with event/focus reconciliation; category saves update only changed fields.

## Files modified

The following source files belong to this task. Some were committed by another workspace actor during the audit, so the final manifest records content hashes rather than treating current `git diff` as the complete inventory. This audit did not stage, commit, reset or revert workspace changes.

| Area | Files |
| --- | --- |
| Push API and subscription security | `backend/app/routers/push.py`, `backend/app/routers/notification_preferences.py`, `backend/app/services/push_service.py`, `backend/app/services/push_security.py`, `backend/app/schemas.py` |
| Dispatch, transaction and recipient fixes | `backend/app/services/notification_dispatcher.py`, `backend/app/services/notifications.py`, `backend/app/services/subtask_notifications.py`, `backend/app/routers/departments.py`, `backend/app/chat/services.py` |
| Settings and browser lifecycle | `frontend/pages/Settings.tsx`, `frontend/components/SettingsNotificationsPanel.tsx`, `frontend/hooks/usePushNotifications.ts`, `frontend/hooks/useAuth.tsx`, `frontend/services/pushBrowser.ts`, `frontend/types/push.ts`, `frontend/public/sw.js`, `frontend/services/mockApi.ts` |
| Notification click targets | `frontend/components/Layout.tsx`, `frontend/components/TaskDetailModal.tsx`, `frontend/pages/TicketPage.tsx`, `frontend/components/Tickets/TicketDetailDrawer.tsx`, `frontend/hooks/useTickets.ts` |
| Automated backend/frontend tests | `backend/tests/test_push_management.py`, `backend/tests/test_push_dispatch.py`, `frontend/test/service-worker-push.test.js`, `frontend/test/push-browser.test.ts` |
| Browser harnesses and isolated API | `frontend/e2e/push-worker.mjs`, `frontend/e2e/push-settings.mjs`, `frontend/e2e/pushSettingsFixture.tsx`, `frontend/e2e/push-settings-live.mjs`, `frontend/e2e/pushLiveFixture.tsx`, `frontend/e2e/push-links.mjs`, `frontend/e2e/pushLinksFixture.tsx`, `ops/testing/push_e2e_server.py` |
| Report and evidence | `docs/push-notifications/README.md` and `docs/push-notifications/checks/` |

## Remaining limitations

1. Web Push is best effort. It has no durable retry queue, provider delivery history or browser receipt ledger. The existing notification outbox handles email. A process crash after commit can lose queued push, while the in-app notification remains.
2. Provider requests run synchronously after the business transaction releases its connection, with connect/read timeouts. A large recipient/device fan-out can still lengthen request latency. No sustained-load certification was performed.
3. Rewards/achievements remain history-only. Existing group-chat policy notifies mentions; direct messages notify unmuted participants. Category settings do not create new notification producers.
4. Known Google, Mozilla, Apple and Microsoft push providers are allowed. Custom provider deployments require an explicit allowlist review. There is no dedicated self-test rate limit or per-account device cap.
5. Browser permission, OS notification settings, network availability, expired subscriptions and VAPID rotation can affect delivery. No Safari/Firefox or physical mobile-device certification was performed.
6. Repository-wide TypeScript diagnostics and the missing frontend lint command remain separate release checks; final counts appear in the manifest.

## Deployment

Keep one stable VAPID key pair and a valid contact subject in the server environment (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, or the existing `VEE_` equivalents). Changing the pair requires browsers to reconnect. Do not generate a new key pair on every restart.

Deploy the backend and any notification-producing workers before, or together with, the frontend and service worker. The new worker deliberately rejects old payloads without recipient account fields. Reload authenticated pages so the worker update and account binding complete. Verify the live OpenAPI includes `/api/push/status` and `/api/push/subscriptions`.

Build/recreate through the existing Compose/release process. No database migration is needed for this feature. Check Settings as an ordinary user as well as an administrator, including enabling, targeted testing, category mute, remote-device removal, shared-browser account switch and logout. Verify a visible notification on each supported production browser/OS separately.

The local deployment used:

```powershell
docker compose build backend frontend
docker compose up -d --no-deps --no-build backend
# Verify backend /health and new OpenAPI paths before updating the worker.
docker compose up -d --no-deps --no-build frontend
```

All five application services were running after deployment. PostgreSQL, Redis and presence were not recreated. No test notification was sent to an existing application's device. The synthetic verification services have been stopped and their credentials/schema removed.

## Rollback

Redeploy the previously recorded compatible backend and frontend images together, including notification-producing workers. Do not combine the old un-stamped sender with the new strict worker. Service-worker updates require an authenticated page reload; do not delete unrelated service workers or site data.

Keep subscription, preference and notification rows. No schema rollback is necessary. Restoring old code reintroduces the ownership, transaction and navigation defects, so a forward fix is preferable. Reverse only reviewed feature changes; unrelated timer, archive and sidebar work is outside this rollback.

For this local deployment, the prior images are recorded in `checks/local-before-images.txt`. While those images are retained, the following commands restore the pair without rebuilding source or resetting data:

```powershell
docker image tag sha256:db9c49a137efb5204aa87e32a75b64efd49a016024c6c01750352f33972970e4 ideashop-zeaplay-v5-backend:latest
docker image tag sha256:ca179150042ab1433495810d103496c086019b4862c330845f17ed946c85a49e ideashop-zeaplay-v5-frontend:latest
docker compose up -d --no-deps --no-build backend frontend
```

These rollback commands were documented, not executed. Check health and reload browsers afterward. Production rollback must use its own previously recorded image pair and release configuration.

## Reproduction

Use a dedicated `zeaplay-push-audit` Compose project with `ops/testing/compose.realtime.yml`. Set bootstrap off and explicitly point tests at scratch SQLite/PostgreSQL/Redis. The PostgreSQL database must be named `zeaplay_rt3_test`; tests use random schemas. Never substitute the application's database.

Use `npm.cmd test`, `npx.cmd tsc --noEmit`, `npm.cmd run lint` and `npm.cmd run build` from `frontend` on Windows. Browser harnesses accept `ZEAPLAY_PLAYWRIGHT_MODULE` pointing to an existing Playwright installation and `ZEAPLAY_PUSH_TEST_URL` pointing to an owned loopback Vite server.

The Settings harness requires the application's existing Tailwind runtime saved as `checks/tailwind-test-runtime.js` (or set `ZEAPLAY_TAILWIND_RUNTIME`). The live harness reads `checks/runtime-location.json` and a caller-owned temporary `ready.json`; never print or publish that ready file. Stop the synthetic API gracefully before removing its database so its schema and credential file are removed.
