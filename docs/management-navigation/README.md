# Management navigation review - 21 October 2026

Implemented locally. No deployment, container rebuild, production migration, email, or provider connection was performed. Unrelated existing working-tree changes were preserved.

## Result

- One `Management` sidebar item with `UsersRound`, linking directly to `/management`. No chevron, dropdown, hover menu, accordion, or nested sidebar links. Mobile navigation uses the same single entry.
- A full Management page contains the existing Users and Clients components at `/management/users` and `/management/clients`. The exact Settings tab styling, keyboard handling, and selected-tab scrolling now live in the shared `PageTabs` component.
- `/management` selects the first visible authorized tab in configured order, falling back to an authorized hidden tab for direct access. An unavailable parent or both unavailable children cannot expose either page. Management stays selected in the sidebar across both routes.
- Users and Clients business components were not edited by this task. Existing forms, dialogs, drawers, profiles, avatars, identity cards, contacts, archive/restore, and project associations remain in those components.
- Existing OAuth management and Authorized Applications components now live under Settings > OAuth. Normal users and managers can review their own grants; management endpoints retain the existing owner/admin ceiling. The OAuth protocol, provider configuration implementation, tokens, connections, and revocation handlers were reused.
- Sidebar Management has `Main Sidebar Pages`, `Management Page Tabs`, and `Settings Page Tabs`. Users/Clients retain stable policy IDs (`users`, `clients`) and existing saved restrictions and personal names. Labels/order remain account-and-tenant scoped in browser storage. Workspace access policy updates remain owner-only, and admins retain personal layout controls, matching existing backend permissions.
- OAuth has its own `settings.oauth` policy. Existing saved API restrictions continue to protect OAuth management while the policy has no explicit OAuth entry. A new complete workspace-policy save supplies an explicit OAuth rule, allowing subsequent API and OAuth configuration to be independent. Existing own-grant restrictions retain their `authorized-apps` policy ID.

## Compatibility routes

| Existing URL | Destination |
| --- | --- |
| `/admin/users` | `/management/users` |
| `/clients` | `/management/clients` |
| `/oauth/applications` | `/settings/oauth/authorized-apps` |
| `/api/oauth-apps` | `/settings/oauth` |
| `/settings/api/oauth` | `/settings/oauth` |
| `/settings/api/oauth/authorized-apps` | `/settings/oauth/authorized-apps` |

Redirects replace obsolete history entries and preserve query parameters and navigation state. This application retains its existing HashRouter URLs (`#/management/users`, for example).

## Required validation

| # | Requirement | Result and evidence |
| --- | --- | --- |
| 1 | Management appears once | PASS - desktop and mobile browser assertions |
| 2 | No Management dropdown/chevron/nested menu | PASS - plain NavLink with UsersRound; browser checks |
| 3 | Full Management page opens | PASS - sidebar route and page headings |
| 4 | Horizontal Users Management and Clients tabs | PASS - shared Settings PageTabs component |
| 5 | Existing pages retain functionality | PASS - original page components reused; existing user/client create dialogs and client search exercised; client/contact/profile backend regressions |
| 6 | Switching tabs updates route | PASS - mouse and keyboard browser checks |
| 7 | Refresh and browser history work | PASS - active route, back/forward, and reload assertions |
| 8 | Management stays highlighted | PASS - `aria-current` checks on both routes |
| 9 | Authorized Apps under Settings > OAuth | PASS - legacy redirects and unchanged grants screen |
| 10 | No duplicate navigation entries | PASS - removed links absent on desktop/mobile; OAuth removed from API subnavigation |
| 11 | Role visibility and direct access | PASS - all four roles, disabled/hidden/narrowed policies, server-side endpoint checks, and real-login browser scenario |
| 12 | Sidebar Management supports new structure | PASS - three configuration groups, retained stable policy IDs, existing save/reorder/conflict/isolation tests |
| 13 | Responsive layouts | PASS - Management at 320/390/768/1024/1440px; Settings additionally at 1280px; no document overflow |

## Checks

| Check | Result |
| --- | --- |
| Frontend unit tests | PASS - 144 tests |
| Navigation API tests | PASS - 70 passed; 69 PostgreSQL cases skipped |
| Clients, contacts, avatars/profiles | PASS - 29 passed; 16 PostgreSQL cases skipped |
| Real-session Chrome integration | PASS - 1 SQLite integration test; 1 PostgreSQL case skipped |
| Management browser scenarios | PASS - 19 cases |
| Settings browser regression | PASS - 22 cases |
| Sidebar Management browser regression | PASS - 20 cases |
| Scoped Python Ruff | PASS - registry, policy service, navigation/client/contact tests |
| Production build | PASS - Vite build; existing large-chunk warning remains |
| Full TypeScript check | FAIL - 118 diagnostics in files not edited by this task; zero diagnostics in the 28 task source/test files |
| Frontend lint | UNAVAILABLE - `npm run lint` was attempted; no lint script is configured |

