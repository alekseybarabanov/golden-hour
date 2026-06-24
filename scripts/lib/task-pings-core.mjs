// Task ping selection for checkins (scheduled_at + snooze, max per day, quiet hours).

export function userKeyToChatId(userKey) {
  const m = String(userKey).match(/^tg-(\d+)$/);
  return m ? m[1] : null;
}

export function parseTimeHM(s, fallback = "08:00") {
  const raw = s || fallback;
  const m = String(raw).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 8, minute: 0 };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Quiet window that may cross midnight (default 23:00–08:00 MSK). */
export function isQuietHours(hour, minute, start = "23:00", end = "08:00") {
  const now = hour * 60 + minute;
  const s = parseTimeHM(start);
  const e = parseTimeHM(end);
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;
  if (startMin > endMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

export function mskNowParts(ref = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(ref)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+03:00`,
    ms: ref.getTime(),
  };
}

export function taskTriggerAtMs(task) {
  const sched = task.scheduled_at ? Date.parse(task.scheduled_at) : 0;
  const snooze = task.snoozed_until ? Date.parse(task.snoozed_until) : 0;
  return Math.max(sched || 0, snooze || 0);
}

export function wasPingedForTrigger(state, taskId, triggerMs) {
  return (state?.sent || []).some(
    (s) => s.task_id === taskId && s.trigger_at === triggerMs
  );
}

export function goalForTask(plan, task) {
  return (plan?.goals || []).find((g) => g.id === task.goal_id) || null;
}

export function taskWeight(task) {
  return task.goal_weight ?? task.weight ?? 3;
}

/** Tasks due for ping, sorted by weight desc then trigger time asc. */
export function selectDueTasks(plan, nowMs, state, { graceMinutes = 0 } = {}) {
  const graceMs = graceMinutes * 60 * 1000;
  const tasks = plan?.tasks || [];
  const due = [];

  for (const task of tasks) {
    if (!["planned", "in_progress"].includes(task.status)) continue;
    const triggerMs = taskTriggerAtMs(task);
    if (!triggerMs || triggerMs > nowMs + graceMs) continue;
    if (wasPingedForTrigger(state, task.id, triggerMs)) continue;
    due.push({ task, triggerMs, weight: taskWeight(task) });
  }

  due.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.triggerMs - b.triggerMs;
  });
  return due;
}

export function buildPingMessage(task, goal) {
  const goalTitle = goal?.title?.replace(/\s*\(нед\..*$/, "") || "задача";
  return (
    `Пора за *${goalTitle}* 🌅\n` +
    `${task.title}\n` +
    `≈${task.est_minutes || "?"} мин\n\n` +
    `Как настрой? Напиши *начинаю*, *отложить* или *пропустить*.`
  );
}

export function pingButtons(_taskId) {
  return null;
}

export function pingStatePath(plansDir, date) {
  return `${plansDir}/.ping-state-${date}.json`;
}

export function recordPing(state, { taskId, triggerMs, atIso }) {
  const sent = [...(state?.sent || [])];
  sent.push({ task_id: taskId, trigger_at: triggerMs, at: atIso });
  return {
    date: state?.date,
    count: (state?.count || 0) + 1,
    sent,
  };
}

/** True when cron slot matches target HH:MM (±graceMinutes). */
export function isCronSlot(hour, minute, targetHm, graceMinutes = 7) {
  const now = hour * 60 + minute;
  const t = parseTimeHM(targetHm);
  const target = t.hour * 60 + t.minute;
  return Math.abs(now - target) <= graceMinutes;
}

/** Idempotent ping reservation — safe for task-pings and cron-deliver / heartbeat. */
export function commitPingIfNew(state, { taskId, triggerMs, atIso, date }) {
  if (wasPingedForTrigger(state, taskId, triggerMs)) {
    return { state, committed: false };
  }
  const next = recordPing({ ...state, date: state?.date || date }, {
    taskId,
    triggerMs,
    atIso: atIso || new Date().toISOString(),
  });
  next.date = date;
  return { state: next, committed: true };
}
