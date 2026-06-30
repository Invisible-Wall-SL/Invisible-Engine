# Invisible Rigger — design + build plan

> An online **Spine skeleton editor** — view bones, pose/edit the rig, build and
> weight-paint meshes, and author animations — that reads and writes the **Spine
> 4.2 export format** so files round-trip with the official runtime, while keeping
> the desktop Spine Editor usable alongside it.
> Owner direction 2026-06-13. Related: `live-assets.md` (the deploy→bake→pull→register
> contract every new asset class must travel), `invisible-editor.md` (the
> sibling online editor whose `/spine` viewer + R2 spine plumbing this builds on).

## 0. Status

**BUILT — Phases 0–6 are on `main` and the tool is registered/deployed** (verified
2026-06-29; this §0 was previously a stale "not built" plan header). What shipped: bones,
mesh (move/add/remove/region→mesh/CDT/UV), weights (bind/per-vertex/brush/auto-weight-to-chain),
animation (keyframing, dopesheet, curves, graph editor, slot/event/draw-order channels),
rig + animation libraries, isolated-mesh edit, mesh-**deform** animation timelines (§18 item 1),
IK constraint authoring + the IK mix timeline (§18 item 3),
`.irig` export + R2 save. **Genuinely
outstanding:** ship-from-Rigger (rule-8 export→deploy→bake→pull→register — rigs only save to
R2 today), Phase 3.6 visual texture-panel UV editor +
hull editing, and the better auto-weights algorithm (a proximity chain-skinner shipped; the
quality gate against a real character mesh is still open). **The whole tool still needs
owner live-verify** (headless spikes use un-mangled spine-core, not the vendored minified
runtime). The detailed phase log below is append-only and lags — see `docs/STATUS.md`
"Current state — reconciled" for the authoritative summary.

(Historical plan note: nothing ships until it travels the full asset chain (§8); Phase 0
(§7) was the make-or-break gate — both spikes passed, see §10.)

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

**Phase 3.6 — global re-triangulation landed** (code; algorithm verified headlessly).
The `＋ Add vertex` split is good for local refinement, but the artist's mental model
(from Spine) is "drop interior *floating* points in the middle, then weave the mesh
through them." A `⟁ Re-triangulate` button now does exactly that. Rewrites `triangles`
only — `vertices`/`uvs`/weights are untouched, so existing weights survive; refreshes
the slot detail + heatmap after.
- **Dedup first:** two verts at the *same* position can't both sit in a non-degenerate
  triangulation, so they're collapsed (relative EPS — genuinely close-but-distinct
  points are kept) by removing the orphan from `uvs`/`vertices`/`hull`. (Without this
  the dropped twin looked "merged.")
- **Constrained Delaunay (CDT)**, NOT Delaunay + centroid-clip. The first attempt clipped
  triangles by centroid-in-polygon; on a concave shape (cactus armpits = reflex hull
  verts) that could clip away *every* triangle touching a reflex vert → it dropped/merged
  a HULL vertex. CDT instead: **ear-clip the hull polygon** (every hull vert referenced,
  boundary edges present by construction) → **insert interior points** by splitting the
  containing triangle → **Delaunay flip pass** that never flips a hull boundary edge.
  Cannot orphan a hull vert or jump a concavity.
- **Verified:** `tools/rigger-spike/retriangulate-cdt.mjs` (cactus body + 2 arms + reflex
  armpits, 0–20 interior pts): every vertex referenced, **all hull edges present**, exact
  cover (Σtri == polygon area), no degenerate slivers. Plus `retriangulate-degenerate.mjs`
  (dedup: exact/near-coincident/collinear/on-edge/cocircular) and the earlier
  `retriangulate.mjs`. Viewer `<script>` blocks pass `node --check`; build GREEN.

**Mesh topology editing is now add + move + remove + re-triangulate.**

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

**Phase 4.2 — visual weight brush landed** (code; build GREEN; dab math verified
headlessly). Paint weights instead of typing them.
- Toggle **🖊 Weight brush** on a weighted mesh → pick a target **bone**, **radius**
  (screen-px → world via zoom), **strength**, and a **subtract** (erase) toggle.
  Dragging on the mesh paints: every vertex within the brush radius gets its weight
  toward the target bone pushed up (linear falloff), adding the bone where missing
  (bone-local = `worldToLocal(P)`), then renormalising — same invariant as 4.1, so
  vertices never move.
- **Heatmap:** in brush mode the vertex handles are colour-mapped (blue→red) by their
  weight toward the target bone, so the weight map is visible while painting.
- Dabs are throttled (sample every ~0.4·radius of cursor travel) to bound the
  per-dab `rebuildFromRawDoc`.
- **Verified:** `tools/rigger-spike/brush.mjs` — apply a dab to the verts in a radius,
  reload: every painted vertex carries the target bone with weight > 0, each vertex's
  weights sum to 1, and no vertex moved. Full mesh+weights suite re-run = no
  regression. Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify the brush
  UI live (cursor/heatmap, paint feel, per-dab rebuild perf on large skeletons).

**Weight painting is complete: bind + manual per-vertex + visual brush.** The Rigger
now covers the full headline set — **bones + mesh (create/topology/UV) + weights**.
Remaining: **auto-weights** (Spike 2, OPEN — needs a representative character mesh +
a better algorithm; manual + brush are the guaranteed fallback), the **Phase 3.6**
visual texture-panel UV editor + hull editing, and **animation authoring (Phase 5)**.

## 16. Authoring from scratch (new-rig workflow) — owner priority 2026-06-13

Owner's top priority: **create a NEW rig — import images, create bones/skins — then
save + reopen.** Honest status when raised: the tool was a deep *editor of existing*
rigs; the from-scratch + image-import flow was mostly unbuilt. Owner decisions: image
source = **both** (place from existing project atlases *and* raw upload later); build
the authoring workflow next.

**Entanglement found:** a new rig needs an **atlas** to be indexed (`buildSkeletonsIndex`
skips atlas-less folders) and loaded (the viewer needs a `TextureAtlas`). So
"import images" is on the critical path for "new rig", not optional. Sequence:
**(A1) structural primitives → (A2) new-rig + attach images from an existing atlas
(end-to-end) → (A3) raw image upload (creates the atlas).**

**A1 — structural authoring primitives landed** (code; build GREEN; verified
headlessly). In edit mode the inspector sections gain **＋ Add bone** (child of the
selected bone/root), **＋ Add slot** (on the selected bone/root), **＋ Add skin** —
all `rawDoc` mutations + rebuild + auto-unique names; the new bone/slot is selected
and editable via the existing transform/drag/weight tools.
- **Verified:** `tools/rigger-spike/authoring.mjs` — from a MINIMAL blank skeleton
  (`root` + empty `default` skin), add bone→bone, slot, skin, serialize → the
  official loader accepts it with the right hierarchy (bone2.parent=bone1, slot on
  bone1, skins default+skin1). Viewer `<script>` blocks pass `node --check`.

**A2 — new-rig + attach-images-from-existing-atlas landed** (code; build GREEN;
parser + attach verified headlessly). The from-scratch loop now works via the
existing-atlas path:
- **`＋ New rig`** (sidebar) → name it + pick an existing project **atlas** → POSTs a
  blank skeleton (`root` + `default` skin) to `/api/rigger/save` saved **into that
  atlas's folder** (so it indexes + loads and that atlas's images are attachable) →
  opens in edit mode. `GET /api/rigger/atlases` lists the project's atlases + region
  names (`rigger`-gated; `atlasRegionNames` parses them — page lines are identified
  *structurally*, since region names can have extensions like `heart_shadow.png`).
- **Attach image** — a selected slot's detail shows an `image` picker of the loaded
  atlas's regions; choosing one creates a region attachment in the active skin
  (size from the atlas, position at the bone origin, then editable / convertible to
  a mesh). This is the "import image" action.
- **Verified:** `tools/rigger-spike/attach.mjs` — the parser matches the official
  `TextureAtlas` regions exactly (0 missing/extra) across 3 atlases; attaching a
  region to a slot on a blank skeleton → the loader resolves it to a
  `RegionAttachment`. Build GREEN; viewer `<script>` blocks pass `node --check`.
  ⏳ owner-verify the New-rig + attach UI live.

