# 08. Интеграции и данные

## Google Calendar (двусторонняя синхронизация)

Движок — `scripts/gcal.mjs`, скилл — `skills/google-calendar-sync/SKILL.md`, руководство оператора — [`GOOGLE-CALENDAR.md`](../GOOGLE-CALENDAR.md). Только при `setup_status: complete`.

### Настройка OAuth (владелец, ~10 мин)
1. Google Cloud Console → создать проект.
2. Включить **Google Calendar API**.
3. OAuth consent screen: тип External, scope `https://www.googleapis.com/auth/calendar.events`, добавить test users (или опубликовать).
4. Credentials → OAuth client ID → тип **TV and Limited Input devices** (нужен для device flow) → скопировать Client ID и Secret.

В `~/.openclaw/secrets.json`:
```json
{ "google": { "clientId": "…apps.googleusercontent.com", "clientSecret": "…" } }
```
Проверка: `node scripts/gcal.mjs status --user local` → `{"ok":true,"connected":false}`.

### Пользовательский поток
1. «подключи календарь» → `gcal.mjs connect --user <key>` → бот присылает `google.com/device` + код.
2. После авторизации «готово» → `connect:poll` до `connected`.
3. Доступно: `/calendar` (показать события), «выгрузи план в календарь» (upsert), «отключи календарь» (disconnect).

### Что синхронизируется
- **Бот → календарь (`upsert`):** слоты дня из `plans/YYYY-MM-DD.json`, вехи/дедлайны из `plan.md` (allDay), задачи с датами. Стабильные `uid` (`gh:<key>:daily:<дата>:<слот>`), обновление по `uid` без дублей. Собирается в `users/<key>/.gcal-events.json`.
- **Календарь → бот (`list`/pull):** перенос времени → сдвиг слота; `✅`/`[x]` в начале названия → `done` в `progress.md` + streak; `cancelled`/`deleted` → пропуск.

Токены — приватно в `users/<key>/google-calendar.json` (git-ignored). Client secret — только в `secrets.json`. Scope ограничен событиями календаря. Отзыв: https://myaccount.google.com/permissions.

## Кодификаторы экзаменов (`data/exam-topics/`)

JSON-справочники для `scripts/exam-topics.mjs` (read-only). Текущие: `ege-history.json`, `ege-math-profile.json`, `ege-russian.json`, `oge-math.json`.

Формат:
```json
{
  "id": "ege-math-profile",
  "exam_type": "ege",
  "exam_subject": "math",
  "exam_subject_variant": "profile",
  "label": "ЕГЭ математика (профиль)",
  "topics": ["Алгебра и начала анализа", "Планиметрия", "Стереометрия", "…"]
}
```

Использование:
```bash
node scripts/exam-topics.mjs list
node scripts/exam-topics.mjs show --id ege-math-profile
node scripts/exam-topics.mjs resolve --exam-type ege --exam-subject math --variant profile
node scripts/exam-topics.mjs apply --user tg-123 --exam-type ege --exam-subject math --variant profile
```

Добавление нового: создать JSON с полями `id`, `exam_type`, `exam_subject`, (`exam_subject_variant`), `label`, `topics[]`.

## SQLite-бэкенд (experimental)

Опциональная альтернатива файловому хранилищу. Включается `GH_USE_DB=1` (требует `npm install` для `better-sqlite3`). Слой — `scripts/lib/db.mjs`. Правка профиля — `profile-update.mjs`. Миграция файлов в БД — `db-migrate.mjs` (`--dry-run`, `--force`, `--status`). База `golden-hour.db` (git-ignored). По умолчанию **выключено** — основной путь файловый.

## Google Task Hub (experimental)

Альтернатива локальным `tasks`/`longterm-stats`: Google Tasks (UI) + Sheet (источник правды) + Calendar (дедлайны). Python-реализация в `skills/google-task-hub/scripts/` (`sync_in.py`, `sync_out.py`, `state_manager.py`, `render_dashboard.py`, `google_api_client.py`, `auth_setup.py`) с тестами и mock-store. Не заменяет локальные задачи по умолчанию.
</content>
