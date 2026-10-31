# VW T6 Digital Twin — Architektur

## Übersicht

```
[VW T6]                                 [Zuhause]
Pi 3B+ (Alt: Zero 2 W)                  Intel NUC (Proxmox)
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
- **Hardware:** Pi 3B+ (Alternativen: Zero 2 W/WH — gleiche 40-Pin-HAT-Pins, Software identisch; 3B+ gewählt wegen Verfügbarkeit, 2× USB für künftiges USB-ELM327-Upgrade und 5-GHz-WLAN für stabile Tailscale-Verbindung), GPS HAT, ELM327 Bluetooth; Strom aus Zweitbatterie mit Unterspannungsschutz (12.0V GPIO-Überwachung + Hardware-Relais)
- **Polling:** OBD alle 5s; GPS 60s bzw. nur bei Bewegung
- **Speicher:** SQLite WAL auf Pi; NUC konsolidiert in `telemetry.db`
- **Dashboard v1:** statisches JSON + Chart.js auf GitHub Pages (v2: React SPA + API)

## Pipelline Details

1. **Pi `collector.py`** (systemd service):
   - verbindet ELM327 via rfcomm/BT
   - fragt PIDs 010C (RPM), 010D (Speed), 0105 (Coolant), 0142 (Voltage), 012F (Fuel) alle 5s ab
   - `gpsd` liefert Position während Geschwindigkeit > 5 km/h
   - schreibt in `/var/lib/twin/telemetry.db` (WAL)
   - liest zusätzlich gespeicherte DTCs mit Mode 03 (`GET_DTC`), beim Verbinden und danach alle 60s (`TWIN_DIAGNOSTIC_INTERVAL`, Sekunden); `STATUS` (Mode 01 PID 01) liefert optional den MIL-Status
   - ausschließlich lesend: kein Löschen von DTCs, keine Aktuatorbefehle; OBD und GPS haben jeweils eine eigene SQLite-Verbindung im Worker-Thread
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

## Gespeicherte OBD-II-Diagnosen (read-only)

Die Migration auf Pi und NUC ist additiv und wiederholbar: `open_db()` legt
neben der unveränderten `telemetry`-Tabelle folgende Tabelle an. Bestehende
Telemetriedaten bleiben erhalten; es ist kein DB-Reset nötig.

```sql
CREATE TABLE diagnostics (
  ts INTEGER NOT NULL,       -- Unix-Sekunden: Zeitpunkt des letzten Versuchs
  source TEXT NOT NULL,      -- derzeit 'obd'
  status TEXT NOT NULL CHECK (status IN ('ok', 'unavailable', 'error')),
  mil INTEGER CHECK (mil IN (0, 1)),  -- NULL: nicht verfügbar
  codes_json TEXT,           -- JSON [{code, description}], [] bei bestätigtem Leerresultat
  error TEXT,               -- NULL bei erfolgreicher Code-Abfrage
  PRIMARY KEY (ts, source)
);
```

Jeder Diagnoseversuch erzeugt einen Snapshot, auch bei fehlender Verbindung,
nicht unterstütztem Mode 03, Nullantwort oder Ausnahme. Nur eine erfolgreich
gelesene, gültige Codeliste ergibt `ok`; eine bestätigte leere Liste ist ein
gültiges Ergebnis, `NULL` dagegen nicht. Fehlende Unterstützung und Nullantworten
ergeben `unavailable`, Ausnahmen/ungültige Antworten `error`; Fehler werden
explizit protokolliert. Die optionale MIL-Abfrage darf fehlschlagen: Dann bleibt
bei erfolgreicher Code-Abfrage `status: "ok"`, aber `mil: null`, mit Logeintrag.
Beschreibungen stammen unverändert aus python-OBD; bei fehlendem Text wird `""`
ausgegeben, keine erfundene Fehlerbeschreibung.

`ingest.py` öffnet die empfangene DB nur lesend und migriert ausschließlich die
Master-DB. Alte Pi-DBs ohne Diagnosetabelle funktionieren weiterhin. Snapshots
werden über `(ts, source)` dedupliziert; identische Wiederholungen ändern keine
Diagnosezeile. Ein veränderter Snapshot derselben Sekunde wird aktualisiert
(z.B. Verbindungsabbruch direkt nach erfolgreicher Abfrage). Innerhalb derselben
Sekunde bleibt pro Quelle nur der letzte lokal gespeicherte Versuch erhalten.
Telemetrie und Diagnose werden gemeinsam in einer Transaktion übernommen.

### JSON-Vertrag

`data/latest.json` erhält zusätzlich `diagnostics`; alle bisherigen
Telemetrie-Felder bleiben unverändert:

```json
{
  "status": "ok",
  "checked_at": 1792420000,
  "mil": false,
  "codes": [
    {"code": "P0301", "description": "", "component": "engine"}
  ],
  "error": null,
  "source": "obd"
}
```

- `status`: `"ok" | "unavailable" | "error"`.
- `checked_at`: Unix-Sekunden des neuesten Versuchs, auch bei Fehlern; `null`,
  wenn noch kein Versuch vorliegt.
- `mil`: `true | false | null`; unabhängig von der Codeliste.
- `codes`: Liste `{code: string, description: string, component: string}`.
  `component` ist ausschließlich `"engine" | "transmission" | "fuel" |
  "cooling" | "exhaust" | "electrical" | "unknown"`.
- `error`: Fehlertext oder `null`; `source` ist optional, derzeit `"obd"`.

Ohne Tabelle/Zeilen wird
`{"status":"unavailable","checked_at":null,"mil":null,"codes":[],"error":null}`
exportiert. Bei fehlgeschlagenen Versuchen bleiben Codes leer und MIL unbekannt.
Ein neuer Fehler verdrängt einen älteren Erfolg; der Export sucht **nicht** den
letzten erfolgreichen Snapshot. Die zeitliche Aktualität muss anhand von
`checked_at` bewertet werden, besonders nach Offline-Phasen.

Die Komponentenzuordnung ist eine **vorläufige System-/Ortsklassifikation**,
keine Diagnose eines defekten Bauteils. Nur ausgewählte bekannte generische
P0/P2-Familien werden gruppiert (z.B. P0300–P0314 Motor, P07xx Getriebe,
P0170–P0175 Kraftstoff, P0115–P0119 Kühlung, P0420 Abgas, P0560–P0563 Elektrik).
Nicht abgedeckte generische Codes sowie herstellerspezifische/unverifizierte
Codes bleiben `unknown`; insbesondere wird aus einem P1/P3-Code keine
VW-spezifische Bedeutung abgeleitet. Gespeicherte Codes können historisch sein
und sind **kein Beweis für einen derzeit aktiven Fehler**. Es werden weder
Pending/Permanent-Codes noch Freeze-Frames oder herstellerspezifische
Steuergeräteabfragen ergänzt.

### Deployment und Validierung

1. Aktualisiertes `collector.py` auf den Pi kopieren und Collector-Dienst neu
   starten; die Diagnosemigration erfolgt beim Start automatisch. Vorhandenes
   python-OBD wird genutzt, es kommt keine neue Abhängigkeit hinzu.
2. Aktualisierte `ingest.py` und `export_json.py` auf dem NUC installieren.
   Ingest migriert die Master-DB beim nächsten Lauf. Der neue Export kann auch
   bereits vorher mit einer alten DB laufen (`unavailable`).
3. Bestehende Timer/Sync-Abfolge beibehalten: Pi-Sync, NUC-Ingest, JSON-Export.
   `sync.py` führt weiterhin `wal_checkpoint(TRUNCATE)` aus und rsynct **nur**
   die `.db`-Datei; dieses Verhalten wird hier nicht verändert. Bei einem
   laufenden Collector ist Checkpoint plus rsync keine atomare SQLite-Sicherung
   (erneute WAL-Schreibvorgänge sind möglich). Für einen verifizierbaren
   manuellen Ersttransfer Collector stoppen, Sync/Checkpoint ausführen und
   danach wieder starten; eine atomare Backup-/Sync-Umstellung ist separat.
4. `checked_at`, Status und Collector-Logs prüfen. Ohne ECU/Adapter kann die
   tatsächliche Hardwareantwort nicht zertifiziert werden.

Konkretes Update einer bereits eingerichteten Installation, jeweils im
Repository-Verzeichnis auf dem betreffenden Linux-Host ausführen:

```bash
# Pi: nur den Collector ersetzen; bestehende Bluetooth-/GPS-/Sync-Konfiguration bleibt.
sudo install -m 0644 pi/collector.py /opt/vw-t6-twin/collector.py
sudo systemctl restart collector.service
sudo systemctl status collector.service --no-pager
sudo journalctl -u collector.service -n 50 --no-pager

