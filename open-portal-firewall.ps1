# Открывает порт 18791 (TCP) для student-portal на Private-профиле.
# Запускать от имени администратора: правый клик → "Run with PowerShell (Admin)"
$ErrorActionPreference = "Stop"
$name = "Student Portal 18791 (Private)"
$rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($rule) {
    Write-Host "Правило уже есть — обновляю."
    Remove-NetFirewallRule -DisplayName $name | Out-Null
}
New-NetFirewallRule `
    -DisplayName $name `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 18791 `
    -Profile Private `
    -Description "LAN access to Golden Hour student portal (http://<lan-ip>:18791)" | Out-Null
Write-Host "OK: правило '$name' добавлено на Private-профиль, TCP 18791."
Write-Host "Проверь в браузере телефона: http://10.216.37.92:18791/"
