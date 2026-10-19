# Release Checklist Verification

Date: 2026-10-15 (Asia/Calcutta)

Decision: NO-GO. This is verification evidence, not deployment or runbook approval.

Source snapshot: commit `6631576` (`Websocket Update`), initially clean working tree. Application code, production data, balances, and migrations were not changed by this check. New artifacts are this report and supplementary accounting probes.

## Checklist

PASS (local) means the specified behavior passed the available automated tests on SQLite. It does not certify PostgreSQL locking, a restored production database, browser behavior, or live external providers. PARTIAL and BLOCKED items remain unchecked for release.

| Requested gate | Result | Current evidence / missing evidence |
| --- | --- | --- |
| Verified database backup and restoration test | BLOCKED | No production-like backup, restore transcript, or verified recovery artifact available. |
| All migrations passed on production-like data | BLOCKED | Repository graph resolves to one head, `fb3c4d5e6f7a`, across 32 revisions. No restored PostgreSQL upgrade was executed. Previously reported revision `7g8h9i0j1k2l` is still absent from source; the live target revision was not queried in this check. |
| Existing user and reward balances reconciled | BLOCKED / FAIL | No production before/after reconciliation. Existing synthetic migration preservation test passes, but a supplementary stale-claim probe produces a duplicate refund. |
| Legacy tasks and subtasks preserved | PARTIAL | Phase 5/6/11 legacy fixtures pass. No row-count/hash comparison on a restored backup. Historical completion XP probe fails. |
| All new endpoints enforce tenant isolation | PARTIAL | Client/contact/project/task/timer/evidence/notification security tests pass, including eight Phase 13 tests. This is not an exhaustive proof for every endpoint and alternate path. |
| Multiple project manager permissions verified | PASS (local) | Seven Phase 4 tests and Phase 13 manager permission matrix pass. |
| Sequential and parallel handoff tests passed | FAIL | Full run: simultaneous completion test returns statuses `{200, 404}` instead of `{200}`. Isolated retry passes. Sequential/parallel functional tests pass; intermittent concurrent behavior remains unresolved. |
| Force-start and reopen audit tests passed | PASS (local) | Phase 7 force-start reason/actor/history, unauthorized override, reopen and rollback tests pass; Phase 13 audit tests pass. |
| Timers survive refresh and concurrent requests | PASS (API tests) | All 15 Phase 8 tests pass, including client recreation, duplicate start/stop, UTC, corrections, overlap prevention and totals. Actual browser refresh/sleep and multi-process PostgreSQL verification remain open. |
| Evidence uploads and downloads secured | PARTIAL | All 11 Phase 9 tests pass, including signature/MIME/size validation, authorization and revoked access. Private local evidence has no persistent backend media mount in production Compose. |
| In-app and email notification tests passed | PASS (mocked delivery) | All nine Phase 10 tests pass: dedupe, retry, provider failure, stale worker recovery, tenant/recipient authorization. Real provider delivery and crash-window duplicate delivery remain unverified. |
| All 11 existing backend task statuses supported | PASS (local) | Backend enum, frontend enum, Phase 5 serialization and Phase 11 counts support all 11 values, including BUG_FIXING and DEPLOYED. Six subtask statuses remain separate. |
| No duplicate parent task XP awards | FAIL | Existing eight Phase 12 tests pass for their fixtures. Supplementary historical-task reopen probe changes points/completion count from `(40, 1)` to `(80, 2)`. |
| Frontend build, backend tests and end-to-end tests pass | FAIL | Frontend 38/38 and production build pass; backend 170 pass / 1 fail. TypeScript fails. Browser E2E was not run; no configured browser E2E suite was found. |
| Deployment rollback and forward-fix runbooks approved | PENDING | Procedures exist in reports 03/08 and the VPS guide; no approval record or recovery rehearsal verified. Several downgrades drop history-bearing tables or XP guards. |

## Release Blockers Found

### Historical task XP can be awarded again

`backend/alembic/versions/fb3c4d5e6f7a_add_task_completion_xp_award_marker.py` adds nullable markers without reconciling prior awards. `backend/app/services/gamification.py:120` checks the marker before awarding; `backend/app/routers/tasks.py:2874` calls it when reopened work becomes complete again.

Supplementary probe creates an already-rewarded historical DONE task with a NULL marker and a user with 40 XP / one completed task. An authorized API PATCH to TODO followed by POST to `/api/tasks/{id}/complete` results in 80 XP / two completions. The expected preserved state is 40 XP / one completion.

Required resolution: establish a historical-award compatibility policy from actual historical evidence and prevent repeat awards without resetting balances, awarding historical XP, or introducing a clawback. Existing tests only cover reopening tasks whose new award marker was already populated.

### Stale reward rejection can refund twice

`backend/app/services/rewards.py:570` reads a claim through `db.get`, checks PENDING, then adds `xp_spent` to the user balance. It does not lock/refresh the claim or atomically claim the pending-to-rejected transition.

Two sessions first read the same PENDING claim for 40 XP. Starting at a post-spend balance of 60, rejecting in the first session restores 100. Rejecting with the second session's stale claim restores another 40, ending at 140. The expected result is 100 and one effective refund.

