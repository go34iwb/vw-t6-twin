#!/bin/bash
# VW T6 Digital Twin — NUC bootstrap (Proxmox LXC, Debian 12)
set -euo pipefail

echo "[1/5] Create LXC 'twin-server' (run from Proxmox shell):"
echo "   pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \\"
echo "     --hostname twin-server --memory 512 --cores 1 --rootfs local-lvm:8 \\"
echo "     --net0 name=eth0,bridge=vmbr0,ip=dhcp --unprivileged 1 --start 1"
echo
echo "[2/5] Inside the CT (pct enter 200):"
echo "   apt-get update"
echo "   apt-get install -y python3 python3-pip git openssh-server rsync sqlite3 curl"
echo "   curl -fsSL https://tailscale.com/install.sh | sh"
echo "   tailscale up --hostname=twin-server"
echo "   useradd -m twin"
echo
echo "[3/5] Pi ssh-key"
echo "   On Pi: ssh-keygen -t ed25519 -f /root/.ssh/twin"
echo "   On CT: mkdir -p /home/twin/.ssh; cat Pi-public-key >> authorized_keys"
echo "   chown -R twin:twin /home/twin/.ssh; chmod 700 /home/twin/.ssh; chmod 600 authorized_keys"
echo
echo "[4/5] Deploy"
echo "   mkdir -p /var/lib/twin/incoming /var/lib/twin"
echo "   chown -R twin:twin /var/lib/twin"
echo "   cp ingest.py /usr/local/bin/twin-ingest.py; chmod +x /usr/local/bin/twin-ingest.py"
echo "   cp export_json.py /usr/local/bin/twin-export.py; chmod +x /usr/local/bin/twin-export.py"
echo "   git clone -b gh-pages git@github.com:go34iwb/vw-t6-twin.git /opt/vw-t6-twin-repo"
echo "   cp systemd/*.timer systemd/*.service /etc/systemd/system/"
echo "   systemctl daemon-reload"
echo "   systemctl enable --now twin-ingest.timer twin-export.timer"
echo
echo "[5/5] Verify"
echo "   systemctl list-timers | grep twin"
echo "   journalctl -u twin-ingest.service -f"
