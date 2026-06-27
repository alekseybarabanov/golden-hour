#!/usr/bin/env node
// plan-task.mjs — ответы на пинги дневного плана (начинаю / отложить / пропустить / готово).
//
// Usage:
//   node scripts/plan-task.mjs respond --user <key> --action start|snooze|skip|done [--task-id t_001] [--date YYYY-MM-DD] [--snooze-minutes 30] [--dry-run]

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  readJson,
  writeJson,
  out,
  die,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus } from "./lib/profile.mjs";
import { resolveToday } from "./lib/dates.mjs";
import {
  normalizeAction,
  pickActiveTask,
  applyTaskAction,
  buildRespondMessage,
  updatePlanTask,
} from "./lib/plan-task-core.mjs";
import { normalizePlan } from "./lib/plan-utils.mjs";
import { hookPlanTaskAction } from "./lib/kg-hooks.mjs";

const { cmd, opts } = parseArgs(process.argv);
if (cmd !== "respond") {
  die("usage: node scripts/plan-task.mjs respond --user <key> --action start|snooze|skip|done");
}

const userKey = requireUser(opts);
const dir = userDir(userKey);
const date = resolveToday(opts);
const dryRun = opts["dry-run"] === "true";
const snoozeMinutes = Number(opts["snooze-minutes"] || 30);
const taskId = opts["task-id"] || opts.task || null;

const action = normalizeAction(opts.action);
if (!action) die("invalid --action (start|snooze|skip|done or начинаю|отложить|пропустить|готово|засчитать)");

const { exists, profile } = loadProfile(dir, (p) => readText(p));
if (!exists) die("profile not found");
if (getSetupStatus(profile) !== "complete") die("setup_status not complete");

const planPath = path.join(dir, "plans", `${date}.json`);
if (!fs.existsSync(planPath)) {
  die("no_plan_for_date", {
    date,
    hint: `node scripts/daily-plan.mjs --user ${userKey} --date ${date} --dry-run`,
  });
}

const plan = readJson(planPath, null);
normalizePlan(plan);
const task = pickActiveTask(plan, taskId);
if (!task) die("no_open_task", { date });

const applied = applyTaskAction(task, action, { snoozeMinutes });
if (!applied.ok) die(applied.error);

const nextPlan = updatePlanTask(plan, task.id, applied.task);
const message = buildRespondMessage(action, applied.task, { snoozeMinutes });

if (!dryRun) {
  writeJson(planPath, nextPlan);
}

let kg = null;
if (!dryRun && ["done", "start", "skip"].includes(action)) {
  try {
    kg = hookPlanTaskAction(dir, applied.task, action);
  } catch {
    kg = { ok: false, error: "kg_hook_failed" };
  }
}

out({
  user_key: userKey,
  date,
  dry_run: dryRun,
  action,
  task_id: task.id,
  previous_status: applied.previous_status,
  status: applied.task.status,
  snoozed_until: applied.task.snoozed_until || null,
  message,
  kg,
  summary: dryRun
    ? `Dry-run: ${action} для «${task.title}» → ${applied.task.status}.`
    : message,
});
