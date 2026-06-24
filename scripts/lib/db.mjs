// db.mjs — SQLite persistence layer (better-sqlite3).
// Single source of truth for users, tasks, and team data.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE } from "./cli.mjs";

const DEFAULT_DB = path.join(WORKSPACE, "golden-hour.db");

const _dbs = new Map();

export function getDb(dbPath = DEFAULT_DB) {
  if (!_dbs.has(dbPath)) {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    _dbs.set(dbPath, db);
  }
  return _dbs.get(dbPath);
}

export function dbExists(dbPath = DEFAULT_DB) {
  return fs.existsSync(dbPath);
}

export function defaultDbPath(workspace = WORKSPACE) {
  return path.join(workspace, "golden-hour.db");
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_key     TEXT PRIMARY KEY,
      setup_status TEXT NOT NULL DEFAULT 'new',
      data         TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT,
      updated_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS user_tasks (
      id         TEXT NOT NULL,
      user_key   TEXT NOT NULL,
      title      TEXT,
      status     TEXT NOT NULL DEFAULT 'planned',
      data       TEXT NOT NULL DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (id, user_key)
    );

    CREATE TABLE IF NOT EXISTS teams (
      team_id    TEXT PRIMARY KEY,
      owner_key  TEXT NOT NULL,
      goal       TEXT,
      data       TEXT NOT NULL DEFAULT '{}',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id   TEXT NOT NULL,
      user_key  TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT,
      data      TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (team_id, user_key)
    );

    CREATE TABLE IF NOT EXISTS team_tasks (
      id         TEXT PRIMARY KEY,
      team_id    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'planned',
      assignee   TEXT,
      data       TEXT NOT NULL DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS team_notifications (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id  TEXT NOT NULL,
      type     TEXT,
      by_user  TEXT,
      data     TEXT NOT NULL DEFAULT '{}',
      at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_invites (
      invite_code TEXT PRIMARY KEY,
      team_id     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      data        TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT,
      expires_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_user_tasks_user ON user_tasks(user_key);
    CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_key);
    CREATE INDEX IF NOT EXISTS idx_team_tasks_team ON team_tasks(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_notif_team ON team_notifications(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);
  `);
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function parseData(row) {
  if (!row) return null;
  try {
    return { ...row, data: JSON.parse(row.data || "{}") };
  } catch {
    return { ...row, data: {} };
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function upsertUser(db, user_key, fields) {
  const existing = db
    .prepare("SELECT data, created_at FROM users WHERE user_key = ?")
    .get(user_key);

  const prevData = existing ? JSON.parse(existing.data || "{}") : {};
  const newData = { ...prevData, ...fields };

  // Extract top-level indexed fields from data
  const setup_status = newData.setup_status || "new";
  delete newData.setup_status; // keep in data too for compatibility

  const now = nowUtc();
  db.prepare(`
    INSERT INTO users (user_key, setup_status, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      setup_status = excluded.setup_status,
      data         = excluded.data,
      updated_at   = excluded.updated_at
  `).run(
    user_key,
    setup_status,
    JSON.stringify({ ...newData, setup_status }),
    existing?.created_at || now,
    now
  );

  return getUser(db, user_key);
}

export function getUser(db, user_key) {
  const row = db
    .prepare("SELECT * FROM users WHERE user_key = ?")
    .get(user_key);
  if (!row) return null;
  const parsed = parseData(row);
  return { ...parsed.data, user_key: row.user_key, _updated_at: row.updated_at };
}

export function listActiveUsers(db) {
  const rows = db
    .prepare("SELECT * FROM users WHERE setup_status = 'complete'")
    .all();
  return rows.map((row) => {
    const parsed = parseData(row);
    const profile = { ...parsed.data, user_key: row.user_key };
    return { user_key: row.user_key, profile };
  });
}

export function deleteUser(db, user_key) {
  db.prepare("DELETE FROM users WHERE user_key = ?").run(user_key);
}

// ─── User Tasks ───────────────────────────────────────────────────────────────

export function upsertTask(db, user_key, task) {
  const { id, title, status = "planned", ...rest } = task;
  if (!id) throw new Error("task.id required");
  const now = nowUtc();
  const existing = db
    .prepare("SELECT created_at FROM user_tasks WHERE id = ? AND user_key = ?")
    .get(id, user_key);

  db.prepare(`
    INSERT INTO user_tasks (id, user_key, title, status, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, user_key) DO UPDATE SET
      title      = excluded.title,
      status     = excluded.status,
      data       = excluded.data,
      updated_at = excluded.updated_at
  `).run(
    id,
    user_key,
    title || null,
    status,
    JSON.stringify(rest),
    existing?.created_at || now,
    now
  );
}

export function getUserTasks(db, user_key, status = null) {
  const rows = status
    ? db
        .prepare("SELECT * FROM user_tasks WHERE user_key = ? AND status = ? ORDER BY created_at")
        .all(user_key, status)
    : db
        .prepare("SELECT * FROM user_tasks WHERE user_key = ? ORDER BY created_at")
        .all(user_key);

  return rows.map((row) => {
    const parsed = parseData(row);
    return { id: row.id, title: row.title, status: row.status, ...parsed.data };
  });
}

export function deleteTask(db, user_key, id) {
  db.prepare("DELETE FROM user_tasks WHERE id = ? AND user_key = ?").run(id, user_key);
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export function upsertTeam(db, team) {
  const { team_id, owner_key, goal, created_at, ...rest } = team;
  const now = nowUtc();
  db.prepare(`
    INSERT INTO teams (team_id, owner_key, goal, data, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(team_id) DO UPDATE SET
      owner_key = excluded.owner_key,
      goal      = excluded.goal,
      data      = excluded.data
  `).run(team_id, owner_key, goal || null, JSON.stringify(rest), created_at || now);
}

export function getTeam(db, team_id) {
  const row = db.prepare("SELECT * FROM teams WHERE team_id = ?").get(team_id);
  if (!row) return null;
  const parsed = parseData(row);
  return {
    team_id: row.team_id,
    owner_key: row.owner_key,
    goal: row.goal,
    created_at: row.created_at,
    ...parsed.data,
  };
}

export function listTeamIds(db) {
  return db.prepare("SELECT team_id FROM teams").all().map((r) => r.team_id);
}

// ─── Team Members ─────────────────────────────────────────────────────────────

export function upsertTeamMember(db, team_id, member) {
  const { user_key, role = "member", joined_at, ...rest } = member;
  const now = nowUtc();
  db.prepare(`
    INSERT INTO team_members (team_id, user_key, role, joined_at, data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(team_id, user_key) DO UPDATE SET
      role  = excluded.role,
      data  = excluded.data
  `).run(team_id, user_key, role, joined_at || now, JSON.stringify(rest));
}

export function getTeamMembers(db, team_id) {
  return db
    .prepare("SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at")
    .all(team_id)
    .map((row) => {
      const parsed = parseData(row);
      return {
        user_key: row.user_key,
        role: row.role,
        joined_at: row.joined_at,
        ...parsed.data,
      };
    });
}

export function removeTeamMember(db, team_id, user_key) {
  db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_key = ?").run(
    team_id,
    user_key
  );
}

export function getUserTeams(db, user_key) {
  return db
    .prepare(`
      SELECT tm.team_id, tm.role, tm.joined_at, t.goal
      FROM team_members tm
      JOIN teams t ON t.team_id = tm.team_id
      WHERE tm.user_key = ?
    `)
    .all(user_key);
}

// ─── Team Tasks ───────────────────────────────────────────────────────────────

export function upsertTeamTask(db, team_id, task) {
  const { id, status = "planned", assignee, created_at, ...rest } = task;
  if (!id) throw new Error("task.id required");
  const now = nowUtc();
  const existing = db.prepare("SELECT created_at FROM team_tasks WHERE id = ?").get(id);

  db.prepare(`
    INSERT INTO team_tasks (id, team_id, status, assignee, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status     = excluded.status,
      assignee   = excluded.assignee,
      data       = excluded.data,
      updated_at = excluded.updated_at
  `).run(
    id,
    team_id,
    status,
    assignee || null,
    JSON.stringify(rest),
    existing?.created_at || created_at || now,
    now
  );
}

export function getTeamTasks(db, team_id) {
  return db
    .prepare("SELECT * FROM team_tasks WHERE team_id = ? ORDER BY created_at")
    .all(team_id)
    .map((row) => {
      const parsed = parseData(row);
      return {
        id: row.id,
        team_id: row.team_id,
        status: row.status,
        assignee_user_key: row.assignee,
        ...parsed.data,
      };
    });
}

export function getTeamTaskById(db, team_id, task_id) {
  const row = db
    .prepare("SELECT * FROM team_tasks WHERE id = ? AND team_id = ?")
    .get(task_id, team_id);
  if (!row) return null;
  const parsed = parseData(row);
  return {
    id: row.id,
    team_id: row.team_id,
    status: row.status,
    assignee_user_key: row.assignee,
    ...parsed.data,
  };
}

// ─── Team Invites ─────────────────────────────────────────────────────────────

export function upsertTeamInvite(db, team_id, invite) {
  const { invite_code, status = "pending", created_at, expires_at, ...rest } = invite;
  const now = nowUtc();
  db.prepare(`
    INSERT INTO team_invites (invite_code, team_id, status, data, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(invite_code) DO UPDATE SET
      status     = excluded.status,
      data       = excluded.data,
      expires_at = excluded.expires_at
  `).run(invite_code, team_id, status, JSON.stringify(rest), created_at || now, expires_at || null);
}

export function getTeamInvites(db, team_id) {
  return db
    .prepare("SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at")
    .all(team_id)
    .map((row) => {
      const parsed = parseData(row);
      return {
        invite_code: row.invite_code,
        team_id: row.team_id,
        status: row.status,
        created_at: row.created_at,
        expires_at: row.expires_at,
        ...parsed.data,
      };
    });
}

export function findPendingInviteByCode(db, invite_code) {
  const row = db
    .prepare("SELECT * FROM team_invites WHERE invite_code = ? AND status = 'pending'")
    .get(invite_code);
  if (!row) return null;
  const parsed = parseData(row);
  return {
    invite_code: row.invite_code,
    team_id: row.team_id,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    ...parsed.data,
  };
}

export function findPendingInvitesByTarget(db, telegramId, username) {
  const all = db
    .prepare("SELECT * FROM team_invites WHERE status = 'pending'")
    .all();

  return all
    .map((row) => {
      const parsed = parseData(row);
      return {
        invite_code: row.invite_code,
        team_id: row.team_id,
        status: row.status,
        created_at: row.created_at,
        expires_at: row.expires_at,
        ...parsed.data,
      };
    })
    .filter((inv) => {
      const matchId =
        telegramId &&
        inv.target_telegram_id &&
        Number(inv.target_telegram_id) === Number(telegramId);
      const matchUser =
        username &&
        inv.target_username &&
        inv.target_username.replace(/^@/, "").toLowerCase() ===
          username.replace(/^@/, "").toLowerCase();
      return matchId || matchUser;
    });
}

// ─── Team Notifications ───────────────────────────────────────────────────────

export function appendTeamNotification(db, team_id, entry) {
  const { type, by, ...rest } = entry;
  const now = nowUtc();
  db.prepare(`
    INSERT INTO team_notifications (team_id, type, by_user, data, at)
    VALUES (?, ?, ?, ?, ?)
  `).run(team_id, type || null, by || null, JSON.stringify(rest), now);
}

export function getTeamNotifications(db, team_id, limit = 200) {
  return db
    .prepare("SELECT * FROM team_notifications WHERE team_id = ? ORDER BY id DESC LIMIT ?")
    .all(team_id, limit)
    .reverse()
    .map((row) => {
      const parsed = parseData(row);
      return {
        id: row.id,
        type: row.type,
        by: row.by_user,
        at: row.at,
        ...parsed.data,
      };
    });
}
