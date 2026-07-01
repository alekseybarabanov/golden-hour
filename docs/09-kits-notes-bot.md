# 09. Notes-Bot Kit v1

> **Не часть агента Golden Hour.** `kits/notes-bot-kit-v1/` — самостоятельный дистрибутив: Telegram-бот на Python (aiogram 3.x) для сбора идей команды и авто-конвейера генерации `SKILL.md`. Работает автономно; включён в репозиторий как отдельный продукт.

## Что это

Бот собирает идеи/заметки от команды (текст, голос, фото, документы), классифицирует их и автоматически ставит «forge-able» идеи в очередь на генерацию скилла. Production-протестирован на инстансе команды.

## Структура

```
notes-bot-kit-v1/
├── README.md / INSTALL.md / ARCHITECTURE.md / COMMANDS.md / OPERATIONS.md / CHANGELOG.md
├── .env.example              # TEAM_BOT_TOKEN
├── install.ps1 / uninstall.ps1
├── runtime/
│   ├── scripts/
│   │   ├── telegram_notes_bot.py          # основной бот (aiogram polling, все хендлеры)
│   │   ├── telegram_notes_bot_watchdog.py # монитор процесса, backoff 5→60с
│   │   ├── idea_intake.py                 # дедуп, стоп-слова, классификация, is_forgeable()
│   │   ├── idea_to_skill.py               # локальный генератор SKILL.md (фолбэк)
│   │   ├── members.py                     # реестр user_id → @handle
│   │   └── forge_check.py                 # отладка forgeable-классификации
│   └── workspace/memory/                  # шаблоны конфига, members, notes.jsonl
├── agent-skills/            # 8 SKILL.md для OpenClaw (architecture/setup/operator/commands/…)
└── examples/               # inbox-sample, notes.jsonl-sample, idea-to-skill-flow, SKILL.md-template
```

## Подсистемы

| Подсистема | Файл | Роль |
|---|---|---|
| Ядро бота | `telegram_notes_bot.py` | aiogram polling, команды, периодический дайджест |
| Watchdog | `telegram_notes_bot_watchdog.py` | перезапуск в цикле, экспоненциальный backoff, «никогда не сдаётся» |
| Intake/классификатор | `idea_intake.py` | дедуп, стоп-слова, 8 категорий, разбивка списков, `is_forgeable()` |
| Локальный фолбэк | `idea_to_skill.py` | быстрая генерация SKILL.md для `/skills` (без ресёрча/тестов) |
| Реестр участников | `members.py` | user_id → @username/имя |
| Forge-check | `forge_check.py` | отладочная утилита |

## Happy path (текстовая идея)

```
Пользователь: "Бот должен слать мотивацию в 8 утра"
  → aiogram polling → idea_intake.append_note()
  → notes.jsonl + inbox/YYYY-MM-DD.md
  → is_forgeable() → True (len >30, не приветствие)
  → enqueue forge_queue.jsonl (status=pending, async)
  → ответ "Записано 📝" (без ожидания)
  → (async) notes-keeper читает очередь → sessions_send() к forge-skill
  → forge-skill: Research → Design → Tests → Save → Report
  → skills/<slug>/SKILL.md создан → notes-keeper обновляет очередь (done) + отчёт владельцу
```

Гарантии: одно сообщение → одна запись в `notes.jsonl` → максимум одна запись в очереди; бот не ждёт forge-skill (async); без спама уведомлений.

## Роли (RBAC)

| Роль | Кто | Доступ |
|---|---|---|
| Owner | один человек (`bot-config.json → owner`) | все команды + `/start` + авто-forge |
| Team | username'ы из `bot-config.json → team` | read: `/info /ideas /classify /rejected /split` (`/skills` — только owner) |
| Guest | все остальные | только слать текст/голос/фото → «Принято ✅», без команд |

Гостевые сообщения тоже пишутся в `notes.jsonl` + inbox (не терять сигналы извне команды).

## Хранилище

| Путь | Тип | Содержимое |
|---|---|---|
| `memory/notes.jsonl` | append | все сообщения |
| `memory/inbox/YYYY-MM-DD.md` | append | человекочитаемый дневной дамп |
| `memory/forge_queue.jsonl` | append+status | forge-able идеи в ожидании |
| `memory/forge_results.jsonl` | append | результаты forge-skill |
| `memory/ideas.md` / `ideas_rejected.md` | overwrite | вывод `/classify` |
| `memory/ideas_state.json` | JSON | last_run_ts, seen IDs (дедуп) |
| `memory/bot-config.json` | JSON | конфиг (owner, team, ASR, digest) |
| `memory/members.json` | JSON | реестр user_id → handle |
| `media/inbound/<file_id>.ogg/.txt` | файлы | голос + Whisper-транскрипт |

## Голосовой конвейер (опц.)

Включается `bot-config.json → asr.server_side: true` (faster-whisper + ffmpeg). Голос → `getFile()` → `.ogg` → транскрипт → `append_note(kind=voice)`; если транскрипт >30 симв. и не приветствие — идёт в forge. Без Whisper бот не падает — пишет placeholder и классифицирует как rejected.

## Установка (Windows)

```powershell
cd notes-bot-kit-v1
.\install.ps1 -BotToken "1234567890:AAH…"
```
`install.ps1`: копирует `runtime/scripts/` → `%LOCALAPPDATA%\NotesBotKit\scripts\`, создаёт `bot-config.json` + `members.json` из шаблонов, пишет `.env`, ставит `aiogram`+`aiohttp`, регистрирует watchdog в Windows Scheduled Tasks (AtLogOn).

## Что НЕ входит

OpenClaw runtime, агент forge-skill (внешний; кит показывает вызов через `sessions_send`), репозиторий Golden Hour, готовые скиллы, модель Whisper.

Подробности — `kits/notes-bot-kit-v1/ARCHITECTURE.md`, `OPERATIONS.md`, `COMMANDS.md`.
</content>
