# Golden Hour on Raspberry Pi / Linux

Adaptations for running the agent on a Raspberry Pi (or any Linux host) instead
of Windows. Three things differ from the default (Windows-oriented) setup:

1. **Cron** → systemd user timers (this folder) instead of `scripts/cron/*.ps1`.
2. **Timezone** → `GH_TZ` env, no longer hardcoded to Europe/Moscow.
3. **Student portal** → serves on the Pi's LAN IP, not the Windows hotspot `192.168.137.1`.

The core agent (Node scripts + skills) is cross-platform; only the surrounding
tooling needed Linux equivalents.

---

## 1. Prerequisites

- Raspberry Pi 4/5 with **≥4 GB RAM** recommended (gateway + Node; Chromium for
  PNG cards is heavy on ARM). Pi 3 / 1 GB will be tight against `MemoryMax`.
- 64-bit Raspberry Pi OS, **Node ≥18** (`node --version`), OpenClaw running on ARM.
- Prefer booting/data from **SSD** over an SD card, or take regular backups of
  `users/` — SD cards wear out under frequent writes (timer tick, plans, JSONL).
- Optional PNG cards: `sudo apt install chromium` (auto-detected via
  `/usr/bin/chromium`); slow on ARM but functional. Override with `EDGE_BIN`.
- Do **not** enable the Ollama fallback (`INSTALL_OLLAMA=0`): a local 7B model
  needs far more RAM than a Pi has. Use a cloud model via API key.

## 2. Timezone

Calendar-day math reads `GH_TZ` (IANA name, default `Europe/Moscow`); the UTC
offset is derived automatically (override with `GH_TZ_OFFSET`). Set the **system**
timezone to the same value so slot times and timer firing agree:

```bash
sudo timedatectl set-timezone Europe/Moscow    # or your Area/City
```

Put `GH_TZ` in `golden-hour.env` (below). For zones with DST, prefer a real IANA
name so the offset tracks DST; a fixed `GH_TZ_OFFSET` does not shift.

## 3. Cron via systemd user timers

```bash
cp deploy/pi/golden-hour.env.example deploy/pi/golden-hour.env
# edit golden-hour.env: TELEGRAM_BOT_TOKEN + GH_TZ (and optional portal host)

bash deploy/pi/install-timers.sh
loginctl enable-linger "$USER"     # keep timers running without an active login
systemctl --user list-timers 'golden-hour-*'
```

Installed timers (local time — match the system TZ):

| Timer | Schedule | Command |
|---|---|---|
| morning-plan | 07:00 daily | `morning-plan.mjs` (writes plans, no delivery) |
| morning-brief | 07:00–10:00 every 15 min | `cron-deliver.mjs morning-brief.mjs` |
| task-pings | every 5 min | `cron-deliver.mjs task-pings.mjs` |
| evening-checkin | 20:00–22:00 every 15 min | `cron-deliver.mjs evening-checkin.mjs` |
| timer-tick | every 1 min | `cron-deliver.mjs timer-tick.mjs` |
| cleanup-cards | Sun 03:00 | `cleanup-cards.mjs --keep 20` |

Delivery uses `TELEGRAM_BOT_TOKEN` from `golden-hour.env` (or
`~/.openclaw/secrets.json`). Logs: `journalctl --user -u golden-hour-task-pings`.

Remove everything: `bash deploy/pi/install-timers.sh --uninstall`.

> Alternative: OpenClaw's own cron (`openclaw cron add … --tz <IANA>`) works on
> Linux too; the systemd timers here are a self-contained option that needs no
> gateway cron support.

## 4. Student portal on the Pi's LAN

`student-portal.mjs` now returns `portal_url` as the Pi's LAN address (auto-detected)
with a `mode` field:

- `lan` — phone must join the **same Wi‑Fi/router** as the Pi (the normal case).
- `hotspot` — only when a Windows `192.168.137.1` interface exists.
- `public` — an HTTPS tunnel URL if configured.

Pin the address explicitly if auto-detection picks the wrong interface:

```bash
# in golden-hour.env (and export for the portal backend if you run it)
GH_STUDENT_PORTAL_HOST=192.168.1.50
```

The Python portal backend (`dashboard/student_portal_backend.py`, port 18791,
binds `0.0.0.0`) runs under Python 3 on the Pi; the Windows `.ps1` launchers and
hotspot scripts do not apply — start it directly, e.g.:

```bash
python3 dashboard/student_portal_backend.py
```

Open `http://<pi-lan-ip>:18791/…` from a phone on the same network.
