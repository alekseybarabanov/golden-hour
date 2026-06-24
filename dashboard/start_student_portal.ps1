# Golden Hour student portal (LAN / Wi-Fi)
param(
    [int]$Port = 18791,
    [string]$HostAddr = "0.0.0.0",
    [switch]$LocalOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Here "student_portal_backend.py"
$OutLog = Join-Path $Here "student-portal.out.log"
$ErrLog = Join-Path $Here "student-portal.err.log"

$Py = $env:OPENCLAW_PYTHON
if (-not $Py) { $Py = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $Py -or -not (Test-Path $Py)) {
  $fallback = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
  if (Test-Path $fallback) { $Py = $fallback }
}
if (-not $Py -or -not (Test-Path $Py)) {
    Write-Error "Python not found. Install Python 3.12+ or set OPENCLAW_PYTHON."
    exit 1
}

if ($LocalOnly) { $HostAddr = "127.0.0.1" }

$gw = Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $gw) {
    Write-Host "Gateway :18789 not running - starting..."
    openclaw gateway restart --force 2>&1 | Out-Host
    Start-Sleep -Seconds 10
}

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        Write-Host "Port $Port in use by PID $procId, stopping..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting student portal on http://${HostAddr}:$Port/ (LAN Wi-Fi)"
Start-Process -FilePath $Py -ArgumentList @($Backend, "--port", "$Port", "--host", $HostAddr) `
    -WorkingDirectory $Here -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog

Start-Sleep -Seconds 2

try {
    $lanJson = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/lan" -TimeoutSec 5
    $lanIp = $lanJson.lan_ip
    $prof = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Connectivity -eq 'Internet' } | Select-Object -First 1
    Write-Host ""
    Write-Host "=== Student portal (same Wi-Fi) ==="
    Write-Host "URL: http://${lanIp}:$Port/my/<token>"
    Write-Host "Bot: /web"
    if ($prof -and $prof.NetworkCategory -eq 'Public') {
        Write-Host ""
        Write-Host "WARN: Wi-Fi profile is Public - run as Admin:"
        Write-Host "  .\open-firewall-student-portal.ps1"
    }
    if ($prof -and $prof.Name -match 'Guest|guest') {
        Write-Host ""
        Write-Host "WARN: Guest Wi-Fi often blocks phone<->PC (AP isolation)."
        Write-Host "Use main home Wi-Fi, or PC hotspot, or disable guest isolation in router."
    }
    Write-Host ""
} catch {
    Write-Host "Portal starting... check http://127.0.0.1:$Port/"
}

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port/"
}
