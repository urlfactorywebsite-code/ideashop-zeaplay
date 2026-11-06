# Shared task status display names

The workspace owner can choose **Rename** in Settings → Sidebar Management → Status Management, edit **Display name (all task views)**, and save. This reuses `TaskStatus.display_label`; no new database field or migration is needed. Internal names, IDs, native enums, histories, workflow behavior and scoring rules remain protected. Existing duplicate/Unicode validation, tenant scoping, revision checks and configuration auditing still apply.

## Behavior

- Renamed names appear in All Tasks counters, filters, mission updates and badges; Calendar filters/cards; Gantt filters/labels/legend; task creation and details; dashboard cards; project task statuses; user task summaries; achievement point-history entries; reporting filters/status cells/charts; linked ticket tasks; and parent task journey/execution/history displays.
- Filter values, API writes, URLs and business calculations continue using immutable internal values, such as `IN_PROGRESS`, rather than the visible name.
- Ordinary users can read labels without gaining access to owner-only settings or task counts. The existing authenticated, tenant-scoped `GET /kanban-columns` now supports `include_inactive=true` and returns activation/visibility flags. Its default active-only behavior is preserved, and responses are `no-store`.
- One shared React provider loads labels for the authenticated tenant/account. Views and badges do not fetch individually. Configuration events and browser storage events refresh labels; focus and 30-second polling pick up changes from other sessions/devices. Query keys and immutable lookup snapshots prevent tenant/account label reuse.
- Hidden and inactive statuses retain names for historical/current tasks. Old custom-column IDs and canonical custom-status IDs both resolve. Unknown or removed records keep an explicit identifier or supplied historical label. A failed catalog read uses existing task/default labels rather than dropping tasks.
- Long labels wrap in badges, counters, filter controls and Gantt chips. Existing fantasy styling is retained. Project lifecycle, subtask, ticket and work-session status vocabularies remain separate. Stored historical audit data and machine-readable export codes are not rewritten.

## Affected files

- Backend: `app/routers/kanban.py`, `app/schemas.py`; new `tests/test_status_display_labels.py`.
- Shared frontend: `App.tsx`; new `hooks/useTaskStatusLabels.tsx`, `utils/taskStatusLabels.ts`; `types.ts`, `services/mockApi.ts` retain the backend's optional `status_title` for fallback display.
- Pages: `Tasks.tsx`, `CalendarView.tsx`, `GanttView.tsx`, `Dashboard.tsx`, `Projects.tsx`, `Users.tsx`, `Achievements.tsx`, `Reports.tsx`, `Logs.tsx`.
- Components: `StatusManagement.tsx`, `ui/TaskStatusBadge.tsx`, `CreateTaskModal.tsx`, `TaskDetailModal.tsx`, `SameTaskLogModal.tsx`, `TaskJourneyModal.tsx`, `TaskExecutionReport.tsx`, `Tickets/TicketTasksPanel.tsx`, `Tickets/TicketTasksSummary.tsx`.
- Tests: new `frontend/test/task-status-labels.test.ts`, `frontend/e2e/status-display-labels.playwright.js`; `frontend/e2e/taskNavigationFixture.tsx` accepts a tenant/account for synthetic isolation checks.

Unrelated changes already present in `test_status_production_readiness.py` and `docs/status-owner-controls.md` were preserved.

## Verification — 2026-11-06

| Check | Result |
| --- | --- |
| Real API/auth/SQL tests on SQLite and isolated PostgreSQL: display labels plus existing Status Management regression | PASS: 52 |
| Full frontend unit suite | PASS: 154 |
| New browser rename → list/filter → Calendar/Gantt → cross-tab update → user/tenant isolation → 80-character mobile-label flow | PASS: 17 checks |
| Existing Settings Status Management browser regression | PASS: 45 checks |
| Existing Kanban browser regression | PASS: 29 checks |
| Production frontend build | PASS; existing large-chunk and lottie eval warnings |
| TypeScript | FAIL: unchanged 116 diagnostics; zero added/removed after path/line normalization |
| Diff whitespace check | PASS |

Evidence: ignored `.tmp/status-labels-*` logs and browser artifacts. Browser tests run actual app components with synthetic HTTP fixtures; backend tests use actual JWT authorization and SQL on disposable databases. No production task data or application database was changed.

## Deployment

Rebuild and restart the backend and frontend using the installation's existing deployment procedure. Deploy both together so the shared catalog includes inactive statuses. This change introduces **no additional migration**; the preceding owner-control migration `f44ab1c2d3e4` is still required if that change has not been deployed. Do not stamp an unreviewed/unversioned database. Verify an owner rename and a regular user's filters/cards after restart. To roll back, restore the previous application builds; saved display names and task data remain intact. Deployment was not run here.
