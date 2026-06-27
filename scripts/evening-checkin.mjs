#!/usr/bin/env node
// evening-checkin.mjs — вечерний чек-ин для всех активных пользователей (без LLM).
//
// Usage: node scripts/evening-checkin.mjs [--date YYYY-MM-DD] [--dry-run] [--grace-minutes N]
//
// Учитывает profile.evening_checkin_time (default 21:00). Без плана — пропуск (как morning-brief).

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readText, readJson, out } from "./lib/cli.mjs";
import { listActiveUsers } from "./lib/users.mjs";
import { resolveToday } from "./lib/dates.mjs";
import { isCronSlot, mskNowParts } from "./lib/task-pings-core.mjs";
import { deliveryStatePath, wasDelivered } from "./lib/delivery-state.mjs";
import { countDoneTasks } from "./lib/plan-utils.mjs";

const { opts } = parseArgs(process.argv);
const date = resolveToday(opts);
const dryRun = opts["dry-run"] === "true";
const graceMinutes = Number(opts["grace-minutes"] || 7);
const now = mskNowParts();

function buildCheckin(profile, plan) {
  const name = profile.name || "друг";
  const total = (plan?.tasks || []).length;
  const done = countDoneTasks(plan);

  const lines = [
    `🌙 *${name}*, как прошёл день?`,
    "",
    total > 0 ? `Сегодня в плане: ${done}/${total} закрыто.` : "План на сегодня не был сохранён.",
    "",
    "Что успел? Что переносим на завтра?",
    "",
    "Ответь текстом — без кнопок.",
  ];
  return lines.join("\n");
}

const results = [];

if (now.date !== date) {
  out({
    ok: true,
    date,
    dry_run: dryRun,
    skipped_reason: "date_mismatch_use_today",
    results: [],
    summary: `Чек-ин только для сегодня (${now.date}), передан --date ${date}.`,
  });
  process.exit(0);
}

for (const { user_key, dir, profile } of listActiveUsers((p) => readText(p))) {
  const checkinTime = profile.evening_checkin_time || "21:00";
  if (!isCronSlot(now.hour, now.minute, checkinTime, graceMinutes)) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "not_checkin_time",
      evening_checkin_time: checkinTime,
    });
    continue;
  }

  const plansDir = path.join(dir, "plans");
  const deliveryPath = deliveryStatePath(plansDir, date);
  const deliveryState = readJson(deliveryPath, { date, delivered: {} });
  if (wasDelivered(deliveryState, "evening-checkin")) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "already_sent",
    });
    continue;
  }

  const planPath = path.join(plansDir, `${date}.json`);
  if (!fs.existsSync(planPath)) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "no_plan",
    });
    continue;
  }

  const plan = readJson(planPath, null);
  const message = buildCheckin(profile, plan);

  const notifications = dryRun
    ? []
    : [{ template: "evening-checkin", message }];

  results.push({
    user_key,
    ok: true,
    has_plan: true,
    notifications,
  });
}

const count = results.filter((r) => r.notifications?.length).length;

out({
  ok: true,
  date,
  dry_run: dryRun,
  checkins: count,
  results,
  summary: `Вечерний чек-ин: ${count} пользовател(ей).`,
});

