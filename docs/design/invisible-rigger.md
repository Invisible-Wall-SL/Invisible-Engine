# Invisible Rigger — design + build plan

> An online **Spine skeleton editor** — view bones, pose/edit the rig, build and
> weight-paint meshes, and author animations — that reads and writes the **Spine
> 4.2 export format** so files round-trip with the official runtime, while keeping
> the desktop Spine Editor usable alongside it.
> Owner direction 2026-06-13. Related: `live-assets.md` (the deploy→bake→pull→register
> contract every new asset class must travel), `invisible-editor.md` (the
> sibling online editor whose `/spine` viewer + R2 spine plumbing this builds on).

## 0. Status

**Not built. This doc is the registered build plan.** Nothing here ships until it
travels the full asset chain (§8). Phase 0 (§7) is the make-or-break gate — do not
start Phases 2+ until the two spikes pass.

## 1. Why this tool exists (the goal)

Owner direction (2026-06-13): a license-free, browser-based, collaboration-first
rigging tool we own end-to-end — so multiple artists can rig/animate without a
Spine license, the export→re-import round-trip friction disappears, rigs live in
R2 where they can be edited and reviewed online, and Spine becomes one more
**Invisible** tool in the pipeline. Rigging/animation is **core, constant work**,
which is what justifies a build of this size. **Weight painting is in scope and
non-negotiable** — without mesh deformation the tool doesn't replace Spine for
real work.

This is its own product, comparable in size to the Atlas Maker or larger. The
phasing (§7) is structured so every phase ships a usable increment and the riskiest
work is proven first.

## 2. The format question (settled)

### 2.1 Native format = Spine 4.2 export JSON, under our own extension

A Spine **runtime export** is open and documented: a `.json` (or binary `.skel`)
skeleton + a `.atlas` + page PNG(s). The skeleton JSON is a plain tree — bone
hierarchy (`x/y/rotation/scaleX/scaleY/shearX/shearY/length/parent`), slots, skins
(region / **mesh** / clipping / boundingbox / path attachments), IK / transform /
path constraints, events, and animations (keyframed timelines with bezier curves).
Nothing is encrypted or proprietary about the *data*.

**Decision:** our native file **is** byte-valid Spine 4.2 JSON, saved under our own
extension (working name `.irig`). The extension is cosmetic — the official runtime
loader (`SkeletonJson.readSkeletonData`) takes a parsed object/string and does not
care about the filename; only convenience auto-loaders pick the JSON vs binary
reader by extension, and in our own pipeline we call the loader directly. This buys
branding/ownership with **zero** compatibility cost:

- **Our editor → Esoteric runtime:** seamless, no conversion.
- **Our editor → a future Invisible (license-free) renderer:** same bytes (§7 Phase 6).

Do **not** fork the format. The instant our format diverges from Spine's we lose
the free runtime and inherit a permanent round-trip-fidelity burden.

### 2.2 Editor-only metadata goes in a sidecar

Anything outside the Spine schema (our UI state, layer colours, comments, lock
flags) lives in a sidecar so the skeleton file stays 100% pure and portable:

```
model.irig            ← pure Spine 4.2 JSON (every Spine runtime eats this, untouched)
model.irig.meta.json  ← our extras (ignored by every Spine runtime)
```

This is the [[feedback_validate_data_contracts_offline]] lesson applied up front:
never risk confusing a strict loader with unknown keys — keep extras out-of-band.

### 2.3 The honest interop limit

There are two distinct Spine formats:

| | What it is | Can we write it? |
|---|---|---|
| **Runtime export** (`.json` / `.skel`) | the "compiled" data runtimes consume | ✅ yes — our native format |
| **Project file** (`.spine`) | Spine **Editor's** own save format (proprietary, undocumented) | ❌ no |

So "keep both" is **total at the runtime level** — every Spine runtime renders our
files natively. Going *back into desktop Spine Editor* works via its **Import**
(it can import skeleton JSON), but that is an import, not a pristine project
round-trip; the desktop editor really wants its `.spine` project file, which we
cannot author. In practice this is fine: desktop Spine stays available for anyone
who wants it, our tool produces files it can import, and our tool ↔ runtime is
seamless. We just don't promise a lossless desktop-editor round-trip — that's an
Esoteric limitation, not ours.

### 2.4 We target Spine 4.2, version-locked

