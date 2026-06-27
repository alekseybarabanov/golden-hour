# Cron: утренний дневной план

Автогенерация `plans/YYYY-MM-DD.json` **до** morning brief (по умолчанию 09:00).

Скрипт: `node scripts/morning-plan.mjs` — обходит всех пользователей с `setup_status: complete`, пропускает если план на сегодня уже есть.

## Ручной запуск

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
node scripts/morning-plan.mjs --dry-run   # посмотреть, что будет
node scripts/morning-plan.mjs             # создать планы
node scripts/morning-plan.mjs --force     # пересобрать даже если файл есть
```

## Вариант A — OpenClaw cron (рекомендуется, **без LLM**)

Payload `command` — gateway выполняет shell напрямую:

```powershell
.\scripts\cron\register-all-cron.ps1
```

Регистрирует: `morning-plan` (07:00), `morning-brief` (09:00), `task-pings` (*/5), `evening-checkin` (21:00), `timer-tick` (1m). Доставка через `cron-deliver.mjs` + `TELEGRAM_BOT_TOKEN`. Требуется `openclaw gateway`.

Или только план:

```powershell
.\scripts\cron\register-morning-plan.ps1
```

Или вручную:

```powershell
openclaw cron add `
  --name golden-hour-morning-plan `
  --cron "0 7 * * *" `
  --tz Europe/Moscow `
  --session isolated `
  --command "node scripts/morning-plan.mjs" `
  --command-cwd "$env:USERPROFILE\.openclaw\workspaces\golden-hour" `
  --no-deliver
```

Проверка / ручной запуск:

```powershell
openclaw cron list
openclaw cron run <job-id> --wait
```

## Вариант B — Windows Task Scheduler (без LLM, надёжнее)

```powershell
$action = New-ScheduledTaskAction -Execute "node" -Argument "scripts/morning-plan.mjs" -WorkingDirectory "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
$trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
Register-ScheduledTask -TaskName "GoldenHour-MorningPlan" -Action $action -Trigger $trigger -Description "Daily plan JSON for all users"
```

## Связка с morning brief

| Время | Что |
|---|---|
| 07:00 | `morning-plan.mjs` → создаёт `plans/YYYY-MM-DD.json` |
| 09:00 | `golden-hour-morning-brief` → читает JSON, шлёт brief в Telegram |

Если morning-plan не сработал — brief всё равно может отправиться по вчерашнему/пустому плану; в логе `plans/YYYY-MM-DD-log.md` отметить «план не найден».

## Агент при «спланируй день»

1. `node scripts/daily-plan.mjs --user <key> --dry-run`
2. Показать `summary` пользователю
3. При «да» / без возражений: `node scripts/daily-plan.mjs --user <key>`
4. Озвучить `summary` из JSON — **не пересчитывать**

При «Продолжить» в session-start: если нет `plans/<сегодня>.json` — предложить спланировать или вызвать `morning-plan` / `daily-plan` автоматически.
