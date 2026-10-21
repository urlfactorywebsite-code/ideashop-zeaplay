# Avatar and employee profile refinement review

Reviewed on 2026-10-21 in `F:\Projects\ideashop-zeaplay-v5`.

**Feature verification: PASS in isolated local tests. Repository-wide quality gate: FAIL.** The feature tests and production frontend build pass; the full frontend typecheck and broader legacy-module Ruff checks remain nonzero. This is not production certification. No deployment, live migration, or application-container rebuild was performed.

## Issues fixed

1. **Private profile data exposure.** `UserRead` now omits phone, location, and administrative notes by default, including nested task/comment-related user projections. User routes explicitly authorize private fields using the authenticated viewer and existing administrative hierarchy. Own phone/location remain available; ordinary users do not receive administrative notes. Storage keys and raw legacy image payloads are excluded from response serialization. Legacy user references to a different tenant's avatar expose neither its metadata nor its image URL. Reusing a serialized model for another viewer cannot retain the first viewer's private-field authorization. Tenant-visible work email remains part of the employee identity card.
2. **Private static-path bypass on Windows.** The static guard now normalizes separators, dot segments, and case, checks resolved paths, and rejects invalid paths. Authenticated image endpoints remain tenant checked; normal uploads still reject SVG and other unsupported content.
3. **Broken shipped avatars.** The ten immutable repository SVG avatars retain their existing static URLs through an exact ID/path allowlist. This does not enable SVG uploads or arbitrary SVG paths.
4. **Concurrent writes accepting stale versions.** Row-lock queries now refresh the SQLAlchemy identity map after obtaining the lock. Two PostgreSQL uploads with the same version produce one success and one 409. Offset-bearing timestamps compare by UTC instant. Asset selection coordinates with cleanup and library mutation through asset-row locks.
5. **Cleanup around savepoints and legacy uploads.** Staged variants are tracked by transaction. Savepoint commit cannot prematurely discard rollback cleanup, and savepoint rollback removes only its own staged variants. Failed post-commit deletion retains a retryable retirement row. Legacy MinIO finalization now uses the canonical pipeline, locks the user, retires the original upload after commit, and records failed deletion for retry. Unused competing raster/crop/encoding helpers were removed.
6. **Invalid edge crops.** Rounded crops containing no pixels now return 400 rather than reaching the image encoder with an empty image.
7. **Repeated requests and stale rendering.** Authenticated blob images share in-flight requests by versioned URL and variant. The cache is memory-only, bounded to 48 idle entries, and expires idle entries on subsequent cache activity after 60 seconds. Logout clears it. Minimal user lookups share in-flight work. Old-session profile reads and stale version responses cannot repopulate current avatar state. Library replacements also publish updated URLs to mounted avatars.
8. **Frame and layout consistency.** All seven existing frames are selectable through the same definitions. Missing card fields have explicit empty states; long text wraps. Avatar sizes match existing containers. The directory table scrolls horizontally within its container, and filter/action/page-size controls have accessible names. Obsolete avatar calculations and initials imports were removed.
9. **Cloud privacy checks and legacy migration recovery.** Supabase private uploads reject public or unknown bucket visibility. Google Drive checks every permissions page before uploading. The unapplied additive migration can recover a creatorless custom avatar's tenant when all its remaining references belong to exactly one tenant.
10. **Employee input lengths.** Write validation now matches existing database limits for IDs, designation, manager email, timezone and shift fields, so overlong values return validation errors rather than database errors. Existing field formats and stored data are preserved.

## Review matrix

