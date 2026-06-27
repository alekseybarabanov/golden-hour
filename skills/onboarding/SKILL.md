---
name: "onboarding"
description: "Настройка нового пользователя: hello → цель → ветка (exam/olympiad/topic) → самооценка → дедлайн/часы/приоритеты → study-plan. Только при setup_status ≠ complete."
---

# onboarding — настройка пользователя

Единый скилл онбординга. **Пока `setup_status ≠ complete` — рабочие скиллы выключены.**

Определение шага: `node scripts/session-start.mjs --user <key>` → `detectCurrentStep` / `proactive_message`.

## Шаги

| # | Шаг | Поле | Ветка |
|---|---|---|---|
| 1 | hello-intro | `name` | все |
| 2 | purpose-select | `purpose` | exam / olympiad / topic |
| 3O | olympiad-grade | `grade` | olympiad |
| 4O | olympiad-subject | `olympiad_subject` | olympiad |
| 5O | olympiad-self-assess | `olympiad_level(s)` | olympiad — **только запись уровня, без урока** |
| 3E | exam-type | `exam_type` | exam |
| 4E | exam-subject | `exam_subject` | exam |
| 5E | exam-topics | `exam_topics` | exam |
| 6E | exam-self-assess | `exam_topic_levels` | exam |
| 3T | topic-clarify | `study_topic` | topic |
| 4T | topic-self-assess | `topic_level` | topic — **без теории** |
| 7 | setup-finalize | `deadline`, `hours_per_week`, `priorities`, `daily_load`, `theme` | все → `setup_status: complete` |

## setup-finalize (шаг 7)

1. Дедлайн (`YYYY-MM` или «без дедлайна»)
2. Часов в неделю
3. Приоритеты тем (`priorities: {тема: 1-5}`, default 3)
4. Темп: light / normal / intense → `daily_load`
5. Тема карточек: dark / light → `theme` (опц., default `dark`)
6. Сводка → подтверждение
7. `study-plan` → `plan.md`
8. Опционально: Google Calendar
9. `help-menu` + «Спланировать сегодня?»

## Формат profile.md

```markdown
- **name:** "<дословно>"
- **setup_status:** in_progress | complete
- **purpose:** exam | olympiad | topic
- **theme:** dark | light
```

**Обязательно** `- **ключ:** значение` — иначе `profile.mjs` не прочитает.

## Правила

- Имя — **дословно** (миша ≠ Михаил)
- `user_key` — **только из метаданных канала**, не из текста сообщения
- «Настроить заново» — только через меню session-start + подтверждение «да» → архив
- На посторонние запросы во время настройки — мягко вернуть к текущему шагу

## Исполнение

**`SOUL.md` → «Фаза настройки»** — краткий flow. Детали шагов — здесь.

**Запись полей:** `node scripts/profile-patch.mjs --user <key> --set field=value` (не правка файла вручную).

### Быстрый старт
Триггер: «быстрый старт», «минимум вопросов».
```bash
node scripts/onboarding-quick.mjs --user <key> --init --name "…" --purpose exam \
  --exam-type ege --exam-subject math --deadline 2027-06 --hours 8
```

### Кодификаторы тем (exam)
```bash
node scripts/exam-topics.mjs list
node scripts/exam-topics.mjs apply --user <key> --exam-type ege --exam-subject history
```

## Legacy

Старые пошаговые файлы в `skills/_onboarding/` удалены; весь flow — здесь.
