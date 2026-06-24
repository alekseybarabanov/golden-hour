---
name: "web-material-finder"
description: "Sub-agent for material search (web/file), image generation, and programmatic drawing; used by goal-materials in parallel with the Telegram bot."
---

# Web Material Finder

Изолированный саб-агент в 5 режимах: **topic**, **source**, **file**, **image**, **draw**. Вызывается из основного агента через `sessions_spawn` — бот не блокируется, результат приходит асинхронно пушем.

## Когда использовать

**Только после** `node scripts/goal-materials.mjs pick` / `today` вернули `count: 0`, либо пользователь явно просит **новый** поиск.

- `goal-materials` нужно найти/сгенерировать материал по запросу юзера
- Web/file-поиск по теме, источнику, файлу
- AI-генерация картинки/схемы
- Программная отрисовка точного учебного чертежа/графика

## 5 режимов

| Режим | Когда | Входы | Инструмент |
|---|---|---|---|
| `topic` | Тема словами | `topic`, `depth` | `web_search`, `web_fetch` |
| `source` | URL/файл + «найди …» | `source_url`/`source_file`, `source_mode` | + `read_file` |
| `file` | PDF/DOCX/PPTX + «найди в нём» | `file_path`, `search_query` | `exec` (парсеры) + `read_file` |
| `image` | «нарисуй / график / схему» (художественно) | `image_prompt`, `reference_image?` | `image_generate` |
| `draw` | «нарисуй ТОЧНО / как в учебнике / график функции» | `draw_prompt`, `draw_type` | `write` + `exec` (matplotlib/graphviz/schemdraw/tikz) |

`source_mode` (для source): `similar` / `theory` / `solutions` / `deeper` / `easier`.

## Шаблон запуска

```python
sessions_spawn(
  task = <TASK_PROMPT>,                                 # см. ниже
  taskName = f"matfind_{goal_id}_{slug}_{unix_ts}",
  mode = "run",                                          # фон, не блокировать
  context = "isolated",                                  # чистый sub-agent
  toolsAllow = ["web_search", "web_fetch", "read_file", "exec", "write", "image_generate"]
)
```

## TASK_PROMPT (универсальный)

```text
Саб-агент. 5 режимов. Верни результат СТРОГО в JSON, БЕЗ текста вокруг.

ВХОДНЫЕ
- goal_id, mode: <topic|source|file|image|draw>
- topic, language, depth, level, sources_pref, freshness

MODE=SOURCE: source_url, source_file, source_mode
MODE=FILE: file_path, file_format (pdf|docx|pptx), search_query, max_excerpts: 7
MODE=IMAGE:
  image_prompt, image_style (clean|technical|schematic|sketch|3d) default clean,
  image_model default minimax/image-01,
  image_size 1024x1024, image_aspect 1:1,
  reference_image, ref_action (redraw|extend|style_transfer) default redraw
MODE=DRAW:
  draw_prompt, draw_type, draw_backend (по типу: cube→matplotlib, diagram→graphviz,
              circuit→schemdraw, latex→matplotlib),
  draw_output_path, draw_script_path, draw_size default 9x9

ИНСТРУМЕНТЫ
- topic/source: web_search, web_fetch, read_file
- file: exec (PyPDF2/python-docx/python-pptx), read_file
- image: image_generate, image (для reference)
- draw: write, exec
Запрещено: платные источники; выдумывать содержимое; текст вокруг JSON.

АЛГОРИТМЫ
mode=topic:  web_search → web_fetch топ-N → summary.
mode=source: прочитай источник → извлеки тему/сложность/концепции/gist →
             search_query из extracted_topic + source_mode →
             web_search + 1-2 вариации → web_fetch топ-N.
mode=file:   парсер по расширению (.pdf PyPDF2 fallback pdfplumber/pdftotext;
             .docx python-docx fallback docx2txt; .pptx python-pptx; .md/.txt read_file).
             Если > 50KB — чанки по 500 строк с overlap 50.
             Семантически оцени релевантность search_query.
             Из топ-чанков: excerpt ±5 строк, page (PDF/PPTX) или line_range.
             Дедупликация перекрытий >70% → топ max_excerpts.
mode=image:  refined_prompt (на англ): "clean 3D wireframe <figure>, label <vertices>,
             highlight <element>, textbook style, vector, white background, no shading"
             → image_generate(prompt, model=minimax/image-01,
               size=image_size, aspectRatio=image_aspect).
             ⚠️ AI часто ломает текст/подписи — для точных чертежей используй mode=draw.
mode=draw:   1) draw_backend по draw_type (см. маппинг).
             2) Напиши Python-скрипт: # -*- coding: utf-8 -*-, import matplotlib,
                matplotlib.use('Agg'), import matplotlib.pyplot as plt,
                [код чертежа], plt.savefig(OUTPUT, dpi=150, bbox_inches='tight'),
                plt.close().
             3) Сохрани через write в draw_script_path.
             4) Выполни exec("python <draw_script_path>").
             5) Проверь PNG (exists, size > 0). Если ошибка — fix, max 3 попытки.

ВЫВОД
{
  "goal_id": "...",
  "mode": "topic|source|file|image|draw",
  "topic": "...",
  "language": "...",
  "searched_at": "<ISO-8601>",
  "search_context": {
    // mode=topic: {}
    // mode=source: {url, file, title, extracted_topic, extracted_difficulty, key_concepts, gist, source_mode}
    // mode=file:   {file_path, file_format, search_query, file_size_kb, total_pages_or_lines, total_excerpts_found, error?}
    // mode=image:  {image_prompt, refined_prompt, image_style, image_model, image_size, image_aspect, reference_image_used, ref_action}
    // mode=draw:   {draw_prompt, draw_type, draw_backend, draw_script_path, draw_output_path, attempts}
  },
  "sources": [{
    "title": "...",
    "url": "https://..." | null,
    "type": "image | problem | theory | link | video | note",
    "tags": ["..."],
    "level": "easy|medium|hard|any",
    "summary": "1-2 предложения по-русски",
    "relation": "<similar|theory_for|solution_for|deeper_version|easier_version>" | null,
    "excerpt": "..." | null,
    "line_range": "45-60" | null,
    "page": 3 | null,
    "relevance": 0.85,
    "image_path": "<PNG путь>" | null,
    "image_url": "https://..." | null,
    "image_prompt": "..." | null,
    "image_model": "minimax/image-01" | null,
    "draw_backend": "<matplotlib|graphviz|schemdraw|tikz>" | null,
    "draw_script_path": "<путь к .py>" | null
  }]
}

ПРАВИЛА
- Количество по max_excerpts/depth (±2).
- Сам источник/файл в sources НЕ включай.
- Ничего — {"sources": [], "search_context": {...}}.
- Summary/excerpt — по факту прочитанного, не по заголовку.
```

