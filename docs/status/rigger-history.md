# Invisible Rigger — change history (detail)

> The long-form record behind the "Recent changes" in [rigger.md](rigger.md): what broke, why, the
> measurements, and the constraints the fixes rely on. Newest first. Entries that later work
> superseded, or whose whole lesson now lives in a spike or gate, were dropped. Before 2026-07-16:
> [docs/history.md](../history.md).

- 2026-10-01 — **Rig undo / redo** (was open item 1).
  - **Model.** Snapshots, not commands, as in cinematic.js and Flow's `undoHistory.ts`: each entry
    is `rawDoc` as JSON text plus the selection (bone, slot, constraint), the skin on stage and the
    open clip with its playhead. The existing edit funnel draws the steps: `markDirty()` only notes
    that the open step has changes (`historyNote`); `historyFlush` serialises and pushes it, and is
    a no-op when the text did not change. So no edit site was touched except the ones that must be
    one step whatever calls them.
  - **Step boundaries.** Capture-phase listeners on `window` (pointerdown, keydown, input, change,
    click, dblclick, contextmenu, drop) key each user action and close a pending step whose key
    differs BEFORE the action's handler runs, which is what keeps "typed, then deleted 100 ms later"
    two steps. A field's key is its place in the page plus the selection and playhead, so typing in
    one field coalesces (800 ms debounce, as in Flow) and survives the inspector re-rendering. A
    pointer gesture holds every flush until after pointerup's task (the mouseup handlers that
    commit a drag run there); a FIELD's blur must not end it, because a pointerdown on the canvas
    blurs the focused field. `historyStep(fn)` closes the open step, runs `fn`, closes again — used
    by bone/slot/constraint delete, ▸ Convert, ② Auto-weight, 🩹 Repair and the import's merge,
    which lands after a fetch with no user action around it.
  - **Two histories.** The cinematic's covers its own document; it takes Ctrl+Z only on the plain
    Cinematic stage (its handler already returns while tweaking). The rig's takes it in every other
    mode with a rig open, tweaking included (`rigHistoryActive`). Neither can reach the other's
    document. Undoing during a tweak keeps the strip's clip open; a clip the snapshot lacks (an
    inline override born from the key being undone) is dropped and the next key makes it again.
  - **Derived writes.** `ensureRigBounds` writes `skeleton.x/y/width/height` on save, ⤓ .irig, 📦
    and the bounds toggle with no `markDirty`, so that write rode into the NEXT undo step and undoing
    to "the saved document" came back without it. `settleRigBounds` folds it into the present
    instead.
  - **Memory.** `RIG_HISTORY_LIMIT` 100 entries and `RIG_HISTORY_MAX_BYTES` 64 MB over past +
    future (string length ≈ bytes: rig JSON is ASCII, one byte per char in V8), always keeping at
    least one step. Measured in headless Chromium on the biggest checked-in rig, mm_bigwin: 1.07 MB
    per snapshot, `JSON.stringify` ~7 ms, a step ~6-8 ms; 64 MB keeps 59 of its steps.
  - **Gate.** `tools/rigger-spike/rig-undo.mjs` (89 checks) drives the real page: typing, a canvas
    drag, a colour scrub, a keyboard-stepped slider, ◆ Key, ＋ animation / skin, a delete cascade,
    convert / auto-weight / a constructed stale mesh + 🩹 Repair, an import mid-typing; each undo
    string-equal to the previous `rawDoc`, each redo to the next. `--mutants` runs it against 12
    planted mutants (no coalescing, no boundary, gesture not one step, `historyStep` not closing,
    undo leaving the rig clean, a failed open keeping history, no byte cap, no entry cap, selection
    not restored, redo branch kept, rig history taking Ctrl+Z in Cinematic, keys reaching into text
    fields); every one fails the gate.
  - **Found on the way.** cinematic.js's `frame` read `doc.stage` from the moment the script loaded,
    before `init` set `doc`, so entering 🎬 threw every frame until its imports landed; it now
    returns until there is a doc.
