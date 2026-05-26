(function () {
  'use strict';

  var wall = document.querySelector('.wall');
  var scrollStage = document.querySelector('.scroll-stage');
  var pinSection = document.querySelector('.pin-section');
  var cutouts = document.querySelectorAll('.wall-cutout');
  if (!wall || !scrollStage || !pinSection) return;

  var flipped = false;
  var lookTargetX = 0;
  var lookTargetY = 0;
  var lookCurrentX = 0;
  var lookCurrentY = 0;
  var isHoveringWall = false;
  // Flip exactly at 90 degrees
  var FLIP_THRESHOLD = -90;
  
  // Performance optimization: cache last applied values
  var lastTransformString = '';
  var lastOpacity = '';
  var lastFlipState = null;
  var lastMotionEvent = null;
  var frameCount = 0;

  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

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
    var baseRotateY = -360 * e; // Full 360 degree rotation
    var rotateY = baseRotateY;
    var rotateX = Math.sin(progress * Math.PI) * -8;
    var rotateZ = Math.sin(progress * Math.PI) * -0.7;
    var wallScale = 1;
    var verticalHover = progress >= 0.5 ? -lookCurrentX : lookCurrentX;
    var hoverTiltX = verticalHover * 5.8;
    var hoverTiltY = lookCurrentY * 8.5;
    var hoverTwist = lookCurrentY * -0.9;

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
    
    var opacityString = (1 - Math.abs(Math.sin(progress * Math.PI)) * 0.03).toFixed(3);
    if (opacityString !== lastOpacity) {
      wall.style.opacity = opacityString;
      lastOpacity = opacityString;
    }

    // Scale cutout synchronized with rotation
    // Rotation goes from 0° to -180° based on eased progress
    // Initial: scale 0.5 (cutout is ~33vw wide)
    // Target: 102vw wide
    // Final scale needed: 102vw / 66vw = 1.545 (since base width is 66vw at scale 1)
    // Scale range: 0.5 to 1.545, so add (1.545 - 0.5) = 1.045
    var cutoutScale = 0.5 + (e * 1.045);
    for (var i = 0; i < cutouts.length; i++) {
      cutouts[i].style.transform = 'scale(' + cutoutScale.toFixed(4) + ')';
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
    
    if (!isHoveringWall) {
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
  
  // Add mouse hover event listeners
  window.addEventListener('scroll', updateFromScroll, { passive: true });
  window.addEventListener('resize', updateFromScroll);
  
  pinSection.addEventListener('mouseenter', function () {
    isHoveringWall = true;
  });
  
  pinSection.addEventListener('mouseleave', function () {
    isHoveringWall = false;
    lookTargetX = 0;
    lookTargetY = 0;
  });
  
  pinSection.addEventListener('mousemove', function (e) {
    if (!isHoveringWall) return;
    var rect = pinSection.getBoundingClientRect();
    var nx = clamp(((e.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
    var ny = clamp(((e.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
    lookTargetX = -ny;
    lookTargetY = nx;
    // Debug: log occasionally
    if (frameCounter % 60 === 0) {
      console.log('Hover:', lookTargetX.toFixed(2), lookTargetY.toFixed(2));
    }
  });
  
  tickWall(performance.now());
})();
