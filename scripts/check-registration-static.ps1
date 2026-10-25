$ErrorActionPreference = 'Stop'
Set-Location 'C:\dev\atom-app'
$script = Join-Path $PSScriptRoot 'check-registration-static.cjs'
node $script
if ($LASTEXITCODE -ne 0) { throw 'Static source contracts failed: inspect output. Do not enable registration.' }
Write-Host 'Static source checks passed. This is NOT an E2E PASS.' -ForegroundColor Yellow
