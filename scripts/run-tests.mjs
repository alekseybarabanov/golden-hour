#!/usr/bin/env node
// run-tests.mjs — run golden-hour script unit tests.
//
// Usage: node scripts/run-tests.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  weightTopic,
  getDailyBudget,
  clamp,
} from "./lib/task-weighting.mjs";
import { balanceDay } from "./lib/daily-balancer.mjs";
import { parseProfile, getTopicsFromProfile } from "./lib/profile.mjs";
import { parsePlanTopics, currentWeekNumber, topicForWeek } from "./lib/plan-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "tests", "fixtures", name), "utf8")
  );
}

// --- weighting fixtures ---
const fx = loadFixture("weighting-cases.json");
const today = fx.today;

for (const c of fx.cases) {
  if (c.expect_budget != null) {
    const b = getDailyBudget(c.profile.daily_load);
    assert(b === c.expect_budget, `${c.id}: budget ${b} !== ${c.expect_budget}`);
    continue;
  }
  const item = weightTopic(c.topic, c.profile, today);
  const e = c.expect;
  if (e.eff_priority != null) {
    assert(item.eff_priority === e.eff_priority, `${c.id}: priority ${item.eff_priority}`);
  }
  if (e.eff_priority_max != null) {
    assert(item.eff_priority <= e.eff_priority_max, `${c.id}: priority too high`);
  }
  if (e.eff_difficulty_min != null) {
    assert(item.eff_difficulty >= e.eff_difficulty_min, `${c.id}: difficulty low`);
  }
  if (e.eff_difficulty_max != null) {
    assert(item.eff_difficulty <= e.eff_difficulty_max, `${c.id}: difficulty high`);
  }
}

// --- balancer fixture ---
const bfx = fx.balancer;
const balanced = balanceDay(bfx.candidates, bfx.budget, bfx.date);
assert(
  balanced.tasks.length <= bfx.expect.max_tasks,
  `balancer: too many tasks ${balanced.tasks.length}`
);
assert(
  balanced.load.sum_difficulty <= bfx.budget,
  `balancer: load ${balanced.load.sum_difficulty} > budget`
);
const count5 = balanced.tasks.filter((t) => t.eff_difficulty >= 5).length;
assert(count5 <= bfx.expect.max_difficulty_5_count, "balancer: too many diff-5 blocks");

// --- profile parse (real user) ---
const mikhailProfile = fs.readFileSync(
  path.join(WORKSPACE, "users", "tg-5649925712", "profile.md"),
  "utf8"
);
const parsed = parseProfile(mikhailProfile);
assert(parsed.name === "Майкл" || parsed.name === 'Майкл', "profile: name");
assert(parsed.setup_status === "complete", "profile: setup_status");
assert(parsed.purpose === "exam", "profile: purpose");
const topics = getTopicsFromProfile(parsed);
assert(topics.length === 11, `profile: topics count ${topics.length}`);

// --- plan parse ---
const planText = fs.readFileSync(
  path.join(WORKSPACE, "users", "tg-5649925712", "plan.md"),
  "utf8"
);
const planTopics = parsePlanTopics(planText);
assert(planTopics.length >= 10, `plan topics: ${planTopics.length}`);
const week = currentWeekNumber(planText, "2026-06-19");
const topic = topicForWeek(planTopics, week);
assert(topic?.title?.includes("Параметр"), `week ${week} topic: ${topic?.title}`);

// --- clamp sanity ---
assert(clamp(10, 1, 5) === 5, "clamp hi");
assert(clamp(-1, 1, 5) === 1, "clamp lo");

console.log(`\nTests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
