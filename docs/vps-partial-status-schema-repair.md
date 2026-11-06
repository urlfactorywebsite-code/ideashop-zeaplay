# VPS partial status schema recovery

Prepared on 2026-11-05 for `/opt/ideashop-zeaplay`. No VPS repair has been executed
by Codex. The user-supplied PostgreSQL traceback reports a missing
`tasks.custom_status_id` inside `zea_behavior_guard`, while the read-only gate
reports seven missing task columns, the missing board index and no migration
revision. The registry tables and database guards already exist.

## Scope

`backend/scripts/repair_partial_status_schema.py` accepts this exact partial
schema, with empty status scopes, statuses, configuration audits and hold history.
It refuses populated new tables, recorded Alembic revisions, additional missing
columns, missing/disabled guards and other schema drift. Its default mode is
read-only. An already compatible unversioned database is checked without mutation.

The repair adds the seven task columns, a restricted status foreign key, the
custom-status index and the composite board index. It provisions tenant workflows
through the existing registry service, preserving legacy Kanban labels. Legacy
ON_HOLD tasks receive an interval starting at the repair cutover, matching the
existing Phase 3 policy; earlier hold time is not estimated. The task's native
status, ID, original deadline, points and existing timestamps are preserved.

All changes run in one PostgreSQL transaction with bounded lock/statement waits.
Every old column/row outside the initially empty new tables is fingerprinted before
and after. Any schema/data/preservation verification error rolls back the repair.
No existing trigger is disabled, no old record is deleted and no Alembic version
is created/stamped. Fingerprint reports contain counts and hashes, never record
contents, credentials or tokens.

## Transfer and execute

Upload these two files into the same private directory on the VPS, such as `/root`:

- `ops/repair-partial-status-schema.sh`
- `backend/scripts/repair_partial_status_schema.py`

For example, from this Windows checkout, replacing `YOUR_VPS_IP`:

```powershell
scp ops/repair-partial-status-schema.sh backend/scripts/repair_partial_status_schema.py root@YOUR_VPS_IP:/root/
```

Then, in the VPS SSH terminal:

```bash
bash /root/repair-partial-status-schema.sh --apply
```

The wrapper uses the exact existing backend image, network and container
environment. It does not build, pull or change application configuration. It:

1. Performs read-only preflight and checks the backup target.
2. Stops backend and presence writers for the maintenance window.
3. Saves a private full custom-format dump under `/root/zeaplay-status-repair.*`
   and verifies its archive listing.
4. Restores it into a new rehearsal database; repairs and verifies that database,
   then repeats the repair to confirm it makes no further changes.
5. Repairs the original database only after the rehearsal succeeds; retains JSON
   results, fingerprints and the restored rehearsal database for review.
6. Restarts the same containers, checks local `/ready`, and gracefully reloads
   the frontend gateway so Nginx resolves the restarted upstream addresses.

If preflight refuses, nothing has been stopped or changed. If backup, rehearsal
or repair fails, inspect the reported phase, logs and container state before
resuming writers. If readiness fails after commit, the message explicitly says
the repair committed; inspect backend logs instead of repeating migrations.

Refresh Tasks and Status Management after success and confirm task list, Kanban
and status reads. `/ready` should report database/realtime true. The strict
`check_status_integrity.py` gate will still report
`migration_revision_not_f339a0b1c2d3` because this recovery preserves the
unversioned installation. Establishing its historical migration baseline remains
separate work; stamping would not validate that history.

If an earlier repair completed with local readiness true but the public API
returns 502, first refresh the gateway's upstream addresses:

```bash
docker exec zeaplay_frontend nginx -t &&
docker exec zeaplay_frontend nginx -s reload
curl -fsS https://api.ideashop.zeacrm.com/ready
```

This is a graceful configuration reload. It does not repeat the database repair.

## Local verification

- Six PostgreSQL recovery tests passed. Six SQLite cases were explicitly skipped
  because this helper supports PostgreSQL only.
- Tests cover pre-existing value/history preservation, legacy hold cutover,
  authenticated status/list/Kanban reads, a repeat apply without changes, refusal
  of drift/populated status data/versioned databases, preservation of an empty
  version table and full rollback after an injected verification failure.
- The mounted CLI was also exercised using the existing Linux backend image and
  a full dump restored into an isolated synthetic PostgreSQL database.
- The wrapper's backup/restore/repeat/restart/readiness workflow passed on the
  repaired test database. Packaged authenticated HTTP reads returned 200 for
  statuses, task pagination and Kanban; `/ready` reported both checks true.
- Ruff and Bash syntax checks passed. No persistent application database or VPS
  database was changed during validation. These checks do not certify all
  production data or the full application release.
