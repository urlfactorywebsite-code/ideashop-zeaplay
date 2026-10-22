All Tasks must continue to use the server's existing `tasks` authorization when a frontend with task tabs is deployed ahead of a backend that has no `tasks.list` navigation entry. Previously the outer route guard accepted `tasks`, but the list tab's guard looked up the missing entry and redirected to Access forbidden. The selected Owner checkbox on the parent page did not prevent this.

`resolveNavigationPage` now falls back from an absent `tasks.list` to the current document's `tasks` decision. The navigation provider uses it consistently for guards, tab visibility and panel mounting. Explicit child entries are authoritative, including denied or disabled entries. Parent restrictions and hidden-only behavior remain in force; missing parent and unrelated unknown page IDs remain denied. The response and stored policy are not modified. Backend authorization and tenant scoping are unchanged.

Validation on 2026-10-22:

- All 154 frontend tests passed, including the four-role legacy-document policy matrix and explicit-denial/unknown-page cases.
- The loopback Chrome regression passed 15 scenarios. One reproduces the exact Owner Access forbidden result using the previous lookup and a navigation response without `tasks.list`. The fixed lookup passes Owner/Admin/Manager/User at 1440px and 390px, reload, current-backend compatibility, hidden-only direct access, and parent/child disabled or forbidden policies. Denied cases do not mount the task-list data reader. No browser errors occurred.
- Production Vite build and `git diff --check` passed. Existing dependency eval, mixed-import and chunk-size build warnings remain.

These checks use the actual application, navigation provider and route guards with synthetic API/session data. No VPS login, deployment, database write or policy reset was performed. The screenshot alone cannot confirm the live backend version.

To confirm the suspected version mismatch on the VPS, run this read-only check:

```bash
docker exec zeaplay_backend python -c "from app.navigation_registry import REGISTRY; print({key: key in REGISTRY for key in ['tasks', 'tasks.list', 'management']})"
```

`tasks: True` with `tasks.list: False` confirms that the running backend lacks the task-list policy entry. Publishing and deploying this frontend compatibility fix accommodates that response. Alternatively, updating the running backend to the reviewed matching release supplies the new registry entry; preserve its existing Compose project, overrides, environment and persistent media mounts. Do not reset navigation policies or grant blanket role access to work around a version mismatch. If `tasks.list` is present, inspect the authenticated `/navigation` decisions for `tasks` and `tasks.list` before changing live permissions.

Repeat the browser check with a loopback Vite server on port 16309 and `ZEAPLAY_PLAYWRIGHT_MODULE` pointing to an installed Playwright module:

```powershell
node frontend/e2e/task-navigation-compatibility.mjs
```

The browser results are recorded in [checks/browser.json](checks/browser.json).
