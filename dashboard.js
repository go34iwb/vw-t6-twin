const dateTime = new Intl.DateTimeFormat('de-DE', {dateStyle: 'medium', timeStyle: 'short'});
const timeOnly = new Intl.DateTimeFormat('de-DE', {hour: '2-digit', minute: '2-digit'});
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let telemetryData = null;
let telemetryRendered = false;
const componentNames = {
  engine: 'Motor', transmission: 'Getriebe', fuel: 'Kraftstoff',
  cooling: 'Kühlung', exhaust: 'Abgas', electrical: 'Elektrik', unknown: 'Unverortet'
};
const tabs = [...document.querySelectorAll('[role="tab"]')];

function openView(name, focus = false) {
  const selected = tabs.find(tab => tab.dataset.view === name) || tabs[0];
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
  if (focus) selected.focus();
  history.replaceState(null, '', '#' + selected.dataset.view);
  if (selected.dataset.view === 'telemetrie') renderTelemetry();
  window.TwinGarage?.setActive(selected.dataset.view === 'garage');
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => openView(tab.dataset.view));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      openView(tabs[next].dataset.view, true);
    }
  });
});
window.addEventListener('hashchange', () => openView(location.hash.slice(1)));
document.querySelectorAll('[data-open-diagnosis]').forEach(button => {
  button.addEventListener('click', () => openView('diagnose', true));
});

document.querySelectorAll('.flow-toggle').forEach(button => {
  button.addEventListener('click', () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    document.querySelectorAll(`.flow-toggle[data-layer="${button.dataset.layer}"]`).forEach(toggle => {
      toggle.setAttribute('aria-pressed', String(enabled));
    });
    document.querySelector(`.${button.dataset.layer}`).classList.toggle('is-hidden', !enabled);
    window.TwinGarage?.setFlow(button.dataset.layer, enabled);
    if (button.dataset.layer === 'information-flow') {
      document.body.classList.toggle('information-hidden', !enabled);
    }
  });
});

const pauseButtons = [...document.querySelectorAll('[data-pause-animation]')];
pauseButtons.forEach(button => button.addEventListener('click', () => {
  document.body.classList.toggle('animation-paused');
  applyMotionPreference();
}));
function applyMotionPreference() {
  const paused = document.body.classList.contains('animation-paused');
  pauseButtons.forEach(button => {
    button.disabled = reducedMotion.matches;
    button.setAttribute('aria-pressed', String(paused || reducedMotion.matches));
    button.textContent = reducedMotion.matches ? 'Bewegung reduziert (System)' :
      (paused ? 'Animation fortsetzen' : 'Animation pausieren');
  });
  window.TwinGarage?.setPaused(reducedMotion.matches || paused);
}
applyMotionPreference();
reducedMotion.addEventListener('change', applyMotionPreference);

function validPosition(position) {
  return position && Number.isFinite(position.lat) && Number.isFinite(position.lon) &&
    Math.abs(position.lat) <= 90 && Math.abs(position.lon) <= 180;
}

function showMap(data) {
  const position = data.last_position;
  const container = document.getElementById('map');
  if (!validPosition(position)) {
    container.innerHTML = '<p class="empty-state">Noch keine gültige GPS-Position synchronisiert.</p>';
    return;
  }
  const timestamp = Number.isFinite(position.ts) ? dateTime.format(new Date(position.ts * 1000)) : 'Zeit unbekannt';
  document.getElementById('last-pos-meta').textContent =
    `${timestamp} · ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`;
  if (!window.L) {
    container.innerHTML = '<p class="empty-state">Kartenbibliothek konnte nicht geladen werden. Koordinaten stehen unter der Karte.</p>';
    console.error('Leaflet konnte nicht geladen werden.');
    return;
  }
  container.replaceChildren();
  const map = L.map(container).setView([position.lat, position.lon], 14);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  tiles.on('tileerror', () => {
    document.getElementById('last-pos-meta').textContent =
      `${timestamp} · ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)} · Kartenkacheln nicht verfügbar.`;
  });
  L.marker([position.lat, position.lon]).addTo(map);
  const track = (data.gps_last_24h || []).filter(validPosition).map(point => [point.lat, point.lon]);
  if (track.length > 1) L.polyline(track, {color: '#169a70', weight: 3, opacity: .85}).addTo(map);
}

