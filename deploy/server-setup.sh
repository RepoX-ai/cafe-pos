#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 VPS. Run as root, once:
#
#   bash server-setup.sh <username>
#
# Installs Docker, Nginx, certbot, a firewall, fail2ban and automatic security
# updates; creates <username> (sudo + docker) with root's SSH keys; prepares
# /opt/cafe-pos and /var/backups/cafe-pos. It writes the SSH hardening file
# but does NOT reload SSH — do that only after logging in as <username> works
# (docs/go-live-runbook.md, step 4).
set -euo pipefail

USER_NAME="${1:?usage: bash server-setup.sh <username>}"

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
[[ -s /root/.ssh/authorized_keys ]] || {
  echo "No SSH key in /root/.ssh/authorized_keys. Add your key first (runbook step 3)," >&2
  echo "otherwise disabling password login would lock you out." >&2
  exit 1
}

export DEBIAN_FRONTEND=noninteractive

echo "==> System packages"
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades \
  nginx certbot python3-certbot-nginx rclone
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Asia/Jakarta

echo "==> Docker (official repository)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> User $USER_NAME"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USER_NAME"
  echo "Set a password for $USER_NAME (needed for sudo, not for SSH login):"
  passwd "$USER_NAME"
fi
usermod -aG sudo,docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
cp /root/.ssh/authorized_keys "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"
chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"

echo "==> Swap (the Next.js build needs headroom on small servers)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Firewall: SSH, HTTP, HTTPS only"
# Compose publishes Postgres and the app on 127.0.0.1 only, so Docker's
# habit of bypassing ufw for published ports does not expose them.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> SSH hardening (applied on the next reload, not now)"
# 00- so it is read before cloud-init's 50-cloud-init.conf: sshd keeps the
# first value it sees for each setting.
cat > /etc/ssh/sshd_config.d/00-cafe-pos-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t

echo "==> App and backup directories"
install -d -o "$USER_NAME" -g "$USER_NAME" /opt/cafe-pos
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" /var/backups/cafe-pos

cat <<EOF

Done. Next (runbook step 4):
  1. In a NEW terminal on your laptop:  ssh $USER_NAME@<server-ip>
  2. If that works:  sudo systemctl reload ssh
  3. Keep this root session open until step 1 has worked.
EOF
