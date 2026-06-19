# Register Windows Task Scheduler job (no LLM) — 07:00 daily

$workspace = "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node not found in PATH" }

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "scripts\morning-plan.mjs" `
  -WorkingDirectory $workspace

$trigger = New-ScheduledTaskTrigger -Daily -At "07:00"

Register-ScheduledTask `
  -TaskName "GoldenHour-MorningPlan" `
  -Action $action `
  -Trigger $trigger `
  -Description "Golden Hour: generate plans/YYYY-MM-DD.json for all users" `
  -Force

Write-Host "Registered GoldenHour-MorningPlan at 07:00 daily"
