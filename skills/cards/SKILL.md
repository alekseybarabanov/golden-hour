---
name: "cards"
description: "Визуализация в Telegram: макро-план и таблицы → PNG (dark|light). Абсолютный запрет markdown-таблиц в чате — только PNG, сразу, без запроса."
---

# cards — визуальные карточки (план + таблицы)

Единый скилл для **всех PNG в чате**. Telegram плохо показывает markdown-таблицы — **любой** ответ с таблицей (≥2 колонок) → **сначала PNG, потом короткий текст**. Без исключений.

## Абсолютное правило

| ❌ Запрещено | ✅ Обязательно |
|---|---|
| `\| col \|` в исходящем сообщении | `table-cards.mjs` → PNG → attachments |
| «Вертикальный список вместо таблицы» для табличных данных | Рендер сразу, без `--dry-run` для таблиц |
| Спрашивать «картинкой или текстом?» | PNG по умолчанию и единственный формат |
| «Сейчас отрисую…» без PNG в том же ходе | `png_files` из JSON → альбом в Telegram |

## Два режима

| Режим | Триггеры | Скрипт | Выход |
|---|---|---|---|
| **План** | «карточки плана», «/cards», «план в картинках» | `study-plan-cards.mjs` | `users/<key>/cards/*.png` |
| **Таблица** | любая таблица, «сделай таблицу», расписание по дням/слотам | `table-cards.mjs` | `users/<key>/cards/tables/*.png` |

Тема (`dark` / `light`) — из `profile.md → theme` (default `dark`).

## Обязательный flow для таблиц (каждый раз)

1. Собрать markdown-таблицу **для скрипта** (не для чата).
2. Выполнить (PowerShell: `;` между командами, не `&&`):
   ```bash
   node scripts/table-cards.mjs --user <key> --title "Заголовок" --text "| День | Слот | Что |
   |---|---|---|
   | Пн | утро | … |"
   ```
3. Прочитать JSON: `png_files[]`.
4. Отправить файлы **картинками** (альбом ≤10).
5. Текст пользователю: подпись + вопросы — **без строк таблицы**.

**Self-check:** перед отправкой ответа — если в тексте есть `| ... |`, остановиться и выполнить шаги 1–4.

## CLI (план)

```bash
# Макро-план → PNG (dry-run → рендер)
node scripts/study-plan-cards.mjs --user <key> --dry-run
node scripts/study-plan-cards.mjs --user <key>
```

## Рендер-движок

`skills/study-cards/` — HTML+Edge, кириллица. Оркестратор: `skills/study-plan-cards/scripts/render.js`.

Режимы orchestrator: `from-plan-file`, `from-state`, `from-topics`, `full` — см. README в `study-plan-cards/`.

## Правила

- ❌ Markdown-таблицы в Telegram — **никогда**
- ❌ Кириллица через `image_generate` — только `study-cards`
- ❌ Edge недоступен → повтор; fallback — вертикальный список **без** `|`, не markdown-таблица
- Перед `image_generate`: `node skills/study-cards/check-prompt.js --tool image_generate`

## Связанные скиллы

- `study-plan` — источник `plan.md`
- `checkins` — доставка PNG в Telegram
- `daily-plan` — CardPlan из дневного плана (опционально)

## Исполнение

**`SOUL.md` → «Визуализация»** — обязательный flow для агента. Приоритет выше dry-run и «короче для мобилы».
