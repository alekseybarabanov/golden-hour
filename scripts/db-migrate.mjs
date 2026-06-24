#!/usr/bin/env node
// db-migrate.mjs — one-time migration from file-based storage to SQLite.
// Idempotent (INSERT OR IGNORE for existing rows).
//
// Usage:
//   node scripts/db-migrate.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, isDryRun, WORKSPACE } from "./lib/cli.mjs";
import { getDb, defaultDbPath, upsertUser, upsertTeam, upsertTeamMember, upsertTeamTask, upsertTeamInvite, appendTeamNotification } from "./lib/db.mjs";
import { parseProfile } from "./lib/profile.mjs";

const { opts } = parseArgs(process.argv);
const dryRun = isDryRun(opts);

const dbPath = defaultDbPath(WORKSPACE);
const db = dryRun ? null : getDb(dbPath);

let importedUsers = 0;
let importedTeams = 0;
let skippedUsers = 0;
let skippedTeams = 0;

// ─── Migrate users/*/profile.md ───────────────────────────────────────────────

const usersRoot = path.join(WORKSPACE, "users");
if (fs.existsSync(usersRoot)) {
  for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("archive")) continue;
    const user_key = entry.name;
    const profilePath = path.join(usersRoot, user_key, "profile.md");
    if (!fs.existsSync(profilePath)) {
      console.log(`  skip ${user_key}: no profile.md`);
      skippedUsers++;
      continue;
    }
    const text = fs.readFileSync(profilePath, "utf8");
    const profile = parseProfile(text);
    if (!profile || Object.keys(profile).length === 0) {
      console.log(`  skip ${user_key}: empty profile`);
      skippedUsers++;
      continue;
    }
    console.log(`  ${dryRun ? "[dry]" : "import"} user ${user_key}: setup_status=${profile.setup_status || "new"}, name=${profile.name || "?"}`);
    if (!dryRun) {
      // INSERT OR IGNORE — don't overwrite existing DB records
      const existing = db.prepare("SELECT user_key FROM users WHERE user_key = ?").get(user_key);
      if (!existing) {
        upsertUser(db, user_key, profile);
        importedUsers++;
      } else {
        console.log(`    already in DB — skipped`);
        skippedUsers++;
      }
    } else {
      importedUsers++;
    }
  }
}

// ─── Migrate data/teams/*/  ───────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

const teamsRoot = path.join(WORKSPACE, "data", "teams");
if (fs.existsSync(teamsRoot)) {
  for (const entry of fs.readdirSync(teamsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("team-")) continue;
    const teamId = entry.name;
    const dir = path.join(teamsRoot, teamId);
    const meta = readJson(path.join(dir, "meta.json"));
    if (!meta?.team_id) {
      console.log(`  skip team ${teamId}: no meta.json`);
      skippedTeams++;
      continue;
    }

    if (!dryRun) {
      const existing = db.prepare("SELECT team_id FROM teams WHERE team_id = ?").get(teamId);
      if (existing) {
        console.log(`  team ${teamId}: already in DB — skipped`);
        skippedTeams++;
        continue;
      }
    }

    console.log(`  ${dryRun ? "[dry]" : "import"} team ${teamId}: goal="${meta.goal}"`);
    if (!dryRun) {
      upsertTeam(db, {
        team_id: meta.team_id,
        owner_key: meta.owner_user_key,
        goal: meta.goal,
        created_at: meta.created_at,
        owner_telegram_id: meta.owner_telegram_id || null,
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

      const logPath = path.join(dir, "notifications.log");
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            appendTeamNotification(db, teamId, entry);
          } catch { /* skip malformed lines */ }
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
console.log(`Users:  imported=${importedUsers}  skipped=${skippedUsers}`);
console.log(`Teams:  imported=${importedTeams}  skipped=${skippedTeams}`);
if (!dryRun) console.log(`DB:     ${dbPath}`);
console.log("─────────────────────────────────────────────────────────");