- 2026-10-01 — **A bone delete is compensated** (open item 8).
  - **The jump.** `deleteBoneCore` re-parented the bone's children and slots onto its parent and
    moved its weighted influences there, all keeping their LOCAL values, which were relative to
    the deleted bone. On `anticipation`, `W` and `S` that moved 47, 57 and 21 of the bones and
    attachments checked; deleting the synthetic rig's `spine` moved its whole arm by 140 units.
  - **What is composed in.** The world transforms of the deleted bone D and its heir G (the
    parent) give the map `M = G⁻¹ · D` from D's space into G's. A child bone gets the local
    values that put it at the world it had (`boneLocalAt`), in its own inherit mode: `normal`
    and `noRotationOrReflection` solve the 2×2 against the frame the mode builds from the parent,
    and `onlyTranslation` only moves. The no-scale modes build their frame from the bone's OWN
    rotation, so the rotation is solved first, turning the bone until the frame's x axis points
    where it did, and then shear and scale are re-solved under that frame. The solve keeps the
    authored shearX and the signs of both scales, so under a parent that only turned and scaled
    a child just turns and scales. A mirrored child stays mirrored rather than becoming a
    180°-turned one with a flipped shear. A slot's image, point, unweighted mesh / path / box /
    clip vertices and their deform keys go through `M` (`rehomeAttachment`,
    `rehomeSlotDeform`), and a path's `lengths` scale with it. An influence on D becomes one on G
    at `M·p`. If the vertex already has an influence on G, the two merge, because
    w₁·G·p₁ + w₂·G·p₂ = (w₁+w₂)·G·(their weighted mean). The merged influence's deform offset is
    the same weighted mean, with D's offset turned by M's 2×2 (`remapWeightedDeform` now takes a
    list of weighted, transformed source entries per new entry).
  - **Which pose.** The one the stage draws: `posedSetupWorlds` loads the doc through the
    runtime in the skin on stage, with constraints applied and physics off. `setupWorlds` (a pure
    mirror of the reference core runtime 4.2's `updateWorldTransformWith`) fills in any bone the skin leaves
    inactive. Two traps decide which doc is posed. First, the constraints the delete removes
    must already be gone, or the dependants keep a pose that vanishes with them. Second, D must
    still be in the constraints that stay: the cascade's predicate filters D out of their `bones`
    lists, and posing after that left D unconstrained, which threw its dependants off by up to 59
    units. So the delete poses a copy with only the broken constraints dropped.
  - **Not exact.** An image has no shear, so on a bone whose transform would shear it (a
    non-uniform scale or shear between D and G) it keeps its centre, axis and area. Animation:
    D's own keys go with it (the cascade since #880 drops `animations.*.bones[D]`), so its
    dependants no longer follow its motion. A child's own keys are offsets in its parent's
    space, so a translate key now moves it along G's axes. Mapping those through `M` would need
    the x and y curves of a split or Bézier-eased translate to be combined, which rig cannot
    express, so the confirm says it instead. A local-space transform constraint reading a
    re-solved child's local values sees the new ones. A two-bone IK `[G, D]` survives as a
    one-bone IK on G, which poses G differently.
  - **Degenerate scales.** A deleted bone at scale 0 has flattened its dependants in the setup
    pose. Composing that in would zero their own values for good, so that delete stays
    uncompensated, as before. A CHILD at scale 0 hides the axis it scales, so the solve would
    keep its old rotation and lose the turn. It is solved at scale 1 and the zero is put back.
  - **Code review** (the `code-reviewer` agent) found both scale cases. It also found that
    merging two heir influences on a vertex the bone never touched shrank the influence count
    without remapping its deform keys, so merges now happen only on a vertex that had an
    influence moved. The pose load no longer writes into the open rig's `missingArt`.
  - **Proof.** `delete.mjs` snapshots what the runtime draws, in every skin: each active bone's
    world and each attachment's world geometry (image corners, point position and direction,
    vertex attachments' vertices). After every bone delete, everything left must match the
    reference within 1e-3: the rig with only the removed constraints deleted. This covers every
    bone of the given rig (CI: `anticipation`, plus `W` and `S`, newly in CI) and the synthetic
    rigs. A new one has deleted bones with a child in every inherit mode, a mirror, non-uniform
    scale and shear, a sheared heir, every attachment kind, merged weights and deform keys
    (checked under the animation too), and two transform constraints: one survives the delete,
    one goes with it. Run over all 153 checked-in rigs, the check found one more bug: an image with
    a NEGATIVE `scaleX` (`symbols2/M`, `multiplier_pick_glow`, 859 units off). Its axis had been
    given the scale's sign twice, because the bone solver's sign handling was copied, and an
    image's rotation axis carries no scale. The synthetic image now mirrors `scaleX`. 19 mutants
    are each caught, that bug and the three review findings among them. Two of them, "no-scale rotation not solved" and
    "mirror sign dropped", leave the world exact, so the rig also asserts the clean values:
    deleting `g` turns its mirrored child by 15° and scales it by 0.9, still mirrored, and turns
    its no-scale child by 15° with shear and scale untouched.

- 2026-10-01 — **✨ Auto FX slots on a slot showing an image sequence.**
  - **The break.** `autoCreateFxSlots` maps each slot to the region its setup attachment samples
    (`path`, or the attachment name). For a sequence that is the frames' prefix (`symbexpl_`).
    When the atlas also held a region of that name with an FX layer beside it
    (`symbexpl__glow`), Auto FX duplicated the slot and `repointSlotSetupImage` set the copy's
    `path`. That re-aimed all 13 frames at `symbexpl__glow01`…, which do not exist, and stock
    Rig refused the rig ("Region not found in atlas: symbexpl__glow01").
  - **Refuse, not carry.** Carrying the sequence would need the FX frames as their own numbered
    run (`<path>_glow` + number). The Sheet Maker writes FX per image (`<frame>_glow`), and rig
    names a sequence's frames `<path><number>`, so no declaration can name them.
    `fxRepointRefusal` is checked BEFORE the duplicate, so a refused layer leaves no orphan
    slot. `repointSlotSetupImage` refuses on its own too and returns why. A per-frame layer
    (`symbexpl_01_glow`) was reported as "base not slotted". `sequenceFrameSlots` now names it as
    one frame of the sequence on its slot.
  - **Proof.** `sequence.mjs` §F (CI, on `W`): the W atlas plus the trigger regions, through the
    shipped `autoCreateFxSlots`. The rig still opens in stock rig, there is no FX slot from the
    sequence slot, both skips are explained, and a plain image beside them (`wild_exp_w`) still
    gets its `_glow` slot (the control). With the refusal planted out, 4 checks go red, the load
    with "Region not found".

- 2026-09-30 — **A create that died after its claim no longer holds the name** (the residual the
  entry below left open).
  - **The window.** `rigger/new` and `rigger/upload` claim `<spines>/<name>/<name>.irig` with
    `If-None-Match`, then list for a case clash, then write the page, the atlas and
    `skeletons.json`. A request that dies after the claim (or after the page) leaves a folder with
    no atlas, so the index never lists it: no Rigger surface can open or delete it, and
    `rigBundleNameTaken` refuses the name, in every case spelling, for good.
  - **Reclaim** (`riggerAbandonedClaim.ts` `reclaimAbandonedClaims`, called by both routes before
    the name check). A folder named like the new rig is abandoned when it is not in
    `skeletons.json`, has no `.atlas`, holds only `<folder>.irig` and page images (no subfolder,
    no `source.json`), and every object in it is at least `ABANDONED_CLAIM_MS` (10 min) old. A
    create does seconds of work after its claim, so an in-flight one is never taken for dead. An
    unreadable index reclaims nothing.
  - **Order.** Back the `.irig` up to its 🕘 folder, take it over with `If-Match` (overwritten
    with `{}`), then delete the folder's objects. Two guards make concurrent reclaimers safe.
    First, the HEAD's ETag must equal the one the listing showed: a HEAD alone would read a fresh
    claim another create made on the freed name since the listing, and the takeover would then
    delete it. Second, the takeover is conditional, so of two creates that both read the stale
    claim only one proceeds to delete. A reclaimer that dies after the takeover leaves a `{}`
    `.irig` of the same shape, reclaimed 10 minutes later.
  - **Not covered.** A create stalled more than 10 minutes between its claim and its page
    write would find its folder reclaimed under it; nothing in that path waits on anything
    slower than an R2 PUT.
  - **Gate.** `check:rigger-writes` (51 checks, real routes, mocked R2 with per-object mtimes and
    HEAD seams):
    - For each route: a same-name stale claim, and a stale claim plus page under another case,
      are reclaimed, and the rig is created and backed up.
    - Refused and untouched: a young claim, a listed atlas-less rig however old, a folder with an
      atlas, with another file, with a differently named skeleton, recently written, or with an
      unreadable index.
    - Same-name creates at once, with B held before and after its HEAD while A reclaims and claims.
    - Two creates that both read the claim first.

    Proof it has teeth:
    - 15 checks fail on the previous routes. Six of those are the older interleaving cases, whose
      list counts moved.
    - Each rule of the reclaim has a mutant that fails a check: the listing-ETag comparison, the
      `If-Match` takeover, the age check, the index check, and the folder-shape check.

- 2026-09-30 — **A mesh made from an image draws the image's pixels — trimmed, rotated or a
  sequence — and meshes the earlier tools saved wrong can be repaired in one click** (were open
  items 10 and 12).
  - **Root cause, trimmed images (12).** A `RegionAttachment`'s quad covers only the trimmed ink
    (`updateRegion` offsets it by `region.offsetX/Y`), but a `MeshAttachment`'s `uvs` are a fraction
    of the UNTRIMMED image, v down: its `updateRegion` subtracts the offsets and scales by
    `originalWidth/Height` against the page size, and undoes a 90/180/270° pack. Read off the
    vendored reference WebGL runtime and the reference core runtime 4.2.74 (the same code). ▸ Convert to mesh wrote
    UVs `[0,1, 0,0, 1,0, 1,1]` over the ink's quad and ✎ Draw mesh wrote `affineUV` (0..1 across
    that quad), so the whole image — and whatever the atlas packs beside the ink — was squeezed
    into the ink's box. Now both map through `regionInkUVs(region)` (the ink's place on the image:
    `u0 = offsetX/ow`, `v0 = (oh − offsetY − height)/oh`, …): Convert's corners take the ink's
    corners, a drawn point `(s, t)` on the ink's quad takes `inkToImageUV`. The vertices are
    unchanged (the ink's quad), so the mesh draws exactly the region's pixels. That is also the format's own UV space — its `ground_snow` in `symbols` (ink 70×134 of 192×134) has UVs
    0.319–0.681, the ink's span — while its default region→mesh is a whole-image quad
    (`[1,1, 0,1, 0,0, 1,0]`, 115 of 118 checked-in 4-vertex meshes): it packs from untrimmed
    source images, whereas an atlas has no pixels outside the ink to give such a quad.
  - **Root cause, sequences (10).** Convert, Draw and ＋ Linked mesh built the new attachment from
    `path` alone; a sequence's `path` is its frames' shared stem (`fx_`), which no region carries,
    so the mesh drew placeholder art and the strict loader throws "Region not found in atlas". All
    three now copy `sequence` (setup frame included); the linked-mesh source picker gives a
    linked mesh its new source's frames and, when the new source has none, takes its frames away
    along with its own sequence keys in its skin (`dropSequenceKeysFor(slot, att, onlySkin)`) —
    those keys would otherwise throw at load. Convert calls `Sequence.apply` first (an image the
    stage has not drawn has no region yet). 41 of the 44 checked-in sequences trim each frame
    differently, and a mesh has one set of UVs for every frame: Convert covers the union of the
    frames' ink (`sequenceInk`, placed through `regionPointAt`, the region's own placement
    formula), and Convert and Draw both ask first when the frames differ, since a frame with less
    ink then shows what the atlas packs beside it in the rest.
  - **UV panel.** `drawRegionUpright` stretched the ink over the whole box. The box is now the
    untrimmed image (`uvArtAspect` from `originalWidth/Height`), the ink sits where the UVs find it,
    and the 180 / 270° packs are undone too (only 90° was). A UV drag, in the panel or ⛶ isolate,
    is clamped to the ink (`meshInkBox`, every frame's for a sequence) instead of 0..1, which now
    reaches the atlas beside it. From review: answering No to Draw's sequence question keeps the
    traced outline; a missing frame's 1×1 placeholder (`placeholder: true`) no longer counts as a
    frame trimmed differently; Convert calls `updateRegion()` after `Sequence.apply` as before.
  - **Repair.** `meshRepairs()` runs on every rebuild; the banner lists what it finds, each with
    **🩹 Repair** (`repairMeshes([repairKey])`, then 💾 Save; **🩹 Repair all** for several) and
    **keep as is** (`repairsKept`, for the page's life — review: a heuristic must not be
    all-or-nothing, nor nag after every rebuild once declined). A linked mesh onto a sequence mesh that
    lacks its frames (and names the same stem) gets the parent's `sequence`. A mesh from a trimmed
    image is offered only when `inkMappedAsImage` sees all three signs of the old mapping: UVs
    reaching past the ink's box by more than half a pixel (a mesh mapped right over the ink stays
    inside it); a flat mesh (its rest positions, unweighted or bound 100 % to its slot's bone, are
    one least-squares affine map of its UVs within 0.1 % of its size); and that map a uniformly
    scaled copy of the ink's box but not of the image's — or, where the two share an aspect, the
    ink's at scale 1. The repair maps every UV from the ink onto the image; the vertices stay, so
    it draws what the region drew, and linked meshes follow. The "reaches past the ink" sign was
    added after the gate caught a false positive without it: the FIXED Convert of `tall` (ink 9×31
    of 22×38) under scaleY 2 fits the ink's box uniformly by coincidence (2.444 vs 2.452).
  - **Verified.** `tools/rigger-spike/trimmesh.mjs` (new, 515 checks): the shipped actions run on
    the vendored runtime in a Node sandbox, and the rigs they leave are drawn by that runtime's own
    WebGL `SkeletonRenderer` in headless Chromium (NEAREST sampling; every page texel encodes which
    image pixel it holds, the rest of the page reads as "atlas") and compared pixel by pixel. 8
    images (trimmed, 0 / 90 / 180 / 270° packs, one untrimmed) × 4 placings (plain, shifted, turned
    90° ×2, under a turned flipped bone): Convert and Draw each give a mesh identical to the region
    (0 / 90°) and to an untrimmed twin (all four), and the reference core runtime 4.2.74 agrees on the UVs at every
    vertex. Sequences: Convert on frames trimmed alike (identical per frame), frame by frame (asks
    once; every ink pixel of every frame kept; the union exceeds any single frame) and keyed (the
    key still drives it); Draw on a sequence; ＋ Linked mesh onto two sequence meshes (frames and a
    keyed frame match the source); a linked mesh's source switched to a sequence mesh and back. The
    repair: 12 stale meshes (old Convert unweighted and bone-bound, old Draw, a linked mesh) offered
    and drawing the region's pixels after 🩹, one repaired alone touching only its own; No to
    Draw's question writing nothing and keeping the outline; not offered — a plain whole-image quad on an
    ink of the image's aspect and of another, an old mesh reshaped so only flatness refuses it, an
    untrimmed one, the unevenly scaled ones it cannot tell, the fixed tools' 64 meshes, and all
    1,615 meshes of the 153 checked-in rigs. The UV panel's art is drawn by the shipped helpers in
    a real canvas and read back per image pixel. The pre-fix `view.html`
    (`RIGGER_VIEW_HTML=<file>`) fails 155 of the 308 checks it reaches; 20 planted mutants are each
    caught. In the real page (rig-switch's fake launcher, a one-off probe): an old-Convert mesh
    planted on `anticipation`'s `glow3` is listed in the banner; **keep as is** hides it through a
    rebuild; 🩹 Repair re-maps it to the ink and leaves the rig unsaved; nothing thrown. Not reached by the repair, by design: an image
    trimmed evenly all round and scaled (`radial1`, ink 170×171 of 198×199 at 0.2) — there a
    whole-image quad and a squeezed ink quad differ only by the unknown scale; the guide gives the
    redo. `linkedmesh.mjs` now checks the texel at every vertex on trimmed images too (it
    skipped them) and offers sequence sources to ＋ Linked mesh; `uvpanel.mjs` pulls the shipped
    `uvArtAspect` / `computeUvFit` instead of a hand copy.
  - **Found, not fixed** (open item 13): a region on a 180° pack draws upside down and on a 270°
    pack transposed, in the reference core runtime 4.2 itself — its `RegionAttachment.updateRegion` undoes a 90°
    pack only. Only `apps/price/…/symbolsSpecial` has such packs (18 regions).

- 2026-09-30 — **Save residuals closed** (former open items 2 and 6).
  - **Animation library (6a).** `/api/rigger/animations/save` did a plain PUT, so a same-id save
    from any project silently replaced the studio-wide entry. It now goes through
    `riggerLibraryWrite.ts` `putLibraryEntry`, which the rig library save shares: `baseEtag: null`
    creates only, a taken id answers `409 exists` with the entry's etag, `project` and `savedAt`,
    and the tab's confirmed retry is `If-Match` on that etag (a second concurrent overwrite is
    `409 conflict`). Nothing is written, blob or Postgres row, on either 409. A tab still running
    the old `view.html` sends no `baseEtag` and gets a 400 asking it to reload — loud, nothing lost.
  - **Case-only New-rig clash (6b).** `rigBundleNameTaken` is a read and `claimNewIrig` is
    `If-None-Match` on the exact-case key, so `Hero` and `hero` created at once both passed.
    `releaseClaimOnCaseClash` (`rigIndex.ts`) re-lists the rigs folder after the claim and
    before anything else is written; a top-level name differing only by case makes the route
    delete its own `.irig` and answer 409. Both creates claim before they list and an R2 listing is
    strongly consistent, so the later lister always sees the other: never both, at worst neither.
    Used by `rigger/new` and `rigger/upload`. Not closed: a crash between claim and check leaves a
    lone `.irig` (as it could before).
  - **Index rebuilds (2).** `rigger/new`, `upload`, `delete` and `editor/spines/reindex` wrote
    `buildSkeletonsIndex`, which skips a folder with no `.atlas`, so any of them un-listed an
    unrelated atlas-less rig. All of them and `writeIrig` now call `rigReindex.ts`
    `reindexProjectSkeletons` (the save's re-derive-then-preserve wiring, extracted);
    `buildSkeletonsIndex` had no callers left and is removed. The preserve step now keeps a prior
    entry only while its skeleton file still exists (`atlasMissingFiles`), so deleting one rig
    from a folder that still holds another atlas-less skeleton does not bring it back. The reindex
    response adds `rederived`, `preserved` and `atlasMissing`.
  - **`irigDocProblem` (6c).** Added, matching the reference core runtime 4.2.74 `SkeletonJson` exactly: a skin's
    `bones` / `ik` / `transform` / `path` / `physics` lists; an animation's IK and transform keys
    (only with a first key, as the loader reads them), path keys (always), physics keys (except
    `""`, which keys every physics constraint); draw-order offsets' `slot`; event keys' `name`
    against the keys of `events`. Names match as `SkeletonData.find*` does (a falsy name throws,
    `==` comparison). A falsy field the loader reads as absent (`"ik": null`, a skin's
    `attachments: null`, a bone's `parent: ""`, …) is no longer refused. Still stricter than the
    loader, on purpose: a truthy field of the wrong type (a 3.x object-form `skins` loads as no
    skins), a rig with no bones, a constraint with no name, and a constraint's `bones` entries
    that are not strings (the loader's `==` finds bone `"7"` from `7`). No exporter writes these.
  - **Gates.** `apps/launcher-api/scripts/check-rigger-writes.ts` (`check:rigger-writes`) runs the
    real route handlers on an in-memory R2 that can pause a request mid-flight: 34 cases, 27 red on
    the previous code (every animation-library case, claim-claim-list-list `Hero`/`hero` giving
    `[200, 200]`, reindex/new/upload/delete dropping atlas-less B). `irig-save.mjs` adds 21 break
    and 61 near-miss synthetic cases (every falsy value of every field the loader skips) plus a per-name differential on all 153 checked-in rigs (1,529
    renames, each loader-throws ⇔ check-refuses): 181 cases, 85 red on the previous check.
    `reindex-preserve.mjs` adds the deleted-file case.

- 2026-09-30 — **＋ add image… in a skin other than default belongs to that skin only; the default
  skin can't be deleted.** `attachRegion` wrote the region into the skin on stage under its own
  name AND set `slots[].attachment` to it — the setup attachment, one name for every skin — so with
  `skin1` on stage, `frame_radial1` (setup `radial1`) became `dust1` everywhere, and default, which
  has no `dust1` there, drew nothing (still nothing after `skin1` was deleted). Owner decision
  (2026-09-30), option A: the format's idiom of a same-named override.
  - **Naming.** In a non-default skin the new entry is keyed by the slot's setup name (`radial1`)
    with `path: dust1`; the setup attachment is untouched, so the skin on stage resolves its own
    `radial1` and every other skin its own, else default's — exactly what it drew before. `path`
    is written only when the key differs from the region; the attachment's name stays the key.
  - **No setup attachment.** The key is the region's name, suffixed `2`, `3`… until no skin holds
    it on that slot, and it becomes the setup attachment: every other skin then resolves a name it
    does not hold, so default stays empty (anticipation's `payframe` slot has no setup attachment
    but default holds a `payframe` there — adding the `payframe` region in `skin1` names it
    `payframe2`).
  - **The skin already holds its own image under that name.** A plain region is replaced in place,
    inheriting its placement (no linked mesh or deform key can hang off a region). A mesh, a region
    with a `sequence`, or another kind is refused with the reason: replacing it would throw away
    geometry, deform / sequence keys (SkeletonJson throws on a deform or sequence key naming a
    region without one) and linked meshes. So in an imported skin that holds its own images (the
    only skin drawing its slots), adding an image replaces the one shown rather than adding a
    second one beside it.
  - **Default.** Unchanged: a new attachment under the region's name, made the setup attachment.
  - The mesh-inheritance confirm now says, outside default, that only the skin on stage stops
    showing the mesh. The ＋ add image select resets after a pick, so a refused add does not leave
    the region shown in it.
  - **Deleting default.** `skinDeleteRefusal` (shared by `deleteSkinCore`, `deleteSkin` and the
    🗑 button) refuses `default` — a game that sets no skin draws it, the reason `renameSkin` keeps
    its name — and the last skin; 🗑 on default alerts without asking to confirm.
  - **Proof.** `skins-panel.mjs` (real page, headless Chromium, anticipation): add in a new skin on
    `frame_radial1`, again there, on `payframe` (no setup), in default, and in the imported
    `gem_default` (replacing its own); after each, every other skin draws what it drew (a fresh
    skeleton per skin), `rigDocLoadProblem` passes, and the rig read back through the tool's loader
    draws the same in every skin; 🗑 on default refuses and changes nothing. 71/71; the previous
    `view.html` fails 27. `linkedmesh.mjs` asserts the same rule on the synthetic rigs and on every
    slot of the CI rigs, in default and in a new skin (anticipation 68 + 68, S 51 + 51), plus the
    delete refusal; the previous `view.html` fails 236 of its checks on anticipation and 195 on S.

- 2026-09-30 — **Stage errors read in full.** `#err` and `#artWarn` were each `position:absolute;
  top:10px`, the same `top` as the floating `#modeBar` (z-index 5 over their 4), so the bar covered
  the middle ~330 px of every stage message at a 1280 px window ("Load failed: Parent mesh no…"),
  and the two messages covered each other when both showed. Both now live in a `#stageMsgs` flex
  column at `top:66px` (below the 48 px mode bar) that stacks them with a gap; `#stage.tweaking`
  (set by `applyTweakChrome`) moves it to `96px`, under the tweak bar. Measured in the browser pane:
  mode bar 47–95, error 103–137, banner 143–196; tweaking, tweak bar 89–123 and error from 133.
  `rig-switch.mjs` asserts the error's box does not intersect the mode bar (38/38; the previous
  page fails exactly that check).

- 2026-09-30 — **The placement fields, the pivot and replace image edit the image the stage
  shows.** The last three lookups with the first-skin rule (open item 9), each probed with the
  shipped functions on the synthetic two-skin rig (`default`: slot `body` → region `body`, 10×10;
  `gold`: a same-named `body` drawing `gold_body` at 30×30, x 4, rotation 15):
  - **The placement fields** (`applyAttachmentEdit`: x, y, rotation, scaleX, scaleY) set the stage's
    attachment, then mirrored the value into the raw doc with a loop that took the FIRST skin
    holding the name. With `gold` on stage, x = 7 moved gold's image live but was written into
    default's `body`; the next rebuild put gold's back at x 4.
  - **The pivot** (`pivotRawDef`, which `setPivotUV`, `pivotUV` and the placement fields' pivot hold
    read) had the same loop: pivot `[0, 1]` with `gold` on stage wrote `pivot: [0, 1]`, x 10.61 and
    y 18.37 — offsets measured off gold's rotated 30×30 quad — into default's `body`, and the
    rebuild put gold's back at (4, 0).
  - **Replace image** tried the skin on stage first, then fell back to the first skin holding the
    name rather than to default: with skins `[gold, default, blue]` and `blue` on stage, it
    re-pointed gold's `body`, and the stage kept default's art.
  - **One rule.** All three now resolve through `rawDocAttSkin` (entry below): the skin on stage's
    image if it has one, else default's. `pivotRawDef` is now `rawDocAttEntry`, so the placement
    fields read a held pivot from, and write the compensating x / y back into, the same entry. An
    image a skin only inherits is edited in default, which every skin without its own shows — the
    rule ▸ Convert / ✎ Draw mesh and the mesh edits already follow. The probes again: x = 7 stays
    on gold's `body` through a rebuild; pivot `[0, 1]` lands in gold's (x 14.61, y 18.37); replace
    image re-points default's.
  - **Gate.** `linkedmesh.mjs` now also pulls the shipped `applyAttachmentEdit`, `setPivotUV`,
    `pivotUV` and `pivotEditable`. On the synthetic image rig — each skin on stage, `default` listed
    first and second, plain and with a different pivot on default's and gold's `body` — it edits
    every placement field in turn, chooses a pivot, and replaces the image with a region no skin's
    `body` draws. Each edit must be written into the stage image's entry alone (a snapshot diff of
    the whole rig) and show at once; a turn or scale must hold that image's pivot, measured off the
    quad the reference core runtime draws rather than the tool's pivot math; the pivot panel must show that image's
    pivot before and the choice after, the point chosen taking the old pivot's place; and a rebuild
    must leave the image exactly where the edit put it, with the same skin on stage. The CLI rig gets
    all three on every slot showing a default-skin image (63 on `anticipation`, 34 on `S`), with a
    pivot on default's image and on a fresh skin's same-named copy, from that skin holding nothing and
    holding its copy. ▸ Convert / ✎ Draw mesh now run the same six skin-on-stage cases (they ran
    four). 797 checks synthetic, 7288 on `anticipation`, 4921 on `S`; the previous `view.html` fails
    67, 823 and 475 of them. Nine mutants are each caught: either loop reverted
    (`applyAttachmentEdit`, `pivotRawDef`); replace image's fallback reverted; default preferred to
    the skin on stage (placement, replace); the pivot read in the skin on stage with no fallback;
    the held x / y not written back; `setPivotUV` writing the first skin while reading the right one;
    the placement fields reading the pivot off the first skin while writing the right one. The CI
    rigs alone cannot catch the replace-image fallback — their fresh skin is listed after default, so
    the first skin holding the name IS default — the synthetic `[gold, default, blue]` order does.
    `pivot.mjs`, which runs the pivot block and `applyAttachmentEdit` in a sandbox of its own, now
    pulls `rawDocAttEntry`, `rawDocAttSkin` and `activeSkinName` too.

- 2026-09-30 — **▸ Convert to mesh and ✎ Draw mesh rewrite the image the stage shows.** Both read
  the slot's image off the stage (`skeleton.getAttachment`: the active skin, then default) but
  picked the raw entry to rewrite with a loop that took the FIRST skin holding the name, usually
  `default`. A probe of the shipped functions on a two-skin rig (`default`: `body`, 10×10; `gold`: a
  same-named `body` drawing `gold_body` at 30×30), `gold` on stage: default's `body` became a mesh on
  gold's ±15 quad (for ✎ Draw mesh, with UVs measured off gold's quad too) over default's own art,
  gold's stayed a region, and the stage did not change. With `default` listed after another skin,
  the same loop rewrote the other skin's image while default was on stage.
  - **One rule.** `rawDocAttSkin(attName)` names the raw skin whose image the stage shows — the
    skin on stage if it defines the name, else default, `skeleton.getAttachment`'s order — and both
    actions rewrite that one. `rawDocAttEntry`, which ＋ add image and the point, box / clip and
    linked-mesh editors read, is now read off it too; the mesh and path lookups still resolve on
    their own (the placement, pivot and replace-image ones joined it in the entry above). In a skin
    that only inherits the image, the one rewritten is default's, which every skin without its own
    then shows as a mesh — the rule mesh edits already follow (`meshInActiveSkin`, ⎘ Make
    skin-specific). Unchanged: converting a text element's source locale still links its other
    locales in the same skin (`syncTextLocaleMeshes`), and path and tint carry over as before (✎
    Draw mesh has never taken the tint).
  - **Gate.** `linkedmesh.mjs` now also pulls the shipped `convertRegionToMesh` and
    `finishDrawMesh`. On a synthetic rig — `default`; `gold`, overriding `body` with other art,
    placement and tint and a text element's two locales with other placement; `blue`, holding
    nothing; and the same rig with `default` listed second — each action runs with each skin on
    stage, and Convert on the text element's source locale. On the CLI rig, both run on every slot
    whose setup image is a default-skin region (63 of 68 on `anticipation`, 34 of 51 on `S`), from
    a skin added that session: holding nothing (default's image must become the mesh) and holding a
    same-named copy placed elsewhere (the copy must), one session per skin and action. Each check
    asserts that a snapshot diff is exactly that entry (plus the linked locales), that the same skin
    stays on stage and shows a mesh of the same art (and tint, for Convert), that a drawn mesh's
    vertices are where they were clicked, and — on an untrimmed image — that a converted mesh sits
    on the image's corners and every vertex samples the texel the image drew there. ＋ add image is
    also run with `gold` on stage over its own `body`, and with `blue` on stage and `default` listed
    second, to pin `rawDocAttEntry`. 335 checks synthetic, 2542 on `anticipation`, 2147 on `S`; the
    previous `view.html` fails 14, 266 and 150 of them. Fourteen mutants are each caught: the whole
    revert; either function's loop reverted; default preferred to the skin on stage; the skin on
    stage with no fallback, or even when it lacks the image; no text linking; path or tint dropped
    (Convert) or path dropped (Draw); u and v swapped in a drawn mesh; the rebuild putting default
    back on stage; `rawDocAttEntry` preferring default, or taking the first skin holding the name.
  - **Found, not fixed.** Three other lookups had the same first-skin rule — the placement fields,
    the pivot and replace image — fixed in the entry above. Both actions map a TRIMMED image wrong
    (open item 12): a `RegionAttachment`'s quad is the trimmed ink (`updateRegion` offsets it by
    `region.offsetX/Y`), but a `MeshAttachment`'s `regionUVs` span the original canvas (its
    `updateRegion` subtracts those offsets and scales by `originalWidth/Height`), so UVs laid 0–1
    across the ink's quad draw the whole canvas into it — a 40×40 image trimmed to 20×10 samples
    u −0.078…0.547 where the region sampled 0…0.313 (64 px page). And ▸ Convert to mesh drops a
    sequence image's `sequence` (open item 10): once the stage has drawn it, the mesh names the
    sequence's base (`fx_`), which the strict loader cannot find ("Region not found in atlas") and
    the page draws as placeholder art.

