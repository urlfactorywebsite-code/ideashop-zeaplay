# Run from Windows with dependencies and Docker installed. All databases are disposable.
$ErrorActionPreference = 'Stop'
$auditRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $auditRoot
try {
    docker compose -p zeaplay-restore-audit -f ops/testing/compose.realtime.yml up -d --wait postgres redis
    if ($LASTEXITCODE -ne 0) { throw 'Scratch services failed to start' }
    $env:VEE_BOOTSTRAP_SCHEMA = 'false'
    $auditGlobalDb = Join-Path $env:TEMP ('restore-audit-' + [guid]::NewGuid().ToString('N') + '.db')
    $env:VEE_DATABASE_URL = 'sqlite:///' + $auditGlobalDb.Replace([char]92, [char]47)
    $env:ZEAPLAY_RT_POSTGRES_TEST_URL = 'postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
    $env:ZEAPLAY_WORK_TEST_REDIS_URL = 'redis://127.0.0.1:56379/15'
    $env:VEE_REDIS_URL = $env:ZEAPLAY_WORK_TEST_REDIS_URL
    & backend/venv/Scripts/python.exe -m pytest backend/tests/test_archive_restore_audit.py backend/tests/test_archive_restore.py backend/tests/test_clients_phase2.py backend/tests/test_contacts_phase3.py backend/tests/test_projects_phase4.py backend/tests/test_tasks_phase5.py backend/tests/test_tasks_phase8.py backend/tests/test_tasks_phase11.py backend/tests/test_security_phase13.py backend/tests/test_task_execution_report.py -q -r s
    $auditBackendExit = $LASTEXITCODE
    Push-Location frontend
    try {
        npm test
        $auditUnitExit = $LASTEXITCODE
        npx tsc --noEmit
        $auditTypeExit = $LASTEXITCODE
        npm run lint
        $auditLintExit = $LASTEXITCODE
        npm run build
        $auditBuildExit = $LASTEXITCODE
    } finally { Pop-Location }
    [pscustomobject]@{ backend=$auditBackendExit; frontend=$auditUnitExit;
        typecheck=$auditTypeExit; lint=$auditLintExit; build=$auditBuildExit } | ConvertTo-Json
    # Browser component checks additionally require an owned loopback Vite on 6302:
    # $env:ZEAPLAY_PLAYWRIGHT_MODULE='<existing @playwright/test/index.mjs>'
    # $env:ZEAPLAY_RESTORE_OUTPUT='../../docs/archive-restore-audit/checks/reproduction/'
    # node frontend/e2e/archive-restore.mjs
    # Real API browser setup is described in README.md and never uses app data.
} finally {
    docker compose -p zeaplay-restore-audit -f ops/testing/compose.realtime.yml down
    Pop-Location
}