function showCharts(obd) {
  const series = [
    ['c-rpm', 'rpm', 'U/min', '#42f5ac'],
    ['c-speed', 'speed_kmh', 'km/h', '#42f5ac'],
    ['c-cool', 'coolant_c', '°C', '#f5d547'],
    ['c-volt', 'battery_v', 'V', '#42f5ac']
  ];
  document.getElementById('history-state').textContent =
    obd.length ? `${obd.length.toLocaleString('de-DE')} Messpunkte · OBD-II` : 'Keine OBD-Messwerte im Export';
  series.forEach(([id, key, unit, color]) => {
    const canvas = document.getElementById(id);
    const empty = canvas.nextElementSibling;
    if (!obd.some(row => Number.isFinite(row[key]))) return;
    if (!window.Chart) {
      empty.textContent = 'Diagrammbibliothek konnte nicht geladen werden.';
      console.error('Chart.js konnte nicht geladen werden.');
      return;
    }
    empty.hidden = true;
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: obd.map(row => timeOnly.format(new Date(row.ts * 1000))),
        datasets: [{
          data: obd.map(row => Number.isFinite(row[key]) ? row[key] : null),
          label: unit, borderColor: color, backgroundColor: color + '12',
          fill: true, pointRadius: obd.length === 1 ? 3 : 0,
          borderWidth: 1.5, tension: .25, spanGaps: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: {intersect: false, mode: 'index'},
        scales: {
          x: {grid: {color: '#24334655'}, ticks: {color: '#8fa2b7', maxTicksLimit: 6, maxRotation: 0, font: {size: 10}}},
          y: {grid: {color: '#24334688'}, ticks: {color: '#8fa2b7', maxTicksLimit: 5, font: {size: 10}}}
        },
        plugins: {legend: {display: false}, tooltip: {displayColors: false}}
      }
    });
  });
}

function renderTelemetry() {
  if (!telemetryData || telemetryRendered) return;
  telemetryRendered = true;
  showMap(telemetryData);
  showCharts(telemetryData.obd_last_24h);
}

function showDiagnostics(raw) {
  let diagnostics = raw;
  const valid = diagnostics && ['ok', 'unavailable', 'error'].includes(diagnostics.status) &&
    (diagnostics.checked_at === null || (Number.isFinite(diagnostics.checked_at) && diagnostics.checked_at > 0 &&
      Number.isFinite(new Date(diagnostics.checked_at * 1000).getTime()))) &&
    (diagnostics.status !== 'ok' || diagnostics.checked_at !== null) &&
    (diagnostics.mil === null || typeof diagnostics.mil === 'boolean') &&
    Array.isArray(diagnostics.codes) &&
    diagnostics.codes.every(item => item && /^[PCBU][0-3][0-9A-F]{3}$/.test(item.code) &&
      typeof item.description === 'string' && Object.hasOwn(componentNames, item.component)) &&
    (diagnostics.status === 'ok' || diagnostics.codes.length === 0);
  if (!valid) {
    if (raw != null) console.error('Ungültiges Diagnoseformat:', raw);
    diagnostics = {status: 'unavailable', checked_at: null, mil: null, codes: [],
      error: raw == null ? 'Der Export enthält noch keine Diagnose-Snapshots.' : 'Ungültiges Diagnoseformat im Export.'};
  }
  const codes = diagnostics.status === 'ok' ? diagnostics.codes : [];
  const components = new Set(codes.map(code => code.component));
  document.querySelectorAll('.sensor-hotspot').forEach(hotspot => {
    const component = hotspot.dataset.component;
    const findings = codes.filter(code => code.component === component);
    hotspot.classList.toggle('has-fault', findings.length > 0);
    hotspot.querySelector('title').textContent = findings.length ?
      `${componentNames[component]}: ${findings.map(code => code.code).join(', ')}. Ungefähre Systemzuordnung, kein Bauteilnachweis.` :
      `${componentNames[component]}: möglicher Diagnosebereich, kein Fehlernachweis`;
  });
  window.TwinGarage?.setDiagnostics(components);
  document.getElementById('diagnosis-count').textContent = diagnostics.status === 'ok' ? String(codes.length) : '—';
  document.getElementById('diagnosis-count').classList.toggle('has-codes', codes.length > 0);
  document.querySelector('.diagnosis-status').classList.toggle('has-codes', codes.length > 0);
  const status = diagnostics.status === 'ok' ?
    (codes.length ? `${codes.length} gespeicherte${codes.length === 1 ? 'r Fehlercode' : ' Fehlercodes'}` : 'Keine gespeicherten Fehlercodes') :
    (diagnostics.status === 'error' ? 'Letztes Auslesen fehlgeschlagen' : 'Diagnose nicht verfügbar');
  document.getElementById('diagnosis-status').textContent = status;
  document.getElementById('hotspot-summary').textContent = status;
  document.getElementById('dtc-count').textContent = diagnostics.status === 'ok' ? `${codes.length} DTC` : 'UNBEKANNT';
  document.getElementById('diagnosis-mil').textContent = diagnostics.mil === null ? 'Unbekannt' : (diagnostics.mil ? 'Angefordert / MIL an' : 'Nicht angefordert / MIL aus');
  const checked = diagnostics.checked_at ? dateTime.format(new Date(diagnostics.checked_at * 1000)) : 'Noch kein Auslesezeitpunkt';
  const age = diagnostics.checked_at ? Date.now() - diagnostics.checked_at * 1000 : null;
  const ageNote = age !== null && age > 15 * 60 * 1000 ? ' · Achtung: Diagnose älter als 15 Minuten' :
    (age !== null && age < -5 * 60 * 1000 ? ' · Achtung: Zeitstempel liegt in der Zukunft' : '');
  const reason = typeof diagnostics.error === 'string' && diagnostics.error ? ` · ${diagnostics.error}` : '';
  document.getElementById('diagnosis-meta').textContent = checked + ageNote + reason;
  document.getElementById('garage-diagnosis').textContent = `${status} · ${checked}${ageNote}${reason}`;
  const list = document.getElementById('dtc-list');
  list.replaceChildren();
  if (!codes.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = diagnostics.status === 'ok' ?
      'Im letzten erfolgreichen Ausleseversuch wurden keine gespeicherten Standard-OBD-II-Codes gemeldet. Das ist kein vollständiger Fahrzeug-Gesundheitscheck.' :
      'Keine belastbare Aussage zum Fehlerspeicher möglich. Diagnose-Erfassung, Verbindung und Datenstand prüfen.';
    list.append(empty);
    return;
  }
  codes.forEach(item => {
    const card = document.createElement('article');
    card.className = 'dtc-card';
    const heading = document.createElement('div');
    heading.className = 'dtc-card-heading';
    const code = document.createElement('b');
    code.className = 'dtc-code';
    code.textContent = item.code;
    const component = document.createElement('span');
    component.className = 'dtc-component';
    component.textContent = componentNames[item.component];
    heading.append(code, component);
    const description = document.createElement('p');
    description.textContent = item.description || 'Keine standardisierte Beschreibung übermittelt.';
    const note = document.createElement('small');
    note.textContent = item.component === 'unknown' ?
      'Keine verifizierte Systemzuordnung. Herstellerdokumentation zur Interpretation erforderlich.' :
      'Ungefähre Systemzuordnung aus dem Codebereich. Ein gespeicherter Code kann auch einen früheren Fehler beschreiben.';
    card.append(heading, description, note);
    list.append(card);
  });
}

