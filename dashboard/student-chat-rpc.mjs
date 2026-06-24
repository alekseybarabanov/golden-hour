#!/usr/bin/env node
/**
 * One-shot Gateway RPC for student portal (chat.history / chat.send).
 * Uses Node native WebSocket — gateway stays on loopback; phones talk HTTP to portal only.
 *
 *   node student-chat-rpc.mjs history --session <key> [--limit 80]
 *   node student-chat-rpc.mjs send --session <key> --message "text"
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const opts = {};
  let cmd = null;
  let i = 2;
  if (argv[2] && !argv[2].startsWith("--")) {
    cmd = argv[2];
    i = 3;
  }
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      opts[k] = v;
    }
  }
  return { cmd, opts };
}

function openclawHome() {
  return process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
}

function loadGatewayToken() {
  const env = process.env.GATEWAY_AUTH_TOKEN?.trim();
  if (env) return env;
  const home = openclawHome();
  const envPath = path.join(home, ".env");
  if (fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [k, ...rest] = line.split("=");
      if (k.trim() === "GATEWAY_AUTH_TOKEN") {
        return rest.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  const secretsPath = path.join(home, "secrets.json");
  if (fs.existsSync(secretsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
      const tok = data?.gateway?.auth?.token;
      if (tok) return String(tok).trim();
    } catch {
      /* ignore */
    }
  }
  return "";
}

function gatewayPort() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(openclawHome(), "openclaw.json"), "utf8")
    );
    return cfg?.gateway?.port || 18789;
  } catch {
    return 18789;
  }
}

function request(ws, method, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), timeoutMs);
    const onMsg = (ev) => {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (frame.type !== "res" || frame.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMsg);
      if (frame.ok) resolve(frame.payload);
      else reject(new Error(frame.error?.message || `${method} failed`));
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

async function connectGateway() {
  const token = loadGatewayToken();
  if (!token) throw new Error("gateway token not found");

  const port = gatewayPort();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const connectId = randomUUID();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connect timeout")), 15000);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 4,
            maxProtocol: 4,
            client: {
              id: "openclaw-control-ui",
              displayName: "Golden Hour Portal",
              version: "1.0.0",
              platform: "web",
              mode: "webchat",
              instanceId: randomUUID().slice(0, 8),
            },
            auth: { token },
            role: "operator",
            scopes: ["operator.read", "operator.write"],
          },
        })
      );
    });
    ws.addEventListener("message", (ev) => {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (frame.type === "res" && frame.id === connectId) {
        clearTimeout(timer);
        if (frame.ok) resolve();
        else reject(new Error(frame.error?.message || "handshake failed"));
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    });
  });

  return ws;
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv);
  if (!cmd || !["history", "send"].includes(cmd)) {
    process.stderr.write("usage: history|send --session <key> [--message ...]\n");
    process.exit(2);
  }
  const sessionKey = opts.session;
  if (!sessionKey) {
    process.stdout.write(JSON.stringify({ ok: false, error: "missing --session" }) + "\n");
    process.exit(1);
  }

  let ws;
  try {
    ws = await connectGateway();
    let payload;
    if (cmd === "history") {
      const limit = Number(opts.limit || 80);
      payload = await request(ws, "chat.history", { sessionKey, limit });
    } else {
      const message = opts.message;
      if (!message) throw new Error("missing --message");
      payload = await request(ws, "chat.send", {
        sessionKey,
        message,
        idempotencyKey: randomUUID(),
      });
    }
    process.stdout.write(JSON.stringify({ ok: true, ...payload }) + "\n");
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: e.message || String(e) }) + "\n"
    );
    process.exit(1);
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  }
}

main();