**The from-scratch authoring loop exists end-to-end** (new rig → bones/slots/skins →
attach images → save → reopen) using images already packed in the Atlas Maker.
**A2 FIX (2026-06-13) — the atlas list was empty.** First cut scanned `spines/` for
`.atlas` files and saved a new rig there; but the Atlas Maker writes **manifests**
(`<project>/manifests/atlas_manifest_*.json`, pages preferring `deploy/`) — a fresh
project has those but no spine bundles, so the picker showed nothing. Fixed:
- `/api/rigger/atlases` now lists the project's **manifests** via the editor's
  `loadRegionSet` (handles Invisible + TexturePacker shapes), returning each usable
  atlas's `manifestKey` + region names.
- **`POST /api/rigger/new`** assembles a self-contained spine bundle: synthesise a
  Spine `.atlas` from the manifest's regions (`regionsToSpineAtlas` in `spine.ts`,
  byte-format-compatible with the Atlas Maker's own `atlas_format.write_atlas` —
  `bounds:`/`offsets:`/`rotate:90`), copy the packed page image, write a blank
  `.irig`, all into `spines/<name>/`, then reindex. So a new rig is a normal spine
  bundle that indexes + loads + has its images attachable. Works **post-compose** (no
  deploy needed — `loadRegionSet` resolves the page from `deploy/` or the source).
- **Verified:** `tools/rigger-spike/synth.mjs` — real atlas → regions → synthesise →
  re-parse with the official `TextureAtlas`: region count + on-page rects + original
  sizes round-trip with **0 mismatch incl. rotated regions** (15/10/8 rotated across
  symbols/anticipation/transition). Build GREEN; viewer `node --check` OK. ⏳
  owner-verify live (the `test1` project's atlas should now appear; New rig → it
  loads with that atlas's images).

**A-canvas (2026-06-13, owner ask) — direct canvas manipulation + draw-a-mesh.**
- **Click a bone on the canvas to select + move it** (was inspector-tree-only):
  `nearestBone(e)` hit-tests the setup-pose bone segment/origin (screen-scaled
  threshold) → selects + starts the drag. Mesh-vertex select+move on canvas already
  worked once a mesh slot is active; mousedown priority is now draw-point → mesh
  vertex (if hit) → bone (if hit) → pan, so a missed mesh-vertex click falls through
  to bone-pick instead of dead-ending.
- **Create a mesh from scratch by drawing its outline:** on a slot with a region
  attachment, **✎ Draw mesh** → click boundary points on the canvas (drawn as a live
  polygon) → **Finish**. Each point becomes a bone-local vertex; its **UV** comes from
  the **affine inverse of the region quad** (`affineUV` — exact for any
  rotation/scale/shear since a region placement is affine); the polygon is
  **ear-clipped** to triangles; the region is replaced by the mesh (then editable via
  the 3.x tools).
- **Verified:** `tools/rigger-spike/drawmesh.mjs` — affine UVs hit the exact corner
  UVs ((0,0)/(1,0)/(0,1)) + centre (0.5,0.5); a mesh built from drawn points loads as
  a `MeshAttachment` whose vertices land exactly where placed (0.0000 off) and
  triangulates. Full mesh+weights+authoring suite (8 tests) re-run = no regression.
  Viewer `<script>` blocks pass `node --check`. ⏳ owner-verify the canvas UI live.

**A-usability (2026-06-13, owner ask) — rename + collapse.**
- **Collapsible bone tree:** each bone with children gets a ▸/▾ toggle (`collapsedBones`
  Set, persists across rebuilds, cleared on skeleton load); collapsed bones hide their
  subtree. (The inspector *sections* — Slots/Skins/Animations/Constraints — were
  already `<details>`.)
- **Rename bones / slots / skins:** name fields in the bone + slot detail panels and a
  ✎ on each skin row. Each rename **rewrites every reference** so the skeleton stays
  valid — bone: child `parent`, slot `bone`, IK/transform/path constraint `bones`/
  `target`/`bone`, animation `bones` keys; slot: skin attachment keys, animation
  `slots`/`deform`/`drawOrder`; skin: linked-mesh `skin` refs — then rebuild.
- **Verified:** `tools/rigger-spike/rename.mjs` — rename a bone (with children) + a
  slot, reload through the official loader: it accepts (no dangling refs), new names
  present / old gone, the child's `parent` + the renamed slot updated (anticipation,
  transition, symbols). Full suite (9 tests) no regression; viewer `node --check` OK.
- **Fix (owner-reported):** selecting a bone/slot only worked when you clicked the
  small NAME span — the rest of the row (tag, ↑/↓ area) did nothing, so the detail
  kept showing the last-selected item. Now the WHOLE row selects (`row.onclick`); the
  ↑/↓ buttons + collapse toggle + skin ✎ `stopPropagation` so they don't double-fire.

### A-delete — delete bones / slots / images / skins (owner: "delete any item?")

