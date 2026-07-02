# Установка «Золотой час» — полная инструкция

ИИ-агент для подготовки к **олимпиадам / экзаменам / темам**: онбординг, макро- и дневные планы, напоминания в Telegram, таймер, карточки, личный кабинет и Mini App.

Репозиторий содержит **только код и шаблоны**. Персональные данные (`users/tg-*`, `USER.md`, `secrets.json`) создаются у вас локально и **не публикуются**.

---

## Содержание

1. [Требования](#1-требования)
2. [Клонирование](#2-клонирование)
3. [Профиль владельца](#3-профиль-владельца)
4. [Регистрация в OpenClaw](#4-регистрация-в-openclaw)
5. [Секреты и Telegram-бот](#5-секреты-и-telegram-бот)
6. [Проверка и первый запуск](#6-проверка-и-первый-запуск)
7. [Функции агента](#7-функции-агента)
8. [Cron и напоминания](#8-cron-и-напоминания)
9. [Дашборд Фельпик](#9-дашборд-фельпик)
10. [Личный кабинет ученика](#10-личный-кабинет-ученика)
11. [Telegram Mini App](#11-telegram-mini-app)
12. [Grafana (опционально)](#12-grafana-опционально)
13. [Google Calendar (опционально)](#13-google-calendar-опционально)
14. [Структура репозитория](#14-структура-репозитория)
15. [Частые проблемы](#15-частые-проблемы)
16. [Обновление](#16-обновление)

---

## 1. Требования

| Компонент | Версия | Проверка |
|-----------|--------|----------|
| **Node.js** | ≥ 18 | `node --version` |
| **OpenClaw** | CLI + gateway | `openclaw --version` |
| **Git** | любая актуальная | `git --version` |
| **Python** | ≥ 3.10 | `python --version` — для дашборда и student portal |
| **Chrome / Edge** | — | для PNG-карточек (`table-cards`, `study-plan-cards`) |
| **Telegram-бот** | опционально | токен от [@BotFather](https://t.me/BotFather) |
| **LLM-провайдер** | — | API-ключ в конфиге OpenClaw |
| **cloudflared** | опционально | для HTTPS Mini App в Telegram |

---

## 2. Клонирование

**Windows (PowerShell):**

```powershell
$ws = "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
git clone https://github.com/svirepymedved/golden-hour.git $ws
cd $ws
```

**Linux / macOS:**

```bash
mkdir -p ~/.openclaw/workspaces
git clone https://github.com/svirepymedved/golden-hour.git ~/.openclaw/workspaces/golden-hour
cd ~/.openclaw/workspaces/golden-hour
```

> Путь воркспейса должен совпадать с полем `workspace` агента в `~/.openclaw/openclaw.json`.

**Зависимости Node** (только для экспериментального SQLite `GH_USE_DB=1`):

```powershell
npm install
```

---

## 3. Профиль владельца

Скопируйте шаблоны (данные владельца воркспейса, **не** учеников бота):

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"

Copy-Item USER.example.md USER.md
Copy-Item MEMORY.example.md MEMORY.md
Copy-Item memory\task-categories.example.md memory\task-categories.md
Copy-Item memory\user-priorities.example.md memory\user-priorities.md
```

Отредактируйте `USER.md`: имя, часовой пояс, стиль общения.

Учебные профили пользователей бота создаются автоматически в `users/<user_key>/profile.md` при онбординге.

---

## 4. Регистрация в OpenClaw

Скопируйте фрагмент из [`openclaw.agent.example.json`](openclaw.agent.example.json) в `~/.openclaw/openclaw.json`:

| Параметр | Значение |
|----------|----------|
| Агент | `golden-hour`, путь к воркспейсу |
| Telegram-аккаунт | `golden-hour`, `inlineButtons: "off"` |
| `bindings` | роутинг сообщений бота на агента |
| `session.dmScope` | `per-channel-peer` — отдельная сессия на каждого пользователя Telegram |

В `allowFrom` укажите свой Telegram user id (для `dmPolicy: allowlist`) или смените политику на `open`.

Перезапуск:

```powershell
openclaw gateway restart
openclaw gateway status
```

---

## 5. Секреты и Telegram-бот

### 5.1. Создать бота

1. [@BotFather](https://t.me/BotFather) → `/newbot`
2. Сохраните токен вида `123456789:AAH…`

### 5.2. secrets.json

```powershell
Copy-Item secrets.example.json "$env:USERPROFILE\.openclaw\secrets.json"
# Отредактируйте: channels.telegram.golden-hour.botToken
```

Альтернатива — переменная окружения `TELEGRAM_BOT_TOKEN` (см. `openclaw.agent.example.json`).

### 5.3. .env для дашборда / Mini App

```powershell
cd dashboard
copy telegram-miniapp.env.example $env:USERPROFILE\.openclaw\.env
# TELEGRAM_BOT_TOKEN=ваш_токен
```

---

## 6. Проверка и первый запуск

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"

node scripts/run-tests.mjs
node scripts/exam-topics.mjs list
node scripts/profile-patch.mjs --user local-test --init --set name=Test --set setup_status=in_progress --dry-run
node scripts/session-start.mjs --user local
```

Ожидаемо: тесты проходят; `session-start` для нового пользователя → `setup_status: "new"`.

### CLI (без Telegram)

```powershell
openclaw agent --agent golden-hour --session-key test-local --message "привет"
```

### Telegram

Напишите боту «привет».

**Сценарий онбординга:**

1. Новый пользователь → имя → цель → ветка (олимпиада / экзамен / тема) → дедлайн и часы → макро-план
2. Создаётся `users/<user_key>/profile.md` с `setup_status: complete`
3. Повторный заход → «С возвращением! 1. Продолжить 2. Настроить заново»

`user_key` для Telegram: `tg-<id>`. Для CLI: `local`.

---

## 7. Функции агента

### Цепочка работы

```
session-start
  ├─ вернувшийся → продолжить / настроить заново
  └─ новый → onboarding → study-plan

рабочий режим: daily-plan → checkins → timer → progress
```

### Скиллы и команды бота

| Скилл | Команда / триггер | Назначение |
|-------|-------------------|------------|
| `onboarding` | первый вход | настройка профиля, цели, плана |
| `study-plan` | `/plan` | макро-план подготовки |
| `daily-plan` | `/today` | план на день + spaced repetition |
| `tasks` | `/tasks`, `/break`, `/recur` | задачи, декомпозиция, повторы |
| `checkins` | `/checkin`, `/reflect` | чек-ин, рефлексия, пинги |
| `timer` | `/timer` | помодоро и focus-сессии |
| `cards` | таблицы в чате | PNG-карточки планов и таблиц |
| `goal-materials` | `/materials` | материалы по цели |
| `longterm-stats` | `/stats` | статистика за период |
| `google-calendar-sync` | `/calendar` | синхронизация с Google Calendar |
| `student-portal` | `/web` | ссылка на личный кабинет |
| `help-menu` | `/help` | меню возможностей |
| `user-profile` | `/profile` | просмотр и правка профиля |

Подробности каждого скилла: `skills/<name>/SKILL.md`.

### Ключевые скрипты

```powershell
node scripts/session-start.mjs --user tg-123456
node scripts/study-plan.mjs --user tg-123456
node scripts/daily-plan.mjs --user tg-123456
node scripts/timer.mjs start --user tg-123456 --mode pomodoro
node scripts/table-cards.mjs --user tg-123456 --title "План" --text "| A | B |"
node scripts/goal-materials.mjs pick --user tg-123456 --topic "тема"
node scripts/student-portal.mjs --user tg-123456
```

Полный список: [`scripts/README.md`](scripts/README.md).

### Темы экзаменов (справочник)

```powershell
node scripts/exam-topics.mjs list
node scripts/exam-topics.mjs show ege-math-profile
```

Данные: `data/exam-topics/*.json`.

### PNG-карточки

Требуют Chrome/Edge на хосте. Агент **всегда** отправляет таблицы картинкой, не markdown-текстом (см. `SOUL.md` → «Визуализация»).

---

## 8. Cron и напоминания

Автоматические задачи (Europe/Moscow):

| Время | Скрипт | Действие |
|-------|--------|----------|
| 07:00 | `morning-plan.mjs` | дневной план для всех готовых пользователей |
| 09:00 | `morning-brief.mjs` | утренний бриф |
| каждые 5 мин | `task-pings.mjs` | пинги задач по расписанию |
| 21:00 | `evening-checkin.mjs` | вечерний чек-ин |
| ~1 мин | `timer-tick.mjs` | переходы фаз таймера |

Регистрация cron:

```powershell
.\scripts\cron\register-all-cron.ps1
# или только утренний план:
.\scripts\cron\register-morning-plan.ps1
# или Windows Task Scheduler:
.\scripts\cron\register-task-scheduler.ps1
```

**Linux / Raspberry Pi** — вместо `.ps1` используйте systemd user-таймеры:
```bash
bash deploy/pi/install-timers.sh
```
Подробно (таймзона, портал по LAN, ресурсы Pi): [`deploy/pi/README.md`](deploy/pi/README.md).

Доставка в Telegram: `cron-deliver.mjs` → Bot API (нужен `TELEGRAM_BOT_TOKEN`).

Подробности: [`scripts/cron/morning-plan.md`](scripts/cron/morning-plan.md), [`HEARTBEAT.md`](HEARTBEAT.md).

---

## 9. Дашборд Фельпик

Веб-интерфейс для Kanban, календаря, costs, roster агентов OpenClaw.

```powershell
cd dashboard
.\start_dashboard.ps1
```

Откройте: **http://127.0.0.1:18790/**

| Вкладка | Назначение |
|---------|------------|
| Tasks | Kanban (todo / progress / done / archive) |
| Calendar | день / неделя / месяц |
| Costs | расходы LLM (встроенный или Grafana) |
| Tools | ссылки на Control UI и Claw Dash |
| Roster | агенты из `openclaw.json` |

**Важно:** не открывайте `dashboard.html` через `file://` — только через backend.

Состав: [`dashboard/README.md`](dashboard/README.md), [`dashboard/STATUS.md`](dashboard/STATUS.md).

### Автозапуск порталов (Windows)

```powershell
cd dashboard
.\install-portal-autostart.ps1
# или всё сразу:
.\start_all_portals.ps1
.\repair-portals.ps1
```

---

## 10. Личный кабинет ученика

Персональный веб-интерфейс: план на сегодня, Kanban, чат с агентом.

### Получить ссылку

```powershell
node scripts/student-portal.mjs --user tg-123456
```

Агент отправляет только `portal_url` — без токенов и путей.

### Запуск backend

```powershell
cd dashboard
.\start_student_portal.ps1
```

Порт по умолчанию: **18791**.

### Доступ по Wi‑Fi (хотспот ПК)

1. Запустите порталы: `.\start_all_portals.ps1`
2. Windows → Параметры → **Мобильный хотспот** → Вкл.
3. Телефон подключается к Wi‑Fi ПК
4. Открыть: `http://192.168.137.1:18791/my/<token>`

Не работает в guest Wi‑Fi — используйте хотспот или HTTPS-туннель.

Скилл: [`skills/student-portal/SKILL.md`](skills/student-portal/SKILL.md).

---

## 11. Telegram Mini App

Мобильный Kanban и календарь **внутри Telegram** (кнопка меню бота).

**Полная инструкция:** [`dashboard/TELEGRAM_MINIAPP.md`](dashboard/TELEGRAM_MINIAPP.md)

### Быстрый старт

```powershell
# 1. Токен в %USERPROFILE%\.openclaw\.env
# 2. Всё в одном:
cd dashboard
.\setup_telegram_miniapp.ps1
# 3. В Telegram: чат с ботом → кнопка меню → Mini App
```

Скрипт:

1. Запускает dashboard на `0.0.0.0:18790`
2. Поднимает cloudflared (если установлен)
3. Вызывает `setChatMenuButton` с URL `https://…/miniapp`

### Что доступно в Mini App

- Kanban, календарь, создание задач
- Тема следует за Telegram (светлая/тёмная)
- Нижняя навигация: Задачи · Календарь · Новая задача

### Что скрыто в Mini App

- Чат с gateway (нужен публичный `wss://`)
- Grafana, topology — только в полном дашборде

---

## 12. Grafana (опционально)

Метрики OpenClaw (latency, queue, tokens, cost):

```powershell
cd dashboard\grafana
.\start_grafana.ps1
# Dashboard: http://127.0.0.1:3000/d/openclaw-overview/openclaw-overview
```

Перед этим включите `diagnostics-prometheus` в gateway и перезапустите:

```powershell
openclaw gateway restart
```

---

## 13. Google Calendar (опционально)

Пошаговая инструкция: **[GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md)**.

Кратко:

1. OAuth Client ID/Secret в `secrets.json`
2. Пользователь пишет боту «подключи календарь»
3. Device flow: ссылка + код Google

---

## 14. Структура репозитория

```
golden-hour/
  SOUL.md                 # главная логика агента
  AGENTS.md               # правила воркспейса
  IDENTITY.md             # имя, emoji
  INSTALL.md              # эта инструкция
  SETUP.md                # краткая установка
  skills/                 # дизайн-документы скиллов
  scripts/                # детерминированные скрипты (Node)
  dashboard/              # Фельпик Dashboard + Mini App + student portal
  data/exam-topics/       # справочник тем экзаменов
  users/_example/         # шаблон данных пользователя
  memory/*.example.md     # шаблоны категорий
  openclaw.agent.example.json
  secrets.example.json
  deploy/                 # деплой на Linux VPS (опционально)
  _archived/              # устаревшие модули (team-tasks, telegram-group)
```

**Не коммитятся** (`.gitignore`): `users/tg-*`, `USER.md`, `MEMORY.md`, `secrets.json`, `.env`, логи, runtime-состояние порталов.

---

## 15. Частые проблемы

| Симптом | Решение |
|---------|---------|
| Агент каждый раз спрашивает имя | Проверьте `SOUL.md`, перезапустите gateway |
| «План» игнорируется | `setup_status ≠ complete` — завершите онбординг |
| Нет inline-кнопок | Ожидаемо: `inlineButtons: "off"` |
| Нет напоминаний | Нет `plans/YYYY-MM-DD.json` — запустите `daily-plan` или cron |
| Дубли ответов в Telegram | Один ответ за ход; перезапуск gateway |
| Таблицы текстом | Должны быть PNG — см. `cards` скилл |
| Dashboard loading вечно | Открывайте через `start_dashboard.ps1`, не `file://` |
| Mini App не открывается | Нужен HTTPS; `setup_telegram_miniapp.ps1 -Lan` |
| `hasBotToken: false` | Добавьте токен в `.env`, перезапустите backend |
| Данные смешиваются | `session.dmScope: per-channel-peer` |
| Ошибка скриптов | Node ≥ 18; `node scripts/run-tests.mjs` |

---

## 16. Обновление

```powershell
cd "$env:USERPROFILE\.openclaw\workspaces\golden-hour"
git pull
openclaw gateway restart
```

Локальные `users/`, `USER.md`, `MEMORY.md` при обновлении не затрагиваются.

---

## CI / тесты

```powershell
node scripts/run-tests.mjs
```

GitHub Actions: `.github/workflows/test-golden-hour.yml`.

---

## Лицензия и вклад

Код агента — open source. Не публикуйте `users/`, токены ботов и OAuth-ключи.
