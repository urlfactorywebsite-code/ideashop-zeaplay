The `/tasks` startup path now uses compiled Tailwind CSS, preloads the header video's first-frame poster, and loads the manual/editor and clock assistant on demand. This targets the runtime CSS generation, late header-media discovery, and eager module evaluation described in the supplied live audit.

Measured production build sizes:

| Initial JavaScript | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Raw bytes | 2,892,278 | 1,014,530 | 64.9% |
| Gzip bytes | 842,320 | 306,300 | 63.6% |

The measurements include entry chunks and their static JavaScript imports. Deferred chunks are still available when requested. This is a payload/module-loading comparison, not a claim that live LCP or main-thread time decreased by the same percentage.

Changes:

- `frontend/index.html` removes the Tailwind CDN script/configuration and unused global Frappe Gantt/FullCalendar resources. The current Gantt and Calendar views use their existing React implementations and have no references to those CDN resources. A local stylesheet is discovered in the document head.
- `frontend/tailwind.config.js`, `postcss.config.js` and `tailwind.css` compile Tailwind 3 during Vite development/build. The former dark-mode setting and theme colors are preserved. Production source folders, including pages, utilities, feature components and constants, are scanned for complete class strings. No constructed utility prefixes were found that require a safelist. The package manifest and lockfile include Tailwind/PostCSS/Autoprefixer; the added dependencies support the existing Docker Node 18 build.
- `frontend/public/header-poster.webp` is the existing Cloudinary video's first frame, downloaded as a 1600x100 WebP (3,460 bytes). Source: `https://res.cloudinary.com/dqhcbck76/video/upload/so_0,w_1600,q_auto,f_webp/v1770339698/Untitled_design_2_opyhae.webp`. The head preloads this local image with high priority and preconnects to Cloudinary. `Header.tsx` uses the same poster on the existing autoplay/muted/looping video. Regenerate the poster if that video is replaced.
- `Header.tsx` loads `TaskDocumentation` after the first manual-open action. It stays mounted after closing so existing manual state and close effects are preserved. The editor/highlighting/parser subtree is absent from the initial bundle.
- `ClockAssistant/ClockButton.jsx` loads `ClockDropdown` when opened, moving its Lottie animation/JSON and other closed-panel dependencies out of the initial bundle. Both lazy panels have accessible loading text and labeled triggers.

A poster preload is used instead of copying the proposed `as="video"` tag. This supplies a small visual resource directly from the HTML head before React discovers the video. See Google's [video performance guidance](https://web.dev/learn/performance/video-performance). The build integration follows the [Tailwind 3 PostCSS setup](https://v3.tailwindcss.com/docs/installation/using-postcss); [content scanning](https://v3.tailwindcss.com/docs/content-configuration) requires complete class strings. Existing theme overrides remain in place.

Validation on 2026-10-23:

- Production builds passed. The build analyzer confirms no `TaskDocumentation`, `ClockDropdown`, `lottie`, `react-md-editor`, `refractor`, or `parse5` modules in the initial static bundle. Existing mixed-import, large deferred chunk and Lottie dependency eval warnings remain.
- All 154 frontend tests passed.
- Six before/after browser cases passed: dark, light and colorful at 1440px and 390px. Task rows and the existing Create Task project picker render; task-tab width, height, typography, padding and border radius exactly match the runtime CSS baseline. No horizontal document overflow or browser exceptions occurred. The manual and clock panel load when opened. Screenshots are in `checks/`; external branding/media was blocked in the harness, so broken external logo images in those screenshots are test artifacts.
- Six production-build browser cases passed through the actual entry point, browser-session restoration, task-list hook and Axios adapter with synthetic HTTP responses. Tasks render with the CDN blocked; no manual/clock chunks load before interaction. Both deferred panels open successfully. The poster's resource timing identifies the HTML `link` as its initiator, and its request starts before the entry JavaScript finishes downloading. Production tab geometry matches the baseline in every theme/viewport.
- The existing task-list-loading browser regression passed server-error, authorization-denial, validation-error and network-failure/retry/empty-response cases after the CSS change.
- Whitespace checks passed. Repository-wide TypeScript/lint certification was not part of these performance checks.

No live deployment, production permission change, API modification, task data change or schema migration was performed. The earlier VPS task-visibility diagnosis still requires the authenticated response's counts/filters; HTTP 200 alone does not identify an empty result versus a rendering problem. Browser extension overhead is outside these application changes. The audit's exact `register` frame was not separately mapped to a source module; the verification establishes deferral of the heavy closed-panel module trees without claiming a measured reduction for that specific frame.

Concurrent changes to task filters, backend tests and the favicon were preserved and are outside this performance change. The favicon reference in the shared `index.html` belongs to that concurrent work.

To repeat the checks, run from `frontend`:

```powershell
$env:ZEAPLAY_BUILD_REPORT='../docs/tasks-performance/checks/build-after.json'
node scripts/analyze-build.mjs
npm test
```

With loopback Vite on 16309, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`, then run `node e2e/tasks-performance.mjs`. This compares against the saved `browser-before.json` baseline. With `vite preview --host 127.0.0.1 --port 16310 --strictPort`, run `node e2e/tasks-production-performance.mjs`. Both scripts refuse non-loopback targets and do not operate the real VPS.

Evidence: [before build](checks/build-before.json), [after build](checks/build-after.json), [browser comparison](checks/browser-after.json), [production browser](checks/production-browser.json).
