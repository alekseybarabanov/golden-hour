---
name: "goal-materials"
description: "Материалы по целям: задачи/теория/ссылки; add/pick/status; memory/inbox + tg-кнопки."
---

# Goal Materials

Библиотека материалов (задачи, теория, ссылки, файлы, заметки), привязанная к целям пользователя из `USER.md` (ЕГЭ, олимпиады, проекты, темы). Скилл умеет и принимать то, что прислал пользователь, и сам подкидывать задачи/искать ссылки по теме. Все материалы дублируются в общий inbox (`memory/notes.jsonl` + `memory/YYYY-MM-DD.md`) для преемственности между сессиями.

## Когда использовать

- Пользователь прислал задачу/ссылку/формулу/файл и хочет сохранить к цели.
- Нужно выдать случайный материал по цели («дай задачу по параметрам»).
- Нужно посмотреть, что уже есть по цели/предмету.
- Нужно отметить материал как разобранный / не понятый.
- Скилл сам предлагает задачу или ссылку по теме (по запросу).
- Любой материал после `add` или `web_search` автоматически попадает в общий inbox (`memory/notes.jsonl` + дневник дня) — для последующего обзора через `show-ideas` / `idea-tools`.

## Workflow

### 1. Определить цель

- Если пользователь указал явно (`g_ege_math`, «ЕГЭ математика», «олимпиада по физике») — берём её.
- Если не указал — читаем активные цели из `USER.md`:
  - `exam_subjects` + `exam_subject_variants` → цели `exam_<subject>_<variant>`
  - `olympiad_*` → цели `olymp_<subject>_<grade>`
  - `purpose` / `topic` → общая цель `topic_<slug>`
  - Кастомные цели из `USER.md` → `goals: [...]` (если есть)
- Если активная цель одна — используем без вопроса.
- Если несколько — спрашиваем одним сообщением со списком.
- Если целей нет — просим назвать цель или создаём её.

### 2. Добавить материал (`add`)

- Типы: `problem`, `theory`, `link`, `file`, `note`.
- Теги: тема (`производная`, `параметры`, `стереометрия`), источник (`stepik`, `foxford`), уровень (`easy/medium/hard`).
- Статус при создании: `new`.
- Путь: `materials/<goal_id>/<type>/YYYY-MM-DD_<slug>.md`.
- Индекс: `materials/index.json`.
- Каждый материал — markdown с frontmatter:
  ```
  ---
  id: m_a1b2c3d
  goal_id: g_ege_math_profile
  type: problem
  tags: [параметры, егэ-профиль]
  status: new
  source: user
  created_at: 2026-06-18T11:59:00+03:00
  status_history:
    - { status: new, at: 2026-06-18T11:59:00+03:00 }
  ---
  ```
- Если пользователь прислал URL и попросил «найди по этой теме ещё» — скилл может сам подобрать 2–3 ссылки через `web_search` с пометкой `source: web_search` (только если есть активная цель).

**После создания файла** — обязательно:
1. Дописать запись в `memory/notes.jsonl`:
   ```json
   {"type":"material","id":"m_<id>","goal_id":"...","material_type":"problem","title":"...","tags":[...],"source":"user|web_search","source_url":null,"path":"materials/.../file.md","is_idea":false,"created_at":"<ISO>"}
   ```
2. Дописать строку в `memory/YYYY-MM-DD.md` (дневник дня):
   ```
   - 12:42  📎 [exam_math_profile] problem «Задача 16: стереометрия (куб)» → materials/exam_math_profile/problems/2026-06-18_stereometriya_kub.md
   ```

### 3. Посмотреть что есть (`list`)

- По цели: `materials list g_ege_math` → сгруппировано по типу и статусу.
- По тегу: `materials list --tag параметры`.
- Сводка: `materials list --summary` → счётчики по статусам.

### 4. Выдать материал (`pick`)

- Случайный из `new` (свежее) или из `working` (добить).
- Фильтры: `--type`, `--tag`, `--status`.
- Возвращает содержимое + переводит в `working`.

### 5. Поиск (`search`)

- По тексту/тегу/типу/статусу. Grep по markdown + индекс.

