# Update only the main bot menu button, without starting a tunnel.
param(
    [string]$PublicUrl = "",
    [string]$MenuText = "",
    [string]$BotToken = ""
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

if (-not $PublicUrl) {
    $PublicUrl = $env:TELEGRAM_MINIAPP_URL
    if (-not $PublicUrl) { $PublicUrl = Read-DotEnvKey "TELEGRAM_MINIAPP_URL" }
    if (-not $PublicUrl) {
        $errLog = Join-Path $Here "cloudflared-miniapp.err.log"
        if (Test-Path $errLog) {
            $m = Select-String -Path $errLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
            if ($m) { $PublicUrl = $m.Matches[0].Value }
        }
    }
}

if (-not $PublicUrl) {
    Write-Host "URL not found. Pass -PublicUrl https://xxxx.trycloudflare.com" -ForegroundColor Yellow
    exit 1
}

if (-not $BotToken) {
    Write-Host "No TELEGRAM_BOT_TOKEN in .env" -ForegroundColor Yellow
    exit 1
}

$miniappUrl = ($PublicUrl.TrimEnd('/')) + "/miniapp"
Write-Host "Menu button: $MenuText" -ForegroundColor Cyan
Write-Host "URL: $miniappUrl" -ForegroundColor Green

$bodyObj = @{ menu_button = @{ type = "web_app"; text = $MenuText; web_app = @{ url = $miniappUrl } } }
$body = $bodyObj | ConvertTo-Json -Depth 5 -Compress
$utf8Body = [System.Text.Encoding]::UTF8.GetBytes($body)
$uri = "https://api.telegram.org/bot$BotToken/setChatMenuButton"
Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json; charset=utf-8" -Body $utf8Body | Out-Null
Write-Host "Done." -ForegroundColor Green
