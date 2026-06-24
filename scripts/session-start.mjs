#!/usr/bin/env node
// session-start.mjs — determine user phase and profile snapshot.
//
// Usage:
//   node scripts/session-start.mjs --user <user_key> [--telegram-id N] [--username @x] [--group <chat_id>]
//   node scripts/session-start.mjs --owner   # принудительно user_key=owner (для webchat)
//
// Output: { ok, status, profile_summary, paths, actions, proactive_message }

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE,
  parseArgs,
  requireUser,
  userDir,
  readText,
  relWorkspacePath,
  out,
  die,
} from "./lib/cli.mjs";
import {
  loadProfile,
  getSetupStatus,
  getTopicsFromProfile,
} from "./lib/profile.mjs";
import { kgDir } from "./lib/temporal-kg-core.mjs";
import { resolvePendingInvites } from "./lib/team-tasks.mjs";
import { groupContext, resolvePendingGroupInvites } from "./lib/group-core.mjs";
import {
  detectCurrentStep,
  buildOnboardingProgress,
  getOnboardingPrompt,
} from "./lib/onboarding.mjs";
import { materialsForToday } from "./lib/goal-materials-core.mjs";
import { todayISO } from "./lib/dates.mjs";

const { opts } = parseArgs(process.argv);
// --owner: владелец через webchat (принудительно user_key=owner)
const userKey = opts.owner === "true" ? "owner" : requireUser(opts);
const dir = userDir(userKey);
const { exists, profile } = loadProfile(dir, (p) => readText(p));

const telegramId = opts["telegram-id"] || opts.telegramId || null;
const telegramUsername = opts.username || null;
const groupChatId = opts.group || opts["chat-id"] || opts.chatId || null;

function resolveGroupInvites() {
  if (!telegramId && !telegramUsername) return null;
  try {
    return resolvePendingGroupInvites({
      userKey,
      chatId: groupChatId,
      telegramId: telegramId ? Number(telegramId) : null,
      username: telegramUsername,
    });
  } catch {
    return { count: 0, resolved: [], error: true };
  }
}

function resolveTeamInvites() {
  if (!telegramId && !telegramUsername) return null;
  try {
    return resolvePendingInvites({
      userKey,
      telegramId: telegramId ? Number(telegramId) : null,
      username: telegramUsername,
    });
  } catch {
    return { accepted: [], count: 0, error: true };
  }
}

const teamInvitesResolveCmd =
  telegramId || telegramUsername
    ? `node scripts/team-tasks.mjs invites resolve --user ${userKey}${telegramId ? ` --telegram-id ${telegramId}` : ""}${telegramUsername ? ` --username ${telegramUsername}` : ""}`
    : null;

const groupInvitesResolveCmd =
  telegramId || telegramUsername
    ? `node scripts/group-invites-resolve.mjs --user ${userKey}${groupChatId ? ` --chat-id ${groupChatId}` : ""}${telegramId ? ` --telegram-id ${telegramId}` : ""}${telegramUsername ? ` --username ${telegramUsername}` : ""}`
    : null;

// Owner detection: user_key === "owner" (или начинается с "owner-")
const isOwner = userKey === "owner" || userKey.startsWith("owner-");

function countActiveUsers() {
  const usersRoot = path.join(WORKSPACE, "users");
  if (!fs.existsSync(usersRoot)) return { total: 0, complete: 0 };
  let total = 0;
  let complete = 0;
  for (const name of fs.readdirSync(usersRoot)) {
    if (name.startsWith("_") || name.startsWith("archive-")) continue;
    total++;
    const pdir = path.join(usersRoot, name);
    const { profile } = loadProfile(pdir, (p) => readText(p));
    if (getSetupStatus(profile) === "complete") complete++;
  }
  return { total, complete };
}

