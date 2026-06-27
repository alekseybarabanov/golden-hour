# Shared helpers for Felpik dashboard + Golden Hour student portal + Telegram mini apps.
$ErrorActionPreference = "Continue"

$script:DashboardRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$script:OpenClawHome = if ($env:OPENCLAW_HOME) { $env:OPENCLAW_HOME } else { Join-Path $env:USERPROFILE ".openclaw" }
$script:PortalStateFile = Join-Path $script:DashboardRoot ".portal-state.json"
$script:WatchdogLog = Join-Path $script:DashboardRoot "portal-watchdog.log"
$script:HotspotHost = if ($env:GH_STUDENT_PORTAL_HOTSPOT_HOST) { $env:GH_STUDENT_PORTAL_HOTSPOT_HOST.Trim() } else { "192.168.137.1" }
$script:TunnelUrlPattern = 'https://(?!(?:api|www|developers)\.)[a-z0-9-]+\.trycloudflare\.com'
$script:LocaltunnelUrlPattern = 'https://[a-z0-9-]+\.loca\.lt'

function Write-PortalWatchdogLog([string]$Message) {
    $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message
    Add-Content -Path $script:WatchdogLog -Value $line -Encoding utf8
    Write-Host $line
}

function Get-PortalStateHash {
    $state = Get-PortalState
    if ($state -is [pscustomobject]) {
        $h = @{}
        $state.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
        return $h
    }
    if ($state -is [hashtable]) { return $state }
    return @{}
}

function Resolve-PortalPython {
    if ($env:OPENCLAW_PYTHON -and (Test-Path $env:OPENCLAW_PYTHON)) { return $env:OPENCLAW_PYTHON }
    $py = (Get-Command python -ErrorAction SilentlyContinue).Source
    if ($py -and (Test-Path $py)) { return $py }
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}

function Test-PortalPortListening([int]$Port) {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return [bool]$c
}

