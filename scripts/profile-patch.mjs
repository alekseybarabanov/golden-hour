#!/usr/bin/env node
// profile-patch.mjs — deterministic patch for users/<user_key>/profile.md (file storage).
//
// Usage:
//   node scripts/profile-patch.mjs --user <key> --patch '{"name":"Миша","setup_status":"in_progress"}'
//   node scripts/profile-patch.mjs --user <key> --set name=Миша --set setup_status=in_progress
//   node scripts/profile-patch.mjs --user <key> --get
//   node scripts/profile-patch.mjs --user <key> --init --set name=Миша [--dry-run]

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  writeText,
  out,
  die,
  relWorkspacePath,
} from "./lib/cli.mjs";
import {
  parseProfile,
  loadProfile,
  patchProfileMarkdown,
  mergeProfile,
  createProfileMarkdown,
} from "./lib/profile.mjs";

const { opts } = parseArgs(process.argv);
const userKey = requireUser(opts);
const dir = userDir(userKey);
const profilePath = path.join(dir, "profile.md");
const dryRun = opts["dry-run"] === "true";

if (opts.get === "true" || opts.get === true) {
  const { exists, profile } = loadProfile(dir, (p) => readText(p));
  if (!exists) die("profile not found", { user_key: userKey });
  out({ user_key: userKey, profile, profile_path: relWorkspacePath(profilePath) });
  process.exit(0);
}

const rawSets = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--set" && process.argv[i + 1]) {
    rawSets.push(process.argv[++i]);
  }
}

let patch = {};
if (opts.patch) {
  try {
    patch = JSON.parse(opts.patch);
  } catch {
    die("invalid --patch JSON");
  }
  if (typeof patch !== "object" || Array.isArray(patch)) die("--patch must be a JSON object");
}

for (const entry of rawSets) {
  const eq = entry.indexOf("=");
  if (eq < 1) die(`invalid --set format: "${entry}" (expected key=value)`);
  const key = entry.slice(0, eq).trim();
  const raw = entry.slice(eq + 1);
  try {
    patch[key] = JSON.parse(raw);
  } catch {
    patch[key] = raw;
  }
}

if (!Object.keys(patch).length) {
  die("provide --patch '{...}' or one or more --set key=value");
}

if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const init = opts.init === "true" || opts.init === true;
let prevText = readText(profilePath, "");
let prevProfile = prevText ? parseProfile(prevText) : {};

if (!prevText && !init) {
  die("profile not found — use --init for first write", { user_key: userKey });
}

const merged = mergeProfile(prevProfile, patch);
let nextText;

if (!prevText) {
  nextText = createProfileMarkdown(merged, { title: merged.name });
} else {
  const { text } = patchProfileMarkdown(prevText, patch);
  nextText = text;
}

if (!dryRun) {
  writeText(profilePath, nextText);
}

const { profile } = loadProfile(dir, () => nextText);

out({
  user_key: userKey,
  dry_run: dryRun,
  updated: Object.keys(patch),
  profile_path: relWorkspacePath(profilePath),
  profile,
  summary: dryRun
    ? `Dry-run: обновил бы ${Object.keys(patch).join(", ")}.`
    : `Профиль обновлён: ${Object.keys(patch).join(", ")}.`,
});