### 6. Изменить статус (`status`)

Переходы:
- `new` → `working` (вручную или автоматом из `pick`)
- `working` → `understood` (разобрался)
- `working` → `stuck` (не понял, нужен разбор)
- `stuck` → `working` (вернулся)
- `stuck` → `understood`
- `understood` → `archived` (неактуально)

Каждое изменение пишется в `status_history`. Смены `understood`/`stuck`/`archived` дополнительно отражаются в `memory/YYYY-MM-DD.md` строкой (но НЕ дублируются в `notes.jsonl` — там только материалы, не события).

## Telegram-интерфейс (inline buttons)

Все ответы бота сопровождаются inline-кнопками (Telegram `inline_keyboard`). Полное описание — `references/tg-buttons.md`.

**Кнопки по командам:**

- **`pick` (выдача материала):**
  ```
  [✅ Разобрала]  [❌ Не поняла]  [⏭ Пропустить]
  ```
  callback_data: `mat:status:<id>:understood` / `:stuck` / `:archived`

- **`list` (у каждого материала):**
  ```
  [Открыть]  [В работу]  [🗑 В архив]
  ```
  callback_data: `mat:show:<id>` / `mat:status:<id>:working` / `:archived`

- **`add` (после добавления):**
  ```
  [Открыть]  [Добавить ещё]
  ```
  callback_data: `mat:show:<id>` / `mat:add:continue`

- **`search` (у найденных):**
  ```
  [Открыть]  [В работу]
  ```
  callback_data: `mat:show:<id>` / `mat:status:<id>:working`

**Обработка callback:** callback приходит в агента как сообщение с `callback_data`. Агент:
1. Парсит `mat:<action>:<id>[:<value>]`
2. Выполняет команду (`status`, `show`, `add`)
3. Обновляет файл материала + `index.json` + при `understood`/`stuck` пишет строку в `memory/YYYY-MM-DD.md`
4. Отвечает коротким confirm-сообщением (без кнопок) или редактирует исходное сообщение

## Хранение

```
materials/
  index.json
  <goal_id>/
    problems/YYYY-MM-DD_<slug>.md
    theory/YYYY-MM-DD_<slug>.md
    links/YYYY-MM-DD_<slug>.md
    files/
    notes/YYYY-MM-DD_<slug>.md
```

```
memory/
  notes.jsonl                    # общий inbox
  YYYY-MM-DD.md                  # дневник дня
```

`index.json` обновляется при каждом `add`/`status`. Переиндексация — `materials rebuild-index`.
`notes.jsonl` обновляется при каждом `add` (но не при `status`).

## Источники материалов

- **От пользователя**: текст/ссылка/файл из сообщения. Скилл парсит и нормализует (frontmatter + slug из заголовка/первой строки).
- **От скилла**:
  - Из своего склада (`pick`).
  - Через `web_search` (если запрос «дай задачу/найди ссылку по теме» и тема распознана). Каждая найденная ссылка — отдельный материал с `source: web_search` и записью в inbox.
- Без активной цели web-поиск отключён.

## Конвенции

- ID материала: `m_<8-символов>` (от timestamp + slug).
- Имя файла: `YYYY-MM-DD_<slug>.md`, slug транслитом, lower-case, без спецсимволов.
- Теги — lower-case, kebab-case, без `#`.
- Статусы — только фиксированный набор: `new`, `working`, `stuck`, `understood`, `archived`.
- Записи в `notes.jsonl` — по одной JSON-строке, `type: "material"`, `is_idea: false`.

## Связь с USER.md

При старте скилл парсит `USER.md` и кеширует цели (обновлять при изменении). Если `USER.md` пустой или целей нет — скилл просит назвать цель или создать её.

## Связь с другими скиллами

- **`note-to-file`** — формат записи в `memory/notes.jsonl` совместим (тот же файл).
- **`show-ideas` / `idea-tools`** — материалы попадают в общий поток; можно фильтровать по `type=material` или `goal_id`.
- **`focus-timer`** — может писать минуты, потраченные на конкретный материал, в `materials/<id>/time_log.md` (опционально, не автоматом).
