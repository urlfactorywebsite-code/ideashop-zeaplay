# Phase 2: Animated Task Status Journey

Implemented 2026-10-19 in the existing React/Vite application. This is a read-only
extension of Task Details, not a new status editor, workflow engine or timer model.
No backend/schema, XP, approval or reward behavior changed in this phase.

Current verification and refinements: [independent Phase 2 review](review.md).
The Validation table below records the original implementation baseline; the
review has the final 64-test / 26-browser-scenario evidence and remaining limits.

## UI And Contracts

- Task Details has a Journey button beside its existing metadata. The popup is
  lazy-loaded and uses the installed Headless UI dialog and Lucide icons.
- Header: current title, ID, creator, assignees, stored creation timestamp and
  server journey status. Missing authorized user names fall back to their IDs.
- Connected roadmap includes all 11 TaskStatus values. Six core stages and five
  alternate stages are visual groupings, not mandatory transitions or new rules.
  Checkmarks mean a recorded departure from that stage, not inferred completion.
  Reopened work can therefore show DONE as previously visited and another active
  stage. SubtaskStatus retains its separate six-value vocabulary.
- Capture-order transition records keep every repeated status and backward move,
  exact timestamp precision, actor, recorded reason and individual stage duration.
  No missing actor, reason, date or pre-capture stage is guessed. Phase 1's frozen
  trigger normally stores no status-change reason; these display Not recorded.
  Existing workflow/approval reasons are not heuristically matched to trigger rows.
- Each subtask has its own expandable roadmap, transitions, assignee, recorded
  active-stage/completion dates, retained-session start/stop dates and work total.
  Deleted children encountered in history remain identifiable by ID. Their missing
  current title/assignee/time aggregate is not reconstructed.
- Timer histories include retained/corrected intervals, original correction dates,
  continuation identity and an immutable-event ledger for start/pause/resume/stop/
  restart/correction/deletion. Closed views do not render the session ledger;
  expanded views render 25 loaded rows at a time.
- Four summary metrics: direct task person-time; child person-time; lifetime since
  stored creation to server-derived now; and duration of the latest known current
  status visit. Combined person-time unions parent and child intervals per user;
  work elapsed unions all users. Direct and child totals must not simply be added
  when legacy overlaps exist. Different users' parallel work adds person-time.

Existing authenticated HTTP methods call:

| Method | API | Use |
| --- | --- | --- |
| GET | `/api/tasks/{id}` | Fresh title, assignments and subtask metadata |
| GET | `/api/tasks/{id}/journey?after_id=0&limit=100` | Status and event pages |
| GET | `/api/tasks/{id}/analytics` | Authoritative metrics and UTC `as_of` |
| GET | `/api/tasks/{id}/execution-sessions?after_id=&limit=100` | Session pages |

Wire contracts are typed in `frontend/types/taskLifecycle.ts`. Timer mapping adds
the existing Phase 1 continuation/start/stop metadata without removing any fields.
`getTask`'s optional fresh/signal arguments preserve ordinary cached-call behavior.
Fresh calls neither read nor populate the shared task cache and preserve HTTP
error status for the popup's safe error messages. No journey data is persisted in
browser storage and no new write API is called.

## Synchronization And Safety

- The existing task socket dispatches a local notice scoped to its authenticated
  user and tenant. The popup subscribes without opening a second socket. Other
  hosts without an active task socket still support refresh and visible polling.
- Idle notices/reconnections debounce refresh by 250ms; notices during a request
  coalesce into one serialized follow-up. Visible polling is every 30 seconds;
  focus, online and visibility recovery also refresh. Cleanup
  aborts requests and removes listeners, debounce timers and polling on close.
- A request version plus AbortController prevents older requests/pages from
  replacing newer data. A scope change immediately hides the previous snapshot.
  Access failures clear already-rendered history, including on pagination.
  Automatic refresh pauses after 401/403/404 until explicit retry. Each journey
  request has a 15-second timeout; existing cached task requests are unaffected.
- Independent endpoints are not one database snapshot. Conflicting current-status
  snapshots fail safely and offer retry. Page results for a changed status trigger
  refresh rather than appending conflicting history. Existing backend permissions
  remain authoritative; a local event only requests another authorized read.
- One monotonic clock is anchored to analytics `as_of` with a request midpoint
  latency estimate. Wall-clock/time-zone changes cannot change elapsed displays.
  Live figures are estimates, never persisted or used for XP. Extrapolation stops
  after 60 seconds without a successful sync.
- Live aggregate increments require a complete session collection that reconciles
  with server metrics at `as_of`; partial/mismatching sets keep server snapshot
  totals. Original corrected intervals are never added to effective intervals.
- Exact UTC source strings retain microseconds in timestamp labels. Displayed
  durations use whole seconds; browser interval arithmetic is millisecond precision,
  while backend analytics remain authoritative at boundaries.
- Dialog supplies focus containment/restoration, Escape/outside dismissal, labeled
  icon buttons, native keyboard-expandable details and status/error announcements.
  Reduced-motion disables the active ring animation. Layout uses theme variables,
  a bounded independently scrolling body and mobile vertical roadmaps.

## Changed Files

