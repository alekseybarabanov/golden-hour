# Plan data schema

Input: daily/weekly plan produced by the planning skill.

## File location

`users/<user_key>/plans/YYYY-MM-DD.json` (папка пользователя, см. `user-profile`)

(Confirm path with the planning skill — implemented in `scripts/lib/daily-plan-engine.mjs`.)

## Schema

```json
{
  "date": "2026-06-17",
  "user_id": "u_local",
  "goals": [
    {
      "id": "g_42",
      "title": "Запустить MVP",
      "weight": 5,
      "deadline": "2026-07-01"
    }
  ],
  "tasks": [
    {
      "id": "t_101",
      "goal_id": "g_42",
      "title": "Написать ТЗ для бэкенда",
      "scheduled_at": "2026-06-17T14:00:00+03:00",
      "est_minutes": 90,
      "status": "planned",
      "goal_weight": 5,
      "weight": 5,
      "snoozed_until": null
    }
  ]
}
```

## Status values

- `planned` — not started yet
- `in_progress` — user said "начинаю"
- `done` — user confirmed via `Готово` / `plan-task.mjs` (`completed` при чтении нормализуется в `done`)
- `skipped` — user said "пропустить"
- `snoozed` — user said "отложить"; `snoozed_until` filled

## Required fields for this skill to work

- `goals[].weight` (1–5) — for prioritization
- `tasks[].goal_weight` or `tasks[].weight` (1–5) — for ping prioritization
- `tasks[].scheduled_at` — for ping timing
- `tasks[].status` — writable, this skill updates it
