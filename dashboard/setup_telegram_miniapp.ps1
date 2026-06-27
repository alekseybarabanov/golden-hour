# Telegram Mini App setup for the main Felpik dashboard.
param(
    [int]$Port = 18790,
    [string]$PublicUrl = "",
    [string]$BotToken = "",
    [string]$MenuText = "",
    [switch]$SkipTunnel,
    [switch]$SkipMenu
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-OpenClawEnvFile {
    if ($env:OPENCLAW_HOME) { return Join-Path $env:OPENCLAW_HOME ".env" }
    $default = Join-Path $env:USERPROFILE ".openclaw\.env"
    if (Test-Path $default) { return $default }
    return $default
}

$EnvFile = Get-OpenClawEnvFile

function Read-DotEnvKey([string]$Key) {
    if (-not (Test-Path $EnvFile)) { return "" }
    foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
        if ($line -match "^\s*$Key\s*=\s*(.+)$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Default-MenuText {
    return "Felpik"
}

function Read-SecretsBotToken {
    $secretsFile = if ($env:OPENCLAW_HOME) { Join-Path $env:OPENCLAW_HOME "secrets.json" } else { Join-Path $env:USERPROFILE ".openclaw\secrets.json" }
    if (-not (Test-Path $secretsFile)) { return "" }
    try {
        $secrets = Get-Content $secretsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        return [string]$secrets.channels.telegram.botToken
    } catch {
        return ""
    }
}

if (-not $BotToken) {
    $BotToken = $env:TELEGRAM_MINIAPP_BOT_TOKEN
    if (-not $BotToken) { $BotToken = $env:TELEGRAM_BOT_TOKEN }
    if (-not $BotToken) { $BotToken = Read-DotEnvKey "TELEGRAM_BOT_TOKEN" }
    if (-not $BotToken) { $BotToken = Read-SecretsBotToken }
}

if (-not $MenuText) {
    $MenuText = $env:TELEGRAM_MINIAPP_MENU_TEXT
    if (-not $MenuText) { $MenuText = Read-DotEnvKey "TELEGRAM_MINIAPP_MENU_TEXT" }
    if (-not $MenuText) { $MenuText = Default-MenuText }
}

Write-Host "=== Telegram Mini App setup ===" -ForegroundColor Cyan
Write-Host "1) Starting dashboard (LAN)..."
& (Join-Path $Here "start_dashboard.ps1") -Port $Port -Lan -NoBrowser -NoGrafana

$tunnelUrl = $PublicUrl
if (-not $SkipTunnel -and -not $tunnelUrl) {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cf) {
        Write-Host "WARN: cloudflared not found. Install: winget install Cloudflare.cloudflared" -ForegroundColor Yellow
        Write-Host "Or pass -PublicUrl https://your-domain.example"
    } else {
        Write-Host "2) Starting Cloudflare quick tunnel to http://127.0.0.1:$Port ..."
        $log = Join-Path $Here "cloudflared-miniapp.log"
        $errLog = Join-Path $Here "cloudflared-miniapp.err.log"
        Start-Process -FilePath $cf.Source -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") `
            -WorkingDirectory $Here -WindowStyle Hidden `
            -RedirectStandardOutput $log -RedirectStandardError $errLog
        $deadline = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 1
            foreach ($path in @($log, $errLog)) {
                if (-not (Test-Path $path)) { continue }
                $m = Select-String -Path $path -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
                if ($m) {
                    $tunnelUrl = $m.Matches[0].Value
                    break
                }
            }
            if ($tunnelUrl) { break }
        }
    }
}

if (-not $tunnelUrl) {
    Write-Host ""
    Write-Host "Public HTTPS URL required for Telegram Mini App." -ForegroundColor Yellow
    Write-Host "Options:"
    Write-Host "  - Run again with: -PublicUrl https://xxxx.trycloudflare.com"
    Write-Host "  - Or open in phone browser on PC hotspot: http://192.168.137.1:$Port/miniapp"
    Write-Host ""
    Write-Host "Local preview (browser only): http://127.0.0.1:$Port/miniapp"
    exit 0
}

$tunnelUrl = $tunnelUrl.TrimEnd('/')
$miniappUrl = "$tunnelUrl/miniapp"
Write-Host ""
Write-Host "Mini App URL: $miniappUrl" -ForegroundColor Green

if (-not $SkipMenu -and $BotToken) {
    Write-Host "3) Setting bot menu button ($MenuText)..."
    $bodyObj = @{ menu_button = @{ type = "web_app"; text = $MenuText; web_app = @{ url = $miniappUrl } } }
    $body = $bodyObj | ConvertTo-Json -Depth 5 -Compress
    $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($body)
    $uri = "https://api.telegram.org/bot$BotToken/setChatMenuButton"
    try {
        Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json; charset=utf-8" -Body $utf8Body | Out-Null
        Write-Host "Menu button updated." -ForegroundColor Green
    } catch {
        Write-Host "Failed to set menu button: $_" -ForegroundColor Red
        Write-Host "Set manually in @BotFather: /setmenubutton -> $miniappUrl"
    }
} elseif (-not $BotToken) {
    Write-Host "No bot token. Set TELEGRAM_BOT_TOKEN in .env or pass -BotToken" -ForegroundColor Yellow
    Write-Host "BotFather: /setmenubutton -> $miniappUrl"
}

Write-Host ""
Write-Host "Also set in BotFather (/newapp or Web App settings):"
Write-Host "  URL: $miniappUrl"
Write-Host ""
Write-Host "Env for backend (optional):"
Write-Host "  TELEGRAM_MINIAPP_URL=$tunnelUrl"
