/* VW T6 Digital Twin — System-Reiter (Systemarchitektur, Schaltplan, Datenfluss,
 * Energieversorgung, Komponenten). Alle Statusangaben basieren auf realem Befund:
 * Verifikation dieser Session (Server-Zugriff, Logs, Live-Daten) oder Repositorium
 * (Code/BOM). Keine erfundenen Komponenten. Geplante Hardware ist als geplant markiert.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const html = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return node;
  };
  // replaceChildren rendert `null` als Textnode "null" — daher filtern
  const setChildren = (parent, ...children) => {
    parent.replaceChildren(...children.filter(c => c != null));
  };

  // ------------------------------------------------------- status vocabulary
  // Phase 8: Grün nur bei bestätigter Funktion, Orange nur „geplant“,
  // Rot nur bei echtem Fehler, Grau bei unbekannt/nicht spezifiziert.
  const STATUS = {
    verified:     { label: 'Implementiert & verifiziert', dot: 'var(--green)',  chip: 'status-verified' },
    implemented:  { label: 'Implementiert (Code im Repo)', dot: 'var(--green)', chip: 'status-implemented' },
    planned:      { label: 'Geplant (BOM)',                dot: 'var(--orange)', chip: 'status-planned' },
    concept:      { label: 'Konzeptioneller Entwurf',      dot: 'var(--orange)', chip: 'status-concept' },
    unknown:      { label: 'Nicht spezifiziert',           dot: 'var(--muted)',  chip: 'status-unknown' },
    error:        { label: 'Fehlerhaft',                   dot: 'var(--red)',    chip: 'status-error' }
  };

  // -------------------------------------------------------- component model
  // source: Verifikationsbasis — 'verified' (Server-Prüfung 31.10.2026),
  // 'repo' (Code/Datei im Repository), 'bom' (docs/BOM.md), 'n/a'.
  const COMPONENTS = {
    vehicle: {
      name: 'VW T6 (Bj. 2017, 2.0 TDI 102 PS)', type: 'Fahrzeugsystem (Systemgrenze)',
      status: 'unknown', source: 'n/a',
      description: 'Systemgrenze der Fahrzeughälfte. Liefert OBD-II-Diagnosedaten über die Diagnosebuchse und (geplant) Bordspannung an die Onboard-Einheit.',
      interfaces: ['OBD-II-Diagnosebuchse (ISO 15765-4)', '12-V-Bordnetz'],
      protocols: ['OBD-II (SAE J1979 / ISO 15031)', 'CAN-Bus (fahrzeugintern, für dieses Projekt nicht direkt adressiert)'],
      inputs: '—', outputs: 'Diagnosedaten (PIDs, DTCs), Bordspannung (geplant)'
    },
    obdAdapter: {
      name: 'OBD-II-Adapter (ELM327, Bluetooth)', type: 'Diagnoseschnittstelle',
      status: 'planned', source: 'bom',
      description: 'Listet die BOM als Bluetooth-Variante (z. B. Vgate iCar Pro); ein späteres Upgrade auf USB ist dort vermerkt. Ist noch nicht eingebaut — die aktuelle Telemetrie stammt aus einem synthetischen Generator, nicht aus diesem Adapter.',
      interfaces: ['OBD-II (Eingang)', 'Bluetooth SPP (Ausgang)'],
      protocols: ['OBD-II', 'Bluetooth (SPP)'],
      inputs: 'Fahrzeugdiagnosedaten (OBD-II-PIDs, DTCs)',
      outputs: 'JSON-Zeilen (OBD-Antworten) an den Raspberry Pi'
    },
    pi: {
      name: 'Raspberry Pi Zero 2 W (512 MB)', type: 'Onboard-Rechner',
      status: 'planned', source: 'bom',
      description: 'Hauptrechner der Fahrzeugseite (BOM #1, ca. 5 V/0,5 A). Läuft hier: collector.py (Erfassung), sync.py (Übertragung), power_watch.py (Versorgungswächter). Gerät ist noch nicht eingebaut.',
      interfaces: ['USB (OBD-Adapter)', 'UART (GPS HAT)', 'I2C (ADS1115)', 'WiFi (sync)'],
      protocols: ['UART', 'I2C', 'SSH/rsync über Tailscale', 'WiFi'],
      inputs: 'OBD-Zeilen (BT), GPS-NMEA (UART), Batteriespannung (I2C/ADC)',
      outputs: 'SQLite-DB (samples) → rsync an twin-server'
    },
    gpsHat: {
      name: 'GPS HAT (u-blox, z. B. Waveshare L76X)', type: 'Positionsgeber',
      status: 'planned', source: 'bom',
      description: 'GPS-Modul per UART an den Pi (BOM #3, Antenne an der Frontscheibe). collector.py liest nur, während sich das Fahrzeug bewegt (SPEED > 1 km/h), Intervall 10 s — via gpsd.',
      interfaces: ['UART (Pi)', 'GPS-Antenne'],
      protocols: ['NMEA (via gpsd)'],
      inputs: 'GPS-Signale', outputs: 'Positionsdaten (lat/lon/alt/speed) an collector.py'
    },
    powerRail: {
      name: 'Bordversorgung (Zweitbatterie → DC/DC 12 V→5 V)', type: 'Stromversorgung',
      status: 'concept', source: 'bom',
      description: 'Konzeptioneller Entwurf laut BOM: Zweitbatterie → Flachsicherung 5 A (1,5 mm²) → DC/DC-Wandler mit Enable-Pin (LM2596-Modul o. ä.) → Pi. Zusätzlich: Spannungsteiler 100k/22k → ADS1115 (Messung), Unterspannungsrelais (Kemo M148, Cut-off ~12,0 V) als letzte Absicherung. NICHT gebaut, NICHT geprüft — keine fahrzeugsichere Aussage.',
      interfaces: ['Klemmen an der Zweitbatterie', 'Enable-Pin (Schaltlogik)', 'I2C (Messung)'],
      protocols: ['12-V-Gleichstrom', 'I2C (ADS1115)'],
      inputs: 'Bordnetz (Zweitbatterie, 12 V)',
      outputs: '5-V-Versorgung für Pi/HATs, Spannungsmessung, Not-Abschaltung'
    },
    ads1115: {
      name: 'ADS1115 (I2C-ADC) + Spannungsteiler', type: 'Messverstärker',
      status: 'planned', source: 'bom',
      description: '16-Bit-I2C-ADC (BOM #7), da der Pi keinen onboard-ADC hat. Spannungsteiler 100k/22k (Faktor 5,545) misst die Batteriespannung für power_watch.py. Noch nicht verbaut.',
      interfaces: ['I2C (Pi)', 'Spannungsteiler'],
      protocols: ['I2C'],
      inputs: 'Batteriespannung (geteilt)', outputs: 'Digitaler Spannungswert an power_watch.py'
    },
    collector: {
      name: 'collector.py (Datenerfassung)', type: 'Software (Pi)',
      status: 'implemented', source: 'repo: pi/collector.py',
      description: 'Zwei Worker: OBD-Lesezyklus alle 15 s (RPM, Speed, Kühlmittel, Batterie, Kraftstoff) und Diagnose-Auslese alle 60 s (MIL + DTCs). GPS-Worker alle 10 s, nur bei Bewegung. Schreibt in die lokale SQLite-DB (WAL). Code implementiert; läuft nicht (Pi nicht eingebaut).',
      interfaces: ['Bluetooth (OBD-Adapter)', 'gpsd (D-Bus/Uncified API)', 'SQLite'],
      protocols: ['JSON (OBD)', 'NMEA', 'SQLite WAL'],
      inputs: 'OBD-Antworten, GPS-Pakete',
      outputs: 'samples-Tabelle (ts, source, rpm, speed_kmh, coolant_c, battery_v, fuel_pct, lat, lon, alt) + diagnostics'
    },
    sync: {
      name: 'sync.py (DB-Sync)', type: 'Software (Pi)',
      status: 'implemented', source: 'repo: pi/sync.py',
      description: 'WAL-Checkpoint, dann rsync-ssh über Tailscale an twin-server:/var/lib/twin/incoming/telemetry.db. Idempotent vom Server-Import. Code implementiert; läuft nicht (Pi nicht eingebaut).',
      interfaces: ['SQLite', 'SSH (Tailscale)', 'rsync'],
      protocols: ['SSH (Ed25519-Key)', 'rsync over SSH'],
      inputs: 'Lokale telemetry.db (Pi)', outputs: 'telemetry*.db in /var/lib/twin/incoming/ (twin-server)'
    },
    powerWatch: {
      name: 'power_watch.py (Power-Watchdog)', type: 'Software (Pi)',
      status: 'implemented', source: 'repo: pi/power_watch.py',
      description: 'Liest alle 5 s die Batteriespannung über den ADS1115. Liegt sie 30 s unter 12,0 V, fährt das System kontrolliert herunter (shutdown -h). Das Hardware-Relais ist die letzte Stufe. Code implementiert; läuft nicht (Hardware nicht verbaut).',
      interfaces: ['I2C (ADS1115)', 'systemd (Shutdown)'],
      protocols: ['I2C', 'POSIX (shutdown)'],
      inputs: 'Spannungswert (I2C)', outputs: 'Kontrolliertes Herunterfahren bei Unterspannung'
    },
    twinServer: {
      name: 'twin-server (Proxmox LXC, Debian 12)', type: 'Server / Infrastruktur',
      status: 'verified', source: 'verified (LXC, Proxmox)',
      description: 'LXC-Container im Homelab (Intel NUC): 1 vCPU, 512 MB RAM, 8 GB Disk. Läuft Tailscale, SSH für Pi-Key, systemd-Timer twin-ingest + twin-export (je alle 5 min). Verifiziert am 31.10.2026 (Zugriff, Units, Logs).',
      interfaces: ['SSH (Pi, Hermes)', 'Tailscale (Netz)', 'systemd-Timer'],
      protocols: ['SSH (Ed25519)', 'Tailscale (WireGuard)'],
      inputs: 'telemetry*.db (rsync), manuelle Befehle (Hermes)',
      outputs: 'Master-DB, latest.json, gh-pages-Push'
    },
    ingest: {
      name: 'twin-ingest (ingest.py)', type: 'Import-Service (Timer, 5 min)',
      status: 'verified', source: 'verified (Timer aktiv, Lauf OK)',
      description: 'Merge-t alle /var/lib/twin/incoming/telemetry*.db idempotent in die Master-DB (UPSERT auf ts+source). Verifiziert: Service läuft, Daten in der DB. Aktuelle Master-DB der Export-Kette: telemetry-synthetic.db (Testmodus).',
      interfaces: ['Dateisystem (incoming/)', 'SQLite'],
      protocols: ['SQLite (WAL)', 'systemd (Timer)'],
      inputs: 'incoming/telemetry*.db (Pi-Sync)',
      outputs: 'Master-DB: samples + diagnostics'
    },
    masterDb: {
      name: 'Master-DB (SQLite)', type: 'Datenbank / Historie',
      status: 'verified', source: 'verified (Schema, Datenbestand)',
      description: 'SQLite auf dem twin-server. Tabellen: samples (ts, source, rpm, speed_kmh, coolant_c, battery_v, fuel_pct, lat, lon, alt) und diagnostics (ts, mil, code, description, component). Verifiziert am 31.10.2026. Die echte DB /var/lib/twin/telemetry.db enthält die Originaldaten und wird nicht mit Testdaten gemischt.',
      interfaces: ['SQLite (WAL)', 'Leszugriff Anomalie-Service (geplant)'],
      protocols: ['SQLite'],
      inputs: 'ingest.py', outputs: 'Telemetrie-Historie für export/anomaly'
    },
    export: {
      name: 'twin-export (export_json.py)', type: 'Export-Service (Timer, 5 min)',
      status: 'verified', source: 'verified (Push erfolgreich, 31.10.2026)',
      description: 'Baut data/latest.json (obd_last_24h/7d, gps_last_24h, last_position, diagnostics), committet und pusht in den gh-pages-Clone /opt/vw-t6-twin-repo. Vor jedem Push: git fetch + reset --hard origin/gh-pages (verhindert Divergenz). Verifiziert: Push f120a236 am 31.10.2026 18:52 UTC.',
      interfaces: ['SQLite (lesend)', 'Git (gh-pages-Clone)', 'GitHub (SSH-Key)'],
      protocols: ['JSON', 'Git over SSH', 'systemd (Timer)'],
      inputs: 'Master-DB', outputs: 'data/latest.json → gh-pages → GitHub'
    },
    anomaly: {
      name: 'Anomalieerkennung (Autoencoder)', type: 'Analyse-Service',
      status: 'planned', source: 'repo: anomaly-service/',
      description: 'Python-Service (FastAPI, localhost:8765): Feature-Fenster (60 s/30 s) über rpm, speed, coolant, battery, fuel → Autoencoder (hidden 16) → Reconstruction-Score, Hysterese, Events. Modus: dry-run/normal/offline. Code vollständig im Repo — ABER: nicht auf dem twin-server deployt, kein systemd-Service aktiv, kein Modell trainiert. Deshalb „geplant“, nicht „implementiert“.',
      interfaces: ['SQLite (read-only)', 'HTTP API (localhost)', 'JSON-Events'],
      protocols: ['SQLite', 'HTTP (FastAPI)'],
      inputs: 'Master-DB (Telemetrie-Fenster)',
      outputs: 'Anomalie-Score + Ereignisse (API/JSON) — Aufnahme ins Dashboard noch offen'
    },
    hermes: {
      name: 'Hermes Agent', type: 'Analyse & Betrieb',
      status: 'implemented', source: 'verified (aktiver Betrieb)',
      description: 'KI-Agent auf dem Hermes-System mit SSH-Zugriff auf den twin-server. Analysiert Telemetrie, erklärt Auffälligkeiten, unterstützt Wartung/Diagnose und Deployment. Kein Telemetrie-Dienst in der Pipeline — greift von außen zu (SSH).',
      interfaces: ['SSH (twin-server)', 'GitHub (Read/Write via Key auf twin-server)'],
      protocols: ['SSH', 'Git'],
      inputs: 'Telemetrie, Logs, Repository',
      outputs: 'Analysen, Erklärungen, Deployment-Schritte'
    },
    ghActions: {
      name: 'GitHub Actions (publish-dashboard)', type: 'CI/CD',
      status: 'verified', source: 'verified (Workflow-Runs)',
      description: 'Workflow .github/workflows/publish-dashboard.yml: Bei Push nach main (dashboard/**) kopiert dashboard/* nach gh-pages und pusht. Verifiziert: Lauf „Publish dashboard from main“ (z. B. ccb40ded).',
      interfaces: ['GitHub (main → gh-pages)'],
      protocols: ['Git', 'GitHub Actions'],
      inputs: 'Push nach main (dashboard/)', outputs: 'Aktualisierter gh-pages-Baum'
    },
    ghPages: {
      name: 'GitHub Pages', type: 'Hosting (statisch)',
      status: 'verified', source: 'verified (HTTP 200, Daten live)',
      description: 'Statische Auslieferung von go34iwb.github.io/vw-t6-twin/. Liefert das Dashboard und data/latest.json (CDN). Kein Backend, kein Push vom Dashboard — die Daten kommen ausschließlich über den twin-server (git push).',
      interfaces: ['HTTP(S) (Read)'],
      protocols: ['HTTP(S)'],
      inputs: 'gh-pages-Baum (export, Actions)',
      outputs: 'Dashboard + latest.json an Browser'
    },
    dashboard: {
      name: 'Dashboard (diese Seite)', type: 'Frontend',
      status: 'implemented', source: 'repo: dashboard/',
      description: 'Vanilla JS ohne Build-Schritt: Chart.js (CDN), Leaflet (CDN, OpenStreetMap), Three.js (Garage). Liest data/latest.json (5-min-Takt), kein Live-Stream. Tabs: Übersicht/Antrieb, Cockpit, Telemetrie, Garage, Diagnose, System.',
      interfaces: ['fetch data/latest.json'],
      protocols: ['HTTP(S) (JSON)', 'OpenStreetMap Tiles (HTTP)'],
      inputs: 'latest.json', outputs: 'Interaktive Visualisierung'
    }
  };

  // ------------------------------------------------------------ layout data
  // Schaltplan (viewBox 1040 × 820). Anchors: l/r/t/b = Kantenmitte.
  const NODES = [
    // Fahrzeug
    { id: 'vehicle',      x: 40,  y: 46,  w: 210, h: 118, zone: 'vehicle',  title: 'VW T6' },
    { id: 'obdAdapter',   x: 330, y: 60,  w: 200, h: 64,  zone: 'vehicle',  title: 'OBD-II-Adapter' },
    { id: 'powerRail',    x: 330, y: 156, w: 200, h: 64,  zone: 'vehicle',  title: 'Bordversorgung' },
    { id: 'gpsHat',       x: 610, y: 46,  w: 180, h: 54,  zone: 'vehicle',  title: 'GPS HAT' },
    { id: 'ads1115',      x: 610, y: 120, w: 180, h: 54,  zone: 'vehicle',  title: 'ADS1115 + Teiler' },
    { id: 'pi',           x: 610, y: 196, w: 340, h: 76,  zone: 'vehicle',  title: 'Raspberry Pi Zero 2 W' },
    // Twin-Server
    { id: 'twinServer',   x: 40,  y: 330, w: 170, h: 96,  zone: 'server',   title: 'twin-server (LXC)' },
    { id: 'ingest',       x: 270, y: 336, w: 190, h: 60,  zone: 'server',   title: 'twin-ingest' },
    { id: 'masterDb',     x: 270, y: 432, w: 190, h: 60,  zone: 'server',   title: 'Master-DB (SQLite)' },
    { id: 'export',       x: 530, y: 336, w: 200, h: 60,  zone: 'server',   title: 'twin-export' },
    { id: 'anomaly',      x: 530, y: 432, w: 200, h: 60,  zone: 'server',   title: 'Anomalie-Service' },
    { id: 'hermes',       x: 800, y: 366, w: 200, h: 60,  zone: 'server',   title: 'Hermes Agent' },
    // GitHub
    { id: 'ghActions',    x: 250, y: 596, w: 210, h: 60,  zone: 'cloud',    title: 'GitHub Actions' },
    { id: 'ghPages',      x: 530, y: 596, w: 210, h: 60,  zone: 'cloud',    title: 'GitHub Pages' },
    { id: 'dashboard',    x: 530, y: 712, w: 210, h: 58,  zone: 'cloud',    title: 'Dashboard (Browser)' }
  ];
  const ZONES = [
    { id: 'vehicle', x: 20,  y: 20,  w: 960, h: 268, label: 'SYSTEMGRENZE · FAHRZEUG (VW T6)' },
    { id: 'server',  x: 20,  y: 304, w: 960, h: 200, label: 'SYSTEMGRENZE · HOMELAB (PROXMOX)' },
    { id: 'cloud',   x: 20,  y: 570, w: 960, h: 228, label: 'SYSTEMGRENZE · CLOUD (GITHUB)' }
  ];

  // Link-Styles: data (fest, läuft), dataPlanned (gestrichelt cyan),
  // network (gestrichelt cyan), power (grün fest / orange gestrichelt bei Konzept),
  // planned (orange gestrichelt), unknown (grau gestrichelt)
  const LINKS = [
    { from: 'vehicle',  to: 'obdAdapter', fromA: 'r', toA: 'l', style: 'dataPlanned', label: 'OBD-II (ISO 15765-4)' },
    { from: 'obdAdapter', to: 'pi',       fromA: 'r', toA: 't', style: 'dataPlanned', label: 'Bluetooth · JSON' },
    { from: 'powerRail',  to: 'pi',       fromA: 'r', toA: 'l', style: 'powerPlanned', label: '5 V (konzeptionell)' },
    { from: 'gpsHat',     to: 'pi',       fromA: 'b', toA: 't', style: 'dataPlanned', label: 'UART · NMEA' },
    { from: 'powerRail',  to: 'ads1115',  fromA: 'r', toA: 'l', style: 'powerPlanned', label: '12 V (Messpunkt)' },
    { from: 'ads1115',    to: 'pi',       fromA: 'b', toA: 't', style: 'dataPlanned', label: 'I2C · Spannung' },
    { from: 'pi',         to: 'twinServer', fromA: 'l', toA: 'r', style: 'network', label: 'WiFi/Tailscale · rsync-ssh' },
    { from: 'twinServer', to: 'ingest',   fromA: 'r', toA: 'l', style: 'data', label: 'Timer 5 min' },
    { from: 'ingest',     to: 'masterDb', fromA: 'b', toA: 't', style: 'data', label: 'UPSERT (idempotent)' },
    { from: 'masterDb',   to: 'export',   fromA: 't', toA: 'b', style: 'data', label: 'SELECT 24 h/7 d' },
    { from: 'export',     to: 'ghActions', fromA: 'b', toA: 't', style: 'network', label: 'git push gh-pages (SSH)' },
    { from: 'ghActions',  to: 'ghPages',  fromA: 'r', toA: 'l', style: 'data', label: 'publish (main → gh-pages)' },
    { from: 'ghPages',    to: 'dashboard', fromA: 'b', toA: 't', style: 'data', label: 'HTTP · latest.json' },
    { from: 'masterDb',   to: 'anomaly',  fromA: 'r', toA: 'l', style: 'dataPlanned', label: 'read-only (geplant)' },
    { from: 'hermes',     to: 'twinServer', fromA: 'l', toA: 'r', style: 'network', label: 'SSH (Betrieb/Analyse)' },
    { from: 'hermes',     to: 'ghActions',  fromA: 'b', toA: 't', style: 'network', label: 'git (via Key)' }
  ];

  const nodeById = Object.fromEntries(NODES.map(n => [n.id, n]));
  const anchor = (n, side) => ({
    l: [n.x, n.y + n.h / 2], r: [n.x + n.w, n.y + n.h / 2],
    t: [n.x + n.w / 2, n.y],  b: [n.x + n.w / 2, n.y + n.h]
  }[side]);

  const LINK_STYLE = {
    data:         { stroke: 'var(--cyan, #37c8f0)', width: 2,   dash: '',     marker: 'arr-data',    anim: true },
    dataPlanned:  { stroke: '#37c8f0',              width: 1.6, dash: '6 5',  marker: 'arr-planned', anim: false, opacity: .55 },
    network:      { stroke: '#37c8f0',              width: 1.6, dash: '2 5',  marker: 'arr-data',    anim: true },
    power:        { stroke: 'var(--green)',         width: 2,   dash: '',     marker: 'arr-power',   anim: false },
    powerPlanned: { stroke: 'var(--orange)',        width: 1.8, dash: '7 5',  marker: 'arr-planned', anim: false, opacity: .8 },
    planned:      { stroke: 'var(--orange)',        width: 1.6, dash: '6 5',  marker: 'arr-planned', anim: false },
    unknown:      { stroke: 'var(--muted)',         width: 1.4, dash: '2 6',  marker: 'arr-unknown', anim: false, opacity: .7 }
  };

  // ------------------------------------------------------------- state
  let pipeline = { key: 'unknown', label: 'Status unbekannt', detail: 'Noch keine Telemetrie geladen.' };
  let selectedId = null;
  let root = null;

  // -------------------------------------------------- pipeline status (live)
  function derivePipeline(data) {
    if (!data || !data.generated_at) {
      return { key: 'offline', label: 'Keine aktuellen Daten verfügbar',
        detail: 'data/latest.json konnte nicht geladen oder ist ungültig.' };
    }
    const ageMs = Date.now() - new Date(data.generated_at).getTime();
    const ageMin = Math.round(ageMs / 60000);
    if (ageMin < 15) {
      return { key: 'ok', label: 'Pipeline aktiv (Daten frisch)',
        detail: `Letzter Export ${new Date(data.generated_at).toLocaleTimeString('de-DE')} Uhr · Intervall 5 min.` };
    }
    if (ageMin < 120) {
      return { key: 'stale', label: `Export verzögert (~${ageMin} min)`,
        detail: 'Daten vorhanden, aber älter als 15 min. Export-Service auf dem twin-server prüfen.' };
    }
    return { key: 'offline', label: 'Export inaktiv (> 2 h ohne Push)',
      detail: 'Kein frisches latest.json. Timer/Service und Git-Zugriff auf dem twin-server prüfen.' };
  }

  function pipelineStatusFor(compId) {
    // Nur Komponenten, deren Zustand durch die Datenlage belegt ist:
    const live = ['twinServer', 'ingest', 'masterDb', 'export', 'ghPages', 'ghActions'];
    if (!live.includes(compId)) return null;
    if (pipeline.key === 'ok') return { label: 'Läuft (verifiziert)', chip: 'status-verified' };
    if (pipeline.key === 'stale') return { label: 'Verzögert', chip: 'status-stale' };
    return { label: 'Inaktiv', chip: 'status-error' };
  }

  // ------------------------------------------------------------- SVG build
  function drawSchematic(container) {
    container.replaceChildren();
    const svg = svgEl('svg', { viewBox: '0 0 1040 820', class: 'sys-svg', role: 'img',
      'aria-label': 'Interaktiver Systemschaltplan VW T6 Digital Twin' });

    // Defs: Pfeilspitzen
    const defs = svgEl('defs');
    [['arr-data', '#37c8f0'], ['arr-planned', 'var(--orange)'],
     ['arr-power', 'var(--green)'], ['arr-unknown', 'var(--muted)']].forEach(([id, color]) => {
      const m = svgEl('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      m.append(svgEl('path', { d: 'M 0 1 L 9 5 L 0 9 z', fill: color }));
      defs.append(m);
    });
    svg.append(defs);

    // Zonen (Systemgrenzen, SysML-artig: gestrichelte Umrandung)
    ZONES.forEach(z => {
      const g = svgEl('g', { class: 'sys-zone' });
      g.append(svgEl('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 14, class: 'sys-zone-rect' }));
      const t = svgEl('text', { x: z.x + 16, y: z.y + 22, class: 'sys-zone-label' });
      t.textContent = z.label;
      g.append(t);
      svg.append(g);
    });

    // Links (unter den Nodes)
    const linkGroup = svgEl('g', { class: 'sys-links' });
    LINKS.forEach(link => {
      const s = LINK_STYLE[link.style];
      const a = anchor(nodeById[link.from], link.fromA);
      const b = anchor(nodeById[link.to], link.toA);
      const elbow = (link.fromA === 't' || link.fromA === 'b' || link.toA === 't' || link.toA === 'b') &&
                    (link.fromA !== link.toA);
      let d;
      if (!elbow) {
        d = `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`;
      } else if (link.fromA === 'b' || link.fromA === 't') {
        const midY = (a[1] + b[1]) / 2;
        d = `M ${a[0]} ${a[1]} L ${a[0]} ${midY} L ${b[0]} ${midY} L ${b[0]} ${b[1]}`;
      } else {
        const midX = (a[0] + b[0]) / 2;
        d = `M ${a[0]} ${a[1]} L ${midX} ${a[1]} L ${midX} ${b[1]} L ${b[0]} ${b[1]}`;
      }
      const path = svgEl('path', { d, class: `sys-link sys-link--${link.style}` + (s.anim ? ' sys-link--anim' : ''),
        'marker-end': `url(#${s.marker})` });
      if (s.dash) path.setAttribute('stroke-dasharray', s.dash);
      path.style.strokeWidth = s.width + 'px';
      if (s.opacity) path.style.opacity = s.opacity;
      linkGroup.append(path);
      if (link.label) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const lt = svgEl('text', { x: mx, y: my - 5, class: 'sys-link-label' });
        lt.textContent = link.label;
        linkGroup.append(lt);
      }
    });
    svg.append(linkGroup);

    // Nodes
    const nodeGroup = svgEl('g', { class: 'sys-nodes' });
    NODES.forEach(n => {
      const comp = COMPONENTS[n.id];
      const st = STATUS[comp.status];
      const g = svgEl('g', { class: 'sys-node', 'data-node': n.id, tabindex: '0',
        role: 'button', 'aria-label': `${n.title} — ${st.label}. Details öffnen.` });
      g.append(svgEl('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 10,
        class: `sys-node-rect sys-node--${comp.status}` }));
      // Status-Punkt
      g.append(svgEl('circle', { cx: n.x + n.w - 14, cy: n.y + 14, r: 4.5,
        class: 'sys-node-dot', style: `fill:${st.dot}` }));
      // Ports (SysML-artig): kleine Kreuze an den verwendeten Ankern
      const usedSides = new Set();
      LINKS.forEach(l => {
        if (l.from === n.id) usedSides.add(l.fromA);
        if (l.to === n.id) usedSides.add(l.toA);
      });
      [...usedSides].forEach(side => {
        const [px, py] = anchor(n, side);
        g.append(svgEl('circle', { cx: px, cy: py, r: 3.5, class: 'sys-port' }));
      });
      const t1 = svgEl('text', { x: n.x + 14, y: n.y + 24, class: 'sys-node-title' });
      t1.textContent = n.title;
      g.append(t1);
      const t2 = svgEl('text', { x: n.x + 14, y: n.y + 40, class: 'sys-node-sub' });
      t2.textContent = comp.type.length > 34 ? comp.type.slice(0, 33) + '…' : comp.type;
      g.append(t2);
      if (n.h > 70) {
        const t3 = svgEl('text', { x: n.x + 14, y: n.y + 56, class: 'sys-node-sub' });
        t3.textContent = st.label.length > 38 ? st.label.slice(0, 37) + '…' : st.label;
        g.append(t3);
      }
      g.addEventListener('click', () => selectNode(n.id));
      g.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(n.id); }
      });
      nodeGroup.append(g);
    });
    svg.append(nodeGroup);
    container.append(svg);
  }

  // --------------------------------------------------------- detail panel
  function renderDetail() {
    const panel = root.querySelector('#sys-detail');
    if (!panel) return;
    if (!selectedId) {
      panel.replaceChildren(
        html('p', { class: 'sys-detail-empty' },
          'Komponente im Schaltplan anklicken, um technische Details, Schnittstellen und Datenflüsse zu sehen.'));
      return;
    }
    const comp = COMPONENTS[selectedId];
    const st = STATUS[comp.status];
    const live = pipelineStatusFor(selectedId);
    const upstream = LINKS.filter(l => l.to === selectedId).map(l =>
      `${nodeById[l.from].title} → ${l.label || l.style}`);
    const downstream = LINKS.filter(l => l.from === selectedId).map(l =>
      `${nodeById[l.to].title} ← ${l.label || l.style}`);
    const row = (k, v) => html('div', { class: 'sys-drow' },
      html('span', { class: 'sys-dk', text: k }), html('span', { class: 'sys-dv', text: v }));
    setChildren(panel,
      html('div', { class: 'sys-detail-head' },
        html('h4', { text: comp.name }),
        html('span', { class: 'chip ' + (live ? live.chip : st.chip), text: live ? live.label : st.label })),
      live && !['status-verified'].includes(st.chip)
        ? html('p', { class: 'sys-detail-sub' }, `Statisch: ${st.label} · live abgeleitet: ${live.label}`)
        : html('p', { class: 'sys-detail-sub', text: st.label }),
      row('Typ', comp.type),
      row('Basis', comp.source),
      row('Schnittstellen', comp.interfaces.join(' · ')),
      row('Protokolle', comp.protocols.join(' · ')),
      row('Eingang', comp.inputs),
      row('Ausgang', comp.outputs),
      html('p', { class: 'sys-detail-desc', text: comp.description }),
      upstream.length ? html('p', { class: 'sys-detail-flow' },
        html('b', { text: 'Eingehende Flüsse: ' }), upstream.join(' | ')) : null,
      downstream.length ? html('p', { class: 'sys-detail-flow' },
        html('b', { text: 'Ausgehende Flüsse: ' }), downstream.join(' | ')) : null
    );
  }

  function selectNode(id) {
    selectedId = (selectedId === id) ? null : id;
    root.querySelectorAll('.sys-node').forEach(g =>
      g.classList.toggle('is-selected', g.dataset.node === selectedId));
    renderDetail();
  }

  // ------------------------------------------------------- overview (BDD)
  function buildOverview(container) {
    const SUBSYS = [
      { label: 'Onboard-Einheit (Fahrzeug)', ids: ['obdAdapter', 'pi', 'gpsHat', 'powerRail', 'ads1115', 'collector', 'sync', 'powerWatch'] },
      { label: 'Datenplattform (Homelab)', ids: ['twinServer', 'ingest', 'masterDb', 'export', 'anomaly', 'hermes'] },
      { label: 'Veröffentlichung (Cloud)', ids: ['ghActions', 'ghPages', 'dashboard'] }
    ];
    const sys = html('div', { class: 'sys-bdd' },
      html('div', { class: 'sys-bdd-system' },
        html('span', { class: 'sys-bdd-title', text: 'DIGITAL TWIN — SYSTEMGRENZE' }),
        html('div', { class: 'sys-bdd-subs' },
          SUBSYS.map(sub => html('div', { class: 'sys-bdd-sub' },
            html('b', { class: 'sys-bdd-sub-label', text: sub.label }),
            html('div', { class: 'sys-chips' },
              sub.ids.map(id => html('button', {
                class: 'sys-chip ' + (pipelineStatusFor(id) ? pipelineStatusFor(id).chip : STATUS[COMPONENTS[id].status].chip),
                'data-node': id, type: 'button',
                text: nodeById[id] ? nodeById[id].title : COMPONENTS[id].name
              }))))
          )
        )
      ));
    // Chips → Detail-Panel (reicht über alle Views)
    sys.querySelectorAll('.sys-chip').forEach(chip =>
      chip.addEventListener('click', () => {
        const id = chip.dataset.node;
        if (NODES.some(n => n.id === id)) selectNode(id);
        showSysView('schematic');
      }));
    container.replaceChildren(
      html('div', { class: 'sys-overview-grid' },
        html('div', { class: 'sys-panel-box' },
          html('h3', { class: 'sys-h3', text: 'Systemstruktur (BDD-artig)' }),
          html('p', { class: 'muted', text: 'Systemgrenzen → Subsysteme → Komponenten. Klick auf eine Komponente öffnet den Schaltplan mit Details.' }),
          sys),
        html('div', { class: 'sys-panel-box' },
          html('h3', { class: 'sys-h3', text: 'Pipeline-Status (abgeleitet aus echten Daten)' }),
          html('div', { id: 'sys-pipeline-box' }),
          html('h3', { class: 'sys-h3', text: 'Bestand' }),
          html('div', { id: 'sys-counts' }),
          html('h3', { class: 'sys-h3', text: 'Wichtige Hinweise' }),
          html('ul', { class: 'sys-notes' },
            html('li', { text: 'Aktuelle Telemetrie stammt aus einem SYNTHETISCHEN Generator (telemetry-synthetic.db), nicht aus dem Fahrzeug.' }),
            html('li', { text: 'Fahrzeugseite (Pi, OBD-Adapter, GPS, Strom) ist BOM-Planung — noch nicht verbaut.' }),
            html('li', { text: 'Anomalie-Service: Code vollständig im Repo, Deployment auf dem twin-server ausstehend.' }),
            html('li', { text: 'Kein Live-Stream: latest.json wird alle 5 min exportiert.' })
          )
        )
      )
    );
    refreshOverview();
  }

  function refreshOverview() {
    if (!root) return;
    const box = root.querySelector('#sys-pipeline-box');
    if (box) {
      const cls = 'sys-pipe sys-pipe--' + pipeline.key;
      setChildren(box,
        html('div', { class: cls },
          html('b', { text: pipeline.label }),
          html('span', { text: pipeline.detail })),
        pipeline.key !== 'ok' && root.dataset.hasDtc === '1'
          ? html('p', { class: 'muted', text: 'Hinweis: Fahrzeug-Diagnose meldet DTC(s) — siehe Reiter Diagnose (Fahrzeugzustand, kein Systemfehler).' })
          : null
      );
    }
    const counts = root.querySelector('#sys-counts');
    if (counts) {
      const c = { verified: 0, implemented: 0, planned: 0, concept: 0, unknown: 0, error: 0 };
      Object.values(COMPONENTS).forEach(x => { c[x.status] = (c[x.status] || 0) + 1; });
      counts.replaceChildren(
        html('div', { class: 'sys-count-row' },
          html('span', { class: 'chip status-verified', text: `${c.verified} verifiziert & aktiv` }),
          html('span', { class: 'chip status-implemented', text: `${c.implemented} implementiert (Code)` }),
          html('span', { class: 'chip status-planned', text: `${c.planned} geplant (BOM)` }),
          html('span', { class: 'chip status-concept', text: `${c.concept} Konzept` }),
          html('span', { class: 'chip status-unknown', text: `${c.unknown} Systemgrenze/unklar` })
        )
      );
    }
  }

  // ---------------------------------------------------------- flow diagram
  const FLOW_OBD = [
    { name: 'VW T6 · ECUs (CAN)', status: 'vehicle', detail: 'Diagnose-Daten im Fahrzeug-CAN-Bus' },
    { name: 'OBD-II-Diagnosebuchse (ISO 15765-4)', status: 'vehicle', detail: 'Standardisierte Schnittstelle (K-Line/CAN) am Fahrzeug' },
    { name: 'ELM327-Adapter (Bluetooth)', status: 'planned', detail: 'Übersetzt OBD-II → JSON-Zeilen · BOM, noch nicht verbaut' },
    { name: 'collector.py (Pi, alle 15 s)', status: 'implemented', detail: 'PIDs: RPM, Speed, Kühlmittel, Batterie, Kraftstoff · Diagnose (MIL/DTCs) alle 60 s' },
    { name: 'SQLite samples (Pi)', status: 'implemented', detail: 'ts, source, rpm, speed_kmh, coolant_c, battery_v, fuel_pct · WAL' },
    { name: 'sync.py (rsync-ssh via Tailscale)', status: 'implemented', detail: 'WAL-Checkpoint → /var/lib/twin/incoming/telemetry.db' },
    { name: 'twin-ingest (Timer, 5 min)', status: 'verified', detail: 'Idempotenter Merge (UPSERT ts+source) in die Master-DB' },
    { name: 'Master-DB (SQLite)', status: 'verified', detail: 'Telemetrie-Historie + diagnostics-Tabelle' },
    { name: 'twin-export (Timer, 5 min)', status: 'verified', detail: 'Fenster 24 h/7 d → latest.json · git fetch/reset → push' },
    { name: 'GitHub Pages (CDN)', status: 'verified', detail: 'Statisches JSON, 5-Minuten-Takt' },
    { name: 'Dashboard (Chart.js)', status: 'implemented', detail: 'Reiter Telemetrie/Diagnose' }
  ];
  const FLOW_GPS = [
    { name: 'GPS HAT (u-blox)', status: 'planned', detail: 'Antenne an der Frontscheibe · BOM, noch nicht verbaut' },
    { name: 'UART → gpsd (Pi)', status: 'implemented', detail: 'NMEA-Empfang · gpsd-py3' },
    { name: 'collector.py GPS-Worker (10 s)', status: 'implemented', detail: 'Nur bei Bewegung (speed > 1 km/h) · lat/lon/alt/speed' },
    { name: 'SQLite samples (source=gps)', status: 'implemented', detail: 'Gleiche Tabelle wie OBD, eigener source-Wert' },
    { name: 'sync → ingest → Master-DB', status: 'verified', detail: 'Gleiche Kette wie OBD-Daten (ab rsync)' },
    { name: 'twin-export', status: 'verified', detail: 'gps_last_24h + last_position in latest.json' },
    { name: 'Dashboard (Leaflet/OSM)', status: 'implemented', detail: 'Karte + 24-h-Track (Reiter Telemetrie)' }
  ];

  function buildFlow(container) {
    const chain = (title, note, steps) => html('div', { class: 'sys-flowcol' },
      html('h3', { class: 'sys-h3', text: title }),
      html('p', { class: 'muted', text: note }),
      html('div', { class: 'sys-flowsteps' },
        steps.map((s, i) => html('div', { class: 'sys-flowstep ' + 'sys-flowstep--' + (s.status === 'verified' ? 'ok' : s.status === 'planned' ? 'planned' : 'impl') },
          html('span', { class: 'sys-flowstep-dot', text: i + 1 }),
          html('div', {},
            html('b', { text: s.name }),
            html('small', { text: s.detail }))))));
    container.replaceChildren(
      html('p', { class: 'muted', text: 'Verarbeitungskette von der Quelle bis zur Visualisierung. Farben: grün = aktiv/verifiziert, orange = geplant (BOM), grau-grün = Code implementiert (Gerät nicht verbaut). Alle Formate stammen aus dem Repository-Code — nichts Erfundenes.' }),
      html('div', { class: 'sys-flowgrid' },
        chain('Kette A · OBD-Diagnosedaten', 'Einzeldaten: RPM, Speed, Kühlmittel, Batterie, Kraftstoff · dazu DTCs/MIL alle 60 s.', FLOW_OBD),
        chain('Kette B · Positionsdaten (GPS)', 'Zweite, parallele Quelle über das gleiche Sync-/Export-Backend.', FLOW_GPS)
      )
    );
  }

  // ------------------------------------------------------------- power view
  function buildPower(container) {
    const step = (name, detail, state) => html('div', { class: 'sys-powerstep sys-powerstep--' + state },
      html('b', { text: name }), html('small', { text: detail }));
    container.replaceChildren(
      html('div', { class: 'sys-power-warn' },
        html('b', { text: 'Konzeptioneller Entwurf — nicht gebaut, nicht geprüft. ' }),
        'Keine fahrzeugsichere Aussage. Alle Werte stammen aus der BOM-Planung (docs/BOM.md) und dem Entwurf von power_watch.py; keine Messung, kein Fahrzeugtest.'),
      html('div', { class: 'sys-power-grid' },
        html('div', { class: 'sys-panel-box' },
          html('h3', { class: 'sys-h3', text: 'Spannungskette (Konzept)' }),
          html('div', { class: 'sys-powerchain' },
            step('Zweitbatterie (12 V)', 'Getrennt von der Starterbatterie — Vermeidung einer Entladung', 'planned'),
            step('Flachsicherung 5 A', '1,5 mm² KFZ-Kabel, ~3 m · Schutz der Leitung', 'planned'),
            step('DC/DC-Wandler 12 V → 5 V', '≥ 3 A, mit Enable-Pin (LM2596-Modul o. ä.) — kontrolliertes Ein/Aus', 'planned'),
            step('Raspberry Pi Zero 2 W + GPS HAT', 'Verbraucher (ca. 5 V / 0,5 A)', 'planned')),
          html('h3', { class: 'sys-h3', text: 'Monitoringschleife (Konzept)' }),
          html('div', { class: 'sys-powerchain' },
            step('Spannungsteiler 100k/22k → ADS1115', 'I2C, 16-bit · Faktor 5,545 · alle 5 s ausgelesen', 'planned'),
            step('power_watch.py', '< 12,0 V für 30 s → kontrolliertes Herunterfahren (shutdown -h)', 'implemented'),
            step('Unterspannungs-Relais (Kemo M148)', 'Cut-off ~12,0 V · letzte Stufe, falls die GPIO-Logik versagt', 'planned'))),
        html('div', { class: 'sys-panel-box' },
          html('h3', { class: 'sys-h3', text: 'Anforderungen & aktueller Stand' }),
          html('ul', { class: 'sys-powerreqs' },
            html('li', { text: 'Fahrzeugspannung: 12-V-Bordnetz, Anschluss an Zweitbatterie (geplant).' }),
            html('li', { text: 'Sicherung: 5-A-Flachsicherung (BOM) — nicht montiert.' }),
            html('li', { text: 'Überspannungsschutz: über den DC/DC-Wandler (LM2596 o. ä.) — Konzept, nicht geprüft.' }),
            html('li', { text: 'Unterspannungsschutz: softwareseitig (power_watch.py, Code fertig) + Relais (BOM).' }),
            html('li', { text: 'Kontrolliertes Herunterfahren: implemented in power_watch.py (30 s Hold, 5 s Takt).' }),
            html('li', { text: 'Klemme-15-/Zündungssignal: NICHT spezifiziert — bewusst kein Enable-Signal aus dem Bordnetz eingeplant, da die Zweitbatterie unabhängig vom Bordnetz bleibt.' }),
            html('li', { text: 'Ruhestrom bei ausgeschalteter Zündung: NICHT spezifiziert / nicht gemessen — muss bei der Realisierung ermittelt werden (Pi Zero 2 W Ruhestrom typ. im Bereich einiger 100 mA, exakter Wert zu messen).' }),
            html('li', { text: 'Entladung der Starterbatterie: entkoppelt durch Zweitbatterie (Konzept); Kapazität/Größe der Zweitbatterie noch nicht spezifiziert.' })
          ),
          html('p', { class: 'muted', text: 'Bewusste Lücke: Ohne Zündungssignal läuft die Einheit, solange die Zweitbatterie es trägt — der Watchdog ist dann der einzige Schutz. Bei der Realisierung zu klären (siehe offene Fragen im Abschlussbericht).' })
        )
      )
    );
  }

  // ---------------------------------------------------- component table view
  function buildTable(container) {
    const head = (t) => html('th', { scope: 'col', text: t });
    const rows = Object.entries(COMPONENTS).map(([id, c]) => {
      const live = pipelineStatusFor(id);
      const st = live || STATUS[c.status];
      return html('tr', {},
        html('td', { text: c.name, class: 'sys-td-name' }),
        html('td', { text: c.type }),
        html('td', {}, html('span', { class: 'chip ' + st.chip, text: st.label })),
        html('td', { text: c.interfaces.join(' · '), class: 'sys-td-small' }),
        html('td', { text: c.protocols.join(' · '), class: 'sys-td-small' }),
        html('td', { text: c.inputs, class: 'sys-td-small' }),
        html('td', { text: c.outputs, class: 'sys-td-small' }),
        html('td', { text: c.source, class: 'sys-td-small' }));
    });
    container.replaceChildren(
      html('p', { class: 'muted', text: 'Alle Komponenten mit Quellenangabe (BOM, Repository oder Verifikation vom 31.10.2026). „Geplant“ = in der Stückliste, nicht verbaut. „Konzept“ = Entwurf ohne Realisierung. Live-Status nur dort, wo echte Daten ihn belegen.' }),
      html('div', { class: 'sys-tablewrap' },
        html('table', { class: 'sys-table' },
          html('thead', {}, html('tr', {},
            head('Komponente'), head('Typ'), head('Status'), head('Schnittstellen'),
            head('Protokolle'), head('Eingang'), head('Ausgang'), head('Basis'))),
          html('tbody', {}, rows))))
  }

  // ------------------------------------------------------------- sub-tabs
  const VIEWS = [
    { id: 'overview',   label: 'Systemübersicht' },
    { id: 'schematic',  label: 'Interaktiver Schaltplan' },
    { id: 'flow',       label: 'Datenfluss' },
    { id: 'power',      label: 'Energieversorgung' },
    { id: 'components', label: 'Komponenten & Schnittstellen' }
  ];

  function showSysView(id) {
    const view = VIEWS.some(v => v.id === id) ? id : 'overview';
    root.querySelectorAll('.sys-subtab').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.sysView === view)));
    root.querySelectorAll('.sys-view').forEach(v =>
      v.hidden = v.dataset.sysView !== view);
    if (view === 'schematic') renderDetail();
  }

  // ------------------------------------------------------------ init
  // Daten kommen asynchron aus dashboard.js (boot/fetch) — Reihenfolge ungewiss:
  // update() vor init() puffert in pendingLive, init() wendet den Puffer an.
  let pendingLive = null;

  function applyLive() {
    if (!pendingLive || !root) return;
    const [data, diagnostics] = pendingLive;
    pendingLive = null;
    pipeline = derivePipeline(data);
    root.dataset.hasDtc = diagnostics && diagnostics.status === 'ok' && diagnostics.codes && diagnostics.codes.length ? '1' : '0';
    // Live-Status der Pipeline-Komponenten auf Diagramm + Detail + Übersicht anwenden
    root.querySelectorAll('.sys-node').forEach(g => {
      const id = g.dataset.node;
      const live = pipelineStatusFor(id);
      const dot = g.querySelector('.sys-node-dot');
      const rect = g.querySelector('.sys-node-rect');
      const comp = COMPONENTS[id];
      if (rect) {
        rect.classList.remove('sys-node--verified', 'sys-node--implemented', 'sys-node--planned', 'sys-node--concept', 'sys-node--unknown', 'sys-node--error', 'sys-node--stale');
        rect.classList.add(live && live.chip === 'status-stale' ? 'sys-node--stale'
          : live && live.chip === 'status-error' ? 'sys-node--error'
          : live && live.chip === 'status-verified' ? 'sys-node--verified'
          : 'sys-node--' + comp.status);
      }
      if (dot) {
        dot.style.fill = live && live.chip === 'status-stale' ? 'var(--yellow)'
          : live && live.chip === 'status-error' ? 'var(--red)'
          : STATUS[comp.status].dot;
      }
    });
    if (selectedId) renderDetail();
    refreshOverview();
  }

  function init() {
    const mount = document.getElementById('system-root') || document.getElementById('view-system');
    if (!mount) return;
    root = mount;
    mount.replaceChildren(
      html('p', { class: 'eyebrow', text: 'System · Architektur & Betrieb' }),
      html('div', { class: 'sys-subnav', role: 'group', 'aria-label': 'System-Unteransichten' },
        VIEWS.map(v => html('button', {
          class: 'sys-subtab', type: 'button', 'data-sys-view': v.id,
          'aria-pressed': 'false', text: v.label
        }))),
      html('div', { id: 'sys-view-overview', class: 'sys-view', 'data-sys-view': 'overview' }),
      html('div', { id: 'sys-view-schematic', class: 'sys-view', 'data-sys-view': 'schematic', hidden: '' },
        html('div', { class: 'sys-schematic-layout' },
          html('div', { class: 'sys-diagram-wrap', id: 'sys-diagram' }),
          html('aside', { id: 'sys-detail', class: 'sys-detail', 'aria-live': 'polite' })),
        html('div', { class: 'sys-legend' },
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'lg lg-verified' }), 'implementiert & verifiziert'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'lg lg-implemented' }), 'implementiert (Code)'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'lg lg-planned' }), 'geplant (BOM)'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'lg lg-error' }), 'tatsächlicher Fehler'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'lg lg-unknown' }), 'Systemgrenze / unkategorisiert'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'ln ln-data' }), 'Datenfluss (aktiv)'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'ln ln-planned' }), 'geplante Verbindung'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'ln ln-network' }), 'Netzwerk'),
          html('span', { class: 'sys-legend-item' }, html('i', { class: 'ln ln-power' }), 'Strom (Konzept)')),
        html('p', { class: 'diagram-note', text: 'Systemgrenzen gestrichelt (SysML-artig). Ports als kleine Kreise an den Verbindungsstellen. Status farbcodiert, Klick = Details rechts. Keine Live-Verbindungsprüfung im Browser — „läuft“ ist aus dem Datenexport abgeleitet.' })),
      html('div', { id: 'sys-view-flow', class: 'sys-view', 'data-sys-view': 'flow', hidden: '' }),
      html('div', { id: 'sys-view-power', class: 'sys-view', 'data-sys-view': 'power', hidden: '' }),
      html('div', { id: 'sys-view-components', class: 'sys-view', 'data-sys-view': 'components', hidden: '' })
    );
    root.querySelectorAll('.sys-subtab').forEach(b =>
      b.addEventListener('click', () => showSysView(b.dataset.sysView)));
    buildOverview(root.querySelector('#sys-view-overview'));
    drawSchematic(root.querySelector('#sys-diagram'));
    buildFlow(root.querySelector('#sys-view-flow'));
    buildPower(root.querySelector('#sys-view-power'));
    buildTable(root.querySelector('#sys-view-components'));
    showSysView('overview');
    applyLive();
  }

  window.TwinSystem = {
    init,
    update(data, diagnostics) {
      pendingLive = [data, diagnostics];
      if (root) applyLive();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
