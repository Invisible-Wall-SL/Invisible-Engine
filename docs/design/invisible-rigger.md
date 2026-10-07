# Invisible Rigger — design + build plan

> An online **rig skeleton editor** — view bones, pose/edit the rig, build and
> weight-paint meshes, and author animations — that reads and writes the **rig
> 4.2 export format** so files round-trip with the official runtime, while keeping
> An external rig editor usable alongside it.
> Owner direction 2026-06-13. Related: `live-assets.md` (the deploy→bake→pull→register
> contract every new asset class must travel), `invisible-editor.md` (the
> sibling online editor whose `/rig-viewer` viewer + R2 rig plumbing this builds on).

## 0. Status

This document is the **plan**. How far the plan got — what is built, what is open, what still
needs live verification — lives in [docs/status/rigger.md](../status/rigger.md), and the user
guide is [docs/tools/rigger.md](../tools/rigger.md). Cinematic mode has its own design
([invisible-cinematic](invisible-cinematic.md)) and status ([cinematic](../status/cinematic.md)).

## 1. Why this tool exists (the goal)

Owner direction (2026-06-13): a license-free, browser-based, collaboration-first
rigging tool we own end-to-end — so multiple artists can rig/animate without a third-party licence, the export→re-import round-trip friction disappears, rigs live in
R2 where they can be edited and reviewed online, and rig becomes one more
**Invisible** tool in the pipeline. Rigging/animation is **core, constant work**,
which is what justifies a build of this size. **Weight painting is in scope and
non-negotiable** — without mesh deformation the tool doesn't replace rig for
real work.

This is its own product, comparable in size to the Atlas Maker or larger. The
phasing (§7) is structured so every phase ships a usable increment and the riskiest
work is proven first.

## 2. The format question (settled)

### 2.1 Native format = 4.2-format export JSON, under our own extension

A rig **runtime export** is open and documented: a `.json` (or binary `.skel`)
skeleton + a `.atlas` + page PNG(s). The skeleton JSON is a plain tree — bone
hierarchy (`x/y/rotation/scaleX/scaleY/shearX/shearY/length/parent`), slots, skins
(region / **mesh** / clipping / boundingbox / path attachments), IK / transform /
path constraints, events, and animations (keyframed timelines with bezier curves).
Nothing is encrypted or proprietary about the *data*.

**Decision:** our native file **is** byte-valid 4.2-format JSON, saved under our own
extension (working name `.irig`). The extension is cosmetic — the official runtime
loader (`SkeletonJson.readSkeletonData`) takes a parsed object/string and does not
care about the filename; only convenience auto-loaders pick the JSON vs binary
reader by extension, and in our own pipeline we call the loader directly. This buys
branding/ownership with **zero** compatibility cost:

- **Our editor → our runtime (`engine-rig`, §7 Phase 6):** same bytes, no conversion.
- **Our editor → the reference runtime / an external rig editor import:** still the same bytes.

Do **not** fork the format. The instant our format diverges from rig's we lose
the free runtime and inherit a permanent round-trip-fidelity burden.

### 2.2 Editor-only metadata goes in a sidecar

Anything outside the rig schema (our UI state, layer colours, comments, lock
flags) lives in a sidecar so the skeleton file stays 100% pure and portable:

```
model.irig            ← pure 4.2-format JSON (every 4.2 runtime reads this, untouched)
model.irig.meta.json  ← our extras (ignored by every runtime)
```

This is the [[feedback_validate_data_contracts_offline]] lesson applied up front:
never risk confusing a strict loader with unknown keys — keep extras out-of-band.

### 2.3 The honest interop limit

There are two distinct rig formats:

| | What it is | Can we write it? |
|---|---|---|
| **Runtime export** (`.json` / `.skel`) | the "compiled" data runtimes consume | ✅ yes — our native format |
| **Project file** | the desktop **editor's** own save format (proprietary, undocumented) | ❌ no |

So "keep both" is **total at the runtime level** — every rig runtime renders our
files natively. Going *back into an external rig editor* works via its **Import**
(it can import skeleton JSON), but that is an import, not a pristine project
round-trip; the desktop editor really wants its own project file, which we
cannot author. In practice this is fine: an external rig editor stays available for anyone
who wants it, our tool produces files it can import, and our tool ↔ runtime is
seamless. We just don't promise a lossless desktop-editor round-trip — that's the
desktop editor's limitation, not ours.

