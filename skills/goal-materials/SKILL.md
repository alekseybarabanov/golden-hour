---
name: "goal-materials"
description: "Материалы по целям: add/pick/status; web/file-search/image/draw саб-агентом; tg-кнопки."
---

# Goal Materials

Библиотека материалов (задачи, теория, ссылки, файлы, заметки, **изображения**), привязанная к целям пользователя из `USER.md`. **Web/file/image/draw-поиск через саб-агента `web-material-finder`** в **5 режимах**: topic-based, source-based, file-search, image-generate, draw-programmatic. Бот не блокируется.

## Когда использовать

- add / pick / list / search / status — стандартно
- URL/файл + «найди похожие» — **source-based**
- PDF/DOCX/PPTX + «найди в нём» — **file-search**
- «нарисуй / график / схему (художественно)» — **image-generate** (AI)
- «нарисуй ТОЧНО / как в учебнике / чертёж с подписями / график функции / электросхему» — **draw** (программно через Python)
- Fallback: pick/search локально пусто → topic-based

## Workflow

### 1. Определить цель

Стандарт: exam_<subject>_<variant> / olymp_<subject>_<grade> / topic_<slug> / custom.

### 2. Добавить материал (`add`)

Типы: `problem`, `theory`, `link`, `file`, `note`, **`image`**.

Frontmatter (полный шаблон):
```yaml
---
id: m_<8-hex>
goal_id: <goal_id>
type: problem | theory | link | file | note | image
tags: [<tags>]
status: new
source: user | web_search | file_search | image_generate | image_draw
source_url: <url> | null
source_path: <file_path> | null
image_path: <path> | null
image_url: <url> | null
image_prompt: <text> | null
image_model: <name> | null
draw_backend: <matplotlib|graphviz|schemdraw|tikz> | null
draw_script_path: <path> | null
related_to: <id> | null
relation: <similar|theory_for|solution_for|deeper_version|easier_version> | null
excerpt: <text> | null
line_range: <"45-60"> | null
page: <n> | null
relevance: <0..1> | null
created_at: <ISO>
status_history:
  - { status: new, at: <ISO> }
---
```

**После создания файла:**
1. `memory/notes.jsonl` (mode-specific поля)
2. `memory/YYYY-MM-DD.md` (сводная строка)

### 3. `list` / 4. `pick` / 5. `search` / 6. `status`

Стандартно.

### 7. Web/file/image/draw-поиск (через саб-агента)

**НЕ делать web_search / image_generate / matplotlib инлайн.** Вместо этого — `sessions_spawn` саб-агента `web-material-finder`.

```python
sessions_spawn(
  task = <TASK_PROMPT>,
  taskName = f"matfind_{goal_id}_{slug}_{unix_ts}",
  mode = "run",
  context = "isolated",
  toolsAllow = ["web_search", "web_fetch", "read_file", "exec", "write", "image_generate"]
)
```

`write` нужен для mode=draw (сохранить .py скрипт в `_inbox/scripts/`).

#### 7.1 Topic-based (по теме)
`mode: "topic"`, web-поиск, placeholder `🔍`, JSON → материалы.

#### 7.2 Source-based (по источнику)
`mode: "source"`, `source_url`/`source_file` + `source_mode`, placeholder `🔗`, JSON → материалы с `related_to`+`relation`.

#### 7.3 File-search (PDF/DOCX/PPTX)
`mode: "file"`, `file_path` + `search_query`, placeholder `📄`, JSON → excerpts.

#### 7.4 Image-generate (AI-генерация картинки)

`mode: "image"`, `image_prompt` + опц. `reference_image`. Саб-агент вызывает `image_generate` (default: **`minimax/image-01`** — единственная сконфигурированная модель).

⚠️ **Известные ограничения AI image gen:**
- Текст в картинке — мусор (A₁ → «A1» или «1», α → не отрисовано)
- Математическая нотация — индексы, степени, греческие буквы — ломаются
- Точные геометрические отношения — приблизительные
- **Для схем с подписями вершин → используй mode=draw**

Placeholder `🎨`, JSON → материал с `image_path`/`image_prompt`/`image_model`. Кнопки `[✅ Сохранить] [🔄 Перегенерировать] [📐 Другой стиль]`.

#### 7.5 Draw (программная отрисовка — ТОЧНЫЕ чертежи)

Когда юзер просит **точную, чистую, учебниковую** схему — НЕ AI, а **программно** через Python (matplotlib/graphviz/schemdraw/tikz). Результат — идеальный как в учебнике: точные координаты, правильные подписи, корректная геометрия.

**Триггеры:**
- «нарисуй **точно** / **как в учебнике** / **чисто**»
- «построй график функции y = …»
- «чертёж куба / пирамиды / сферы / сечения»
- «электросхема / блок-схема»
- «3D-фигура с подписями»
- «TikZ / matplotlib / graphviz»

**Когда AI (mode=image) НЕ подходит → draw:**
- Любые схемы с подписями вершин (A, B, C, D, A₁…)
- Графики функций (точный масштаб, оси, метки)
- Геометрические чертежи (точные координаты)
- Электросхемы / блок-схемы / mind-maps
- Таблицы / матрицы / формулы (LaTeX → PNG)

**Алгоритм:**

