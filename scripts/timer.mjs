#!/usr/bin/env node
// timer.mjs — единый таймер: pomodoro (циклы) + focus (одна задача). Агент-управляемый.
//
// Что есть (тонкий CLI для агента):
//   start            — запустить (pomodoro | focus, агент решает)
//   status           — текущая фаза/время
//   skip             — следующая фаза (только pomodoro)
//   stop             — завершить сессию
//   credit           — засчитать завершённую focus-сессию (план + tasks.yaml)
//   again            — новая focus-сессия по той же задаче
//   stats            — статистика
//   schedule         — предложить расписание
//   schedule-confirm — применить предложенное расписание (текст «подтверждаю»)
//
// Остальное (variants list, mark-dialog, schedule-cancel) — на лету через
// pomodoro-core.mjs или прямую правку файла. Не дублируем в CLI.
//
// Usage:
//   node scripts/timer.mjs start --user <key> [--mode pomodoro|focus] [--variant classic|long|extended|short] [--shorthand 30/60] [--duration N] [--task task-001]
//   node scripts/timer.mjs status --user <key>
//   node scripts/timer.mjs skip --user <key>
//   node scripts/timer.mjs stop --user <key>
//   node scripts/timer.mjs credit --user <key> [--date YYYY-MM-DD] [--task-id t_001]
//   node scripts/timer.mjs again --user <key> [--duration N] [--task task-001]
//   node scripts/timer.mjs stats --user <key>
//   node scripts/timer.mjs schedule --user <key> [--plan | --from HH:MM --to HH:MM | --hours N] [--variant ...] [--topic ...]
//   node scripts/timer.mjs schedule-confirm --user <key>
//
// Storage: users/<key>/timer/ (preferred). Fallback: users/<key>/pomodoro/ (legacy).


import path from "node:path";
import fs from "node:fs";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  readJson,
  writeJson,
  out,
  die,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus } from "./lib/profile.mjs";
import { resolveTimerDir } from "./lib/timer-dir.mjs";
import { addTimeSpentMinutes, markTaskDone } from "./lib/tasks-core.mjs";
import { resolveToday } from "./lib/dates.mjs";
import { creditPlanTask } from "./lib/plan-task-core.mjs";
import { normalizePlan } from "./lib/plan-utils.mjs";
import { hookTimerCredit } from "./lib/kg-hooks.mjs";
import {
  parseVariantInput,
  cmdStart,
  cmdStatus,
  cmdSkip,
  cmdStop,
  cmdStats,
  cmdSchedule,
  cmdScheduleConfirm,
  nowISO,
} from "./lib/pomodoro-core.mjs";

const { cmd, opts } = parseArgs(process.argv);
if (!cmd) die("missing command: start|status|skip|stop|credit|again|stats|schedule|schedule-confirm");

const userKey = requireUser(opts);
const dir = userDir(userKey);
const effectiveDir = resolveTimerDir(dir);

const { exists, profile } = loadProfile(dir, (p) => readText(p));
if (!exists) die("profile not found");
if (getSetupStatus(profile) !== "complete") die("setup_status not complete");

function parsedVariant() {
  let variant = opts.variant;
  let work = opts.work;
  let brk = opts.break;
  if (opts.shorthand) {
    const [w, b] = String(opts.shorthand).split("/");
    work = w;
    brk = b;
    variant = "custom";
  }
  const p = parseVariantInput(variant, work, brk);
  if (!p.ok) {
    out({ ok: false, error: "custom_invalid", message: "Кастомные тайминги: работа 1–240 мин, отдых 1–60 мин." });
    process.exit(0);
  }
  return p;
}

function isFocus(dir) {
  const s = readJson(path.join(dir, "session.json"), null);
  return s && s.mode === "focus";
}

// === Focus mode (single task session with praise) ===

function startFocus(dir, opts) {
  const duration = Number(opts.duration || 25);
  if (!Number.isInteger(duration) || duration < 1 || duration > 240) {
    return { ok: false, error: "invalid_duration", message: "Длительность: 1–240 мин." };
  }
  const existing = readJson(path.join(dir, "session.json"), null);
  if (existing && (existing.phase === "focus" || ["work", "break", "long_break"].includes(existing.phase))) {
    return { ok: false, error: "session_active", message: "Сессия уже идёт." };
  }
  const session = {
    schema: "openclaw.timer.focus.v1",
    mode: "focus",
    phase: "focus",
    phase_started_at: nowISO(),
    phase_duration_minutes: duration,
    task_id: opts.task || null,
    started_at: nowISO(),
    dialog_opened: existing?.dialog_opened !== false,
  };
  writeJson(path.join(dir, "session.json"), session);
  const taskNote = opts.task ? ` над ${opts.task}` : "";
  return {
    ok: true,
    action: "started",
    mode: "focus",
    message: `🎯 Фокус-сессия${taskNote}: ${duration} мин. Погнали! «стоп» — завершить.`,
    buttons: null,
    summary: `Focus запущен (${duration} мин).`,
  };
}

function statusFocus(dir) {
  const s = readJson(path.join(dir, "session.json"), null);
  if (!s || s.mode !== "focus" || s.phase !== "focus") {
    return { ok: true, active: false, message: "Нет активной сессии. `/timer start` или `/timer start focus` — начать." };
  }
  const elapsed = Math.max(0, Math.ceil((Date.parse(nowISO()) - Date.parse(s.phase_started_at)) / 60000));
  const left = Math.max(0, s.phase_duration_minutes - elapsed);
  return {
    ok: true,
    active: true,
    mode: "focus",
    message: `🎯 Фокус: ${elapsed}/${s.phase_duration_minutes} мин (осталось ~${left}). «стоп» — завершить.`,
    buttons: null,
  };
}

