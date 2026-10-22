Create Task now renders in a portal attached to `document.body`, so it stays a fixed popup above All Tasks rather than appearing below the list. Its layout and form logic are unchanged. The nested Generate Task with AI dialog has its own higher stacking context and remains above the task form.

The cause was theme-specific CSS: `.tasks-light-theme > *` and `.tasks-colorful-theme > *` apply `position: relative` and page stacking rules. Those selectors were more specific than the task overlay's `.fixed` class. A browser probe confirms the old placement computes to `relative` in both affected themes. Moving the dialog outside those page containers preserves its fixed positioning without altering global page styles.

Validation on 2026-10-22:

- Full application browser harness passed all 12 placement cases: light, colorful and dark themes at 1440x900, 1366x768, 1280x600 and 390x640. The dialog is a direct child of body with fixed position and viewport-wide bounds. Title, close and submit controls remain accessible above the header, and closing restores body scrolling.
- Task creation passed in each theme with the selected project retained. Opening/dismissing the nested AI dialog passed in each theme; no AI generation requests were sent.
- All 152 frontend tests passed. TypeScript reports the same 116 existing errors as the saved baseline, with no new diagnostics. No lint script is configured.
- Frontend container build and scoped whitespace checks passed. Recreated only the local frontend service and verified HTTP 200 for the root page and updated task-modal JavaScript at `http://localhost:6300`. Backend source and application data were not changed; production was not deployed.

Modified source: `frontend/components/CreateTaskModal.tsx`. Browser regression coverage: `frontend/e2e/task-modal-popup.mjs`. Screenshots, results, build output and served-asset verification are in [checks](checks/). Refresh the affected browser with Ctrl+Shift+R before reopening Create Task.

To repeat the browser checks, start loopback Vite on port 16309, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an existing Playwright `index.mjs`, and run `node frontend/e2e/task-modal-popup.mjs` from the repository root. `ZEAPLAY_TASK_POPUP_TEST_URL` selects another loopback port.
