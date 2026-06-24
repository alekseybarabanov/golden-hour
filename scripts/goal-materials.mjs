#!/usr/bin/env node
// goal-materials.mjs — materials library CLI (list/pick/add/status).
//
// Usage:
//   node scripts/goal-materials.mjs goals --user <key>
//   node scripts/goal-materials.mjs list --user <key> [--goal <goal_id>] [--type theory] [--status new] [--tag ...]
//   node scripts/goal-materials.mjs pick --user <key> [--goal <goal_id>] [--topic "..."] [--type ...] [--limit N]
//   node scripts/goal-materials.mjs today --user <key> [--date YYYY-MM-DD]
//   node scripts/goal-materials.mjs show --user <key> --id <m_...>
//   node scripts/goal-materials.mjs search --user <key> --query "..."
//   node scripts/goal-materials.mjs add --user <key> --goal <goal_id> --type theory --title "..." [--source-url ...] [--dry-run]
//   node scripts/goal-materials.mjs status --user <key> --id <m_...> --status understood
//   node scripts/goal-materials.mjs rebuild-index --user <key>
//   node scripts/goal-materials.mjs fix-frontmatter --user <key>

import path from "node:path";
import {
  parseArgs,
  requireUser,
  userDir,
  readText,
  relWorkspacePath,
  out,
  die,
  isDryRun,
} from "./lib/cli.mjs";
import { loadProfile, getSetupStatus } from "./lib/profile.mjs";
import {
  loadUserGoals,
  listMaterials,
  pickMaterials,
  getMaterial,
  addMaterial,
  setMaterialStatus,
  rebuildIndex,
  fixMaterialFrontmatter,
  materialsForToday,
  primaryGoalId,
} from "./lib/goal-materials-core.mjs";
import { todayISO } from "./lib/dates.mjs";

const { cmd, opts } = parseArgs(process.argv);
if (!cmd) {
  die("missing command: goals|list|pick|today|show|search|add|status|rebuild-index|fix-frontmatter");
}

const userKey = requireUser(opts);
const dir = userDir(userKey);
const { exists, profile } = loadProfile(dir, (p) => readText(p));
if (!exists) die("profile not found");
if (getSetupStatus(profile) !== "complete" && cmd !== "goals") {
  die("setup_status not complete");
}

function summaryItems(items) {
  return items.map((x, i) => ({
    n: i + 1,
    id: x.id,
    type: x.type,
    title: x.title,
    status: x.status || "new",
    goal_id: x.goal_id,
    source_url: x.source_url || null,
  }));
}

switch (cmd) {
  case "goals": {
    const { goals } = loadUserGoals(dir, (p) => readText(p));
    out({
      user_key: userKey,
      goals,
      primary: goals[0] || null,
      summary: goals.length
        ? `Цели материалов: ${goals.join(", ")}`
        : "Цели не определены — проверь profile.md",
    });
    break;
  }

  case "list": {
    const items = listMaterials(dir, {
      goal_id: opts.goal,
      type: opts.type,
      status: opts.status,
      tag: opts.tag,
    });
    out({
      user_key: userKey,
      count: items.length,
      items: summaryItems(items),
      summary:
        items.length === 0
          ? "Материалов нет — можно искать через web-material-finder"
          : `Материалов: ${items.length}`,
    });
    break;
  }

  case "pick":
  case "today": {
    let items;
    let meta = {};
    if (cmd === "today") {
      const r = materialsForToday(dir, profile, opts.date || todayISO());
      items = r.items;
      meta = { date: r.date, topic: r.topic, goal_id: r.goal_id };
    } else {
      items = pickMaterials(dir, {
        goal_id: opts.goal || primaryGoalId(profile),
        topic: opts.topic,
        type: opts.type,
        status: opts.status,
        tag: opts.tag,
        limit: opts.limit ? Number(opts.limit) : 10,
      });
    }
    out({
      user_key: userKey,
      ...meta,
      count: items.length,
      items: summaryItems(items),
      summary:
        items.length === 0
          ? "Локальных материалов нет — сначала pick/list, потом web-material-finder"
          : `Подборка: ${items.length} материал(ов)`,
      hint:
        items.length > 0
          ? "Покажи items пользователю. Новый поиск — только если пользователь явно просит или pick пуст."
          : null,
    });
    break;
  }

  case "show": {
    const id = opts.id;
    if (!id) die("missing --id");
    const mat = getMaterial(dir, id);
    if (!mat) die("material not found", { id });
    out({
      user_key: userKey,
      id,
      goal_id: mat.entry.goal_id,
      type: mat.entry.type,
      title: mat.entry.title,
      source_url: mat.meta?.source_url || mat.entry.source_url || null,
      body: mat.body,
      path: relWorkspacePath(mat.path),
    });
    break;
  }

  case "search": {
    const q = opts.query || opts.q;
    if (!q) die("missing --query");
    const items = listMaterials(dir, {
      goal_id: opts.goal,
      query: q,
      type: opts.type,
      tag: opts.tag,
    });
    out({
      user_key: userKey,
      query: q,
      count: items.length,
      items: summaryItems(items),
      summary: `Найдено: ${items.length}`,
    });
    break;
  }

  case "add": {
    const goal_id = opts.goal || primaryGoalId(profile);
    const type = opts.type;
    const title = opts.title;
    if (!goal_id) die("missing --goal (или заполни profile.md)");
    if (!type) die("missing --type");
    if (!title) die("missing --title");

    let tags = [];
    if (opts.tags) {
      try {
        tags = JSON.parse(opts.tags.replace(/'/g, '"'));
      } catch {
        tags = String(opts.tags)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }
    }

    const result = addMaterial(dir, {
      goal_id,
      type,
      title,
      source: opts.source || "user",
      source_url: opts["source-url"] || opts.sourceUrl || null,
      tags,
      body: opts.body || opts.text || "",
      dry_run: isDryRun(opts),
    });
    if (!result.ok) die(result.error);
    out({ user_key: userKey, ...result });
    break;
  }

  case "status": {
    const id = opts.id;
    const status = opts.status;
    if (!id) die("missing --id");
    if (!status) die("missing --status");
    const result = setMaterialStatus(dir, id, status);
    if (!result.ok) die(result.error);
    out({ user_key: userKey, ...result });
    break;
  }

  case "rebuild-index": {
    const r = rebuildIndex(dir);
    out({
      user_key: userKey,
      ...r,
      summary: `Индекс: ${r.count} материал(ов) в ${r.goals.length} целях`,
    });
    break;
  }

  case "fix-frontmatter": {
    const r = fixMaterialFrontmatter(dir);
    out({
      user_key: userKey,
      ...r,
      summary: r.fixed ? `Исправлено файлов: ${r.fixed}` : "Frontmatter в порядке",
    });
    break;
  }

  default:
    die(`unknown command: ${cmd}`);
}
