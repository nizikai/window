async function loadThreeModule() {
  const urls = [
    'https://unpkg.com/three@0.160.0/build/three.module.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
  ];

  for (const url of urls) {
    try {
      return await import(url);
    } catch (err) {
      // Try next CDN.
    }
  }
  return null;
}

function bootFallbackCanvas() {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
  let themeBlend = 0, themeTarget = 0;
  let wallProgress = 0;
  let isSceneVisible = true;

  function lerpC(a, b, t) { return Math.round(a + (b - a) * t); }
  const vertices = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rotatePoint([x, y, z], rx, ry, rz) {
    let px = x;
    let py = y;
    let pz = z;

    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    let y1 = py * cx - pz * sx;
    let z1 = py * sx + pz * cx;
    py = y1; pz = z1;

    let x2 = px * cy + pz * sy;
    let z2 = -px * sy + pz * cy;
    px = x2; pz = z2;

    let x3 = px * cz - py * sz;
    let y3 = px * sz + py * cz;
    return [x3, y3, pz];
  }

  function project([x, y, z], scale, camZ, cx, cy) {
    const depth = camZ - z;
    const f = scale / Math.max(0.2, depth);
    return [cx + x * f, cy + y * f];
  }

  function draw() {
    requestAnimationFrame(draw);
    
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = performance.now() * 0.001;

    // Crossfade theme colours
    if (Math.abs(themeBlend - themeTarget) > 0.001) themeBlend += (themeTarget - themeBlend) * 0.12;

    const tb = themeBlend;
    ctx.fillStyle = `rgb(${lerpC(5,18,tb)},${lerpC(9,5,tb)},${lerpC(23,29,tb)})`;
    ctx.fillRect(0, 0, w, h);

    const centerX = w * 0.5;
    const centerY = h * 0.5;
    const scale = Math.min(w, h) * 0.95;
    const camZ = 5.2;
    const rx = t * 0.9;
    const wallInfluence = -wallProgress * 0.13;
    const ry = t * 1.1 + wallInfluence;
    const rz = t * 0.6;

    const rotated = vertices.map((v) => rotatePoint(v, rx, ry, rz));
    const projected = rotated.map((v) => project(v, scale, camZ, centerX, centerY));

    ctx.strokeStyle = `rgb(${lerpC(65,224,tb)},${lerpC(236,178,tb)},${lerpC(255,255,tb)})`;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = `rgba(${lerpC(65,224,tb)},${lerpC(236,178,tb)},255,0.75)`;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    for (const [a, b] of edges) {
      ctx.moveTo(projected[a][0], projected[a][1]);
      ctx.lineTo(projected[b][0], projected[b][1]);
    }
    ctx.stroke();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('v2-wall-flip', (evt) => {
    themeTarget = Boolean(evt?.detail?.flipped) ? 1 : 0;
  });
  window.addEventListener('v2-wall-motion', (evt) => {
    const nextProgress = Number(evt?.detail?.progress);
    if (Number.isFinite(nextProgress)) {
      wallProgress = clamp(nextProgress, 0, 1);
    }
  });

  resize();
  draw();
}

function bootScene(THREE) {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: false, // Disable for better performance
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false // Disable alpha for better performance
    });
  } catch (err) {
    bootFallbackCanvas();
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050917);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 4.2;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1)); // Reduce to 1x for max performance

  const cubeGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  const cubeMat = new THREE.MeshPhongMaterial({
    color: 0x12d8ff,
    transparent: true,
    opacity: 0.72,
    shininess: 95,
    specular: 0xffffff,
    emissive: 0x0c3c48,
    emissiveIntensity: 0.35
  });
  const cube = new THREE.Mesh(cubeGeo, cubeMat);
  scene.add(cube);

  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x12d8ff,
    transparent: true,
    opacity: 1
  });
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cubeGeo), edgeMat));

  scene.add(new THREE.AmbientLight(0x404466, 0.65));
  const keyLight = new THREE.PointLight(0x12d8ff, 2.2, 20);
  keyLight.position.set(2.2, 2.1, 3.2);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x7a3df0, 1.1, 18);
  fillLight.position.set(-2.2, -1.4, 2.2);
  scene.add(fillLight);
  scene.add(new THREE.HemisphereLight(0xc2eeff, 0x1a1e2f, 0.55));

  // Front / back theme colour tables for smooth crossfade
  const FRONT = {
    bg:      new THREE.Color(0x050917),
    cube:    new THREE.Color(0x12d8ff),
    emissive:new THREE.Color(0x0c3c48),
    edge:    new THREE.Color(0x12d8ff),
    key:     new THREE.Color(0x12d8ff),
    fill:    new THREE.Color(0x7a3df0)
  };
  const BACK = {
    bg:      new THREE.Color(0x12051d),
    cube:    new THREE.Color(0xba6dff),
    emissive:new THREE.Color(0x3a1e56),
    edge:    new THREE.Color(0xcf90ff),
    key:     new THREE.Color(0xbd7cff),
    fill:    new THREE.Color(0x2ad8ff)
  };
  let themeBlend = 0, themeTarget = 0;

  function applyBlend(t) {
    cubeMat.color.lerpColors(FRONT.cube, BACK.cube, t);
    cubeMat.emissive.lerpColors(FRONT.emissive, BACK.emissive, t);
    edgeMat.color.lerpColors(FRONT.edge, BACK.edge, t);
    scene.background.lerpColors(FRONT.bg, BACK.bg, t);
    keyLight.color.lerpColors(FRONT.key, BACK.key, t);
    fillLight.color.lerpColors(FRONT.fill, BACK.fill, t);
  }

  window.addEventListener('v2-wall-flip', (evt) => {
    themeTarget = Boolean(evt?.detail?.flipped) ? 1 : 0;
    needsRender = true;
  }, { passive: true });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize, { passive: true });

  let lookAtX = 0;
  let lookAtY = 0;
  let currentLookX = 0;
  let currentLookY = 0;
  let wallYawTarget = 0;
  let wallYawCurrent = 0;
  const BASE_ROT_X = -0.28;
  const BASE_ROT_Y = 0.42;
  const BASE_ROT_Z = -0.03;
  const WALL_SCROLL_YAW_MULTIPLIER = 0.14;

  const SMOOTH = 0.08;
  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  
  // Performance: cache last rotation values to avoid unnecessary updates
  let lastRotX = 0;
  let lastRotY = 0;
  let lastRotZ = 0;
  const ROT_THRESHOLD = 0.0001; // Only update if change is significant
  let needsRender = true;
  let frameSkip = 0;
  let isSceneVisible = true; // Track if scene is visible through the wall cutout
  let currentWallRotation = 0;

  window.addEventListener('v2-wall-motion', (evt) => {
    const rotateYDeg = Number(evt?.detail?.rotateYDeg);
    if (!Number.isFinite(rotateYDeg)) return;
    const turnProgress = clamp(rotateYDeg / -180, 0, 1);
    wallYawTarget = -turnProgress * WALL_SCROLL_YAW_MULTIPLIER;
    currentWallRotation = rotateYDeg;
    
    // Scene is always visible - removed visibility check for smoother experience
    isSceneVisible = true;
    
    needsRender = true;
  }, { passive: true });

  document.addEventListener('mousemove', (e) => {
    const nx = clamp((e.clientX / window.innerWidth - 0.5) * 2, -1.2, 1.2);
    const ny = clamp((e.clientY / window.innerHeight - 0.5) * 2, -1.2, 1.2);
    lookAtY = nx * 0.15;
    lookAtX = ny * 0.15;
    if (isSceneVisible) needsRender = true;
  }, { passive: true });

  // Gyro tilt on mobile — driven by app.js via v2-look-update event.
  // detail.y = -deltaGamma / RANGE (left/right tilt) → cube Y rotation
  // detail.x = deltaBeta / RANGE (forward/back tilt) → cube X rotation
  window.addEventListener('v2-look-update', (e) => {
    lookAtY = e.detail.y * 0.15;
    lookAtX = e.detail.x * 0.15;
    if (isSceneVisible) needsRender = true;
  }, { passive: true });

  function tick() {
    requestAnimationFrame(tick);
    
    // Skip every other frame for better performance
    frameSkip++;
    if (frameSkip % 2 !== 0 && !needsRender) return;

    // Crossfade theme colours when wall flip fires
    if (Math.abs(themeBlend - themeTarget) > 0.001) {
      themeBlend = lerp(themeBlend, themeTarget, 0.12);
      applyBlend(themeBlend);
      needsRender = true;
    }

    currentLookX = lerp(currentLookX, lookAtX, SMOOTH);
    currentLookY = lerp(currentLookY, lookAtY, SMOOTH);
    wallYawCurrent = lerp(wallYawCurrent, wallYawTarget, SMOOTH * 0.7);
    
    const newRotX = BASE_ROT_X + currentLookX + wallYawCurrent * 0.16;
    const newRotY = BASE_ROT_Y + currentLookY + wallYawCurrent;
    const newRotZ = BASE_ROT_Z + currentLookY * -0.08 + currentLookX * 0.04;
    
    // Only update rotation if change is significant (dirty flag optimization)
    const rotChanged = Math.abs(newRotX - lastRotX) > ROT_THRESHOLD ||
                       Math.abs(newRotY - lastRotY) > ROT_THRESHOLD ||
                       Math.abs(newRotZ - lastRotZ) > ROT_THRESHOLD;
    
    if (rotChanged) {
      cube.rotation.x = newRotX;
      cube.rotation.y = newRotY;
      cube.rotation.z = newRotZ;
      lastRotX = newRotX;
      lastRotY = newRotY;
      lastRotZ = newRotZ;
      needsRender = true;
    }

    // Only render if something changed
    if (needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }

  applyBlend(0);
  resize();
  tick();
}

loadThreeModule().then((THREE) => {
  if (!THREE) {
    bootFallbackCanvas();
    return;
  }
  bootScene(THREE);
});
