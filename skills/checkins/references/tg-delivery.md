# Telegram delivery (DEPRECATED)

> **Не использовать.** Golden Hour доставляет напоминания через `cron-deliver.mjs` → Telegram Bot API. **Без inline-кнопок** — ответы текстом («начинаю», «отложить», «пропустить») → `plan-task.mjs`.

Актуально:
- `skills/checkins/SKILL.md`
- `scripts/lib/telegram-deliver.mjs`
- `HEARTBEAT.md`

---

_Ниже — legacy-справка по inline-кнопкам (историческая)._

## Sending from a skill (JS context) — legacy

The skill invoked the message action with `buttons` / inline keyboard. **Отключено** (`inlineButtons: "off"`).

## Callback handling — legacy

Callback `goal:done:`, `goal:snooze:`, `goal:skip:` — заменены текстовыми командами и `plan-task.mjs respond`.