Authoring was add+rename only; this adds removal with full reference cleanup so the
skeleton stays valid (no dangling refs through the official loader).
- **Delete bone** (`deleteBone`, "🗑 Delete bone" in the bone editor, disabled for
  root): children + slots reparent to the bone's parent; ik/transform/path constraints
  that reference it are cleaned (name pulled from `bones[]`) or dropped (lost their
  target/`bone`/all bones); its animation track is removed. CRITICAL: weighted-mesh
  vertices reference bones by INDEX, so removing one shifts every higher index — we
  remap each influence BY NAME (`oldNames[idx]` → new index), drop the deleted bone's
  influences, and **renormalise only the vertices that actually lost an influence** so
  untouched vertices stay bit-identical (source weights aren't always exactly 1).
- **Delete slot** (`deleteSlot`, "🗑 Delete slot"): removes the slot + its attachments
  in every skin + animation slot/deform/drawOrder-offset refs.
- **Delete image** (`deleteAttachment`, "✕" by the image picker): removes the
  attachment from every skin and clears the slot's setup attachment if it pointed there.
- **Delete skin** (`deleteSkin`, "🗑" on the skin row): removes a skin; the last
  remaining skin can't be deleted.
- **Verified:** `tools/rigger-spike/delete.mjs` on h1 / anticipation / loader / W —
  delete a leaf bone referenced by a weighted mesh, reload: loader accepts, bone gone,
  all weighted indices in range, every vertex keeps ≥1 influence summing to 1, and
  vertices NOT influenced by the bone are UNCHANGED (0 moved, 0.00000 — caught + fixed
  an over-renormalisation that nudged untouched verts ~0.009px). Slot delete clean.
  Build GREEN; viewer `node --check` OK; full suite no regression. UI not browser-
  verified (authed) — owner-verify live.

### A-delete-rig — delete a whole rig from the list (owner: 2 same-name rigs, can't delete)

Owner created two rigs that differed only by case (`Test1/` vs `test1/` — R2 keys are
case-sensitive, so `/api/rigger/new`'s `objectExists` guard saw them as distinct) and
had no way to remove either. Added per-row delete:
- `🗑` on each skeleton-list row → `deleteRig` → `POST /api/rigger/delete
  { dir, skeleton_file }` (`rigger`-gated, path-guarded). Deletes ONLY that skeleton
  file, then — if `dir` is a named bundle sub-dir (never the spines root) and NO
  skeleton (`.irig`/`.skel`/`.json`) remains in it — purges the now-orphaned support
  files (`.atlas`, page images) in that exact dir. So a from-scratch rig folder is fully
  removed, but an artist's source `.json` (or a second rig sharing the dir) is never
  touched. Reindexes `skeletons.json`. Deleting the on-stage rig reloads the page (query
  params persist) to clear the canvas.
- **Verified:** the purge-decision predicate on 6 scenarios (from-scratch / edited-with-
  source / shared-dir / TexturePacker-json / spines-root / empty) — purges ONLY when no
  skeleton/source remains. Build GREEN; viewer `node --check` OK. (R2 I/O itself, like
  save/new/upload, is owner-verified live.)

### A-delete follow-ups — case-insensitive name guard + skin discoverability

- **Case-insensitive new-rig guard** (`spineBundleNameTaken` in `spineIndex.ts`, used by
  `/api/rigger/new` + `/api/rigger/upload`): R2 keys are case-sensitive, so the old
  `objectExists` check let `Test1` and `test1` coexist as separate bundles (how the dupes
  happened). Now New-rig / upload 409 if a bundle dir matches the name case-insensitively.
  Verified the prefix-segment match logic on 6 cases.
- **Skin discoverability:** the active skin is what shows a skin's images/meshes/weights,
  but the only control was the easy-to-miss top-bar `Skin` dropdown. The inspector SKINS
  rows are now CLICKABLE (`setActiveSkin`) with the active skin highlighted + an "active"
  badge + a hint line; the top-bar dropdown routes through the same `setActiveSkin`, which
  syncs both, re-renders the rows, and refreshes the open slot's mesh/weight UI under the
  newly-active skin. (Model reminder: bones drive SLOTS, not skins; a skin is a per-slot
  set of attachments — switch the active skin to inspect/paint that skin's meshes.)
  Build GREEN; viewer `node --check` OK. UI owner-verify live.

**A3 — raw image upload landed** (2026-06-13, owner ask "insert images"; code; build
GREEN; packer + synth verified headlessly). Start a rig from **brand-new art** with no
Atlas Maker step. In the New-rig panel, **or upload images** (file input, multi):
- The **browser** loads the images, **shelf-packs** them onto one page (tallest-first,
  wrap at 2048px, 2px pad), draws them to a `<canvas>`, and reads the region rects;
  region names come from the filenames (deduped).
- It POSTs the page PNG (data URL) + `{pageWidth,pageHeight,regions:[{name,x,y,w,h}]}`
  to **`POST /api/rigger/upload`** (`rigger`-gated), which decodes the PNG, writes it +
  a synthesised `.atlas` (`regionsToSpineAtlas`) + a blank `.irig` into
  `spines/<name>/`, then reindexes. The new rig opens in edit mode; its uploaded
  images are immediately attachable.
- **Verified:** `tools/rigger-spike/upload.mjs` — the packer yields non-overlapping
  rects within the page; the packed regions → synth `.atlas` → official `TextureAtlas`
  re-parse with the region count + every rect round-tripping. Build GREEN; viewer
  `node --check` OK; full 11-test suite no regression. ⏳ owner-verify the upload UI
  live.

**Image sourcing is now complete (the owner's "both"): attach from an existing atlas
(A2) AND raw upload (A3).** The from-scratch authoring loop is end-to-end from either
source: new rig → bones/slots/skins → attach/draw meshes → weights → save → reopen.

Remaining (lower priority / larger): the **Phase 3.6** visual texture-panel UV editor
+ hull editing; **auto-weights** (Spike 2 — needs a character mesh + better algorithm;
manual + brush are the fallback).

## 17. Phase 5 — animation authoring (owner priority 2026-06-14)

Owner direction: add the animation layer — animate with bones, support many animations
per file (Spine allows this), and split the anim vs edit workflows clearly in the UI.

**Mode model (the UI split).** One `Preview | Setup | Animate` segmented toggle replaces
the ✎ Edit button. `editMode` stays the "setup" flag (every rig-editing guard keeps
working); `animMode` is new. mode = "preview" | "setup" | "animate":
- **Preview** — full `AnimationState` playback (honours bezier curves + mixing), read-only.
- **Setup** — edit the rest pose (bones/meshes/weights/attachments) = the old edit mode.
- **Animate** — author ONE animation at a playhead, posed over the setup pose.

**Keyframe data model (verified `tools/rigger-spike/anim.mjs`).** Bone timelines:
`rotate.value` + `translate.x/y` are OFFSETS from the setup pose; `scale.x/y` are
MULTIPLIERS of setup (1 = setup). Confirmed against spine-core: authored keys load and
play exactly as our own linear interpolation predicts (midpoint + endpoints). Animations
live in the skeleton JSON, so the existing 💾 Save (`.irig`) persists them for free; the
format natively holds many animations, so multi-anim is CRUD on `rawDoc.animations`.

**5.0 + 5.1 LANDED (2026-06-14, `09da996`):**
- Mode toggle + per-mode inspector/bottom-bar behaviour. Frame loop: animate mode does
  `setToSetupPose()` then `poseAtTime(curAnim, animTime)` (our linear interp) each frame;
  an in-progress bone drag overrides the posed value so it tracks the cursor.
- Animation CRUD in the Animations section: ＋ New / ✎ rename / ⧉ duplicate / 🗑 delete.
- Bone keyframing: the bone detail in animate mode shows the POSE at the playhead (the
  animated local values); editing a field keys that channel. Canvas drag poses a bone
  (keys translate on release). ◆ Key (bar + panel) keys rotate+translate+scale; |◀ / ▶|
  prev/next key; ✕ Key deletes the key at the playhead. `animDuration` is derived from
  the max key time; the scrub bar is the playhead.
- Sync: entering Preview rebuilds the runtime from `rawDoc` (if anims edited) so playback
  reflects authored keys + honours curves; `animsDirty` gates that rebuild.

**5.2 LANDED (2026-06-14, `320ad02`) — dopesheet timeline** docked below the stage in
Animate mode: a time ruler (auto-stepped ticks), one row per keyed bone (+ the selected
bone) with diamond key dots, a draggable red playhead (click/drag ruler or track to
scrub; tracks playback each frame). Drag a key dot to RETIME it — `retimeBoneKey` moves
all of that bone's channel keys at that time together, drops a clashing key, re-sorts,
and can extend past the old end (duration grows). Double-click a dot deletes the key;
click a gutter/dot selects the bone. A dopesheet key = one time on a bone row (union of
its rotate/translate/scale keys). `retimeBoneKey` verified headlessly.

**5.3 LANDED (2026-06-14, `db198b0`) — keyframe curves.** Animate mode honours per-key
interpolation: `sampleChannel` reads the FROM key's `curve` (linear default / "stepped" /
bezier array; `bezierValue` solves the cubic X(s)=t → Y(s)), so the preview now matches
the runtime for curved keys (incl. existing imported anims). The bone-animate panel shows
easing buttons (Linear / Stepped / Ease In / Out / In-Out) for the key under the playhead —
they set the OUTGOING interpolation across all the bone's channels; bezier presets bake
ABSOLUTE control points from the segment (the last key stays linear). Dopesheet: stepped
keys = upright squares, eased = teal. Verified vs spine-core (`tools/rigger-spike/curve.mjs`).
Known limit (noted in-UI): a baked bezier uses absolute coords → re-apply easing after a
large retime/re-pose. A draggable bezier graph editor can refine presets later.

**5.4 LANDED (2026-06-14, `05bb7f4`) — slot animation (attachment swap + colour).** First
half of the non-bone channels: `poseAtTime` also applies slot timelines — attachment swap
(stepped, which image/mesh shows) + rgba colour (curve-aware fade via `sampleColor`). The
Animate-mode slot panel keys the attachment ("shows" dropdown) + colour (swatch + alpha)
at the playhead. The dopesheet generalised bone-only → TRACKS (bones + slots) with a kind
tag (⦿/▤) and amber slot dots; retime/delete/seek/selection dispatch on kind. Verified vs
spine-core (`tools/rigger-spike/slotanim.mjs`): `slots[slot].attachment=[{time,name}]`
(stepped), `slots[slot].rgba=[{time,color:"rrggbbaa",curve?}]`.

**5.4a (2026-06-18) — dedicated opacity control + slot-colour easing.** The slot Animate
panel split the old combined colour-swatch+alpha row into a **colour** row (RGB tint only,
preserving the current alpha) and a dedicated **opacity** row (0–100% slider + **◆ Key
opacity @ t** button). Each commits through `keySlotColor` by re-reading the other channel
from `slotColorAt` at the playhead, so retinting never drops opacity and vice-versa — still
one `rgba` timeline (no conflicting standalone `alpha` channel, stays byte-valid Spine 4.2).
Added per-key **easing** for the rgba/opacity key (`setSlotColorCurve` / `slotColorCurveType`,
mirroring the bone `setKeyCurve`: linear drops the curve, stepped, or a per-channel bezier
array baked from the segment). Verified headless: an Ease-In-Out 100→0% fade samples
1.000 / 0.500 / 0.000 at t=0/0.5/1, monotonic, slow at both ends, 16-float curve;
`stepped` holds the value through the segment.

**Graph (curve) editor — Phase 5.3b, iteration 1 LANDED (`ece46c7`):** a separate view
from the dopesheet (Dopesheet ⇄ Graph switch in the timeline legend; dopesheet code
untouched). `renderGraphBody` plots the selected bone's channels (rotation/x/y/scaleX/
scaleY) as SVG value-over-time curves sampled via `sampleChannel` (linear/stepped/bezier
render true), auto-fit value axis, draggable keyframe handles (X = retime, Y = revalue;
range frozen mid-drag, channel re-sorts live), channel show/hide toggles, click-to-seek.
**Iter 2 LANDED (`e25d210`):** draggable bezier TANGENT handles — eased segments draw
their two control points as square handles (dashed leaders to the anchor key); dragging
clamps X within the segment and writes `curve[vi*4 + ctrl*2..]` per value index. Set a
key's easing in the Properties panel, then fine-tune the handle in the graph.
**Iter 3 LANDED (`88944f2`):** multi-select (shift-click + marquee box on empty graph;
selected points = white fill + colour ring), move-selection-together (absolute-from-
snapshot delta so a key backing multiple field-curves isn't double-moved), and a
right-click easing menu (Linear/Stepped/Ease In/Out/In-Out → setKeyCurve). Plain click
seeks + clears; selection clears on bone/anim change (per-bone). The graph editor now has
the classic curve-editor set: value curves · draggable keys · bezier handles · multi-
select · marquee · easing menu.
**Iter 4 LANDED (`0810678`):** box-select scaling (≥2 keys → dashed bbox with 8
edge/corner handles; L/R edges stretch timing, T/B edges scale values = the value-scale
handle, corners both, scaling around the opposite edge) + snapping (⇥ toggle, on by
default; key/box-edge times snap to playhead/grid/nearby keys via `graphSnapTime`). Also
a **loading overlay** (`36cbbe7`) blocks input during new-rig / image-upload / skeleton
load.

**Dopesheet key easing LANDED (2026-06-29) — change curve interpolation IN the dopesheet.**
Owner gap: easing was only settable from the bone Properties panel (the playhead key) or
the graph editor's right-click, so in the **dopesheet** there was no way to change a key's
interpolation. Now **right-clicking a dopesheet key** opens the SAME easing menu
(Linear / Stepped / Ease In / Out / In-Out), dispatched by track kind — bone keys →
`setKeyCurve` (all channels, matching the panel/graph), slot **colour** (`rgba`) keys →
`setSlotColorCurve`; stepped-by-nature tracks (events / draw-order / attachment swaps) get
no menu (`trackKeyEasable`). The graph + dopesheet now share ONE `openCurveMenu(x,y,apply,
current)` (the active preset shows a ✓), and the dot tooltip advertises "right-click:
easing". The dopesheet dot's `onmousedown` now ignores button 2 so the context menu fires
instead of starting a drag. Reuses the existing verified `setKeyCurve`/`setSlotColorCurve`
(`curve.mjs`/`slotanim.mjs`) — no model change. Inline JS syntax-checked + `launcher-api`
build GREEN; ⏳ owner live-verify the right-click interaction in `/rigger`.

## 18. Spine 4.2 parity — audit + build plan (2026-06-29)

Owner direction: close the feature gap toward Spine 4.2 ("do them all"). Two audits were
run — Spine 4.2's real feature set (grounded in the official `spine-runtimes` 4.2
`SkeletonJson.ts` loader, NOT the stale 3.8-era JSON-format prose page) and the Rigger's
actual code coverage (`view.html` + `tools/rigger-spike`). Result below. **Watch the 4.2
data model:** separated `translatex/y`·`scalex/y`·`shearx/y`, slot colour is
`rgba/rgb/alpha/rgba2/rgb2` (not 3.8 `color/twoColor`), `drawOrder` is camelCase, and
physics + sequences are new.

### Coverage today (have)
Bones (transform/drag/reparent/draw-order/add/delete/rename); mesh create + topology +
UV + retriangulate; weights (bind/per-vertex/brush/auto-to-chain); animation: bone
rotate/translate/scale + slot attachment/rgba/alpha + events + draw-order, with a real
bezier **graph/curve editor**, multi-select, marquee, copy-via-Alt-drag; skins
(add/rename/delete/switch + per-skin attachments); `.irig` 4.2 round-trip.

### Gaps (prioritized build order)
1. **Mesh deform timelines** — ✅ **LANDED** (`rigger/mesh-deform-timelines`). Authorable now:
   in **animate mode**, dragging a mesh vertex writes/updates a **deform key at the playhead**
   (a delta from setup) instead of editing the setup mesh; `poseAtTime` applies the deform
   timeline (curve-aware: linear / stepped / bezier) to the live `MeshAttachment` for preview,
   and a **`deform` dopesheet track** shows the keys (retime / Alt-drag duplicate / dbl-click
   delete / right-click easing — a deform key carries ONE curve so it is easable). Setup-mode
   mesh editing is unchanged; a deform-less mesh/anim is byte-identical to before (no track,
   no per-frame writes). **Format crux corrected vs this audit's guess** — deform is NOT a
   top-level `deform.<skin>…` block; the 4.2 loader reads it under the per-attachment map:
   `animations.<a>.attachments.<skin>.<slot>.<att>.deform = [{time, offset?, vertices:[…delta],
   curve?}]`, pure per-component deltas (offset 0 + full length in v1). **Array length +
   coordinate space (validated headless against spine-core@4.2.74 in `tools/rigger-spike/
   deform.mjs`, both mesh types):**
   - **unweighted:** length = `2*vertexCount`, interleaved `[dx,dy]` per vertex in mesh
     (slot-bone) **local** space; the loader pre-adds setup at parse → runtime holds setup+delta.
   - **weighted:** length = `2*totalInfluences` (NOT `2*vertexCount` — e.g. anticipation
     `payframe` = 384 for 40 verts/192 influences), `[dx,dy]` per **influence** in
     influence-walk order, each in that influence's **bone-local** space (added before the
     weighted blend); pure deltas (loader does not pre-add setup).
   Spike GREEN: a known world delta moves exactly the target vertex by that delta with all
   others unchanged, on both meshes; linear midpoint == runtime sampling; bezier ease-in is
   sub-linear and matches our evaluator. Graph editor ignores deform (too many verts) — dopesheet
   only, per plan. ⏳ owner-verify the drag-to-deform + dopesheet UI live.
2. **Bone shear keying** — PRESERVE-ONLY (data model + tracks already handle shear; `keyBone`
   just has no shear branch). Cheap completeness win.
3. **IK constraint authoring** (create/edit/delete + target + mix/softness/bend) **+ the IK
   `ik` mix timeline** — ✅ **LANDED** (`rigger/ik-constraints`). The constraints panel was
   display-only; IK rows are now clickable → an **IK editor** (target `<select>`, mix 0–1,
   softness, bend+/compress/stretch toggles, chain-bones display, rename, delete). **＋ Add IK
   constraint** creates a 2-bone chain on the selected bone (its parent + itself; falls back to
   a 1-bone chain when the bone has no parent) reaching a target bone, defaults
   mix=1/bendPositive=true/softness=0. Every edit mutates `rawDoc.ik[i]` + `rebuildFromRawDoc`.
   transform/path stay display-only (items 6/7). Bone rename/delete already rewrote/dropped
   `ik` bone+target refs; delete now ALSO clears a dropped constraint's `ik` timeline (else the
   loader throws "IK Constraint not found"); constraint rename rekeys its `ik` timeline.
   **Animation:** an **`ik` dopesheet track** per constraint with keys (+ the selected one as an
   empty row to key into); **◆ Key IK mix @ t** (and `keyIk(name)`) upserts the live mix into
   `animations.<a>.ik.<name>`; retime / Alt-drag duplicate / dbl-click delete / right-click
   easing (one curve → the mix channel) via the shared `openCurveMenu`. `poseAtTime` sets the
   live `IkConstraint.mix` (+ softness/bend if keyed) before `updateWorld`, so animate-mode
   preview shows the runtime IK solve; Preview mode (AnimationState) already solves it.
   **Format crux (validated headless vs spine-core@4.2.74 in `tools/rigger-spike/ik.mjs`):**
   - **Setup** = top-level `ik` array: `{name, order, bones:[parent,child]|[bone], target, mix,
     bendPositive, softness, compress, stretch}`. `bendPositive` serialises as a **BOOLEAN**
     (runtime → `bendDirection` ±1), NOT `bendDirection`. `order` defaults 0; 1-bone vs 2-bone
     is purely `bones.length`.
   - **Timeline** = `animations.<a>.ik.<name> = [{time, mix, softness, bendPositive, compress,
     stretch, curve?}]` (an `IkConstraintTimeline`); mix + softness interpolate (linear/bezier),
     bend/compress/stretch are stepped; `curve` (read off the current key) drives two bezier
     channels (0=mix, 1=softness) — we author one ease for the mix channel.
   Spike GREEN (18/18): loader builds the IkConstraint; **mix=1 SOLVES** toward the target (chain
   tip reaches it), **mix=0 == setup/FK**, a mix-0→1 timeline blends FK→IK, linear mix@0.5==0.5
   and a bezier ease-in mix-value@0.5 (0.318) matches our evaluator (0.315); 1-bone loads;
   `bendPositive:false`→−1. **Parity:** no IK authored ⇒ no `ik` array / no `ik` track / no
   behaviour change (SkeletonJson does not write back, so a no-IK doc round-trips unchanged).
   Existing PRESERVE-ONLY IK constraints round-trip (whole `rawDoc` is saved verbatim) and are
   now editable. **`◆ Key all` intentionally does NOT key IK mix** (mix is a constraint reveal,
   not a per-bone pose — keying it everywhere would fight the FK→IK intent); key it explicitly
   via the IK editor. The auto-picked default target excludes descendants of the chain bones (a
   descendant target moves with the chain → degenerate solve). Makes the panel editable =
   foundation for 4/6/7. ⏳ owner-verify the add/edit + IK dopesheet + solve preview live.
