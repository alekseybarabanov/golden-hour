# 04. Каталог скиллов

Скиллы лежат в `skills/<name>/SKILL.md` (у части есть `references/`, `scripts/`, `proposal.json`, `README.md`). Это подробные дизайн-документы; исполнение — через `SOUL.md`. При первом использовании скилла агент читает его `SKILL.md`.

Скиллы сгруппированы в три яруса: **основной учебный цикл**, **инфраструктура**, **опциональные/владельческие**.

## Основной учебный цикл

Работают только при `setup_status: complete` (кроме `onboarding`).

### `onboarding`
Настройка нового пользователя: цель (exam/olympiad/topic), ветка, самооценка тем, дедлайн, часы/неделю, приоритеты, тема оформления. Триггеры: первая сессия, `/new`, «быстрый старт». Пишет `profile.md` через `profile-patch.mjs` / `onboarding-quick.mjs` / `exam-topics.mjs`. Работает только при `setup_status ≠ complete`.

### `study-plan`
Генерирует макро-план (недели/месяцы) из профиля и дедлайна — источник для дневного плана. Триггеры: авто после `setup-finalize`, «составь/пересобери план». Читает `profile.md`, пишет `plan.md`. Часы распределяются по слабости тем; в скелет встроены контрольные точки (тесты по темам, пробные варианты каждые ~4 недели).

### `daily-plan`
Собирает `plans/YYYY-MM-DD.json` из профиля и макро-плана. Триггеры: авто в 07:00 (cron `morning-plan.mjs`), «спланируй день». Использует `task-weighting` + `daily-balancer` + `recurring` + spaced repetition (интервалы 1→3→7→14→30 дней). Flow: dry-run → показать `summary` → запись без `--dry-run`.

### `checkins`
Напоминания и учёт прогресса: утренний бриф, пинги задач (макс 3/день), вечерний чек-ин, рефлексия при срывах (без стыда, ищет причины + адаптирует). Читает `plans/*.json`, пишет `progress.md` + эмитит в temporal-kg. Скрипты: `morning-brief.mjs`, `task-pings.mjs`, `evening-checkin.mjs`, `plan-task.mjs respond`, `checkin-record.mjs`. **Тайминги слотов брать из plan JSON, не из `tasks.yaml`.**

### `tasks`
Управление задачами: агент распознаёт намерение из текста, CLI — тонкий слой. Триггеры: «добавь/закрой/прогресс», «список задач», «что горит», «разбей задачу», recurring. Хранилище: `tasks.yaml` (правда) + `tasks.md` (рендер) + `recurring.json`. Взвешенный прогресс, категории, overdue, риск. CLI: `add|list|close|progress|decompose|recurring`.

### `timer`
Фокус-сессии: pomodoro-циклы (25/5, 50/10, 100/20, 15/3, custom) или focus (одна задача без перерывов; «засчитать» → done, «ещё» → повтор). Триггеры: «начни помодоро», «час над X», «что сейчас?», «сколько осталось?». Хранилище `timer/`, интеграция с `tasks.yaml` (`time_spent_minutes`). DND во время сессии, длинный перерыв каждые 4 цикла, статистика по 5 окнам.

### `cards`
Рендер плана и произвольных таблиц в PNG (**в Telegram таблицы — только PNG**). Режимы: план (`study-plan-cards.mjs`) и таблица (`table-cards.mjs`). Тема из `profile.md → theme` (dark/light). Движок — `skills/study-cards/`. Никогда не слать markdown-таблицу; не спрашивать «картинкой или текстом?».

### `help-menu`
Единая точка знакомства с возможностями. Триггеры: «что умеешь», «помощь», «меню», «/help». Авто — после онбординга. Поведение зависит от `setup_status`: краткое до `complete`, полное меню после.

## Инфраструктура

### `session-start`
Точка входа каждой сессии: решает «загрузить/сбросить/новый онбординг». Скрипт `session-start.mjs` возвращает `setup_status` + `action` + шаблон проактивного сообщения. Сценарии A (new) / B (complete → меню выбора) / C (in_progress → продолжить) / D (owner → management). Всегда предлагать выбор возвращающемуся, не грузить молча.

### `user-profile`
Слой хранения всех per-user данных (структура `users/<key>/`, формат `profile.md`, правила `user_key` и `setup_status`). Пишет только то, что сказал пользователь; не нормализует; не раскрывает чужие `user_key`. Детали — в [03. Модель данных](03-data-model.md).

### `study-cards`
Низкоуровневый движок рендера (обложка + недели + статистика + произвольные таблицы → PNG). Не вызывается агентом напрямую — через `cards`. Скрипты: `render.js`, `render-table.js`, `render-stats.js`, `check-prompt.js` (guard для `image_generate` с кириллицей). Требует Node 14+ и Edge/Chrome headless. Темы dark/light.

### `study-plan-cards`
Оркестратор визуальных карточек плана (режимы from-plan-file / from-topics / from-state / full); делегирует рендер `study-cards`. Точка входа для агента (обёртка), сам `study-cards` — движок.

