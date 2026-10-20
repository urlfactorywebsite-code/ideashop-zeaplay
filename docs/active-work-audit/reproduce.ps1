param([string]$PlaywrightModule = '')

# Disposable verification only. Requires Docker and installed backend/frontend dependencies.
# For browser checks, first start the loopback Vite fixture server on 6302 and
# pass the path to an existing @playwright/test/index.mjs. No app database is used.
$ErrorActionPreference = 'Stop'
$auditRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$auditOutput = Join-Path $PSScriptRoot 'checks/reproduction'
New-Item -ItemType Directory -Path $auditOutput -Force | Out-Null
Push-Location $auditRoot
try {
    docker compose -p zeaplay-timer-audit -f ops/testing/compose.realtime.yml up -d --wait postgres redis
    if ($LASTEXITCODE -ne 0) { throw 'Disposable services failed to start' }
    $env:VEE_BOOTSTRAP_SCHEMA = 'false'
    $auditGlobalDb = Join-Path $env:TEMP ('timer-reproduction-' + [guid]::NewGuid().ToString('N') + '.db')
    $env:VEE_DATABASE_URL = 'sqlite:///' + $auditGlobalDb.Replace([char]92, [char]47)
    $env:ZEAPLAY_RT_POSTGRES_TEST_URL = 'postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test'
    $env:ZEAPLAY_WORK_TEST_REDIS_URL = 'redis://127.0.0.1:56379/15'
    & backend/venv/Scripts/python.exe -m pytest backend/tests/test_timer_refinement.py backend/tests/test_active_work.py backend/tests/test_task_lifecycle.py backend/tests/test_task_lifecycle_review.py backend/tests/test_task_execution_report.py backend/tests/test_tasks_phase7.py backend/tests/test_tasks_phase8.py backend/tests/test_realtime_refinement.py backend/tests/test_realtime_postgres_refinement.py backend/tests/test_security_phase13.py -q -r s
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
    if ($PlaywrightModule) {
        $env:ZEAPLAY_PLAYWRIGHT_MODULE = $PlaywrightModule
        $env:ZEAPLAY_WORK_OUTPUT = '../../docs/active-work-audit/checks/reproduction/'
        $env:ZEAPLAY_JOURNEY_OUTPUT = '../../docs/active-work-audit/checks/reproduction/journey/'
        node frontend/e2e/active-work.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Active Work browser checks failed' }
        node frontend/e2e/task-journey.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Task journey browser checks failed' }
    }
    [pscustomobject]@{ backend = $auditBackendExit; frontend_tests = $auditUnitExit;
        typecheck = $auditTypeExit; lint = $auditLintExit; build = $auditBuildExit } |
        ConvertTo-Json | Set-Content (Join-Path $auditOutput 'exits.json')
} finally {
    docker compose -p zeaplay-timer-audit -f ops/testing/compose.realtime.yml down
    Pop-Location
}
