// Auto-emit temporal-kg events from checkins, plan tasks, and timer credits.

import { kgDir, ingestCheckin, emitEvent } from "./temporal-kg-core.mjs";

function topicsFromCheckinText(text) {
  const m = /изучил[аи]?:\s*(.+)/i.exec(text || "");
  if (m) {
    return m[1]
      .split(/[,;]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1)
      .slice(0, 8);
  }
  const plain = String(text || "")
    .replace(/^\*\*Чек-ин\.\*\*\s*/i, "")
    .trim();
  if (plain.length > 2) return [plain.slice(0, 120)];
  return [];
}

function taskTopic(task) {
  return task?.topic || task?.title || "задача";
}

export function hookCheckinRecorded(userDir, { text, date }) {
  const dir = kgDir(userDir);
  const topics = topicsFromCheckinText(text);
  return ingestCheckin(dir, {
    note: text,
    topics,
    mood: null,
    energy: null,
    ts: date ? `${date}T21:00:00+03:00` : undefined,
  });
}

export function hookPlanTaskAction(userDir, task, action) {
  const dir = kgDir(userDir);
  const topic = taskTopic(task);
  if (action === "done") {
    return emitEvent(dir, {
      type: "study",
      topic,
      result: "success",
      source: "plan-task",
      task_id: task?.id,
    });
  }
  if (action === "start") {
    return emitEvent(dir, {
      type: "study",
      topic,
      result: "started",
      source: "plan-task",
      task_id: task?.id,
    });
  }
  if (action === "skip") {
    return emitEvent(dir, {
      type: "study",
      topic,
      result: "skipped",
      source: "plan-task",
      task_id: task?.id,
    });
  }
  return { ok: true, skipped: true };
}

export function hookTimerCredit(userDir, { topic, minutes, taskId, mode }) {
  const dir = kgDir(userDir);
  return emitEvent(dir, {
    type: "study",
    topic: topic || "фокус",
    result: "success",
    duration_min: minutes || null,
    source: mode || "timer",
    task_id: taskId || null,
  });
}