## Шаблоны Python-скриптов для mode=draw

### Куб с диагональю (matplotlib 3D)

```python
# -*- coding: utf-8 -*-
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np

fig = plt.figure(figsize=(9, 9), facecolor='white')
ax = fig.add_subplot(111, projection='3d')
a = 1.0
verts = np.array([
    [0,0,0],[a,0,0],[a,a,0],[0,a,0],   # A, B, C, D
    [0,0,a],[a,0,a],[a,a,a],[0,a,a]    # A1, B1, C1, D1
])
edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]
for e in edges:
    ax.plot(*zip(verts[e[0]], verts[e[1]]), 'k-', linewidth=1.8)

# Диагональ AC1
ax.plot([0,a],[0,a],[0,a], 'r-', linewidth=2.5)
# Проекция на нижнюю грань
ax.plot([0,a,a],[0,a,a],[0,0,a], 'r--', linewidth=1.5, alpha=0.7)

# Подписи вершин
labels = ['A','B','C','D',"A'","B'","C'","D'"]
offsets = [(-.08,-.05,-.05),(.08,-.05,-.05),(.10,.08,-.05),(-.10,.08,-.05),
           (-.08,-.05,.05),(.08,-.05,.05),(.10,.08,.05),(-.10,.08,.05)]
for lbl, p, off in zip(labels, verts, offsets):
    ax.text(p[0]+off[0], p[1]+off[1], p[2]+off[2], lbl, fontsize=16, fontweight='bold')

ax.text(a-0.1, a-0.1, 0.05, 'α', fontsize=16, color='red', fontweight='bold')
ax.set_xlim([-.15,1.15]); ax.set_ylim([-.15,1.15]); ax.set_zlim([-.15,1.15])
ax.set_box_aspect([1,1,1]); ax.view_init(elev=18, azim=-50); ax.axis('off')
ax.set_title("Куб с диагональю AC' и углом α", fontsize=13)
plt.savefig(r'OUTPUT_PATH', dpi=150, bbox_inches='tight', facecolor='white')
plt.close()
```

### График функции (matplotlib 2D)

```python
# -*- coding: utf-8 -*-
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(-3, 5, 400)
y = x**2 - 4*x + 3
fig, ax = plt.subplots(figsize=(9, 7))
ax.plot(x, y, 'b-', linewidth=2)
ax.axhline(0, color='k', linewidth=0.5)
ax.axvline(0, color='k', linewidth=0.5)
ax.grid(True, alpha=0.3)
ax.plot([1, 3], [0, 0], 'ro')
ax.annotate('(1, 0)', (1, 0), textcoords='offset points', xytext=(5, -10))
ax.annotate('(3, 0)', (3, 0), textcoords='offset points', xytext=(5, -10))
ax.plot([2], [-1], 'go')
ax.annotate('вершина (2,-1)', (2, -1), textcoords='offset points', xytext=(5, -15))
ax.set_xlabel('x')
ax.set_ylabel('y')
ax.set_title('y = x² - 4x + 3')
plt.savefig(r'OUTPUT_PATH', dpi=150, bbox_inches='tight')
plt.close()
```

### Блок-схема (graphviz)

