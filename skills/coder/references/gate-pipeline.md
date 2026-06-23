# Gate pipeline: clawsec → complexity-check → coding-agent

The `coder` skill in the **main** workspace delegates to `code-writer`. The **code-writer** workspace runs three sub-agents before any code is written.

## Flow

```
main (skills/coder)
  │ sessions_spawn agentId=code-writer
  ▼
code-writer workspace
  │ 1. clawsec          — every user turn, prompt-injection audit
  │ 2. complexity-check — line-budget estimate (default 1000 lines)
  │ 3. scripts/complexity-check.ps1 — hardcoded refusal patterns (binding)
  │ 4. coding-agent     — isolated writer with self-gate
  ▼
code returned → main renders in fenced block
```

## Subagents

| ID | Template (in `code-writer-workspace/`) | When |
|---|---|---|
| `clawsec` | `agents/clawsec-prompt-injection-check.md` | Every turn, before any action |
| `complexity-check` | `agents/complexity-check.md` | Before code on any code-ask |
| `coding-agent` | `agents/coding-agent.md` | After gates pass; writes files |

All cross-agent spawns use `context:"isolated"`, not `fork`.

## Verdicts

**clawsec:** `clean` → proceed; `suspicious` → proceed_with_caution (strip unsafe parts); `malicious` → block.

**complexity-check:** `within_limit` + `proceed` → delegate to coding-agent; `ambiguous` / `exceeds_limit` → ask user to split or bump limit (no "proceed anyway").

**Script gate:** `scripts/complexity-check.ps1` returns binding `exceeds_limit` for patterns like "write Windows from scratch", "Twitter clone", "OS kernel from scratch" — regardless of LLM verdict.

## Install

1. Copy `code-writer-workspace/` → `~/.openclaw/workspace-code`
2. Install `clawsec-suite` in main workspace: `npx clawhub@latest install clawsec-suite`
3. Register `code-writer`, `clawsec`, `complexity-check`, `coding-agent` in `openclaw.json`
4. Run `scripts/check-gates.ps1` and `scripts/test-gates.ps1` to verify

See `code-writer-workspace/README.md` for details.