| # | Review area | Result and evidence |
| --- | --- | --- |
| 1 | Upload, normalization, crop, replacement, removal | PASS: real HTTP JPEG/PNG uploads, decoded WebP 512/128 variants, crop bounds, replacement/removal and persisted reload; browser scenarios cover the complete controls. |
| 2 | XSS, traversal, unsafe files | PASS: unsupported SVG, corrupt/truncated images, MIME mismatch, animation, excessive size/pixels, polyglot trailing content and edge crops tested; safe React text rendering; static case/separator and sibling-directory traversal tests. |
| 3 | Durable storage and URLs | PASS locally: fresh storage adapter reads persisted files, canonical protected URLs and shipped SVG URLs work; existing named volume configuration retains `.avatars`. Cloud account deployment is NOT VERIFIED. |
| 4 | Safe old-image/thumbnail cleanup | PASS: replacement/removal, shared references, explicit rollback, abandoned session, savepoints, failed provider deletion/retry, and legacy original cleanup tests. |
| 5 | Cross-surface avatar propagation | PASS: browser checks cover Settings, Header, Directory, Details, and actual mounted Projects/TaskDetailModal/comment-author components. |
| 6 | No full-page refresh | PASS: mutation updates mounted views with unchanged document marker; removal propagates too. |
| 7 | Desktop, tablet, mobile card | PASS: 1440px, 768px and 390px browser screenshots and bounds checks; mobile card fits inside the viewport and the details dialog scrolls. |
| 8 | Missing/empty fields | PASS: component tests cover absent name, role, status, ID, email, bio and designation; activity values default to zero. |
| 9 | Bio and skills | PASS: persisted 500-character bio limit, safe multiline display, 30/60 skill limits, whitespace normalization, duplicate prevention and removal. |
| 10 | Additional Details structures | PASS: existing user contact/employment/shift/manager/notes/skills fields and authorized project memberships are reused. Free-text project labels remain separate from assignments. No emergency-contact collection or new parallel profile table. |
| 11 | Existing role permissions | PASS: existing administrative hierarchy is reused; managers retain permitted employment editing but cannot change another user's photo/frame or manage an administrator. |
| 12 | Restricted updates | PASS: self-service rejects role/status/points/title/manager/notes fields and denies employment/department/ID/shift changes by ordinary users; administrative routes reject unauthorized callers. |
| 13 | Cross-tenant access | PASS: profile reads/updates, avatar selection/image retrieval/library mutation and directory isolation tested; an explicit asset tenant overrides a conflicting legacy creator, and legacy foreign references cannot expose asset metadata/URLs. |
| 14 | Sensitive responses | PASS: unauthorized list/detail/employer-ID/default nested projections omit private fields entirely; own contact fields and permitted administrative reads are tested. |
| 15 | Migration compatibility | PASS for additive upgrade and data preservation on SQLite/PostgreSQL, including an existing creatorless custom photo. Existing columns/references are not rewritten. Lossy downgrade remains deliberately refused. |
| 16 | Directory behavior | PASS: name, employee ID, role, department, combined filters, page size, next/previous pages and existing action-menu availability tested with 14 synthetic employees. |
| 17 | Frame customization | PASS: all seven values accepted/persisted by the API and rendered/selectable in component tests; frame survives upload, reload and removal in browser tests. |
| 18 | Loading/caching | PASS: unit tests prove in-flight sharing, size/version separation, bounded idle eviction, retry, and session clearing. Browser checks permit at most one request per variant across mounted project/task/comment/header views. |
| 19 | Duplicate/unused logic | PASS within scope: shared renderer remains authoritative; competing MinIO raster helpers, redundant decorators/hydrators, dead URL calculations and old initials imports removed. |
| 20 | Lint/typecheck/tests/build | MIXED: feature tests, frontend tests, focused Ruff, build and whitespace checks PASS. Full typecheck and broader legacy-module Ruff FAIL as detailed below. |

## Concrete verification evidence

All evidence is under `artifacts/avatar-refinement/`. Synthetic users and images were used. Backend fixtures create disposable SQLite files and schemas in a disposable PostgreSQL 16 container; they do not use the running application database. External browser network access is blocked except the loopback fixture; project/task data is synthetic while profile/avatar operations use real HTTP endpoints and JWT authentication.

| Check | Result | Evidence |
| --- | --- | --- |
| Backend avatar/profile suites | 59 passed, 1 skipped | `backend-tests.txt`; skip is the SQLite version of the PostgreSQL row-lock concurrency test |
| PostgreSQL concurrency regression | 1 passed; SQLite variant skipped | `concurrency-tests.txt` |
| Frontend tests | 127 passed | `frontend-tests.txt` |
| Browser scenarios | 16 passed, no recorded page errors | `browser-results.json`, `browser-log.txt` |
| Production Vite build | PASS; existing chunk-size warning | `build.txt` |
| Focused Ruff | PASS | `lint-focused.txt` |
| Full frontend typecheck | FAIL: 118 diagnostics before and after; no new diagnostics | `typecheck-baseline.txt`, `typecheck-current.txt`, `typecheck-comparison.json` |
| Broader Ruff on six touched legacy modules | FAIL: 925 diagnostics, predominantly legacy typing/style rules | `lint-legacy.json`, `lint-summary.json` |
| Whole backend application Ruff | FAIL: 3,231 diagnostics | `backend-full-lint-statistics.txt`; no broad automatic fixes applied |
| Whitespace validation | PASS | `diff-check.txt` |
| Notification/password regression | 48 passed, 6 skipped | `auth-regression.txt`; skips cover PostgreSQL-only checks on SQLite and tests requiring a separately configured Redis fixture |

