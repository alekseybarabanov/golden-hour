// Load exam topic codifiers from data/exam-topics/*.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE } from "./cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODIFIERS_DIR = path.join(WORKSPACE, "data", "exam-topics");

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function listCodifiers() {
  if (!fs.existsSync(CODIFIERS_DIR)) return [];
  return fs
    .readdirSync(CODIFIERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(CODIFIERS_DIR, f), "utf8"));
      return {
        id: data.id || f.replace(/\.json$/, ""),
        exam_type: data.exam_type,
        exam_subject: data.exam_subject,
        exam_subject_variant: data.exam_subject_variant || null,
        label: data.label || data.id,
        topic_count: (data.topics || []).length,
      };
    });
}

export function loadCodifier(idOrPath) {
  if (!idOrPath) return null;
  const direct = path.join(CODIFIERS_DIR, `${idOrPath}.json`);
  if (fs.existsSync(direct)) {
    return JSON.parse(fs.readFileSync(direct, "utf8"));
  }
  for (const f of fs.readdirSync(CODIFIERS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(CODIFIERS_DIR, f), "utf8"));
    if (data.id === idOrPath) return data;
  }
  return null;
}

export function resolveCodifier({ exam_type, exam_subject, exam_subject_variant }) {
  const et = normalizeKey(exam_type);
  const es = normalizeKey(exam_subject);
  const ev = exam_subject_variant ? normalizeKey(exam_subject_variant) : null;

  const aliases = {
    егэ: "ege",
    огэ: "oge",
    math: "math",
    математика: "math",
    history: "history",
    история: "history",
    russian: "russian",
    "русский": "russian",
    "русский язык": "russian",
    profile: "profile",
    профиль: "profile",
    профильный: "profile",
    base: "base",
    база: "base",
    базовый: "base",
  };

  const typeKey = aliases[et] || et.replace(/[^a-zа-яё0-9]/gi, "");
  const subjKey = aliases[es] || es.replace(/[^a-zа-яё0-9]/gi, "");
  const varKey = ev ? aliases[ev] || ev : null;

  for (const meta of listCodifiers()) {
    const c = loadCodifier(meta.id);
    const ct = normalizeKey(c.exam_type);
    const cs = normalizeKey(c.exam_subject);
    const cv = c.exam_subject_variant ? normalizeKey(c.exam_subject_variant) : null;
    if (ct !== typeKey && !ct.includes(typeKey) && !typeKey.includes(ct)) continue;
    if (cs !== subjKey && !cs.includes(subjKey) && !subjKey.includes(cs)) continue;
    if (varKey && cv && cv !== varKey) continue;
    return c;
  }
  return null;
}

export function defaultTopicLevels(topics, level = "средне") {
  const map = {};
  for (const t of topics || []) map[t] = level;
  return map;
}

export function defaultPriorities(topics, value = 3) {
  const map = {};
  for (const t of topics || []) map[t] = value;
  return map;
}
