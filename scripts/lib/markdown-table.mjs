// Parse markdown pipe tables from text.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chunkTableByHeight } = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../skills/study-cards/lib/table-layout.js")
);

function parseRow(line) {
  if (!line.trim().startsWith("|")) return null;
  const cells = line
    .split("|")
    .map((c) => c.trim().replace(/\*\*/g, ""))
    .filter((_, i, arr) => i > 0 && i < arr.length - 1);
  return cells.length ? cells : null;
}

function isSeparator(line) {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  return /^\|[\s\-:|]+\|$/.test(t.replace(/\s/g, ""));
}

/** @returns {{ headers: string[], rows: string[][] }[]} */
export function extractMarkdownTables(text) {
  const tables = [];
  const lines = String(text || "").split("\n");
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith("|")) {
      i++;
      continue;
    }
    const block = [];
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      block.push(lines[i]);
      i++;
    }
    if (block.length < 2 || !isSeparator(block[1])) continue;
    const headers = parseRow(block[0]);
    if (!headers) continue;
    const rows = block
      .slice(2)
      .map(parseRow)
      .filter((r) => r && r.some((c) => c !== "" && c !== "—"));
    if (rows.length) tables.push({ headers, rows });
  }
  return tables;
}

export function textHasMarkdownTable(text) {
  return extractMarkdownTables(text).length > 0;
}

/** Split large tables into pages by estimated PNG height. */
export function chunkTable(table, maxHeight = 4200, meta = {}) {
  return chunkTableByHeight(table, maxHeight, meta);
}
