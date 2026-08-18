# Invisible Rigger — status

> Design: [docs/design/invisible-rigger.md](../design/invisible-rigger.md) · Guide: [docs/tools/rigger.md](../tools/rigger.md) · Agent: _none yet_

**One-line state:** Built — Phases 0–6 on `main`, registered + documented; ⏳ the **whole tool** still needs owner live-verify (the vendored **minified** spine runtime hides browser-only bugs the headless spikes' un-mangled `spine-core` never surface).

## Current state
Online Spine 4.2 skeleton editor at `/rigger` (launcher-native, full-page, `rigger`-gated). Reads/writes byte-valid Spine 4.2 JSON under our `.irig` extension, non-destructively saved to R2 alongside the artist's source. Phases 0–6 are all on `main`:

- **Bones** — transform edits, canvas drag-to-move, reparent (cycle-safe topo-sort), rename (rewrites every reference), add/delete, collapsible hierarchy.
- **Slots / skins** — draw-order reorder, region-attachment placement, add/rename/delete, duplicate slot, **✨ Auto FX slots** (auto-duplicate + repoint `_shine`/`_glow`/`_shadow`/… from the atlas), multi-skin.
- **Mesh** — region→mesh convert, draw-a-mesh, move/add/remove vertex, constrained-Delaunay re-triangulate, numeric UV editing, **isolated-mesh edit** (⛶) that re-pins UVs so reshaping the wireframe never distorts the art.
- **Weights** — bind-to-bone, per-vertex numeric editing, visual **weight brush** (radius/strength/erase + blue→red heatmap), a proximity chain-skinner auto-weight.
- **Animation** — keyframing (per-channel + key-all), **dopesheet** (multi-select, marquee, alt-drag duplicate, per-key easing — **right-click a key in a multi-selection eases the whole selection at once**), a **graph editor** (bezier tangents), slot channels (shows / colour / opacity via one `rgba` timeline), **timeline events** (⚡ cues that cross the game event bus to fire Invisible FX), and draw-order channels.
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
   changes) — so "the tool has no signal that `/localization` moved on" is closed. Still NOT
   built: a **rename** for a text element (the id is the attachment name, so it is locked after
   creation), and **placed/persistent FX slots** (the other half of design §12.4a). Owner
   live-verify is owed against real R2 + a real game, and nobody has yet *looked* at baked rig
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
  all four now call `reorderDeform`. Hull-loop *reordering* deferred to 3.6d. Launcher-static only
  (`view.html`) — no engine change, no submodule bump. Offline proof:
  `tools/rigger-spike/hulledit.mjs` — posed deform is byte-preserved through a permutation on BOTH
  an unweighted and a weighted (varied influence-count) mesh via spine-core, hull stays a simple
  polygon (9/9). **⏳ Live-verify owed (owner):** ⬡ Hull promote/demote on a real mesh; and a mesh
  WITH a deform animation → remove a vertex → play the deform → geometry stays correct.
- 2026-08-04 — **Phase 3.6b: constraint-edge (mesh `edges`) authoring.** New **✎ Edge** mesh mode:
  click two vertices to toggle a "keep this edge" constraint that (a) **survives re-triangulation**
  — guaranteed present via proper constrained edge-insertion (`forceConstraintEdge` re-triangulates
  the cavity the segment crosses, not just flip-protection) and (b) **persists losslessly** as spine
  `edges` (`vertexIndex×2` pairs). The `edges` field was previously *derived-and-dropped* on every
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
  no guard, and are GLOBAL (not project-scoped) — so two users on *unrelated* projects silently
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
