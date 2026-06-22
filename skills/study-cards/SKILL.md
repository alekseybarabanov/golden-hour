---
name: "study-cards"
description: "PNG-карточки 1080×1440 для учебного плана и статистики: light/dark, кириллица, zero npm deps; отправка альбомом в Telegram."
---

# Study Cards — study-cards

Рендерит мобильные PNG-карточки из `plan.json` (макро-план) и `tasks.yaml` (статистика). **Zero npm-зависимостей** — только Node.js + локальный Edge/Chrome headless. Кириллица из коробки.

## Когда использовать

- Пользователь просит «покажи план картинками» / «скинь план в тг»
- После `study-plan` или `daily-plan` — визуализировать недели
- После `task-tracker` / `longterm-stats` — сводка, дедлайны, категории
- Отправка альбомом в Telegram (≤ 10 PNG за раз)

## Режимы

| Скрипт | Вход | Выход |
|---|---|---|
| `render.js` | `plan.json` в cwd | `cover_{light,dark}.png`, `weekN_{light,dark}.png` |
| `render-stats.js` | `tasks.yaml` (или `--source=PATH`) | `stats_cover_*`, `stats_deadlines_*`, `stats_cats_*` |

## Workflow

### 1. План (от study-plan / daily-plan)

```bash
cd skills/study-cards
cp /path/to/plan.json plan.json
node render.js
```

Или из workspace пользователя:

```bash
node skills/study-cards/render.js
# plan.json должен лежать рядом со скриптом или в cwd
```

### 2. Статистика (от task-tracker)

```bash
node skills/study-cards/render-stats.js --source=users/<user_key>/state/tasks.yaml
```

### 3. Отправка в Telegram

```bash
openclaw message send --target=<chat> --attachments="cover_dark.png,week1_dark.png,week2_dark.png"
```

**Правила альбома:**
- ≤ 10 файлов за одно сообщение
- Предпочитать `*_dark.png` для Telegram
- Порядок: cover → week1 → week2 → …

## Формат plan.json

См. `examples/plan.example.json`. Ключи: `cover` (title, subtitle, target, dates, stats) + `weeks[]` (label, title, subtitle, days[]).

## Формат tasks.yaml

См. `examples/tasks.example.yaml`. Секции `tasks:` и `meta:` — совместимо с `task-tracker`.

## Требования

- Node.js **14+**
- **Microsoft Edge** (Windows) или **Chrome** (Linux/macOS)
- Переопределить браузер: `EDGE_BIN=/path/to/chrome`

## Особенности

- HTML + Edge headless (не AI image-gen) — кириллица без артефактов
- Уникальный `--user-data-dir` на каждый скриншот (параллельные вызовы)
- Палитры недель циклически: 🟢 🟠 🟣 🔵
- Сгенерированные `*.png` и `*.html` в `.gitignore`

## Связанные скиллы

- `study-plan` — источник `plan.json`
- `daily-plan` — дневной план, можно собрать недельную карточку
- `task-tracker` / `longterm-stats` — источник `tasks.yaml`
- `goal-checkin-notifier` — доставка карточек в Telegram
