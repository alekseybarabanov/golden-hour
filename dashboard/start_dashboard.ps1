# Start Felpik Dashboard backend
param(
    [int]$Port = 18790,
    [string]$HostAddr = "127.0.0.1",
    [switch]$Lan,
    [switch]$NoBrowser,
    [switch]$WithGrafana,
    [switch]$NoGrafana
)

$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py = $env:OPENCLAW_PYTHON
if (-not $Py) { $Py = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $Py -or -not (Test-Path $Py)) {
  $fallback = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
  if (Test-Path $fallback) { $Py = $fallback }
}
$Backend = Join-Path $Here "backend.py"
$OutLog = Join-Path $Here "backend.out.log"
$ErrLog = Join-Path $Here "backend.err.log"

if (-not (Test-Path $Py)) {
    Write-Error "Python not found: $Py"
    exit 1
}

if ($Lan) { $HostAddr = "0.0.0.0" }

$gw = Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $gw) {
    Write-Host "Gateway :18789 not running - starting OpenClaw Gateway..."
    openclaw gateway restart --force 2>&1 | Out-Host
    Start-Sleep -Seconds 12
    $gw = Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($gw) { Write-Host "Gateway OK on :18789" } else { Write-Host "WARN: Gateway still down - run: openclaw gateway restart" }
}

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
        Write-Host "Port $Port in use by PID $procId, stopping..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting dashboard at http://${HostAddr}:$Port/"
Start-Process -FilePath $Py -ArgumentList @($Backend, "--port", "$Port", "--host", $HostAddr) `
    -WorkingDirectory $Here -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog

Start-Sleep -Seconds 2
$openHost = if ($HostAddr -eq "0.0.0.0") { "127.0.0.1" } else { $HostAddr }
if (-not $NoBrowser) {
    Start-Process "http://${openHost}:$Port/"
}
Write-Host "Ready: http://127.0.0.1:$Port/  (use port $Port, not bare 127.0.0.1)"

$GrafanaDir = Join-Path $Here "grafana"
$GrafanaLib = Join-Path $GrafanaDir "lib.ps1"
if (-not $NoGrafana -and (Test-Path $GrafanaLib)) {
    . $GrafanaLib
    $wantGrafana = $WithGrafana -or (Test-OpenClawMetricsBinsInstalled)
    if ($wantGrafana) {
        try {
            $wdPid = Start-OpenClawMetricsWatchdog -GrafanaRoot $GrafanaDir
            Write-Host "Grafana watchdog: PID $wdPid (auto-restart :3000 / :9090)"
        } catch {
            Write-Host "WARN: Grafana watchdog not started - run: cd grafana; .\start_grafana.ps1 -Watchdog"
        }
    }
}
