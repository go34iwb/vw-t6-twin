#!/usr/bin/env python3
"""
VW T6 Digital Twin — Pi collector service.

Polls OBD-II via ELM327 (Bluetooth rfcomm) every POLL_INTERVAL_S seconds,
reads GPS from gpsd only while vehicle is moving (speed > MOVE_MIN_KMH),
and stores everything in a local SQLite DB (WAL mode) for later batch sync.
"""
import os
import time
import sqlite3
import logging
import threading
from datetime import datetime, timezone

try:
    import obd  # python-OBD
except ImportError:
    obd = None

try:
    from gpsd import gpsd  # gpsd-py3
except ImportError:
    gpsd = None

DB_PATH = os.environ.get("TWIN_DB", "/var/lib/twin/telemetry.db")
POLL_INTERVAL_S = float(os.environ.get("TWIN_OBD_INTERVAL", "5"))
GPS_INTERVAL_S = float(os.environ.get("TWIN_GPS_INTERVAL", "10"))
MOVE_MIN_KMH = float(os.environ.get("TWIN_MOVE_MIN_KMH", "5"))
PWR_INTERVAL_S = 30.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("collector")


def open_db(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("""
      CREATE TABLE IF NOT EXISTS telemetry (
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
        rpm REAL, speed_kmh REAL, coolant_c REAL,
        battery_v REAL, fuel_pct REAL,
        lat REAL, lon REAL, alt_m REAL,
        PRIMARY KEY (ts, source)
      )
    """)
    return conn


def obd_worker(conn):
    if obd is None:
        log.error("python-OBD not installed; obd worker disabled")
        return
    while True:
        try:
            conn_obd = obd.OBD()  # auto-detects rfcomm0 after pairing
            if not conn_obd.is_connected():
                log.warning("OBD not connected, retrying in 15s")
                time.sleep(15)
                continue
            log.info("OBD connected: %s", conn_obd.port_name())
            cmds = [obd.commands.RPM, obd.commands.SPEED,
                    obd.commands.COOLANT_TEMP, obd.commands.ELM_VOLTAGE,
                    obd.commands.FUEL_LEVEL]
            while conn_obd.is_connected():
                vals = {}
                for c in cmds:
                    r = conn_obd.query(c)
                    if not r.is_null() and r.value is not None:
                        v = r.value
                        vals[c.name.lower()] = getattr(v, 'magnitude', v)
                ts = int(time.time())
                conn.execute(
                    "INSERT OR REPLACE INTO telemetry "
                    "(ts, source, rpm, speed_kmh, coolant_c, battery_v, fuel_pct) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (ts, "obd",
                     vals.get("rpm"), vals.get("speed"),
                     vals.get("coolant_temp"), vals.get("elm_voltage"),
                     vals.get("fuel_level")))
                time.sleep(POLL_INTERVAL_S)
            log.warning("OBD disconnected, reconnecting…")
        except Exception as e:
            log.exception("obd worker: %s", e)
            time.sleep(15)


def gps_worker(conn):
    if gpsd is None:
        log.error("gpsd-py3 not installed; gps worker disabled")
        return
    while True:
        try:
            gpsd.connect()
            log.info("gpsd connected")
            while True:
                pkt = gpsd.get_current()
                if pkt.mode >= 2:
                    speed = getattr(pkt, "speed", lambda: 0)() or 0
                    speed_kmh = speed * 3.6
                    if speed_kmh >= MOVE_MIN_KMH:
                        ts = int(time.time())
                        lat, lon = pkt.position()
                        alt = pkt.altitude() or None
                        conn.execute(
                            "INSERT OR REPLACE INTO telemetry "
                            "(ts, source, speed_kmh, lat, lon, alt_m) "
                            "VALUES (?,?,?,?,?,?)",
                            (ts, "gps", speed_kmh, lat, lon, alt))
                time.sleep(GPS_INTERVAL_S)
        except Exception as e:
            log.exception("gps worker: %s", e)
            time.sleep(10)


def main():
    conn = open_db(DB_PATH)
    log.info("DB at %s", DB_PATH)
    threading.Thread(target=obd_worker, args=(conn,), daemon=True).start()
    threading.Thread(target=gps_worker, args=(conn,), daemon=True).start()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
