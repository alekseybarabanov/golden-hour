#!/usr/bin/env node
// Add/list study dashboard tasks in users/<user>/plans/YYYY-MM-DD.json.
//
// Usage:
//   node scripts/dashboard-task.mjs add --user tg-123 --title "..." --description "..." --tag topic [--date YYYY-MM-DD] [--est-minutes 30] [--status planned]
//   node scripts/dashboard-task.mjs list --user tg-123 [--date YYYY-MM-DD]

import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readJson,
  writeJson,
  out,
  die,
  relWorkspacePath,
} from "./lib/cli.mjs";
import { resolveToday } from "./lib/dates.mjs";

const STATUSES = new Set(["planned", "in_progress", "done", "skipped"]);

const { cmd, opts } = parseArgs(process.argv);
const userKey = requireUser(opts);
const dir = userDir(userKey);
const date = resolveToday(opts);
const planPath = path.join(dir, "plans", `${date}.json`);

function emptyPlan() {
  return {
    date,
    user_id: userKey,
    goals: [],
    tasks: [],
    load: { sum_difficulty: 0, budget: 0 },
    meta: { generated_by: "dashboard-task.mjs", topic: "", purposes: [] },
  };
}

function nextTaskId(tasks) {
  let max = 0;
  for (const task of tasks || []) {
    const m = /^t_(\d+)$/.exec(String(task.id || ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `t_${String(max + 1).padStart(3, "0")}`;
}

function normalizeStatus(raw) {
  const status = String(raw || "planned").trim().toLowerCase();
  if (["pending", "queued", "todo", "new"].includes(status)) return "planned";
  if (["running", "active", "working"].includes(status)) return "in_progress";
  if (["completed", "ok", "success"].includes(status)) return "done";
  if (["cancelled", "canceled", "blocked", "failed"].includes(status)) return "skipped";
  return STATUSES.has(status) ? status : "planned";
}

function hasAbandonConfirmation(opts) {
  for (const key of ["abandon-confirmed", "abandon_confirmed", "confirm-abandoned", "confirm_abandoned"]) {
    const raw = opts[key];
    if (raw === true) return true;
    if (typeof raw === "string" && ["1", "true", "yes", "y", "да", "confirmed"].includes(raw.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

function normalizeTag(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

function meaningfulDescription(raw, title) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (text.length < 24) return "";
  if (text.toLowerCase() === String(title || "").trim().toLowerCase()) return "";
  if (/^(todo|task|задача|описание|нет|n\/a|-)$/i.test(text)) return "";
  return text;
}

function loadPlan() {
  const plan = readJson(planPath, null) || emptyPlan();
  if (!Array.isArray(plan.tasks)) plan.tasks = [];
  if (!Array.isArray(plan.goals)) plan.goals = [];
  return plan;
}

switch (cmd) {
  case "add": {
    const title = String(opts.title || "").trim();
    if (!title) die("missing --title");
    const description = meaningfulDescription(opts.description, title);
    if (!description) die("missing meaningful --description (explain what to do and what result is expected)");
    const tag = normalizeTag(opts.tag);
    if (!tag || tag.length < 3) die("missing meaningful --tag (use a specific category like topic, practice, review)");
    const status = normalizeStatus(opts.status);
    if (status === "skipped" && !hasAbandonConfirmation(opts)) {
      die("status skipped/blocked requires explicit user confirmation: add --abandon-confirmed true");
    }
    const plan = loadPlan();
    const due = String(opts["due-date"] || opts.due_date || opts.date || date).slice(0, 10);
    const now = new Date().toISOString();
    const task = {
      id: nextTaskId(plan.tasks),
      goal_id: opts["goal-id"] || opts.goal_id || "dashboard",
      title,
      description,
      scheduled_at: opts.scheduled_at || opts["scheduled-at"] || `${due}T12:00:00`,
      est_minutes: Number(opts["est-minutes"] || opts.est_minutes || 30),
      weight: Number(opts.weight || 3),
      goal_weight: Number(opts["goal-weight"] || opts.goal_weight || opts.weight || 3),
      difficulty: Number(opts.difficulty || 2),
      priority: String(opts.priority || "medium").trim().toLowerCase(),
      status,
      snoozed_until: null,
      source: opts.source || "agent-dashboard-task",
      created_at: now,
      updated_at: now,
      tag,
    };
    if (opts.purpose) task.purpose = String(opts.purpose).trim();
    plan.tasks.push(task);
    writeJson(planPath, plan);
    out({
      action: "added",
      user_key: userKey,
      date,
      path: relWorkspacePath(planPath),
      task,
    });
    break;
  }
  case "list": {
    const plan = loadPlan();
    out({
      user_key: userKey,
      date,
      path: relWorkspacePath(planPath),
      count: plan.tasks.length,
      tasks: plan.tasks,
    });
    break;
  }
  default:
    die("missing command: add|list");
}
