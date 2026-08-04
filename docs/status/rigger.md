# Invisible Rigger — status

> Design: [docs/design/invisible-rigger.md](../design/invisible-rigger.md) · Guide: [docs/tools/rigger.md](../tools/rigger.md) · Agent: _none yet_

**One-line state:** Built — Phases 0–6 on `main`, registered + documented; ⏳ the **whole tool** still needs owner live-verify (the vendored **minified** spine runtime hides browser-only bugs the headless spikes' un-mangled `spine-core` never surface).

## Current state
Online Spine 4.2 skeleton editor at `/rigger` (launcher-native, full-page, `rigger`-gated). Reads/writes byte-valid Spine 4.2 JSON under our `.irig` extension, non-destructively saved to R2 alongside the artist's source. Phases 0–6 are all on `main`:

- **Bones** — transform edits, canvas drag-to-move, reparent (cycle-safe topo-sort), rename (rewrites every reference), add/delete, collapsible hierarchy.
- **Slots / skins** — draw-order reorder, region-attachment placement, add/rename/delete, duplicate slot, **✨ Auto FX slots** (auto-duplicate + repoint `_shine`/`_glow`/`_shadow`/… from the atlas), multi-skin.
- **Mesh** — region→mesh convert, draw-a-mesh, move/add/remove vertex, constrained-Delaunay re-triangulate, numeric UV editing, **isolated-mesh edit** (⛶) that re-pins UVs so reshaping the wireframe never distorts the art.
- **Weights** — bind-to-bone, per-vertex numeric editing, visual **weight brush** (radius/strength/erase + blue→red heatmap), a proximity chain-skinner auto-weight.
- **Animation** — keyframing (per-channel + key-all), **dopesheet** (multi-select, marquee, alt-drag duplicate, per-key easing), a **graph editor** (bezier tangents), slot channels (shows / colour / opacity via one `rgba` timeline), **timeline events** (⚡ cues that cross the game event bus to fire Invisible FX), and draw-order channels.
- **Rig + animation libraries** — cross-project R2 libraries: copy/paste or save/load a single clip, or save/apply/import a whole rig (namespaced lossless merge; apply-at-creation), with a matched-vs-missing compatibility report.
- **Bounds / natural size** written on every save (setup-pose measured, animation-union fallback); one-click **⟳ Re-sync atlas** / **source…** to re-pull a rig's atlas snapshot.
- **Self-healing atlas snapshot (2026-07-21).** A rig bundle carries a FROZEN copy of the source sheet's `.atlas` geometry + page; regenerating the sheet used to leave every downstream consumer (Symbols, Scene Editor spine preview, the baked game) stale until each rig was manually `⟳ Re-sync`ed. Now `source.json` records a **revision** (geometry hash + page ETag) and the shared `ensureBundleAtlasFresh` (`$lib/server/spineBundleSync.ts`) re-derives the bundle `.atlas` + page from the live manifest whenever it drifts — called on the Symbols/Editor **read** path (`resolveEditorSpine`) and the **bake** path (`exportSpineBundle`), so a re-packed/recoloured sheet propagates with no manual step. `new` seeds the revision; `⟳ Re-sync atlas` now delegates to the same helper (`force`). See [docs/status/symbols.md](symbols.md).

The `.irig` round-trips through the official loader (Phase 0: 120/120 skeletons, weighted-mesh vertices included). `.skel` binary is view-only; editing is JSON only. See design §0 for the reconciled phase summary.

## Open items / next
1. ✅ ~~**Ship-from-Rigger (rule 8)**~~ — **DONE (owner-confirmed 2026-08-04).** A rig now travels the full export → `deploy/` → bake → pull → runtime-register chain and reaches a game; "renders in `/rigger`" now also means "ships."
2. **Mesh-deform animation timelines** — per-vertex `deform` channel keying (the largest missing animation channel).
3. **Phase 3.6 visual UV editor** — a texture-panel UV editor (drag vertices over the region image) + hull/edge editing; only numeric UV editing exists today.
4. **Better auto-weights** — the shipped proximity chain-skinner scored poorly against artist ground truth; a geodesic/heat algorithm + a representative **character-mesh validation gate** (Spike 2) is still open. Manual brush stays the guaranteed path.

## Blocked (owner / external)
- **⏳ Rig/animation library catalogs moved to Postgres — live-verify owed.** The build is
  green and the migration is additive, but the two-user test has NOT run: there are no R2
  credentials in a local checkout and the only reachable `DATABASE_URL` is production, so
  neither the concurrent-save test nor the backfill could be exercised offline. **After the
  next deploy, confirm `/rigger` still lists every rig + animation** (the first list call
  backfills the legacy index blobs) — auto-migrate is fail-soft, so a failed `0013` shows up
  as an empty library / 500s, not as a failed deploy. See
  [design/multi-user-concurrency](../design/multi-user-concurrency.md) Phase 0.
- **Whole-tool live-verify** is the standing gap and is owner-driven — the minified vendored runtime has already surfaced browser-only bugs (e.g. `constructor.name` type checks, a double-flipped canvas Y) that headless spikes missed. Verify each action live before relying on it.
- **No lossless desktop-Spine `.spine` project round-trip** — an Esoteric limitation (desktop Spine can only _import_ our JSON), not ours.

## Recent changes
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
