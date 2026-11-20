# Rigger — lessons

What has bitten rigger work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/rigger.md](../../status/rigger.md); this file only keeps the traps.
Covers Invisible Rigger (`/rigger`), the `.irig` format, `packages/engine-rig`, the Rig Viewer
([status/rig-viewer.md](../../status/rig-viewer.md)) and rigs placed in games. Atlas-side traps
(manifest geometry, packing) live in [atlas.md](atlas.md).

A rig placed in the Scene Editor drawing off its box (screen anchor, origin, ⊕ Centre origin)
lives in [editor.md](editor.md#a-rig-draws-in-one-place-and-selects-in-another).

### `view.html` committed with CRLF came back as a whole-file conflict

- **Symptom:** after a branch switch, the merge of `main` conflicted as one block over all of `view.html`.
- **Cause:** the file holds 3 literal NUL bytes, so `* text=auto` treats it as binary and never normalises it; a CRLF working copy is committed as it is.
- **Fix:** convert it back to LF and commit only that.
- **Guard:** before pushing, check `git show HEAD:apps/launcher-api/static/rigger/view.html` has no CRLF.
- **PR:** found in #1839 (2026-11-20)

### A mesh's shape froze, leaked into Setup and played differently in the game

- **Symptom:** deform keys could not be made (◆ Key / ✕ Key ignored them) and drew as slot keys; a mesh you were not on froze while scrubbing, Setup showed the animated shape, a shape popped in later than in the game.
- **Cause:** Animate wrote setup + offset into the live attachment's `vertices` (shared with Setup and linked meshes), for `meshCtx` only, sampling the first key before it; engine-rig poses `slot.deform` for every keyed attachment.
- **Fix:** `poseDeforms` poses every deform timeline into `slot.deform`; `deformTarget` resolves the skin and linked-mesh source; key buttons, slot panel and dopesheet row cover shapes.
- **Guard:** `tools/rigger-spike/deform-keys.mjs` (vs engine-rig, 16 mutants), `deform-keys-browser.mjs` (6).
- **PR:** #1840 (2026-11-20). Open: re-keying a bone key drops its easing; pasting a clip with deform keys onto a rig without that mesh is not caught.

### A renumbering mesh edit left a linked mesh's own deform keys behind

- **Symptom:** after − Remove vertex, ⟁ Re-triangulate (merge / outside-drop) or ⬡ promote/demote, a `timelines: false` linked mesh deformed the wrong vertices; the rig still loaded.
- **Cause:** `meshDeformArrays` (`view.html`) collected only the edited mesh's timelines; a linked mesh's own keys index its source's vertices, and engine-rig's `readDeform` pads or truncates silently.
- **Fix:** it also collects the own timelines of every linked mesh on the slot, in any skin, whose source is the edited mesh.
- **Guard:** `tools/rigger-spike/linkedmeshdeform.mjs` (12 mutants). Rule: a store keyed by a mesh's vertex index includes its linked meshes' keys.
- **PR:** #1838 (2026-11-20)

### A motion-import spike could not load, and the mesh gates broke on a new call

- **Symptom:** spikes died with "Identifier 'RIG_HISTORY_LIMIT' has already been declared", "Cannot access 'PC_SIM' before initialization", or `repairsKept` declared twice, after a change that touched no mesh code.
- **Cause:** the `pull()` the rigger spikes copy ends a `const` at the next column-0 `};`, so a `const X = [` array swallowed later declarations; chunks joined in discovery, not page, order. A new call from `rebuildFromRawDoc` to a panel renderer reached hundreds more functions.
- **Fix:** close on the bracket the first line opens and sort chunks by source position (`meshreset.mjs`); keep what `rebuildFromRawDoc` calls small (`fitControlsToRig`), stubbed in the mesh gates.
- **Guard:** the gates; before adding a call to a function the gates pull (`rebuildFromRawDoc`, `selectBone`, `markDirty`) run `check:all --only tools/rigger-spike`.
- **PR:** #1833, #1831 (2026-11-20)

### "Back to the image" put the image one drag-length off

- **Symptom:** ▭ placed the image off after a corner was dragged, a point was ＋ added into a dragged triangle, or the image was moved before converting.
- **Cause:** placement read off the mesh's points alone is ambiguous (one dragged corner leaves three points fitting two maps; an added point out-votes the image); "the image it was converted from" goes stale; 1e-3 right-angle tolerance passed a dragged-corner map.
- **Fix:** the converted-from image wins only while three non-collinear points still sit on it, else a majority over current + saved points, right angles at 1e-5; off without a majority (`imagePlacement`).
- **Guard:** `meshreset.mjs` (every save state × corner × edge; a mutant per evidence source), `meshreset-browser.mjs`.
- **PR:** #1833 (2026-11-20)

### A browser gate's planted mutant passed, and a second save passed without saving

- **Symptom:** a mutant dropping the save's `rawDocSaved` update passed; a check that the second 💾 was conditional on the first ETag passed while no save happened.
- **Cause:** the fake endpoint answered `saved: true`, which the real one sends only when the write landed but the reindex failed; the Save button is disabled for 1.5 s after a save, so a scripted `.click()` did nothing.
- **Fix:** the fake answers as the endpoint does (reindex-failed is its own step); call `saveToR2()` and wait on the new ETag, then assert the post count.
- **Guard:** `meshreset-browser.mjs --mutants`; `rig-control-shapes-browser.mjs` asserts one post per save.
- **PR:** #1833, #1831 (2026-11-20)

### A 60° tilt on a 2.5D arm left it at full length

- **Symptom:** tilt typed on a template's arm foreshortened nothing.
- **Cause:** template bones keep x at 0° and hang their child below (−y), so a tilt about the bone's y axis turned the arm about its own length.
- **Fix:** tilt and twist are read about the bone's length (`orientAlong` / `anglesAlong`): its x axis, else the direction to its first child.
- **Guard:** `check:rig3d` "a bone whose length runs along −y tilts its length toward the viewer"; the browser gate's foreshortening check.
- **PR:** #1834 (2026-11-20)

### Per-tab 3D state beside the undo history sent the wrong save

- **Symptom:** (caught before shipping) after undoing ⇲ Detach, a save sent the 3D clip without `resolve: rebake`; deleting a bone's last 3D key would take the last bake's keys.
- **Cause:** the "re-keyed" set and the owned bones lived beside the history, not in it.
- **Fix:** derive them: the save asks for every 3D clip; owned bones are re-read from the restored state on undo (`bake3dReset`).
- **Guard:** the browser gate's detach-undo-edit and save checks (mutants "undo keeps the cache", "the save asks for no re-bake").
- **PR:** #1834 (2026-11-20)

### A 3D clip's fingers drew off their pose though the bake met its tolerance

- **Symptom:** fingers or face parts keyed in 2D under a turned bone were 0.80 off against 0.45 allowed.
- **Cause:** the bake widens a baked bone's error card over its flat descendants' motion read from `clip.bones`, but `clipOf` only put the 2D keys of the bones the baked ones hang from, so flat leaves were measured at setup.
- **Fix:** `clipOf` also carries the flat bones' rotate / translate / scale keys (`flatBonesOf`), refuses their other timelines, never owns them.
- **Guard:** `check:rig3d` §7 (a curling finger under a turned hand), `check:rigger-writes`.
- **PR:** #1836 (2026-11-20)

### Hands of a 3D import floated off the forearms in the Rigger only

- **Symptom:** "the hands seem completely discarded": finger clusters 30–685 units off the forearms; the game was right. Also the hands pointed 9–37° off the tracked hand.
- **Cause:** `poseAtTime` (`view.html`) skipped one-axis timelines, but the bake keys `sheary` on every bone it owns; and `rigMotion3d` used Pose Landmarker's coarse hand points.
- **Fix:** `poseAtTime` plays `BONE_AXIS_TIMELINES`; `Bone3dPoints.hand` reads the hand's picture direction from the hand found on its wrist, depth from the pose.
- **Guard:** `motion-3d.mjs` (page pose = engine-rig; hand to the tracked hand), `keydefaults.mjs` (split channels).
- **PR:** #1837 (2026-11-20)

### The first 3D motion import pointed the arms 2–5° off the video

- **Symptom:** arms off the video by 2–5° median, where the 2D import followed at 0.4°.
- **Cause:** MediaPipe's world points are a separate 3D estimate; their x and y do not project onto its picture points.
- **Fix:** read x, y from the picture (at the frame's pixels per metre) and only depth from the world points (`rigMotion3d.ts`).
- **Guard:** `motion-3d.mjs` (3D points skewed 8° from the picture).
- **PR:** #1829 (2026-11-20)

### A 3D import baked 81 bones and took 7 s for 4 s of footage

- **Symptom:** fingers and face parts with no motion of their own took 70–100 keys each.
- **Cause:** the bake keyed every bone under a 3D-turned one, re-keying a flat child to correct its parent's interpolation error (`rig2p5d.ts`).
- **Fix:** a bone flat in its parent's card keeps its 2D keys; the baked parent sizes its error floor over the flat art (`flat`, `reachOf`).
- **Guard:** `motion-3d.mjs` (flat bones not owned); `rig-2p5d.mjs` `[hinged]`.
- **PR:** #1829 (2026-11-20)

### On real footage a hinged arm and a shoulder-turned chest baked 66,070 keys

- **Symptom:** 30 s of the bridge shot: 66,070 keys, 7,608 runs past tolerance.
- **Cause:** a hanging arm's bend plane and a side-on chest go edge-on several times a second; every non-flat bone under an edge-on card pays 1/σ keys and a step (`rigTemplates.ts` 3D maps).
- **Fix:** limbs and hands roll to face the viewer; the body's bones face the viewer and only the torso image takes the turn (13,047 keys, 238 past).
- **Guard:** none (measured, not gated); re-measure on the T10/T11 captures when a template's 3D map changes.
- **PR:** #1829 (2026-11-20)

### A camera cut drew the upper body below the hips for a second

- **Symptom:** a 3D import of the bridge shot drew the whole upper body below the hips.
- **Cause:** across a cut the tracker found a body with hips above shoulders; a 3D turn has no channel range to clamp it as the 2D controls did.
- **Fix:** a `bone3d` entry's `reach`; a reading past it is a gap, held and reported (spine / hips 60°, chest 30° more).
- **Guard:** `motion-3d.mjs` (a body upside down for six frames holds upright and is reported).
- **PR:** #1829 (2026-11-20)

### An added constraint silently never ran, or switched another off

- **Symptom:** ＋ Add IK on `W` moved its bones 15.7 units at mix 0; ＋ Add transform did nothing.
- **Cause:** engine-rig runs ONE constraint per `order` in 0..count−1; the adds (`view.html`) took
  `order` = the count of their own kind. A clash loads, so `irigDocProblem` let it through.
- **Fix:** the next free order across all four kinds; re-packs keep what runs; 🩹 Repair is the
  author's click; `saveRig` refuses a gained clash (`gainedOrderClashes`).
- **Guard:** `rig-controls.mjs`, `check:rigger-writes` `order:`, `rig-order-browser.mjs`.
- **PR:** rig-controls K0 (2026-11-20)

### A 2.5D step keyed on the dense grid played the wrong side

- **Symptom:** the 2.5D bake (`src/lib/rig2p5d.ts`) reported an unmet run of 80 units at a stepped
  3D key at 2.2 s; the spike's flips (never on the grid) had not shown it.
- **Cause:** the step's key time is a float32 (`fround(2.2)` > 2.2), so the dense key at exactly
  2.2 counted as inside the run before the step, yet it was read after the jump. Two steps under
  2 µs apart likewise read their limits across each other.
- **Fix:** a run's inner keys lie strictly between its two limit samples; steps closer than their
  limits are one; checks inside a step's float32 window are not counted; a refinement key the float32
  times cannot place is reported unmet, not dropped.
- **Guard:** `rig-2p5d.mjs` `[curves]` (a stepped tilt on a grid time, every run met).
- **PR:** rig-2p5d P1 (2026-11-20)

### An imported elbow sat at its edge on most frames

- **Symptom:** after a 🎥 Motion import the forearms hardly moved: Bend elbow held at its edge on
  62–90% of frames, the forearm 20–50° off the video.
- **Cause:** not a flip, a mirror or world space. In the picture, a hanging arm bringing the hand in
  front of the body bends its elbow _inward_ (on 58–100% of real frames); which way a 3D hinge
  bends on screen depends on the upper arm's roll, an axis a 2D bone lacks. The template let it
  bend 140° outward and 42° in.
- **Fix:** the elbow reaches ±168° both ways (range only; travel unchanged, so every key keeps its
  meaning). A reading clamped most of the time is a geometry question first: measure the raw angle's
  distribution on footage before touching gains or ranges.
- **Guard:** `tools/rigger-spike/motion-follow.mjs` poses bent-in / bent-out / folded arms through
  engine-rig and compares each bone with the picture; the reference overlay shows it by eye.
- **PR:** rig templates T11 (2026-11-20)

### "Fixes" that scaled every frame to absorb a few

- **Symptom:** with auto-range on the body, a hand followed the video worse (p90 13° → 26°).
- **Cause:** a body reading is a direction in the picture; scaling one side of the range to take
  in its 2% outliers turns every frame on that side. Outliers there are mostly noise (side-on
  shoulders, someone else's hand), better dropped at the source.
- **Fix:** auto-range only where a reading's shape matters more than its size (face, hand curls),
  off by default on the body; noisy readings get a `minSpan` or a guard instead.
- **Guard:** `motion-follow.mjs` (body parent fitted, child still follows); the import report lists
  what was scaled.
- **PR:** rig templates T11 (2026-11-20)

### A draw-order key froze the tab

- **Symptom:** a draw-order key naming one slot twice hung the Rigger tab for good (the Controls
  panel rebuilds the key on any template with a depth control).
- **Cause:** `view.html` copied SkeletonJson's `while (oi !== o.i)` rebuild three times; a repeated
  slot puts `o.i` behind `oi` so it never ends, and an out-of-range offset writes past the order.
- **Fix:** one `drawOrderOfOffsets` (`<` loop; a repeated slot, out-of-range or taken offset is
  dropped) always returns every slot once. engine-rig's readers still have the loop.
- **Guard:** `check:rig-templates` runs the three in a VM with a 1 s timeout on malformed keys.
- **PR:** #1807 (2026-11-20)

### A missing optional image keyed an empty slot

- **Symptom:** on art without `brow_l_angry`, an angry brow (from a clip, a slider or 🎥 Motion)
  keyed the brow slot empty: the brow vanished. A ¾ torso swap would have hidden the torso.
- **Cause:** a swap step the art lacked fell back only to steps below it; a step below the
  control's rest (angry, a left-facing view) had none, so the key named nothing.
- **Fix:** fall back toward the rest step first (`faceSwapPart` in `view.html`, `swapPart` for the
  pose check), then below it as before; values at or above the rest key what they did.
- **Guard:** `motion-depth.mjs` (¾ / side torso art missing); `check:rig-templates` (below step 1).
- **PR:** rig templates T10, depth (2026-11-19)

### A deleted rig's folder never went away

- **Symptom:** deleting a rig made from an atlas, or with baked text, left its page, `.atlas` and
  sidecars in R2 for good; found when a template rig's `template.json` outlived its delete.
- **Cause:** the delete purges a bundle only when no skeleton is left, and counted every `.json`
  as a skeleton, so the bundle's own `source.json` / `text.json` / `template.json` kept it alive.
- **Fix:** those sidecars are named in the delete route and do not count as skeletons.
- **Guard:** `check:rigger-writes` "deleting the rig takes its template.json with it".
- **PR:** rig templates T1 (2026-11-17)

### Older traps, folded (symptom — cause — fix — guard · PR)

- **Preview played a different pose from the game** — rig JSON omits key values and `time` at their defaults; `view.html` read 0 / `undefined` — `fillKeyDefaults` + `normalizeKeyTimes` at open, import, merge — `keydefaults.mjs` · #1278.
- **A rig anchor moved icons half a box off-centre** — `<RigProvider anchor>` used the sprite rule, rig space is skeleton space — anchor is a point of the Bounds frame (`rigFramePivot`) — `rigBox.fixture.ts` · #1274.
- **Graph editor drew a sharp V where the bone eased** — `graphValueAt` sampled each field alone — samples the channel's whole field list — `graphcurve.mjs`.
- **Rig pages tripled a game's texture download** — rotated regions turned into a private lossless page per rig — `bundleSheetPage` ships the sheet's page with `rotate:270` — `check:rig-sheet-page`, `check:rig-atlas-rotation`.
- **Rig parity gate red for nine days** — a header without `hash` / `spine`: the reader wrote `null` — copy fields as written; the gate runs in CI (advisory) — `.github/workflows/rig-parity.yml`; run all four `tools/rig-parity/` gates on any `engine-rig` change · #1107.
- **Bound FX drew under the rig in the Rigger only** — two overlays each took "the new canvas" and the second took the first's — each band mounts in its own host with its z-index (`.fxBand`) — none · #1222.
- **FX forces played everywhere but the Rigger** — committed `vendor/rigger-fx.js` / `rigger-text.js` not rebuilt — rebuild after any `fxOverlay.client.ts` or `engine-rig` edit — `check:vendored-bundles`.
- **The rig rename rewrote R2 paths that never moved** — blanket "spine → rig"; bundles stay under `spines/` and `_shared/spines/` — rename display names only, never a stored key, prefix or route (`'spine'` node kind, `skeleton.spine`, `winSpine`) — none · #1107.
- **A mounted rig drew nothing until it played** — `RigView` diverged from the reference on slot-object order and posing — full bone matrix, slot alpha, no pose until first `update` — `rig-parity/render.mjs --slot-objects --fresh` (manual).
- **Deleting a bone or slot broke or moved the rig** — constraints, weighted indices, linked meshes, draw-order keys left dangling; children kept local values — one cascade (`dropConstraints`) plus a delete that composes the bone's transform in — `delete.mjs` · #877.
- **Auto FX slots broke an image-sequence slot** — the duplicate's `path` was re-aimed at the FX region — Auto FX skips sequence layers; `repointSlotSetupImage` refuses a sequence — `sequence.mjs`.
- **A mesh from a trimmed image was squeezed** — UVs are fractions of the UNTRIMMED image — map through the ink's place (`regionInkUVs`), 🩹 Repair for old meshes — `trimmesh.mjs`.
- **An image packed at 180° draws upside down** — `RegionAttachment.updateRegion` undoes 90 / 270, not 180 — none yet (item 13); re-pack without 180° — none.
- **Save wrote one rig's content under another's name** — a failed open left the old document under the new selection and ETag — close before fetching; a failed open disables 💾 / 📦 / ⤓ — `rig-switch.mjs`.
- **Edits landed in the default skin** — a stale skin `<select>` read `""` — `activeSkinName` / `rawDocAttSkin` everywhere — `skins-panel.mjs`, `linkedmesh.mjs` · #884.
- **A linked mesh in another skin would not load** — an absent `skin` reads as `default` — omit `skin` only for `default` — `linkedmesh.mjs`.
- **A broken rig reached the rig library** — 📦 skipped 💾's full parse; `irigDocProblem` never resolved linked-mesh parents or deform / sequence keys — parse first, resolve as the loader does — `irig-save.mjs` · #832.
- **Event FX fired on the wrong key or not at t=0** — bindings keyed by event NAME; a missing import compiled as a global; one object per slot — per-keyframe beats (`riggedBeatMatches`), shared slot host — `riggedBeat.fixture.ts`, `rigSlotHost.fixture.ts`, `check:rig-fx-overrides` · #549, #552.
- **A carrier rig vanished in game only** — `api/rigger/new` wrote a corrupt 1×1 placeholder PNG, failing the bundle — valid placeholder; rewrite old pages — none; check the in-game Symbol Debug grid.
- **Re-sync atlas flipped rotated regions again** — the `deploy/_boot/` mirror was picked as the source page — a derived page is never a source (`DERIVED_SUBTREE_RE`) — `check:deployed-page`.
- **Saving a rig silently un-shipped it** — index writers dropped atlas-less rigs — every writer goes through `reindexProjectSkeletons` / `reindexSkeletonsPreserving` — `reindex-preserve.mjs`, `check:rigger-writes`.
- **Reading snake_case trim offset every rig** — `parseRegions` taught the Atlas Maker's trim moved the space under frozen geometry — reverted, camelCase only; read the `RawRegion` landmine in `editorRegions.ts` — none.
- **Rotated sprites drew upside down** — packers turn pixels clockwise, the old runtime read `rotate:90` as CCW — `reorientRotatedRegionsForRig`, later `rotate:270` — `check:rig-atlas-rotation`, `check:rig-sheet-page`.
- **Rig bigger in game than in the editor** — bare `scale` is not WYSIWYG — authorable Width × Height fitted alike (`rigSizeScale`; `authoredRigBox`) — `rigBox.fixture.ts`.
- **A rig shipped as `.irig` crashed the game** — `PIXI.Assets` picks a parser by extension — exports ship `.json` (`exportRigBundle`) — none; keep the rename.
- **Headless spikes green, tool broken in the browser** — type checks used `constructor.name`, mangled in the vendored runtime — `instanceof` (`isRegionAtt` / `isMeshAtt`); claim live-verify only after the owner checks the authed page — none.
