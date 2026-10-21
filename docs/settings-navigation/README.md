# Centralized Settings navigation

The subsequent [Sidebar Management production-readiness review](../sidebar-management/production-readiness.md) supersedes the earlier permission and editor details below and records the current security checks and release blockers.

Implemented locally on 2026-10-21. No production deployment or dependency addition was performed. When restarting for the Authorized apps relocation, the unversioned local database was missing `navigation_policies`. A database backup was saved before creating only that empty table; existing user, task, and time-entry row counts were preserved and no Alembic version was stamped.

## Result

The main sidebar and mobile menu now contain one permanent gear **Settings** link. It stays active for all Settings child routes, including in collapsed mode. The former bottom dropdown and its trigger/state are removed. Unrelated sidebar items retain their relative order.

Settings contains General / Profile, Support, API, Logs, Media Library, and the existing Push notifications feature. Master Control was removed from Settings; its previous links return to General / Profile. Tabs use the existing theme, icons, keyboard navigation, horizontal scrolling, and lazy loading. Existing pages and service methods are reused. Support's existing form renders inline; its modal behavior remains available to other callers.

The existing profile component was extracted, preserving its profile/avatar, password, theme/badge, backup/import/reset, and storage controls. Once visited, it stays mounted while changing Settings tabs so profile drafts and metadata requests survive. The application layout and shared providers remain mounted. Owner API subsection navigation retains the existing API page and its parent state.

Logout remains in the account menu. Release notes remain accessible through the footer information button. Sidebar editing is available in Settings > Sidebar Management; the temporary footer pencil has been removed. Existing browser-local preferences remain scoped to the same account and tenant; no preferences are reset.

The existing compact header now applies below 1280px to prevent tablet overflow; the layout also permits the tab row to shrink. No new design system is introduced.

## Routes

The application uses hash routes through the data router: for example, `https://ideashop.zeacrm.com/#/settings/profile`.

| Previous route | Canonical route |
| --- | --- |
| `/settings` | `/settings/profile` |
| `/settings?tab=profile` | `/settings/profile` |
| `/settings?tab=push` | `/settings/push` |
| `/support` (compatibility alias for former modal access) | `/settings/support` |
| `/master-control` | `/settings/profile` |
| `/settings/master-control` | `/settings/profile` |
| `/api/overview` | `/settings/api/overview` |
| `/api/oauth-apps` | `/settings/api/oauth` |
| `/api/smtp` | `/settings/api/smtp` |
| `/logs` | `/settings/logs` |
| `/media` | `/settings/media-library` |

Redirects use history replacement and preserve unrelated query parameters and navigation state. The recognized legacy `tab=profile`/`tab=push` parameter is consumed. Refresh, browser back/forward, and deep links are covered by browser tests.

`/settings/api` defaults to Overview for owners and OAuth for admins. Owner API subroutes also include `/settings/api/documentation`, `/settings/api/token`, and `/settings/api/webhooks`. Authorized apps now lives at `/settings/api/oauth/authorized-apps`, inside OAuth, and its former `/oauth/applications` URL redirects there. Users and managers enter API directly at their own Authorized apps; OAuth administration and other API tools retain their existing role and navigation policy checks. The `/oauth/authorize` route and backend API URLs are unchanged.

## Permissions

Actual established frontend permissions were preserved, including admin access to SMTP/OAuth without granting owner API tools.

| Settings section | User | Manager | Admin | Owner |
| --- | --- | --- | --- | --- |
| General / Profile | Yes | Yes | Yes | Yes |
| Support | Yes | Yes | Yes | Yes |
| API | Own authorized apps | Own authorized apps | SMTP/OAuth and own authorized apps | All existing sections |
| Logs | No | Yes | Yes | Yes |
| Media Library | Yes | Yes | Yes | Yes |
| Push notifications | Yes | Yes | Yes | Yes |

Shared metadata drives tab visibility and route guards. Unauthorized direct routes redirect to the existing dashboard destination before mounting restricted components or calling their services. Backend authorization remains unchanged. Media Library and other reused pages retain their own existing action permissions.

## Files created

| File | Purpose |
| --- | --- |
| `frontend/utils/settingsNavigation.ts` | Shared section permissions, API subsections, legacy mappings, landing URL handling |
| `frontend/components/SettingsRedirect.tsx` | Query/state-preserving compatibility redirects |
| `frontend/pages/ProfileSettings.tsx` | Existing profile content extracted from Settings |
| `frontend/pages/SettingsApi.tsx` | API subnavigation and role-aware integration of existing components |
| `frontend/test/settings-navigation.test.ts` | Role metadata and redirect unit tests |
| `frontend/e2e/settingsNavigationFixture.tsx` | Actual application with synthetic services for local browser verification |
| `frontend/e2e/settings-navigation.mjs` | Navigation, role, form, history, and responsive browser checks |
| `docs/settings-navigation/README.md` | This implementation and validation report |
| `docs/settings-navigation/checks/*` | Test/build output, comparison, and screenshots listed below |

## Files modified

