// Cron failure logging and optional owner alert via Telegram.

import fs from "node:fs";
import path from "node:path";
import { WORKSPACE } from "./cli.mjs";
import { resolveBotToken, sendTelegramMessage } from "./telegram-deliver.mjs";

const LOG_PATH = path.join(WORKSPACE, "memory", "cron-errors.jsonl");

export function logCronError(entry) {
  const row = {
    ts: new Date().toISOString(),
    ...entry,
  };
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n", "utf8");
  return row;
}

export async function alertCronFailure({ script, error, exit_code, stdout }) {
  const row = logCronError({ script, error, exit_code, stdout: stdout?.slice(0, 500) || null });

  const ownerChat = process.env.GH_OWNER_CHAT_ID || process.env.OWNER_TELEGRAM_CHAT_ID;
  const token = resolveBotToken();
  if (!ownerChat || !token) {
    return { alerted: false, logged: true, path: "memory/cron-errors.jsonl" };
  }

  const msg = [
    "⚠️ Golden Hour cron",
    `Скрипт: ${script}`,
    `Ошибка: ${String(error || "unknown").slice(0, 300)}`,
    exit_code != null ? `Код: ${exit_code}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await sendTelegramMessage({ token, chatId: ownerChat, message: msg, buttons: null });
    return { alerted: true, logged: true };
  } catch (e) {
    return { alerted: false, logged: true, alert_error: String(e.message || e) };
  }
}
