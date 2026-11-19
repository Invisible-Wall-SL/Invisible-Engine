# 3D models — lessons

What has bitten the 3D `models` asset class before, newest first: the upload and register path,
the optimiser (`modelOptimize.ts`), the derive worker and its cache, the export and the pull.
Format and rules: [README](../README.md). Current state lives in
[status/3d.md](../../status/3d.md); launcher-wide traps are in [launcher.md](launcher.md).

### The model export froze the launcher on every runtime assemble

- **Symptom:** every authoring boot of a 3D project stalled the whole launcher for seconds; nobody
  else was served while it ran.
- **Cause:** each assemble re-derived every tier of every model on the main thread; the KTX2 encode
  is synchronous wasm (seconds per texture) and nothing cached the derived geometry.
- **Fix:** derives on one worker thread (timeout, own heap); each finished tier cached under
  `models/<id>/derived/<key>/`, so a warm export only claims or copies files.
- **Guard:** `check:model-derive-worker` (event-loop gap < 250 ms vs 2.7 s in-process),
  `check:model-export` "warm export".
- **PR:** (this PR, 2026-11-18) · source: `docs/status/3d.md`
