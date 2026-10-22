Create Task's Project field now reuses the Assignees/Linked Clients searchable picker in single-selection mode. It shares the trigger, avatar/chip sizes, search input, row styling, selected and hover states, status badges, border, shadow and custom scrollbar. Selecting a project replaces the previous value, closes the dropdown and restores trigger focus. Other selectors retain their multi-selection behavior.

Search uses the existing authenticated `getProjects` API with a 250ms debounce, ACTIVE status filter, 25 records per page and Load more. Project name, description and client company are searchable through the existing backend query. Selected project metadata survives searches so project membership filtering and task creation continue to use the selected record. A sole available project is still preselected. Backend routes and task payload contracts are unchanged.

Validation on 2026-10-22:

- Five project browser groups passed: shared appearance, pagination, case-insensitive client/project search beyond the previous 100-record limit, single selection, keyboard navigation, empty/error states, membership changes, task `project_id` submission, sole-project preselection, mobile layout and outside-click dismissal.
- All ten existing Linked Clients/Assignees browser regression groups passed, including the 19 computed visual comparisons.
- All 152 frontend tests passed. Production build and scoped whitespace checks passed.
- TypeScript reports the same 116 pre-existing errors as the saved baseline, with no new diagnostics. No lint script is configured.
- The legacy backend project fixture initially failed six tests because it lacks navigation-policy storage. `checks/verify_backend.py` supplies that table only in the collected suite's isolated in-memory SQLite engine. With that setup, six tests passed, including permissions and tenant isolation. The query-budget test still fails: it observes 8 SELECTs against a limit of 7. Backend source was not changed for this UI work.

Modified implementation: `frontend/components/CreateTaskModal.tsx` and `frontend/components/ui/SearchableMultiSelect.tsx`. Browser coverage is in `frontend/e2e/task-project-picker.mjs`, with a project mode added to the existing local `linkedClientsFixture.tsx`. Screenshots, results and command output are in [checks](checks/). No application database or production changes were performed.

Local runtime follow-up: the user confirmed the old selector was visible at `http://localhost:6300`. The running Docker frontend lacked the updated project-search asset. Rebuilt the existing development Compose frontend and recreated only that service with `--no-deps`. The root page and updated `CreateTaskModal-CVc86Phx.js` now return HTTP 200; the served JavaScript contains the new project-search field. See `checks/local-runtime.json`. No connected browser was available for a direct session refresh; existing tabs should use Ctrl+Shift+R and reopen Create Task.

To repeat browser checks, start loopback Vite on port 16309, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an existing Playwright `index.mjs`, then run `node frontend/e2e/task-project-picker.mjs` and `node frontend/e2e/linked-clients.mjs` from the repository root. `ZEAPLAY_PROJECT_PICKER_TEST_URL` can select another loopback port.
