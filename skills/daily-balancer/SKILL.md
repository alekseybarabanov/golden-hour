---
name: "daily-balancer"
description: "CLI: сборка сбалансированного дня из кандидатов (бюджет сложности). daily-balancer.mjs + lib/daily-balancer.mjs."
---

# daily-balancer

Раскладывает кандидаты по слотам утро/день/вечер с лимитом `D_max` из `daily_load`.

```bash
node scripts/daily-balancer.mjs --file candidates.json --budget 9 --date YYYY-MM-DD
```

В продакшене вызывается из `daily-plan-engine.mjs`, не вручную агентом.
