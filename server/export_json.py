#!/usr/bin/env python3
"""
Aggregates the master DB into JSON files for the GitHub Pages dashboard,
then commits + pushes them to the gh-pages branch of go34iwb/vw-t6-twin.
"""
import os
import json
import sqlite3
import subprocess
import logging
from datetime import datetime, timedelta, timezone

MASTER_DB = os.environ.get("TWIN_MASTER_DB", "/var/lib/twin/telemetry.db")
REPO_DIR = os.environ.get("TWIN_REPO", "/opt/vw-t6-twin-repo")
DATA_DIR = os.path.join(REPO_DIR, "data")
GIT_PUSH = os.environ.get("TWIN_PUSH", "1") == "1"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("export")


def fetch_series(conn, source, hours):
    since = int((datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp())
    return conn.execute(
        "SELECT ts, rpm, speed_kmh, coolant_c, battery_v, fuel_pct, "
        "lat, lon, alt_m FROM telemetry "
        "WHERE source=? AND ts>=? ORDER BY ts ASC",
        (source, since)).fetchall()


def row_to_obj(r):
    return {"ts": r[0], "rpm": r[1], "speed_kmh": r[2], "coolant_c": r[3],
            "battery_v": r[4], "fuel_pct": r[5],
            "lat": r[6], "lon": r[7], "alt_m": r[8]}


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(MASTER_DB)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "obd_last_24h": [row_to_obj(r) for r in fetch_series(conn, "obd", 24)],
        "gps_last_24h": [row_to_obj(r) for r in fetch_series(conn, "gps", 24)],
        "obd_last_7d":  [row_to_obj(r) for r in fetch_series(conn, "obd", 7*24)],
    }
    last_pos = conn.execute(
        "SELECT ts, lat, lon, alt_m, speed_kmh FROM telemetry "
        "WHERE source='gps' AND lat IS NOT NULL ORDER BY ts DESC LIMIT 1"
    ).fetchone()
    if last_pos:
        payload["last_position"] = dict(
            ts=last_pos[0], lat=last_pos[1], lon=last_pos[2],
            alt_m=last_pos[3], speed_kmh=last_pos[4])
    conn.close()

    out = os.path.join(DATA_DIR, "latest.json")
    with open(out, "w") as fh:
        json.dump(payload, fh)
    log.info("wrote %s (%d rows obd/24h)", out, len(payload["obd_last_24h"]))

    if GIT_PUSH:
        subprocess.run(["git", "-C", REPO_DIR, "add", "data/latest.json"],
                       check=True)
        r = subprocess.run(
            ["git", "-C", REPO_DIR, "commit", "-m",
             f"Update telemetry {payload['generated_at']}"],
            capture_output=True, text=True)
        if r.returncode != 0 and "nothing to commit" in r.stdout + r.stderr:
            log.info("no changes")
        else:
            subprocess.run(["git", "-C", REPO_DIR, "push", "origin", "gh-pages"],
                           check=True)
            log.info("pushed to gh-pages")


if __name__ == "__main__":
    main()
