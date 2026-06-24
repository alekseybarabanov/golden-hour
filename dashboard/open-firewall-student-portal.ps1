# Open Windows Firewall for student portal (run as Administrator once).
# Needed when Wi-Fi network profile is Public (e.g. Sber-Guest).

$ErrorActionPreference = "Stop"
$Port = 18791

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Host "Re-launching as Administrator..."
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $MyInvocation.MyCommand.Path
    )
    exit 0
}

$names = @(
    "Golden Hour Student Portal 18791",
    "Student Portal 18791 (Private)",
    "Student Portal 18791 (Public)"
)

foreach ($n in $names) {
    netsh advfirewall firewall delete rule name="$n" 2>$null | Out-Null
}

netsh advfirewall firewall add rule name="Golden Hour Student Portal 18791" `
    dir=in action=allow protocol=TCP localport=$Port `
    profile=domain,private,public | Out-Host

Write-Host ""
Write-Host "OK: TCP $Port allowed (Domain, Private, Public)."
Write-Host "Try from phone: http://<PC-WiFi-IP>:$Port/my/<token>"
Write-Host ""
Read-Host "Press Enter to close"
