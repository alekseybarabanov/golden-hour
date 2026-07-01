# 05. Справочник скриптов

Детерминированная логика агента. Все скрипты — Node.js ≥18 (ESM `.mjs`), запускаются как `node scripts/<name>.mjs ...`. Полная таблица команд — в [`scripts/README.md`](../scripts/README.md).

## Контракт

- Каждый скрипт печатает **один JSON** в stdout: `{ ok: true, ... }` или `{ ok: false, error }`.
- Без LLM — чистый детерминизм. Агент вызывает скрипт → читает JSON → показывает `summary`. При `ok:false` результат не выдумывается.
- Порядок изменений: `--dry-run` → показать `summary` → запуск без флага.

## Переменные окружения

| Переменная | Смысл |
|---|---|
| `GH_WORKSPACE` | корень воркспейса (default: родитель `scripts/`) |
| `GH_USE_DB` | включить SQLite-бэкенд (нужен `npm install`) |
| `GH_CARDS_KEEP` | сколько наборов табличных карточек хранить (default 20) |
| `TELEGRAM_BOT_TOKEN` | токен для доставки cron-сообщений |
| `GH_OWNER_CHAT_ID` / `OWNER_TELEGRAM_CHAT_ID` | алерты владельцу при сбоях cron |

## Онбординг и профиль

| Скрипт | Назначение | Ключевой CLI | Пишет |
|---|---|---|---|
| `session-start.mjs` | фаза сессии + снапшот профиля | `--user <key>` \| `--owner` | — |
| `profile-patch.mjs` | правка `profile.md` (основной способ записи) | `--user <key> [--patch {…}] [--set k=v] [--get] [--init] [--dry-run]` | `profile.md` |
| `onboarding-quick.mjs` | быстрый старт с дефолтами + кодификатор | `--user <key> --name … --purpose exam --exam-type … --deadline … --hours …` | `profile.md`, `plan.md` |
| `exam-topics.mjs` | кодификаторы тем экзаменов | `list \| show --id … \| resolve … \| apply --user <key> …` | `profile.md` |
| `profile-update.mjs` | правка профиля в SQLite (опц. `GH_USE_DB=1`) | `--user <key> [--set …] [--get]` | SQLite |

`session-start.mjs` возвращает: `{ ok, user_key, status, setup_status, action, profile_summary, paths, proactive_message, daily_plan_cmd, materials_today, onboarding_next }`.

## Планирование и веса

| Скрипт | Назначение | Ключевой CLI | Пишет |
|---|---|---|---|
| `study-plan.mjs` | макро-план подготовки | `--user <key> [--dry-run] [--force] [--purpose …] [--output …]` | `plan.md` |
| `daily-plan.mjs` | дневной план | `--user <key> [--date YYYY-MM-DD] [--dry-run]` | `plans/YYYY-MM-DD.json` |
| `morning-plan.mjs` | дневной план для **всех** пользователей (batch cron) | `[--date …] [--dry-run] [--force]` | `plans/…` всех юзеров |
| `task-weighting.mjs` | `eff_priority` / `eff_difficulty` | `--user <key> [--date …] [--topic …]` \| `weigh --json '…'` | — |
| `daily-balancer.mjs` | баланс дня из кандидатов | `--file cands.json --budget 9 --date …` (или stdin) | — |
| `normalize-plans.mjs` | починка неканонических статусов задач | `[--user <key>] [--date …] [--dry-run]` | `plans/…` |

## Задачи

| Скрипт | Назначение | Ключевой CLI | Пишет |
|---|---|---|---|
| `tasks.mjs` | трекер задач | `add\|list\|close\|progress\|decompose\|recurring --user <key> …` | `tasks.yaml`, `tasks.md`, `recurring.json` |
| `dashboard-task.mjs` | задачи в дневном плане (для dashboard) | `add\|list --user <key> --title … [--date …]` | `plans/YYYY-MM-DD.json` |

> Любую новую учебную задачу агент сразу добавляет в дневной план через `dashboard-task.mjs add`, чтобы её видел веб-кабинет.

## Таймер и фокус

| Скрипт | Назначение | Ключевой CLI |
|---|---|---|
| `timer.mjs` | единый таймер (pomodoro + focus) | `start\|status\|skip\|stop\|credit\|again\|stats\|schedule --user <key> [--mode …] [--duration …]` |
| `timer-tick.mjs` | тик активных таймеров (cron, каждую минуту) | `[--dry-run]` |
| `migrate-timer-storage.mjs` | миграция `pomodoro/` → `timer/` | `--user <key> \| --all [--dry-run]` |

## Обучение и повторение

| Скрипт | Назначение | Ключевой CLI |
|---|---|---|
| `spaced-repetition.mjs` | темы к повторению на дату | `--user <key> [--date …] [--max 3]` |
| `temporal-kg.mjs` | граф событий | `emit\|link\|topic\|window\|checkin\|solve\|import-progress\|import-all --user <key> …` |
| `longterm-stats.mjs` | статистика за период | `--user <key> [--period week\|month\|year\|all]` |
| `goal-materials.mjs` | библиотека материалов | `goals\|list\|pick\|today\|show\|search\|add\|status --user <key> …` |

## Карточки и рендер

