[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$frontendPath = Join-Path $PSScriptRoot 'frontend'
if (-not (Test-Path -LiteralPath (Join-Path $frontendPath 'package.json') -PathType Leaf)) {
    throw 'Missing frontend/package.json. Keep this script at the project root.'
}
$npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $npm) {
    throw 'npm.cmd is unavailable. Install Node.js with npm and open a new PowerShell terminal.'
}

Push-Location -LiteralPath $frontendPath
try {
    Write-Host 'Starting the frontend with the existing Vite configuration. Press Ctrl+C to stop.'
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) {
        throw 'Vite stopped with an error. Review the output and ensure existing frontend dependencies are available; this script does not install them.'
    }
}
finally {
    Pop-Location
}
