# Invisible Rigger — status

> Design: [docs/design/invisible-rigger.md](../design/invisible-rigger.md) · Guide: [docs/tools/rigger.md](../tools/rigger.md) · Agent: _none yet_

**One-line state:** _(2026-09-23)_ A slot's **pivot is editable** — ✥ Set pivot in Setup mode puts the point the art rotates and scales around anywhere under it, without moving the art; a new slot no longer spins about its middle with no way to change that (see Recent changes). Was: _(2026-09-02)_ The **Bounds box is now the frame that fills a symbol cell, centred** — in `/symbols`, the Scene Editor's reel cells and the game alike; the game used to centre the skeleton ORIGIN instead, so a Rigger frame had the right size and the wrong place (see Recent changes). Was: _(2026-09-02)_ A rig event binding is now **one KEYFRAME**, not one event name: an effect on the 1s key no longer fires on the 0.01s key beside the flipbook there, each key keeps its own settings, and a key at **t=0** plays instead of being skipped (see Recent changes). Was: _(2026-09-01)_ A **carrier** rig (FX/Flipbook bindings, no art of its own) now gets a natural size — measured from the clips it carries, or hand-drawn in the Bounds box — and its bound content no longer previews mirrored (see Recent changes). Was: _(2026-08-31)_ A rig animation event can now play an **Invisible Flipbook clip** as well as an Invisible FX effect — the same binding shape, the same shared preview overlay, both on one key if you want (see Recent changes). Was: Built — Phases 0–6 on `main`, registered + documented; ⏳ the **whole tool** still needs owner live-verify (the vendored **minified** spine runtime hides browser-only bugs the headless spikes' un-mangled `spine-core` never surface).

## Current state

Online Spine 4.2 skeleton editor at `/rigger` (launcher-native, full-page, `rigger`-gated). Reads/writes byte-valid Spine 4.2 JSON under our `.irig` extension, non-destructively saved to R2 alongside the artist's source. Phases 0–6 are all on `main`:

- **Bones** — transform edits, canvas drag-to-move, reparent (cycle-safe topo-sort), rename (rewrites every reference), add/delete, collapsible hierarchy.
- **Slots / skins** — draw-order reorder, region-attachment placement, add/rename/delete, duplicate slot, **✨ Auto FX slots** (auto-duplicate + repoint `_shine`/`_glow`/`_shadow`/… from the atlas), multi-skin.
- **Mesh** — region→mesh convert, draw-a-mesh, move/add/remove vertex, constrained-Delaunay re-triangulate, numeric UV editing, **isolated-mesh edit** (⛶) that re-pins UVs so reshaping the wireframe never distorts the art.
- **Weights** — bind-to-bone, per-vertex numeric editing, visual **weight brush** (radius/strength/erase + blue→red heatmap), a proximity chain-skinner auto-weight.
- **Animation** — keyframing (per-channel + key-all), **dopesheet** (multi-select, marquee, alt-drag duplicate, per-key easing — **right-click a key in a multi-selection eases the whole selection at once**), a **graph editor** (bezier tangents), slot channels (shows / colour / opacity via one `rgba` timeline), **timeline events** (⚡ cues that cross the game event bus, and that can bind an Invisible **FX effect** and/or an Invisible **Flipbook clip** directly to the beat), and draw-order channels.
- **Localized text as ART (2026-08-17)** — a **Text (localized art)** section in Setup mode:
  pick a localization key + a project font, live-preview it, and bake it to **one atlas region
  per locale**, placed on its own bone as one region attachment per locale named
  `<id>@<locale>`. It is then an ordinary region — mesh convert, weights, deform, keyframing and
  cinematic casting all apply with no new machinery, and the `.irig` stays byte-valid Spine 4.2
  with no sidecar. Localization is an **attachment swap** the engine performs at mount. Design:
  [invisible-cinematic §12.4a](../design/invisible-cinematic.md). Details in Recent changes.
  **Kept current automatically (2026-08-18):** opening a rig reconciles its text art with
  `/localization` — new language, corrected string, or attachments missing from the `.irig` — and
  saves. The author's only input is the original text.
- **Rig + animation libraries** — cross-project R2 libraries: copy/paste or save/load a single clip, or save/apply/import a whole rig (namespaced lossless merge; apply-at-creation), with a matched-vs-missing compatibility report.
- **Bounds / natural size** written on every save (setup-pose measured, animation-union fallback); one-click **⟳ Re-sync atlas** / **source…** to re-pull a rig's atlas snapshot.
- **Self-healing atlas snapshot (2026-07-21).** A rig bundle carries a FROZEN copy of the source sheet's `.atlas` geometry + page; regenerating the sheet used to leave every downstream consumer (Symbols, Scene Editor spine preview, the baked game) stale until each rig was manually `⟳ Re-sync`ed. Now `source.json` records a **revision** (geometry hash + page ETag) and the shared `ensureBundleAtlasFresh` (`$lib/server/spineBundleSync.ts`) re-derives the bundle `.atlas` + page from the live manifest whenever it drifts — called on the Symbols/Editor **read** path (`resolveEditorSpine`) and the **bake** path (`exportSpineBundle`), so a re-packed/recoloured sheet propagates with no manual step. `new` seeds the revision; `⟳ Re-sync atlas` now delegates to the same helper (`force`). See [docs/status/symbols.md](symbols.md).

The `.irig` round-trips through the official loader (Phase 0: 120/120 skeletons, weighted-mesh vertices included). `.skel` binary is view-only; editing is JSON only. See design §0 for the reconciled phase summary.

## Open items / next

1. ✅ ~~**Ship-from-Rigger (rule 8)**~~ — **DONE (owner-confirmed 2026-08-04).** A rig now travels the full export → `deploy/` → bake → pull → runtime-register chain and reaches a game; "renders in `/rigger`" now also means "ships."
2. ✅ ~~**Mesh-deform animation timelines**~~ — **DONE (merged, owner-confirmed 2026-08-04).** The
   per-vertex `deform` dopesheet channel (key at playhead from the live mesh, curve-aware preview,
   retime/duplicate/delete/easing) writes Spine 4.2 `deform` keyframes into the `.irig`; offline-proved
   by `tools/rigger-spike/deform.mjs`. (Live drag-to-deform UI verify folds into the standing tool-wide
   live-verify gap below.)
3. **Phase 3.6d hull-loop reordering** — drag to change the boundary winding order (a pure permutation the 3.6c primitive already supports; no UI yet) — the only remaining 3.6 sub-item. (Phases 3.6a UV panel, 3.6b constraint edges, and 3.6c hull promote/demote all shipped + **owner-verified live 2026-08-04**, see Recent changes.)
4. **Localized text — live-verify + the next slice.** The authoring path and the runtime swap
   shipped 2026-08-17, and the re-bake became **automatic on rig open** 2026-08-18 (Recent
   changes) — so "the tool has no signal that `/localization` moved on" is closed. The fit rule
   that keeps a long translation inside its art was **repaired 2026-08-25** (it was shrinking the
   pixels while the attachment stretched them back); a meshed text element still cannot be
   fitted, see Recent changes. Still NOT
   built: a **rename** for a text element (the id is the attachment name, so it is locked after
   creation), and **placed/persistent FX slots** — an always-on, keyable emitter living on the rig
   as a slot (the other half of design §12.4a). NOTE the one-shot timeline cue is a different thing
   and it DID gain depth + modifiers on 2026-08-27 (Recent changes); what is still missing is the
   persistent emitter. Owner
   live-verify is owed against real R2 + a real game, and nobody has yet _looked_ at baked rig
   text on screen.
   The runtime half is already **live**: `.github/workflows/runtime-release.yml` auto-releases on
   any push to `main` touching `packages/**`, and the release built from `88f5e5e7` (2026-08-18
   11:33) contains `13bfc005`, the swap. So the online games' shared bundle carries
   `applyLocaleAttachments` — a rig that bakes and saves correctly will localize with no further
   release.
5. **Better auto-weights** — the shipped proximity chain-skinner scored poorly against artist ground truth; a geodesic/heat algorithm + a representative **character-mesh validation gate** (Spike 2) is still open. Manual brush stays the guaranteed path.
6. **Cinematic mode** — SHIPPED as a fourth mode (2026-08-17); see [status/cinematic](cinematic.md) and [design/invisible-cinematic](../design/invisible-cinematic.md). Two spillovers worth knowing here: (a) the cinematic stage keeps its OWN actor array rather than touching the rig editor's `skeleton`/`animState` singletons, so rig editing is byte-unchanged; (b) `/rigger` now has an **undo stack for the first time**, but it is scoped to the cinematic document — **rig editing still has no undo**. The history is written to be liftable (it knows nothing beyond `serialize`/`applySnapshot`), so giving the rig editor undo is now a matter of pointing it at `rawDoc` rather than building one.

## Blocked (owner / external)

- ✅ ~~**Rig/animation library catalogs moved to Postgres — live-verify owed.**~~ **VERIFIED live
  (owner-confirmed 2026-08-04):** `/rigger` lists every rig + animation post-deploy (the first list
  call backfilled the legacy index blobs), migrations applied through 0014. Concurrency Phase 0 is
  closed. See [design/multi-user-concurrency](../design/multi-user-concurrency.md) Phase 0.
- **Whole-tool live-verify** is the standing gap and is owner-driven — the minified vendored runtime has already surfaced browser-only bugs (e.g. `constructor.name` type checks, a double-flipped canvas Y) that headless spikes missed. Verify each action live before relying on it.
- **No lossless desktop-Spine `.spine` project round-trip** — an Esoteric limitation (desktop Spine can only _import_ our JSON), not ours.

## Recent changes

- 2026-09-23 — **Follow-up to the pivot editor below: a bone another slot's WEIGHTED mesh is painted
  onto is no longer treated as movable.** Caught by `code-reviewer` after the first commit shipped, and
  it was a real one. `exclusive` tested four ways a bone can be depended on — it is the root, a bone
  parents to it, another slot hangs off it, a constraint targets it — and missed the fifth: **weighted
  vertices reference bones by positional INDEX**, so a slot depends on every bone painted onto its
  mesh without ever naming one in `slot.bone`. A leaf bone used by exactly one slot, that the weight
  brush had painted onto a DIFFERENT slot's mesh, passed as exclusive, so it was moved in place — and
  that other slot's art jumped, with no compensation possible from here (the counter-move would have
  to land on the other slot). Measured at **34.11px** on a synthesised repro over `anticipation`.
  Reachable from the tool's own weight brush and auto-weights, and rig editing has no undo.
  - **Fix:** `weightedBoneNames()` walks every weighted `vertices` array in every skin and maps the
    indices back to names; a hit routes the slot to the already-safe `<slot>-pivot` branch, which
    moves nothing. The whole test moved out of `slotPivotCtx` into `pivotBoneIsExclusive(bone)` — the
    ctx runs up to three times a frame while the mode is armed, and this walks every constraint and
    every weighted vertex array, so it now runs only when the panel renders or a pivot is committed.
  - Also from the same review: **the pivot no longer shares the canvas with another armed mode**
    (unlike the per-attachment-type modes it applies to every slot, so it could be armed alongside the
    mesh/path/poly/point/brush modes and the two then fought over one mousedown — arming it now stands
    them down, as the mesh buttons already did for each other); **vertex rebasing rounds to 2 dp** like
    every other vertex writer here, instead of accreting float noise (`-13.370000000000005`, +339 bytes
    on an 87 KB `.irig`, compounding per move); and the panel now branches off `pivotEditable()` rather
    than re-implementing its three tests inline.
  - **The spike could pass having asserted nothing** — six rigs skipped every block and still printed
    PASS, so a batch driver grepping for FAIL called them green. It now counts assertions and fails on
    zero; the "loader accepts it" check re-reads through a FRESH loader and asserts every bone still
    follows its parent (the ordering an appended bone could break) instead of testing a stub's own
    output; and the run covers what the design turns on — the foreign-weight case above (proved to go
    red without the fix: 34.11px → 0.0000px), plus `path` / `boundingbox` / `clipping` / `point`, which
    take the `vertexCount` arm of the unweighted test and no shipped rig carries. Slots that hold an
    attachment in a skin but no SETUP attachment now get one assigned, the way picking the image does,
    which is what left those six rigs uncovered. **148 rigs, 148 pass, 5886 assertions, minimum 24 per
    rig.** Re-verified live against the vendored minified runtime too.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/pivot.mjs`.

- 2026-09-23 — **A slot's pivot is editable — the point its art turns and scales around.** Reported as:
  _"when I create a new slot, this slot has no pivot … I would like a button where I can edit the pivot and move
  it around where I want. Right now that pivot seems to always be in the centre of the image. It is basic
  functionality for a rigger."_ Accurate: Spine gives an attachment **no pivot of its own** — a
  `RegionAttachment` builds its quad symmetric about its own centre, rotates THAT by `rotation`, and only then
  offsets by `x`/`y` — so the only real pivot an image has is the origin of the bone its slot hangs from. And
  `attachRegion` writes `{width, height}` with no `x`/`y`, which parks the image centre exactly on the bone. Hence
  "always in the centre", with the numeric placement fields able to move the art but never the point it turns from.
  - **The control.** Setup mode, under the attachment tools: a **pivot** section with **✥ Set pivot** (click or
    drag on the canvas, Esc to leave, the mode stays on for repeated nudges), a **3×3 snap grid** for the art's
    corners / edge midpoints / centre, and an `across % × down %` readout of where the pivot sits inside the art.
    The grid cells interpolate the region's REAL quad (via the existing `affineUV` basis), so they follow a rotated
    image instead of a screen-aligned box. While the mode is on the canvas draws an orange crosshair at the pivot
    over a faint outline of the art.
  - **What it writes.** Moving the pivot moves the bone origin under the art and subtracts the same offset from the
    art's placement, so nothing shifts on screen. A bone **nothing else depends on** is moved in place; a **shared**
    one (root, has children, another slot uses it, a constraint targets it) instead gets the slot its own
    `<slot>-pivot` child and nothing else in the rig moves. Either way the pivot bone is then selected, so the
    rotate gizmo turns the art from the new point immediately — and because the pivot IS a bone, it reaches
    animation and the game, not just this editor. No new fields, no sidecar: the `.irig` stays byte-valid Spine 4.2.
  - **Rebasing covers every attachment the slot owns, in every skin** — region/point `x`/`y`, and unweighted
    mesh/path/box/clip vertex arrays. **Weighted** geometry is deliberately left alone (its vertices live in the
    WEIGHT bones' spaces, so the slot bone does not place it). A **linked mesh** borrows its geometry from another
    mesh, so there is no array here to take the move back out of — those slots are refused outright, with the
    panel pointing at the source slot. One predicate, `pivotEditable()`, gates the panel, the canvas hit-test and
    the overlay together, because the selected slot and its attachment change through paths that never call
    `selectSlot` (＋ Add slot, add/replace image) — without it the canvas went on swallowing clicks for a slot
    that has no pivot. A ⚠ line warns when the bone is already keyed to rotate/scale, since moving the pivot
    re-aims that animation and rig editing still has no undo.
  - **Precision note:** the pivot is stored as a bone-local offset snapped to 2 decimals so the x/y fields stay
    readable, and the art is rebased by that SAME snapped value, which is what makes the cancellation exact. The
    moved bone's own `x`/`y` are written **unrounded** — they are in the PARENT's space, so a second rounding
    there would no longer cancel and the art would creep (canvas bone drag writes full precision for the same
    reason). Caught by the spike: two rigs missed the click by ~0.05px before the rounding came out.
  - **Verified.** `tools/rigger-spike/pivot.mjs` extracts the SHIPPED functions out of `view.html` and runs them in
    a `vm` sandbox against the official `spine-core@4.2.74` loader, so the test cannot drift from the tool. Across
    **146 checked-in rigs, 146 pass**: art drift 0.0000px, the pivot lands within the snap, nothing else in the rig
    moves, the animations stay byte-unchanged, a second placement reuses the bone instead of stacking another, and
    after a 90° turn the pivot is the rotation's one fixed point. 6 unweighted-mesh placements, 76 weighted-mesh
    non-interference checks, 76 linked-mesh refusals. **Also verified live in a browser** against the vendored
    **minified** runtime (a local harness serving the real `view.html` with stub `/spine/*`): 0px art drift on both
    branches, the pivot landing 0.0039px from a canvas click (no Y-flip — the readout tracked both axes), a
    `slot1-pivot` bone created for a fresh slot on `root` with 0 of the other 85 bones moving, and after a 35° turn
    the art's bottom-centre still exactly on the pivot while its far corner travelled 2852px.
  - ⏳ Owner live-verify against real R2 still owed, as for the rest of the tool.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/pivot.mjs`.

- 2026-09-18 — **The rig FX preview was offset and clipped at 150% browser zoom** — `createFxOverlay`
  set `resolution: devicePixelRatio` without `autoDensity`, so the canvas ELEMENT kept its
  backing-store size and every effect landed `devicePixelRatio`× too far from the origin. Found and
  fixed via `/symbols`, which shares the factory; never reported here. Cause, measurements and the
  guard: `docs/status/symbols.md`, 2026-09-18.

- 2026-09-04 — **A rig's bound FX / clips now play wherever the rig is mounted, not only on a placed `spine` node.** What you key here reached the game through exactly two mount sites; a rig used by a coded component (the big-win rig, backdrops, transitions, cinematic actors) read the binding nowhere. The join moved into `<SpineProvider>`. Authoring is unchanged. Detail in [fx status](fx.md).
- 2026-09-03 — **A carrier rig's bound clips and effects draw at their authored size in the game too.** Follow-up to the Bounds fix below: the frame was right but the lobster inside it was half-size on the board, because a symbol bundle is read at load scale 2 and a Pixi child riding a bone follows only the bone's scale. The engine now scales bound content by the host bundle's load scale, so what this tool (and /symbols) shows at load 1 is what the board draws. Details in [engine status](engine.md).
- 2026-09-02 — **The Bounds box is now the frame that fills a symbol cell — centred — everywhere, so
  what you author here is what the board draws.** Reported as: "the rig bounds we build seem off; I
  author them in the Rigger to get the size right in the game, but the two don't match." They could
  not: every consumer read only `skeleton.width/height` and placed the box as if it were CENTRED ON
  THE ORIGIN (`measureSpineBounds` returned `-w/2, -h/2`; `<SpineProvider>` pivoted on (0,0)). True
  of every Spine-editor rig we ship (all 32 checked-in headers are `x = -w/2, y = -h/2`), false of a
  Rigger rig: `ensureRigBounds` writes the measured setup-pose extent and a dragged frame writes
  wherever the author put it, so a rig whose root sits at its feet had a frame the game sized
  correctly and then hung from the wrong point — the origin at the cell centre, the frame's centre
  somewhere else. Shrinking or growing the frame to "get the size right" then moved the art as well,
  which is the "very difficult to match" in the report.
  - **Fix: read the box where the header puts it.** `authoredSpineBox` (`constants-shared/spine`) is
    the ONE reading of `skeleton.{x,y,width,height}`; `measureSpineBounds` (Scene Editor reel cells,
    `/symbols` grid + preview) returns its real corner, and `<SpineProvider centreBox>` pivots the
    game's rig on the box centre — scaled by the bundle's load scale and y-flipped into pixi space
    (`spineBoxPivot`), because the header stays unscaled while the geometry does not. Opted in by the
    three cell-fit consumers (`SymbolSpineMain`, `StackedPicture`, the paytable's `InfoOverlay`); a
    PLACED scene spine keeps origin-at-position, which is the convention the Scene Editor draws it
    with, so nothing else moves. A header with a size but no `x`/`y` keeps the centred reading.
  - Parity: a centred box yields a `(0,0)` pivot, so every shipped rig is byte-identical.
    Fixture `packages/pixi-svelte/fixtures/spineBox.fixture.ts` proves it against a real
    `SkeletonJson` parse (centred ⇒ no-op at load 1 and 2; feet-rooted frame ⇒ box centre; a
    missing `x` comes through `undefined`, not 0). Reaches online games via the automatic runtime
    release; the launcher side deploys with this commit. The Bounds button's tooltip now states the
    contract. ⏳ Owner live-verify on `test6`'s lobster rig.
- 2026-09-02 — **A rig event binding is one KEYFRAME, and a key at t=0 plays.** Reported directly:
  two event keys, a flipbook on the one at 0.01s and an effect on the one at 1s, and _"the FX will
  start playing on the first keyframe with the flipbook"_; and _"if I put my keyframe at 0 then
  neither the Flipbook or the FX start playing, as if they were getting skipped completely"_. Two
  independent bugs, two independent fixes.
  - **What was wrong (1): the manifest was keyed by the event NAME.** Both keys carry the default
    name `event`, so the bake collapsed them onto that name and `<RiggedEffect>` / `<RiggedFlipbook>`
    fired on EVERY keyframe of it — the effect on the 0.01s key beside the clip, the clip again at
    1s — and the first key's settings won for both. This was a documented limit (the 2026-08-27
    entry's "the limit the manifest imposes"), surfaced by an inspector warning telling the author
    to rename the event. That was the wrong answer: the author asked to control each key
    separately, and a spine event already carries what identifies its key.
  - **The fix: bake the BEAT.** A binding now carries `animation` + `time` beside the event name
    (`RigBeat` in `engine-layout`, read through `readRigBeat` at the same choke points as the
    overrides), one binding per keyframe; the runtime listener matches all three off the fire — the
    track entry's animation and the spine `Event.time` (the keyframe time, verbatim from the rig
    JSON). `riggedBeatMatches` in `pixi-svelte` is the one rule, extracted like
    `shouldApplySpineAnimation` so it runs headless. Absent fields match anything, so a manifest
    baked before beats existed still registers and keeps its name-only firing until re-baked. The
    bakes and both live timelines now walk ONE `beatsOf` list; the only thing still de-duped is a
    literal duplicate (same beat, same effect/clip, same place). Each keyframe keeps its own
    settings, so the inspector's "another key binds the same effect — rename it" warning and
    `bindingOverrideClashes` are gone with the limit they described.
  - **`continuous` reads slightly differently now:** it still starts once and survives loop wraps
    and state changes (it stops when the rig unmounts), but a binding is one keyframe — so key an
    ambient effect ONCE, on the animation that starts it; the same effect keyed continuous in a
    second animation is a second instance.
  - **What was wrong (2): a t=0 key fired before anyone listened.** The sibling `<SpineTrack>` sets
    the animation and poses it with `spine.update(0)` from its `$effect`, and sibling effects run in
    template order — so the listeners `<RiggedEffect>` / `<RiggedFlipbook>` attached from THEIR
    `$effect` landed after that first apply, which is exactly when spine fires a frame-0 event. A
    key at 0.01s only ever worked because the ticker fired it a frame later. Both now attach the
    listener during init (removed in `onDestroy`), before any track is set.
  - **And the Rigger preview skipped it too**, for its own reason: the crossing is `(prev, cur]`,
    and every paused frame walks `prev` up to the playhead — so pressing Play with the playhead ON
    a key (t=0 after a scrub-back, most of all) could never cross it on the first lap. `fxArmPlayhead`
    nudges the cursor a hair below the playhead when Play starts.
  - Gates: `check:rig-fx-overrides` + `check:rig-flipbook-overrides` rewritten to the per-keyframe
    rule (**mutation-verified**: restoring the name-keyed dedupe fails 4 checks) and
    `packages/pixi-svelte/fixtures/riggedBeat.fixture.ts` (mutation-verified: ignoring `time` fails
    the reported case). ⏳ Owner live-verify in `/rigger` and in a published game: needs a **re-bake**
    (Publish) for the new manifest to reach the game.
  - **Follow-up the same day (#549):** the first release blanked the reels on the first spin —
    `ReferenceError: rigBeatKey is not defined`. The `{#each}` keys in `LayoutNodeView` and
    `SymbolSpineMain` called the helper but the patch that was meant to add its IMPORT never
    landed, and Svelte compiles a bare template identifier as a global, so `launcher build` (not a
    type-check) stayed green and the throw only surfaced when a rig with bindings rendered. Found by
    loading the republished game in the browser and reading the console, not by reasoning.
  - **Second follow-up the same day (#552): on H1 only the FX showed, not the clip.** Per-keyframe
    bindings exposed a spine-pixi rule: ONE object per slot — `addSlotObject(slot)` first
    `removeSlotObject(slot)`s, pulling the previous container out of the spine. The H1 rig
    (`R_TentacleFlip`) binds `f_tentacle_exit` on `slot1` in BOTH `animation` (tumble) and
    `animation_copy` (static/land), which are now two `<RiggedFlipbook>` mounts, so the second
    evicted the first and the tumble's clip played into a container the rig no longer contained;
    the effect on `slot2` (one binding) still drew. Fix = `spineSlotHost.attachToSlot`: the slot
    object is a shared HOST, first binding in creates + registers it, later ones nest under it, last
    one out unregisters and destroys it. Both rigged players use it; `<SpineSlot>` (coded slot
    content) still registers directly and is untouched. Fixture
    `packages/pixi-svelte/fixtures/spineSlotHost.fixture.ts` (mutation-verified: a host per
    binding fails the eviction case). Read off the baked `rigFlipbooks` for test6 via
    `/api/editor/runtime`, not guessed.
- 2026-09-01 — **A carrier rig had no SIZE and its bound content previewed upside down** — two
  independent bugs, both surfacing for the first time on a rig built entirely from FX + Flipbook
  bindings (`R_TentacleFlip`). Reported as: elements rotated 180° in `/rigger`, no Bounds box at
  all, correct in the game, too big in `/symbols`, bigger still in the game.
  - **No natural size.** Every measuring path is `skeleton.getBounds()`, which sees only
    ATTACHMENTS. A binding is a timeline **event** and the slots hosting one are empty, so the
    setup-pose measure, the animation union and the runtime's `spineNaturalBounds` all returned 0;
    `ensureRigBounds` no-opped and the rig kept the `{ spine: '4.2' }` it was scaffolded with. The
    Bounds box then could not draw (`rigBoundsRect` needs a positive width/height) — and its one
    rescue path calls the same `ensureRigBounds` — so the ONE control that could have given the rig
    a size was unusable on exactly the rigs that need it.
  - **The two consumers then guessed DIFFERENTLY**, which is why the same rig was two sizes:
    `measureSpineBounds` fitted a 100×100 box while `spineSizeScale` returned `{1,1}`, silently
    dropping the requested `cell × SYMBOL_SPINE_FILL` and drawing the rig raw. That disagreement
    read as a sizing bug in one surface rather than as the missing bounds it was. The fallback is
    now ONE number, `SPINE_FALLBACK_NATURAL_SIZE` in `constants-shared/spine`, used by both.
  - **Fix: measure what the rig CARRIES.** A third tier in `computeRigBounds` unions the declared
    box of every bound Flipbook clip, posed at the beat and placed through its host bone's world
    matrix (the clip box is PIXI y-DOWN and the rig is spine y-UP, so the corner's y is flipped
    BEFORE the bone matrix — that is what puts an off-centre box on the side it draws on, and it is
    exactly the composition `<SpineBoneAttach>` performs). FX contributes nothing on purpose:
    particles have no declared extent, so there is no honest size to read. When nothing is
    measurable the Bounds button now SEEDS a placeholder frame (unlocked, so a clip that later
    gains a box still auto-fits over it) and says so in a notice.
  - **The 180° was a REFLECTION the overlay carried through.** `fxBoneTransform` derives its 2×2 by
    differencing projected points, and every stage projection here mirrors (a y-up skeleton drawn
    into a y-down canvas; the Symbols grid mirrors x too), so `d < 0` and `setFromMatrix` drew the
    burst flipped about its bone. Invisible for as long as FX has existed — a particle burst is
    near-symmetric — and glaring the moment a Flipbook clip, which has an up and a down, was bound
    (2026-08-31, one day earlier). The game never did this: `<SpineBoneAttach followRotation
followScale>` takes `rotation = -getWorldRotationX()` and sizes by `Math.hypot` MAGNITUDES,
    with a comment saying why. One shared `fxMatrix` in `fxOverlay.client.ts` now strips the
    reflection and keeps rotation + magnitudes, so **`/symbols` is fixed by the same change** — it
    was flipped too, just hidden under the oversize.
  - Proved offline against an independent implementation of the `<SpineBoneAttach>` rule (every
    rotation × per-axis scale) and verified live on the local launcher with a synthesised carrier
    rig: box seeds + draws (4 edges, 9 handles), every handle grabbable, drag locks it, the lock
    survives `ensureRigBounds`, a 512×512 clip box yields a 512×512 rig, `scale: 2` doubles it,
    FX-only falls through to the seed, and a normal rig is still measured by tier 1 untouched.
    ⚠️ The vendored `static/rigger/vendor/rigger-fx.js` is rebuilt and committed — the Rigger reads
    the overlay from THAT bundle, so a future `fxOverlay.client.ts` edit needs
    `pnpm --filter launcher-api build:rigger-fx` or the tool keeps the old behaviour.
- 2026-09-01 — **An atlas-less ("carrier") rig shipped a page image no browser could decode, so the
  rig — and every FX/flipbook binding on it — silently vanished in-game.** Reported as "my H1 tumble
  explosion plays in `/symbols` but not at all in the game". The `noAtlas` placeholder page in
  `api/rigger/new` was a spliced 1×1 PNG (a grayscale+alpha IHDR carrying an RGBA IDAT ⇒ bad IDAT
  CRC, truncated zlib), so Chrome answered `InvalidStateError: The source image could not be
decoded`, `Assets.load` failed the whole bundle, the rig was missing from `loadedAssets`, and
  `<SpineProvider>` rendered nothing — **including its children**, which for a carrier rig is the
  entire point of it (`<RiggedEffect>` / `<RiggedFlipbook>`). Every authoring surface stayed healthy
  because they read the `.irig` and preview clips off the TIMELINE, never through the loaded bundle:
  the one asymmetry that lets a rig look perfect in `/rigger` + `/symbols` and draw nothing in the
  game. Placeholder regenerated (valid 8-bit RGBA, CRCs computed); existing bundles carrying the old
  70-byte page must have it rewritten (the page is not re-derived for a rig with no source sheet, so
  `⟳ Re-sync atlas` cannot repair one). Verified live: the H1 `tumbleExplosion` cell went from
  "magenta / key missing" in the in-game Symbol Debug grid to playing its bound clip + `v_splash`.
- 2026-08-31 — **A rig animation event can now play a FLIPBOOK CLIP, so rigs, flipbooks and FX mix in
  the animator.** Asked directly: _"I would like to be able to add flipbooks to the rigger, so I can
  mix rigs, flipbook and FX in the animator. we already added FX successfully, and we can use that as
  a reference"_ — so it is deliberately the same shape as the FX binding, end to end.
  - **`event.flipbook = { clipId, bone?, … }`** beside the existing `event.fx`. Same custom-field
    trick, same reason it needs a baked manifest: spine-pixi discards custom event fields at parse
    time, so the binding is read from the rig `.irig`/`.json` (`rigFlipbookExport.ts`) and shipped as
    `rigFlipbooks`, keyed by the rig's bundle folder — exactly as `rigFx` is.
  - **Two sections on one key, not a choice.** A key can fire an effect AND a clip: a hit that throws
    sparks and a frame-animated flash is one beat. Everything after "which binding" — band, host
    bone, crossing, follow, stop — is ONE code path (`evtBindings` / `fxStart`), so the two cannot
    drift apart on depth or timing the way two copies would.
  - **The overrides are the FX six plus the clip's own playback block.** `slot`/`alpha`/`scale`/
    `delay`/`duration`/`continuous` mean what they already mean; `fps`/`loop`/`direction`/`flipX`/
    `flipY` are the SAME per-use vocabulary `/symbols` and the Scene Editor offer, folded through the
    same `foldFlipbookPlayback`. Deliberately NOT a `speed` multiplier — an author setting a rate
    here should be typing the number they type everywhere else. `duration` reads differently and the
    UI says so: for a clip it is time ON SCREEN, which only bounds a LOOPING clip (a one-shot ends
    itself).
  - **`false` had to survive, unlike `continuous: false`.** `loop`/`flipX`/`flipY` all default to
    something other than off somewhere in the chain, so a binding must be able to say `loop:false` —
    dropping it the way the sparse rule drops `continuous:false` would make "play this one once"
    unauthorable. Three-state selects in the inspector, an explicit type test in the clamp.
  - **`playFlipbook` on the SHARED overlay**, not a third canvas: the browser caps live WebGL
    contexts (~16) and a burst and a clip on one beat have to be in one scene to layer at all. Both
    bands work for clips, so a clip bound to the backmost slot previews behind the rig with the same
    exact/approximate note FX gets. The preview hold cap is NOT the FX rule — an authored duration
    wins, a continuous binding is never capped, a one-shot clip ends itself, and only a LOOPING clip
    gets the 1.5s guess (capping a 3s one-shot would show the author an animation ending where it
    does not).
  - **The frames are CUT, not looked up** — the one place the preview genuinely differs from the
    game, and the one with silent failure modes. `flipbookFrames.client.ts` re-applies every geometry
    rule the loader applies: atlas rotation (a sideways frame drawn upright is 90° wrong, once,
    mid-animation), per-frame trim (frames of one animation are trimmed to different rects, so a
    dropped offset makes the art jump around its own origin), the clip's declared box, and the
    direction walk. Pinned by `check:flipbook-frames`, mutation-verified (dropping the rotation swap
    fails it).
  - **`/symbols` got it too.** `/api/editor/rig-fx` now returns both timelines off the SAME parsed
    skeleton (one read, not two), and the grid tags + merges them into one crossing — so a symbol
    whose rig binds a clip previews it there as well. This is the "three surfaces must agree" rule
    the continuous fix established; leaving it out would make `/symbols` silently show less than the
    Rigger.
  - Gates: `check:rig-flipbook-overrides` (the clamp, the bake identity, the timeline, the registry)
    and `check:flipbook-frames` (the cut geometry) — both mutation-verified. `check:rig-fx-overrides`
    still passes after `rigFxExport` was refactored onto the shared `walkRigSkeletons`.
  - **Verified live** on the local launcher against the 73-bone `anticipation` builtin (the
    no-login shim technique): the "Play flipbook" section renders with the project's clips, picking
    one writes the sparse binding, the overlay creates its Pixi app, fetches the region set + page and
    mounts a PLAYING `AnimatedSprite` with the right textures; `direction:pingpong` → 4 textures for a
    3-frame clip, `loop:false` → `sprite.loop false`, `fps:30` → `animationSpeed 0.5`, `scale:2` →
    the inner container; a backmost-slot binding opened the BACK band (a second overlay) with the
    green "nothing is drawn behind" note; the 1.5s hold stopped a looping clip and `continuous`
    suppressed it; and one key carrying both an effect and a clip fired BOTH on the crossing path,
    each tracked by its own binding object. Vendored `rigger-fx.js` rebuilt (it MUST be, or
    `playFlipbook` is missing from the bundle and nothing plays).
- 2026-08-27 — **A rig FX cue can be marked CONTINUOUS, so a looping animation stops chopping it up.**
  Asked directly: _"would it be possible to mark an FX I put in the rig as continuous? so if the
  animation loops the FX is not resetting?"_ Yes, and it was a small addition to the override set.
  - **What was wrong:** a binding is a one-shot per beat — every time the event crosses, `RiggedEffect`
    bumps `runId` and the `{#key runId}` re-mount replays the effect from t=0. On a LOOPING clip that
    restarts the burst once per lap, which is right for an impact and visibly wrong for anything
    ambient (drifting smoke, bubbles, a glow): the reset reads as a stutter.
  - **`evtObj.fx.continuous`** — the first BOOLEAN in `RigFxOverrides`. The first fire starts the
    effect and later fires of the same event are ignored, so the emitter runs unbroken. Sparse like
    the rest: only the opt-IN is stored, so every existing binding bakes byte-identically.
  - **It stops when the RIG unmounts, not when the animation changes** — the manifest is keyed by
    event name, not by clip, so an ambient effect survives a state change instead of dying on it. An
    authored `duration` still bounds it.
  - **Three places had to agree**, because each kills bursts on a loop wrap for its own reasons: the
    game (`RiggedEffect`'s re-fire guard), the Rigger stage (stop the one-shots individually instead
    of `clear()`-ing the whole overlay), and the `/symbols` grid (same, per cell). The preview overlay
    also skips its `PREVIEW_HOLD_MS` cap for a continuous burst — capping it would show the author the
    exact stutter the flag exists to remove.
  - Verified live over ~3 laps of a 1.33s looping clip with one continuous and one one-shot cue on the
    same timeline: the continuous effect played **once** and was still live at the end; the one-shot
    played **3 times**, once per lap. Gate `check:rig-fx-overrides` extended and **mutation-verified**
    — storing `continuous:false` and dropping the field from the reader each fail it.
- 2026-08-27 — **The stage now has an FX overlay on EACH side of the rig, so two cues at opposite
  depths both preview truthfully.** Reported after the previous fix: _"the layering works fine in
  game, but not in the rigger — the canvas view is still showing both FX on top of the rig."_ That
  was the design conceding, not a bug: with ONE overlay every live burst shared a band, and the rule
  chosen when they disagreed was "prefer front", so a behind-cue was dragged on top.
  - **Now two overlays**, lazily created per band: `back` at `z-index 0` (below `#cv`) and `front` at
    `2` (above it), with the rig canvas sandwiched at 1. Each burst plays into the overlay for its own
    side, so nothing has to be conceded. `createFxOverlay` was already a factory with all state closed
    over per instance — `rigger-fx/main.ts` now also exposes it as `window.RiggerFxCreate`, since
    `view.html` has no module system. `window.RiggerFx` stays as the front instance for back-compat.
  - **This only became possible after the transparent clear** shipped earlier the same day: under the
    old opaque `#cv` an overlay below it was simply invisible, which is why one overlay had been the
    only option.
  - **Bands are created per CLIP, before the crossing runs.** Creating one on first fire dropped that
    first burst (its overlay was still initialising), so a behind-cue only appeared on the second loop
    — and on a non-looping clip, never.
  - **`fxDepthIsExact` replaces the old "behind = exact" shortcut.** With a band on each side, a slot
    at EITHER end of the draw order previews exactly — nothing behind it, or nothing in front. Only a
    genuinely mid-stack slot (art on both sides) is approximated, and the note now says which side it
    chose. The "contested" wording is gone: two cues on opposite sides are no longer a conflict.
  - Costs a second WebGL context, but only for a rig that actually uses both sides; a rig with FX on
    one side creates one overlay, and a rig with none creates neither.
  - Verified live against the 73-bone `anticipation` builtin with the reported two-cue setup: the
    stack is `fx(back) z0 · #cv z1 · fx(front) z2`, and the two bursts route to **different overlay
    instances** — `e1`→instance 1 at z2, `e2`→instance 2 at z0. Notes checked for all three cases:
    backmost slot → exact/behind, frontmost → exact/in front, mid-stack → approximate with the side
    named. Vendored `rigger-fx.js` rebuilt (it MUST be, or `RiggerFxCreate` is missing and the second
    band never exists).
  - Owner confirmed the same day: in-game layering correct, and the `/symbols` FX alignment fix is
    **verified by eye** — that closes the pixel-check owed for it.
- 2026-08-27 — **Two FX cues at different depths both previewed on the same side, and the slot list
  read backwards.** Reported as _"I placed the new slot over the rig slot… but both my FX draw at
  the bottom, so the drawing selection doesn't really seem to work."_ Two separate causes, one of
  them mine.
  - **The band was last-fire-wins.** The stage has ONE overlay canvas, so every live burst shares a
    band — but `setFxOverlayDepth` was called per FIRE, so of two cues 40ms apart the second dragged
    the first to its band, while each inspector note still claimed its own depth was exact. The band
    is now derived from the LIVE SET (`fxActive[].inFront`) and prefers FRONT when they disagree:
    the stage cannot show two depths, and hiding a burst behind the rig is the worse of the two lies.
    The note says so when it happens instead of asserting an exactness it cannot deliver.
    **The GAME was right the whole time** — each binding gets its own `addSlotObject` at its own slot.
  - **The slot list reads back-to-front, and said nothing about it.** `Slots (draw order)` renders
    `skeletonData.slots` in index order, so the TOP row is drawn first and therefore sits BEHIND —
    the opposite of every layer panel authors know, where the top is the front. Unlabelled it reads
    as "drag it to the top to put it over the rig" and does the exact reverse, which is precisely the
    move that was made. The list now carries `↑ behind · drawn first — in front · drawn last ↓`, and
    the **Draw at slot** picker labels its ends (`— furthest BACK` / `— furthest FRONT`).
  - Verified live against the 73-bone `anticipation` builtin, reproducing the owner's setup (two cues
    0.06s and 0.0954s apart on opposite sides): both fire, the live set wants `[front, behind]`, and
    the overlay stays at `z-index 2` instead of being dragged to 0; a lone behind-cue still resolves
    to `z-index 0`; the contested note appears only when contested; the picker and list captions
    render.
- 2026-08-27 — **The stage can now actually SHOW a burst behind the rig, so "Draw at slot" is
  authorable instead of just bakeable.** Reported bluntly: _"I am still not able to author the FX
  under the rig!"_ — and that was fair. Shipping the slot picker while the preview could only ever
  draw FX on top left the author choosing a depth they could not see.
  - **Why "behind" never worked:** `#cv` cleared at **alpha 1**, so the overlay's lower band
    (`z-index: 0`) was not "behind the art", it was _underneath an opaque sheet_ — invisible. The
    band existed but could never show anything, which is also why a cinematic set authored behind
    its cast showed nothing at all.
  - **Why it could not simply clear transparent:** `premultiplyAtlas` uploads every page with
    `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `pma` is on, so the frame buffer holds PREMULTIPLIED
    colour — but the context was created `premultipliedAlpha: false`, telling the browser to
    multiply by alpha a second time. That mismatch was invisible only because a fully opaque buffer
    makes premultiplied and straight identical. Measured on a half-alpha pixel: clearing transparent
    under the old flag darkened it by **50/255**; with `premultipliedAlpha: true` it reproduces the
    opaque render to **0.4/255**, i.e. rounding. So the flag was wrong all along and had simply never
    been load-bearing.
  - **Now:** the context declares premultiplied, `#cv` clears `(0,0,0,0)`, and the stage colour moved
    to `#stage`'s CSS (`applyStageBg`, driven off the same `bgColor` so the two cannot drift).
  - **Band choice is exact where it matters.** `fxBandInFront` reads the LIVE draw order and counts
    only slots that actually carry an attachment: a burst with nothing drawn behind it previews in the
    BEHIND band, which is its true depth. That is the case authors build — a dedicated FX slot parked
    at the back, which is exactly what the owner's `FX_Slot` is. A slot with art behind it still cannot
    be shown truthfully (one canvas, two bands), so it previews in front and the inspector now says
    which of the two it is, in green when exact and amber when approximate.
  - Verified live against the 73-bone `anticipation` builtin: context reports
    `premultipliedAlpha: true`, stage background `rgb(27,29,34)`, the buffer really clears transparent
    (683 transparent / 27 opaque / 90 partial pixels on a row across the rig — i.e. a layer beneath
    shows through everywhere the rig did not draw and is occluded where it did), and all five band
    cases resolve correctly (backmost → behind, frontmost/middle/none/unknown-slot → front) with the
    overlay canvas moving between `z-index` 0 and 2.
  - ⏳ **Not eyeballed.** The Browser pane does not composite while hidden, so there is no screenshot;
    this is verified by frame-buffer sampling and by an isolated WebGL compositing test, not by
    looking at it. Worth one glance on a real rig.
- 2026-08-27 — **A bound FX cue can now say WHERE it draws and HOW it plays: draw-at-slot depth plus
  opacity / size / delay / duration / speed.** The binding had been `{ effectId, bone? }` since it
  shipped, so a burst always drew on top of the whole rig at the effect's authored opacity, size and
  timing — the three things the owner hit at once on `test6`.
  - **Draw at slot.** `evtObj.fx.slot` names a slot; in game `<RiggedEffect>` hands its container to
    spine-pixi's `addSlotObject`, so the burst renders at that slot's place in the draw order — behind
    the head, in front of the body. An unknown slot name falls back to the old on-top mount instead of
    throwing (`getSlotFromRef` does throw, and a rig re-synced with that slot renamed must not take the
    game down). With no bone chosen the slot's own bone hosts the burst, which is also what the Rigger
    stage now projects.
  - **Five modifiers**, all optional, all absent by default — `alpha`, `scale`, `delay`, `duration`,
    `speed`. **Blank is not a default:** an unset field stays absent through bake, registry and
    runtime, which is what keeps every already-baked rig byte-identical. `duration` also closes a
    live divergence — `forceEmit` started emission and nothing ended it, so a continuous effect fired
    from a keyframe emitted FOREVER in-game while the previews force-stopped at ~1.5s.
  - **One clamp, three readers.** `readRigFxOverrides` in `engine-layout` is the only place the rules
    live; the bake, the runtime registry and the previews all read through it, and `rigFxExport.ts`
    now IMPORTS the binding type instead of hand-mirroring it behind a "mirrors the engine-layout
    `RigFxBinding`" comment. Out-of-range and malformed values are DROPPED, never coerced.
  - **The limit the manifest imposes, surfaced in the UI.** The baked manifest is keyed by the event
    NAME, so placement (`bone`, `slot`) identifies a binding and the numbers ride along from the first
    matching keyframe — while the per-keyframe timeline the previews read CAN express two keys that
    disagree. Rather than let a published game quietly contradict the tool, the event inspector warns
    when two keys share a name, effect and place but differ in the numbers.
  - **The preview cannot show slot depth, and says so.** The stage draws every rig into one WebGL
    canvas and FX into a Pixi canvas above it, so it has two bands and no in-between — the same
    constraint the cinematic already states for `fx:` cues. Picking a slot prints a note naming the
    slot the game will actually draw at.
  - Guarded by **`pnpm --filter launcher-api run check:rig-fx-overrides`** (new) — 25 assertions over
    the real `bindingsFromSkeleton` / `fxTimelineFromSkeleton` / `registerRigFx`, **mutation-verified**
    against three plausible regressions: putting the numbers in the dedupe key (⇒ two mounts, two
    bursts per beat), defaulting `alpha` to 1 in the clamp, and dropping the registry-side clamp.
  - Verified live in the Rigger against the 73-bone `anticipation` builtin, driving the real controls:
    all six render, values clamp at both ends, a blanked box removes the key, the crossing hands the
    authored options to the overlay, the slot's own bone hosts a slot binding, and the clash warning
    fires on exactly the one case that clashes (six cases checked). The vendored
    `static/rigger/vendor/rigger-fx.js` was rebuilt (+369 B) — it MUST be, or the stage keeps the old
    two-argument `play()` and silently ignores every override.
  - ⏳ **Not pixel-verified in a running game:** the `addSlotObject` depth, and `alpha`/`scale`/`delay`
    riding the nested container, are verified by construction (against the spine-pixi 4.2.74 source,
    which rewrites a slotted container's transform AND alpha every frame — hence the nesting) and by
    the build, not by looking at a published game. That check is owed.
- 2026-08-27 — **A bound FX cue could be invisible on the stage two different ways; both fixed in
  `view.html`.** Reported as "the FX doesn't show in the Rigger preview".
  - **The cinematic's overlay depth was sticky.** FX is a second Pixi canvas over `#cv`, and only
    two bands exist (`z-index` 0 or 2 around the rig canvas's 1). A cinematic set authored BEHIND
    its cast asks for band 0 via `setFxDepth(false)` — but `#cv` clears at **alpha 1**, so band 0
    is not "behind the art", it is _invisible_, and nothing reset it on the way out. One visit to
    Cinematic mode therefore buried every animate-mode burst for the rest of the page session.
    The band is now cinematic-scoped: `setMode` restores the front band whenever cinematic mode is
    left, and both writers go through one `setFxOverlayDepth` helper.
  - **▶ Preview never ran the crossing at all.** `updateFxPreview` was gated on `animMode`, so a
    cue fired only in ◆ Animate — not in the mode most authors watch a clip back in. It now reads
    a per-mode `fxPlayContext()`: animate keeps the tool's own `curAnim`/`animTime`, preview reads
    the live track entry's name + **`getAnimationTime()`** (the runtime's own clamp — a raw
    `trackTime % dur` would wrap a NON-looping clip past its end and re-fire every cue forever).
    A clip change now clears the outgoing clip's bursts, and the whole path exits before touching
    the overlay when the running clip has no bound keyframe — preview is entered on every rig
    open, and the browser caps live WebGL contexts at ~16.
  - The single `updateFxPreview()` call also moved to **after** `updateWorld()`, so the bone
    transforms it projects are this frame's rather than the previous frame's.
  - Verified live on the local launcher against the 73-bone `anticipation` builtin (the no-login
    recipe: builtin spine + fetch/XHR/`Image.src`/rAF shims, plus a recording `window.RiggerFx`
    stub). Preview fires the keyframe once and rides the bone; looping fires once per loop;
    **non-looping fires once while `trackTime` runs to 4× the clip length**; animate is unchanged;
    setup is inert; an unbound clip generates zero overlay traffic; and `setFxDepth(false)` →
    leave cinematic restores `z-index: 2`.
  - Untouched, and still the answer to the rest of that report: an fx binding is still only
    `{ effectId, bone? }`, so **draw order (which slot the burst sits in), opacity and timing are
    not authorable** — that is the un-built "placed/persistent FX slots" half of
    [design §12.4a](../design/invisible-cinematic.md). `spine-pixi-v8` has `addSlotObject`, which
    is the primitive that build would use.
- 2026-08-25 — **The fit rule shrank the pixels and the rig stretched them straight back — a
  translation still overflowed its button.** Reported live: `Acheter fonctionnalité` ran off the
  buy-feature button exactly as before the 2026-08-18 fit shipped. The fit itself was working —
  `fitTilesToSource` re-rasterised French at 28px inside English's width — but `width`/`height`
  on a region attachment was only ever written when the attachment was **created**.
  `placeTextAttachments` bailed on sight of an existing one (`if (bag[attName]) continue;`,
  "keep an authored placement"), so the `.irig` kept declaring the pre-fit box and Spine scaled
  the new, narrower region right back up into it. On screen: unchanged, and slightly softer.
  Every rig baked before the fit was in this state, and re-baking by hand hit the same path.
  Fixed by splitting what the attachment owns: **size is the tool's** (the art's natural size,
  refreshed from the atlas region on every bake), **placement is the author's**
  (`x`/`y`/`rotation`/`scaleX`/`scaleY`, untouched — `scale` is their size knob). A mesh is
  skipped: its size is its vertices. A rig already re-baked since 2026-08-18 would otherwise
  have been stranded — its pixels are correct and its attachment is not, which no existing drift
  rule saw — so `textElementDrift` gained **`(wrong size)`**, and it clears on the cheap
  re-attach path with no rasterising (`textDriftNeedsBake`, now extracted rather than restated
  in the gate). Both new rules fail CLOSED on missing data, like the width rule: an attachment
  with no declared size is _unknown_, not wrong. Gate `rigtext-autosync.mjs` 36/36, and
  **decisive on five separate broken copies** (restoring the old bail; dropping the size rule;
  removing either fail-closed guard; routing `(wrong size)` through a full re-bake). The first
  version of that gate matched SOURCE TEXT and let two of the five pass — case 17 now RUNS
  `placeTextAttachments` against a stubbed skeleton instead.
  **Known limit, not fixed here:** a text element converted to a **mesh** cannot be fitted at
  all. Its other locales are Spine `linkedmesh` children, which inherit the parent's vertices by
  definition, so a shrunk region is stretched back onto the source's hull whatever its own size
  says. Fitting a meshed element needs either a per-locale scale on the slot or dropping the
  linked-mesh share (and with it the one-deform-drives-all-locales promise of §12.4a) — a
  deliberate design call, not a patch. Region attachments (a plain button label) are unaffected.
  **Not retroactive:** a deployed game keeps its old rig until the rig is re-opened in `/rigger`
  (which now auto-repairs it) and the game is re-published.
- 2026-08-20 — **⟳ Re-sync atlas flipped rotated regions 180°, and the cause was the boot-splash mirror shadowing the real page — a same-day regression, now fixed + guarded.** Symptom: re-syncing `R_InvisibleEngine` turned a rig that rendered CORRECTLY into one whose wordmark read `NI` instead of `IN`, with mirrored parts. Chain: `pickDeployedPage` answers "which deployed page IS this sheet?" by basename stem, newest-first, excluding only `deploy/editor-<kind>/` as derived bake output. The new `deploy/_boot/<tier>/` mirror (shipped that morning) copies a spine bundle's page under the SAME filename, **already reoriented 180° for Spine**, and rewrites it on every `ensureDeployExports` — so it was always the newest stem match and won the ranking. `ensureBundleAtlasFresh` then re-derived the bundle from that page and ran `reorientRotatedRegionsForSpine` a SECOND time, leaving every rotated region 180° out. Fix: the exclusion is now structural (`DERIVED_SUBTREE_RE` = `editor-<kind>` | `_boot` | `_pages`) with the rule stated as _a page we WROTE from another page can never be the source of truth for that other page_ — `_pages` joins it for the same reason even though its content-addressed names made a stem collision unlikely. **The convention itself was re-derived from the vendored runtime and is unchanged:** `spine-webgl-4.2.js` maps texture upper-left → displayed upper-RIGHT for `degrees == 90` (a 90° CW display rotation), so storage must be CCW while our packers store CW — the 180° reorient is right, it was just running twice. Also confirmed CORRECT and left alone: `regionsToSpineAtlas` writes `bounds` with UPRIGHT `w,h`, which is what the parser wants (it derives the `(h×w)` footprint itself at `u2 = (x + height)/pageWidth`). Guarded by `pnpm --filter launcher-api run check:deployed-page` (9 assertions), **mutation-verified** — restoring the old `editor-*`-only exclusion fails exactly the three `_boot`/`_pages` cases, and a `_bootcamp/` look-alike is asserted NOT excluded so the fix stays surgical. **Not retroactive:** any rig re-synced while the bug was live is still flipped; re-sync it once more after this deploys and it resolves the real `sprites/` page and reorients once.
- 2026-08-18 — **Two rig-editor crashes, found while building the cinematic's Tweak Mode** (which
  drives this file's animator, so its bugs are this tool's bugs). Both are old, both are one-line:
  - **◆ Animate died on any freshly imported `.json` rig.** Spine JSON omits `time` on a keyframe
    at 0 — it is the format's default — and `sampleChannel` treats `k.time` as a number. A channel
    whose ONLY key is written that way made it walk off the end of the array and throw _from the
    frame loop_. Rigs saved by this tool always write the time, so it only ever bit imports; the
    `anticipation` builtin has 37 such channels. Now normalised once at load (`normalizeKeyTimes`),
    which fixes the sampler, the dopesheet, key drag and `animDuration` together.
  - **A slot with no setup attachment broke every `setMode` on that rig.** `slotsWithPath` handed
    the slot's null `attachmentName` to `getAttachment`, which throws on null instead of returning
    nothing, taking `buildInspector` — and therefore the mode switch — down with it.
    See [status/cinematic](cinematic.md) for Tweak Mode itself.
- 2026-08-18 — **A translation now SHRINKS to the source locale's width instead of running off
  the art.** Owner, once French finally reached the button: "the text is not fitting anymore."
  `Acheter fonctionnalité` baked 421px against `Buy Feature`'s 247px — 1.7× — and every locale
  shares ONE placement (that symmetry is what makes swapping language never move the text, and
  what lets a mesh authored once drive them all as linked meshes), so the extra width simply
  overhung the button.
  - **Fitted at bake time, not by scaling the attachment.** `fitTilesToSource` takes the source
    locale's rasterised width as the budget and re-rasterises any wider sibling at a smaller
    FONT SIZE — uniform, never an x-squeeze, because a distorted translation reads as a bug
    where a smaller one reads as intended. Per-locale attachment scale was the alternative and
    was rejected: it breaks the shared placement and is silently discarded the moment the
    element becomes a mesh.
  - **It terminates.** A variant wider than the source is drift, so old art re-bakes — but the
    applied size is now persisted (`RigTextVariant.fontSize`), and a variant already shrunk
    below the element's size is left alone. Without that, a translation too long to fit at the
    8px floor would re-bake on every rig open forever. The gate pins this as its own property.
  - **An unfittable locale warns rather than disappearing.** New `warnings` channel on the bake
    result, kept apart from `failed` (which means "no pixels"): these ship, they just ship wide,
    and only the author can shorten the string or give the element more room.
  - Gate grew to **27/27**. Two separate broken-copy runs prove it decisive: removing the
    attachment-drift rule fails 3, removing the termination guard fails 2. It also caught the
    fit rule failing OPEN on a variant with no recorded width (`undefined <= n` is false), which
    would have re-baked every pre-fit variant on sight.
  - **The auto-sync loaded strings but not FONTS**, so its first real re-bake lost every tile to
    "the font could not be loaded" and wrote nothing. Only live use could surface it: the gate
    reasons about drift rather than pixels, and the first live run repaired _attachments_, which
    needs no rasteriser at all. Fixed on both sides — the auto-sync loads both catalogs, and
    `save()` now loads the font catalog itself if no caller did, since resolving fonts is the
    bake's own business and not a prerequisite each call site should have to remember.
- 2026-08-18 — **A rig's localized text now follows `/localization` on its own, and the bake
  finally SAVES the rig.** Owner: the remake's new Spine "Buy Feature" button stayed English in
  a `lang=fr` game. Three faults in one chain, found by walking it end to end on live R2:
  - **The bake never persisted the skeleton.** `placeTextAttachments` wrote the slot/bone/
    attachments into `rawDoc` and called `markDirty()` — nothing else. So a bake that reported
    success left the `.irig` naming only the source locale while the translated regions sat in
    the atlas unused, and the runtime swap (which requires the sibling `<base>@<locale>` to
    EXIST) had nothing to swap to. Publishing exported the R2 rig, so the game shipped English.
    `bakeAndPlaceText` now saves as step 5. This was the actual bug; the rest is why it was
    reachable at all.
  - **The reviewed gate is gone for rig text.** `/api/rigger/strings` returned translations only
    once REVIEWED, so an author who had never opened `/localization` to approve anything got a
    single-locale bake and no explanation. The gate's premise — baked art cannot be corrected at
    runtime — stops holding once the re-bake is automatic, so it now returns every translation
    and reports `unreviewed` as a LABEL. `/api/localization/strings` (the game's own export) is
    untouched and still ships reviewed-only.
  - **Opening a rig reconciles it.** `autoSyncRigText` compares the baked variants against the
    current strings and the skeleton's attachments, and repairs what drifted: a new language, a
    corrected string, or — the repair path for every rig baked before today — variants whose
    attachments never reached the `.irig`. That last case skips rasterising entirely, since the
    pixels are already packed. A rig with no text, or one already current, does no work beyond
    one strings fetch. It refuses to run on a dirty rig: every path ends in a save, and silently
    committing edits the author has not chosen to commit is not the tool's call.
  - **Gate.** `tools/rigger-spike/rigtext-autosync.mjs` **15/15**, extracting the REAL
    `localesFor` (`src/rigger-text/main.ts`) and `textElementDrift` (`view.html`) rather than
    restating them — a drift oracle that disagrees with the baker either re-bakes forever or
    never, so they must be the same definition. Includes a convergence assertion (re-measuring
    the bake's own output finds nothing stale). Run against a deliberately broken copy
    (`RIGTEXT_VIEW_SRC=…`) it fails 3 — and doing that is what exposed two assertions passing
    **vacuously** on an empty array, now guarded.
  - ⏳ Live-verify owed: the automatic path has not been watched running in a real browser.
- 2026-08-18 — **Baked text was CUT to the font's declared line box; it now always fits.** Owner:
  "the text we create in the rigger is getting cut at creation" — a descender sheared flat off
  `Buy Feature`. PIXI frames text by its METRICS, not its ink: `BitmapText` reports a line as the
  sum of the glyphs' `xAdvance` by the font's `lineHeight`, and `extract` renders exactly that
  box. Any glyph whose baked art overhangs — a descender under a `lineHeight` that under-declares
  it, a swash past its advance, a baked shadow or outline — was drawn outside the frame and lost.
  Permanently, because rig text IS art: no runtime fix, only a re-bake. `rasterizeString` now
  rasterises into a PADDED frame, measures the ink that landed, grows the pad until no ink touches
  an edge, and cuts the tile back to the metric box **grown symmetrically** by the largest
  overhang. Symmetric on purpose: a region attachment is placed by its CENTRE, so an even margin
  leaves every locale's centre exactly where the metric box put it — a translation that overhangs
  and one that does not still line up — and a font with honest metrics yields the same tile as
  before, byte for byte. **Existing text elements keep their cut art until re-baked** (✎ on the
  element → Re-bake). `rigtext-browser.mjs` grew a decisive gate: the same font art served twice,
  once behind a descriptor that under-declares its box (a line 45px shorter, advances 40%
  narrower), asserting the ink survives identically. It fails hard on the old code — 45px of
  height and 16px of width gone, 62% of the ink — and passes on the fix.
- 2026-08-18 — **Preview mode's Properties column now points at Setup instead of dead-ending.**
  Selecting a slot outside Setup rendered three read-only lines (name → bone → attachment) and
  nothing else, for EVERY slot — which reads as "this attachment has no options". It surfaced on
  localized text art (owner: "I can't really do anything with this text, was mesh + bones not
  shipped?" — it was: the text is an ordinary region, so ▸ Convert to mesh, the weight brush and
  the `deform` channel all apply, one mode over). The readout now carries a **✎ Setup to edit
  this slot** button; `setMode` re-selects the same slot, so the editor opens on what was already
  selected. Shown only with an editable rig open (a view-only `.skel` cannot enter Setup).
  Verified in headless Chromium on the real rig: the button switches mode, keeps the selection,
  and the panel comes back offering Convert to mesh — and `rigtext-panel.mjs` still passes 49/49.
- 2026-08-17 — **Text as LOCALIZED ART in the rig** (design
  [invisible-cinematic §12.4a](../design/invisible-cinematic.md); guide:
  [tools/rigger](../tools/rigger.md#localized-text-setup-mode--text-localized-art)). Three
  commits: the text→region pipeline, the `/rigger` panel, and the game-side swap.
  - **Where the art lives, and why it ships.** The rasterised strings are packed onto a **second
    page of the rig bundle's own `.atlas`**, not into the source sheet. `exportSpineBundle`
    already copies every page `atlasPageNames` finds, so the text page travels export →
    `deploy/` → bake → pull → register **with the rig, for free** — no new asset class, nothing
    stranded (rule 8). Packing into the source sheet would have re-packed it, moving every rect
    and invalidating the frozen geometry of every other rig built on it.
  - **The catch that created.** `ensureBundleAtlasFresh` re-synthesises the `.atlas` wholesale,
    so an appended block would be silently dropped on the next sync. The text page is therefore
    **derived** there from `<bundle>/text.json` on every synthesis, and the document's hash is
    folded into the bundle revision — otherwise a text-only edit (same sheet, same page ETag)
    would short-circuit the freshness gate and every consumer would keep serving the pre-text
    atlas. A rig with no text composes a **byte-identical** atlas and an unchanged revision, so
    `new`'s recorded baseline stays valid.
  - **Localization = attachment swap**, done in `BaseSpineProvider` so every rig in the game
    gets it (`packages/pixi-svelte/src/lib/spineLocale.ts`). Guarded twice: the suffix must look
    like a locale (TWO-letter language + optional subtag), and — the guard that matters — the
    sibling `<base>@<locale>` must EXIST, so a coincidental name can never hide art. Unbaked
    language ⇒ the source art, never a blank slot.
  - **Mesh + weights + deform are authored ONCE.** Converting the source locale to a mesh
    relinks the other locales as Spine `linkedmesh` (shared geometry, own `path`, `deform:true`);
    a locale arriving after a mesh exists is created as one. Without this a German player would
    have got an unrigged quad where the English one deforms.
  - **Reuse, not rebuild:** rasterisation is PIXI's own `BitmapText`/`Text` through the shared
    `$lib/fontLoad.client.ts` (so what bakes is what the game's font draws); packing is the Font
    Maker's glyph packer, extracted to `$lib/shelfPack.ts` and now shared by both; the browser
    bundle `static/rigger/vendor/rigger-text.js` follows the `rigger-fx.js` pattern
    (`pnpm --filter launcher-api build:rigger-text`); strings come from `/localization` via
    `/api/rigger/strings`, and only **reviewed** translations are bakeable (art cannot be
    corrected at runtime); the font catalog/asset endpoints gained `rigger` as an `altTool`.
  - **Verification.** 4 gates, 179 assertions, two of them in a REAL browser:
    `rigtext-panel.mjs` **49/49** drives the actual `view.html` in headless Chromium on a real
    shipped rig + font (the decisive assertion: after the round trip the **minified** vendored
    runtime resolves every text region — `missingArt` empty — and an authored mesh **survives**
    the re-bake's reload); `rigtext-browser.mjs` **32/32** drives the vendored bundle with
    metrics chosen to be sensitive (ink boxes not lit-pixel counts; a longer string must be
    measurably wider; two strings must differ in pixels); `rigtext.mjs` **58/58** composes the
    atlas and loads it with spine-core as region / mesh+linkedmesh / weighted mesh;
    `rigtext-runtime.mjs` **30/30** pins the swap. Four assertions failed first and each found a
    real bug — a 2–3 letter locale pattern classified `logo@big` as a locale; and the swap
    keyed "already right?" off the setup attachment, so switching BACK to the source language,
    or to an unbaked one, left the previous language on screen.
  - **⏳ Live-verify owed (owner).** Nothing here has touched real R2, real auth, or a real
    game: the conditional write + presigned upload + stale-page sweep ran only against fakes,
    and **how the baked text LOOKS** (a bitmap font's premultiply halo, the size relative to the
    rig) has never been eyeballed. In `/rigger`: open a rig with a project font and a localized
    key, ＋ Add text, then re-open the rig and confirm the regions survive; then publish and
    confirm `deploy/` carries the `rigtext-*.png` page. **Shipped games need an `engine`
    submodule bump** to receive the runtime swap.
- 2026-08-10 — **Stale manifest geometry could rotate/mis-place a region (fixed at the read
  layer).** A rig bundle's `.atlas` is synthesised from the source sheet's `atlas_manifest_*.json`
  `regions`, whose `x/y/w/h/rotated` are a CACHE of the packed page. That cache can drift from the
  actual page — e.g. `bookofborutremake/S_VFX` had `T_VFX_AnticipationLine_shine` cached as
  `rotated:false` at (0,428) while the page (and the sibling `S_VFX.atlas` + `S_VFX.json`
  TexturePacker output) have it `rotate:90` at (975,0); its `_zoom` sibling was cached with the
  SWAPPED slot. `regionsToSpineAtlas` trusted the stale rect, so the Rigger sampled an un-rotated,
  over-tall page rect that bled into the neighbour below (the frame with a circle-burst tacked
  underneath; siblings looked fine because their cache happened to match). Fix: `loadRegionSet`'s
  `backfillMissingGeometry` (`$lib/server/editorRegions.ts`) now RECONCILES each region's on-page
  placement + rotation against the authoritative `atlas.texturepacker_json` (`frame` = the tight
  packed rect; un-swap a rotated frame's axes back to upright), overriding a drifted `x/y/w/h/
rotated` — **never trim** (`offX/offY/origW/origH`), per the `RawRegion` landmine. Heals via the
  same `ensureBundleAtlasFresh` used on the Symbols/Editor read path, the bake path, and the
  Rigger's **⟳ Re-sync atlas** button. Launcher-server only (`editorRegions.ts`) — no engine change,
  no submodule bump. Headless proof: replicated the reconcile against the real `S_VFX` manifest +
  TP JSON → base/zoom/shine/glow all match the packer ground truth (4/4). **⏳ Live-verify owed
  (owner):** open `R_AnticipationColumn` in `/rigger`, click **⟳ Re-sync atlas**, reload — the
  `_shine`/`_zoom` meshes should render as the upright glowing frame (no rotation, no circle-burst
  bleed). A re-pack of any sheet self-heals on next read/bake with no manual step.
- 2026-08-04 — **Phase 3.6c: hull editing + a shared vertex-permutation primitive (fixes a
  latent deform bug).** New **⬡ Hull** mesh mode: click an interior vertex to **promote** it onto
  the outline (inserted at the nearest non-crossing slot), or a hull vertex to **demote** it to
  interior (convex corners fall out via retriangulate's outside-drop; the ⟁ hull loop draws bright
  green in the mode). Any hull change is a vertex-index permutation applied by
  `permuteMeshVertices` to **every** index-keyed store — uvs, vertices (unweighted flat / weighted
  packed blocks), triangles, `edges`, hull, `selMeshVert`, and **deform animation timelines**
  (`reorderDeform`, spine-core-validated: unweighted 2 floats/vertex, weighted per-influence runs).
  **This also fixes a pre-existing latent bug:** `dedupMeshVertices` / `dropMeshVertices` /
  `removeMeshVertex[Fallback]` renumbered verts but never permuted deform, so removing/merging a
  vertex silently mis-aligned existing deform keys (fine at rest, corrupt on playback / re-import);
  all four now call `reorderDeform`. Hull-loop _reordering_ deferred to 3.6d. Launcher-static only
  (`view.html`) — no engine change, no submodule bump. Offline proof:
  `tools/rigger-spike/hulledit.mjs` — posed deform is byte-preserved through a permutation on BOTH
  an unweighted and a weighted (varied influence-count) mesh via spine-core, hull stays a simple
  polygon (9/9). **⏳ Live-verify owed (owner):** ⬡ Hull promote/demote on a real mesh; and a mesh
  WITH a deform animation → remove a vertex → play the deform → geometry stays correct.
- 2026-08-04 — **Phase 3.6b: constraint-edge (mesh `edges`) authoring.** New **✎ Edge** mesh mode:
  click two vertices to toggle a "keep this edge" constraint that (a) **survives re-triangulation**
  — guaranteed present via proper constrained edge-insertion (`forceConstraintEdge` re-triangulates
  the cavity the segment crosses, not just flip-protection) and (b) **persists losslessly** as spine
  `edges` (`vertexIndex×2` pairs). The `edges` field was previously _derived-and-dropped_ on every
  topology edit; now the four `delete rd.edges` teardowns are **remaps** (`remapEdges` +
  `removeOneRemap`) so author constraints survive add/remove/dedup/drop, and every retriangulate
  **re-derives** `rd.edges = hull loop ∪ author interior edges` (`cdtWithConstraints`) — also giving
  a lossless desktop-Spine outline round-trip. Constraint edges draw **amber** in both the WebGL
  overlay and the 3.6a UV panel. Hull reordering is deferred to 3.6c (open item #3). Launcher-static
  only (`view.html`) — no engine/`packages` change, no submodule bump. Offline proof:
  `tools/rigger-spike/hulledges.mjs` — `forceConstraintEdge` makes a missing diagonal present
  fold-free + area-preserving, collinear guard refuses cleanly, `hull`/`edges` round-trip
  byte-identical through spine-core (`hullLength === hull*2`), remap-on-removal correct (8/8).
  **⏳ Live-verify owed (owner):** in `/rigger`, enter ✎ Edge on a real mesh, mark an interior edge
  → the triangulation should visibly honour it (amber in canvas + UV panel); add/remove a vertex →
  constraint survives or drops cleanly; save→reload → edge persists.
- 2026-08-04 — **Phase 3.6a: visual UV editor panel.** The mesh inspector now shows a "UV map"
  panel — the region art drawn upright with the mesh wireframe over it — and you can **drag a
  vertex in region-local UV space** to re-map which pixels it samples (the dual of the isolate-mode
  world-drag). Works purely in region-local 0..1 UV; `att.updateRegion()` handles the page mapping,
  so the panel only reasons about the upright art. Selection (`selMeshVert`), the numeric u/v
  fields, and the main-canvas overlay all share one write path (`applyVertexUV`) so they stay in
  sync. Launcher-static only (`apps/launcher-api/static/rigger/view.html`) — no engine/`packages`
  change, no submodule bump. Offline proof: `tools/rigger-spike/uvpanel.mjs` (letterbox fit,
  uv↔pixel round-trip, clamp, hit-test, rotated-pack aspect swap — 12/12). **⏳ Live-verify owed
  (owner):** the `degrees===90` rotated-art blit (`drawRegionUpright`) is a canvas transform a
  headless spike can't render — open `/rigger` on a rig with a **rotated-packed** region and
  confirm the art shows upright and dragging tracks; if it's sideways, that one branch is the fix.
  Hull/edge editing is deferred to Phase 3.6b (open item #3).
- 2026-08-04 — **Ship-from-Rigger (rule 8) closed (owner-confirmed).** A rig now travels the full
  export → `deploy/` → bake → pull → runtime-register chain into a game — the standing "renders in
  `/rigger`" ≠ "ships" gap is resolved.
- 2026-07-28 — **Save can no longer silently un-ship a rig.** `POST /api/rigger/save` rebuilt
  the WHOLE project index via `buildSkeletonsIndex` and overwrote `skeletons.json`; that scan
  SILENTLY DROPS any skeleton folder whose `.atlas` is missing (`if (!atlases.length) continue`
  in `spineIndex.ts`). So re-saving an atlas-less rig un-shipped it (blank in the editor, gone
  from the editor-art export + game), and saving rig A could drop a DIFFERENT atlas-less rig B.
  Now `save` goes through **`reindexSkeletonsPreserving`** (`spineIndex.ts`): Layer 1 re-derives
  a missing `.atlas` from the folder's `source.json` via `ensureBundleAtlasFresh` (the `⟳ Re-sync
atlas` path); Layer 2 preserves the prior `skeletons.json` entry for any folder it still can't
  rebuild (never drops) and, for the folder being SAVED, **fails 400 loudly** ("…has no atlas and
  no source to rebuild it — re-sync an atlas first") instead of writing a self-dropping index. A
  healthy save is byte-identical to before (parity fast-path). Offline proof:
  `tools/rigger-spike/reindex-preserve.mjs` (esbuild-bundles the real helpers; 21/21).
  **Still-risky (noted, not yet fixed):** `rigger/{new,upload,delete}` and `editor/spines/reindex`
  do the same project-wide `buildSkeletonsIndex` overwrite, so any of them can drop an atlas-less
  rig B. Route them through `reindexSkeletonsPreserving` (or a preserve-only variant) next.
- 2026-07-16 — **Rig + animation library catalogs are Postgres rows, not R2 blobs.** The
  `_shared/{rigs,animations}/index.json` blobs were read-modify-written by four endpoints with
  no guard, and are GLOBAL (not project-scoped) — so two users on _unrelated_ projects silently
  dropped each other's rows, surfacing as "my rig vanished" (the `<id>.json` body wrote fine;
  only the catalog entry was lost). Row upserts remove the race structurally. Blob/row ordering
  now fails toward an orphaned blob, never a dangling row ([detail in history](../history.md)).
- 2026-07-16 — **reverted** the same day's `parseRegions` snake_case trim read: it re-based the atlas coordinate space under every rig's frozen geometry (art shrinks by `w/orig_w` and corner-anchors on the next `⟳ Re-sync atlas`), and the `off_y` it switched on is TexturePacker's Y-down where Spine wants Y-up. `parseRegions` is deliberately camelCase-only now — read the landmine comment on `RawRegion` before "fixing" it again ([detail in history](../history.md)).
- 2026-07-16 — "＋ add image…" now inherits the slot's setup placement instead of seeding a fresh attachment at the bone origin, and warns before flattening a mesh slot; "replace image (keep mesh)…" re-derives `width`/`height` from the new region ([detail in history](../history.md)).
- 2026-07-14 — Rigger FX overlay redrawn with the full bone transform so it matches the in-game renderer at any scale ([detail in history](../history.md)).
- 2026-07-14 — `/rigger` `view.html` + vendored bundles cache-bust via `?v=BUILD_ID` so a redeploy is fetched fresh ([detail in history](../history.md)).
- 2026-07-10 — Live rig-bound FX preview on the stage + docked event-key inspector (pick an effect directly on a keyframe) ([detail in history](../history.md)).
- 2026-07-08 — Timeline event-key authoring UI (name / int / float / string / time) on the dopesheet ([detail in history](../history.md)).
- 2026-07-06 — "✨ Auto FX slots": auto-author FX layers from the atlas manifest ([detail in history](../history.md)).
