// Parallax Flip Window - Application Script

/**
 * CursorTracker Module
 * Tracks mouse position relative to the card center and applies parallax offsets to layers.
 * Uses rAF-based loop to compute translations at 60fps+.
 * 
 * Interface:
 *   CursorTracker.start()        - Begin rAF loop and mousemove listener
 *   CursorTracker.stop()         - Stop rAF loop
 *   CursorTracker.resetLayers()  - Animate layers to (0,0) with 600ms easeOut via GSAP
 */
var CursorTracker = (function () {
  'use strict';

  // --- Configuration ---
  var MAX_TRANSLATION = 42;       // Maximum layer translation in px (±42)
  var TRACKING_BOUNDARY = 280;    // Cursor tracking activation boundary in px
  var RESET_DURATION = 0.6;       // Duration for layer reset animation in seconds

  // --- State ---
  var mouseX = 0;
  var mouseY = 0;
  var rafId = null;
  var isTracking = false;         // Whether cursor is within tracking boundary
  var isRunning = false;          // Whether the rAF loop is active

  // --- DOM References (cached on start) ---
  var card = null;
  var layers = [];                // Array of { element, depthFactor }

  // --- Helpers ---

  /**
   * Clamp a value between min and max.
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Get the card's bounding rect and center coordinates.
   */
  function getCardGeometry() {
    var rect = card.getBoundingClientRect();
    return {
      rect: rect,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      halfWidth: rect.width / 2,
      halfHeight: rect.height / 2
    };
  }

  /**
   * Determine if a point (x, y) is within TRACKING_BOUNDARY px of the card boundary.
   */
  function isWithinTrackingArea(x, y, geo) {
    var expandedLeft = geo.rect.left - TRACKING_BOUNDARY;
    var expandedRight = geo.rect.right + TRACKING_BOUNDARY;
    var expandedTop = geo.rect.top - TRACKING_BOUNDARY;
    var expandedBottom = geo.rect.bottom + TRACKING_BOUNDARY;

    return x >= expandedLeft && x <= expandedRight &&
           y >= expandedTop && y <= expandedBottom;
  }

  /**
   * Mousemove handler — caches cursor position (no DOM writes here).
   */
  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  /**
   * rAF tick — computes and applies translations to parallax layers.
   */
  function tick() {
    if (!isRunning) return;

    var geo = getCardGeometry();
    var withinArea = isWithinTrackingArea(mouseX, mouseY, geo);

    if (withinArea) {
      if (!isTracking) {
        // Cursor just entered tracking area — start from current layer positions
        // (no reset, no jump — layers stay where they are and begin updating smoothly)
        isTracking = true;
      }

      // Compute normalized offset from card center: range [-1, 1]
      var normalizedX = (mouseX - geo.centerX) / geo.halfWidth;
      var normalizedY = (mouseY - geo.centerY) / geo.halfHeight;

      // Clamp normalized values to [-1, 1] for positions outside card but within boundary
      normalizedX = clamp(normalizedX, -1, 1);
      normalizedY = clamp(normalizedY, -1, 1);

      // Apply translation to each layer
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var tx = clamp(normalizedX * layer.depthFactor * MAX_TRANSLATION, -MAX_TRANSLATION, MAX_TRANSLATION);
        var ty = clamp(normalizedY * layer.depthFactor * MAX_TRANSLATION, -MAX_TRANSLATION, MAX_TRANSLATION);

        // Use GSAP set for immediate transform application (no tween, just direct)
        gsap.set(layer.element, { x: tx, y: ty });
      }
    } else if (isTracking) {
      // Cursor just left the tracking area — animate layers back to neutral
      isTracking = false;
      animateLayersToNeutral();
    }

    rafId = requestAnimationFrame(tick);
  }

  /**
   * Animate all layers back to translation (0, 0) with ease-out over RESET_DURATION.
   */
  function animateLayersToNeutral() {
    for (var i = 0; i < layers.length; i++) {
      gsap.to(layers[i].element, {
        x: 0,
        y: 0,
        duration: RESET_DURATION,
        ease: 'power2.out',
        overwrite: 'auto'
      });
    }
  }

  /**
   * Cache DOM references for the card and its parallax layers.
   */
  function cacheDOMReferences() {
    card = document.querySelector('.card');
    var layerElements = document.querySelectorAll('.card-face .parallax-layer');
    layers = [];

    for (var i = 0; i < layerElements.length; i++) {
      var el = layerElements[i];
      var depth = parseFloat(el.getAttribute('data-depth')) || 1;
      layers.push({ element: el, depthFactor: depth });
    }
  }

  // --- Public API ---

  return {
    /**
     * Begin rAF loop and attach mousemove listener.
     */
    start: function () {
      if (isRunning) return;

      cacheDOMReferences();

      if (!card || layers.length === 0) {
        console.warn('CursorTracker: No card or layers found.');
        return;
      }

      isRunning = true;
      document.addEventListener('mousemove', onMouseMove);
      rafId = requestAnimationFrame(tick);
    },

    /**
     * Stop the rAF loop and remove mousemove listener.
     */
    stop: function () {
      isRunning = false;
      isTracking = false;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      document.removeEventListener('mousemove', onMouseMove);
    },

    /**
     * Animate all layers to (0, 0) with 600ms ease-out (public reset method).
     * Useful when disabling interactions (e.g., on flip start).
     */
    resetLayers: function () {
      animateLayersToNeutral();
    }
  };
})();

