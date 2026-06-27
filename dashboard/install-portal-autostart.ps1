# Register portal watchdog (dashboard + student miniapp + tunnels) at Windows logon.
param(
    [string]$TaskName = "OpenClaw Portal Watchdog",
    [switch]$Uninstall,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Watchdog = Join-Path $Here "watchdog.ps1"

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    $pidFile = Join-Path $Here ".portal-watchdog.pid"
    if (Test-Path $pidFile) {
        $wpid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($wpid -gt 0) { Stop-Process -Id $wpid -Force -ErrorAction SilentlyContinue }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Removed scheduled task: $TaskName" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $Watchdog)) {
    Write-Error "watchdog.ps1 not found: $Watchdog"
    exit 1
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Watchdog`"" `
    -WorkingDirectory $Here

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Registered: $TaskName (At logon)" -ForegroundColor Green
Write-Host "  Dashboard     http://127.0.0.1:18790"
Write-Host "  Student portal http://127.0.0.1:18791"
Write-Host "  Log: $Here\portal-watchdog.log"

if (-not $NoStart) {
    . (Join-Path $Here "lib.ps1")
    $pidFile = Join-Path $Here ".portal-watchdog.pid"
    if (Test-Path $pidFile) {
        $old = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($old -gt 0) {
            $proc = Get-Process -Id $old -ErrorAction SilentlyContinue
            if ($proc) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
        }
    }
    $outLog = Join-Path $Here "portal-watchdog.out.log"
    $errLog = Join-Path $Here "portal-watchdog.err.log"
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $Watchdog
    ) -WorkingDirectory $Here -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    Write-Host "Watchdog started PID $($p.Id)" -ForegroundColor Green
    Write-Host "Waiting for services..."
    Start-Sleep -Seconds 20
    if (Test-PortalHttp "http://127.0.0.1:18790/api/health") {
        Write-Host "OK admin dashboard :18790" -ForegroundColor Green
    } else {
        Write-Host "WARN admin dashboard not up yet - see portal-watchdog.log" -ForegroundColor Yellow
    }
    if (Test-PortalHttp "http://127.0.0.1:18791/api/health") {
        Write-Host "OK student portal :18791" -ForegroundColor Green
    } else {
        Write-Host "WARN student portal not up yet - see portal-watchdog.log" -ForegroundColor Yellow
    }
}
