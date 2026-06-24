#!/usr/bin/env node
// morning-plan.mjs — generate today's daily plan for all active users.
//
// Usage:
//   node scripts/morning-plan.mjs [--date YYYY-MM-DD] [--dry-run] [--force]
//
// Skips users who already have plans/YYYY-MM-DD.json unless --force.

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  readText,
  isDryRun,
  out,
  relWorkspacePath,
} from "./lib/cli.mjs";
import { listActiveUsers } from "./lib/users.mjs";
import { buildDailyPlan } from "./lib/daily-plan-engine.mjs";
import { resolveToday } from "./lib/dates.mjs";

const { opts } = parseArgs(process.argv);
const date = resolveToday(opts);
const dryRun = isDryRun(opts);
const force = opts.force === "true";

const users = listActiveUsers((p) => readText(p));
const results = [];

for (const { user_key, dir } of users) {
  const planPath = path.join(dir, "plans", `${date}.json`);
  const exists = fs.existsSync(planPath);

  if (exists && !force) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "plan_exists",
      path: relWorkspacePath(planPath),
    });
    continue;
  }

  const r = buildDailyPlan(user_key, dir, date, { dryRun });
  results.push({ ...r, skipped: false });
}

const generated = results.filter((r) => r.ok && !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
const errors = results.filter((r) => !r.ok).length;

out({
  date,
  dry_run: dryRun,
  force,
  generated,
  skipped,
  errors,
  results,
  summary: `Утренний план ${date}: создано ${generated}, пропущено ${skipped}, ошибок ${errors}.`,
});
