#!/usr/bin/env node
// profile-update.mjs — write or patch a user profile in the DB.
// Used by onboarding skills instead of directly editing profile.md.
//
// Usage:
//   node scripts/profile-update.mjs --user <user_key> --patch '{"name":"Миша","setup_status":"in_progress"}'
//   node scripts/profile-update.mjs --user <user_key> --set name=Миша --set setup_status=in_progress
//   node scripts/profile-update.mjs --user <user_key> --get          # read current profile

import { parseArgs, requireUser, die, out, WORKSPACE } from "./lib/cli.mjs";
import { getDb, upsertUser, getUser, defaultDbPath } from "./lib/db.mjs";
import path from "node:path";

const { opts } = parseArgs(process.argv);
const user_key = requireUser(opts);

const dbPath = defaultDbPath(WORKSPACE);
const db = getDb(dbPath);

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
// Collect all --set entries
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
  // Try to parse as JSON value, fall back to string
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
