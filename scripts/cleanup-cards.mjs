#!/usr/bin/env node
// cleanup-cards.mjs — retention for users/*/cards/tables/* (PNG render artifacts).
//
// Usage:
//   node scripts/cleanup-cards.mjs [--user <key>] [--keep 20] [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, requireUser, userDir, WORKSPACE, out } from "./lib/cli.mjs";

const { opts } = parseArgs(process.argv);
const keep = Math.max(5, Number(opts.keep || process.env.GH_CARDS_KEEP || 20));
const dryRun = opts["dry-run"] === "true";
const userKey = opts.user;

function cleanupUser(dir) {
  const tablesRoot = path.join(dir, "cards", "tables");
  if (!fs.existsSync(tablesRoot)) return { removed: 0, kept: 0 };

  const stamps = fs
    .readdirSync(tablesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (stamps.length <= keep) return { removed: 0, kept: stamps.length };

  const toRemove = stamps.slice(0, stamps.length - keep);
  for (const stamp of toRemove) {
    const p = path.join(tablesRoot, stamp);
    if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
  }
  return { removed: toRemove.length, kept: keep };
}

let totalRemoved = 0;
let usersProcessed = 0;

if (userKey) {
  const r = cleanupUser(userDir(userKey));
  totalRemoved += r.removed;
  usersProcessed = 1;
} else {
  const usersRoot = path.join(WORKSPACE, "users");
  if (fs.existsSync(usersRoot)) {
    for (const ent of fs.readdirSync(usersRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith("_")) continue;
      const r = cleanupUser(path.join(usersRoot, ent.name));
      totalRemoved += r.removed;
      usersProcessed++;
    }
  }
}

out({
  ok: true,
  dry_run: dryRun,
  keep,
  users_processed: usersProcessed,
  directories_removed: totalRemoved,
  summary: dryRun
    ? `Dry-run: удалил бы ${totalRemoved} старых папок cards/tables (keep=${keep}).`
    : `Удалено ${totalRemoved} старых папок cards/tables (keep=${keep}).`,
});
