// Personal student portal: per-user tokens and LAN URLs.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORKSPACE, userDir } from "./cli.mjs";
import { loadProfile } from "./profile.mjs";

const PORTAL_FILE = "portal.json";
const DEFAULT_PORT = Number(process.env.GH_STUDENT_PORTAL_PORT || 18791);
const PORTAL_UI_VERSION = process.env.GH_PORTAL_UI_VERSION || "7";
const HOTSPOT_HOST = process.env.GH_STUDENT_PORTAL_HOTSPOT_HOST?.trim() || "192.168.137.1";
const DASHBOARD_DIR = path.join(WORKSPACE, "dashboard");

export function portalPath(userKey) {
  return path.join(userDir(userKey), PORTAL_FILE);
}

export function readPortal(userKey) {
  const p = portalPath(userKey);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writePortal(userKey, data) {
  const p = portalPath(userKey);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

export function ensurePortalToken(userKey, { rotate = false } = {}) {
  const existing = readPortal(userKey);
  if (existing?.token && !rotate) return existing;

  const token = crypto.randomBytes(24).toString("base64url");
  const now = new Date().toISOString();
  const data = {
    token,
    created: existing?.created || now.slice(0, 10),
    rotated_at: rotate ? now : existing?.rotated_at || null,
  };
  return writePortal(userKey, data);
}

export function findUserByToken(token) {
  if (!token || typeof token !== "string" || token.length < 16) return null;
  const root = path.join(WORKSPACE, "users");
  if (!fs.existsSync(root)) return null;

  for (const name of fs.readdirSync(root)) {
    if (name.startsWith("_")) continue;
    const p = path.join(root, name, PORTAL_FILE);
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      if (data.token === token) {
        return { user_key: name, portal: data };
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export function sessionKeyForUser(userKey) {
  const m = /^tg-(\d+)$/.exec(userKey);
  if (m) return `agent:golden-hour:telegram:direct:${m[1]}`;
  return `agent:golden-hour:main`;
}

function isVirtualOrTunnelIp(ip) {
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("192.168.56.")) return true; // Hyper-V / VirtualBox host
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // Docker / VPN
  return false;
}

function ifaceScore(name, ip) {
  const n = (name || "").toLowerCase();
  let score = 0;
  if (/wi-?fi|wireless|беспровод|wlan/i.test(n)) score += 100;
  if (/ethernet|eth/i.test(n) && !/virtual|vethernet|hyper|vmware|virtualbox/i.test(n)) score += 40;
  if (ip.startsWith("192.168.")) score += 30;
  if (ip.startsWith("10.")) score += 20;
  if (isVirtualOrTunnelIp(ip)) score -= 200;
  if (/virtual|vethernet|hyper|vmware|virtualbox|happ|tun|tap|wsl/i.test(n)) score -= 150;
  return score;
}

export function listLanIps() {
  const env = process.env.GH_STUDENT_PORTAL_HOST?.trim();
  if (env) return [env];

  const nets = os.networkInterfaces();
  const scored = [];

  for (const [name, entries] of Object.entries(nets)) {
    for (const e of entries || []) {
      if (e.family !== "IPv4" && e.family !== 4) continue;
      if (e.internal) continue;
      const ip = e.address;
      if (!ip || ip.startsWith("127.")) continue;
      scored.push({ ip, score: ifaceScore(name, ip), name });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const row of scored) {
    if (seen.has(row.ip)) continue;
    seen.add(row.ip);
    out.push(row.ip);
  }
  if (out.includes("192.168.137.1")) {
    return ["192.168.137.1", ...out.filter((x) => x !== "192.168.137.1")];
  }
  return out.length ? out : ["127.0.0.1"];
}

export function detectLanIp() {
  return listLanIps()[0];
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export function hotspotHost() {
  return HOTSPOT_HOST;
}

export function publicStudentPortalBaseUrl() {
  const env =
    process.env.GH_STUDENT_PORTAL_PUBLIC_URL?.trim() ||
    process.env.TELEGRAM_STUDENT_MINIAPP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");

  const state = readJsonSafe(path.join(DASHBOARD_DIR, ".portal-state.json"));
  const stateUrl = typeof state?.student_tunnel_url === "string"
    ? state.student_tunnel_url.trim()
    : "";
  if (stateUrl.startsWith("https://")) return stateUrl.replace(/\/+$/, "");

  return "";
}

export function portalUrl(userKey, { host, port = DEFAULT_PORT } = {}) {
  const { token } = ensurePortalToken(userKey);
  const publicBase = publicStudentPortalBaseUrl();
  const ip = host || detectLanIp();
  const primaryHost = host || (listLanIps().includes(HOTSPOT_HOST) ? HOTSPOT_HOST : ip);
  const pathPart = `/my/${token}?v=${PORTAL_UI_VERSION}`;
  const hotspotUrl = `http://${HOTSPOT_HOST}:${port}${pathPart}`;
  const lanUrl = `http://${primaryHost}:${port}${pathPart}`;
  return {
    token,
    host: primaryHost,
    port,
    url: publicBase ? `${publicBase}${pathPart}` : hotspotUrl,
    public_url: publicBase ? `${publicBase}${pathPart}` : "",
    public_base_url: publicBase,
    lan_url: lanUrl,
    hotspot_url: hotspotUrl,
    hotspot_host: HOTSPOT_HOST,
    path: pathPart,
    ui_version: PORTAL_UI_VERSION,
  };
}

export function userDisplayName(userKey, readText) {
  const dir = userDir(userKey);
  const { profile } = loadProfile(dir, readText);
  return profile?.name || "Ученик";
}