/**
 * TiltController Module
 * 
 * Applies 3D rotation (rotateX/rotateY) to the card element based on cursor position.
 * Center of card = (0°, 0°), card edge = ±15° maximum.
 * Uses GSAP quickTo for smooth interpolation.
 * 
 * Interface:
 *   TiltController.start()   - Begin tracking (attach listeners, init quickTo)
 *   TiltController.stop()    - Stop tracking and reset rotation
 *   TiltController.reset()   - Animate rotation back to (0°, 0°) over 400ms
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */
var TiltController = (function () {
  'use strict';

  // --- Configuration ---
  var MAX_TILT = 9;            // Business-card tilt intensity
  var MAX_TILT_Z = 1.2;        // Small roll for depth feel
  var TRACKING_BOUNDARY = 340; // Allow follow before direct hover
  var RESET_DURATION = 0.4;    // 400ms reset animation

  // --- State ---
  var card = null;
  var cardInner = null;
  var active = false;
  var isTracking = false;
  var quickRotateX = null;
  var quickRotateY = null;
  var quickRotateZ = null;

  // --- Core Calculation ---

  /**
   * Compute tilt angles from cursor position relative to card center.
   * 
   * rotateY = clamp((cx / halfWidth) * MAX_TILT, -MAX_TILT, MAX_TILT)
   *   → cursor right of center produces positive rotateY
   * 
   * rotateX = clamp(-(cy / halfHeight) * MAX_TILT, -MAX_TILT, MAX_TILT)
   *   → cursor below center produces negative rotateX
   * 
   * @param {number} cx - Cursor X offset from card center (px)
   * @param {number} cy - Cursor Y offset from card center (px)
   * @param {number} halfWidth - Half the card width (px)
   * @param {number} halfHeight - Half the card height (px)
   * @returns {{rotateX: number, rotateY: number}}
   */
  function computeTiltFromNormalized(x, y) {
    var clampedX = Math.max(-1, Math.min(1, x));
    var clampedY = Math.max(-1, Math.min(1, y));

    return {
      rotateX: clampedY * MAX_TILT,
      rotateY: clampedX * MAX_TILT,
      rotateZ: clampedX * MAX_TILT_Z
    };
  }

  /**
   * Determine if a point is inside an expanded card proximity zone.
   */
  function isWithinTrackingArea(x, y, rect) {
    var expandedLeft = rect.left - TRACKING_BOUNDARY;
    var expandedRight = rect.right + TRACKING_BOUNDARY;
    var expandedTop = rect.top - TRACKING_BOUNDARY;
    var expandedBottom = rect.bottom + TRACKING_BOUNDARY;

    return x >= expandedLeft && x <= expandedRight &&
           y >= expandedTop && y <= expandedBottom;
  }

  // --- Event Handlers ---

  /**
   * Handle mousemove on the card – compute tilt and apply via quickTo.
   */
  function onMouseMove(e) {
    if (!active || !card || !cardInner) return;

    var rect = card.getBoundingClientRect();
    var withinArea = isWithinTrackingArea(e.clientX, e.clientY, rect);

    if (!withinArea) {
      if (isTracking) {
        isTracking = false;
        gsap.to(cardInner, {
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          duration: RESET_DURATION,
          ease: 'power2.out',
          overwrite: 'auto'
        });
      }
      return;
    }

    isTracking = true;

    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;
    var halfWidth = rect.width / 2;
    var halfHeight = rect.height / 2;

    // Match the reference card behavior:
    // x = -((mouseX/width)-0.5)*2 ; y = ((mouseY/height)-0.5)*2
    var normalizedX = -((e.clientX - rect.left) / rect.width - 0.5) * 2;
    var normalizedY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    var tilt = computeTiltFromNormalized(normalizedX, normalizedY);

    quickRotateX(tilt.rotateX);
    quickRotateY(tilt.rotateY);
    quickRotateZ(tilt.rotateZ);
  }

  /**
   * Handle mouseleave on the card – animate rotation back to (0°, 0°).
   */
  function onMouseLeave() {
    if (!active || !cardInner) return;

    gsap.to(cardInner, {
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      duration: RESET_DURATION,
      ease: 'power2.out',
      overwrite: 'auto'
    });
  }

  // --- Public API ---

  return {
    /**
     * Start tilt tracking on the card.
     * Initializes GSAP quickTo tweens for smooth rotation interpolation.
     */
    start: function () {
      card = document.querySelector('.card');
      cardInner = document.querySelector('.card-inner');

      if (!card) {
        console.warn('TiltController: No .card element found.');
        return;
      }
      if (!cardInner) {
        console.warn('TiltController: No .card-inner element found.');
        return;
      }

      active = true;

      // GSAP quickTo creates optimized tweens for rapidly-changing values
      quickRotateX = gsap.quickTo(cardInner, 'rotateX', {
        duration: 0.3,
        ease: 'power2.out'
      });
      quickRotateY = gsap.quickTo(cardInner, 'rotateY', {
        duration: 0.3,
        ease: 'power2.out'
      });
      quickRotateZ = gsap.quickTo(cardInner, 'rotateZ', {
        duration: 0.24,
        ease: 'power2.out'
      });

      document.addEventListener('mousemove', onMouseMove);
      card.addEventListener('mouseleave', onMouseLeave);
    },

    /**
     * Stop tilt tracking and optionally reset rotation to neutral.
     * Removes event listeners.
     */
    stop: function (shouldReset) {
      active = false;

      if (card) {
        card.removeEventListener('mouseleave', onMouseLeave);
      }
      document.removeEventListener('mousemove', onMouseMove);
      isTracking = false;

      if (shouldReset !== false) {
        this.reset();
      }
    },

    /**
     * Animate rotation back to (0°, 0°) over 400ms with ease-out.
     */
    reset: function () {
      if (!cardInner) return;

      gsap.to(cardInner, {
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
        duration: RESET_DURATION,
        ease: 'power2.out',
        overwrite: 'auto'
      });
    },

    /**
     * Expose computeTilt for unit/property testing.
     * @param {number} cx - Cursor X offset from card center
     * @param {number} cy - Cursor Y offset from card center
     * @param {number} halfWidth - Half the card width
     * @param {number} halfHeight - Half the card height
     * @returns {{rotateX: number, rotateY: number}}
     */
    computeTilt: computeTiltFromNormalized
  };
})();

