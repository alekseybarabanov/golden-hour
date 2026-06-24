---
name: "tasks"
description: "Менеджер задач: веса, дедлайны, прогресс, напоминания. Агент-управляемый."
---

# tasks — Менеджер задач (агент-управляемый)

> Скилл для работы со списком задач пользователя. **Агент сам распознаёт намерение** из текста и вызывает нужную подкоманду `tasks.mjs`. Юзер не должен знать команды — только говорит что хочет.

## Принцип

**Главное — что агент умеет, а не команды CLI.** Юзер пишет «закрой задачу про отчёт», агент понимает «close» и вызывает `tasks.mjs close`. Юзер не должен писать `node scripts/tasks.mjs close --task 5`.

CLI — тонкий слой под агентом, не для пользователя напрямую.

## Что агент распознаёт (намерения → CLI)

| Юзер говорит | Агент вызывает |
|---|---|
| «добавь задачу X» / «новая задача X» | `tasks.mjs add --title "X" [--weight N] [--deadline ...]` |
| «список задач» / «что в работе» | `tasks.mjs list` |
| «закрой X» / «сделал X» / «X готово» | `tasks.mjs close --task <id>` (агент находит id по имени) |
| «X на 50%» / «X почти готов» | `tasks.mjs progress --task <id> --percent N` |
| «что горит» / «горит?» | Агент читает `tasks.mjs list`, считает overdue по `deadline < now` |
| «прогресс» / «общий прогресс» | Агент читает `tasks.mjs list`, считает `Σ(weight × progress) / Σ(weight)` |
| «завтра X» / «перенеси X на завтра» | Агент правит `deadline` в YAML (через `add` + новый id, или прямую правку файла) |
| «итог дня» | Агент читает `progress.md` + `tasks.mjs list`, выдаёт сводку |
| «напомни про X» | Агент ставит cron-`at` напоминание, **задача остаётся в `tasks.yaml`** |

## CLI (тонкий, для агента)

```bash
node scripts/tasks.mjs add --user <key> --title "..." [--weight 5] [--deadline 2026-06-27T15:00:00+00:00] [--category ...] [--done-when "..."]
node scripts/tasks.mjs list --user <key> [--status planned|in_progress|done|blocked|overdue] [--category ...]
node scripts/tasks.mjs close --user <key> --task <id>
node scripts/tasks.mjs progress --user <key> --task <id> --percent N
node scripts/tasks.mjs decompose --user <key> --task <id> --steps "шаг1|шаг2|шаг3"
node scripts/tasks.mjs recurring add --user <key> --title "..." [--schedule daily|weekdays|weekly] [--est-minutes 30]
node scripts/tasks.mjs recurring list --user <key>
node scripts/tasks.mjs recurring remove --user <key> --id <id>
```

**`list --status overdue`** — фильтрует по `deadline < now` (вычисляется, не хранится в YAML).

**Не CLI:** прогресс по весу, по категориям, горит/риск — на лету через `list` + арифметику в агенте.

## Хранилище

```
users/<user_key>/
  tasks.yaml       # источник истины (плоский YAML)
  tasks.md         # рендер для чтения (генерируется из yaml)
  recurring.json   # повторяющиеся дела для daily-plan
```

### Схема `tasks.yaml`

```yaml
- id: int
  name: string
  done_when: string
  category: string
  weight: int                 # 1-10, default 5
  deadline: ISO datetime      # или отсутствует
  duration: int               # минут на задачу
  status: planned | in_progress | done | blocked | overdue
  progress: 0-100
  time_spent_minutes: int
  created_at: ISO datetime
  updated_at: ISO datetime
```

**Default `weight = 5`**, **default `status = planned`**.

### Схема `tasks.md` (рендер)

Секции: «Сегодня», «Завтра», «Позже», «План (без даты)», «Блокеры», «История (закрытые)». Обновляется при каждом изменении `tasks.yaml`.

## Расчёты (агент делает на лету)

**Общий прогресс (по весу, НЕ среднее):**
```
overall = Σ(weight × progress) / Σ(weight)
```

**Прогресс по категории:**
```
category_progress = Σ(weight × progress) / Σ(weight) в категории
```

**Просрочено:**
```
tasks where status != done AND deadline < now
```

**Под риском (≤ 1.5 ч до дедлайна):**
```
tasks where status != done AND 0 < deadline - now < 1.5h
```

## Напоминания

Скилл **`checkins`** читает `plans/YYYY-MM-DD.json` и шлёт пинги по `scheduled_at` и `goal_weight`. Задачи из `tasks.yaml` — отдельный трекер (не источник слотов).

## Anti-patterns

- ❌ Создавать новые CLI-команды (`urgent`, `dashboard`, `move`, `mode`) — агенту хватает `list` + арифметика
- ❌ Дублировать `tasks.md` и `tasks.yaml` руками (yaml — истина, md — рендер)
- ❌ Удалять историю (только архивировать с датой)
- ❌ Запускать скилл при `setup_status != complete`
- ❌ Считать прогресс средним арифметическим (только по весу)
- ❌ Просить юзера вводить «task id» в чате — агент находит по имени сам
