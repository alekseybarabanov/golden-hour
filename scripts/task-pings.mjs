#!/usr/bin/env node
// task-pings.mjs — пинги задач по scheduled_at (без LLM).
//
// Usage: node scripts/task-pings.mjs [--date YYYY-MM-DD] [--dry-run] [--grace-minutes N]
//
// Output: { ok, results: [{ user_key, notifications: [{ message }] }] }
// Ping state (.ping-state-*.json) записывается здесь — idempotent с cron-deliver.

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readText, readJson, out } from "./lib/cli.mjs";
import { listActiveUsers } from "./lib/users.mjs";
import { resolveToday } from "./lib/dates.mjs";
import {
  mskNowParts,
  isQuietHours,
  selectDueTasks,
  goalForTask,
  buildPingMessage,
  wasPingedForTrigger,
} from "./lib/task-pings-core.mjs";
import { normalizePlan } from "./lib/plan-utils.mjs";

const { opts } = parseArgs(process.argv);
const date = resolveToday(opts);
const dryRun = opts["dry-run"] === "true";
const graceMinutes = Number(opts["grace-minutes"] || 2);
const now = mskNowParts();

const results = [];

if (now.date !== date) {
  out({
    ok: true,
    date,
    dry_run: dryRun,
    skipped_reason: "date_mismatch_use_today",
    results: [],
    summary: `Пинги только для сегодня (${now.date}), передан --date ${date}.`,
  });
  process.exit(0);
}

for (const { user_key, dir, profile } of listActiveUsers((p) => readText(p))) {
  const quietStart = profile.quiet_hours_start || "23:00";
  const quietEnd = profile.quiet_hours_end || "08:00";
  const maxPings = Number(profile.max_pings_per_day ?? 3);

  if (isQuietHours(now.hour, now.minute, quietStart, quietEnd)) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "quiet_hours",
    });
    continue;
  }

  const planPath = path.join(dir, "plans", `${date}.json`);
  if (!fs.existsSync(planPath)) {
    results.push({
      user_key,
      ok: false,
      skipped: true,
      reason: "no_plan",
    });
    continue;
  }

  const plan = readJson(planPath, null);
  normalizePlan(plan);
  const statePath = path.join(dir, "plans", `.ping-state-${date}.json`);
  let state = readJson(statePath, { date, count: 0, sent: [] });
  const pingsToday = state.count || 0;

  if (pingsToday >= maxPings) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "max_pings_reached",
      pings_today: pingsToday,
      max_pings_per_day: maxPings,
    });
    continue;
  }

  const due = selectDueTasks(plan, now.ms, state, { graceMinutes });
  if (!due.length) {
    results.push({ user_key, ok: true, skipped: true, reason: "no_due_tasks" });
    continue;
  }

  const pick = due[0];
  const goal = goalForTask(plan, pick.task);
  const message = buildPingMessage(pick.task, goal);

  const notifications =
    dryRun || !wasPingedForTrigger(state, pick.task.id, pick.triggerMs)
      ? [{ template: "task-ping", message, buttons: null }]
      : [];

  results.push({
    user_key,
    ok: true,
    task_id: pick.task.id,
    trigger_at: pick.triggerMs,
    pings_today: state.count || pingsToday,
    notifications,
  });
}

const sent = results.filter((r) => r.notifications?.length).length;
const skipped = results.filter((r) => r.skipped).length;

out({
  ok: true,
  date,
  dry_run: dryRun,
  pings: sent,
  skipped,
  results,
  summary: dryRun
    ? `Dry-run: ${results.filter((r) => r.task_id).length} пинг(ов) готовы.`
    : sent > 0
      ? `Пинги задач: ${sent} пользовател(ей).`
      : skipped > 0
        ? `Пинги пропущены (${skipped} пользовател(ей)).`
        : "Нет задач для пинга.",
});
