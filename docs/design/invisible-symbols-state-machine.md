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
  edits bindings within that fixed grid). NOTE: the **global highlight** below is the one
  global binding now authorable on top of the fixed grid — it is not per-symbol-per-state.

## Symbol size lives on the reel (moved out 2026-06-18)

Symbol render size is **NOT** a Symbols State Machine concern. A short-lived global
`defaultSizeRatios` field on the symbols doc was added then **removed**: size is a *layout*
concern, so it now lives on the reel's `reelGrid.symbolSizeRatios` and is edited in the
**Scene Editor** — see
[`docs/design/invisible-editor.md`](./invisible-editor.md) ("Symbol size on the reel"). This
tool is once again only about *which asset maps to each symbol×state*.

- **Where size lives now:** `ReelGridNode.symbolSizeRatios?: { width, height }` on the layout
  doc (`scenes.json`), edited via the reel's "Symbol size (× cell)" control in the Scene
  Editor's `EditorProperties`. `1` = the art fills one reel cell; absent ⇒ the game's coded
  per-symbol sizes (parity). It travels on the layout doc like every other reelGrid field —
  no symbols-doc involvement and no bake step beyond the normal scene bake.
- **Back-compat only on the symbols side:** the per-cell `SymbolCell.sizeRatios` field stays
  **optional** purely for back-compat *reads* — the engine's size resolver still honours a
  baked per-cell override ahead of the reel value — but the Symbols State Machine no longer
  **authors** size at any level (the size panel + per-cell size inputs were removed,
  `f555e8d`/`a2f3cef`).
- **Resolution order (at render):** baked per-cell `sizeRatios` (legacy override) > reel
  `reelGrid.symbolSizeRatios` > coded `SYMBOL_INFO_MAP` size > `{ width: 1, height: 1 }`.
- **Scope reality.** cluster / scatter / ways / price keep self-contained `SYMBOL_INFO_MAP`s
  and don't use the baked symbols pipeline. Book of Borut (separate repo, lines/`bookOf`
  stack) takes the reel-size render path when it bumps the engine submodule.

## Global highlight (win frame) — added 2026-06-17

Separate from the per-symbol `symbols` map, the doc carries ONE optional global binding:
the **highlight** — the win-frame spine that loops over winning symbols (today the game
hardcodes a local spine named `payframe`, spine key `anticipation`).

```jsonc
{
  "version": 1,
  "symbols": { /* … */ },
  "highlight": { "type": "spine", "assetKey": "<full R2 bundle prefix>", "animationName": "<loop anim>" }
}
```

- **Optional + spine-only.** Absent → the game keeps its built-in `payframe`. The tool
  shows the built-in default as a non-editable **Default (payframe)** placeholder (it's a
  LOCAL game asset, not in R2, so it can't be previewed) and lets the user override it
  with an R2 spine bundle via the SAME spine library picker the grid cells use.
- **Contract field (end to end):** `highlight?: { type: 'spine'; assetKey; animationName }`
  on `SymbolsDoc` (schema in `symbolsStorage.ts`). The coded default is represented on
  `SymbolDefaults.highlight` (`symbolDefaults.ts` + `lines.json`) for the "current =
  default" display only — never forced into an override.
- **Export/bake.** `symbolExport.ts` adds the highlight's `assetKey` to the spine bundles
  it copies into `deploy/editor-symbols/` (so it's in `index.spines`, keyed by the same
  `assetKey`), and returns a `highlight: { assetKey, animationName }` pointer.
  `bake-editor-doc.mjs` embeds it at `bundle.symbols.highlight`. The game loads the spine
  by `assetKey` like any per-symbol spine; an un-overridden project ships no `highlight`
  and renders byte-identical to before.

## Win-line overlay config — added 2026-06-17, styling added 2026-06-18

Alongside the highlight, the doc carries ONE more optional global setting: the **win-line
overlay** config — the line traced across each winning payline, with the win amount stamped
under its end. It started (2026-06-17) as a plain on/off flag and was widened (2026-06-18)
to also carry line + text **style**. It is still **pure config — no asset, no preview**
(the chosen text font travels via the existing font pipeline, not here).

```jsonc
{
  "version": 1,
  "symbols": { /* … */ },
  "winLine": {
    "enabled": false,                       // present ONLY when turned OFF
    "line": { "color": "#ff3366", "width": 0.04, "glow": true, "glowColor": "#ff88aa",
              "animated": true, "speed": 1.5 },
    "text": { "font": "silver", "size": 0.6, "color": "#ffffff" }
  }
}
```

- **Contract field (end to end):** `winLine?: { enabled?; line?; text? }` on `SymbolsDoc`
  (schema in `symbolsStorage.ts`; client type + sparse setters in `symbols.client.ts`).
  Every field is optional; the EFFECTIVE on/off is `doc.winLine?.enabled ?? true` and each
  style field falls through to the game's coded default. Colours are CSS hex strings
  (Pixi 8 `ColorSource`); `line.width`/`text.size` are multiples of `SYMBOL_SIZE`;
  `line.speed` scales the animated-draw duration.
- **Sparse on purpose.** Default (on, default style) writes nothing. Only the off-state
  (`enabled: false`) and the individual fields the author changes are persisted; "Reset
  win-line style" clears `line`/`text`; turning the toggle back on clears `enabled`.
- **Export/bake.** `symbolExport.ts` passes `winLine` straight through verbatim (no asset);
  `bake-editor-doc.mjs` embeds it at `bundle.symbols.winLine`, OMITTING it when absent.
- **Renderer (per-game).** Book of Borut's `WinLine.svelte` reads the resolved config via
  `editor-scenes.ts#bakedWinLineConfig()` (coded defaults applied) — line colour/thickness,
  an optional layered-stroke glow, an optional `svelte/motion` `Tween` draw (first→last,
  *then* the amount), and the bitmap win-amount text (`style.fill` tint). The win-line
  draw is awaited via `broadcastAsync` so an animated line completes before the symbol
  glow; non-animated resolves instantly, preserving the original timing. `apps/lines` has
  no win-line renderer (symbol-glow win model) — it carries the contract TYPE only, so an
  untouched project is byte-identical to before and the overlay stays on.

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
      "static": { "type": "sprite", "assetKey": "h1.webp" },
      "win":    { "type": "spine",  "assetKey": "H1", "animationName": "h1" },
      // sizeRatios is OPTIONAL on a cell (back-compat reads only; size is now set on the
      // reel — reelGrid.symbolSizeRatios in the Scene Editor). One entry per authored
      // state; unset states fall through.
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
- **S6 — Global config (post-v1).** The doc-level globals authored on top of the fixed grid:
  `highlight` (2026-06-17) and `winLine` (2026-06-17, styled 2026-06-18) — see their sections
  above. Each is sparse (absent = byte-identical to before), forwarded verbatim through
  `symbolExport.ts` → `bake-editor-doc.mjs` → `bundle.symbols.*`, and consumed by the per-game
  engine accessor (`bakedWinLineConfig()`). The `apps/lines` render-side mirror has landed;
  Book of Borut needs the same mirror as a follow-up (bump the engine submodule for the
  launcher/bake changes). (Symbol *size* was briefly a doc global here too —
  `defaultSizeRatios` — but it has since moved to `reelGrid.symbolSizeRatios` on the reel,
  edited in the Scene Editor; see "Symbol size lives on the reel" above.)

## Per-project defaults — automatic publish (added 2026-06-12)

The grid is scaffolded from each game's coded `SYMBOL_INFO_MAP` (the symbol list, the 6
states, every cell's default binding). The launcher is cloud and can't import a game's
source, so — like every other asset class — the game **publishes** its map to R2 and the
tool reads it. No hand-maintained per-game JSON.

1. **Publish (game build)** — `apps/launcher-api/scripts/publish-symbol-defaults.mjs` imports
   the game's `SYMBOL_INFO_MAP` (under `node --experimental-strip-types`, since it's a TS
   module with computed ratios) and `PUT`s `{ version, gameType, symbols }` to
   `POST`-sibling `PUT /api/editor/symbol-defaults?project=&k=` (deploy-token gated). The
   endpoint writes `<client>/<project>/symbols/defaults.json`. `--optional` keeps a build
   green when un-tokened (mirrors `bake:doc`/`pull:assets`).