### 2.4 We target 4.2-format, version-locked

The schema changes between rig versions. We pin to **4.2** — the semantics our own runtime, `packages/engine-rig`,
implements (`engine-rig/pixi` in the games, `static/rig-viewer/vendor/invisible-rig.js` in
the static tools). The serializer (§7 Phase 0) is validated against that 4.2 loader,
not a guess.

## 3. What we already have to build on

The `/rig-viewer` Invisible Rig Viewer and the editor's rig plumbing are the
foundation — this tool extends them rather than starting cold:

- **Viewer + runtime** — `apps/launcher-api/static/rig-viewer/view.html` +
  `invisible-rig.js` (built from `packages/engine-rig`); `/rig-viewer` page +
  `routes/(app)/rig-viewer/{+page.svelte, +page.server.ts, skeletons/+server.ts, file/+server.ts}`.
- **Rig in the editor** — `routes/(app)/editor/{editorRig.client.ts,
  rigRuntime.client.ts, EditorRigLayer.svelte}`, `lib/server/rig.ts`,
  `lib/server/rigIndex.ts`, the upload/reindex endpoints under
  `routes/api/editor/rigs/`, and `scripts/r2-sync-rigs.mjs`.
- **pixi-svelte rig components** — `packages/pixi-svelte/src/lib/components/{RigProvider,
  BaseRigProvider,RigTrack,RigSlot,RigBone}.svelte`. The runtime already
  exposes `skeleton.bones` (each with full transform + parent) and slots, so the
  **bone overlay and hierarchy outline are nearly free**.
- **R2 rig prefix + symbols rig stages** — `SymbolRigStage.svelte` /
  `SymbolRigPreview.svelte` show we already load atlases + skeletons from R2 and
  animate them in a shared WebGL stage.

## 4. Architecture (proposed)

- **Host:** a launcher-native Svelte 5 page at **`/rigger`** — reuses launcher
  auth, the client→project selector, scope gating, and R2 writes (the
  `invisible-font-maker.md` §3 pattern). No new Railway/Python service.
