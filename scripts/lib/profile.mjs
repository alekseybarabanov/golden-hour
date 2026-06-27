// Parse users/<user_key>/profile.md (semi-structured markdown).
// loadProfile() reads users/<user_key>/profile.md (authoritative).
// Optional SQLite (GH_USE_DB=1) — experimental, not used by default.

import fs from "node:fs";
import path from "node:path";
import { isDbEnabled, getDb, getUser } from "./db.mjs";

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      return JSON.parse(s.replace(/'/g, '"'));
    } catch {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(/,\s*/).map((part) =>
        part.trim().replace(/^["']|["']$/g, "")
      );
    }
  }
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function isSubLine(line) {
  return /^\s{2,}/.test(line) && line.trim() !== "";
}

function parseSubBlock(lines, start) {
  const map = {};
  const list = [];
  let i = start;
  let mode = null;

  while (i < lines.length) {
    const line = lines[i];
    if (!isSubLine(line) && line.trim() !== "" && !line.startsWith("<!--")) {
      break;
    }
    if (line.trim() === "" || line.startsWith("<!--")) {
      i++;
      continue;
    }

    const trimmed = line.trim();
    const listMap = trimmed.match(/^-\s+"([^"]+)":\s*(.+)$/);
    if (listMap) {
      mode = "map";
      map[listMap[1]] = parseScalar(listMap[2]);
      i++;
      continue;
    }

    const bareMap = trimmed.match(/^"([^"]+)":\s*(.+)$/);
    if (bareMap) {
      mode = "map";
      map[bareMap[1]] = parseScalar(bareMap[2]);
      i++;
      continue;
    }

    const listItem = trimmed.match(/^-\s+(.+)$/);
    if (listItem) {
      mode = mode || "list";
      list.push(parseScalar(listItem[1]));
      i++;
      continue;
    }

    i++;
  }

  if (mode === "map" || Object.keys(map).length) return { value: map, end: i };
  if (list.length) return { value: list, end: i };
  return { value: null, end: start };
}

function parsePlainYamlLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const m = trimmed.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
  if (!m) return null;
  return { key: m[1].trim(), value: parseScalar(m[2].trim()) };
}

export function parseProfile(text) {
  const profile = {};
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  let hasMarkdownFields = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^-\s+\*\*([^*]+):\*\*\s*(.*)$/);
    if (!m) continue;
    hasMarkdownFields = true;

    const key = m[1].trim();
    const rest = m[2].trim();

    if (rest === "" || rest === "null") {
      const sub = parseSubBlock(lines, i + 1);
      if (sub.value != null) {
        profile[key] = sub.value;
        i = sub.end - 1;
        continue;
      }
      profile[key] = null;
      continue;
    }

    profile[key] = parseScalar(rest);
  }

  if (!hasMarkdownFields) {
    for (const line of lines) {
      const kv = parsePlainYamlLine(line);
      if (kv) profile[kv.key] = kv.value;
    }
  }

  return profile;
}

export function loadProfile(userDir, readText) {
  if (isDbEnabled()) {
    const absDir = path.resolve(userDir);
    const workspace = path.dirname(path.dirname(absDir));
    const dbPath = path.join(workspace, "golden-hour.db");
    if (fs.existsSync(dbPath)) {
      const user_key = path.basename(absDir);
      try {
        const db = getDb(dbPath);
        const profile = db ? getUser(db, user_key) : null;
        if (profile) return { exists: true, path: `[db:${user_key}]`, profile };
      } catch {
        // fall through to file
      }
    }
  }
  const p = `${userDir}/profile.md`;
  const text = typeof readText === "function" ? readText(p) : null;
  if (!text) return { exists: false, path: p, profile: null };
  return { exists: true, path: p, profile: parseProfile(text) };
}

export function getSetupStatus(profile) {
  return profile?.setup_status || profile?.["setup_status"] || "new";
}

