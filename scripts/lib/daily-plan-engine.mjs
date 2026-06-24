// Core daily-plan builder (shared by daily-plan.mjs and morning-plan.mjs).

import path from "node:path";
import { readText, readJson, writeJson, relWorkspacePath } from "./cli.mjs";
import { loadProfile, getSetupStatus, getPurposes } from "./profile.mjs";
import { getCurrentPlanTopic, resolvePlanPath } from "./plan-parse.mjs";
import { weightTopic, getDailyBudget } from "./task-weighting.mjs";
import { balanceDay, buildGoalId } from "./daily-balancer.mjs";
import { dueTopics, reviewTaskCandidates } from "./spaced-repetition.mjs";
import { studyBlocksForTopic } from "./task-templates.mjs";

function deadlineIso(profile) {
  if (!profile?.deadline) return null;
  return profile.deadline.length === 7
    ? `${profile.deadline}-01`
    : profile.deadline;
}

function collectPurposeBlock(userDirPath, profile, purpose, date) {
  const planPath = resolvePlanPath(userDirPath, profile, { purpose });
  const planText = readText(planPath);
  if (!planText) return null;

  const activeProfile = { ...profile, purpose };
  const { week, topic } = getCurrentPlanTopic(planText, date);
  if (!topic) return null;

  const topicWeight = weightTopic(topic.title, activeProfile, date);
  const goalId = buildGoalId(topic.title, purpose);
  const candidates = [];
  const topicUnits = topic._sprintItems?.length ? topic._sprintItems : [topic];

  for (const unit of topicUnits) {
    for (const b of studyBlocksForTopic(unit, activeProfile, week)) {
      const w = weightTopic(unit.title, activeProfile, date, {
        est_minutes: b.est_minutes,
        kind: b.kind,
        eff_difficulty: b.difficulty,
      });
      candidates.push({
        ...w,
        title: b.title,
        kind: b.kind,
        _goalId: goalId,
        _purpose: purpose,
      });
    }
  }

  return {
    week,
    topic,
    goalId,
    topicWeight,
    candidates,
    planPath,
    purpose,
  };
}

export function buildDailyPlan(userKey, userDirPath, date, { dryRun = false, purpose } = {}) {
  const { exists, profile } = loadProfile(userDirPath, (p) => readText(p));
  if (!exists) {
    return { ok: false, user_key: userKey, error: "profile not found" };
  }
  if (getSetupStatus(profile) !== "complete") {
    return {
      ok: false,
      user_key: userKey,
      error: "setup_status not complete",
      setup_status: getSetupStatus(profile),
    };
  }

  const purposes = purpose ? [purpose] : getPurposes(profile);
  const progressText = readText(path.join(userDirPath, "progress.md"), "");
  const budget = getDailyBudget(profile.daily_load);
  const goals = [];
  const candidates = [];
  const metaTopics = [];
  let week = null;

  for (const p of purposes) {
    const block = collectPurposeBlock(userDirPath, profile, p, date);
    if (!block) continue;
    week = week ?? block.week;
    metaTopics.push(block.topic.title);
    candidates.push(...block.candidates);
    goals.push({
      id: block.goalId,
      title: `${block.topic.title} (нед. ${block.week}, eff_p=${block.topicWeight.eff_priority})`,
      weight: block.topicWeight.eff_priority,
      deadline: deadlineIso(profile),
      purpose: p,
    });
  }

  if (!goals.length) {
    const firstPurpose = purposes[0];
    const planPath = resolvePlanPath(userDirPath, profile, { purpose: firstPurpose });
    const planText = readText(planPath);
    if (!planText) {
      return { ok: false, user_key: userKey, error: "plan not found" };
    }
    const { week: w } = getCurrentPlanTopic(planText, date);
    return { ok: false, user_key: userKey, error: "no topic for current week", week: w };
  }

  const primaryPurpose = purposes[0];
  const primaryProfile = { ...profile, purpose: primaryPurpose };

  for (const r of reviewTaskCandidates(
    dueTopics(primaryProfile, progressText, date, 3),
    primaryProfile,
    date
  )) {
    const w = weightTopic(r.title, primaryProfile, date, r);
    candidates.push({
      ...w,
      _goalId: goals[0].id,
      _purpose: primaryPurpose,
      kind: "review",
    });
  }

  const recurring = readJson(path.join(userDirPath, "recurring.json"), { items: [] });
  for (const item of recurring.items || []) {
    candidates.push({
      ...weightTopic(item.title, primaryProfile, date, {
        est_minutes: item.est_minutes || 30,
        kind: "recurring",
      }),
      _goalId: goals[0].id,
      _purpose: primaryPurpose,
      kind: "recurring",
    });
  }

  const balanced = balanceDay(candidates, budget, date);

  let taskNum = 1;
  const tasks = balanced.tasks.map((t) => ({
    id: `t_${String(taskNum++).padStart(3, "0")}`,
    goal_id: t._goalId || goals[0].id,
    title: t.title,
    scheduled_at: t.scheduled_at,
    est_minutes: t.est_minutes,
    weight: t.eff_priority,
    goal_weight: t.eff_priority,
    difficulty: t.eff_difficulty,
    status: "planned",
    snoozed_until: null,
    ...(t.tag ? { tag: t.tag } : {}),
    ...(t._purpose ? { purpose: t._purpose } : {}),
  }));

  const plan = {
    date,
    user_id: userKey,
    goals,
    tasks,
    load: balanced.load,
    meta: {
      week,
      topic: metaTopics.join(" · "),
      purposes,
      deferred_count: balanced.deferred.length,
      generated_by: "daily-plan.mjs",
    },
  };

  const outPath = path.join(userDirPath, "plans", `${date}.json`);
  const hours =
    Math.round((tasks.reduce((s, t) => s + t.est_minutes, 0) / 60) * 10) / 10;
  const summary = `План на ${date}: ${tasks.length} задач, ~${hours} ч, нагрузка ${balanced.load.sum_difficulty}/${balanced.load.budget}. Темы: ${metaTopics.join(", ")}.`;

  if (!dryRun) {
    writeJson(outPath, plan);
  }

  return {
    ok: true,
    user_key: userKey,
    path: relWorkspacePath(outPath),
    plan,
    summary,
    dry_run: dryRun,
    deferred: balanced.deferred.map((d) => d.title),
    purposes,
  };
}