| File | Change |
| --- | --- |
| `frontend/App.tsx` | Shared Settings route and legacy redirects |
| `frontend/pages/Settings.tsx` | Central Settings layout and section routes |
| `frontend/pages/ApiOverview.tsx` | Optional controlled section and hidden internal tab bar; existing logic retained |
| `frontend/components/Sidebar.tsx` | Permanent Settings, removed standalone links/dropdown, direct owner editor and release notes access |
| `frontend/components/Layout.tsx` | Mobile Settings link, removed obsolete support modal state, bounded content width |
| `frontend/components/Header.tsx` | Settings account links and existing compact header at tablet widths |
| `frontend/components/SupportFormModal.tsx` | Optional inline rendering of the same support form |
| `frontend/components/SettingsStorageOptionsPanel.tsx` | Canonical Media Library link |
| `frontend/test/storage-options-settings.test.ts` | Follow extracted profile content |
| `frontend/e2e/sidebar.mjs` | Updated editor access, removed dropdown checks, current session fixture |
| `frontend/e2e/sidebarFixture.tsx` | Updated Sidebar props |
| `frontend/e2e/push-settings.mjs` | Canonical route/tab navigation and current session/category fixtures |
| `frontend/e2e/pushSettingsFixture.tsx` | Shared Settings route and redirect |
| `frontend/e2e/pushLiveFixture.tsx` | Shared Settings route and redirect |

Unrelated backend working-tree changes were left untouched.

## Validation

| Check | Result |
| --- | --- |
| `npm test` in frontend | PASS: 141 passed, zero failed/skipped |
| Settings browser harness | PASS: 22 scenario groups; zero captured application console/page errors |
| Existing sidebar browser harness | PASS: editing, save/cancel/reset/reload, drag reorder, collapse, Escape, account/tenant/role isolation |
| Existing push Settings browser harness | PASS: 14 scenario groups; zero page errors/unmatched API requests |
| `npm run build` in frontend | PASS; existing bundle-size/eval warnings remain |
| `npx tsc --noEmit --pretty false` | FAIL: 121 existing diagnostics, down from 125; zero new normalized diagnostics |
| `npm run lint` | Unavailable: frontend package has no lint script |

Browser coverage includes all relocated sections, representative profile/password/support/feature-toggle actions, SMTP/OAuth forms, Logs/Media filters, preserved profile drafts, permissions before service calls, all legacy routes, query/state preservation, reload/history, keyboard navigation, and responsive/collapsed navigation. Tested widths: 320, 390, 768, 1024, 1280, and 1440px, with dark and light theme coverage and no page overflow.

The four removed TypeScript diagnostics were an unused SMTP type reference and three redundant enum/string switch comparisons in the extracted profile code. Existing unrelated type errors were not broadened into this refactor.

Evidence:

- [Summary](checks/summary.json)
- [Settings browser results](checks/browser.json)
- [Push Settings browser results](checks/push-browser.json)
- [Frontend tests](checks/frontend-tests.txt)
- [Frontend build](checks/frontend-build.txt)
- [Typecheck comparison](checks/typecheck-comparison.json)
- [Lint command result](checks/lint.txt)
- [Desktop screenshot](checks/desktop.png)
- [Mobile screenshot](checks/mobile.png)

### Reproduction

Use the existing frontend dependencies. In one PowerShell terminal:

```powershell
cd F:\Projects\ideashop-zeaplay-v5\frontend
npm run dev -- --host 127.0.0.1 --port 6337 --strictPort
```

In another terminal, run the normal checks:

```powershell
cd F:\Projects\ideashop-zeaplay-v5\frontend
npm test
npx tsc --noEmit --pretty false
npm run build
npm run lint
```

For browser checks, point `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs` and have Chrome installed. The run used the sibling checkout's existing installation; no dependency was added to this project. The Tailwind file is the application's existing CDN runtime, cached locally for deterministic styling.

```powershell
cd F:\Projects\ideashop-zeaplay-v5
$env:ZEAPLAY_PLAYWRIGHT_MODULE='F:\Projects\Zeaplay-V2\node_modules\@playwright\test\index.mjs'
$env:ZEAPLAY_SETTINGS_TEST_URL='http://127.0.0.1:6337'
$env:ZEAPLAY_PUSH_TEST_URL='http://127.0.0.1:6337'
$env:ZEAPLAY_SIDEBAR_TEST_URL='http://127.0.0.1:6337'
$env:ZEAPLAY_TAILWIND_JS=Join-Path $env:TEMP 'zea-settings-tailwind.js'
Invoke-WebRequest 'https://cdn.tailwindcss.com' -UseBasicParsing -OutFile $env:ZEAPLAY_TAILWIND_JS
$env:ZEAPLAY_TAILWIND_RUNTIME=$env:ZEAPLAY_TAILWIND_JS
$env:ZEAPLAY_PUSH_OUTPUT=([System.Uri]((Join-Path $env:TEMP 'zea-settings-push-checks') + '\')).AbsoluteUri
node frontend/e2e/settings-navigation.mjs
node frontend/e2e/sidebar.mjs
node frontend/e2e/push-settings.mjs
```

### Limits

Browser tests use real application components/router with synthetic service responses. They establish local navigation, permissions, and representative UI/service wiring; they do not certify live database actions, every existing form branch, SMTP delivery, external OAuth providers, media provider uploads, physical notification delivery, or VPS deployment. Production was not changed. Full repository typecheck/lint cleanliness remains unavailable for the reasons above.
