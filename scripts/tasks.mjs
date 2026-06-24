#!/usr/bin/env node
// tasks.mjs — единое хранилище задач. Минимальный CLI для агента.
//
// Commands:
//   add, list, close, progress
//   decompose — разбить задачу на подзадачи (add × N)
//   recurring add|list|remove — повторяющиеся дела для daily-plan
//
// Usage:
//   node scripts/tasks.mjs add --user <key> --title "..." [--weight 5] [--deadline ...] [--category ...] [--done-when "..."]
//   node scripts/tasks.mjs list --user <key> [--status planned|in_progress|done|blocked|overdue] [--category ...]
//   node scripts/tasks.mjs close --user <key> --task <id>
//   node scripts/tasks.mjs progress --user <key> --task <id> --percent N
//   node scripts/tasks.mjs decompose --user <key> --task <id> --steps "шаг1|шаг2|шаг3"
//   node scripts/tasks.mjs recurring add --user <key> --title "..." [--schedule daily|weekdays|weekly] [--est-minutes 30]
//   node scripts/tasks.mjs recurring list --user <key>
//   node scripts/tasks.mjs recurring remove --user <key> --id <id>
//
// Storage: users/<key>/tasks.yaml + tasks.md + recurring.json

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  out,
  die,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus } from "./lib/profile.mjs";
import { nowISO } from "./lib/pomodoro-core.mjs";
import {
  parseTasksYaml,
  serializeTasksYaml,
  isTaskOverdue,
  loadRecurring,
  saveRecurring,
} from "./lib/tasks-core.mjs";

const { cmd, opts, positional } = parseArgs(process.argv);
if (!cmd) die("missing command: add|list|close|progress|decompose|recurring");

const userKey = requireUser(opts);
const dir = userDir(userKey);
const yamlPath = path.join(dir, "tasks.yaml");
const mdPath = path.join(dir, "tasks.md");

const { exists, profile } = loadProfile(dir, (p) => readText(p));
if (!exists) die("profile not found");
if (getSetupStatus(profile) !== "complete") die("setup_status not complete");

function loadTasks() {
  return parseTasksYaml(readText(yamlPath));
}

function saveTasks(tasks) {
  fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
  fs.writeFileSync(yamlPath, serializeTasksYaml(tasks), "utf8");
  renderMarkdown(tasks);
}

function nextId(tasks) {
  return tasks.length ? Math.max(...tasks.map((t) => Number(t.id) || 0)) + 1 : 1;
}

function matchesStatus(task, status) {
  if (status === "overdue") return isTaskOverdue(task);
  return task.status === status;
}

function renderMarkdown(tasks) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const day = (d) => (d ? d.slice(0, 10) : null);
  const active = tasks.filter((t) => t.status !== "done");
  const todayTasks = active.filter((t) => day(t.deadline) === today);
  const tomorrowTasks = active.filter((t) => day(t.deadline) === tomorrow);
  const later = active.filter((t) => !t.deadline || (day(t.deadline) > tomorrow && day(t.deadline) !== today));
  const done = tasks.filter((t) => t.status === "done");
  const blocked = active.filter((t) => t.status === "blocked");
  const lines = [
    "# Текущие задачи",
    "",
    `**Обновлён:** ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    `**Активных:** ${active.length}`,
    "",
    "---",
    "",
    "## Сегодня",
    todayTasks.length ? todayTasks.map(formatMd).join("\n") : "*(пусто)*",
    "",
    "## Завтра",
    tomorrowTasks.length ? tomorrowTasks.map(formatMd).join("\n") : "*(пусто)*",
    "",
    "## Позже",
    later.length ? later.map(formatMd).join("\n") : "*(пусто)*",
    "",
    "---",
    "",
    "## Блокеры",
    blocked.length ? blocked.map(formatMd).join("\n") : "*(пусто)*",
    "",
    "## История (закрытые)",
    done.length ? done.slice(-20).map(formatMd).join("\n") : "*(пусто)*",
    "",
  ];
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
}

function formatMd(t) {
  const check = t.status === "done" ? "x" : " ";
  const w = t.weight ? ` · вес ${t.weight}` : "";
  const dl = t.deadline ? ` · до ${t.deadline.slice(0, 16).replace("T", " ")}` : "";
  const pr = t.progress != null && t.status !== "done" ? ` · ${t.progress}%` : "";
  const od = isTaskOverdue(t) ? " 🔥" : "";
  return `- [${check}] #${t.id} · ${t.name}${w}${dl}${pr}${od}`;
}

