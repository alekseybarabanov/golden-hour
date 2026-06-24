// goal-materials-core.mjs — materials library per user (users/<key>/materials/).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadProfile } from "./profile.mjs";
import { todayISO } from "./dates.mjs";
import { readJson, relWorkspacePath, WORKSPACE } from "./cli.mjs";

const MATERIAL_TYPES = new Set([
  "problem",
  "theory",
  "link",
  "file",
  "note",
  "image",
]);
const STATUSES = new Set(["new", "working", "stuck", "understood", "archived"]);
const TYPE_DIRS = {
  problem: "problems",
  theory: "theory",
  link: "links",
  file: "files",
  note: "notes",
  image: "images",
};

export function materialsRoot(userDirPath) {
  return path.join(userDirPath, "materials");
}

export function indexPath(userDirPath) {
  return path.join(materialsRoot(userDirPath), "index.json");
}

/** Derive goal_id slugs from users/<key>/profile.md (not workspace USER.md). */
export function resolveGoalIds(profile) {
  if (!profile) return [];
  const purpose = profile.purpose;
  if (purpose === "exam") {
    const subject = slugify(profile.exam_subject || "subject");
    const variant = profile.exam_subject_variant
      ? slugify(profile.exam_subject_variant)
      : null;
    const base = `exam_${subject}`;
    return variant ? [base, `${base}_${variant}`] : [base];
  }
  if (purpose === "olympiad") {
    const subject = slugify(profile.olympiad_subject || "subject");
    const grade = profile.grade != null ? String(profile.grade) : null;
    return grade ? [`olymp_${subject}_${grade}`] : [`olymp_${subject}`];
  }
  if (purpose === "topic") {
    const topic = slugify(profile.study_topic || profile.study_subject || "topic");
    return [`topic_${topic}`];
  }
  return [];
}

export function primaryGoalId(profile) {
  return resolveGoalIds(profile)[0] || null;
}

