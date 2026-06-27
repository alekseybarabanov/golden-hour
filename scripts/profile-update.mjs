#!/usr/bin/env node
// profile-update.mjs — patch user profile in SQLite (experimental, opt-in).
// **File storage:** use profile-patch.mjs instead (default).
//
// Requires: npm install && GH_USE_DB=1
//
// Usage:
//   node scripts/profile-update.mjs --user <user_key> --patch '{"name":"Миша","setup_status":"in_progress"}'
//   node scripts/profile-update.mjs --user <user_key> --set name=Миша --set setup_status=in_progress
//   node scripts/profile-update.mjs --user <user_key> --get

import { parseArgs, requireUser, die, out, WORKSPACE } from "./lib/cli.mjs";
import { isDbEnabled, getDb, upsertUser, getUser, defaultDbPath } from "./lib/db.mjs";

if (!isDbEnabled()) {
  die("sqlite_disabled", {
    hint:
      "SQLite is off. Use: node scripts/profile-patch.mjs --user <key> --set key=value. " +
      "To enable SQLite: npm install && GH_USE_DB=1",
  });
}

const { opts } = parseArgs(process.argv);
const user_key = requireUser(opts);

const dbPath = defaultDbPath(WORKSPACE);
const db = getDb(dbPath);
if (!db) {
  die("sqlite_unavailable", {
    hint: "Run npm install in the workspace, then GH_USE_DB=1",
  });
}

// --get: print profile
if (opts.get === "true" || opts.get === true) {
  const profile = getUser(db, user_key);
  if (!profile) die("user not found", { user_key });
  out({ user_key, profile });
  process.exit(0);
}

// --patch '{"key":"value",...}' — merge JSON patch into profile
if (opts.patch) {
  let patch;
  try {
    patch = JSON.parse(opts.patch);
  } catch {
    die("invalid --patch JSON");
  }
  if (typeof patch !== "object" || Array.isArray(patch)) die("--patch must be a JSON object");
  const profile = upsertUser(db, user_key, patch);
  out({ user_key, profile, updated: Object.keys(patch) });
  process.exit(0);
}

// --set key=value [--set key2=value2 ...] — individual field updates
const rawSets = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--set" && process.argv[i + 1]) {
    rawSets.push(process.argv[++i]);
  }
}

if (rawSets.length === 0) {
  die("provide --patch '{...}' or one or more --set key=value");
}

const fields = {};
for (const entry of rawSets) {
  const eq = entry.indexOf("=");
  if (eq < 1) die(`invalid --set format: "${entry}" (expected key=value)`);
  const key = entry.slice(0, eq).trim();
  const raw = entry.slice(eq + 1);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  fields[key] = value;
}

const profile = upsertUser(db, user_key, fields);
out({ user_key, profile, updated: Object.keys(fields) });
