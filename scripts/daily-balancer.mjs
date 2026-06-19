#!/usr/bin/env node
// daily-balancer.mjs — balance weighted candidates (stdin/JSON or --file).
//
// Usage:
//   node scripts/daily-balancer.mjs --file candidates.json --budget 9 --date 2026-06-19
//   echo '{"candidates":[...],"budget":9,"date":"2026-06-19"}' | node scripts/daily-balancer.mjs

import fs from "node:fs";
import { parseArgs, out, die } from "./lib/cli.mjs";
import { balanceDay } from "./lib/daily-balancer.mjs";
import { resolveToday } from "./lib/dates.mjs";

const { opts } = parseArgs(process.argv);

async function loadInput() {
  if (opts.file) {
    return JSON.parse(fs.readFileSync(opts.file, "utf8"));
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) die("no input — use --file or stdin JSON");
  return JSON.parse(raw);
}

const data = await loadInput();
const candidates = data.candidates || data.items || [];
const budget = Number(opts.budget || data.budget || 9);
const date = opts.date || data.date || resolveToday(opts);

if (!candidates.length) die("empty candidates");

const result = balanceDay(candidates, budget, date);
out(result);
