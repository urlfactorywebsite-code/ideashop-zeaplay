# Animated Zea.Play Login Redesign

Implemented 2026-10-19 in the existing `frontend/` application. This change is UI-only: no backend, auth API, route, credential validation, token storage, database or session implementation was changed for this request. No production deployment or container restart was performed.

## Design and Scope

The former gradient/Three.js ballpit, generated SVG and nested animated panels have been replaced with the actual supplied mascot scenes, a single centered glass login form, cyan/teal controls and restrained gold accents. Branding now displays Zea.Play V6.0.1 instead of the login page's obsolete V1.2.1 text.

The supplied files were found in **`frontend/images/favicon/`**, not directly in `frontend/images/`. All three PNG originals are referenced as Vite-managed imports; none was moved, regenerated or edited. Include these user-supplied assets in any approved release.

- A 30-second CSS cycle presents each scene for approximately ten seconds, including a two-second crossfade, with slow pan/zoom.
- Decorative Lucide trophy/star/energy icons, short spark trails and a faint scan line animate without JavaScript animation loops, new dependencies or a WebGL canvas. They contain no fictional user XP, streak, rank or online-count values.
- The first scene stays static until all three images decode. A slow/failed secondary image does not fade out the initial artwork or prevent form use. Async completion is ignored after unmount; media-query listeners are removed.
- A labeled pause/play icon freezes background motion. System reduced-motion preference removes motion and fixes the first scene; the control reflects that preference. The login intentionally remains cinematic/dark across existing theme preferences without changing the stored application theme.
- Scoped, bundled CSS provides labels, focus rings, hover/pressed/loading/error states, readable input sizes and responsive layouts. Mobile removes additional decorations; short screens scroll instead of hiding the form.
- Existing email/password IDs, autocomplete, required/email validation, show/hide control, login handler, pending/error flow, return-path redirect and Forgot Password modal are retained. Unused theme branches/SVG art and previously unreachable login documentation-modal state were removed; no working documentation route was removed.

## Files Changed

| File | Change |
| --- | --- |
| `frontend/pages/Login.tsx` | Replaced presentation; preserved the existing submit handler; added motion preference/control |
| `frontend/pages/Login.css` | New locally bundled and route-scoped styling, crossfades, layouts and motion/accessibility rules |
| `frontend/components/login/AnimatedLoginBackground.tsx` | New memoized artwork/decorative layer with decode readiness and unmount cleanup |
| `frontend/test/login-ui.test.ts` | Three new auth-contract, real-asset and motion-contract tests |
| `frontend/e2e/login-design.mjs` | New safe browser interaction, visual, pixel-rendering and responsive checks |
| `docs/login-redesign/` | This report and generated test logs/screenshots |

No package manifests or dependency lockfiles were changed. Existing unrelated dirty work was preserved. Existing recovery/logout browser harnesses were rerun, not redesigned; their generated screenshots may also have refreshed.

## Verified Results

| Check | Result |
| --- | --- |
| Existing plus new frontend suite, `npm test` | **73 passed**, zero failures/skips |
| Login browser checks | **11 passed** using real Chrome against loopback Vite |
| Existing recovery browser checks | **8 passed** |
| Existing logout browser checks | **5 scenarios passed** |
| Production Vite build | PASS; existing Lottie `eval` and large-chunk warnings remain |
| TypeScript, `npx tsc --noEmit --pretty false` | **FAIL**, 131 pre-existing diagnostics; normalized messages match the prior console-error-fix baseline, with zero added/removed diagnostics |
| Submit-handler source comparison | Byte-for-byte identical after line-ending normalization against the repository baseline |
| Scoped `git diff --check` | PASS, aside from existing Git LF/CRLF notices |
| Lint | No configured frontend lint script; no lint pass claimed |

Browser coverage includes native required/email validation, password visibility without value loss, keyboard focus, recovery dialog/API/Escape/focus restoration, unchanged login JSON payload, disabled pending submission, a real UI error after an intercepted 401, retry, successful token storage, return-path navigation, slow-image loading, pause/play, live reduced-motion changes and existing light/dark/colorful preferences. This is a frontend integration test with intercepted APIs, **not** certification of live credentials, SMTP, backend authorization or production SSO.