2. **Scaffold (automatic for new games)** — `scripts/new-game.mjs` adds a `publish:symbols`
   script and chains it into `build` (`… && pnpm publish:symbols --optional && vite build`),
   so every new game publishes its symbol map on build with zero per-game wiring.
3. **Read (tool)** — `symbols/+page.server.ts` prefers `loadPublishedSymbolDefaults(...)`
   (R2) and falls back to the committed `symbolDefaultsFor(gameType)` (`lines.json`) for an
   un-published project or `apps/lines` dev. So Book of Borut shows ITS symbols once it has
   built once with a deploy token; an un-published project shows the coded `lines` set.

`lines.json` stays committed as the offline fallback / dev parity.

## Seeding a game's symbol assets into R2 (so previews render)

The tool previews ONLY from R2, under the per-project prefixes `listProjectAssets` scans:
sprites → `sheets/` + `manifests/`, spines → `spines/`. A game's BASE symbol art lives in
its repo (`static/assets/…`), not those prefixes, so default cells render as placeholder
chips until the art is seeded. Two sibling syncs (run from the engine repo with `R2_*` creds):

- **Sprites** — `apps/launcher-api/scripts/r2-sync-sheets.mjs <spritesDir> <client> <project>`
  uploads each TexturePacker sheet folder to `<client>/<project>/sheets/<folder>/`.
  `loadRegionSet` reads the TexturePacker JSON directly + resolves the page beside it, so a
  game's own `symbolsStatic` (frames `h1.png … w.png`) becomes previewable with no re-author.
- **Spines** — `apps/launcher-api/scripts/r2-sync-spines.mjs <spinesDir> <client> <project>`
  uploads bundles + writes the `skeletons.json` index. (Spine *default* cells still render as
  chips — the coded map's short keys like `H1` aren't R2 bundle prefixes; only a rebind, which
  stores the full bundle prefix, gets a live preview.)

## Open decisions

- **Existing standalone games must build once to publish.** Book of Borut (and any game that
  predates this) needs (a) the S1 engine contract mirrored in (its own `src/game/*`), and
  (b) one tokened build (or a manual `publish:symbols` run) to populate
  `symbols/defaults.json`. New games get it from the scaffolder automatically.
- **Per-game `getSymbolInfo`** — each `apps/<game>/src/game/utils.ts` has its own copy;
  S1 lands in `apps/lines` first, then mirrors into Book of Borut (record-every-engine-change
  rule) and the other reference games.
- **Spine in editor-art convergence** — once spine export exists here, the editor-art
  exporter's parked spine support (live-assets.md open decision) can share this code.
