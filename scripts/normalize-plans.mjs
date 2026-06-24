#!/usr/bin/env node
// normalize-plans.mjs — repair non-canonical task statuses in plans/*.json
//
// Usage: node scripts/normalize-plans.mjs [--user <key>] [--date YYYY-MM-DD] [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, writeJson, out, userDir, WORKSPACE } from "./lib/cli.mjs";
import { normalizePlan } from "./lib/plan-utils.mjs";

const { opts } = parseArgs(process.argv);
const dryRun = opts["dry-run"] === "true";
const onlyDate = opts.date || null;
const onlyUser = opts.user || null;

function scanUser(userKey) {
  const dir = userDir(userKey);
  const plansDir = path.join(dir, "plans");
  if (!fs.existsSync(plansDir)) return [];

  const files = fs
    .readdirSync(plansDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));

  const repaired = [];
  for (const file of files) {
    const date = file.replace(/\.json$/, "");
    if (onlyDate && date !== onlyDate) continue;
    const p = path.join(plansDir, file);
    const plan = readJson(p, null);
    if (!plan) continue;
    if (normalizePlan(plan)) {
      if (!dryRun) writeJson(p, plan);
      repaired.push({ user_key: userKey, date });
    }
  }
  return repaired;
}

const repaired = [];
const usersRoot = path.join(WORKSPACE, "users");

if (onlyUser) {
  repaired.push(...scanUser(onlyUser));
} else if (fs.existsSync(usersRoot)) {
  for (const name of fs.readdirSync(usersRoot)) {
    if (name.startsWith("_") || name.startsWith("archive-")) continue;
    repaired.push(...scanUser(name));
  }
}

out({
  ok: true,
  dry_run: dryRun,
  repaired_count: repaired.length,
  repaired,
  summary:
    repaired.length > 0
      ? `${dryRun ? "Dry-run: " : ""}Нормализовано планов: ${repaired.length}.`
      : "Нечего нормализовать — все статусы каноничны.",
});
