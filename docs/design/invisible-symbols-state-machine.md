# Invisible Symbols State Machine — author the symbol→state→asset map (design)

A tool that turns the in-game **Symbol Debug** grid into an editable surface: per symbol,
per animation state, rebind the cell to a sprite / sprite-sheet animation / spine that
already lives in R2 — and ship those bindings to the game through the standard deploy chain.

Owner-named **Invisible Symbols State Machine** (2026-06-12). Standalone tool page, like
Atlas / Spine / Font Maker.

## The thing we are making data-driven

Today every game hardcodes a `SYMBOL_INFO_MAP` — see
[`apps/lines/src/game/constants.ts`](../../apps/lines/src/game/constants.ts) — a grid of
**symbol × state → asset binding**:

```
SYMBOL_INFO_MAP['H1']['win'] = {
  type: 'spine', assetKey: 'H1', animationName: 'h1', sizeRatios: { width, height },
}
SYMBOL_INFO_MAP['H1']['static'] = { type: 'sprite', assetKey: 'h1.webp', sizeRatios }
```

Symbols: `H1…H5`, `L1…L5`, `W`, `S`. States: `static`, `spin`, `land`, `win`,
`postWinStatic`, `explosion` (`apps/lines/src/game/types.ts#SYMBOL_STATES`). Each cell is
either a **sprite** (`assetKey` = a sheet frame key, e.g. `h1.webp`) or a **spine**
(`assetKey` = a registered spine bundle + `animationName`).

The Symbol Debug overlay
([`SymbolDebugOverlay.svelte`](../../packages/components-pixi/src/components/SymbolDebugOverlay.svelte),
gated behind `localStorage.IE_DEBUG=1` + the `d` hotkey) already renders this exact grid
live. This tool is that grid, **editable**, with the result authored to R2 and shipped.

## v1 scope (owner decisions 2026-06-12)

- **Bindings only.** The tool authors the symbol→state→asset map. Payline geometry (which
  board positions form each winning line) stays code/math-defined — OUT of v1.
- **Standalone tool page** (`/symbols` in the launcher), not a panel inside the editor —
  but it REUSES the editor's R2 library picker, doc endpoints, deploy-token plumbing, and
  the `bake-editor-doc.mjs` / `pull-project-assets.mjs` transport.
- **Spine included in v1.** Most states (`win`/`land`) are spine, so a sprites-only tool is
  useless. Spine support = a *copy/mirror* of already-made spine bundles into `deploy/`
  (see below) — NOT spine authoring.

### Out of v1
- Payline geometry / which symbols pay on which lines.
- Creating or editing spine animations (we only reference existing ones).
- Adding/removing symbols or states (the symbol set + 6 states are fixed in v1; the tool
  edits bindings within that fixed grid).

## "Spine export" demystified

A spine asset is a **bundle of sibling files that travel together**, e.g. for `H1`
(`apps/lines/src/game/assets.ts`):

```
symbols.atlas   ← libGDX region map (SHARED by H1…L4)
h1.json         ← this symbol's skeleton
symbols.webp    ← the page image the .atlas references (SHARED)
```

Several symbols share one atlas + page (`symbols`=H1–L4, `symbols2`=M+S, `symbols3`=W+
explosion). These are made by an artist in Spine Editor and already exist in R2 (the
Invisible Spine Viewer streams them). **We import them as-is.** "Export" = the same humble
copy step `fontExport.ts` does for bitmap fonts: mirror the existing files into the
project's `deploy/` subtree with their sibling files + names intact, so the build pull drops
them into `static/assets/` and the game registers them. The ONE new capability vs the
existing editor-art exporter (which only handles single-file sprite sheets) is gathering the
multi-file spine bundle (atlas + N skeletons + shared page) and keeping the relative names
lined up.

## The R2 doc (new asset class)

`<client>/<project>/symbols/symbols.json` — the authored binding map. Coded
`SYMBOL_INFO_MAP` is the **fallback/default** (dev parity), exactly as
`fallbackEditorScenes` is for the layout doc.

```jsonc
{
  "version": 1,
  "symbols": {
    "H1": {
      "static": { "type": "sprite", "assetKey": "h1.webp", "sizeRatios": { "width": 1, "height": 1 } },
      "win":    { "type": "spine",  "assetKey": "H1", "animationName": "h1", "sizeRatios": { "width": 0.57, "height": 0.65 } },
      // … one entry per authored state; unset states fall through to the coded map
    }
    // … only symbols/states the user changed need appear (sparse overrides)
  }
}
```

Sparse: an unset symbol/state falls through to the coded default, so the doc only carries
edits. Same merge philosophy as `componentDefaults`.

## Engine contract (build FIRST — everything hangs off it)

`getSymbolInfo` ([`apps/lines/src/game/utils.ts`](../../apps/lines/src/game/utils.ts))
currently reads `SYMBOL_INFO_MAP[name][state]` straight from the constant. Change:

1. **`apps/lines/src/game/symbolMap.ts`** (new) — exports `activeSymbolInfoMap`, computed
   once as `mergeSymbolMap(SYMBOL_INFO_MAP, bakedSymbolMap())`. `mergeSymbolMap` deep-merges
   per symbol/state (override wins; unset falls through). `utils.ts#getSymbolInfo` reads
   from `activeSymbolInfoMap`.
