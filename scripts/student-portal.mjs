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
const portalUrls = link.public_url ? [link.public_url, link.hotspot_url] : [link.hotspot_url, ...lanPortalUrls];

const payload = {
  user_key: userKey,
  name: userDisplayName(userKey, readText),
  session_key: sessionKeyForUser(userKey),
  portal_url: link.public_url || link.hotspot_url,
  public_portal_url: link.public_url || null,
  portal_urls: portalUrls,
  hotspot_url: link.hotspot_url,
  lan_portal_url: link.lan_url,
  hotspot_host: link.hotspot_host,
  port: link.port,
  access_note: link.public_url
    ? "Откройте portal_url — это HTTPS через локальный туннель на ПК."
    : "Включите мобильный хотспот на этом ПК, подключите телефон к его Wi‑Fi и откройте portal_url в браузере.",
  hint: link.public_url
    ? "Откройте portal_url в браузере телефона или через кнопку Study в Telegram."
    : "Параметры Windows → Сеть → Мобильный хотспот → Вкл. Телефон подключается к Wi‑Fi ПК, не к гостевой сети.",
  hotspot_hint:
    "Параметры → Сеть → Мобильный хотспот → Вкл. Адрес шлюза обычно http://192.168.137.1",
};

if (includeLan) {
  payload.lan_portal_urls = lanPortalUrls;
  payload.lan_ip_detected = detectLanIp();
}

out(payload);
