# Invisible Flipbook (atlas frame-animation authoring) — design + build plan

> An online **frame-animation authoring tool** — group an atlas sheet's packed regions into
> named, **ordered, timed clips** (fps + loop mode), preview them scrubbing live, and save a
> `FlipbookDoc` that ships through the standard deploy→bake→pull→register chain and is played
> by three consumers: **FX** particles, **Symbols** states, and **Scene Editor** elements.
> Owner direction 2026-07-20. Related: `live-assets.md` (the asset chain every new class must
> travel), `invisible-fx.md` (today's only frame-sequence path — locked inside the emitter),
> `invisible-symbols-state-machine.md` (where Spine is currently the *only* route to an
> animated symbol), `invisible-editor.md` (the `LayoutNode` union a flipbook must join).

## Why a tool, not a field

The gap is narrow and sits entirely between authoring and registration — **both ends already
exist**:

- `packages/pixi-svelte/src/lib/components/AnimatedSprite.svelte` wraps `PIXI.AnimatedSprite`
  (`textures / animationSpeed / loop / play`), and `SpriteSheet.svelte` resolves a `loadedAssets`
  key into an ordered texture array and feeds it. Both are exported, Storybook-covered, and have
  **zero call sites in any game or engine package** — a dead-but-working primitive.
- The loader already distinguishes the two shapes (`assetLoad.ts:23-34`): `sprites` → a flat
  name→texture **map** (what the whole editor-art pipeline uses), `spriteSheet` → an ordered
  texture **array** (what a flipbook needs). *That distinction is the entire problem.*

What does not exist anywhere is the concept of **an ordered, named, timed group of frames**:

| Surface | Today |
|---|---|
| Sheet Maker (`services/sheet-tool`) | Zero animation concept — grep for `anim\|flipbook\|fps\|sequence` returns nothing. A sheet is a bag of independently-named cells; TexturePacker's `frames` is a name→rect hash with no order. |
| FX (`EmitterArt`) | `frames: string[]` + `animated?: boolean`. Order = checkbox-click order (`toggleFrame` appends, no reorder UI). No fps. |
| Scene Editor (`SpriteNode`) | Explicitly single-frame: `assetKey` + one `region?`. |
| Symbols (`symbolCellSchema`) | `type: 'sprite' \| 'spine'` — a `sprite` cell is one frozen frame; `animationName` is meaningful only for `spine`. |

So a `Spin`/`Land`/`Win` symbol state is either a Spine animation or a still image. **Spine is
currently the only route to an animated symbol** — which also makes the flipbook the natural
cheaper fallback for the Tier-C spine-particle perf ceiling already flagged in
`docs/status/fx.md`.

### Why the clip doc is its own asset class

Three consumers want the same clip and only one is FX. A `clipId` reference means one authored
animation serves an emitter, a symbol state, and a scene element. Embedding clips in the sheet
manifest instead would drag ordering and timing through `build_manifest`, `loadRegionSet`, and
the Atlas Maker round-trip — three places that have no reason to know about time.

### Why the clip editor is not in the Sheet Maker

The Sheet Maker is a stdlib `ThreadingHTTPServer` + Pillow Python service whose entire UI is a
single 1272-line `ui.html`. A timeline, frame reordering, onion-skinning, and scrub playback
would all be hand-rolled inline JS in a file the build never parses — the exact failure mode
behind the Atlas tool's inline-JS quote collision and Rigger's never-type-checked `view.html`.
The Sheet Maker keeps owning **pixels**; the new tool owns **time**.

## Data model

`FlipbookDoc` — one doc per project, `<client>/<project>/clips/<name>.json`:

```ts
export const FLIPBOOK_DOC_VERSION = 1;

export interface FlipbookClip {
	id: string;            // stable, referenced by clipId from every consumer
	name: string;          // author-facing label
	assetKey: string;      // manifest key of the source sheet (one sheet per clip in v1)
	frames: string[];      // ORDERED region names — the whole point of this tool
	fps: number;           // default 24
	loop: boolean;         // default true
}

export interface FlipbookDoc {
	version: number;
	clips: FlipbookClip[];
}
```

`frames` is ordered and authored; `fps`/`loop` are real fields rather than the hardcoded
constants FX uses today. One sheet per clip in v1 — cross-sheet clips would need multi-atlas
texture resolution at every consumer, which is not worth v1.

## Travel (rule 8 — export→bake→pull→register)

Mirrors the effects chain verbatim:

- **export:** an exporter walks the project's clips and ships each referenced sheet through the
  existing `exportEditorArt` path, so a clip's frames always have textures. The ref-walker
  (`editorArtExport.ts:166,300`) must learn that a clip references N regions.
- **bake:** the clip docs are collected into a `flipbooks` manifest embedded in the bundle
  beside `effects` and `rigFx`.
- **register:** boot calls `registerFlipbooks(map)`; runtime `resolveFlipbook(clipId)` — a
  module-scoped `Map`, mirroring `registerRigFx.ts` / `registerEffects.ts` exactly.

## Referential integrity — the join is by NAME

A clip stores region **names**, so the whole design hinges on how stable a name is. Verified
2026-07-20:

**Repack is safe.** `api_arrange` (`sheet_server.py:463`) never sees display names — its identity
is `src`, the uploaded filename (`:476`), and it returns only `{src,x,y,w,h,rotated,locked}`
(`:488`). `api_export` re-emits `r["name"]` verbatim with fresh geometry. So re-authoring a sheet
— adding sprites, resizing the canvas, toggling rotation — absorbs all geometry drift and leaves
every clip intact. **This is the common case and it needs no special handling.**

**Rename and delete are hard breaks, with no hook to intercept them.** Renaming a region is
`renameSel()` in `ui.html:862` — an in-memory array mutation with **no rename endpoint**. It
reaches the server only through `api_session`'s blind whole-doc overwrite (`:165,204`), which
performs no diff. The server therefore *cannot know a rename occurred*; a rename is
indistinguishable from delete-plus-add from outside the Python tool. `deleteSel()`
(`ui.html:895`) is the same, minus even the duplicate-name check. Neither notifies any consumer —
`sheet_server.py` contains no reference to editor, symbol, or fx docs.

### The cautionary precedent: FX `art.frames[]` is unguarded today

The exact analogue of a clip's frame list has **zero detection at any stage**.
`effectExport.ts:50-59` collects only `assetKey`; `editorArtExport.ts:295-305` never adds FX frame
names to `refs.usedRegions`, so the dangling guard at `:461-474` structurally cannot see them.

The runtime degradation is silent and actively wrong (`EffectLayer.svelte:95-115`): missing frames
are dropped from the array, so *some* missing ⇒ a quietly shortened animation and
uniform-degraded weights; *all* missing ⇒ `undefined` ⇒ `ParticleEmitter.svelte:120-122` binds
**the entire sheet**, spraying random wrong textures rather than failing.

Elsewhere the guards exist but only warn: bake `console.warn`s dangling regions
(`bake-editor-doc.mjs:242,381`) and never `bail()`s — contrast `bail()` at `:259` for an
unreachable endpoint. In-game a missing sprite region is `Texture.EMPTY` (`Sprite.svelte:29-33`):
the node mounts, holds its transform, draws nothing. In the Scene Editor it's a grey placeholder
(`EditorCanvas.svelte:2133`) easily misread as "still loading", and `contentWarnings`
(`editor/+page.svelte:325-350`) validates `assetKey` only — never `node.region`.

### What this design does about it

1. **Clip frames become real references** — added to `refs.usedRegions` in `editorArtExport.ts`
   so the existing dangling guard covers them. Fix the FX `art.frames[]` omission in the same
   change; it is the same one-line class of bug.
2. **Fatal for clips, not a warning.** A silently shortened animation is a wrong result that
   looks plausible. The bake `bail()`s on a clip with a missing frame.
3. **Author-time detection in `/flipbook`** — the tool re-reads the live region set on load, so a
   dangling frame is caught the moment the author opens it, not at publish.
4. **Rename-repair hint (design option, unconfirmed).** `src` is the identity that survives a
   rename, so recording each frame's `src` at author time would let the tool offer "region X is
   gone — did you mean Y?". **Caveat:** `sheet_session.json` is the working state of one open
   sheet, so per-sheet durable recovery of `src` must be confirmed before relying on this.

No downstream validation makes rename *safe* — only *loud*. The durable fix is a rename endpoint
in the Sheet Maker emitting a change record; deferred past v1 as a Python-tool change with its
own cost.

## Two traps that must be designed around

1. **The namespacing straddle.** Editor-art registers frames *scoped*
   (`editorArtNamespace(sheet.key)` → `assetKey::region`), but symbol sheets register
   **un-namespaced deliberately** — a symbol binding's `assetKey` is the plain frame key
   `SymbolSprite` looks up directly (`editor-scenes.ts:546-549`). A clip usable in both the
   Scene Editor and the Symbols tool must resolve frames through `editorArtTextureKey()` with
   the bare-name fallback `parseScopedFrameRef` already provides.
2. **The build is not a type check.** `pnpm --filter launcher-api build` is a bare `vite build`
   with no `svelte-check` — a type error ships green. Widening `LayoutNode`, `symbolCellSchema`,
   or `COMPONENT_PARAM_KINDS` will **not** be caught. Follow the `COMPONENT_PARAM_KINDS`
   precedent: derive from one exported runtime VALUE, and cover it with an offline Node fixture.

## Build plan

1. **Fix the FX loop/framerate bug** (independent, ships first). `bindArt.ts:85-105` hardcodes
   `framerate: -1` and passes `loop: true`, which particle-emitter coerces to `false` whenever
   framerate ≤ 0 (`particle-emitter.es.js:840`) — so every FX flipbook plays exactly once per
   particle lifetime regardless of intent, and the `bindArt` doc comment claiming otherwise is
   wrong. Fix the comment; make the coercion explicit.
1b. **Close the FX frame-name guard gap** (independent, ships with 1). Add `layer.art.frames` to
   `refs.usedRegions` in `editorArtExport.ts:295-305` so dangling FX frames are reported like
   dangling sprite regions. Today they are invisible to every guard and degrade to a whole-sheet
   texture fallback.
2. **`packages/engine-flipbook`** — `FlipbookDoc` types, a normalizer (mirroring
   `engine-fx/normalize.ts`), and `registerFlipbooks` / `resolveFlipbook`.
3. **Sheet Maker sequence import** — numeric-suffix grouping (`explosion_001.png…`) on
   `POST /api/upload` so a dropped sequence lands ordered instead of as an unordered pile.
   Upload already accumulates, so *adding to an existing sheet* mostly works today.
4. **`/flipbook` tool** — region picker, ordered frame list with drag-reorder, fps + loop,
   live scrub preview. Reads region sets via the existing `loadRegionSet`; reuses the `/fx`
   atlas-slicing preview path (`framesToTextures`). Registry entry + `docs/tools/flipbook.md`
   in the **same** change (rule 9).
5. **Runtime playback seam** — resolve a clip's ordered frames to textures and feed
   `AnimatedSprite`. Since editor-art registers as `sprites` (flat map), resolve frame-by-frame
   through `editorArtTextureKey` rather than relying on `spriteSheet`'s array.
6. **Consumers**, in ascending risk:
   - **FX** — add `clipId?` to `EmitterArt` alongside the existing `frames[]` path; `bindArt`
     prefers the clip's order and fps when present. Existing docs keep working.
   - **Symbols** — widen `symbolCellSchema.type` to `'sprite' | 'spine' | 'flipbook'` + a
     `SymbolFlipbook.svelte` branch in `Symbol.svelte`.
   - **Scene Editor** — ✅ done. `FlipbookNode` in the `LayoutNode` union + a
     `node.kind === 'flipbook'` branch in `LayoutNodeView.svelte`, next to the `sprite` branch.
     Two things the plan did not anticipate: (a) the editor does NOT need a placeholder chip —
     a clip is atlas frames in order, so the 2D canvas plays it through the same region draw a
     sprite uses (the `effect` chip exists because a WebGL emitter genuinely cannot run there);
     (b) trap #2 below bit exactly where predicted, so `LAYOUT_NODE_KINDS` is now an exported
     runtime value that `editorStorage.ts`'s accepted-kind set derives from — a hand-copied list
     would have DROPPED every placed node on save, silently and green.
7. **Export/bake/pull/register wiring** + the `docs/status/flipbook.md` status file.

`COMPONENT_PARAM_KINDS` gains a frame-list/clip kind only if flipbooks should be bindable
inside components — deferred past v1 unless the owner wants it.