2. **`editor-scenes.ts#bakedSymbolMap()`** — returns `bundle.symbols?.map` (the authored
   overrides) or `undefined` when un-baked → dev keeps the coded map byte-for-byte.
3. **`editor-scenes.ts#bakedSymbolAssets()`** — turns the bundle's `symbols.index` into
   engine asset entries for any assetKey the overrides introduce that the coded `assets.ts`
   doesn't already register:
   - sprite sheet → `{ type:'sprites', src:'assets/editor-symbols/<stem>/<stem>.json', namespace? }`
   - standalone image → `{ type:'sprite', src }`
   - spine bundle → `{ type:'spine', src:{ atlas, skeleton, scale } }` (paths under
     `assets/editor-symbols/…`)
   Spread into `createApp({assets})` in
   [`stateApp.ts`](../../apps/lines/src/game/stateApp.ts) beside `bakedEditorArtAssets()`.
4. No boot-order surprise: the map is pure data (no registration call), so reading
   `activeSymbolInfoMap` at first render is enough. Assets register at `createApp` as today.

Un-baked repos (`apps/lines` dev, any game before first symbol edit) get `undefined` map +
`{}` assets → identical to today.

## The deploy chain (mirror `editorArtExport.ts` / `fontExport.ts` exactly)

Per the hard rule (`docs/design/live-assets.md`, CLAUDE.md §8): a new R2 asset class is only
done when it travels **export → `deploy/` → bake → pull → register**.

1. **Export (server)** — `apps/launcher-api/src/lib/server/symbolExport.ts#exportEditorSymbols`:
   read `symbols.json`, resolve each referenced sprite sheet / standalone image / **spine
   bundle**, copy into `deploy/editor-symbols/<stem>/` (preserving sibling file names so a
   spine `.atlas`'s page refs + a skeleton's atlas ref resolve), write `index.json` (sprite
   sheets, images, spine bundles with their atlas/skeleton/scale). Prune stale; idempotent.
2. **Trigger** — `POST /api/editor/export-symbols?project=<key>&k=<token>` (same deploy-token
   gate as `export-art` / `export-fonts`). `bake-editor-doc.mjs` calls it alongside the
   other exports and embeds the returned `{ map, index }` as `bundle.symbols`.
3. **Bake** — `baked-editor-bundle.json` gains a `symbols?: { map, index }` field
   (`editor-scenes.ts`'s `BakedBundle` type).
4. **Pull** — `pull-project-assets.mjs` already mirrors ALL of `deploy/` → `static/assets/`;
   just add `editor-symbols/` to its prune-aware list. ⚠ Same build-order rule: `bake:doc`
   BEFORE `pull:assets`.
5. **Register** — `bakedSymbolAssets()` + `bakedSymbolMap()` above.

## The tool UI (`/symbols`, "Invisible Symbols State Machine")

- Auth gate + client/project selector + tool top bar — REUSE existing launcher helpers
  (run `/reuse-check` before building any of these surfaces).
- Grid: rows = symbols, columns = the 6 states. Each cell shows a **live preview** of the
  current binding (sprite frame or spine animation playing), mirroring the debug overlay.
- Click a cell → open the **R2 asset library picker** (same component the editor uses) to
  choose a sprite-sheet frame or a spine bundle; for spine, choose `animationName`; edit
  `sizeRatios` (numeric, minimal in v1).
- Save → write `symbols.json` to R2. A "Deploy" affordance can call the export, consistent
  with how the editor triggers art export.

## Build plan (ordered)

- **S1 — Engine contract.** `symbolMap.ts` + `getSymbolInfo` reads the merged map;
  `bakedSymbolMap()` / `bakedSymbolAssets()` stubs in `editor-scenes.ts` (return
  `undefined`/`{}` until the bundle carries `symbols`); `BakedBundle.symbols` type;
  `stateApp.ts` spread. **Pure parity** — no behaviour change until a doc is baked. Verify
  the game renders byte-identical.
- **S2 — Doc schema + R2 read/write + server.** `symbols.json` schema (Zod, shared),
  project path helper (`projectPaths.ts#symbolsDocKey`), `GET/PUT` doc endpoints.
- **S3 — Tool page.** `/symbols` grid UI with live previews + library picker + save.
- **S4 — Export + bake + pull (spine-aware).** `symbolExport.ts`, `export-symbols`
  endpoint, `bake-editor-doc.mjs` wiring, `pull-project-assets.mjs` prune entry.
- **S5 — Prove end-to-end** on Book of Borut: rebind a symbol state online → `pnpm build`
  → republish → new asset/animation shows in the game.

## Open decisions

- **Symbol set discovery** — v1 reads the fixed `apps/lines` symbol set. A later version
  should read the project's actual symbol set from the engine-truth import (mirrors how
  `defaultLayout('lines')` imports the basegame).
- **Per-game `getSymbolInfo`** — each `apps/<game>/src/game/utils.ts` has its own copy;
  S1 lands in `apps/lines` first, then mirrors into Book of Borut (record-every-engine-change
  rule) and the other reference games.
- **Spine in editor-art convergence** — once spine export exists here, the editor-art
  exporter's parked spine support (live-assets.md open decision) can share this code.
