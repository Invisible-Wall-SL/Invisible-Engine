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
   - **Scene Editor** — `FlipbookNode` in the `LayoutNode` union (`types.ts:528`) + a
     `node.kind === 'flipbook'` branch in `LayoutNodeView.svelte`, next to the `sprite` branch.
7. **Export/bake/pull/register wiring** + the `docs/status/flipbook.md` status file.

`COMPONENT_PARAM_KINDS` gains a frame-list/clip kind only if flipbooks should be bindable
inside components — deferred past v1 unless the owner wants it.
