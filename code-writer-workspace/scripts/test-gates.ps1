<#
.SYNOPSIS
  Demonstrate the complexity-check gate firing on canonical vague tasks.

.DESCRIPTION
  Runs scripts/complexity-check.ps1 against a list of test cases and prints the verdicts.
  Useful for verifying that the gate is working in a workspace before relying on it.

.EXAMPLE
  .\scripts\test-gates.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CheckScript = Join-Path $ScriptDir 'complexity-check.ps1'

if (-not (Test-Path $CheckScript)) {
  Write-Error "complexity-check.ps1 not found in $ScriptDir"
  exit 1
}

$cases = @(
  @{ Task = 'напиши винду с нуля';                                                Expected = 'exceeds_limit' },
  @{ Task = 'write Windows from scratch';                                         Expected = 'exceeds_limit' },
  @{ Task = 'build me an OS kernel with bootloader + scheduler + FS + shell';     Expected = 'exceeds_limit' },
  @{ Task = 'build me a twitter clone';                                           Expected = 'exceeds_limit' },
  @{ Task = 'add a button to the login page';                                     Expected = 'ambiguous' },
  @{ Task = 'fix the off-by-one in the diff function';                            Expected = 'ambiguous' },
  @{ Task = 'write a Python function that returns the factorial of n';            Expected = 'ambiguous' }
)

$pass = 0
$fail = 0

Write-Host "=== Gate test suite ==="
Write-Host ""

foreach ($case in $cases) {
  $output = & $CheckScript -Task $case.Task
  $verdict = ($output | ConvertFrom-Json).verdict

  if ($verdict -eq $case.Expected) {
    Write-Host "  [PASS] '$($case.Task)' -> $verdict"
    $pass++
  } else {
    Write-Host "  [FAIL] '$($case.Task)' -> $verdict (expected $($case.Expected))"
    $fail++
  }
}

Write-Host ""
Write-Host "Results: $pass passed, $fail failed."

if ($fail -gt 0) {
  exit 1
}
exit 0
