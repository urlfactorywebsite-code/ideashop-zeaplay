Login startup performance, verified locally on 2026-10-23.

The login entry eagerly imported the authenticated Layout, task-detail UI and their dependencies. Layout now loads behind the existing authentication guard. The password-reset route loads when visited; the recovery dialog and its CSS load on first request. The dialog stays mounted after its first use and explicitly restores focus to its opener on close. Authentication handlers, APIs, role policies, tokens, animations and the existing visual design are preserved.

`runtime-config.js` now uses `defer`. A production-browser test deliberately delays its response by 300 ms and supplies a distinct runtime API prefix, proving the API client initializes with that value. It remains ahead of the module entry in document order; `async` would not provide the same ordering guarantee. See [MDN's script documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script#defer).

Compiled Tailwind and removal of the global Frappe JS/CSS and invalid FullCalendar CSS were already present at the start of this work. Essential compiled CSS remains a normal stylesheet to preserve the first styled frame. No critical-style duplication or print-media stylesheet workaround was added. The reported production `register` stack was not available with source mapping, so no speculative modification to that function was made. Browser extensions were excluded from local measurement.

| Production build resource | Before | After |
| --- | ---: | ---: |
| Initial JavaScript, decoded | 1,016,279 bytes | 531,219 bytes |
| Initial JavaScript, gzip | 307,148 bytes | 162,696 bytes |
| Initial CSS, decoded | 389,418 bytes | 373,439 bytes |

Initial JavaScript decreased by 47.7% decoded / 47.0% gzip. The manifest and observed network resources confirm Layout, ForgotPasswordModal and PasswordReset are absent from login's initial requests.

Local median LCP, three cold/warm pairs per viewport:

| Scenario | Before | After |
| --- | ---: | ---: |
| Desktop, cold | 276 ms | 204 ms |
| Desktop, cached | 100 ms | 108 ms |
| Mobile viewport, 4x CPU, cold | 656 ms | 580 ms |
| Mobile viewport, 4x CPU, cached | 244 ms | 244 ms |

Cached LCP was effectively unchanged. Median cold mobile long-task time decreased from 194 ms to 132 ms. These are extension-free Chrome results against a loopback gzip server with synthetic anonymous auth, reduced motion and no network throttling. They do not predict production latency or reproduce the user's extension overhead. Baseline source was commit `9deb23e`; production LCP and the reported production bundle were not re-profiled. Raw measurements: [before](checks/before.json), [after](checks/after.json).

Validation:

- PASS: production Vite build; existing dependency/chunk warnings remain.
- PASS: all 154 frontend unit tests.
- PASS: 12 production cold/warm page loads, correct runtime endpoint, and absence of optional chunks; delayed-config ordering, lazy recovery submission/Escape/focus restoration, invalid credentials and direct reset route.
- PASS: all 13 existing login UI browser groups, including successful login, request payloads, duplicate-submit guard, audio cleanup, animations, keyboard controls, six responsive viewports and reduced motion. The harness's obsolete localStorage token assertion was updated to verify the existing in-memory tokens and absence of tokens in localStorage. [Results](design/browser-results.json).
- PASS: all 8 task-loading browser groups through the real App and lazy authenticated Layout with synthetic session/API responses.
- PASS: desktop/mobile production screenshots visually inspected; scoped whitespace check.

Repeat the production checks after installing dependencies and setting `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`:

```powershell
npm --prefix frontend run build -- --manifest
node frontend/e2e/login-performance.mjs
```

`--before` requires a baseline build with manifest in `.tmp/login-performance-before`. The temporary baseline build and extra design screenshots were archived outside the repository under the Windows temporary directory after validation. The harness starts and closes its own loopback server. No VPS deployment, production authentication attempt, SMTP delivery or backend/schema change was performed.
