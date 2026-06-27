#!/usr/bin/env node
// cron-deliver.mjs — run a notification script and deliver via Telegram Bot API (no LLM).
//
// Usage: node scripts/cron-deliver.mjs <script.mjs> [--script-args ...] [--deliver-dry-run]
//
// Requires TELEGRAM_BOT_TOKEN for real delivery.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, out, die, WORKSPACE } from "./lib/cli.mjs";
import { deliverFromPayload } from "./lib/telegram-deliver.mjs";
import { alertCronFailure } from "./lib/cron-alert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const deliverDryRun = argv.includes("--deliver-dry-run");
const scriptArgs = [];
let scriptRel = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--deliver-dry-run") continue;
  if (!scriptRel) {
    scriptRel = a.replace(/^scripts[/\\]/, "");
    continue;
  }
  scriptArgs.push(a);
}

if (!scriptRel) {
  die("usage: node scripts/cron-deliver.mjs <script.mjs> [script args...]");
}

const scriptPath = path.join(WORKSPACE, "scripts", scriptRel);
const run = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
  cwd: WORKSPACE,
  encoding: "utf8",
});

if (run.status !== 0) {
  const errText = run.stderr?.trim() || `script failed: ${scriptRel}`;
  await alertCronFailure({
    script: scriptRel,
    error: errText,
    exit_code: run.status,
    stdout: run.stdout?.trim() || null,
  });
  die(errText, {
    exit_code: run.status,
    stdout: run.stdout?.trim() || null,
  });
}

let payload;
try {
  const line = (run.stdout || "").trim().split("\n").filter(Boolean).pop();
  payload = JSON.parse(line);
} catch {
  die("script did not return JSON on stdout", { stdout: run.stdout?.trim() || null });
}

if (payload.ok === false) {
  await alertCronFailure({
    script: scriptRel,
    error: payload.error || "payload ok:false",
    stdout: JSON.stringify(payload).slice(0, 500),
  });
  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(1);
}

const delivery = await deliverFromPayload(payload, { dryRun: deliverDryRun });

out({
  ...payload,
  delivery,
  summary: delivery.ok
    ? `${payload.summary || "Done."} Доставлено: ${delivery.delivered?.length || 0}.`
    : delivery.error,
});