/**
 * ScrollAnimator Module
 *
 * Creates and manages a single GSAP timeline with ScrollTrigger for the
 * scroll-driven flip (and later, expansion) animation.
 *
 * Timeline structure (flip + fullscreen at the same time):
 *   Progress 0–0.72: rotateY 0° → -180° while scaling to fullscreen
 *   Progress 0.72–1.0: settle/fade phase for overlays
 *
 * ScrollTrigger config:
 *   - trigger: .component-container
 *   - pin: true
 *   - scrub: true
 *   - start: "top top"
 *   - end: "+=420vh"
 *
 * Interface:
 *   ScrollAnimator.init()                  - Create timeline and ScrollTrigger
 *   ScrollAnimator.destroy()               - Kill timeline and ScrollTrigger
 *   ScrollAnimator.onFlipStart(callback)   - Register callback for flip start
 *   ScrollAnimator.onFlipReverse(callback) - Register callback for full reverse
 *
 * Validates: Requirements 4.1, 4.2, 4.5, 4.6, 6.2, 6.4, 7.2, 8.2
 */
var ScrollAnimator = (function () {
  'use strict';

  // --- State ---
  var timeline = null;
  var scrollTriggerInstance = null;
  var flipStartCallbacks = [];
  var flipReverseCallbacks = [];
  var hasFlipStarted = false; // Tracks whether flip is in progress (progress > 0)

  // --- Helpers ---

  /**
   * Fire all registered flip-start callbacks.
   */
  function fireFlipStart() {
    for (var i = 0; i < flipStartCallbacks.length; i++) {
      flipStartCallbacks[i]();
    }
  }

  /**
   * Fire all registered flip-reverse callbacks.
   */
  function fireFlipReverse() {
    for (var i = 0; i < flipReverseCallbacks.length; i++) {
      flipReverseCallbacks[i]();
    }
  }

  // --- Public API ---

  return {
    /**
     * Initialize the ScrollAnimator: create the GSAP timeline with ScrollTrigger
     * and add the flip tween.
     */
    init: function () {
      var container = document.querySelector('.component-container');
      var card = document.querySelector('.card');

      if (!container || !card) {
        console.warn('ScrollAnimator: Required elements (.component-container, .card) not found.');
        return;
      }

      // Register ScrollTrigger plugin
      gsap.registerPlugin(ScrollTrigger);

      // Create the master timeline with ScrollTrigger
      // Pin the container and scrub over a long distance so the two-stage transition
      // (flip + fullscreen expansion) has enough room to breathe.
      timeline = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          pin: true,
          scrub: 1,
          start: 'top top',
          end: '+=420vh',
          onUpdate: function (self) {
            var progress = self.progress;

            // Detect flip start (progress moves away from 0)
            if (progress > 0 && !hasFlipStarted) {
              hasFlipStarted = true;
              fireFlipStart();
            }

            // Detect full reverse (progress returns to 0)
            if (progress === 0 && hasFlipStarted) {
              hasFlipStarted = false;
              fireFlipReverse();
            }
          }
        }
      });

      // Store reference to the ScrollTrigger instance
      scrollTriggerInstance = timeline.scrollTrigger;

      var backFullscreenOverlay = card.querySelector('.back-fullscreen-overlay');
      var hudElements = card.querySelectorAll('.scan-line, .frame-corner, .hud-text');

      // Flip tween: rotateY from 0° to -180° with temporary X/Z tilt.
      timeline.to(card, {
        rotateY: -180,
        duration: 0.72,
        ease: 'power3.inOut'
      }, 0);

      timeline.to(card, {
        rotateX: -10,
        rotateZ: -0.9,
        duration: 0.36,
        ease: 'power2.inOut'
      }, 0);

      timeline.to(card, {
        rotateX: 0,
        rotateZ: 0,
        duration: 0.36,
        ease: 'power2.inOut'
      }, 0.36);

      // Expand to fullscreen while rotation is in progress.
      timeline.to(card, {
        width: '120vw',
        height: '120vh',
        borderRadius: '0px',
        borderWidth: '0px',
        boxShadow: 'none',
        duration: 0.72,
        ease: 'power3.inOut',
        onStart: function () {
          card.style.aspectRatio = 'auto';
        },
        onReverseComplete: function () {
          card.style.aspectRatio = '16 / 9';
        }
      }, 0);

      if (hudElements.length > 0) {
        timeline.to(hudElements, {
          opacity: 0,
          duration: 0.24,
          ease: 'none'
        }, 0.36);
      }

      if (backFullscreenOverlay) {
        timeline.to(backFullscreenOverlay, {
          opacity: 1,
          duration: 0.28,
          ease: 'none'
        }, 0.44);
      }
    },

    /**
     * Destroy the timeline and ScrollTrigger instance, cleaning up all resources.
     */
    destroy: function () {
      if (timeline) {
        timeline.kill();
        timeline = null;
      }
      if (scrollTriggerInstance) {
        scrollTriggerInstance.kill();
        scrollTriggerInstance = null;
      }
      flipStartCallbacks = [];
      flipReverseCallbacks = [];
      hasFlipStarted = false;
    },

    /**
     * Register a callback to fire when the flip begins (scroll progress > 0).
     * @param {Function} callback
     */
    onFlipStart: function (callback) {
      if (typeof callback === 'function') {
        flipStartCallbacks.push(callback);
      }
    },

    /**
     * Register a callback to fire when scroll fully reverses (progress returns to 0).
     * @param {Function} callback
     */
    onFlipReverse: function (callback) {
      if (typeof callback === 'function') {
        flipReverseCallbacks.push(callback);
      }
    },

    /**
     * Refresh ScrollTrigger to sync animation state with the current scroll position.
     * Should be called after all modules are initialized (e.g., in ParallaxCard.init())
     * to handle deep links or page loads at a non-zero scroll offset.
     *
     * Validates: Requirements 7.2
     */
    refresh: function () {
      if (typeof ScrollTrigger !== 'undefined') {
        ScrollTrigger.refresh();
      }
    }
  };
})();


