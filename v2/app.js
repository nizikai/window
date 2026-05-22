(function () {
  'use strict';

  var wall = document.querySelector('.wall');
  var scrollStage = document.querySelector('.scroll-stage');
  var pinSection = document.querySelector('.pin-section');
  if (!wall || !scrollStage || !pinSection) return;

  var flipped = false;
  var lookTargetX = 0;
  var lookTargetY = 0;
  var lookCurrentX = 0;
  var lookCurrentY = 0;
  var isHoveringWall = false;
  var FLIP_TO_BACK_AT = -98;
  var FLIP_TO_FRONT_AT = -82;

  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function emitFlipState(nextFlipped) {
    if (flipped === nextFlipped) return;
    flipped = nextFlipped;
    window.dispatchEvent(new CustomEvent('v2-wall-flip', { detail: { flipped: flipped } }));
  }

  function emitWallMotion(progress, rotateYDeg, wallScale) {
    window.dispatchEvent(new CustomEvent('v2-wall-motion', {
      detail: {
        progress: Number(progress.toFixed(4)),
        rotateYDeg: Number(rotateYDeg.toFixed(3)),
        wallScale: Number(wallScale.toFixed(4))
      }
    }));
  }

  function isBackFaceVisible(rotateYDeg) {
    // Hysteresis avoids rapid front/back toggling around 90deg.
    if (flipped) return rotateYDeg < FLIP_TO_FRONT_AT;
    return rotateYDeg < FLIP_TO_BACK_AT;
  }

  function readProgress() {
    var travel = Math.max(1, scrollStage.offsetHeight - window.innerHeight);
    var top = scrollStage.getBoundingClientRect().top;
    return clamp(-top / travel, 0, 1);
  }

  function applyWallTransform(progress) {
    var e = easeInOut(progress);
    var baseRotateY = -180 * e;
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

    wall.style.transform =
      'rotateY(' + rotateY.toFixed(3) + 'deg) ' +
      'rotateX(' + rotateX.toFixed(3) + 'deg) ' +
      'rotateZ(' + rotateZ.toFixed(3) + 'deg)';
    wall.style.opacity = (1 - Math.abs(Math.sin(progress * Math.PI)) * 0.03).toFixed(3);

    emitFlipState(isBackFaceVisible(baseRotateY));
    emitWallMotion(progress, baseRotateY, wallScale);
  }

  var indicator = document.querySelector('.scroll-indicator');
  function updateFromScroll() {
    if (indicator && window.scrollY > window.innerHeight * 0.05) {
      indicator.style.opacity = '0';
      indicator.style.display = 'none';
    }
  }

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
  });

  var currentProgress = readProgress();
  function tickWall() {
    requestAnimationFrame(tickWall);
    var target = readProgress();
    currentProgress += (target - currentProgress) * 0.14;
    if (!isHoveringWall) {
      lookTargetX = 0;
      lookTargetY = 0;
    }
    lookCurrentX += (lookTargetX - lookCurrentX) * 0.11;
    lookCurrentY += (lookTargetY - lookCurrentY) * 0.11;
    applyWallTransform(currentProgress);
  }

  updateFromScroll();
  tickWall();
})();
