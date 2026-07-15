# Invisible Symbols State Machine — status

> Design: [docs/design/invisible-symbols-state-machine.md](../design/invisible-symbols-state-machine.md) · Guide: [docs/tools/symbols-state-machine.md](../tools/symbols-state-machine.md) · Agent: _none yet — no `.claude/agents/symbols.md`; closest is `book-of-game` / `engine-pixi-svelte`_

**One-line state:** Shipped — S1–S4 (engine contract, doc schema + endpoints, `/symbols` tool page, export→bake→pull chain) are on `main`; S5 (prove the full round-trip end-to-end on Book of Borut) is still the open piece.

## Current state
This is the **`/symbols` launcher tool** (registry "Invisible Symbols State Machine", bar
name "Symbols SM") — the online, editable twin of the in-game Symbol Debug grid. It is
**NOT** the in-game state machine itself; it authors a sparse `symbol × state → asset`
override doc (`<client>/<project>/symbols/symbols.json`) that the engine merges over each
game's coded `SYMBOL_INFO_MAP`. Un-baked repos render byte-identical to today.

Working on `main`:
- **The tool page** (`/symbols`, `(app)` route, `ssr = false`, auth + role gate;
  `admin`/`developer`/`artist` by default). Grid = symbols × the six states (`Static`,
  `Spin`, `Land`, `Win`, `Post-win`, `Explosion`). Each cell shows its effective binding
  (override or coded default): sprite frame thumbnail, or a live spine animation on the
  shared canvas. Cell editor toggles Sprite/Spine, uses the editor's `RegionPicker` /
  spine-bundle picker, edits are sparse overrides with per-cell reset (↺) + edited badge.
- **Save** — `PUT /api/editor/symbols` to R2 with dirty tracking.
- **↻ Reload from R2** — re-fetches spine bundles + previews and re-reads the project's
  bundle list, dropping the per-bundle skeleton/page HTTP cache so a re-rigged (Invisible
  Rigger) or replaced bundle shows its new art + animation names; unsaved edits preserved.
- **Per-project defaults auto-publish** — each game publishes its coded `SYMBOL_INFO_MAP`
  to R2 at build (`publish-symbol-defaults.mjs`, chained into `build` by `new-game.mjs`);
  the tool reads it, **filtered to the in-play set** from `src/game/config.ts` (drops dead
  rows like an unused `H5`). Un-published projects / `apps/lines` dev fall back to the
  committed `lines.json`.
- **Symbol export scans ALL atlases for bound frames** (2026-07-06 fix, `7c94f4f`) —
  `exportEditorSymbols` breaks only once every bound frame name is actually covered, not on
  a running region-count compare, so a frame that lives only in a later atlas
  (`S_Game_Reel`) no longer ships blank.
- **Live rig-timeline FX preview matching the game** — `SymbolSpineStage` fires an
  fx-bound symbol's particle effect on the beat of its animation, riding the bound bone via
  the shared `fxOverlay.client.ts` factory (same core as the Rigger overlay; binding from
  `/api/editor/rig-fx`). The overlay applies the **full bone transform** (position +
  rotation + per-axis scale via `setFromMatrix` / `FxTransform`), so `/symbols`, `/rigger`,
  and the running game agree on rotated/scaled bones. ⏳ owner visual-verify.
- **Doc-level globals** (design §S6): `highlight` (win-frame spine, sparse, spine-only,
  default = built-in `payframe`) and `winLine` (payline overlay on/off + line/text style,
  sparse config, no asset). Both travel verbatim through `symbolExport.ts` →
  `bake-editor-doc.mjs` → `bundle.symbols.*`. The `winLine` renderer was ported into the
  **shared engine** (`apps/lines/components/WinLine.svelte` + `bakedWinLineConfig()`,
  `806d6cf`), so every `runtime:lines` game draws it (default-on) — Book of Borut _remake_
  now included. ⏳ owner confirm the drawn line on a real win.
- **Full deploy chain** (export → `deploy/editor-symbols/` → bake → pull → register):
  spine-aware `symbolExport.ts`, `POST /api/editor/export-symbols`, `bake-editor-doc.mjs`
  wiring, `pull-project-assets.mjs` prune entry, `bakedSymbolMap()` / `bakedSymbolAssets()`.
- **Symbol size is NOT authored here** — it moved to `reelGrid.symbolSizeRatios` on the
  reel, edited in the Scene Editor; a baked per-cell `sizeRatios` is honoured for back-compat
  reads only.

## Open items / next
1. **S5 — prove end-to-end on Book of Borut.** Mirror the S1 engine contract
   (`symbolMap.ts` / `getSymbolInfo`) into Book of Borut's own `src/game/*`, keep symbol
   frame names unique across bound sheets, verify the shared-spine fallback, then actually
   rebind a symbol online → tokened rebuild → republish → confirm the new asset/animation
   in-game.
2. **Preview endpoints are still `editor`-gated** (`/api/editor/regions`, `/api/editor/spine`)
   — a user holding **only** the `symbols` tool gets a 403 on previews. Default roles hold
   both, so it only bites a narrowly-scoped role.
3. **Default-art cells render as placeholder chips until project assets are seeded into R2**
   (sprites under `sheets/`/`manifests/`, spines under `spines/`). Spine *default* cells stay
   chips regardless — only a rebind stores a full bundle prefix that previews.
4. **No dedicated `symbols` agent file** — `.claude/agents/symbols.md` does not exist
   (see the four-surfaces model in `docs/status/README.md`).

## Blocked (owner / external)
- Several items above are ⏳ owner visual-verify (FX full-transform parity across
  `/symbols` / `/rigger` / game; the win-line drawing on a real win).

## Recent changes
- 2026-07-14 — Win-line renderer ported into the **shared engine** so `runtime:lines` games (incl. Book of Borut remake) draw it ([detail in history](../history.md)).
- 2026-07-14 — Rig FX in `/symbols` + Rigger overlay upgraded to the **full bone transform** to match the game ([detail in history](../history.md)).
- 2026-07-13 — `/symbols` stage gained **live rig-timeline FX preview** (parity with the Rigger) ([detail in history](../history.md)).
- 2026-07-06 — Symbol export now **scans all atlases for bound frames** (fixes new icons rendering blank, `7c94f4f`) ([detail in history](../history.md)).