The schema changes between Spine versions. We pin to **4.2** (the engine's runtime —
`@esotericsoftware/spine-pixi-v8`, and `static/spine/vendor/spine-webgl-4.2.js`).
The serializer (§7 Phase 0) is validated against the 4.2 loader, not a guess.

## 3. What we already have to build on

The `/spine` Invisible Spine Viewer and the editor's spine plumbing are the
foundation — this tool extends them rather than starting cold:

- **Viewer + runtime** — `apps/launcher-api/static/spine/view.html` +
  `spine-webgl-4.2.js` (and `-4.1` fallback); `/spine` page +
  `routes/(app)/spine/{+page.svelte, +page.server.ts, skeletons/+server.ts, file/+server.ts}`.
- **Spine in the editor** — `routes/(app)/editor/{editorSpine.client.ts,
  spineRuntime.client.ts, EditorSpineLayer.svelte}`, `lib/server/spine.ts`,
  `lib/server/spineIndex.ts`, the upload/reindex endpoints under
  `routes/api/editor/spines/`, and `scripts/r2-sync-spines.mjs`.
- **pixi-svelte spine components** — `packages/pixi-svelte/src/lib/components/{SpineProvider,
  BaseSpineProvider,SpineTrack,SpineSlot,SpineBone}.svelte`. The runtime already
  exposes `skeleton.bones` (each with full transform + parent) and slots, so the
  **bone overlay and hierarchy outline are nearly free**.
- **R2 spine prefix + symbols spine stages** — `SymbolSpineStage.svelte` /
  `SymbolSpinePreview.svelte` show we already load atlases + skeletons from R2 and
  animate them in a shared WebGL stage.

## 4. Architecture (proposed)

- **Host:** a launcher-native Svelte 5 page at **`/rigger`** — reuses launcher
  auth, the client→project selector, scope gating, and R2 writes (the
  `invisible-font-maker.md` §3 pattern). No new Railway/Python service.
