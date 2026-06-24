// group-core.mjs — Telegram group storage (group_id = chat_id) + shared tasks lifecycle.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WORKSPACE, readJson, writeJson, readText, writeText } from "./cli.mjs";

const INVITE_TTL_DAYS = 5;

export class GroupError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "GroupError";
    this.extra = extra;
  }
}

export function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function addDaysUtc(iso, days) {
  const d = new Date(iso.replace(/\+00:00$/, "Z"));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function isExpiredUtc(iso, ref = nowUtc()) {
  if (!iso) return false;
  return iso <= ref;
}

export function groupsRoot(workspace = WORKSPACE) {
  return path.join(workspace, "data", "groups");
}

export function groupDir(chatId, workspace = WORKSPACE) {
  const id = String(chatId);
  if (!/^-?\d+$/.test(id)) throw new GroupError("invalid chat_id");
  return path.join(groupsRoot(workspace), id);
}

function groupFile(chatId, name, workspace) {
  return path.join(groupDir(chatId, workspace), name);
}

export function userGroupsPath(userKey, workspace = WORKSPACE) {
  return path.join(workspace, "users", userKey, "groups.json");
}

export function newInviteCode() {
  return crypto.randomBytes(4).toString("hex");
}

export function newTaskId(nextNum) {
  return `task-${String(nextNum).padStart(3, "0")}`;
}

function readGroupFile(chatId, name, fallback, workspace) {
  return readJson(groupFile(chatId, name, workspace), fallback);
}

function writeGroupFile(chatId, name, obj, workspace) {
  writeJson(groupFile(chatId, name, workspace), obj);
}

export function loadMeta(chatId, workspace = WORKSPACE) {
  return readGroupFile(chatId, "meta.json", null, workspace);
}

export function loadMembers(chatId, workspace = WORKSPACE) {
  return readGroupFile(chatId, "members.json", [], workspace);
}

export function saveMembers(chatId, members, workspace = WORKSPACE) {
  writeGroupFile(chatId, "members.json", members, workspace);
}

export function loadInvites(chatId, workspace = WORKSPACE) {
  return readGroupFile(chatId, "invites.json", [], workspace);
}

export function saveInvites(chatId, invites, workspace = WORKSPACE) {
  writeGroupFile(chatId, "invites.json", invites, workspace);
}

export function loadTasks(chatId, workspace = WORKSPACE) {
  return readGroupFile(chatId, "tasks.json", { tasks: [], next_id: 1 }, workspace);
}

export function saveTasks(chatId, tasksDoc, workspace = WORKSPACE) {
  writeGroupFile(chatId, "tasks.json", tasksDoc, workspace);
}

function findMember(members, userKey) {
  return members.find((m) => m.user_key === userKey) || null;
}

export function assertMember(chatId, userKey, workspace = WORKSPACE) {
  const meta = loadMeta(chatId, workspace);
  if (!meta) throw new GroupError("group not found", { chat_id: chatId });
  const members = loadMembers(chatId, workspace);
  const m = findMember(members, userKey);
  if (!m) throw new GroupError("not a group member", { chat_id: chatId, user_key: userKey });
  return m;
}

export function assertOwner(chatId, userKey, workspace = WORKSPACE) {
  const m = assertMember(chatId, userKey, workspace);
  if (m.role !== "owner") throw new GroupError("owner only", { chat_id: chatId });
  return m;
}

function addUserToGroupIndex(userKey, chatId, role, workspace) {
  const gp = userGroupsPath(userKey, workspace);
  const existing = readJson(gp, []);
  if (!existing.find((g) => g.chat_id === String(chatId))) {
    existing.push({ chat_id: String(chatId), role, joined_at: nowUtc() });
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    writeJson(gp, existing);
  }
}

function removeUserFromGroupIndex(userKey, chatId, workspace) {
  const gp = userGroupsPath(userKey, workspace);
  if (!fs.existsSync(gp)) return;
  const existing = readJson(gp, []);
  const filtered = existing.filter((g) => g.chat_id !== String(chatId));
  if (filtered.length !== existing.length) writeJson(gp, filtered);
}

function appendNotification(chatId, event, workspace) {
  const p = groupFile(chatId, "notifications.log", workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify({ at: nowUtc(), ...event }) + "\n", "utf8");
}

function seedGroupProfile(chatId, { goal, subject, ownerUserKey }, workspace) {
  const dir = groupDir(chatId, workspace);
  fs.mkdirSync(path.join(dir, "plans"), { recursive: true });
  const topic = subject || goal;
  const profile = `name: "${goal.replace(/"/g, '\\"')}"
purpose: topic
study_topic: "${topic.replace(/"/g, '\\"')}"
setup_status: complete
owner: ${ownerUserKey}
deadline: null
hours_per_week: 10
daily_load: normal
`;
  writeText(path.join(dir, "profile.md"), profile);
  if (!readText(path.join(dir, "progress.md"))) {
    writeText(
      path.join(dir, "progress.md"),
      `# Прогресс — ${goal}\n\n**Streak:** 0 дней\n\n## Дневник\n`
    );
  }
}

export function computeDisplayStatus(task, ref = nowUtc()) {
  if (
    task.deadline &&
    isExpiredUtc(task.deadline, ref) &&
    task.status !== "done" &&
    task.status !== "awaiting_review"
  ) {
    return "overdue";
  }
  return task.status;
}

export function enrichTask(task, ref = nowUtc()) {
  return { ...task, display_status: computeDisplayStatus(task, ref) };
}

export function createGroup({
  userKey,
  chatId,
  goal,
  subject,
  botUsername,
  workspace = WORKSPACE,
}) {
  if (!goal?.trim()) throw new GroupError("missing --goal");
  const id = String(chatId);
  const dir = groupDir(id, workspace);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadMeta(id, workspace);
  if (existing) return { ok: true, action: "exists", meta: existing, chat_id: id };

  const at = nowUtc();
  const meta = {
    chat_id: id,
    goal: goal.trim(),
    subject: subject || null,
    owner_user_key: userKey,
    bot_username: botUsername || null,
    created_at: at,
    setup_status: "complete",
  };
  writeGroupFile(id, "meta.json", meta, workspace);
  saveMembers(id, [{ user_key: userKey, role: "owner", joined_at: at }], workspace);
  saveInvites(id, [], workspace);
  saveTasks(id, { tasks: [], next_id: 1 }, workspace);
  fs.writeFileSync(groupFile(id, "notifications.log", workspace), "", "utf8");
  seedGroupProfile(id, { goal: goal.trim(), subject, ownerUserKey: userKey }, workspace);
  addUserToGroupIndex(userKey, id, "owner", workspace);
  appendNotification(id, { type: "group_created", by: userKey }, workspace);

  return { ok: true, action: "created", meta, chat_id: id };
}

export function inviteToGroup({
  userKey,
  chatId,
  telegramId,
  username,
  workspace = WORKSPACE,
}) {
  assertOwner(String(chatId), userKey, workspace);
  if (!telegramId && !username) throw new GroupError("missing --telegram-id or --username");
  const id = String(chatId);
  const code = newInviteCode();
  const expires = addDaysUtc(nowUtc(), INVITE_TTL_DAYS);
  const invites = loadInvites(id, workspace);
  invites.push({
    code,
    telegram_id: telegramId ? Number(telegramId) : null,
    username: username || null,
    created_by: userKey,
    created_at: nowUtc(),
    expires_at: expires,
    used: false,
  });
  saveInvites(id, invites, workspace);
  appendNotification(id, { type: "invite_created", code, by: userKey }, workspace);
  return { ok: true, action: "invited", code, expires_at: expires, chat_id: id };
}

export function acceptGroupInvite({
  userKey,
  code,
  chatIdHint,
  workspace = WORKSPACE,
}) {
  if (!code) throw new GroupError("missing --code");
  const root = groupsRoot(workspace);
  if (!fs.existsSync(root)) throw new GroupError("no invites");

  let foundChatId = chatIdHint ? String(chatIdHint) : null;
  let foundInvite = null;

  if (foundChatId) {
    foundInvite = loadInvites(foundChatId, workspace).find(
      (i) => i.code === code && !i.used && !isExpiredUtc(i.expires_at)
    );
  } else {
    for (const cid of fs.readdirSync(root)) {
      const inv = loadInvites(cid, workspace).find(
        (i) => i.code === code && !i.used && !isExpiredUtc(i.expires_at)
      );
      if (inv) {
        foundInvite = inv;
        foundChatId = cid;
        break;
      }
    }
  }
  if (!foundInvite) throw new GroupError("invite not found or expired");

  const invs = loadInvites(foundChatId, workspace);
  invs.forEach((i, idx, arr) => {
    if (i.code === code) arr[idx] = { ...i, used: true, used_by: userKey, used_at: nowUtc() };
  });
  saveInvites(foundChatId, invs, workspace);

  const members = loadMembers(foundChatId, workspace);
  if (!findMember(members, userKey)) {
    members.push({ user_key: userKey, role: "member", joined_at: nowUtc() });
    saveMembers(foundChatId, members, workspace);
  }
  addUserToGroupIndex(userKey, foundChatId, "member", workspace);
  appendNotification(foundChatId, { type: "member_joined", by: userKey }, workspace);

  return { ok: true, action: "accepted", chat_id: foundChatId, role: "member" };
}

export function leaveGroup({ userKey, chatId, workspace = WORKSPACE }) {
  const id = String(chatId);
  const members = loadMembers(id, workspace);
  const me = findMember(members, userKey);
  if (!me) throw new GroupError("not a member", { chat_id: id });
  const remaining = members.filter((m) => m.user_key !== userKey);
  if (me.role === "owner" && remaining.length > 0) {
    remaining[0].role = "owner";
    const meta = loadMeta(id, workspace);
    if (meta) writeGroupFile(id, "meta.json", { ...meta, owner_user_key: remaining[0].user_key }, workspace);
  }
  saveMembers(id, remaining, workspace);
  removeUserFromGroupIndex(userKey, id, workspace);
  appendNotification(id, { type: "member_left", by: userKey }, workspace);
  return { ok: true, action: "left", chat_id: id };
}

export function showGroup(chatId, workspace = WORKSPACE) {
  const id = String(chatId);
  const meta = loadMeta(id, workspace);
  if (!meta) throw new GroupError("group not found", { chat_id: id });
  const members = loadMembers(id, workspace);
  const invites = loadInvites(id, workspace).filter((i) => !i.used && !isExpiredUtc(i.expires_at));
  const dir = groupDir(id, workspace);
  return {
    ok: true,
    meta,
    members,
    active_invites: invites,
    has_profile: fs.existsSync(path.join(dir, "profile.md")),
    has_plan: fs.existsSync(path.join(dir, "plan.md")),
    has_progress: fs.existsSync(path.join(dir, "progress.md")),
  };
}

function getTask(tasksDoc, taskId) {
  const task = tasksDoc.tasks.find((t) => t.id === taskId);
  if (!task) throw new GroupError("task not found", { task_id: taskId });
  return task;
}

export function addGroupTask({
  userKey,
  chatId,
  title,
  deadline,
  assigneeUserKey,
  workspace = WORKSPACE,
}) {
  assertMember(String(chatId), userKey, workspace);
  if (!title?.trim()) throw new GroupError("missing --title");
  const id = String(chatId);
  const tasksDoc = loadTasks(id, workspace);
  const taskId = newTaskId(tasksDoc.next_id);
  const at = nowUtc();
  const task = {
    id: taskId,
    title: title.trim(),
    status: "planned",
    assignee_user_key: assigneeUserKey || null,
    created_by: userKey,
    created_at: at,
    deadline: deadline || null,
    submit_at: null,
    submit_note: null,
    approved_at: null,
  };
  tasksDoc.tasks.push(task);
  tasksDoc.next_id += 1;
  saveTasks(id, tasksDoc, workspace);
  appendNotification(id, { type: "task_added", task_id: taskId, by: userKey }, workspace);
  return { ok: true, action: "task_added", task: enrichTask(task), chat_id: id };
}

export function takeGroupTask({ userKey, chatId, taskId, workspace = WORKSPACE }) {
  assertMember(String(chatId), userKey, workspace);
  const id = String(chatId);
  const tasksDoc = loadTasks(id, workspace);
  const task = getTask(tasksDoc, taskId);
  if (task.status !== "planned" && task.status !== "blocked") {
    throw new GroupError("task not available", { task_id: taskId, status: task.status });
  }
  if (task.assignee_user_key && task.assignee_user_key !== userKey) {
    throw new GroupError("task already assigned", { task_id: taskId });
  }
  task.status = "in_progress";
  task.assignee_user_key = userKey;
  saveTasks(id, tasksDoc, workspace);
  appendNotification(id, { type: "task_taken", task_id: taskId, by: userKey }, workspace);
  return { ok: true, action: "task_taken", task: enrichTask(task), chat_id: id };
}

export function submitGroupTask({ userKey, chatId, taskId, note, workspace = WORKSPACE }) {
  assertMember(String(chatId), userKey, workspace);
  const id = String(chatId);
  const tasksDoc = loadTasks(id, workspace);
  const task = getTask(tasksDoc, taskId);
  if (task.assignee_user_key !== userKey) {
    throw new GroupError("only assignee can submit", { task_id: taskId });
  }
  task.status = "awaiting_review";
  task.submit_at = nowUtc();
  task.submit_note = note || "";
  saveTasks(id, tasksDoc, workspace);
  appendNotification(id, { type: "task_submitted", task_id: taskId, by: userKey }, workspace);
  return { ok: true, action: "task_submitted", task: enrichTask(task), chat_id: id };
}

export function approveGroupTask({ userKey, chatId, taskId, workspace = WORKSPACE }) {
  assertOwner(String(chatId), userKey, workspace);
  const id = String(chatId);
  const tasksDoc = loadTasks(id, workspace);
  const task = getTask(tasksDoc, taskId);
  if (task.status !== "awaiting_review") {
    throw new GroupError("task not awaiting review", { task_id: taskId });
  }
  task.status = "done";
  task.approved_at = nowUtc();
  saveTasks(id, tasksDoc, workspace);
  appendNotification(id, { type: "task_approved", task_id: taskId, by: userKey }, workspace);
  return { ok: true, action: "task_approved", task: enrichTask(task), chat_id: id };
}

export function reopenGroupTask({ userKey, chatId, taskId, reason, workspace = WORKSPACE }) {
  assertOwner(String(chatId), userKey, workspace);
  const id = String(chatId);
  const tasksDoc = loadTasks(id, workspace);
  const task = getTask(tasksDoc, taskId);
  task.status = "planned";
  task.assignee_user_key = null;
  task.submit_at = null;
  task.submit_note = reason || null;
  task.approved_at = null;
  saveTasks(id, tasksDoc, workspace);
  appendNotification(id, { type: "task_reopened", task_id: taskId, by: userKey }, workspace);
  return { ok: true, action: "task_reopened", task: enrichTask(task), chat_id: id };
}

export function listGroupTasks({ userKey, chatId, status, workspace = WORKSPACE }) {
  assertMember(String(chatId), userKey, workspace);
  const id = String(chatId);
  const ref = nowUtc();
  let tasks = loadTasks(id, workspace).tasks.map((t) => enrichTask(t, ref));
  if (status === "overdue") {
    tasks = tasks.filter((t) => t.display_status === "overdue");
  } else if (status) {
    tasks = tasks.filter((t) => t.status === status || t.display_status === status);
  }
  return { ok: true, tasks, count: tasks.length, chat_id: id };
}

export function readGroupNotifications({ userKey, chatId, limit = 20, workspace = WORKSPACE }) {
  assertOwner(String(chatId), userKey, workspace);
  const p = groupFile(String(chatId), "notifications.log", workspace);
  if (!fs.existsSync(p)) return { ok: true, events: [], chat_id: String(chatId) };
  const lines = readText(p, "").trim().split("\n").filter(Boolean);
  const events = lines.slice(-limit).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
  return { ok: true, events, chat_id: String(chatId) };
}

export function resolvePendingGroupInvites({
  userKey,
  chatId,
  telegramId,
  username,
  workspace = WORKSPACE,
}) {
  const now = new Date();
  const resolved = [];

  function tryResolveOne(cid) {
    const invites = loadInvites(cid, workspace);
    let changed = false;
    for (let i = 0; i < invites.length; i++) {
      const inv = invites[i];
      if (inv.used) continue;
      if (new Date(inv.expires_at.replace(/\+00:00$/, "Z")) <= now) continue;
      const idMatch = telegramId && inv.telegram_id === Number(telegramId);
      const nameMatch =
        username &&
        inv.username &&
        inv.username.replace(/^@/, "") === String(username).replace(/^@/, "");
      if (idMatch || nameMatch) {
        invites[i] = { ...inv, used: true, used_by: userKey, used_at: nowUtc() };
        changed = true;
        resolved.push({ chat_id: cid, code: inv.code });
        break;
      }
    }
    if (changed) {
      saveInvites(cid, invites, workspace);
      const members = loadMembers(cid, workspace);
      if (!findMember(members, userKey)) {
        members.push({ user_key: userKey, role: "member", joined_at: nowUtc() });
        saveMembers(cid, members, workspace);
      }
      addUserToGroupIndex(userKey, cid, "member", workspace);
    }
  }

  if (chatId) {
    tryResolveOne(String(chatId));
  } else {
    const root = groupsRoot(workspace);
    if (fs.existsSync(root)) {
      for (const cid of fs.readdirSync(root)) tryResolveOne(cid);
    }
  }

  return { ok: true, resolved, count: resolved.length };
}

export function groupContext(chatId, userKey, workspace = WORKSPACE) {
  const id = String(chatId);
  const meta = loadMeta(id, workspace);
  if (!meta) {
    return {
      chat_id: id,
      registered: false,
      action: "suggest_create",
      message: "Группа не зарегистрирована — /group create <цель>",
    };
  }
  const members = loadMembers(id, workspace);
  const me = userKey ? findMember(members, userKey) : null;
  const dir = groupDir(id, workspace);
  return {
    chat_id: id,
    registered: true,
    meta,
    is_member: Boolean(me),
    role: me?.role || null,
    members_count: members.length,
    tasks_count: loadTasks(id, workspace).tasks.length,
    has_plan: fs.existsSync(path.join(dir, "plan.md")),
    has_today_plan: fs.existsSync(
      path.join(dir, "plans", `${new Date().toISOString().slice(0, 10)}.json`)
    ),
    action: me ? "group_ready" : "suggest_accept_invite",
  };
}
