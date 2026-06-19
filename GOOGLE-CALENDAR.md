# Google Calendar — подключение к агенту «Золотой час»

Двусторонняя синхронизация: бот ставит учебные слоты / дедлайны / задачи в Google Calendar и забирает изменения обратно (перенос, выполнено, удаление). Авторизация — **OAuth device flow**, отдельно для каждого пользователя (мультипользовательский режим).

Движок: `scripts/gcal.mjs` (Node ≥ 18, без внешних зависимостей). Логика — в `SOUL.md` → «Google Calendar» и `skills/google-calendar-sync/SKILL.md`.

---

## Часть 1. Разовая настройка приложения (делает владелец, ~10 минут)

Нужна **одна** учётка приложения OAuth на весь проект — её используют все пользователи.

1. Зайти в **Google Cloud Console** → создать проект (или выбрать существующий).
2. **APIs & Services → Library** → включить **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Заполнить название/почту поддержки.
   - **Scopes:** добавить `https://www.googleapis.com/auth/calendar.events`.
   - **Test users:** пока приложение не «опубликовано», добавить туда e-mail каждого, кто будет подключаться (или нажать **Publish app** для открытого доступа).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **TV and Limited Input devices**.
   - Скопировать **Client ID** и **Client secret**.

> Тип «TV and Limited Input devices» обязателен — именно он даёт device flow (ссылка + код, без браузерного редиректа). Подходит для пользователей в Telegram.

### Куда положить ключи
В `~/.openclaw/secrets.json` (Windows: `%USERPROFILE%\.openclaw\secrets.json`) добавить блок:

```json
{
  "google": {
    "clientId": "ВАШ_CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "ВАШ_CLIENT_SECRET"
  }
}
```

(Альтернатива — переменные окружения `GCAL_CLIENT_ID` / `GCAL_CLIENT_SECRET`.)

Проверка:
```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
node scripts/gcal.mjs status --user local
```
Должно вернуть `{"ok":true,"connected":false}` (без ошибки про missing creds).

---

## Часть 2. Подключение пользователя (через бота, ~1 минута)

Пользователь пишет боту «**подключи календарь**». Бот:

1. `node scripts/gcal.mjs connect --user <user_key>` → получает ссылку и код.
2. Присылает в чат:
   > 📅 Открой **google.com/device**, введи код **ABCD-EFGH**, разреши доступ и напиши «готово».
3. После «готово» — `connect:poll` до `{"action":"connected"}`.

`user_key` бот определяет сам по отправителю (Telegram → `tg-<id>`, иначе `local`).

---

## Часть 3. Как пользоваться

| Команда боту | Что делает |
|---|---|
| «подключи календарь» | OAuth device flow (часть 2) |
| «выгрузи план в календарь» / «синхронизируй» | создаёт/обновляет события из плана, дневных слотов и задач |
| «что в календаре» | показывает события бота на ближайшие дни |
| «отключи календарь» | удаляет токен пользователя |

**Что попадает в календарь:** дневные слоты (утро/день/вечер из `daily-plan`), дедлайны и вехи (из `study-plan`, обычно на весь день), задачи с датами.

**Обратная связь (бот видит твои правки):**
- Перенёс событие → бот переносит слот в плане.
- Отметил выполненным — **добавь `✅` в начало названия события** → бот пишет в прогресс и поднимает streak.
- Удалил событие → бот отмечает пропуск.

Забор изменений идёт периодически (heartbeat) и по команде «синхронизируй».

---

## Безопасность

- Refresh-токены лежат в `users/<user_key>/google-calendar.json` — **приватно, в репозиторий не коммитятся** (см. `.gitignore`: `users/`).
- `clientSecret` хранится только в `secrets.json`, не в коде и не в git.
- Скоуп ограничен `calendar.events` (события), без доступа к остальным данным аккаунта.
- Отзыв доступа: пользователь в любой момент может убрать приложение на https://myaccount.google.com/permissions, либо команда «отключи календарь».

---

## Диагностика

| Симптом | Причина / решение |
|---|---|
| `missing Google client id/secret` | не добавлен блок `google` в `secrets.json` (часть 1) |
| `device code request failed` | OAuth client не типа «TV and Limited Input», или не включён Calendar API |
| `connect:poll` всё время `pending` | пользователь ещё не подтвердил на google.com/device |
| `access_denied` | пользователь не в Test users (или приложение не опубликовано) |
| `token refresh failed` | пользователь отозвал доступ → переподключить («подключи календарь») |
| события дублируются | проверь стабильность `uid` (бот всегда обновляет по `uid`) |
