---
name: "timer"
description: "Таймер фокус-сессий: pomodoro-циклы + focus-режим. Агент-управляемый, оба режима всегда доступны."
---

# timer — Таймер фокус-сессий (агент-управляемый)

> Единый скилл для помодоро (циклы работа/перерыв) и focus (одна задача с похвалой). **Агент сам решает** какой режим запустить по контексту запроса юзера. Юзер не знает команд — пишет что хочет.

## Принцип

**Главное — что агент умеет, а не команды CLI.** Юзер говорит «давай час позанимаюсь над X» — агент понимает «focus, 60 мин, task X» и вызывает `timer.mjs start --mode focus --duration 60 --task X`. Юзер говорит «поработаем 25/5» — агент вызывает `start --mode pomodoro --variant classic`.

CLI — тонкий слой под агентом, не для пользователя напрямую.

## Что агент распознаёт (намерения → CLI)

| Юзер говорит | Агент вызывает |
|---|---|
| «начни помодоро» / «поработаем по помидору» | `timer.mjs start --mode pomodoro [--variant classic|long|...]` |
| «давай час позанимаюсь над X» | `timer.mjs start --mode focus --duration 60 --task X` |
| «работаю 30 мин над задачей Y» | `timer.mjs start --mode focus --duration 30 --task Y` |
| «поработаем с 15 до 17» | `timer.mjs schedule --from 15:00 --to 17:00 --variant long` |
| «поработаем по плану» | `timer.mjs schedule --plan` |
| «что сейчас?» / «сколько осталось?» | `timer.mjs status` |
| «пропусти перерыв» | `timer.mjs skip` (только pomodoro) |
| «хватит» / «останови» | `timer.mjs stop` |
| «засчитать» (после focus) | `timer.mjs credit` |
| «ещё» (ещё одна focus-сессия) | `timer.mjs again` |
| «сколько я сегодня сделал?» | `timer.mjs stats` |
| «подтверждаю» | `timer.mjs schedule-confirm` |
| «отмена» (расписание) | Агент удаляет `users/<key>/timer/schedule-pending.json` напрямую |

## CLI (тонкий, для агента)

```bash
node scripts/timer.mjs start --user <key> [--mode pomodoro|focus] [--variant classic|long|extended|short] [--shorthand 30/60] [--duration N] [--task task-001]
node scripts/timer.mjs status --user <key>
node scripts/timer.mjs skip --user <key>           # только pomodoro
node scripts/timer.mjs stop --user <key>
node scripts/timer.mjs credit --user <key> [--date YYYY-MM-DD] [--task-id t_001]
node scripts/timer.mjs again --user <key> [--duration N] [--task task-001]
node scripts/timer.mjs stats --user <key>
node scripts/timer.mjs schedule --user <key> [--plan | --from HH:MM --to HH:MM | --hours N] [--variant ...] [--topic ...]
node scripts/timer.mjs schedule-confirm --user <key>
```

**Не CLI:** variants list (агент знает сам), mark-dialog (внутренний флаг), schedule-cancel (агент удаляет `schedule-pending.json` напрямую).

## Техника помодоро (ядро, не трогаем)

- Классический цикл: 25 мин работа / 5 мин перерыв
- **Long break каждые 4 цикла: 15 мин** — ключевая часть техники, не убирать
- Variants: `classic` (25/5), `long` (50/10), `extended` (100/20), `short` (15/3), `custom <work>/<break>` (bounds: work 1–240, break 1–60)
- DND во время сессии (не дёргать по другим скиллам)
- Scheduled sessions: окно из плана, генерация последовательности, подтверждение
- Drift recovery: пропуск фаз без спама уведомлений
- Proactive suggestions: max 1/день если план отстаёт
- Telegram dialog warmup: проверка `dialog_opened` перед первым стартом
- Quiet hours: уведомления отложены, сессия идёт
- Self-healing статистики при пропущенном cron

## Focus-режим

- Одна сессия на задачу (без перерыва, без циклов)
- Завершить досрочно — текстом: «стоп» / «хватит»
- Похвала в конце: «Молодец! 🎉 Занимался {N} мин»
- «засчитать» → `task.status = done` в `tasks.yaml` + статистика
- «ещё» → новая focus-сессия по той же задаче
- 5-оконная статистика: 24h / week / month / year / all
- `mid_session_pings: false` (тишина во время работы)
- `auto_log_to_plan: true` — при `--task <id>` время пишется в `tasks.yaml` → `time_spent_minutes` (pomodoro-core + focus stop/tick)

## Хранилище: `users/<key>/timer/`

```
session.json              # текущая сессия (любой режим)
stats.json                # 5-оконная статистика (общая)
history.jsonl             # завершённые сессии
log/
  YYYY-MM-DD.jsonl                # переходы фаз (только pomodoro)
  YYYY-MM-DD-dnd.jsonl            # DND-suppressed сообщения
  YYYY-MM-DD-stats.jsonl          # начисления статистики
  YYYY-MM-DD-suggestions.jsonl
  YYYY-MM-DD-schedule.jsonl
schedule-pending.json     # ожидающая подтверждения schedule-предложение
```

**Backward compat:** если `users/<key>/timer/` нет, но `pomodoro/` есть — читаем из старого. Миграция: `node scripts/migrate-timer-storage.mjs --user <key>` (или `--all`).

## Связь с другими скиллами

- `daily-plan` — даёт блоки для `schedule --plan`
- `checkins` — пингует «поработать»; ответ «начинаю» → focus prompt
- `longterm-stats` — читает `stats.json`
- `tasks` (новый) — focus-сессия привязана к `task_id` из `tasks.yaml`
- `study-plan` — расчёт weekly budget

## Anti-patterns

- ❌ Упрощать технику помодоро (убирать long break, фиксить 25/5)
- ❌ Навязывать один режим (оба всегда доступны)
- ❌ Писать `weight` для focus-сессий (только время и задача)
- ❌ Спамить уведомлениями во время сессии (DND)
- ❌ Запускать focus без явной задачи (нечего «засчитать»)
- ❌ Запускать этот скилл при `setup_status != complete`
- ❌ Использовать `~/.openclaw/pomodoro/` или `~/.openclaw/focus/` — только `users/<key>/timer/`
- ❌ Больше 1 proactive suggestion в день (hard cap, не quota)
- ❌ Ломать `stats.json` schema без version bump
- ❌ Добавлять новые CLI-команды без нужды (варианты, mark-dialog — в lib, не в CLI)
