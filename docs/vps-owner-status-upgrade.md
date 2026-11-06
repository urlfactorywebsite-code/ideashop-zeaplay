# Hosted Status Management save conflict - 2026-11-06

Public checks confirm `https://api.ideashop.zeacrm.com/ready` returns **503** with
`database: false, realtime: true`. The current API exposes the new label catalog,
so application code alone is not the missing deployment step. The user's PUT
returns the generic IntegrityError conflict message. A stale owner-control
constraint/guard is a likely cause, as seen locally; it must be confirmed by the
server-side schema preflight. This message does not establish duplicate labels.

SSH from this Codex session was refused. **No VPS database or deployment was
changed.** Local database repair does not repair the hosted PostgreSQL database.

## Run the guarded upgrade

After the reviewed repair commit is pushed to `origin/main`, run in the existing
VPS checkout:

```bash
cd /opt/ideashop-zeaplay &&
git pull --ff-only origin main &&
python3 ops/upgrade-owner-status-schema.py --apply &&
curl -fsS https://api.ideashop.zeacrm.com/ready
```

This uses the checkout files with the exact running backend image. No rebuild is
needed for the database repair. Pulling source alone does not run the migration.
If Git refuses because of local changes or divergent history, stop and inspect
them; do not reset the server checkout or discard its configuration.

Alternatively, use the prepared `owner-status-vps-upgrade.zip` bundle. It contains
only these files and this runbook:

- `ops/upgrade-owner-status-schema.py`
- `backend/scripts/apply_owner_status_schema.py`

Copy the bundle to `/root` using your existing VPS connection. From this Windows
checkout, the transfer command is:

```powershell
scp .tmp/owner-status-vps-upgrade.zip root@167.86.108.178:/root/
```

In the VPS terminal:

```bash
python3 -m zipfile -e /root/owner-status-vps-upgrade.zip /root/owner-status-vps-upgrade
python3 /root/owner-status-vps-upgrade/ops/upgrade-owner-status-schema.py --apply
```

Without `--apply`, the wrapper performs read-only preflight. It uses existing
`zeaplay_backend`, `zeaplay_postgres`, `zeaplay_presence`, `zeaplay_frontend`
containers; exact names can be supplied with `STATUS_BACKEND_CONTAINER`,
`STATUS_POSTGRES_CONTAINER`, `STATUS_PRESENCE_CONTAINER`, `STATUS_FRONTEND_CONTAINER`.
It verifies that the backend database matches the PostgreSQL backup target.

The wrapper does not build/pull images, change environment files, recreate
application containers, or stamp Alembic history. It mounts the reviewed helper
into a one-shot instance of the exact existing backend image. Its environment
and credentials stay in process memory/stdin, not logs or command arguments.

For the exact eligible unversioned baseline it:

1. Stops backend/presence writers, saves a full custom-format PostgreSQL dump
   under a private `/root/zea-owner-upgrade-*` directory and checks its listing.
2. Restores into a separate `zea_owner_rehearsal_*` database, applies only
   existing owner-control revision `f44ab1c2d3e4`, verifies unchanged records,
   schema/integrity and an unchanged second apply.
3. Applies to the original database in a transaction **only if every table's
   count/hash matches the verified restored copy**. Table locks protect the
   comparison/DDL/verification; mismatches or verification errors roll back.
4. Restarts the same containers, waits for direct readiness, validates/reloads
   frontend Nginx, and retains backup, fingerprints and rehearsal database.

Production CLI applies without restored-backup proof remain refused. Database
overrides accept only a separate `zea_owner_rehearsal_*` name. Versioned schemas,
unknown drift, extra missing indexes/guards, data errors and stale proof refuse
without applying DDL. An already compatible schema exits without stopping writers.
Do not rename constraints, disable guards, set the environment to development,
stamp head or run the unrelated partial-schema repair to bypass refusal.

If the wrapper stops, inspect the named private stderr/JSON files and container
state before resuming writers. If it reports the upgrade committed but readiness
failed, diagnose runtime/proxy health; do not repeat schema repairs. Preserve
evidence and the full backup. Recovery means restoring into a separate database
and verifying it with the matching application version, not overwriting later
user writes. The migration downgrade also requires all native statuses active
and visible. Historical Alembic baseline adoption remains separate work.

After success, verify:

```bash
curl -fsS https://api.ideashop.zeacrm.com/ready
```

Then refresh Status Management, reload the current revision and retry the intended
save. Check All Tasks and Kanban totals, inactive-status tasks and saved display
names. A fresh 409 on an already healthy schema needs its server-side cause
investigated; the wrapper will not force an unrelated data change.

## Source validation and limitations

Settings save/removal now checks the installed status schema after owner
authorization and before mutation. An incomplete deployment returns **503** with
`Status configuration database upgrade required...`, while actual duplicate,
assignment and revision conflicts retain their existing validation/status codes.
This improved error requires deploying the updated backend source; the guarded
database repair itself uses the already installed status migration.

PASS: 100 backend tests and 7 dialect-specific skips across SQLite and an empty
PostgreSQL test database, plus one separate production CLI refusal test. Suites:
`test_owner_status_schema_upgrade.py`, `test_owner_status_controls.py`,
`test_task_status_management.py`, `test_status_display_labels.py`. These include
proof matching/refusal, rollback, incomplete-schema 503 responses, immutability,
RBAC, tenancy, duplicate labels, concurrency and preserved histories/scoring.
PASS: 23 frontend tests for labels, Kanban, core behavior and avatars; Ruff and
whitespace checks. Browser E2E was not rerun for this backend/operations change.

PASS: the wrapper's complete production-mode Docker flow on a restored full
backup: stop, backup/list validation, restore, upgrade/repeat, all 107 table
fingerprints unchanged, verified live upgrade, restart, readiness and Nginx
validation/reload. A transient closed HTTP connection during the first restart
exposed a polling bug; retries now cover that condition and the complete flow
passed on a fresh restored disposable target. The original application containers
and database were not used as upgrade test targets.

PASS: authenticated HTTP on the isolated production-mode API after upgrade:
`DEPLOYED` deactivation 200, renamed-status PUT 200, native ID retained, task page
and Kanban both account for all 9 tasks. A repeat wrapper invocation returned
`already_compatible` without stopping services or changing records. Private local
wrapper evidence/backups are under
`C:\Users\Lenovo\.codex\backups\ideashop-zeaplay-v5\vps-owner-wrapper-validation`.

No claim of VPS repair success can be made until the operator runs the wrapper
and returns its output, public readiness passes and the intended authenticated
save succeeds. No remote credentials or tokens are included in the bundle.