4. **Slot dark colour (`rgba2`)** setup + timeline — extends the slot-colour path. **LANDED**
   (see the §18.4 note below).
5. **Blend-mode authoring** (slot `blend` dropdown) — setup-only. **LANDED** (see the §18.5 note
   below).
6. **Transform constraint** authoring + `transform` mix timeline — ✅ **LANDED**
   (`rigger/transform-constraints`). Mirrors the IK path (3): the constraints panel's transform
   rows are now clickable → a **transform editor** (target `<select>`, the six mix sliders
   rotate/X/Y/scaleX/scaleY/shearY, the six offsets rotation/X/Y/scaleX/scaleY/shearY, relative +
   local toggles, rename, delete). **＋ Add transform constraint** creates one on the selected
   bone (full mixes, zero offsets) following an auto-picked target (excludes the bone + its
   descendants → no circular/degenerate follow). Every edit mutates `rawDoc.transform[i]` +
   `rebuildFromRawDoc`; `editTc` only writes the touched field (offsets that go to 0 are dropped)
   so an untouched preserve-only constraint is never corrupted. The IK + transform editors share
   one `#consDetail` box via `renderConstraintEditor` (selecting one kind clears the other); the
   bone rename/delete constraint-ref cleanup already walked `["ik","transform","path"]`, so
   transform refs (bones/target) were already rewritten/dropped — delete also clears a dropped
   constraint's `transform` timeline, rename rekeys it. path stays display-only (item 7).
   **Animation:** a **`transform` dopesheet track** per constraint with keys (+ the selected one
   as an empty row); **◆ Key transform mix @ t** (`keyTransform(name)`) upserts the six live mixes
   into `animations.<a>.transform.<name>`; retime / Alt-drag duplicate / dbl-click delete /
   right-click easing via the shared dispatch (extends the same fns the `ik` kind uses — a
   transform key carries ONE shared curve so it is easable). `poseAtTime` sets the live
   `TransformConstraint`'s six mix fields before `updateWorld`, so animate-mode preview reflects
   the constraint solve; Preview mode (AnimationState) already solves it.
   **Format crux (validated headless vs spine-core@4.2.74 in `tools/rigger-spike/transform.mjs`,
   18/18):**
   - **Setup** = top-level `transform` array: `{name, order, bones:[…constrained], target,
     mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, rotation, x, y, scaleX, scaleY,
     shearY, relative, local}`. **All six MIXES default to 1**; absent `mixY` falls back to `mixX`
     and absent `mixScaleY` to `mixScaleX` (loader fallbacks — the editor displays those resolved
     defaults so the baseline never drifts). The **offset JSON keys are the SHORT names**
     (`rotation/x/y/scaleX/scaleY/shearY`, all default 0) — the runtime stores them as
     `data.offset{Rotation,X,Y,ScaleX,ScaleY,ShearY}`. `order` defaults 0; `relative`/`local`/
     `skin` default false. Verified against real cluster rigs (`loader.json`, `mm_bg.json`) which
     use exactly these keys with partial mixes.
   - **Timeline** = `animations.<a>.transform.<name> = [{time, mixRotate, mixX, mixY, mixScaleX,
     mixScaleY, mixShearY, curve?}]` (a `TransformConstraintTimeline`); all six mixes interpolate
     (linear/bezier), there are NO stepped-only fields. **CRUX:** the shared `curve` drives SIX
     bezier channels in order **0=mixRotate 1=mixX 2=mixY 3=mixScaleX 4=mixScaleY 5=mixShearY**;
     `readCurve` indexes `curve[channel<<2]`, so a single `[cx1,cy1,cx2,cy2]` is NOT enough
     (channels 1-5 read undefined → NaN). One shared ease must be BAKED across all six channels
     (24 numbers, per-channel value handles in absolute value-space — same pattern as rgba/rgba2).
   Spike GREEN (18/18): loader builds the TransformConstraintData with all-mixes-default-1;
   **mixRotate=1 FOLLOWS** the target's world rotation, a rotation offset shifts it by exactly that
   offset, **all-mixes=0 == setup/FK**, mixRotate=0.5 blends; a mix-0→1 timeline samples linear
   mixRotate@0.5==0.5 and a baked bezier ease-in mix VALUE@0.5 (0.318) matches our evaluator
   (0.315) across mixRotate AND mixScaleX (shared curve). **Parity:** no transform authored ⇒ no
   `transform` array / no `transform` track / no per-frame writes (SkeletonJson does not write
   back). Build GREEN (`pnpm --filter launcher-api build`); inline `<script>` passes a
   `new Function` syntax check. ⏳ owner-verify the add/edit + transform dopesheet + solve preview
   live (the vendored runtime is minified; the spike uses un-mangled core). Builds on (3) =
   foundation extended toward (7/8).
