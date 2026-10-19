# Independent Phase 2 Review

Reviewed 2026-10-19 against the existing working tree. Scope: Task Status Journey
correctness, UI/accessibility, refresh reliability and rendering only. No later
phase, backend/schema change, production operation or new dependency.

## Defects Fixed

| Finding | Correction |
| --- | --- |
| Realtime invalidation aborted healthy slow snapshots; the reproducer had three overlapping analytics requests | Serialize refresh/pagination, coalesce a burst into one queued follow-up, and discard queued work on close/scope change |
| Background refresh discarded loaded history and session pages | Re-read the user's loaded page window; retain expansion state and refreshed correction data |
| Stopped legacy rows with future stop dates accrued more live time | Advance only open sessions after `as_of`; clamp displayed stopped intervals to their snapshot |
| A gap between recorded statuses was counted as continuous time in one stage | Require matching previous/new status boundaries; unknown, reversed and future durations stay Not recorded |
| Closed subtask rows reprocessed history on each clock tick | Prepare intervals and child view models once per snapshot; memoize stable closed rows and roadmaps |
| UUID ordering made session rows appear out of execution order | Sort loaded sessions by actual UTC start, then ID, and display each session identity |
| Invalid server clock could produce an empty content area | Reject invalid/conflicting snapshots with the existing safe error/retry state |
| Access-denied views continued automatic retry traffic | Suspend automatic refresh on 401/403/404; retain explicit retry and clear private content |
| Fresh reads could remain pending without a timeout | Apply 15-second request timeouts to journey reads only; ordinary cached task calls remain unchanged |
| Light-theme indicators/focus colors and long user names needed stronger handling | Use theme-aware contrast-safe accent, scoped box sizing, and wrapping; fix mobile child-date grid alignment |
| Task status label was not associated with its select | Connect label/select with a unique React ID, without changing values, permissions or update handlers |

Capture-ID order remains authoritative for event records. Labels now say Recorded
order, rather than claiming wall-clock chronology when timestamps disagree. Exact
UTC source precision is preserved. Unknown reasons/actors are still not fabricated.

## Verification Matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Active-stage glow, all 11 statuses and reopened visits | PASS | Actual animation style changes; only one active main stage; repeated transitions retained |
| Timestamp precision, event order and status-duration gaps | PASS | Unit cases and rendered source timestamps |
| Direct/child/combined time, overlaps and live clocks | PASS | Union regressions, future-stop reproducer, monotonic clock and 60-second stale pause |
| Timer sessions/corrections and local paging | PASS | 30-session component scenario; 25 rows initially; original correction evidence retained |
| Many subtasks and long titles | PASS | 250 subtasks; no closed bodies; zero observed inactive-row DOM mutations across a clock tick |
| Realtime, slow requests, loaded pages and stale responses | PASS | Scoped notices, serialized burst, preserved pages, old task response rejection |
| Tenant/logout/access revocation and cleanup | PASS | Private content cleared; close cancels queued work; interval/listener counts return to baseline |
| Desktop/mobile, dark/light and reduced motion | PASS | 1440/768/375/320 viewports; overflow checks/screenshots; indicator contrast >= 3:1 for fixture palettes |
| Keyboard navigation | PASS | Tab/Shift+Tab containment, native Enter/Space expansion, Escape and focus restoration |
| Existing task status editing | PASS | Owner selects BUG_FIXING, existing PATCH succeeds, refreshed journey displays it; all 11 options remain |
| Frontend unit/contract suite | PASS: 64 tests | [TAP](checks/review-frontend-tests.tap) |
| Component/browser interaction suite | PASS: 26 scenarios | [Results](checks/review-browser.json) |
| Production build | PASS | [Build](checks/review-build.txt); existing Lottie eval/large-chunk warnings remain |
| Full TypeScript | FAIL: 131 existing diagnostics | [Diagnostics](checks/review-typescript.txt); no new journey-module errors |
| Scoped tracked-file whitespace | PASS | `git diff --check` on reviewed paths; only LF/CRLF notices |

The 64-test suite includes the previous 58 cases plus six new accounting/snapshot
regressions. The expanded browser suite exercises real React components with
intercepted synthetic APIs, not a live database. Its only business write is the
explicit existing status-edit test, intercepted locally. All other journey actions
are reads. No additional task/Socket.IO connection was opened by the popup.

Tests were added before the fixes. Retained failing evidence:
[unit reproducers](checks/review-unit-before.tap),
[browser reproducers](checks/review-browser-before.json). Initial results were two
unit failures and two browser failures. A later status-edit test attempt also
failed because the original fixture supplied `OWNER`, while the real role contract
is lowercase `owner`. That fixture was corrected, not the application's role
policy. An unhandled response-wait promise in that attempt was replaced with an
awaited Promise.all; the final run is complete and passing.

## Measured Observations

- Slow 900ms fixture responses: peak simultaneous analytics requests decreased
  from three in the reproducer to one. Three invalidations during the first read
  produce two serialized snapshots total, not three canceled/restarted reads.
- A 250-subtask initial view performs four task/lifecycle reads, not one per child.
  Auth setup is separate. Previously loaded additional pages require additional
  reads on refresh so corrections and history do not become stale.
- After preparing 251 sessions, 61 simulated clock ticks perform zero Date.parse
  calls in the prepared accounting path. This is an operation-count assertion,
  not a hardware latency/throughput benchmark.
- Three open/close cycles return the instrumented interval and scoped-listener
  counts to baseline. Closing during a delayed queued refresh starts no later
  orphan requests. This is resource-lifecycle evidence, not heap-leak certification.
- The final lazy journey chunk is 34.10 kB JS (11.41 kB gzip) and 9.67 kB CSS
  (2.26 kB gzip). It remains separate from initial task rendering.
- Comparing TypeScript diagnostics against the implementation baseline, ignoring
  shifted line/column positions, gives 131 before, 131 after and zero changed
  diagnostic messages. This does not convert the existing failure into a pass.

## Changed Files

- `frontend/components/TaskJourneyModal.tsx`
- `frontend/components/TaskJourneyModal.css`
- `frontend/components/TaskDetailModal.tsx` (status label association only in this review)
- `frontend/hooks/useTaskJourney.ts`
- `frontend/utils/taskJourney.ts`
- `frontend/services/mockApi.ts` (timeouts for new/fresh journey reads only)
- `frontend/test/task-journey.test.ts`
- `frontend/e2e/task-journey.mjs`
- This report, README corrections and generated `checks/` evidence/screenshots.

Reviewed and retained the existing wire DTOs, task socket notice bridge, lazy
integration and auth flow. Unrelated dirty realtime/backend/deployment files were
not reverted or included as new review changes.

## Remaining Limits

- TypeScript is not globally green; unrelated pre-existing errors remain release
  debt. No configured linter exists. Vite build success is not typecheck success.
- API snapshots are independent and pagination is not a gap-free commit feed.
  Conflicts fail safely; eventual reconciliation uses existing notices/polling.
- Very large loaded windows cost extra refresh requests. Production-size histories,
  real backend multi-worker delivery, mobile hardware and assistive technologies
  were not certified by this mocked Chrome suite. No load benchmark was run.
- Legacy historical reasons, actors and timestamps can remain absent. No evidence
  or task status is invented or backfilled by the UI.
- Phase 1 migration/operational prerequisites remain required. No backend tests,
  migrations, balances, application containers or production services were changed
  by this review. Existing workflow and XP authorization paths are untouched.

**PHASE 2 REVIEW PASS for the tested local UI scope**, with the explicit global
TypeScript failure and deployment limits above. No Phase 3 or deployment started.
