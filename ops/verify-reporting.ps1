param(
    [string[]]$TestTargets = @(
        "backend/tests/test_reporting_inventory.py",
        "backend/tests/test_advanced_reporting_time.py",
        "backend/tests/test_reporting_index.py",
        "backend/tests/test_reporting_exports.py",
        "backend/tests/test_reporting_frontend_contract.py",
        "backend/tests/test_task_lifecycle.py",
        "backend/tests/test_task_execution_report.py::test_overlapping_parent_child_work_union_not_sum",
        "backend/tests/test_task_execution_report.py::test_pauses_require_valid_continuations_and_do_not_round_each_person"
    ),
    [string]$ResultName = "backend-postgres-combined",
    [switch]$ShowOutput
)

$ErrorActionPreference = "Stop"
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$pythonPath = Join-Path $workspacePath "backend\venv\Scripts\python.exe"
$checksPath = Join-Path $workspacePath "docs\advanced-reporting\checks"
if ($ResultName -notmatch "^[a-z0-9-]+$") {
    throw "ResultName must contain only lowercase letters, digits, and hyphens."
}
New-Item -ItemType Directory -Path $checksPath -Force | Out-Null
$reportLog = Join-Path $checksPath "$ResultName.txt"
$junitPath = Join-Path $checksPath "$ResultName.xml"
$containerRecordPath = Join-Path $checksPath "$ResultName-container.json"
$verificationName = "zeaplay-reporting-verify-" + [Guid]::NewGuid().ToString("N").Substring(0, 12)
$verificationPassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$verificationContainerId = $null
$cleanupSucceeded = $false
$testExit = 1
$previousLocation = Get-Location
$savedEnvironment = @{}
foreach ($variable in @("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "ZEAPLAY_RT_POSTGRES_TEST_URL",
                        "PYTHONDONTWRITEBYTECODE", "VEE_BOOTSTRAP_SCHEMA", "VEE_DATABASE_URL")) {
    $savedEnvironment[$variable] = [Environment]::GetEnvironmentVariable($variable, "Process")
}

try {
    Set-Location -LiteralPath $workspacePath
    $env:POSTGRES_USER = "reporting_verifier"
    $env:POSTGRES_PASSWORD = $verificationPassword
    $env:POSTGRES_DB = "rt3_test_reporting"
    $env:PYTHONDONTWRITEBYTECODE = "1"
    # Importing app.database otherwise runs legacy schema helpers against its
    # configured global engine before pytest's isolated get_db override exists.
    $env:VEE_BOOTSTRAP_SCHEMA = "false"
    $env:VEE_DATABASE_URL = "sqlite://"
    $containerOutput = & docker run --detach --rm --name $verificationName `
        --label "zeaplay.verification=advanced-reporting" `
        --memory 1g --cpus 2 --publish "127.0.0.1::5432" `
        --tmpfs "/var/lib/postgresql/data:rw" `
        --env POSTGRES_USER --env POSTGRES_PASSWORD --env POSTGRES_DB postgres:16-alpine
    if ($LASTEXITCODE -ne 0) { throw "Could not start the isolated PostgreSQL verification container." }
    $verificationContainerId = ($containerOutput | Select-Object -Last 1).Trim()
    if ($verificationContainerId -notmatch "^[a-f0-9]{64}$") {
        throw "Unexpected verification container identifier; refusing cleanup of an unverified target."
    }
    [pscustomobject]@{
        container_id = $verificationContainerId
        name = $verificationName
        created_at_utc = [DateTime]::UtcNow.ToString("o")
        database = "rt3_test_reporting"
        cleanup_succeeded = $false
    } | ConvertTo-Json | Set-Content -LiteralPath $containerRecordPath -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker exec $verificationContainerId pg_isready -U reporting_verifier -d rt3_test_reporting *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Isolated PostgreSQL was not ready within 30 seconds." }
    $portBinding = (& docker port $verificationContainerId 5432/tcp | Select-Object -First 1).Trim()
    if ($portBinding -notmatch "^127\.0\.0\.1:(\d+)$") {
        throw "Verification PostgreSQL must bind only to a dynamically selected loopback port."
    }
    $verificationPort = $Matches[1]
    $env:ZEAPLAY_RT_POSTGRES_TEST_URL = "postgresql+psycopg://reporting_verifier:${verificationPassword}@127.0.0.1:${verificationPort}/rt3_test_reporting?connect_timeout=5"
    Write-Output "Running SQLite and isolated PostgreSQL 16 reporting checks. Temporary database: rt3_test_reporting. No shared database connection."
    $pytestOptions = @("-q", "-r", "s", "--junitxml=$junitPath")
    if ($ShowOutput) { $pytestOptions += "-s" }
    & $pythonPath -m pytest @TestTargets @pytestOptions 2>&1 |
        ForEach-Object { $_.ToString().Replace($verificationPassword, "[REDACTED_SECRET]") } |
        Tee-Object -FilePath $reportLog
    $testExit = $LASTEXITCODE
}
finally {
    if (Test-Path -LiteralPath $junitPath) {
        $content = [IO.File]::ReadAllText($junitPath).Replace($verificationPassword, "[REDACTED_SECRET]")
        [IO.File]::WriteAllText($junitPath, $content, [Text.UTF8Encoding]::new($false))
    }
    if ($verificationContainerId -and $verificationContainerId -match "^[a-f0-9]{64}$") {
        # Remove only the exact container ID returned by this invocation.
        $cleanupErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & docker rm --force $verificationContainerId *> $null
            $cleanupSucceeded = $LASTEXITCODE -eq 0
        }
        finally {
            $ErrorActionPreference = $cleanupErrorPreference
        }
        if ($cleanupSucceeded) {
            Write-Output "Removed this run's isolated verification container and its in-memory database."
        }
        else {
            Write-Warning "The Docker API could not clean up this run. The exact owned container ID is recorded in $containerRecordPath."
            $testExit = 1
        }
        if (Test-Path -LiteralPath $containerRecordPath) {
            $record = Get-Content -LiteralPath $containerRecordPath -Raw | ConvertFrom-Json
            $record.cleanup_succeeded = $cleanupSucceeded
            $record | ConvertTo-Json | Set-Content -LiteralPath $containerRecordPath -Encoding UTF8
        }
    }
    foreach ($variable in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($variable, $savedEnvironment[$variable], "Process")
    }
    Set-Location -LiteralPath $previousLocation
}
exit $testExit