### `daily-balancer`
CLI-поддержка: упаковывает кандидатов в сбалансированный день (утро/день/вечер) в пределах `D_max`. Вызывается из `daily-plan-engine.mjs`, не напрямую.

### `task-weighting`
CLI-поддержка: детерминированно считает `eff_priority` и `eff_difficulty` тем/задач. Вызывается из движка дневного плана; можно использовать для отладки/показа приоритетов.

### `goal-materials`
Библиотека материалов (задачи, теория, ссылки, файлы, заметки, картинки), привязанная к целям из профиля. Порядок: `pick`/`today` (локальные) → только затем web-поиск. CLI: `add`, `pick`, `today`, `list`, `search`, `status`. Хранилище `materials/index.json` + подпапки по `goal_id`. Web-поиск — через sub-агент `web-material-finder`.

### `temporal-kg`
Граф событий/связей во времени по темам. Для вопросов «когда последний раз, какие ошибки, почему выправился». События: study/solve/checkin/milestone/drift/reflection. CLI: `emit`, `link`, `topic`, `window`, `forgotten`, `import-progress`. Интеграция с spaced repetition и адаптивными весами.

### `longterm-stats`
Статистика за период (streak, закрытые задачи, часы по темам, % плана). Триггеры: «статистика за неделю/месяц/год/всё». Источники: `tasks.yaml`, `progress.md`, `plans/*.json`, `temporal-kg/`.

## Интеграции и внешняя синхронизация

### `google-calendar-sync`
Двусторонняя синхронизация с Google Calendar. Только при `setup_status: complete` + OAuth. Подключение через device flow; push слотов/дедлайнов/задач в календарь (стабильные `uid`); pull изменений (перенос → сдвиг слота; ✅/[x] в названии → done+streak; удаление → пропуск). Токены — приватно в `users/<key>/google-calendar.json`. Детали: [08. Интеграции](08-integrations.md).

### `google-task-hub` (experimental)
Альтернатива локальным `tasks`/`longterm-stats`: связка Google Tasks (UI) + Sheet (источник правды) + Calendar (дедлайны). Sync IN/OUT, статистика, шаблоны. Python-скрипты + тесты в `skills/google-task-hub/`. Не заменяет локальные задачи по умолчанию.

## Опциональные / владельческие

### `owner-profile`
Management-режим для владельца (`user_key = owner`), не для Telegram. `users/owner/` с `audit-log.jsonl` (hash-chaining). Read-only доступ к пользовательским данным через аудит-скиллы, без имперсонации и без отключения защит. Команды: audit, drift check, proposals, apply/reject, status, tests, git status.

### `soul-guardian`
Детект несанкционированного дрейфа критичных файлов (SOUL.md, AGENTS.md — восстановление; USER/TOOLS/IDENTITY/HEARTBEAT/MEMORY — алерт). Режимы restore/alert, tamper-evident лог с hash-chaining. Cron, владелец. Python-скрипты в `skills/soul-guardian/scripts/`.

### `clawsec-suite`
Security-suite: advisory feed, approval-gated установка скиллов, подписанные артефакты (ed25519), hook + опциональный cron. Cross-reference затронутых скиллов, детект вредоносных. Cron, владелец. Хук в `skills/clawsec-suite/hooks/`.

### `coder`
Делегирование генерации кода sub-агенту `code-writer` (`sessions_spawn`). Основная сессия код **никогда не пишет** (даже однострочник). Агент распознаёт намерение → выбирает язык → спавнит sub-агент → показывает результат в блоке кода + короткая заметка.

### `web-material-finder`
Sub-агент поиска/генерации материалов, 5 режимов: `topic` (web_search+fetch), `source` (из URL/файла), `file` (парсинг PDF/DOCX/PPTX), `image` (AI-генерация — часто портит текст/индексы), `draw` (Python-скрипт matplotlib/graphviz/schemdraw/tikz для точных академических диаграмм). Вызывается из `goal-materials` только когда `pick`/`today` пусты или по явной просьбе.

### `student-portal`
Веб-кабинет ученика: план на сегодня + Kanban/календарь + чат с ботом. Триггеры: `/web`, «личный кабинет», «веб-план». Обычно `http://192.168.137.1:18791/my/<token>` (хотспот ПК). Отправлять пользователю **только** `portal_url`; токен секретный. Только при `setup_status: complete`. Детали: [06. Дашборд и Mini App](06-dashboard.md).

## Сводка по ярусам

| Ярус | Скиллы |
|---|---|
| Основной цикл | onboarding, study-plan, daily-plan, checkins, tasks, timer, cards, help-menu |
| Инфраструктура | session-start, user-profile, study-cards, study-plan-cards, daily-balancer, task-weighting, goal-materials, temporal-kg, longterm-stats |
| Интеграции | google-calendar-sync, google-task-hub *(experimental)* |
| Владельческие/спец | owner-profile, soul-guardian, clawsec-suite, coder, web-material-finder, student-portal |
| Архив | `_archived/`: team-tasks, telegram-group |
</content>
