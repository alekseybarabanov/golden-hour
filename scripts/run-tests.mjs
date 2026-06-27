#!/usr/bin/env node
// run-tests.mjs — unit tests

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseProfile, loadProfile, getSetupStatus, getPurposes, patchProfileMarkdown, formatProfileField, mergeProfile } from "./lib/profile.mjs";
import { isTaskOverdue, parseTasksYaml } from "./lib/tasks-core.mjs";
import { todayISO } from "./lib/dates.mjs";
import { parsePlanTopics, parseSprintTopics, getCurrentPlanTopic } from "./lib/plan-parse.mjs";
import { balanceDay } from "./lib/daily-balancer.mjs";
import { assignWeeks, buildStudyPlan } from "./lib/study-plan.mjs";
import {
  resolveGoalIds,
  primaryGoalId,
  addMaterial,
  listMaterials,
  rebuildIndex,
  normalizeFrontmatterText,
} from "./lib/goal-materials-core.mjs";
import {
  isQuietHours,
  selectDueTasks,
  wasPingedForTrigger,
  buildPingMessage,
  recordPing,
  isCronSlot,
  commitPingIfNew,
} from "./lib/task-pings-core.mjs";
import {
  normalizeAction,
  pickActiveTask,
  applyTaskAction,
  updatePlanTask,
  creditPlanTask,
} from "./lib/plan-task-core.mjs";
import { appendCheckin, computeStreak } from "./lib/progress-core.mjs";
import {
  normalizeTaskStatus,
  normalizePlan,
  isTaskDone,
  countDoneTasks,
} from "./lib/plan-utils.mjs";
import { wasDelivered, markDelivered } from "./lib/delivery-state.mjs";
import { detectCurrentStep, hasDeadline, hasExamTopics, hasExamTopicLevels } from "./lib/onboarding.mjs";
import { resolveCodifier, defaultTopicLevels } from "./lib/exam-topics-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

// --- profile parser ---
const mdProfile = parseProfile(`- **name:** "Тест"
- **setup_status:** complete
- **purpose:** exam`);
assert(mdProfile.name === "Тест", "markdown profile name");
assert(getSetupStatus(mdProfile) === "complete", "markdown setup_status");

const yamlProfile = parseProfile(`name: "Никита"
purpose: exam
exam_type: ege
exam_subject: history
setup_status: in_progress`);
assert(yamlProfile.name === "Никита", "yaml profile name");
assert(yamlProfile.exam_subject === "history", "yaml exam_subject");
assert(getSetupStatus(yamlProfile) === "in_progress", "yaml setup_status");

// --- dates (Europe/Moscow) ---
assert(/^\d{4}-\d{2}-\d{2}$/.test(todayISO()), "todayISO format");

// --- sprint plan parser ---
const sprintPlan = `# Plan
> Создан: 2026-06-24
## Дневной скелет
### День 1 — база
1. **Бином** (2 ч) — test
2. **GF** (2 ч) — test
### День 2 — advanced
3. **RSK** (2 ч) — test
`;
assert(parseSprintTopics(sprintPlan).length === 3, "sprint topics count");
const sprintTopic = getCurrentPlanTopic(sprintPlan, "2026-06-24");
assert(sprintTopic.topic?.title?.includes("Бином"), "sprint day 1 topic");

