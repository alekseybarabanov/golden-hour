<#
.SYNOPSIS
  Install complexity-check gates into a target workspace.

.DESCRIPTION
  Copies the gate rules (AGENTS.md), agent templates (agents/*.md), and the
  complexity-check script (scripts/complexity-check.ps1) into a target workspace.
  Use this when bringing a new bot/workspace into compliance with the gate protocol.

.PARAMETER TargetWorkspace
  Path to the target workspace. Defaults to the current directory.

.EXAMPLE
  .\scripts\setup-gates.ps1 -TargetWorkspace C:\path\to\other-workspace
#>
[CmdletBinding()]
param(
  [string]$TargetWorkspace = '.'
)

$ErrorActionPreference = 'Stop'

# Resolve script directory (where this script lives).
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Split-Path -Parent $ScriptDir

# Verify source has the gates.
$requiredFiles = @(
  'AGENTS.md',
  'agents/clawsec-prompt-injection-check.md',
  'agents/complexity-check.md',
  'agents/coding-agent.md',
  'scripts/complexity-check.ps1'
)

foreach ($f in $requiredFiles) {
  if (-not (Test-Path (Join-Path $SourceRoot $f))) {
    Write-Error "Source file missing: $f. Refusing to install incomplete gate set."
    exit 1
  }
}

# Verify target.
if (-not (Test-Path $TargetWorkspace)) {
  Write-Error "Target workspace does not exist: $TargetWorkspace"
  exit 1
}

# Create target directories.
New-Item -ItemType Directory -Force -Path (Join-Path $TargetWorkspace 'agents') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetWorkspace 'scripts') | Out-Null

# Copy files.
$copied = @()
foreach ($f in $requiredFiles) {
  $src = Join-Path $SourceRoot $f
  $dst = Join-Path $TargetWorkspace $f
  Copy-Item -Path $src -Destination $dst -Force
  $copied += $f
}

# Report.
Write-Host "Setup complete. Copied to $TargetWorkspace :"
foreach ($f in $copied) {
  Write-Host "  + $f"
}
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open the target workspace's AGENTS.md and verify the Red Lines section is intact."
Write-Host "  2. Run scripts/check-gates.ps1 -TargetWorkspace $TargetWorkspace to verify."
Write-Host "  3. Run scripts/test-gates.ps1 in the target workspace to demonstrate the gate firing."
