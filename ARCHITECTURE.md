# VW T6 Digital Twin — Architektur

## Übersicht

```
[VW T6]                                 [Zuhause]
Pi Zero 2 W                             Intel NUC (Proxmox)
 ├─ ELM327 (BT) → OBD-II PIDs           ├─ LXC: twin-server
 ├─ GPS HAT → Position (nur Fahrt)      │   ├─ ingest.py (SFTP Empfang)
 ├─ ADS1115 → Batteriespannung          │   ├─ SQLite/Postgres (telemetry.db)
 ├─ SQLite WAL (lokaler Puffer)         │   ├─ export_json.py (cron, alle 5min)
 └─ sync.py → Tailscale ────────────────┤   └─ git push → go34iwb/vw-t6-twin
                                          └─ GitHub Pages (Dashboard, Chart.js)
```

## Entscheidungen (Grill-Me Konsens 2026-10-03)

- **Ziel:** Live-Telemetrie (OBD-II + GPS), später Wartungs-Dashboard
- **Daten:** OBD-II Standard-PIDs + GPS-Position (nur während Fahrt)
- **Sync:** Batch über Heim-WLAN/Tailscale, kein Mobilfunk in v1
- **Hardware:** Pi Zero 2 W, GPS HAT, ELM327 Bluetooth; Strom aus Zweitbatterie mit Unterspannungsschutz (12.0V GPIO-Überwachung + Hardware-Relais)
- **Polling:** OBD alle 5s; GPS 60s bzw. nur bei Bewegung
- **Speicher:** SQLite WAL auf Pi; NUC konsolidiert in `telemetry.db`
- **Dashboard v1:** statisches JSON + Chart.js auf GitHub Pages (v2: React SPA + API)

## Pipelline Details

1. **Pi `collector.py`** (systemd service):
   - verbindet ELM327 via rfcomm/BT
   - fragt PIDs 010C (RPM), 010D (Speed), 0105 (Coolant), 0142 (Voltage), 012F (Fuel) alle 5s ab
   - `gpsd` liefert Position während Geschwindigkeit > 5 km/h
   - schreibt in `/var/lib/twin/telemetry.db` (WAL)
   - `power_watch.py` überwacht Spannung: < 12.0V für > 30s → `shutdown now`
2. **Pi `sync.py`** (systemd timer, alle 5min und nach Boot):
   - prüft Tailscale-Verbindung zum NUC (`twin-server`)
   - `rsync` der WAL-DB (inkrementelle `INSERT` — server dedupliziert anhand von `ts,source`)
3. **NUC `ingest.py`**: merge pi-db → master-db (`telemetry.db`)
4. **NUC `export_json.py`** (cron */5): aggregiert letzte 24h, 7d, 30d → `data/*.json` → `git commit && push`
5. **GH Pages** lädt `data/latest.json` und rendert Charts

## Datenmodell (telemetrie)

```sql
CREATE TABLE telemetry (
  ts        INTEGER NOT NULL,        -- unix epoch
  source    TEXT NOT NULL,           -- 'obd' | 'gps' | 'power'
  rpm       REAL, speed_kmh REAL,
  coolant_c REAL, battery_v REAL, fuel_pct REAL,
  lat REAL, lon REAL, alt_m REAL,
  PRIMARY KEY (ts, source)
);
```

## Sicherheit

- Kein Port-Forwarding: Tailscale-only Kommunikation
- Keine Positionsdaten im Repo-History vor 24h (Aggregation löscht Feinauflösung > 24h)
- API-Key nicht erforderlich (statisch)
