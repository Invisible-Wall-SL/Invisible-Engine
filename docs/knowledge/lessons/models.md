# 3D models — lessons

What has bitten the 3D `models` asset class before, newest first: the upload and register path,
the optimiser (`modelOptimize.ts`), the derive worker and its cache, the export and the pull.
Format and rules: [README](../README.md). Current state lives in
[status/3d.md](../../status/3d.md); launcher-wide traps are in [launcher.md](launcher.md).

### Model tiers shipped no sockets, and empty web tiers for nested LODs

- **Symptom:** no shipped GLB had its `SK_` sockets (the index listed them); a model whose LOD1 or
  socket was parented to LOD0 shipped `half` / `quarter` GLBs with no nodes at all.
- **Cause:** glTF-Transform `prune` drops leaf nodes by default (`keepLeaves: false`), and dropping
  a level outside the tier's window disposed its whole subtree.
- **Fix:** hoist every mesh node's children with their world transform before windowing; prune with
  `keepLeaves: true`; `_COL` meshes become `extras.ie.collision` boxes.
- **Guard:** `check:model-optimize` "LOD tree" (a mutant per fix fails 4–5 checks).
- **PR:** (this PR, 2026-11-18) · source: `docs/status/3d.md`