// --- onboarding step detection ---
const examMid = {
  name: "Аня",
  purpose: "exam",
  exam_type: "ege",
  exam_subject: "math",
  setup_status: "in_progress",
};
assert(detectCurrentStep(examMid)?.name === "exam-topics", "exam needs topics step");
assert(
  detectCurrentStep({ ...examMid, exam_topics: ["алгебра"] })?.name === "exam-self-assess",
  "exam needs levels after topics"
);
assert(
  detectCurrentStep({ ...examMid, exam_topics: [] })?.name === "exam-topics",
  "empty exam_topics blocks onboarding"
);
assert(
  detectCurrentStep({
    ...examMid,
    exam_topics: ["алгебра"],
    exam_topic_levels: {},
  })?.name === "exam-self-assess",
  "empty exam_topic_levels blocks onboarding"
);
assert(!hasExamTopics({ exam_topics: [] }), "hasExamTopics empty array");
assert(!hasExamTopicLevels({ exam_topic_levels: {} }), "hasExamTopicLevels empty map");
const olympiadLevelOnly = {
  name: "Боря",
  purpose: "olympiad",
  grade: 10,
  olympiad_subject: "math",
  olympiad_level: "medium",
};
assert(
  detectCurrentStep(olympiadLevelOnly)?.field === "deadline",
  "olympiad_level satisfies level step; next is deadline"
);
assert(
  detectCurrentStep({ ...olympiadLevelOnly, olympiad_level: undefined })?.name ===
    "olympiad-self-assess",
  "olympiad needs level"
);
assert(hasDeadline({ deadline: null }), "null deadline is set");
assert(!hasDeadline({}), "missing deadline");
assert(
  detectCurrentStep({
    name: "Вика",
    purpose: "topic",
    study_topic: "комбинаторика",
    topic_level: "medium",
    deadline: null,
  })?.field === "hours_per_week",
  "setup-finalize hours after deadline null"
);

const tmpProfileDir = path.join(WORKSPACE, ".test-profile-" + Date.now());
fs.mkdirSync(tmpProfileDir, { recursive: true });
fs.writeFileSync(
  path.join(tmpProfileDir, "profile.md"),
  'name: "Smoke"\nsetup_status: in_progress\n',
  "utf8"
);
const loaded = loadProfile(tmpProfileDir, (p) => fs.readFileSync(p, "utf8"));
assert(getSetupStatus(loaded.profile) === "in_progress", "loadProfile yaml");
fs.rmSync(tmpProfileDir, { recursive: true, force: true });

// --- tasks overdue ---
const overdueTask = { id: 1, name: "X", status: "planned", deadline: "2000-01-01T00:00:00+00:00" };
assert(isTaskOverdue(overdueTask), "isTaskOverdue past deadline");
assert(!isTaskOverdue({ id: 2, name: "Y", status: "done", deadline: "2000-01-01T00:00:00+00:00" }), "done not overdue");
const parsed = parseTasksYaml(`- id: 1
  name: Test
  status: planned
  weight: 5`);
assert(parsed[0].name === "Test", "parseTasksYaml name");

// --- daily-balancer ---
const balanced = balanceDay(
  [
    { title: "Heavy", eff_priority: 5, eff_difficulty: 5, est_minutes: 60 },
    { title: "Light", eff_priority: 3, eff_difficulty: 2, est_minutes: 30 },
  ],
  9,
  "2026-06-24"
);
assert(balanced.tasks.length >= 1, "balanceDay selects blocks");
assert(balanced.load.sum_difficulty <= 9, "balanceDay within budget");

// --- goal-materials goal ids ---
const examProfile = {
  purpose: "exam",
  exam_subject: "russian",
};
assert(resolveGoalIds(examProfile)[0] === "exam_russian", "resolveGoalIds exam");
assert(primaryGoalId(examProfile) === "exam_russian", "primaryGoalId");

const fixedYaml = normalizeFrontmatterText('--- id: m_test\n---');
assert(fixedYaml.startsWith("---\nid:"), "normalizeFrontmatterText fence");

// --- goal-materials storage ---
const matDir = path.join(WORKSPACE, ".test-materials-" + Date.now());
const matUser = path.join(matDir, "users", "tg-mat");
fs.mkdirSync(matUser, { recursive: true });
fs.writeFileSync(
  path.join(matUser, "profile.md"),
  "name: Test\npurpose: exam\nexam_subject: math\nsetup_status: complete\n",
  "utf8"
);
const matAdded = addMaterial(matUser, {
  goal_id: "exam_math",
  type: "theory",
  title: "Test theory",
  source: "user",
});
assert(matAdded.ok && matAdded.id.startsWith("m_"), "addMaterial");
const listed = listMaterials(matUser, { goal_id: "exam_math" });
assert(listed.length === 1, "listMaterials after add");
const rebuilt = rebuildIndex(matUser);
assert(rebuilt.count === 1, "rebuildIndex");
fs.rmSync(matDir, { recursive: true, force: true });

