<#
.SYNOPSIS
  Audit a workspace for the presence of complexity-check gates.

.DESCRIPTION
  Checks that all required gate files exist in the target workspace, and that AGENTS.md
  contains the key Red Lines. Returns a structured report and exits non-zero if anything
  is missing.

.PARAMETER TargetWorkspace
  Path to the target workspace. Defaults to the current directory.
#>
[CmdletBinding()]
param(
  [string]$TargetWorkspace = '.'
)

$ErrorActionPreference = 'Continue'

$requiredFiles = @(
  'AGENTS.md',
  'agents/clawsec-prompt-injection-check.md',
  'agents/complexity-check.md',
  'agents/coding-agent.md',
  'scripts/complexity-check.ps1'
)

$requiredRules = @(
  'Every user turn goes through ClawSec first'
  'Before complexity-check: detect scope ambiguity'
  'Before writing code, the request also goes through complexity-check'
  'First-message contract on code turns'
  'Code generation goes through `coding-agent`'
  'Pre-write script gate (hard enforcement)'
)

$missing = @()

Write-Host "=== File check ==="
foreach ($f in $requiredFiles) {
  $path = Join-Path $TargetWorkspace $f
  if (Test-Path $path) {
    Write-Host "  [OK]   $f"
  } else {
    Write-Host "  [MISS] $f"
    $missing += "file: $f"
  }
}

Write-Host ""
Write-Host "=== AGENTS.md rule check ==="
$agentsPath = Join-Path $TargetWorkspace 'AGENTS.md'
$agentsContent = ''
if (Test-Path $agentsPath) {
  $agentsContent = Get-Content $agentsPath -Raw
}
foreach ($rule in $requiredRules) {
  if ($agentsContent -match [regex]::Escape($rule)) {
    Write-Host "  [OK]   $rule"
  } else {
    Write-Host "  [MISS] $rule"
    $missing += "rule: $rule"
  }
}

Write-Host ""
if ($missing.Count -eq 0) {
  Write-Host "All gates present. Workspace is compliant."
  exit 0
} else {
  Write-Host "Gates missing: $($missing.Count) items."
  Write-Host "Run scripts/setup-gates.ps1 -TargetWorkspace $TargetWorkspace to install."
  exit 1
}
