#!/usr/bin/env bash
# =============================================================================
# Golden Hour — Initial Server Setup Script
# Run ONCE on a fresh Ubuntu/Debian server as root or with sudo.
# After this, all subsequent deploys happen via GitHub Actions → run-deploy.sh.
# =============================================================================
set -euo pipefail

# ---- Config (override via env before running) --------------------------------
BOT_USER="${BOT_USER:-golden-hour}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/golden-hour}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/golden-hour}"
REPO_URL="${REPO_URL:-https://github.com/margoshkagt-star/Golden-Hour.git}"
REPO_BRANCH="${REPO_BRANCH:-deploy}"
NODE_VERSION="${NODE_VERSION:-20}"
# Non-standard SSH port (default 47822) — set this as GitHub Secret SSH_PORT
SSH_PORT="${SSH_PORT:-47822}"
SERVICE_NAME="${SERVICE_NAME:-golden-hour}"
# The OS user that GitHub Actions SSHes in as (NOT the bot service user)
DEPLOY_SUDO_USER="${DEPLOY_SUDO_USER:-ubuntu}"

# ---- Colors ------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ---- Prerequisites -----------------------------------------------------------
[[ $EUID -eq 0 ]] || error "Run as root: sudo bash deploy/setup-server.sh"

info "=== Golden Hour Server Setup ==="
info "Deploy path   : $DEPLOY_PATH"
info "SSH port      : $SSH_PORT"
info "Bot user      : $BOT_USER"
info "Deploy user   : $DEPLOY_SUDO_USER"
info "Branch        : $REPO_BRANCH"
echo ""

# ---- 1. System packages ------------------------------------------------------
info "[1/11] Updating packages..."
apt-get update -qq
apt-get install -y -qq git curl ufw fail2ban sudo

# ---- 2. Node.js --------------------------------------------------------------
info "[2/11] Installing Node.js $NODE_VERSION..."
if ! command -v node &>/dev/null; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
info "Node.js: $(node --version)"

# ---- 3. System tunables (must be done before service starts) -----------------
info "[3/11] Setting system tunables..."
cat > /etc/sysctl.d/99-golden-hour.conf <<'EOF'
# Allow high file descriptor limits for the bot service
fs.file-max = 131072
EOF
sysctl -p /etc/sysctl.d/99-golden-hour.conf

# ---- 4. Dedicated bot user ---------------------------------------------------
info "[4/11] Creating system user '$BOT_USER'..."
if ! id "$BOT_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$BOT_USER"
  info "User '$BOT_USER' created."
else
  warn "User '$BOT_USER' already exists — skipping."
fi

# ---- 5. Deploy directory -----------------------------------------------------
info "[5/11] Setting up deploy directory..."
if [ -d "$DEPLOY_PATH/.git" ]; then
  warn "Repo already cloned at $DEPLOY_PATH — pulling latest."
  git -C "$DEPLOY_PATH" fetch origin "$REPO_BRANCH"
  git -C "$DEPLOY_PATH" checkout "$REPO_BRANCH"
  git -C "$DEPLOY_PATH" reset --hard "origin/$REPO_BRANCH"
else
  git clone --branch "$REPO_BRANCH" --depth 50 "$REPO_URL" "$DEPLOY_PATH"
fi

# ---- 6. Persistent data directories (NEVER overwrite on deploy) -------------
info "[6/11] Creating persistent data directories..."
# These live INSIDE the git repo directory but are .gitignored —
# git reset --hard never touches untracked directories.
# For extra safety, run-deploy.sh backs them up before every deploy.
mkdir -p \
  "$DEPLOY_PATH/users" \
  "$DEPLOY_PATH/data/teams" \
  "$DEPLOY_PATH/memory" \
  "$BACKUP_DIR"

# ---- 7. Permissions ----------------------------------------------------------
info "[7/11] Setting permissions..."
# Code owned by root, readable/executable by golden-hour group
chown -R root:"$BOT_USER" "$DEPLOY_PATH"
chmod 750 "$DEPLOY_PATH"
chmod -R 750 "$DEPLOY_PATH/scripts" "$DEPLOY_PATH/skills" 2>/dev/null || true
# run-deploy.sh must be owned by root and NOT writable by the deploy user
chown root:root "$DEPLOY_PATH/deploy/run-deploy.sh"
chmod 555 "$DEPLOY_PATH/deploy/run-deploy.sh"
# User data: bot user owns it, no world access
chown -R "$BOT_USER:$BOT_USER" "$DEPLOY_PATH/users" "$DEPLOY_PATH/data" "$DEPLOY_PATH/memory"
chmod 700 "$DEPLOY_PATH/users" "$DEPLOY_PATH/data"
chown -R "$BOT_USER:$BOT_USER" "$BACKUP_DIR"

# ---- 8. Environment file -----------------------------------------------------
info "[8/11] Setting up .env..."
if [ ! -f "$DEPLOY_PATH/.env" ]; then
  cp "$DEPLOY_PATH/deploy/.env.example" "$DEPLOY_PATH/.env"
  chown "$BOT_USER:$BOT_USER" "$DEPLOY_PATH/.env"
  # 600 = owner-only, never group-readable (the deploy user cannot read secrets via SSH)
  chmod 600 "$DEPLOY_PATH/.env"
  warn "Created $DEPLOY_PATH/.env — FILL IN TELEGRAM_BOT_TOKEN before starting the service."