- **Editing model:** load skeleton JSON → an **in-memory editable document**
  (our own typed model, not the runtime's immutable `SkeletonData`). The runtime is
  used to *render/preview*; edits mutate our document; on save we **serialize our
  document → Spine 4.2 JSON**. Keep a clean boundary: runtime = renderer, our
  document = source of truth while editing.
- **Rendering:** `spine-webgl-4.2` as the preview renderer initially (and possibly
  forever). Our document is pushed to a runtime `Skeleton` for live display.
- **Writes:** a `rigger`-gated launcher endpoint (`POST /api/rigger/save`) using the
  existing `r2.ts` writers; `assertAllowed` every key against the gate's prefixes.
  Skeleton + sidecar + (when meshes/atlas change) the atlas/page handoff to the
  Atlas Maker's domain — see §8.

## 5. The hard parts (named honestly)

1. **No official exporter.** Spine runtimes only *read*; serialization lives only in
   the paid desktop editor. We must write our own 4.2 serializer. Bounded but
   unforgiving and version-locked. → De-risked in Phase 0.
2. **Auto-weights is research-grade.** Manual brush painting is doable; the thing
   that makes mesh rigging *usable* — auto-weights (Spine uses a proprietary
   bounded-biharmonic / heat-diffusion approach) — we must approximate
   (inverse-distance-to-bone-segment or a bone-glow flood), and it **will not match
   Spine on day one**. This is the single biggest risk. → De-risked in Phase 0.
3. **Mesh geometry editing.** Hull + interior vertices, constrained
   triangulation (ear-clipping / Delaunay), UV binding, edges — a small CAD-like
   subsystem.
4. **Animation timeline authoring.** Dopesheet + bezier graph editor + events — the
   bulk of Spine Editor by surface area.
5. **License.** As long as we render with `spine-*`, we remain under the Esoteric
   Spine Runtimes License (a valid Spine license is required to use the runtime).
   Our own format reader/writer is fine (format is documented). Truly license-free
   rendering needs our own deformer (Phase 6) — **optional**, not required, because
   §2.1 keeps the format identical either way.

## 6. The weight-painting subsystem (Phase 4 detail)

The runtime already performs linear-blend skinning when it renders a weighted mesh —
the math is done for us. Everything hard is **authoring**:

- **Weighted-mesh vertex format.** Spine packs weighted vertices as a flat array:
  per vertex `boneCount, [boneIndex, x, y, weight] × boneCount`, where `x,y` are in
  each influencing bone's *local* space and weights normalize to ~1. Reading/writing
  this exactly is fiddly but bounded — covered by the Phase 0 round-trip fixture.
- **Auto-weights (the risk).** Ship an approximation first; gate the whole project on
  whether its output *looks acceptable deforming* on a real mesh (Phase 0 spike).
- **Brush.** Manual per-vertex/per-bone weight painting with falloff + normalization,
  with live deform preview by posing the bones.

## 7. Build plan (phased — each ships something usable)

| Phase | Delivers | Risk |
|---|---|---|
| **0 — Format core + spikes** | 4.2 JSON reader/writer; `read→write→read` round-trip diff on a **real production skeleton**; auto-weight prototype on one real mesh, viewed deforming | **make-or-break — do first** |
| **1 — Viewer + inspector** | extend `/spine`: bone overlay, slot/skin tree outline, animation scrubber (read-only) | low — foundation exists |
| **2 — Rig editor** | move/rotate/scale/reparent bones; edit slots/skins/draw-order/attachment placement; rename/delete; **export valid `.irig`** | medium |
| **3 — Mesh editor** | place vertices, auto-triangulate, UV bind, hull/edges | medium-high |
| **4 — Weights** | auto-weights + brush painting + live deform | **highest** |
| **5 — Animation** | timeline/dopesheet + bezier curves + events | high |
| **6 — License-free render (optional)** | our own WebGL LBS deformer; drop the Esoteric runtime dependency | medium |
| **7 — Pipeline wiring** | export → `deploy/` → bake → pull → register (rule 8 / §8) + R2 collaboration UX | medium |

**Phase 0 is a gate, not a formality.** Both spikes must pass before committing to
Phases 2+:

1. **Round-trip fidelity** — reproduce Esoteric's 4.2 JSON closely enough that the
   runtime loads our re-serialized file identically. Build a fixture: take a real
   shipped skeleton (e.g. a Book of Borut spine), `read → write → read`, diff the
   parsed structures. This is the format contract — rule 7 puts it first regardless.
2. **Auto-weights quality** — prototype the algorithm on one real mesh and *look at
   it deforming*. If we can't get acceptable output and can't see a path to closing
   the gap, we learn it on day 3, not month 3.

## 8. Pipeline wiring (rule 8 — non-negotiable)

Spines are already an R2 asset class with viewer + editor consumption, but a
**rig authored by this tool only ships when it travels the full chain**, mirroring
`editorArtExport.ts` / `fontExport.ts` (see [[project_live_assets_pipeline]],
[[feedback_r2_assets_must_ship]]):

**export → `<client>/<project>/deploy/` → bake (embed index in the bundle) → pull
(mirror into `static/assets/`) → runtime register in the game.**

"It renders in `/rigger`" does **not** mean it ships — the editor reads R2 directly.
Watch the two known traps: the `bake:doc` ordering (must run before `pull:assets`)
and the build-env token trap that silently serves stale assets
([[project_component_art_to_game]], [[gotcha_game_build_stale_engine_dist]]).

Meshes that touch atlas regions are the Atlas Maker's domain — `/rigger` authors the
skeleton + weights; atlas/page generation stays with the Atlas Maker. Define the
handoff in Phase 3, don't duplicate the packer.

## 9. Open questions (resolve during Phase 0/1)

- Binary `.skel` support — read-only import first, or skip until needed? (JSON is the
  authoring format; `.skel` is an optional export.)
- Final extension name (`.irig` working title) + whether the sidecar is one file or
  per-resource.
- Collaboration model in R2 — last-write-wins + lock flag in the sidecar, or
  something with optimistic concurrency.
- Undo/redo architecture for the editable document (command stack) — decide before
  Phase 2 since every later phase depends on it.

## 10. Phase 0 results (2026-06-13)

Spike harness lives in `tools/rigger-spike/` (`spineModel.mjs` parse↔serialize,
`roundtrip.mjs` single-file driver, `batch.mjs` corpus runner, `autoweights.mjs`,
`inspect.mjs`). Arbiter = the official `@esotericsoftware/spine-core@4.2.74` loader
(already in the tree via `spine-pixi-v8`). Corpus = the real game spines under
`apps/{cluster,lines,ways,scatter}/static/assets/spines` (exported by Spine 4.1.23;
the 4.2 loader reads them, so this also confirms 4.1→4.2 read-compat).

### Spike 1 — serializer round-trip: ✅ PASS (unambiguous)

`node tools/rigger-spike/batch.mjs` → **120 / 120 skeletons** re-serialize to JSON
the official loader reads back **identically** (deep SkeletonData diff: bones,
slots, skins, constraints, **weighted-mesh vertices**, animations all match).
Coverage: 3,700 region, 440 mesh (**372 weighted, 36,920 bone influences
decoded→re-encoded**), 720 linkedmesh, 20 clipping, 108 path. The weighted-mesh
packed-vertex format — the weight-painting data contract — round-trips faithfully.
- **Found + fixed:** Spine **4.2 sequence attachments** (`{sequence:{count,digits}}`,
  region resolves to `name+index`) — our first model dropped the `sequence` field
  (16 failures); adding it to region+mesh fixed all 16. Exactly the kind of
  version-specific field Phase 0 exists to surface.
- **Caveat (honest):** `boundingbox` and `point` attachment paths are written but
  **untested** — none exist in this corpus. Animations are **pass-through** (parsed
  raw, re-emitted), so their match is real-via-loader but not yet model-reconstructed
  (that's Phase 5). Byte-minimisation (matching Esoteric's omit-defaults) is not
  done — we emit explicitly; the loader doesn't care, but a future "diff vs original
  bytes" pass is a nicety, not a blocker.

**Verdict:** the no-official-exporter risk (§5.1) is **retired** for the rig
structure + the weighted-mesh data contract. We can author Spine 4.2 JSON the
runtime accepts and reads identically.

### Spike 2 — auto-weights vs artist ground truth: ⚠️ OPEN (risk reframed, not settled)

`node tools/rigger-spike/autoweights.mjs` → over **186 weighted meshes / 8,936
vertices**, a cheap proximity algorithm (inverse-squared distance-to-bone-segment,
top-4, normalised) vs the artists' real weights: **top-1 bone match 20.5%, cosine
0.837, mean L1 0.579**.

Root-caused via `inspect.mjs`: these assets are a **poor ground truth** for
proximity weighting. Example — the `eyebrow_l` mesh: its two influencing bones
(`handle`, `origin`) **both sit at world (0,0)**, far from the vertices, and the
artist used **near-uniform** weights (0.35 / 0.65 across all 4 vertices). That's a
"deform-handle" rig style (whole region bound to co-located control bones), not the
anatomical falloff a distance algorithm models. A proximity heuristic *cannot*
recover a 35/65 split from two co-located bones — hence high cosine but tie-flipping
top-1. The corpus is slot symbols / UI; it has **no embedded-skeleton character
mesh** (bones running along limbs), which is the case proximity auto-weights is
actually for.

**What this means (the reframe):**
- The naive proximity algorithm is **not good enough as-is**, and the available data
  can't fairly evaluate the real target case. The risk is **not closed**.
- **But the bar is lower than "match the artist exactly":** in Spine itself,
  auto-weights is a *starting point* artists then clean up with the brush. So the
  product bar is "**a sane starting point + a reliable manual brush**," and the brush
  (Phase 4) is the guaranteed-correct fallback regardless of auto-weight quality.
- **To actually settle Spike 2 before committing to Phase 4 we need:** (a) a better
  algorithm for embedded-bone rigs (geodesic/heat-diffusion, bone-length-aware —
  note 5/24 bones here are zero-length, collapsing segments to points), (b) a
  **representative character test mesh** as ground truth, and (c) treat the brush as
  the safety net. This is the open item that gates Phase 4 — not Phases 1–3.

**Net Phase 0 readout:** the format/serializer half (the thing most likely to be a
silent dealbreaker) is proven. Phases 1–3 (viewer, rig editor, mesh geometry) are
clear to proceed. Phase 4 (weights) stays gated on resolving the auto-weights
question with proper test data — the brush makes the *tool* viable even if
auto-weights only ever reaches "decent starting point."

## 12. Phase 1 progress (2026-06-13)

**Read-model + viewer landed (code; build GREEN; not browser-verified — authed
launcher page needs Postgres/R2/auth).**

- **Inspector read-model** (`tools/rigger-spike/inspectModel.mjs`, committed
  `757b6d5`): pure `buildInspector(skeletonData)` → bone hierarchy tree, setup-pose
  bone world transforms (origin→tip→rotation = the overlay geometry), slots in draw
  order, skins (with weighted-mesh flags), animations, constraints. Verified
  headlessly on the anticipation skeleton.
- **`/rigger` launcher tool** — registered in `roles.ts` (tool + icon +
  `TOOL_BAR_ORDER` + doc slug; granted to admin/developer/animator), gated redirect
  `routes/(app)/rigger/+page.server.ts` mirroring `/spine`, and the static WebGL app
  `static/rigger/view.html`. **Reuse, not rebuild:** forked the proven Spine Viewer
  (rendering, pan/zoom, scrubber, anim/skin, debug overlay) and reuses its
  `/spine/skeletons` + `/spine/file` endpoints + vendored `spine-webgl-4.2` (the
  access gate `requireSpineAccess` was widened to accept `spineViewer` OR `rigger`).
  The Rigger's **delta** is the structured **Inspector panel** (hierarchy / slots /
  skins / animations / constraints), bone **selection** (tree highlight + detail +
  a defensive world-space marker), and bones-overlay-on — the seed of Phase 2 edit.