- **Editing model:** load skeleton JSON → an **in-memory editable document**
  (our own typed model, not the runtime's immutable `SkeletonData`). The runtime is
  used to *render/preview*; edits mutate our document; on save we **serialize our
  document → 4.2-format JSON**. Keep a clean boundary: runtime = renderer, our
  document = source of truth while editing.
- **Rendering:** `engine-rig`'s WebGL `SceneRenderer` (the vendored `invisible-rig.js`)
  is the preview renderer. Our document is pushed to a runtime `Skeleton` for live display.
- **Writes:** a `rigger`-gated launcher endpoint (`POST /api/rigger/save`) using the
  existing `r2.ts` writers; `assertAllowed` every key against the gate's prefixes.
  Skeleton + sidecar + (when meshes/atlas change) the atlas/page handoff to the
  Atlas Maker's domain — see §8.

## 5. The hard parts (named honestly)

1. **No official exporter.** The runtimes only *read*; serialization lives only in
   the paid desktop editor. We must write our own 4.2 serializer. Bounded but
   unforgiving and version-locked. → De-risked in Phase 0.
2. **Auto-weights is research-grade.** Manual brush painting is doable; the thing
   that makes mesh rigging *usable* — auto-weights (rig uses a proprietary
   bounded-biharmonic / heat-diffusion approach) — we must approximate
   (inverse-distance-to-bone-segment or a bone-glow flood), and it **will not match
   Rig on day one**. This is the single biggest risk. → De-risked in Phase 0.
3. **Mesh geometry editing.** Hull + interior vertices, constrained
   triangulation (ear-clipping / Delaunay), UV binding, edges — a small CAD-like
   subsystem.
4. **Animation timeline authoring.** Dopesheet + bezier graph editor + events — the
   bulk of an external rig editor by surface area.
5. **License.** Rendering with the reference runtimes would keep us under the
   third-party runtime licence (a valid third-party licence is required to use them). Owner
   direction (2026-10-06): that is not acceptable, so Phase 6 is **required** — our
   own clean-room runtime reads, poses and draws every rig, and no third-party runtime
   code ships in a game or tool. §2.1 keeps the format identical either way. (Counsel
   should still confirm the clean-room position before relying on it commercially.)

## 6. The weight-painting subsystem (Phase 4 detail)

The runtime already performs linear-blend skinning when it renders a weighted mesh —
the math is done for us. Everything hard is **authoring**:

- **Weighted-mesh vertex format.** Rig packs weighted vertices as a flat array:
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
| **1 — Viewer + inspector** | extend `/rig-viewer`: bone overlay, slot/skin tree outline, animation scrubber (read-only) | low — foundation exists |
| **2 — Rig editor** | move/rotate/scale/reparent bones; edit slots/skins/draw-order/attachment placement; rename/delete; **export valid `.irig`** | medium |
| **3 — Mesh editor** | place vertices, auto-triangulate, UV bind, hull/edges | medium-high |
| **4 — Weights** | auto-weights + brush painting + live deform | **highest** |
| **5 — Animation** | timeline/dopesheet + bezier curves + events | high |
| **6 — License-free runtime (required, built 2026-10-06)** | `packages/engine-rig`: our own 4.2-format-compatible reader (JSON + `.skel`), pose, constraints, physics, AnimationState, clipping, a Pixi 8 `RigView` and a WebGL `SceneRenderer`; every consumer swapped off the third-party runtime packages; parity-gated against the reference runtime by `tools/rig-parity` | medium |
| **7 — Pipeline wiring** | export → `deploy/` → bake → pull → register (rule 8 / §8) + R2 collaboration UX | medium |

**Phase 0 is a gate, not a formality.** Both spikes must pass before committing to
Phases 2+:

1. **Round-trip fidelity** — reproduce the reference runtime's 4.2 JSON closely enough that the
   runtime loads our re-serialized file identically. Build a fixture: take a real
   shipped skeleton (e.g. a Book of Borut rig), `read → write → read`, diff the
   parsed structures. This is the format contract — rule 7 puts it first regardless.
2. **Auto-weights quality** — prototype the algorithm on one real mesh and *look at
   it deforming*. If we can't get acceptable output and can't see a path to closing
   the gap, we learn it on day 3, not month 3.

## 8. Pipeline wiring (rule 8 — non-negotiable)

Rigs are already an R2 asset class with viewer + editor consumption, but a
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

## 9. Open questions

Resolved during the build:

- **Binary `.skel`** — read-only (view) support; editing and export are JSON only.
- **Extension** — `.irig` is final. Out-of-band data sits beside the bundle rather than in
  one `.irig.meta.json`: `source.json` (the atlas snapshot's origin + revision) and
  `text.json` (localized text elements). One exception to §2.2: an image's pivot is stored
  inline as a `pivot` key on the region attachment, because the 4.2 loader ignores it and the
  rendered geometry is unchanged.
- **Collaboration model** — a soft lease in Postgres for coordination plus R2 conditional
  writes for correctness; the lock does NOT live in the sidecar (a lock stored in the blob is
  clobberable by the very race it exists to prevent). Owned by
  [multi-user-concurrency](multi-user-concurrency.md).

Still open:

- **Undo/redo for rig editing.** Only Cinematic mode has a command history (snapshot-based,
  scoped to the cinematic document, written so it can be pointed at the rig document).

## 10. Phase 3.6: visual UV editor + hull editing

A larger, inherently-visual build deferred out of the mesh phase (Phase 3): a **visual UV
editor panel** — show the region's texture image and drag vertices in UV space — plus
**hull / edge editing**. Because these are inherently visual they need real in-browser
verification, so they are best built after the live `/rigger` check rather than proven
purely by a headless spike.

## 11. Model note (Fable 5 vs Opus 4.8 for building this)

Default the build to **Opus 4.8** — it's state-of-the-art at long-horizon agentic
engineering, and the bulk of this project (viewer, rig editor UI, mesh geometry,
timeline, pipeline wiring) is well-specified Svelte 5 / PixiJS work it handles
excellently at half the token cost. **Reserve Fable 5** ($10/$50 vs $5/$25 per MTok)
for the genuinely research-grade pieces where the intelligence ceiling pays for
itself: the **auto-weights algorithm** (Phase 0/4) and gnarly **serializer
round-trip debugging** (Phase 0). Blanket-using Fable 5 for the whole build would be
a waste of tokens.
