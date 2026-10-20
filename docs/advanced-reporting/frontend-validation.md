# Frontend reporting validation

Validated locally on Windows on 2026-10-20.

| Check | Result | Evidence |
| --- | --- | --- |
| Reporting utility tests | PASS: 6 tests | `frontend/test/reporting.test.ts` |
| Complete frontend unit suite | PASS: 124 tests, 0 failures | `checks/frontend-tests.txt` |
| Production Vite build | PASS; existing Lottie eval and large-bundle warnings | `checks/frontend-build.txt` |
| Full TypeScript check | FAIL: 127 errors, identical normalized signatures to the independently checked HEAD baseline of 127. No errors in reporting files, App, Layout, or Sidebar | `checks/typescript-head-baseline.txt`, `checks/typescript-frontend-after.txt` |
| Frontend lint | Unavailable: repository has no lint script or configured linter | `frontend/package.json` |
| Browser interaction coverage | PASS: 10 groups, no uncaught browser errors | `checks/browser-results.json` |
| Desktop, mobile, charts and time-report visual inspection | PASS: 390px layout remains within viewport, controls have visible keyboard focus, charts disable animation | `checks/reporting-*.png` |
| Actual API/UI field and sorting contract | PASS on isolated SQLite: 110 sorting/export combinations plus all displayed fields, grouping variants, session fields and detail relationships | `checks/api-ui-contract-responses.json`, `backend/tests/test_reporting_frontend_contract.py` |

The browser harness uses the existing authenticated application route with deterministic intercepted API responses. It verifies UI behavior and request contracts; it is not evidence of live database correctness, deployed authorization, or production availability. Database aggregation and authorization need the backend fixture tests.

The trustworthy TypeScript baseline comes from `git archive` of commit `6dae33387d2dfbbbfe9b7e066ed38c8f5c9def9b`, extracted under ignored `frontend/node_modules/.reporting-verification/` with a junction to the same installed dependencies. No tracked environment files were included. The earlier `typescript-current.txt` capture was taken after implementation began and is not treated as the original baseline.

The API/UI contract test reads the actual table columns and sort controls from `Reports.tsx`, invokes the real FastAPI router against an isolated temporary database, and checks response keys plus every exposed ascending/descending sorting choice and matching CSV export. It covers all five time groupings and all three activity groupings. It also verifies real detail responses, including a parent visible only through an assigned child, its restricted parent assignee, and project membership counts/truncation. Captured JSON contains synthetic authorized records and no tokens or credentials.

This review corrected subtask links to use the actual parent task ID plus child ID, changed the detail heading to “Parent tasks in scope,” removed the unavailable subtask creation date column, and added recorded effort and explicit truncated-name flags. A regression test preserves parent/child IDs and applied filters in deep links.

Browser checks cover regular-user route access, all four combined filters and URL persistence, archived/inactive selectors, parent-task deep links, sorting, pagination, CSV download request filters, employee/subtask/session detail, distinct effort and unique-time metrics, time grouping, active-timer filtering, activity grouping and prior-period comparison, clearing records after forbidden responses, empty states, resetting applied and unapplied filters, invalid dates, mobile layout, keyboard focus and reduced motion.

## Reproduction

From `frontend`:

```powershell
npm.cmd test
npm.cmd run build
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 6303 --strictPort
```

In a separate shell, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`, then run:

```powershell
node e2e/reporting.mjs
```

The browser runner defaults to loopback port 6303, intercepts APIs and external network assets, and does not use real credentials. `ZEAPLAY_REPORTING_TEST_URL` can override the loopback base URL.

## Implemented frontend files

- Existing `pages/Reports.tsx` now uses backend reports, shared filters and seven report sections.
- New `pages/Reports.css` uses existing theme tokens and responsive layouts.
- New `services/reportingApi.ts` uses the existing authenticated Axios client exported from `services/mockApi.ts`.
- New `types/reporting.ts` and `utils/reporting.ts` define request/response types, timezone-aware presets, validation, URL serialization, durations and comparison dates.
- Existing `App.tsx`, `components/Sidebar.tsx`, and `components/Layout.tsx` expose own-work reporting to regular users on desktop and mobile; backend queries remain the authority for visibility.
- New `test/reporting.test.ts` and `e2e/reporting.mjs` cover report helpers and browser interactions.

## Frontend behavior notes

Inventory filters use task creation dates; date-wise reports use event timestamps; time reports intersect active session intervals. The four global filters remain applied across tabs, drill-downs, pagination, sorting and exports. Custom final dates are inclusive in the UI; the backend determines exclusive UTC end boundaries using the reporting timezone. Invalid profile timezones fall back to UTC.

Successful parent completion is `DONE` or `DEPLOYED`. In-progress metrics include `IN_PROGRESS`, `BUG_FIXING` and `IN_REVIEW`; pending metrics include `WAITING_FOR_REQUIREMENT`, `TODO` and `ON_HOLD`. Historical assignment events are explicitly unavailable. Parent status history and existing execution evidence remain available through task deep links.

Employee/project tables include recorded effort for their filtered task inventory; employee/project details also expose historical work summaries and session histories, plus links to activity and complete work breakdown. Project member counts are complete authorized counts; member/manager names are capped previews with explicit truncation flags. Subtask creation timestamps are not stored in the existing model. Exports are generated at the server's current report snapshot and may reflect changes after the displayed report loaded.
