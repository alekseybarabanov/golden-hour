#!/usr/bin/env node
// checkin-record.mjs — записать вечерний (или ручной) чек-ин в progress.md.
//
// Usage:
//   node scripts/checkin-record.mjs --user <key> --text "что изучил сегодня" [--date YYYY-MM-DD] [--dry-run]

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  readJson,
  writeText,
  out,
  die,
  relWorkspacePath,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus } from "./lib/profile.mjs";
import { resolveToday } from "./lib/dates.mjs";
import { appendCheckin, planDayStats } from "./lib/progress-core.mjs";
import { hookCheckinRecorded } from "./lib/kg-hooks.mjs";

const { opts } = parseArgs(process.argv);
const userKey = requireUser(opts);
const dir = userDir(userKey);
const date = resolveToday(opts);
const dryRun = opts["dry-run"] === "true";
const bullet = opts.text || opts.summary;
if (!bullet?.trim()) die("missing --text");

const { exists, profile } = loadProfile(dir, (p) => readText(p));
if (!exists) die("profile not found");
if (getSetupStatus(profile) !== "complete") die("setup_status not complete");

const planPath = path.join(dir, "plans", `${date}.json`);
const plan = fs.existsSync(planPath) ? readJson(planPath, null) : null;
const stats = plan ? planDayStats(plan) : null;

let entry = `**Чек-ин.** ${bullet.trim()}`;
if (stats?.total) {
  entry += ` (план: ${stats.done}/${stats.total})`;
}

const progressPath = path.join(dir, "progress.md");
const prev = readText(progressPath, "");
const { text, streak, duplicate } = appendCheckin(prev, {
  date,
  bullet: entry,
  name: profile.name,
});

if (!dryRun && !duplicate) {
  writeText(progressPath, text);
}

let kg = null;
if (!dryRun && !duplicate) {
  try {
    kg = hookCheckinRecorded(dir, { text: bullet.trim(), date });
  } catch {
    kg = { ok: false, error: "kg_hook_failed" };
  }
}

out({
  user_key: userKey,
  date,
  dry_run: dryRun,
  duplicate,
  streak,
  plan_stats: stats,
  kg,
  progress_path: relWorkspacePath(progressPath),
  summary: duplicate
    ? "Запись за этот день уже есть — дубликат не добавлен."
    : dryRun
      ? `Dry-run: чек-ин за ${date}, streak ${streak}.`
      : `Чек-ин записан. Streak: ${streak}.`,
});