| Скрипт | Назначение | Ключевой CLI | JSON |
|---|---|---|---|
| `study-plan-cards.mjs` | план → PNG | `--user <key> [--dry-run]` | `png_files`, `card_theme` |
| `table-cards.mjs` | markdown-таблица → PNG | `--user <key> --title … [--text … \| --file … \| --stdin]` | `png_files`, `tables_found` |
| `cleanup-cards.mjs` | ретеншен PNG | `[--user <key>] [--keep 20] [--dry-run]` | `directories_removed` |

## Чек-ины и уведомления

| Скрипт | Назначение | Ключевой CLI |
|---|---|---|
| `morning-brief.mjs` | утренний бриф всем (без LLM) | `[--date …] [--dry-run] [--grace-minutes N]` |
| `task-pings.mjs` | пинги задач по `scheduled_at` (batch) | `[--date …] [--dry-run] [--grace-minutes N]` |
| `evening-checkin.mjs` | вечерний чек-ин всем | `[--date …] [--dry-run] [--grace-minutes N]` |
| `plan-task.mjs` | ответ на пинг | `respond --user <key> --action start\|snooze\|skip\|done [--task-id …] [--snooze-minutes …]` |
| `checkin-record.mjs` | запись вечернего чек-ина | `--user <key> --text "…" [--date …]` |
| `cron-deliver.mjs` | запустить скрипт и доставить в Telegram | `<script.mjs> [args…] [--deliver-dry-run]` |

`cron-deliver.mjs` читает из JSON скрипта поле `results[].notifications[]` и шлёт каждое `message` через Telegram Bot API. Идемпотентность — через state-файлы (`.delivery-state-*.json`, `.ping-state-*.json`).

## Календарь, портал, утилиты

| Скрипт | Назначение | Ключевой CLI |
|---|---|---|
| `gcal.mjs` | Google Calendar (OAuth device flow, двусторонняя синхр.) | `connect\|connect:poll\|status\|disconnect\|upsert\|list\|delete --user <key> [--days N]` |
| `student-portal.mjs` | ссылка на веб-кабинет (LAN/хотспот) | `--user <key> [--rotate] [--include-lan]` → `portal_url` |
| `db-migrate.mjs` | миграция файлов → SQLite (experimental) | `[--dry-run] [--force] [--status]` |
| `run-tests.mjs` | unit-тесты (71+) | — |

## Общие модули `scripts/lib/`

| Модуль | Ответственность |
|---|---|
| `cli.mjs` | парсинг аргументов, JSON I/O, пути |
| `profile.mjs` | парсинг `profile.md` |
| `plan-parse.mjs` | парсинг `plan.md`, резолв макро-планов |
| `dates.mjs` | даты (Europe/Moscow, +03:00) |
| `task-weighting.mjs` | формулы приоритета/сложности |
| `daily-balancer.mjs` | алгоритм баланса дня (knapsack-подобный) |
| `daily-plan-engine.mjs` | ядро сборки дневного плана (общее для daily-plan и morning-plan) |
| `spaced-repetition.mjs` | интервалы и даты повторений |
| `task-templates.mjs` | детерминированные шаблоны заголовков задач |
| `study-plan.mjs` | генератор markdown макро-плана |
| `pomodoro-core.mjs` | конечный автомат помодоро (work/break/long_break) |
| `timer-dir.mjs` | хранилище `timer/` + авто-миграция из `pomodoro/` |
| `tasks-core.mjs` | парсер `tasks.yaml`, overdue, учёт времени |
| `onboarding.mjs` | определение шага онбординга |
| `onboarding-quick-core.mjs` | блоки тем для быстрого старта (олимпиады) |
| `goal-materials-core.mjs` | библиотека материалов по целям |
| `task-pings-core.mjs` | выбор задач для пингов (`scheduled_at`, тихие часы) |
| `plan-task-core.mjs` | обработчики действий (start/snooze/skip/done) |
| `progress-core.mjs` | запись чек-инов и расчёт streak |
| `plan-utils.mjs` | хелперы plan JSON (канонические статусы, нормализация) |
| `delivery-state.mjs` | флаги доставки per-user/per-day (идемпотентность) |
| `kg-hooks.mjs` | авто-эмит temporal-kg из checkins/tasks/timer |
| `cron-alert.mjs` | логирование сбоев cron (`memory/cron-errors.jsonl`) |
| `exam-topics-core.mjs` | загрузка кодификаторов из `data/exam-topics/` |
| `card-render.mjs` | пути и константы тем для рендера PNG |
| `markdown-table.mjs` | извлечение markdown-таблиц из текста |
| `temporal-kg-core.mjs` | хранилище графа (events.jsonl + topic-index) |
| `telegram-deliver.mjs` | доставка через Telegram Bot API (cron-safe) |
| `portal-core.mjs` | токены и LAN-URL веб-кабинета |
| `db.mjs` | слой SQLite (опц., better-sqlite3) |
| `users.mjs` | перечисление активных пользователей |

## Тесты

```bash
node scripts/run-tests.mjs   # 71+ unit-тестов
```

Запускаются также в CI (`.github/workflows/test-golden-hour.yml`), плюс smoke: `exam-topics.mjs list` и `cleanup-cards.mjs --dry-run`.
</content>
