// Plan task responses for checkins (начинаю / отложить / пропустить).

import { addMinutes } from "./dates.mjs";
import { mskNowParts } from "./task-pings-core.mjs";
import { isOpenTask, normalizeTaskStatus } from "./plan-utils.mjs";

const ACTION_MAP = {
  start: { status: "in_progress", clearSnooze: true },
  snooze: { status: "snoozed", setSnooze: true },
  skip: { status: "skipped", clearSnooze: true },
  done: { status: "done", clearSnooze: true },
};

export function normalizeAction(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (["start", "начинаю", "начать", "go"].includes(s)) return "start";
  if (["snooze", "отложить", "отложи", "later"].includes(s)) return "snooze";
  if (["skip", "пропустить", "пропуск", "skip"].includes(s)) return "skip";
  if (
    ["done", "готово", "засчитать", "сделал", "сделала", "закрыл", "закрыла"].includes(s)
  )
    return "done";
  return null;
}

export function creditPlanTask(plan, taskId) {
  const task = pickActiveTask(plan, taskId);
  if (!task) return { ok: false, error: "task_not_found" };
  const applied = applyTaskAction(task, "done", {});
  if (!applied.ok) return applied;
  return {
    ok: true,
    task: applied.task,
    plan: updatePlanTask(plan, task.id, applied.task),
    message: buildRespondMessage("done", applied.task),
  };
}

export function pickActiveTask(plan, taskId) {
  const tasks = plan?.tasks || [];
  if (taskId) {
    return tasks.find((t) => t.id === taskId) || null;
  }
  const open = tasks.filter((t) => isOpenTask(t));
  if (!open.length) return null;
  open.sort((a, b) => {
    const ta = Date.parse(a.snoozed_until || a.scheduled_at || 0) || 0;
    const tb = Date.parse(b.snoozed_until || b.scheduled_at || 0) || 0;
    return ta - tb;
  });
  return open[0];
}

export function applyTaskAction(task, action, { snoozeMinutes = 30, nowIso } = {}) {
  const spec = ACTION_MAP[action];
  if (!spec || !task) return { ok: false, error: "invalid_action_or_task" };

  const next = { ...task, status: normalizeTaskStatus(spec.status) };
  if (spec.clearSnooze) next.snoozed_until = null;
  if (spec.setSnooze) {
    const base = nowIso || mskNowParts().iso;
    next.snoozed_until = addMinutes(base, snoozeMinutes);
  }
  return { ok: true, task: next, previous_status: task.status };
}

export function buildRespondMessage(action, task, { snoozeMinutes } = {}) {
  const title = task?.title || "задача";
  switch (action) {
    case "start":
      return `Принял — *${title}*. Удачи!`;
    case "snooze": {
      const at = task.snoozed_until?.match(/T(\d{2}):(\d{2})/);
      const when = at ? `${at[1]}:${at[2]}` : `через ${snoozeMinutes} мин`;
      return `Ок, отложил *${title}* — напомню около ${when}.`;
    }
    case "skip":
      return `Пропустили *${title}*. Если передумаешь — напиши.`;
    case "done":
      return `Засчитал *${title}* — молодец!`;
    default:
      return null;
  }
}

export function updatePlanTask(plan, taskId, patched) {
  const tasks = (plan.tasks || []).map((t) => (t.id === taskId ? patched : t));
  return { ...plan, tasks };
}
