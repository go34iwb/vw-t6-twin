#!/usr/bin/env python3
"""
Merges incoming Pi SQLite db into the master DB on the NUC.
Deduplicates via (ts, source) primary key.
"""
import os
import sqlite3
import logging
from pathlib import Path

MASTER = os.environ.get("TWIN_MASTER_DB", "/var/lib/twin/telemetry.db")
INCOMING_DIR = os.environ.get("TWIN_INCOMING", "/var/lib/twin/incoming")

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ingest")

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
  status TEXT NOT NULL CHECK (status IN ('ok', 'unavailable', 'error')),
  mil INTEGER CHECK (mil IN (0, 1)),
  codes_json TEXT,
  error TEXT,
  PRIMARY KEY (ts, source)
);
"""


def open_db(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(SCHEMA)
    conn.execute(DIAGNOSTIC_SCHEMA)
    return conn


def merge(incoming_path):
    if not os.path.exists(incoming_path):
        log.warning("missing %s", incoming_path)
        return 0
    master = open_db(MASTER)
    src = None
    try:
        # Never migrate or change journal mode on the incoming rsync copy.
        src = sqlite3.connect(
            Path(incoming_path).resolve().as_uri() + "?mode=ro",
            uri=True, timeout=10)
        src.execute("BEGIN")
        rows = src.execute(
            "SELECT ts, source, rpm, speed_kmh, coolant_c, battery_v, "
            "fuel_pct, lat, lon, alt_m FROM telemetry").fetchall()
        has_diagnostics = src.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='diagnostics'"
        ).fetchone()
        diagnostic_rows = src.execute(
            "SELECT ts, source, status, mil, codes_json, error FROM diagnostics"
        ).fetchall() if has_diagnostics else []
        master.execute("BEGIN")
        master.executemany(
            "INSERT OR REPLACE INTO telemetry VALUES (?,?,?,?,?,?,?,?,?,?)",
            rows)
        master.executemany(
            "INSERT INTO diagnostics "
            "(ts, source, status, mil, codes_json, error) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(ts, source) DO UPDATE SET "
            "status=excluded.status, mil=excluded.mil, "
            "codes_json=excluded.codes_json, error=excluded.error "
            "WHERE diagnostics.status IS NOT excluded.status "
            "OR diagnostics.mil IS NOT excluded.mil "
            "OR diagnostics.codes_json IS NOT excluded.codes_json "
            "OR diagnostics.error IS NOT excluded.error",
            diagnostic_rows)
        n = master.total_changes
        master.execute("COMMIT")
    except Exception:
        if master.in_transaction:
            master.execute("ROLLBACK")
        raise
    finally:
        if src is not None:
            src.close()
        master.close()
    log.info("merged %d rows from %s into %s", len(rows),
             incoming_path, MASTER)
    log.info("read %d diagnostic snapshots from %s", len(diagnostic_rows),
             incoming_path)
    return n


def main():
    for fname in os.listdir(INCOMING_DIR):
        if fname.startswith("telemetry") and fname.endswith(".db"):
            p = os.path.join(INCOMING_DIR, fname)
            try:
                merge(p)
            except Exception:
                log.exception("failed merging %s", p)


if __name__ == "__main__":
    main()
