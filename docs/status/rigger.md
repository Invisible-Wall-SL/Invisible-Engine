# Invisible Rigger — status

> Design: [docs/design/invisible-rigger.md](../design/invisible-rigger.md) · Guide: [docs/tools/rigger.md](../tools/rigger.md) · Agent: [`.claude/agents/invisible-rigger.md`](../../.claude/agents/invisible-rigger.md) · Detail: [rigger-history.md](rigger-history.md)

**One-line state:** Built and shipping — bones, meshes, weights, animation (incl. image sequences
and a dopesheet stretch), localized text art and FX/flipbook event bindings are on `main`, and
rigs travel the full ship chain. Saves are conditional with 20 restorable versions. ⏳ The whole
tool still owes owner live-verify against real R2; rig editing has no undo.

## Current state

Online Spine 4.2 skeleton editor at `/rigger` (launcher-native, full-page, `rigger`-gated; static `static/rigger/view.html` + vendored `rigger-fx.js` / `rigger-text.js` bundles, cache-busted by `?v=BUILD_ID`). Reads/writes byte-valid Spine 4.2 JSON under our `.irig` extension, saved to R2 beside the artist's source. The design's build plan is on `main` except the optional Phase 6 license-free renderer (the tool and the games still use the Esoteric runtime):

- **Bones** — transform edits, canvas drag, reparent (cycle-safe), rename (rewrites every reference), add/delete; **IK / transform / path / physics constraints** (add, edit, rename, delete, dopesheet tracks).
- **Slots / skins** — draw-order reorder (the list reads top = drawn first = furthest back, and says so), region placement, add/rename/delete/duplicate, **✨ Auto FX slots**, multi-skin. An image's **pivot** is its anchor: stored inline as an inert `pivot: [u, v]` on the region attachment (fraction of the UNTRIMMED image), choosing one moves the art so that point sits on the slot position, and rotation/scale turn around it; no bone is created. A leftover `<slot>-pivot` bone from the first design folds back from the panel.
- **Image sequences** — declare a numbered atlas run as a Spine `sequence`, key it (mode / start image / hold), shown as a dopesheet track. The editor refuses any declaration that does not fully resolve against the atlas, because Spine's loader throws on it and the rig would no longer open.
- **Mesh** — region→mesh, draw-a-mesh, vertex move/add/remove, constrained-Delaunay re-triangulate, UV panel (3.6a), constraint edges (✎ Edge, 3.6b), hull promote/demote (⬡ Hull, 3.6c), isolated-mesh edit (⛶), linked meshes (a source on the same slot, in any skin). Every index-keyed store, deform timelines included, is permuted through `permuteMeshVertices` / `reorderDeform`.
- **Weights** — bind-to-bone, per-vertex numeric editing, weight brush + heatmap, and **Auto-weight to chain** (inverse-square distance to the chain's length-bearing bone segments, ≤4 influences).
- **Animation** — keyframing, dopesheet (multi-select, marquee, alt-drag duplicate, per-key and per-selection easing, **stretch about an anchor key**), graph editor, slot / draw-order / deform / sequence channels, and **timeline events** that can bind an Invisible **FX** effect and/or an Invisible **Flipbook** clip to ONE keyframe (`animation` + `time` baked as a `RigBeat`), with draw-at-slot depth, alpha / scale / delay / duration / speed and a **Continuous** flag. The stage previews FX and clips on an overlay on each side of the rig.
- **Localized text as art** — a text element is rasterised once per locale onto a second page of the rig's own atlas and placed as `<id>@<locale>` region attachments; the engine swaps attachments at mount. Opening a rig re-bakes and saves drifted text; wide translations are re-rasterised smaller to the source width. Design: [invisible-cinematic §12.4a](../design/invisible-cinematic.md).
- **Bounds** — the frame that fills a symbol cell, read where the header puts it (`authoredSpineBox`) by `/symbols`, the Scene Editor and the game (`<SpineProvider centreBox>`). A carrier rig (bindings, no art) is sized from its bound clips' declared boxes, or seeded for hand-drawing.
- **Atlas snapshot** — a bundle carries a frozen copy of its source sheet's geometry; `ensureBundleAtlasFresh` re-derives it on the read and bake paths when the source revision drifts, and **⟳ Re-sync atlas** forces it. Manifest geometry is reconciled against the TexturePacker JSON on read (never the trim).
- **Save** — `.irig` saves are ETag-conditional (a colleague's newer save prompts; the retry is `If-Match` on the version shown), refused with 422 when the rig would not load again (`irigDocProblem`), backed up to `<client>/<project>/rigger-backups/<dir>/<stem>/` (20 kept) and restorable from **🕘**; the tab warns before closing with unsaved rig or cinematic edits, and opening another rig over unsaved edits asks first. A rig that fails to open leaves no rig open — the document, the selection and the save precondition change together — so nothing can be saved under its name, while 🕘 can still restore an earlier save of it. The rig library save creates only, and refuses a rig that would not load (the tab's full parse, then `irigDocProblem`); applying or importing a library rig that would not load is refused too.
- **Libraries** — cross-project rig + animation libraries (Postgres catalog rows); copy/paste or save/load a clip, save/apply/import a whole rig.
- **Ship chain** — export → `deploy/` → bake → pull → register (owner-confirmed 2026-08-04), plus the `rigFx` / `rigFlipbooks` manifests. A rig plays its bound content wherever it is mounted (`<SpineProvider>`).

The `.irig` round-trips through the official loader (Phase 0: 120/120 skeletons). `.skel` binary is view-only. Offline suites live in `tools/rigger-spike/` (they extract the shipped functions from `view.html` and run them against spine-core 4.2).

## Open items / next

1. **Rig undo.** Only Cinematic mode has a history; it is written to be pointed at `rawDoc`.
2. **Index rebuilds can still drop an atlas-less rig.** Save uses `reindexSkeletonsPreserving`, but `rigger/new`, `rigger/delete` and `editor/spines/reindex` still overwrite `skeletons.json` from `buildSkeletonsIndex`, which skips a folder with no `.atlas`.
3. **Better auto-weights** — the proximity skinner scored poorly against artist ground truth; a geodesic/heat algorithm + a representative character-mesh gate (Spike 2) is open.
4. **Localized text** — no rename for a text element (the id is the attachment name); a text element converted to a **mesh** cannot be width-fitted (its locales are linked meshes sharing the source hull); **persistent FX slots** (an always-on, keyable emitter living on the rig, the other half of §12.4a) are unbuilt.
5. **Phase 3.6d hull-loop reordering** — the permutation primitive exists; no UI.
6. **Save residuals** — the animation-library save is still unconditional; two `＋ New rig` names differing only by case can both pass the create claim. The server's `irigDocProblem` still skips by-name references spine-core throws on: a skin's `bones` / `ik` / `transform` / `path` / `physics` lists, and an animation's IK / transform / path / physics keys, draw-order slots and event names. Both saves run the tab's full parse first, so only a 🕘 restore, a tab still running an older `view.html`, or a direct POST depends on the server check alone.
7. **Spike reds on other rigs** (the gate runs one representative rig; these are each their own
   task): `transform` shows a 0.00° constraint effect on ~12 lines rigs and "Transform constraint
   not found: particle_control2" on `mm_bg`; `synth` miscounts regions on `buy_button` /
   `multiframe` / `reelhouse_glow`; `ik` fails on `buy_button`, `fs_total_number`, `S`, `W`; the
   mesh spikes throw on `apps/price/.../symbolsSpecial`. (`delete` is green on all 153 rigs.)
8. **Bone delete is uncompensated.** Its children, its slots and any vertex weighted only to it
   move to the parent keeping their LOCAL values, so they jump by the deleted bone's own
   transform (the confirm says they move; it does not say they jump). Composing that transform
   in would keep them in place.
9. **Skins in the editor.** ＋ add image… makes the new image the slot's setup attachment, one name
   for every skin: added in a skin other than default, it leaves that slot empty in default (and
   still empty once the skin is deleted). Spine's own idiom is a same-named override in the skin —
   a behaviour decision, not a bug fix. The image placement fields (x, y, rotation, scaleX, scaleY)
   and the image pivot move the image on stage but write into the FIRST skin holding its name
   (usually default): with a skin on stage that overrides a same-named image, default's moves, and
   the one on stage snaps back at the next rebuild (`applyAttachmentEdit`, `pivotRawDef`, probed).
   Replace image falls back to that first skin too, not to default, when the skin on stage has no
   image of that name (it matters only with default listed after another skin holding one).
   Deleting the default skin is still allowed while another exists, though a rig without one draws
   nothing in a game that sets no skin (renaming it is refused for that reason).
10. **＋ Linked mesh onto a sequence mesh** copies its `path` (the sequence base) but not its
    `sequence`, so the linked mesh shows placeholder art. **▸ Convert to mesh on a sequence image**
    drops its `sequence` the same way: the mesh names the sequence's base, which the atlas does not
    have, so the image turns into placeholder art (probed).
11. **Stage errors are half hidden.** The error bar (`#err`) sits under the floating mode bar
    (both at `top: 47px`, the bar on `z-index` 5), so the middle of every stage error is covered
    at usual widths — a failed open's missing mesh name, a refused save's reason.
12. **A mesh made from a trimmed image is mapped wrong.** A region's quad covers only its trimmed
    ink, but a mesh's UVs span the untrimmed canvas, and ▸ Convert to mesh and ✎ Draw mesh both lay
    UVs across the ink's quad as if it were the canvas: the whole canvas is squeezed into the ink's
    box, drawing whatever the atlas packs beside the ink with it (probed: the ink of a 40×40 image
    trimmed to 20×10 is drawn at half its width and a quarter of its height). 14 of
    `anticipation`'s 24 regions are trimmed, 163 of `symbols2`'s 204. `linkedmesh.mjs` compares
    texels on untrimmed images only.

## Blocked (owner / external)

- **Whole-tool live-verify** is owner-driven — the vendored minified runtime has surfaced browser-only bugs the headless spikes (un-mangled spine-core) missed. Specifically owed: a real save / conflict / restore against R2; baked rig text on screen in a game; the UV panel's rotated-region blit; rig FX slot depth in a published game.
- **No lossless desktop-Spine `.spine` project round-trip** — an Esoteric limitation (desktop Spine can only _import_ our JSON).

## Recent changes

Detail for every entry below from 2026-07-16 on is in [rigger-history.md](rigger-history.md).

- 2026-09-30 — **▸ Convert to mesh and ✎ Draw mesh rewrite the image the stage shows.** They
  rewrote the first skin holding the image's name, usually default: with a skin on stage that
  overrides a same-named image, default's became a mesh of the other skin's quad and the stage did
  not change. Both now take the skin on stage's image if it has one, else default's
  (`rawDocAttSkin`, which `rawDocAttEntry` reads too); rig-text locale linking and the path / tint
  carry-over are unchanged. `linkedmesh.mjs` runs both, shipped, with each skin of a synthetic rig
  on stage and on every slot of the CI rigs that shows an image, from an empty and an overriding
  skin; the previous `view.html` fails 14, 266 and 150 of its checks. Found, not fixed: the
  placement fields, the pivot and replace image look up the same wrong skin (open item 9), Convert
  drops a sequence image's frames (open item 10), and a mesh made from a trimmed image is mapped
  wrong (open item 12).

- 2026-09-30 — **A rig that fails to open leaves no rig open — 💾 can no longer save one rig's
  content under another's name** (was open item 11). Opening S, then a rig that failed to load
  (e.g. "Parent mesh not found"), left S's document open under the failed rig's selection and
  `.irig` ETag, so 💾 overwrote the failed rig's `.irig` with S (the precondition passed), 📦
  offered S to the library under its name and ⤓ downloaded S as it. The open rig is now closed
  before anything is fetched, and a failed open leaves nothing: ⤓ .irig, 💾 and 📦 are disabled,
  🕘 stays available to restore an earlier save of the failed rig (the repair), and a failed rig
  is not what the next visit reopens. Opening a rig from the list, ＋ New rig and upload now ask
  before discarding unsaved edits (the list click never asked). A save, a restore or a text
  document answering after a switch no longer lands on the next rig.
  `tools/rigger-spike/rig-switch.mjs` (37 checks, real page in Chromium; the old page fails 20).
  Found, not fixed: open item 11 (stage errors half hidden).

- 2026-09-30 — **A rig that will not load can no longer reach the rig library, or leave it.**
  📦 Save rig to library skipped the full parse 💾 Save runs, and the server's `irigDocProblem`
  (behind both saves and the 🕘 restore) never resolved a linked mesh's parent or an animation's
  deform / sequence keys, so a broken rig could be saved to the library and break every rig it was
  imported into. The library save now runs the tab's full parse before asking for a name, and
  shows a server refusal as text rather than raw JSON. `irigDocProblem` resolves both references as
  SkeletonJson does — a linked mesh's parent on its own slot, in the skin its `skin` names (none =
  the LAST skin named `default`, a name = the FIRST skin with it), and a mesh; an animation's skin,
  its slot, and the attachment whenever a deform or sequence key reads it, which must then have
  vertices (deform) or a declared sequence (sequence). A library rig saved before these checks is
  refused when applied to a new rig (422, before anything is written) and when imported (the merge
  is tried on a copy; the open rig is left untouched). The import also dropped the imported rig's
  event definitions, so a rig with FX / flipbook bindings (event keys) broke the rig it was merged
  into; its events now come along under the prefix (`rigmerge.mjs`).
  `tools/rigger-spike/irig-save.mjs` pins each rule against spine-core on a synthetic rig and on
  every checked-in rig (all 153 load and pass, `S`'s 180 linked meshes included). The references
  it still skips are open item 6; a failed rig switch found in review is fixed in the entry above.

- 2026-09-30 — **The Skin picker lists the rig's skins as they are, and every edit lands in the
  skin on stage.** The picker's options were built once, when the rig opened, and a `<select>`
  reads back `""` for a value no option carries: in a skin added, renamed or imported since,
  ＋ add image… wrote into the first skin, the slot's attachment list showed default's, and the
  rebuild after the edit put the default skin back on stage. The picker is now re-rendered with
  the inspector from the skins the rig has, edits read the skin on stage (`activeSkinName`), and
  the rebuild keeps that skin on stage, a renamed one included. ＋ add image… takes its placement
  from the image the slot shows (default's, in a new skin — it used to find none). ＋ path drawn in
  such a skin could replace a path of the same name (the linked-mesh hazard again); it sees the
  right skin now too. `linkedmesh.mjs` runs the shipped rebuild and picker; the new
  `skins-panel.mjs` drives the real page in Chromium (36 checks; the old page fails 22);
  `sequence.mjs`, which had gone vacuous, puts its skin on stage again. Found, not fixed: open
  item 9.

- 2026-09-30 — **Linked meshes added or re-pointed in a non-default skin now load.** Spine reads
  a linked mesh's absent `skin` as the DEFAULT skin; ＋ Linked mesh and the source picker omitted
  it whenever the parent was in the ACTIVE skin, so with any other skin active the rig stopped
  loading ("Parent mesh not found", save refused) or silently bound default's same-named mesh.
  `skin` is now omitted only for `default`, and the same model is fixed in rig import (every
  Spine-exported linked mesh relies on the implicit default, which import renames — `S` has 180)
  and in the source the picker shows. The source list is the selected slot's meshes: Spine never
  finds a parent on another slot. A skin rename now carries the animations' deform keys, and the
  default skin can no longer be renamed (without one, a game that sets no skin draws nothing). A
  new attachment can no longer take the name of one in its own skin that the stale top-bar picker
  hid (it replaced an imported rig's source mesh). `tools/rigger-spike/linkedmesh.mjs` (CI: a
  synthetic rig, `anticipation`, `S`); `rigmerge.mjs` now runs the shipped import.

- 2026-09-30 — **Deletes no longer leave a rig that will not open.** Deleting a path
  constraint's target slot broke the load ("Couldn't find target slot") in 72 of the 153
  checked-in rigs, `symbols/l3` included, so the save was refused with a 422. Bone, slot,
  attachment, skin and constraint deletes now go through one cascade (`dropConstraints`) that
  removes every IK / transform / path / physics constraint that can no longer work, its keys and
  its skin-list entries, re-packs `order`, and names what went in a notice. It also remaps weighted
  path / clipping / bounding-box indices, keeps weighted deform keys aligned, turns an orphaned
  linked mesh into a plain mesh (a deleted parent broke `S`) and rebuilds draw-order keys (a slot
  delete left a hole in `mm_bg` / `W`'s animated order). `tools/rigger-spike/delete.mjs` now
  runs the shipped functions (the old copy had drifted, hence the `l3` red) on a synthetic rig
  with every constraint kind, plus every bone / slot / path attachment of the given rig.

- 2026-09-30 — **The rigger spikes are a CI gate** (`Checks` workflow, `pnpm check:all`): every
  spike with a usage line runs; the per-rig ones against `apps/lines/.../anticipation` (regions, a
  weighted multi-influence mesh, an unweighted mesh, 12 path constraints), plus `W` for `sequence` /
  `meshremove` and `S` for `retriangulate`. 59 runs, all green. Four harnesses had drifted, none
  over a bug in shipped code:
  - **`brush` / `weights`** assumed re-weighting a vertex never moves it. That holds only when its
    per-bone offsets agree; a bone moved after binding leaves them up to 20 px apart (l1–l4), and
    keeping the bind pose — what `view.html` does, and what Spine does — must then move the vertex
    by `Σ Δwᵢ·pᵢ`. Both now PREDICT the landing point from the pre-edit data and assert it to 1e-3,
    which is stricter than the old `< 0.01` (a 0.05 offset corruption now fails).
  - **`rigtext-browser` / `rigtext-panel`** mocked the pre-7ac812b8 strings shape, asserted a width
    growth eac50ae6 removed on purpose, and mocked a save without #832's conditional GET (so the
    re-bake hung 40 s). They also never found Chromium on Linux; `CHROME_PATH` comes first now.
    34/34 and 50/50.

- 2026-09-29 — **Docs caught up**: the guide documents **Auto-weight to chain** (it said auto-weights were not built) and the current localized-text behaviour (every translation baked, auto re-bake on open); the design doc's §0/§9 now point here for progress. Status detail split into [rigger-history.md](rigger-history.md).
- 2026-09-28 — **Multi-author-safe `.irig` save** (#832, live `dd31c4f4`): conditional save with
  an `If-Match` retry on the version shown, project mismatch refused, pre-save validation on both
  sides (422), 20 rolling backups + 🕘 restore through the same guarded write, beforeunload guard,
  create-only rig library save. `tools/rigger-spike/irig-save.mjs` agrees with spine-core on every
  reference break across all 153 checked-in skeletons.
- 2026-09-24 — **Image sequences are authorable.** A declaration that does not resolve is refused
  by name; `makeAttachmentLoader` substitutes a placeholder per missing frame. An absent `delay`
  inherits while `0` holds, `start` is whatever number the first region carries, and removing a
  declaration must remove its timeline. Keys go only into a skin that declares the sequence.
  `tools/rigger-spike/sequence-all.mjs` (153 rigs).
- 2026-09-23 — **Dopesheet stretch about an anchor key**, and the `sequence` timeline became a
  track. A sequence `delay` is seconds per sub-frame and is inherited, so any retime must rescale
  it; bezier `curve` control times are refitted (`fitKeyCurve`); `retimeTrackKey` drops a key it
  lands on, so the apply order is farthest-first when spreading and all remaps precede all retimes.
  `stretchAnimation` now walks every timeline kind (`scaleKeyTimes`). A plain click must not
  rebuild the timeline DOM (Chrome drops the click, killing double-click-to-delete).
- 2026-09-23 — **The pivot is an image anchor, not a bone.** The first version moved or added bones;
  reworked after owner feedback so nothing touches the skeleton. That first version's lesson still
  applies elsewhere: weighted vertices name bones by positional INDEX, so a slot depends on bones it
  never names. The ＋ Add constraint buttons were dead because `selectBone` never refreshed the
  panel (now `renderConstraintTools()`), and disabled buttons now look disabled.
- 2026-09-18 — The rig FX preview was offset at 150% zoom (`resolution` without `autoDensity`) —
  fixed in the shared overlay factory; see [symbols.md](symbols.md).
- 2026-09-04 — **Bound FX / clips play wherever the rig is mounted** — the join moved into
  `<SpineProvider>` ([fx status](fx.md)).
- 2026-09-03 — **Carrier-rig content draws at its authored size in game** — bound content is scaled
  by the host bundle's load scale ([engine status](engine.md)).
- 2026-09-02 — **The Bounds box is the frame that fills a symbol cell, centred, everywhere.**
  Consumers had assumed an origin-centred box; `authoredSpineBox` is now the one reading and a
  centred box pivots at (0,0) (parity). `packages/pixi-svelte/fixtures/spineBox.fixture.ts`.
- 2026-09-02 — **An event binding is one KEYFRAME, and a key at t=0 plays.** The manifest was keyed
  by event NAME; bindings now carry the beat (`riggedBeatMatches`). The rigged players attach their
  listeners during init, before `<SpineTrack>`'s first apply fires frame-0 events. Follow-ups: a
  missing import shipped green (a bare template identifier compiles as a global) and blanked the
  reels; spine-pixi allows ONE object per slot, so bindings share a host
  (`spineSlotHost.attachToSlot`).
- 2026-09-01 — **Carrier rigs**: sized from their bound clips (`computeRigBounds` third tier;
  `SPINE_FALLBACK_NATURAL_SIZE` is the one fallback), previewed without the mirror
  (`fxMatrix` strips the reflection), and shipped with a decodable placeholder page (the old one
  was a corrupt PNG, so the whole bundle — and its bindings — failed to load in game only).
  Rebuild `rigger-fx.js` (`pnpm --filter launcher-api build:rigger-fx`) after any
  `fxOverlay.client.ts` edit.
- 2026-08-31 — **A rig event can play a Flipbook clip** (`event.flipbook`, baked as
  `rigFlipbooks`), on the same code path as FX. Frames are cut by `flipbookFrames.client.ts`
  honouring rotation, trim, declared box and direction (`check:flipbook-frames`).
- 2026-08-27 — **FX bindings gained depth and modifiers** (`slot`, alpha/scale/delay/duration/
  speed, `continuous`; one clamp, `readRigFxOverrides`), and the stage became able to show them: the
  WebGL context is `premultipliedAlpha: true` and clears transparent, with an FX overlay on each
  side of the rig. Preview mode runs the event crossing too, using `getAnimationTime()`.
- 2026-08-25 — **The text fit now sticks**: attachment size is the tool's (refreshed every bake),
  placement is the author's. Meshed text cannot be fitted (open item 4).
- 2026-08-20 — **⟳ Re-sync atlas flipped rotated regions**: the `deploy/_boot/` mirror was picked
  as the source page. Derived subtrees (`editor-<kind>`, `_boot`, `_pages`) can never be a
  page's source (`check:deployed-page`).
- 2026-08-18 — **Localized text follows `/localization` on its own** (auto-sync on open, bake saves
  the rig, every translation baked); text is fitted to the source width; the rasteriser pads to
  the ink so glyph overhangs are never cut. Imported JSON omits `time` at 0 — normalised on load
  (`normalizeKeyTimes`).
- 2026-08-17 — **Text as localized art in the rig** — the text page lives in the rig's own atlas
  (derived from `<bundle>/text.json` on every synthesis, hashed into the bundle revision); the
  engine swaps only to a sibling `<base>@<locale>` that exists.
- 2026-08-10 — **Stale manifest geometry is reconciled against the TexturePacker JSON on read**
  (placement + rotation only — never trim).
- 2026-08-04 — Phase 3.6a–c (UV panel, constraint edges, hull promote/demote) and ship-from-Rigger
  closed (owner-verified).
- 2026-07-28 — **Save can no longer silently un-ship a rig** (`reindexSkeletonsPreserving`); the
  other index writers are open item 2.
- 2026-07-16 — **Rig + animation library catalogs are Postgres rows**, not a shared R2 blob.
- 2026-07-16 — **reverted** the same day's `parseRegions` snake_case trim read: it re-based the atlas coordinate space under every rig's frozen geometry. `parseRegions` is deliberately camelCase-only — read the landmine comment on `RawRegion` before "fixing" it again ([detail in history](../history.md)).
- 2026-07-16 — "＋ add image…" inherits the slot's setup placement; "replace image (keep mesh)…" re-derives `width`/`height` from the new region ([detail in history](../history.md)).
- Before 2026-07-16 — FX overlay with the full bone transform, `?v=BUILD_ID` cache-bust, the event-key inspector, Auto FX slots ([history](../history.md)).