- 2026-09-30 — **A rig that fails to open leaves no rig open, so a save can no longer write one
  rig's content under another rig's name.** Open item 11, found in the review of the entry below
  and reproduced against a mock launcher: open S, then open S-broken, whose linked mesh names a
  missing parent, so `SkeletonJson` throws ("Parent mesh not found: …"). `selectSkeleton` set
  `selected` at its top and `loadRigPrecondition` then set `rigEtag` to S-broken's `.irig` ETag;
  the throw left `rawDoc`, `skeletonData` and the stage on S. The error bar said "Load failed",
  but ⤓ .irig, 💾 and 📦 stayed enabled and read that mixed state: 💾 posted S's skeleton as
  `stem: "S-broken"` with S-broken's own ETag — the precondition passed, `irigDocProblem` passed
  (S is a valid rig), and S-broken.irig was overwritten with S, kept in 🕘 but with no word to the
  author; 📦 offered S to the library under S-broken's name; ⤓ downloaded S as `S-broken.irig`; a
  cinematic tweak (`openRigForTweak` tested `rawDoc`) reported success and keyed into S.
  `saveToR2.confirmedFor` carried over too, skipping the "an .irig already exists" prompt.
  - **The document, the selection and the save precondition change together.** `selectSkeleton`
    closes the open rig (`closeRig`: `rawDoc`, `skeletonData`, the skeleton, `dirty`, the
    selections, the rig text, the per-open confirm) BEFORE it fetches anything, then sets
    `selected` and asks for the precondition; a failure — or a build that got part-way — closes
    again, with the reason in the outline. No state has one rig's document under another rig's
    name, not even mid-load. `selectSkeleton` resolves true/false and every caller acts on it:
    boot restore, the cinematic tweak, ＋ New rig / upload (Setup only once it opened), the text
    bake (`bakeAndPlaceText` / `rebakeAllTextElements` stop instead of placing into nothing and
    saving); ⟳ Re-sync, ↻ Refresh and 🕘 restore reload into the same closed state on failure.
  - **What a failed open leaves.** No document, nothing on stage, Setup / Animate disabled, the
    outline naming the rig as not open; ⤓ .irig, 💾 and 📦 disabled (`refreshRigFileButtons`,
    keyed on the document). 🕘 History and ⟳ Re-sync / source… stay enabled for the rig that
    failed — they act on its files — and the precondition fetched at the failed open is kept, so
    a rig saved in a broken state is repaired by restoring an earlier save. (🕘 used to need an
    open document, so a rig that failed at boot could not be restored from the tool.) A rig that
    failed is no longer what the next visit reopens: `saveRiggerState` needs a built skeleton.
  - **Switching asks.** Opening a rig from the list, and ＋ New rig / upload images (which open the
    new rig), over unsaved edits now ask first; since a failed open leaves nothing open, that is
    the one point the edits can still be kept. The list click had no guard at all — every switch
    discarded unsaved edits silently, failed or not. (↻ Refresh, ⟳ Re-sync, 🕘 restore and the
    cinematic tweak already asked.)
  - **Late answers are dropped** (`rigGen`, bumped by every open). A save still in flight when
    another rig opens no longer hands that rig its new ETag (its next save prompted a spurious
    conflict), clears its dirty flag, or re-points `selected` at the saved rig's `.irig` entry —
    with two rigs in one folder, a cross-rig save of its own. A restore's reload no longer reopens
    the old rig over the one opened meanwhile. A rig's text document that answers after a switch is
    no longer applied to the next rig (its elements then auto-synced into that rig and saved).
    The text auto-sync re-checks the rig and `dirty` after its catalog fetches (an edit made
    meanwhile was reloaded away), and hides only the loading overlay it put up — it used to hide
    any, including another load's.
  - **Gate.** `tools/rigger-spike/rig-switch.mjs` drives the real page in Chromium against a fake
    launcher serving three copies of `anticipation`, one broken as above, and records every POST —
    37 checks: Cancel and OK at the prompt; the failed state (no document, ⤓ / 💾 / 📦 disabled and
    sending nothing even when called directly, 🕘 enabled, the outline, no close-tab warning, not
    remembered); the tweak; a failed boot restore; 🕘 Restore opening the rig again; a mid-load
    sample; ＋ New rig cancelled; a save and a text document in flight across a switch. The
    previous page fails 20 of them, 💾 posting `{ stem: "S-broken", baseEtag: <S-broken's>,
    skeleton: S }` exactly as reported. Nine planted mutants — no close before the fetch or on
    failure, the save's answer landing, either prompt removed, 🕘 needing a document, a failed rig
    remembered, the stale text document applied, 💾 enabled by the selection — are each caught.
    All 63 rigger spikes are green. Also walked by hand in the browser pane (rAF shimmed): a bone
    edit, Cancel, OK, the failed state, clicked saves reaching nothing, 🕘 → Restore.
  - **Found, not fixed** (now open item 11): the stage error bar sits under the floating mode bar
    (both at `top: 47px`, the bar on `z-index` 5), so the middle of every stage error — here the
    missing mesh's name — is hidden at usual widths.

