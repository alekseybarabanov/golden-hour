# Register Golden Hour cron jobs (command payloads + Telegram delivery, no LLM).
# Run once from PowerShell in workspace root.

$ErrorActionPreference = "Stop"
$workspace = "$env:USERPROFILE\.openclaw\workspaces\golden-hour"

function Remove-JobByName($name) {
  do {
    $removed = $false
  $raw = openclaw cron list --json 2>$null
  if (-not $raw) { break }
  $parsed = $raw | ConvertFrom-Json
  $list = @($parsed.jobs)
  if (-not $list -or $list.Count -eq 0) { $list = @($parsed) }
    foreach ($j in $list) {
      if ($j.name -eq $name) {
        Write-Host "Removing old job: $name ($($j.id))"
        openclaw cron rm $j.id 2>$null
        $removed = $true
        break
      }
    }
  } while ($removed)
}

Write-Host "=== morning-plan 07:00 (no LLM, no deliver) ==="
Remove-JobByName "golden-hour-morning-plan"
openclaw cron add `
  --name golden-hour-morning-plan `
  --cron "0 7 * * *" `
  --tz Europe/Moscow `
  --session isolated `
  --command "node scripts/morning-plan.mjs" `
  --command-cwd $workspace `
  --no-deliver `
  --json

Write-Host "=== morning-brief 09:00 window (cron-deliver, */15 7-10 MSK) ==="
Remove-JobByName "golden-hour-morning-brief"
openclaw cron add `
  --name golden-hour-morning-brief `
  --cron "*/15 7-10 * * *" `
  --tz Europe/Moscow `
  --session isolated `
  --command "node scripts/cron-deliver.mjs morning-brief.mjs" `
  --command-cwd $workspace `
  --no-deliver `
  --json

Write-Host "=== task-pings every 5 min (cron-deliver, no LLM) ==="
Remove-JobByName "golden-hour-task-pings"
openclaw cron add `
  --name golden-hour-task-pings `
  --cron "*/5 * * * *" `
  --tz Europe/Moscow `
  --session isolated `
  --command "node scripts/cron-deliver.mjs task-pings.mjs" `
  --command-cwd $workspace `
  --no-deliver `
  --json

Write-Host "=== evening-checkin 21:00 window (cron-deliver, */15 20-22 MSK) ==="
Remove-JobByName "golden-hour-evening-checkin"
openclaw cron add `
  --name golden-hour-evening-checkin `
  --cron "*/15 20-22 * * *" `
  --tz Europe/Moscow `
  --session isolated `
  --command "node scripts/cron-deliver.mjs evening-checkin.mjs" `
  --command-cwd $workspace `
  --no-deliver `
  --json

Write-Host "=== timer-tick every 1 min (cron-deliver, no LLM) ==="
Remove-JobByName "golden-hour-timer-tick"
openclaw cron add `
  --name golden-hour-timer-tick `
  --every "1m" `
  --session isolated `
  --command "node scripts/cron-deliver.mjs timer-tick.mjs" `
  --command-cwd $workspace `
  --no-deliver `
  --json

Write-Host ""
Write-Host "Done. Token: TELEGRAM_BOT_TOKEN env or ~/.openclaw/secrets.json (channels.telegram.golden-hour.botToken)."
Write-Host "Verify: openclaw cron list"
