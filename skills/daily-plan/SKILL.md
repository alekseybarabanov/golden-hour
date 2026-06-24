---
name: "daily-plan"
description: "Генерирует users/<user_key>/plans/YYYY-MM-DD.json из профиля и макро-плана. Без дневного плана checkins молчит. Включает spaced repetition. Требует setup_status=complete."
---

# daily-plan

## Цель
Сгенерировать план на сегодня из профиля и макро-плана. Файл `plans/YYYY-MM-DD.json` нужен скиллу **`checkins`** (бриф, пинги, чек-ин).

## Триггер
- **Авто:** `session-start` предлагает dry-run, если нет `plans/<сегодня>.json`; cron `morning-plan.mjs` в 07:00 (без подтверждения)
- **Вручную:** «спланируй день» / «создай план» / «обнови план»

## Исполнение (только скрипт)

```bash
node scripts/daily-plan.mjs --user <user_key> --date <YYYY-MM-DD> --dry-run
node scripts/daily-plan.mjs --user <user_key> --date <YYYY-MM-DD>
```

Движок: `scripts/lib/daily-plan-engine.mjs` → `task-weighting` + `daily-balancer` + `spaced-repetition` + recurring.

1. Прочитать `profile.md` и `plan.md`. **Требует `setup_status: complete`.**
2. Собрать кандидаты, сбалансировать день (`D_max` из `daily_load`).
3. Записать `plans/YYYY-MM-DD.json`.
4. Показать пользователю `summary` из JSON — **не пересчитывать вручную**.

## Структура плана

```json
{
  "date": "YYYY-MM-DD",
  "user_id": "tg-1234567890",
  "goals": [{ "id": "g_...", "title": "...", "weight": 5 }],
  "tasks": [{
    "id": "t_001",
    "goal_id": "g_...",
    "title": "...",
    "scheduled_at": "YYYY-MM-DDTHH:MM:SS+03:00",
    "est_minutes": 60,
    "goal_weight": 5,
    "status": "planned",
    "snoozed_until": null
  }],
  "load": { "sum_difficulty": 7, "budget": 9 }
}
```

## Адаптация под `purpose`

- **olympiad** — по `olympiad_subject`, слабые блоки из `olympiad_level(s)`
- **exam** — по `exam_subject` / `exam_topics`, слабые из `exam_topic_levels`
- **topic** — по `study_topic` / `topic_sublevels`

## Spaced repetition

Слабые темы → `scripts/spaced-repetition.mjs` → кандидаты в дневной план. Интервалы: 1→3→7→14→30 дней.

## Зависимости

- После `setup-finalize` + `study-plan`
- Перед `checkins` / `task-pings`

## Где живёт реальное исполнение

**`SOUL.md` → «Рабочий режим» + таблица скриптов.** Этот файл — дизайн-документ.
