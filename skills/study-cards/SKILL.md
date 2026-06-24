---
name: "study-cards"
description: "Render engine: PNG for plans, stats, tables. Called by cards skill (study-plan-cards.mjs / table-cards.mjs)."
---

# Study Cards — render engine

**Низкоуровневый движок рендера.** Точка входа для агента — скилл **`cards`**, не этот файл напрямую.

## Роль в связке

| Скилл | Роль |
|---|---|
| **`cards`** | Оркестратор: триггеры, CardPlan, доставка в Telegram |
| **`study-cards`** (этот) | Движок: `render.js`, `render-stats.js`, `render-table.js` → PNG |

**Стиль:** тёмная и светлая темы (`--themes=dark|light`). По умолчанию — `profile.md → theme` (default `dark`).

```
daily-plan / study-plan / exam-topics / tasks
                    │
                    ▼
           cards  ──exec──►  study-cards/render.js
                    │                   study-cards/render-stats.js
                    ▼
              cards/*.png  ──►  checkins / Telegram
```

## Скрипты

### `render.js` — план (cover + недели)

```bash
node skills/study-cards/render.js \
  --source=cards/plan.json \
  --output-dir=cards/ \
  --themes=dark
```

Флаги:
- `--source=` — CardPlan JSON (default: `plan.json` рядом со скриптом)
- `--output-dir=` — куда писать PNG/HTML (default: каталог скрипта)
- `--themes=dark|light` — встроенные темы (default `dark`, из `profile.md → theme`)
- `--no-weeks` — только обложка

Выход: `cover_dark.png`, `weekN_dark.png`

### `render-table.js` — произвольная таблица

```bash
node skills/study-cards/render-table.js \
  --source=table.json \
  --output-dir=cards/tables/ \
  --name=table-0.png
```

JSON: `{ title, subtitle?, headers[], rows[][] }`. Вызывается из `scripts/table-cards.mjs`.

### `render-stats.js` — статистика (tasks)

```bash
node skills/study-cards/render-stats.js \
  --source=users/<user_key>/tasks.yaml \
  --output-dir=cards/ \
  --themes=dark
```

Выход: `stats_cover_*`, `stats_deadlines_*`, `stats_cats_*`

### `check-prompt.js` — pre-flight guard (image_generate)

Перед `image_generate` с русским текстом — проверка. AI ломает кириллицу в таблицах; для учебного контента используй `render.js` (HTML+Edge).

```bash
node skills/study-cards/check-prompt.js --tool image_generate --prompt "План олимпиады"
node skills/study-cards/check-prompt.js --tool image_generate --source=cards/plan.json
node skills/study-cards/check-prompt.js --tool render --prompt "..."   # render + кириллица = OK
```

Exit: `0` ok · `1` при `--strict` и не-ASCII · `2` usage error.

## Форматы

- **CardPlan** (`plan.json`): см. `examples/plan.example.json` и раздел в `study-plan-cards/SKILL.md`
- **tasks.yaml**: см. `examples/tasks.example.yaml` — формат скилла `tasks`

## Требования

- Node.js **14+**
- Edge (Windows) или Chrome/Chromium — переопределить через `EDGE_BIN`

## Контракт вывода

В конце каждый скрипт печатает JSON-строку с manifest:

```json
{"kind":"plan","outputDir":"...","files":["cover_dark.png","week1_dark.png"]}
```

`study-plan-cards` использует её для сборки альбома Telegram.

## Связанные скиллы

- **`study-plan-cards`** — единственная точка входа для агента
- `study-plan`, `daily-plan`, `exam-topics` — источники CardPlan
- `tasks`, `longterm-stats` — источник `users/<user_key>/tasks.yaml`
