(function () {
  'use strict';

  var wall = document.querySelector('.wall');
  var scrollStage = document.querySelector('.scroll-stage');
  var pinSection = document.querySelector('.pin-section');
  var cutouts = document.querySelectorAll('.wall .wall-cutout');
  var sceneCanvas = document.getElementById('canvas');
  var rotatingCutout = document.querySelector('.wall .wall-front .wall-cutout');
  var whiteCover = document.querySelector('.white-cover');
  if (!wall || !scrollStage || !pinSection) return;

  var flipped = false;
  var lookTargetX = 0;
  var lookTargetY = 0;
  var lookCurrentX = 0;
  var lookCurrentY = 0;
  var isHoveringWall = false;
  var gyroActive = false;
  var gyroCalibBeta = null;
  var gyroCalibGamma = null;
  // Flip exactly at 90 degrees
  var FLIP_THRESHOLD = -90;
  
  // Performance optimization: cache last applied values
  var lastTransformString = '';
  var lastFlipState = null;
  var lastMotionEvent = null;
  var frameCount = 0;
  var maxCutoutScale = 1.545;

  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  function updateMaxCutoutScale() {
    if (!rotatingCutout) return;
    var baseW = rotatingCutout.offsetWidth;
    var baseH = rotatingCutout.offsetHeight;
    if (!baseW || !baseH) return;
    var coverScale = Math.max(window.innerWidth / baseW, window.innerHeight / baseH) * 1.02;
    // Desktop: keep 1.545 floor so the landscape cutout fully covers the viewport width.
    // Mobile: the tall 9:16 cutout grows too fast with that floor — let coverScale win
    // so the cutout only reaches full-viewport size near the end of the scroll.
    maxCutoutScale = window.innerWidth < 780
      ? coverScale
      : Math.max(1.545, coverScale);
  }

  function easeInOut(t) {
    // Extra smooth cubic easing with gentler flip transition
    if (t < 0.45) {
      return 4 * t * t * t;
    } else if (t > 0.55) {
      return 1 - Math.pow(-2 * t + 2, 3) / 2;
    } else {
      // Super smooth interpolation during flip (0.45 to 0.55)
      var flipT = (t - 0.45) / 0.1; // normalize to 0-1
      return 0.364 + flipT * 0.272; // linear through the flip zone
    }
  }

  function emitFlipState(nextFlipped) {
    if (flipped === nextFlipped) return;
    flipped = nextFlipped;
    // Only dispatch if state actually changed
    if (lastFlipState !== nextFlipped) {
      lastFlipState = nextFlipped;
      console.log('Flip event dispatched:', nextFlipped ? 'BACK' : 'FRONT');
      window.dispatchEvent(new CustomEvent('v2-wall-flip', { detail: { flipped: flipped } }));
    }
  }

  function emitWallMotion(progress, rotateYDeg, wallScale, effectiveRotateYDeg, isHovering) {
    // Throttle motion events - only emit every 2 frames to reduce overhead
    frameCount++;
    // Prevent frameCount overflow
    if (frameCount > 10000) frameCount = 0;
    
    if (frameCount % 2 !== 0) return;
    
    // Reuse object to reduce garbage collection
    if (!lastMotionEvent) {
      lastMotionEvent = {
        progress: 0,
        rotateYDeg: 0,
        effectiveRotateYDeg: 0,
        wallScale: 1,
        isHovering: false
      };
    }
    
    // Only dispatch if values changed significantly
    if (Math.abs(lastMotionEvent.progress - progress) > 0.001 ||
        Math.abs(lastMotionEvent.rotateYDeg - rotateYDeg) > 0.1) {
      lastMotionEvent.progress = Number(progress.toFixed(4));
      lastMotionEvent.rotateYDeg = Number(rotateYDeg.toFixed(3));
      lastMotionEvent.effectiveRotateYDeg = Number(effectiveRotateYDeg.toFixed(3));
      lastMotionEvent.wallScale = Number(wallScale.toFixed(4));
      lastMotionEvent.isHovering = Boolean(isHovering);
      
      window.dispatchEvent(new CustomEvent('v2-wall-motion', { detail: lastMotionEvent }));
    }
  }

  function isBackFaceVisible(rotateYDeg) {
    // Flip when rotation passes -90 degrees
    return rotateYDeg < FLIP_THRESHOLD;
  }

  function readProgress() {
    var travel = Math.max(1, scrollStage.offsetHeight - window.innerHeight);
    var top = scrollStage.getBoundingClientRect().top;
    return clamp(-top / travel, 0, 1);
  }

  function applyWallTransform(progress) {
    var e = easeInOut(progress);
    var baseRotateY = -180 * e; // Single 180-degree flip
    var rotateY = baseRotateY;
    var tilt = window.innerWidth < 780 ? 0.25 : 1;
    // Use sin(2π·progress) so tilt is 0 at the flip and reverses local sign across it.
    // After the wall's 180° Y-rotation, the sign reversal cancels in screen space,
    // producing a continuous visual tilt instead of an apparent snap at the flip.
    var rotateX = -Math.sin(progress * Math.PI * 2) * 8 * tilt;
    var rotateZ = -Math.sin(progress * Math.PI * 2) * 0.7 * tilt;
    var wallScale = 1;
    var verticalHover = progress >= 0.5 ? -lookCurrentX : lookCurrentX;
    var hoverTiltX = verticalHover * 5.8;
    var hoverTiltY = lookCurrentY * 8.5;
    var hoverTwist = lookCurrentY * (progress >= 0.5 ? 0.9 : -0.9);

    rotateX += hoverTiltX;
    rotateY += hoverTiltY;
    rotateZ += hoverTwist;

    // Cache transform string to avoid recreating it
    var transformString = 
      'rotateY(' + rotateY.toFixed(3) + 'deg) ' +
      'rotateX(' + rotateX.toFixed(3) + 'deg) ' +
      'rotateZ(' + rotateZ.toFixed(3) + 'deg)';
    
    // Only update if changed
    if (transformString !== lastTransformString) {
      wall.style.transform = transformString;
      lastTransformString = transformString;
    }

    // Scale cutout synchronized with rotation
    // Rotation goes from 0° to -180° based on eased progress
    // Initial: scale 0.5 (cutout is ~33vw wide)
    // Target: 102vw wide
    // Final scale needed: 102vw / 66vw = 1.545 (since base width is 66vw at scale 1)
    // Scale range: 0.5 to 1.545, so add (1.545 - 0.5) = 1.045
    var cutoutScale = 0.5 + (e * (maxCutoutScale - 0.5));
    var cutoutScaleStr = 'scale(' + cutoutScale.toFixed(4) + ')';
    for (var i = 0; i < cutouts.length; i++) {
      cutouts[i].style.transform = cutoutScaleStr;
    }

    // Clip the scene canvas to the rotating cutout's TRUE projected quadrilateral.
    // 1) Replicate CSS's matrix (rotateY * rotateX * rotateZ then perspective: 1350px) and
    //    transform the four cutout corners into screen-space points.
    // 2) Inflate the resulting quadrilateral by SCREEN_PAD pixels in screen space (NOT in
    //    local space — a local pad would be foreshortened by cos(rotateY) and vanish at
    //    high rotations, leaving the visible seam at the cutout edge).
    // The canvas itself never rotates — only its visible region changes — so Three.js's
    // camera and perspective are completely unaffected.
    if (sceneCanvas && rotatingCutout) {
      var cutoutBaseW = rotatingCutout.offsetWidth;
      var cutoutBaseH = rotatingCutout.offsetHeight;
      var hw = (cutoutBaseW * cutoutScale) * 0.5;
      var hh = (cutoutBaseH * cutoutScale) * 0.5;
      var vCx = window.innerWidth * 0.5;
      var vCy = pinSection.offsetHeight * 0.5;
      var PERSPECTIVE = 2500;
      var SCREEN_PAD = 6;

      // Border-radius in local 3D space (CSS clamp(18px,2vw,28px) scaled by cutout transform).
      var holeRadius = Math.min(28, Math.max(18, window.innerWidth * 0.02));
      var r = Math.min(holeRadius * cutoutScale, Math.min(hw, hh) * 0.45);

      var ryRad = rotateY * Math.PI / 180;
      var rxRad = rotateX * Math.PI / 180;
      var rzRad = rotateZ * Math.PI / 180;
      var cZ = Math.cos(rzRad), sZ = Math.sin(rzRad);
      var cX = Math.cos(rxRad), sX = Math.sin(rxRad);
      var cY = Math.cos(ryRad), sY = Math.sin(ryRad);

      // 16-point polygon: 4 pts per corner (arc endpoints + 2 intermediates at 30°/60°).
      // Each 90° arc is split into 3×30° segments — error ≤ r*(1−cos15°) ≈ 3.4%r,
      // always inside the 6px frame-stroke. CW order in screen space (y-down).
      // ra = r*sin(30°) = 0.5r,  rb = r*(1−cos(30°)) ≈ 0.134r
      var ra = r * 0.5, rb = r * 0.1339745962;
      var localX = [
        -hw+r,  -hw+ra, -hw+rb, -hw,    // TL arc: top-edge → left-edge
        -hw,    -hw+rb, -hw+ra, -hw+r,  // BL arc: left-edge → bottom-edge
         hw-r,   hw-ra,  hw-rb,  hw,    // BR arc: bottom-edge → right-edge
         hw,     hw-rb,  hw-ra,  hw-r   // TR arc: right-edge → top-edge
      ];
      var localY = [
        -hh,    -hh+rb, -hh+ra, -hh+r,  // TL arc
         hh-r,   hh-ra,  hh-rb,  hh,    // BL arc
         hh,     hh-rb,  hh-ra,  hh-r,  // BR arc
        -hh+r,  -hh+ra, -hh+rb, -hh     // TR arc
      ];
      var N = 16;

      var pSx = new Array(N);
      var pSy = new Array(N);
      var pcx = 0, pcy = 0;
      for (var ci = 0; ci < N; ci++) {
        var lx = localX[ci];
        var ly = localY[ci];
        var x = lx * cZ - ly * sZ;
        var y = lx * sZ + ly * cZ;
        var z = 0;
        var ny = y * cX - z * sX;
        var nz = y * sX + z * cX;
        y = ny; z = nz;
        var nx = x * cY + z * sY;
        nz = -x * sY + z * cY;
        x = nx; z = nz;
        var f = PERSPECTIVE / (PERSPECTIVE - z);
        pSx[ci] = vCx + x * f;
        pSy[ci] = vCy + y * f;
        pcx += pSx[ci];
        pcy += pSy[ci];
      }
      pcx /= N;
      pcy /= N;

      // Inflate each projected point outward from the centroid by SCREEN_PAD px (screen-space).
      var poly = 'polygon(';
      for (var pi = 0; pi < N; pi++) {
        var dxp = pSx[pi] - pcx;
        var dyp = pSy[pi] - pcy;
        var dist = Math.sqrt(dxp * dxp + dyp * dyp);
        var sx, sy;
        if (dist > 0.5) {
          sx = pSx[pi] + (dxp / dist) * SCREEN_PAD;
          sy = pSy[pi] + (dyp / dist) * SCREEN_PAD;
        } else {
          sx = pSx[pi];
          sy = pSy[pi];
        }
        poly += sx.toFixed(1) + 'px ' + sy.toFixed(1) + 'px';
        if (pi < N - 1) poly += ',';
      }
      poly += ')';
      sceneCanvas.style.clipPath = poly;

      // White cover: inverse path using the 8-point projected polygon (not inflated).
      // Winding direction flips after the 180° Y-rotation, so detect it dynamically.
      if (whiteCover) {
        var sa2 = 0;
        for (var si = 0; si < N; si++) {
          var sj = (si + 1) % N;
          sa2 += pSx[si] * pSy[sj] - pSx[sj] * pSy[si];
        }
        if (Math.abs(sa2) < 100) {
          whiteCover.style.clipPath = 'none';
        } else {
          var vw = window.innerWidth;
          var vh = pinSection.offsetHeight;
          // sa2 > 0 → CW → reverse points to make inner polygon CCW
          // sa2 < 0 → CCW → keep original order
          var innerPath = ' M' + pSx[0].toFixed(1) + ',' + pSy[0].toFixed(1);
          if (sa2 > 0) {
            for (var qi = N - 1; qi >= 1; qi--) {
              innerPath += ' L' + pSx[qi].toFixed(1) + ',' + pSy[qi].toFixed(1);
            }
          } else {
            for (var qi = 1; qi < N; qi++) {
              innerPath += ' L' + pSx[qi].toFixed(1) + ',' + pSy[qi].toFixed(1);
            }
          }
          innerPath += ' Z';
          whiteCover.style.clipPath = 'path("M0,0 H' + vw + ' V' + vh + ' H0 Z' + innerPath + '")';
        }
      }
    }

    // Flip detection should reflect the actual rendered rotation, including hover tilt.
    emitFlipState(isBackFaceVisible(rotateY));
    emitWallMotion(progress, baseRotateY, wallScale, rotateY, isHoveringWall);
  }

  var indicator = document.querySelector('.scroll-indicator');
  function updateFromScroll() {
    if (indicator && window.scrollY > window.innerHeight * 0.05) {
      indicator.style.opacity = '0';
      indicator.style.display = 'none';
    }
  }

  // FPS Counter
  var fpsCounter = document.querySelector('.fps-counter');
  var fpsValue = document.querySelector('.fps-value');
  var fpsFrames = 0;
  var fpsLastTime = performance.now();
  var fpsHistory = [];
  
  function updateFPS(currentTime) {
    fpsFrames++;
    var delta = currentTime - fpsLastTime;
    
    if (delta >= 1000) { // Update every second
      var fps = Math.round((fpsFrames * 1000) / delta);
      fpsHistory.push(fps);
      if (fpsHistory.length > 5) fpsHistory.shift(); // Keep last 5 samples
      
      var avgFps = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length);
      
      if (fpsValue) {
        fpsValue.textContent = avgFps;
        
        // Color coding
        fpsValue.classList.remove('warning', 'critical');
        if (avgFps < 30) {
          fpsValue.classList.add('critical');
        } else if (avgFps < 50) {
          fpsValue.classList.add('warning');
        }
      }
      
      fpsFrames = 0;
      fpsLastTime = currentTime;
    }
  }

  var currentProgress = readProgress();
  var lastAppliedProgress = -1;
  var lastAppliedLookX = 0;
  var lastAppliedLookY = 0;
  var frameCounter = 0;
  var cachedTarget = currentProgress;
  var lastFrameTime = performance.now();
  
  function tickWall(currentTime) {
    requestAnimationFrame(tickWall);
    
    // Update FPS counter
    updateFPS(currentTime);
    
    // Calculate delta time for frame-rate independent animation
    var deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
    
    // Clamp delta to prevent huge jumps if tab was backgrounded
    deltaTime = Math.min(deltaTime, 32); // max 32ms (30fps minimum)
    
    // Adjust smoothing based on frame time (60fps = 16.67ms)
    var smoothFactor = Math.min(deltaTime / 16.67, 2);
    
    frameCounter++;
    // Prevent overflow
    if (frameCounter > 10000) frameCounter = 0;
    
    // Only read scroll position every 3 frames to reduce layout thrashing
    if (frameCounter % 3 === 0) {
      cachedTarget = readProgress();
    }
    
    // Adaptive smoothing - slower near flip point for stability
    var distanceToFlip = Math.abs(currentProgress - 0.5);
    var adaptiveSmooth = distanceToFlip < 0.1 ? 0.08 : 0.14;
    
    currentProgress += (cachedTarget - currentProgress) * adaptiveSmooth * smoothFactor;
    
    if (!isHoveringWall && !gyroActive) {
      lookTargetX = 0;
      lookTargetY = 0;
    }
    lookCurrentX += (lookTargetX - lookCurrentX) * 0.11 * smoothFactor;
    lookCurrentY += (lookTargetY - lookCurrentY) * 0.11 * smoothFactor;
    
    // Only apply transform if values changed significantly (reduces DOM writes)
    var progressDelta = Math.abs(currentProgress - lastAppliedProgress);
    var lookDeltaX = Math.abs(lookCurrentX - lastAppliedLookX);
    var lookDeltaY = Math.abs(lookCurrentY - lastAppliedLookY);
    
    // Lower thresholds for more responsive hover
    if (progressDelta > 0.0001 || lookDeltaX > 0.0005 || lookDeltaY > 0.0005) {
      applyWallTransform(currentProgress);
      lastAppliedProgress = currentProgress;
      lastAppliedLookX = lookCurrentX;
      lastAppliedLookY = lookCurrentY;
    }
  }

  updateFromScroll();
  updateMaxCutoutScale();

  window.addEventListener('scroll', updateFromScroll, { passive: true });
  window.addEventListener('resize', function () {
    updateFromScroll();
    updateMaxCutoutScale();
  });
  
  pinSection.addEventListener('pointerenter', function (e) {
    if (e.pointerType === 'touch') return;
    isHoveringWall = true;
  });

  pinSection.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'touch') return;
    isHoveringWall = false;
    lookTargetX = 0;
    lookTargetY = 0;
  });

  pinSection.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    if (!isHoveringWall) return;
    var rect = pinSection.getBoundingClientRect();
    var nx = clamp(((e.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
    var ny = clamp(((e.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
    lookTargetX = -ny;
    lookTargetY = nx;
  }, { passive: true });
  
  // Match holographic-card gyro feel: ±20° physical tilt maps to full [-1, 1].
  var GYRO_RANGE    = 20;
  var gyroInitTimer  = null; // fires if no orientation events arrive within 500ms
  var gyroStaleTimer = null; // fires if events stop (sleep / permission revoked)

  function onDeviceOrientation(e) {
    // Clear the startup timer — orientation events are live
    if (gyroInitTimer !== null) {
      clearTimeout(gyroInitTimer);
      gyroInitTimer = null;
    }
    if (e.gamma === null || e.beta === null) return;
    // Capture baseline on first event — wherever device is held = cursor center
    if (gyroCalibGamma === null) {
      gyroCalibGamma = e.gamma;
      gyroCalibBeta  = e.beta;
    }
    // Same axis model as holographic-card:
    // x = -deltaGamma / RANGE, y = deltaBeta / RANGE
    var tiltX = -clamp(e.gamma - gyroCalibGamma, -GYRO_RANGE, GYRO_RANGE) / GYRO_RANGE;
    var tiltY = clamp(e.beta - gyroCalibBeta, -GYRO_RANGE, GYRO_RANGE) / GYRO_RANGE;
    lookTargetY = tiltX;
    lookTargetX = tiltY;
    gyroActive = true;

    // Feed gyro look values to the 3D scene
    window.dispatchEvent(new CustomEvent('v2-look-update', {
      detail: { x: lookTargetX, y: lookTargetY }
    }));

    // Decay back to neutral if events stop arriving (sleep / revoked)
    clearTimeout(gyroStaleTimer);
    gyroStaleTimer = setTimeout(function () {
      gyroActive = false;
      lookTargetX = 0;
      lookTargetY = 0;
      window.dispatchEvent(new CustomEvent('v2-look-update', { detail: { x: 0, y: 0 } }));
    }, 500);
  }

  function isMobileDevice() {
    if (typeof navigator.userAgentData === 'object' &&
        typeof navigator.userAgentData.mobile === 'boolean') {
      return navigator.userAgentData.mobile;
    }
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Windows Phone|Mobile/i
      .test(navigator.userAgent || '');
  }

  function needsGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') return true;
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') return true;
    return false;
  }

  function requestGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission();
    }
    return DeviceMotionEvent.requestPermission();
  }

  function setupGyro() {
    // 500ms startup guard — if no events fire, gyro is unavailable; wall stays static
    gyroInitTimer = setTimeout(function () {
      gyroInitTimer = null;
      gyroActive = false;
    }, 500);
    window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
  }

  function initGyro() {
    if (!isMobileDevice()) return;
    if (typeof DeviceOrientationEvent === 'undefined' &&
        typeof DeviceMotionEvent === 'undefined') return;
    if (needsGyroPermission()) {
      var btn = document.getElementById('gyro-btn');
      if (!btn) return;
      btn.classList.add('visible');
      btn.addEventListener('click', function () {
        requestGyroPermission()
          .then(function (state) {
            if (state === 'granted') {
              setupGyro();
              btn.classList.remove('visible');
            }
          })
          .catch(function () {});
      });
    } else {
      setupGyro();
    }
  }

  initGyro();
  tickWall(performance.now());
})();
