# Employee avatar and digital ID implementation

Implemented in `F:\Projects\ideashop-zeaplay-v5`. No deployment, container rebuild, live database migration, mail, or push delivery was performed. Existing unrelated working-tree edits were preserved.

The subsequent [refinement review](avatar-profile-refinement-review.md) contains the current security, caching, concurrency and validation results. The verification counts below describe the initial implementation.

## Delivered behavior

- General / Profile uses a shared media editor: original-file preview, circular crop, zoom/reposition, progress, replacement, removal, error feedback, and independent frame selection.
- Classic Slate, Aurora Neon, Solar Flare, Emerald Crest and the previous role/achievement/minimal frames resolve through the same frame helper. Frames now persist with the user.
- One accessible `Avatar` renders photos or deterministic initials and loads protected images as authenticated blobs using 128px or 512px variants. Mounted avatars share a bounded, session-local image cache; unused URLs are revoked on eviction or logout. Profile mutations invalidate list/library caches and publish current profile state without a reload.
- Header, directory, employee details, assignee and mention selectors, task comments, project members, calendar/Gantt, organization tree, ticket approvals/timeline, chat layouts, activity logs, and notification actors use this shared renderer.
- The employee card displays persisted name, email, designation (`title`), employee ID (`employer_id`), department, role, status, bio, and skills. Missing fields have explicit empty states.
- Additional Details groups existing personal, employment, reporting, shift, and professional fields. Assigned Projects loads all pages visible to the viewer and filters actual memberships. Existing free-text project labels are separately labelled; no project assignment is invented from a label.
- A 500-character multiline professional bio and case-insensitively deduplicated skills are editable. Skills reuse the existing JSON string list; suggestions come from authorized users in the tenant. Limit: 30 skills, 60 characters each.
- Existing directory filters, sorting, pagination, presence, points, and activity remain. Details and crop dialogs have keyboard focus handling; the profile card stacks on mobile.

## Component structure

```text
Settings / ProfileSettings
  ProfileInformationForm -> SkillsEditor
  ProfileMediaEditor -> Avatar + AvatarCropModal
Users
  directory -> Avatar
  details dialog -> EmployeeDetails -> EmployeeIdentityCard -> Avatar
  administrative editor -> ProfileMediaEditor + SkillsEditor + existing employee fields
Header / work / project / chat / activity surfaces -> Avatar
API profile mapper -> profileEvents -> mounted Avatar instances
```

The old global browser profile/manager overlays are no longer read or written. Their existing localStorage keys are left untouched for recovery. Persisted backend user data is authoritative. The old browser-only frame key is also retained but is not copied across accounts.

## API and permissions

Existing routes are extended rather than duplicated:

| Route | Behavior |
| --- | --- |
| `GET /api/users`, `GET /api/users/{id}` | Tenant-scoped user records with canonical avatar URLs and bio |
| `PATCH /api/users/me` | Own name, bio, skills, phone, location, timezone, avatar selection/removal and frame; protected employment fields require admin/owner |
| `PATCH /api/users/{id}` | Existing administrative policy; validates same-tenant reporting relationships and existing department references |
| `POST /api/users/me/avatar`, `POST /api/users/{id}/avatar` | Validated data URL plus optional pixel crop and `expected_updated_at`; another user's picture requires admin/owner in the same tenant |
| `GET /api/avatars/limits` | Configured byte limit and accepted MIME types |
| `GET /api/avatars/{id}/image?size=128\|512` | Authenticated tenant-checked image; `private, no-store`, `nosniff` |
| `GET /api/users/{id}/avatar/image` | Authenticated compatibility read for existing MinIO profile-image keys |
| Existing `/api/avatars` library routes | Tenant-filtered library, normalized uploads, safe replacement, referenced-asset deletion protection |
| Existing `/api/media/avatar/finalize` | Delegates to the canonical asset pipeline; no longer writes a competing avatar reference |

Self-profile requests reject unknown fields, including attempts to change role. Managers retain the application's existing administrative policies; they do not gain permission to replace someone else's photo. The department catalogue remains the existing shared catalogue; this change adds no new department tenancy model.

The new editors send `expected_updated_at`. A stale save returns HTTP 409. Row locks serialize photo/profile updates. Old clients can continue using the existing payload contract without the optional conflict token.

