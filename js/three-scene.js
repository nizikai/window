/**
 * ThreeScene Module
 * 
 * Creates a Three.js WebGL scene inside the card's front face canvas.
 * Uses the same parallax-pivot architecture as the gyro-parallax reference:
 * camera orbits a pivot point, objects at different Z-depths shift at different rates.
 *
 * The key to perceived depth: LARGE Z-separation + camera orbit = objects at different
 * distances move at dramatically different speeds (parallax).
 */
var ThreeScene = (function () {
  'use strict';

  // --- Configuration ---
  // Tuned for maximum depth perception inside the card window
  var CONFIG = {
    fov: 50,              // Wider FOV = more perspective distortion = more depth
    distance: 3.0,        // Camera distance from pivot
    orbitX: 20,           // degrees — max vertical orbit (increased)
    orbitY: 14,           // degrees — max horizontal orbit (increased)
    pivotDepth: 1.5,      // Z position camera looks at (middle of the scene)
    smoothing: 0.08       // Lerp factor — slightly faster for responsiveness
  };

  // Layer Z-positions (huge spread for real parallax)
  var LAYERS = {
    bg: -8.0,       // Far background — barely moves
    midBack: -4.0,  // Mid-back elements
    mid: -1.5,      // Middle / pivot area
    midFront: 0.5,  // In front of pivot
    fg: 2.0         // Foreground — moves a LOT
  };

  // --- State ---
  var scene, camera, renderer;
  var canvas = null;
  var rafId = null;
  var isRunning = false;
  var currentOrbitX = 0;
  var currentOrbitY = 0;
  var mouseNormX = 0;
  var mouseNormY = 0;
  var clock = null;

  // --- Helpers ---

  function degToRad(deg) {
    return deg * Math.PI / 180;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Procedural nebula background shader
   */
  function createBgMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime;',
        'varying vec2 vUv;',
        '',
        'float hash(vec2 p) {',
        '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
        '}',
        '',
        'float noise(vec2 p) {',
        '  vec2 i = floor(p);',
        '  vec2 f = fract(p);',
        '  f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),',
        '             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);',
        '}',
        '',
        'float fbm(vec2 p) {',
        '  float v = 0.0, a = 0.5;',
        '  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }',
        '  return v;',
        '}',
        '',
        'void main() {',
        '  vec2 uv = vUv;',
        '  float t = uTime * 0.015;',
        '  vec3 col = vec3(0.015, 0.008, 0.035);',
        '  col += vec3(0.1, 0.015, 0.16) * smoothstep(0.3, 0.7, fbm(uv * 2.5 + t));',
        '  col += vec3(0.0, 0.05, 0.12) * smoothstep(0.35, 0.75, fbm(uv * 3.0 - t * 0.7 + 3.0));',
        '  col += vec3(0.0, 0.08, 0.14) * smoothstep(0.5, 0.0, length(uv - 0.5)) * 0.4;',
        '  float stars = 0.0;',
        '  for (float i = 0.0; i < 3.0; i++) {',
        '    vec2 su = uv * (15.0 + i * 12.0);',
        '    float s = smoothstep(0.97, 0.99, hash(floor(su)));',
        '    stars += s * (sin(uTime * (1.5 + hash(floor(su)+i)) * 2.0) * 0.3 + 0.7) * (0.3 + i * 0.15);',
        '  }',
        '  col += stars;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n'),
      side: THREE.FrontSide
    });
  }

  /**
   * Build all scene geometry across the Z-depth layers
   */
  function buildScene() {
    // ========================
    // BACKGROUND (z = -8) — barely moves when camera orbits
    // ========================
    var bgPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 9),
      createBgMaterial()
    );
    bgPlane.position.z = LAYERS.bg;
    scene.add(bgPlane);

    // ========================
    // MID-BACK (z = -4) — slow movement, creates separation from BG
    // ========================
    var midBackGroup = new THREE.Group();
    midBackGroup.position.z = LAYERS.midBack;

    // Large portal ring (outer)
    var outerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.44, 80),
      new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    );
    midBackGroup.add(outerRing);

    // Second ring slightly offset
    var ring2 = new THREE.Mesh(
      new THREE.RingGeometry(1.28, 1.31, 80),
      new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
    );
    midBackGroup.add(ring2);

    // Grid floor extending back
    var gridMat = new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.12 });
    for (var i = 0; i < 16; i++) {
      var angle = (i / 16) * Math.PI * 2;
      var pts = [
        new THREE.Vector3(0, -0.8, 0),
        new THREE.Vector3(Math.cos(angle) * 4, -0.8, Math.sin(angle) * 4 - 2)
      ];
      midBackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    // Concentric floor rings
    for (var r = 0.8; r <= 4; r += 0.8) {
      var ringPts = [];
      for (var j = 0; j <= 48; j++) {
        var a = (j / 48) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(Math.cos(a) * r, -0.8, Math.sin(a) * r - 2));
      }
      midBackGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ringPts),
        new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.06 })
      ));
    }

    scene.add(midBackGroup);

    // ========================
    // MIDDLE (z = -1.5) — pivot layer, moderate movement
    // ========================
    var midGroup = new THREE.Group();
    midGroup.position.z = LAYERS.mid;

    // Hexagonal frames
    for (var h = 0; h < 2; h++) {
      var hexPts = [];
      var hexR = 0.7 - h * 0.15;
      for (var v = 0; v <= 6; v++) {
        var ha = (v / 6) * Math.PI * 2 - Math.PI / 2;
        hexPts.push(new THREE.Vector3(Math.cos(ha) * hexR, Math.sin(ha) * hexR, h * -0.3));
      }
      midGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(hexPts),
        new THREE.LineBasicMaterial({ color: h === 0 ? 0x00d2ff : 0xa855f7, transparent: true, opacity: 0.3 - h * 0.1 })
      ));
    }

    // Data line accents
    var accentMat = new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.35 });
    var accents = [
      [[-1.2, 0.5], [-0.7, 0.5]], [[-1.2, 0.44], [-0.85, 0.44]],
      [[0.7, -0.4], [1.2, -0.4]], [[0.75, -0.46], [1.15, -0.46]],
      [[-0.9, -0.6], [-0.5, -0.6]], [[0.5, 0.6], [0.95, 0.6]]
    ];
    accents.forEach(function (pair) {
      var pts = [new THREE.Vector3(pair[0][0], pair[0][1], 0), new THREE.Vector3(pair[1][0], pair[1][1], 0)];
      midGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), accentMat));
    });

    // Small glowing dots at this depth
    var dotColors = [0x00d2ff, 0xa855f7, 0x00d2ff, 0xa855f7];
    var dotPositions = [[0.9, 0.3], [-0.8, -0.3], [0.4, -0.7], [-0.5, 0.7]];
    dotPositions.forEach(function (pos, idx) {
      var dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 12, 12),
        new THREE.MeshBasicMaterial({ color: dotColors[idx], transparent: true, opacity: 0.6 })
      );
      dot.position.set(pos[0], pos[1], 0);
      midGroup.add(dot);
    });

    scene.add(midGroup);

    // ========================
    // MID-FRONT (z = 0.5) — noticeable movement
    // ========================
    var midFrontGroup = new THREE.Group();
    midFrontGroup.position.z = LAYERS.midFront;

    // Floating cubes / data fragments at this depth
    var cubeMat = new THREE.MeshBasicMaterial({ color: 0x8888bb, transparent: true, opacity: 0.25, wireframe: true });
    var cubePositions = [
      [-0.9, 0.4, 0], [0.85, -0.3, 0.1], [-0.5, -0.5, -0.1],
      [0.6, 0.5, 0.05], [-0.3, 0.7, 0], [0.4, -0.6, 0.1],
      [-0.7, -0.1, 0.15], [0.9, 0.1, -0.05]
    ];
    cubePositions.forEach(function (pos) {
      var size = 0.03 + Math.random() * 0.04;
      var cube = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), cubeMat);
      cube.position.set(pos[0], pos[1], pos[2]);
      cube.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      midFrontGroup.add(cube);
    });

    scene.add(midFrontGroup);

    // ========================
    // FOREGROUND (z = 2.0) — moves FAST, creates strong parallax
    // ========================
    var fgGroup = new THREE.Group();
    fgGroup.position.z = LAYERS.fg;

    // Large floating particles close to camera
    var fgParticles = [
      { x: -0.7, y: 0.4, color: 0x00d2ff, size: 0.035 },
      { x: 0.8, y: 0.35, color: 0xa855f7, size: 0.03 },
      { x: -0.4, y: -0.5, color: 0x00d2ff, size: 0.025 },
      { x: 0.6, y: -0.4, color: 0xa855f7, size: 0.04 },
      { x: -0.9, y: -0.2, color: 0x00d2ff, size: 0.02 },
      { x: 0.3, y: 0.6, color: 0x00d2ff, size: 0.028 },
      { x: -0.2, y: 0.2, color: 0xa855f7, size: 0.022 },
      { x: 0.5, y: 0.0, color: 0x00d2ff, size: 0.032 }
    ];
    fgParticles.forEach(function (p) {
      var mesh = new THREE.Mesh(
        new THREE.SphereGeometry(p.size, 12, 12),
        new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.7 })
      );
      mesh.position.set(p.x, p.y, (Math.random() - 0.5) * 0.5);
      fgGroup.add(mesh);
    });

    // Light streaks in foreground
    var streakMat = new THREE.LineBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.5 });
    [
      [[-1.0, 0.25, 0.1], [-0.7, 0.27, 0.1]],
      [[0.6, -0.35, 0.05], [0.9, -0.33, 0.05]],
      [[-0.5, -0.55, 0.15], [-0.2, -0.53, 0.15]]
    ].forEach(function (pair) {
      var pts = pair.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
      fgGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), streakMat));
    });

    // Bright center glow (at pivot depth for focus)
    var glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.9 })
    );
    glow.position.set(0, 0, -LAYERS.fg + LAYERS.mid); // Place at pivot depth in world
    fgGroup.add(glow);

    var glowCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    glowCore.position.copy(glow.position);
    fgGroup.add(glowCore);

    scene.add(fgGroup);

    // Store references for animation
    scene.userData.bgPlane = bgPlane;
    scene.userData.midBackGroup = midBackGroup;
    scene.userData.midGroup = midGroup;
    scene.userData.midFrontGroup = midFrontGroup;
    scene.userData.fgGroup = fgGroup;
  }

  /**
   * Update camera position — orbit around pivot with lerp smoothing.
   * This is what creates the parallax: objects at different Z-depths
   * appear to shift by different amounts as the camera moves laterally.
   */
  function updateCamera() {
    var targetX = mouseNormY * degToRad(CONFIG.orbitX);
    var targetY = mouseNormX * degToRad(CONFIG.orbitY);

    currentOrbitX = lerp(currentOrbitX, targetX, CONFIG.smoothing);
    currentOrbitY = lerp(currentOrbitY, targetY, CONFIG.smoothing);

    // Spherical coordinates around pivot
    var pivotZ = -CONFIG.pivotDepth;
    camera.position.x = Math.sin(currentOrbitY) * CONFIG.distance;
    camera.position.y = Math.sin(currentOrbitX) * CONFIG.distance * 0.7;
    camera.position.z = Math.cos(currentOrbitY) * Math.cos(currentOrbitX) * CONFIG.distance;

    camera.lookAt(0, 0, pivotZ);
  }

  /**
   * Main render loop
   */
  function render() {
    if (!isRunning) return;
    rafId = requestAnimationFrame(render);

    var t = clock.getElapsedTime();

    updateCamera();

    // Animate BG shader
    var bgPlane = scene.userData.bgPlane;
    if (bgPlane && bgPlane.material.uniforms) {
      bgPlane.material.uniforms.uTime.value = t;
    }

    // Subtle float on foreground particles
    var fg = scene.userData.fgGroup;
    if (fg) {
      fg.children.forEach(function (child, i) {
        if (child.isMesh) {
          child.position.y += Math.sin(t * 0.6 + i * 1.5) * 0.00025;
          child.position.x += Math.cos(t * 0.4 + i * 1.1) * 0.0002;
        }
      });
    }

    // Slow rotation on midBack ring
    var midBack = scene.userData.midBackGroup;
    if (midBack && midBack.children[0]) {
      midBack.children[0].rotation.z += 0.0004;
      if (midBack.children[1]) midBack.children[1].rotation.z -= 0.0003;
    }

    // Rotate mid-front cubes
    var midFront = scene.userData.midFrontGroup;
    if (midFront) {
      midFront.children.forEach(function (child, i) {
        if (child.isMesh) {
          child.rotation.x += 0.003 + i * 0.0005;
          child.rotation.y += 0.002 + i * 0.0003;
        }
      });
    }

    renderer.render(scene, camera);
  }

  /**
   * Mouse handler
   */
  function onMouseMove(e) {
    if (!canvas) return;
    var card = canvas.closest('.card');
    if (!card) return;
    var rect = card.getBoundingClientRect();

    var expandedBound = 350;
    if (e.clientX < rect.left - expandedBound || e.clientX > rect.right + expandedBound ||
        e.clientY < rect.top - expandedBound || e.clientY > rect.bottom + expandedBound) {
      return;
    }

    mouseNormX = -((e.clientX - rect.left) / rect.width - 0.5) * 2;
    mouseNormY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }

  // --- Public API ---

  return {
    init: function () {
      canvas = document.getElementById('frontScene');
      if (!canvas || typeof THREE === 'undefined') {
        console.warn('ThreeScene: Canvas or THREE.js not available.');
        return;
      }

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x040610);

      camera = new THREE.PerspectiveCamera(CONFIG.fov, 16 / 9, 0.1, 100);
      camera.position.z = CONFIG.distance;

      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x040610, 1);

      this.resize();
      clock = new THREE.Clock();
      buildScene();
      document.addEventListener('mousemove', onMouseMove);
    },

    start: function () {
      if (isRunning) return;
      isRunning = true;
      if (clock) clock.start();
      render();
    },

    stop: function () {
      isRunning = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },

    resize: function () {
      if (!canvas || !renderer || !camera) return;
      var card = canvas.closest('.card');
      if (!card) return;
      var rect = card.getBoundingClientRect();
      var w = rect.width || 800;
      var h = rect.height || 450;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    destroy: function () {
      this.stop();
      document.removeEventListener('mousemove', onMouseMove);
      if (renderer) {
        renderer.dispose();
        renderer = null;
      }
      scene = null;
      camera = null;
      canvas = null;
    },

    resetOrbit: function () {
      mouseNormX = 0;
      mouseNormY = 0;
    }
  };
})();