/**
 * ResizeHandler Module
 *
 * Listens for window resize events and recalculates layout-dependent values.
 * Uses a 150ms debounce to avoid excessive recalculation during drag-resizing.
 * On debounced resize, calls ScrollTrigger.refresh() to update pin positions
 * and scroll calculations.
 *
 * Interface:
 *   ResizeHandler.init()    - Attach resize listener
 *   ResizeHandler.destroy() - Remove resize listener and clear pending debounce
 *
 * Validates: Requirements 7.3
 */
var ResizeHandler = (function () {
  'use strict';

  // --- Configuration ---
  var DEBOUNCE_DELAY = 150; // milliseconds

  // --- State ---
  var timerId = null;
  var listening = false;

  // --- Core ---

  /**
   * Debounced resize callback.
   * Refreshes ScrollTrigger so pin positions and scroll calculations stay accurate.
   */
  function onResizeDebounced() {
    if (typeof ScrollTrigger !== 'undefined' && ScrollTrigger.refresh) {
      ScrollTrigger.refresh();
    }
  }

  /**
   * Raw resize event handler — resets the debounce timer.
   */
  function onResize() {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(function () {
      timerId = null;
      onResizeDebounced();
    }, DEBOUNCE_DELAY);
  }

  // --- Public API ---

  return {
    /**
     * Start listening for window resize events.
     */
    init: function () {
      if (listening) return;
      listening = true;
      window.addEventListener('resize', onResize);
    },

    /**
     * Stop listening and clear any pending debounce timer.
     */
    destroy: function () {
      listening = false;
      window.removeEventListener('resize', onResize);
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    }
  };
})();