function runTestSummary() {
  if (process.env.GH_OWNER_TESTS !== "1") return "run GH_OWNER_TESTS=1 to test";
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [path.join(scriptDir, "run-tests.mjs")], {
    cwd: WORKSPACE,
    encoding: "utf8",
  });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("Tests:")) || "";
  const m = line.match(/(\d+) passed,\s*(\d+) failed/);
  if (!m) return r.status === 0 ? "passed" : "failed";
  return `${m[1]}/${Number(m[1]) + Number(m[2])} passed`;
}

function buildProactiveMessage(scenario, context) {
  switch (scenario) {
    case "A":
      return {
        scenario: "A_new",
        title: "Привет",
        template:
          "🌅 Привет! Я — **Золотой час**, планировщик подготовки к олимпиадам и экзаменам.\n\n" +
          "Помогу с планом, прогрессом и напоминаниями. Что изучаем? Можно сразу написать, как тебя зовут.\n\n" +
          "1. **Экзамен** — ЕГЭ / ОГЭ / вступительные\n" +
          "2. **Олимпиада** — ВсОШ / перечневая\n" +
          "3. **Тема** — конкретная без дедлайна\n\n" +
          "Цифра или слово.",
      };
    case "B":
      return {
        scenario: "B_returning",
        title: "С возвращением",
        template:
          "🌅 С возвращением, **<name>**!\n\n" +
          "Помню: <purpose> — <subject>, дедлайн <deadline>, <hours_per_week> ч/нед.\n\n" +
          "1. **Продолжить** — загружу профиль и план, идём дальше\n" +
          "2. **Настроить заново** — начнём с нуля (старое уйдёт в архив)\n\n" +
          "Цифра или слово.",
      };
    case "C":
      return {
        scenario: "C_in_progress",
        title: "Продолжаем настройку",
        template:
          "🌅 Привет снова, **<name>**! Мы не закончили настройку — остановились на шаге <step-number>: <step-name>.\n\n" +
          "Заполнено: <filled>\n" +
          "⏳ Осталось: <missing>\n\n" +
          "1. **Продолжить настройку** — с того места, где остановились\n" +
          "2. **Начать заново** — архив и с чистого листа\n\n" +
          "Цифра или слово.",
      };
    case "D":
      return {
        scenario: "D_owner",
        title: "Владелец",
        template:
          "🌅 Владелец. Сводка:\n\n" +
          "🧪 Tests: <tests>\n" +
          "📊 Users: <users-summary>\n\n" +
          "Что делаем? (drift/proposals — soul-guardian, owner-profile)",
      };
    default:
      return null;
  }
}

if (!exists) {
  const team_invites = resolveTeamInvites();
  const group_invites = resolveGroupInvites();
  const proactive_message = buildProactiveMessage("A", { user_key: userKey });
  out({
    user_key: userKey,
    status: "new",
    setup_status: "new",
    action: "onboarding",
    message: "Новый пользователь — запустить hello-intro",
    proactive_message,
    paths: { profile: relWorkspacePath(path.join(dir, "profile.md")) },
    team_invites,
    team_invites_resolve_cmd: teamInvitesResolveCmd,
    group_invites,
    group_invites_resolve_cmd: groupInvitesResolveCmd,
    group: groupChatId ? groupContext(groupChatId, userKey) : null,
  });
  process.exit(0);
}

const setupStatus = getSetupStatus(profile);
const topics = getTopicsFromProfile(profile);

const summary = {
  name: profile.name,
  purpose: profile.purpose,
  deadline: profile.deadline,
  hours_per_week: profile.hours_per_week,
  daily_load: profile.daily_load,
  topic_count: topics.length,
};

let action = "onboarding";
if (setupStatus === "complete") action = "menu_continue_or_reset";
else if (setupStatus === "in_progress") action = "resume_setup_or_reset";

