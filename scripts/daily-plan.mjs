#!/usr/bin/env node
// daily-plan.mjs — build users/<user_key>/plans/YYYY-MM-DD.json
//
// Usage:
//   node scripts/daily-plan.mjs --user <user_key> [--date YYYY-MM-DD] [--dry-run]

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
const userKey = requireUser(opts);
const date = resolveToday(opts);
const dir = userDir(userKey);

const result = buildDailyPlan(userKey, dir, date, { dryRun: isDryRun(opts) });

if (!result.ok) {
  out({ ok: false, ...result });
  process.exit(1);
}

out({ ok: true, ...result });
