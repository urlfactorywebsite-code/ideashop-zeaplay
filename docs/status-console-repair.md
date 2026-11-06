# Local Status Management console repair - 2026-11-06

The local API on port 6311 had application/schema drift. Owner deactivation and
configuration saves encountered the previous `NOT is_system OR is_active`
constraint, and the native-assignment guard from `f44ab1c2d3e4` was missing.
The failed removal request targeted the non-core native status `DEPLOYED`.
`/ready` returned 503. The running application also predated the shared display
name catalog. The avatar 404 was separate: an existing legacy asset referenced a
file absent from the application image and available local backups.

## Changes and local migration

- Added `backend/scripts/apply_owner_status_schema.py`: read-only by default;
  accepts only the reviewed unversioned PostgreSQL baseline or an already
  compatible schema. Refuses versioned databases, other schema drift, data
  integrity errors and production applies. Locks tables, executes only the
  existing owner-control revision, verifies every existing record, and rolls
  back on verification failure. Does not stamp Alembic history.
- Applied existing revision `f44ab1c2d3e4` on a restored backup first, including
  an unchanged second apply. Then stopped the local backend, took a fresh full
  backup and applied the same upgrade locally. All 107 table fingerprints were
  unchanged, including all 9 tasks and existing histories/configuration/audits.
- Rebuilt and recreated only the local backend/frontend. Added
  `ops/deploy/status-runtime.compose.yml` to keep startup schema bootstrap
  disabled for this explicitly migrated installation.
- Updated `backend/app/avatar_utils.py` to return no image URL for a missing
  legacy local avatar file. Existing UI initials are used. The database asset
  and original file reference remain intact; restoring the file restores its
  URL. No replacement photo or destructive asset cleanup was performed.
- Added `backend/tests/test_owner_status_schema_upgrade.py` and a regression in
  `backend/tests/test_avatar_refinement.py` for these repairs. Earlier owner
  controls and shared display-name changes were included in the local rebuild.

Backups are outside the repository:
`C:\Users\Lenovo\.codex\backups\ideashop-zeaplay-v5\20261106T062612Z-owner-controls`.
`rehearsal.dump` was restored successfully; `before-apply.dump` was taken with
writers stopped. Both custom-format archive listings were verified. The latter
is 386586 bytes, SHA-256
`b8048c6dba430fccee82a5f1a960df8bfb71998d8f15f018141b699f5dfe6330`.

## Verification

- PASS: restored-data upgrade, idempotent repeat, live upgrade and unchanged
  before/after fingerprints. Schema guard/index checks have no issues; data
  integrity has no errors or warnings (9 tasks, 1 scope).
- PASS: live `/ready` is 200 with database/realtime true; frontend `/api/health`
  proxy is 200. Authenticated status configuration, inactive-inclusive catalog,
  task page, Kanban and affected user-profile reads return 200.
- PASS: live owner controls are available; 11 configured native statuses resolve
  to their saved labels. Task page and Kanban both account for all 9 tasks;
  unmapped task count is zero. Missing-avatar profile returns `avatar_url: null`
  and retains the asset/file reference.
- PASS: backend/frontend Docker builds; 23 frontend tests for avatars, labels,
  Kanban and core behavior; Ruff on the four Python files changed for this fix.
- PASS: final backend run, **157 passed, 6 skipped** across SQLite and the empty
  PostgreSQL test database. Suites: `test_owner_status_schema_upgrade.py`,
  `test_avatar_profiles.py`, `test_avatar_refinement.py`,
  `test_owner_status_controls.py`, `test_status_display_labels.py` and
  `test_task_status_management.py`. Coverage includes migration rollback and
  refusal, owner-only RBAC, immutable identities, cross-tenant rejection,
  concurrent assignments/deactivation, retained histories, duplicate names and
  restored-avatar recovery. Skips are dialect-specific cases; existing
  deprecation warnings remain.
- PASS: 91 synthetic browser checks (17 shared-label, 45 Status Management,
  29 Kanban), including owner controls, accessible tooltips and reordering,
  live preview, long labels, responsive layouts and retained hidden-status tasks.

An initial additional PostgreSQL run used the populated restore database. The
existing fixtures include `public` in their search path and picked up restored
tables, causing 11 failures. This affected only the disposable restore. Final
regressions use a separate empty `rt3_test` database. Never point these fixtures
at a populated database. No fixture behavior or unrelated application feature
was changed to conceal that result.

## Deployment and recovery

The local repair is already applied. For subsequent starts of this installation:

```powershell
docker compose -f docker-compose.yml -f ops/deploy/status-runtime.compose.yml up -d --no-deps backend frontend
```

For another **matching unversioned development** installation: first stop writers,
take and validate a full backup, and rehearse its restore. Build matching code,
run the helper without `--apply` to inspect eligibility, then apply only if its
baseline matches. Use the same Compose files above with
`run --rm --no-deps backend python scripts/apply_owner_status_schema.py --apply`.
Verify `/ready`, authenticated reads, counts and labels before resuming use.
The helper does not create a backup. It is not a VPS/production migration tool.

Versioned installations should use their reviewed Alembic upgrade through
`f44ab1c2d3e4`. The existing revision's downgrade refuses until every native
status is active and visible. For this unversioned repair, recover into a separate
database from the full backup, verify it, and pair it with the matching previous
application image before switching connections; do not blindly stamp or downgrade
the historical chain. Do not restore over a database containing later user writes
without a reviewed reconciliation plan.

Refresh the local browser to load the rebuilt app and fresh status/profile data.
To recover the missing portrait, restore its original file from an external
backup or upload the photo again through the existing profile controls.

This is local repair evidence, not whole-application production certification.
The database remains historically unversioned; the strict production migration
gate still requires a reviewed baseline adoption. Existing TypeScript baseline
issues and earlier release-review limitations remain separate work. No VPS or
production database was modified.

Follow-up: the separately tested, backup-first VPS entry point is documented in
`vps-owner-status-upgrade.md`. Direct production CLI applies still refuse without
verified restored-backup proof. The local success above does not establish hosted
schema compatibility or hosted repair success.
