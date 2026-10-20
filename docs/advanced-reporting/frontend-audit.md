# Phase 1: Existing reporting frontend

Inspected before implementing the reporting extension on 2026-10-20.

- `frontend/pages/Reports.tsx` currently fetches all `/tasks` and `/users` through the authenticated `mockApi` service and computes metrics in the browser. Its existing department/person filters, comparisons, workload bars and CSV downloads are useful entry points, but do not provide project/status filters, pagination, server-side sorting, historical project reporting, or work-session analytics.
- Existing completion calculations include `FAILED`; this differs from successful completion (`DONE` and `DEPLOYED`) and conflicts with the existing overdue calculation. The new reporting metric definitions must explicitly distinguish successful completion, failed work, and archived work.
- The existing date range uses the browser timezone and an inclusive final millisecond. Completion trends use tasks already filtered by creation date, which can omit completion events from tasks created before the selected range. Inventory and activity reports need separate documented date semantics.
- Workload grouping by display name can merge different users who share a name. Employee summaries must group by immutable user IDs.
- Existing CSV output quotes fields but does not neutralize spreadsheet formulas or include timezone/filter metadata. Server-generated exports must reuse report query definitions.
- `frontend/App.tsx` and `frontend/components/Sidebar.tsx` currently limit reports to Manager/Admin/Owner. The extension needs regular-user access to backend-enforced own-work reports, while manager access remains restricted to authorized records.
- `frontend/services/mockApi.ts` already supplies the authenticated Axios client, refresh/retry handling, abort signals, and error normalization. Existing `/tasks/page` and project dashboards provide page/page-size conventions. Reuse this client rather than creating an independent authentication implementation.
- `frontend/hooks/useTaskReport.ts` already aborts obsolete requests, clears inaccessible data, and protects against stale responses. The analytics page should follow these patterns and keep independent loading/error states.
- `frontend/types.ts` distinguishes persisted `TaskStatus` from `SubtaskStatus` and project dashboard `derivedStatus`. Reporting must use persisted parent status exclusively, with subtask completion shown as separate progress.
- `frontend/index.html` defines existing `--color-*` design tokens, including dark surfaces, text, borders and task-status colors. Existing Recharts and Luxon dependencies support charts and timezone-aware date presets without new packages.
- `frontend/package.json` provides `npm test` (`node --test --import tsx`) and `npm run build`; no lint script exists. The repository has TypeScript and Node-test contract/unit tests. Global type checking must be reported separately from pre-existing failures.

## Implementation plan

Replace browser aggregation on the existing Reports route with shared backend filters and independent report requests. Keep filter context in URL parameters, use timezone-aware presets and inclusive calendar dates mapped by the backend to exclusive-end UTC ranges, and reset pagination when filters change. Add Overview, Employees, Tasks, Projects, Activity, and Time views with server pagination and sorting, scoped searchable employee/project selectors, accessible tables, chart drill-downs, detail views, and authorized CSV/XLSX downloads. Reuse current authentication, theme tokens, and the existing task/project deep-link behavior. Surface history limitations returned by the backend rather than generating missing timestamps.
