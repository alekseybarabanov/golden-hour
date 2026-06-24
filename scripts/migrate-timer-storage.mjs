#!/usr/bin/env node
// migrate-timer-storage.mjs — copy users/<key>/pomodoro/ → timer/ when timer/ is missing.
//
// Usage:
//   node scripts/migrate-timer-storage.mjs --user <user_key> [--dry-run]
//   node scripts/migrate-timer-storage.mjs --all [--dry-run]

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  WORKSPACE,
  out,
  die,
} from "./lib/cli.mjs";

function copyDir(src, dest, { dryRun }) {
  if (!fs.existsSync(src)) return { copied: false, reason: "source_missing" };
  if (fs.existsSync(dest)) return { copied: false, reason: "dest_exists" };
  if (dryRun) return { copied: true, dry_run: true, from: src, to: dest };
  fs.cpSync(src, dest, { recursive: true });
  return { copied: true, from: src, to: dest };
}

const { opts } = parseArgs(process.argv);
const dryRun = opts["dry-run"] === "true" || opts.dryRun === "true";

function migrateOne(userKey) {
  const dir = userDir(userKey);
  const src = path.join(dir, "pomodoro");
  const dest = path.join(dir, "timer");
  return { user_key: userKey, ...copyDir(src, dest, { dryRun }) };
}

if (opts.all === "true") {
  const usersRoot = path.join(WORKSPACE, "users");
  const results = [];
  for (const name of fs.readdirSync(usersRoot)) {
    if (!name.startsWith("tg-") && name !== "local" && !name.startsWith("owner")) continue;
    results.push(migrateOne(name));
  }
  const migrated = results.filter((r) => r.copied);
  out({
    ok: true,
    dry_run: dryRun,
    migrated: migrated.length,
    results,
    summary: dryRun
      ? `Dry-run: ${migrated.length} папок можно перенести pomodoro → timer`
      : `Перенесено ${migrated.length} папок pomodoro → timer`,
  });
  process.exit(0);
}

const userKey = requireUser(opts);
const result = migrateOne(userKey);
if (!result.copied && result.reason === "source_missing") {
  die("pomodoro/ not found — nothing to migrate", { user_key: userKey });
}
out({ ok: true, dry_run: dryRun, ...result });
