# users/_example — шаблон структуры данных пользователя

Каждый пользователь бота получает свою папку `users/<user_key>/`.

| Источник | `user_key` |
|---|---|
| Telegram | `tg-<id>` |
| Другой канал | `<channel>-<id>` |
| Webchat / CLI | `local` |

## Файлы

| Файл | Назначение |
|---|---|
| `profile.md` | цель, предмет, уровни, дедлайн, `setup_status` |
| `plan.md` | макро-план (генерирует `study-plan`) |
| `progress.md` | чек-ины, streak, закрытые темы |
| `tasks.md` | активные задачи (рендер из `tasks.yaml`) |
| `tasks.yaml` | данные трекера задач |
| `recurring.json` | повторяющиеся дела для `daily-plan` |
| `plans/YYYY-MM-DD.json` | дневной план для напоминаний |
| `timer/` | pomodoro + focus сессии (единое хранилище) |
| `materials/` | материалы по цели |
| `google-calendar.json` | OAuth-токен (приватно) |

Папки `users/tg-*` создаются автоматически при онбординге. **Не коммитятся в git** (см. `.gitignore`).

Пример начального `profile.md` — `profile.md.example`.
