# Enable Windows Mobile Hotspot and show student portal URL.
# Phone connects to PC hotspot -> bypasses Guest Wi-Fi AP isolation.
param(
    [int]$Port = 18791
)

$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$HotspotIp = "192.168.137.1"

Write-Host "=== Student portal via PC hotspot ===" -ForegroundColor Cyan
Write-Host ""

# Ensure portal is running
$listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listen) {
    Write-Host "Starting student portal..."
    & (Join-Path $Here "start_student_portal.ps1") -NoBrowser
    Start-Sleep -Seconds 2
}

# Try to start Mobile Hotspot (Windows 10/11)
$started = $false
try {
    Add-Type -AssemblyName Windows.Runtime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    Function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }
    [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime] | Out-Null
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
    $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
    if ($mgr.TetheringOperationalState -ne "On") {
        Write-Host "Starting Mobile Hotspot..."
        $r = Await ($mgr.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        if ($r.Status -eq "Success") { $started = $true; Write-Host "Hotspot ON" -ForegroundColor Green }
        else { Write-Host "Hotspot start: $($r.Status) - enable manually in Settings" -ForegroundColor Yellow }
    } else {
        $started = $true
        Write-Host "Hotspot already ON" -ForegroundColor Green
    }
} catch {
    Write-Host "Auto-start failed: $($_.Exception.Message)"
    Write-Host "Open Settings manually: ms-settings:network-mobilehotspot"
    Start-Process "ms-settings:network-mobilehotspot"
}

Write-Host ""
Write-Host "On phone:" -ForegroundColor Cyan
Write-Host "  1. Turn OFF mobile data"
Write-Host "  2. Wi-Fi -> connect to THIS PC hotspot (not Sber-Guest)"
Write-Host "  3. Open link from bot /web (or below)"
Write-Host ""
Write-Host "Portal URL (hotspot):" -ForegroundColor Green
Write-Host "  http://${HotspotIp}:$Port/my/<token>"
Write-Host ""
Write-Host "Get token: node scripts/student-portal.mjs --user tg-<id> --host $HotspotIp"
Write-Host ""

# Firewall for hotspot interface
$adminScript = Join-Path $Here "fix-student-portal-access.ps1"
if (Test-Path $adminScript) {
    Write-Host "Tip: if blocked, run as Admin: .\fix-student-portal-access.ps1"
}
