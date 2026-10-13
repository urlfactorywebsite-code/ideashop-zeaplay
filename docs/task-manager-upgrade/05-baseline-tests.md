# Task Manager Upgrade - Baseline Tests

Phase 1 baseline date: 2026-10-13

No failures were hidden. No production data was modified.

## Repository State Check

Command:

```powershell
git status --short --branch
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5
```

Result:

```text
FAIL
fatal: not a git repository
```

Impact:

- this workspace root cannot provide Git dirty-tree or commit-boundary evidence.
- implementation phases should confirm the intended repository root before edits.

## Backend Tests

Initial incorrect command:

```powershell
backend\venv\Scripts\python.exe -m pytest
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\backend
```

Result:

```text
FAIL
PowerShell command resolution failed because the path was relative to the backend directory twice.
```

Correct command:

```powershell
.\venv\Scripts\python.exe -m pytest
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\backend
```

Result:

```text
FAIL
44 items collected / 4 collection errors
```

Failure pattern:

```text
sqlite3.OperationalError: no such function: to_tsvector
```

Affected test modules:

- `tests/test_generate_token.py`
- `tests/test_oauth2_server.py`
- `tests/test_task_list.py`
- `tests/test_ticket_tenant_permissions.py`

Root cause observed:

- test collection imports the application.
- application metadata creation attempts to create the `tasks.search_vector` generated column using PostgreSQL `to_tsvector`.
- SQLite does not provide `to_tsvector`.

Warnings observed:

- SQLAlchemy deprecation warning for duplicate `Level.created_by` mapping.
- Pydantic class-based config deprecation.
- FastAPI `on_event` deprecation.

Baseline conclusion:

- backend tests are currently blocked at collection.
- this is an existing architecture/test-configuration issue, not a Phase 1 document-generation issue.

Focused command from repository root:

```powershell
.\backend\venv\Scripts\python.exe -m pytest backend\tests\test_time_bonus.py
```

Result:

```text
PASS
18 passed in 0.04s
```

Focused command from backend directory:

```powershell
.\venv\Scripts\python.exe -m pytest tests\test_time_bonus.py
```

Result:

```text
FAIL
ModuleNotFoundError: No module named 'backend'
```

Observation:

- some backend tests assume the repository root is on `PYTHONPATH`.
- full backend pytest from the backend directory fails earlier on `to_tsvector`, so this import-path issue is masked in the full run.

## Alembic Verification

Commands:

```powershell
.\venv\Scripts\python.exe -m alembic current
.\venv\Scripts\python.exe -m alembic heads
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\backend
```

Result:

```text
FAIL for current
Can't locate revision identified by '7g8h9i0j1k2l'

PASS for heads
9c8d7e6f5a4b (head)
```

Observation:

- Alembic reads `VEE_DATABASE_URL` through backend settings, and this checkout's backend `.env` points at a remote PostgreSQL database.
- no migration command that changes state should be run until the target environment is made explicit.
- the local SQLite `vee_task_manager.db` has no `alembic_version` table.

## Frontend Unit Tests

Command:

```powershell
npm test
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\frontend
```

Result:

```text
PASS
7 tests passed
```

Covered areas from test names/output:

- chat normalization behavior.
- service-worker push behavior.

Baseline conclusion:

- available frontend unit tests pass.
- coverage is narrow relative to the task-manager upgrade.
- the discovered project tests are under `frontend/test`, and the passing run covers chat message normalization plus service-worker push icon/error behavior.

## Frontend Type Check

Command:

```powershell
npx tsc --noEmit
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\frontend
```

Result:

```text
FAIL
```

Representative existing errors:

- `components/AvatarCropModal.tsx`: `onCompleteWithMetadata` is undefined.
- `components/Ballpit.tsx`: private field and property/type errors.
- `components/CreateTaskModal.tsx`: `Role` is not found.
- `components/CreateUserModal.tsx`: user shape missing `overallXpPoints` and `claimedXpPoints`.
- `components/NotesBoard.tsx`: missing note-related types.
- `components/TaskTemplateModal.tsx`: file/template shape mismatches.
- `pages/TicketDetailDrawer.tsx` and `pages/TicketPage.tsx`: handler return type mismatches.
- `hooks/useChatUnreadIndicator.ts`: invalid arithmetic/type combination.
- `pages/Tasks.tsx`: status count and filter typing errors.
- `services/mockApi.ts`: missing/import mismatches and level type errors.
- `services/seedData.ts`: seed objects do not match current frontend types.
- `utils/mentionUtils.ts`: `replace` called on `never`.

Baseline conclusion:

- frontend TypeScript is not currently a passing gate.
- Phase 2 should either fix the baseline or define a scoped type-check gate before UI expansion.

## Frontend Build

Command:

```powershell
npm run build
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\frontend
```

Result:

```text
PASS
```

Notable warnings:

- `lottie-web` uses `eval`.
- generated `dist/assets/index-CD5tJL7_.js` is larger than 500 kB after minification.

Baseline conclusion:

- production frontend build currently succeeds despite TypeScript baseline failures.

## Frontend Lint

Command:

```powershell
npm run lint
```

Working directory:

```text
F:\Projects\ideashop-zeaplay-v5\frontend
```

Result:

```text
FAIL
Missing script: "lint"
```

Baseline conclusion:

- frontend lint is not currently configured as an available check.

## Backend Lint And Type Checks

No backend lint/type-check script was identified during the Phase 1 audit.

Baseline conclusion:

- backend quality gate currently depends primarily on tests, but tests fail during collection.

## Baseline Summary

| Check | Result | Notes |
| --- | --- | --- |
| Git status at workspace root | FAIL | Root is not a Git repository. |
| Backend pytest | FAIL | SQLite cannot create PostgreSQL `to_tsvector` generated column. |
| Backend focused time bonus test from repo root | PASS | 18 tests passed. |
| Backend focused time bonus test from backend dir | FAIL | Import path expects `backend` package from repo root. |
| Alembic current | FAIL | Configured PostgreSQL database references missing revision `7g8h9i0j1k2l`. |
| Alembic heads | PASS | Source head is `9c8d7e6f5a4b`. |
| Frontend unit tests | PASS | 7 tests passed. |
| Frontend TypeScript | FAIL | Multiple existing type errors. |
| Frontend build | PASS | Build succeeds with chunk/eval warnings. |
| Frontend lint | FAIL | No `lint` script. |
| Backend lint/type | NOT AVAILABLE | No script identified. |

## Certification Meaning

This baseline is suitable as an honest Phase 1 audit baseline.

It is not suitable as a release certification baseline because:

- backend tests do not collect.
- Alembic current fails for the configured database.
- frontend type checking fails.
- linting is not configured.
- tenant isolation gaps exist in the task model.
- task approval/XP semantics are not compatible with the confirmed target requirements.
