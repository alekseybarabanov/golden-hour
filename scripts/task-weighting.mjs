#!/usr/bin/env node
// task-weighting.mjs — compute eff_priority / eff_difficulty for topics.
//
// Usage:
//   node scripts/task-weighting.mjs --user <user_key> [--date YYYY-MM-DD] [--topic "Title"]
//   node scripts/task-weighting.mjs weigh --json '{"topics":["A","B"],"profile":{...}}'

import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  out,
  die,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus, getTopicsFromProfile } from "./lib/profile.mjs";
import {
  weightTopic,
  weightTopics,
  getDailyBudget,
} from "./lib/task-weighting.mjs";
import { resolveToday } from "./lib/dates.mjs";

const { cmd, opts } = parseArgs(process.argv);
const today = resolveToday(opts);

if (cmd === "weigh" && opts.json) {
  let data;
  try {
    data = JSON.parse(opts.json);
  } catch {
    die("invalid --json");
  }
  const profile = data.profile || {};
  const topics = data.topics || [];
  const items = weightTopics(topics, profile, today);
  out({ items, budget: getDailyBudget(profile.daily_load) });
  process.exit(0);
}

const userKey = requireUser(opts);
const dir = userDir(userKey);
const { exists, profile } = loadProfile(dir, (p) => readText(p));

if (!exists) die("profile not found", { user_key: userKey });
if (getSetupStatus(profile) !== "complete") {
  die("setup_status not complete", { setup_status: getSetupStatus(profile) });
}

const todayResolved = resolveToday(opts);

if (opts.topic) {
  const item = weightTopic(opts.topic, profile, todayResolved);
  out({
    user_key: userKey,
    date: todayResolved,
    item,
    budget: getDailyBudget(profile.daily_load),
  });
  process.exit(0);
}

let topics = getTopicsFromProfile(profile);
if (opts.topics) {
  try {
    topics = JSON.parse(opts.topics).map((t) =>
      typeof t === "string" ? { title: t } : t
    );
  } catch {
    die("invalid --topics JSON array");
  }
}

const items = weightTopics(topics, profile, todayResolved);
out({
  user_key: userKey,
  date: todayResolved,
  items,
  budget: getDailyBudget(profile.daily_load),
});
