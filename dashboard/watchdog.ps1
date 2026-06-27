# Keeps OpenClaw gateway + admin dashboard + student portal + Telegram miniapp tunnels alive.
$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib.ps1")

$intervalSec = 45
$pidFile = Join-Path $Here ".portal-watchdog.pid"
$PID | Set-Content -Path $pidFile -Encoding ascii

Write-PortalWatchdogLog "portal watchdog started (PID $PID)"

Start-PortalBackends

while ($true) {
    try {
        if (-not (Test-PortalPortListening 18789)) { Ensure-OpenClawGateway | Out-Null }
        if (-not (Test-PortalHttp "http://127.0.0.1:18790/api/health")) { Ensure-AdminDashboard | Out-Null }
        if (-not (Test-PortalHttp "http://127.0.0.1:18791/api/health")) { Ensure-StudentPortal | Out-Null }

        $state = Maintain-PortalAccess (Get-PortalStateHash)
        Save-PortalState $state
    } catch {
        Write-PortalWatchdogLog "loop error: $_"
    }
    Start-Sleep -Seconds $intervalSec
}
