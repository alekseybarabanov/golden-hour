// Deliver notifications[] from cron scripts via Telegram Bot API (no LLM).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { userKeyToChatId, commitPingIfNew } from "./task-pings-core.mjs";
import { readJson, writeJson, WORKSPACE } from "./cli.mjs";

const API_BASE = "https://api.telegram.org";

export function resolveBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.GOLDEN_HOUR_BOT_TOKEN) return process.env.GOLDEN_HOUR_BOT_TOKEN;

  const secretsPath = path.join(os.homedir(), ".openclaw", "secrets.json");
  try {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    const gh = secrets?.channels?.telegram?.["golden-hour"]?.botToken;
    if (gh) return gh;
    const main = secrets?.channels?.telegram?.botToken;
    if (main) return main;
  } catch {
    // ignore
  }
  return null;
}

function commitTaskPing(row, date) {
  if (!row?.task_id || row.trigger_at == null || !row.user_key || !date) return;
  const statePath = path.join(
    WORKSPACE,
    "users",
    row.user_key,
    "plans",
    `.ping-state-${date}.json`
  );
  const state = readJson(statePath, { date, count: 0, sent: [] });
  const { state: next, committed } = commitPingIfNew(state, {
    taskId: row.task_id,
    triggerMs: row.trigger_at,
    date,
  });
  if (committed) writeJson(statePath, next);
}

export async function sendTelegramMessage({ token, chatId, message, buttons }) {
  const body = {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown",
  };
  if (buttons?.length) {
    body.reply_markup = { inline_keyboard: buttons };
  }

  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${res.status}`);
  }
  return data.result;
}

/**
 * @param {{ results?: Array<{ user_key: string, notifications?: Array }> }} payload
 */
export async function deliverFromPayload(payload, { dryRun = false } = {}) {
  const token = resolveBotToken();
  const delivered = [];
  const skipped = [];
  const date = payload?.date || null;

  for (const row of payload?.results || []) {
    const notes = row.notifications || [];
    if (!notes.length) continue;

    const chatId = userKeyToChatId(row.user_key);
    if (!chatId) {
      skipped.push({ user_key: row.user_key, reason: "no_telegram_chat" });
      continue;
    }

    for (const n of notes) {
      if (!n?.message) continue;
      if (dryRun) {
        delivered.push({ user_key: row.user_key, chat_id: chatId, dry_run: true });
        continue;
      }
      if (!token) {
        return {
          ok: false,
          error: "Telegram bot token not found (TELEGRAM_BOT_TOKEN or ~/.openclaw/secrets.json)",
          delivered,
          skipped,
        };
      }
      try {
        const msg = await sendTelegramMessage({
          token,
          chatId,
          message: n.message,
          buttons: n.buttons,
        });
        delivered.push({
          user_key: row.user_key,
          chat_id: chatId,
          message_id: msg.message_id,
          template: n.template || null,
        });
        if (n.template === "task-ping") {
          commitTaskPing(row, date);
        }
      } catch (e) {
        skipped.push({
          user_key: row.user_key,
          chat_id: chatId,
          error: String(e.message || e),
        });
      }
    }
  }

  return { ok: true, delivered, skipped };
}