The probe uses two sequentially interleaved sessions to reproduce stale state deterministically. This is not a PostgreSQL race certification. Required resolution: serialize/atomically guard claim resolution and balance mutation; test approve-versus-reject and parallel refunds on isolated PostgreSQL.

### Completion concurrency test is intermittent

`backend/tests/test_tasks_phase7.py::test_simultaneous_completion_requests_do_not_duplicate_activation_history` failed in the full suite and passed alone on retry. The shared in-memory SQLite StaticPool fixture cannot certify PostgreSQL row locking. The failure must be investigated rather than erased by the passing retry.

### Evidence files lack durable deployment storage

`backend/app/services/subtask_completion.py:89` stores proofs under `<media_root>/private/completion-evidence`. The backend service in `docker-compose.prod.yml` has no media volume; only PostgreSQL and Redis volumes are declared. Selecting an external media provider does not change this evidence service's local file writes.

Container replacement can leave attachment metadata pointing to missing files. Required resolution: durable private evidence storage, backup coverage for that storage, and an upload/download verification after container recreation. Endpoint access-control tests currently pass.

## Fresh Validation Results

| Check | Result |
| --- | --- |
| Full backend suite | FAIL: 170 passed, 1 failed, 4770 warnings, 129.07 seconds |
| Isolated retry of failing workflow test | PASS: 1 passed, 37 warnings, 3.25 seconds; does not replace full-suite failure |
| Supplementary accounting probes | FAIL: 2 failed, 43 warnings, 3.58 seconds |
| Frontend tests | PASS: 38 passed |
| Vite production build | PASS: 25.05 seconds; existing lottie-web eval and large main-chunk warnings |
| TypeScript `npx tsc --noEmit` | FAIL: existing errors in components, pages, API/seed types and timer contract test |
| Alembic source graph | PASS for graph inspection only: one head, 32 revisions |
| Compose configuration using `.env.production.example` | PASS; sample syntax only, not validation of production secrets or running services |
| Production-like migration / restore / reconciliation | NOT RUN |
| Browser E2E / live email delivery | NOT RUN |

The full run passed: chat 33; clients 6; contacts 6; gamification 8; token generation 2; OAuth2 3; projects 7; proxy configuration 2; security 8; task listing 4; notifications 9; dashboard 9; project-linked tasks 8; subtasks 9; timers 15; evidence 11; ticket permissions 3; time bonus 18. Workflow suite: 9 passed / 1 failed.

## Reproduction Environment

Backend tests ran from a fresh temporary working directory with `PYTHONPATH` set to this checkout, `VEE_DATABASE_URL=sqlite:///./verification_app.db`, `VEE_MEDIA_ROOT=./media`, `VEE_STORAGE_PROVIDER=local` and `VEE_ENABLE_N8N_FORWARDING=false`. Test-created databases and files stayed there. No development env file or production database was used.

The initial scratch run stopped with five collection errors because `app.main` requires a working-directory-relative `assets` directory. Creating an empty scratch `assets` directory allowed the full rerun above. It did not validate real static assets.

Commands, run from that prepared scratch directory:

```powershell
python -m pytest F:\Projects\ideashop-zeaplay-v5\backend\tests -q --tb=short --junitxml=backend-results.xml
python -m pytest F:\Projects\ideashop-zeaplay-v5\backend\tests\test_tasks_phase7.py::test_simultaneous_completion_requests_do_not_duplicate_activation_history -q
python -m pytest F:\Projects\ideashop-zeaplay-v5\docs\task-manager-upgrade\checks\test_release_accounting_probes.py -q --tb=short
```

Raw transcripts and JUnit results were retained at `C:\Users\Lenovo\AppData\Local\Temp\zeaplay-release-check-05cf8ba4811e4538adcd87dc306f5676` (`backend-test.log`, `backend-results.xml`, `workflow-retry.log`, `workflow-retry.xml`, `release-probes.log`, `release-probes.xml`). Running the retained probe file again reproduced both failures in 3.93 seconds (`retained-accounting-probes.log` and `retained-accounting-probes.xml`). The supplementary probes are deliberately failing invariant checks retained as review evidence; they are outside the normal backend test discovery path.

## Required Evidence Before Release

1. Resolve the historical XP and stale-refund defects and add regression tests to the normal backend suite.
2. Investigate the concurrent workflow failure and verify races with independent PostgreSQL connections/processes.
3. Restore a sanitized production backup to isolated PostgreSQL. Record its origin, timestamp, checksum and revision; reconcile the previously reported missing revision before migration.
4. Validate every migration and compare before/after user balances, claim statuses/spend, tasks, subtasks and evidence references. Startup runs schema/seed helpers, so include first startup in preservation checks.
5. Provide durable evidence storage and test file availability after container replacement and restore.
6. Run browser E2E against the restored/migrated environment and verify notification delivery with a controlled recipient.
7. Reconcile failing TypeScript checks and obtain a clean backend run.
8. Record operator approval of the rollback/forward-fix plan, including database and evidence recovery, write freeze, worker handling, release artifacts and post-restore reconciliation. Code-only rollback does not recover data; dropping XP markers removes idempotency history.

No deployment was performed. No approval is implied by passing local checks.
