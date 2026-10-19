#!/usr/bin/env python3
"""
VW T6 Digital Twin — Pi collector service.

Polls OBD-II via ELM327 (Bluetooth rfcomm) every POLL_INTERVAL_S seconds,
reads GPS from gpsd only while vehicle is moving (speed > MOVE_MIN_KMH),
and stores everything in a local SQLite DB (WAL mode) for later batch sync.
"""
import os
import json
import re
import time
import sqlite3
import logging
import threading

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
DIAGNOSTIC_INTERVAL_S = float(os.environ.get("TWIN_DIAGNOSTIC_INTERVAL", "60"))

DIAGNOSTIC_SCHEMA = """
CREATE TABLE IF NOT EXISTS diagnostics (
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'unavailable', 'error')),
  mil INTEGER CHECK (mil IN (0, 1)),
  codes_json TEXT,
  error TEXT,
  PRIMARY KEY (ts, source)
);
"""

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("collector")


def open_db(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
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
    conn.execute(DIAGNOSTIC_SCHEMA)
    return conn


def store_diagnostics(conn, ts, status, codes=None, mil=None, error=None):
    conn.execute(
        "INSERT OR REPLACE INTO diagnostics "
        "(ts, source, status, mil, codes_json, error) VALUES (?,?,?,?,?,?)",
        (ts, "obd", status, mil,
         json.dumps(codes) if codes is not None else None, error))
    if status != "ok":
        log.error("stored DTC diagnostics %s: %s", status, error)


def collect_diagnostics(conn, connection):
    """Read stored Mode 03 codes; never issue clear or actuator commands."""
    ts = int(time.time())
    try:
        command = obd.commands.GET_DTC
        if not connection.supports(command):
            store_diagnostics(conn, ts, "unavailable",
                              error="Stored DTC retrieval (Mode 03) is unsupported")
            return
        response = connection.query(command)
        if response.is_null() or response.value is None:
            store_diagnostics(conn, ts, "unavailable",
                              error="Stored DTC retrieval (Mode 03) returned no data")
            return
        if not isinstance(response.value, (list, tuple)):
            raise ValueError("Invalid stored DTC response")
        codes = []
        for item in response.value:
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                raise ValueError("Invalid stored DTC entry")
            code, description = item
            if (not isinstance(code, str)
                    or not re.fullmatch(r"[PCBU][0-3][0-9A-F]{3}", code)
                    or (description is not None and not isinstance(description, str))):
                raise ValueError("Invalid stored DTC code or description")
            codes.append({"code": code, "description": description or ""})
    except Exception as exc:
        log.exception("Stored DTC retrieval failed")
        store_diagnostics(conn, ts, "error", error=str(exc))
        return

    mil = None
    try:
        status_command = obd.commands.STATUS
        if connection.supports(status_command):
            status = connection.query(status_command)
            if not status.is_null() and status.value is not None:
                value = getattr(status.value, "MIL", None)
                if isinstance(value, bool):
                    mil = value
                else:
                    log.warning("OBD STATUS returned no valid MIL flag")
            else:
                log.warning("OBD STATUS returned no data; MIL unavailable")
        else:
            log.warning("OBD STATUS unsupported; MIL unavailable")
    except Exception:
        log.exception("OBD STATUS failed; MIL unavailable")
    store_diagnostics(conn, ts, "ok", codes=codes, mil=mil)


def obd_worker(conn):
    if obd is None:
        log.error("python-OBD not installed; obd worker disabled")
        store_diagnostics(conn, int(time.time()), "unavailable",
                          error="python-OBD is not installed")
        return
    while True:
        try:
            conn_obd = obd.OBD()  # auto-detects rfcomm0 after pairing
            if not conn_obd.is_connected():
                log.warning("OBD not connected, retrying in 15s")
                store_diagnostics(conn, int(time.time()), "unavailable",
                                  error="OBD is not connected")
                time.sleep(15)
                continue
            log.info("OBD connected: %s", conn_obd.port_name())
            cmds = [obd.commands.RPM, obd.commands.SPEED,
                    obd.commands.COOLANT_TEMP, obd.commands.ELM_VOLTAGE,
                    obd.commands.FUEL_LEVEL]
            next_diagnostics = 0.0
            while conn_obd.is_connected():
                if time.monotonic() >= next_diagnostics:
                    collect_diagnostics(conn, conn_obd)
                    next_diagnostics = time.monotonic() + DIAGNOSTIC_INTERVAL_S
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
            store_diagnostics(conn, int(time.time()), "unavailable",
                              error="OBD disconnected")
        except Exception as e:
            log.exception("obd worker: %s", e)
            store_diagnostics(conn, int(time.time()), "error", error=str(e))
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


def run_worker(worker):
    # SQLite connections must be created in the thread that uses them.
    conn = open_db(DB_PATH)
    try:
        worker(conn)
    finally:
        conn.close()


def main():
    conn = open_db(DB_PATH)
    conn.close()
    log.info("DB at %s", DB_PATH)
    threading.Thread(target=run_worker, args=(obd_worker,), daemon=True).start()
    threading.Thread(target=run_worker, args=(gps_worker,), daemon=True).start()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
