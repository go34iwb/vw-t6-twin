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
TAILSCALE_AUTH_KEY="tskey-auth-XXXX...X"   # tailscale.com → Machines → Auth Keys
APN=""                                      # optional: APN für LTE-Stick (z. B. "iot.t-mobile")

# TRUE  = synthetische Telemetrie (TEST) — kein OBD-Adapter nötig.
# FALSE = echter collector.py (braucht gepairten ELM327 via BT).
# Später nach dem ELM327-Setup einfach hier auf FALSE stellen und neu starten.
USE_SYNTHETIC=TRUE
# -------------------------------------------------------------------------------

# Hilfsfunktion: ist ein Platzhalter noch ungelernt?
# Erkennbar durch: leer, "…", oder einen der vordefinierten Beispel-Werte.
is_placeholder() {
  case "$1" in
    ""|*"…"*) return 0 ;;
    "DeinHeimWLAN"|"heim-wlan-passwort"|"DeinHandyHotspot"|"hotspot-passwort") return 0 ;;
    tskey-auth-*|"tskey-auth-XXXX...X") return 0 ;;
    *) return 1 ;;
  esac
}

echo "[1/7] Packages"
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv git rsync gpsd gpsd-clients \
     bluetooth bluez rfkill pigpio python3-smbus i2c-tools network-manager

echo "[2/7] Python deps"
sudo python3 -m pip install --break-system-packages \
     obd gpsd-py3 adafruit-circuitpython-ads1x15

echo "[3/7] Wi-Fi: Heim-WLAN (primär) + Handy-Hotspot (Fallback) — headless, automatisch"
# NetworkManager-Profile: Pi verbindet sich bei jedem Boot selbst, keine Interaktion.
if is_placeholder "$HOME_WIFI_SSID" || is_placeholder "$HOME_WIFI_PASS"; then
  echo "   !! SKIP: HOME_WIFI_SSID/HOME_WIFI_PASS sind noch Platzhalter."
  echo "      -> Nach dem Ausfüllen neu laufen lassen, oder manuell: nmcli connection add ..."
else
  sudo nmcli -No connection show 2>/dev/null | grep -q "^twin-home" || \
    sudo nmcli connection add type wifi con-name twin-home ifname wlan0 ssid "$HOME_WIFI_SSID" \
      sec.sec2 wpa-sec2 key-mgmt wpa-psk sec.psk "$HOME_WIFI_PASS"
  sudo nmcli connection modify twin-home connection.autoconnect yes
  echo "   -> Heim-WLAN-Profil 'twin-home' gesetzt (autoconnect, höchste Priorität)."
fi

if is_placeholder "$HOTSPOT_WIFI_SSID" || is_placeholder "$HOTSPOT_WIFI_PASS"; then
  echo "   !! SKIP: HOTSPOT_WIFI_SSID/HOTSPOT_WIFI_PASS sind noch Platzhalter."
else
  sudo nmcli -No connection show 2>/dev/null | grep -q "^twin-hotspot" || \
    sudo nmcli connection add type wifi con-name twin-hotspot ifname wlan0 ssid "$HOTSPOT_WIFI_SSID" \
      sec.sec2 wpa-sec2 key-mgmt wpa-psk sec.psk "$HOTSPOT_WIFI_PASS"
  sudo nmcli connection modify twin-hotspot connection.autoconnect yes \
    connection.autoconnect-priority -10
  echo "   -> Hotspot-Profil 'twin-hotspot' gesetzt (autoconnect-priority -10 = Fallback)."
fi
if [ -n "$APN" ]; then
  sudo nmcli -No connection show 2>/dev/null | grep -q "^twin-lte" || \
    sudo nmcli connection add type gsm con-name twin-lte apn "$APN" \
      autoconnect yes autoconnect-priority -20
  echo "   -> LTE-Profil 'twin-lte' gesetzt (autoconnect-priority -20 = letzter Fallback)."
else
  echo "   Optional (LTE-Stick als drittes Upstream): USB-4G-Dongle + SIM einlegen,"
  echo "   APN oben setzen und neu installieren (oder: nmcli connection add type gsm ...)."
fi

echo "[4/7] Tailscale (einmaliges Auth-Key, danach automatisch, Auto-Reconnect)"
if is_placeholder "$TAILSCALE_AUTH_KEY"; then
  echo "   !! SKIP: TAILSCALE_AUTH_KEY ist noch ein Platzhalter."
  echo "      -> tailscale.com -> Machines -> Auth Keys erzeugen, Key oben eintragen, neu installieren."
  echo "      -> OHNE Tailscale synchronisiert der Pi NICHT zu twin-server."
