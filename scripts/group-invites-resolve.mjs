#!/usr/bin/env node
// group-invites-resolve.mjs — auto-accept pending group invites by telegram id/username.
//
// Usage:
//   node scripts/group-invites-resolve.mjs --user <key> [--chat-id <id>] --telegram-id N [--username @x]
//   node scripts/group-invites-resolve.mjs --user <key> --telegram-id N   # scan all groups

import { parseArgs, requireUser, out, die } from "./lib/cli.mjs";
import { resolvePendingGroupInvites } from "./lib/group-core.mjs";

const { opts } = parseArgs(process.argv);
const userKey = requireUser(opts);
const chatId = opts["chat-id"] || opts.chatId || opts.group || null;
const telegramId = opts["telegram-id"] || opts.telegramId || null;
const username = opts.username || null;

if (!telegramId && !username) die("missing --telegram-id or --username");

const result = resolvePendingGroupInvites({
  userKey,
  chatId,
  telegramId,
  username,
});

out({
  ...result,
  summary:
    result.count > 0
      ? `Принято ${result.count} групповых инвайт(ов).`
      : "Нет ожидающих групповых инвайтов.",
});
