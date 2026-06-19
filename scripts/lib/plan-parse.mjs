// Parse users/<user_key>/plan.md

import { parseDateOnly, daysBetween, todayISO } from "./dates.mjs";

function parseWeekRange(s) {
  if (!s) return null;
  const clean = String(s).replace(/\*\*/g, "").trim();
  const m = clean.match(/(\d+)\s*[–\-—]\s*(\d+)/);
  if (m) return { start: +m[1], end: +m[2] };
  const single = clean.match(/^(\d+)$/);
  if (single) return { start: +single[1], end: +single[1] };
  const decimal = clean.match(/^(\d+)\.(\d+)$/);
  if (decimal) {
    const w = +decimal[1];
  return { start: w, end: w };
  }
  return null;
}

function parseTableRow(line) {
  if (!line.startsWith("|")) return null;
  if (/^\|[\s\-:|]+\|$/.test(line.replace(/\s/g, ""))) return null;
  const cells = line
    .split("|")
    .map((c) => c.trim())
    .filter((_, i, arr) => i > 0 && i < arr.length - 1);
  return cells.length ? cells : null;
}

export function parsePlanTopics(text) {
  const lines = text.split("\n");
  const topics = [];
  let inTopics = false;

  for (const line of lines) {
    if (/^##\s+Темы/i.test(line)) {
      inTopics = true;
      continue;
    }
    if (inTopics && /^##\s+/.test(line)) break;
    if (!inTopics) continue;

    const cells = parseTableRow(line);
    if (!cells || cells.length < 4) continue;
    if (cells[0] === "#" || cells[0].toLowerCase() === "тема") continue;
    if (cells[0] === "—" || cells[0].startsWith("**")) continue;

    const num = cells[0].replace(/\D/g, "");
    const title = cells[1].replace(/\*\*/g, "").trim();
    const level = cells[2]?.replace(/\*\*/g, "").trim() || "medium";
    const hoursRaw = cells[3]?.replace(/[^\d.]/g, "") || "";
    const hours = hoursRaw ? Number(hoursRaw) : null;
    const weeksCol = cells.find((c) => /\d+\s*[–\-—]/.test(c)) || cells[4];
    const weeks = parseWeekRange(weeksCol);
    const difficultyCol = cells[cells.length - 1];
    let difficulty = 3;
    if (/^\d$/.test(difficultyCol)) difficulty = +difficultyCol;
    else if (/микс/i.test(difficultyCol)) difficulty = 3;

    if (!title || title === "Тема") continue;
    topics.push({
      num: num ? +num : topics.length + 1,
      title,
      level,
      hours,
      weeks,
      difficulty,
    });
  }

  return topics;
}

export function parsePlanMeta(text) {
  const meta = {
    created: null,
    deadline: null,
    hoursPerWeek: null,
    totalWeeks: null,
    planStart: null,
    dailyLoad: null,
  };

  const created = text.match(/Создан:\s*(\d{4}-\d{2}-\d{2})/i);
  if (created) meta.created = created[1];

  const deadline = text.match(/Дедлайн:\s*\*?\*?(\d{4}-\d{2}(?:-\d{2})?)/i);
  if (deadline) meta.deadline = deadline[1];

  const hpw = text.match(/(\d+(?:\.\d+)?)\s*ч\/нед/i);
  if (hpw) meta.hoursPerWeek = +hpw[1];

  const weeks = text.match(/Недель до дедлайна:\s*\*?\*?(\d+)/i);
  if (weeks) meta.totalWeeks = +weeks[1];

  const start = text.match(/Старт:\s*(\d{4}-\d{2}-\d{2})/i);
  if (start) meta.planStart = start[1];

  const load = text.match(/бюджет дня:\s*(\d+)/i);
  if (load) meta.dailyLoadBudget = +load[1];

  const intense = text.match(/Темп:\s*\*\*(\w+)\*\*/i);
  if (intense) meta.dailyLoad = intense[1].toLowerCase();

  return meta;
}

export function currentWeekNumber(planText, today) {
  const meta = parsePlanMeta(planText);
  let start = meta.planStart || meta.created;
  if (!start) return 1;

  const days = daysBetween(start, today);
  if (days == null || days < 0) return 1;
  return Math.floor(days / 7) + 1;
}

export function topicForWeek(topics, weekNum) {
  for (const t of topics) {
    if (!t.weeks) continue;
    if (weekNum >= t.weeks.start && weekNum <= t.weeks.end) return t;
  }
  if (topics.length && weekNum > 0) {
    const last = topics[topics.length - 1];
    if (last.weeks && weekNum > last.weeks.end) return last;
    return topics[0];
  }
  return null;
}

export function getCurrentPlanTopic(planText, today = todayISO()) {
  const topics = parsePlanTopics(planText);
  const week = currentWeekNumber(planText, today);
  const topic = topicForWeek(topics, week);
  return { topics, week, topic };
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "topic";
}