else
  if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  if ! tailscale status >/dev/null 2>&1; then
    sudo tailscale up --auth-key="$TAILSCALE_AUTH_KEY" --ssh --hostname=vw-t6-pi
  fi
  sudo systemctl enable --now tailscaled
  echo "   -> Tailscale läuft; Key wird nach dem ersten Up verworfen (kein Klartext auf Platte)."
  echo "      Pi-IP im Tailnet: $(tailscale ip 2>/dev/null || echo 'noch nicht verbunden')"
fi

echo "[5/7] ELM327 Bluetooth pairing"
if [ "$USE_SYNTHETIC" = "TRUE" ]; then
  echo "   -> SKIP: Synthetic-Modus aktiv — kein OBD-Adapter nötig (Test-Daten)."
  echo "      Nach der Umstellung auf echtes OBD (USE_SYNTHETIC=FALSE) einmalig ausführen:"
  echo "        bluetoothctl: power on / scan on / pair <MAC> / trust <MAC>"
  echo "        sudo rfcomm bind 0 <MAC> 1   (+ 'rfcomm bind 0 <MAC> 1' in /etc/rc.local)"
else
  echo "   -> OBD-Adapter jetzt an der Zündungsleiste koppeln (einmalig, interaktiv):"
  echo "        bluetoothctl: power on / scan on / pair <MAC> / trust <MAC>"
  echo "        sudo rfcomm bind 0 <MAC> 1   (+ 'rfcomm bind 0 <MAC> 1' in /etc/rc.local)"
fi

echo "[6/7] gpsd"
if [ "$USE_SYNTHETIC" = "TRUE" ]; then
  echo "   -> SKIP: Synthetic-Modus — GPS wird simuliert, kein HAT vorhanden."
else
  sudo sed -i 's/^DEVICES=.*/DEVICES="\/dev\/serial0"/' /etc/default/gpsd
  sudo sed -i 's/^GPSD_OPTIONS=.*/GPSD_OPTIONS="-n"/' /etc/default/gpsd
  sudo grep -q '^enable_uart=1' /boot/firmware/config.txt 2>/dev/null || \
    echo 'enable_uart=1' | sudo tee -a /boot/firmware/config.txt
  sudo systemctl enable --now gpsd
  echo "   -> gpsd auf /dev/serial0 aktiv (UART freigegeben)."
fi

echo "[7/7] Install software"
sudo mkdir -p /opt/vw-t6-twin /var/lib/twin
sudo cp collector.py synthetic_obd.py power_watch.py sync.py /opt/vw-t6-twin/
sudo chown -R root:root /opt/vw-t6-twin
sudo cp systemd/collector.service systemd/synthetic.service systemd/power_watch.service \
        systemd/sync.service systemd/sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now power_watch.service sync.timer
if [ "$USE_SYNTHETIC" = "TRUE" ]; then
  echo "   -> USE_SYNTHETIC=TRUE: starte SYNTHETIC-Generator (TEST-Daten, kein OBD-Adapter nötig)."
  echo "      Später nach ELM327-Setup auf echtes OBD umschalten:"
  echo "        sudo systemctl disable --now synthetic && sudo systemctl enable --now collector"
  sudo systemctl enable --now synthetic
else
  echo "   -> USE_SYNTHETIC=FALSE: starte echten collector.py (OBD via Bluetooth)."
  sudo systemctl enable --now collector
fi

echo "=============================================="
echo " Done. Status:"
if is_placeholder "$HOME_WIFI_SSID"; then echo "   [!] Wi-Fi: noch Platzhalter — kein Upstream" ; else echo "   [OK] Wi-Fi-Profile gesetzt" ; fi
if is_placeholder "$TAILSCALE_AUTH_KEY"; then echo "   [!] Tailscale: Auth-Key fehlt — kein Sync zum NUC" ; else echo "   [OK] Tailscale verbunden" ; fi
echo "   Datenquelle: $([ "$USE_SYNTHETIC" = "TRUE" ] && echo 'SYNTHETIC (Test)' || echo 'echt (collector)')"
echo "=============================================="
echo "Checks: systemctl status $( [ "$USE_SYNTHETIC" = "TRUE" ] && echo synthetic || echo collector ) ; journalctl -u sync -f"
echo "Netzwerk: nmcli -t -f ACTIVE,NAME connection ; tailscale status"
echo "Umschalten Test->Echt (nach ELM327): sudo systemctl disable --now synthetic && sudo systemctl enable --now collector"
