#!/usr/bin/env node
// timer-tick.mjs — tick active timer sessions for all users (cron/heartbeat).
//
// Usage: node scripts/timer-tick.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { WORKSPACE, parseArgs, out, userDir, readJson, writeJson } from "./lib/cli.mjs";
import { cmdTick, nowISO } from "./lib/pomodoro-core.mjs";
import { resolveTimerDir } from "./lib/timer-dir.mjs";
import { addTimeSpentMinutes } from "./lib/tasks-core.mjs";

const { opts } = parseArgs(process.argv);
const dryRun = opts["dry-run"] === "true";
const usersRoot = path.join(WORKSPACE, "users");
const results = [];

if (!fs.existsSync(usersRoot)) {
  out({ ok: true, ticked: 0, results: [] });
  process.exit(0);
}

for (const key of fs.readdirSync(usersRoot)) {
  if (key.startsWith("_") || key.startsWith("archive-")) continue;
  const dir = userDir(key);
  const timerDir = resolveTimerDir(dir, { autoMigrate: true });
  if (!fs.existsSync(timerDir)) continue;
  const session = readJson(path.join(timerDir, "session.json"), null);
  if (!session) continue;

  // Focus mode: check duration, send praise on completion
  if (session.mode === "focus" && session.phase === "focus") {
    if (dryRun) {
      results.push({ user_key: key, dry_run: true, mode: "focus" });
      continue;
    }
    const elapsed = Math.max(0, Math.ceil((Date.parse(nowISO()) - Date.parse(session.phase_started_at)) / 60000));
    if (elapsed >= session.phase_duration_minutes) {
      const taskNote = session.task_id ? ` над ${session.task_id}` : "";
      results.push({
        user_key: key,
        mode: "focus",
        notifications: [
          {
            template: "focus-complete",
            message: `Молодец! 🎉 Занимался ${elapsed} мин${taskNote}. Напиши **засчитать** или **ещё**.`,
            buttons: null,
          },
        ],
        active: false,
      });
      session.phase = "stopped";
      session.ended_at = nowISO();
      session.ended_reason = "timer_expiry";
      session.credited_minutes = session.phase_duration_minutes;
      session.elapsed_minutes = elapsed;
      writeJson(path.join(timerDir, "session.json"), session);
      if (session.task_id) {
        addTimeSpentMinutes(dir, session.task_id, session.credited_minutes);
      }
    }
    continue;
  }

  // Pomodoro mode: existing logic
  if (!["work", "break", "long_break"].includes(session.phase)) continue;
  if (dryRun) {
    results.push({ user_key: key, dry_run: true, phase: session.phase });
    continue;
  }
  const r = cmdTick(timerDir);
  if (r.notifications?.length) {
    results.push({ user_key: key, notifications: r.notifications, active: r.active });
  }
}

out({
  ok: true,
  ticked: results.length,
  results,
  summary:
    results.length > 0
      ? `Таймер: ${results.length} сессий с переходом — отправь уведомления из notifications[].`
      : "Активных переходов таймера нет.",
});
