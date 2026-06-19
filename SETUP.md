# SETUP — как запустить агента «Золотой час»

Ветка **`agent-install`** — полный дистрибутив для самостоятельной установки: воркспейс OpenClaw, скиллы, детерминированные скрипты, шаблоны данных.

Агент знакомится с пользователем, **запоминает каждого в отдельной папке**, строит план подготовки, ведёт прогресс и напоминает в Telegram.

---

## 1. Предпосылки

| Требование | Проверка |
|---|---|
| **Node.js ≥ 18** | `node --version` |
| **OpenClaw** (CLI + gateway) | `openclaw --version` |
| **Git** | `git --version` |
| **Telegram-бот** (опционально, для пингов) | токен от [@BotFather](https://t.me/BotFather) |
| **LLM-провайдер** | API-ключ в конфиге OpenClaw |

---

## 2. Клонирование и установка воркспейса

```bash
git clone -b agent-install https://github.com/margoshkagt-star/Golden-Hour.git golden-hour
```

**Linux / macOS:**

```bash
mkdir -p ~/.openclaw/workspaces
cp -r golden-hour ~/.openclaw/workspaces/golden-hour
```

**Windows (PowerShell):**

```powershell
$ws = "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
git clone -b agent-install https://github.com/margoshkagt-star/Golden-Hour.git $ws
```

> Можно клонировать сразу в целевую папку — главное, чтобы путь совпал с `workspace` в `openclaw.json`.

---

## 3. Профиль владельца и служебные файлы

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"

Copy-Item USER.example.md USER.md
Copy-Item MEMORY.example.md MEMORY.md
Copy-Item memory\task-categories.example.md memory\task-categories.md
Copy-Item memory\user-priorities.example.md memory\user-priorities.md
```

Отредактируйте `USER.md` — имя, часовой пояс, стиль общения.

---

## 4. Регистрация агента в OpenClaw

Скопируйте фрагмент из `openclaw.agent.example.json` в ваш `~/.openclaw/openclaw.json`:

- агент `golden-hour` с путём к воркспейсу;
- Telegram-аккаунт `golden-hour` с `inlineButtons: "all"` (нужно для кнопок напоминаний);
- `bindings` — роутинг сообщений бота на агента;
- `session.dmScope: "per-channel-peer"` — отдельная сессия на каждого пользователя Telegram.

**Токен бота** — в `secrets.json` (см. `secrets.example.json`) или через переменную окружения `TELEGRAM_BOT_TOKEN`.

```powershell
# пример secrets.json
Copy-Item secrets.example.json "$env:USERPROFILE\.openclaw\secrets.json"
# отредактировать токен и Google OAuth (если нужен календарь)
```

---

## 5. Проверка скриптов

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
node scripts/run-tests.mjs
node scripts/session-start.mjs --user local
```

Ожидаемо: тесты проходят; `session-start` возвращает JSON с `setup_status: "new"` для нового пользователя.

---

## 6. Перезапуск gateway

```bash
openclaw gateway restart
openclaw gateway status
```

---

## 7. Первый запуск

**Через CLI (без Telegram):**

```bash
openclaw agent --agent golden-hour --session-key test-local --message "привет"
```

**Через Telegram:** напишите боту «привет».

### Ожидаемый сценарий

1. **Новый пользователь** → приветствие → имя → цель → ветка (олимпиада/экзамен/тема) → дедлайн и часы → макро-план.
2. Появляется `users/<user_key>/profile.md` с `setup_status: complete`.
3. **Повторный заход** → «С возвращением! 1. Продолжить 2. Настроить заново».

`user_key` для Telegram: `tg-<id>`. Для CLI/webchat: `local`.

---

## 8. Утренний cron (опционально)

Автогенерация дневных планов в **07:00** Europe/Moscow:

```powershell
.\scripts\cron\register-morning-plan.ps1
# или Windows Task Scheduler:
.\scripts\cron\register-task-scheduler.ps1
```

Подробности: `scripts/cron/morning-plan.md`.

---

## 9. Google Calendar (опционально)

Пошаговая инструкция: **[GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md)**.

Кратко: OAuth-ключи в `secrets.json` → пользователь пишет боту «подключи календарь».

---

## Структура репозитория

```
golden-hour/
  SOUL.md              # главная логика агента (обязательно!)
  AGENTS.md            # базовое поведение воркспейса
  IDENTITY.md          # имя, emoji, аватар
  TOOLS.md             # локальные заметки владельца
  HEARTBEAT.md         # периодические задачи (опционально)
  skills/              # дизайн-документы скиллов
    _onboarding/       # скиллы фазы настройки
  scripts/             # детерминированные скрипты (Node ≥18)
  users/_example/      # шаблон структуры данных пользователя
  memory/*.example.md  # шаблоны категорий и приоритетов
  knowledge/           # общие учебные материалы (опционально)
  openclaw.agent.example.json
  secrets.example.json
```

**Не коммитятся** (см. `.gitignore`): `users/tg-*`, `USER.md`, `MEMORY.md`, `secrets.json`.

---

## Состав скиллов

**Инфраструктура:** `user-profile`, `session-start`, `help-menu`

**Онбординг** (`skills/_onboarding/`): `hello-intro` → `purpose-select` → ветка → `setup-finalize`

**Рабочий режим:** `study-plan`, `daily-plan`, `daily-study-checkin`, `goal-checkin-notifier`, `current-tasks`, `task-tracker`, `task-triage`, `focus-timer`, `spaced-repetition`, `longterm-stats`, `goal-materials`, `google-calendar-sync`, `reflection-loop`

---

## Частые проблемы

| Симптом | Решение |
|---|---|
| Агент каждый раз спрашивает имя | Не скопирован/устарел `SOUL.md`. Перезапустить gateway. |
| «План» игнорируется | `setup_status ≠ complete` — закончить онбординг. |
| Нет inline-кнопок | В `openclaw.json`: `capabilities.inlineButtons: "all"`. |
| Нет напоминаний | Нет `users/<key>/plans/YYYY-MM-DD.json` — запустить `daily-plan`. |
| Ошибка скриптов | Node ≥ 18; путь к воркспейсу верный; `node scripts/run-tests.mjs`. |
| Данные смешиваются | Проверить `session.dmScope: per-channel-peer` и `user_key` из канала. |

---

## Обновление

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
git pull origin agent-install
openclaw gateway restart
```

Папка `users/` и локальные `USER.md`/`MEMORY.md` при `git pull` не затрагиваются.
