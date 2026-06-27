// team-tasks.mjs — team orchestration: membership, invites, shared tasks.
// All timestamps UTC ISO-8601 (+00:00). Storage: data/teams/<id>/*.json (default).
// Optional SQLite when GH_USE_DB=1 and golden-hour.db exists.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WORKSPACE, readJson, writeJson } from "./cli.mjs";
import {
  isDbEnabled,
  getDb,
  dbExists,
  defaultDbPath,
  upsertTeam,
  getTeam,
  listTeamIds,
  upsertTeamMember,
  getTeamMembers,
  removeTeamMember,
  getUserTeams,
  upsertTeamTask,
  getTeamTasks,
  getTeamTaskById,
  upsertTeamInvite,
  getTeamInvites,
  findPendingInviteByCode,
  findPendingInvitesByTarget,
  appendTeamNotification,
  getTeamNotifications,
} from "./db.mjs";

const INVITE_TTL_DAYS = 5;
const TASK_STATUSES = new Set([
  "planned",
  "in_progress",
  "awaiting_review",
  "done",
  "blocked",
]);

export function teamsRoot(workspace = WORKSPACE) {
  return path.join(workspace, "data", "teams");
}

export function teamDir(teamId, workspace = WORKSPACE) {
  if (!teamId || !/^team-[a-z0-9-]+$/.test(teamId)) {
    throw new TeamError("invalid team_id");
  }
  return path.join(teamsRoot(workspace), teamId);
}

export function userTeamsPath(userKey, workspace = WORKSPACE) {
  return path.join(workspace, "users", userKey, "teams.json");
}

function _db(workspace) {
  if (!isDbEnabled()) return null;
  const dbPath = defaultDbPath(workspace);
  if (dbExists(dbPath)) return getDb(dbPath);
  return null;
}

export class TeamError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "TeamError";
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

export function newTeamId() {
  return `team-${crypto.randomBytes(4).toString("hex")}`;
}

export function newInviteCode() {
  return crypto.randomBytes(4).toString("hex");
}

export function newTaskId(nextNum) {
  return `task-${String(nextNum).padStart(3, "0")}`;
}

// ─── File-based helpers (used only when DB is unavailable) ───────────────────

function readTeamFile(teamId, name, fallback, workspace) {
  return readJson(path.join(teamDir(teamId, workspace), name), fallback);
}

function writeTeamFile(teamId, name, obj, workspace) {
  writeJson(path.join(teamDir(teamId, workspace), name), obj);
}

// ─── Unified load/save — DB-first, file fallback ─────────────────────────────

export function loadMeta(teamId, workspace = WORKSPACE) {
  const db = _db(workspace);
  if (db) {
    const team = getTeam(db, teamId);
    if (!team) throw new TeamError("team not found", { team_id: teamId });
    return {
      team_id: team.team_id,
      goal: team.goal,
      owner_user_key: team.owner_key,
      created_at: team.created_at,
    };
  }
  const meta = readTeamFile(teamId, "meta.json", null, workspace);
  if (!meta?.team_id) throw new TeamError("team not found", { team_id: teamId });
  return meta;
}

export function loadMembers(teamId, workspace = WORKSPACE) {
  const db = _db(workspace);
  if (db) {
    const members = getTeamMembers(db, teamId).map((m) => ({
      user_key: m.user_key,
      telegram_id: m.telegram_id || null,
      username: m.username || null,
      role: m.role,
      joined_at: m.joined_at,
    }));
    return { members };
  }
  return readTeamFile(teamId, "members.json", { members: [] }, workspace);
}

export function loadInvites(teamId, workspace = WORKSPACE) {
  const db = _db(workspace);
  if (db) {
    return { invites: getTeamInvites(db, teamId) };
  }
  return readTeamFile(teamId, "invites.json", { invites: [] }, workspace);
}