else
  warn ".env already exists — not overwriting. Verify it has chmod 600."
  chmod 600 "$DEPLOY_PATH/.env"
fi

# ---- 9. Systemd service + sudoers -------------------------------------------
info "[9/11] Installing systemd service..."
cp "$DEPLOY_PATH/deploy/service/golden-hour.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# Minimal sudoers: deploy user can only run specific systemctl subcommands
# and journalctl for this service — nothing else.
SUDOERS_FILE="/etc/sudoers.d/golden-hour-deploy"
cat > "$SUDOERS_FILE" <<EOF
# Allow $DEPLOY_SUDO_USER to manage the golden-hour service only.
# This file is managed by deploy/setup-server.sh — do not edit manually.
$DEPLOY_SUDO_USER ALL=(root) NOPASSWD: \\
  /bin/systemctl daemon-reload, \\
  /bin/systemctl restart $SERVICE_NAME, \\
  /bin/systemctl is-active $SERVICE_NAME, \\
  /bin/systemctl show $SERVICE_NAME --property=NRestarts --value, \\
  /bin/journalctl -u $SERVICE_NAME *
EOF
chmod 440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" || error "sudoers syntax check failed — fix $SUDOERS_FILE"
info "sudoers installed: $SUDOERS_FILE"

# ---- 10. SSH ForceCommand (C-4: restrict deploy key to run-deploy.sh only) --
info "[10/11] Configuring SSH ForceCommand for deploy key..."
DEPLOY_HOME=$(eval echo "~$DEPLOY_SUDO_USER")
SSH_DIR="$DEPLOY_HOME/.ssh"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

AUTH_KEYS="$SSH_DIR/authorized_keys"

# Instructions for the operator — we cannot write the key here because
# we don't know the public key at setup time. Print instructions instead.
warn "========================================================"
warn "ACTION REQUIRED: Add deploy public key to $AUTH_KEYS"
warn "The key MUST use ForceCommand to restrict to run-deploy.sh:"
warn ""
warn "  command=\"$DEPLOY_PATH/deploy/run-deploy.sh\","
warn "  no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty"
warn "  ssh-ed25519 AAAA... deploy@golden-hour"
warn ""
warn "Generate a dedicated deploy key pair (Ed25519):"
warn "  ssh-keygen -t ed25519 -C deploy@golden-hour -f ~/.ssh/golden_hour_deploy"
warn "  # Add private key as GitHub Secret: SSH_PRIVATE_KEY"
warn "  # Add public key here with ForceCommand prefix"
warn "========================================================"

# ---- 11. Firewall & SSH hardening -------------------------------------------
info "[11/11] Configuring UFW and SSH..."

UFW_RESET_DONE=false
ufw --force reset && UFW_RESET_DONE=true
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp" comment 'SSH non-standard'
ufw --force enable
info "UFW: allowing only port $SSH_PORT/tcp for SSH."

# Harden SSH
SSH_CONFIG="/etc/ssh/sshd_config"
cp -n "$SSH_CONFIG" "${SSH_CONFIG}.bak.$(date +%s)"  # backup before modifying

if grep -qE "^Port $SSH_PORT$" "$SSH_CONFIG"; then
  warn "SSH already on port $SSH_PORT — skipping port change."
else
  warn "Changing SSH port to $SSH_PORT."
  warn "CRITICAL: Open a second SSH session on port $SSH_PORT BEFORE closing this one!"
  sed -i "s/^#*Port .*/Port $SSH_PORT/" "$SSH_CONFIG"
fi

sed -i "s/^#*PermitRootLogin .*/PermitRootLogin no/" "$SSH_CONFIG"
sed -i "s/^#*PasswordAuthentication .*/PasswordAuthentication no/" "$SSH_CONFIG"

# Validate config before reloading — prevents lockout from syntax errors
sshd -t || error "sshd config validation FAILED. Check $SSH_CONFIG before reloading sshd!"
info "sshd config validated OK."
systemctl reload sshd
info "sshd reloaded on port $SSH_PORT."

# fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# ---- Done --------------------------------------------------------------------
echo ""
info "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit $DEPLOY_PATH/.env — add TELEGRAM_BOT_TOKEN"
echo "  2. Add the deploy public key to $AUTH_KEYS with ForceCommand (see above)"
echo "  3. Start the service: systemctl start $SERVICE_NAME"
echo "  4. Check logs: journalctl -u $SERVICE_NAME -f"
echo ""
echo "GitHub Actions secrets to set (Settings → Secrets → Actions):"
echo "  SERVER_HOST      = your server IP or hostname"
echo "  SERVER_USER      = $DEPLOY_SUDO_USER"
echo "  SSH_PRIVATE_KEY  = contents of the deploy private key"
echo "  SSH_PORT         = $SSH_PORT"