// --- task-pings ---
assert(isQuietHours(23, 30, "23:00", "08:00"), "quiet hours late night");
assert(!isQuietHours(10, 0, "23:00", "08:00"), "not quiet mid-day");
const samplePlan = {
  goals: [{ id: "g_1", title: "Физика", weight: 5 }],
  tasks: [
    {
      id: "t_001",
      goal_id: "g_1",
      title: "Задачи",
      scheduled_at: "2026-06-24T09:00:00+03:00",
      est_minutes: 45,
      status: "planned",
      goal_weight: 5,
      snoozed_until: null,
    },
  ],
};
const triggerMs = Date.parse("2026-06-24T09:00:00+03:00");
const due = selectDueTasks(samplePlan, triggerMs + 60000, { sent: [] });
assert(due.length === 1 && due[0].task.id === "t_001", "selectDueTasks picks due task");
assert(
  wasPingedForTrigger(recordPing({ sent: [] }, { taskId: "t_001", triggerMs, atIso: "x" }), "t_001", triggerMs),
  "recordPing marks sent"
);
assert(buildPingMessage(due[0].task, samplePlan.goals[0]).includes("Физика"), "buildPingMessage");

// --- plan-task ---
assert(normalizeAction("начинаю") === "start", "normalizeAction начинаю");
assert(normalizeAction("засчитать") === "done", "normalizeAction засчитать");
const samplePlanTask = {
  tasks: [
    { id: "t_001", status: "planned", scheduled_at: "2026-06-24T09:00:00+03:00", title: "A" },
    { id: "t_002", status: "planned", scheduled_at: "2026-06-24T11:00:00+03:00", title: "B" },
  ],
};
assert(pickActiveTask(samplePlanTask, null)?.id === "t_001", "pickActiveTask earliest");
const started = applyTaskAction(samplePlanTask.tasks[0], "start", {});
assert(started.ok && started.task.status === "in_progress", "applyTaskAction start");
const snoozed = applyTaskAction(samplePlanTask.tasks[0], "snooze", {
  snoozeMinutes: 30,
  nowIso: "2026-06-24T09:00:00+03:00",
});
assert(snoozed.ok && snoozed.task.status === "snoozed" && snoozed.task.snoozed_until, "applyTaskAction snooze");
const patched = updatePlanTask(samplePlanTask, "t_001", started.task);
assert(patched.tasks[0].status === "in_progress", "updatePlanTask");

const creditPlan = {
  tasks: [{ id: "t_001", status: "in_progress", title: "Focus task" }],
};
const credited = creditPlanTask(creditPlan, "t_001");
assert(credited.ok && credited.plan.tasks[0].status === "done", "creditPlanTask");

// --- study-plan week ranges ---
const heavyTopics = Array.from({ length: 15 }, (_, i) => ({
  title: `Topic ${i + 1}`,
  hours: 160,
  eff_priority: 4,
  level: "medium",
}));
const weekAlloc = assignWeeks(heavyTopics, 49, 40, 296);
assert(weekAlloc.finalWeeks.start <= weekAlloc.finalWeeks.end, "final week range valid");
assert(weekAlloc.finalWeeks.end === 49, "final block ends at totalWeeks");
assert(weekAlloc.finalWeeks.start >= 42, "final block reserved at tail");

const compactPlan = buildStudyPlan(
  {
    name: "Test",
    purpose: "exam",
    exam_type: "ege",
    exam_subject: "math",
    exam_topics: ["Алгебра", "Геометрия"],
    exam_topic_levels: { Алгебра: "слабо", Геометрия: "средне" },
    deadline: "2027-06",
    hours_per_week: 40,
    setup_status: "complete",
  },
  "2026-06-24"
);
assert(!compactPlan.error, "buildStudyPlan ok");
assert(
  compactPlan.finalWeeks.start <= compactPlan.finalWeeks.end,
  "buildStudyPlan final weeks valid"
);
assert(
  !compactPlan.markdown.includes("50–49") && !compactPlan.markdown.includes("50-49"),
  "no inverted final week range in markdown"
);