Images are checked for successful loading and actual screenshot pixels containing the gold mascot, not opacity values alone. Crossfade states are sampled through the native animation API. Screenshots were visually inspected for all three scenes and mobile/tablet layouts. Viewports: 1440x900, 1920x1080, 1024x768, 768x1024, 390x844, 320x568 and 844x390. No horizontal overflow or out-of-panel form controls was observed. Native Safari/iOS, full screen-reader testing and an automated WCAG audit were not performed.

### Test Safety and Harness Corrections

All business APIs and external-provider traffic were intercepted, with synthetic credentials only; no actual account/email/password was used or changed. No external stylesheet is supplied by the harness. The legacy HTML's inline Tailwind configuration expects `window.tailwind`; the harness provides only that empty global instead of downloading the CDN script. Consequently, these checks establish local login styling independence, not that the application's pre-existing global CDN bootstrap has been made outage-proof. Initially blocking the CDN without this bootstrap stub surfaced the existing `tailwind is not defined` error; no application-global behavior was silently changed to hide it.

Forced animation timestamps initially needed an explicit image-decode/two-frame paint wait before screenshots: computed opacity alone yielded blank captures. The final harness verifies rendered mascot pixels. The slow-load harness was corrected to delay only image requests, not Vite's asset-module imports. Final runs passed with these harness fixes.

## Performance and Limits

Animations change transform/opacity on a fixed, bounded number of layers. There are no JavaScript intervals, pointer-move loops, reconnect handlers, API polling or animated work-stat counters in the new UI. The memoized background does not rerender for email/password keystrokes; first-image priority is high, other images low. No extra animation library was introduced.

The final local build's main JavaScript chunk measured 2,766,202 bytes versus the pre-task build's 3,370,760 bytes. This is a build-size observation, not a frame-rate, load-time or capacity benchmark; this dirty workspace also contains concurrent unrelated edits, so the entire delta is not attributed solely to this redesign. Final build output is retained in `checks/build.txt`.

The original PNGs total approximately **5.63MB**, a remaining cold-load bandwidth cost. They are retained faithfully as requested; no unsupported mobile-network, image-compression, FPS, Lighthouse or runtime-memory improvement is claimed. Vite fingerprints the assets for normal immutable caching. The wider app still has existing oversized JS and external CDN dependencies.

## Preview and Reproduction

The existing loopback dev server was reused: **http://127.0.0.1:6302/#/login**. No backend or Docker restart is needed for this source preview. Normal sign-in uses the existing configured backend; do not use the synthetic harness credentials for actual login.

From `frontend`, execute separately and retain exit codes:

```powershell
npm test
npx tsc --noEmit --pretty false
npm run build
```

If no preview server is running, choose an unused port rather than replacing another process:

```powershell
npm run dev -- --host 127.0.0.1 --port 6302 --strictPort
```

From the repository root, set `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`; the harness refuses non-loopback targets:

```powershell
$env:ZEAPLAY_PLAYWRIGHT_MODULE='F:\Projects\Zeaplay-V2\node_modules\@playwright\test\index.mjs'
node frontend/e2e/login-design.mjs
node frontend/e2e/password-reset.mjs
node frontend/e2e/logout.mjs
```

The path above reuses an existing local test installation, not a new runtime dependency. Browser logs, JSON results, per-scene, reduced-motion and viewport screenshots live in `checks/`.

## Deployment and Rollback

Review and release only the approved frontend changes plus the three provided images; do not publish this checkout's unrelated dirty files. Rebuild the frontend with its existing correct API/presence build configuration. The existing container on port 6300 remains unchanged until that explicit update. This UI change requires no database migration, backend rebuild, password reset or secret change.

For an authorized **local** frontend-only update:

```powershell
docker compose up -d --build --no-deps frontend
```

Hard-refresh after the new frontend is healthy. Production release requires the project's normal reviewed frontend image/reverse-proxy procedure; none was executed here. Rollback is frontend-only to the previously approved image, with no database downgrade or data restoration. Local verification is not a blanket production-readiness claim.
