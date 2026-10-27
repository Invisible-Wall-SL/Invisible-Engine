# Rigger — lessons

What has bitten rigger work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/rigger.md](../../status/rigger.md); this file only keeps the traps.
Covers Invisible Rigger (`/rigger`), the `.irig` format, `packages/engine-rig`, the Rig Viewer
([status/rig-viewer.md](../../status/rig-viewer.md)) and rigs placed in games. Atlas-side traps
(manifest geometry, packing) live in [atlas.md](atlas.md).

A rig placed in the Scene Editor drawing off its box (screen anchor, origin, ⊕ Centre origin)
lives in [editor.md](editor.md#a-rig-draws-in-one-place-and-selects-in-another).

### The preview played a different pose from the game
- **Symptom:** a clip previewed at scaleY 0 while the game played 1; ◆ Animate crashed on imports.
- **Cause:** rig JSON omits key values and `time` at their defaults (scale 1, mixes 1, time 0);
  `view.html` read them as 0 or as `undefined`.
- **Fix:** `fillKeyDefaults` + `normalizeKeyTimes` (both via `normalizeKeys`) at open, clip import
  and library merge. Before a bone channel's first key the preview still differs (open item 16).
- **Guard:** `tools/rigger-spike/keydefaults.mjs` (in `check:all`).
- **PR:** not recorded (2026-10-20; 2026-08-18) · source: `docs/status/rigger-history.md`

### The graph editor drew a sharp V where the bone eased
- **Symptom:** a y or scaleY key with flat handles drew as a corner; playback was smooth.
- **Cause:** `graphValueAt` sampled each field alone, so y read x's half of the bezier.
- **Fix:** it samples the channel's whole field list. Saved data was never wrong.
- **Guard:** `tools/rigger-spike/graphcurve.mjs` compares every graphed curve with `engine-rig`.
- **PR:** not recorded (2026-10-20) · source: `docs/status/rigger.md`

### Rig pages tripled a game's texture download
- **Symptom:** 36.9 MB of a 48.4 MB build were rig pages, each a lossless copy of a sheet page.
- **Cause:** rotated regions were turned 180° into a private lossless page for the old CCW-only
  runtime, so every rig shipped its own page beside the sheet's.
- **Fix:** `bundleSheetPage` (`rigBundleSync.ts`) ships the sheet's own page and rewrites its
  rotations to `rotate:270` (`clockwiseOnPage`). Sets a runtime rollback floor.
- **Guard:** `check:rig-sheet-page`, `check:rig-atlas-rotation`.
- **PR:** not recorded (2026-10-16) · source: `docs/status/rigger.md`

### The rig parity gate went red after the rename
- **Symptom:** `tools/rig-parity/parity.mjs` failed on `main` on two demo rigs for nine days.
- **Cause:** a `skeleton` header with no `hash` / `spine`; the reference copies `undefined`,
  `engine-rig` wrote `null`. Nothing ran the gate in CI.
- **Fix:** the reader copies those fields as written; the gate now runs in CI (advisory).
- **Guard:** `.github/workflows/rig-parity.yml`; run all four `tools/rig-parity/` gates on any
  `engine-rig` change (only `parity.mjs` is automatic).
- **PR:** #1107 broke it (2026-10-16) · source: `docs/status/rigger.md`

### Bound FX always drew under the rig in the Rigger only
- **Symptom:** FX ignored their draw-at-slot order in `/rigger`; the game was fine.
- **Cause:** front and back overlays were created together and a canvas lookup gave both the
  wrong z-index, sinking them under `#cv`.
- **Fix:** each band mounts in its own host carrying its z-index (`.fxBand`, `view.html`).
- **Guard:** none.
- **PR:** not recorded (2026-10-15) · source: `docs/status/rigger.md`

### FX forces played everywhere but the Rigger
- **Symptom:** an FX feature worked in `/fx` and in games, not in the Rigger's preview.
- **Cause:** the committed `static/rigger/vendor/rigger-fx.js` (and `rigger-text.js`) had not
  been rebuilt since the source changed.
- **Fix:** rebuilt; rebuild after any `fxOverlay.client.ts` or `engine-rig` edit.
- **Guard:** `pnpm --filter launcher-api check:vendored-bundles` (CI, via `check:all`).
- **PR:** not recorded (2026-10-13) · source: `docs/status/rigger.md`

### The rig rename rewrote R2 paths that never moved
- **Symptom:** messages and docs named `rigs/skeletons.json`; nothing lives there.
- **Cause:** a blanket "spine → rig" rename. Bundles and their index stay under `spines/` and
  `_shared/spines/`; `_shared/rigs/` is the Rigger's separate doc library.
- **Fix:** paths restored. Stored values keep their spelling: the `'spine'` node kind, the
  `spineViewer` tool id, `skeleton.spine`, `spineAnimation` / `winSpine` keys.
- **Guard:** none; rename display names only, never a stored key, prefix or route.
- **PR:** #1107 (2026-10-07) · source: `docs/status/rig-viewer.md`

### A mounted rig drew nothing until it played
- **Symptom:** after Phase 6, slot objects (counters, win text) drew under their slot's art, and
  a not-yet-played rig showed nothing (posing early showed an explosion's first frame instead).
- **Cause:** `RigView` diverged from the reference Pixi runtime on slot-object order and posing.
- **Fix:** follow the reference: full bone matrix, slot alpha, drawn after the attachment; no pose
  until the first `update`.
- **Guard:** `tools/rig-parity/render.mjs --slot-objects --fresh` (manual).
- **PR:** not recorded (2026-10-06) · source: `docs/status/rigger.md`

### Deleting a bone or slot broke or moved the rig
- **Symptom:** after a delete the rig would not open ("Couldn't find target slot"), or children
  jumped by the deleted bone's transform.
- **Cause:** constraints, weighted indices, linked meshes and draw-order keys were left dangling;
  children kept their LOCAL values under the new parent.
- **Fix:** one cascade (`dropConstraints`) plus a delete that composes the bone's transform in.
- **Guard:** `tools/rigger-spike/delete.mjs` (in CI; green on all checked-in rigs).
- **PR:** #877 (2026-09-30), follow-up 2026-10-01 · source: `docs/status/rigger-history.md`

### Auto FX slots broke a slot that shows an image sequence
- **Symptom:** after ✨ Auto FX slots the rig no longer opened ("Region not found").
- **Cause:** the duplicate slot's `path` was re-aimed at the FX region, so every sequence frame
  named a region that does not exist.
- **Fix:** Auto FX skips sequence layers and says why; `repointSlotSetupImage` refuses a sequence.
- **Guard:** `tools/rigger-spike/sequence.mjs` (CI, on `W`).
- **PR:** not recorded (2026-10-01) · source: `docs/status/rigger.md`

### A mesh made from a trimmed image was squeezed
- **Symptom:** Convert to mesh / Draw mesh showed the whole image (and neighbours) in the ink box.
- **Cause:** mesh UVs are fractions of the UNTRIMMED image; the tools laid 0..1 over the ink quad.
- **Fix:** map through the ink's place (`regionInkUVs`); a banner offers 🩹 Repair for old meshes.
- **Guard:** `tools/rigger-spike/trimmesh.mjs` (per-pixel, real WebGL renderer).
- **PR:** not recorded (2026-09-30) · source: `docs/status/rigger.md`

### An image packed at 180 degrees draws upside down
- **Symptom:** a region attachment on a half-turn pack draws flipped, in the Rigger and the game.
- **Cause:** `RegionAttachment.updateRegion` in `engine-rig` undoes 90 and 270 but not 180; meshes
  undo all four. Only `apps/price/…/symbolsSpecial` has such packs, all drawn by meshes.
- **Fix:** none yet (open item 13); re-pack without 180° rotation.
- **Guard:** none.
- **PR:** not recorded (found 2026-09-30) · source: `docs/status/rigger.md`

### Save wrote one rig's content under another's name
- **Symptom:** after a rig failed to open, 💾 overwrote it with the previously open rig.
- **Cause:** a failed open left the old document loaded under the new selection and ETag.
- **Fix:** close before fetching; a failed open disables 💾 / 📦 / ⤓ and keeps 🕘 restore.
- **Guard:** `tools/rigger-spike/rig-switch.mjs`.
- **PR:** not recorded (2026-09-30) · source: `docs/status/rigger.md`

### Edits landed in the default skin, not the one on stage
- **Symptom:** add image, move, pivot or convert in a skin changed default's image instead.
- **Cause:** a stale skin `<select>` read `""` and lookups took the first skin holding the name.
- **Fix:** `activeSkinName` / `rawDocAttSkin` everywhere; default can't be renamed or deleted.
- **Guard:** `tools/rigger-spike/skins-panel.mjs`, `linkedmesh.mjs`.
- **PR:** #884 (2026-09-30) · source: `docs/status/rigger-history.md`

### A linked mesh in another skin would not load
- **Symptom:** "Parent mesh not found", save refused, after ＋ Linked mesh in a non-default skin.
- **Cause:** an absent `skin` reads as `default`; the tool dropped it for the active skin.
- **Fix:** omit `skin` only for `default`, in the tool and in rig import.
- **Guard:** `tools/rigger-spike/linkedmesh.mjs` (CI on a synthetic rig, `anticipation`, `S`).
- **PR:** not recorded (2026-09-30) · source: `docs/status/rigger.md`

### A broken rig reached the rig library
- **Symptom:** importing a library rig broke every rig it was merged into.
- **Cause:** 📦 skipped 💾's full parse, and `irigDocProblem` (`riggerIrig.ts`) never resolved
  linked-mesh parents or deform / sequence keys.
- **Fix:** the library save parses first; `irigDocProblem` resolves references as the loader does.
- **Guard:** `tools/rigger-spike/irig-save.mjs` (differential vs the reference, every repo rig).
- **PR:** #832 (2026-09-28), 2026-09-30 · source: `docs/status/rigger.md`

### Event FX fired on the wrong key or not at t=0
- **Symptom:** two keys both played both bindings; a key at 0 played nothing; then the reels
  blanked (`rigBeatKey is not defined`); then a slot showed one of its two bindings.
- **Cause:** bindings keyed by event NAME; a missing import compiled as a global (build green);
  the runtime allows ONE object per slot. **Fix:** per-keyframe beats (`riggedBeatMatches`),
  listeners before the first apply, a shared slot host (`rigSlotHost.attachToSlot`).
- **Guard:** `riggedBeat.fixture.ts`, `rigSlotHost.fixture.ts`, `check:rig-fx-overrides`.
- **PR:** #549, #552 (2026-09-02) · source: `docs/status/rigger-history.md`

### A carrier rig vanished in game only
- **Symptom:** an FX-only rig played in `/rigger` and `/symbols`, and drew nothing in the game.
- **Cause:** `api/rigger/new` wrote a corrupt 1×1 placeholder PNG; `Assets.load` failed the bundle,
  so `<RigProvider>` rendered no children. Authoring tools never load the page.
- **Fix:** valid placeholder; old bundles need the page rewritten (Re-sync cannot).
- **Guard:** none; check a carrier rig in the in-game Symbol Debug grid.
- **PR:** not recorded (2026-09-01) · source: `docs/status/rigger-history.md`

### Re-sync atlas flipped rotated regions again
- **Symptom:** ⟳ Re-sync atlas left every rotated region 180° out.
- **Cause:** the `deploy/_boot/` mirror (already reoriented) was picked as the source page and
  reoriented a second time.
- **Fix:** a page we wrote from another page is never its source (`DERIVED_SUBTREE_RE`,
  `deployedPage.ts`: `editor-<kind>`, `_boot`, `_pages`).
- **Guard:** `check:deployed-page`.
- **PR:** not recorded (2026-08-20) · source: `docs/status/rigger-history.md`

### Saving a rig silently un-shipped it
- **Symptom:** a rig disappeared from `skeletons.json` (and the game) after a save or create.
- **Cause:** index writers rebuilt the index from scratch and dropped atlas-less rigs.
- **Fix:** every writer goes through `reindexProjectSkeletons` / `reindexSkeletonsPreserving`.
- **Guard:** `tools/rigger-spike/reindex-preserve.mjs`, `check:rigger-writes`.
- **PR:** not recorded (2026-07-28; 2026-09-30) · source: `docs/status/rigger.md`

### Reading snake_case trim offset every rig
- **Symptom:** after re-deploying an atlas, images in every rig were offset in a bigger region.
- **Cause:** `parseRegions` was taught the Atlas Maker's snake_case trim; frozen rig geometry was
  built on the camelCase-only reading, so the coordinate space moved under it.
- **Fix:** reverted the same day. `parseRegions` stays camelCase-only; read the `RawRegion`
  landmine comment in `editorRegions.ts` before "fixing" it.
- **Guard:** the landmine comment only.
- **PR:** not recorded (2026-07-16) · source: `docs/history.md`

### Rotated sprites drew upside down in a rig
- **Symptom:** every region packed rotated drew 180° off in the Rigger; flags and geometry right.
- **Cause:** our packers turn rotated pixels 90° clockwise; the runtime of the time read
  `rotate:90` as counter-clockwise only.
- **Fix:** `reorientRotatedRegionsForRig` (`rig.ts`) turns them in the bundle page (sheet-made
  rigs now use `rotate:270` instead). ⟳ Re-sync atlas after any re-pack.
- **Guard:** `check:rig-atlas-rotation`, `check:rig-sheet-page`.
- **PR:** not recorded (2026-06-25) · source: `docs/history.md`

### Rig bigger in game than in the editor
- **Symptom:** a Rigger rig with no authored bounds rendered larger in game than in the editor.
- **Cause:** with no natural size, bare `scale` is not WYSIWYG: the editor showed the setup pose,
  the game the playing pose at raw scale.
- **Fix:** authorable Width × Height, fitted the same way on both sides (`rigSizeScale`); Bounds is
  the frame that fills a symbol cell (`authoredRigBox`).
- **Guard:** `packages/pixi-svelte/fixtures/rigBox.fixture.ts`.
- **PR:** not recorded (2026-06-25; 2026-09-02) · source: `docs/history.md`

### A rig shipped as irig crashed the game on load
- **Symptom:** a Rigger rig bound in Symbols crashed the game: "Cannot read properties of null
  (reading 'skeleton')".
- **Cause:** the export shipped `<name>.irig` verbatim; `PIXI.Assets` picks a parser by extension.
- **Fix:** exports ship the skeleton as `.json` (`exportRigBundle`, `rig.ts`); `RigTrack` also
  falls back to the first animation. `engine-rig` reads `.irig` now; older runtimes do not.
- **Guard:** none dedicated; keep the rename in `exportRigBundle`.
- **PR:** not recorded (2026-06-14) · source: `docs/history.md`

### Headless spikes green, tool broken in the browser
- **Symptom:** mesh tools never appeared live although every spike passed.
- **Cause:** type checks used `constructor.name`; the minified vendored runtime mangles class names.
- **Fix:** test with `instanceof` (`isRegionAtt` / `isMeshAtt` in `view.html`); claim live-verify
  only after the owner checks the authed WebGL page.
- **Guard:** none; spikes bundle `engine-rig` source, so they cannot see a mangled class name.
- **PR:** not recorded (2026-06-14) · source: `docs/history.md`