async function boot() {
  let data;
  try {
    const response = await fetch('data/latest.json?_' + Date.now(), {cache: 'no-store'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    data = await response.json();
    if (!data || !Array.isArray(data.obd_last_24h) ||
        !Number.isFinite(Date.parse(data.generated_at)) ||
        (data.gps_last_24h != null && !Array.isArray(data.gps_last_24h))) {
      throw new Error('Ungültiges Telemetrieformat');
    }
  } catch (error) {
    console.error('Telemetrie konnte nicht geladen werden:', error);
    document.querySelector('.connection').classList.add('unavailable');
    document.getElementById('connection-state').textContent = 'Keine Telemetrie verfügbar';
    document.getElementById('last-update').textContent = `Wartet auf Pi-Sync · ${error.message}`;
    document.getElementById('map').innerHTML = '<p class="empty-state">Keine Positionsdaten verfügbar. Wartet auf den ersten Datenexport.</p>';
    document.getElementById('history-state').textContent = 'Kein Datenexport verfügbar';
    showDiagnostics(null);
    return;
  }
  const generated = new Date(data.generated_at);
  const stale = Date.now() - generated.getTime() > 15 * 60 * 1000;
  document.querySelector('.connection').classList.add(stale ? 'unavailable' : 'available');
  document.getElementById('connection-state').textContent = stale ? 'Datenstand älter als 15 min' : 'Datenexport verfügbar';
  document.getElementById('last-update').textContent = dateTime.format(generated) + ' · kein Live-Stream';
  const obd = data.obd_last_24h.filter(row => row && Number.isFinite(row.ts)).sort((a, b) => a.ts - b.ts);
  if (obd.length) {
    const last = obd[obd.length - 1];
    [['s-rpm', 'rpm', 0], ['s-speed', 'speed_kmh', 0], ['s-cool', 'coolant_c', 1],
      ['s-volt', 'battery_v', 1], ['s-fuel', 'fuel_pct', 1]].forEach(([id, key, digits]) => {
      document.getElementById(id).textContent = Number.isFinite(last[key]) ?
        last[key].toLocaleString('de-DE', {maximumFractionDigits: digits}) : '—';
    });
  }
  telemetryData = {...data, obd_last_24h: obd};
  showDiagnostics(data.diagnostics);
  if (!document.getElementById('view-telemetrie').hidden) renderTelemetry();
}
openView(location.hash.slice(1));
boot();
