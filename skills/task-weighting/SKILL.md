---
name: "task-weighting"
description: "CLI: eff_priority и eff_difficulty для тем/задач. Вызывается через task-weighting.mjs и daily-plan-engine."
---

# task-weighting

Детерминированные веса для `daily-plan`. **Не считать в голове.**

```bash
node scripts/task-weighting.mjs --user <key> [--topic "..."]
```

Используется внутри `daily-plan.mjs` / `morning-plan.mjs`. Агенту напрямую — только для отладки или показа приоритетов пользователю.
