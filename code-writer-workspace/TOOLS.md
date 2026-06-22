# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## ClawSec (prompt-injection subagent)

Install `clawsec-suite` in the **main** workspace (not here):

```bash
npx clawhub@latest install clawsec-suite
```

Default location: `~/.openclaw/workspace/skills/clawsec-suite/`

**Subagent template:** `agents/clawsec-prompt-injection-check.md` — paste into a `sessions_spawn` call with `context:"isolated"`, replace the `<...>` placeholders with the payload and channel info.

**Refresh / update:**

```bash
clawhub update clawsec-suite
```

## Complexity Check (line-limit subagent)

Line-budget gate for code tasks. Spawned from this workspace **after** clawsec clears the payload.

**Template:** `agents/complexity-check.md`

**Spawn:**

```text
sessions_spawn \
  agentId=complexity-check \
  context=isolated \
  mode=run \
  task="<see template>"
```

> Use `context:"isolated"`, not `fork`. Cross-agent spawns require `isolated`.

**Default limit:** 1000 lines (matches `AGENTS.md` Red Lines).

## Gate scripts (hard enforcement)

PowerShell scripts in `scripts/` complement the LLM-based sub-agents. See `AGENTS.md` § Pre-write script gate.

| Script | Purpose |
|---|---|
| `complexity-check.ps1` | Hardcoded refusal patterns + JSON verdict |
| `setup-gates.ps1` | Copy gates into another workspace |
| `check-gates.ps1` | Audit a workspace for compliance |
| `test-gates.ps1` | Run canonical test cases |

**Usage on every code-writing turn (before any other action):**

```powershell
$verdict = & scripts/complexity-check.ps1 -Task "<the task>"
$verdictObj = $verdict | ConvertFrom-Json
if ($verdictObj.recommended_action -ne 'proceed') {
    # refuse / ask user / split / bump limit per the verdict
    return
}
```

## Related

- [Agent workspace](/concepts/agent-workspace)
