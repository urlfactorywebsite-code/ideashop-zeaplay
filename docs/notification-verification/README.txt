Notification and subtask verification - 20 October 2026

Result: implemented and running locally at http://localhost:6300.

Behavior
--------
The bell receives authenticated live invalidations through /notifications/stream.
The server checks committed, recipient-scoped history every second. Reconnection,
heartbeat recovery, token expiration, credential rotation, account switching and
polling fallback are covered. Read/delete actions synchronize across open clients.

Task notifications cover the creator, parent/subtask assignees, followers and
authorized project managers as appropriate to the event, excluding the actor.
Project events reach current members and active tenant admins/owners.
Client events reach active tenant owners/admins/managers, matching the UI route.
User/department events reach tenant management roles; users also receive their
own account updates. Ticket events use actual ticket access. Comments and mentions
cannot copy private task content to unrelated users. Chat, approvals, SLA,
achievements and rewards retain their existing event flows and shared delivery.
Category preferences mute browser push while keeping in-app history.

Subtasks without dependency edges hand off in displayed order. With explicit
dependencies, the next subtask becomes ready only when its predecessors are done.
The next assignee sees a message such as:
  Alice completed 'Design'. You can start 'Build' now.
Approval handoffs identify the submitting worker; direct completion identifies
the actor. All children DONE completes the parent. Reopening a child reopens the
parent. Existing parent approval requirements remain in effect, and repeated
completion/reopening does not award duplicate completion XP.

The API rejects unauthorized child updates and parent edits by observers.
Frontend edit, assignment and review controls use server-returned permissions.
Notification links handle subtask focus, projects, clients, administrative pages,
chat bridges and deleted records.

Verification
------------
PASS - final Linux notification suite: 151 passed, 3 SQLite-only skips.
  linux-notification-regressions.txt
  Includes SQLite/PostgreSQL permissions, push preferences and deduplication,
  rollback-safe automation, live HTTP streaming for all four roles, and additive
  enum migration/legacy compatibility.

PASS after targeted recheck - Linux subtask/lifecycle suite:
  Initial broad run: 153 passed, 4 failed, 5 skipped.
  All four failures were corrected test fixtures/obsolete expectations:
  required project missing, previously valid notification history counted as new,
  and an old single-child test expecting no parent completion XP.
  Corrected four cases: 4 passed; application code did not change for this recheck.
  linux-subtask-regressions.txt and linux-subtask-targeted-recheck.txt
  Skips: three PostgreSQL-only behaviors on SQLite, two optional Redis cases.

PASS - final frontend suite: 118 passed, 0 failed.
  frontend-final-tests.txt
PASS - final Docker backend/frontend builds and nginx configuration.
  docker-final-build.txt
PASS - actual browser checks for user, manager, admin and owner.
  frontend-browser.json
  Browser harness uses synthetic APIs/SSE; it verifies live unread updates,
  correct subtask focus, completion evidence dialog, parent/child refresh,
  exact permissions and account isolation. Zero page errors.
PASS - real HTTP SSE checks against temporary servers with SQLite/PostgreSQL.
  http-stream-tests.txt (also included in the final Linux notification suite).
PASS - running frontend HTTP 200, documented stream and capability fields,
  unauthenticated stream HTTP 401 through nginx.
  local-runtime.json
PASS - running backend source matches tested workspace files.
  runtime-source-check.json
PASS - scoped whitespace checks.

Local database audit
--------------------
Read-only aggregate checks found:
  0 subtask completed/status flag mismatches.
  0 open parents with every child DONE.
  0 completed parents with unfinished children.
A backup was saved to before-notification-fix.bak (ignored by Git).
Only six additive notification enum labels were applied to the existing legacy
database; no business-data backfill was needed. The isolated test database was
removed after verifying it had no remaining connections.

Limits
------
Whole-project TypeScript checking still fails with pre-existing legacy errors;
the production Vite build and final frontend tests pass. Existing dependency
deprecation/bundle warnings remain.
One broad Windows Python run hit a native runtime access violation; final backend
verification used Linux containers instead.
External push-provider/desktop popup display and SMTP inbox delivery were not
tested. No provider test messages were sent. Production/VPS deployment was not
performed.

Concurrent unrelated edits to the production environment example, deployment
documentation and time-entry proxy registration/tests were preserved.
