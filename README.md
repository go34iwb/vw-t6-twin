# VW T6 Digital Twin

Digitaler Zwilling eines VW T6 Transporter/Caravelle, Bj. 2017.

## Aufbau

```
pi/         Software, die auf dem Raspberry Pi 3B+ im Bus läuft (Alternative: Zero 2 W/WH)
server/     Ingest + Export-Skripte für den Intel NUC (Proxmox LXC "twin-server")
dashboard/  Statisches GitHub-Pages-Dashboard (Chart.js + Leaflet)
docs/       Architektur, BOM
```

## Quickstart

1. **Pi vorbereiten** — siehe `pi/install.sh`
2. **NUC/LXC einrichten** — siehe `server/install.sh`
3. **Dashboard** — `dashboard/index.html` wird per `server/export_json.py` mit `data/latest.json` versorgt und nach GitHub Pages gepusht.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/BOM.md](docs/BOM.md)

## Dashboard

[Dashboard auf GitHub Pages öffnen](https://go34iwb.github.io/vw-t6-twin/)

- Schwarzes Cockpit mit den Reitern **Cockpit**, **Diagnose**, **Telemetrie**,
  **System** und **3D-Garage**; Navigation auch per Pfeiltasten und Direktlink
  (`#cockpit`, `#diagnose`, `#telemetrie`, `#system`, `#garage`).
- Transparente VW-T6-Caravelle-Draufsicht mit schematischem Frontantrieb und
  **8 Sitzen (2 + 3 + 3)**: zwei Einzelsitze vorn und zwei nachfolgende 3er-Reihen.
- Grün pulsierend: Kraftstoffversorgung und Kraftübertragung. Gelb pulsierend:
  Informationswege von Motor/Steuergerät über OBD-II sowie GPS zum Raspberry Pi und NUC.
- Rote transparente Pulse zeigen Systeme mit gespeicherten OBD-II-Fehlercodes
  aus dem letzten Diagnose-Snapshot. Graue Ringe markieren mögliche Diagnosebereiche,
  nicht bestätigte Fehler. Herstellerabhängige oder nicht eindeutig zuordenbare Codes
  werden als **unverortet** angezeigt; die Systemzuordnung ist keine Bauteildiagnose.
- Die 3D-Garage enthält ein eigenständig modelliertes Caravelle-Modell mit acht Sitzen,
  Röntgenmodus, Perspektiv-/Drauf-/Seitenansicht, Drehen und Zoomen sowie denselben
  Fluss- und Diagnosezuständen wie die Draufsicht.
- Beide Flussebenen sind zwischen Cockpit und 3D synchron schaltbar. Die Animation
  lässt sich pausieren, respektiert reduzierte Bewegung und stoppt im unsichtbaren 3D-Tab.
- Messwerte, GPS-Karte und 24-Stunden-Verläufe verwenden ausschließlich den letzten
  JSON-Export. Fehlende Daten werden nicht durch erfundene Messwerte ersetzt.
  Die Flussanimation ist illustrativ, kein Live-Stream und kein Nachweis einer
  fahrzeugspezifischen Antriebsausstattung.
- Die Diagnose unterscheidet erfolgreiche leere Auslesung, fehlende Unterstützung,
  Auslesefehler und veraltete Snapshots. Es werden nur gespeicherte Standard-OBD-II-DTCs
  und der MIL-Status gelesen, niemals Fehler gelöscht oder Stellglieder angesteuert.
  Dies ersetzt keinen vollständigen VW-Steuergeräte-Scan und keine Werkstattprüfung.

Die erweiterte Diagnose-Pipeline muss auch auf Pi und Twin-Server ausgerollt werden;
ein Dashboard-Push allein aktualisiert diese Geräte nicht. Migration, Datenformat und
Deployment sind in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) beschrieben.
Die öffentliche Page und ihr Datenexport können GPS- und Diagnosedaten offenlegen.

Die statische Oberfläche besteht aus `dashboard/index.html`, `dashboard/dashboard.css`,
`dashboard/dashboard.js` und `dashboard/garage.js`. Zum Veröffentlichen alle vier Dateien in das
Wurzelverzeichnis des Branches `gh-pages` übernehmen; dessen vorhandenes
`data/`-Verzeichnis erhalten. Der Server aktualisiert weiterhin nur `data/latest.json`.
GitHub Pages veröffentlicht den Branch `gh-pages` (Verzeichnis `/`).
Die vorherige, nur auf `gh-pages` vorhandene Oberfläche bleibt dort als
`technik.html` erhalten und ist im Footer über „Bisherige Ansicht“ verlinkt. Ihre Ressourcen
(`drivetrain.js`, `assets/` und Dokumentation) beim Veröffentlichen ebenfalls erhalten.
Beim erstmaligen Umstieg die bisherige Root-`index.html` vor dem Ersetzen nach
`technik.html` kopieren; bei späteren Veröffentlichungen diese Datei nicht überschreiben.