TypeScript diagnostics include existing Ballpit/Three types, seed data, and other page/service contracts. They were not suppressed or excluded. Full diagnostics are retained in `checks/typecheck.txt`.

Browser tests use the real application/router/components. Management, Settings and editor browser suites use synthetic services. The real-session integration uses real logins, signed/HttpOnly sessions, policy persistence, and OAuth/configuration endpoints against a disposable SQLite database; unrelated layout reads are synthetic. PostgreSQL cases require an explicitly isolated database and were skipped. External provider authorization/delivery was not retested or claimed.

## Changed source and test files

This task touched the following files; several already had unrelated uncommitted changes before this task. The Users/Clients business logic and OAuth protocol implementation were reused without edits.

### Backend

- [`backend/app/navigation_registry.py`](../../backend/app/navigation_registry.py)
- [`backend/app/services/navigation.py`](../../backend/app/services/navigation.py)
- [`backend/tests/test_navigation.py`](../../backend/tests/test_navigation.py)
- [`backend/tests/test_clients_phase2.py`](../../backend/tests/test_clients_phase2.py)
- [`backend/tests/test_contacts_phase3.py`](../../backend/tests/test_contacts_phase3.py)

### Frontend

- [`frontend/App.tsx`](../../frontend/App.tsx)
- [`frontend/components/PageTabs.tsx`](../../frontend/components/PageTabs.tsx)
- [`frontend/components/Sidebar.tsx`](../../frontend/components/Sidebar.tsx)
- [`frontend/components/Layout.tsx`](../../frontend/components/Layout.tsx)
- [`frontend/components/SidebarEditor.tsx`](../../frontend/components/SidebarEditor.tsx)
- [`frontend/hooks/useNavigation.tsx`](../../frontend/hooks/useNavigation.tsx)
- [`frontend/pages/Management.tsx`](../../frontend/pages/Management.tsx)
- [`frontend/pages/Settings.tsx`](../../frontend/pages/Settings.tsx)
- [`frontend/pages/SettingsApi.tsx`](../../frontend/pages/SettingsApi.tsx)
- [`frontend/pages/SettingsOAuth.tsx`](../../frontend/pages/SettingsOAuth.tsx)
- [`frontend/types/navigation.ts`](../../frontend/types/navigation.ts)
- [`frontend/utils/settingsNavigation.ts`](../../frontend/utils/settingsNavigation.ts)
- [`frontend/utils/navigationPreferences.ts`](../../frontend/utils/navigationPreferences.ts)
- [`frontend/test/settings-navigation.test.ts`](../../frontend/test/settings-navigation.test.ts)
- [`frontend/test/navigation-preferences.test.ts`](../../frontend/test/navigation-preferences.test.ts)
- [`frontend/e2e/management-navigation.mjs`](../../frontend/e2e/management-navigation.mjs)
- [`frontend/e2e/settings-navigation.mjs`](../../frontend/e2e/settings-navigation.mjs)
- [`frontend/e2e/settingsNavigationFixture.tsx`](../../frontend/e2e/settingsNavigationFixture.tsx)
- [`frontend/e2e/navigation-fixture.mjs`](../../frontend/e2e/navigation-fixture.mjs)
- [`frontend/e2e/navigation-manifest.json`](../../frontend/e2e/navigation-manifest.json)
- [`frontend/e2e/navigation-api-manifest.json`](../../frontend/e2e/navigation-api-manifest.json)
- [`frontend/e2e/navigation-security.mjs`](../../frontend/e2e/navigation-security.mjs)
- [`frontend/e2e/sidebar.mjs`](../../frontend/e2e/sidebar.mjs)

The report, JSON summaries, final command logs, and four desktop/mobile screenshots are under `docs/management-navigation/`. Raw execution output and the real-session browser artifacts are also under `artifacts/management-*`.

## Reproduce

From the repository root:

```powershell
python -m pytest backend/tests/test_navigation.py -q --disable-warnings
python -m pytest backend/tests/test_clients_phase2.py backend/tests/test_contacts_phase3.py backend/tests/test_avatar_profiles.py -q --disable-warnings
ruff check backend/app/navigation_registry.py backend/app/services/navigation.py backend/tests/test_navigation.py backend/tests/test_clients_phase2.py backend/tests/test_contacts_phase3.py
```

From `frontend`:

```powershell
npm test
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm run lint
npm run build
```

For browser tests, start a loopback Vite server and point `ZEAPLAY_PLAYWRIGHT_MODULE` at an installed Playwright `index.mjs`; `ZEAPLAY_TAILWIND_JS` points at the cached existing Tailwind CDN runtime. The Management driver uses `ZEAPLAY_MANAGEMENT_TEST_URL`, Settings uses `ZEAPLAY_SETTINGS_TEST_URL`, and Sidebar Management uses `ZEAPLAY_SIDEBAR_TEST_URL`. The real-session pytest harness uses `ZEAPLAY_NAVIGATION_FRONTEND_URL`. This run used `http://127.0.0.1:6338` and the sibling checkout's existing Playwright installation, without adding dependencies.
