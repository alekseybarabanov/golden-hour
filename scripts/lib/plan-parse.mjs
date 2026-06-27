// Parse users/<user_key>/plan.md

import fs from "node:fs";
import path from "node:path";
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

function parsePlanTopicsTable(text) {
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
    const hoursCell = cells[3] || cells.find((c) => /~\d/.test(c)) || cells[4];
    const hoursRaw = hoursCell?.replace(/[^\d.]/g, "") || "";
    const hours = hoursRaw ? Number(hoursRaw) : null;
    const rangeCells = cells.filter((c) => /\d+\s*[–\-—]\s*\d+/.test(c));
    const weeksCol = rangeCells.length
      ? rangeCells[rangeCells.length - 1]
      : cells[4] || cells[5];
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

/** Sprint plans: `## Дневной скелет` with `### День N` blocks. */
export function parseSprintTopics(text) {
  const lines = text.split("\n");
  const topics = [];
  let inSkeleton = false;
  let dayNum = 0;

  for (const line of lines) {
    if (/^##\s+Дневной\s+скелет/i.test(line)) {
      inSkeleton = true;
      continue;
    }
    if (inSkeleton && /^##\s+/.test(line) && !/^###/.test(line)) break;
    if (!inSkeleton) continue;

    const dayHdr = line.match(/^###\s+День\s+(\d+)/i);
    if (dayHdr) {
      dayNum = +dayHdr[1];
      continue;
    }

    const item = line.match(/^\d+\.\s+\*\*([^*]+)\*\*\s*\((\d+(?:\.\d+)?)\s*ч\)/);
    if (!item || !dayNum) continue;

    topics.push({
      num: topics.length + 1,
      title: item[1].trim(),
      level: "medium",
      hours: +item[2],
      weeks: { start: dayNum, end: dayNum },
      difficulty: 3,
    });
  }

  return topics;
}

export function parsePlanTopics(text) {
  const tableTopics = parsePlanTopicsTable(text);
  if (tableTopics.length) return tableTopics;
  return parseSprintTopics(text);
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

  const deadline = text.match(/(?:Дедлайн|Собеседование):\s*\*?\*?(\d{4}-\d{2}(?:-\d{2})?)/i);
  if (deadline) meta.deadline = deadline[1];

  const days = text.match(/Дней до дедлайна:\s*\*?\*?(\d+)/i);
  if (days) meta.totalDays = +days[1];

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
  const sprintTopics = parseSprintTopics(planText);
  if (sprintTopics.length && meta.created) {
    const day = daysBetween(meta.created, today);
    if (day != null && day >= 0) return day + 1;
  }

  let start = meta.planStart || meta.created;
  if (!start) return 1;

  const days = daysBetween(start, today);
  if (days == null || days < 0) return 1;
  return Math.floor(days / 7) + 1;
}

export function topicForWeek(topics, weekNum) {
  const inRange = topics.filter(
    (t) => t.weeks && weekNum >= t.weeks.start && weekNum <= t.weeks.end
  );
  if (inRange.length > 1) {
    return {
      title: inRange.map((t) => t.title).join("; "),
      level: inRange[0].level,
      hours: inRange.reduce((s, t) => s + (t.hours || 0), 0),
      weeks: { start: weekNum, end: weekNum },
      difficulty: Math.max(...inRange.map((t) => t.difficulty || 3)),
      _sprintItems: inRange,
    };
  }
  if (inRange.length === 1) return inRange[0];

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

/** Resolve macro-plan file for user (supports multi-purpose via profile.plan_files). */
export function resolvePlanPath(userDirPath, profile, { purpose } = {}) {
  const activePurpose = purpose || profile?.purpose || "exam";
  const map = profile?.plan_files;
  if (map && typeof map === "object" && map[activePurpose]) {
    return path.join(userDirPath, map[activePurpose]);
  }
  const named = path.join(userDirPath, `plan-${activePurpose}.md`);
  if (fs.existsSync(named)) return named;
  const legacy = path.join(userDirPath, "plans", `${activePurpose}-plan.md`);
  if (fs.existsSync(legacy)) return legacy;
  return path.join(userDirPath, "plan.md");
}