function Test-PortalHttp([string]$Url, [int]$TimeoutSec = 5) {
    try {
        $headers = @{}
        if ($Url -match '\.loca\.lt') {
            $headers['Bypass-Tunnel-Reminder'] = 'true'
            $headers['User-Agent'] = 'golden-hour-portal-healthcheck'
        }
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -Headers $headers
        return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Stop-PortalPort([int]$Port) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return }
    foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

function Get-PortalState {
    if (-not (Test-Path $script:PortalStateFile)) { return @{} }
    try {
        return (Get-Content $script:PortalStateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        return @{}
    }
}

function Save-PortalState([hashtable]$State) {
    ($State | ConvertTo-Json -Depth 6) | Set-Content -Path $script:PortalStateFile -Encoding UTF8
}

function Read-SecretsBotToken([string]$Agent) {
    $secretsFile = Join-Path $script:OpenClawHome "secrets.json"
    if (-not (Test-Path $secretsFile)) { return "" }
    try {
        $secrets = Get-Content $secretsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $tg = $secrets.channels.telegram
        if ($Agent -eq "golden-hour") { return [string]$tg.'golden-hour'.botToken }
        return [string]$tg.botToken
    } catch {
        return ""
    }
}

function Set-TelegramMenuButton([string]$BotToken, [string]$MenuText, [string]$MiniappUrl) {
    if (-not $BotToken -or -not $MiniappUrl) { return $false }
    try {
        $menuJson = (@{
            type    = "web_app"
            text    = $MenuText
            web_app = @{ url = $MiniappUrl }
        } | ConvertTo-Json -Depth 5 -Compress)
        $uri = "https://api.telegram.org/bot$BotToken/setChatMenuButton"
        $resp = Invoke-RestMethod -Uri $uri -Method Post -Body @{ menu_button = $menuJson }
        if (-not $resp.ok) {
            Write-PortalWatchdogLog "menu button set failed: $($resp | ConvertTo-Json -Compress)"
            return $false
        }
        Start-Sleep -Milliseconds 800
        $cur = Get-TelegramMenuUrl $BotToken
        if ($cur -eq $MiniappUrl) { return $true }

        Clear-TelegramMenuButton $BotToken | Out-Null
        Start-Sleep -Seconds 2
        $resp2 = Invoke-RestMethod -Uri $uri -Method Post -Body @{ menu_button = $menuJson }
        if (-not $resp2.ok) { return $false }
        Start-Sleep -Milliseconds 1200
        $cur = Get-TelegramMenuUrl $BotToken
        if ($cur -ne $MiniappUrl) { return $false }
        return $true
    } catch {
        Write-PortalWatchdogLog "menu button failed: $_"
        return $false
    }
}

function Set-TelegramMenuButtonWithRetry([string]$BotToken, [string]$MenuText, [string]$MiniappUrl, [int]$Attempts = 8) {
    for ($i = 1; $i -le $Attempts; $i++) {
        if (Set-TelegramMenuButton $BotToken $MenuText $MiniappUrl) { return $true }
        if ($i -lt $Attempts) {
            Write-PortalWatchdogLog "menu retry $i/$Attempts for $MiniappUrl"
            Start-Sleep -Seconds 5
        }
    }
    $cur = Get-TelegramMenuUrl $BotToken
    Write-PortalWatchdogLog "menu button URL not applied (want=$MiniappUrl got=$cur)"
    return $false
}

function Clear-TelegramMenuButton([string]$BotToken) {
    if (-not $BotToken) { return $false }
    try {
        $menuJson = (@{ type = "default" } | ConvertTo-Json -Compress)
        $uri = "https://api.telegram.org/bot$BotToken/setChatMenuButton"
        Invoke-RestMethod -Uri $uri -Method Post -Body @{ menu_button = $menuJson } | Out-Null
        return $true
    } catch {
        Write-PortalWatchdogLog "clear menu button failed: $_"
        return $false
    }
}

function Get-TelegramMenuUrl([string]$BotToken) {
    if (-not $BotToken) { return "" }
    try {
        $mb = Invoke-RestMethod "https://api.telegram.org/bot$BotToken/getChatMenuButton"
        if ([string]$mb.result.type -ne "web_app") { return "" }
        return [string]$mb.result.web_app.url
    } catch {
        return ""
    }
}

function Default-MenuText([string]$Agent) {
    if ($Agent -eq "golden-hour") {
        $sun = [System.Text.Encoding]::UTF8.GetString([byte[]](0xF0, 0x9F, 0x8C, 0x85))
        return $sun + " " + [char]0x041A + [char]0x0430 + [char]0x0431 + [char]0x0438 + [char]0x043D + [char]0x0435 + [char]0x0442
    }
    $gear = [System.Text.Encoding]::UTF8.GetString([byte[]](0xE2, 0x9A, 0x99, 0xEF, 0xB8, 0x8F))
    return $gear + " " + [char]0x0424 + [char]0x0435 + [char]0x043B + [char]0x044C + [char]0x043F + [char]0x0438 + [char]0x043A
}

function Get-LocalLanIp {
    try {
        $nip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notmatch '^127\.' -and
                $_.IPAddress -notmatch '^169\.254\.' -and
                $_.PrefixOrigin -ne 'WellKnown'
            } |
            Sort-Object InterfaceMetric, PrefixLength |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($nip) { return $nip }
    } catch {}
    return "127.0.0.1"
}

function Get-HotspotHost {
    return $script:HotspotHost
}

function Get-HotspotBaseUrl([int]$Port) {
    return "http://$(Get-HotspotHost):$Port"
}

function Get-LanBaseUrl([int]$Port) {
    return "http://$(Get-LocalLanIp):$Port"
}

function Clear-TelegramMiniappMenus {
    foreach ($agent in @("main", "golden-hour")) {
        $tok = Read-SecretsBotToken $agent
        if ($tok) {
            Clear-TelegramMenuButton $tok | Out-Null
            Write-PortalWatchdogLog "telegram menu cleared ($agent) - use direct PC URL in phone browser"
        }
    }
}

function Sync-HotspotPortalState([hashtable]$State) {
    $adminBase = Get-HotspotBaseUrl 18790
    $lanBase = Get-LanBaseUrl 18790
    $State["admin_tunnel_url"] = $adminBase
    $State["student_tunnel_url"] = Get-HotspotBaseUrl 18791
    $State["admin_menu_url"] = "$adminBase/miniapp"
    $State["student_menu_url"] = "$adminBase/gh/miniapp"
    $State["lan_miniapp_url"] = "$lanBase/miniapp"
    $State["lan_gh_miniapp_url"] = "$lanBase/gh/miniapp"
    $State["lan_ip"] = Get-LocalLanIp
    $State["admin_tunnel_provider"] = "local-pc"
    $State["gh_miniapp_tunnel_provider"] = "local-pc"
    $State["proxy_mode"] = "hotspot"
    $State["admin_tunnel_pid"] = 0
    $State["gh_miniapp_tunnel_pid"] = 0
    $State["updated_at"] = (Get-Date).ToString("o")
    return $State
}

function Test-PortalUsesTunnels([hashtable]$State) {
    return [string]$State.proxy_mode -eq "tunnel"
}

function Merge-PortalTunnelStateFromDisk([hashtable]$State) {
    $saved = Get-PortalStateHash
    foreach ($k in @(
        "admin_tunnel_url", "student_tunnel_url",
        "admin_tunnel_pid", "gh_miniapp_tunnel_pid",
        "admin_tunnel_provider", "gh_miniapp_tunnel_provider",
        "admin_fail_count", "gh-miniapp_fail_count"
    )) {
        if ($null -ne $saved[$k] -and "$saved[$k]" -ne "") { $State[$k] = $saved[$k] }
    }
    return $State
}

function Maintain-PortalAccess([hashtable]$State) {
    if (Test-PortalUsesTunnels $State) {
        $prevUrl = [string]$State.admin_tunnel_url
        $adminTunnel = Ensure-AdminHttpsTunnel
        if ($adminTunnel) {
            $State["admin_tunnel_url"] = $adminTunnel
        }
        $urlChanged = $prevUrl -and $adminTunnel -and ($prevUrl.TrimEnd('/') -ne $adminTunnel.TrimEnd('/'))
        $menuBase = Get-TelegramMenuBaseUrl
        $menuMismatch = $adminTunnel -and $menuBase -and ($menuBase.TrimEnd('/') -ne $adminTunnel.TrimEnd('/'))
        $State = Sync-TelegramMiniappMenus $State -Force:($urlChanged -or $menuMismatch)
        if (-not $urlChanged -and -not $menuMismatch) {
            $State = Sync-TelegramMiniappMenus $State
        }
        $State["proxy_mode"] = "tunnel"
    } else {
        $State = Sync-HotspotPortalState $State
    }
    $State["updated_at"] = (Get-Date).ToString("o")
    return $State
}

function Test-TunnelHealthy([string]$BaseUrl, [string]$HealthPath = "/api/health") {
    if (-not $BaseUrl) { return $false }
    return (Test-PortalHttp "$($BaseUrl.TrimEnd('/'))$HealthPath" 15)
}

function Test-AdminTunnelReady([string]$BaseUrl) {
    if (-not $BaseUrl) { return $false }
    $base = $BaseUrl.TrimEnd('/')
    for ($try = 1; $try -le 3; $try++) {
        if ((Test-PortalHttp "$base/api/health" 20) -and (Test-PortalHttp "$base/gh/api/health" 25)) {
            return $true
        }
        if ($try -lt 3) { Start-Sleep -Seconds 3 }
    }
    return $false
}

function Stop-PortalWatchdog {
    $pidFile = Join-Path $script:DashboardRoot ".portal-watchdog.pid"
    if (-not (Test-Path $pidFile)) { return }
    $wpid = 0
    [void][int]::TryParse([string](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$wpid)
    if ($wpid -gt 0) {
        Stop-TunnelProcess $wpid
        Write-PortalWatchdogLog "stopped portal watchdog PID $wpid"
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Start-PortalWatchdog {
    $watchdog = Join-Path $script:DashboardRoot "watchdog.ps1"
    if (-not (Test-Path $watchdog)) { return $false }
    Stop-PortalWatchdog
    $outLog = Join-Path $script:DashboardRoot "portal-watchdog.out.log"
    $errLog = Join-Path $script:DashboardRoot "portal-watchdog.err.log"
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $watchdog
    ) -WorkingDirectory $script:DashboardRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    Write-PortalWatchdogLog "portal watchdog started PID $($p.Id)"
    return $true
}

function Sync-TelegramMiniappMenus([hashtable]$State, [switch]$Force) {
    $adminUrl = [string]$State.admin_tunnel_url

    if ($adminUrl -like "https://*" -and (Test-AdminTunnelReady $adminUrl)) {
        $wantMain = "$adminUrl/miniapp"
        $tokMain = Read-SecretsBotToken "main"
        $curMain = Get-TelegramMenuUrl $tokMain
        if ($Force -or $curMain -ne $wantMain) {
            if ($tokMain -and (Set-TelegramMenuButtonWithRetry $tokMain (Default-MenuText "main") $wantMain 12)) {
                $State["admin_menu_url"] = $wantMain
                Write-PortalWatchdogLog "admin menu -> $wantMain"
            }
        } elseif ($curMain -eq $wantMain) {
            $State["admin_menu_url"] = $wantMain
        }

        $wantGh = "$adminUrl/gh/miniapp"
        $tokGh = Read-SecretsBotToken "golden-hour"
        $curGh = Get-TelegramMenuUrl $tokGh
        if ($Force -or $curGh -ne $wantGh) {
            if ($tokGh -and (Set-TelegramMenuButtonWithRetry $tokGh (Default-MenuText "golden-hour") $wantGh 12)) {
                $State["student_menu_url"] = $wantGh
                Write-PortalWatchdogLog "golden-hour menu -> $wantGh"
            } elseif ($curGh -and $curGh -ne $wantGh) {
                Write-PortalWatchdogLog "golden-hour menu stuck on $curGh (want $wantGh)"
            }
        } elseif ($curGh -eq $wantGh) {
            $State["student_menu_url"] = $wantGh
        }
    } elseif ($adminUrl) {
        Write-PortalWatchdogLog "telegram menus skipped - admin tunnel unhealthy ($adminUrl)"
    }

    return $State
}

function Start-PortalPythonBackend {
    param(
        [string]$ScriptName,
        [int]$Port,
        [string]$HostAddr = "0.0.0.0",
        [string]$OutLog,
        [string]$ErrLog
    )
    $py = Resolve-PortalPython
    if (-not $py) {
        Write-PortalWatchdogLog "python not found for $ScriptName"
        return $false
    }
    $backend = Join-Path $script:DashboardRoot $ScriptName
    if (-not (Test-Path $backend)) {
        Write-PortalWatchdogLog "missing $backend"
        return $false
    }
    Stop-PortalPort $Port
    Start-Process -FilePath $py -ArgumentList @($backend, "--port", "$Port", "--host", $HostAddr) `
        -WorkingDirectory $script:DashboardRoot -WindowStyle Hidden `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog | Out-Null
    Start-Sleep -Seconds 2
    return (Test-PortalHttp "http://127.0.0.1:$Port/api/health")
}

function Ensure-AdminDashboard {
    if (Test-PortalHttp "http://127.0.0.1:18790/api/health") { return $true }
    Write-PortalWatchdogLog "admin dashboard down - starting :18790"
    return Start-PortalPythonBackend -ScriptName "backend.py" -Port 18790 `
        -OutLog (Join-Path $script:DashboardRoot "backend.out.log") `
        -ErrLog (Join-Path $script:DashboardRoot "backend.err.log")
}

function Ensure-StudentPortal {
    if (Test-PortalHttp "http://127.0.0.1:18791/api/health") { return $true }
    Write-PortalWatchdogLog "student portal down - starting :18791"
    return Start-PortalPythonBackend -ScriptName "student_portal_backend.py" -Port 18791 `
        -OutLog (Join-Path $script:DashboardRoot "student-portal.out.log") `
        -ErrLog (Join-Path $script:DashboardRoot "student-portal.err.log")
}

function Read-TunnelUrlFromLog([string]$LogPath) {
    if (-not (Test-Path $LogPath)) { return "" }
    $found = @()
    foreach ($pattern in @($script:TunnelUrlPattern, $script:LocaltunnelUrlPattern)) {
        Select-String -Path $LogPath -Pattern $pattern -AllMatches | ForEach-Object {
            foreach ($m in $_.Matches) { $found += $m.Value }
        }
    }
    if ($found.Count -gt 0) { return $found[-1] }
    return ""
}

function Resolve-Cloudflared {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { return $cf.Source }
    foreach ($candidate in @(
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\Cloudflare\cloudflared\cloudflared.exe"
    )) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Stop-TunnelProcess([int]$TunnelPid) {
    if ($TunnelPid -le 0) { return }
    & taskkill.exe /PID $TunnelPid /T /F 2>&1 | Out-Null
}

function Stop-AllCloudflared {
    $procs = Get-Process cloudflared -ErrorAction SilentlyContinue
    if (-not $procs) { return 0 }
    $count = @($procs).Count
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-PortalWatchdogLog "stopped $count cloudflared process(es)"
    return $count
}

function Stop-AllLocaltunnel {
    $count = 0
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'localtunnel' } |
        ForEach-Object {
            Stop-TunnelProcess $_.ProcessId
            $count++
        }
    if ($count -gt 0) {
        Start-Sleep -Seconds 2
        Write-PortalWatchdogLog "stopped $count localtunnel process(es)"
    }
    return $count
}

function Stop-AllTunnels {
    $n = (Stop-AllCloudflared) + (Stop-AllLocaltunnel)
    return $n
}

function Test-TunnelProcessAlive([int]$TunnelPid) {
    if ($TunnelPid -le 0) { return $false }
    $proc = Get-Process -Id $TunnelPid -ErrorAction SilentlyContinue
    return [bool]$proc
}

function Wait-TunnelHealthy([string]$BaseUrl, [string]$HealthPath, [int]$Seconds = 45) {
    $url = "$($BaseUrl.TrimEnd('/'))$HealthPath"
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortalHttp $url 12) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Start-CloudflaredTunnelProcess {
    param([int]$Port, [string]$Name)

    $cfPath = Resolve-Cloudflared
    if (-not $cfPath) { return $null }

    $log = Join-Path $script:DashboardRoot "cloudflared-$Name.log"
    $errLog = Join-Path $script:DashboardRoot "cloudflared-$Name.err.log"
    if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }
    if (Test-Path $errLog) { Remove-Item $errLog -Force -ErrorAction SilentlyContinue }

    $p = Start-Process -FilePath $cfPath -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") `
        -WorkingDirectory $script:DashboardRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError $errLog

    $tunnelUrl = ""
    $deadline = (Get-Date).AddSeconds(35)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        foreach ($path in @($log, $errLog)) {
            $tunnelUrl = Read-TunnelUrlFromLog $path
            if ($tunnelUrl) { break }
        }
        if ($tunnelUrl) { break }
        if ($p.HasExited) { break }
    }

    if (-not $tunnelUrl -or $tunnelUrl -match '://api\.trycloudflare\.com') {
        Stop-TunnelProcess $p.Id
        return $null
    }

    return @{ pid = $p.Id; url = $tunnelUrl.TrimEnd('/'); provider = "cloudflared" }
}

function Start-LocaltunnelProcess {
    param([int]$Port, [string]$Name)

    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-PortalWatchdogLog "npx not found - localtunnel unavailable"
        return $null
    }

    $log = Join-Path $script:DashboardRoot "localtunnel-$Name.log"
    $errLog = Join-Path $script:DashboardRoot "localtunnel-$Name.err.log"
    if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }
    if (Test-Path $errLog) { Remove-Item $errLog -Force -ErrorAction SilentlyContinue }

    $p = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "npx --yes localtunnel --port $Port") `
        -WorkingDirectory $script:DashboardRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError $errLog

    $tunnelUrl = ""
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        foreach ($path in @($log, $errLog)) {
            $tunnelUrl = Read-TunnelUrlFromLog $path
            if ($tunnelUrl) { break }
        }
        if ($tunnelUrl) { break }
        if ($p.HasExited) { break }
    }

    if (-not $tunnelUrl) {
        Stop-TunnelProcess $p.Id
        return $null
    }

    return @{ pid = $p.Id; url = $tunnelUrl.TrimEnd('/'); provider = "localtunnel" }
}

function Save-TunnelState {
    param(
        [hashtable]$State,
        [string]$Name,
        [hashtable]$Tunnel
    )

    $urlKey = if ($Name -eq "gh-miniapp") { "student_tunnel_url" } else { "${Name}_tunnel_url" }
    $pidKey = if ($Name -eq "gh-miniapp") { "gh_miniapp_tunnel_pid" } else { "${Name}_tunnel_pid" }
    $providerKey = if ($Name -eq "gh-miniapp") { "gh_miniapp_tunnel_provider" } else { "${Name}_tunnel_provider" }
    $failKey = "${Name}_fail_count"

    $State[$urlKey] = $Tunnel.url
    $State[$pidKey] = $Tunnel.pid
    $State[$providerKey] = $Tunnel.provider
    $State[$failKey] = 0
    $State["updated_at"] = (Get-Date).ToString("o")
    Save-PortalState $State
}

function Ensure-PublicTunnel {
    param(
        [int]$Port,
        [string]$Name,
        [string]$HealthPath = "/api/health",
        [switch]$Force
    )
    $state = Get-PortalStateHash
    $urlKey = if ($Name -eq "gh-miniapp") { "student_tunnel_url" } else { "${Name}_tunnel_url" }
    $pidKey = if ($Name -eq "gh-miniapp") { "gh_miniapp_tunnel_pid" } else { "${Name}_tunnel_pid" }
    $failKey = "${Name}_fail_count"
    $storedUrl = [string]$state[$urlKey]
    $tunnelPid = 0
    [void][int]::TryParse([string]$state[$pidKey], [ref]$tunnelPid)

    if (-not $Force -and $storedUrl -and (Test-TunnelProcessAlive $tunnelPid)) {
        $healthy = if ($Port -eq 18790) { Test-AdminTunnelReady $storedUrl } else { Test-TunnelHealthy $storedUrl $HealthPath }
        if ($healthy) {
            $state[$failKey] = 0
            Save-PortalState $state
            return $storedUrl.TrimEnd('/')
        }
        Write-PortalWatchdogLog "tunnel $Name dead (process alive, URL unreachable) - restarting $storedUrl"
    } elseif ($Force) {
        Write-PortalWatchdogLog "tunnel $Name forced restart"
    } elseif (-not $storedUrl) {
        Write-PortalWatchdogLog "tunnel $Name missing - creating"
    }

    if (Test-TunnelProcessAlive $tunnelPid) {
        Stop-TunnelProcess $tunnelPid
    }

    $providerKey = if ($Name -eq "gh-miniapp") { "gh_miniapp_tunnel_provider" } else { "${Name}_tunnel_provider" }
    $prevProvider = [string]$state[$providerKey]

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $cfAttempt = Start-CloudflaredTunnelProcess -Port $Port -Name $Name
        if (-not $cfAttempt) { continue }

        Start-Sleep -Seconds 10
        $healthy = if ($Port -eq 18790) {
            (Wait-TunnelHealthy $cfAttempt.url "/api/health" 120) -and (Wait-TunnelHealthy $cfAttempt.url "/gh/api/health" 60)
        } else {
            Wait-TunnelHealthy $cfAttempt.url $HealthPath 120
        }
        if ($healthy) {
            Save-TunnelState $state $Name $cfAttempt
            Write-PortalWatchdogLog "tunnel $Name ($($cfAttempt.provider)) -> $($cfAttempt.url)"
            return $cfAttempt.url
        }

        Write-PortalWatchdogLog "tunnel $Name cloudflared unhealthy (try $attempt/3) - $($cfAttempt.url)"
        Stop-TunnelProcess $cfAttempt.pid
    }

    Write-PortalWatchdogLog "tunnel $Name cloudflared failed - trying localtunnel (VPN may block cloudflared)"
    $ltAttempt = Start-LocaltunnelProcess -Port $Port -Name $Name
    if ($ltAttempt) {
        Start-Sleep -Seconds 8
        $healthy = if ($Port -eq 18790) {
            (Wait-TunnelHealthy $ltAttempt.url "/api/health" 90) -and (Wait-TunnelHealthy $ltAttempt.url "/gh/api/health" 45)
        } else {
            Wait-TunnelHealthy $ltAttempt.url $HealthPath 90
        }
        if ($healthy) {
            Save-TunnelState $state $Name $ltAttempt
            Write-PortalWatchdogLog "tunnel $Name (localtunnel) -> $($ltAttempt.url)"
            return $ltAttempt.url
        }
        Stop-TunnelProcess $ltAttempt.pid
    }

    Write-PortalWatchdogLog "tunnel $Name unavailable"
    return ""
}

function Ensure-CloudflaredTunnel {
    param(
        [int]$Port,
        [string]$Name,
        [string]$HealthPath = "/api/health",
        [switch]$Force
    )
    return Ensure-PublicTunnel -Port $Port -Name $Name -HealthPath $HealthPath -Force:$Force
}

function Get-TelegramMenuBaseUrl {
    $main = Get-TelegramMenuUrl (Read-SecretsBotToken "main")
    $gh = Get-TelegramMenuUrl (Read-SecretsBotToken "golden-hour")
    if ($main -match '^(https://[^/]+)') {
        $base = $Matches[1]
        if ($gh -like "$base/*") { return $base }
    }
    if ($gh -match '^(https://[^/]+)') {
        $base = $Matches[1]
        if ($main -like "$base/*") { return $base }
    }
    return ""
}

function Get-TelegramHttpsBases {
    $bases = New-Object System.Collections.Generic.List[string]
    foreach ($url in @(
        (Get-TelegramMenuUrl (Read-SecretsBotToken "main")),
        (Get-TelegramMenuUrl (Read-SecretsBotToken "golden-hour")),
        [string](Get-PortalStateHash).admin_tunnel_url
    )) {
        if ($url -match '^(https://[^/]+)') {
            $base = $Matches[1]
            if (-not $bases.Contains($base)) { [void]$bases.Add($base) }
        }
    }
    return @($bases)
}

function Ensure-AdminHttpsTunnel {
    param([switch]$Force)

    $state = Get-PortalStateHash
    $storedUrl = [string]$state.admin_tunnel_url
    $tunnelPid = 0
    [void][int]::TryParse([string]$state.admin_tunnel_pid, [ref]$tunnelPid)
    $failCount = 0
    [void][int]::TryParse([string]$state.admin_fail_count, [ref]$failCount)

    if (-not $Force) {
        foreach ($candidate in (Get-TelegramHttpsBases)) {
            if ($candidate -like "https://*" -and (Test-AdminTunnelReady $candidate)) {
                $state["admin_fail_count"] = 0
                $state["admin_tunnel_url"] = $candidate.TrimEnd('/')
                Save-PortalState $state
                Write-PortalWatchdogLog "admin HTTPS tunnel ok -> $candidate"
                return $candidate.TrimEnd('/')
            }
        }

        $localOk = (Test-PortalHttp "http://127.0.0.1:18790/api/health" 5) -and
            (Test-PortalHttp "http://127.0.0.1:18791/api/health" 5)
        if ($localOk -and $storedUrl -like "https://*" -and (Test-TunnelProcessAlive $tunnelPid)) {
            $failCount++
            $state["admin_fail_count"] = $failCount
            Save-PortalState $state
            if ($failCount -lt 4) {
                Write-PortalWatchdogLog "admin tunnel public blip ($failCount/4) - keeping $storedUrl"
                return $storedUrl.TrimEnd('/')
            }
            Write-PortalWatchdogLog "admin tunnel unhealthy after $failCount checks - restarting ($storedUrl)"
        } elseif ($storedUrl -like "https://*" -and (Test-AdminTunnelReady $storedUrl)) {
            $state["admin_fail_count"] = 0
            Save-PortalState $state
            return $storedUrl.TrimEnd('/')
        }
    } else {
        $failCount = 0
    }

    if ($storedUrl -and -not $Force) {
        Write-PortalWatchdogLog "admin HTTPS tunnel stale - restarting ($storedUrl)"
    } else {
        Write-PortalWatchdogLog "admin HTTPS tunnel missing - creating (cloudflared/localtunnel)"
    }

    if (Test-TunnelProcessAlive $tunnelPid) { Stop-TunnelProcess $tunnelPid }

    $state["admin_fail_count"] = 0

    $cf = Start-CloudflaredTunnelProcess -Port 18790 -Name "admin"
    if ($cf) {
        Start-Sleep -Seconds 12
        if (Test-AdminTunnelReady $cf.url) {
            Save-TunnelState $state "admin" $cf
            Write-PortalWatchdogLog "admin tunnel (cloudflared) -> $($cf.url)"
            return $cf.url.TrimEnd('/')
        }
        Write-PortalWatchdogLog "admin tunnel cloudflared unhealthy - $($cf.url)"
        Stop-TunnelProcess $cf.pid
    }

    $lt = Start-LocaltunnelProcess -Port 18790 -Name "admin"
    if ($lt) {
        Start-Sleep -Seconds 12
        if (Test-AdminTunnelReady $lt.url) {
            Save-TunnelState $state "admin" $lt
            Write-PortalWatchdogLog "admin tunnel (localtunnel) -> $($lt.url)"
            return $lt.url.TrimEnd('/')
        }
        Stop-TunnelProcess $lt.pid
    }

    return ""
}

function Ensure-OpenClawGateway {
    if (Test-PortalPortListening 18789) { return $true }
    Write-PortalWatchdogLog "gateway down - openclaw gateway start"
    $oc = Get-Command openclaw -ErrorAction SilentlyContinue
    if (-not $oc) {
        Write-PortalWatchdogLog "openclaw CLI not found"
        return $false
    }
    & openclaw gateway start 2>&1 | Out-Null
    Start-Sleep -Seconds 8
    if (-not (Test-PortalPortListening 18789)) {
        & openclaw gateway restart --force 2>&1 | Out-Null
        Start-Sleep -Seconds 10
    }
    return (Test-PortalPortListening 18789)
}

function Start-PortalBackends {
    Write-PortalWatchdogLog "ensuring portal backends"
    Ensure-OpenClawGateway | Out-Null
    Ensure-AdminDashboard | Out-Null
    Ensure-StudentPortal | Out-Null
}

function Start-PortalStack {
    param([switch]$WithTunnels, [switch]$KeepTunnel)

    Write-PortalWatchdogLog "starting portal stack (local PC + hotspot)"
    Start-PortalBackends

    $state = Get-PortalStateHash
    $wantTunnels = [bool]$WithTunnels

    if (-not $KeepTunnel) {
        Stop-AllTunnels | Out-Null
    }

    if ($wantTunnels) {
        $state["proxy_mode"] = "tunnel"
        if ($KeepTunnel) {
            $adminTunnel = [string]$state.admin_tunnel_url
            Write-PortalWatchdogLog "reusing tunnel $adminTunnel"
        } else {
            $adminTunnel = Ensure-AdminHttpsTunnel -Force
        }
        if ($adminTunnel) {
            $state["admin_tunnel_url"] = $adminTunnel
            if (-not $state["admin_tunnel_provider"]) {
                $state["admin_tunnel_provider"] = "localtunnel"
            }
        }
        $state = Sync-TelegramMiniappMenus $state -Force
    } else {
        $state = Sync-HotspotPortalState $state
        Clear-TelegramMiniappMenus
        Write-PortalWatchdogLog "local PC admin=$($state.admin_tunnel_url) gh=$($state.student_menu_url)"
        Write-PortalWatchdogLog "LAN: $($state.lan_miniapp_url) (same Wi-Fi as PC)"
        Write-PortalWatchdogLog "hotspot: connect phone to PC Wi-Fi, open URLs above in browser"
    }

    Save-PortalState $state
    Write-PortalWatchdogLog "stack ready admin=:18790 student=:18791 gateway=:18789 hotspot=$(Get-HotspotHost)"
}
