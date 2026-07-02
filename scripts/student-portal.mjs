#!/usr/bin/env node
// Personal student portal link for a user (LAN / shared WiFi).
//
// Usage:
//   node scripts/student-portal.mjs --user tg-123456
//   node scripts/student-portal.mjs --user tg-123456 --rotate
//   node scripts/student-portal.mjs --token <portal-token>   # resolve user (internal)

import fs from "node:fs";
import { parseArgs, requireUser, die, out } from "./lib/cli.mjs";
import {
  ensurePortalToken,
  findUserByToken,
  portalUrl,
  sessionKeyForUser,
  userDisplayName,
  detectLanIp,
  listLanIps,
} from "./lib/portal-core.mjs";

const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const { opts } = parseArgs(process.argv);

if (opts.token) {
  const hit = findUserByToken(opts.token);
  if (!hit) die("unknown portal token");
  out({
    user_key: hit.user_key,
    session_key: sessionKeyForUser(hit.user_key),
    name: userDisplayName(hit.user_key, readText),
  });
  process.exit(0);
}

const userKey = requireUser(opts);
const rotate = opts.rotate === "true" || opts.rotate === true;
ensurePortalToken(userKey, { rotate: !!rotate });
const link = portalUrl(userKey, {
  host: opts.host || null,
  port: opts.port ? Number(opts.port) : undefined,
});
const { token } = link;
const includeLan = opts["include-lan"] === "true" || opts.includeLan === "true";
const lanPortalUrls = listLanIps().map(
  (ip) => `http://${ip}:${link.port}/my/${token}?v=${link.ui_version}`
);
const portalUrls = link.public_url
  ? [link.public_url, link.hotspot_url]
  : Array.from(new Set([link.url, ...lanPortalUrls]));

// Access wording depends on how the portal is reachable (link.mode):
//   public  — HTTPS tunnel; hotspot — Windows mobile hotspot; lan — same Wi‑Fi/LAN.
const NOTES = {
  public: {
    access_note: "Откройте portal_url — это HTTPS через локальный туннель.",
    hint: "Откройте portal_url в браузере телефона или через кнопку Study в Telegram.",
  },
  hotspot: {
    access_note: "Включите мобильный хотспот на этом ПК, подключите телефон к его Wi‑Fi и откройте portal_url в браузере.",
    hint: "Параметры Windows → Сеть → Мобильный хотспот → Вкл. Телефон подключается к Wi‑Fi ПК, не к гостевой сети.",
  },
  lan: {
    access_note: "Подключите телефон к той же локальной сети (Wi‑Fi/роутер), что и этот компьютер, и откройте portal_url в браузере.",
    hint: "Телефон и хост агента должны быть в одной сети. Открой portal_url в браузере телефона или через кнопку Study в Telegram.",
  },
};
const note = NOTES[link.mode] || NOTES.lan;

const payload = {
  user_key: userKey,
  name: userDisplayName(userKey, readText),
  session_key: sessionKeyForUser(userKey),
  portal_url: link.public_url || link.url,
  public_portal_url: link.public_url || null,
  portal_urls: portalUrls,
  mode: link.mode,
  lan_portal_url: link.lan_url,
  port: link.port,
  access_note: note.access_note,
  hint: note.hint,
};

// Hotspot-specific fields only when a Windows hotspot interface is actually present.
if (link.mode === "hotspot") {
  payload.hotspot_url = link.hotspot_url;
  payload.hotspot_host = link.hotspot_host;
  payload.hotspot_hint =
    "Параметры → Сеть → Мобильный хотспот → Вкл. Адрес шлюза обычно http://192.168.137.1";
}

if (includeLan) {
  payload.lan_portal_urls = lanPortalUrls;
  payload.lan_ip_detected = detectLanIp();
}

out(payload);
