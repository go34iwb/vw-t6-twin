#!/usr/bin/env python3
"""
Merges incoming Pi SQLite db into the master DB on the NUC.
Deduplicates via (ts, source) primary key.
"""
import os
import sqlite3
import logging

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


def open_db(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(SCHEMA)
    return conn


def merge(incoming_path):
    if not os.path.exists(incoming_path):
        log.warning("missing %s", incoming_path)
        return 0
    master = open_db(MASTER)
    src = open_db(incoming_path)
    rows = src.execute(
        "SELECT ts, source, rpm, speed_kmh, coolant_c, battery_v, "
        "fuel_pct, lat, lon, alt_m FROM telemetry").fetchall()
    src.close()
    master.executemany(
        "INSERT OR REPLACE INTO telemetry VALUES (?,?,?,?,?,?,?,?,?,?)",
        rows)
    n = master.total_changes
    master.close()
    log.info("merged %d rows from %s into %s", len(rows),
             incoming_path, MASTER)
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