/**
 * FeatureDetection Module
 *
 * Provides capability detection functions used by the main ParallaxCard controller
 * to determine which features to initialize. Implements graceful degradation:
 *
 * - Touch-only devices: disable parallax and tilt (scroll-driven flip/expansion still work)
 * - No CSS 3D transforms: render card statically, skip flip/expansion scroll zones
 * - No GSAP: render card statically (non-interactive)
 *
 * Interface:
 *   FeatureDetection.hasHoverCapability()    - true if device supports hover (not touch-only)
 *   FeatureDetection.has3DTransformSupport() - true if CSS 3D transforms are supported
 *   FeatureDetection.hasGSAP()              - true if window.gsap is available
 *
 * Validates: Requirements 7.3, 7.4, 9.4
 */
var FeatureDetection = (function () {
  'use strict';

  /**
   * Detect whether the device has hover capability (i.e., not a touch-only device).
   * Uses the `(hover: hover)` media query which returns true for devices with a
   * primary pointing device that can hover (mouse, trackpad).
   * Touch-only devices (phones, tablets without a mouse) will return false.
   *
   * @returns {boolean} true if the device supports hover interactions
   */
  function hasHoverCapability() {
    return window.matchMedia('(hover: hover)').matches;
  }

  /**
   * Detect whether the browser supports CSS 3D transforms.
   * Uses CSS.supports() to check for rotateY support, which is required
   * for the flip transition and tilt effect.
   *
   * If CSS.supports is not available (very old browsers), falls back to false.
   *
   * @returns {boolean} true if CSS 3D transforms are supported
   */
  function has3DTransformSupport() {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      return CSS.supports('transform', 'rotateY(1deg)') || CSS.supports('-webkit-transform', 'rotateY(1deg)');
    }
    // If CSS.supports isn't available, assume modern browser supports 3D
    return true;
  }

  /**
   * Check whether GSAP is loaded and available on the window object.
   * This detects CDN load failures — if GSAP script fails to load,
   * window.gsap will be undefined and the component should render statically.
   *
   * @returns {boolean} true if window.gsap exists
   */
  function hasGSAP() {
    return typeof window.gsap !== 'undefined';
  }

  // --- Public API ---

  return {
    hasHoverCapability: hasHoverCapability,
    has3DTransformSupport: has3DTransformSupport,
    hasGSAP: hasGSAP
  };
})();


