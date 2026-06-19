---
name: "focus-timer"
description: "\"Focus session timer with duration picker, praise-on-complete, and 5-window stats (24h/week/month/year/all). Logs to plan.\""
---

# Focus Timer

Starts, tracks, and stops focused work sessions. Triggered by:
1. User command — "начать [duration] [task_title]"
2. From `goal-checkin-notifier` "Начинаю" button — sends a duration selection prompt, starts timer once user picks

## Workflow

1. **Parse trigger**:
   - User free text in TG → match against command patterns
   - Incoming message starts with `callback_data: goal:done:` → send duration selection prompt (NOT auto-start)
   - Incoming message starts with `callback_data: goal:snooze:` or `goal:skip:` → ignore
   - Incoming message starts with `callback_data: timer:duration:<N>:` → user picked a duration from the prompt — start session
   - Incoming message starts with `callback_data: timer:custom:` → user clicked "своё" — ask "Сколько минут?"
   - Incoming message starts with `callback_data: timer:done:` → mark task done
   - Incoming message starts with `callback_data: timer:more:` → show duration selection for new session
   - Incoming message starts with `callback_data: timer:stats:` → show stats summary

2. **Resolve task context**:
   - For explicit `task_id` in command or callback, look up the task in today's plan
   - For "начать" without task context, use the most recent active task

3. **Resolve duration**:
   - **From user command** ("начать 30" / "начать час" / "начать 1ч 30м") — use the explicit value
   - **From "Начинаю" button** — user has NOT specified; show selection prompt:
     ```
     Сколько хочешь заниматься над *{task_title}*?

     [⏱ час (60)] [⏱ пара (45)] [⏱ 30м] [⏱ своё]
     ```
   - **From "своё"** — ask: "Сколько минут? (например, `30`, `1ч 30м`, `90`)"
   - **From "Ещё!" button** (after timer expiry) — use just-finished duration, or ask

4. **Manage session** (silent during work, no mid-session notifications):
   - **Start**: record `session_start`, `task_id`, `goal_id`, `planned_duration_minutes` to `state/sessions.json`. Reply: "Запустил таймер на *{task_title}* 🦊 ⏱ {duration} мин"
   - **Stop** (manual `стоп`): compute `duration_minutes`, append to plan file's `task.time_spent_minutes`, log to daily journal. Reply: "Ок, остановил. *{minutes}* мин на *{task_title}* — сохранено в журнал, но задача осталась активной"
   - **Pause**: "Пауза ⏸"
   - **Resume**: "Продолжаем ⏱"
   - **Status**: reply with elapsed time, current task

5. **End-of-session flow** (timer expires, PRAISE the user):
   - Send: "Молодец! 🎉 Занимался *{task_title}* {minutes} мин. Что дальше?"
   - Inline buttons: `[Засчитать] [Ещё!]`
   - On `[Засчитать]`: set `task.status = "done"`, append `time_spent_minutes`, log session to `history` (`end_reason: timer_expiry_confirmed`), **update stats counters**, end
   - On `[Ещё!]`: log finished segment to history with `end_reason: timer_expiry_continued`, send duration selection prompt for a new session on the same task

6. **Update statistics on session end** — see "Statistics" section below

7. **Persist**: `state/sessions.json` and `state/stats.json` survive restarts; on gateway restart with active session, the user can resume

## Schema versioning

Both `state/sessions.json` and `state/stats.json` are versioned for cross-skill compatibility:

- `schema_version` — current is `1`
- `skill_name` — `"focus-timer"` (so other skills can identify the producer of a file in a shared directory)

These fields are stable. v1 readers continue to work on v1 files. Breaking changes will bump `schema_version` and the v1 reader will detect "file is v2, I read v1" and refuse to write. See `references/statistics.md` for the full cross-skill contract and `references/state-storage.md` for backward-compat rules.

## Configuration

- `default_session_length_minutes` — default `0` (no default; ask every time via prompt)
- `preset_durations` — `{"час": 60, "пара": 45, "30м": 30}` (Russian aliases; user-configurable)
- `state_dir` — default `~/.openclaw/focus-timer/`
- `mid_session_pings` — default `false` (always off — focus timer stays silent during the session)
- `auto_log_to_plan` — default `true`
- `end_of_session_buttons` — `["Засчитать", "Ещё!"]`
- `praise_message` — default `"Молодец! 🎉"`
- `stats_enabled` — default `true` (5-window stats tracking)

## Output

