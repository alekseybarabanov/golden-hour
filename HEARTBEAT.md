# Heartbeat — периодические проверки

## Timer tick (каждые ~1 мин)
- Выполни: `node scripts/timer-tick.mjs`
- Если в JSON есть `results` с `notifications` — отправь **один раз** каждому `user_key` поле `message` (без кнопок)

> Cron: `scripts/cron/register-all-cron.ps1` — morning-plan, morning-brief, **task-pings** (*/5), evening-checkin, timer-tick. Доставка через `cron-deliver.mjs` (без LLM).

## Check-ins (напоминания по плану)
Скилл: `skills/checkins/SKILL.md`

| Время (MSK) | Скрипт | Действие |
|---|---|---|
| 07:00 | `morning-plan.mjs` | Дневной план для всех `setup_status: complete` (без подтверждения — cron) |
| 09:00 | `morning-brief.mjs` | Утренний бриф из `plans/<сегодня>.json` (`morning_brief_time`; cron `*/15` 7–10 MSK) |
| каждые 5 мин | `task-pings.mjs` | Пинги задач по `scheduled_at`, max 3/день |
| 21:00 | `evening-checkin.mjs` | Вечерний чек-ин (`evening_checkin_time`; cron `*/15` 20–22 MSK) |

**Доставка (бриф / пинги / чек-ин / таймер):** cron запускает `node scripts/cron-deliver.mjs <script>.mjs` — скрипт → JSON → Telegram Bot API (`TELEGRAM_BOT_TOKEN`). Без LLM.

**Ручной fallback (heartbeat):** прочитай JSON скрипта → для каждого `results[].notifications` отправь `message` пользователю `user_key` **дословно**, без дублей. **Без inline-кнопок.** Состояние пингов пишет `task-pings.mjs` (`.ping-state-*.json`); бриф/вечер — `.delivery-state-*.json`.

Без `plans/YYYY-MM-DD.json` — `morning-brief` пропускает пользователя (`skipped: no_plan`).

<!-- Soul Guardian и ClawSec Advisory — только по cron (не дублировать здесь). -->