/**
 * ScrollIndicator Module
 *
 * Shows a downward-pointing scroll indicator on page load and fades it out
 * when the user scrolls past 10% of the first scroll zone (entry zone).
 *
 * Uses GSAP ScrollTrigger to detect the 10% threshold (10vh of the 100vh entry zone).
 * Once hidden, the indicator stays hidden permanently.
 *
 * Interface:
 *   ScrollIndicator.show()          - Make the indicator visible (opacity 1, display block)
 *   ScrollIndicator.hide(duration)  - Fade out over duration ms, then set display:none
 *
 * Validates: Requirements 8.3, 8.4
 */
var ScrollIndicator = (function () {
  'use strict';

  // --- State ---
  var indicator = null;
  var isHidden = false;
  var scrollTriggerInstance = null;

  // --- Public API ---

  return {
    /**
     * Show the scroll indicator (opacity 1, visible).
     * No-op if already hidden permanently.
     */
    show: function () {
      if (!indicator) {
        indicator = document.querySelector('.scroll-indicator');
      }
      if (!indicator || isHidden) return;

      gsap.set(indicator, { opacity: 1, display: 'block', visibility: 'visible' });
    },

    /**
     * Fade out the scroll indicator over the specified duration (in ms),
     * then hide it. Once hidden, it stays hidden.
     * @param {number} duration - Fade-out duration in milliseconds (default: 300)
     */
    hide: function (duration) {
      if (!indicator) {
        indicator = document.querySelector('.scroll-indicator');
      }
      if (!indicator || isHidden) return;

      var durationSec = (duration || 300) / 1000;

      isHidden = true;

      gsap.to(indicator, {
        opacity: 0,
        duration: durationSec,
        ease: 'power2.out',
        onComplete: function () {
          gsap.set(indicator, { display: 'none' });
        }
      });
    },

    /**
     * Initialize the ScrollIndicator: show on load, set up ScrollTrigger
     * to hide when user scrolls past 10% of the entry zone.
     */
    init: function () {
      indicator = document.querySelector('.scroll-indicator');
      if (!indicator) {
        console.warn('ScrollIndicator: No .scroll-indicator element found.');
        return;
      }

      // Ensure visible on load
      this.show();

      // Hide when user scrolls past 10vh (10% of the first 100vh spacer)
      var self = this;
      var threshold = window.innerHeight * 0.1;

      function onScroll() {
        if (window.scrollY > threshold && !isHidden) {
          self.hide(300);
          window.removeEventListener('scroll', onScroll);
        }
      }

      window.addEventListener('scroll', onScroll);
    },

    /**
     * Destroy the ScrollTrigger instance (cleanup).
     */
    destroy: function () {
      if (scrollTriggerInstance) {
        scrollTriggerInstance.kill();
        scrollTriggerInstance = null;
      }
      isHidden = false;
      indicator = null;
    }
  };
})();


