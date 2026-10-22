Linked Clients uses the Create Task Assignees picker through `SearchableMultiSelect`. The shared component retains the trigger, selected chips, counter, avatar sizes, row classes, status badges, search styling and scroll container. Client options use company initials, email/phone details and ACTIVE/ARCHIVED labels. Both selectors now use the same Avatar renderer; company avatars have no user ID and do not request user profiles.

The review removed the client-only dark backing in dark mode, matched the inherited dropdown text and label colors, and fixed Escape handling when focus is on dropdown footer controls. Client positioning measures the actual search/footer height, including concurrent loading and pagination. It uses the same below-trigger anchor and 8px gap when space permits, reduces the visible list height as needed, and opens above when space below is insufficient. Assignees keeps its existing layout and positioning. No new opening animation was added; its current animation and transition styles match the reference selector.

Client search reuses `getClients` with a 250ms debounce and 25 records per page. Load more requests the next page. Search responses never replace selected IDs. Existing contact summaries seed every selected link immediately, including archived clients and clients outside the current result page. Only missing details for those linked clients are fetched individually. Requests use the existing authenticated, tenant-scoped APIs; backend routes and contracts are unchanged.

Creation preselects the current client. Editing preserves all client links and per-client primary flags until selection or primary settings change. Duplicate IDs are removed by the existing payload normalization.

Validation on 2026-10-22:

- Frontend: 152 tests passed (`npm test`).
- Backend: 12 client/contact tests passed against isolated in-memory SQLite. These cover create/update persistence, shared links, archived relationships, duplicates, permissions and tenant isolation.
- Browser: ten groups passed against loopback Vite using synthetic API responses through the real frontend API adapter. Coverage includes name/email/phone search, toggling/counts, avatars/status, empty and failed searches/retry, stale responses, pagination, Arrow keys/End/Enter/Escape/Tab behavior, preselection, create/edit payloads, explicit link additions/removals and reopening, archived/off-page preservation, Assignees regression, outside clicks, long name/email truncation, and 390px/320px layouts with normal/reduced motion and light/dark themes.
- Direct visual comparison: 19 computed-style groups match, covering empty/selected trigger dimensions and typography, search focus, counter, avatars and chips, row height (52px) and spacing, text truncation, selected/hover states, status badge, popup border/shadow, scrollbar and animation/transition properties. Identity-derived avatar fill colors and data labels intentionally differ. Container widths and clipped list height adapt to each existing form.
- Production build passed, with existing bundle-size, mixed-import and lottie eval warnings.
- Full TypeScript checking remains blocked by 116 pre-existing errors; baseline and final diagnostics are identical. No new diagnostics.
- Lint could not run: the repository has no lint script or configuration. `npm run lint` reports a missing script.
- Scoped `git diff --check` passed. Existing unrelated working-tree changes were preserved.

Evidence is under [checks](checks/): browser results, desktop/mobile screenshots, frontend test/build output and baseline/final TypeScript diagnostics. Browser fixtures are imported only by the local test route. No deployment or live production verification was performed.

The accessible original attachment contains only the pasted text brief. No supplied screenshot image is available for comparison. The reference was the actual existing Create Task selector, with generated screenshots visually reviewed after the automated comparison.

Files modified during this review: `frontend/components/LinkedClientsSelect.tsx`, `frontend/components/ui/SearchableMultiSelect.tsx`, `frontend/pages/Clients.tsx` (Linked Clients label only), `frontend/e2e/linked-clients.mjs`, this report and its checks. No unrelated components or backend source were modified.

To repeat browser verification, start Vite on loopback port 16309, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an existing Playwright `index.mjs`, and run `node frontend/e2e/linked-clients.mjs` from the repository root. Set `ZEAPLAY_LINKED_CLIENTS_TEST_URL` to use another loopback port.
