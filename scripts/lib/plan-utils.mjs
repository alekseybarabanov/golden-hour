// Plan JSON helpers — canonical task statuses and normalization.

const STATUS_ALIASES = {
  completed: "done",
  complete: "done",
  finished: "done",
  cancelled: "skipped",
  canceled: "skipped",
};

export const OPEN_TASK_STATUSES = new Set(["planned", "in_progress", "snoozed"]);
export const DONE_TASK_STATUSES = new Set(["done", "completed", "complete", "finished"]);

export function normalizeTaskStatus(status) {
  const s = String(status || "planned").trim().toLowerCase();
  return STATUS_ALIASES[s] || s;
}

export function isTaskDone(task) {
  return DONE_TASK_STATUSES.has(normalizeTaskStatus(task?.status));
}

export function isOpenTask(task) {
  const s = normalizeTaskStatus(task?.status);
  return OPEN_TASK_STATUSES.has(s);
}

/** Normalize task statuses in a plan object (mutates tasks). Returns true if anything changed. */
export function normalizePlan(plan) {
  if (!plan?.tasks?.length) return false;
  let changed = false;
  for (const task of plan.tasks) {
    const next = normalizeTaskStatus(task.status);
    if (task.status !== next) {
      task.status = next;
      changed = true;
    }
  }
  return changed;
}

export function countDoneTasks(plan) {
  return (plan?.tasks || []).filter((t) => isTaskDone(t)).length;
}

export function loadPlanJson(readJson, planPath, { repair = false, writeJson } = {}) {
  const plan = readJson(planPath, null);
  if (!plan) return null;
  if (repair && normalizePlan(plan) && writeJson) {
    writeJson(planPath, plan);
  }
  return plan;
}
