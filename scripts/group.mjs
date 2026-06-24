#!/usr/bin/env node
// group.mjs — Telegram-группа: lifecycle, задачи, уведомления.
//
// Usage:
//   node scripts/group.mjs group create --user <key> --chat-id <id> --goal "..." [--subject X]
//   node scripts/group.mjs group invite|accept|leave|show ...
//   node scripts/group.mjs task add|take|submit|approve|reopen|list ...
//   node scripts/group.mjs notifications --user <key> --chat-id <id> [--limit N]

import {
  parseArgs,
  requireUser,
  out,
  die,
} from "./lib/cli.mjs";
import { GroupError } from "./lib/group-core.mjs";
import {
  createGroup,
  inviteToGroup,
  acceptGroupInvite,
  leaveGroup,
  showGroup,
  addGroupTask,
  takeGroupTask,
  submitGroupTask,
  approveGroupTask,
  reopenGroupTask,
  listGroupTasks,
  readGroupNotifications,
} from "./lib/group-core.mjs";

const { cmd, opts, positional } = parseArgs(process.argv);
if (!cmd) die("missing command: group|task|notifications");

function chatId() {
  const id = opts.group || opts["chat-id"] || opts.chatId;
  if (!id) die("missing --chat-id or --group");
  return id;
}

function handleError(fn) {
  try {
    out(fn());
  } catch (e) {
    if (e instanceof GroupError) die(e.message, e.extra || {});
    throw e;
  }
}

if (cmd === "group") {
  const sub = positional[0];
  if (!sub) die("missing: group create|invite|accept|leave|show");
  switch (sub) {
    case "create":
      handleError(() =>
        createGroup({
          userKey: requireUser(opts),
          chatId: chatId(),
          goal: opts.goal,
          subject: opts.subject,
          botUsername: opts["bot-username"],
        })
      );
      break;
    case "invite":
      handleError(() =>
        inviteToGroup({
          userKey: requireUser(opts),
          chatId: chatId(),
          telegramId: opts["telegram-id"],
          username: opts.username,
        })
      );
      break;
    case "accept":
      handleError(() =>
        acceptGroupInvite({
          userKey: requireUser(opts),
          code: opts.code,
          chatIdHint: opts.group || opts["chat-id"] || opts.chatId,
        })
      );
      break;
    case "leave":
      handleError(() =>
        leaveGroup({ userKey: requireUser(opts), chatId: chatId() })
      );
      break;
    case "show":
      handleError(() => showGroup(chatId()));
      break;
    default:
      die("unknown group subcommand", { sub });
  }
} else if (cmd === "task") {
  const sub = positional[0];
  if (!sub) die("missing: task add|take|submit|approve|reopen|list");
  const base = { userKey: requireUser(opts), chatId: chatId() };
  switch (sub) {
    case "add":
      handleError(() =>
        addGroupTask({
          ...base,
          title: opts.title,
          deadline: opts.deadline,
          assigneeUserKey: opts.assignee || opts["assignee-user"],
        })
      );
      break;
    case "take":
      if (!opts.task) die("missing --task");
      handleError(() => takeGroupTask({ ...base, taskId: opts.task }));
      break;
    case "submit":
      if (!opts.task) die("missing --task");
      handleError(() =>
        submitGroupTask({ ...base, taskId: opts.task, note: opts.note })
      );
      break;
    case "approve":
      if (!opts.task) die("missing --task");
      handleError(() => approveGroupTask({ ...base, taskId: opts.task }));
      break;
    case "reopen":
      if (!opts.task) die("missing --task");
      handleError(() =>
        reopenGroupTask({ ...base, taskId: opts.task, reason: opts.reason })
      );
      break;
    case "list":
      handleError(() =>
        listGroupTasks({ ...base, status: opts.status || null })
      );
      break;
    default:
      die("unknown task subcommand", { sub });
  }
} else if (cmd === "notifications") {
  handleError(() =>
    readGroupNotifications({
      userKey: requireUser(opts),
      chatId: chatId(),
      limit: opts.limit ? Number(opts.limit) : 20,
    })
  );
} else {
  die("unknown command", { cmd });
}
