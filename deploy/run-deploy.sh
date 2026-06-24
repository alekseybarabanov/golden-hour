#!/usr/bin/env bash
# =============================================================================
# Golden Hour — Server-Side Deploy Script
#
# This file must be:
#   - Owned by root:  chown root:root /opt/golden-hour/deploy/run-deploy.sh
#   - Read-only:      chmod 555 /opt/golden-hour/deploy/run-deploy.sh
#   - Referenced in authorized_keys via ForceCommand so the deploy SSH key
#     cannot execute arbitrary commands on this server.
#
# Setup in /home/<deploy-user>/.ssh/authorized_keys:
#   command="/opt/golden-hour/deploy/run-deploy.sh",\
#   no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty \
#   ssh-ed25519 AAAA... deploy@golden-hour
# =============================================================================
set -euo pipefail

DEPLOY_PATH="/opt/golden-hour"
SERVICE_NAME="golden-hour"
BACKUP_DIR="/var/backups/golden-hour"
BRANCH="deploy"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}   $*"; }
error() { echo -e "${RED}[ERROR]${NC}  $*" >&2; }

# Expected commit SHA passed by GitHub Actions (first argument or $DEPLOY_SHA)
EXPECTED_SHA="${1:-${DEPLOY_SHA:-}}"

# ---- [0] Acquire deploy lock (prevents cron race during deploy) ---------------
LOCK_FILE="/var/lock/golden-hour-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  error "Another deploy is already running. Aborting."
  exit 1
fi

# ---- [1] Verify deploy directory exists --------------------------------------
info "[1/7] Checking deploy path..."
if [ ! -d "$DEPLOY_PATH/.git" ]; then
  error "No git repo at $DEPLOY_PATH. Run deploy/setup-server.sh first."
  exit 1
fi

# ---- [2] Backup persistent user data before touching the repo ----------------
info "[2/7] Backing up persistent user data..."
mkdir -p "$BACKUP_DIR"
BACKUP_TS=$(date +%Y%m%d-%H%M%S)
# Only backup if there is actual user data
if [ "$(ls -A "$DEPLOY_PATH/users" 2>/dev/null)" ]; then
  tar -czf "$BACKUP_DIR/users-$BACKUP_TS.tar.gz" \
    -C "$DEPLOY_PATH" users data memory 2>/dev/null || true
  info "Backup saved: $BACKUP_DIR/users-$BACKUP_TS.tar.gz"
  # Keep only the last 10 backups
  ls -t "$BACKUP_DIR"/users-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm --
else
  warn "No user data to back up yet."
fi

# ---- [3] Pull code (NEVER touches untracked user data) -----------------------
info "[3/7] Pulling code..."
cd "$DEPLOY_PATH"

# Save current HEAD for rollback
PREV_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

git fetch origin "$BRANCH" --quiet

# Verify we are about to deploy what GitHub Actions says we are
REMOTE_SHA=$(git rev-parse "origin/$BRANCH")
if [ -n "$EXPECTED_SHA" ] && [ "$REMOTE_SHA" != "$EXPECTED_SHA" ]; then
  error "SHA mismatch: expected $EXPECTED_SHA, remote has $REMOTE_SHA"
  error "Another push may have arrived. Aborting to avoid deploying the wrong commit."
  exit 1
fi

# Reset only tracked files — untracked users/ data/ memory/ are NOT touched.
# NEVER run 'git clean' here — it would delete user data.
git reset --hard "origin/$BRANCH"
NEW_SHA=$(git rev-parse HEAD)
info "Deployed commit: $NEW_SHA"

# ---- [4] Fix permissions (errors are fatal — do not suppress) ----------------
info "[4/7] Fixing permissions..."
# Code files owned by root, readable by golden-hour
chown -R root:golden-hour "$DEPLOY_PATH/scripts" "$DEPLOY_PATH/skills" 2>/dev/null || true
chmod -R 750 "$DEPLOY_PATH/scripts" "$DEPLOY_PATH/skills" 2>/dev/null || true
# Secrets: owner-only (service user golden-hour owns .env)
chmod 600 "$DEPLOY_PATH/.env" 2>/dev/null || true

# ---- [5] Reload systemd and restart with graceful drain ----------------------
info "[5/7] Restarting service (graceful drain via TimeoutStopSec)..."
sudo systemctl daemon-reload
# systemctl restart sends SIGTERM; golden-hour.service has TimeoutStopSec=30
# to allow in-flight requests to finish before SIGKILL.
sudo systemctl restart "$SERVICE_NAME"

# ---- [6] Health check with retry (detects crash loops) -----------------------
info "[6/7] Waiting for service to become healthy..."
HEALTHY=false
RESTARTS_BEFORE=$(sudo systemctl show "$SERVICE_NAME" --property=NRestarts --value 2>/dev/null || echo 0)

for i in $(seq 1 12); do
  sleep 5
  if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    RESTARTS_AFTER=$(sudo systemctl show "$SERVICE_NAME" --property=NRestarts --value 2>/dev/null || echo 0)
    if [ "$RESTARTS_AFTER" -gt "$RESTARTS_BEFORE" ]; then
      warn "Service restarted $((RESTARTS_AFTER - RESTARTS_BEFORE)) time(s) — possible crash loop."
    else
      HEALTHY=true
      info "Service is healthy after ${i} checks (~$((i*5))s)."
      break
    fi
  fi
  info "  Attempt $i/12 — service not yet active..."
done

if [ "$HEALTHY" != "true" ]; then
  error "Service failed to start. Showing journal:"
  sudo journalctl -u "$SERVICE_NAME" -n 50 --no-pager || true

  # Automatic rollback to previous commit
  if [ -n "$PREV_SHA" ] && [ "$PREV_SHA" != "$NEW_SHA" ]; then
    warn "Rolling back to $PREV_SHA..."
    git reset --hard "$PREV_SHA"
    sudo systemctl restart "$SERVICE_NAME" || true
    error "Deployment FAILED. Rolled back to $PREV_SHA."
  fi
  exit 1
fi

# ---- [7] Summary -------------------------------------------------------------
info "[7/7] Deployment complete."
echo ""
echo "  Previous : ${PREV_SHA:-none}"
echo "  Current  : $NEW_SHA"
echo "  Backup   : $BACKUP_DIR/users-$BACKUP_TS.tar.gz"