No emergency-contact, certification, experience, or other intrusive personal-data fields were introduced. Private phone/location fields require self access or existing administrative authority; administrative notes require administrative authority. Ordinary peer responses and default nested projections omit these fields. Bio and skills are rendered as text, not HTML. Avatar changes and profile updates retain audit events.

## Validation and storage

`avatar_assets` and `users.avatar_asset_id` remain the canonical records. No competing profile table, skill taxonomy, or binary user column was added. The Media Library's configured storage adapter is reused (`local`, `supabase`, or `gdrive`). Public storage is never used as a fallback for a failed private upload.

The backend ignores filenames, limits encoded and decoded size, restricts Pillow's parsers to JPEG/PNG/WebP, checks actual format against declared MIME, verifies and fully decodes the image, checks dimensions/pixel count, rejects animation, applies EXIF orientation and crop bounds, removes metadata, and encodes clean WebP variants. These checks follow [Pillow's image verification and decoding guidance](https://pillow.readthedocs.io/en/stable/reference/Image.html).

Configuration:

| Setting | Default |
| --- | --- |
| `VEE_AVATAR_MAX_FILE_SIZE_MB` | 5 (configurable from 1 to 20) |
| `VEE_AVATAR_MAX_PIXELS` | 25,000,000 |
| Dimensions | Minimum 32px on each axis; maximum 10,000px on either axis |
| Generated variants | 512×512 and 128×128 WebP |

Objects live at `.avatars/{tenant UUID}/{asset UUID}/display.webp` and `thumbnail.webp` within the configured provider. Asset IDs and versioned API URLs refresh caches. The local public media mount denies the private namespace and legacy `assets/avatars/custom` paths.

New files are cleaned on rollback, abandoned sessions, and partial upload failure. Replaced custom variants are deleted only after commit and only when no user references them. Shared/library assets remain intact. Provider cleanup failures retain an unreferenced asset row for retry. Replaced legacy MinIO variants are represented by retryable retirement records.

The maintenance command is read-only by default:

```sh
python -m backend.app.avatar_cleanup
# After reviewing the count, remove unreferenced assets older than one hour:
python -m backend.app.avatar_cleanup --apply
```

Run from the repository root in the intended backend environment. A process termination between writing an object and recording its database row can still require storage-side orphan reconciliation; this command retries recorded assets.

Supabase requires a private bucket. Google Drive requires a private folder; broad inherited public/domain permissions are rejected. These adapters were not exercised against live cloud accounts. Previously issued public URLs outside this application cannot be revoked by changing API serialization alone; review old provider policies when activating this release. Existing legacy files/references are preserved until an explicit replacement/removal.

## Migration and activation

Migration `ffe4b5c6d7e8_employee_avatar_profile.py` depends on the existing navigation migration `ffd3a4b5c6d7` and adds:

- Nullable `users.profile_bio VARCHAR(500)`.
- Nullable `avatar_assets.tenant_id`, `storage_provider`, and `thumbnail_path`.
- A tenant lookup index and creator-based tenant backfill for existing assets.

Existing data is not overwritten. Downgrade is deliberately refused because removing provider metadata would strand new photos. Restore a reviewed backup for rollback.

Before activation, back up the target database and legacy uploads, review its actual Alembic revision, and apply the additive migration through the normal release procedure. An unversioned database needs a reviewed baseline/additive procedure; do not blindly stamp it or run the whole migration chain. No live schema was changed here.

Both Compose files declare `avatar_media_data:/app/media/.avatars` for new private local avatars. This narrowly mounts the new namespace and does not mask the existing media directory. The mount has not been activated. If `VEE_MEDIA_ROOT` differs from the default, align the mount with that path. Preserve existing database volumes, environment files, legacy assets, and media during the normal release. Never use `down -v` for this change.

## Verification

Evidence is in `artifacts/avatar-profile/`:

| Check | Final local result |
| --- | --- |
| Focused backend tests with disposable PostgreSQL | 33 passed |
| Frontend tests | 122 passed |
| Browser scenarios | 12 passed; no recorded browser errors |
| Production frontend build | Passed; existing chunk-size warnings |
| New backend files and rewritten avatar router Ruff | Passed |
| Full frontend typecheck | 118 diagnostics, compared with 123 at baseline; no new normalized diagnostics |
| Notification/password regression | 23 passed, 31 skipped |
| Older chat/project regression suites | Existing fixture failures remain; see logs below |

Typecheck counts include compiler error records, excluding continuation lines. Some resolved baseline diagnostics came from concurrent unrelated work. Local Compose configuration resolves; production Compose resolution is unverified because this checkout has no `.env.production`. Neither configuration was activated.

- `backend-postgres-tests.txt`: focused real-HTTP, validation, permissions, rollback, storage failure, serialization, library sharing, and migration tests on disposable SQLite/PostgreSQL.
- `frontend-tests.txt`: complete configured frontend test files, including component rendering, safe text, fallback/frame, skill controls, and stale-state checks.
- `browser-results.json`, `employee-desktop.png`, `employee-mobile.png`: actual Header, ProfileSettings, and Users components against a disposable backend; crop/save, refresh, frames, skills/bio, filters, mobile card, replacement/removal, and regular-user controls.
- `build.txt`: production Vite build. Existing large-chunk warnings remain.
- `typecheck-baseline.txt`, `typecheck-current.txt`, `typecheck-comparison.json`: repository typecheck is not green; normalized comparison identifies any new diagnostics separately from pre-existing failures and concurrent unrelated fixes.
- `lint-new-files.txt`: full Ruff check of the new backend implementation/tests and rewritten avatar router. There is no configured frontend lint script. `lint.txt` records the broader legacy-module lint failures; these are not represented as a full lint pass.
- `backend-auth-regression.txt`: notification-schema/password-recovery regression results on their isolated fixtures.
- `backend-regression-isolated.txt`, `backend-adjacent-tests.txt`: older chat/project suites are not green. The chat fixture has websocket and obsolete task-stub failures; the project fixture lacks the navigation policy table required by the existing navigation work. The initial old chat fixture also hit a stale SQLite trigger setup error before being rerun in an isolated directory. These suites were not modified to conceal failures.

The test-only browser entry and backend fixture must not be used as production entry points. The production build does not import them. The feature is locally implemented and validated, but repository-wide certification and production activation remain outstanding.

## Files

New backend files: `app/avatar_static.py`, `app/avatar_cleanup.py`, `app/profile_validation.py`, `tests/test_avatar_profiles.py`, `tests/avatar_browser_fixture.py`, and the migration above.

Modified backend files: `app/avatar_utils.py`, `app/config.py`, `app/models.py`, `app/schemas.py`, `app/main.py`, `app/routers/users.py`, `app/routers/avatars.py`, `app/services/minio_media_service.py`, `app/storage/{base,local,supabase,gdrive}.py`, and `app/chat/{serializers,services}.py`.

New frontend components: `Avatar.tsx`, `ProfileMediaEditor.tsx`, `ProfileInformationForm.tsx`, `SkillsEditor.tsx`, `EmployeeIdentityCard.tsx`, `EmployeeDetails.tsx`. New support: `services/profileEvents.ts`, `test/avatar-profile.test.tsx`, `e2e/avatar-profile.mjs`, `e2e/avatarProfileFixture.tsx`.

Modified frontend integration files: `pages/ProfileSettings.tsx`, `pages/Users.tsx`, `components/Header.tsx`, `components/AvatarCropModal.tsx`, `components/AvatarPicker.tsx`, `constants/avatarFrames.ts`, `services/mockApi.ts`, `services/tokenStorage.ts`, and `types.ts`.

Shared-avatar adoption: `components/{CreateTaskModal,CreateUserModal,EditUserModal,OrganizationTreeSection,SameTaskLogModal,TaskDetailModal}.tsx`, `components/ui/{MultiSelect,MentionPicker}.tsx`, `components/Tickets/{TicketApprovalPanel,TicketStatusTimeline}.tsx`, `pages/{Projects,CalendarView,GanttView,LevelsManager,Logs}.tsx`, `features/chat/ChatApp.tsx`, and `features/chat/components/{ChatSidebar,ConversationListItem,EmptyChatState,MemberPanel}.tsx`.

Deployment configuration: `docker-compose.yml`, `docker-compose.prod.yml`. This document and validation artifacts complete the handoff. Other dirty/untracked files in the checkout belong to prior or concurrent work and are outside this change.
