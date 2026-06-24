#!/usr/bin/env node
// _render-plan-tables.mjs — последовательный рендер 4 таблиц плана с уникальными именами.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const userKey = "tg-1996411547";
const sourceFolder = "users/tg-1996411547/cards/tables/2026-06-24T1307";
const outFolder = path.join("users", userKey, "cards", "tables", "plan-2026-06-24");
fs.mkdirSync(outFolder, { recursive: true });

const items = [
  {
    file: "ege-budget.md",
    title: "ЕГЭ — бюджет часов",
    subtitle: "49 нед · 1960 ч · 40 ч/нед",
    out: "01-ege-budget.png",
  },
  {
    file: "ege-skeleton.md",
    title: "ЕГЭ — понедельный скелет",
    subtitle: "нед. 1-49 · приоритет: важные+слабые → финал",
    out: "02-ege-skeleton.png",
  },
  {
    file: "olymp-budget.md",
    title: "Олимпиады — бюджет часов",
    subtitle: "49 нед · 2450 ч · 50 ч/нед",
    out: "03-olymp-budget.png",
  },
  {
    file: "olymp-skeleton.md",
    title: "Олимпиады — понедельный скелет",
    subtitle: "нед. 1-49 · информатика → физика → финал",
    out: "04-olymp-skeleton.png",
  },
];

const rendered = [];
for (const it of items) {
  const filePath = path.join(sourceFolder, it.file);
  console.log(`\n→ ${it.title}`);
  const stdout = execSync(
    `node scripts/table-cards.mjs --user ${userKey} --title "${it.title}" --subtitle "${it.subtitle}" --file "${filePath}"`,
    { encoding: "utf8" }
  );
  const json = JSON.parse(stdout);
  if (!json.png_files || !json.png_files.length) {
    console.error("no png_files for", it.title);
    process.exit(1);
  }
  const src = json.png_files[0];
  const dst = path.join(outFolder, it.out);
  fs.copyFileSync(src, dst);
  console.log(`  ✓ ${src} → ${dst}`);
  rendered.push(dst);
  // sleep 1.5s to ensure next render is in different folder
  await new Promise((r) => setTimeout(r, 1500));
}

console.log("\nГотово, файлы:");
for (const r of rendered) console.log(" -", r);