- `state/sessions.json` — current and historical sessions (with `schema_version: 1`, `skill_name: "focus-timer"`)
- `state/stats.json` — 5-window stats (with `schema_version: 1`, `skill_name: "focus-timer"`)
- Plan file: `task.time_spent_minutes` (additive)
- Plan file: `task.status = "done"` (only on `[Засчитать]`)
- Daily log: `state/YYYY-MM-DD-log.md`

## Statistics (5 time windows — the user's "5 variables")

The skill tracks time spent per task and per goal across 5 time windows:

| Variable | Aliases | Period | Resets at |
|---|---|---|---|
| `24h` | `сегодня`, `today`, `day` | Today (local 00:00 → 23:59) | 00:00 each day |
| `week` | `неделя`, `week` | Current ISO week (Mon → Sun) | 00:00 each Monday |
| `month` | `месяц`, `month` | Current calendar month | 00:00 on 1st of month |
| `year` | `год`, `year` | Current calendar year | 00:00 on Jan 1 |
| `all` | `всё`, `all`, `всегда` | All sessions ever | **never** |

For each window, the skill tracks (in `state/stats.json`):

- `by_task[task_id] = { minutes, sessions }`
- `by_goal[goal_id] = { minutes, sessions }`
- `period_start` — ISO timestamp of the current period's start (for the 4 reset windows; "all" has no `period_start`)

### Update on session end

When a session ends, the skill increments the relevant counters:

- For each of the 4 reset windows (`24h`, `week`, `month`, `year`):
  - If `session.ended_at >= window.period_start` → increment `by_task[task_id]` and `by_goal[goal_id]` by `session.duration_minutes` and `1`
  - If `session.ended_at < window.period_start` → window has expired; do not increment (the next session or stats query will trigger self-healing)
- For `all` window: always increment (never resets)

### Reset at boundaries (cron-driven)

The 4 reset windows are zeroed by cron jobs at the period boundary. Cron definitions are in `references/cron-setup.md`. The `all` window has no reset cron — counters accumulate indefinitely.

### Self-healing

If a reset cron is missed (e.g., gateway was down at 00:00), the next session end or stats query detects the stale `period_start` and recomputes the window from `state/sessions.json.history` (filtering sessions to the current period) before incrementing. This keeps stats accurate even after a missed reset.

### Statistics commands

- `статистика` or `/timer stats` — show all 5 windows with totals and top tasks
- `статистика <window>` — show details for one window (`24h`, `week`, `month`, `year`, `all`)
- `статистика <goal_keyword>` — show stats for a specific goal across all 5 windows (e.g., `статистика физика`)

Full schema, output format, command reference, **cross-skill contract, and example queries for other skills**: `references/statistics.md`.

## Recurring daily tasks

For tasks that repeat daily (e.g., "Подготовка по физике" every day):

- Each daily session is **independent** — starts fresh, asks for duration
- All sessions are saved to `state/sessions.json.history` regardless of date or task recurrence
- Statistics across 5 windows aggregate these sessions
- The skill does **not** auto-create new sessions across days and does **not** track streaks — that's a separate concern

## Integration with `goal-checkin-notifier`

**Task ping** (from notifier, **no time shown**):
```
Пора за *{goal_title}* 🦊
{task_title}

Как настрой, начинаем?
```
Buttons: `[Начинаю] [Отложить 30м] [Пропустить]`

**"Начинаю" button flow** (NEW: duration selection prompt, NOT auto-start):
1. User clicks "Начинаю" (callback: `goal:done:<task_id>`)
2. Notifier processes: updates plan's `task.status = "in_progress"`
3. Focus-timer processes: sends duration selection prompt with 4 buttons
4. User picks duration (button click or text)
5. Focus-timer starts session with chosen duration, sends confirmation

**End-of-session "[Засчитать]":**
1. User clicks `[Засчитать]` on the praise message
2. Focus-timer writes `task.status = "done"` to the plan
3. Focus-timer updates stats counters (all 5 windows)
4. Notifier should skip pings for this task for the rest of the day

The notifier's "Отложить" / "Пропустить" callbacks do **not** affect the timer.

## Open contract with the team

- New field `time_spent_minutes` on tasks in the plan file
- Time parsing rules: see `references/commands.md`
- Duration selection UX: 4 inline buttons (час / пара / 30м / своё)
- Praise message customization per goal/task?
- Stats storage model: stored counters with cron-based reset + self-healing
- 5-window time zones: user-local
- Stats window definitions: calendar-based (Mon-Sun week, 1st-of-month, Jan 1)
- "All time" storage: never truncated, ever-growing JSON
- Cross-skill contract: read-only for other skills, see `references/statistics.md`
- Schema versioning: v1 current, breaking changes bump version, see `references/statistics.md`