function slugify(s) {
  return String(s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "unknown";
}

function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const off = "+03:00";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off}`
  );
}

function newMaterialId() {
  return `m_${crypto.randomBytes(4).toString("hex")}`;
}

function appendMemoryLog(userDirPath, goalId, materialId, title, type, relPath, source) {
  const day = todayISO();
  const memDir = path.join(WORKSPACE, "memory");
  const dayPath = path.join(memDir, `${day}.md`);
  const jsonlPath = path.join(memDir, "notes.jsonl");
  const hhmm = new Date().toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const line = `- ${hhmm}  📎 [${goalId}] ${type} «${title}» → users/${path.basename(userDirPath)}/materials/${goalId}/${relPath}`;
  fs.mkdirSync(memDir, { recursive: true });
  fs.appendFileSync(dayPath, line + "\n", "utf8");

  const note = {
    type: "material",
    id: materialId,
    goal_id: goalId,
    material_type: type,
    title,
    tags: [],
    source,
    source_url: null,
    path: `users/${path.basename(userDirPath)}/materials/${goalId}/${relPath}`,
    is_idea: false,
    created_at: nowIso(),
  };
  fs.appendFileSync(jsonlPath, JSON.stringify(note) + "\n", "utf8");
}

function appendStatusLog(userDirPath, goalId, materialId, status) {
  const day = todayISO();
  const dayPath = path.join(WORKSPACE, "memory", `${day}.md`);
  const icon =
    status === "understood" ? "✓" : status === "stuck" ? "❌" : status === "archived" ? "🗑" : "•";
  const hhmm = new Date().toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  fs.mkdirSync(path.dirname(dayPath), { recursive: true });
  fs.appendFileSync(
    dayPath,
    `- ${hhmm}  ${icon} [${goalId}] ${materialId} → ${status}\n`,
    "utf8"
  );
}

export function normalizeFrontmatterText(text) {
  let t = text
    .replace(
      /-\s*\{\{\s*status:\s*(\w+),\s*at:\s*"([^"]+)"\s*\}\}/g,
      '- { status: $1, at: "$2" }'
    )
    .replace(
      /-\s*\{\s*status:\s*(\w+),\s*at:\s*"([^"]+)"\s*\}/g,
      '- { status: $1, at: "$2" }'
    );
  // Repair merged opening fence: "--- id: foo" → "---\nid: foo"
  if (/^---\s+id:/m.test(t)) {
    t = t.replace(/^---\s+/m, "---\n");
  }
  return t;
}

export function parseMaterialFile(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  const norm = normalizeFrontmatterText(raw);
  let m = norm.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    // Frontmatter without body (closing --- at EOF)
    m = norm.match(/^---\r?\n([\s\S]*?)\r?\n---\s*$/);
    if (m) return { meta: parseFrontmatterBlock(m[1]), body: "", path: absPath };
    return { meta: {}, body: norm.trim(), path: absPath };
  }
  return { meta: parseFrontmatterBlock(m[1]), body: m[2].trim(), path: absPath };
}

function parseFrontmatterBlock(block) {
  const meta = {};
  for (const line of block.split("\n")) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === "null") val = null;
    else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    else if (val.startsWith("[") && val.endsWith("]")) {
      try {
        val = JSON.parse(val.replace(/'/g, '"'));
      } catch {
        /* keep string */
      }
    } else if (/^\d+(\.\d+)?$/.test(val)) val = Number(val);
    meta[key] = val;
  }
  return meta;
}

function loadIndexRaw(userDirPath) {
  const p = indexPath(userDirPath);
  if (!fs.existsSync(p)) return { byGoal: {}, updated_at: null };
  const data = readJson(p, {}) || {};
  const byGoal = {};

  if (data.by_goal && typeof data.by_goal === "object") {
    Object.assign(byGoal, data.by_goal);
  } else if (data.by_id && typeof data.by_id === "object") {
    for (const [id, entry] of Object.entries(data.by_id)) {
      const gid = entry.goal_id;
      if (!gid) continue;
      if (!byGoal[gid]) byGoal[gid] = [];
      byGoal[gid].push({
        id,
        type: entry.type,
        path: entry.path?.replace(/^materials\/[^/]+\//, "") || entry.path,
        title: entry.title || id,
        tags: entry.tags || [],
        status: entry.status || "new",
      });
    }
  } else {
    for (const [k, v] of Object.entries(data)) {
      if (k === "updated_at" || k === "schema_version") continue;
      if (Array.isArray(v)) byGoal[k] = v;
    }
  }

  return { byGoal, updated_at: data.updated_at || null };
}

function saveIndex(userDirPath, byGoal) {
  const p = indexPath(userDirPath);
  const payload = {
    schema_version: 1,
    by_goal: byGoal,
    updated_at: nowIso(),
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function relMatPath(userDirPath, goalId, subPath) {
  return path.join(materialsRoot(userDirPath), goalId, subPath);
}

function indexEntryFromFile(userDirPath, goalId, relPath, meta, titleFallback) {
  const relFromGoal = relPath.replace(/^materials\/[^/]+\//, "");
  return {
    id: meta.id,
    type: meta.type,
    path: relFromGoal.includes("/") ? relFromGoal : relFromGoal,
    title: titleFallback || meta.title || meta.id,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    status: meta.status || "new",
    source_url: meta.source_url || null,
  };
}

export function rebuildIndex(userDirPath) {
  const root = materialsRoot(userDirPath);
  const byGoal = {};
  if (!fs.existsSync(root)) {
    saveIndex(userDirPath, byGoal);
    return { count: 0, goals: [] };
  }

  for (const name of fs.readdirSync(root)) {
    if (name.startsWith("_") || name === "index.json") continue;
    const goalDir = path.join(root, name);
    if (!fs.statSync(goalDir).isDirectory()) continue;
    const entries = [];

    function walk(dir, prefix = "") {
      for (const ent of fs.readdirSync(dir)) {
        const full = path.join(dir, ent);
        if (ent.startsWith(".")) continue;
        if (fs.statSync(full).isDirectory()) {
          walk(full, prefix ? `${prefix}/${ent}` : ent);
          continue;
        }
        if (!/\.md$/i.test(ent)) continue;
        const rel = prefix ? `${prefix}/${ent}` : ent;
        const { meta, body } = parseMaterialFile(full);
        if (!meta.id) continue;
        const titleLine = body.split("\n").find((l) => l.startsWith("# "));
        const title = titleLine ? titleLine.slice(2).trim() : ent;
        entries.push(
          indexEntryFromFile(userDirPath, name, rel, meta, title)
        );
      }
    }
    walk(goalDir);
    if (entries.length) byGoal[name] = entries;
  }

  saveIndex(userDirPath, byGoal);
  return {
    count: Object.values(byGoal).reduce((s, a) => s + a.length, 0),
    goals: Object.keys(byGoal),
  };
}

function ensureIndex(userDirPath) {
  const p = indexPath(userDirPath);
  if (!fs.existsSync(p)) return rebuildIndex(userDirPath);
  const { byGoal } = loadIndexRaw(userDirPath);
  if (!Object.keys(byGoal).length) return rebuildIndex(userDirPath);
  return { byGoal };
}

export function listMaterials(userDirPath, filters = {}) {
  const { byGoal } = loadIndexRaw(userDirPath);
  let items = [];
  const goalFilter = filters.goal_id || filters.goal;

  for (const [goalId, arr] of Object.entries(byGoal)) {
    if (goalFilter && goalId !== goalFilter) continue;
    for (const e of arr) {
      items.push({ ...e, goal_id: goalId });
    }
  }

  if (filters.type) {
    items = items.filter((x) => x.type === filters.type);
  }
  if (filters.status) {
    items = items.filter((x) => (x.status || "new") === filters.status);
  }
  if (filters.tag) {
    const t = filters.tag.toLowerCase();
    items = items.filter((x) =>
      (x.tags || []).some((tag) => String(tag).toLowerCase().includes(t))
    );
  }
  if (filters.query) {
    const q = filters.query.toLowerCase();
    items = items.filter(
      (x) =>
        String(x.title || "").toLowerCase().includes(q) ||
        String(x.id || "").toLowerCase().includes(q)
    );
  }

  return items;
}

export function pickMaterials(userDirPath, filters = {}) {
  let items = listMaterials(userDirPath, filters);
  if (filters.topic) {
    const t = filters.topic.toLowerCase();
    const scored = items.map((x) => {
      const hay = `${x.title} ${(x.tags || []).join(" ")}`.toLowerCase();
      let score = 0;
      if (hay.includes(t)) score += 10;
      const words = t.split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 3);
      score += words.filter((w) => hay.includes(w)).length;
      if ((x.status || "new") === "new") score += 1;
      return { x, score };
    });
    scored.sort((a, b) => b.score - a.score);
    items = scored.filter((s) => s.score > 0).map((s) => s.x);
    if (!items.length) items = scored.map((s) => s.x);
  }

  const limit = filters.limit ? Number(filters.limit) : items.length;
  return items.slice(0, limit);
}

export function getMaterial(userDirPath, materialId) {
  const items = listMaterials(userDirPath, {});
  const entry = items.find((x) => x.id === materialId);
  if (!entry) return null;

  const abs = path.join(
    materialsRoot(userDirPath),
    entry.goal_id,
    entry.path.replace(/^materials\/[^/]+\//, "")
  );
  if (!fs.existsSync(abs)) return { entry, meta: null, body: null, path: abs };
  const { meta, body } = parseMaterialFile(abs);
  return { entry, meta, body, path: abs };
}

export function fixMaterialFrontmatter(userDirPath) {
  const root = materialsRoot(userDirPath);
  if (!fs.existsSync(root)) return { fixed: 0 };
  let fixed = 0;

  const titleFromFile = (filePath, meta) => {
    const base = path.basename(filePath, ".md");
    const map = {
      "2026-06-24_zadanie-4-orfepiya": "Задание 4 — орфоэпия, теория + алгоритм",
      "2026-06-24_kultura-rechi-4-6": "Культура речи (задания 4–6)",
      "2026-06-24_zadanie-7-morfologicheskie": "Задание 7 — морфологические нормы",
      "2026-06-24_zadanie-7-razbor": "Задание 7 — разбор с примерами",
      "2026-06-24_rechevye-oshibki": "Речевые ошибки (тавтология, плеоназм)",
      "2026-06-24_rabochiy-list-trenirovka": "Рабочий лист — тренировочные задания",
    };
    return map[base] || meta.title || base;
  };

  const defaultTags = (filePath) => {
    const base = path.basename(filePath, ".md");
    if (base.includes("zadanie-4")) return ["егэ", "языковые-нормы", "задание-4", "орфоэпия"];
    if (base.includes("kultura")) return ["егэ", "культура-речи", "задания-4-6"];
    if (base.includes("morfolog")) return ["егэ", "задание-7", "морфология"];
    if (base.includes("razbor")) return ["егэ", "задание-7", "разбор"];
    if (base.includes("rechevye")) return ["егэ", "речевые-ошибки", "задания-5-6"];
    if (base.includes("rabochiy")) return ["егэ", "тренировка", "языковые-нормы"];
    return ["егэ", "русский"];
  };

  function walk(dir) {
    for (const ent of fs.readdirSync(dir)) {
      const full = path.join(dir, ent);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.md$/i.test(ent)) continue;

      const { meta, body } = parseMaterialFile(full);
      if (!meta.id) continue;

      const title = titleFromFile(full, meta);
      const created = meta.created_at || nowIso();
      const repaired = {
        id: meta.id,
        goal_id: meta.goal_id || "exam_russian",
        type: meta.type || (full.includes(`${path.sep}problems${path.sep}`) ? "problem" : "theory"),
        tags: defaultTags(full),
        status: meta.status || "new",
        source: meta.source || "web_search",
        source_url: meta.source_url || null,
        source_path: null,
        excerpt: meta.excerpt && !String(meta.excerpt).includes("пїЅ") ? meta.excerpt : null,
        relevance: meta.relevance ?? 0.85,
        created_at: created,
        updated_at: created,
        status_history: [{ status: meta.status || "new", at: created }],
      };

      const newBody =
        body?.trim() ||
        `# ${title}\n\n` +
          (repaired.source_url ? `🔗 ${repaired.source_url}\n` : "");

      const content = serializeFrontmatter(repaired) + "\n\n" + newBody + "\n";
      fs.writeFileSync(full, content, "utf8");
      fixed++;
    }
  }
  walk(root);
  if (fixed) rebuildIndex(userDirPath);
  return { fixed };
}