7. **Path attachment + path constraint** authoring + `path` timeline — needs the path
   attachment type first; bigger.
8. **Physics constraint** authoring + `physics` timeline (NEW in 4.2: inertia/strength/
   damping/mass/wind/gravity/mix/reset) — most complex; after IK/transform.
9. **Attachments:** clipping (mask), bounding-box, point (locator — cheap + useful for FX),
   linked-mesh authoring (PRESERVE-ONLY today).
10. Lower priority: separated translatex/y·scalex/y·shearx/y channels, sequence attachment +
    `sequence` timeline, skin placeholders, mixing/mix-times, `inherit` timeline.

Each item travels the rule-8 chain only when a rig is placed/shipped; the deform/constraint
data lives in the `.irig`, so the existing save/round-trip already carries it. Every feature
gets a headless `tools/rigger-spike/*.mjs` verified against the official 4.2 loader before
the UI is trusted (browser interaction stays ⏳ owner-verify — the vendored runtime is
minified, the spikes use un-mangled spine-core).

**Event channel LANDED (`286da28`):** always-on "⚡ events" dopesheet track + ＋ to name/
add an event at the playhead (auto-defines `rawDoc.events[name]`); purple keys, retime/
delete like others. Format `events:{name:{int,float,string}}` + `animations[a].events=
[{time,name}]`, saved in the .irig; verified firing vs spine-core (`eventanim.mjs`).
**Draw-order channel LANDED (`b04b9be`):** "▦ draw order" dopesheet track (cyan) + ✎ opens
a reorder popover (slots in order-at-playhead, ↑/↓, reset, Key @ t). `keyDrawOrder`
generates minimal Spine `offsets` (newDrawPos−setupIndex, moved-only); `poseAtTime`
reconstructs via `reconstructDrawOrder` (mirrors SkeletonJson) for live preview. Offsets
format verified vs spine-core (`draworder.mjs`, 5 random 68-slot perms exact).
**§18.4 Slot dark colour (`rgba2`, two-color tinting / "tint black") LANDED.** Validated format
(spike `tools/rigger-spike/darkcolor.mjs`, 18/18 vs spine-core@4.2.74's `SkeletonJson` +
`RGBA2Timeline` + `Color.setFromString`):
- **Setup:** per-slot `rawDoc.slots[i].dark = "rrggbb"` — RGB-only (6 hex, NO alpha; the loader's
  `Color.fromString` sets a=1 for non-8-hex and the runtime never animates dark alpha). The
  loader does `SlotData.darkColor = Color.fromString(dark)`. A slot has two-color tinting **iff**
  `dark` is present (`SlotData.darkColor` non-null); with no `dark` it stays null.
- **Timeline:** `animations.<a>.slots.<slot>.rgba2 = [{time, light:"rrggbbaa", dark:"rrggbb",
  curve?}]` → `RGBA2Timeline`. On apply it sets `slot.color` from `light` (r,g,b,a) AND
  `slot.darkColor` from `dark` (r,g,b; dark alpha untouched). A single shared key `curve` drives
  SEVEN bezier channels (0=R 1=G 2=B 3=A 4=R2 5=G2 6=B2); bezier handle y-values are ABSOLUTE
  value-space (not normalized). Linear + bezier both verified against the runtime's own sampling.
  A slot WITHOUT a setup `dark` can't safely use rgba2 (its live `Slot.darkColor` is null →
  applying rgba2 throws) — hence the rule below.
