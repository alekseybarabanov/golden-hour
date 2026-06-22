<#
.SYNOPSIS
  Pre-write complexity check with hardcoded refusal patterns.

.DESCRIPTION
  Returns a JSON verdict for the given task. Hardcoded patterns (e.g. "write Windows from
  scratch", "build an OS kernel", "Twitter clone", "LLM from scratch") return exceeds_limit +
  block_and_ask_user regardless of LLM heuristics. Non-matching tasks return ambiguous +
  recommend spawning the LLM-based complexity-check sub-agent for the actual estimate.

  This script exists because LLM-based rules can be ignored by the model. A script's output
  is a hard fact the bot must act on. Patterns are regex, matched case-insensitively against
  the lowercased task string.

.PARAMETER Task
  The task description (one line or multi-line).

.PARAMETER Limit
  Line limit. Default 1000.

.PARAMETER HardcodedOnly
  Skip the LLM-based fallback recommendation; only check hardcoded patterns. Useful for fast
  pre-flight checks where the bot will spawn complexity-check separately.

.EXAMPLE
  .\scripts\complexity-check.ps1 -Task "write Windows from scratch"
  # Returns: {"verdict":"exceeds_limit", ...}

.EXAMPLE
  .\scripts\complexity-check.ps1 -Task "add a button to the login page"
  # Returns: {"verdict":"ambiguous", "recommended_action":"block_and_ask_user", ...}
  # Bot should then spawn LLM-based complexity-check for the actual estimate.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
  [string]$Task,
  [int]$Limit = 1000,
  [switch]$HardcodedOnly
)

$ErrorActionPreference = 'Stop'

# Hardcoded refusal patterns. Match against the lowercased task.
# Any of these -> immediate exceeds_limit, no LLM estimate needed.
# Edit this list to add or remove refusal targets. Patterns are regex.
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 as Windows-1251 by default
# unless the file has a UTF-8 BOM, and non-ASCII patterns can mojibake on load.
$HardcodedRefusals = @(
  @{ Pattern = 'write.*windows.*from.*scratch|build.*windows|rewrite.*nt|reimplement.*nt|write.*win.*os';        Reason = 'OS-from-scratch (Windows/NT-class) is fundamentally >limit' }
  @{ Pattern = 'write.*os.*from.*scratch|build.*os.*from.*scratch|kernel.*from.*scratch|boot.*loader.*scheduler.*fs.*shell'; Reason = 'OS from scratch is fundamentally >limit' }
  @{ Pattern = 'build.*twitter.*clone|build.*facebook.*clone|build.*instagram.*clone|build.*tiktok.*clone|build.*youtube.*clone'; Reason = 'Major product clone is fundamentally >limit' }
  @{ Pattern = 'write.*3d.*engine|write.*game.*engine|build.*rendering.*engine|engine.*from.*scratch';          Reason = 'Engine from scratch is fundamentally >limit' }
  @{ Pattern = 'build.*chatgpt.*clone|build.*llm.*from.*scratch|train.*llm.*from.*scratch|build.*gpt.*from.*scratch'; Reason = 'LLM system from scratch is fundamentally >limit' }
  @{ Pattern = 'build.*compiler.*from.*scratch|write.*compiler|build.*database.*from.*scratch|write.*database.*engine'; Reason = 'Compiler or database engine from scratch is fundamentally >limit' }
)

$lower = $Task.ToLower()

foreach ($rule in $HardcodedRefusals) {
  if ($lower -match $rule.Pattern) {
    $result = @{
      verdict            = 'exceeds_limit'
      estimated_lines    = 5000
      limit              = $Limit
      confidence         = 'high'
      category           = 'full_app'
      factors            = @("hardcoded refusal: $($rule.Reason)")
      reasoning          = "Task matches hardcoded refusal pattern. This is a multi-thousand-line undertaking; the $Limit-line policy is binding."
      recommended_action = 'block_and_ask_user'
      source             = 'scripts/complexity-check.ps1'
    }
    $result | ConvertTo-Json -Depth 5
    exit 0
  }
}

# No hardcoded match. Recommend LLM-based complexity-check.
if ($HardcodedOnly) {
  $result = @{
    verdict            = 'ambiguous'
    estimated_lines    = $null
    limit              = $Limit
    confidence         = 'low'
    category           = 'unknown'
    factors            = @('no hardcoded match; -HardcodedOnly was set')
    reasoning          = 'No hardcoded pattern matched. The caller should now spawn the LLM-based complexity-check sub-agent.'
    recommended_action = 'block_and_ask_user'
    source             = 'scripts/complexity-check.ps1 (hardcoded-only)'
  }
  $result | ConvertTo-Json -Depth 5
  exit 0
}

# Default: ambiguous, recommend LLM check.
$result = @{
  verdict            = 'ambiguous'
  estimated_lines    = $null
  limit              = $Limit
  confidence         = 'low'
  category           = 'unknown'
  factors            = @('no hardcoded match; defer to LLM-based complexity-check sub-agent')
  reasoning          = 'No hardcoded pattern matched. The caller should spawn the LLM-based complexity-check via sessions_spawn agentId=complexity-check.'
  recommended_action = 'block_and_ask_user'
  source             = 'scripts/complexity-check.ps1'
}

$result | ConvertTo-Json -Depth 5
