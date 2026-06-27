---
name: "checkins"
description: "Напоминания, чек-ины и рефлексия: утренний бриф, пинги по плану, итог дня, разбор срывов. Читает plans/YYYY-MM-DD.json."
---

# checkins — напоминания, чек-ины, рефлексия

Объединяет три связанных потока: **доставка напоминаний**, **фиксация прогресса**, **разбор провалов**.

> План на день — только через `daily-plan.mjs` / `morning-plan.mjs`. Этот скилл **читает** `plans/YYYY-MM-DD.json` и **пишет** в `progress.md`.

## 1. Напоминания

**Источник:** `users/<user_key>/plans/YYYY-MM-DD.json` (схема: `references/data-schema.md`).

| Событие | Время (MSK, default) | Скрипт |
|---|---|---|
| Утренний бриф | `09:00` (`morning_brief_time`) | `morning-brief.mjs` (cron `*/15` 7–10) |
| Пинг задачи | `tasks[].scheduled_at` | `task-pings.mjs` (cron */5, max 3/день) |
| Вечерний чек-ин | `21:00` (`evening_checkin_time`) | `evening-checkin.mjs` (cron `*/15` 20–22) |

**Доставка:** `cron-deliver.mjs` → Telegram Bot API. Токен: `TELEGRAM_BOT_TOKEN` или `~/.openclaw/secrets.json` → `channels.telegram.golden-hour.botToken`.

**Quiet hours:** 23:00–08:00 — пинги пропускаются (`task-pings.mjs`).

**Ответы:** текстом — «начинаю» / «отложить» / «пропустить» → `node scripts/plan-task.mjs respond --user <key> --action start|snooze|skip` (читает JSON → показывает `message`). **Без inline-кнопок.**

**Cron:** `register-all-cron.ps1` — 07:00 plan → morning-brief `*/15` 7–10 MSK (per-user `morning_brief_time`, default 09:00) → */5 pings → evening `*/15` 20–22 MSK (`evening_checkin_time`, default 21:00).

## 2. Чек-ин дня

**Триггеры:** «чек-ин», «итог дня», авто 21:00, ответ на вечерний пинг.

1. Что изучил сегодня?
2. Что на завтра? Блокеры?
3. Запись: `checkin-record.mjs` → `progress.md` + streak; **temporal-kg** — автоматически (поле `kg` в JSON).
4. Закрытая тема → `[x]` в progress + при необходимости `temporal-kg milestone`

**Не делает:** не шлёт пинги (это §1).

## 3. Рефлексия

**Когда:** «не успел / провалил», 2+ пропуска подряд, milestone <70%, 3+ дня без streak.

1. Факт без осуждения
2. Меню причин (время / фокус / непонял / приоритет / отвлёкся / забыл / форс-мажор)
3. Запись в `progress.md` + `temporal-kg reflection`
4. Адаптация: `study-plan`, `daily_load`, `tasks`, напоминания
5. Один micro-commit на 48 ч

## Конфигурация (на пользователя, опционально в profile.md)

- `morning_brief_time` — default `09:00`
- `evening_checkin_time` — default `21:00`
- `max_pings_per_day` — default `3`
- `quiet_hours_start` / `quiet_hours_end` — `23:00` / `08:00`

## Anti-patterns

- ❌ Считать расписание в голове — только JSON из `daily-plan.mjs`
- ❌ Пинговать без дневного плана
- ❌ Читать `tasks.yaml` для тайминга слотов (слоты — в plan JSON; tasks — отдельный трекер)
- ❌ Рефлексия по одному пропуску

## Связанные скиллы

`daily-plan`, `tasks`, `timer`, `temporal-kg`, `cards`

## Исполнение

**`SOUL.md` → «Рабочий режим» + `HEARTBEAT.md`**
