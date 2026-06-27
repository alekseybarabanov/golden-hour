# Scripts — Золотой час

Детерминированные скрипты для скиллов. Агент **вызывает скрипт → читает JSON → формулирует ответ**. Не пересчитывает план/веса в голове.

Контракт (как `gcal.mjs`): stdout = один JSON `{ ok: true, ... }` или `{ ok: false, error }`.

## Быстрый старт

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"

# Статус сессии (подставь user_key из метаданных канала)
node scripts/session-start.mjs --user tg-1234567890

# Макро-план (перезапись: --force; олимпиада: --purpose olympiad --output plan-olympiad.md)
node scripts/study-plan.mjs --user tg-1234567890 --dry-run
node scripts/study-plan.mjs --user tg-1234567890

# Дневной план (--purpose olympiad для второго макро-плана)
node scripts/daily-plan.mjs --user tg-1234567890 --date 2026-06-24 --dry-run
node scripts/daily-plan.mjs --user tg-1234567890

# Веса тем
node scripts/task-weighting.mjs --user tg-1234567890

# Таймер
node scripts/timer.mjs status --user tg-1234567890
node scripts/migrate-timer-storage.mjs --user tg-1234567890 --dry-run

# Задачи
node scripts/tasks.mjs list --user tg-1234567890
node scripts/tasks.mjs recurring list --user tg-1234567890
node scripts/dashboard-task.mjs add --user tg-1234567890 --title "Разобрать тему" --date 2026-06-24
node scripts/dashboard-task.mjs list --user tg-1234567890 --date 2026-06-24

# Повторы (spaced repetition)
node scripts/spaced-repetition.mjs --user tg-1234567890

# Статистика
node scripts/longterm-stats.mjs --user tg-1234567890 --period week

# Карточки плана (PNG)
node scripts/study-plan-cards.mjs --user tg-1234567890 --dry-run
node scripts/study-plan-cards.mjs --user tg-1234567890

# Таблица → PNG
node scripts/table-cards.mjs --user tg-1234567890 --title "План" --text "| A | B |`n|---|---|`n| 1 | 2 |"

# Temporal KG
node scripts/temporal-kg.mjs import-all

# Материалы (локальная библиотека — перед web-поиском)
node scripts/goal-materials.mjs pick --user tg-1234567890 --topic "тема"
node scripts/goal-materials.mjs today --user tg-1234567890
node scripts/goal-materials.mjs list --user tg-1234567890

# Тесты
node scripts/run-tests.mjs
node scripts/morning-plan.mjs --dry-run
node scripts/morning-plan.mjs
```

## Cron (утро)

`morning-plan.mjs` в **07:00** Europe/Moscow — до morning brief (09:00). Инструкция: `scripts/cron/morning-plan.md`.

```powershell
# OpenClaw cron
.\scripts\cron\register-morning-plan.ps1

