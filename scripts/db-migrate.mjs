#!/usr/bin/env node
// db-migrate.mjs — migrate file-based storage into SQLite (experimental, opt-in).
// Requires: npm install && GH_USE_DB=1
//
// Default storage is files (users/*/profile.md, data/teams/). This script is for
// a future DB rollout — not needed in normal operation.
//
// Переносит:
//   - users/*/profile.md          → таблица users
//   - data/teams/*/meta.json      → таблица teams
//   - data/teams/*/members.json   → таблица team_members
//   - data/teams/*/tasks.json     → таблица team_tasks
//   - data/teams/*/invites.json   → таблица team_invites
//   - data/teams/*/notifications.log → таблица team_notifications
//
// Usage:
//   node scripts/db-migrate.mjs              # migrate (skip existing records)
//   node scripts/db-migrate.mjs --dry-run    # preview only, no writes
//   node scripts/db-migrate.mjs --force      # overwrite existing DB records
//   node scripts/db-migrate.mjs --status     # show current DB contents

import fs from "node:fs";
import path from "node:path";
import { parseArgs, isDryRun, die, WORKSPACE } from "./lib/cli.mjs";
import {
  isDbEnabled,
  getDb,
  defaultDbPath,
  upsertUser,
  upsertTeam,
  upsertTeamMember,
  upsertTeamTask,
  upsertTeamInvite,
  appendTeamNotification,
} from "./lib/db.mjs";
import { parseProfile } from "./lib/profile.mjs";

const { opts } = parseArgs(process.argv);
const dryRun = isDryRun(opts);
const force   = opts.force === "true" || opts.force === true;
const status  = opts.status === "true" || opts.status === true;

if (!isDbEnabled() && !status) {
  die("sqlite_disabled", {
    hint:
      "SQLite is off. Data stays in users/ and data/teams/. " +
      "To migrate later: npm install && GH_USE_DB=1 && node scripts/db-migrate.mjs",
  });
}

const dbPath = defaultDbPath(WORKSPACE);

// ─── --status: show DB contents ───────────────────────────────────────────────

if (status) {
  if (!isDbEnabled()) {
    console.log("SQLite disabled (GH_USE_DB not set). Data is in users/ and data/teams/.");
    process.exit(0);
  }
  if (!fs.existsSync(dbPath)) {
    console.log("No DB yet at:", dbPath);
    process.exit(0);
  }
  const db = getDb(dbPath);
  if (!db) {
    console.log("SQLite unavailable. Run: npm install && GH_USE_DB=1");
    process.exit(1);
  }

  const users = db.prepare("SELECT user_key, setup_status, updated_at FROM users ORDER BY updated_at DESC").all();
  console.log(`\n── Users (${users.length}) ──────────────────────────────────`);
  for (const u of users) {
    const data = JSON.parse(db.prepare("SELECT data FROM users WHERE user_key=?").get(u.user_key)?.data || "{}");
    console.log(`  ${u.user_key}  [${u.setup_status}]  name=${data.name || "?"}  updated=${u.updated_at?.slice(0,16) || "?"}`);
  }

  const teams = db.prepare("SELECT team_id, goal, owner_key FROM teams").all();
  console.log(`\n── Teams (${teams.length}) ──────────────────────────────────`);
  for (const t of teams) {
    const members = db.prepare("SELECT count(*) as n FROM team_members WHERE team_id=?").get(t.team_id);
    const tasks   = db.prepare("SELECT count(*) as n FROM team_tasks WHERE team_id=?").get(t.team_id);
    console.log(`  ${t.team_id}  goal="${t.goal}"  members=${members.n}  tasks=${tasks.n}`);
  }

  const taskCount = db.prepare("SELECT count(*) as n FROM user_tasks").get();
  console.log(`\n── User tasks: ${taskCount.n}`);
  console.log(`\nDB: ${dbPath}`);
  process.exit(0);
}

// ─── Migration ────────────────────────────────────────────────────────────────

const db = dryRun ? null : getDb(dbPath);

let importedUsers = 0;
let skippedUsers  = 0;
let updatedUsers  = 0;

let importedTeams = 0;
let skippedTeams  = 0;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function alreadyInDb(table, keyCol, keyVal) {
  if (!db) return false;
  return !!db.prepare(`SELECT ${keyCol} FROM ${table} WHERE ${keyCol} = ?`).get(keyVal);
}

