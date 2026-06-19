// task-weighting — eff_priority and eff_difficulty (skills/task-weighting).

import { daysBetween } from "./dates.mjs";

const WEAK = new Set([
  "zero",
  "weak",
  "с нуля",
  "новичок",
  "beginner",
  "слабо",
  "слабый",
]);

const STRONG = new Set([
  "strong",
  "expert",
  "продвинутый",
  "топ",
  "уверенно",
  "отлично",
  "advanced",
]);

const MEDIUM = new Set(["medium", "средне", "средний", "average"]);

export function normalizeLevel(level) {
  if (level == null) return "medium";
  const s = String(level).toLowerCase().trim();
  if (WEAK.has(s)) return "weak";
  if (STRONG.has(s)) return "strong";
  if (MEDIUM.has(s)) return "medium";
  return s;
}

export function isWeakLevel(level) {
  return WEAK.has(String(level).toLowerCase().trim()) || normalizeLevel(level) === "weak";
}

export function isStrongLevel(level) {
  return STRONG.has(String(level).toLowerCase().trim()) || normalizeLevel(level) === "strong";
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function deadlineBoost(deadline, today) {
  if (!deadline) return 0;
  const days = daysBetween(today, deadline.length === 7 ? `${deadline}-01` : deadline);
  if (days == null) return 0;
  const weeks = days / 7;
  if (weeks < 3) return 2;
  if (weeks < 8) return 1;
  return 0;
}

export function getDailyBudget(dailyLoad, hoursToday = null) {
  const map = { light: 6, normal: 9, intense: 12 };
  let base = map[String(dailyLoad || "normal").toLowerCase()] ?? 9;
  if (hoursToday != null && hoursToday < 1.5) base = Math.max(4, base - 3);
  else if (hoursToday != null && hoursToday < 2) base = Math.max(6, base - 2);
  return base;
}

import { topicField, matchTopicKey } from "./profile.mjs";

export function topicLevel(profile, title) {
  return (
    topicField(profile, title, "exam_topic_levels") ??
    topicField(profile, title, "olympiad_levels") ??
    topicField(profile, title, "olympiad_topic_levels") ??
    topicField(profile, title, "topic_sublevels")
  );
}

export function basePriority(topic, profile) {
  const priorities = profile.priorities || {};
  const key = matchTopicKey(topic, priorities);
  if (key && priorities[key] != null) return Number(priorities[key]);
  return 3;
}

export function baseDifficulty(topic, profile, level) {
  const diff = profile.difficulty || {};
  const key = matchTopicKey(topic, diff);
  if (key && diff[key] != null) return Number(diff[key]);
  return 3;
}

export function computeEffPriority(topic, profile, today) {
  const level = topicLevel(profile, topic);
  const base = basePriority(topic, profile);
  const dBoost = deadlineBoost(profile.deadline, today);
  const wBoost = isWeakLevel(level) ? 1 : 0;
  return clamp(base + dBoost + wBoost, 1, 5);
}

export function computeEffDifficulty(topic, profile, levelHint) {
  const level = levelHint ?? topicLevel(profile, topic);
  const base = baseDifficulty(topic, profile, level);
  let adj = 0;
  if (isWeakLevel(level)) adj = 1;
  else if (isStrongLevel(level)) adj = -1;
  return clamp(base + adj, 1, 5);
}

export function weightTopic(title, profile, today, opts = {}) {
  const level = opts.level ?? topicLevel(profile, title);
  const eff_priority = opts.eff_priority ?? computeEffPriority(title, profile, today);
  const eff_difficulty =
    opts.eff_difficulty ?? computeEffDifficulty(title, profile, level);
  return {
    title,
    level: normalizeLevel(level),
    eff_priority,
    eff_difficulty,
    est_minutes: opts.est_minutes ?? defaultMinutes(eff_priority, profile.hours_per_week),
    kind: opts.kind || "study",
    tag: opts.tag || null,
  };
}

function defaultMinutes(priority, hoursPerWeek) {
  const hpw = Number(hoursPerWeek) || 7;
  const dailyHours = hpw / 5;
  if (priority >= 5) return dailyHours >= 2 ? 90 : 60;
  if (priority >= 4) return 60;
  return 45;
}

export function weightTopics(topics, profile, today) {
  return topics.map((t) => {
    if (typeof t === "string") return weightTopic(t, profile, today);
    return weightTopic(t.title, profile, today, t);
  });
}

export function sortByPriority(items) {
  return [...items].sort((a, b) => {
    if (b.eff_priority !== a.eff_priority) return b.eff_priority - a.eff_priority;
    if (b.eff_difficulty !== a.eff_difficulty) return a.eff_difficulty - b.eff_difficulty;
    return 0;
  });
}
