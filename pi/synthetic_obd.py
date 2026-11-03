#!/usr/bin/env python3
"""
VW T6 Digital Twin — SYNTHETIC OBD-II + GPS + DTC generator (DROP-IN Ersatz für collector.py).

⚠️  ALLE DATEN HIER SIND ERFUNDEN (SYNTHETIC).
    Dieses Skript simuliert einen 2.0 TDI (102 PS) mit einem Fahr-State-Machine
    (parken → Kaltstart → Fahrt → parken) und erzeugt realistische
    OBD-2-Messwerte (RPM, Speed, Kühlmittel, Batterie, Kraftstoff), GPS (nur
    bei Bewegung) und gespeicherte DTCs (Mode 03) im EXAKTEN SQLite-Format von
    collector.py — damit die komplette Pipeline (sync → ingest → export →
    GitHub Pages) unverändert funktioniert.

    ZWECK: Dashboard-Verifikation & Pipeline-Test, BEVOR der echte OBD-2-
    Bluetooth-Adapter (ELM327) eingebaut ist.

    ENTFERNEN, SOBALD OBD-2 per Bluetooth eingerichtet ist:
        sudo systemctl disable --now synthetic.service
        sudo systemctl enable --now collector.service
        (siehe pi/install.sh, Schritt [6/7] "Synthetic → Real OBD-2")

    Es liest KEINEN echten OBD-Adapter und schickt keine Aktor-Befehle.
"""
import os
import json
import time
import math
import random
import sqlite3
import logging
import threading

DB_PATH = os.environ.get("TWIN_DB", "/var/lib/twin/telemetry.db")
# Wenig Daten: OBD alle 15 s (statt 5 s bei echt), GPS alle 10 s nur bei Fahrt
POLL_INTERVAL_S = float(os.environ.get("TWIN_OBD_INTERVAL", "15"))
GPS_INTERVAL_S = float(os.environ.get("TWIN_GPS_INTERVAL", "10"))
MOVE_MIN_KMH = float(os.environ.get("TWIN_MOVE_MIN_KMH", "5"))
DIAGNOSTIC_INTERVAL_S = float(os.environ.get("TWIN_DIAGNOSTIC_INTERVAL", "60"))

# Referenzposition: München (wie die echten Pilotdaten)
BASE_LAT = float(os.environ.get("TWIN_BASE_LAT", "48.1476"))
BASE_LON = float(os.environ.get("TWIN_BASE_LON", "11.5755"))

# VW T6 2.0 TDI (102 PS) — realistische Kenngroßen
IDLE_RPM = 800.0
COOLANT_HOT_C = 91.0
CHARGE_V = 14.4          # Ladespannung (Generator) bei laufendem Motor
REST_V = 12.6            # Batteriespannung motor aus
FUEL_PER_100KM = 6.5     # l/100km → Verbrauch für Kraftstoffabnahme

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("synthetic")

SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry (
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  rpm REAL, speed_kmh REAL, coolant_c REAL,
  battery_v REAL, fuel_pct REAL,
  lat REAL, lon REAL, alt_m REAL,
  PRIMARY KEY (ts, source)
);
"""
DIAGNOSTIC_SCHEMA = """
CREATE TABLE IF NOT EXISTS diagnostics (
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','unavailable','error')),
  mil INTEGER CHECK (mil IN (0,1)),
  codes_json TEXT,
  error TEXT,
  PRIMARY KEY (ts, source)
);
"""


def open_db(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(SCHEMA)
    conn.execute(DIAGNOSTIC_SCHEMA)
    return conn


class Trip:
    """Fahr-State-Machine: parken → kalt → anfahren → fahrt → anhalten → parken."""

    def __init__(self):
        self.state = "parked"
        self.t_state = 0.0           # Sekunden im aktuellen Zustand
        self.rpm = 0.0
        self.speed = 0.0
        self.coolant = 20.0          # kaltstart
        self.fuel = 78.0             # Prozent
        self.heading = random.uniform(0, 360)
        self.lat = BASE_LAT
        self.lon = BASE_LON
        self.moving = False

    def _transition(self, dur):
        self.t_state += 1.0
        if self.t_state < dur:
            return
        self.t_state = 0.0
        nxt = {
            "parked": ("cold_start", 60),       # Motor an, 60 s Warmlauf
            "cold_start": ("idle", 120),        # Standwarm, Kühlmittel steigt
            "idle": ("accelerate", 20),
            "accelerate": ("cruise", random.uniform(60, 180)),
            "cruise": ("decelerate", 12),
            "decelerate": ("idle", random.choice([120, 300])),
            "idle": ("cruise", 120),
        }[self.state]
        self.state, self._dur = nxt

    def step(self, dt):
        self._dt = dt
        self._transition(dt)

        if self.state == "parked":
            # Motor aus: keine Rotation, Spannungsabfall, Kühltemperatur sinkt
            self.rpm = 0.0
            self.speed = 0.0
            self.moving = False
            self.coolant += (22.0 - self.coolant) * 0.002 * dt
            self.battery = REST_V + random.uniform(-0.05, 0.05)
            return

        self.battery = CHARGE_V + random.uniform(-0.15, 0.15)

        if self.state == "cold_start":
            # Anlassen: RPM hoch, dann in Leerlauf, Kühlmittel beginnt zu steigen
            self.rpm = min(IDLE_RPM + 400, self.rpm + 900 * dt)
            self.speed = 0.0
            self.moving = False
            self.coolant += (COOLANT_HOT_C - self.coolant) * 0.01 * dt
        elif self.state == "idle":
            self.rpm = IDLE_RPM + random.uniform(-25, 25)
            self.speed = max(0.0, self.speed - 12 * dt)
            self.moving = self.speed > MOVE_MIN_KMH
            self.coolant += (COOLANT_HOT_C - self.coolant) * 0.02 * dt
        elif self.state == "accelerate":
            self.speed = min(110.0, self.speed + 9 * dt)
            self.rpm = 1800 + (self.speed / 110.0) * 1800 + random.uniform(-60, 60)
            self.moving = True
            self.coolant += (95.0 - self.coolant) * 0.02 * dt
        elif self.state == "cruise":
            target = random.uniform(60, 110)
            self.speed += (target - self.speed) * 0.1 * dt
            self.speed = max(40.0, min(128.0, self.speed))
            self.rpm = 1300 + (self.speed / 128.0) * 1400 + random.uniform(-40, 40)
            self.moving = True
            self.coolant += (94.0 - self.coolant) * 0.01 * dt
        elif self.state == "decelerate":
            self.speed = max(0.0, self.speed - 14 * dt)
            self.rpm = max(IDLE_RPM + 100, 1300 - (128.0 - self.speed) / 128.0 * 900)
            self.moving = self.speed > MOVE_MIN_KMH
            self.coolant += (COOLANT_HOT_C - self.coolant) * 0.01 * dt

        # GPS-Position nur bei Bewegung (wie gpsd/collector)
        if self.moving and self.speed > 0.5:
            self.heading = (self.heading + random.uniform(-2, 2)) % 360
            dkm = self.speed * dt / 3600.0          # km seit letztem Step
            rad = math.radians(self.heading)
            self.lat += dkm / 111.0 * math.sin(rad)
            self.lon += dkm / (111.0 * math.cos(math.radians(self.lat))) * math.cos(rad)

        # Kraftstoffverbrauch (realistisch, nur bei Fahrt)
        if self.moving:
            self.fuel -= (FUEL_PER_100KM / 100.0) * (self.speed * dt / 3600.0) * 100.0 / 60.0
            self.fuel = max(8.0, min(99.0, self.fuel))

    @property
    def obd_row(self):
        return (self.rpm, self.speed, self.coolant, self.battery, self.fuel)

    @property
    def gps_row(self):
        return (self.speed, self.lat, self.lon, 510.0)


def pick_dtcs(t_now):
    """Simulierte gespeicherte Mode-03-Codes (wie die echten Pilotdaten)."""
    # P0128 (Thermostat) ist stabil gesetzt; P0456 (EVAP) kommt seltener hinzu
    codes = [{"code": "P0128", "description":
              "Coolant thermostat (coolant temperature below regulating temperature)",
              "component": "cooling"}]
    if (t_now // 3600) % 3 == 0:            # stündlich wechselnd für Abwechslung
        codes.append({"code": "P0456", "description":
                      "Evaporative emission control system leak (small)",
                      "component": "evap"})
    mil = 1                                  # MIL angeleuchtet, solange DTC gesetzt
    return codes, mil


def store_diagnostics(conn, ts, status, codes=None, mil=None, error=None):
    conn.execute("INSERT OR REPLACE INTO diagnostics "
                 "(ts, source, status, mil, codes_json, error) VALUES (?,?,?,?,?,?)",
                 (ts, "obd", status, mil,
                  json.dumps(codes) if codes is not None else None, error))


def obd_worker(conn):
    trip = Trip()
    next_diag = 0.0
    log.info("SYNTHETIC OBD started (interval %s s). ALLE DATEN ERFUNDEN.", POLL_INTERVAL_S)
    while True:
        now = time.time()
        trip.step(POLL_INTERVAL_S)
        ts = int(now)
        rpm, speed, coolant, batt, fuel = trip.obd_row
        conn.execute("INSERT OR REPLACE INTO telemetry "
                     "(ts, source, rpm, speed_kmh, coolant_c, battery_v, fuel_pct) "
                     "VALUES (?,?,?,?,?,?,?)",
                     (ts, "obd", round(rpm, 1), round(speed, 1),
                      round(coolant, 1), round(batt, 2), round(fuel, 1)))
        if now >= next_diag:
            codes, mil = pick_dtcs(ts)
            store_diagnostics(conn, ts, "ok", codes=codes, mil=mil)
            next_diag = now + DIAGNOSTIC_INTERVAL_S
        time.sleep(POLL_INTERVAL_S)


def gps_worker(conn):
    trip = Trip()   # eigenem Instance; position roughly aligned via shared base
    # GPS-Thread nutzt dieselbe "Fahrtlogik" — für Verifikation reicht
    # eine unabhängige, plausible Positionsfolge in der Referenzumgebung.
    while True:
        try:
            trip.step(GPS_INTERVAL_S)
            if trip.moving and trip.speed >= MOVE_MIN_KMH:
                ts = int(time.time())
                speed, lat, lon, alt = trip.gps_row
                conn.execute("INSERT OR REPLACE INTO telemetry "
                             "(ts, source, speed_kmh, lat, lon, alt_m) "
                             "VALUES (?,?,?,?,?,?)",
                             (ts, "gps", round(speed, 1),
                              round(lat, 6), round(lon, 6), round(alt, 1)))
        except Exception as e:
            log.exception("synthetic gps: %s", e)
        time.sleep(GPS_INTERVAL_S)


def run_worker(worker):
    conn = open_db(DB_PATH)
    try:
        worker(conn)
    finally:
        conn.close()


def main():
    conn = open_db(DB_PATH)
    conn.close()
    log.info("DB at %s (SYNTHETIC)", DB_PATH)
    threading.Thread(target=run_worker, args=(obd_worker,), daemon=True).start()
    threading.Thread(target=run_worker, args=(gps_worker,), daemon=True).start()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
