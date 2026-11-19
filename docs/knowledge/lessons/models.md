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

### One bad model broke the whole project's assemble, and the bake shipped no models

- **Symptom:** a master that passed upload failed its derive; the runtime assemble and Publish
  failed for the whole project, and a standalone build shipped with no models index.
- **Cause:** no per-model `try` around the derive (`settleExports` is a bare `Promise.all`), and the
  bake ran the models export as `additive` ("continue without it").
- **Fix:** derive a model's tiers in full before writing any; skip a failing model and report it in
  the index's `skipped` (never shipped); the bake's models policy is `optional`.
- **Guard:** `check:model-export` (a valid-header, undecodable-pixels base colour).

### Model tiers shipped no sockets, and empty web tiers for nested LODs

- **Symptom:** no shipped GLB had its `SK_` sockets (the index listed them); a model whose LOD1 or
  socket was parented to LOD0 shipped `half` / `quarter` GLBs with no nodes at all.
- **Cause:** glTF-Transform `prune` drops leaf nodes by default (`keepLeaves: false`), and dropping
  a level outside the tier's window disposed its whole subtree.
- **Fix:** hoist every mesh node's children with their world transform before windowing; prune with
  `keepLeaves: true`; `_COL` meshes become `extras.ie.collision` boxes.
- **Guard:** `check:model-optimize` "LOD tree" (a mutant per fix fails 4–5 checks).
- **PR:** (this PR, 2026-11-18) · source: `docs/status/3d.md`
