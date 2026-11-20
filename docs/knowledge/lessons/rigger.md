# Rigger — lessons

What has bitten rigger work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/rigger.md](../../status/rigger.md); this file only keeps the traps.
Covers Invisible Rigger (`/rigger`), the `.irig` format, `packages/engine-rig`, the Rig Viewer
([status/rig-viewer.md](../../status/rig-viewer.md)) and rigs placed in games. Atlas-side traps
(manifest geometry, packing) live in [atlas.md](atlas.md).
More Rigger traps: [rigger-2p5d.md](rigger-2p5d.md) (2.5D rigs, 3D motion import) and [rigger-older.md](rigger-older.md) (older ones, unchanged).

A rig placed in the Scene Editor drawing off its box (screen anchor, origin, ⊕ Centre origin)
lives in [editor.md](editor.md#a-rig-draws-in-one-place-and-selects-in-another).

### Re-keying an eased bone key made it linear and bent the ease into it

- **Symptom:** after a drag or ◆ Key on an eased bone key, the dot lost its eased look and the motion into and out of the key changed.
- **Cause:** `upsertKey` replaced the key wholesale, dropping `curve`; and bone curves hold their handles as absolute VALUES, so the neighbouring key's curve kept pointing at the old value.
- **Fix:** `upsertBoneKey` keeps the curve and maps each segment's handles from the old values to the new ones, for every bone writer.
- **Guard:** `tools/rigger-spike/rekey-ease.mjs` (vs engine-rig, 7 mutants). Constraint keys still drop theirs.
- **PR:** #1843 (2026-11-20)

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
- **PR:** #1840 (2026-11-20). Open: pasting a clip with deform keys onto a rig without that mesh is not caught.

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