// --- progress / checkin-record ---
assert(computeStreak("", "2026-06-24") === 1, "streak first day");
const appended = appendCheckin("", {
  date: "2026-06-24",
  bullet: "тест",
  name: "Тест",
});
assert(appended.text.includes("### 2026-06-24"), "appendCheckin section");
assert(appended.streak === 1, "appendCheckin streak");

// --- plan-utils ---
assert(normalizeTaskStatus("completed") === "done", "completed -> done");
assert(isTaskDone({ status: "completed" }), "isTaskDone completed");
const planFix = { tasks: [{ id: "t_1", status: "completed" }, { id: "t_2", status: "planned" }] };
assert(normalizePlan(planFix), "normalizePlan mutates");
assert(planFix.tasks[0].status === "done", "normalizePlan completed");
assert(countDoneTasks(planFix) === 1, "countDoneTasks");

// --- getPurposes ---
assert(
  JSON.stringify(getPurposes({ purposes: "[exam, olympiad]", purpose: "exam" })) ===
    '["exam","olympiad"]',
  "getPurposes bracket string"
);

// --- cron slot ---
assert(isCronSlot(9, 5, "09:00", 7), "isCronSlot match");
assert(!isCronSlot(10, 30, "09:00", 7), "isCronSlot miss");

// --- commitPingIfNew idempotent ---
let pingState = { date: "2026-06-24", count: 0, sent: [] };
const c1 = commitPingIfNew(pingState, { taskId: "t_001", triggerMs: 1000, date: "2026-06-24" });
assert(c1.committed && c1.state.count === 1, "commitPing first");
const c2 = commitPingIfNew(c1.state, { taskId: "t_001", triggerMs: 1000, date: "2026-06-24" });
assert(!c2.committed && c2.state.count === 1, "commitPing idempotent");

// --- delivery state ---
let ds = { date: "2026-06-24", delivered: {} };
assert(!wasDelivered(ds, "morning-brief"), "delivery not yet");
ds = markDelivered(ds, "morning-brief", "x");
assert(wasDelivered(ds, "morning-brief"), "delivery marked");

// --- profile patch ---
const sampleProfile = `- **name:** "Тест"
- **setup_status:** in_progress
- **purpose:** exam
`;
const profilePatched = patchProfileMarkdown(sampleProfile, {
  name: "Миша",
  exam_type: "ege",
  exam_topics: ["Алгебра", "Геометрия"],
});
assert(profilePatched.text.includes('**name:** "Миша"'), "patch replaces name");
assert(profilePatched.text.includes("Алгебра"), "patch adds exam_topics list");
const merged = mergeProfile({ a: 1, b: { x: 1 } }, { b: { y: 2 }, c: 3 });
assert(merged.b.x === 1 && merged.b.y === 2, "mergeProfile deep merge");
assert(formatProfileField("hours_per_week", 8).includes("8"), "formatProfileField scalar");

// --- exam codifiers ---
const cod = resolveCodifier({ exam_type: "ege", exam_subject: "math", exam_subject_variant: "profile" });
assert(cod?.id === "ege-math-profile", "resolveCodifier ege math profile");
assert(defaultTopicLevels(["A", "B"], "слабо").A === "слабо", "defaultTopicLevels");

// --- onboarding quick skip self-assess ---
const quickStep = detectCurrentStep({
  name: "X",
  purpose: "exam",
  exam_type: "ege",
  exam_subject: "math",
  exam_topics: ["Алгебра"],
  onboarding_mode: "quick",
  deadline: "2027-06",
  hours_per_week: 5,
  priorities: { Алгебра: 3 },
  daily_load: "normal",
});
assert(quickStep === null, "quick mode skips exam-self-assess without levels");

console.log(`\nTests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