There is no configured frontend lint script. Focused Ruff covers the avatar implementation/router, validation, static guard, cleanup utility, migration, and feature test fixtures. The broader lint result is reported separately rather than represented as a full lint pass. Unrelated repository-wide typing/style changes were not made. Earlier chat/project suite failures from the initial implementation are not re-certified by this review.

The concurrency test initially reproduced two successful writes for one expected version, then passed after refreshing locked ORM instances. The first browser expansion had a case-sensitive test selector mismatch (`Reset Password`), corrected before the passing run. The SQLite savepoint test explicitly begins its outer transaction because pysqlite's legacy transaction mode does not begin one for SELECT alone.

Commands executed from the repository root (frontend commands from `frontend/`):

```text
python -m pytest backend/tests/test_avatar_profiles.py backend/tests/test_avatar_refinement.py -q --disable-warnings
python -m pytest backend/tests/test_notification_schema.py backend/tests/test_password_recovery.py -q --disable-warnings
frontend/node_modules/.bin/tsc.cmd --noEmit -p frontend/tsconfig.json
python -m ruff check backend/app --statistics
git diff --check

# frontend/
npm test -- test/*.test.ts test/*.test.tsx
npm run build
node e2e/avatar-profile.mjs
```

PostgreSQL checks used `ZEAPLAY_RT_POSTGRES_TEST_URL` pointing only to disposable `rt3_test_avatar_review` on loopback port 65439. Browser checks used fixture ports 6348/6349, the installed Playwright module and a local Tailwind fixture bundle. Those services and the disposable database container were stopped after validation. The live application services were not changed by this review.

Screenshots: `employee-desktop.png`, `employee-tablet.png`, `employee-mobile.png`. The visible script-like bio is deliberate test text rendered safely, not executed. A blocked external logo in the fixture does not validate production logo delivery.

## Remaining activation limits

- No live schema, Compose mount, service image, or production route was activated or certified. Review the actual target revision and back up data/media before applying the additive migration; do not blindly stamp an unversioned database.
- Supabase and Google Drive checks are tested with controlled SDK stubs, not live accounts. Actual bucket/folder policies, credentials, persistent-volume retention and service restart behavior on the deployment host need release verification.
- A process crash or provider failure while cleaning an uncommitted upload can still leave a storage-only orphan. Recorded retirement rows can be retried with the existing cleanup command; storage-only orphans require provider reconciliation. Previously issued public provider URLs cannot be revoked by API serialization alone.
- A legacy creatorless custom avatar referenced across multiple tenants is deliberately not assigned to a guessed tenant. Such ambiguous legacy data requires reviewed remediation.
- Migration downgrade is intentionally refused to avoid losing storage metadata. A reviewed backup is the rollback mechanism.
- The implementation does not add remote cross-device realtime avatar broadcasts; current-session mutations update mounted views, and normal authenticated reload/refetch retrieves persisted changes.

## Main files touched during refinement

Backend: `app/avatar_utils.py`, `app/avatar_static.py`, `app/models.py`, `app/schemas.py`, `app/profile_validation.py`, `app/routers/{users,avatars,auth}.py`, `app/services/minio_media_service.py`, `app/storage/{supabase,gdrive}.py`, the existing unapplied avatar migration, `tests/avatar_browser_fixture.py`, and new `tests/test_avatar_refinement.py`.

Frontend: new `services/avatarResources.ts`; `services/{profileEvents,mockApi}.ts`; `utils/userAvatar.ts`; `components/{Avatar,ProfileMediaEditor,EmployeeIdentityCard,EmployeeDetails,Header,SameTaskLogModal,CreateTaskModal,TaskDetailModal}.tsx`; `pages/{Users,LevelsManager}.tsx`; obsolete initials imports in four chat components; and the avatar component/browser tests and fixtures.

The serializer uses Pydantic's documented model-serialization mechanism and private attributes for server-set authorization state ([serialization documentation](https://docs.pydantic.dev/latest/concepts/serialization/), [private attributes](https://docs.pydantic.dev/latest/concepts/models/#private-model-attributes)). Static-path checks supplement the framework's containment behavior ([Starlette StaticFiles](https://www.starlette.io/staticfiles/)).
