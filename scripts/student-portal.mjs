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
const portalUrls = listLanIps().map(
  (ip) => `http://${ip}:${link.port}/my/${token}?v=${link.ui_version}`
);
const hotspotUrl = `http://192.168.137.1:${link.port}/my/${token}?v=${link.ui_version}`;

out({
  user_key: userKey,
  name: userDisplayName(userKey, readText),
  session_key: sessionKeyForUser(userKey),
  portal_url: link.url,
  portal_urls: portalUrls,
  hotspot_url: hotspotUrl,
  lan_ip: link.host,
  port: link.port,
  access_note:
    "Sber-Guest и другие Guest Wi-Fi часто блокируют телефон↔ПК. Если ссылка не открывается: включи раздачу Wi‑Fi с ПК (мобильный хотспот), подключи телефон к хотспоту ПК, открой hotspot_url.",
  hotspot_hint:
    "Параметры → Сеть → Мобильный хотспот → Вкл. Телефон подключается к Wi‑Fi ПК, не к Sber-Guest.",
  hint: "Откройте ссылку в браузере телефона, подключённого к тому же Wi‑Fi.",
  lan_ip_detected: detectLanIp(),
});
