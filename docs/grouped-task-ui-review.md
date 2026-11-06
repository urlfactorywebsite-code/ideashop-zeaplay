# Grouped task UI/UX review - 2026-11-06

The grouped feature checks pass. The repository release gate is **not fully green**: TypeScript retains 114 existing diagnostics, and frontend lint is not configured. This review modifies the grouped task presentation and its shared avatar/tooltip integration; unrelated notification, backend and product work is preserved.

## Changes and findings

1. **Correct identity and counts.** Membership now follows actual assignment user IDs, including when lean profile snapshots are absent. Stale or mismatched snapshot names cannot impersonate another assignee. Directory names are used consistently. A shared canonical Avatar identity hook keeps live profile names, avatar labels, tooltips and member actions synchronized while retaining the existing tenant guard, frames and image cache.
2. **Correct reward estimates.** Remaining group XP now sums the existing per-assignment points summary, including overdue penalties and eligible hold time. It no longer adds early-completion potential to already overdue assignments. Completed/failed estimates and individual assignment IDs remain independent; no award or scoring mutation was added.
3. **Selection and safe bulk actions.** Group checkboxes expose mixed selection when membership changes. Bulk deletion has a synchronous in-flight guard plus disabled/busy feedback, preventing duplicate mutation submissions. Large selections are limited to four simultaneous mutation requests, retaining input-ID/result ordering and independent failure handling. Queued requests are not sent after the account/action scope changes. Acknowledged successes are removed, failed assignments remain selected, and account/role changes invalidate pending UI reconciliation and old selections.
4. **Accessible filters.** The existing Tasks filter dropdown now exposes a real listbox and options, supports Arrow Up/Down, Home/End, Enter, Escape and Tab, and restores trigger focus. Existing selected button names and visual styling remain intact. Search, comments and loading feedback have explicit accessible names/status semantics.
5. **Readable tooltips.** Group member tooltips remain visible while hovered, dismiss with Escape, reposition after live name changes and keep the existing viewport constraints. Hoverability is opt-in; other tooltip consumers retain their behavior.
6. **Fewer derived calculations and requests.** Memoized grouped components and stable callbacks avoid recomputing party rewards when typing comments or selecting cards. A visible sibling assignment update refreshes the group rather than rereading the open task and comments. Full task events still reconcile the assignment. Existing sequence, account and unmount guards remain active.
7. **Compatibility.** No Kanban structure/card/drag source, grouping identity, API wire contract, database field, task history, timer link, server permission or points formula changed. Equal titles in different projects remain distinct cards/rows. Filtering continues to match a visible assignment while showing all authorized members of a matching logical task.

## Files modified by this review

| File | Purpose |
| --- | --- |
| `frontend/components/Avatar.tsx` | Export/reuse the existing tenant-guarded live identity resolver |
| `frontend/components/TaskGroupMembers.tsx` | Consistent member identity, live accessible names and memoized group presentation |
| `frontend/components/QuestParty.tsx` | Shared member identity and memoized party rendering |
| `frontend/components/TaskDetailModal.tsx` | Stable party actions, accessible comment name and targeted roster refreshes |
| `frontend/components/ui/Tooltip.tsx` | Opt-in hover persistence and live-text positioning |
| `frontend/pages/Tasks.tsx` | Mixed selection, bulk guards/account reset, stable callbacks and accessible filters/loading |
| `frontend/utils/taskGroups.ts` | Assignment-based member resolution, selection state and canonical remaining-XP estimates |
| `frontend/test/task-groups.test.tsx` | Identity fallback, stale metadata, mixed selection and overdue/hold reward regressions |
| `frontend/e2e/taskNavigationFixture.tsx` | Per-member permission cases and consistent list/detail reward fixture data |
| `frontend/e2e/task-groups.playwright.js` | Expanded interaction, filtering, identity, request and accessibility checks |
| `frontend/e2e/kanban-customization.playwright.js` | Wait for refreshed pagination state before asserting the existing empty-board behavior |
| `docs/grouped-task-ui-review.md` | This report |
| `docs/checks/grouped-task-ui/*.png` | Seven generated verification screenshots listed below |

The working tree already contained earlier grouping and notification changes. The file list above is this review's delta, not an inventory of all uncommitted work. A local comparison patch is retained at `.tmp/group-ui-review-changes.patch`.

## Screenshots

These show actual application components with synthetic loopback data, not static mockups. External resources are blocked by the fixture, so unrelated logo/chatbot images may appear as placeholders; those product assets were not changed.

- [Desktop Grid](checks/grouped-task-ui/grid-desktop.png)
- [Desktop List](checks/grouped-task-ui/list-desktop.png)
- [Mobile Grid](checks/grouped-task-ui/grid-mobile.png)
- [Quest Party in task details](checks/grouped-task-ui/details-desktop.png)
- [Individual member status and reward](checks/grouped-task-ui/party-member.png)
- [Existing light theme](checks/grouped-task-ui/grid-light.png)
- [Existing colorful theme](checks/grouped-task-ui/grid-colorful.png)

