# TOOLS.md — локальные заметки владельца

Заметки о календарях, интеграциях, привычках. Заполняется по мере настройки.

## Скрипты планирования (`scripts/`)

Детерминированная логика скиллов — Node ≥18, без npm. Контракт: stdout = JSON `{ ok, ... }`.

**PowerShell:** в exec использовать `;`, не `&&` между командами.

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
node scripts/session-start.mjs --user local
node scripts/daily-plan.mjs --user local --dry-run
node scripts/run-tests.mjs
node scripts/morning-plan.mjs --dry-run
```

Полный список: `scripts/README.md`. Cron утреннего плана: `scripts/cron/morning-plan.md`.

**Таблицы в Telegram:** только PNG через `node scripts/table-cards.mjs --user <key> --title "…" --text "…"` → отправить `png_files`. Markdown-таблицы в чат запрещены (`SOUL.md` → «Визуализация»).

## Календари

- Google Calendar — см. `GOOGLE-CALENDAR.md` и `skills/google-calendar-sync/SKILL.md`

## Задачники

- `users/<user_key>/tasks.yaml` + `tasks.md` — живой список задач (skill `tasks`)

## Привычки по времени

- _заполнять по мере обнаружения_

## Интеграции

- Telegram — через OpenClaw (`openclaw.agent.example.json`)
- Cron утреннего плана — `scripts/cron/`
