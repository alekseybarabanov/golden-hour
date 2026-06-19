# Register golden-hour morning plan cron (07:00 Europe/Moscow)
# Uses --command payload (no LLM). Run once from PowerShell.

$workspace = "$env:USERPROFILE\.openclaw\workspaces\golden-hour"

openclaw cron add `
  --name golden-hour-morning-plan `
  --cron "0 7 * * *" `
  --tz Europe/Moscow `
  --session isolated `
  --command "node scripts/morning-plan.mjs" `
  --command-cwd $workspace `
  --no-deliver `
  --json

Write-Host "Done. Verify: openclaw cron list"
