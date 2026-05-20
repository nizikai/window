// Parallax Depth Window

/**
 * DepthParallax
 * 
 * How it works:
 * 1. Each .depth-layer gets translateZ based on data-depth (spread across Z-axis)
 * 2. On cursor move, each layer gets an X/Y translation proportional to its depth
 *    - Far layers (low depth) move slightly OPPOSITE to cursor → background parallax
 *    - Near layers (high depth) move MORE opposite to cursor → foreground parallax
 * 3. The card-inner also tilts slightly to sell the 3D rotation
 *
 * This is a simpler, more reliable approach than rotating a perspective container.
 * Each layer just translates by (cursor * depth * multiplier) — more depth = more movement.
 */
var DepthParallax = (function () {
  'use strict';

  // --- Tuning ---
  var TRANSLATE_FACTOR = 40;    // px of movement per depth unit at full cursor offset
  var SMOOTHING = 0.08;
  var TRACKING_BOUNDARY = 400;

  // --- State ---
  var card = null;
  var layers = [];
  var currentX = 0, currentY = 0;
  var targetX = 0, targetY = 0;
  var rafId = null;
  var isRunning = false;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function onMouseMove(e) {
    if (!card) return;
    var rect = card.getBoundingClientRect();

    if (e.clientX < rect.left - TRACKING_BOUNDARY ||
        e.clientX > rect.right + TRACKING_BOUNDARY ||
        e.clientY < rect.top - TRACKING_BOUNDARY ||
        e.clientY > rect.bottom + TRACKING_BOUNDARY) {
      targetX = 0;
      targetY = 0;
      return;
    }

    // Normalized cursor position: -1 (left/top) to +1 (right/bottom)
    targetX = clamp(((e.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
    targetY = clamp(((e.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
  }

  function tick() {
    if (!isRunning) return;
    rafId = requestAnimationFrame(tick);

    currentX = lerp(currentX, targetX, SMOOTHING);
    currentY = lerp(currentY, targetY, SMOOTHING);

    // Move each layer: offset = -cursor * depth * factor
    // Negative so layers move opposite to cursor (parallax look-through effect)
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      var tx = -currentX * l.depth * TRANSLATE_FACTOR;
      var ty = -currentY * l.depth * TRANSLATE_FACTOR;
      l.el.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)';
    }
  }

  return {
    start: function () {
      card = document.querySelector('.card');
      if (!card) return;

      var allLayers = document.querySelectorAll('.depth-layer');
      layers = [];
      for (var i = 0; i < allLayers.length; i++) {
        var el = allLayers[i];
        var depth = parseFloat(el.getAttribute('data-depth')) || 1;
        layers.push({ el: el, depth: depth });
      }

      isRunning = true;
      document.addEventListener('mousemove', onMouseMove);
      rafId = requestAnimationFrame(tick);
    },

    stop: function () {
      isRunning = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      document.removeEventListener('mousemove', onMouseMove);
      targetX = 0; targetY = 0;
    },

    reset: function (immediate) {
      targetX = 0; targetY = 0;
      if (immediate) {
        currentX = 0; currentY = 0;
        for (var i = 0; i < layers.length; i++) {
          layers[i].el.style.transform = 'translate(0px, 0px)';
        }
      }
    }
  };
})();


/**
 * TiltController — tilts the card-inner on cursor for the 3D card feel
 */
var TiltController = (function () {
  'use strict';

  var MAX_TILT = 8;
  var TRACKING_BOUNDARY = 400;
  var RESET_DURATION = 0.5;
  var card = null, cardInner = null, active = false, isTracking = false;
  var quickRX = null, quickRY = null;

  function onMouseMove(e) {
    if (!active || !card || !cardInner) return;
    var rect = card.getBoundingClientRect();
    if (e.clientX < rect.left - TRACKING_BOUNDARY || e.clientX > rect.right + TRACKING_BOUNDARY ||
        e.clientY < rect.top - TRACKING_BOUNDARY || e.clientY > rect.bottom + TRACKING_BOUNDARY) {
      if (isTracking) {
        isTracking = false;
        gsap.to(cardInner, { rotateX: 0, rotateY: 0, duration: RESET_DURATION, ease: 'power2.out', overwrite: 'auto' });
      }
      return;
    }
    isTracking = true;
    var nx = -((e.clientX - rect.left) / rect.width - 0.5) * 2;
    var ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    quickRX(ny * MAX_TILT);
    quickRY(nx * MAX_TILT);
  }

  return {
    start: function () {
      card = document.querySelector('.card');
      cardInner = document.querySelector('.card-inner');
      if (!card || !cardInner) return;
      active = true;
      quickRX = gsap.quickTo(cardInner, 'rotateX', { duration: 0.4, ease: 'power2.out' });
      quickRY = gsap.quickTo(cardInner, 'rotateY', { duration: 0.4, ease: 'power2.out' });
      document.addEventListener('mousemove', onMouseMove);
    },
    stop: function () {
      active = false;
      document.removeEventListener('mousemove', onMouseMove);
      isTracking = false;
    },
    reset: function (immediate) {
      if (!cardInner) return;
      if (immediate) gsap.set(cardInner, { rotateX: 0, rotateY: 0, overwrite: true });
      else gsap.to(cardInner, { rotateX: 0, rotateY: 0, duration: RESET_DURATION, ease: 'power2.out', overwrite: 'auto' });
    }
  };
})();


/**
 * ScrollAnimator — scroll-driven flip + expansion
 */
var ScrollAnimator = (function () {
  'use strict';
  var timeline = null;
  var flipStartCbs = [], flipReverseCbs = [];
  var hasFlipStarted = false;

  return {
    init: function () {
      var container = document.querySelector('.component-container');
      var card = document.querySelector('.card');
      if (!container || !card) return;

      gsap.registerPlugin(ScrollTrigger);

      timeline = gsap.timeline({
        scrollTrigger: {
          trigger: container, pin: true, scrub: 1,
          start: 'top top',
          end: function () { return '+=' + Math.round(window.innerHeight * 2.5); },
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            if (self.progress > 0 && !hasFlipStarted) { hasFlipStarted = true; flipStartCbs.forEach(function (cb) { cb(); }); }
            if (self.progress === 0 && hasFlipStarted) { hasFlipStarted = false; flipReverseCbs.forEach(function (cb) { cb(); }); }
          }
        }
      });

      var hud = card.querySelectorAll('.scan-line, .frame-corner');
      timeline.to(card, { rotateY: -180, duration: 0.72, ease: 'power3.inOut' }, 0);
      timeline.to(card, { rotateX: -10, rotateZ: -0.9, duration: 0.36, ease: 'power2.inOut' }, 0);
      timeline.to(card, { rotateX: 0, rotateZ: 0, duration: 0.36, ease: 'power2.inOut' }, 0.36);
      timeline.to(card, {
        width: '120vw', height: '120vh', borderRadius: '0px', borderWidth: '0px', boxShadow: 'none',
        duration: 0.72, ease: 'power3.inOut',
        onStart: function () { card.style.aspectRatio = 'auto'; },
        onReverseComplete: function () { card.style.aspectRatio = '16 / 9'; }
      }, 0);
      if (hud.length) timeline.to(hud, { opacity: 0, duration: 0.24, ease: 'none' }, 0.36);
    },
    onFlipStart: function (cb) { flipStartCbs.push(cb); },
    onFlipReverse: function (cb) { flipReverseCbs.push(cb); },
    refresh: function () { if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(); }
  };
})();


// === INIT ===
document.addEventListener('DOMContentLoaded', function () {
  if (typeof gsap === 'undefined') return;

  ScrollAnimator.init();
  DepthParallax.start();

  if (window.matchMedia('(hover: hover)').matches) {
    TiltController.start();
  }

  // Scroll indicator fade
  var indicator = document.querySelector('.scroll-indicator');
  if (indicator) {
    window.addEventListener('scroll', function check() {
      if (window.scrollY > window.innerHeight * 0.1) {
        gsap.to(indicator, { opacity: 0, duration: 0.3, onComplete: function () { indicator.style.display = 'none'; } });
        window.removeEventListener('scroll', check);
      }
    });
  }

  // Resize
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(); }, 150);
  });

  // Flip callbacks
  ScrollAnimator.onFlipStart(function () {
    DepthParallax.stop();
    DepthParallax.reset(true);
    TiltController.stop();
    TiltController.reset(true);
  });
  ScrollAnimator.onFlipReverse(function () {
    DepthParallax.start();
    if (window.matchMedia('(hover: hover)').matches) TiltController.start();
  });

  ScrollAnimator.refresh();
});
