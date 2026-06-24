---
name: "telegram-group"
description: "Telegram-группа: lifecycle, общие задачи, групповой план. group_id = chat_id."
status: applied
---

# telegram-group — бот в Telegram-группе

Биндинг бота к групповому чату: `group_id = chat_id`. Общий профиль, план, задачи и прогресс — в `data/groups/<chat_id>/`.

## Data model

```
data/groups/<chat_id>/
  meta.json           # goal, subject, owner, setup_status
  profile.md          # как users/<key>/profile.md (setup_status: complete после create)
  plan.md             # макро-план (study-plan --group)
  progress.md         # чек-ины группы
  plans/YYYY-MM-DD.json
  members.json
  invites.json
  tasks.json          # групповые задачи (lifecycle как team-tasks)
  notifications.log
```

## CLI — lifecycle

```bash
node scripts/group.mjs group create --user <key> --chat-id <chat_id> --goal "..." [--subject X]
node scripts/group.mjs group invite --user <key> --chat-id <chat_id> --telegram-id <id> [--username @x]
node scripts/group.mjs group accept --user <key> --code <code> [--chat-id <chat_id>]
node scripts/group.mjs group leave --user <key> --chat-id <chat_id>
node scripts/group.mjs group show --chat-id <chat_id>
```

## CLI — задачи

```bash
node scripts/group.mjs task add --user <key> --chat-id <id> --title "..." [--deadline ISO] [--assignee-user <key>]
node scripts/group.mjs task take --user <key> --chat-id <id> --task task-001
node scripts/group.mjs task submit --user <key> --chat-id <id> --task task-001 [--note "..."]
node scripts/group.mjs task approve --user <key> --chat-id <id> --task task-001
node scripts/group.mjs task reopen --user <key> --chat-id <id> --task task-001 [--reason "..."]
node scripts/group.mjs task list --user <key> --chat-id <id> [--status planned|overdue|...]
```

## CLI — планирование

```bash
node scripts/study-plan.mjs --group <chat_id> [--user <key>] [--dry-run] [--force]
node scripts/daily-plan.mjs --group <chat_id> [--user <key>] [--date YYYY-MM-DD] [--dry-run]
```

## Inbound / session-start

```bash
node scripts/session-start.mjs --user <key> --group <chat_id> [--telegram-id N] [--username @x]
node scripts/group-invites-resolve.mjs --user <key> [--chat-id <id>] --telegram-id N
```

JSON включает `group`: `{ registered, is_member, members_count, has_plan, action }`.

## Скиллы в группе

| Скилл | Контекст | Ответ |
|---|---|---|
| `telegram-group` | group | lifecycle, задачи |
| `study-plan` / `daily-plan` | group | `--group` → plan в data/groups/ |
| `team-tasks` | альтернатива | data/teams/ для отдельных команд |
| `timer` / `tasks` | member DM | личные — только в личку |
| `help-menu` | group | групповой вариант |

## Privacy

- Не показывать `user_key`, `chat_id`, `telegram_id` в групповом чате
- Личные команды — только в DM автору
- Owner: `node scripts/group.mjs notifications --user <key> --chat-id <id>`

## Anti-patterns

- ❌ Использовать `chat_id` как `user_key` для личных скиллов
- ❌ Отвечать в группу на `/my`, timer, tasks
- ❌ Отвечать без @mention/reply (агент решает в SOUL)

## Связанные скиллы

- `team-tasks` — параллельная модель для команд вне Telegram-группы
- `session-start` — + `--group` для inbound из группы
