#!/usr/bin/env node
// session-start.mjs — determine user phase and profile snapshot.
//
// Usage:
//   node scripts/session-start.mjs --user <user_key>
//
// Output: { ok, status, profile_summary, paths, actions }

import path from "node:path";
import {
  WORKSPACE,
  parseArgs,
  requireUser,
  userDir,
  readText,
  out,
  die,
} from "./lib/cli.mjs";
import {
  loadProfile,
  getSetupStatus,
  getTopicsFromProfile,
} from "./lib/profile.mjs";

const { opts } = parseArgs(process.argv);
const userKey = requireUser(opts);
const dir = userDir(userKey);
const { exists, profile } = loadProfile(dir, (p) => readText(p));

if (!exists) {
  out({
    user_key: userKey,
    status: "new",
    setup_status: "new",
    action: "onboarding",
    message: "Новый пользователь — запустить hello-intro",
    paths: { profile: path.join(dir, "profile.md") },
  });
  process.exit(0);
}

const setupStatus = getSetupStatus(profile);
const topics = getTopicsFromProfile(profile);

const summary = {
  name: profile.name,
  purpose: profile.purpose,
  deadline: profile.deadline,
  hours_per_week: profile.hours_per_week,
  daily_load: profile.daily_load,
  topic_count: topics.length,
};

let action = "onboarding";
if (setupStatus === "complete") action = "menu_continue_or_reset";
else if (setupStatus === "in_progress") action = "resume_setup_or_reset";

const files = {
  profile: path.join(dir, "profile.md"),
  plan: readText(path.join(dir, "plan.md")) ? path.join(dir, "plan.md") : null,
  progress: readText(path.join(dir, "progress.md"))
    ? path.join(dir, "progress.md")
    : null,
  tasks: readText(path.join(dir, "tasks.md")) ? path.join(dir, "tasks.md") : null,
};

out({
  user_key: userKey,
  status: setupStatus === "complete" ? "returning" : setupStatus,
  setup_status: setupStatus,
  action,
  profile_summary: summary,
  paths: files,
  workspace: WORKSPACE,
});
