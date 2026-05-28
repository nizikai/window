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
    // On portrait mobile the 16:9 cutout may not cover full viewport height — scale to cover.
    var coverScale = Math.max(window.innerWidth / baseW, window.innerHeight / baseH) * 1.02;
    maxCutoutScale = Math.max(1.545, coverScale);
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
      var vCy = window.innerHeight * 0.5;
      var PERSPECTIVE = 2500;
      var SCREEN_PAD = 6; // pixels of screen-space overlap past the cutout outline

      var ryRad = rotateY * Math.PI / 180;
      var rxRad = rotateX * Math.PI / 180;
      var rzRad = rotateZ * Math.PI / 180;
      var cZ = Math.cos(rzRad), sZ = Math.sin(rzRad);
      var cX = Math.cos(rxRad), sX = Math.sin(rxRad);
      var cY = Math.cos(ryRad), sY = Math.sin(ryRad);

      // Project the 4 local cutout corners (CW: TL, TR, BR, BL).
      var cornersX = [-hw,  hw,  hw, -hw];
      var cornersY = [-hh, -hh,  hh,  hh];
      var pSx = [0, 0, 0, 0];
      var pSy = [0, 0, 0, 0];
      var pcx = 0, pcy = 0;
      for (var ci = 0; ci < 4; ci++) {
        var lx = cornersX[ci];
        var ly = cornersY[ci];
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
      pcx *= 0.25;
      pcy *= 0.25;

      // Inflate each projected corner outward from the projected centroid by SCREEN_PAD px.
      // Store inflated coords — used for both the canvas clip-path and the inverse cover path.
      var infSx = [0, 0, 0, 0];
      var infSy = [0, 0, 0, 0];
      var poly = 'polygon(';
      for (var pi = 0; pi < 4; pi++) {
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
        infSx[pi] = sx;
        infSy[pi] = sy;
        poly += sx.toFixed(1) + 'px ' + sy.toFixed(1) + 'px';
        if (pi < 3) poly += ',';
      }
      poly += ')';
      sceneCanvas.style.clipPath = poly;

      // White cover: inverse path — full-viewport CW rect + scene polygon CCW (winding −1).
      // After the flip the projected corners reverse winding (CW→CCW), so inner-polygon
      // order is chosen dynamically using the signed area of the raw projected polygon.
      // At exact edge-on the polygon degenerates to a line (sa2 ≈ 0); the path() can't
      // form a meaningful hole there, so fall back to no clip-path for that brief frame.
      if (whiteCover) {
        var sa2 =
          (pSx[0]*pSy[1] - pSx[1]*pSy[0]) +
          (pSx[1]*pSy[2] - pSx[2]*pSy[1]) +
          (pSx[2]*pSy[3] - pSx[3]*pSy[2]) +
          (pSx[3]*pSy[0] - pSx[0]*pSy[3]);
        if (Math.abs(sa2) < 100) {
          whiteCover.style.clipPath = 'none';
        } else {
          var vw = window.innerWidth;
          var vh = window.innerHeight;
          // sa2 > 0 → polygon CW  → reverse inner to make it CCW [0,3,2,1]
          // sa2 < 0 → polygon CCW → keep original order         [0,1,2,3]
          var ia = sa2 > 0 ? 3 : 1;
          var ic = sa2 > 0 ? 1 : 3;
          whiteCover.style.clipPath =
            'path("M0,0 H' + vw + ' V' + vh + ' H0 Z' +
            ' M' + pSx[0].toFixed(1)  + ',' + pSy[0].toFixed(1)  +
            ' L' + pSx[ia].toFixed(1) + ',' + pSy[ia].toFixed(1) +
            ' L' + pSx[2].toFixed(1)  + ',' + pSy[2].toFixed(1)  +
            ' L' + pSx[ic].toFixed(1) + ',' + pSy[ic].toFixed(1) + ' Z")';
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
  
  var gyroStaleTimer = null;

  function onDeviceOrientation(e) {
    if (e.gamma === null || e.beta === null) return;
    // Calibrate neutral on first reading — wherever user holds device = center
    if (gyroCalibGamma === null) {
      gyroCalibGamma = e.gamma;
      gyroCalibBeta  = e.beta;
    }
    var dGamma = e.gamma - gyroCalibGamma; // left/right tilt → horizontal cursor
    var dBeta  = e.beta  - gyroCalibBeta;  // forward/back tilt → vertical cursor
    lookTargetY = clamp(dGamma * 0.07, -1, 1);
    lookTargetX = clamp(-dBeta  * 0.07, -1, 1);
    gyroActive = true;

    // Reset if events stop arriving (device sleep / permission lost)
    clearTimeout(gyroStaleTimer);
    gyroStaleTimer = setTimeout(function () {
      gyroActive = false;
      lookTargetX = 0;
      lookTargetY = 0;
    }, 500);
  }

  function setupGyro() {
    window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
  }

  function initGyro() {
    if (!window.DeviceOrientationEvent) return;
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: requestPermission must come from a direct click handler
      var btn = document.getElementById('gyro-btn');
      if (!btn) return;
      btn.classList.add('visible');
      btn.addEventListener('click', function () {
        DeviceOrientationEvent.requestPermission()
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
