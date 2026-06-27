# Repair: local stack + optional HTTPS for Telegram menu buttons (cloudflared/localtunnel, no Tailscale).
param(
    [switch]$WithTunnels,
    [switch]$WithTelegram
)

$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib.ps1")

$telegram = $WithTelegram -or $WithTunnels

Write-PortalWatchdogLog "=== repair portals (local PC$(if ($telegram) { ' + telegram HTTPS' })) ==="
Stop-PortalWatchdog

$keepTunnel = $false
if ($telegram) {
    $state = Get-PortalStateHash
    $stored = [string]$state.admin_tunnel_url
    if ($stored -like "https://*" -and (Test-AdminTunnelReady $stored)) {
        $menuBase = Get-TelegramMenuBaseUrl
        if ($menuBase -and ($menuBase.TrimEnd('/') -eq $stored.TrimEnd('/'))) {
            $keepTunnel = $true
            Write-PortalWatchdogLog "keeping healthy tunnel $stored"
        }
    }
}

if (-not $keepTunnel) {
    Stop-AllTunnels | Out-Null
}

Ensure-OpenClawGateway | Out-Null
Ensure-AdminDashboard | Out-Null
Ensure-StudentPortal | Out-Null

Start-Sleep -Seconds 2

Start-PortalStack -WithTunnels:$telegram -KeepTunnel:$keepTunnel
$state = Get-PortalStateHash

Start-PortalWatchdog | Out-Null

$mainMenu = Get-TelegramMenuUrl (Read-SecretsBotToken "main")
$ghMenu = Get-TelegramMenuUrl (Read-SecretsBotToken "golden-hour")

Write-PortalWatchdogLog "repair done mode=$($state.proxy_mode) main=$mainMenu gh=$ghMenu"
Write-Host ""
if ($telegram) {
    Write-Host "Telegram menu buttons (HTTPS, no Tailscale):" -ForegroundColor Green
    Write-Host "  Main: $mainMenu" -ForegroundColor Cyan
    Write-Host "  GH:   $ghMenu" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Fully quit Telegram (swipe away from recents), then reopen and open the bot." -ForegroundColor Yellow
} else {
    Write-Host "Direct on PC (phone browser, same Wi-Fi / hotspot):" -ForegroundColor Green
    Write-Host "  Hotspot: $(Get-HotspotHost)" -ForegroundColor Cyan
    Write-Host "  Main: $($state.admin_menu_url)" -ForegroundColor White
    Write-Host "  GH:   $($state.student_menu_url)" -ForegroundColor White
    if ($state.lan_ip -and $state.lan_ip -ne (Get-HotspotHost)) {
        Write-Host "  LAN main: $($state.lan_miniapp_url)" -ForegroundColor White
        Write-Host "  LAN GH:   $($state.lan_gh_miniapp_url)" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "For Telegram buttons: .\repair-portals.ps1 -WithTelegram" -ForegroundColor Yellow
}