- 2026-09-30 — **A rig that will not load can no longer enter the rig library, or leave it.** Open
  item 6: 📦 Save rig to library posted `rawDoc` without the tab's `rigDocLoadProblem` (only
  💾 Save ran it), and `irigDocProblem` — behind both saves and the 🕘 restore — stopped at a skin's
  slot keys and an animation's bone / slot keys. A rig whose linked mesh or deform key named a
  missing skin, parent or attachment was accepted into the shared library; **Import into open
  rig** then broke the open rig (the merge went straight into `rawDoc` and the rebuild threw), and
  **Apply saved rig** wrote an `.irig` that opens as "Load failed".
  - **The rules, read off SkeletonJson 4.2.74 and each confirmed by running it:**
    - A linked mesh is any `mesh` or `linkedmesh` with a truthy `parent`. The parent is
      `skin ? findSkin(skin) : defaultSkin`, looked up by NAME on the linked mesh's own slot.
      `findSkin` returns the FIRST skin with the name, but `defaultSkin` is the LAST skin named
      `default` (each one reassigns it), so with two skins of one name an explicit and an implicit
      reference read different skins. An empty `skin` means none. A skin named `""` never loads
      (`new Skin("")` throws), so the check now refuses it, like an empty bone or slot name.
    - The parent must be a mesh. A region / bounding-box / path / point / clipping parent is found
      by name, then throws a TypeError in `updateRegion()` at load — or, for a linked mesh with a
      `sequence`, in its first `computeWorldVertices` (`Sequence.apply`), so that rig loads and
      crashes on its first frame. A linked mesh whose parent is another linked mesh loads in either
      order, but resolved before its parent it copies the parent's still-empty geometry and draws
      nothing, like one naming ITSELF. Neither is refused (the Rigger writes neither).
    - `animations.<a>.attachments.<skin>.<slot>.<attachment>`: the skin and the slot must exist
      even when their maps are empty (`findSkin`, no default fallback). The attachment is looked
      up in THAT skin only, and read only by a `deform` or `sequence` timeline whose first key is
      present — an empty list, a missing first key or an unknown timeline over a missing
      attachment loads, so the check lets those through. What the key reads must then be there:
      a deform key reads `vertices`, which only the `VertexAttachment`s have (mesh, linked mesh,
      bounding box, path, point, clipping — a region throws), and a sequence key reads
      `attachment.sequence.id`, so it needs a region or mesh that declares a `sequence`. Only an
      ABSENT `type` means region: `getValue` defaults nothing else, so `type: null` is a type the
      loader does not know, and it skips the attachment.
  - **The library save** calls `rigDocLoadProblem` before the name prompt (the refusal goes in the
    error banner, as for 💾 Save), and a server refusal shows its `message` in the status line
    instead of the raw JSON body.
  - **Out of the library** (found in review — a rig saved before these checks can already be in
    it). `resolveRigSkeletonBody` (＋ New rig → Apply saved rig, for `/api/rigger/new` and
    `/api/rigger/upload`) runs `irigDocProblem` on the library skeleton and answers 422 before
    anything is written. It runs the WHOLE check, so an older library rig that loads but breaks
    one of its stricter rules (two bones of one name, a parent listed after its child) can no longer
    be applied either — 💾 Save would refuse the rig made from it anyway. `importRig` merges copies
    first and runs the tab's full parse on the result; on a problem it shows **Import refused**
    with the reason — naming the open rig when that is what does not load on its own — and leaves
    the open rig untouched and clean.
  - **The import dropped the imported rig's events** (found in review, once the guard made it
    visible). `prefixRigNames` renamed every other name and `mergeRigInto` copied everything else,
    but neither touched `events`, so an imported animation's event keys named definitions the open
    rig lacks ("Event not found") or silently took the open rig's same-named one. A rig's FX /
    flipbook bindings ARE event keys, so every rig with bindings broke the rig it was imported into
    — and, with the guard, was refused. The definitions now take the prefix like every other name,
    every key is renamed, `mergeRigInto` copies them, and the prefix is chosen clear of the open
    rig's events too.
  - **Verified.** `irig-save.mjs` 83/83: 17 named breaks on a synthetic rig, each pinned to the
    loader's message (for a TypeError, the property it could not read) and to what the check
    names; 8 near misses the loader accepts, which the check must accept too; every checked-in rig
    loads (one stand-in region answers every atlas lookup) and passes — 153 rigs, 906 linked
    meshes, 347 deform / sequence keys, `S`'s 180 linked meshes all naming no skin; on every
    checked-in rig that has them, a missing parent, a missing skin and a renamed default skin (6
    rigs), a renamed animation skin / slot / attachment key (27 rigs) and a sequence key's
    attachment losing its `sequence` (21 rigs) make the loader throw and the check name the break;
    and Apply refuses a broken library rig with a 422. The pre-change code fails 25 of these. 19
    mutants are each caught: first / last skin swapped, an empty skin taken as a name, no mesh
    check on the parent, keys with no first key counted as reading, the implicit skin read as the
    linked mesh's own, a `""` skin allowed, the parent searched on every slot, no animation skin or
    slot check, `type: "mesh"` not counted as linked, `type: null` read as a region, deform
    allowed on any type or only on meshes, sequence keys allowed without a declared sequence, on
    any type, only on regions or only on meshes, and the apply guard removed. The review's two
    differential fuzzers agree with the loader: 1,078 generated attachment-kind docs, every one;
    and of 145,184 generated reference docs, none the loader rejects is accepted, and the only
    loadable ones refused are sequence linked meshes over a non-mesh parent, which crash on their
    first frame. `rigmerge.mjs` (the shipped merge, loaded by the reference core runtime) now imports a rig whose
    keys name an event the open rig lacks and one it defines differently: both load, each key
    names the imported definition; the old merge fails it ("Event not found: fx_hit"). The real
    `view.html` in a browser against a mock API backed by the real `irigDocProblem`, on `S`: the
    valid rig reaches the library; a broken parent and a missing-skin deform key are refused
    before the name prompt with no request sent; a duplicate bone name (the loader accepts it, the
    server refuses it) shows the server's message as text; a broken library rig is refused on
    import with the open rig unchanged and not dirty, and a valid one still
    imports. `pnpm check:all` 300/300.
  - **Still skipped by the server check** (open item 6), each probed to make the loader throw and
    each caught by the tab's full parse on both saves: a skin's `bones` / constraint lists, an
    animation's IK / transform / path / physics keys, draw-order slots and event names.
  - **Found in review, not fixed here** (open item 11, reproduced): after a rig fails to open, the
    tab still holds the previous rig's document under the failed rig's name and ETag, so 💾 Save
    overwrites the failed rig with the previous one.

