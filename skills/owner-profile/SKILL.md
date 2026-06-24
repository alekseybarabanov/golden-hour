---
name: "owner-profile"
description: "Профиль владельца в users/owner/: management-режим, скип онбординга, аудит."
---

# owner-profile — Профиль владельца воркспейса

> Когда владелец заходит через webchat (или напрямую), он получает **management-режим** вместо learning-онбординга. Отдельный `user_key`, отдельный профиль, отдельные правила. Данные учеников владельцу доступны read-only через audit-скиллы, не через `users/tg-…`.

## Архитектура

```
users/owner/
  profile.md          # management-профиль (НЕ learning)
  audit-log.jsonl     # аудит-журнал действий владельца
  notes.md            # заметки владельца (опц.)
```

`user_key = owner` (а не `local`). OpenClaw bindings: webchat → `user_key=owner`. Telegram-бот НЕ реагирует на команду `/owner` (это не пользовательский режим).

## Профиль (`users/owner/profile.md`)

```markdown
# Профиль — owner

- **user_key:** owner
- **role:** workspace-owner
- **channel:** webchat (default)
- **created:** YYYY-MM-DD
- **updated:** YYYY-MM-DD HH:MM
- **setup_status:** complete

## Права
- **scope:** full                # полный доступ ко всему воркспейсу
- **can_apply_proposals:** true  # применять skill proposals без подтверждения
- **can_read_user_data:** read-only-via-audit  # НЕ напрямую users/tg-…/, только через audit-скиллы
- **can_send_to_users:** false   # НЕ отправлять сообщения ученикам от бота
- **can_modify_soul:** true      # править SOUL.md (с аудитом)
- **can_run_scripts:** true      # любые scripts/

## Ограничения
- **safety_overrides:** false    # safety-промпты НЕ отключаются даже для владельца
- **impersonation:** false       # НЕ притворяться другим пользователем
- **delete_without_confirm:** false  # удаление и архивация — только с явным подтверждением

## Логирование
- Все действия владельца → `users/owner/audit-log.jsonl`
- Формат: `{ ts, action, target, before, after, agent_thoughts }`
```

## `session-start` для owner

**Скип онбординга.** Если `users/owner/profile.md` нет — создать дефолтный (см. выше) и НЕ запускать `hello-intro`/`purpose-select`/и т.д.

Сразу после `session-start`:
1. Прочитать `users/owner/profile.md` → `setup_status: complete`
2. Поприветствовать: «🌅 Владелец. Что делаем?»
3. Показать меню management-команд

## Management-команды (вместо learning)

| Команда | Действие |
|---|---|
| «аудит», «проверь системы» | Полный аудит (как в прошлый раз) |
| «drift», «проверь дрифт» | Soul-guardian drift report |
| «approve MEMORY.md» | Закрыть drift на конкретном файле |
| «proposals», «покажи proposals» | Список pending proposals |
| «apply X», «reject X» | Lifecycle proposal |
| «cat SOUL.md», «show config» | Просмотр файлов (с фильтром чувствительного) |
| «users», «сколько пользователей» | Только количество и распределение по статусам (без имён/id) |
| «tests», «запусти тесты» | `node scripts/run-tests.mjs` |
| «git status» | Статус репозитория (если git) |
| «применить tasks», «применить timer» | Lifecycle proposal commands |

## Что владелец НЕ может (даже с `scope: full`)

| Действие | Почему |
|---|---|
| ❌ Отправить сообщение ученику от бота (impersonation) | Бот = сущность, не impersonation tool. Ученик должен сам взаимодействовать с ботом. |
| ❌ Читать `users/<tg-id>/` напрямую через file API | Только через audit-скиллы с записью в `audit-log.jsonl` |
| ❌ Удалять файлы без подтверждения | Dry-run → подтверждение → выполнение |
| ❌ Стирать `MEMORY.md` / `SOUL.md` целиком | Только точечные правки |
| ❌ Снимать safety-промпты | Они защищают агента, не владельца |
| ❌ Менять audit-log задним числом | Append-only |
| ❌ Выдавать себя за другого пользователя бота | Privacy |

## Аудит

Каждое действие владельца → запись в `users/owner/audit-log.jsonl`:

```jsonl
{"ts": "2026-06-23T22:30:00.000Z", "action": "edit_file", "target": "skills/telegram-group/SKILL.md", "before_hash": "abc...", "after_hash": "def..."}
{"ts": "2026-06-23T22:35:00.000Z", "action": "apply_proposal", "target": "tasks-20260623-2ba99fe847", "result": "ok"}
{"ts": "2026-06-23T22:40:00.000Z", "action": "run_script", "target": "scripts/run-tests.mjs", "result": "11 passed"}
```

## Anti-patterns

- ❌ Использовать `user_key=local` для владельца (только `owner`)
- ❌ Хранить чувствительные данные владельца в одном файле с `users/<tg-id>/` (изоляция)
- ❌ Скипать аудит для «быстрых» действий (всегда логируем)
- ❌ Давать владельцу Telegram-tokens учеников (только audit-доступ)
- ❌ Менять audit-log (append-only)
- ❌ Говорить «я твой владелец» в чате с учеником (это уже делает владелец через эту систему, агент не выдаёт данные владельца)
- ❌ Использовать владельческие права для обхода safety-промптов (safety ≠ permission)