```python
# -*- coding: utf-8 -*-
import graphviz

dot = graphviz.Digraph(format='png')
dot.node('A', 'Начало')
dot.node('B', 'x > 0?')
dot.node('C', 'f(x) = x')
dot.node('D', 'f(x) = -x')
dot.node('E', 'Вывод')
dot.edge('A', 'B')
dot.edge('B', 'C', label='да')
dot.edge('B', 'D', label='нет')
dot.edge('C', 'E')
dot.edge('D', 'E')
dot.render(r'OUTPUT_BASENAME', cleanup=True)
```

## file-search: парсеры

| Формат | Парсер (приоритет) | Фоллбек |
|---|---|---|
| `.pdf` | `PyPDF2.PdfReader` (постранично) | `pdfplumber`, `pdftotext` (CLI) |
| `.docx` | `python-docx` Document | `docx2txt` |
| `.pptx` | `python-pptx` Presentation | — |
| `.md`/`.txt` | `read_file` | — |

Сканированный PDF без текстового слоя → `error: "scanned PDF, no text layer"`.

## image-generate: правила промптов

1. **Стиль:** clean / technical / sketch / 3d
2. **Фон:** "white background", "no shadows"
3. **Подписи:** перечислить (но AI часто ломает — для точных подписей → mode=draw)
4. **Формат:** "vector illustration", "geometric diagram"
5. **Анти-артефакты:** "no text artifacts", "no watermark", "no extra text"

**Модели (по приоритету):**
- `minimax/image-01` — сконфигурирован по умолчанию
- `openai/gpt-image-2` — нужен `OPENAI_API_KEY`
- `google/imagen`, `fal/krea` — нужны API-ключи

## Обработка результата в goal-materials

1. Спарсить JSON.
2. Для каждого `sources[i]`:
   - Путь: `materials/<goal_id>/<type>s/YYYY-MM-DD_<slug>.<ext>` (для `image` → `images/`).
   - **mode=image/draw:** скопировать PNG в `materials/<goal_id>/images/`.
   - **mode=draw:** `.py` остаётся в `materials/_inbox/scripts/`.
   - Frontmatter:
     ```yaml
     ---
     id: m_<8-hex>
     goal_id: <goal_id>
     type: <type>
     tags: [<tags>]
     status: new
     source: <user|web_search|file_search|image_generate|image_draw>
     source_url: <url> | null
     source_path: <file_path> | null
     image_path: <path> | null
     image_url: <url> | null
     image_prompt: <text> | null
     image_model: <name> | null
     draw_backend: <matplotlib|graphviz|schemdraw|tikz> | null
     draw_script_path: <path> | null
     related_to: <id> | null
     relation: <...> | null
     excerpt: <...> | null
     line_range: <...> | null
     page: <n> | null
     relevance: <0..1> | null
     created_at: <ISO>
     status_history:
       - { status: new, at: <ISO> }
     ---
     ```
3. `materials/index.json`, `memory/notes.jsonl`, `memory/YYYY-MM-DD.md`.
4. Сводка в дневник: `🔍/🔗` / `📄` / `🎨` / `📐`.
5. Edit placeholder в TG.

## Ошибки

- `sources: []` → «По … ничего 🤷»
- file: `error: "scanned PDF"` → «PDF сканированный»
- file: `error: "cannot parse"` → «Не смог прочитать файл»
- image: `image_path: null` → «Не удалось нарисовать, уточни описание»
- draw: PNG не создан после 3 попыток → «Не получилось нарисовать, попробуй уточнить»
- Саб-агент упал/таймаут → «Поиск/генерация не удались»

## UX placeholder

```text
# topic:   🔍 Ищу «<topic>»…                    [⏹]
# source:  🔗 Ищу похожие на «<title>»…          [⏹]
# file:    📄 Ищу в «<file>» «<query>»…          [⏹]
# image:   🎨 Рисую «<prompt>» (AI)…             [⏹]
# draw:    📐 Чертёж «<prompt>» (программно)…    [⏹]
```

**Результат в TG (только текст, без кнопок):**

- topic/source/file: «в работу» · «пропустить» + ссылка/файл текстом
- image: «сохранить» · «перегенерировать» · «другой стиль»
- draw: «сохранить» · «перегенерировать» · «изменить скрипт»

«отменить» → отменить саб-агента.

## Конвенции

- `taskName` = `matfind_<goal>_<slug>_<unix_ts>`
- В саб-агента **НЕ передавать** USER.md / историю чата
- Один запрос = один `sessions_spawn`
- Источники только открытые; paywall → выкидывать
- sub-agent'у доступны: `web_search`, `web_fetch`, `read_file`, `exec`, `write`, `image_generate` (явно через `toolsAllow`)
- TG-аплоады → `materials/_inbox/`
- mode=file: `source: "file_search"`, `excerpt`/`line_range`/`page`/`relevance`
- mode=image: `source: "image_generate"`, `image_model` (default `minimax/image-01`)
- mode=draw: `source: "image_draw"`, `draw_backend`, `draw_script_path` (в `_inbox/scripts/`)
- Дедупликация: перекрытие >70% → один с большей `relevance`
