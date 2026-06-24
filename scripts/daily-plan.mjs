#!/usr/bin/env node
// daily-plan.mjs — build plans/YYYY-MM-DD.json for user or Telegram group.
//
// Usage:
//   node scripts/daily-plan.mjs --user <user_key> [--date YYYY-MM-DD] [--purpose ...] [--dry-run]
//   node scripts/daily-plan.mjs --group <chat_id> [--user <key>] [--date ...] [--dry-run]

import {
  parseArgs,
  requireUser,
  userDir,
  isDryRun,
  out,
  die,
} from "./lib/cli.mjs";
import { buildDailyPlan } from "./lib/daily-plan-engine.mjs";
import { resolveToday } from "./lib/dates.mjs";
import { groupDir, assertMember, GroupError } from "./lib/group-core.mjs";

const { opts } = parseArgs(process.argv);
const date = resolveToday(opts);
const chatId = opts.group || opts["chat-id"] || opts.chatId;

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

const result = buildDailyPlan(userKey, dir, date, {
  dryRun: isDryRun(opts),
  purpose: opts.purpose || null,
});

if (!result.ok) {
  out({ ok: false, ...result, chat_id: chatId || null });
  process.exit(1);
}

out({ ok: true, ...result, chat_id: chatId || null });