function serializeFrontmatter(meta) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (k === "status_history") continue;
    if (v == null) lines.push(`${k}: null`);
    else if (Array.isArray(v)) lines.push(`${k}: ${JSON.stringify(v)}`);
    else if (typeof v === "string") lines.push(`${k}: "${v.replace(/"/g, '\\"')}"`);
    else lines.push(`${k}: ${v}`);
  }
  if (meta.status_history) {
    lines.push("status_history:");
    for (const h of meta.status_history) {
      lines.push(`  - { status: ${h.status}, at: "${h.at}" }`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function addMaterial(userDirPath, opts) {
  const {
    goal_id,
    type,
    title,
    source = "user",
    source_url = null,
    tags = [],
    body = "",
    dry_run = false,
  } = opts;

  if (!goal_id) return { ok: false, error: "missing goal_id" };
  if (!MATERIAL_TYPES.has(type)) return { ok: false, error: "invalid type" };
  if (!title?.trim()) return { ok: false, error: "missing title" };

  const id = newMaterialId();
  const created = nowIso();
  const dirName = TYPE_DIRS[type] || "notes";
  const slug = slugify(title).slice(0, 40) || "material";
  const fileName = `${todayISO()}_${slug}.md`;
  const relPath = `${dirName}/${fileName}`;
  const absPath = relMatPath(userDirPath, goal_id, relPath);

  const meta = {
    id,
    goal_id,
    type,
    tags: Array.isArray(tags) ? tags : [],
    status: "new",
    source,
    source_url,
    source_path: null,
    created_at: created,
    updated_at: created,
    status_history: [{ status: "new", at: created }],
  };

  const content =
    serializeFrontmatter(meta) +
    "\n\n" +
    `# ${title.trim()}\n\n` +
    (body?.trim() ? body.trim() + "\n" : "");

  if (dry_run) {
    return {
      ok: true,
      dry_run: true,
      id,
      goal_id,
      path: relPath,
      preview: content.slice(0, 400),
    };
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
  rebuildIndex(userDirPath);
  appendMemoryLog(userDirPath, goal_id, id, title.trim(), type, relPath, source);

  return {
    ok: true,
    id,
    goal_id,
    type,
    title: title.trim(),
    path: relPath,
  };
}

export function setMaterialStatus(userDirPath, materialId, status) {
  if (!STATUSES.has(status)) return { ok: false, error: "invalid status" };
  const mat = getMaterial(userDirPath, materialId);
  if (!mat?.path || !fs.existsSync(mat.path)) {
    return { ok: false, error: "material not found" };
  }

  const { meta, body } = parseMaterialFile(mat.path);
  const at = nowIso();
  const history = Array.isArray(meta.status_history)
    ? [...meta.status_history]
    : [];
  history.push({ status, at });
  meta.status = status;
  meta.updated_at = at;
  meta.status_history = history;

  const content = serializeFrontmatter(meta) + "\n\n" + body + "\n";
  fs.writeFileSync(mat.path, content, "utf8");
  rebuildIndex(userDirPath);
  if (["understood", "stuck", "archived"].includes(status)) {
    appendStatusLog(userDirPath, mat.entry.goal_id, materialId, status);
  }

  return { ok: true, id: materialId, status, goal_id: mat.entry.goal_id };
}

export function materialsForToday(userDirPath, profile, date) {
  const planPath = path.join(userDirPath, "plans", `${date || todayISO()}.json`);
  const plan = readJson(planPath, null);
  const topic =
    plan?.meta?.topic ||
    plan?.tasks?.[0]?.title?.replace(/^[^:]+:\s*/, "") ||
    null;
  const goals = resolveGoalIds(profile);
  const goal_id = goals[0] || null;

  const items = pickMaterials(userDirPath, {
    goal_id,
    topic: topic || undefined,
    limit: 10,
  });

  return {
    date: date || todayISO(),
    topic,
    goal_id,
    count: items.length,
    items,
  };
}

export function loadUserGoals(userDirPath, readText) {
  const { profile } = loadProfile(userDirPath, readText);
  if (!profile) return { goals: [], profile: null };
  return { goals: resolveGoalIds(profile), profile };
}
