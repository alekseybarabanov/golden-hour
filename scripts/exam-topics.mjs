#!/usr/bin/env node
// exam-topics.mjs — кодификаторы тем экзамена (data/exam-topics/).
//
// Usage:
//   node scripts/exam-topics.mjs list
//   node scripts/exam-topics.mjs show --id ege-math-profile
//   node scripts/exam-topics.mjs resolve --exam-type ege --exam-subject math [--variant profile]
//   node scripts/exam-topics.mjs apply --user <key> [--id ege-math-profile | --exam-type ...]

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireUser, userDir, out, die } from "./lib/cli.mjs";
import {
  listCodifiers,
  loadCodifier,
  resolveCodifier,
  defaultTopicLevels,
  defaultPriorities,
} from "./lib/exam-topics-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATCH = path.join(__dirname, "profile-patch.mjs");

const { cmd, opts } = parseArgs(process.argv);

if (cmd === "list" || !cmd) {
  const items = listCodifiers();
  out({
    ok: true,
    codifiers: items,
    summary: items.length
      ? `Кодификаторов: ${items.length}.`
      : "Кодификаторов нет — добавьте JSON в data/exam-topics/.",
  });
  process.exit(0);
}

if (cmd === "show") {
  const c = loadCodifier(opts.id);
  if (!c) die("codifier not found", { id: opts.id });
  out({ ok: true, codifier: c, topics: c.topics, summary: `${c.label}: ${c.topics.length} тем.` });
  process.exit(0);
}

if (cmd === "resolve") {
  const c = resolveCodifier({
    exam_type: opts["exam-type"] || opts.exam_type,
    exam_subject: opts["exam-subject"] || opts.exam_subject,
    exam_subject_variant: opts.variant || opts["exam-subject-variant"],
  });
  if (!c) die("no matching codifier");
  out({ ok: true, codifier_id: c.id, label: c.label, topics: c.topics });
  process.exit(0);
}

if (cmd === "apply") {
  const userKey = requireUser(opts);
  let c = opts.id ? loadCodifier(opts.id) : null;
  if (!c) {
    c = resolveCodifier({
      exam_type: opts["exam-type"] || opts.exam_type,
      exam_subject: opts["exam-subject"] || opts.exam_subject,
      exam_subject_variant: opts.variant || opts["exam-subject-variant"],
    });
  }
  if (!c) die("no matching codifier");

  const topics = c.topics || [];
  const levels = defaultTopicLevels(topics, opts.level || "средне");
  const priorities = defaultPriorities(topics, Number(opts.priority || 3));

  const patch = {
    exam_type: c.exam_type,
    exam_subject: c.exam_subject,
    exam_topics: topics,
    exam_topics_source: `codifier:${c.id}`,
    exam_topic_levels: levels,
    priorities,
  };
  if (c.exam_subject_variant) patch.exam_subject_variant = c.exam_subject_variant;

  const run = spawnSync(
    process.execPath,
    [PATCH, "--user", userKey, "--patch", JSON.stringify(patch)],
    { encoding: "utf8" }
  );
  if (run.status !== 0) {
    die(run.stderr?.trim() || "profile-patch failed");
  }
  const line = (run.stdout || "").trim().split("\n").filter(Boolean).pop();
  const result = JSON.parse(line);
  out({
    ok: true,
    user_key: userKey,
    codifier_id: c.id,
    topics_applied: topics.length,
    profile: result.profile,
    summary: `Применил кодификатор «${c.label}»: ${topics.length} тем.`,
  });
  process.exit(0);
}

die("usage: exam-topics.mjs list|show|resolve|apply");
