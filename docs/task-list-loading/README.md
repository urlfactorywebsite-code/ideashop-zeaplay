All Tasks previously ignored the `error` returned by `useTaskList`. An unsuccessful `/tasks/page` request stopped the loading indicator but left an unexplained blank list. The page now displays the request error with a Retry loading tasks button. A successful empty result has a separate No tasks found message. No API authorization, queries, role policy, task mapping or backend schema was changed.

Follow-up for the reported live `200 {"items":[],"total":0}` with `quick_filter=createdByMe`:

- A successful empty response is distinct from a failed request. The local backend filters `Task.created_by_id` by the authenticated user's ID after applying visibility restrictions; other active filters also apply.
- The empty state now explains creator/assignee filtering and offers **Clear filters** when filters or search are active. This clears search and all list filters, returns pagination to page 1, and preserves unrelated view/deep-link parameters. Empty responses keep the selected filters until the user explicitly clears them.
- The broken remote `ZEA-1.png` favicon reference now uses a bundled `/favicon.svg`, matching the login page's gamepad motif.
- The invalid FullCalendar CSS link was already removed in existing local changes. FullCalendar v6 injects CSS from JavaScript ([official documentation](https://legacy.fullcalendar.io/v6/upgrading-from-v5#bundlers-and-css)); replacing that link with another CDN stylesheet is unnecessary. The current CalendarView uses its own React layout.
- Current local validation: 154 frontend tests passed; all 8 browser groups passed across list/grid and 1440px/390px, including filtered-empty recovery, simultaneous filter/search reset, URL preservation, API page reset, and the earlier request-error cases; the new disposable SQLite API regression passed creator-vs-assignee selection, tenant isolation, and legitimate empty results. Production Vite build passed with dependency/chunk warnings. PostgreSQL and the authenticated production response were not tested in this follow-up.

These changes are local. No deployment, production data change or permission change was performed.

Validation on 2026-10-23:

- Live public OpenAPI at `https://api.ideashop.zeacrm.com/openapi.json` includes `/tasks/page` and `/api/tasks/page`, page sizes up to 200, and the timezone/filter parameters used by the frontend.
- Anonymous GET requests to `/api/tasks/page?page=1&page_size=50` through the API domain, frontend domain and HTTP port 6300 all returned 401 Not authenticated. These read-only checks verify routing, not the signed-in owner's response or task access.
- All 154 frontend tests passed.
- Browser regression passed HTTP 500, HTTP 403 with structured denial, HTTP 422 validation errors, and network failure. Each case verifies a visible error, no false empty state, retry with a pending loading state, successful rendering through the actual Axios/task mapper, and a genuine empty response after reload. Tests cover desktop 1440px and mobile 390px with no document overflow or browser exceptions.
- Production Vite build passed with existing dependency/chunk warnings. Scoped whitespace checks passed.

The browser harness uses the actual App, navigation provider, task-list hook and API adapter with synthetic session data and intercepted HTTP responses. The existing fixture now has an opt-in `networkTaskPage` parameter to exercise the real task-page adapter; its default behavior is unchanged. Repeat with loopback Vite on 16309 and `ZEAPLAY_PLAYWRIGHT_MODULE` pointing to an installed Playwright module:

```powershell
node frontend/e2e/task-list-loading.mjs
```

Results: [checks/browser.json](checks/browser.json).

Live diagnosis remains pending: inspect the signed-in browser Network response for `/tasks/page`, or reproduce the failure and inspect the existing backend container logs. Do not infer a schema issue or change permissions from an empty page. No VPS deployment, authenticated task read, production policy write, migration or database repair was performed in this work. The frontend error-display improvement is local and unpushed.