const files = {
  profile: relWorkspacePath(path.join(dir, "profile.md")),
  plan: readText(path.join(dir, "plan.md"))
    ? relWorkspacePath(path.join(dir, "plan.md"))
    : null,
  progress: readText(path.join(dir, "progress.md"))
    ? relWorkspacePath(path.join(dir, "progress.md"))
    : null,
  tasks: readText(path.join(dir, "tasks.md"))
    ? relWorkspacePath(path.join(dir, "tasks.md"))
    : null,
};

let kg_import_recommended = false;
if (setupStatus === "complete" && files.progress) {
  const ep = path.join(kgDir(dir), "events.jsonl");
  if (!fs.existsSync(ep) || !readText(ep, "").trim()) {
    kg_import_recommended = true;
  }
}

const team_invites = resolveTeamInvites();
const group_invites = resolveGroupInvites();

let materials_today = null;
let daily_plan_cmd = null;
const today = todayISO();
const todayPlanPath = path.join(dir, "plans", `${today}.json`);
if (setupStatus === "complete") {
  if (!readText(todayPlanPath)) {
    daily_plan_cmd = `node scripts/daily-plan.mjs --user ${userKey} --date ${today} --dry-run`;
  }
  const mt = materialsForToday(dir, profile, today);
  if (mt.count > 0) {
    materials_today = {
      count: mt.count,
      topic: mt.topic,
      cmd: `node scripts/goal-materials.mjs today --user ${userKey}`,
    };
  }
}

let onboarding_next = null;
if (setupStatus === "in_progress") {
  const step = detectCurrentStep(profile);
  onboarding_next = {
    step,
    prompt: getOnboardingPrompt(step),
  };
}

// Build proactive_message based on setup_status and user_key
let proactive_message = null;
if (isOwner) {
  proactive_message = buildProactiveMessage("D", { user_key: userKey });
  const users = countActiveUsers();
  const tests = runTestSummary();
  proactive_message.context = {
    tests,
    users_summary: `${users.complete} с настройкой / ${users.total} всего`,
  };
} else if (setupStatus === "complete") {
  // Scenario B: returning with complete profile
  const deadlineLabel =
    summary.deadline == null ? "без дедлайна" : summary.deadline;
  const c = {
    name: summary.name,
    purpose: summary.purpose,
    deadline: deadlineLabel,
    hours_per_week: summary.hours_per_week ?? "—",
    subject: topics[0]?.title || "предмет не указан",
  };
  proactive_message = buildProactiveMessage("B", c);
  proactive_message.context = c;
} else if (setupStatus === "in_progress") {
  const stepInfo = detectCurrentStep(profile);
  const { filled, missing } = buildOnboardingProgress(profile);
  proactive_message = buildProactiveMessage("C", {
    name: profile.name,
    step_number: stepInfo?.step || "?",
    step_name: stepInfo?.name || "?",
    filled: filled.join(", "),
    missing: missing.join(", "),
  });
  proactive_message.context = { step: stepInfo, filled, missing };
} else {
  // Unknown status — fallback to A
  proactive_message = buildProactiveMessage("A", { user_key: userKey });
}

out({
  user_key: userKey,
  status: setupStatus === "complete" ? "returning" : setupStatus,
  setup_status: setupStatus,
  action,
  profile_summary: summary,
  paths: files,
  kg_import_recommended,
  kg_import_cmd: kg_import_recommended
    ? `node scripts/temporal-kg.mjs import-progress --user ${userKey}`
    : null,
  team_invites,
  team_invites_resolve_cmd: teamInvitesResolveCmd,
  group_invites,
  group_invites_resolve_cmd: groupInvitesResolveCmd,
  group: groupChatId ? groupContext(groupChatId, userKey) : null,
  proactive_message,
  ...(setupStatus === "complete"
    ? {
        daily_plan_cmd,
        materials_today,
        materials_pick_cmd: `node scripts/goal-materials.mjs pick --user ${userKey}`,
      }
    : {}),
  ...(setupStatus === "in_progress" ? { onboarding_next } : {}),
});
