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
import re
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


def diagnostic_component(code):
    """Tentative system grouping, never a failed-part diagnosis."""
    if not re.fullmatch(r"P[02][0-9]{3}", code):
        return "unknown"
    if (code.startswith("P07") or code == "P0218"):
        return "transmission"
    if ("P0115" <= code <= "P0119"
            or "P0125" <= code <= "P0128" or code == "P0217"):
        return "cooling"
    if ("P0170" <= code <= "P0175" or "P0200" <= code <= "P0214"
            or "P0230" <= code <= "P0233"
            or "P2096" <= code <= "P2099"):
        return "fuel"
    if ("P0300" <= code <= "P0314" or "P2100" <= code <= "P2119"):
        return "engine"
    if ("P0400" <= code <= "P0439" or "P2000" <= code <= "P2003"
            or "P2200" <= code <= "P2209"):
        return "exhaust"
    if "P0560" <= code <= "P0563":
        return "electrical"
    return "unknown"


def fetch_diagnostics(conn):
    result = {"status": "unavailable", "checked_at": None, "mil": None,
              "codes": [], "error": None}
    try:
        if not conn.execute(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='diagnostics'").fetchone():
            return result
        row = conn.execute(
            "SELECT ts, source, status, mil, codes_json, error FROM diagnostics "
            "ORDER BY ts DESC, source ASC LIMIT 1").fetchone()
        if row is None:
            return result
        ts, source, status, mil, codes_json, error = row
        if not isinstance(ts, int) or ts <= 0:
            raise ValueError("Invalid diagnostic snapshot timestamp")
        result.update(checked_at=ts, source=source)
        if status not in ("ok", "unavailable", "error"):
            raise ValueError("Invalid diagnostic snapshot status")
        if status != "ok":
            result.update(status=status, error=error)
            return result
        if codes_json is None:
            result["error"] = "Stored DTC snapshot contains no confirmed code data"
            return result
        codes = json.loads(codes_json)
        if not isinstance(codes, list):
            raise ValueError("Invalid diagnostic snapshot codes")
        exported_codes = []
        for item in codes:
            if (not isinstance(item, dict)
                    or not isinstance(item.get("code"), str)
                    or not re.fullmatch(r"[PCBU][0-3][0-9A-F]{3}", item["code"])
                    or not isinstance(item.get("description"), str)):
                raise ValueError("Invalid diagnostic snapshot code or description")
            exported_codes.append({
                "code": item["code"], "description": item["description"],
                "component": diagnostic_component(item["code"])})
        if mil not in (None, 0, 1):
            raise ValueError("Invalid diagnostic snapshot MIL flag")
        result.update(status="ok", codes=exported_codes,
                      mil=None if mil is None else bool(mil))
        return result
    except (sqlite3.Error, ValueError, TypeError) as exc:
        log.exception("Cannot export diagnostic snapshot")
        result.update(status="error", mil=None, codes=[], error=str(exc))
        return result


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(MASTER_DB)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "obd_last_24h": [row_to_obj(r) for r in fetch_series(conn, "obd", 24)],
        "gps_last_24h": [row_to_obj(r) for r in fetch_series(conn, "gps", 24)],
        "obd_last_7d":  [row_to_obj(r) for r in fetch_series(conn, "obd", 7*24)],
        "diagnostics": fetch_diagnostics(conn),
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
