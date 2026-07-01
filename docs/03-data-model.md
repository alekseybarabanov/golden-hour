# 03. Модель данных

Всё хранение — файловое, по пользователю. Один пользователь = одна папка `users/<user_key>/`. Данные разных пользователей никогда не смешиваются и никогда не пишутся в `USER.md`/`MEMORY.md` (это про владельца воркспейса).

## `user_key`

Определяется **только из метаданных канала** (`sender_id`/`chat_id`), никогда из текста.

| Источник | `user_key` |
|---|---|
| Telegram | `tg-<id>` |
| Другой канал | `<channel>-<id>` |
| Webchat / локально | `local` |
| Владелец | `owner` |

## `setup_status` — гейт доступа

| Статус | Папка | Что разрешено |
|---|---|---|
| `new` | папки нет | только онбординг |
| `in_progress` | есть | продолжить онбординг с места обрыва |
| `complete` | есть | рабочие скиллы (план, задачи, чек-ины, напоминания) |

## Структура папки пользователя

```
users/<user_key>/
  profile.md            # профиль (источник правды: цель, дедлайн, часы, уровни, статус, тема)
  plan.md               # макро-план подготовки (недели/месяцы)
  plan-olympiad.md      # опц.: второй макро-план (если exam + olympiad)
  progress.md           # дневник чек-инов, streak, закрытые темы
  tasks.md              # активные задачи (рендер из tasks.yaml)
  tasks.yaml            # данные трекера задач (источник правды)
  recurring.json        # повторяющиеся задачи для daily-plan
  plans/
    YYYY-MM-DD.json     # дневные планы (слоты, задачи, статусы) — для напоминаний и dashboard
  timer/
    session.json        # текущая сессия (pomodoro | focus)
    stats.json          # агрегаты по окнам (24ч/неделя/месяц/год/всё)
    history.jsonl       # завершённые сессии
    log/                # переходы фаз, статистика, подсказки
  materials/            # библиотека материалов по целям (index.json + подпапки)
  cards/                # PNG-карточки плана; cards/tables/ — табличные карточки
  temporal-kg/
    events.jsonl        # события (study, solve, checkin, milestone, drift, reflection)
    edges.jsonl         # связи (preceded_by, caused_by, resolves, blocked_by)
    topic-index.json    # быстрый индекс по темам (first_seen, last_seen, success_rate...)
  google-calendar.json  # OAuth refresh-токен + карта uid→eventId (приватно, git-ignored)
  portal.json           # секретный токен доступа к student portal
```

Файлы создаются **лениво**, при первой записи. Поля в `profile.md` обновляются **на месте, без дублей ключей**, не стирая остальное. Имя и заметки записываются **дословно** (без нормализации).

## Формат `profile.md`

Обязательный формат строки — `- **ключ:** значение` (иначе `profile.mjs` не распарсит). Значения дописываются онбордингом постепенно.

```markdown
# Профиль

- **name:** "Алексей"
- **setup_status:** complete
- **purpose:** exam
- **exam_type:** ege
- **exam_subject:** math
- **exam_subject_variant:** profile
- **deadline:** 2027-06
- **hours_per_week:** 8
- **daily_load:** normal
- **priorities:** {...}
- **theme:** dark
- **created:** 2026-06-19
```

Ключевые поля:

| Поле | Смысл |
|---|---|
| `name` | имя пользователя (дословно) |
| `setup_status` | `new` / `in_progress` / `complete` |
| `purpose` | `exam` / `olympiad` / `topic` |
| `purposes` | JSON-массив, если целей несколько: `["exam","olympiad"]` |
| `exam_type`, `exam_subject`, `exam_subject_variant` | привязка к кодификатору из `data/exam-topics/` |
| `deadline` | дедлайн подготовки (`YYYY-MM` или `YYYY-MM-DD`) |
| `hours_per_week` | бюджет часов в неделю |
| `daily_load` | `light` / `normal` / `intense` → бюджет сложности дня `D_max` = 6 / 9 / 12 |
| `priorities` | приоритеты тем |
| `theme` | `dark` (default) / `light` — стиль PNG-карточек |
| `plan_files` | опц.: `{ exam: "plan.md", olympiad: "plan-olympiad.md" }` |

