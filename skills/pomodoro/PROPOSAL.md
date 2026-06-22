# PROPOSAL: pomodoro

## Summary

Telegram-delivered Pomodoro technique timer for the `code-writer` agent. Cycles between work blocks and breaks, sends a notification at every phase transition, persists state to disk so a session survives restarts, supports classic/long/extended/short variants and user-defined custom durations, automatically accumulates the work portion of every pomodoro into a durable statistics file, stays silent on non-pomodoro topics while a session is running (DND), — at most once a day — gently suggests trying a pomodoro when the user is behind on their plan, and can start a **time-windowed scheduled session** pulled from the user's plan (with confirmation and on-the-fly editing).

## Files

- `SKILL.md` — frontmatter + 10-step workflow + Configuration + Output + Open contract (~216 lines).
- `references/data-schema.md` — JSON shapes for `session.json` (incl. scheduled mode), `suggestions.json`, `stats.json`, `schedule-pending.json`, per-day transition log, per-day summary, per-day stats log, per-day DND log, per-day suggestion log, per-day schedule log (~292 lines).
- `references/message-templates.md` — Telegram message text for every notification: work-start, break-start, long-break-start, session-end, status, dnd-off-topic, telegram-warmup, custom-start, custom-invalid, custom-list, plan-behind-suggestion, stats-daily, schedule-proposal, schedule-no-plan, schedule-too-short, schedule-cancelled, window-end, window-end-soon (~234 lines).
- `references/tg-delivery.md` — Telegram delivery contract, including the dialog-warmup requirement (~37 lines).
- `proposal.json` — this proposal's metadata.

## Capabilities

1. **Variants on demand** — `/pomodoro start classic | long | extended | short` for built-ins, `/pomodoro start custom <w> <b>` or `/pomodoro start <w>/<b>` shorthand for user-defined durations (bounds: work 1–240 min, break 1–60 min).
2. **Phase notifications** — work-start, break-start, long-break-start, session-end. Long break fires every `long_break_every` cycles (default 4) and lasts `long_break_minutes` (default 15).
3. **Inline buttons + slash commands** — `[Пропустить фазу]`, `[Завершить сессию]`, plus schedule confirmation buttons `[Подтвердить] [Изменить] [Отмена]`, plus window-end buttons `[Завершить] [Дать дойти] [Продлить]`.
4. **Crash-safe state** — atomic writes via temp+rename, drift recovery on restart, persistent across all restarts.
5. **DND during active sessions** — non-pomodoro messages during `work`/`break`/`long_break` get a one-line `dnd-off-topic` reply and are dropped. No parsing, no journal entries, no skill calls.
6. **Telegram dialog warm-up** — on first session start, refuses to start until the user has sent at least one message to the bot (Telegram silently drops messages to users who haven't opened a dialog).
7. **Proactive once-per-day suggestion** — at most one `plan-behind-suggestion` per local calendar day, hard-capped via `suggestions.json`. Suppressed during active sessions and quiet hours. Triggered by overdue tasks or low completion rate from the user's plan.
8. **Automatic work-time statistics** — every work block (full or partial) is added to `stats.json` with per-date and lifetime counters. Credit rule: `actual_elapsed_capped` by default (partial credit on skip/stop, full credit on normal completion and drift recovery). Queryable via `/pomodoro stats`.
9. **Time-windowed scheduled sessions (step 10)** — user can ask "поработаем с 15 до 17" or "/pomodoro schedule 15-17" or just "поработаем" (intent-routed by agent). The skill pulls the window from the user's plan (current or next block), generates a full pomodoro sequence that fits, asks the user to confirm or edit BEFORE starting (inline buttons `[Подтвердить] [Изменить] [Отмена]`), and runs the session with auto-end at the window boundary. Long-break strategy is configurable (`shrink` / `drop` / `keep_and_truncate`). Drift recovery for scheduled sessions: skipped blocks are dropped, no backfill.

## Open contracts (cross-skill coordination)

- **Plan-behind signal source AND scheduled-session plan lookup** — both step 8 and step 10 read plan state from the location defined in `goal-checkin-notifier/references/data-schema.md`. Needs confirmation from the planning-skill owner. Pomodoro tolerates the file being missing or malformed (silent skip, no error).
- **Plan task shape (assumed)** — `name`, `scheduled_at`, `duration`, `status`. Confirm with planning-skill owner.
- **Statistics integration with `longterm-stats`** — three possible ownership models (read-only consumer, owner of stats file, no integration). Until decided, `pomodoro` is the canonical writer of `stats.json` and other skills read but do not write.
- **Quiet hours** — shared config with `goal-checkin-notifier`. DND is independent (bound to session phase, not the wall clock). Scheduled sessions respect quiet hours for notifications only.
- **Channel identity** — same owner Telegram bot, same OpenClaw message action contract, same `inlineButtons: "all"` capability.
- **`focus-timer` skill overlap** — both skills coexist; agent picks based on user intent. If team wants them merged, separate refactor.

## Verification

All files exist, frontmatter is well-formed YAML, proposal.json parses with the required fields, and all 3 supportFiles' sha256+sizeBytes match disk. Total skill size: 887 lines (cap 1000, 89%).

## Goal

Provide a complete, production-ready Pomodoro technique timer as an OpenClaw workspace skill, with all behaviour documented (variants, statistics, DND, proactive suggestions, scheduled sessions, warm-up), all coordination points with neighbouring skills marked as explicit open contracts, and no runtime script — same architecture as `goal-checkin-notifier`.

## Evidence

Built incrementally across the chat session based on iterative user requirements:

- Initial ask: basic Pomodoro timer (25/5) with Telegram notifications, modelled on `goal-checkin-notifier`.
- Refinement 1: spelling fix to "помодоро", and notification text changed to "время работы" / "время отдыха".
- Refinement 2: DND during active sessions + Telegram dialog warm-up.
- Refinement 3: added `extended` variant (1h40m / 20m) and `custom` variant with bounds 1–240 / 1–60.
- Refinement 4: proactive once-per-day suggestion tied to plan-behind signal.
- Refinement 5: replaced `🍅` (tomato emoji) with the word "помодоро".
- Refinement 6: automatic work-time statistics accumulation into `stats.json` with configurable credit rule.
- Refinement 7: time-windowed scheduled sessions with confirmation flow, plan-driven window lookup, configurable long-break strategy, and auto-end at window boundary.