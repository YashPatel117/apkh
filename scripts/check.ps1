# Full check for every package: the same steps as .github/workflows/ci.yml
# (minus the Docker image build). Exits non-zero when any step fails.
#
#   pwsh scripts/check.ps1              # everything
#   pwsh scripts/check.ps1 api web      # only some areas: api, web, search, storage, mcp
#   pwsh scripts/check.ps1 -NoBuild     # lint + types only (skips nest build / next build)
param(
    [string[]]$Areas = @('api', 'web', 'search', 'storage', 'mcp'),
    [switch]$NoBuild
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$failed = @()
$results = @()

function Invoke-Step([string]$area, [string]$name, [string]$dir, [scriptblock]$cmd) {
    Write-Host "`n=== [$area] $name" -ForegroundColor Cyan
    Push-Location $dir
    try {
        $global:LASTEXITCODE = 0
        & $cmd
        $ok = ($LASTEXITCODE -eq 0) -and $?
    } catch {
        Write-Host $_ -ForegroundColor Red
        $ok = $false
    } finally {
        Pop-Location
    }
    $script:results += [pscustomobject]@{ Area = $area; Step = $name; Result = $(if ($ok) { 'ok' } else { 'FAILED' }) }
    if (-not $ok) { $script:failed += "$area/$name" }
}

function Test-NodePackage([string]$area, [string]$dir) {
    if (-not (Test-Path $dir)) { Write-Host "`n=== [$area] skipped: $dir does not exist" -ForegroundColor Yellow; return $false }
    if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
        Write-Host "`n=== [$area] skipped: no node_modules (run 'npm ci' in $dir)" -ForegroundColor Yellow
        $script:results += [pscustomobject]@{ Area = $area; Step = 'deps'; Result = 'skipped' }
        return $false
    }
    return $true
}

$env:NEXT_TELEMETRY_DISABLED = '1'
if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = 'http://localhost:3000' }

if ($Areas -contains 'api') {
    $dir = Join-Path $root 'apkh-api'
    if (Test-NodePackage 'api' $dir) {
        Invoke-Step 'api' 'eslint' $dir { npx eslint "src/**/*.ts" }
        Invoke-Step 'api' 'tsc' $dir { npx tsc --noEmit }
        if (-not $NoBuild) { Invoke-Step 'api' 'build' $dir { npm run build } }
    }
}

if ($Areas -contains 'web') {
    $dir = Join-Path $root 'apkh-web'
    if (Test-NodePackage 'web' $dir) {
        Invoke-Step 'web' 'eslint' $dir { npx eslint }
        Invoke-Step 'web' 'tsc' $dir { npx tsc --noEmit }
        if (-not $NoBuild) { Invoke-Step 'web' 'build' $dir { npm run build } }
    }
}

if ($Areas -contains 'search') {
    $dir = Join-Path $root 'apkh-search'
    if (-not (Test-Path $dir)) {
        Write-Host "`n=== [search] skipped: $dir does not exist" -ForegroundColor Yellow
    } else {
        $py = Join-Path $dir '.venv/Scripts/python.exe'
        if (-not (Test-Path $py)) { $py = Join-Path $dir '.venv/bin/python' }
        if (-not (Test-Path $py)) { $py = 'python' }
        Invoke-Step 'search' 'compile' $dir { & $py -m compileall -q main.py routes services }
        Invoke-Step 'search' 'import' $dir {
            $env:JWT_SECRET = 'ci-only'; $env:BUILTIN_AI = 'off'
            & $py -c "import main; print(len(main.app.routes), 'routes')"
        }
    }
}

if ($Areas -contains 'storage') {
    $dir = Join-Path $root 'apkh-storage'
    if (Test-Path $dir) { Invoke-Step 'storage' 'node --check' $dir { node --check server.js } }
    else { Write-Host "`n=== [storage] skipped: $dir does not exist" -ForegroundColor Yellow }
}

if ($Areas -contains 'mcp') {
    $dir = Join-Path $root 'apkh-mcp'
    if (Test-NodePackage 'mcp' $dir) {
        if ($NoBuild) { Invoke-Step 'mcp' 'tsc' $dir { npx tsc --noEmit } }
        else { Invoke-Step 'mcp' 'build' $dir { npm run build } }
    }
}

Write-Host "`n=== Summary" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
if ($failed.Count -gt 0) {
    Write-Host "FAILED: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host 'All checks passed.' -ForegroundColor Green
exit 0