# или Windows Task Scheduler (без LLM)
.\scripts\cron\register-task-scheduler.ps1
```

## Скрипты

| Скрипт | Скилл | Назначение |
|---|---|---|
| `session-start.mjs` | session-start | фаза пользователя, сводка профиля |
| `study-plan.mjs` | study-plan | генерация `plan.md` (или `--output`) |
| `task-weighting.mjs` | task-weighting | eff_priority / eff_difficulty (CLI) |
| `daily-balancer.mjs` | daily-balancer | сборка дня из кандидатов (JSON) |
| `daily-plan.mjs` | daily-plan | `plans/YYYY-MM-DD.json` |
| `morning-plan.mjs` | daily-plan (batch) | все `users/*` на сегодня |
| `timer.mjs` | timer | pomodoro + focus сессии |
| `timer-tick.mjs` | timer (cron) | переходы фаз, уведомления |
| `migrate-timer-storage.mjs` | timer | `pomodoro/` → `timer/` |
| `tasks.mjs` | tasks | add/list/close/progress, decompose, recurring |
| `dashboard-task.mjs` | daily-plan / student portal | add/list задач прямо в `plans/YYYY-MM-DD.json` для личного dashboard |
| `spaced-repetition.mjs` | spaced-repetition | due-темы на повтор |
| `longterm-stats.mjs` | longterm-stats | агрегаты из tasks.yaml и plans/ |
| `study-plan-cards.mjs` | cards | CardPlan из plan.md → PNG |
| `table-cards.mjs` | cards | markdown-таблица → PNG |
| `temporal-kg.mjs` | temporal-kg | временной граф событий |
| `gcal.mjs` | google-calendar-sync | Google Calendar API |
| `goal-materials.mjs` | goal-materials | list/pick/today/add/status материалов |
| `morning-brief.mjs` | checkins | утренний бриф (все пользователи) |
| `task-pings.mjs` | checkins | пинги задач по `scheduled_at` |
| `plan-task.mjs` | checkins | ответ на пинг: start/snooze/skip/done → plan JSON |
| `checkin-record.mjs` | checkins | запись чек-ина → `progress.md` |
| `evening-checkin.mjs` | checkins | вечерний чек-ин |
| `cron-deliver.mjs` | checkins / timer | запуск скрипта + доставка в Telegram (без LLM) |
| `normalize-plans.mjs` | checkins | починка статусов `completed` → `done` в plans/*.json |
| `profile-patch.mjs` | user-profile / onboarding | **патч `profile.md` (основной способ записи)** |
| `onboarding-quick.mjs` | onboarding | быстрый старт с дефолтами + кодификатор |
| `exam-topics.mjs` | onboarding / study-plan | кодификаторы `data/exam-topics/` |
| `cleanup-cards.mjs` | cards | retention PNG-артефактов (`GH_CARDS_KEEP`, cron вс) |
| `profile-update.mjs` | user-profile | (эксперимент) SQLite — только при `GH_USE_DB=1` |
| `db-migrate.mjs` | — | (эксперимент) импорт файлов → SQLite — только при `GH_USE_DB=1` |
| `run-tests.mjs` | — | unit-тесты |

## Библиотека `scripts/lib/`

- `cli.mjs` — args, paths, JSON I/O
- `profile.mjs` — парсер `profile.md` (markdown + plain YAML)
- `plan-parse.mjs` — парсер `plan.md`, `resolvePlanPath`
- `dates.mjs` — даты (+03:00)
- `task-weighting.mjs` — формулы весов
- `daily-balancer.mjs` — алгоритм баланса дня
- `spaced-repetition.mjs` — интервалы повтора
- `task-templates.mjs` — шаблоны названий задач
- `study-plan.mjs` — генератор markdown плана
- `pomodoro-core.mjs` — ядро таймера (pomodoro + focus)
- `timer-dir.mjs` — `users/<key>/timer/` + auto-migrate из `pomodoro/`
- `tasks-core.mjs` — парсер tasks.yaml, overdue, auto-log времени
- `onboarding.mjs` — детектор шага онбординга (session-start)
- `goal-materials-core.mjs` — материалы по целям из profile.md
- `task-pings-core.mjs` — отбор задач для пинга
- `plan-task-core.mjs` — ответы на пинг (начинаю/отложить/пропустить)
- `progress-core.mjs` — запись чек-ина и streak в progress.md
- `plan-utils.mjs` — канонические статусы задач в plan JSON
- `delivery-state.mjs` — флаги доставки брифа/вечернего чек-ина
- `kg-hooks.mjs` — авто-emit temporal-kg из checkin/plan-task/timer
- `cron-alert.mjs` — лог ошибок cron в `memory/cron-errors.jsonl`
- `exam-topics-core.mjs` — загрузка кодификаторов тем

## Переменные окружения

- `GH_WORKSPACE` — путь к воркспейсу (по умолчанию: родитель `scripts/`)
- `GH_USE_DB` — `1` для экспериментального SQLite (`golden-hour.db`); по умолчанию **выкл** — данные в `users/`. Требует `npm install` (better-sqlite3).
- `GH_CARDS_KEEP` — сколько папок `cards/tables/*` хранить на пользователя (default 20).
- `GH_OWNER_CHAT_ID` / `OWNER_TELEGRAM_CHAT_ID` — алерт владельцу при падении cron-deliver.

## Правила для агента

1. Планирование (`study-plan`, `daily-plan`, `task-weighting`) — **только через скрипты**.
2. Перед записью — `--dry-run`, показать пользователю `summary`, затем без флага.
3. При `{ ok: false }` — не выдумывать результат, передать `error` пользователю.
4. Ответы на пинги и вечерний чек-ин — `plan-task.mjs` / `checkin-record.mjs`, не правка JSON/md вручную.
5. Новые учебные задачи для сегодняшнего дня — сразу через `dashboard-task.mjs add`, чтобы они появились в student dashboard/mini app и читались агентом из `plans/YYYY-MM-DD.json`.