- Verified: `pnpm --filter launcher-api build` GREEN; both inline `<script>` blocks
  pass `node --check`. **Owner-verify live at `/rigger`** (skeleton list loads, a
  skeleton renders with bone overlay, inspector populates, bone click selects).
- **Reuse finding (recorded):** the Spine Viewer already covers most *read-only*
  viewing (render + debug bone/mesh overlay + scrubber). The Rigger's real value is
  the inspector + (Phase 2+) editing, so it extends the viewer rather than cloning it.

## 13. Phase 2 progress (2026-06-13)

**Phase 2.1 — bone transform editing + `.irig` export landed** (code; build GREEN;
edit→export contract verified headlessly; UI not browser-verified).

The Rigger now *writes* skeletons. In `static/rigger/view.html`:
- **Edit mode** (`✎ Edit` button) — pauses animation and holds the (editable) setup
  pose; the frame loop skips `animState.apply` so edits stay visible.
- **Editable source of truth = the parsed skeleton JSON** (`rawDoc`, from
  `assetMgr.require`). Per-edit we mutate `rawDoc` **matched by bone name** (index
  drift can't corrupt it) AND the live runtime `BoneData` (instant render via
  `setToSetupPose`). The selected bone gets numeric editors (x/y/rotation/
  scaleX/scaleY/length) in the inspector detail.