/** Active preparation branches: exam, olympiad, topic (multi-goal users). */
export function getPurposes(profile) {
  let raw = profile?.purposes;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("[")) {
      try {
        raw = JSON.parse(t.replace(/'/g, '"'));
      } catch {
        raw = t
          .slice(1, -1)
          .split(/,\s*/)
          .map((p) => p.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
    } else if (t) {
      raw = [t];
    }
  }
  if (Array.isArray(raw) && raw.length) {
    return [...new Set(raw.map((p) => String(p).trim()).filter(Boolean))];
  }
  if (profile?.purpose) return [profile.purpose];
  return ["topic"];
}

/** PNG theme for study-plan-cards / table-cards: light | dark */
export function getCardTheme(profile) {
  return profile?.theme === "light" ? "light" : "dark";
}

export function getTopicsFromProfile(profile, purposeOverride) {
  const purpose = purposeOverride || profile.purpose;
  if (purpose === "exam") {
    let topics = profile.exam_topics;
    if (typeof topics === "string") {
      try {
        topics = JSON.parse(topics.replace(/'/g, '"'));
      } catch {
        topics = [topics];
      }
    }
    if (!Array.isArray(topics)) topics = [];
    const levels = profile.exam_topic_levels || {};
    return topics.map((title) => ({
      title,
      level: levels[title] ?? levels[String(title)] ?? "medium",
    }));
  }

  if (purpose === "olympiad") {
    const levels = profile.olympiad_levels || profile.olympiad_topic_levels;
    if (levels && typeof levels === "object" && !Array.isArray(levels)) {
      return Object.entries(levels).map(([title, level]) => ({ title, level }));
    }
    const subject = profile.olympiad_subject || "предмет";
    const level = profile.olympiad_level || "medium";
    return defaultOlympiadTopics(subject, level);
  }

  if (purpose === "topic") {
    const sub = profile.topic_sublevels;
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      return Object.entries(sub).map(([title, level]) => ({ title, level }));
    }
    const main = profile.study_topic || profile.study_subject || "тема";
    return [
      {
        title: main,
        level: profile.topic_level || "medium",
      },
    ];
  }

  return [];
}

function defaultOlympiadTopics(subject, defaultLevel) {
  const blocks = {
    math: ["Алгебра", "Геометрия", "Комбинаторика", "Теория чисел"],
    physics: ["Механика", "Термодинамика", "Электродинамика", "Оптика"],
    informatics: ["Структуры данных", "Динамическое программирование", "Графы"],
    chemistry: ["Неорганическая химия", "Органическая химия", "Расчётные задачи"],
    biology: ["Ботаника", "Зоология", "Анатомия", "Генетика"],
    russian: ["Орфография", "Пунктуация", "Стилистика"],
  };
  const key = String(subject || "").toLowerCase();
  const titles = blocks[key] || [`Подготовка: ${subject}`];
  return titles.map((title) => ({ title, level: defaultLevel }));
}

export function matchTopicKey(title, map) {
  if (!map || typeof map !== "object") return null;
  if (map[title] != null) return title;

  const t = String(title).toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const key of Object.keys(map)) {
    const k = key.toLowerCase();
    if (k === t) return key;
    if (k.includes(t) || t.includes(k)) {
      const score = Math.min(k.length, t.length);
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
      continue;
    }
    const words = t.split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 3);
    const hits = words.filter((w) => k.includes(w)).length;
    if (hits > bestScore) {
      bestScore = hits;
      best = key;
    }
  }
  return best;
}

export function topicField(profile, title, field) {
  const map = profile[field];
  if (!map || typeof map !== "object") return undefined;
  const key = matchTopicKey(title, map);
  return key ? map[key] : undefined;
}

export function getLevelMap(profile) {
  const purpose = profile.purpose;
  if (purpose === "exam") return profile.exam_topic_levels || {};
  if (purpose === "olympiad") {
    return profile.olympiad_levels || profile.olympiad_topic_levels || {};
  }
  if (purpose === "topic") {
    const sub = profile.topic_sublevels;
    if (sub && typeof sub === "object") return sub;
    const main = profile.study_topic || "тема";
    return { [main]: profile.topic_level || "medium" };
  }
  return {};
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isProfileSubLine(line) {
  return /^\s{2,}/.test(line) && line.trim() !== "";
}

/** Serialize one scalar for `- **key:** value` lines. */
export function formatProfileScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value.startsWith("[") && value.endsWith("]")) return value;
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return JSON.stringify(value).replace(/"/g, '"');
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/** One profile field block (markdown). */
export function formatProfileField(key, value) {
  if (value === null || value === undefined) {
    return `- **${key}:** null`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return `- **${key}:** []`;
    const items = value.map((v) => {
      const s = formatProfileScalar(v);
      return `  - ${s.startsWith('"') ? s : `"${v}"`}`;
    });
    return `- **${key}:**\n${items.join("\n")}`;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const items = Object.entries(value).map(
      ([k, v]) => `  - "${k}": ${formatProfileScalar(v)}`
    );
    return `- **${key}:**\n${items.join("\n")}`;
  }
  return `- **${key}:** ${formatProfileScalar(value)}`;
}

function findFieldBlock(lines, key) {
  const re = new RegExp(`^-\\s+\\*\\*${escapeRegExp(key)}:\\*\\*\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    let end = i + 1;
    if (m[1].trim() === "") {
      while (end < lines.length) {
        const line = lines[end];
        if (line.trim() === "" || line.startsWith("<!--")) {
          end++;
          continue;
        }
        if (isProfileSubLine(line)) {
          end++;
          continue;
        }
        break;
      }
    }
    return { start: i, end };
  }
  return null;
}

/** Patch profile.md in place; preserves unrelated sections and comments. */
export function patchProfileMarkdown(text, patch) {
  const lines = (text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const touched = [];

  for (const [key, value] of Object.entries(patch)) {
    const block = formatProfileField(key, value).split("\n");
    const span = findFieldBlock(lines, key);
    if (span) {
      lines.splice(span.start, span.end - span.start, ...block);
    } else {
      const insertAt = lines.length && lines[lines.length - 1].trim() === "" ? lines.length : lines.length;
      if (insertAt > 0 && lines[insertAt - 1]?.trim() !== "") lines.push("");
      lines.push(...block);
    }
    touched.push(key);
  }

  const out = lines.join("\n");
  return { text: out.endsWith("\n") ? out : out + "\n", updated: touched };
}

export function mergeProfile(base, patch) {
  const next = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === "object" &&
      !Array.isArray(next[key])
    ) {
      next[key] = { ...next[key], ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function createProfileMarkdown(profile, { title } = {}) {
  const name = title || profile?.name || "пользователь";
  const header = `# Профиль — ${name}\n\n`;
  const keys = Object.keys(profile || {});
  const body = keys.map((k) => formatProfileField(k, profile[k])).join("\n");
  return header + body + "\n";
}