export function loadTasks(teamId, workspace = WORKSPACE) {
  const db = _db(workspace);
  if (db) {
    const tasks = getTeamTasks(db, teamId).map((t) => {
      const { team_id, ...rest } = t;
      return rest;
    });
    const maxNum = tasks.reduce((m, t) => {
      const n = parseInt(t.id.replace("task-", ""), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return { tasks, next_id: maxNum + 1 };
  }
  return readTeamFile(teamId, "tasks.json", { tasks: [], next_id: 1 }, workspace);
}

export function loadUserTeams(userKey, workspace = WORKSPACE) {
  const db = _db(workspace);
  if (db) {
    const teams = getUserTeams(db, userKey).map((t) => ({
      team_id: t.team_id,
      role: t.role,
      joined_at: t.joined_at,
    }));
    return { teams };
  }
  return readJson(userTeamsPath(userKey, workspace), { teams: [] });
}

export function saveUserTeams(userKey, data, workspace = WORKSPACE) {
  // In DB mode, user-team index is derived from team_members table — no separate file needed.
  const db = _db(workspace);
  if (db) return; // DB is authoritative
  writeJson(userTeamsPath(userKey, workspace), data);
}

function findMember(membersDoc, userKey) {
  return membersDoc.members.find((m) => m.user_key === userKey) || null;
}

export function assertMember(teamId, userKey, workspace = WORKSPACE) {
  const members = loadMembers(teamId, workspace);
  const m = findMember(members, userKey);
  if (!m) throw new TeamError("not a team member", { team_id: teamId, user_key: userKey });
  return m;
}

export function assertOwner(teamId, userKey, workspace = WORKSPACE) {
  const m = assertMember(teamId, userKey, workspace);
  if (m.role !== "owner") throw new TeamError("owner only", { team_id: teamId });
  return m;
}

function appendNotification(teamId, event, workspace) {
  const db = _db(workspace);
  if (db) {
    appendTeamNotification(db, teamId, event);
    return;
  }
  const line = JSON.stringify({ at: nowUtc(), ...event }) + "\n";
  const p = path.join(teamDir(teamId, workspace), "notifications.log");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, line, "utf8");
}

function syncUserTeamIndex(userKey, teamId, role, joinedAt, workspace) {
  const db = _db(workspace);
  if (db) {
    // DB team_members table is the authoritative index — no separate file
    return;
  }
  const idx = loadUserTeams(userKey, workspace);
  const existing = idx.teams.find((t) => t.team_id === teamId);
  if (existing) {
    existing.role = role;
    existing.joined_at = joinedAt;
  } else {
    idx.teams.push({ team_id: teamId, role, joined_at: joinedAt });
  }
  saveUserTeams(userKey, idx, workspace);
}

function removeUserTeamIndex(userKey, teamId, workspace) {
  const db = _db(workspace);
  if (db) return; // DB is authoritative
  const idx = loadUserTeams(userKey, workspace);
  idx.teams = idx.teams.filter((t) => t.team_id !== teamId);
  saveUserTeams(userKey, idx, workspace);
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
  return {
    ...task,
    display_status: computeDisplayStatus(task, ref),
  };
}

export function listMemberUserKeys(teamId, workspace = WORKSPACE) {
  return loadMembers(teamId, workspace).members.map((m) => m.user_key);
}

export function buildNotifications(teamId, type, payload, workspace = WORKSPACE) {
  const meta = loadMeta(teamId, workspace);
  const members = loadMembers(teamId, workspace);
  const recipients = members.members
    .filter((m) => m.user_key !== payload.exclude_user_key)
    .map((m) => ({
      user_key: m.user_key,
      telegram_id: m.telegram_id,
      username: m.username || null,
    }));
  return {
    team_id: teamId,
    goal: meta.goal,
    type,
    payload,
    recipients,
    message: payload.message || null,
  };
}

export function createTeam({
  userKey,
  telegramId,
  username,
  goal,
  workspace = WORKSPACE,
}) {
  if (!goal?.trim()) throw new TeamError("missing --goal");
  const teamId = newTeamId();
  const at = nowUtc();

  const db = _db(workspace);
  if (db) {
    upsertTeam(db, {
      team_id: teamId,
      owner_key: userKey,
      goal: goal.trim(),
      created_at: at,
      owner_telegram_id: telegramId ? Number(telegramId) : null,
    });
    upsertTeamMember(db, teamId, {
      user_key: userKey,
      telegram_id: telegramId ? Number(telegramId) : null,
      username: username || null,
      role: "owner",
      joined_at: at,
    });
    appendTeamNotification(db, teamId, { type: "team_created", by: userKey });
  } else {
    const dir = teamDir(teamId, workspace);
    fs.mkdirSync(dir, { recursive: true });
    writeTeamFile(teamId, "meta.json", {
      team_id: teamId,
      goal: goal.trim(),
      owner_user_key: userKey,
      owner_telegram_id: telegramId ? Number(telegramId) : null,
      created_at: at,
    }, workspace);
    writeTeamFile(teamId, "members.json", {
      members: [{
        user_key: userKey,
        telegram_id: telegramId ? Number(telegramId) : null,
        username: username || null,
        role: "owner",
        joined_at: at,
      }],
    }, workspace);
    writeTeamFile(teamId, "invites.json", { invites: [] }, workspace);
    writeTeamFile(teamId, "tasks.json", { tasks: [], next_id: 1 }, workspace);
    fs.writeFileSync(path.join(teamDir(teamId, workspace), "notifications.log"), "", "utf8");
    syncUserTeamIndex(userKey, teamId, "owner", at, workspace);
    appendNotification(teamId, { type: "team_created", by: userKey }, workspace);
  }

  return {
    team_id: teamId,
    goal: goal.trim(),
    role: "owner",
    created_at: at,
    notifications: buildNotifications(
      teamId,
      "team_created",
      {
        message: `Создана команда «${goal.trim()}». Owner: ${username || userKey}.`,
        exclude_user_key: userKey,
      },
      workspace
    ),
  };
}

export function inviteMember({
  userKey,
  teamId,
  targetTelegramId,
  targetUsername,
  workspace = WORKSPACE,
}) {
  assertOwner(teamId, userKey, workspace);
  const at = nowUtc();
  const expiresAt = addDaysUtc(at, INVITE_TTL_DAYS);
  const code = newInviteCode();
  const invite = {
    invite_code: code,
    created_by: userKey,
    target_telegram_id: targetTelegramId ? Number(targetTelegramId) : null,
    target_username: targetUsername || null,
    created_at: at,
    expires_at: expiresAt,
    status: "pending",
  };

  const db = _db(workspace);
  if (db) {
    upsertTeamInvite(db, teamId, invite);
    appendTeamNotification(db, teamId, {
      type: "invite_created",
      by: userKey,
      invite_code: code,
      target_telegram_id: targetTelegramId || null,
    });
  } else {
    const invites = loadInvites(teamId, workspace);
    invites.invites.push(invite);
    writeTeamFile(teamId, "invites.json", invites, workspace);
    appendNotification(teamId, {
      type: "invite_created",
      by: userKey,
      invite_code: code,
      target_telegram_id: targetTelegramId || null,
    }, workspace);
  }

  return {
    team_id: teamId,
    invite_code: code,
    expires_at: expiresAt,
    target_telegram_id: targetTelegramId ? Number(targetTelegramId) : null,
    target_username: targetUsername || null,
    summary: `Инвайт ${code} действует до ${expiresAt} UTC.`,
  };
}

function acceptInviteInternal({
  userKey,
  telegramId,
  username,
  invite,
  teamId,
  workspace,
}) {
  const members = loadMembers(teamId, workspace);
  if (findMember(members, userKey)) {
    invite.status = "accepted";
    const db = _db(workspace);
    if (db) upsertTeamInvite(db, teamId, { ...invite, status: "accepted" });
    else {
      const inv = loadInvites(teamId, workspace);
      writeTeamFile(teamId, "invites.json", inv, workspace);
    }
    return { team_id: teamId, already_member: true };
  }

  const at = nowUtc();
  invite.status = "accepted";
  invite.accepted_at = at;
  invite.accepted_by = userKey;

  const db = _db(workspace);
  if (db) {
    upsertTeamMember(db, teamId, {
      user_key: userKey,
      telegram_id: telegramId ? Number(telegramId) : null,
      username: username || null,
      role: "member",
      joined_at: at,
    });
    upsertTeamInvite(db, teamId, invite);
    appendTeamNotification(db, teamId, {
      type: "member_joined",
      user_key: userKey,
      telegram_id: telegramId || null,
    });
  } else {
    members.members.push({
      user_key: userKey,
      telegram_id: telegramId ? Number(telegramId) : null,
      username: username || null,
      role: "member",
      joined_at: at,
    });
    writeTeamFile(teamId, "members.json", members, workspace);
    syncUserTeamIndex(userKey, teamId, "member", at, workspace);
    appendNotification(teamId, {
      type: "member_joined",
      user_key: userKey,
      telegram_id: telegramId || null,
    }, workspace);
  }

  const meta = loadMeta(teamId, workspace);
  return {
    team_id: teamId,
    goal: meta.goal,
    role: "member",
    joined_at: at,
    notifications: buildNotifications(
      teamId,
      "member_joined",
      {
        message: `${username || userKey} вступил(а) в команду «${meta.goal}».`,
        exclude_user_key: userKey,
      },
      workspace
    ),
  };
}

export function acceptInvite({
  userKey,
  inviteCode,
  telegramId,
  username,
  workspace = WORKSPACE,
}) {
  if (!inviteCode) throw new TeamError("missing --code");

  const db = _db(workspace);
  if (db) {
    const invite = findPendingInviteByCode(db, inviteCode);
    if (!invite) throw new TeamError("invite not found", { invite_code: inviteCode });
    if (isExpiredUtc(invite.expires_at)) {
      upsertTeamInvite(db, invite.team_id, { ...invite, status: "expired" });
      throw new TeamError("invite expired", { invite_code: inviteCode });
    }
    return acceptInviteInternal({
      userKey, telegramId, username, invite, teamId: invite.team_id, workspace,
    });
  }

  const root = teamsRoot(workspace);
  if (!fs.existsSync(root)) throw new TeamError("invite not found");
  for (const entry of fs.readdirSync(root)) {
    const teamId = entry;
    if (!teamId.startsWith("team-")) continue;
    const invites = loadInvites(teamId, workspace);
    const invite = invites.invites.find(
      (i) => i.invite_code === inviteCode && i.status === "pending"
    );
    if (!invite) continue;
    if (isExpiredUtc(invite.expires_at)) {
      invite.status = "expired";
      writeTeamFile(teamId, "invites.json", invites, workspace);
      throw new TeamError("invite expired", { invite_code: inviteCode });
    }
    const result = acceptInviteInternal({ userKey, telegramId, username, invite, teamId, workspace });
    writeTeamFile(teamId, "invites.json", invites, workspace);
    return result;
  }
  throw new TeamError("invite not found", { invite_code: inviteCode });
}

export function resolvePendingInvites({
  userKey,
  telegramId,
  username,
  workspace = WORKSPACE,
}) {
  const accepted = [];
  const db = _db(workspace);

  if (db) {
    const pending = findPendingInvitesByTarget(db, telegramId, username);
    for (const invite of pending) {
      if (isExpiredUtc(invite.expires_at)) {
        upsertTeamInvite(db, invite.team_id, { ...invite, status: "expired" });
        continue;
      }
      const result = acceptInviteInternal({
        userKey, telegramId, username, invite, teamId: invite.team_id, workspace,
      });
      accepted.push(result);
    }
    return { accepted, count: accepted.length };
  }

  const root = teamsRoot(workspace);
  if (!fs.existsSync(root)) return { accepted };
  for (const entry of fs.readdirSync(root)) {
    const teamId = entry;
    if (!teamId.startsWith("team-")) continue;
    const invites = loadInvites(teamId, workspace);
    let changed = false;
    for (const invite of invites.invites) {
      if (invite.status !== "pending") continue;
      if (isExpiredUtc(invite.expires_at)) { invite.status = "expired"; changed = true; continue; }
      const matchId = telegramId && invite.target_telegram_id &&
        Number(invite.target_telegram_id) === Number(telegramId);
      const matchUser = username && invite.target_username &&
        invite.target_username.replace(/^@/, "").toLowerCase() ===
          username.replace(/^@/, "").toLowerCase();
      if (!matchId && !matchUser) continue;
      const result = acceptInviteInternal({ userKey, telegramId, username, invite, teamId, workspace });
      changed = true;
      accepted.push(result);
    }
    if (changed) writeTeamFile(teamId, "invites.json", invites, workspace);
  }
  return { accepted, count: accepted.length };
}

export function leaveTeam({ userKey, teamId, workspace = WORKSPACE }) {
  const member = assertMember(teamId, userKey, workspace);
  const meta = loadMeta(teamId, workspace);
  if (member.role === "owner") {
    throw new TeamError("owner cannot leave; transfer ownership first", { team_id: teamId });
  }

  const tasksDoc = loadTasks(teamId, workspace);
  const autoSubmitted = [];
  const db = _db(workspace);
  for (const task of tasksDoc.tasks) {
    if (task.assignee_user_key === userKey && task.status === "in_progress") {
      task.status = "awaiting_review";
      task.submit_at = nowUtc();
      task.submit_note = "auto-submit on member leave";
      autoSubmitted.push(task.id);
      if (db) upsertTeamTask(db, teamId, task);
    }
  }
  if (!db && autoSubmitted.length) writeTeamFile(teamId, "tasks.json", tasksDoc, workspace);

  if (db) {
    removeTeamMember(db, teamId, userKey);
    appendTeamNotification(db, teamId, { type: "member_left", by: userKey, user_key: userKey });
  } else {
    const members = loadMembers(teamId, workspace);
    members.members = members.members.filter((m) => m.user_key !== userKey);
    writeTeamFile(teamId, "members.json", members, workspace);
    removeUserTeamIndex(userKey, teamId, workspace);
    appendNotification(teamId, { type: "member_left", user_key: userKey }, workspace);
  }

  return {
    team_id: teamId,
    left: true,
    auto_submitted_tasks: autoSubmitted,
    notifications: buildNotifications(
      teamId, "member_left",
      {
        message: `${member.username || userKey} вышел(а) из команды «${meta.goal}».`,
        exclude_user_key: userKey,
        auto_submitted_tasks: autoSubmitted,
      },
      workspace
    ),
  };
}

export function listTeams(userKey, workspace = WORKSPACE) {
  const idx = loadUserTeams(userKey, workspace);
  const teams = [];
  for (const t of idx.teams) {
    try {
      const meta = loadMeta(t.team_id, workspace);
      const members = loadMembers(t.team_id, workspace);
      const tasksDoc = loadTasks(t.team_id, workspace);
      teams.push({
        team_id: t.team_id,
        goal: meta.goal,
        role: t.role,
        joined_at: t.joined_at,
        member_count: members.members.length,
        open_tasks: tasksDoc.tasks.filter((x) => x.status !== "done").length,
      });
    } catch {
      // stale index entry
    }
  }
  return { teams };
}

export function showTeam({ userKey, teamId, workspace = WORKSPACE }) {
  assertMember(teamId, userKey, workspace);
  const meta = loadMeta(teamId, workspace);
  const members = loadMembers(teamId, workspace);
  const tasksDoc = loadTasks(teamId, workspace);
  const ref = nowUtc();
  return {
    team_id: teamId,
    goal: meta.goal,
    owner_user_key: meta.owner_user_key,
    created_at: meta.created_at,
    members: members.members,
    tasks: tasksDoc.tasks.map((t) => enrichTask(t, ref)),
  };
}

export function addTask({
  userKey,
  teamId,
  title,
  description,
  deadline,
  workspace = WORKSPACE,
}) {
  assertMember(teamId, userKey, workspace);
  if (!title?.trim()) throw new TeamError("missing --title");
  const tasksDoc = loadTasks(teamId, workspace);
  const id = newTaskId(tasksDoc.next_id);
  const at = nowUtc();
  const task = {
    id,
    title: title.trim(),
    description: description?.trim() || "",
    status: "planned",
    assignee_user_key: null,
    assignee_telegram_id: null,
    created_by: userKey,
    created_at: at,
    deadline: deadline || null,
    submit_at: null,
    submit_note: null,
    approved_at: null,
    blocked_reason: null,
  };

  const db = _db(workspace);
  if (db) {
    upsertTeamTask(db, teamId, task);
    appendTeamNotification(db, teamId, { type: "task_added", task_id: id, by: userKey });
  } else {
    tasksDoc.tasks.push(task);
    tasksDoc.next_id += 1;
    writeTeamFile(teamId, "tasks.json", tasksDoc, workspace);
    appendNotification(teamId, { type: "task_added", task_id: id, by: userKey }, workspace);
  }

  const meta = loadMeta(teamId, workspace);
  return {
    task: enrichTask(task),
    notifications: buildNotifications(teamId, "task_added", {
      message: `Новая таска в «${meta.goal}»: «${title.trim()}».`,
      task_id: id,
      exclude_user_key: userKey,
    }, workspace),
  };
}

function getTask(tasksDoc, taskId) {
  const task = tasksDoc.tasks.find((t) => t.id === taskId);
  if (!task) throw new TeamError("task not found", { task_id: taskId });
  return task;
}

function getTaskOrDb(db, teamId, taskId, tasksDoc) {
  if (db) {
    const t = getTeamTaskById(db, teamId, taskId);
    if (!t) throw new TeamError("task not found", { task_id: taskId });
    return t;
  }
  return getTask(tasksDoc, taskId);
}

function saveTask(db, teamId, task, tasksDoc, workspace) {
  if (db) {
    upsertTeamTask(db, teamId, task);
  } else {
    writeTeamFile(teamId, "tasks.json", tasksDoc, workspace);
  }
}

export function takeTask({ userKey, teamId, taskId, telegramId, workspace = WORKSPACE }) {
  assertMember(teamId, userKey, workspace);
  const db = _db(workspace);
  const tasksDoc = db ? null : loadTasks(teamId, workspace);
  const task = getTaskOrDb(db, teamId, taskId, tasksDoc);
  if (task.status !== "planned" && task.status !== "blocked") {
    throw new TeamError("task not available to take", { task_id: taskId, status: task.status });
  }
  if (task.assignee_user_key && task.assignee_user_key !== userKey) {
    throw new TeamError("task already assigned", { task_id: taskId });
  }
  task.status = "in_progress";
  task.assignee_user_key = userKey;
  task.assignee_telegram_id = telegramId ? Number(telegramId) : null;
  task.blocked_reason = null;
  saveTask(db, teamId, task, tasksDoc, workspace);
  if (db) appendTeamNotification(db, teamId, { type: "task_taken", task_id: taskId, by: userKey });
  else appendNotification(teamId, { type: "task_taken", task_id: taskId, by: userKey }, workspace);

  const meta = loadMeta(teamId, workspace);
  return {
    task: enrichTask(task),
    notifications: buildNotifications(teamId, "task_taken", {
      message: `«${task.title}» взял(а) ${userKey} (команда «${meta.goal}»).`,
      task_id: taskId,
      exclude_user_key: userKey,
    }, workspace),
  };
}

export function submitTask({ userKey, teamId, taskId, note, workspace = WORKSPACE }) {
  assertMember(teamId, userKey, workspace);
  const db = _db(workspace);
  const tasksDoc = db ? null : loadTasks(teamId, workspace);
  const task = getTaskOrDb(db, teamId, taskId, tasksDoc);
  if (task.assignee_user_key !== userKey) {
    throw new TeamError("only assignee can submit", { task_id: taskId });
  }
  if (task.status !== "in_progress" && task.status !== "blocked") {
    throw new TeamError("task not in progress", { task_id: taskId, status: task.status });
  }
  task.status = "awaiting_review";
  task.submit_at = nowUtc();
  task.submit_note = note?.trim() || null;
  saveTask(db, teamId, task, tasksDoc, workspace);
  if (db) appendTeamNotification(db, teamId, { type: "task_submitted", task_id: taskId, by: userKey });
  else appendNotification(teamId, { type: "task_submitted", task_id: taskId, by: userKey }, workspace);

  const meta = loadMeta(teamId, workspace);
  return {
    task: enrichTask(task),
    notifications: buildNotifications(teamId, "task_submitted", {
      message: `«${task.title}» сдана на проверку (команда «${meta.goal}»). Owner: подтвердите.`,
      task_id: taskId,
      exclude_user_key: userKey,
    }, workspace),
  };
}

export function approveTask({ userKey, teamId, taskId, workspace = WORKSPACE }) {
  assertOwner(teamId, userKey, workspace);
  const db = _db(workspace);
  const tasksDoc = db ? null : loadTasks(teamId, workspace);
  const task = getTaskOrDb(db, teamId, taskId, tasksDoc);
  if (task.status !== "awaiting_review") {
    throw new TeamError("task not awaiting review", { task_id: taskId, status: task.status });
  }
  task.status = "done";
  task.approved_at = nowUtc();
  saveTask(db, teamId, task, tasksDoc, workspace);
  if (db) appendTeamNotification(db, teamId, { type: "task_approved", task_id: taskId, by: userKey });
  else appendNotification(teamId, { type: "task_approved", task_id: taskId, by: userKey }, workspace);

  const meta = loadMeta(teamId, workspace);
  return {
    task: enrichTask(task),
    notifications: buildNotifications(teamId, "task_approved", {
      message: `«${task.title}» принята ✅ (команда «${meta.goal}»).`,
      task_id: taskId,
    }, workspace),
  };
}

export function reopenTask({ userKey, teamId, taskId, reason, workspace = WORKSPACE }) {
  assertOwner(teamId, userKey, workspace);
  const db = _db(workspace);
  const tasksDoc = db ? null : loadTasks(teamId, workspace);
  const task = getTaskOrDb(db, teamId, taskId, tasksDoc);
  if (task.status !== "awaiting_review") {
    throw new TeamError("only awaiting_review can be reopened", { task_id: taskId, status: task.status });
  }
  task.status = "in_progress";
  task.submit_at = null;
  task.submit_note = reason?.trim() || "reopened by owner";
  task.approved_at = null;
  saveTask(db, teamId, task, tasksDoc, workspace);
  if (db) appendTeamNotification(db, teamId, { type: "task_reopened", task_id: taskId, by: userKey });
  else appendNotification(teamId, { type: "task_reopened", task_id: taskId, by: userKey }, workspace);

  return { task: enrichTask(task) };
}

export function blockTask({ userKey, teamId, taskId, reason, workspace = WORKSPACE }) {
  assertMember(teamId, userKey, workspace);
  const db = _db(workspace);
  const tasksDoc = db ? null : loadTasks(teamId, workspace);
  const task = getTaskOrDb(db, teamId, taskId, tasksDoc);
  if (task.status === "done") throw new TeamError("cannot block done task", { task_id: taskId });
  task.status = "blocked";
  task.blocked_reason = reason?.trim() || "blocked";
  saveTask(db, teamId, task, tasksDoc, workspace);
  return { task: enrichTask(task) };
}

export function unblockTask({ userKey, teamId, taskId, workspace = WORKSPACE }) {
  assertMember(teamId, userKey, workspace);
  const db = _db(workspace);
  const tasksDoc = db ? null : loadTasks(teamId, workspace);
  const task = getTaskOrDb(db, teamId, taskId, tasksDoc);
  if (task.status !== "blocked") throw new TeamError("task not blocked", { task_id: taskId });
  task.status = task.assignee_user_key ? "in_progress" : "planned";
  task.blocked_reason = null;
  saveTask(db, teamId, task, tasksDoc, workspace);
  return { task: enrichTask(task) };
}

export function listTasks({
  userKey,
  teamId,
  statusFilter,
  workspace = WORKSPACE,
}) {
  assertMember(teamId, userKey, workspace);
  const tasksDoc = loadTasks(teamId, workspace);
  const ref = nowUtc();
  let tasks = tasksDoc.tasks.map((t) => enrichTask(t, ref));
  if (statusFilter) {
    tasks = tasks.filter(
      (t) =>
        t.status === statusFilter || t.display_status === statusFilter
    );
  }
  return { team_id: teamId, tasks };
}

export function readNotifications({ userKey, teamId, workspace = WORKSPACE }) {
  assertOwner(teamId, userKey, workspace);
  const db = _db(workspace);
  if (db) {
    return { team_id: teamId, notifications: getTeamNotifications(db, teamId) };
  }
  const p = path.join(teamDir(teamId, workspace), "notifications.log");
  const text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const lines = text.trim().split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { raw: l }; }
  });
  return { team_id: teamId, notifications: lines };
}

export function expireStaleInvites(workspace = WORKSPACE) {
  const db = _db(workspace);
  if (db) {
    const now = nowUtc();
    const stale = db.prepare(
      "SELECT invite_code, team_id, data, created_at, expires_at FROM team_invites WHERE status = 'pending'"
    ).all();
    let expired = 0;
    for (const row of stale) {
      if (row.expires_at && row.expires_at <= now) {
        const data = JSON.parse(row.data || "{}");
        upsertTeamInvite(db, row.team_id, {
          ...data, invite_code: row.invite_code, status: "expired",
          created_at: row.created_at, expires_at: row.expires_at,
        });
        expired++;
      }
    }
    return { expired };
  }
  const root = teamsRoot(workspace);
  let expired = 0;
  if (!fs.existsSync(root)) return { expired };
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith("team-")) continue;
    const invites = loadInvites(entry, workspace);
    let changed = false;
    for (const invite of invites.invites) {
      if (invite.status === "pending" && isExpiredUtc(invite.expires_at)) {
        invite.status = "expired";
        expired++;
        changed = true;
      }
    }
    if (changed) writeTeamFile(entry, "invites.json", invites, workspace);
  }
  return { expired };
}
