# Golden Hour — ИИ-агент для подготовки и тайм-менеджмента

ИИ-агент для подготовки к **олимпиадам / экзаменам / темам**: знакомится, **запоминает каждого пользователя в отдельной папке**, строит план, ведёт прогресс, напоминает в Telegram.

> **Установка:** [INSTALL.md](INSTALL.md) — полная инструкция (агент, дашборд, Mini App, cron). Кратко: [SETUP.md](SETUP.md).

## Что внутри

| Компонент | Назначение |
|---|---|
| `SOUL.md` | Главная логика агента — грузится в каждой сессии |
| `skills/` | Дизайн-документы скиллов |
| `scripts/` | Детерминированные скрипты (Node ≥18; `npm install` только для экспериментального SQLite `GH_USE_DB=1`) |
| `openclaw.agent.example.json` | Фрагмент конфига OpenClaw для Telegram-бота |
| `users/_example/` | Шаблон структуры данных пользователя |

## Цепочка

```
session-start
  ├─ вернувшийся → продолжить / настроить заново
  └─ новый → onboarding → study-plan

рабочий режим: daily-plan → checkins → timer → progress
```

## Скиллы (основные)

| Скилл | Назначение |
|---|---|
| `onboarding` | Настройка нового пользователя (все шаги) |
| `study-plan` | Макро-план |
| `daily-plan` | Дневной план + spaced repetition |
| `checkins` | Напоминания, чек-ин, рефлексия |
| `tasks` | Задачи, recurring, decompose |
| `timer` | Помодоро + focus |
| `cards` | План и таблицы → PNG |
| `goal-materials` | Материалы по цели |
| `longterm-stats` / `temporal-kg` | Статистика и история |
| `google-calendar-sync` | Календарь |
| `help-menu` | Меню возможностей |

Инфраструктура: `session-start`, `user-profile`, `owner-profile`, `study-cards` (render engine).

Опционально / владелец: `google-task-hub`, `soul-guardian`, `clawsec-suite`, `coder`, `web-material-finder`.

## Скрипты

```powershell
node scripts/session-start.mjs --user tg-123456
node scripts/study-plan.mjs --user tg-123456 --dry-run
node scripts/daily-plan.mjs --user tg-123456 --dry-run
node scripts/study-plan-cards.mjs --user tg-123456
node scripts/table-cards.mjs --user tg-123456 --title "План" --text "| A | B |"
node scripts/timer.mjs start --user tg-123456 --mode pomodoro
node scripts/goal-materials.mjs pick --user tg-123456 --topic "тема"
node scripts/run-tests.mjs
```

Полный список: [scripts/README.md](scripts/README.md).

**PNG-карточки** (`table-cards`, `study-plan-cards`) требуют Chrome/Edge/Chromium на хосте (см. `skills/study-cards/`).

## Статус компонентов

| Статус | Компоненты |
|---|---|
| **Live** | onboarding, study/daily-plan, checkins, timer, cards, goal-materials, temporal-kg (авто-emit), student-portal, google-calendar-sync |
| **Experimental** | `GH_USE_DB=1` (SQLite), `google-task-hub` (альтернатива локальным tasks) |
| **Archived** | `team-tasks`, `telegram-group` — см. `_archived/` |

## CI

```bash
node scripts/run-tests.mjs   # 71+ unit-тестов; GitHub Actions: .github/workflows/test-golden-hour.yml
```

## Отдельные киты (`kits/`)

Не часть агента — самостоятельные дистрибутивы (напр. `notes-bot-kit-v1`).