# Optional: erster konsistenter manueller Transfer mit gestopptem Collector.
sudo systemctl stop collector.service
sudo systemctl start sync.service
sudo systemctl start collector.service

# NUC/LXC: nach erfolgreichem Pi-Transfer.
sudo install -m 0755 server/ingest.py /usr/local/bin/twin-ingest.py
sudo install -m 0755 server/export_json.py /usr/local/bin/twin-export.py
sudo systemctl start twin-ingest.service
# Export ohne Push zur lokalen Prüfung:
sudo env TWIN_PUSH=0 TWIN_REPO=/opt/vw-t6-twin-repo python3 /usr/local/bin/twin-export.py
sudo journalctl -u twin-ingest.service -n 50 --no-pager
sudo systemctl list-timers twin-ingest.timer twin-export.timer --no-pager
```

Die vorhandenen Server-Timer rufen beim nächsten Lauf die neuen Skripte auf;
ein Neustart der Timer oder `daemon-reload` ist ohne Unit-Änderung nicht nötig.
Der reguläre `twin-export.service` hat weiterhin `TWIN_PUSH=1` und veröffentlicht
beim nächsten Timerlauf wie bisher.

Fokussierte Backendtests ohne zusätzliche Pakete:
`python -m unittest discover -s tests -p test_diagnostics.py`.
Die Tests prüfen Migration, Legacy-DBs, read-only-Abfragen, Null-/Leerantworten,
Fehler, optionale MIL, konservatives Mapping, wiederholten/out-of-order Ingest
und den JSON-Export. Test-DBs samt WAL-Dateien werden im Projekt erzeugt und
anschließend entfernt.
