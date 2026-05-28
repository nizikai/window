# Journal - window (updated 2026-05-28)

## Scope
- Align `v6` mobile gyro behavior with `holographic-card.html` feel.

## Current State
- `v6/app.js` gyro normalization now matches holographic model:
  - baseline calibration on first `deviceorientation` event
  - `RANGE = 20` (was 12)
  - `tiltX = -deltaGamma / RANGE`, `tiltY = deltaBeta / RANGE`
  - mapped into existing wall/scene look pipeline via `v2-look-update`
- `v6/scene.js` gyro event comments updated to match new axis mapping.

## Verification
- `node --check v6/app.js` passes.
- `node --check v6/scene.js` passes.
- Diff is limited to gyro mapping/range + comment sync.

## Handoff
- If feel tuning is requested next, adjust only `GYRO_RANGE` in `v6/app.js` first before changing rotation math.
