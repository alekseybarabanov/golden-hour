#!/usr/bin/env node
// onboarding-quick.mjs — быстрый старт: минимум вопросов, дефолты, кодификатор тем.
//
// Usage:
//   node scripts/onboarding-quick.mjs --user <key> --name "Миша" --purpose exam \
//     --exam-type ege --exam-subject math --deadline 2027-06 --hours 8 [--dry-run]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireUser, userDir, out, die } from "./lib/cli.mjs";
import {
  resolveCodifier,
  defaultTopicLevels,
  defaultPriorities,
} from "./lib/exam-topics-core.mjs";
import { defaultOlympiadTopics } from "./lib/onboarding-quick-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATCH = path.join(__dirname, "profile-patch.mjs");
const STUDY_PLAN = path.join(__dirname, "study-plan.mjs");

const { opts } = parseArgs(process.argv);
const userKey = requireUser(opts);
const dryRun = opts["dry-run"] === "true";

const name = opts.name;
const purpose = opts.purpose || "topic";
if (!name) die("missing --name");

const patch = {
  name,
  setup_status: "in_progress",
  onboarding_mode: "quick",
  purpose,
  daily_load: opts["daily-load"] || opts.daily_load || "normal",
  theme: opts.theme || "dark",
  hours_per_week: Number(opts.hours || opts["hours-per-week"] || 5),
  deadline: opts.deadline || "без дедлайна",
};

if (purpose === "exam") {
  const examType = opts["exam-type"] || opts.exam_type;
  const examSubject = opts["exam-subject"] || opts.exam_subject;
  if (!examType || !examSubject) die("exam requires --exam-type and --exam-subject");
  patch.exam_type = examType;
  patch.exam_subject = examSubject;
  if (opts.variant || opts["exam-subject-variant"]) {
    patch.exam_subject_variant = opts.variant || opts["exam-subject-variant"];
  }
  const codifier = resolveCodifier({
    exam_type: examType,
    exam_subject: examSubject,
    exam_subject_variant: patch.exam_subject_variant,
  });
  if (codifier) {
    patch.exam_topics = codifier.topics;
    patch.exam_topics_source = `codifier:${codifier.id}`;
    patch.exam_topic_levels = defaultTopicLevels(codifier.topics, "средне");
    patch.priorities = defaultPriorities(codifier.topics, 3);
  } else {
    patch.exam_topics = [examSubject];
    patch.exam_topic_levels = { [examSubject]: "средне" };
    patch.priorities = { [examSubject]: 3 };
  }
} else if (purpose === "olympiad") {
  patch.grade = opts.grade || "10";
  patch.olympiad_subject = opts["olympiad-subject"] || opts.olympiad_subject || "math";
  const blocks = defaultOlympiadTopics(patch.olympiad_subject, "средний");
  patch.olympiad_levels = Object.fromEntries(blocks.map((b) => [b, "средний"]));
  patch.priorities = Object.fromEntries(blocks.map((b) => [b, 3]));
} else {
  patch.study_topic = opts.topic || opts["study-topic"] || "тема";
  patch.topic_level = "средний";
  patch.priorities = { [patch.study_topic]: 3 };
}

patch.setup_status = "complete";

if (dryRun) {
  out({
    ok: true,
    dry_run: true,
    user_key: userKey,
    patch,
    summary: "Dry-run: профиль и план не записаны.",
  });
  process.exit(0);
}

const initFlag =
  !fs.existsSync(path.join(userDir(userKey), "profile.md")) || opts.init === "true"
    ? ["--init"]
    : [];
const run = spawnSync(
  process.execPath,
  [PATCH, "--user", userKey, ...initFlag, "--patch", JSON.stringify(patch)],
  { encoding: "utf8" }
);
if (run.status !== 0) die(run.stderr?.trim() || "profile-patch failed");

const planRun = spawnSync(
  process.execPath,
  [STUDY_PLAN, "--user", userKey, "--force"],
  { encoding: "utf8" }
);

let planOk = planRun.status === 0;
let planSummary = planOk ? "Макро-план создан." : "Макро-план не создан — вызови study-plan вручную.";

out({
  ok: true,
  user_key: userKey,
  onboarding_mode: "quick",
  setup_status: "complete",
  plan_created: planOk,
  summary: `Быстрый старт готов для ${name}. ${planSummary}`,
});