- **Export `.irig`** (`⤓ .irig`) — `JSON.stringify(rawDoc)` downloaded as
  `<stem>.irig`: byte-valid Spine 4.2 JSON under our extension. **Edit-existing uses
  in-place mutation, NOT the Phase-0 normalized serializer** — strictly more
  fidelity-safe (preserves animations + every untested field verbatim). The
  serializer stays for synthesis/mesh paths (Phase 3+).
- **Reset** restores bone transforms from the untouched original. JSON-only (binary
  `.skel` is view-only in Phase 2).
- **Verified:** `editexport.mjs` mutates a real bone → stringify → reload via the
  official loader: edit present, loader accepts, every OTHER bone + all slots +
  animations unchanged (drift=0), on anticipation (73 bones) and transition.
  Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify the UI live at
  `/rigger` (Edit → tweak a bone → see it move → Export → reopen the `.irig`).

**Phase 2.2 — canvas drag-to-move + bone reparent landed** (code; build GREEN;
contracts verified headlessly; UI not browser-verified).
- **Drag-to-move:** in edit mode, dragging the canvas moves the selected bone
  (Shift+drag still pans). Screen delta → world delta (`×dpr×zoom`) → **parent-local
  delta** via the inverse of the parent bone's world matrix `[a b; c d]`, added to
  the bone's local x/y (mutates `rawDoc` by name + live `BoneData`).
- **Reparent:** the inspector's selected-bone detail gains a **parent `<select>`**
  (excludes self + descendants, so no cycles; `(root)` = no parent). Changing it is
  STRUCTURAL → mutate `rawDoc.bones[i].parent`, **topo-sort** the bones array
  (parents must precede children in Spine JSON), then `rebuildFromRawDoc` re-reads
  the skeleton from the edited JSON (clone, so the loader never touches our source),
  rebuilds the runtime + anim state, restores skin + selection by name.
