#!/bin/bash
# VW T6 Digital Twin — Pi Zero 2 W bootstrap (Raspberry Pi OS Lite 64-bit)
set -euo pipefail

echo "[1/6] Packages"
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv git rsync gpsd gpsd-clients \
     bluetooth bluez rfkill pigpio python3-smbus i2c-tools

echo "[2/6] Python deps"
sudo python3 -m pip install --break-system-packages \
     obd gpsd-py3 adafruit-circuitpython-ads1x15

echo "[3/6] ELM327 Bluetooth pairing (interactive)"
echo "   Run: bluetoothctl"
echo "     power on"
echo "     scan on  →  find OBDII/Vgate MAC"
echo "     pair <MAC>; trust <MAC>; connect <MAC>"
echo "   Then bind to rfcomm:"
echo "     sudo rfcomm bind 0 <MAC> 1"
echo "   Persist: add 'rfcomm bind 0 <MAC> 1' to /etc/rc.local"

echo "[4/6] gpsd"
echo "   Edit /etc/default/gpsd:"
echo "     DEVICES=\"/dev/serial0\""
echo "     GPSD_OPTIONS=\"-n\""
echo "   Enable UART in /boot/firmware/config.txt: enable_uart=1"

echo "[5/6] Install software"
sudo mkdir -p /opt/vw-t6-twin /var/lib/twin
sudo cp collector.py power_watch.py sync.py /opt/vw-t6-twin/
sudo chown -R root:root /opt/vw-t6-twin
sudo cp systemd/collector.service systemd/power_watch.service \
        systemd/sync.service systemd/sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now collector.service power_watch.service sync.timer

echo "[6/6] Tailscale"
echo "   curl -fsSL https://tailscale.com/install.sh | sh"
echo "   sudo tailscale up --ssh"
echo "   Add the NUC hostname 'twin-server' to /etc/hosts via 'tailscale ip'"

echo "Done. Check: systemctl status collector ; journalctl -u collector -f"