- 2026-09-30 — **The Skin picker follows the rig's skins, and every edit lands in the skin on
  stage.** The picker (`#skin`, in the bottom bar — older comments called it the top bar) had its
  options built once, in `buildSkeleton`. A `<select>` reads back `""` for a value no option
  carries, so for a skin added (`addSkin`), renamed (`renameSkin`) or imported (`importRig`) since,
  `setActiveSkin` put the skin on stage but left the picker reading `""`, and every reader of
  `$("#skin").value` fell back:
  - `attachRegion` (＋ add image…) wrote into the FIRST skin, and `rebuildFromRawDoc` — which ran
    right after it — read `""` as well and put the default skin back on stage. The image went into
    the wrong skin, the author was moved off the skin they were working in, and the next edit went
    to default too.
  - `slotAttachmentList` (the slot's attachment list) showed default's, and
    `replaceAttachmentImage` looked in default first. A deleted skin kept its option, and picking
    it threw.
  - **＋ path could replace a path.** `finishDrawPath` made its name unique against
    `slotAttachmentList` — default's names, under the stale picker — but wrote into the active
    skin: the hazard `addAttachmentToActiveSkin` was hardened against in the linked-mesh fix below.
  Reproduced on the page itself: `skins-panel.mjs` run against the previous `view.html` fails 22
  of its 36 checks — after ＋ Add skin the picker still offers `[default]`; clicking an imported
  skin's row shows it on stage while the picker reads `""`; ＋ add image… then writes into
  `default` and the stage falls back to `default`.
  - **One source.** `activeSkinName()` — the skeleton's skin, else `default` — is what every edit
    reads, and the picker is a view of it: `renderSkinPicker()` rebuilds its options from
    `skeletonData.skins` and selects the skin on stage, and `buildInspector` calls it beside the
    SKINS list it mirrors, so the load, every rebuild and every `setActiveSkin` refresh both.
    Options and value set from code fire no `change`, so nothing re-enters `setActiveSkin`.
  - **The rebuild keeps the skin on stage.** `rebuildFromRawDoc(selName, skinName)` reads
    `activeSkinName()` before it replaces the skeleton; `renameSkin` passes the new name when the
    renamed skin is the one on stage. A deleted one falls back to default, else the first skin.
  - **＋ add image… takes its placement from what the slot shows.** `attachRegion` looked for the
    slot's current image only in the target skin, so in a new skin it found none: no placement
    carried over (`frame_radial1` lost its 0.2 scale) and no mesh warning. It resolves it as the
    stage does now — the active skin's, else default's (`rawDocAttEntry`).
  - `addAttachmentToActiveSkin` is back to its pre-#884 name check: `slotAttachmentList` reads the
    skin it writes into again, which made the union with that skin's names dead code.
  - **Rig text** (`placeTextAttachments`) reads the same function. Its bake reloads the rig first,
    which puts the default skin on stage, so a text element still lands in the default (else the
    first) skin.
  - **Gates.** `linkedmesh.mjs` now runs the shipped `rebuildFromRawDoc`, `setActiveSkin` and
    `renderSkinPicker` — only the loader (the strict one) and the UI renderers are stubbed, and the
    inspector stub renders just the picker — and models the picker as a browser `<select>` that
    only the page writes. It adds a skin session on the synthetic rig (＋ Add skin, pick, ＋ add
    image, rig text, ⎘ Make skin-specific + replace image, rename, delete, import) and ＋ add image
    on every slot of the CLI rig in a skin added that session (68 slots on `anticipation`, 51 on
    `S`), each checked against the placement the reference core runtime resolves for the image the slot showed.
    Eleven mutants — the picker not rebuilt or its value not set, the rebuild or the rename
    dropping the skin on stage, ＋ add image / rig text / the slot list / replace image reading the
    first or default skin, placement taken from the target skin only, a new name checked against
    default only, `change` fired from code — are each caught. The new `skins-panel.mjs` drives the
    real page in Chromium through ＋ Add skin, a pick, ＋ add image…, ✎, 🗑, ⤵ import and a
    skins-list click, reading the picker's options and value, the minified runtime's skin, drawn
    attachment and placement, and the `change` count; it closes Chrome through CDP, because a
    killed one leaves child processes holding its temp profile on Windows.
  - **A gate that had gone vacuous.** `sequence.mjs` put a skin on stage through a stubbed picker,
    so once `activeSkinName` read the skeleton its "gold" pass ran with default on stage, and a
    planted `sequenceKeySkin` break (a key written under a skin that does not declare the sequence,
    which bricks the rig) passed. It now puts the skin on its stand-in skeleton and asserts it is
    on stage; the planted break fails it again. `rigtext-autosync.mjs` gives
    `placeTextAttachments` the shipped `activeSkinName` in place of a picker stub.
  - **Found, not fixed** (open item 9). ＋ add image… makes the new image the slot's setup
    attachment, which is one name for every skin, so added in a skin other than default it leaves
    that slot empty in default — and still empty after that skin is deleted, since the delete
    cannot know what the slot showed before. (This already happened for any skin the rig opened
    with; now it is also the path in a skin added this session.) The format's idiom is an override of
    the same attachment name in the skin, which is a behaviour decision. Separately, ⬡ Convert to
    mesh and ✎ Draw mesh rewrite the image in the first skin holding its name, not the one on
    stage: a two-skin probe of the shipped `convertRegionToMesh`, with `gold` on stage over
    default's same-named `body`, turned default's into a mesh measured off gold's 30×30 art while
    the stage kept showing gold's region.

- 2026-09-30 — **A linked mesh names its parent's skin unless that skin is `default`.** Reported:
  ＋ Linked mesh with a non-default skin active, onto a mesh in that same skin, left a rig that
  would not load. SkeletonJson resolves a linked mesh's parent as `skin ? findSkin(skin) :
  defaultSkin`, by name, in the linked mesh's OWN slot — an absent `skin` is the default skin, not
  the skin the linked mesh sits in. `addLinkedMesh` and `setLinkedMeshParent` omitted `skin`
  whenever the parent's skin was the ACTIVE one, so with any other skin active the rebuild threw
  "Parent mesh not found" (the stage stopped updating and the save was refused) — or, when default
  held a same-named mesh on that slot, the linked mesh silently bound to default's. The vendored
  the reference WebGL runtime has the same rule (read at its SkeletonJson, and the skin-only and
  same-named cases behave identically when run through it headlessly).
  - **One rule, in the LINKED MESH section:** `linkedMeshParentSkin(def)` reads it
    (`skin || "default"`), `setLinkedMeshParentSkin(def, skin)` writes it (omitted only for
    `default`), and `isRawLinkedMeshDef` is any mesh with a `parent` (rig also accepts
    `type: "mesh"`). The delete cascade's copies of the rule (`detachLinkedMeshes`,
    `deleteBoneCore`) now call them.
  - **The same wrong model elsewhere.** `prefixRigNames` (rig import) renames the imported
    `default` skin but prefixed only explicit refs, so importing any rig-exported rig with linked
    meshes broke the open rig (`S`: 180, all implicit). The linked-mesh editor showed
    `skin || active skin` as the current source: the wrong mesh, or nothing.
  - **Skin rename.** It never moved the animations' `attachments` (deform / sequence) keys, which
    SkeletonJson resolves by skin name, so renaming a skin with deform keys broke the load ("Skin
    not found"). Renaming `default` also broke every implicit linked mesh ("Skin not found: null"),
    and even where it loaded it was wrong: Rig draws the skin named `default` when no skin is set
    — how the game mounts a rig unless a `skin` prop names one — and falls back to it for every
    slot another skin leaves empty. So the default skin keeps its name: no ✎, and `renameSkin`
    refuses it.
  - **Same slot only.** `sourceMeshCandidates` offered every mesh in the rig and ＋ Linked mesh
    took the first, but the parent is looked up on the linked mesh's own slot: a mesh from another
    slot never loaded, and one named like the new linked mesh bound it to ITSELF, which the loader
    accepts without a word. It now lists the selected slot's meshes, across skins.
  - **A new attachment could replace one in its own skin** (found in review). The name was made
    unique against `slotAttachmentList`, which follows the top-bar skin picker, but written into
    the skeleton's real skin. The picker's options are built when the rig opens, so for a skin
    added, renamed or imported since it reads `""` and only default's names were checked. Import
    `S`, activate its skin, ＋ Linked mesh on a facet slot: the source mesh was silently replaced by
    a linked mesh pointing at itself, blanking it and the 12 linked meshes that borrow from it, and
    the save accepted that. The name is now also unique in the skin it is written into; the stale
    picker itself is open item 9.
  - `tools/rigger-spike/linkedmesh.mjs` pulls the shipped functions out of `view.html`
    (transitively), stubs the rebuild with the reference core runtime 4.2, models the picker as a browser `<select>`
    (options fixed at load; an unknown value reads `""`), and asserts every result loads with each
    linked mesh bound to the mesh the author picked: ＋ Linked mesh and the picker from every skin
    onto every source offered, the source the picker shows, ＋ Linked mesh in an imported skin, a
    rename of every skin, and an import — on a synthetic three-skin rig, then on `anticipation` and
    `S` in CI. Reverting any one change turns it red. `rigmerge.mjs` now runs the shipped import
    too (its copy had drifted: no physics, no `order` re-pack, the old skin rule). Still open: the
    rig-library save never runs the tab's full parse, and the server's `irigDocProblem` checks
    neither of these references (open item 6).

- 2026-09-30 — **The delete cascade.** #877's CI spikes reported `delete` red on `symbols/l3`
  ("Path constraint not found: circle_path"). That red was the harness: `delete.mjs` hand-copied
  `deleteBone` and had drifted (the shipped one already cleared a dropped constraint's keys). Run
  against the shipped code over all 153 checked-in rigs, the real breaks were elsewhere:
  - **A slot delete broke the load.** A path constraint's `target` is a SLOT, and `deleteSlot`
    never looked at constraints, so deleting one (`l3`'s `circle` / `shake`) left "Couldn't find
    target slot" — 114 slot deletes across 72 rigs (every rig with a path constraint, all five
    apps), each refused on save with a 422. Conversely `deleteBone` compared a path constraint's
    target with the BONE name, dropping it when a bone happened to share the slot's name.
  - **Weighted non-mesh attachments kept stale bone indices.** Path, bounding-box and clipping
    attachments can be weighted too (`W`'s `string_mask` clip is); only meshes were remapped, so a
    bone delete moved `W`'s clip by up to 655 px.
  - **Weighted deform keys desynced.** A weighted deform holds one (x, y) pair per INFLUENCE;
    dropping an influence without dropping its pair shifts every later vertex's key
    (`symbolsSpecial`'s `scatter_box_glow`). A linked mesh with `timelines: false` keeps its own
    keys in the same layout and now follows its parent's remap.
  - **Deleting an IK or transform constraint left a hole in `order`.** Rig never runs a
    constraint whose order is ≥ the constraint count, so a later one went silently inactive
    (`h1`: delete `rays1` and the `shake` path constraint stops).
  - **A slot delete scrambled animated draw order.** A draw-order key's offsets are relative to
    the whole slot list; filtering out the deleted slot's own offset left the others spanning it
    out of range, so the order held a HOLE the renderer crashes on every frame (`mm_bg`,
    `mm_bg_feature`, `W`: dozens of slot deletes each).
  - **Deleting a linked mesh's parent broke the load** ("Parent mesh not found"): `S` has 180
    linked meshes on 15 parents, `symbolsSpecial` 6, and the rig-text locales are linked meshes.
  - **Latent (no checked-in rig has a second skin or a skin constraint list):** a removed
    constraint still named in a skin's constraint list, a deleted bone in a skin's `bones` list,
    a skin delete leaving its `attachments.<skin>` keys ("Skin not found").
  One `dropConstraints(doc, isBroken)` now owns "remove a constraint": its keys, its skin-list
  entries, the `order` re-pack; every delete (bone, slot, attachment, skin, the four constraint
  kinds, and the text-element bone) goes through it and reports what went with `showNotice`.
  A path constraint is removed when its target slot goes or no longer holds a path in any skin.
  An orphaned linked mesh becomes a plain mesh with a copy of the parent's geometry and, when it
  inherited them, the parent's deform keys (its own were ignored). Draw-order keys are rebuilt
  as SkeletonJson reads them, the slot dropped, minimal offsets rewritten. A clipping that ended
  at a deleted slot ends at the slot drawn before it (same clip range). `delete.mjs` pulls the
  shipped functions transitively out of `view.html` (only the rebuild, which LOADS the doc, and
  four UI no-ops are stubbed) and fails 31 synthetic-rig checks on the old code; five mutants
  (selection kept, inherited deform not copied, own-key child not remapped, draw order filtered,
  non-mesh weights not remapped) are each caught.

- 2026-09-28 — **The `.irig` save became safe to use with more than one author.** Before, a save
  was an unconditional PUT of `<spines>/<dir>/<stem>.irig`: no precondition, the project taken
  from the SESSION (a project switch in another tab wrote into the other project), no check
  beyond `Array.isArray(bones)`, no backup (R2 versioning is off), no close-tab guard, and the
  shared rig-library save overwrote a studio-wide name without asking.
  - **Conditional save.** Opening a rig first asks `GET /api/rigger/save?dir&stem` for the
    `.irig`'s ETag and the project (BEFORE the bytes load — the AssetManager hides headers, and
    this order fails toward a spurious prompt, never a silent overwrite). The save sends
    `baseEtag` + `projectKey`; a stale tag answers 409 and the tab asks *Overwrite with your
    version?* (mirrors the cinematic prompt). Unlike the cinematic, "overwrite" does NOT drop the
    precondition — the 409 carries the current ETag and the retry is `If-Match` on exactly the
    version the author was shown, so a third save landing meanwhile prompts again instead of being
    eaten. A project mismatch (the tab's project vs the session's) is refused outright. Once a save
    lands, the open rig IS the `.irig` (a later text re-bake or refresh no longer reopens the
    source `.json` and drops the saved edits); a second save while one is in flight is ignored. A first save
    of a source `.json` creates with `If-None-Match`; opening the source `.json` while a
    `<stem>.irig` already exists asks once before replacing it. `rigger/new` / `rigger/upload`
    claim the `.irig` with `If-None-Match` before writing any page or atlas.
  - **Pre-save validation.** The tab re-parses the doc through the same tolerant `SkeletonJson`
    loader it opens with and refuses with the loader's own message; the server runs
    `irigDocProblem` (`$lib/server/riggerIrig.ts`) — every by-name reference the reference core runtime throws on,
    plus undefined parents (which the reference core runtime silently re-roots) and duplicate names. 422 with a
    readable reason; the stored rig is untouched.
  - **Rolling backups + restore.** Every overwrite first copies the previous `.irig` to
    `<client>/<project>/rigger-backups/<dir>/<stem>/` (outside `spines/`, which the skeleton scan
    would list), 20 kept per rig. A write whose precondition already fails takes no copy, so a
    run of refused saves cannot push real versions out of retention. **🕘** next to 💾 Save lists them; Restore goes through the same
    guarded write, so it backs up what it replaces and keeps the CAS. `/api/rigger/backups`.
  - **beforeunload guard** when the rig or the cinematic (`RiggerCinematic.isDirty()`) has
    unsaved changes.
  - **Rig library save** creates only; a taken name shows who saved it and when, and the
    confirmed retry is `If-Match` on that entry.
  - Verified: `tools/rigger-spike/irig-save.mjs` (45/45 — the check agrees with the reference core runtime on
    every reference break and passes all 153 skeletons checked into the repo; CAS, backup-before-
    PUT ordering, retention, atlas-missing etag hand-back), the other rigger-spike suites
    unchanged (`rigtext-panel` 8/9 and the `$lib`-alias build failure of `cinematic-storage` are
    pre-existing on `main`), `check:launcher-gates` 297/297, and the REAL `view.html` driven in a
    browser against a mock API (create → CAS update → conflict declined/forced → invalid refused
    with no request → scope mismatch refused → json-over-irig confirm → History restore →
    beforeunload → library exists/confirm/decline → conflict-retry on the returned tag), after a
    `pipeline-concurrency` review whose findings are folded in. **Live** 2026-09-28 (#832, `dd31c4f4`): the new `GET /api/rigger/save` and
    `/api/rigger/backups` answer the auth gate on app.invisiblewall.org. Owner live-verify of a real
    save/conflict/restore against R2 is still owed.
  - Not in this change: **rig undo** (separate task — item 6); the animation-library save is
    still unconditional; two `＋ New rig` creates whose names differ only by CASE can both pass the
    `If-None-Match` claim (the name check is case-insensitive, the key is not).

- 2026-09-24 — **Image sequences became authorable, and a wrong declaration can no longer brick a rig.**
  The timeline shipped the day before could only SHOW sequences; nothing could make an image a
  sequence or change what a key does.
  - **Setup mode** gains an **▩ image sequence** section on the selected slot: detect a numbered run
    in the atlas and declare it (`▩ Make this a sequence`), edit frames / first number / digits /
    setup frame, or `✕ Not a sequence` to go back to an ordinary image. Picking any single frame of
    a flipbook is enough — detection strips the trailing number and offers the whole run.
  - **Animate mode** gains a `◆` on the sequence row (keys at the playhead, continuing from the key
    before rather than restarting at image 0) and a docked **key inspector**: plays / starts on
    image / hold each image, with the resulting images-per-second shown.
  - **The reason this needed care:** The runtime's `loadSequence` THROWS on the first frame it cannot
    find, and the Rigger's tolerant loader explicitly excluded sequences — so a wrong declaration
    produced a rig that would not open **in the only tool that could repair it**. Measured against
    the official loader on a rig whose frames are `symbexpl_01`…`_13`: `count` 14, `start` 0 and
    `digits` 3 each throw; `count` 12 loads and silently drops a frame; `setup` 99 loads (clamped).
    So the editor resolves every frame against the atlas and **refuses to write** a declaration that
    does not fully resolve, naming the first missing region — and `makeAttachmentLoader` now
    substitutes a placeholder per missing frame and reports it, exactly as a missing image does.
    `setup` is deliberately NOT gated, because the runtime clamps it.
  - **Two distinctions the format makes that a UI could quietly destroy.** An absent `delay`
    INHERITS the key before it while an explicit `0` holds on one image, so the field treats empty
    and 0 as different. And removing a declaration has to take the timeline with it: a sequence
    timeline on an attachment that is no longer a sequence throws at load — the negative control
    confirms the rig is unopenable with the keys left behind, and loads once they go.
  - **`start` is NOT always 1** — it is whatever number the first region carries, and rigs here use
    both (`symbexpl_01…` vs tumble_win's `expl-00…`). An early spike assertion hardcoded the default
    and called a correct rig broken; detection now reads all four values off the atlas.
  - **Review found a way to still brick a rig, in the one shape the suite never exercised.** `◆`
    wrote keys under the ACTIVE skin, while the row is offered from whichever skin DECLARES the
    sequence (active, falling back to `default`) — so on a multi-skin rig, keying with a skin
    selected that does not define the attachment produced a timeline for a null attachment, and the
    rig never opened again. `sequenceKeySkin` now only writes into a skin that declares it, and
    `sequenceSkinFor` resolves in the same order `sequenceArrForTrack` reads. Four more doors onto
    the same cliff are closed: `replace image (keep mesh)` re-pointed `path` out from under a live
    declaration; `▩ Make this a sequence` was the one write path with no resolve check; removal left
    `path` on the base name (which is not itself a region) when no frame resolved; and the panel
    gated on a denylist, so a boundingbox or clipping def could be made a “sequence”.
  - **Proved on all 153 rigs / 2,646 assertions**, 21 of which carry a real sequence
    (`node tools/rigger-spike/sequence-all.mjs`, which is new — the per-rig spike takes one
    json+atlas pair, so the sweep had been living in a shell history rather than the repo).
    **Verified live** in a browser against the real `explosion.json` + its atlas: the three bricking
    edits each refused by name, the harmless one accepted, `◆` keying at 0.9s and inheriting
    mode/index/delay, and every inspector edit reaching the renderer — halving the hold time doubled
    the rate, `pingpong` made the image index come back down (`0,2,4,6,8,10,12,10,8,6,4,2`), `hold`
    sat on image 7. The whole round trip sequence → plain image → sequence loads through rig's
    STOCK loader at every step.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/sequence.mjs`,
  `tools/rigger-spike/sequence-all.mjs`.

- 2026-09-23 — **The dopesheet can STRETCH a selection's timing about one anchor key.** Asked for as
  _"I would like to be able to resize from the keyframe time of the selected frame, so I can stretch
  up or down the timing from that point"_ — retiming a whole beat proportionally, which the dopesheet
  could not do: its drag TRANSLATES a selection, and `stretchAnimation` scales only a WHOLE animation
  to a new duration.
  - **Now:** select 2+ keys and the ruler grows a green **range bar** over the selection with a **⟺
    grip at each end** and a yellow **pin** at the **anchor** — the one time that does not move.
    Dragging a grip scales every selected key's distance from the anchor by the same ratio. The
    anchor defaults to the selection's earliest key; **clicking a selected key moves it there**, so
    anchoring mid-selection spreads both sides at once. The grip that sits on the anchor is dead.
  - **Timing that is not `time` scales too.** A bezier key's `curve` holds CONTROL TIMES and a
    sequence key's `delay` is seconds-per-sub-frame, while `retimeTrackKey` only ever writes `time` —
    so a stretch built on it alone keeps the old easing shape and the old flipbook speed.
    `scaleTrackKeyTimings` re-fits both, reaching EVERY track kind through the new `trackKeyArrays`.
    `fitKeyCurve` maps a segment `[t1,t2]` onto its final `[t1',t2']`, which is the stretch's own map
    when both ends are selected and is what keeps the curve VALID when only one end moved — including
    for the unselected key immediately BEFORE the selection, which eases into it.
  - **The apply ORDER is the whole game, and it must not interleave.** `retimeTrackKey` DROPS a key
    it lands on, so `applyDopeScale` walks farthest-from-the-anchor first when spreading and nearest
    first when squashing. The negative control proves the teeth: the same ×2 spread applied in plain
    selection order **loses 30 keys** on `anticipation1_intro`; in the shipped order it loses none.
    It also does ALL the timing remaps before ANY retime — a single interleaved pass let a moved key
    read as unselected and pinned a stale `delay` on a sequence follower (found in review, not by the
    spike, which was calling the remap directly instead of through `applyDopeScale`). A final
    `clampTrackCurves` pass per touched track catches the one case re-fitting cannot: a selected key
    pushed PAST an unselected one re-sorts the array, leaving a curve describing a different segment.
  - **Overwrites are loud, not silent.** A selected key landing on an unselected one destroys it —
    the same as drag-to-retime, but a ×3 stretch throws the far end seconds away, usually off-screen.
    Clamping that away would forbid legitimate work, so `dopeScaleClashes` counts it live: the bar
    turns red and the hint says `⚠ would OVERWRITE n unselected key(s)`, then `overwrote n` on
    release.
  - **Two clamps, because rig editing has no undo.** `maxRatio` stops any key crossing t=0;
    `minRatio` keeps distinct times ≥1ms apart (10× the 1e-4 merge epsilon) so a squash can never
    merge two keys. Worth knowing before it is reported as a bug: a selection containing a key at
    **0s**, anchored anywhere to its right, has `maxRatio` **exactly 1** — spreading it is
    arithmetically impossible, not broken. The grip then only squashes and the status line says so.
  - **A plain click on a key rebuilds nothing, at either end of the press.** `renderTimeline` does
    `innerHTML = ""`, and detaching the key under the pointer makes Chrome drop the whole click — no
    `click`, so no `dblclick`, so no double-click-to-delete, which is the only mouse delete path and
    is advertised in every key's tooltip. It took two passes to close: the mousedown now updates the
    `msel` highlight and the bar in place via `syncDopeScaleBar`, and the mouseup rebuilds only when
    the drag actually changed something. Neither drag handler touches the DOM until it has moved
    past the 2px threshold, so a plain click leaves the dots exactly where they were.
  - **Proved offline on 153 rigs / ~18k assertions** (`tools/rigger-spike/stretch.mjs`, which runs the
    SHIPPED code pulled out of `view.html`): affine, lossless, order-preserving, curves inside their
    segments, unselected keys untouched, the clash count matching the keys the commit really
    destroys, ×4 then ×0.25 round-tripping to zero drift — including a selection PARTIAL within one
    track, the only shape in which a clash or a one-moving-end segment can occur. **Verified live**
    against the real page with a genuine pointer drag: four keys at 0.1/0.2/0.3/0.4 anchored on 0.2
    became 0.0088/0.2/0.3913/0.5825 — uniform gaps, the anchor unmoved.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/stretch.mjs`.

- 2026-09-23 — **The `sequence` timeline is now a dopesheet track, and `stretchAnimation` no longer
  leaves five timeline kinds behind.** The stretch above shipped with a hole: a 4.2-format
  **sequence** (a flipbook of numbered atlas images) was invisible to `/rigger` — no track kind at
  all — so 21 rigs here had key times the dopesheet simply did not show.
  - **Now a first-class track.** `▩ <slot> · sequence` rows appear wherever a sequence is keyed, in
    their own colour and drawn as squares (a sequence key IS a step — it carries no `curve`, so it is
    also not easable). Selecting, retiming, duplicating, deleting and stretching all work through the
    existing dispatch. Plumbing mirrors `deform` exactly, because a sequence lives in the SAME
    `animations.<a>.attachments.<skin>.<slot>.<att>` node. Authoring is still NOT built: no way to
    attach a sequence, or to edit a key's mode / index / delay — the tooltip reads them back instead.
  - **`delay` is SECONDS PER SUB-FRAME, not an offset** — `SequenceTimeline.apply` does
    `index += ((time - before) / delay) | 0`. So any retime that scales key times MUST scale `delay`,
    or a stretched flipbook plays at its original speed, runs out of images early and freezes.
    Proved by REPLAYING the animation through the official runtime: ×2 with delay scaled shows the
    identical image at every t·2 over 40 samples; the control (times scaled, delay not) diverges.
  - **`delay` is also INHERITED** by every later key that does not spell its own (the loader carries
    `lastDelay` forward). So scaling one value silently re-times keys that may not be selected.
    `scaleSequenceKeyDelay` pins both directions explicitly, and `deleteSequenceKeyAt` pins the
    effective value on the follower before removing the key that owned it.
  - **`stretchAnimation` was scaling `a.bones` and `a.slots` ONLY.** Every other timeline — events,
    draw order, ik/transform/path/physics, deform, sequence — kept its original times, so "stretch
    all keys to N seconds" desynced them. Replaced by a structural `scaleKeyTimes` walk that cannot
    miss a timeline kind added later. Measured: the old walk left **36 key times** behind on
    `anticipation1_intro` alone. It guards per FIELD, not per key — a key-level `time` test skipped
    `explosion.json`'s first sequence key entirely (rig OMITS `time` at 0) along with the `delay`
    it owns, which is how the runtime replay first failed.
  - `importAnimation` now runs `normalizeKeyTimes` on a clip arriving from the library or clipboard.
    The rig LOAD path normalizes for a reason — every reader treats `k.time` as a number — and a clip
    dropped in unnormalized would compare as NaN: never found, never retimed.
  - **Review caught six things the spikes did not**, all fixed and re-verified live: the two rebuild
    sites that killed double-click-to-delete; `applyDopeScale` interleaving remap and retime, which
    pinned a stale `delay` when SPREADING a sequence; a per-key delay pass that could not be made
    order-independent at all once an UNSELECTED inheritor sat between two selected keys, so the
    result depended on click order (now one left-to-right pass over the whole array); a stale
    selection surviving a row change, now pruned in `renderTimeline` against the freshly built
    `dopeTrackById` so every cause is caught, not just the `sel` button; `retimeSequenceKey` and the
    duplicate path dropping a collided key without the `delay` carry-forward `deleteSequenceKeyAt`
    was careful to do; and Escape mid-drag leaving the drag armed to commit on release. The spikes
    now cover a selection PARTIAL within one track — the only shape in which a clash or a
    one-moving-end segment can happen, and the reason 18k green assertions had coexisted with both —
    and drive `applyDopeScale` rather than the remap in isolation, which is how the interleaving bug
    had stayed green.
  - **Proved on 153 rigs** (`stretch.mjs`, 24,551 assertions) plus **21 rigs with a real sequence**
    (`sequence.mjs`, 348 assertions, replayed through the reference core runtime 4.2.74). Verified live: double-click
    delete (with REAL pointer input — the first attempt at this check synthesised the very
    `click`/`dblclick` events whose dispatch was in question, and so proved nothing), the `sel`
    toggle, Escape-aborts, the clash warning, and a spreading stretch on a sequence row scaling an
    owned `delay` while its inheritors correctly stayed unwritten.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/sequence.mjs`,
  `tools/rigger-spike/stretch.mjs`.

- 2026-09-23 — **The pivot is the image's ANCHOR: choosing one MOVES the image.** Reported as
  _"visually I can see I am moving my pivot around in the canvas, but when I do that I would expect
  the image to offset as the pivot was now the new centre. Instead nothing happens, and the pivot is
  not repositioning anything at all."_ Right — and that was a design choice, not a bug: the entry
  below deliberately made setting a pivot change no placement, so it moved nothing and only took
  effect when you later rotated or scaled. That is not what a pivot is for.
  - **Now:** the pivot is the point of the image that SITS AT the slot's position. Choosing a new one
    moves the ART so that point takes the pivot's place, while the pivot itself stays put — pick
    bottom-centre and the picture jumps up until its bottom edge is on the pivot. Standard
    sprite-editor behaviour. Rig places a region by its CENTRE, so this is an offset on the
    attachment's `x`/`y`: `setPivotUV` shifts the placement by however far the new pivot would
    otherwise have drifted from the old one, and mirrors it onto the live attachment so the canvas
    updates without a rig rebuild. Rotation and scale still turn around the pivot (unchanged), and a
    centred pivot is still a complete no-op.
  - **The pivot is a fraction of the UNTRIMMED image** (rig's `width`/`height`), not of the packed
    atlas rect — deliberate, so that re-packing an atlas never moves anybody's pivot. Visible
    consequence: on a cropped region the rendered edge sits a pixel or two inside the pivot box.
    Measured on `radial` (`bounds:472,817,198,198` / `offsets:1,1,200,200`, load scale 2): clicking
    the visible top-left corner reads **1% × 1%**, not 0% × 0%, and the art slid 198px where a true
    corner would have slid 200px. Worth knowing before it is reported as a 2px bug.
  - **The spike's first assertion was wrong twice before it was right.** It first predicted "the
    image moves by half its height", which holds only on an unscaled, unrotated bone — 108 of 148
    rigs failed it, all of them correct code. The contract is now stated transform-independently:
    with **P** = where the pivot sits and **Q** = where the point about to be chosen sits, every
    vertex must slide by exactly **P − Q** and the pivot must not move. That holds for any bone
    transform. **148 rigs, 148 pass, 19 assertions each.**
  - **Verified live** against the vendored minified runtime: picking bottom-centre moved the image up
    200px (half its height), its bottom edge landing on the pivot, the pivot itself unmoved at
    (0,0), the attachment's `y` going 0 → 200, and the bone count unchanged at 86. The canvas path
    agrees: clicking the rendered top-left slid the art (198, −198) against an expected (200, −200)
    for an untrimmed corner — the 2px being the trim above.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/pivot.mjs`.

- 2026-09-23 — **The pivot is a property of the IMAGE, not a bone. Reworked after owner feedback.**
  Reported as _"the pivot addition is a bit strange, to me it doesn't feel like the image pivot, but
  more like a new added bone! I think the 2 things should be very different and separated. It even
  added an extra bone called pivot in my skeleton when I edit it."_ Correct, and the first design was
  wrong: it realised the pivot by moving the slot's bone (or giving the slot a `<slot>-pivot` child),
  on the reasoning that rig's only real pivot IS a bone origin. True of the runtime, but it made a
  skeleton edit out of an image property and left bones in people's rigs.
  - **Now:** the pivot is stored on the attachment as `pivot: [u, v]` (across, down; 0..1 of the
    image; absent = centred) and **nothing creates, moves or deletes a bone**. Setting it changes no
    placement at all, so the art cannot move; `applyAttachmentEdit` then HOLDS it — editing
    rotation / scaleX / scaleY recomputes x/y so the pivot point is the one point of the image that
    stays put. Since rig always rotates the quad about its own centre and then offsets by x/y,
    holding another point is still just arithmetic on x/y; a **centred pivot cancels to a no-op**, so
    every image authored before this is byte-unchanged.
  - The key is non-standard but **inert**: the official 4.2 loader ignores it and the rendered
    geometry is byte-identical (measured across 90 region attachments), so the `.irig` still opens in
    Rig with no sidecar. Regions only — a mesh's shape lives in its vertices, which is also what
    "image pivot" means.
  - **Migration for the rigs the first version touched:** the panel detects a leftover
    `<slot>-pivot` bone (child, no children, no other slot, no constraint, no timeline, identity
    rotation/scale) and offers **✕ Remove … and fold it back** — the exact inverse of what was
    written, so the art does not move. ⚠ Where the first version moved a slot's OWN bone rather than
    adding one, there is nothing to detect and the bone stays where it was put.
  - **Deleted with the old design:** `setSlotPivotWorld`, `pivotBoneIsExclusive`,
    `weightedBoneNames`, `rebaseSlotAttachments`, `boneHasTurnKeys` — including the weighted-index
    dependency bug that cost a follow-up commit. The feature is now ~40% smaller and touches one
    field.
  - **Verified:** the spike (rewritten for the new contract, still extracting the SHIPPED functions
    into a vm sandbox against the official loader) proves the art does not move, `bones` and `slots`
    are byte-unchanged, the key round-trips inert, rotation and scale hold the pivot, a centred pivot
    writes nothing and changes nothing, and the stray bone folds back at 0.0000px. **148 rigs, 148
    pass, 2368 assertions, 16 on every rig** — a rig with no image at all gets a probe region so it
    still exercises the contract. Live against the vendored minified runtime: bone array
    byte-identical, art drift 0, pivot held to 0.0027px through a 40° turn while the image's furthest
    corner moved 304px, and the fold-back taking 87 bones → 86 at 0.00001px.
  Files: `apps/launcher-api/static/rigger/view.html`, `tools/rigger-spike/pivot.mjs`.

- 2026-09-18 — **The rig FX preview was offset and clipped at 150% browser zoom** — `createFxOverlay`
  set `resolution: devicePixelRatio` without `autoDensity`, so the canvas ELEMENT kept its
  backing-store size and every effect landed `devicePixelRatio`× too far from the origin. Found and
  fixed via `/symbols`, which shares the factory; never reported here. Cause, measurements and the
  guard: `docs/status/symbols.md`, 2026-09-18.

- 2026-09-04 — **A rig's bound FX / clips now play wherever the rig is mounted, not only on a placed `spine` node.** What you key here reached the game through exactly two mount sites; a rig used by a coded component (the big-win rig, backdrops, transitions, cinematic actors) read the binding nowhere. The join moved into `<RigProvider>`. Authoring is unchanged. Detail in [fx status](fx.md).
- 2026-09-03 — **A carrier rig's bound clips and effects draw at their authored size in the game too.** Follow-up to the Bounds fix below: the frame was right but the lobster inside it was half-size on the board, because a symbol bundle is read at load scale 2 and a Pixi child riding a bone follows only the bone's scale. The engine now scales bound content by the host bundle's load scale, so what this tool (and /symbols) shows at load 1 is what the board draws. Details in [engine status](engine.md).
- 2026-09-02 — **The Bounds box is now the frame that fills a symbol cell — centred — everywhere, so
  what you author here is what the board draws.** Reported as: "the rig bounds we build seem off; I
  author them in the Rigger to get the size right in the game, but the two don't match." They could
  not: every consumer read only `skeleton.width/height` and placed the box as if it were CENTRED ON
  THE ORIGIN (`measureRigBounds` returned `-w/2, -h/2`; `<RigProvider>` pivoted on (0,0)). True
  of every externally authored rig we ship (all 32 checked-in headers are `x = -w/2, y = -h/2`), false of a
  Rigger rig: `ensureRigBounds` writes the measured setup-pose extent and a dragged frame writes
  wherever the author put it, so a rig whose root sits at its feet had a frame the game sized
  correctly and then hung from the wrong point — the origin at the cell centre, the frame's centre
  somewhere else. Shrinking or growing the frame to "get the size right" then moved the art as well,
  which is the "very difficult to match" in the report.
  - **Fix: read the box where the header puts it.** `authoredRigBox` (`constants-shared/rig`) is
    the ONE reading of `skeleton.{x,y,width,height}`; `measureRigBounds` (Scene Editor reel cells,
    `/symbols` grid + preview) returns its real corner, and `<RigProvider centreBox>` pivots the
    game's rig on the box centre — scaled by the bundle's load scale and y-flipped into pixi space
    (`rigBoxPivot`), because the header stays unscaled while the geometry does not. Opted in by the
    three cell-fit consumers (`SymbolRigMain`, `StackedPicture`, the paytable's `InfoOverlay`); a
    PLACED scene rig keeps origin-at-position, which is the convention the Scene Editor draws it
    with, so nothing else moves. A header with a size but no `x`/`y` keeps the centred reading.
  - Parity: a centred box yields a `(0,0)` pivot, so every shipped rig is byte-identical.
    Fixture `packages/pixi-svelte/fixtures/rigBox.fixture.ts` proves it against a real
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
    separately, and a rig event already carries what identifies its key.
  - **The fix: bake the BEAT.** A binding now carries `animation` + `time` beside the event name
    (`RigBeat` in `engine-layout`, read through `readRigBeat` at the same choke points as the
    overrides), one binding per keyframe; the runtime listener matches all three off the fire — the
    track entry's animation and the rig `Event.time` (the keyframe time, verbatim from the rig
    JSON). `riggedBeatMatches` in `pixi-svelte` is the one rule, extracted like
    `shouldApplyRigAnimation` so it runs headless. Absent fields match anything, so a manifest
    baked before beats existed still registers and keeps its name-only firing until re-baked. The
    bakes and both live timelines now walk ONE `beatsOf` list; the only thing still de-duped is a
    literal duplicate (same beat, same effect/clip, same place). Each keyframe keeps its own
    settings, so the inspector's "another key binds the same effect — rename it" warning and
    `bindingOverrideClashes` are gone with the limit they described.
  - **`continuous` reads slightly differently now:** it still starts once and survives loop wraps
    and state changes (it stops when the rig unmounts), but a binding is one keyframe — so key an
    ambient effect ONCE, on the animation that starts it; the same effect keyed continuous in a
    second animation is a second instance.
  - **What was wrong (2): a t=0 key fired before anyone listened.** The sibling `<RigTrack>` sets
    the animation and poses it with `rig.update(0)` from its `$effect`, and sibling effects run in
    template order — so the listeners `<RiggedEffect>` / `<RiggedFlipbook>` attached from THEIR
    `$effect` landed after that first apply, which is exactly when rig fires a frame-0 event. A
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
    `SymbolRigMain` called the helper but the patch that was meant to add its IMPORT never
    landed, and Svelte compiles a bare template identifier as a global, so `launcher build` (not a
    type-check) stayed green and the throw only surfaced when a rig with bindings rendered. Found by
    loading the republished game in the browser and reading the console, not by reasoning.
  - **Second follow-up the same day (#552): on H1 only the FX showed, not the clip.** Per-keyframe
    bindings exposed the reference Pixi runtime rule: ONE object per slot — `addSlotObject(slot)` first
    `removeSlotObject(slot)`s, pulling the previous container out of the rig. The H1 rig
    (`R_TentacleFlip`) binds `f_tentacle_exit` on `slot1` in BOTH `animation` (tumble) and
    `animation_copy` (static/land), which are now two `<RiggedFlipbook>` mounts, so the second
    evicted the first and the tumble's clip played into a container the rig no longer contained;
    the effect on `slot2` (one binding) still drew. Fix = `rigSlotHost.attachToSlot`: the slot
    object is a shared HOST, first binding in creates + registers it, later ones nest under it, last
    one out unregisters and destroys it. Both rigged players use it; `<RigSlot>` (coded slot
    content) still registers directly and is untouched. Fixture
    `packages/pixi-svelte/fixtures/rigSlotHost.fixture.ts` (mutation-verified: a host per
    binding fails the eviction case). Read off the baked `rigFlipbooks` for test6 via
    `/api/editor/runtime`, not guessed.
- 2026-09-01 — **A carrier rig had no SIZE and its bound content previewed upside down** — two
  independent bugs, both surfacing for the first time on a rig built entirely from FX + Flipbook
  bindings (`R_TentacleFlip`). Reported as: elements rotated 180° in `/rigger`, no Bounds box at
  all, correct in the game, too big in `/symbols`, bigger still in the game.
  - **No natural size.** Every measuring path is `skeleton.getBounds()`, which sees only
    ATTACHMENTS. A binding is a timeline **event** and the slots hosting one are empty, so the
    setup-pose measure, the animation union and the runtime's `rigNaturalBounds` all returned 0;
    `ensureRigBounds` no-opped and the rig kept the `{ spine: '4.2' }` it was scaffolded with. The
    Bounds box then could not draw (`rigBoundsRect` needs a positive width/height) — and its one
    rescue path calls the same `ensureRigBounds` — so the ONE control that could have given the rig
    a size was unusable on exactly the rigs that need it.
  - **The two consumers then guessed DIFFERENTLY**, which is why the same rig was two sizes:
    `measureRigBounds` fitted a 100×100 box while `rigSizeScale` returned `{1,1}`, silently
    dropping the requested `cell × SYMBOL_RIG_FILL` and drawing the rig raw. That disagreement
    read as a sizing bug in one surface rather than as the missing bounds it was. The fallback is
    now ONE number, `RIG_FALLBACK_NATURAL_SIZE` in `constants-shared/rig`, used by both.
  - **Fix: measure what the rig CARRIES.** A third tier in `computeRigBounds` unions the declared
    box of every bound Flipbook clip, posed at the beat and placed through its host bone's world
    matrix (the clip box is PIXI y-DOWN and the rig is rig y-UP, so the corner's y is flipped
    BEFORE the bone matrix — that is what puts an off-centre box on the side it draws on, and it is
    exactly the composition `<RigBoneAttach>` performs). FX contributes nothing on purpose:
    particles have no declared extent, so there is no honest size to read. When nothing is
    measurable the Bounds button now SEEDS a placeholder frame (unlocked, so a clip that later
    gains a box still auto-fits over it) and says so in a notice.
  - **The 180° was a REFLECTION the overlay carried through.** `fxBoneTransform` derives its 2×2 by
    differencing projected points, and every stage projection here mirrors (a y-up skeleton drawn
    into a y-down canvas; the Symbols grid mirrors x too), so `d < 0` and `setFromMatrix` drew the
    burst flipped about its bone. Invisible for as long as FX has existed — a particle burst is
    near-symmetric — and glaring the moment a Flipbook clip, which has an up and a down, was bound
    (2026-08-31, one day earlier). The game never did this: `<RigBoneAttach followRotation
followScale>` takes `rotation = -getWorldRotationX()` and sizes by `Math.hypot` MAGNITUDES,
    with a comment saying why. One shared `fxMatrix` in `fxOverlay.client.ts` now strips the
    reflection and keeps rotation + magnitudes, so **`/symbols` is fixed by the same change** — it
    was flipped too, just hidden under the oversize.
  - Proved offline against an independent implementation of the `<RigBoneAttach>` rule (every
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
  `<RigProvider>` rendered nothing — **including its children**, which for a carrier rig is the
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
    trick, same reason it needs a baked manifest: the reference Pixi runtime discards custom event fields at parse
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
    the reference Pixi runtime's `addSlotObject`, so the burst renders at that slot's place in the draw order — behind
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
    riding the nested container, are verified by construction (against the reference Pixi runtime 4.2.74 source,
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
    recipe: builtin rig + fetch/XHR/`Image.src`/rAF shims, plus a recording `window.RiggerFx`
    stub). Preview fires the keyframe once and rides the bone; looping fires once per loop;
    **non-looping fires once while `trackTime` runs to 4× the clip length**; animate is unchanged;
    setup is inert; an unbound clip generates zero overlay traffic; and `setFxDepth(false)` →
    leave cinematic restores `z-index: 2`.
  - Untouched, and still the answer to the rest of that report: an fx binding is still only
    `{ effectId, bone? }`, so **draw order (which slot the burst sits in), opacity and timing are
    not authorable** — that is the un-built "placed/persistent FX slots" half of
    [design §12.4a](../design/invisible-cinematic.md). the reference Pixi runtime has `addSlotObject`, which
    is the primitive that build would use.
- 2026-08-25 — **The fit rule shrank the pixels and the rig stretched them straight back — a
  translation still overflowed its button.** Reported live: `Acheter fonctionnalité` ran off the
  buy-feature button exactly as before the 2026-08-18 fit shipped. The fit itself was working —
  `fitTilesToSource` re-rasterised French at 28px inside English's width — but `width`/`height`
  on a region attachment was only ever written when the attachment was **created**.
  `placeTextAttachments` bailed on sight of an existing one (`if (bag[attName]) continue;`,
  "keep an authored placement"), so the `.irig` kept declaring the pre-fit box and rig scaled
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
  all. Its other locales are rig `linkedmesh` children, which inherit the parent's vertices by
  definition, so a shrunk region is stretched back onto the source's hull whatever its own size
  says. Fitting a meshed element needs either a per-locale scale on the slot or dropping the
  linked-mesh share (and with it the one-deform-drives-all-locales promise of §12.4a) — a
  deliberate design call, not a patch. Region attachments (a plain button label) are unaffected.
  **Not retroactive:** a deployed game keeps its old rig until the rig is re-opened in `/rigger`
  (which now auto-repairs it) and the game is re-published.
- 2026-08-20 — **⟳ Re-sync atlas flipped rotated regions 180°, and the cause was the boot-splash mirror shadowing the real page — a same-day regression, now fixed + guarded.** Symptom: re-syncing `R_InvisibleEngine` turned a rig that rendered CORRECTLY into one whose wordmark read `NI` instead of `IN`, with mirrored parts. Chain: `pickDeployedPage` answers "which deployed page IS this sheet?" by basename stem, newest-first, excluding only `deploy/editor-<kind>/` as derived bake output. The new `deploy/_boot/<tier>/` mirror (shipped that morning) copies a rig bundle's page under the SAME filename, **already reoriented 180° for rig**, and rewrites it on every `ensureDeployExports` — so it was always the newest stem match and won the ranking. `ensureBundleAtlasFresh` then re-derived the bundle from that page and ran `reorientRotatedRegionsForRig` a SECOND time, leaving every rotated region 180° out. Fix: the exclusion is now structural (`DERIVED_SUBTREE_RE` = `editor-<kind>` | `_boot` | `_pages`) with the rule stated as _a page we WROTE from another page can never be the source of truth for that other page_ — `_pages` joins it for the same reason even though its content-addressed names made a stem collision unlikely. **The convention itself was re-derived from the vendored runtime and is unchanged:** the reference WebGL runtime maps texture upper-left → displayed upper-RIGHT for `degrees == 90` (a 90° CW display rotation), so storage must be CCW while our packers store CW — the 180° reorient is right, it was just running twice. Also confirmed CORRECT and left alone: `regionsToRigAtlas` writes `bounds` with UPRIGHT `w,h`, which is what the parser wants (it derives the `(h×w)` footprint itself at `u2 = (x + height)/pageWidth`). Guarded by `pnpm --filter launcher-api run check:deployed-page` (9 assertions), **mutation-verified** — restoring the old `editor-*`-only exclusion fails exactly the three `_boot`/`_pages` cases, and a `_bootcamp/` look-alike is asserted NOT excluded so the fix stays surgical. **Not retroactive:** any rig re-synced while the bug was live is still flipped; re-sync it once more after this deploys and it resolves the real `sprites/` page and reorients once.
- 2026-08-18 — **Two rig-editor crashes, found while building the cinematic's Tweak Mode** (which
  drives this file's animator, so its bugs are this tool's bugs). Both are old, both are one-line:
  - **◆ Animate died on any freshly imported `.json` rig.** Rig JSON omits `time` on a keyframe
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
  finally SAVES the rig.** Owner: the remake's new rig "Buy Feature" button stayed English in
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
- 2026-08-17 — **Text as LOCALIZED ART in the rig** (design
  [invisible-cinematic §12.4a](../design/invisible-cinematic.md); guide:
  [tools/rigger](../tools/rigger.md#localized-text-setup-mode--text-localized-art)). Three
  commits: the text→region pipeline, the `/rigger` panel, and the game-side swap.
  - **Where the art lives, and why it ships.** The rasterised strings are packed onto a **second
    page of the rig bundle's own `.atlas`**, not into the source sheet. `exportRigBundle`
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
  - **Localization = attachment swap**, done in `BaseRigProvider` so every rig in the game
    gets it (`packages/pixi-svelte/src/lib/rigLocale.ts`). Guarded twice: the suffix must look
    like a locale (TWO-letter language + optional subtag), and — the guard that matters — the
    sibling `<base>@<locale>` must EXIST, so a coincidental name can never hide art. Unbaked
    language ⇒ the source art, never a blank slot.
  - **Mesh + weights + deform are authored ONCE.** Converting the source locale to a mesh
    relinks the other locales as rig `linkedmesh` (shared geometry, own `path`, `deform:true`);
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
    atlas and loads it with the reference core runtime as region / mesh+linkedmesh / weighted mesh;
    `rigtext-runtime.mjs` **30/30** pins the swap. Four assertions failed first and each found a
    real bug — a 2–3 letter locale pattern classified `logo@big` as a locale; and the swap
    keyed "already right?" off the setup attachment, so switching BACK to the source language,
    or to an unbaked one, left the previous language on screen.
  - **⏳ Live-verify owed (owner).** Nothing here has touched real R2, real auth, or a real
    game: the conditional write + presigned upload + stale-page sweep ran only against fakes,
    and **how the baked text LOOKS** (a bitmap font's premultiply halo, the size relative to the
    rig) has never been eyeballed. In `/rigger`: open a rig with a project font and a localized
    key, ＋ Add text, then re-open the rig and confirm the regions survive; then publish and
    confirm `deploy/` carries the `rigtext-*.png` page.
- 2026-08-10 — **Stale manifest geometry could rotate/mis-place a region (fixed at the read
  layer).** A rig bundle's `.atlas` is synthesised from the source sheet's `atlas_manifest_*.json`
  `regions`, whose `x/y/w/h/rotated` are a CACHE of the packed page. That cache can drift from the
  actual page — e.g. `bookofborutremake/S_VFX` had `T_VFX_AnticipationLine_shine` cached as
  `rotated:false` at (0,428) while the page (and the sibling `S_VFX.atlas` + `S_VFX.json`
  TexturePacker output) have it `rotate:90` at (975,0); its `_zoom` sibling was cached with the
  SWAPPED slot. `regionsToRigAtlas` trusted the stale rect, so the Rigger sampled an un-rotated,
  over-tall page rect that bled into the neighbour below (the frame with a circle-burst tacked
  underneath; siblings looked fine because their cache happened to match). Fix: `loadRegionSet`'s
  `backfillMissingGeometry` (`$lib/server/editorRegions.ts`) now RECONCILES each region's on-page
  placement + rotation against the authoritative `atlas.texturepacker_json` (`frame` = the tight
  packed rect; un-swap a rotated frame's axes back to upright), overriding a drifted `x/y/w/h/
rotated` — **never trim** (`offX/offY/origW/origH`), per the `RawRegion` landmine. Heals via the
  same `ensureBundleAtlasFresh` used on the Symbols/Editor read path, the bake path, and the
  Rigger's **⟳ Re-sync atlas** button. Launcher-server only (`editorRegions.ts`) — no engine change.
  Headless proof: replicated the reconcile against the real `S_VFX` manifest +
  TP JSON → base/zoom/shine/glow all match the packer ground truth (4/4). **⏳ Live-verify owed
  (owner):** open `R_AnticipationColumn` in `/rigger`, click **⟳ Re-sync atlas**, reload — the
  `_shine`/`_zoom` meshes should render as the upright glowing frame (no rotation, no circle-burst
  bleed). A re-pack of any sheet self-heals on next read/bake with no manual step.
- 2026-07-28 — **Save can no longer silently un-ship a rig.** `POST /api/rigger/save` rebuilt
  the WHOLE project index via `buildSkeletonsIndex` and overwrote `skeletons.json`; that scan
  SILENTLY DROPS any skeleton folder whose `.atlas` is missing (`if (!atlases.length) continue`
  in `rigIndex.ts`). So re-saving an atlas-less rig un-shipped it (blank in the editor, gone
  from the editor-art export + game), and saving rig A could drop a DIFFERENT atlas-less rig B.
  Now `save` goes through **`reindexSkeletonsPreserving`** (`rigIndex.ts`): Layer 1 re-derives
  a missing `.atlas` from the folder's `source.json` via `ensureBundleAtlasFresh` (the `⟳ Re-sync
atlas` path); Layer 2 preserves the prior `skeletons.json` entry for any folder it still can't
  rebuild (never drops) and, for the folder being SAVED, **fails 400 loudly** ("…has no atlas and
  no source to rebuild it — re-sync an atlas first") instead of writing a self-dropping index. A
  healthy save is byte-identical to before (parity fast-path). Offline proof:
  `tools/rigger-spike/reindex-preserve.mjs` (esbuild-bundles the real helpers; 21/21).
  **Still-risky (noted, not yet fixed):** `rigger/{new,upload,delete}` and `editor/spines/reindex`
  do the same project-wide `buildSkeletonsIndex` overwrite, so any of them can drop an atlas-less
  rig B. Route them through `reindexSkeletonsPreserving` (or a preserve-only variant) next.
