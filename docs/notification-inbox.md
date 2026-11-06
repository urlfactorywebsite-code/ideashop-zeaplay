# Notification inbox controls - 2026-11-06

Implemented in the existing Header notification popup, shared by desktop and
mobile. Existing fantasy styling, notification icons, unread badge, notification
details and destination navigation are retained.

## User controls

- The filter icon opens search, read/unread and category filters. Categories use
  the existing notification modules, including ticket workflow exceptions; unknown
  historical types remain visible under All/Other. Reset filters restores history.
- **Mark all as read** uses the existing authenticated `/notifications/read-all`
  endpoint. It covers the entire inbox, including filtered-out notifications.
  Notifications arriving after that server transaction stay unread.
- **Select** enables checkboxes. Ctrl+click or Cmd+click on a notification also
  starts selection without opening it or marking it read. While selecting,
  ordinary clicks toggle selection; **Done selecting** restores normal opening.
- Select all shown, clear selection and **Delete selected** support up to 500
  explicit notifications at a time. Larger lists label the action Select first
  500. Bulk deletion requires an inline confirmation with Cancel focused first.
  The existing individual trash action remains available.
- Filter/account changes clear selection; read/live updates prune items no longer
  shown. A frozen confirmation cannot silently include newly arriving items.
  Empty inbox, no filter matches, working state and mutation failures are visible.
- Escape dismisses confirmation, then filters, then the inbox. Focus returns to
  a usable action or the bell. Mobile uses a viewport-positioned portal so the
  popup and scrollable controls fit narrow and short screens.

## API and data safety

New authenticated `POST /api/notifications/bulk-delete` accepts:

```json
{"notification_ids": ["notification-id-1", "notification-id-2"]}
```

The response contains `deleted_ids`. Requests require 1-500 bounded explicit IDs;
unknown attributes are rejected and duplicates are deduplicated. The server locks
selected records in stable ID order and requires **every ID** to belong to the
current user and actual workspace (or the existing personal legacy-null scope).
Missing, stale or unauthorized IDs reject the entire batch with the same 404;
no partial delete or cross-user/admin override is provided. Existing outbox
relationships retain their existing cascade behavior. Deletions and their
`AuditEvent` commit atomically; the existing audit-log queue is notified afterward.

No database migration or new stored field is needed. Existing list, read-all,
single-read and single-delete APIs remain compatible. The existing list response
is filtered on the client; this change does not replace its loading/polling/SSE
behavior. Local mutation versions reject old in-flight list responses, preventing
deleted notifications or old unread state from reappearing after a delayed GET.
Pending mutation callbacks cannot change another account's notification state.

## Affected files

- `backend/app/routers/notifications.py`, `backend/app/schemas.py`: bounded,
  authorized bulk deletion and request/response types.
- `frontend/components/NotificationInbox.tsx`: shared controls, selection,
  confirmation, accessibility and responsive panel.
- `frontend/components/Header.tsx`: integrate both responsive layouts and existing
  mark-all-read, navigation, icons and recipient-bound mutation updates.
- `frontend/hooks/useNotifications.ts`: reject stale reads after local mutations.
- `frontend/services/mockApi.ts`: bulk-delete API client; existing APIs retained.
- `frontend/utils/notificationFilters.ts`: module/category/search/read filters.
- `backend/tests/test_notification_inbox.py`,
  `frontend/test/notification-inbox.test.tsx`,
  `frontend/e2e/notificationInboxFixture.tsx`,
  `frontend/e2e/notification-inbox.playwright.js`: regression coverage.

## Verification

- PASS: **68 backend tests**, SQLite and isolated PostgreSQL, across
  `test_notification_inbox.py` and `test_notification_realtime.py`. Includes all
  four roles, tenant/user boundaries, bounded validation, legacy personal rows,
  all-or-nothing refusal, deduplication, audit retention, rollback and live stream
  compatibility. The final bulk-operation suite was rechecked: **28 passed**.
- PASS: **12 frontend tests**, `notification-inbox.test.tsx` and
  `notification-realtime.test.ts`; filter composition, every registered type,
  historical types, Unicode, escaped/long messages, named actions, empty state,
  stream/session handling and destination compatibility.
- PASS: **30 browser checks** using real Header, auth, notification hook and
  component with synthetic HTTP/SSE. Covers Ctrl/Cmd+click, checkbox keyboard
  input, filters, confirmation/cancel, selected-only deletion, failure/retry,
  stale GETs, post-read arrivals, account switching, ordinary navigation, and
  mobile actions at 390x844 and 390x420. No browser runtime exceptions. Synthetic
  requests deliberately block external images and the unrelated task socket.
- PASS: production Vite build. Existing chunk-size warnings remain.
- PASS: new Python test lint, unchanged baseline lint diagnostics in the edited
  router/schema files, and whitespace checks.
- Full TypeScript check remains FAIL on the **116 pre-existing diagnostics**;
  normalized diagnostic comparison finds no added or removed issues.

Ignored evidence and synthetic screenshots are under `.tmp/notification-inbox-*`.
No production notification data was read or deleted during these tests; the
backend databases and browser accounts are isolated fixtures.

## Deployment

Source implementation and local verification are complete. Existing local/VPS
application containers have not been rebuilt/recreated for this feature. Rebuild
and recreate **both backend and frontend** through the installation's existing
deployment procedure, retaining its environment and verified storage overrides.
Pulling Git alone does not activate the new route/UI. No status-schema repair or
database migration is required for this notification change.