- **rgba↔rgba2 reconciliation:** a slot with `dark` keys/reads colour through **`rgba2`** (light
  carried from the existing colour/opacity controls + the dark); a slot without `dark` stays on
  the plain **`rgba`** timeline exactly as before. `slotIsTwoColor()` is the single gate;
  `slotColorAt`/`setSlotColorCurve`/`poseAtTime`/dopesheet all branch on it. `poseAtTime` sets
  `slot.darkColor` from the sampled dark for the live preview.
- **Setup UI** (`renderSlotDetail`): a "dark colour (two-tone tint)" swatch + ＋Enable / ✕Remove
  (writes/removes `slots[i].dark`, `rebuildFromRawDoc`). **Animate UI** (`renderSlotAnimDetail`):
  a "dark" swatch + "◆ Key dark colour @ t" shown only for two-color slots; the dopesheet shows
  a `slotch` `rgba2` channel ("colour (2-tone)") with retime/delete/easing via the shared
  dispatch (rgba2 keys are easable, single shared curve).
- **Parity:** a slot with no `dark` is byte-identical to before — still `rgba`, no `rgba2`
  anywhere; existing rgba colour/opacity animation untouched. Build GREEN
  (`pnpm --filter launcher-api build`). ⏳ owner-verify the in-browser two-color RENDER (the
  vendored runtime is minified; the spike uses un-mangled core).

**§18.5 Slot blend mode (setup `blend`) LANDED.** Validated format (spike
`tools/rigger-spike/blendmode.mjs`, 7/7 vs spine-core@4.2.74's `SkeletonJson` + `BlendMode` enum +
`Utils.enumValue`):
- **Setup-only:** Spine slot blend mode is a SETUP property (`SlotData.blendMode`) — there is **NO
  blend timeline** (it is not animated). So no dopesheet/channel changes.
- **Format:** per-slot `rawDoc.slots[i].blend = "additive"|"multiply"|"screen"` (a lowercase
  string). The loader does `data.blendMode = Utils.enumValue(BlendMode, getValue(slotMap, "blend",
  "normal"))`; `enumValue` capitalises the first letter and looks it up in the enum
  `{Normal:0, Additive:1, Multiply:2, Screen:3}`. Absent `blend` defaults to `"normal"` → Normal.
- **Setup UI** (`renderSlotDetail`): a "blend mode" `<select>` (Normal / Additive / Multiply /
  Screen) placed below the dark-colour controls. Selecting Normal **removes** `slots[i].blend`
  (Normal is the default — keeps parity); any other value writes the lowercase token. Either way it
  `rebuildFromRawDoc`s so the spine-webgl preview re-renders with the blend mode.
- **Parity:** a slot with no `blend` (or Normal) is byte-identical to before — no `blend` field
  written, existing slots untouched. Build GREEN (`pnpm --filter launcher-api build`); inline
  `<script>` passes a `new Function` syntax check. ⏳ owner-verify the in-browser blend RENDER (the
  vendored runtime is minified; the spike uses un-mangled core).

**Non-bone channels done: attachment · colour · dark colour (2-tone) · events · draw order · mesh deform.** The
free-form mesh-deform timeline (the largest non-bone channel, §18 item 1) LANDED — see the
item-1 note above for the validated format. Ship-from-Rigger (export rig →
`deploy/` as `.json` + register) is the separate open gap. The mode switcher is a floating top-centre pill (`#modeBar`); Setup/Animate
disable until an editable rig loads. Animation settings (working length / stretch / speed)
landed alongside 5.3 (`83073da`). UI is owner-verified live.

**Animate-mode UX pass (2026-06-14, owner live-testing):**
- Timeline ZOOM (px/sec, － / ＋ / ⊡ fit + Ctrl/⌘-wheel, horizontal scroll, sticky name
  gutter), grab-to-SCRUB the playhead, numeric TIME + SPEED inputs in the bar, Reset
  button removed (`7008e24`).
- **Key-recording fix (`94b6f3d`):** `keyBone` bailed with no current animation →
  `ensureCurAnim()` auto-creates one on first key/pose, and keys always refresh the
  dopesheet. `◆ Key` needs a selected bone/slot (else a hint); t=0 keys clamp clear of
  the sticky gutter so they're visible.
- **Transform gizmo (`096aec7`):** rotate ring + move-centre on the selected bone's
  origin (Setup + Animate). Ring = rotate (world-angle delta → local rotation; the first
  canvas rotation control), centre = translate. Animate holds via `posingBone` + keys on
  release by `posingBone.mode` (rotate→rotate channel, move→translate).

## Phase 5.6 — animation library / reuse (2026-06-18)

Goal (owner-approved scope): **reuse an animation across rigs/projects**, via a shared
R2 library PLUS an in-session copy/paste, with a **compatibility report + import-as-is**
(no name-remap UI yet). Additive to Phase 5; no refactor of the anim CRUD.

**Why a clip is portable.** An animation is the self-contained subtree
`rawDoc.animations[<name>]` — `{ bones, slots, drawOrder, events, deform, ik/transform/
path }` — keyed entirely **by name**. Importing it onto another rig is a deep-copy under a
unique name (`uniqueAnimName`). It only *drives* a target rig where bone/slot/event names
match; channels for names the target lacks import harmlessly but silently. So import is
gated by a **compatibility report** that surfaces matched-vs-missing before committing.

**R2 layout (global / project-agnostic, under `_shared/`)** — helpers in
`projectPaths.ts`:
- `sharedAnimationsPrefix = '_shared/animations'`
- `sharedAnimationsIndexKey = '_shared/animations/index.json'`
- `sharedAnimationKey(id) = '_shared/animations/<r2Slug(id)>.json'`

The library is deliberately cross-project (the owner's requirement: reused between
projects, nothing local).

**Entry file** `_shared/animations/<id>.json`:
```
{ schemaVersion: 1, id, name, savedAt, source:{client,project,rig}, refs:{bones[],slots[],events[]}, duration, animation: <the rawDoc.animations[name] subtree, verbatim> }
```
**Index file** `_shared/animations/index.json`: `{ animations: [ <row> ] }` where a row is
the entry MINUS the heavy `animation` body (so the list view is one GET). The id runs
through `r2Slug` to match the launcher/Python normalization everywhere else; re-saving an
id overwrites (the client confirms first).

**Endpoints** (`src/routes/api/rigger/animations/…`, all `rigger`-gated via `gate()`):
- `save/+server.ts` (POST) — body `{ id?, name, animation, refs?, duration?, sourceRig? }`;
  derives `id = r2Slug(id||name)`, builds the entry (`savedAt = new Date().toISOString()`,
  `source = {client, project, rig}` from the gate + body), `putObjectText` the entry, then
  upsert the lightweight row into the index. Returns `{ ok, id }`.
- `list/+server.ts` (GET) — reads the index, returns `{ animations }` sorted by name
  (empty array if no index yet).
- `get/+server.ts` (GET `?id=`) — returns the full entry; 404 if missing.
- `delete/+server.ts` (POST `{ id }`) — deletes the entry object + removes its index row.

**view.html** (`static/rigger/view.html`):
- `animRefs(animation)` / `animCompatibility(animation)` — the by-name ref extraction +
  matched/missing split vs the current rig's `rawDoc.bones`/`rawDoc.slots`.
- `importAnimation(animation, desiredName)` — the shared insert path (compat report →
  `Import anyway / Cancel`, then deep-copy under `uniqueAnimName`, `animsDirty`+`markDirty`,
  `setMode('animate')`, `setCurAnim`, `renderAnimSection`). Used by both paste + library.
- In-session **📋 Copy** (per row) → `animClipboard` (memory only) → **📥 Paste animation**
  (top of the Animations section, shown when the clipboard is set + a rig is loaded).
- R2 **📤 Save to library** (per row) + **🗂 Animation library** modal (list / filter /
  Load / 🗑 delete), both reusing the Load-spine modal styling (`.rigModal`).

**By-name approach (deferred work).** v1 reports compatibility and imports **as-is** — no
channel stripping, no name remapping. A future iteration could add a remap UI (map a
missing source bone/slot onto a target name) and/or an option to drop dead channels on
import. Not wired to the game build pipeline: the library is tool-side authoring data; a
reused clip ships through the existing `.irig` save→ship path, not as a new asset class.