1. **Определить `draw_type`:**
   - `cube / pyramid / sphere / geometry` → **matplotlib** (mpl_toolkits3d)
   - `function_plot / graph_2d` → **matplotlib** (pyplot)
   - `diagram / flowchart / tree` → **graphviz**
   - `circuit` → **schemdraw**
   - `latex_formula` → **matplotlib** (math + mathtext) или LaTeX → PNG
   - `geometric_2d` → **matplotlib** (patches)
2. **Саб-агент пишет Python-скрипт** в `materials/_inbox/scripts/<slug>.py`:
   ```python
   # пример для куба
   import matplotlib
   matplotlib.use('Agg')
   import matplotlib.pyplot as plt
   from mpl_toolkits.mplot3d.art3d import Poly3DCollection
   import numpy as np
   # ... код чертежа ...
   plt.savefig(r'<output_path>', dpi=150, bbox_inches='tight')
   ```
3. **Саб-агент выполняет** через `exec("python <script_path>")`.
4. **Саб-агент проверяет**, что PNG создан, читает метаданные (размер).
5. **Если не получилось** — правит скрипт (макс 3 попытки).
6. **Возвращает JSON:**
   ```json
   {
     "goal_id": "...",
     "mode": "draw",
     "sources": [{
       "title": "...",
       "type": "image",
       "tags": [...],
       "summary": "...",
       "image_path": "<путь к PNG>",
       "image_url": null,
       "draw_backend": "matplotlib|graphviz|schemdraw|tikz",
       "draw_script_path": "<путь к .py>",
       "draw_type": "cube|graph_2d|..."
     }]
   }
   ```

7. **Бот копирует PNG** в `materials/<goal_id>/images/YYYY-MM-DD_<slug>.png`, создаёт frontmatter с `source: "image_draw"`, `draw_backend`, `draw_script_path`. Скрипт остаётся в `_inbox/scripts/` (для повторного использования).

8. **Placeholder/результат в TG:**
   ```
   # placeholder:
   📐 Чертёж «<prompt>» (программно)…
   [⏹ Отменить]

   # результат:
   📐 Готово:
   [image inline]
   [✅ Сохранить] [🔄 Перегенерировать] [🛠 Изменить скрипт]
   ```

**Преимущества mode=draw:**
- ✅ Точные координаты, никаких артефактов
- ✅ Правильные подписи (A₁, B₁, α, β, π, …)
- ✅ Чистый LaTeX для формул
- ✅ Воспроизводимо (скрипт сохраняется)
- ✅ Можно докрутить позже (изменить скрипт → регенерация)

**Ограничения:**
- Требует `matplotlib` / `graphviz` / etc. в окружении (ставится через pip)
- Саб-агент должен уметь писать корректный Python-код

**Окружение (поставить, если нет):**
- `pip install matplotlib` (для графиков и 3D)
- `pip install graphviz` + system Graphviz (для диаграмм)
- `pip install schemdraw` (для электросхем)

## Telegram-интерфейс

**Команды:** стандартные кнопки.

**Поиск/генерация placeholder:** `[⏹ Отменить]`.

**Результаты по режимам:**
- topic/source/file: `[✅ В работу] [⏭ Пропустить]` + кнопка источника/файла
- image-generate: `[✅ Сохранить] [🔄 Перегенерировать] [📐 Другой стиль]`
- **draw**: `[✅ Сохранить] [🔄 Перегенерировать] [🛠 Изменить скрипт]` (последняя → бот показывает скрипт и предлагает отредактировать)

**Callbacks:**
- `mat:cancel:<taskName>` — отменить
- `mat:regen:<id>` — респавн с тем же промптом
- `mat:restyle:<id>` (image) — спросить стиль → респавн
- `mat:editscript:<id>` (draw) — показать `.py` скрипт, юзер правит → регенерация

## Хранение

```
materials/
  index.json
  _inbox/
    <incoming_files>
    scripts/<slug>.py          # скрипты для mode=draw
  <goal_id>/
    problems/ theory/ links/ files/ notes/
    images/YYYY-MM-DD_<slug>.png    # для image-generate и draw результатов
```

## Источники материалов

- **От пользователя** / **Из локальной библиотеки** / **Через саб-агента `web-material-finder`** — 5 режимов:
  - topic / source / file — поиск контента
  - **image-generate** — AI-художество (minimax/image-01)
  - **draw** — программная отрисовка (matplotlib/graphviz/schemdraw/tikz) для точных чертежей

## Конвенции

- ID: `m_<8-hex>`, slug транслитом.
- `taskName`: `matfind_<goal>_<slug>_<unix_ts>`.
- mode=image: `source: "image_generate"`, `image_model` (default `minimax/image-01`), `image_prompt`.
- **mode=draw: `source: "image_draw"`, `draw_backend` (matplotlib/graphviz/schemdraw/tikz), `draw_script_path`, `draw_type`.**
- Дедупликация: перекрытие >70% → один с большей relevance.
- TG-аплоады → `materials/_inbox/`.

## Связь с другими скиллами

- **`web-material-finder`** — саб-агент, 5 режимов. `sessions_spawn` с `toolsAllow: ["web_search", "web_fetch", "read_file", "exec", "write", "image_generate"]`.
- **`note-to-file`** / **`show-ideas`** / **`focus-timer`** — стандартно.
