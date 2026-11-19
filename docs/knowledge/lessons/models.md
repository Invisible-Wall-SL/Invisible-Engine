# 3D models — lessons

What has bitten the 3D `models` asset class before, newest first: the upload and register path,
the optimiser (`modelOptimize.ts`), the derive worker and its cache, the export and the pull.
Format and rules: [README](../README.md). Current state lives in
[status/3d.md](../../status/3d.md); launcher-wide traps are in [launcher.md](launcher.md).

### One bad model broke the whole project's assemble, and the bake shipped no models

- **Symptom:** a master that passed upload failed its derive; the runtime assemble and Publish
  failed for the whole project, and a standalone build shipped with no models index.
- **Cause:** no per-model `try` around the derive (`settleExports` is a bare `Promise.all`), and the
  bake ran the models export as `additive` ("continue without it").
- **Fix:** derive a model's tiers in full before writing any; skip a failing model and report it in
  the index's `skipped` (never shipped); the bake's models policy is `optional`.
- **Guard:** `check:model-export` (a valid-header, undecodable-pixels base colour).
