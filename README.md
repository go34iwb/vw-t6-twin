# VW T6 Digital Twin

Digitaler Zwilling eines VW T6 Transporter/Caravelle, Bj. 2017.

## Aufbau

```
pi/         Software, die auf dem Raspberry Pi Zero 2 W im Bus läuft
server/     Ingest + Export-Skripte für den Intel NUC (Proxmox LXC "twin-server")
dashboard/  Statisches GitHub-Pages-Dashboard (Chart.js + Leaflet)
docs/       Architektur, BOM
```

## Quickstart

1. **Pi vorbereiten** — siehe `pi/install.sh`
2. **NUC/LXC einrichten** — siehe `server/install.sh`
3. **Dashboard** — `dashboard/index.html` wird per `server/export_json.py` mit `data/latest.json` versorgt und nach GitHub Pages gepusht.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/BOM.md](docs/BOM.md)
