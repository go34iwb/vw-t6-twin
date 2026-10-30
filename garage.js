(() => {
  let active = false;
  let initialized = false;
  let failed = false;
  let paused = false;
  let frame = 0;
  let phase = 0;
  let previousTime = 0;
  let renderer, scene, camera, controls;
  let energyGroup, informationGroup;
  const flowVisibility = {'energy-flow': true, 'information-flow': true};
  let diagnosticComponents = new Set();
  const bodyMaterials = [];
  const glassMaterials = [];
  const particles = [];
  const hotspots = new Map();
  const stage = document.getElementById('garage-stage');
  const status = document.getElementById('garage-status');

  function render() {
    if (initialized && active && !failed) renderer.render(scene, camera);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  }
  function tick(time) {
    frame = 0;
    if (!active || document.hidden || paused || failed) return;
    const delta = previousTime ? Math.min((time - previousTime) / 1000, .1) : 0;
    previousTime = time;
    phase = (phase + delta * .18) % 1;
    particles.forEach(({mesh, curve, offset}) => mesh.position.copy(curve.getPointAt((phase + offset) % 1)));
    hotspots.forEach(hotspot => {
      hotspot.scale.setScalar(1 + Math.sin(time / 440) * .16);
    });
    render();
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    render();
    if (initialized && active && !document.hidden && !paused && !failed && !frame) frame = requestAnimationFrame(tick);
  }
  function showError(message, error) {
    failed = true;
    stop();
    status.hidden = false;
    status.textContent = message;
    console.error(message, error || '');
    document.querySelectorAll('.garage-toolbar button').forEach(button => button.disabled = true);
  }
  function initialize() {
    if (initialized || failed) return;
    if (!window.THREE || !THREE.OrbitControls) {
      showError('3D-Bibliothek nicht verfügbar. Bitte Netzwerkverbindung prüfen; die Draufsicht im Cockpit bleibt nutzbar.');
      return;
    }
    try {
      renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    } catch (error) {
      showError('WebGL ist auf diesem Gerät nicht verfügbar. Nutze die Draufsicht im Cockpit.', error);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      showError('Die 3D-Grafikverbindung wurde unterbrochen. Lade die Seite neu oder nutze die Cockpit-Draufsicht.');
    });
    stage.append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
    camera.position.set(7.4, 5.2, -8.5);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = false;
    controls.minDistance = 4.5;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI / 2 - .03;
    controls.enablePan = false;
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => {
      document.querySelectorAll('[data-camera]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    });
    scene.add(new THREE.HemisphereLight(0xd4e4ff, 0x272b30, .7));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(3, 7, -5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88bbdb, .9);
    rim.position.set(-5, 3, 5);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.8, 96),
      new THREE.MeshBasicMaterial({color: 0x080b0f}));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.03;
    scene.add(floor);
    const grid = new THREE.GridHelper(10, 25, 0x343f49, 0x1c242b);
    grid.position.y = -.02;
    scene.add(grid);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.65, .009, 6, 100),
      new THREE.MeshBasicMaterial({color: 0x42f5ac, transparent: true, opacity: .35}));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .005;
    scene.add(ring);

    const bus = new THREE.Group();
    scene.add(bus);
    const paint = new THREE.MeshStandardMaterial({color: 0x82939f, metalness: .75, roughness: .3, transparent: true});
    const roofPaint = paint.clone();
    bodyMaterials.push(paint, roofPaint);
    const glass = new THREE.MeshStandardMaterial({color: 0x172633, metalness: .6, roughness: .12, transparent: true, opacity: .87, side: THREE.DoubleSide});
    glassMaterials.push(glass);
    const black = new THREE.MeshStandardMaterial({color: 0x0c1117, roughness: .8});
    const chrome = new THREE.MeshStandardMaterial({color: 0xb1bdc4, metalness: .9, roughness: .2});
    const metal = new THREE.MeshStandardMaterial({color: 0x465762, metalness: .7, roughness: .4});
    const seatMaterial = new THREE.MeshStandardMaterial({color: 0x273646, roughness: .9});
    const green = new THREE.MeshStandardMaterial({color: 0x164a38, emissive: 0x123427, roughness: .5});
    const yellow = new THREE.MeshStandardMaterial({color: 0x6a5824, emissive: 0x302505, roughness: .5});
    function box(width, height, depth, x, y, z, material, parent = bus) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }
    function roundedBody(width, height, length, y, z, material) {
      const x = -width / 2, bottom = -height / 2, radius = .1;
      const shape = new THREE.Shape();
      shape.moveTo(x + radius, bottom);
      shape.lineTo(-x - radius, bottom);
      shape.quadraticCurveTo(-x, bottom, -x, bottom + radius);
      shape.lineTo(-x, -bottom - radius);
      shape.quadraticCurveTo(-x, -bottom, -x - radius, -bottom);
      shape.lineTo(x + radius, -bottom);
      shape.quadraticCurveTo(x, -bottom, x, -bottom - radius);
      shape.lineTo(x, bottom + radius);
      shape.quadraticCurveTo(x, bottom, x + radius, bottom);
      const geometry = new THREE.ExtrudeGeometry(shape, {depth: length, bevelEnabled: false, steps: 1});
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, y, z - length / 2);
      bus.add(mesh);
      return mesh;
    }
    roundedBody(1.98, .67, 4.88, .89, 0, paint);
    // Extrude the van's side profile across its width to retain the short T6 nose.
    const profile = new THREE.Shape();
    profile.moveTo(-2.27, 1.18);
    profile.lineTo(-1.74, 2.02);
    profile.quadraticCurveTo(-1.63, 2.17, -1.45, 2.18);
    profile.lineTo(2.22, 2.18);
    profile.quadraticCurveTo(2.4, 2.16, 2.42, 1.98);
    profile.lineTo(2.42, 1.18);
    profile.closePath();
    const upperGeometry = new THREE.ExtrudeGeometry(profile, {depth: 1.94, bevelEnabled: false});
    upperGeometry.rotateY(-Math.PI / 2);
    upperGeometry.translate(.97, 0, 0);
    bus.add(new THREE.Mesh(upperGeometry, paint));
    roundedBody(1.95, .08, 3.8, 2.18, .38, roofPaint);
    box(1.8, .09, 4.5, 0, .76, 0, black);
    box(1.5, .08, 3.8, 0, .56, 0, metal);
    const windshield = box(1.75, .82, .025, 0, 1.65, -1.99, glass);
    windshield.rotation.x = .56;
    box(1.72, .66, .025, 0, 1.72, 2.445, glass);
    [-1, 1].forEach(side => {
      [-1.2, -.14, .93, 1.84].forEach((z, index) => {
        box(.026, .67, index === 0 ? .77 : .88, side * .985, 1.71, z, glass);
      });
      box(.035, .028, 4.4, side * 1.005, 1.29, .03, chrome);
      box(.05, .07, .21, side * 1.012, 1.2, -1.05, black);
      box(.05, .07, .24, side * 1.012, 1.2, .17, black);
      box(.028, .42, .024, side * 1.003, .99, -.62, black);
      box(.028, .42, .024, side * 1.003, .99, 1.45, black);
      box(.17, .06, .09, side * 1.07, 1.46, -1.58, black);
      box(.17, .26, .28, side * 1.17, 1.53, -1.57, paint);
      [-1.57, 1.58].forEach(z => {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(.46, .46, .25, 40), black);
        tire.rotation.z = Math.PI / 2;
        tire.position.set(side * 1.02, .47, z);
        bus.add(tire);
        const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .265, 32), chrome);
        rimMesh.rotation.z = Math.PI / 2;
        rimMesh.position.copy(tire.position);
        bus.add(rimMesh);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .28, 20), black);
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(tire.position);
        bus.add(hub);
        for (let spoke = 0; spoke < 5; spoke++) {
          const angle = spoke * Math.PI * 2 / 5;
          const slot = box(.015, .07, .16, side * 1.16, .47 + Math.cos(angle) * .17, z + Math.sin(angle) * .17, black);
          slot.rotation.x = -angle;
        }
        const arch = new THREE.Mesh(new THREE.TorusGeometry(.49, .035, 8, 40, Math.PI), black);
        arch.rotation.y = Math.PI / 2;
        arch.position.set(side * 1.01, .47, z);
        bus.add(arch);
      });
    });
    box(1.85, .19, .09, 0, .68, -2.47, black);
    box(1.3, .26, .045, 0, .99, -2.47, black);
    [.91, .99, 1.07].forEach(y => box(1.25, .018, .05, 0, y, -2.5, chrome));
    const lightMaterial = new THREE.MeshStandardMaterial({color: 0xe7f5ff, emissive: 0xb3d8ee, emissiveIntensity: 1.5});
    [-.75, .75].forEach(x => {
      box(.36, .17, .05, x, 1.09, -2.47, lightMaterial);
      box(.3, .025, .055, x, 1.025, -2.505, lightMaterial);
      box(.1, .42, .035, x * 1.2, 1.16, 2.46,
        new THREE.MeshStandardMaterial({color: 0x992535, emissive: 0x731124}));
    });
    const badge = new THREE.Mesh(new THREE.TorusGeometry(.09, .013, 8, 24), chrome);
    badge.position.set(0, 1.02, -2.535);
    bus.add(badge);
    box(.42, .11, .035, 0, .77, -2.53, chrome);
    box(1.85, .15, .09, 0, .66, 2.46, black);
    let seatCount = 0;
    function seat(x, z) {
      const group = new THREE.Group();
      group.name = 'passenger-seat-' + (++seatCount);
      bus.add(group);
      box(.47, .14, .52, x, .96, z, seatMaterial, group);
      const back = box(.47, .58, .14, x, 1.27, z + .22, seatMaterial, group);
      back.rotation.x = -.08;
      box(.29, .21, .13, x, 1.67, z + .25, seatMaterial, group);
      box(.035, .21, .035, x - .085, 1.5, z + .25, chrome, group);
      box(.035, .21, .035, x + .085, 1.5, z + .25, chrome, group);
      box(.28, .13, .3, x, .84, z, black, group);
    }
    [-.49, .49].forEach(x => seat(x, -1.01));
    [.36, 1.42].forEach(z => [-.61, 0, .61].forEach(x => seat(x, z)));
    renderer.domElement.dataset.seats = String(seatCount);
    box(1.7, .15, .29, 0, 1.27, -1.64, black);
    const steering = new THREE.Mesh(new THREE.TorusGeometry(.17, .025, 8, 28), black);
    steering.rotation.x = -.45;
    steering.position.set(-.49, 1.4, -1.41);
    bus.add(steering);
    box(.76, .38, .57, -.12, .95, -1.98, metal);
    for (let i = 0; i < 4; i++) box(.07, .04, .42, -.37 + i * .16, 1.16, -1.98, chrome);
    box(.35, .27, .36, .49, .83, -1.8, metal);
    box(.52, .22, 1, -.3, .52, .56, green);
    box(.31, .22, .3, -.69, .99, -1.88, metal);
    box(.3, .08, .23, .54, .83, -.41, yellow);
    box(.25, .08, .22, .55, .84, .65, yellow);
    energyGroup = new THREE.Group();
    informationGroup = new THREE.Group();
    scene.add(energyGroup, informationGroup);
    function route(points, color, group) {
      const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)), false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, .018, 6, false),
        new THREE.MeshBasicMaterial({color, transparent: true, opacity: .45}));
      group.add(tube);
      for (let i = 0; i < 7; i++) {
        const particle = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 8), new THREE.MeshBasicMaterial({color}));
        group.add(particle);
        particle.position.copy(curve.getPointAt(i / 7));
        particles.push({mesh: particle, curve, offset: i / 7});
      }
    }
    route([[-.3,.58,.9],[-.69,.64,.3],[-.69,.68,-1.3],[-.12,1.2,-1.98]],0x42f5ac,energyGroup);
    route([[0,1.2,-1.98],[.48,.91,-1.8],[.6,.64,-1.57],[1.02,.52,-1.57]],0x42f5ac,energyGroup);
    route([[.48,.91,-1.8],[0,.64,-1.57],[-1.02,.52,-1.57]],0x42f5ac,energyGroup);
    route([[.1,1.24,-1.98],[.69,1.4,-1.6],[.69,1.32,-.43],[.54,1.1,.65],[1.27,1.1,1.4]],0xf5d547,informationGroup);
    const locations = {
      engine: [-.12,1.17,-1.98], transmission: [.5,.98,-1.8], cooling: [0,1.05,-2.27],
      electrical: [-.69,1.1,-1.88], fuel: [-.3,.64,.56], exhaust: [.5,.58,1.94]
    };
    Object.entries(locations).forEach(([component, position]) => {
      const halo = new THREE.Mesh(new THREE.SphereGeometry(component === 'fuel' ? .47 : .33, 24, 16),
        new THREE.MeshBasicMaterial({color: 0xff4b64, transparent: true, opacity: .22, depthTest: false, depthWrite: false}));
      halo.position.set(...position);
      halo.renderOrder = 10;
      halo.visible = diagnosticComponents.has(component);
      scene.add(halo);
      hotspots.set(component, halo);
      const ringGeometry = new THREE.EdgesGeometry(new THREE.SphereGeometry(.12, 10, 6));
      const marker = new THREE.LineSegments(ringGeometry, new THREE.LineBasicMaterial({color: 0xff4b64, transparent: true, opacity: .8, depthTest: false}));
      halo.add(marker);
    });
    initialized = true;
    energyGroup.visible = flowVisibility['energy-flow'];
    informationGroup.visible = flowVisibility['information-flow'];
    status.hidden = true;
    const observer = new ResizeObserver(() => {
      if (!active) return;
      const {width, height} = stage.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    });
    observer.observe(stage);
    controls.update();
  }
  document.querySelectorAll('[data-camera]').forEach(button => {
    button.addEventListener('click', () => {
      if (!initialized) return;
      const positions = {perspective: [7.4, 5.2, -8.5], top: [0, 10.5, .01], side: [9.5, 2.8, 0]};
      camera.position.set(...positions[button.dataset.camera]);
      controls.target.set(0, 1, 0);
      controls.update();
      document.querySelectorAll('[data-camera]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      render();
    });
  });
  document.getElementById('xray-toggle').addEventListener('click', event => {
    if (!initialized) return;
    const button = event.currentTarget;
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    bodyMaterials.forEach(material => {
      material.opacity = enabled ? .1 : 1;
      material.depthWrite = !enabled;
    });
    glassMaterials.forEach(material => {
      material.opacity = enabled ? .1 : .87;
      material.depthWrite = !enabled;
    });
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else schedule();
  });
  window.TwinGarage = {
    setActive(value) {
      active = value;
      if (active) {
        initialize();
        schedule();
      } else stop();
    },
    setPaused(value) {
      paused = value;
      if (paused) stop();
      schedule();
    },
    setFlow(layer, visible) {
      flowVisibility[layer] = visible;
      if (initialized) {
        (layer === 'energy-flow' ? energyGroup : informationGroup).visible = visible;
        render();
      }
    },
    setDiagnostics(components) {
      diagnosticComponents = new Set(components);
      hotspots.forEach((hotspot, component) => hotspot.visible = components.has(component));
      render();
    }
  };
})();