## Executed verification

| Check | Result |
| --- | --- |
| Grouping, avatars/profile frames, Kanban, navigation, scoring, dates, reports/journey and subtasks unit suite | **PASS: 71 tests** |
| Actual grouped Grid/List/details browser suite | **PASS: 85 checks**, zero browser runtime errors |
| Existing status-display, status-management and Kanban browser suites | **PASS: 91 checks** (17 + 45 + 29) |
| Browser total | **PASS: 176 checks** |
| Production Vite build | **PASS**, existing large-chunk warning remains |
| Full TypeScript check | **FAIL inherited: 114 diagnostics**, zero new diagnostic signatures versus the review-start snapshot |
| `npm run lint` | **NOT CONFIGURED**: exits 1 because package.json has no lint script; no lint pass is claimed |
| Git whitespace and added review-line whitespace checks | **PASS** |
| Database migrations/production data mutation | **NONE** |
| Backend tests and live deployment | **NOT RUN** for this frontend-only review |

Browser coverage includes one card/row for eight members; identical titles across projects; desktop/tablet/mobile widths of 1440/768/390; avatar boundaries at 1/4/5/6/8 members; missing and stale profile metadata; live names; text contrast for avatar initials; configured status names; correct completion progress; independent/member-specific permissions and mutations; failed updates; correct per-member/group reward data; selection across views and membership changes; partial, repeated and concurrency-bounded bulk deletion; debounced search; keyboard filtering; logical pagination/prefetch; loading, empty, failed and recovered results; cache freshness/out-of-order responses; foreign-session events; unsaved drafts; nested log actions; reduced motion; original independent Kanban cards and immutable-ID drag; and derived-calculation/request assertions.

The existing Kanban regression test now waits for its empty-board pagination state to finish reconciling after refetch, avoiding a timing race while retaining the disabled-pagination assertion. No production Kanban code was modified.

The tests verify DOM semantics, accessible names, keyboard focus and selected/mixed states. Manual NVDA/VoiceOver/JAWS testing and formal WCAG certification were not performed. Production load/latency was not certified.

From `frontend/`, unit command:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=384'
node --test --import tsx test/task-groups.test.tsx test/avatar-profile.test.tsx test/kanban-customization.test.tsx test/task-navigation.test.ts test/core-status-business-rules.test.ts test/task-report.test.ts test/task-journey.test.ts test/task-dates.test.ts test/subtask-workflow-contract.test.ts
```

Other commands: `npm run lint`, `node node_modules/typescript/bin/tsc --noEmit --pretty false` (1024 MB heap), and `node node_modules/vite/bin/vite.js build` (1536 MB heap). Browser checks use Vite on loopback port 6337 and `node frontend/e2e/task-groups.mjs`, with `ZEAPLAY_PLAYWRIGHT_MODULE` and optionally `ZEAPLAY_CHROMIUM_EXECUTABLE` set to installed local paths. The existing three status/Kanban Playwright scripts were also executed.

Local evidence: `.tmp/group-ui-review-{units,browser,regressions,tsc,lint,build}.txt`, `.tmp/group-ui-review-tsc-comparison.json` and `.tmp/group-ui-review-changes.patch`. The grouped runner also saves JSON results under the system temporary directory's `zeaplay-task-groups` folder.

## Remaining known issues

- Existing repository-wide TypeScript errors and the absent lint configuration prevent claiming a fully clean production release gate. No new TypeScript diagnostics were introduced in the reviewed files.
- Existing bundle-size warnings remain outside this bounded review.
- Browser/API checks are synthetic and isolated. Live authenticated multi-tenant smoke checks, production load tests and manual assistive-technology checks remain deployment work.
- XP is explicitly an estimate derived from the existing client points configuration and refreshed task/configuration data; authoritative awards remain server-owned.

## Deployment checklist

- [ ] Review and commit only the intended files; preserve unrelated dirty work. Nothing was committed, pushed or deployed by this review.
- [ ] Resolve or explicitly disposition the existing repository TypeScript/lint release gates in the normal release process.
- [ ] Confirm the previously implemented grouped-task backend is deployed. This review adds no endpoint, migration, backfill or Python schema-helper requirement.
- [ ] Build/deploy the frontend with the existing deployment configuration and retain the previous frontend image/revision.
- [ ] Smoke-test an eight-member quest once in Grid, once in List and as eight independent Kanban cards, including a single immutable-ID drag.
- [ ] Verify owner, mixed member capabilities, read-only access and a second tenant; check names, progress and member-specific status/reward information.
- [ ] Check search, status filtering, page changes, group selection, one controlled bulk-action failure, loading/error recovery and keyboard/mobile behavior against the deployed API.
- [ ] If rollback is needed, restore the previous frontend image/revision. No database rollback or history/data alteration is required.