## Phase 5.7 — fresh-read / "↻ Refresh from R2" (2026-06-18)

Owner hit a stale rig list after creating a rig — the tool was reading a cached
`/spine/skeletons` response. Root cause: that endpoint reads `skeletons.json` fresh from
R2 server-side (the editing tools rewrite it on every save/new/upload/delete), but the
response carried **no cache headers**, so the browser cached the GET — and the old client
fetch used a constant `?refresh=1` URL, which a heuristic cache could still serve stale.
(The per-file fetch was already fine — `/spine/file` is `no-store` and the client adds
`&v=Date.now()`.)

Fix, three parts:
- **`routes/(app)/spine/skeletons/+server.ts`** — every response now sets
  `cache-control: no-store` (shared by the Spine Viewer too; only upside there).
- **`view.html#loadSkeletons`** — always cache-busts: `fetch('/spine/skeletons?t='+Date.now()+…, { cache:'no-store' })`.
- **`view.html` — sidebar `↻ Refresh from R2` button** (`refreshFromR2`): re-reads the rig
  list and, if a rig is on stage, re-selects it (re-fetching its files cache-busted).
  Unsaved edits are guarded by a `dirty` confirm.

## Phase 5.8 — rig library / whole-rig reuse (2026-06-18)

Goal (owner-approved scope): **reuse an ENTIRE rig across rigs/projects** — bones +
slots + skins + constraints **and** animations — so a rig "can be moved to a different
object" and re-skinned to new art. The library is the transfer medium; applying a saved
rig gives the new object the bones + animations, then the user attaches the new art,
makes a mesh, and weights it to the imported bones with the EXISTING mesh/weight tools.
Mirrors the Phase 5.6 animation library exactly (R2 layout, endpoint shapes, modal
style); additive, no refactor of the rig CRUD.

**R2 layout (global / project-agnostic, under `_shared/`)** — helpers in
`projectPaths.ts`:
- `sharedRigsPrefix = '_shared/rigs'`
- `sharedRigsIndexKey = '_shared/rigs/index.json'`
- `sharedRigKey(id) = '_shared/rigs/<r2Slug(id)>.json'`

**Entry file** `_shared/rigs/<id>.json`:
```
{ schemaVersion:1, id, name, savedAt, source:{client,project,rig}, stats:{bones,slots,skins,animations:string[]}, skeleton: <full skeleton doc: skeleton block + bones + slots + skins + ik/transform/path + animations> }
```
**Index file** `_shared/rigs/index.json`: `{ rigs: [ <row> ] }`, a row being the entry
MINUS the heavy `skeleton` (list view = one GET). `stats` is computed server-side; the
stored `skeleton.skeleton.spine` is forced to a valid version (default `4.2`). The id
runs through `r2Slug`; re-saving an id overwrites (the client confirms first).

**Endpoints** (`src/routes/api/rigger/rigs/…`, all `rigger`-gated via `gate()` — copied
from the animation endpoints):
- `save/+server.ts` (POST) — body `{ id?, name, skeleton, sourceRig? }`; validates
  `name` non-empty + `skeleton` an object with `Array.isArray(skeleton.bones)`; derives
  `id = r2Slug(id||name)`; computes `stats` from the skeleton; `putObjectText` the entry,
  upsert the index row. Returns `{ ok, id }`.
- `list/+server.ts` (GET) — `{ rigs }` from the index, sorted by name (empty if none).
- `get/+server.ts` (GET `?id=`) — full entry; 404 if missing.
- `delete/+server.ts` (POST `{ id }`) — deletes the entry object + removes its index row.

**Apply-at-creation hook on `new` + `upload`.** Both creation endpoints take an OPTIONAL
`rigId`. A shared helper `src/lib/server/riggerNewRig.ts#resolveRigSkeletonBody(rigId)`
returns the `.irig` body to write: the blank skeleton when `rigId` is empty (unchanged
behavior), else the saved rig's `entry.skeleton` deep-cloned with `skeleton.spine` forced
to `4.2` (404 if the rig is missing). Everything else (synth `.atlas` from the chosen art,
page copy, reindex, response) is identical. The applied skeleton's attachment region names
are NOT remapped to the new atlas — they intentionally don't resolve until the user
re-attaches the new object's art (the by-name caveat below); bones/animations/constraints
come over intact.

**Import into the open rig — the namespaced merge (`view.html#importRig`).** The riskiest
path; made collision-safe by ALWAYS namespacing the imported rig:
- `prefixRigNames(src, p)` — prefixes EVERY internal name and rewrites EVERY reference,
  reusing the same ref-rewrite shape as the in-tool `renameBone`/`renameSlot`: bones
  (name + parent), slots (name + bone), skins (name + attachment-slot keys + linkedmesh
  `skin` refs), constraints (name + bone/target/bones), the animation map keys
  themselves, and every per-animation reference — `bones`/`slots`/`ik`/`transform`/`path`
  keys, the **legacy `deform`** (skin→slot) and the **Spine 4.2 `attachments`**
  (skin→slot→attachment) channels, and `drawOrder` slot offsets. Weighted-mesh bone refs
  are stored as **indices** (not names) so they need no rewrite — they stay valid because
  the imported bones keep their relative order on append + topo-sort.
- `mergeRigInto(dst, src, attachBone)` — drops the imported root bone, re-points every
  reference to it onto `attachBone` (the selected bone, else the current root) so no
  slot/constraint/anim key dangles, appends the (prefixed) bones then `topoSortBones` so
  every parent precedes its children, appends slots/skins/constraints, and folds the
  prefixed animations into `rawDoc.animations`.
- `importRig(id)` — guards on `rawDoc` + a `dirty` confirm, derives a unique prefix
  (`r2Slug(name)_`, bumped with a counter until no imported name collides against the
  open rig), runs the transform, `markDirty()`, `rebuildFromRawDoc(...)`,
  `renderAnimSection()`. Lossless; reversible by **↻ Refresh from R2** (reload discards
  the in-tab merge); deletes nothing from the current rig.

**view.html UI.** Sidebar **📦 Save rig to library** (enabled when `rawDoc` exists) →
`/api/rigger/rigs/save { name, skeleton: rawDoc, sourceRig }`. Sidebar **🗂 Rig library**
→ a `.rigModal` (same style as the animation library) listing rows with stats ("N bones ·
M anims") and per-row **Use in new rig** (opens the New-rig panel with the rig preset in
the new **Apply saved rig** dropdown), **Import into open rig** (`importRig`), **🗑**.
The New-rig panel gains an **Apply saved rig (optional)** `<select>` populated from
`/api/rigger/rigs/list`; `createNewRig` / `createRigFromImages` include `rigId` in the
POST when set.

**Spike** (`tools/rigger-spike/rigmerge.mjs`). Replicates the SAME `prefixRigNames` +
`mergeRigInto` transform, takes two real corpus skeletons, runs the merge, loads the
result through the official `spine-core@4.2.74` loader (with a combined dst+src atlas so
every region name exists for the structural load), and asserts: loader accepts it;
parent-precedes-child holds; no bone/slot/skin name collisions; every imported animation
present (prefixed); weighted-mesh bone indices in range; the ORIGINAL rig's bones + anims
unchanged; bone count grew by exactly the imported-bone count. PASS on multiple pairs
(e.g. `mm_bigwin` ← `anticipation` with 16 anims; `loader` ← weighted symbol `h1` with 40
weighted meshes).

**By-name / re-skin caveat.** A saved rig's attachments reference atlas regions by name;
applied/imported onto a different object they won't resolve against the new atlas — bones
and animations come over intact, but the imported art is blank until the user re-attaches
the new object's art and weights it to the imported bones. By design: the library moves
the rig (skeleton + motion); re-skinning to the new mesh uses the normal Setup/weight
tools. Not wired to the game build pipeline: tool-side authoring data; the result ships
through the existing `.irig` save→ship path, not as a new asset class.

## Phase 5.9 — re-sync atlas / source remembering (2026-06-18)

Problem: each rig is a self-contained spine bundle (`spines/<rig>/`) holding its OWN
**copy** of the atlas page image, snapshotted at New-rig time (see §16 — the page is
`getObjectBytes(rs.pageKey)` → `putObjectBytes(<bundle>/<pageName>)`). When the owner
recolours/edits that atlas in the Atlas Maker afterwards, the rig keeps showing the OLD
image — the bundle copy is never auto-updated. Owner-approved fix: a **⟳ Re-sync atlas**
button that re-pulls the latest page + re-synthesises the `.atlas` from the SOURCE atlas,
keeping the `.irig` (bones + animations + attachments) intact. It **remembers the source**
so re-syncs are one click.

