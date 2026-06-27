# goal-materials

> Материалы по целям пользователя: задачи, теория, ссылки, файлы. Привязка к целям из **`users/<user_key>/profile.md`**, CLI `scripts/goal-materials.mjs`, статусы разбора. Действия в Telegram — **текстом** (без inline-кнопок).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-skill-blue)](https://docs.openclaw.ai)

## Что это

OpenClaw-скилл, который превращает личную копилку учебных материалов в структурированную библиотеку, привязанную к целям из `users/<user_key>/profile.md` (ЕГЭ, олимпиады, темы).

Поддерживает:
- 📚 **5 типов материалов**: `problem`, `theory`, `link`, `file`, `note`
- 🎯 **Автопривязку к целям** из `profile.md` — `goal-materials.mjs goals`
- 🔄 **Жизненный цикл статусов**: `new → working → understood/stuck → archived`
- 🎲 **Случайную выдачу** материалов с фильтрами (`pick --type problem --tag параметры --status new`)
- 🔍 **Поиск** по тексту/тегам/типу/статусу
- 💬 **Текстовые команды в Telegram**: «в работу» · «пропустить» · «сохранить» (см. `SKILL.md`)
- 📎 **Интеграцию с дневником** (`memory/YYYY-MM-DD.md`) при add/status
- 🌐 **Web-поиск** через саб-агента `web-material-finder` — только если `pick`/`today` пуст

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
# Цели из profile.md
node scripts/goal-materials.mjs goals --user tg-123

# Подборка (перед web-поиском!)
node scripts/goal-materials.mjs pick --user tg-123 --topic "параметры"

# Материалы на сегодня (тема из plans/YYYY-MM-DD.json)
node scripts/goal-materials.mjs today --user tg-123

# Добавить материал
node scripts/goal-materials.mjs add --user tg-123 --goal exam_math --type problem --title "Задача на параметры" --dry-run
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

## Telegram (текстовые команды)

Inline-кнопки **не используются**. Подсказки в тексте сообщения — см. `SKILL.md`. Legacy: `_archived/goal-materials-legacy/tg-buttons.md`.

Основные команды:
- `pick` → «в работу» · «не понял» · «пропустить»
- `list` → «открыть» · «в работу» · «в архив»
- `add` / `search` → «открыть» · «сохранить»

Статус материала меняется через `goal-materials.mjs status` по текстовой команде пользователя.

## Связь с другими скиллами

- **`note-to-file`** — формат записи в `memory/notes.jsonl` совместим
- **`daily-plan`** — тема дня для `goal-materials.mjs today`
- **`web-material-finder`** — новый поиск, если локальная библиотека пуста
- **`goal-checkin-notifier`** — может ссылаться на материалы в утреннем брифе
- **`timer`** — опционально: писать минуты, потраченные на материал

## Конвенции

- ID материала: `m_<8 символов>` (от timestamp + slug)
- Имя файла: `YYYY-MM-DD_<slug>.md` (slug транслитом, lower-case, без спецсимволов)
- Теги: lower-case, kebab-case, без `#`
- Статусы: фиксированный набор `new` / `working` / `stuck` / `understood` / `archived`

## Лицензия

[MIT](LICENSE)