- `frontend/components/TaskDetailModal.tsx`
- `frontend/components/TaskJourneyModal.tsx` (new)
- `frontend/components/TaskJourneyModal.css` (new)
- `frontend/hooks/useTaskJourney.ts` (new)
- `frontend/hooks/useTaskWebSocket.ts` (only the scoped notice/dependency additions;
  earlier realtime changes were preserved)
- `frontend/services/mockApi.ts`
- `frontend/services/taskRealtimeEvents.ts` (new)
- `frontend/types.ts`
- `frontend/types/taskLifecycle.ts` (new)
- `frontend/utils/taskJourney.ts` (new)
- `frontend/test/task-journey.test.ts` (new)
- `frontend/e2e/taskJourneyFixture.tsx` (new, not imported by the application)
- `frontend/e2e/task-journey.mjs` (new)
- This report and `checks/` artifacts.

No package/lockfile changes or application dependencies were added. Existing
unrelated dirty backend, frontend, deployment and monitoring work was preserved.

## Validation

| Check | Result | Evidence |
| --- | --- | --- |
| Frontend unit/contract/regression tests | PASS: 58, including 12 new tests | [TAP](checks/frontend-tests.tap) |
| Local Chrome browser integration | PASS: 17 scenarios | [Results](checks/browser-results.json) |
| Production Vite build | PASS in 12.23 seconds, existing warnings remain | [Build](checks/build.txt) |
| Full TypeScript validation | FAIL: 131 existing diagnostics; none in new journey modules | [Diagnostics](checks/typescript.txt) |
| Scoped whitespace validation | PASS | `git diff --check -- <Phase 2 paths>`; only existing LF/CRLF notices |
| Backend migrations/full backend suite/live production | NOT RUN in this frontend-only phase | No backend changes |

Browser tests use intercepted synthetic API responses and test accounts only.
Every HTTP request is blocked except loopback Vite resources and intercepted
responses. No application database, email provider, production account or business
mutation is used. The expected existing auth logout request is also intercepted.
Playwright is reused from an existing local installation, not added to the app.
Tests cover all statuses, repeated/reopened transitions, timestamp precision,
subtask/timer expansion, live clocks despite Date.now changes, 320/375/768/1440
layouts, light/dark tokens, unbroken long titles, reduced motion, keyboard focus,
Escape/restoration, events/session pagination, stale task responses, scoped
invalidation, revoked access, tenant switching, logout and loading/empty/errors.

Initial browser failures were not suppressed: two selectors matched hidden child
content, the zero-area dialog root needed fixed viewport bounds, and fresh task
errors needed to retain their HTTP status. The initial logout test also incorrectly
forbade the existing auth POST; its allowance is limited to intercepted logout.
All final scenarios rerun after correction.

The pre-change `npx tsc --noEmit --pretty false` already failed. Final diagnostics
must remain visible: existing errors include Ballpit, AvatarCropModal, seed data,
Settings, ticket return types and unrelated mockApi types. No dedicated frontend
linter is configured. A successful Vite build is not a passing static typecheck.
Build warnings include existing Lottie eval and large application chunks.
The lazy journey JS chunk is 31.29 kB (10.51 kB gzip); its CSS is 9.06 kB
(2.17 kB gzip). These are artifact sizes, not a runtime performance benchmark.

Reproduce from `frontend` with `npm test`, `npm run build`, and
`npx tsc --noEmit --pretty false`. For browser validation, run a loopback Vite server
with `VITE_API_URL=/api`, then:

```powershell
$env:ZEAPLAY_PLAYWRIGHT_MODULE = '<existing Playwright installation>/index.mjs'
$env:ZEAPLAY_JOURNEY_TEST_URL = 'http://127.0.0.1:6302'
node e2e/task-journey.mjs
```

## Deployment And Remaining Risks

- Install/rehearse Phase 1 and its `fd5e6f7a8b9c` migration first. This phase has no
  migration. A missing/unavailable API yields the safe unavailable/error view.
- Build/deploy only through the existing release process. Roll back the frontend
  artifact to remove the popup; retain Phase 1's additive history schema and data.
  No deployment, container rebuild, migration or production restart was performed.
- Missing historical timestamps/actors/reasons remain unknown. Backend enrichment
  would require separately reviewed contracts; this UI does not invent evidence.
- Journey pagination is not a gap-free change feed across concurrent transactions.
  Refresh re-reads snapshots, including previously loaded pages. New transitions eventually
  reconcile on invalidation/polling; this is not an exactly-once delivery claim.
- Large task histories need production-size validation. Loaded ledgers are paged,
  but roadmap/metric APIs still inherit Phase 1's collection and 50,000-session
  limits. No load benchmark or production performance claim is made.
- Browser tests are mocked integration, not live authenticated backend/multi-worker
  E2E, screen-reader certification or production release verification.

**PHASE 2 IMPLEMENTED AND LOCALLY VALIDATED**, with the explicit existing global
TypeScript failure and data-availability limitations above. No later phase started.

Local development preview: `http://127.0.0.1:6302`. The dev server uses the existing
backend proxy on port 6311, with frontend API paths explicitly set to `/api`.
The existing Docker application containers were not rebuilt or restarted. Browser
fixture screenshots in `checks/` are synthetic evidence, not production records.