**`source.json` sidecar (written by `new`).** After the rig bundle is written, `new`
also writes `<bundle>/source.json = { manifestKey, pageName }` — the manifest the rig was
created from + the page filename in the bundle. This is what makes future re-syncs
one-click. It's harmless: `buildSkeletonsIndex` only indexes skeleton/atlas files (so it's
ignored), and it's a valid `/spine/file` name. `upload/+server.ts` does NOT write one —
uploaded-image rigs have no project-atlas source, so a re-sync there falls through to the
picker.

**Endpoint `src/routes/api/rigger/resync-atlas/+server.ts` (POST, `rigger`-gated).**
Body `{ dir, atlasFile, manifestKey? }`. Mirrors `new`'s page-copy + atlas-synth calls:
1. `gate()` for `rigger` (same forbiddenMessage idiom).
2. Decode `dir` (base64url) → bundle under `spines/`, reject `..`; validate `atlasFile`
   is a non-empty string with no `..`/`/`; build `bundlePrefix` like `save`.
3. Resolve `manifestKey`: body override, else read `<bundle>/source.json`
   (`getObjectText` → JSON.parse). If still none → return `json({ ok:false,
   needsAtlas:true })` at **HTTP 200** (not a 4xx) so the client knows to show the picker.
4. `loadRegionSet(manifestKey, …)`; validate `regions.length`/`pageKey`/`pageWidth`/
   `pageHeight` (mirror `new`'s 400s); `getObjectBytes(rs.pageKey)` (404 if missing);
   `pageName = basename(rs.pageKey)`.
5. Read the bundle's CURRENT atlas; the old page filename = first non-empty trimmed line.
6. Write the new page (`putObjectBytes`), the re-synthesised atlas
   (`regionsToSpineAtlas(pageName, …)` → `putObjectText(<bundle>/<atlasFile>)`), and a
   refreshed `source.json` (so a PICKED source becomes remembered).
7. **Old-page cleanup:** if `oldPageName` exists and `!== pageName`, `deleteObject` it —
   but only AFTER the new page is written, so a failure can't leave the rig page-less.
8. Returns `{ ok:true, pageName, regions }`. Does NOT reindex `skeletons.json` (the
   skeleton list + atlas filename are unchanged).

**Client flow (one-click-then-picker).** `view.html`:
- Sidebar **⟳ Re-sync atlas** (next to ↻ Refresh from R2 / the rig-library buttons),
  enabled only when a rig is loaded (set in `selectSkeleton`).
- `resyncAtlas(manifestKey?)`: requires `selected`; on `dirty`, a confirm (re-sync
  reloads from R2, discarding unsaved skeleton edits). `showLoading`, POST
  `{ dir: selected.dir_b64, atlasFile: selected.atlas_file }` + `manifestKey` when given.
  On `!r.ok` → `showErr`. On `{ needsAtlas:true }` → `openResyncModal()`. On success →
  `await selectSkeleton(selected)` — re-selecting reloads `/spine/file` cache-busted
  (`v=Date.now()`), so the recoloured page shows.
- The sidebar button calls `resyncAtlas()` with **no** manifestKey → the server uses the
  remembered sidecar (one click). Only rigs without a sidecar (older rigs / uploads) fall
  through to the picker; after the first picker-driven re-sync the sidecar is written, so
  it's one click thereafter.
- Picker modal `#resyncModal` (a `.rigModal`, same style as the rig/animation libraries):
  lists `GET /api/rigger/atlases` (`{atlases:[{manifestKey,label,regions}]}`) with a
  filter; choosing one closes the modal and calls `resyncAtlas(manifestKey)`. Empty state:
  "No atlases in this project — compose one in the Atlas Maker first."

**By-name caveat (same as §16/5.8).** Re-sync is safe for a colour change because region
names are preserved. If the atlas was re-packed with renamed/removed regions, the rig's
attachments may no longer resolve and the user re-attaches by hand. Not a new pipeline
asset class — it ships through the existing `.irig` save→ship path.

## Phase 6 — isolated mesh edit ("detach the mesh to edit it") (2026-06-25)

Owner ask: *"a way to detach the mesh from the sprite image so I can edit the mesh, to
then reattach it again."* Clarified to the **isolated-edit** reading (Spine's "Edit Mesh"
workflow), NOT a true unbind/re-project — the image stays bound the whole time, so
"reattach" is just toggling the mode off. Zero data risk: `path`/`uvs` are never touched,
nothing in the `.irig` format or the deploy/bake chain changes. Purely a render-filter +
texture-opacity addition in `static/rigger/view.html`.

Why it's cheap on our side: a `MeshAttachment` already separates **geometry** (`vertices`,
`triangles`, `hull`) from **image binding** (`path` + `uvs`). Editing geometry never
disturbs the binding — exactly why Spine separates mesh editing from posing. So "isolate"
is a view state, not a data operation.

**State (`view.html`).** `meshIsolate` (bool) + `meshTexView` (1 = full, 0.4 = dim,
0 = wireframe only). Both reset on `selectSlot` (moving to another slot exits isolation)
and in `setMode` when leaving setup (isolate is a **setup-mode-only** tool — geometry is
edited against the setup pose, never a deformed/animated pose).

**UI.** When a mesh attachment is selected, the slot-detail panel shows a **⛶ Isolate
mesh** toggle and, while active, a **🖼 Texture: full / dim / off** cycle. Entering isolate
calls `fitMesh()` to frame the camera on the mesh's world bounds.

**Render hook (`frame()`).** When `editMode && meshIsolate && meshCtx`:
- `drawSkeletonIsolated()` draws ONLY the selected mesh slot's attachment at
  `meshTexView` opacity, with every other slot hidden. Non-destructive — it saves every
  slot's `color.a`, zeroes them, sets the target to `saved × meshTexView`, draws once, then
  restores all alphas in the same frame. `meshTexView === 0` skips the textured draw
  entirely (wireframe only).
- the global `showMesh` debug renderer (which would draw *every* mesh's hull) is suppressed
  while isolating, so only the selected mesh's overlay (`drawMeshOverlay` — triangles +
  draggable vertex handles) shows.

All the existing geometry tools (move / add / remove vertex, re-triangulate, draw mesh, UV
numeric edit, weight brush) work unchanged inside the isolated view — they operate on the
same `meshCtx`. "Reattach" = toggle ⛶ off → drop back into the full posed/animated rig with
the edited geometry live, no reprojection.

**UV-locked vertex dragging (the real "don't distort the sprite" fix, 2026-06-25 follow-up).**
First cut only hid the other slots; the owner pointed out that dragging a vertex still
distorted the sprite. Root cause: `applyMeshVertexDelta` moves only the vertex **position**,
never its **UV** — so the texture mapping stays pinned and the picture stretches (this is
just how a mesh renders: the image is the texture warped from UV-space onto the positions).
Spine's *Edit Mesh* avoids this by keeping `UV = affine(position)` for every vertex, so the
mesh renders the texture as one undistorted flat image and reshaping the wireframe only
re-cuts the outline / re-meshes the interior — it never warps the art.

Implementation (isolate mode only; normal setup-mode dragging still deforms, as before):
- On mousedown over a vertex (`tryStartMeshDrag`), `buildMeshUVFrame()` fits a fixed affine
  **world rest-position → region UV** from the mesh's largest-area (most numerically stable)
  vertex triangle — held for the duration of that one drag in `meshUVFrame`.
- During the drag, after `applyMeshVertexDelta` moves the position, `applyIsolatedVertexUV`
  re-pins the dragged vertex's UV = `frame(newWorldPos)` into `rd.uvs` + the live
  `att.regionUVs` (+ `updateRegion()`). Every *other* vertex still satisfies
  `UV = frame(pos)` (they didn't move), so the whole mesh stays globally affine in
  position→UV → the texture renders flat and undistorted. Cleared on mouseup.
- UV is **clamped to [0,1]** so dragging a hull vertex past the art's edge can't sample
  neighbouring atlas regions (bleed). The affine + clamp were unit-tested in Node (frame
  reproduces all original verts' UVs incl. one outside the fit; center→(0.5,0.5);
  past-edge→clamped).

**Not done here (the other reading, deferred):** a *true* unbind → edit free-floating →
re-project-UVs-onto-a-different-region flow (re-skin / retopo+reproject). The data model
supports it (recompute `uvs` via the affine fit `✎ Draw mesh` already uses), but it's a
separate, larger feature; left for a future phase if the owner wants image-swap rebinding.
