#!/bin/bash
# VW T6 Digital Twin — Pi 3B+ bootstrap (Raspberry Pi OS Lite 64-bit)
# Alternative: Zero 2 W/WH — gleicher 40-Pin-HAT-Standard, Script läuft unverändert.
#
# Ziel: headless Auto-Connect — alle Netze und Tailscale werden VORAB
# konfiguriert, sodass der Pi bei jedem Boot selbstständig verbindet.
# Priorität (niedrigste Kosten zuerst): Heim-WLAN > Handy-Hotspot > LTE-Stick.
# Details: docs/ARCHITECTURE.md → "Sync-Szenarien & Auto-Connect".
set -euo pipefail

# --- Konfiguration (vor dem ersten Lauf ausfüllen) -----------------------------
HOME_WIFI_SSID="DeinHeimWLAN"
HOME_WIFI_PASS="heim-wlan-passwort"
HOTSPOT_WIFI_SSID="DeinHandyHotspot"
HOTSPOT_WIFI_PASS="hotspot-passwort"
TAILSCALE_AUTH_KEY="tskey-auth-XXXX..."   # tailscale.com → Machines → Auth Keys
# -------------------------------------------------------------------------------

echo "[1/7] Packages"
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv git rsync gpsd gpsd-clients \
     bluetooth bluez rfkill pigpio python3-smbus i2c-tools network-manager

echo "[2/7] Python deps"
sudo python3 -m pip install --break-system-packages \
     obd gpsd-py3 adafruit-circuitpython-ads1x15

echo "[3/7] Wi-Fi: Heim-WLAN (primär) + Handy-Hotspot (Fallback) — headless, vorab"
echo "   NetworkManager-Profile (automatische Verbindung, keine Interaktion nötig):"
echo "   sudo nmcli connection add type wifi con-name twin-home  \\"
echo "     ifname wlan0 ssid $HOME_WIFI_SSID \\"
echo "     sec.sec2 wpa-sec2 key-mgmt wpa-psk sec.psk $HOME_WIFI_PASS"
echo "   sudo nmcli connection modify twin-home connection.autoconnect yes"
echo "   sudo nmcli connection add type wifi con-name twin-hotspot \\"
echo "     ifname wlan0 ssid $HOTSPOT_WIFI_SSID \\"
echo "     sec.sec2 wpa-sec2 key-mgmt wpa-psk sec.psk $HOTSPOT_WIFI_PASS"
echo "   sudo nmcli connection modify twin-hotspot connection.autoconnect yes \\"
echo "     connection.autoconnect-priority -10"
echo "   -> twin-hotspot hat niedrigere Priorität; Pi bevorzugt Heim-WLAN,"
echo "      springt aber automatisch auf den Hotspot um, wenn das WLAN fehlt."
echo "   Optional (LTE-Stick als drittes Upstream):"
echo "     USB-4G-Dongle (z. B. Quectel EC25) anschließen, SIM einlegen,"
echo "     sudo nmcli connection add type gsm con-name twin-lte \\"
echo "       apn <dein-apn> autoconnect yes autoconnect-priority -20"
echo "     -> höchste Autonomie, aber IoT-SIM-Kosten; erst bei Bedarf."

echo "[4/7] Tailscale (einmaliges Auth-Key, danach automatisch, Auto-Reconnect)"
echo "   curl -fsSL https://tailscale.com/install.sh | sh"
echo "   sudo tailscale up --auth-key=$TAILSCALE_AUTH_KEY --ssh \\"
echo "     --hostname=vw-t6-pi"
echo "   -> Auth-Key wird NUR bei der ersten Anmeldung genutzt und danach"
echo "      verworfen; danach startet tailscaled mit systemd automatisch."
echo "   Pi ist nur über Tailscale erreichbar (kein Port-Forwarding)."

echo "[5/7] ELM327 Bluetooth pairing (einmalig, interaktiv — danach persistiert)"
echo "   Run: bluetoothctl"
echo "     power on"
echo "     scan on  →  find OBDII/Vgate MAC"
echo "     pair <MAC>; trust <MAC>; connect <MAC>"
echo "   Then bind to rfcomm:"
echo "     sudo rfcomm bind 0 <MAC> 1"
echo "   Persist: add 'rfcomm bind 0 <MAC> 1' to /etc/rc.local"
echo "   -> 'trust' macht die spätere Verbindung automatisch (kein Re-Pairing)."

echo "[6/7] gpsd"
echo "   Edit /etc/default/gpsd:"
echo "     DEVICES=\"/dev/serial0\""
echo "     GPSD_OPTIONS=\"-n\""
echo "   Enable UART in /boot/firmware/config.txt: enable_uart=1"

echo "[7/7] Install software"
sudo mkdir -p /opt/vw-t6-twin /var/lib/twin
sudo cp collector.py power_watch.py sync.py /opt/vw-t6-twin/
sudo chown -R root:root /opt/vw-t6-twin
sudo cp systemd/collector.service systemd/power_watch.service \
        systemd/sync.service systemd/sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now collector.service power_watch.service sync.timer

echo "Done. Check: systemctl status collector ; journalctl -u collector -f"
echo "Netzwerk-Check: nmcli -t -f ACTIVE,NAME connection ; tailscale status"