function loadLastStoppedFocus(dir) {
  const session = readJson(path.join(dir, "session.json"), null);
  if (!session || session.mode !== "focus" || session.phase !== "stopped") return null;
  return session;
}

function creditFocus(timerDir, userDirPath, opts) {
  const session = loadLastStoppedFocus(timerDir);
  if (!session) {
    return {
      ok: false,
      error: "no_stopped_focus",
      message: "Нет завершённой focus-сессии. Сначала «стоп» или дождись таймера.",
    };
  }
  if (session.credit_applied) {
    return {
      ok: false,
      error: "already_credited",
      message: "Уже засчитал эту сессию. Напиши **ещё** — запущу новую.",
    };
  }

  const taskId = opts.task || opts["task-id"] || session.task_id;
  const date = resolveToday(opts);
  const credited = [];

  if (taskId && /^t_\d+$/i.test(String(taskId))) {
    const planPath = path.join(userDirPath, "plans", `${date}.json`);
    if (fs.existsSync(planPath)) {
      const plan = readJson(planPath, null);
      normalizePlan(plan);
      const planCredit = creditPlanTask(plan, taskId);
      if (planCredit.ok) {
        writeJson(planPath, planCredit.plan);
        credited.push({ target: "daily_plan", task_id: taskId, message: planCredit.message });
      }
    }
  }

  if (taskId) {
    const yamlCredit = markTaskDone(userDirPath, taskId);
    if (yamlCredit.ok && !yamlCredit.already) {
      credited.push({ target: "tasks_yaml", task_id: taskId });
    }
  }

  session.credit_applied = true;
  writeJson(path.join(timerDir, "session.json"), session);

  const mins =
    session.credited_minutes || session.elapsed_minutes || session.phase_duration_minutes || 0;
  const planMsg = credited.find((c) => c.message)?.message;

  let kg = null;
  try {
    kg = hookTimerCredit(userDirPath, {
      topic: session.window_topic || session.task_title,
      minutes: mins,
      taskId: taskId || session.task_id,
      mode: session.mode || "focus",
    });
  } catch {
    kg = { ok: false, error: "kg_hook_failed" };
  }

  return {
    ok: true,
    action: "credited",
    mode: "focus",
    task_id: taskId || null,
    minutes: mins,
    credited,
    kg,
    message: planMsg || `Засчитал ${mins} мин фокуса.`,
    summary: `Focus засчитан (${mins} мин).`,
  };
}

function againFocus(timerDir, opts) {
  const session = loadLastStoppedFocus(timerDir);
  if (!session) {
    return {
      ok: false,
      error: "no_stopped_focus",
      message: "Сначала заверши focus-сессию («стоп» или дождись таймера).",
    };
  }
  const duration = Number(opts.duration || session.phase_duration_minutes || 25);
  const task = opts.task || session.task_id || null;
  return startFocus(timerDir, { duration, task });
}

function stopFocus(dir) {
  const sp = path.join(dir, "session.json");
  const session = readJson(sp, null);
  if (!session || session.mode !== "focus" || session.phase !== "focus") {
    return { ok: false, error: "no_focus_session" };
  }
  const elapsed = Math.max(0, Math.ceil((Date.parse(nowISO()) - Date.parse(session.phase_started_at)) / 60000));
  const planned = session.phase_duration_minutes;
  const credited = Math.min(planned, elapsed);
  session.phase = "stopped";
  session.ended_at = nowISO();
  session.ended_reason = "user_stopped";
  session.credited_minutes = credited;
  session.elapsed_minutes = elapsed;
  writeJson(sp, session);
  if (session.task_id && credited > 0) {
    addTimeSpentMinutes(dir, session.task_id, credited);
  }
  return {
    ok: true,
    action: "stopped",
    mode: "focus",
    message: `Молодец! 🎉 Занимался ${elapsed} мин${session.task_id ? ` над ${session.task_id}` : ""}. Напиши **засчитать** или **ещё**.`,
    buttons: null,
    summary: `Focus завершён (${elapsed} мин).`,
  };
}

// === Dispatch ===

let result;
switch (cmd) {
  case "start": {
    const mode = opts.mode || "pomodoro";
    if (mode === "focus") result = startFocus(effectiveDir, opts);
    else if (mode === "pomodoro") result = cmdStart(effectiveDir, parsedVariant(), { require_dialog: true });
    else die("mode must be pomodoro|focus");
    break;
  }
  case "status":
    if (isFocus(effectiveDir)) result = statusFocus(effectiveDir);
    else result = cmdStatus(effectiveDir);
    break;
  case "skip":
    if (isFocus(effectiveDir)) result = { ok: false, error: "no_skip_for_focus" };
    else result = cmdSkip(effectiveDir);
    break;
  case "stop":
    if (isFocus(effectiveDir)) result = stopFocus(effectiveDir);
    else result = cmdStop(effectiveDir);
    break;
  case "credit":
    result = creditFocus(effectiveDir, dir, opts);
    break;
  case "again":
    result = againFocus(effectiveDir, opts);
    break;
  case "stats":
    result = cmdStats(effectiveDir);
    break;
  case "schedule":
    result = cmdSchedule(effectiveDir, dir, parsedVariant(), {
      plan: opts.plan === "true",
      from: opts.from,
      to: opts.to,
      hours: opts.hours,
      topic: opts.topic,
      date: opts.date,
    });
    break;
  case "schedule-confirm":
    result = cmdScheduleConfirm(effectiveDir);
    break;
  default:
    die("unknown command", { cmd });
}

out(result);
if (result.ok === false && result.error && !result.message) process.exit(1);