/**
 * ParallaxCard Controller (Main Orchestrator)
 *
 * Initializes all sub-modules, manages phase state transitions, and coordinates
 * cursor interaction toggling during scroll-driven animations.
 *
 * Initialization order:
 *   1. FeatureDetection checks (GSAP, 3D transforms)
 *   2. ScrollAnimator.init()
 *   3. CursorTracker.start() + TiltController.start() (if hover-capable)
 *   4. ScrollIndicator.init()
 *   5. ResizeHandler.init()
 *   6. Register flip start/reverse callbacks on ScrollAnimator
 *   7. ScrollAnimator.refresh() to sync with current scroll position
 *
 * State phases: idle | parallax | flipping | expanded
 *
 * Interface:
 *   ParallaxCard.init()    - Initialize all modules and wire callbacks
 *   ParallaxCard.destroy() - Tear down all modules and listeners
 *
 * Validates: Requirements 6.4, 7.2
 */
var ParallaxCard = (function () {
  'use strict';

  // --- State ---
  var phase = 'idle'; // 'idle' | 'parallax' | 'flipping' | 'expanded'
  var cursorEnabled = false;
  var initialized = false;

  // --- Helpers ---

  /**
   * Disable cursor-based interactions (parallax + tilt).
   * Called when flip/expansion begins.
   */
  function disableCursor() {
    if (!cursorEnabled) return;
    cursorEnabled = false;
    CursorTracker.stop();
    CursorTracker.resetLayers();
    TiltController.stop(false);
  }

  /**
   * Enable cursor-based interactions (parallax + tilt).
   * Called when scroll fully reverses back to idle.
   */
  function enableCursor() {
    if (cursorEnabled) return;
    cursorEnabled = true;
    CursorTracker.start();
    TiltController.start();
  }

  // --- Public API ---

  return {
    /**
     * Get the current phase state.
     * @returns {'idle'|'parallax'|'flipping'|'expanded'}
     */
    getPhase: function () {
      return phase;
    },

    /**
     * Initialize the ParallaxCard component.
     * Checks feature support, initializes modules, and wires callbacks.
     */
    init: function () {
      if (initialized) return;

      // --- Feature Detection ---

      // GSAP is required for all animations
      if (!FeatureDetection.hasGSAP()) {
        console.warn('ParallaxCard: GSAP not available. Rendering statically.');
        return;
      }

      // CSS 3D transforms required for flip/expansion
      if (!FeatureDetection.has3DTransformSupport()) {
        console.warn('ParallaxCard: CSS 3D transforms not supported. Rendering statically.');
        return;
      }

      initialized = true;

      // --- Module Initialization ---

      // 1. ScrollAnimator — creates the pinned timeline for flip + expansion
      ScrollAnimator.init();

      // 2. Cursor interactions (only on hover-capable devices)
      if (FeatureDetection.hasHoverCapability()) {
        CursorTracker.start();
        TiltController.start();
        cursorEnabled = true;
        phase = 'parallax';
      } else {
        phase = 'idle';
      }

      // 3. Scroll indicator — visible on load, hides after 10% scroll
      ScrollIndicator.init();

      // 4. Resize handler — debounced ScrollTrigger.refresh() on resize
      ResizeHandler.init();

      // --- Callback Wiring ---

      // When flip begins: keep cursor interactions active so subtle tilt/parallax
      // continue while the card rotates and expands.
      ScrollAnimator.onFlipStart(function () {
        phase = 'flipping';
      });

      // When scroll fully reverses (progress returns to 0): re-enable cursor
      ScrollAnimator.onFlipReverse(function () {
        if (FeatureDetection.hasHoverCapability()) {
          phase = 'parallax';
          enableCursor();
        } else {
          phase = 'idle';
        }
      });

      // --- Sync with Current Scroll Position ---
      // Handles deep links or page loads at non-zero scroll offsets
      ScrollAnimator.refresh();
    },

    /**
     * Destroy the ParallaxCard component.
     * Tears down all modules and resets state.
     */
    destroy: function () {
      if (!initialized) return;

      CursorTracker.stop();
      TiltController.stop();
      ScrollAnimator.destroy();
      ScrollIndicator.destroy();
      ResizeHandler.destroy();

      phase = 'idle';
      cursorEnabled = false;
      initialized = false;
    }
  };
})();

// --- Bootstrap ---
// Initialize on DOMContentLoaded to ensure DOM is ready
document.addEventListener('DOMContentLoaded', function () {
  ParallaxCard.init();
});
