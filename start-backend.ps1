# Local HTTP development only. Use Secure cookies and HTTPS for deployment.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$backendPath = Join-Path $PSScriptRoot 'backend'
$pythonPath = Join-Path $backendPath '.venv\Scripts\python.exe'
$authPath = Join-Path $backendPath 'instance\demo-auth.json'

if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw 'Backend Python is missing. Set up backend/.venv before starting the backend.'
}
if (-not (Test-Path -LiteralPath $authPath -PathType Leaf)) {
    throw 'Missing backend/instance/demo-auth.json. Restore your existing local demo configuration; this script does not generate credentials.'
}

$startupLock = [System.Threading.Mutex]::new($false, 'Local\HealthCareAssistAI-Backend-5053')
$lockHeld = $false
$locationChanged = $false
$savedEnvironment = @{}
$demoAuth = $null
try {
    try {
        $lockHeld = $startupLock.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $lockHeld = $true
    }
    if (-not $lockHeld) {
        throw 'A backend startup script is already running on port 5053. Use that terminal or stop it with Ctrl+C first.'
    }

    # Refuse an occupied port; never stop an existing process.
    $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 5053)
    try {
        $portProbe.Start()
    }
    catch {
        throw 'Cannot bind 127.0.0.1:5053. The port may already be in use or local execution may be restricted.'
    }
    finally {
        $portProbe.Stop()
    }

    try {
        $demoAuth = Get-Content -Raw -LiteralPath $authPath | ConvertFrom-Json
    }
    catch {
        # JSON parser errors can contain source text, so do not echo the exception.
        throw 'Cannot read backend/instance/demo-auth.json. Check file access and JSON syntax privately.'
    }
    foreach ($name in @('DEMO_USERNAME', 'DEMO_PASSWORD_HASH', 'SECRET_KEY')) {
        if ($demoAuth.$name -isnot [string] -or [string]::IsNullOrWhiteSpace($demoAuth.$name)) {
            throw "Missing or invalid $name in backend/instance/demo-auth.json. Check the existing configuration privately."
        }
    }

    $settings = @{
        DEMO_USERNAME = $demoAuth.DEMO_USERNAME
        DEMO_PASSWORD_HASH = $demoAuth.DEMO_PASSWORD_HASH
        SECRET_KEY = $demoAuth.SECRET_KEY
        # Explicit opt-out solely for this loopback HTTP development process.
        SESSION_COOKIE_SECURE = 'false'
        FLASK_HOST = '127.0.0.1'
        FLASK_PORT = '5053'
        FLASK_DEBUG = 'false'
    }
    foreach ($name in $settings.Keys) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
    }

    Push-Location -LiteralPath $backendPath
    $locationChanged = $true
    # Reuse the application's validator without starting the app or touching the database.
    $validationCode = @'
import os
import sys
from flask import Flask
from app.auth import configured
app = Flask(__name__)
app.config.update({name: os.environ.get(name) for name in ('DEMO_USERNAME', 'DEMO_PASSWORD_HASH', 'SECRET_KEY')})
with app.app_context():
    sys.exit(0 if configured() else 1)
'@
    & $pythonPath -c $validationCode
    if ($LASTEXITCODE -ne 0) {
        throw 'Demo authentication validation failed. Check the username, supported password hash, and signing key privately using docs/demo-authentication.md.'
    }

    Write-Host 'Starting Flask at http://127.0.0.1:5053. Press Ctrl+C to stop.'
    Write-Host 'Local HTTP development only: Secure cookies are disabled for this loopback process.'
    & $pythonPath (Join-Path $backendPath 'run.py')
    if ($LASTEXITCODE -ne 0) {
        throw 'Flask stopped with an error. Review the startup error and existing backend configuration; no credentials were regenerated.'
    }
}
finally {
    if ($locationChanged) { Pop-Location }
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    $demoAuth = $null
    $settings = $null
    $savedEnvironment.Clear()
    if ($lockHeld) { $startupLock.ReleaseMutex() }
    $startupLock.Dispose()
}
