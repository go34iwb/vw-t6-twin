// ═══════════════════════════════════════════════════
// VW T6 — Drivetrain Top-Down Visualization
// Canvas-basierte Draufsicht mit animiertem Datenfluss
// ═══════════════════════════════════════════════════

(function() {
  'use strict';
  
  // === Sensor-Datenbank ===
  const sensors = {
    coolant: {
      id: 'coolant',
      name: 'Kühlmitteltemperatur',
      position: { x: 0.3, y: 0.55 },
      unit: '°C',
      min: 80,
      max: 110,
      warningMin: 70,
      warningMax: 105,
      errorMin: 60,
      errorMax: 120,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Motortemperatur. Normalbereich: 80-110°C. Warnung bei <70 oder >105°C'
    },
    rpm: {
      id: 'rpm',
      name: 'Motordrehzahl',
      position: { x: 0.3, y: 0.5 },
      unit: 'U/min',
      min: 700,
      max: 4500,
      warningMin: 600,
      warningMax: 4800,
      errorMin: 500,
      errorMax: 5200,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Drehzahl des 2.0 TDI Motors. Leerlauf ~800 U/min'
    },
    voltage: {
      id: 'voltage',
      name: 'Bordnetzspannung',
      position: { x: 0.15, y: 0.7 },
      unit: 'V',
      min: 13.5,
      max: 14.8,
      warningMin: 12.0,
      warningMax: 15.5,
      errorMin: 11.0,
      errorMax: 16.0,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Batteriespannung. Bei Motorlauf sollte sie 13.5-14.8V betragen'
    },
    transTemp: {
      id: 'transTemp',
      name: 'Getriebetemperatur',
      position: { x: 0.5, y: 0.55 },
      unit: '°C',
      min: 40,
      max: 120,
      warningMin: 30,
      warningMax: 130,
      errorMin: 20,
      errorMax: 140,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Automatikgetriebe (6HP26). Normal: 60-100°C'
    },
    exhaustTemp: {
      id: 'exhaustTemp',
      name: 'Abgastemperatur',
      position: { x: 0.2, y: 0.7 },
      unit: '°C',
      min: 100,
      max: 600,
      warningMin: 80,
      warningMax: 650,
      errorMin: 50,
      errorMax: 700,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Abgastemperatur vor DPF. DPF-Regeneration bei ~600°C'
    },
    tyreFL: {
      id: 'tyreFL',
      name: 'Reifendruck vorne links',
      position: { x: 0.05, y: 0.35 },
      unit: 'bar',
      min: 2.0,
      max: 2.6,
      warningMin: 1.8,
      warningMax: 2.8,
      errorMin: 1.5,
      errorMax: 3.0,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Reifendruck vorne. Sollwert: 2.3 bar (Teer) / 2.5 bar (Asphalt)'
    },
    tyreFR: {
      id: 'tyreFR',
      name: 'Reifendruck vorne rechts',
      position: { x: 0.55, y: 0.35 },
      unit: 'bar',
      min: 2.0,
      max: 2.6,
      warningMin: 1.8,
      warningMax: 2.8,
      errorMin: 1.5,
      errorMax: 3.0,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Reifendruck vorne. Sollwert: 2.3 bar'
    },
    tyreRL: {
      id: 'tyreRL',
      name: 'Reifendruck hinten links',
      position: { x: 0.05, y: 0.65 },
      unit: 'bar',
      min: 2.5,
      max: 3.0,
      warningMin: 2.3,
      warningMax: 3.2,
      errorMin: 2.0,
      errorMax: 3.5,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Reifendruck hinten. Sollwert: 2.9 bar (voll beladen)'
    },
    tyreRR: {
      id: 'tyreRR',
      name: 'Reifendruck hinten rechts',
      position: { x: 0.55, y: 0.65 },
      unit: 'bar',
      min: 2.5,
      max: 3.0,
      warningMin: 2.3,
      warningMax: 3.2,
      errorMin: 2.0,
      errorMax: 3.5,
      notAvailable: true,
      liveValue: null,
      tooltip: 'Reifendruck hinten. Sollwert: 2.9 bar'
    }
  };

  // === Datenfluss-Pfade (von Sensor zu ECU) ===
  const flowPaths = [
    { from: 'coolant', to: { x: 0.4, y: 0.55 } }, // Motor -> ECU
    { from: 'rpm', to: { x: 0.4, y: 0.5 } }, // Motor -> ECU
    { from: 'voltage', to: { x: 0.2, y: 0.5 } }, // Batterie -> ECU
    { from: 'transTemp', to: { x: 0.5, y: 0.5 } }, // Getriebe -> ECU
    { from: 'exhaustTemp', to: { x: 0.3, y: 0.6 } }, // Abgas -> ECU
    { from: 'tyreFL', to: { x: 0.1, y: 0.4 } }, // Räder -> ESP-ECU
    { from: 'tyreFR', to: { x: 0.3, y: 0.4 } },
    { from: 'tyreRL', to: { x: 0.1, y: 0.55 } },
    { from: 'tyreRR', to: { x: 0.3, y: 0.55 } }
  ];

  // === Globale Variablen ===
  let canvas, ctx;
  let animFrameId = null;
  let particles = [];
  let sensorPulses = {};
  let currentTab = 'telemetrie';
  let isVisible = false;
  let demoMode = true;

  // === Initialisierung ===
  function initDrivetrain() {
    canvas = document.getElementById('drivetrain-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    // Resize Handler
    function resize() {
      const container = document.getElementById('drivetrain-container');
      if (!container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    
    resize();
    window.addEventListener('resize', resize);
    
    // Demo-Daten initialisieren
    initDemoData();
    
    // Event Listeners
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', hideTooltip);
    canvas.addEventListener('click', handleCanvasClick);
    
    // Animation starten
    startAnimation();
    
    // Initialer Tab-Status prüfen
    checkActiveTab();
  }

  // === Demo-Daten initialisieren ===
  function initDemoData() {
    sensors.coolant.liveValue = 92;
    sensors.coolant.notAvailable = false;
    
    sensors.rpm.liveValue = 820;
    sensors.rpm.notAvailable = false;
    
    sensors.voltage.liveValue = 14.2;
    sensors.voltage.notAvailable = false;
    
    // Getriebetemperatur nicht verfügbar
    sensors.transTemp.notAvailable = true;
    sensors.transTemp.liveValue = null;
    
    // Abgastemperatur Demo-Wert
    sensors.exhaustTemp.liveValue = 380;
    sensors.exhaustTemp.notAvailable = false;
    
    // Reifendrücke (einer als Demo-Warnung)
    sensors.tyreFL.liveValue = 2.3;
    sensors.tyreFL.notAvailable = false;
    
    sensors.tyreFR.liveValue = 2.25;
    sensors.tyreFR.notAvailable = false;
    
    sensors.tyreRL.liveValue = 2.85;
    sensors.tyreRL.notAvailable = false;
    
    sensors.tyreRR.liveValue = 1.95; // Warnung!
    sensors.tyreRR.notAvailable = false;
  }

  // === Status berechnen ===
  function getStatus(value, sensor) {
    if (sensor.notAvailable || value === null) return 'gray';
    if (value < sensor.errorMin || value > sensor.errorMax) return 'red';
    if (value < sensor.warningMin || value > sensor.warningMax) return 'yellow';
    return 'green';
  }

  // === Animation starten ===
  function startAnimation() {
    if (animFrameId) return;
    
    function animate() {
      if (!isVisible) {
        animFrameId = requestAnimationFrame(animate);
        return;
      }
      
      // Canvas leeren
      ctx.fillStyle = '#172126';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Netz zeichnen
      drawGrid();
      
      // Fahrzeug-Unterbau zeichnen
      drawDrivetrain();
      
      // Datenfluss-Partikel aktualisieren und zeichnen
      updateAndDrawParticles();
      
      // Sensor-Marker zeichnen
      drawSensorMarkers();
      
      animFrameId = requestAnimationFrame(animate);
    }
    
    animate();
  }

  // === Grid zeichnen ===
  function drawGrid() {
    const spacing = 40;
    ctx.strokeStyle = 'rgba(42, 51, 56, 0.5)';
    ctx.lineWidth = 1;
    
    for (let x = 0; x < canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    for (let y = 0; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  // === Drivetrain zeichnen ===
  function drawDrivetrain() {
    const cx = canvas.width * 0.3;
    const cy = canvas.height * 0.5;
    const scale = Math.min(canvas.width / 800, canvas.height / 700);
    
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    
    // === Chassis-Rahmen ===
    ctx.strokeStyle = '#b7472a';
    ctx.lineWidth = 3;
    ctx.strokeRect(-120, -250, 240, 500);
    
    // Rahmenlängsträger
    ctx.beginPath();
    ctx.moveTo(-120, -250);
    ctx.lineTo(-120, 250);
    ctx.moveTo(120, -250);
    ctx.lineTo(120, 250);
    ctx.stroke();
    
    // Querelemente
    ctx.strokeStyle = 'rgba(183, 71, 42, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-120, i * 70);
      ctx.lineTo(120, i * 70);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    
    // === Motor (2.0 TDI, längs) ===
    const engineX = 0;
    const engineY = -80;
    ctx.fillStyle = 'rgba(60, 120, 129, 0.3)';
    ctx.strokeStyle = '#3c7881';
    ctx.lineWidth = 2;
    ctx.fillRect(engineX - 60, engineY - 40, 120, 80);
    ctx.strokeRect(engineX - 60, engineY - 40, 120, 80);
    
    // Motorbeschriftung
    ctx.fillStyle = '#f3f1ea';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('2.0 TDI', engineX, engineY + 5);
    ctx.font = '11px Arial';
    ctx.fillStyle = '#c8c5ba';
    ctx.fillText('102 PS', engineX, engineY + 20);
    
    // === Getriebe ===
    const transX = 0;
    const transY = 20;
    ctx.fillStyle = 'rgba(214, 167, 70, 0.2)';
    ctx.strokeStyle = '#d6a746';
    ctx.lineWidth = 2;
    ctx.fillRect(transX - 40, transY - 30, 80, 60);
    ctx.strokeRect(transX - 40, transY - 30, 80, 60);
    
    ctx.fillStyle = '#f3f1ea';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('6-Gang', transX, transY + 5);
    
    // === Abgasanlage (links, seitlich) ===
    ctx.strokeStyle = '#c8c5ba';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-80, engineY);
    ctx.quadraticCurveTo(-100, engineY + 100, -100, 180);
    ctx.lineTo(-100, 220);
    ctx.stroke();
    
    // DPF
    ctx.fillStyle = 'rgba(183, 71, 42, 0.4)';
    ctx.strokeStyle = '#b7472a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-100, 120, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f3f1ea';
    ctx.font = '9px Arial';
    ctx.fillText('DPF', -100, 123);
    
    // === Differential (hinten) ===
    const diffX = 0;
    const diffY = 180;
    ctx.fillStyle = 'rgba(90, 105, 109, 0.4)';
    ctx.strokeStyle = '#5a696d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(diffX, diffY, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f3f1ea';
    ctx.font = '10px Arial';
    ctx.fillText('Diff', diffX, diffY + 4);
    
    // === Antriebswellen ===
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    // Front antrieb
    ctx.beginPath();
    ctx.moveTo(transX - 30, transY + 30);
    ctx.lineTo(-100, 250);
    ctx.stroke();
    // Rear antrieb
    ctx.beginPath();
    ctx.moveTo(transX + 30, transY + 30);
    ctx.lineTo(100, 250);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // === Batterien (hinten rechts) ===
    ctx.fillStyle = 'rgba(92, 184, 92, 0.2)';
    ctx.strokeStyle = '#5cb85c';
    ctx.lineWidth = 2;
    ctx.fillRect(80, 180, 40, 25);
    ctx.strokeRect(80, 180, 40, 25);
    ctx.fillStyle = '#f3f1ea';
    ctx.font = '9px Arial';
    ctx.fillText('Batterie', 100, 195);
    
    // === Kraftstofftank ===
    ctx.fillStyle = 'rgba(60, 120, 129, 0.2)';
    ctx.strokeStyle = '#3c7881';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(50, 200, 30, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
  }

  // === Partikel-System ===
  function updateAndDrawParticles() {
    const time = Date.now() / 1000;
    
    flowPaths.forEach((path, idx) => {
      const sensor = sensors[path.from];
      if (!sensor || sensor.notAvailable || sensor.liveValue === null) return;
      
      const status = getStatus(sensor.liveValue, sensor);
      
      // Neue Partikel erstellen
      if (Math.random() < 0.08) {
        particles.push({
          x: sensor.position.x,
          y: sensor.position.y,
          targetX: path.to.x,
          targetY: path.to.y,
          progress: 0,
          speed: 0.005 + Math.random() * 0.005,
          color: status === 'green' ? '#5cb85c' : status === 'yellow' ? '#f0ad4e' : '#d9534f',
          life: 1.0
        });
      }
      
      // Partikel aktualisieren
      particles = particles.filter(p => {
        p.progress += p.speed;
        p.x = (p.targetX - p.x) * p.progress + p.x;
        p.y = (p.targetY - p.y) * p.progress + p.y;
        p.life -= 0.003;
        
        return p.life > 0;
      });
    });
    
    // Partikel zeichnen
    ctx.save();
    const cx = canvas.width * 0.3;
    const cy = canvas.height * 0.5;
    const scale = Math.min(canvas.width / 800, canvas.height / 700);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    
    particles.forEach(p => {
      const px = p.x * 240 - 120;
      const py = p.y * 500 - 250;
      
      // Partikel leuchten
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, 8);
      gradient.addColorStop(0, p.color + 'ff');
      gradient.addColorStop(1, p.color + '00');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = p.life * 0.6;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      
      // Kern
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    
    ctx.restore();
  }

  // === Sensor-Marker zeichnen ===
  function drawSensorMarkers() {
    const cx = canvas.width * 0.3;
    const cy = canvas.height * 0.5;
    const scale = Math.min(canvas.width / 800, canvas.height / 700);
    const time = Date.now() / 1000;
    
    Object.keys(sensors).forEach(key => {
      const sensor = sensors[key];
      const status = getStatus(sensor.liveValue, sensor);
      
      // Puls-Frequenz basierend auf Status
      const pulseFreq = status === 'red' ? 8 : status === 'yellow' ? 4 : 2;
      const pulsePhase = Math.sin(time * pulseFreq) * 0.3 + 0.7;
      
      ctx.save();
      ctx.translate(
        cx + sensor.position.x * 240 * scale - 120 * scale,
        cy + sensor.position.y * 500 * scale - 250 * scale
      );
      ctx.scale(scale, scale);
      
      // Äußerer Ring (pulsierend)
      ctx.strokeStyle = status === 'green' ? '#5cb85c' :
                        status === 'yellow' ? '#f0ad4e' :
                        status === 'red' ? '#d9534f' : '#5a696d';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3 * pulsePhase;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.stroke();
      
      // Mittlerer Ring
      ctx.globalAlpha = 0.6 * pulsePhase;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.stroke();
      
      // Innerer Kreis
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = status === 'green' ? '#5cb85c' :
                      status === 'yellow' ? '#f0ad4e' :
                      status === 'red' ? '#d9534f' : '#5a696d';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      
      // Status-Indikator (Punkt in der Mitte)
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      
      // Label
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#f3f1ea';
      ctx.font = '9px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(sensor.name, 0, -22);
      
      ctx.restore();
    });
  }

  // === Maus-Events ===
  function handleMouseMove(event) {
    if (!isVisible) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    let found = false;
    
    Object.keys(sensors).forEach(key => {
      const sensor = sensors[key];
      const cx = canvas.width * 0.3;
      const cy = canvas.height * 0.5;
      const scale = Math.min(canvas.width / 800, canvas.height / 700);
      
      const sensorX = cx + sensor.position.x * 240 * scale - 120 * scale;
      const sensorY = cy + sensor.position.y * 500 * scale - 250 * scale;
      
      const dist = Math.sqrt((x - sensorX) ** 2 + (y - sensorY) ** 2);
      
      if (dist < 20) {
        showTooltip(event.clientX, event.clientY, sensor);
        canvas.style.cursor = 'pointer';
        found = true;
      }
    });
    
    if (!found) {
      hideTooltip();
      canvas.style.cursor = 'default';
    }
  }

  function handleCanvasClick(event) {
    if (!isVisible) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    Object.keys(sensors).forEach(key => {
      const sensor = sensors[key];
      const cx = canvas.width * 0.3;
      const cy = canvas.height * 0.5;
      const scale = Math.min(canvas.width / 800, canvas.height / 700);
      
      const sensorX = cx + sensor.position.x * 240 * scale - 120 * scale;
      const sensorY = cy + sensor.position.y * 500 * scale - 250 * scale;
      
      const dist = Math.sqrt((x - sensorX) ** 2 + (y - sensorY) ** 2);
      
      if (dist < 20) {
        showTooltip(event.clientX, event.clientY, sensor, true);
      }
    });
  }

  function showTooltip(x, y, sensor, detailed = false) {
    const tooltip = document.getElementById('drivetrain-tooltip');
    if (!tooltip) return;
    
    const status = getStatus(sensor.liveValue, sensor);
    const statusText = status === 'green' ? 'Normal' :
                       status === 'yellow' ? 'Warnung' :
                       status === 'red' ? 'Fehler' : 'Keine Daten';
    
    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(x + 15, window.innerWidth - 300) + 'px';
    tooltip.style.top = Math.min(y + 15, window.innerHeight - 150) + 'px';
    
    document.getElementById('tooltip-title').textContent = sensor.name;
    
    let content = '';
    if (sensor.notAvailable) {
      content = `<div style="color:#888;">Nicht verfügbar / Sensor nicht installiert</div>`;
    } else {
      const value = sensor.liveValue;
      content = `
        <div><strong>Messwert:</strong> ${value.toFixed(1)} ${sensor.unit}</div>
        <div><strong>Status:</strong> <span style="color:${status === 'green' ? '#5cb85c' : status === 'yellow' ? '#f0ad4e' : '#d9534f'}">${statusText}</span></div>
        <div><strong>Normalbereich:</strong> ${sensor.min}-${sensor.max} ${sensor.unit}</div>
        ${detailed ? `<div style="margin-top:6px;font-size:10px;color:#888;">${sensor.tooltip}</div>` : ''}
      `;
    }
    
    document.getElementById('tooltip-content').innerHTML = content;
  }

  function hideTooltip() {
    const tooltip = document.getElementById('drivetrain-tooltip');
    if (tooltip) tooltip.style.display = 'none';
  }

  // === Tab-Wechsel erkennen ===
  window.addEventListener('storage', () => {});
  window.addEventListener('hashchange', () => {
    checkActiveTab();
  });

  function checkActiveTab() {
    const activeTab = document.querySelector('.tabpane.active');
    if (activeTab) {
      currentTab = activeTab.id.replace('tab-', '');
      isVisible = currentTab === 'antrieb';
    }
  }

  // === Initialisierung bei DOM-Ready ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrivetrain);
  } else {
    initDrivetrain();
  }

  // Periodisch Status aktualisieren
  setInterval(() => {
    if (!isVisible) return;
    
    // Demo-Modus: Zufällige Schwankungen
    if (demoMode) {
      if (sensors.coolant.liveValue !== null) {
        sensors.coolant.liveValue += (Math.random() - 0.5) * 2;
        sensors.coolant.liveValue = Math.max(85, Math.min(98, sensors.coolant.liveValue));
      }
      if (sensors.rpm.liveValue !== null) {
        sensors.rpm.liveValue += (Math.random() - 0.5) * 50;
        sensors.rpm.liveValue = Math.max(750, Math.min(900, sensors.rpm.liveValue));
      }
      if (sensors.voltage.liveValue !== null) {
        sensors.voltage.liveValue += (Math.random() - 0.5) * 0.1;
        sensors.voltage.liveValue = Math.max(14.0, Math.min(14.5, sensors.voltage.liveValue));
      }
      if (sensors.exhaustTemp.liveValue !== null) {
        sensors.exhaustTemp.liveValue += (Math.random() - 0.5) * 20;
        sensors.exhaustTemp.liveValue = Math.max(350, Math.min(420, sensors.exhaustTemp.liveValue));
      }
    }
  }, 2000);

})();