// ─── Users ────────────────────────────────────────────────────────────────────

const usersRoot = path.join(WORKSPACE, "users");
if (fs.existsSync(usersRoot)) {
  for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("archive")) continue;
    const user_key = entry.name;
    const profilePath = path.join(usersRoot, user_key, "profile.md");

    if (!fs.existsSync(profilePath)) {
      console.log(`  skip  ${user_key}: no profile.md`);
      skippedUsers++;
      continue;
    }

    const text = fs.readFileSync(profilePath, "utf8");
    const profile = parseProfile(text);
    if (!profile || Object.keys(profile).length === 0) {
      console.log(`  skip  ${user_key}: empty profile`);
      skippedUsers++;
      continue;
    }

    const inDb = alreadyInDb("users", "user_key", user_key);
    if (inDb && !force) {
      console.log(`  skip  ${user_key}: already in DB (use --force to overwrite)`);
      skippedUsers++;
      continue;
    }

    const verb = dryRun ? "[dry]" : inDb ? "update" : "import";
    console.log(`  ${verb} user ${user_key}: setup_status=${profile.setup_status || "new"}, name=${profile.name || "?"}`);

    if (!dryRun) {
      upsertUser(db, user_key, profile);
      if (inDb) updatedUsers++; else importedUsers++;
    } else {
      importedUsers++;
    }
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────

const teamsRoot = path.join(WORKSPACE, "data", "teams");
if (fs.existsSync(teamsRoot)) {
  for (const entry of fs.readdirSync(teamsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("team-")) continue;
    const teamId = entry.name;
    const dir    = path.join(teamsRoot, teamId);
    const meta   = readJson(path.join(dir, "meta.json"));

    if (!meta?.team_id) {
      console.log(`  skip  team ${teamId}: no meta.json`);
      skippedTeams++;
      continue;
    }

    const inDb = alreadyInDb("teams", "team_id", teamId);
    if (inDb && !force) {
      console.log(`  skip  team ${teamId}: already in DB (use --force to overwrite)`);
      skippedTeams++;
      continue;
    }

    const verb = dryRun ? "[dry]" : inDb ? "update" : "import";
    console.log(`  ${verb} team ${teamId}: goal="${meta.goal}"`);

    if (!dryRun) {
      upsertTeam(db, {
        team_id:            meta.team_id,
        owner_key:          meta.owner_user_key,
        goal:               meta.goal,
        created_at:         meta.created_at,
        owner_telegram_id:  meta.owner_telegram_id || null,
      });

      const membersDoc = readJson(path.join(dir, "members.json"));
      for (const m of membersDoc?.members || []) {
        upsertTeamMember(db, teamId, m);
      }

      const tasksDoc = readJson(path.join(dir, "tasks.json"));
      for (const t of tasksDoc?.tasks || []) {
        upsertTeamTask(db, teamId, { ...t, assignee: t.assignee_user_key });
      }

      const invitesDoc = readJson(path.join(dir, "invites.json"));
      for (const inv of invitesDoc?.invites || []) {
        upsertTeamInvite(db, teamId, inv);
      }

      // Notifications: only import if the table is empty for this team (avoid duplicates)
      const existingNotif = db.prepare("SELECT count(*) as n FROM team_notifications WHERE team_id=?").get(teamId);
      if (existingNotif.n === 0) {
        const logPath = path.join(dir, "notifications.log");
        if (fs.existsSync(logPath)) {
          const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
          for (const line of lines) {
            try { appendTeamNotification(db, teamId, JSON.parse(line)); } catch { /* skip malformed */ }
          }
        }
      }

      importedTeams++;
    } else {
      importedTeams++;
    }
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n─── Migration summary ───────────────────────────────────");
if (dryRun) console.log("DRY RUN — no data written");
console.log(`Users:  imported=${importedUsers}  updated=${updatedUsers}  skipped=${skippedUsers}`);
console.log(`Teams:  imported=${importedTeams}  skipped=${skippedTeams}`);
if (!dryRun) {
  console.log(`DB:     ${dbPath}`);
  console.log('\nTip: run with --status to inspect the DB contents');
}
console.log("─────────────────────────────────────────────────────────");
