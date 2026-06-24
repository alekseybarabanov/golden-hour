// Shared tasks.yaml helpers (tasks.mjs, longterm-stats, timer auto-log).

import fs from "node:fs";
import path from "node:path";
import { readText } from "./cli.mjs";
import { nowISO } from "./pomodoro-core.mjs";

function parseScalar(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseTasksYaml(text) {
  if (!text || !text.trim()) return [];
  const tasks = [];
  let current = null;
  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const itemStart = rawLine.match(/^-\s+(\w+):\s*(.*)$/);
    if (itemStart) {
      if (current) tasks.push(current);
      current = {};
      current[itemStart[1]] = parseScalar(itemStart[2]);
      continue;
    }
    const subField = rawLine.match(/^\s{2,}(\w+):\s*(.*)$/);
    if (subField && current) {
      current[subField[1]] = parseScalar(subField[2]);
    }
  }
  if (current) tasks.push(current);
  return tasks;
}

function formatScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") {
    if (v.includes(":") || v.includes("#")) return `"${v.replace(/"/g, '\\"')}"`;
    return v;
  }
  return String(v);
}

export function serializeTasksYaml(tasks) {
  if (!tasks.length) return "";
  const lines = [];
  for (const t of tasks) {
    const keys = Object.keys(t);
    if (!keys.length) continue;
    lines.push(`- ${keys[0]}: ${formatScalar(t[keys[0]])}`);
    for (let i = 1; i < keys.length; i++) lines.push(`  ${keys[i]}: ${formatScalar(t[keys[i]])}`);
  }
  return lines.join("\n") + "\n";
}

export function isTaskOverdue(task, now = new Date()) {
  if (!task || task.status === "done" || !task.deadline) return false;
  return new Date(task.deadline.replace(/\+00:00$/, "Z")) < now;
}

export function tasksYamlPath(userDirPath) {
  return path.join(userDirPath, "tasks.yaml");
}

export function loadTasksFromDir(userDirPath) {
  return parseTasksYaml(readText(tasksYamlPath(userDirPath), ""));
}

export function saveTasksToDir(userDirPath, tasks) {
  const yamlPath = tasksYamlPath(userDirPath);
  fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
  fs.writeFileSync(yamlPath, serializeTasksYaml(tasks), "utf8");
}

export function markTaskDone(userDirPath, taskId) {
  if (!taskId) return { ok: false, error: "missing_task_id" };
  const yamlPath = tasksYamlPath(userDirPath);
  if (!fs.existsSync(yamlPath)) return { ok: false, error: "no_tasks_yaml" };
  const tasks = loadTasksFromDir(userDirPath);
  const t = tasks.find((x) => String(x.id) === String(taskId));
  if (!t) return { ok: false, error: "task_not_found" };
  if (t.status === "done") return { ok: true, already: true, task: t };
  t.status = "done";
  t.progress = 100;
  t.updated_at = nowISO();
  saveTasksToDir(userDirPath, tasks);
  return { ok: true, task: t };
}

export function addTimeSpentMinutes(userDirPath, taskId, minutes) {
  if (!taskId || !minutes || minutes <= 0) return false;
  const yamlPath = tasksYamlPath(userDirPath);
  if (!fs.existsSync(yamlPath)) return false;
  const tasks = loadTasksFromDir(userDirPath);
  const t = tasks.find((x) => String(x.id) === String(taskId));
  if (!t || t.status === "done") return false;
  t.time_spent_minutes = (Number(t.time_spent_minutes) || 0) + minutes;
  t.updated_at = nowISO();
  if (t.progress == null || t.progress === 0) t.status = "in_progress";
  saveTasksToDir(userDirPath, tasks);
  return true;
}

export function recurringPath(userDirPath) {
  return path.join(userDirPath, "recurring.json");
}

export function loadRecurring(userDirPath) {
  const p = recurringPath(userDirPath);
  if (!fs.existsSync(p)) return { items: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return { items: data.items || [] };
  } catch {
    return { items: [] };
  }
}

export function saveRecurring(userDirPath, data) {
  const p = recurringPath(userDirPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
