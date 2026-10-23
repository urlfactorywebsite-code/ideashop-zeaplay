Chat startup performance, locally verified on 2026-10-23.

The shared authenticated layout eagerly imported task details and several dialogs. Its closed clock button also imported Framer Motion. These dependencies were fetched and evaluated before the header mounted on `/chat`, even when their controls were unused.

Changes:

- Layout's task details, claimed reward, release notes and release-note editor now load on demand inside a separate Suspense boundary. The header and chat remain mounted while a dialog loads. Existing providers, permissions, notifications and task APIs are retained.
- The closed clock button uses a small CSS entrance animation. The full dropdown, including its existing Framer Motion/Lottie content, remains lazy. The toggle exposes `aria-expanded`; the outside-click handler ignores the opener, fixing a close/reopen race when clicking the toggle.
- HeaderBackground renders a decorative, eager, high-priority image using the existing `/header-poster.webp`. The existing HTML preload is retained. Image and video share a single opacity/blend layer to preserve the header's appearance.
- Decorative video is attached after two animation frames and an idle callback, with cancellation on unmount/preference changes. Reduced motion and data saver retain the static image. The original muted, looping, inline autoplay media and poster remain available otherwise.

An image rendered by React still waits for React and authentication initialization. This change reduces the work before mounting and separates the poster from video initialization; it does not implement a server-rendered header or eliminate all script-related render delay. The current entry uses `createRoot`, and the supplied minified production stack was not source-mapped in this work. Video posters and first frames can both contribute to LCP ([Chrome guidance](https://web.dev/articles/lcp)); changing the tag alone is insufficient evidence of improvement.

| Initial chat route dependencies | Before | After |
| --- | ---: | ---: |
| Decoded JavaScript | 1,176,865 bytes | 924,001 bytes |
| Gzip JavaScript | 358,859 bytes | 283,594 bytes |

The transitive Vite manifest graph for the entry, Layout and Chat decreased by 21.5% decoded / 21.0% gzip. Network checks confirm task details, the clock dropdown and documentation remain unloaded during initial chat rendering. This baseline includes the preceding local login optimizations, which are preserved.

Local LCP medians, three cold/warm pairs per viewport:

| Scenario | Before | After |
| --- | ---: | ---: |
| Desktop, cold | 528 ms | 544 ms |
| Desktop, cached | 420 ms | 436 ms |
| Mobile viewport, 4x CPU, cold | 1,040 ms | 972 ms |
| Mobile viewport, 4x CPU, cached | 660 ms | 648 ms |

Timing results are mixed: the payload reduction is clear, while these runs do not establish a substantial overall LCP improvement. Median cold mobile long-task time was 416 ms before and 423 ms after; cached mobile long-task time was 81 ms before and 69 ms after. Maximum observed CLS remained approximately 0.00036 desktop / 0.00006 mobile. No meaningful layout-shift regression was observed.

Measurements use a gzip loopback server, the actual production entry/auth/API mapper, synthetic authenticated HTTP responses, extension-free Chrome, no network throttling and reduced motion. External DNS/media and real sockets are blocked. These results do not reproduce production network latency, extension overhead, video playback or multi-user chat. The 2,011 ms production LCP has not been remeasured. Raw results: [before](checks/before.json), [after](checks/after.json).

Validation:

- PASS: production Vite build, with existing dependency/chunk warnings.
- PASS: all 154 frontend unit tests.
- PASS: 12 production cold/warm chat loads showing existing messages and the composer; synthetic message send, lazy clock open/close, lazy manual, live reduced-motion changes and data-saver poster fallback. No real messages were sent.
- PASS: six production task-page cases across dark/light/colorful themes and desktop/mobile. Existing task geometry, early poster preload, lazy manual and clock controls passed.
- PASS: all 10 task-navigation groups, including task details/editing, task creation, route/filter compatibility, authorization, realtime invalidation and Active Work/timer continuity.
- Desktop/mobile production screenshots were inspected. Missing external icons in the fixture reflect its blocked external media.
- Scoped whitespace validation passed.

Repeat the chat production checks after setting `ZEAPLAY_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`:

```powershell
npm --prefix frontend run build -- --manifest
node frontend/e2e/chat-performance.mjs
```

The harness starts and closes its own loopback fixture server. `--before` requires the baseline build and manifest in `.tmp/chat-performance-before`; the temporary baseline build was archived outside the repository after verification. No deployment, production data write, backend change or credential change was performed.
