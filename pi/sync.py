#!/usr/bin/env python3
"""
Syncs the local SQLite WAL DB to the NUC over Tailscale via rsync-ssh.
The server-side ingest script merges rows idempotently.
"""
import os
import subprocess
import logging

DB = os.environ.get("TWIN_DB", "/var/lib/twin/telemetry.db")
DEST = os.environ.get("TWIN_REMOTE", "twin@twin-server:/var/lib/twin/incoming/telemetry.db")
SSH_OPTS = ["-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10",
            "-o", "BatchMode=yes"]

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sync")


def main():
    # ensure no open writer blocks copy: force WAL checkpoint
    import sqlite3
    conn = sqlite3.connect(DB, timeout=10)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    cmd = ["rsync", "-az", "-e", "ssh " + " ".join(SSH_OPTS), DB, DEST]
    log.info("running: %s", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        log.info("sync ok")
    else:
        log.error("sync failed rc=%d stderr=%s", r.returncode, r.stderr)


if __name__ == "__main__":
    main()
