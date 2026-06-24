// Enumerate user folders under users/.

import fs from "node:fs";
import path from "node:path";
import { WORKSPACE } from "./cli.mjs";
import { loadProfile, getSetupStatus } from "./profile.mjs";
import { getDb, listActiveUsers as dbListActiveUsers, dbExists, defaultDbPath } from "./db.mjs";

export function listUserDirs(readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}) {
  const root = path.join(WORKSPACE, "users");
  if (!fs.existsSync(root)) return [];

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("archive"))
    .map((d) => ({
      user_key: d.name,
      dir: path.join(root, d.name),
    }));
}

export function listActiveUsers(readText) {
  // DB-first
  const dbPath = defaultDbPath(WORKSPACE);
  if (dbExists(dbPath)) {
    const db = getDb(dbPath);
    return dbListActiveUsers(db).map(({ user_key, profile }) => ({
      user_key,
      dir: path.join(WORKSPACE, "users", user_key),
      profile,
    }));
  }
  // File fallback
  const users = [];
  for (const { user_key, dir } of listUserDirs(readText)) {
    const { exists, profile } = loadProfile(dir, readText);
    if (!exists) continue;
    if (getSetupStatus(profile) !== "complete") continue;
    users.push({ user_key, dir, profile });
  }
  return users;
}
