// Parallax Flip Window — static cube + tilting/flipping card frame

(function () {
  'use strict';

  // ==========================================
  // THREE.JS — STATIC SCENE
  // ==========================================
  var canvas = document.getElementById('canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06091a);

  var camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  camera.position.z = 4;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  var cubeGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  var cubeMat = new THREE.MeshPhongMaterial({
    color: 0x00d4ff, transparent: true, opacity: 0.18, shininess: 80
  });
  var cube = new THREE.Mesh(cubeGeo, cubeMat);
  scene.add(cube);

  cube.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(cubeGeo),
    new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.9 })
  ));

  scene.add(new THREE.AmbientLight(0x444466, 0.6));
  var p1 = new THREE.PointLight(0x00d4ff, 1.5, 12); p1.position.set(2, 2, 3); scene.add(p1);
  var p2 = new THREE.PointLight(0xa855f7, 0.8, 10); p2.position.set(-2, -1, 2); scene.add(p2);

  // Theme swap (visual cue at flip midpoint)
  function setTheme(themeName) {
    if (themeName === 'back') {
      cubeMat.color.setHex(0xa855f7);
      cube.children[0].material.color.setHex(0xa855f7);
      scene.background.setHex(0x0a0518);
      p1.color.setHex(0xa855f7);
    } else {
      cubeMat.color.setHex(0x00d4ff);
      cube.children[0].material.color.setHex(0x00d4ff);
      scene.background.setHex(0x06091a);
      p1.color.setHex(0x00d4ff);
    }
  }

  // ==========================================
  // STATE
  // ==========================================
  var stage = document.querySelector('.stage');
  var card = document.querySelector('.card');
  var cardInner = document.querySelector('.card-inner');
  var sceneClip = document.querySelector('.scene-clip');

  var targetCubeX = 0, targetCubeY = 0;
  var currentCubeX = 0, currentCubeY = 0;
  var SMOOTH = 0.07;

  var flipDeg = 0;          // 0 → -180 during scroll
  var themeFlipped = false;
  var cursorActive = true;  // disabled during scroll flip

  // Tilt state (separate quickTos drive the card-inner CSS rotation)
  var qRX = null, qRY = null;
  var MAX_TILT = 8;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  // ==========================================
  // RESIZE
  // ==========================================
  function resize() {
    var rect = stage.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', function () {
    resize();
    if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
  });

  // ==========================================
  // CURSOR — tilts card only. Cube stays still.
  // ==========================================
  document.addEventListener('mousemove', function (e) {
    if (!cursorActive) return;
    var r = stage.getBoundingClientRect();
    var nx = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1.2, 1.2);
    var ny = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1.2, 1.2);

    // Card frame tilts
    if (qRX && qRY) {
      qRX(ny * MAX_TILT);
      qRY(-nx * MAX_TILT);
    }
  });

  // ==========================================
  // CLIP-PATH UPDATER — narrows scene-clip as card rotates
  // ==========================================
  function updateClipFromFlip() {
    var absDeg = Math.abs(flipDeg);
    if (absDeg >= 90) {
      sceneClip.style.opacity = '0';
      return;
    }
    sceneClip.style.opacity = '1';

    var rad = absDeg * Math.PI / 180;
    var widthRatio = Math.cos(rad);
    var insetPct = (1 - widthRatio) * 50;

    sceneClip.style.clipPath =
      'inset(0% ' + insetPct + '% 0% ' + insetPct + '% round 14px)';
  }

  // ==========================================
  // RENDER LOOP — cube is static, just render
  // ==========================================
  function tick() {
    requestAnimationFrame(tick);
    renderer.render(scene, camera);
  }

  // ==========================================
  // GSAP — TILT (cursor) + SCROLL (flip + expand)
  // ==========================================
  if (typeof gsap !== 'undefined') {
    qRX = gsap.quickTo(cardInner, 'rotateX', { duration: 0.4, ease: 'power2.out' });
    qRY = gsap.quickTo(cardInner, 'rotateY', { duration: 0.4, ease: 'power2.out' });
  }

  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: '.component-container',
        pin: true,
        scrub: 1,
        start: 'top top',
        end: function () { return '+=' + Math.round(window.innerHeight * 2.5); },
        invalidateOnRefresh: true,
        onUpdate: function (self) {
          // Disable cursor parallax while scroll animation is active (anything > 0 progress)
          var newCursorActive = self.progress === 0;
          if (newCursorActive !== cursorActive) {
            cursorActive = newCursorActive;
            if (!cursorActive) {
              targetCubeX = 0; targetCubeY = 0;
              if (qRX) qRX(0);
              if (qRY) qRY(0);
            }
          }

          // Track card flip angle for clip-path
          flipDeg = -180 * self.progress;
          updateClipFromFlip();

          // Theme swap at midpoint
          if (self.progress >= 0.5 && !themeFlipped) {
            themeFlipped = true;
            setTheme('back');
          } else if (self.progress < 0.5 && themeFlipped) {
            themeFlipped = false;
            setTheme('front');
          }
        }
      }
    });

    // Card flips 180°
    tl.to(card, { rotateY: -180, duration: 0.72, ease: 'power3.inOut' }, 0);

    // Wobble during flip
    tl.to(card, { rotateX: -8, rotateZ: -0.6, duration: 0.36, ease: 'power2.inOut' }, 0);
    tl.to(card, { rotateX: 0, rotateZ: 0, duration: 0.36, ease: 'power2.inOut' }, 0.36);

    // Expand stage to fullscreen alongside the flip
    tl.to(stage, {
      width: '100vw', height: '100vh',
      duration: 0.72, ease: 'power3.inOut',
      onStart: function () { stage.style.aspectRatio = 'auto'; },
      onReverseComplete: function () { stage.style.aspectRatio = '16 / 9'; }
    }, 0);

    // Border-radius stays 14 through flip, drops to 0 only at the end
    tl.to([sceneClip, card.querySelectorAll('.card-face')], {
      borderRadius: '14px', duration: 0.6, ease: 'power3.inOut'
    }, 0);
    tl.to([sceneClip, card.querySelectorAll('.card-face')], {
      borderRadius: '0px', duration: 0.1, ease: 'none'
    }, 0.7);

    // Drop frame styling at the end
    tl.to(card.querySelectorAll('.card-face'), {
      borderWidth: '0px', boxShadow: 'none', duration: 0.72, ease: 'power3.inOut'
    }, 0);

    // Fade HUD during flip
    tl.to(card.querySelectorAll('.frame-corner, .scan-line'), {
      opacity: 0, duration: 0.24, ease: 'none'
    }, 0.36);

    // Scroll indicator hide
    var indicator = document.querySelector('.scroll-indicator');
    if (indicator) {
      window.addEventListener('scroll', function check() {
        if (window.scrollY > window.innerHeight * 0.05) {
          gsap.to(indicator, { opacity: 0, duration: 0.3, onComplete: function () { indicator.style.display = 'none'; } });
          window.removeEventListener('scroll', check);
        }
      });
    }
  }

  // Boot
  resize();
  tick();
})();
