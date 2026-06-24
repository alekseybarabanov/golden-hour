# Fix phone access to student portal (run as Administrator).
$ErrorActionPreference = "Continue"
$Port = 18791
$Py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Host "Need Administrator - re-launching..."
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $MyInvocation.MyCommand.Path
    )
    exit 0
}

Write-Host "=== Golden Hour student portal: network fix ===" -ForegroundColor Cyan

# 1) Wi-Fi -> Private (less strict than Public)
Get-NetConnectionProfile | ForEach-Object {
    if ($_.NetworkCategory -ne "Private") {
        Write-Host "Network '$($_.Name)' -> Private"
        Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue
    }
}

# 2) Firewall: port + python program
$ruleNames = @(
    "Golden Hour Student Portal 18791",
    "Golden Hour Student Portal Python"
)
foreach ($n in $ruleNames) {
    netsh advfirewall firewall delete rule name="$n" 2>$null | Out-Null
}

netsh advfirewall firewall add rule name="Golden Hour Student Portal 18791" `
    dir=in action=allow protocol=TCP localport=$Port `
    profile=any enable=yes | Out-Host

if (Test-Path $Py) {
    netsh advfirewall firewall add rule name="Golden Hour Student Portal Python" `
        dir=in action=allow program="$Py" protocol=TCP `
        profile=any enable=yes | Out-Host
}

# 3) Show URLs
$ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "Firewall rules added. Try on phone (same Wi-Fi, NOT mobile data):" -ForegroundColor Green
foreach ($ip in $ips) {
    if ($ip -match '^192\.168\.56\.' -or $ip -match '^172\.(1[6-9]|2\d|3[01])\.') { continue }
    Write-Host "  http://${ip}:$Port/my/<token>"
}
Write-Host ""
Write-Host "If still fails on Guest Wi-Fi (Sber-Guest):" -ForegroundColor Yellow
Write-Host "  Guest networks block phone<->PC. Use MAIN Wi-Fi or PC hotspot:"
Write-Host "  Settings -> Network -> Mobile hotspot -> On, connect phone to PC hotspot."
Write-Host "  Then open: http://192.168.137.1:$Port/my/<token>"
Write-Host ""
Read-Host "Press Enter to close"
