#!/usr/bin/env node
// daily-plan.mjs — build plans/YYYY-MM-DD.json for user.
//
// Usage:
//   node scripts/daily-plan.mjs --user <user_key> [--date YYYY-MM-DD] [--purpose ...] [--dry-run]

import {
  parseArgs,
  requireUser,
  userDir,
  isDryRun,
  out,
} from "./lib/cli.mjs";
import { buildDailyPlan } from "./lib/daily-plan-engine.mjs";
import { resolveToday } from "./lib/dates.mjs";

const { opts } = parseArgs(process.argv);
const date = resolveToday(opts);
const userKey = requireUser(opts);
const dir = userDir(userKey);

const result = buildDailyPlan(userKey, dir, date, {
  dryRun: isDryRun(opts),
  purpose: opts.purpose || null,
});

if (!result.ok) {
  out({ ok: false, ...result });
  process.exit(1);
}

out({ ok: true, ...result });
