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

The `.irig` round-trips through the official loader (Phase 0: 120/120 skeletons, weighted-mesh vertices included). `.skel` binary is view-only; editing is JSON only. See design §0 for the reconciled phase summary.

## Open items / next
1. **Ship-from-Rigger (rule 8) — recommended next.** A rig only `.irig`-saves to R2; there is **no** export → `deploy/` → bake → pull → runtime-register wiring, so a Rigger rig does not actually reach a game. "Renders in `/rigger`" ≠ "ships."
2. **Mesh-deform animation timelines** — per-vertex `deform` channel keying (the largest missing animation channel).
3. **Phase 3.6 visual UV editor** — a texture-panel UV editor (drag vertices over the region image) + hull/edge editing; only numeric UV editing exists today.
4. **Better auto-weights** — the shipped proximity chain-skinner scored poorly against artist ground truth; a geodesic/heat algorithm + a representative **character-mesh validation gate** (Spike 2) is still open. Manual brush stays the guaranteed path.

## Blocked (owner / external)
- **Whole-tool live-verify** is the standing gap and is owner-driven — the minified vendored runtime has already surfaced browser-only bugs (e.g. `constructor.name` type checks, a double-flipped canvas Y) that headless spikes missed. Verify each action live before relying on it.
- **No lossless desktop-Spine `.spine` project round-trip** — an Esoteric limitation (desktop Spine can only _import_ our JSON), not ours.

## Recent changes
- 2026-07-14 — Rigger FX overlay redrawn with the full bone transform so it matches the in-game renderer at any scale ([detail in history](../history.md)).
- 2026-07-14 — `/rigger` `view.html` + vendored bundles cache-bust via `?v=BUILD_ID` so a redeploy is fetched fresh ([detail in history](../history.md)).
- 2026-07-10 — Live rig-bound FX preview on the stage + docked event-key inspector (pick an effect directly on a keyframe) ([detail in history](../history.md)).
- 2026-07-08 — Timeline event-key authoring UI (name / int / float / string / time) on the dopesheet ([detail in history](../history.md)).
- 2026-07-06 — "✨ Auto FX slots": auto-author FX layers from the atlas manifest ([detail in history](../history.md)).