Записывать профиль **только** через `profile-patch.mjs` (см. [05. Скрипты](05-scripts.md)).

## Формат дневного плана `plans/YYYY-MM-DD.json`

Центральный runtime-файл: его читают checkins, timer, dashboard, google-calendar-sync.

```json
{
  "date": "2026-07-02",
  "user_id": "tg-123456",
  "goals": [
    {
      "id": "g_001",
      "title": "Дописать главу 3",
      "priority": "high",
      "difficulty": 3,
      "status": "in_progress",
      "scheduled_at": "2026-07-02T08:00:00",
      "weight": 5,
      "tag": "math"
    }
  ],
  "tasks": [
    {
      "id": "t_001",
      "title": "Решить задачи 1–10",
      "scheduled_at": "2026-07-02T10:00:00",
      "status": "planned",
      "est_minutes": 45,
      "weight": 3
    }
  ],
  "load": { "sum_difficulty": 0, "budget": 0 },
  "meta": { "generated_by": "...", "topic": "Математика" }
}
```

**Статусы задач (канонические):** `planned` → `in_progress` → `done`; отдельно `skipped` (Брошено).

- Колонка **Брошено** (`skipped`) необратима на текущий день. Задача попадает туда только после явного подтверждения; для скриптов — `--abandon-confirmed true`. Возврат из «Брошено» запрещён.
- Размещение по времени: тяжёлые задачи (сложность ≥4) — утро, средние (3) — день, лёгкие (≤2) — вечер.
- `eff_priority = важность + дедлайн-буст + слабость` (1–5); `eff_difficulty = сложность + поправка на уровень` (1–5); сумма сложности блоков ≤ `D_max`.

При создании задачи агент сам выставляет `difficulty` (1–5) и `priority` (`low|medium|high|critical`); ученик в dashboard может менять только сложность и приоритет.

## Формат задач `tasks.yaml`

Источник правды для трекера (долгосрочные задачи). Поля: `id`, `name`, `done_when`, `category`, `weight` (1–10, default 5), `deadline`, `duration`, `status`, `progress`, `time_spent_minutes`, `created_at`, `updated_at`.

Общий прогресс считается взвешенно: `Σ(weight × progress) / Σ(weight)`, а не среднее.

> Учебный день и Kanban — через `plans/*.json`. `tasks.yaml` — для долгосрочных задач.

## Temporal Knowledge Graph

`users/<key>/temporal-kg/` — граф событий и связей во времени по темам (когда/что/почему, а не линейный дневник). Пополняется автоматически эмиттерами (checkins, tasks, timer). Запросы: сводка по теме, окно времени, «забытые» темы (пора повторить), граф темы. Масштабирование: JSONL сейчас; при 1000+ событий — разбивка по месяцам, при 10000+ → SQLite. Детали: `skills/temporal-kg/`.

## Общие данные (не по пользователю)

| Путь | Содержимое |
|---|---|
| `data/exam-topics/*.json` | кодификаторы экзаменов (read-only), см. [08. Интеграции](08-integrations.md) |
| `data/groups/`, `data/teams/` | заготовки под группы/команды (`.gitkeep`, скиллы архивированы) |
| `memory/task-categories.md` | общая таксономия категорий задач (шаблон `*.example.md`) |
| `memory/user-priorities.md` | общие приоритеты (шаблон) |
| `users/owner/` | профиль владельца + `audit-log.jsonl` (management-режим) |

## Что в git и что нет

**Не коммитится (`.gitignore`):** `users/tg-*`, `data/teams/`, `data/groups/`, live-`memory/`, `USER.md`, `MEMORY.md`, `secrets.json`, `.env`, `.openclaw/`, `*.db*`.

**Коммитится как шаблоны:** `users/_example/`, `*.example.md`, `secrets.example.json`, `openclaw.agent.example.json`.
</content>
