# Remove ALL golden-hour-* cron jobs (use before register-all-cron.ps1).
$ErrorActionPreference = "Stop"

function Remove-AllGoldenHourJobs {
  $removed = 0
  do {
    $found = $false
    $raw = openclaw cron list --json 2>$null
    if (-not $raw) { break }
    $parsed = $raw | ConvertFrom-Json
    $list = @($parsed.jobs)
    if (-not $list -or $list.Count -eq 0) { $list = @($parsed) }
    foreach ($j in $list) {
      if ($j.name -like "golden-hour-*") {
        Write-Host "Removing $($j.name) ($($j.id))"
        openclaw cron rm $j.id 2>$null
        $removed++
        $found = $true
        break
      }
    }
  } while ($found)
  Write-Host "Removed $removed job(s)."
}

Remove-AllGoldenHourJobs
