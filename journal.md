# Journal - window (updated 2026-05-25)

## Scope
- Continue `v5/`: keep 180-degree flip and existing cutout scale behavior, fix dark viewport gaps during wall flip.

## Current State
- `v5/v5.html`: added `.wall-gap-guard` between the canvas and rotating `.wall`.
- `v5/style.css`: guard is full-viewport, z-index 2; wall moved to z-index 3; guard starts `opacity: 0` + `visibility: hidden`.
- `v5/app.js`: guard opacity/visibility is driven from edge-on rotation risk: `edgeOn = 1 - abs(cos(rotateY))`, ramped with `smoothstep((edgeOn - 0.42) / 0.16)`.
- Guard uses the existing `.wall-cutout` class, so its hole scale stays synced with the active cutout update loop.

## Verification
- `node --check v5/app.js` passes.
- `node --check v5/scene.js` passes.
- Local Chrome/CDP visual check: with guard disabled, mid-flip shows viewport-wide dark leak; with guard enabled, white coverage remains outside the cutout.
- Guard lifecycle verified under simulated scroll progress: p=0 hidden/0 opacity, p=0.45 visible/1 opacity, p=0.5 visible/1 opacity, p=1 hidden/0 opacity.

## Caveats
- Headless scroll still does not move this page normally (`scrollY` stays 0), so verification used the existing app loop with a temporary `scroll-stage.getBoundingClientRect()` override.
- In-app browser was unavailable; Playwright CLI could not download because network access to npm was blocked. Used local HTTP server + headless Chrome CDP instead.

## Handoff
- Main gap fix is complete in `v5/`.
- If further visual tuning is requested, adjust only the guard ramp constants before changing flip/cutout math.
