#!/usr/bin/env bash
# =============================================================================
# Golden Hour — Initial Server Setup Script
# Run ONCE on a fresh Ubuntu/Debian server as root or with sudo.
# After this script, all subsequent deploys happen via GitHub Actions.
# =============================================================================
set -euo pipefail

# ---- Config (override via env before running) --------------------------------
BOT_USER="${BOT_USER:-golden-hour}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/golden-hour}"
REPO_URL="${REPO_URL:-https://github.com/margoshkagt-star/Golden-Hour.git}"
REPO_BRANCH="${REPO_BRANCH:-deploy}"
NODE_VERSION="${NODE_VERSION:-20}"
SSH_PORT="${SSH_PORT:-47822}"
SERVICE_NAME="${SERVICE_NAME:-golden-hour}"

# ---- Colors ------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ---- Prerequisites -----------------------------------------------------------
[[ $EUID -eq 0 ]] || error "Run as root: sudo bash deploy/setup-server.sh"

info "=== Golden Hour Server Setup ==="
info "Deploy path : $DEPLOY_PATH"
info "SSH port    : $SSH_PORT"
info "Bot user    : $BOT_USER"
info "Branch      : $REPO_BRANCH"
echo ""

# ---- 1. System packages ------------------------------------------------------
info "[1/9] Updating packages..."
apt-get update -qq
apt-get install -y -qq git curl ufw fail2ban sudo

# ---- 2. Node.js --------------------------------------------------------------
info "[2/9] Installing Node.js $NODE_VERSION..."
if ! command -v node &>/dev/null || [[ "$(node -e 'process.exit(+process.version.slice(1).split(".")[0] < '"$NODE_VERSION"')')" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
node_ver=$(node --version)
info "Node.js installed: $node_ver"

# ---- 3. Dedicated bot user ---------------------------------------------------
info "[3/9] Creating system user '$BOT_USER'..."
if ! id "$BOT_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$BOT_USER"
  info "User '$BOT_USER' created."
else
  warn "User '$BOT_USER' already exists — skipping."
fi

# ---- 4. Deploy directory -----------------------------------------------------
info "[4/9] Setting up deploy directory..."
if [ -d "$DEPLOY_PATH/.git" ]; then
  warn "Repo already cloned at $DEPLOY_PATH — pulling latest."
  git -C "$DEPLOY_PATH" fetch origin "$REPO_BRANCH"
  git -C "$DEPLOY_PATH" checkout "$REPO_BRANCH"
  git -C "$DEPLOY_PATH" reset --hard "origin/$REPO_BRANCH"
else
  git clone --branch "$REPO_BRANCH" --depth 50 "$REPO_URL" "$DEPLOY_PATH"
fi

# ---- 5. Persistent data directories (NEVER overwrite on deploy) -------------
info "[5/9] Creating persistent data directories..."
# These directories hold user data and are excluded from git —
# they must survive every git pull / reset --hard.
mkdir -p \
  "$DEPLOY_PATH/users" \
  "$DEPLOY_PATH/data/teams" \
  "$DEPLOY_PATH/memory"

# ---- 6. Permissions ----------------------------------------------------------
info "[6/9] Setting permissions..."
chown -R "$BOT_USER:$BOT_USER" "$DEPLOY_PATH"
chmod 750 "$DEPLOY_PATH"
chmod -R 750 "$DEPLOY_PATH/scripts" "$DEPLOY_PATH/skills" 2>/dev/null || true
# Keep user data private (only bot user can read/write)
chmod 700 "$DEPLOY_PATH/users" "$DEPLOY_PATH/data"

# ---- 7. Environment file -----------------------------------------------------
info "[7/9] Setting up .env..."
if [ ! -f "$DEPLOY_PATH/.env" ]; then
  cp "$DEPLOY_PATH/deploy/.env.example" "$DEPLOY_PATH/.env"
  chown "$BOT_USER:$BOT_USER" "$DEPLOY_PATH/.env"
  chmod 640 "$DEPLOY_PATH/.env"
  warn "Created $DEPLOY_PATH/.env — FILL IN YOUR SECRETS before starting the service."
else
  warn ".env already exists — not overwriting."
fi

# ---- 8. Systemd service ------------------------------------------------------
info "[8/9] Installing systemd service..."
cp "$DEPLOY_PATH/deploy/service/golden-hour.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
info "Service enabled (will not start until .env is filled in)."

# ---- 9. Firewall & SSH hardening ---------------------------------------------
info "[9/9] Configuring UFW and SSH..."

# UFW: allow non-standard SSH port + app port
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp" comment 'SSH (non-standard)'
ufw --force enable
info "UFW configured. SSH port: $SSH_PORT"

# Harden SSH: change port, disable root login, disable password auth
SSH_CONFIG="/etc/ssh/sshd_config"
if grep -q "^Port $SSH_PORT" "$SSH_CONFIG"; then
  warn "SSH already configured to port $SSH_PORT — skipping."
else
  warn "Changing SSH port to $SSH_PORT. Ensure your GitHub secret SSH_PORT matches!"
  sed -i "s/^#*Port .*/Port $SSH_PORT/" "$SSH_CONFIG"
  sed -i "s/^#*PermitRootLogin .*/PermitRootLogin no/" "$SSH_CONFIG"
  sed -i "s/^#*PasswordAuthentication .*/PasswordAuthentication no/" "$SSH_CONFIG"
  systemctl restart sshd
  warn "SSH restarted on port $SSH_PORT. Update your SSH session before closing this one!"
fi

# fail2ban for SSH brute-force protection
systemctl enable fail2ban
systemctl start fail2ban

# ---- sudoers for service management (deploy-only) ----------------------------
info "Granting $SERVER_USER (GitHub Actions) passwordless sudo for service..."
# Replace $SERVER_USER with the actual deploy user
DEPLOY_SUDO_USER="${DEPLOY_SUDO_USER:-ubuntu}"
SUDOERS_LINE="$DEPLOY_SUDO_USER ALL=(root) NOPASSWD: /bin/systemctl daemon-reload, /bin/systemctl restart $SERVICE_NAME, /bin/systemctl is-active $SERVICE_NAME, /bin/journalctl -u $SERVICE_NAME *"
echo "$SUDOERS_LINE" > "/etc/sudoers.d/golden-hour-deploy"
chmod 440 "/etc/sudoers.d/golden-hour-deploy"
visudo -cf "/etc/sudoers.d/golden-hour-deploy" || error "sudoers syntax check failed"

echo ""
info "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit $DEPLOY_PATH/.env and add TELEGRAM_BOT_TOKEN"
echo "  2. Set up OpenClaw: su -s /bin/bash $BOT_USER -c 'openclaw setup'"
echo "  3. Start the service: systemctl start $SERVICE_NAME"
echo "  4. Check logs: journalctl -u $SERVICE_NAME -f"
echo ""
echo "GitHub Actions secrets to set (Settings → Secrets → Actions):"
echo "  SERVER_HOST      = your server IP or hostname"
echo "  SERVER_USER      = $DEPLOY_SUDO_USER (the SSH user for deploy)"
echo "  SSH_PRIVATE_KEY  = contents of ~/.ssh/id_ed25519 (deploy key)"
echo "  SSH_PORT         = $SSH_PORT"
