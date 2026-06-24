#!/usr/bin/env node
// study-plan.mjs — generate plan.md from profile (user or Telegram group).
//
// Usage:
//   node scripts/study-plan.mjs --user <user_key> [--dry-run] [--force] [--purpose ...] [--output ...]
//   node scripts/study-plan.mjs --group <chat_id> [--user <key>] [--dry-run] [--force]

import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  writeText,
  isDryRun,
  out,
  die,
  relWorkspacePath,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus } from "./lib/profile.mjs";
import { buildStudyPlan } from "./lib/study-plan.mjs";
import { resolvePlanPath } from "./lib/plan-parse.mjs";
import { todayISO } from "./lib/dates.mjs";
import { groupDir, assertMember, GroupError } from "./lib/group-core.mjs";

const { opts } = parseArgs(process.argv);
const chatId = opts.group || opts["chat-id"] || opts.chatId;
const purpose = opts.purpose || null;

let userKey;
let dir;

if (chatId) {
  userKey = opts.user || `group:${chatId}`;
  dir = groupDir(chatId);
  if (opts.user) {
    try {
      assertMember(chatId, opts.user);
    } catch (e) {
      if (e instanceof GroupError) die(e.message, e.extra || {});
      throw e;
    }
  }
} else {
  userKey = requireUser(opts);
  dir = userDir(userKey);
}

const { exists, profile } = loadProfile(dir, (p) => readText(p));
if (!exists) die("profile not found", { chat_id: chatId || null });
if (getSetupStatus(profile) !== "complete") {
  die("setup_status not complete", { setup_status: getSetupStatus(profile) });
}

const planPath = opts.output
  ? path.join(dir, opts.output)
  : resolvePlanPath(dir, profile, { purpose: purpose || profile.purpose });

const existing = readText(planPath);
if (existing && opts.force !== "true" && !isDryRun(opts)) {
  die("plan already exists — use --force to overwrite", {
    path: relWorkspacePath(planPath),
  });
}

const result = buildStudyPlan(profile, opts.date || todayISO(), { purpose });
if (result.error) die(result.error);

if (isDryRun(opts)) {
  out({
    user_key: userKey,
    chat_id: chatId || null,
    dry_run: true,
    path: relWorkspacePath(planPath),
    meta: result.meta,
    preview: result.markdown.slice(0, 800) + "...",
    markdown: result.markdown,
  });
  process.exit(0);
}

writeText(planPath, result.markdown);

out({
  user_key: userKey,
  chat_id: chatId || null,
  path: relWorkspacePath(planPath),
  meta: result.meta,
  summary: `План: ${result.meta.totalWeeks} нед., ${result.meta.totalHours} ч, ${result.meta.topicCount} тем.`,
});
