#!/usr/bin/env bash
# Install Golden Hour cron jobs as systemd *user* timers (Linux / Raspberry Pi).
# Replaces the Windows-only scripts/cron/register-all-cron.ps1.
#
# Each job runs a deterministic Node script (no LLM); delivery goes through
# cron-deliver.mjs + TELEGRAM_BOT_TOKEN. Timers fire in the host's LOCAL time —
# set the system timezone to match GH_TZ (see README.md).
#
# Usage:
#   bash deploy/pi/install-timers.sh            # install + enable
#   bash deploy/pi/install-timers.sh --uninstall
#
# Override workspace/node/env with env vars:
#   GH_WORKSPACE=/opt/golden-hour NODE_BIN=/usr/bin/node bash deploy/pi/install-timers.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${GH_WORKSPACE:-$(cd "$HERE/../.." && pwd)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
ENV_FILE="${GH_ENV_FILE:-$HERE/golden-hour.env}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

# name|OnCalendar|exec-args
JOBS=(
  "golden-hour-morning-plan|*-*-* 07:00:00|scripts/morning-plan.mjs"
  "golden-hour-morning-brief|*-*-* 07..10:00/15:00|scripts/cron-deliver.mjs morning-brief.mjs"
  "golden-hour-task-pings|*:0/5|scripts/cron-deliver.mjs task-pings.mjs"
  "golden-hour-evening-checkin|*-*-* 20..22:00/15:00|scripts/cron-deliver.mjs evening-checkin.mjs"
  "golden-hour-timer-tick|*:0/1|scripts/cron-deliver.mjs timer-tick.mjs"
  "golden-hour-cleanup-cards|Sun *-*-* 03:00:00|scripts/cleanup-cards.mjs --keep 20"
)

names() { for j in "${JOBS[@]}"; do echo "${j%%|*}"; done; }

if [[ "${1:-}" == "--uninstall" ]]; then
  for name in $(names); do
    systemctl --user disable --now "$name.timer" 2>/dev/null || true
    rm -f "$UNIT_DIR/$name.service" "$UNIT_DIR/$name.timer"
    echo "removed $name"
  done
  systemctl --user daemon-reload
  echo "Done. Golden Hour timers uninstalled."
  exit 0
fi

[[ -n "$NODE_BIN" ]] || { echo "node not found; set NODE_BIN=/path/to/node" >&2; exit 1; }
[[ -f "$WORKSPACE/scripts/cron-deliver.mjs" ]] || { echo "workspace not found at $WORKSPACE; set GH_WORKSPACE" >&2; exit 1; }

mkdir -p "$UNIT_DIR"
[[ -f "$ENV_FILE" ]] || { cp "$HERE/golden-hour.env.example" "$ENV_FILE"; echo "created $ENV_FILE — fill TELEGRAM_BOT_TOKEN + GH_TZ"; }

echo "workspace : $WORKSPACE"
echo "node      : $NODE_BIN"
echo "env file  : $ENV_FILE"
echo "units     : $UNIT_DIR"
echo

for j in "${JOBS[@]}"; do
  name="${j%%|*}"; rest="${j#*|}"
  cal="${rest%%|*}"; exec_args="${rest##*|}"

  cat > "$UNIT_DIR/$name.service" <<EOF
[Unit]
Description=Golden Hour — ${name#golden-hour-}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$WORKSPACE
EnvironmentFile=-$ENV_FILE
ExecStart=$NODE_BIN $exec_args
EOF

  cat > "$UNIT_DIR/$name.timer" <<EOF
[Unit]
Description=Golden Hour timer — ${name#golden-hour-}

[Timer]
OnCalendar=$cal
AccuracySec=10s
Persistent=false

[Install]
WantedBy=timers.target
EOF

  echo "wrote $name (OnCalendar=$cal)"
done

systemctl --user daemon-reload
for name in $(names); do
  systemctl --user enable --now "$name.timer"
done

echo
echo "Enabled. Verify:  systemctl --user list-timers 'golden-hour-*'"
echo "IMPORTANT:"
echo "  1) Keep timers running without an active login:  loginctl enable-linger $USER"
echo "  2) Timers fire in SYSTEM local time — align it with GH_TZ:"
echo "       sudo timedatectl set-timezone <Area/City>   # e.g. Europe/Moscow"
echo "  3) Put TELEGRAM_BOT_TOKEN and GH_TZ into: $ENV_FILE"
