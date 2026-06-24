# Golden Hour — ИИ-агент для подготовки и тайм-менеджмента

ИИ-агент для подготовки к **олимпиадам / экзаменам / темам**: знакомится, **запоминает каждого пользователя в отдельной папке**, строит план, ведёт прогресс, напоминает в Telegram.

> **Установка:** [SETUP.md](SETUP.md) (ветка **`agent-install`** — рекомендуется).

## Что внутри

| Компонент | Назначение |
|---|---|
| `SOUL.md` | Главная логика агента — грузится в каждой сессии |
| `skills/` | Дизайн-документы скиллов |
| `scripts/` | Детерминированные скрипты (Node ≥18, без npm) |
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
| `team-tasks` / `telegram-group` | Командная работа |
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

## Отдельные киты (`kits/`)

Не часть агента — самостоятельные дистрибутивы (напр. `notes-bot-kit-v1`).
