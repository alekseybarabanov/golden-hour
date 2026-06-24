#!/usr/bin/env node

// longterm-stats.mjs — aggregate stats from tasks.yaml and daily plans.

//

// Usage:

//   node scripts/longterm-stats.mjs --user <user_key> [--period week|month|year|all]



import path from "node:path";

import fs from "node:fs";

import {

  parseArgs,

  requireUser,

  userDir,

  readText,

  readJson,

  out,

  die,

} from "./lib/cli.mjs";

import { loadProfile, getSetupStatus } from "./lib/profile.mjs";

import { resolveToday, daysBetween } from "./lib/dates.mjs";

import { kgPeriodStats } from "./lib/temporal-kg-core.mjs";

import { parseTasksYaml } from "./lib/tasks-core.mjs";
import { isTaskDone } from "./lib/plan-utils.mjs";

import { resolveTimerDir } from "./lib/timer-dir.mjs";



const PERIOD_DAYS = { week: 7, month: 30, year: 365, all: null };



function aggregatePlans(plansDir, since) {

  let minutes = 0;

  let done = 0;

  let planned = 0;

  if (!fs.existsSync(plansDir)) return { minutes, done, planned };



  for (const f of fs.readdirSync(plansDir)) {

    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;

    const date = f.replace(".json", "");

    if (since && date < since) continue;

    const plan = readJson(path.join(plansDir, f));

    if (!plan?.tasks) continue;

    for (const t of plan.tasks) {

      planned++;

      if (isTaskDone(t)) {

        done++;

        minutes += t.est_minutes || 0;

      }

    }

  }

  return { minutes, done, planned };

}



function weightProgress(tasks) {

  const active = tasks.filter((t) => t.status !== "done");

  const all = tasks.length ? tasks : [{ weight: 1, progress: 0 }];

  const sumW = all.reduce((s, t) => s + (t.weight || 1), 0);

  const sumWP = all.reduce((s, t) => s + (t.weight || 1) * (t.progress || 0), 0);

  return sumW ? Math.round(sumWP / sumW) : 0;

}



function timerWorkMinutes(stats, since) {

  if (!stats?.total_work_minutes_by_date) return 0;

  let total = 0;

  for (const [date, min] of Object.entries(stats.total_work_minutes_by_date)) {

    if (!since || date >= since) total += min;

  }

  return total;

}



function legacyFocusMinutes(focusDir, since) {

  if (!fs.existsSync(focusDir)) return 0;

  let total = 0;

  for (const f of fs.readdirSync(focusDir)) {

    if (!f.endsWith(".json")) continue;

    const s = readJson(path.join(focusDir, f));

    if (s?.total_minutes) total += s.total_minutes;

  }

  return total;

}



const { opts } = parseArgs(process.argv);

const userKey = requireUser(opts);

const period = opts.period || "week";

const today = resolveToday(opts);

const dir = userDir(userKey);



const { exists, profile } = loadProfile(dir, (p) => readText(p));

if (!exists) die("profile not found");

if (getSetupStatus(profile) !== "complete") die("setup_status not complete");



const days = PERIOD_DAYS[period] ?? 7;

const since = days ? (() => {

  const d = new Date(today + "T12:00:00Z");

  d.setUTCDate(d.getUTCDate() - days + 1);

  return d.toISOString().slice(0, 10);

})() : null;



const tasks = parseTasksYaml(readText(path.join(dir, "tasks.yaml"), ""));

const longTasks = tasks.filter(

  (t) =>

    t.task_type === "long" ||

    (t.deadline && daysBetween(today, t.deadline) > 7)

);



const planStats = aggregatePlans(path.join(dir, "plans"), since);



const timerDir = resolveTimerDir(dir, { autoMigrate: false });

const timerStats = readJson(path.join(timerDir, "stats.json"), null);

let timerMinutes = timerWorkMinutes(timerStats, since);



// Legacy focus/ only when unified timer stats are absent (avoid double-count)

let focusMinutes = 0;

if (!timerStats?.total_work_minutes_all_time) {

  focusMinutes = legacyFocusMinutes(path.join(dir, "focus"), since);

}



const hoursActual = Math.round((planStats.minutes + focusMinutes + timerMinutes) / 60 * 10) / 10;

const kgStats = kgPeriodStats(path.join(dir, "temporal-kg"), since, today);

const weightPct = weightProgress(tasks);



const kgPart =

  kgStats.event_count > 0

    ? `, ${kgStats.event_count} событий в графе (${kgStats.topics_active_in_period} тем)`

    : "";



out({

  user_key: userKey,

  period,

  since,

  today,

  tasks: {

    total: tasks.length,

    long_term: longTasks.length,

    weight_progress_pct: weightPct,

  },

  plans: planStats,

  focus_minutes: focusMinutes,

  timer_minutes: timerMinutes,

  pomodoro_minutes: timerMinutes,

  temporal_kg: kgStats,

  hours_actual: hoursActual,

  summary: `За ${period}: закрыто ${planStats.done}/${planStats.planned} слотов плана, ~${hoursActual} ч${kgPart}.`,

});

