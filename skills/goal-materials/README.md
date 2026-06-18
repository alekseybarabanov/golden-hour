# goal-materials

> Материалы по целям пользователя: задачи, теория, ссылки, файлы. С автоматической привязкой к целям из `USER.md`, статусами разбора, Telegram inline-кнопками и интеграцией с общим inbox.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-skill-blue)](https://docs.openclaw.ai)

## Что это

OpenClaw-скилл, который превращает личную копилку учебных материалов в структурированную библиотеку, привязанную к целям пользователя (ЕГЭ, олимпиады, проекты, любые темы из `USER.md`).

Поддерживает:
- 📚 **5 типов материалов**: `problem`, `theory`, `link`, `file`, `note`
- 🎯 **Автопривязку к целям** из `USER.md` — не нужно каждый раз уточнять, к чему относится материал
- 🔄 **Жизненный цикл статусов**: `new → working → understood/stuck → archived`
- 🎲 **Случайную выдачу** материалов с фильтрами (`pick --type problem --tag параметры --status new`)
- 🔍 **Поиск** по тексту/тегам/типу/статусу
- 🤖 **Telegram inline-кнопки**: `[✅ Разобрала] [❌ Не поняла] [⏭ Пропустить]` — статус меняется одним нажатием
- 📎 **Интеграцию с общим inbox** (`memory/notes.jsonl`) — материалы попадают в поток заметок для последующего обзора через `show-ideas` / `idea-tools`
- 🌐 **Самостоятельный web_search** — скилл может сам найти 2–3 ссылки по теме, если активная цель задана

## Установка

Скопировать папку `goal-materials/` в `~/.openclaw/skills/` вашего workspace:

```bash
cp -r goal-materials ~/.openclaw/skills/
```

Или через OpenClaw skill workshop:

```bash
openclaw skills install --from ./goal-materials
```

## Быстрый старт

```bash
# Добавить задачу (цель возьмётся автоматически из USER.md)
> materials add --type problem
  Найдите все значения параметра a, при которых уравнение x² + ax + 1 = 0
  имеет два различных корня, оба меньше 2.

# Выдать случайную задачу по теме
> materials pick exam_math_profile --type problem --tag параметры --status new

# Посмотреть, что есть по цели
> materials list exam_math_profile

# Сводка по статусам
> materials list --summary

# Поиск по тегу
> materials search --tag тригонометрия

# Сменить статус
> materials status m_8a1f2c3d understood
```

## Структура файлов

```
goal-materials/
├── SKILL.md                  # основной файл скилла (workflow, конвенции)
├── README.md                 # этот файл
├── LICENSE                   # MIT
├── references/
│   ├── storage-schema.md     # frontmatter материалов + index.json
│   ├── status-flow.md        # диаграмма переходов статусов
│   ├── tg-buttons.md         # формат inline-кнопок + callback_data
│   └── memory-integration.md # что пишется в memory/
└── examples/
    ├── add.md                # пример команды add
    ├── pick.md               # пример команды pick
    └── status.md             # пример команды status
```

## Хранение материалов

```
materials/
├── index.json                                    # реестр для быстрого поиска
└── <goal_id>/
    ├── problems/YYYY-MM-DD_<slug>.md             # задачи
    ├── theory/YYYY-MM-DD_<slug>.md               # теория/формулы
    ├── links/YYYY-MM-DD_<slug>.md                # ссылки
    ├── files/                                    # прикреплённые файлы
    └── notes/YYYY-MM-DD_<slug>.md                # свободные заметки
```

Каждый материал — markdown с YAML frontmatter (id, goal_id, type, tags, status, source, history). Полная схема — [`references/storage-schema.md`](references/storage-schema.md).

## Telegram-кнопки

Все ответы бота сопровождаются inline-кнопками. Полная спецификация — [`references/tg-buttons.md`](references/tg-buttons.md).

Основные наборы:
- `pick` → `[✅ Разобрала] [❌ Не поняла] [⏭ Пропустить]`
- `list` (у каждого материала) → `[Открыть] [В работу] [🗑 В архив]`
- `add` → `[Открыть] [Добавить ещё]`
- `search` → `[Открыть] [В работу]`

callback_data формат: `mat:<action>:<id>[:<value>]`

При нажатии бот получает callback и автоматически обновляет статус материала, отвечает confirm-сообщением и редактирует исходное сообщение (убирая кнопки).

## Связь с другими скиллами

- **`note-to-file`** — формат записи в `memory/notes.jsonl` совместим
- **`show-ideas` / `idea-tools`** — материалы попадают в общий поток заметок; фильтруй по `type=material` или `goal_id`
- **`goal-checkin-notifier`** — может ссылаться на материалы в утреннем брифе
- **`focus-timer`** — опционально: писать минуты, потраченные на материал

## Конвенции

- ID материала: `m_<8 символов>` (от timestamp + slug)
- Имя файла: `YYYY-MM-DD_<slug>.md` (slug транслитом, lower-case, без спецсимволов)
- Теги: lower-case, kebab-case, без `#`
- Статусы: фиксированный набор `new` / `working` / `stuck` / `understood` / `archived`

## Лицензия

[MIT](LICENSE)