- **Reset** now restores the full original `rawDoc` and rebuilds (covers structural
  edits too, not just transforms).
- **Verified:** `reparent.mjs` — reparent a bone + topo-sort + reload via the
  official loader: parent-precedes-child invariant holds (0 violations), loader
  accepts, new parent applied, no bone lost, animations intact (anticipation +
  transition). Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify the UI
  live (drag a bone, reparent it, Export, reopen).

**Phase 2.3 — save to R2 as a first-class `.irig` landed** (code; build GREEN; not
browser-verified). Edits now persist server-side, not just download.
- **`.irig` is a first-class skeleton.** Taught the shared `spineIndex.ts` about
  `.irig` (added to `SPINE_ASSET_EXT` + `SPINE_CONTENT_TYPE=application/json`; the
  JSON-skeleton detection + `detectVersion` now include `.irig`). So a saved `.irig`
  is listed by `skeletons.json` and re-opens in the tool (and the Spine Viewer) —
  it's just Spine JSON the extension-agnostic loader reads (proven in Phase 0).
- **`POST /api/rigger/save`** (`routes/api/rigger/save/+server.ts`) — `rigger`-gated
  via `gate()`, path-guarded, validates `bones[]`, writes `<bundle>/<stem>.irig`
  with `putObjectText`, then rebuilds `skeletons.json` via `buildSkeletonsIndex`
  (same final step as the editor's spine reindex). **Non-destructive:** the artist's
  source `.json` is untouched; the edit is the sibling `.irig`.
- **Viewer:** `💾 Save` button → POSTs `{dir, stem, skeleton: rawDoc}`, then
  refreshes the list (the new `.irig` appears, tagged "irig · edited").
- Verified: `pnpm --filter launcher-api build` GREEN; viewer `<script>` blocks pass
  `node --check`. ⏳ owner-verify live (edit → 💾 Save → the `.irig` appears in the
  list and re-opens with the edits).

**Phase 2.4 — slot draw-order + region attachment placement landed** (code; build
GREEN; contracts verified headlessly). Structural editing is now complete.
- **Draw-order reorder:** slot rows get ↑/↓ in edit mode → swap in `rawDoc.slots`
  (the array order IS the setup draw order) → `rebuildFromRawDoc`, keeping the slot
  selected. Slots iterate `skeletonData.slots` (setup order = `rawDoc.slots`).
- **Region attachment placement:** clicking a slot selects it; for a region
  attachment its x/y/rotation/scaleX/scaleY get numeric editors. Edits mutate the
  live `RegionAttachment` (+ `updateRegion()` to recompute geometry — no rebuild,
  instant) and the `rawDoc` skin entry (found by skin→slot→attachment). Mesh
  attachments show a "region-only (mesh = Phase 3)" note.
- Edit toggle re-renders the inspector so the ↑/↓ controls appear/disappear; both
  bone and slot selections survive rebuilds.
- **Verified:** `tools/rigger-spike/slotedit.mjs` — swap slots[] + reload = order
  changed, all present, loader accepts; mutate a region attachment's x/rotation +
  reload = values present on the reloaded `RegionAttachment` (anticipation +
  transition). Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify live.

**Phase 2 is complete** (transform edit, drag-move, reparent, slot order, attachment
placement, `.irig` export + R2 save). Next — the real gate before **Phase 3/4 (mesh
geometry + weight painting): resolve the open Spike-2 auto-weights question** — needs
a representative embedded-skeleton character mesh as ground truth + a better
algorithm (geodesic/heat, bone-length-aware). The manual weight brush remains the
guaranteed fallback regardless.

## 11. Model note (Fable 5 vs Opus 4.8 for building this)

Default the build to **Opus 4.8** — it's state-of-the-art at long-horizon agentic
engineering, and the bulk of this project (viewer, rig editor UI, mesh geometry,
timeline, pipeline wiring) is well-specified Svelte 5 / PixiJS work it handles
excellently at half the token cost. **Reserve Fable 5** ($10/$50 vs $5/$25 per MTok)
for the genuinely research-grade pieces where the intelligence ceiling pays for
itself: the **auto-weights algorithm** (Phase 0/4) and gnarly **serializer
round-trip debugging** (Phase 0). Blanket-using Fable 5 for the whole build would be
a waste of tokens.

## 14. Phase 3 progress (2026-06-13)

Phase 3 (mesh geometry) is unblocked — only Phase 4 (weights) is gated on the
Spike-2 auto-weights question.

**Phase 3.1 — mesh vertex editing landed** (code; build GREEN; the move math
verified headlessly across weighted + unweighted meshes; overlay/drag UI not
browser-verified).
- Selecting a slot whose attachment is a **mesh** enters mesh-edit: the vertices are
  drawn as handles on the canvas (world-space, via the runtime's shape API —
  `renderer.circle`), and dragging a handle moves that vertex.
- **Move math (the crux):** screen→world (`camera.screenToWorld`), then the vertex
  snaps to the cursor. The world delta is pushed into the geometry differently per
  format — **unweighted:** add `inv(slotBoneLinear)·delta` to the bone-local `[x,y]`;
  **weighted:** for each influence, add `inv(boneLinear)·delta` to that influence's
  bone-local `[x,y]` (so the weighted world sum shifts by exactly the delta). Both
  the live `MeshAttachment.vertices` (instant render) and the `rawDoc` packed array
  (export/save) are updated — note the **two layouts differ**: runtime splits
  `bones[count,idx…]` + `vertices[x,y,weight]`; rawDoc is the combined packed
  `[count,(idx,x,y,weight)…]`.
- **Verified:** `tools/rigger-spike/meshedit.mjs` — move a vertex by a world delta
  via the rawDoc packed edit, reload through the official loader, recompute setup
  world verts: the vertex moved by *exactly* the delta and others were unchanged, on
  weighted (anticipation `payframe`, symbols `t1_glow`) and unweighted (anticipation
  `payframe_particles`). Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify
  the drag UI live.

**Phase 3.2 — add a mesh vertex landed** (code; build GREEN; math verified headlessly,
weighted + unweighted). A `＋ Add vertex` toggle in the mesh detail; clicking inside
the mesh inserts a vertex via **local triangle split** (no global re-triangulation):
- Find the triangle containing the click (barycentric test over world verts), split
  it into three fanned to the new vertex (`triangles` +6, hull untouched — the new
  vertex is interior, appended last).
- The new vertex's **UV** = barycentric blend of the triangle's corner UVs. For a
  **weighted** mesh, its **bone influences** = barycentric blend of the corners'
  influences (normalised), each influence's bone-local pos = `bone.worldToLocal(P)`.
  Unweighted: append slot-bone-local `[x,y]`. Mutates `rawDoc`, then rebuilds.
- **Verified:** `tools/rigger-spike/meshadd.mjs` — split a triangle at its centroid,
  reload: vertex count +1, triangles +6, new vertex lands at the centroid (off by
  0.000), mesh poses with all-finite verts, loader accepts — weighted (anticipation
  `payframe`, symbols `t1_glow`) + unweighted (`payframe_particles`). The new vertex
  is then draggable via 3.1. ⏳ owner-verify the UI live.

**Phase 3.3 — remove a mesh vertex landed** (code; build GREEN; validity verified
headlessly). A `－ Remove vertex` toggle; clicking an **interior** vertex removes it:
- Collect the triangle fan around the vertex, chain its outer edges into the hole's
  boundary ring, **ear-clip** the ring (using setup-pose world positions) to fill the
  hole, drop the vertex from `uvs` + `vertices` (packed/unweighted), and **reindex**
  every later triangle index. Hull vertices (index < `hull`) are refused (hull-edit =
  3.4); the derived `edges` hint is dropped on the topology change.
- **Verified:** `tools/rigger-spike/meshremove.mjs` — remove an interior vertex,
  reload: vertex count −1, triangles a valid multiple of 3 with all indices in range,
  mesh poses with all-finite verts, loader accepts (weighted anticipation `payframe`,
  symbols `t1_glow`). Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify UI.

**Mesh topology editing is now add + move + remove.**

**Phase 3.4 — region→mesh conversion landed** (code; build GREEN; geometry verified
headlessly). The practical "new mesh" entry point: a `▸ Convert to mesh` button on a
region attachment's detail replaces it with an editable **quad mesh** covering the
same image — 4 corner vertices (the region's bone-local corners from its computed
`offset`, order BL/UL/UR/BR), unit-square UVs in matching order, 2 triangles, hull 4.
Afterwards the 3.1–3.3 mesh tools apply (move/add/remove verts) → the full
create-a-mesh workflow.
- **Verified:** `tools/rigger-spike/convertmesh.mjs` — convert a region, reload: the
  attachment is now a `MeshAttachment` with 4 verts whose world corners match the
  region's original world corners **exactly** (max off 0.0000), loader accepts
  (anticipation `radial1`, transition `dust1`). Viewer `<script>` blocks pass
  `node --check`. ⏳ owner-verify the UI + texel mapping live (UV orientation for
  rotated atlas regions is best-effort — confirm visually).

**Mesh editing is now create (from a region) + topology (add/move/remove).**

**Phase 3.5 — UV editing (numeric) + mesh visualization landed** (code; build GREEN;
UV round-trip verified headlessly). Scoped to the *verifiable* half of a UV editor:
- **Vertex selection:** clicking a mesh vertex selects it (`selMeshVert`); the
  selected/dragged handle is highlighted.
- **Numeric UV editor:** the selected vertex's region UV (u, v ∈ 0–1) gets numeric
  inputs; editing updates `rawDoc.uvs` + the live `MeshAttachment.regionUVs` (+
  `updateRegion()` to recompute page uvs).
- **Triangulation wireframe:** the mesh's triangle edges now draw on the canvas (via
  `renderer.line`) so the topology being edited is visible.