let result;

if (cmd === "recurring") {
  const sub = positional[0];
  if (!sub) die("missing: recurring add|list|remove");
  const data = loadRecurring(dir);
  switch (sub) {
    case "add": {
      if (!opts.title) die("missing --title");
      const id = data.items.length
        ? Math.max(...data.items.map((i) => Number(i.id) || 0)) + 1
        : 1;
      const item = {
        id,
        title: opts.title,
        schedule: opts.schedule || "daily",
        est_minutes: Number(opts["est-minutes"] || opts.estMinutes || 30),
        created_at: nowISO(),
      };
      data.items.push(item);
      saveRecurring(dir, data);
      result = { ok: true, action: "recurring_added", item };
      break;
    }
    case "list":
      result = { ok: true, items: data.items, count: data.items.length };
      break;
    case "remove": {
      if (!opts.id) die("missing --id");
      const before = data.items.length;
      data.items = data.items.filter((i) => String(i.id) !== String(opts.id));
      if (data.items.length === before) die("recurring item not found", { id: opts.id });
      saveRecurring(dir, data);
      result = { ok: true, action: "recurring_removed", id: opts.id };
      break;
    }
    default:
      die("unknown recurring subcommand", { sub });
  }
} else switch (cmd) {
  case "add": {
    if (!opts.title) die("missing --title");
    const tasks = loadTasks();
    const task = {
      id: nextId(tasks),
      name: opts.title,
      weight: Number(opts.weight || 5),
      status: "planned",
      progress: 0,
      time_spent_minutes: 0,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    if (opts.deadline) task.deadline = opts.deadline;
    if (opts.category) task.category = opts.category;
    if (opts["done-when"]) task.done_when = opts["done-when"];
    if (opts["parent-id"]) task.parent_id = Number(opts["parent-id"]);
    tasks.push(task);
    saveTasks(tasks);
    result = { ok: true, action: "added", task };
    break;
  }
  case "list": {
    let tasks = loadTasks();
    if (opts.status) tasks = tasks.filter((t) => matchesStatus(t, opts.status));
    if (opts.category) tasks = tasks.filter((t) => t.category === opts.category);
    result = { ok: true, tasks, count: tasks.length };
    break;
  }
  case "close": {
    if (!opts.task) die("missing --task <id>");
    const tasks = loadTasks();
    const t = tasks.find((x) => String(x.id) === String(opts.task));
    if (!t) die("task not found", { id: opts.task });
    t.status = "done";
    t.progress = 100;
    t.ended_at = nowISO();
    t.updated_at = nowISO();
    saveTasks(tasks);
    result = { ok: true, action: "closed", task: t };
    break;
  }
  case "progress": {
    if (!opts.task || opts.percent == null) die("missing --task <id> --percent N");
    const tasks = loadTasks();
    const t = tasks.find((x) => String(x.id) === String(opts.task));
    if (!t) die("task not found", { id: opts.task });
    const p = Math.max(0, Math.min(100, Number(opts.percent)));
    t.progress = p;
    t.status = p >= 100 ? "done" : p > 0 ? "in_progress" : t.status;
    t.updated_at = nowISO();
    saveTasks(tasks);
    result = { ok: true, action: "progress", task: t };
    break;
  }
  case "decompose": {
    if (!opts.task) die("missing --task <id>");
    const stepsRaw = opts.steps;
    if (!stepsRaw) die("missing --steps \"шаг1|шаг2|...\"");
    const steps = stepsRaw.split("|").map((s) => s.trim()).filter(Boolean);
    if (!steps.length) die("empty --steps");
    const tasks = loadTasks();
    const parent = tasks.find((x) => String(x.id) === String(opts.task));
    if (!parent) die("task not found", { id: opts.task });
    const subtasks = [];
    let nid = nextId(tasks);
    for (const name of steps) {
      const task = {
        id: nid++,
        name,
        weight: Math.max(1, Math.round((parent.weight || 5) / steps.length)),
        status: "planned",
        progress: 0,
        parent_id: parent.id,
        category: parent.category || null,
        created_at: nowISO(),
        updated_at: nowISO(),
      };
      subtasks.push(task);
    }
    parent.decomposed = true;
    parent.updated_at = nowISO();
    saveTasks([...tasks, ...subtasks]);
    result = { ok: true, action: "decomposed", parent_id: parent.id, subtasks };
    break;
  }
  default:
    die("unknown command", { cmd });
}

out(result);
