# Regenerates the API contract and the web's types from it:
#   apkh-api: nest build -> scripts/export-openapi.mjs -> openapi.json
#   apkh-web: openapi-typescript -> src/services/api-schema.d.ts
# Run after any DTO change. CI fails when either file is stale, so commit both.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root 'apkh-api'
$web = Join-Path $root 'apkh-web'

function Invoke-Native([string]$dir, [string]$label, [scriptblock]$cmd) {
    Write-Host "=== $label" -ForegroundColor Cyan
    Push-Location $dir
    try {
        & $cmd
        if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $api 'node_modules'))) { Write-Host "Skipped: run 'npm ci' in apkh-api first." -ForegroundColor Yellow; exit 1 }
Invoke-Native $api 'apkh-api build' { npm run build }
Invoke-Native $api 'apkh-api openapi.json' { npm run openapi }

if (-not (Test-Path $web)) { Write-Host 'apkh-web missing: skipped web types.' -ForegroundColor Yellow; exit 0 }
if (-not (Test-Path (Join-Path $web 'node_modules'))) { Write-Host "Skipped web types: run 'npm ci' in apkh-web first." -ForegroundColor Yellow; exit 1 }
Invoke-Native $web 'apkh-web api-schema.d.ts' { npm run api:types }

Write-Host "`nContract regenerated. Changed files:" -ForegroundColor Green
git -C $root status --short -- apkh-api/openapi.json apkh-web/src/services/api-schema.d.ts