- **Verified:** `tools/rigger-spike/uvedit.mjs` — change a vertex's u in rawDoc,
  reload: the new u is present on the mesh's `regionUVs` and page uvs recompute
  finite; loader accepts. Full mesh suite (edit/add/remove/convert) re-run = no
  regression. Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify live.

**Deferred to Phase 3.6 (a larger, inherently-visual build):** a **visual UV editor
panel** (show the region's texture image, drag vertices in UV space) + **hull/edge
editing**. These need real in-browser verification — best done after the live `/rigger`
check.

## 15. Phase 4 progress — weights (2026-06-13)

**Phase 4.1 — manual per-vertex weight editing + bind-to-bone landed** (code; build
GREEN; verified headlessly). The headline non-negotiable feature, in its precise
(numeric) form. **Not gated on auto-weights** — manual weighting was always the
guaranteed path; auto-weights (§5.2, Spike 2 OPEN) is only a convenience on top.
- **Bind** — an unweighted mesh (e.g. a freshly-converted region-mesh, §3.4) gets a
  *Bind to slot bone (make weighted)* button: every vertex bound 100% to the slot's
  bone, reusing its existing bone-local `[x,y]` (exact, no move). This is the bridge
  from a static quad into a deformable weighted mesh.
- **Per-vertex weights** — selecting a vertex of a weighted mesh lists its bone
  influences with weight inputs (auto-normalised: editing one scales the others to
  fill 1−w), an `✕` to remove an influence (remaining renormalised), and a dropdown
  to add a bone (its bone-local pos = `bone.worldToLocal(P)`, weight 0). The packed
  `rawDoc` array is read/written via `rdVertexAt`/`rdSetVertexInfluences`; weight-only
  edits update the live runtime weights in place (no rebuild), add/remove/bind rebuild.
- **Key invariant (why it's safe):** in the setup pose every influence stores the
  *same* world point P in its bone's local space, so the vertex sits at P for **any**
  weights summing to 1 — weight edits change deformation behaviour, never the
  setup-pose position. Verified: `tools/rigger-spike/weights.mjs` — set a weight to
  0.7 → reload → weights sum to 1 and the vertex world pos is unchanged (0.0000);
  bind an unweighted mesh → reload → now weighted, all world positions unchanged.
  Full mesh suite re-run = no regression. Viewer `<script>` blocks pass `node --check`.
  ⏳ owner-verify the UI live (and that a re-weighted vertex deforms correctly under
  animation).

**The Rigger now covers the full headline feature set: bones + mesh topology +
weights (manual).** Next — **Phase 4.2:** a visual **weight brush** (paint weights
across vertices with falloff, colour-mapped per bone). And **auto-weights** (Spike 2)
remains the OPEN research item — needs a representative embedded-skeleton character
mesh + a better algorithm (geodesic/heat); manual weighting + the brush are the
guaranteed fallback meanwhile.
