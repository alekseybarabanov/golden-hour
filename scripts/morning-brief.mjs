#!/usr/bin/env node
// morning-brief.mjs — утренний бриф для всех активных пользователей (без LLM).
//
// Usage: node scripts/morning-brief.mjs [--date YYYY-MM-DD] [--dry-run] [--grace-minutes N]
//
// Output: { ok, results: [{ user_key, notifications: [{ message }] }] }
// Учитывает profile.morning_brief_time (default 09:00) и .delivery-state-*.json.

import fs from "node:fs";
import path from "node:path";
import { parseArgs, readText, readJson, writeJson, out } from "./lib/cli.mjs";
import { listActiveUsers } from "./lib/users.mjs";
import { resolveToday } from "./lib/dates.mjs";
import { materialsForToday } from "./lib/goal-materials-core.mjs";
import { isCronSlot, mskNowParts } from "./lib/task-pings-core.mjs";
import {
  deliveryStatePath,
  wasDelivered,
  markDelivered,
} from "./lib/delivery-state.mjs";
import { isOpenTask } from "./lib/plan-utils.mjs";

const { opts } = parseArgs(process.argv);
const date = resolveToday(opts);
const dryRun = opts["dry-run"] === "true";
const graceMinutes = Number(opts["grace-minutes"] || 7);
const now = mskNowParts();

function formatTime(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : iso;
}

function buildBrief(profile, plan, materials) {
  const name = profile.name || "друг";
  const tasks = (plan?.tasks || []).filter((t) => isOpenTask(t));
  const topic = plan?.meta?.topic || plan?.goals?.[0]?.title || "подготовка";
  const load = plan?.load;
  const loadStr = load ? `${load.sum_difficulty}/${load.budget}` : "—";

  const lines = [
    `🌅 Доброе утро, *${name}*!`,
    "",
    `📅 *${date}* — ${topic}`,
    `📊 Нагрузка: ${loadStr}`,
    "",
  ];

  if (tasks.length) {
    lines.push("*Задачи:*");
    for (const t of tasks.slice(0, 8)) {
      lines.push(`• ${formatTime(t.scheduled_at)} — ${t.title} (~${t.est_minutes || "?"} мин)`);
    }
    if (tasks.length > 8) lines.push(`… и ещё ${tasks.length - 8}`);
  } else {
    lines.push("Задач в плане нет — напиши «спланируй день».");
  }

  if (materials?.count > 0) {
    lines.push("", `📚 Материалов по теме: *${materials.count}* — «дай материалы»`);
  }

  lines.push("", "Удачного дня! 🌅", "", "Когда готов — напиши *начинаю*.");

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
    summary: `Бриф только для сегодня (${now.date}), передан --date ${date}.`,
  });
  process.exit(0);
}

for (const { user_key, dir, profile } of listActiveUsers((p) => readText(p))) {
  const briefTime = profile.morning_brief_time || "09:00";
  if (!isCronSlot(now.hour, now.minute, briefTime, graceMinutes)) {
    results.push({
      user_key,
      ok: true,
      skipped: true,
      reason: "not_brief_time",
      morning_brief_time: briefTime,
    });
    continue;
  }

  const plansDir = path.join(dir, "plans");
  const deliveryPath = deliveryStatePath(plansDir, date);
  let deliveryState = readJson(deliveryPath, { date, delivered: {} });
  if (wasDelivered(deliveryState, "morning-brief")) {
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
      ok: false,
      skipped: true,
      reason: "no_plan",
    });
    continue;
  }

  const plan = readJson(planPath, null);
  const materials = materialsForToday(dir, profile, date);
  const message = buildBrief(profile, plan, materials);

  let notifications = [];
  if (!dryRun) {
    deliveryState = markDelivered(deliveryState, "morning-brief", now.iso);
    deliveryState.date = date;
    writeJson(deliveryPath, deliveryState);
    notifications = [{ template: "morning-brief", message }];
  }

  results.push({
    user_key,
    ok: true,
    notifications,
    materials_count: materials.count,
  });
}

const sent = results.filter((r) => r.notifications?.length).length;
const skipped = results.filter((r) => r.skipped).length;

out({
  ok: true,
  date,
  dry_run: dryRun,
  briefs: sent,
  skipped,
  results,
  summary:
    dryRun
      ? `Dry-run: ${results.filter((r) => r.ok && !r.skipped).length} бриф(ов) готовы к отправке.`
      : sent > 0
        ? `Утренний бриф: ${sent} пользовател(ей).`
        : skipped > 0
          ? `Бриф пропущен (${skipped} пользовател(ей)).`
          : "Нет активных пользователей для брифа.",
});
