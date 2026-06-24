#!/usr/bin/env node
// _render-one-table.mjs — рендер одной markdown-таблицы в PNG с уникальным именем.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , userKey, fileArg, titleArg, subtitleArg, outArg] = process.argv;
if (!userKey || !fileArg || !outArg) {
  console.error("usage: node _render-one-table.mjs <user_key> <md_file> <title> <subtitle> <out_filename>");
  process.exit(1);
}

const cwd = process.cwd();
const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(cwd, fileArg);
if (!fs.existsSync(filePath)) {
  console.error("file not found:", filePath);
  process.exit(1);
}

const title = titleArg || "Таблица";
const subtitle = subtitleArg || "";

const stdout = execSync(
  `node scripts/table-cards.mjs --user ${userKey} --title "${title}" --subtitle "${subtitle}" --file "${filePath}"`,
  { encoding: "utf8" }
);
const json = JSON.parse(stdout);
if (!json.png_files || !json.png_files.length) {
  console.error("no png_files");
  process.exit(1);
}

const src = json.png_files[0];
const outDir = path.dirname(src);
const dst = path.join(outDir, outArg);
fs.copyFileSync(src, dst);
console.log("ok:", dst);