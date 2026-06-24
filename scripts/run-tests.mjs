#!/usr/bin/env node
// run-tests.mjs — unit tests

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createTeam,
  inviteMember,
  acceptInvite,
  addTask,
  takeTask,
  submitTask,
  approveTask,
  leaveTeam,
  listTasks,
  resolvePendingInvites,
} from "./lib/team-tasks.mjs";
import { parseProfile, loadProfile, getSetupStatus, getPurposes } from "./lib/profile.mjs";
import { isTaskOverdue, parseTasksYaml } from "./lib/tasks-core.mjs";
import { todayISO } from "./lib/dates.mjs";
import { parsePlanTopics, parseSprintTopics, getCurrentPlanTopic } from "./lib/plan-parse.mjs";
import {
  createGroup,
  addGroupTask,
  takeGroupTask,
  submitGroupTask,
  approveGroupTask,
  listGroupTasks,
  acceptGroupInvite,
  inviteToGroup,
} from "./lib/group-core.mjs";
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
import { detectCurrentStep, hasDeadline } from "./lib/onboarding.mjs";

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

// --- group accept (invs scope bug) ---
const grpDir = path.join(WORKSPACE, ".test-group-" + Date.now());
const prevWs = process.env.GH_WORKSPACE;
process.env.GH_WORKSPACE = grpDir;
fs.mkdirSync(path.join(grpDir, "data", "groups", "-1001"), { recursive: true });
fs.mkdirSync(path.join(grpDir, "users", "tg-accept"), { recursive: true });
const inviteCode = "abc12345";
fs.writeFileSync(
  path.join(grpDir, "data", "groups", "-1001", "invites.json"),
  JSON.stringify([
    {
      code: inviteCode,
      created_at: "2026-06-01T00:00:00+00:00",
      expires_at: "2099-01-01T00:00:00+00:00",
      used: false,
    },
  ]),
  "utf8"
);
fs.writeFileSync(path.join(grpDir, "data", "groups", "-1001", "members.json"), "[]", "utf8");
fs.writeFileSync(
  path.join(grpDir, "data", "groups", "-1001", "meta.json"),
  JSON.stringify({ chat_id: "-1001", goal: "Test", owner_user_key: "tg-owner" }),
  "utf8"
);
const groupAccept = spawnSync(
  process.execPath,
  [
    path.join(__dirname, "group.mjs"),
    "group",
    "accept",
    "--user",
    "tg-accept",
    "--code",
    inviteCode,
  ],
  { cwd: grpDir, encoding: "utf8" }
);
assert(groupAccept.status === 0, "group accept exit 0");
const acceptOut = JSON.parse(groupAccept.stdout.trim());
assert(acceptOut.ok && acceptOut.action === "accepted", "group accept ok");

// --- group task lifecycle (group-core) ---
const gOwner = "tg-g1";
const gMember = "tg-g2";
createGroup({
  userKey: gOwner,
  chatId: "-2002",
  goal: "Group tasks test",
  workspace: grpDir,
});
const invG = inviteToGroup({
  userKey: gOwner,
  chatId: "-2002",
  telegramId: 999,
  username: "@gmember",
  workspace: grpDir,
});
acceptGroupInvite({ userKey: gMember, code: invG.code, workspace: grpDir });
const gAdded = addGroupTask({
  userKey: gOwner,
  chatId: "-2002",
  title: "Read chapter",
  workspace: grpDir,
});
assert(gAdded.task.id === "task-001", "group task id");
takeGroupTask({
  userKey: gMember,
  chatId: "-2002",
  taskId: gAdded.task.id,
  workspace: grpDir,
});
submitGroupTask({
  userKey: gMember,
  chatId: "-2002",
  taskId: gAdded.task.id,
  note: "done",
  workspace: grpDir,
});
const gApproved = approveGroupTask({
  userKey: gOwner,
  chatId: "-2002",
  taskId: gAdded.task.id,
  workspace: grpDir,
});
assert(gApproved.task.status === "done", "group task approved");
const gList = listGroupTasks({ userKey: gOwner, chatId: "-2002", workspace: grpDir });
assert(gList.count === 1, "group task list");

fs.rmSync(grpDir, { recursive: true, force: true });
if (prevWs === undefined) delete process.env.GH_WORKSPACE;
else process.env.GH_WORKSPACE = prevWs;

const ttDir = path.join(WORKSPACE, ".test-team-tasks-" + Date.now());
const prevGh = process.env.GH_WORKSPACE;
process.env.GH_WORKSPACE = ttDir;
fs.mkdirSync(path.join(ttDir, "users"), { recursive: true });

const owner = "tg-100";
const member = "tg-200";
const created = createTeam({
  userKey: owner,
  telegramId: 100,
  username: "@alice",
  goal: "Test team",
  workspace: ttDir,
});
const teamId = created.team_id;
assert(teamId.startsWith("team-"), "team id prefix");

const inv = inviteMember({
  userKey: owner,
  teamId,
  targetTelegramId: 200,
  targetUsername: "@bob",
  workspace: ttDir,
});
assert(inv.invite_code, "invite code");

const joined = acceptInvite({
  userKey: member,
  inviteCode: inv.invite_code,
  telegramId: 200,
  username: "@bob",
  workspace: ttDir,
});
assert(joined.role === "member", "member joined");

const added = addTask({
  userKey: owner,
  teamId,
  title: "Build feature",
  deadline: "2000-01-01T00:00:00+00:00",
  workspace: ttDir,
});
const taskId = added.task.id;
assert(taskId === "task-001", "task id");

const taken = takeTask({
  userKey: member,
  teamId,
  taskId,
  telegramId: 200,
  workspace: ttDir,
});
assert(taken.task.status === "in_progress", "in progress");
assert(taken.task.display_status === "overdue", "overdue computed");

const submitted = submitTask({
  userKey: member,
  teamId,
  taskId,
  note: "done",
  workspace: ttDir,
});
assert(submitted.task.status === "awaiting_review", "submitted");

const approved = approveTask({
  userKey: owner,
  teamId,
  taskId,
  workspace: ttDir,
});
assert(approved.task.status === "done", "approved");

const task2 = addTask({
  userKey: owner,
  teamId,
  title: "Second",
  workspace: ttDir,
});
takeTask({
  userKey: member,
  teamId,
  taskId: task2.task.id,
  telegramId: 200,
  workspace: ttDir,
});
const left = leaveTeam({ userKey: member, teamId, workspace: ttDir });
assert(left.auto_submitted_tasks.includes(task2.task.id), "auto submit on leave");

const resolved = resolvePendingInvites({
  userKey: "tg-300",
  telegramId: 300,
  username: "@carol",
  workspace: ttDir,
});
assert(resolved.count === 0, "no orphan resolve");

try {
  listTasks({ userKey: member, teamId, workspace: ttDir });
  assert(false, "ex-member should not list");
} catch (e) {
  assert(e.message === "not a team member", "isolation");
}

fs.rmSync(ttDir, { recursive: true, force: true });
if (prevGh === undefined) delete process.env.GH_WORKSPACE;
else process.env.GH_WORKSPACE = prevGh;

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

console.log(`\nTests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
