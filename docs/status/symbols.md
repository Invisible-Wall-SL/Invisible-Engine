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
  (override or coded default): sprite frame thumbnail, a live spine animation on the
  shared canvas, or a flipbook clip's first frame. Cell editor toggles
  **Sprite / Spine / Flipbook**, uses the editor's `RegionPicker` / spine-bundle picker /
  clip picker; edits are sparse overrides with per-cell reset (↺) + edited badge.
- **Save** — `PUT /api/editor/symbols` to R2 with dirty tracking.
- **↻ Reload from R2** — re-fetches spine bundles + previews and re-reads the project's
  bundle list, dropping the per-bundle skeleton/page HTTP cache so a re-rigged (Invisible
  Rigger) or replaced bundle shows its new art + animation names; unsaved edits preserved.
  Now **also clears the module-level region cache** (`clearRegionCache()`) so the SPRITE
  path's rects/page keys re-resolve too — previously a re-authored sheet stayed stale on
  sprite cells (and the Scene Editor, which shares that cache) until a hard page reload.
- **Regenerated-sheet self-heal (2026-07-21).** Spine cells read geometry through the rig
  bundle's FROZEN `.atlas`, so a re-packed sheet used to show old rects until the rig was
  manually `⟳ Re-sync`ed. `resolveEditorSpine` now calls `ensureBundleAtlasFresh`
  (`$lib/server/spineBundleSync.ts`), which re-derives the bundle `.atlas` + page from the
  live manifest when a **revision** (geometry hash + page ETag in the bundle's `source.json`)
  drifts — geometry (Sheet-Maker re-pack) AND art (Atlas-Maker recolour) now propagate to
  the grid with no manual step. The same helper runs at bake so the shipped game matches.
  See [docs/status/rigger.md](rigger.md).
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
- **Highlight tint** (2026-07-27, default = no tint). The `highlight` cell gained two sparse
  fields on its dedicated schema — `tintMode: 'fixed' | 'winLine'` and `tintColor` (`#rrggbb`,
  `fixed` only) — a MULTIPLY tint the win-frame overlay applies to the winning symbols.
  `fixed` uses the authored swatch; `winLine` picks up each paying line's colour from the game
  config's `paylineColors` (resolved at win time, so no bake dependency). The `/symbols`
  highlight editor gained a "Tint" mode select + a colour picker (shown for `fixed`). Runtime:
  a new `tint?: number` prop on pixi-svelte `BaseSpineProvider`/`SpineProvider` applies it via
  the spine `skeleton.color` (multiply, NOT sprite `.tint`); `SymbolSpine.svelte` resolves the
  number from `tintMode`. The per-win line colour is threaded to the frame through
  `animateSymbols({color})` → `boardWithAnimateSymbols.winLineColor` → the reel cell
  (`utils-slots` `winLineColor`) → `ReelSymbol`/`Symbol` → `SymbolSpine` (coded `winInfo`, the
  post-win replay, and the flow-v2 `animateWinSymbols` leaf all pass it). Threaded the full
  chain per rule 8: Zod (`.strict`) + client type/`setHighlight`/`docSignature`/PUT body →
  `SymbolExportHighlight` → `bake-editor-doc.mjs` whitelist → `BakedBundle.symbols.highlight`
  → `bakedHighlight()`. Verified offline against the schema (accept+preserve both modes,
  `.strict` rejects unknown keys, bad hex/mode rejected) + the bake whitelist; `pixi-svelte`,
  `lines`, and `launcher-api` all build clean. ⏳ owner visual-verify a tinted win frame + a
  `winLine`-tinted frame on a multi-colour-payline config. **Engine change — needs a Borut
  submodule bump + runtime release to reach the remake.**
- **Doc-level globals** (design §S6): `highlight` (win-frame spine, sparse, spine-only,
  default = built-in `payframe`) and `winLine` (payline overlay on/off + line/text style,
  sparse config, no asset). Both travel verbatim through `symbolExport.ts` →
  `bake-editor-doc.mjs` → `bundle.symbols.*`. The `winLine` renderer was ported into the
  **shared engine** (`apps/lines/components/WinLine.svelte` + `bakedWinLineConfig()`,
  `806d6cf`), so every `runtime:lines` game draws it (default-on) — Book of Borut _remake_
  now included. ⏳ owner confirm the drawn line on a real win.
- **Show full payline** (2026-07-27, default OFF). `winLine.line.fullPayline` +
  `line.fullPaylineColor` (coded default `#4a90d9`): when on, the line is traced across the
  WHOLE payline (all reels) as a static underlay beneath the winning segment, in the chosen
  colour; off ⇒ winning segment only (byte-identical). Rides `winLine.line` verbatim through
  export/bake; the renderer gets the full path as `winLineShow.fullPoints`
  (`flowEffects#winLineFullPointsFor`, gated on the flag), fed by BOTH the coded `winInfo`
  handler and the post-win replay. ⏳ owner visual-verify.
- **Winning SYMBOLS keep animating until the next spin** (2026-07-24, default ON). Doc-level
  `winCycle: { enabled?, delay?, showLine? }` (seconds, default `0.4`) authors the engine's
  `winSymbolCycle`: once a round's book is fully presented the game re-lights that spin's
  winning cells via the same `animateSymbols` leaf the round used, until the next bet stops
  it — **stepping through the paying lines one at a time** in book order and looping back to
  the first (`delay` is the gap between lines). The wins are ACCUMULATED across a spin's
  `winInfo` events, deduped: the reference books put every win in one event, but the
  Play4Fun facade the shipped games run on flushes one event per win, and assigning kept
  only the last line there. **The line rides along by default** — `showLine` (tool switch
  "Replay the win line too", default ON) draws each win's line + stamped amount on its pass,
  cleared between passes and on stop; off ⇒ symbols only, and the cycle then emits no line cues
  at all. `winLineEnabledForWin` is the shared gate, so the Win-lines toggle still has the final
  say and a scatter win lights symbols with no line. Its OWN section in the tool ("Winning
  symbols after the spin"), NOT a `winLine` field, so switching the overlay off can never stop
  the symbols. **`showText` (2026-07-27, default ON, tool switch "Replay the win text too")
  decouples the stamped amount from the line:** with `showLine` on, `showText` off keeps the
  line replaying but drops the win-amount text (the cycle sends empty strings, so `WinLine`
  draws the line with no stamp). Independent switches; unset ⇒ both on (prior behaviour).
  **`showMessage` (2026-07-27, default OFF, tool switch "Replay the win message too")** re-shows
  that win's info toast ("You win $X with N Bananas", `messageKind: 'win'`) on each replay pass —
  the toast riding along with the symbols, just as the line/amount do. UNLIKE its siblings it
  defaults OFF and persists sparsely on the ON state (the toast never replayed before this switch,
  so an unset project stays byte-identical — the message shows once at the round's first
  presentation). Independent of `showLine` (it is the toast, not the line). Consumed in
  `winSymbolCycle.ts` via `showWinInfoMessage`; travels the full chain (client setter/accessor,
  `.strict` schema, sparse sanitize, `bake-editor-doc.mjs` whitelist all inverted for default-OFF).
- **Darken the non-winning symbols** (2026-07-27, default OFF, tool switch "Darken the
  non-winning symbols" in the "Winning symbols after the spin" section). `winCycle.dimNonWinning`:
  from the win celebration until the next spin, every symbol that is NOT part of a paying line is
  drawn darkened (Pixi v8 `Container.tint = 0x666666` on `SymbolWrap`, cascading to the sprite /
  spine / flipbook child), so the winning line stands out. Driven from
  `winSymbolCycle.recordWinCycleWins`: a `winInfo` refreshes the lit set to the round's paying
  cells (`refreshWinDim` → `stateGame.winDim`), a `reveal` (the next spin) clears it, so a losing
  spin's board is full-bright. Read by `ReelSymbol` (`stateGame.winDim.active && !cells[reel:row]`).
  **Independent of `enabled`** — the dim is a property of the whole board, not the replay, so its
  tool toggle sits outside the replay's `enabled` gate and applies even with the replay off.
  Persists sparsely on the ON state like `showMessage` (default-OFF ⇒ byte-parity: `SYMBOL_DIM_TINT`
  const, `.strict` schema field, sparse sanitize, verbatim through `symbolExport.ts`). Tint cascade
  verified live in the dev bundle (`_Container.tint` → child `_Spine.groupColor`); ⏳ owner
  visual-verify on a real winning spin.
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

- 2026-07-27 — **Two owner-requested win-line options, wired end-to-end.** (A) **"Show full
  payline"** in the Win lines section — `winLine.line.fullPayline` (bool, default OFF) +
  `line.fullPaylineColor` (coded default `#4a90d9`): draws the WHOLE payline across all reels as
  a static underlay beneath the winning segment. Rides `winLine.line` verbatim through
  export/bake; both the coded `winInfo` handler and the post-win replay pass the full path as
  `winLineShow.fullPoints` via `flowEffects#winLineFullPointsFor` (gated on the flag), and
  `WinLine.svelte` strokes it complete under the animated winning line. (B) **"Replay the win
  text too"** in the "Winning symbols after the spin" section — `winCycle.showText` (bool,
  default ON) decouples the stamped amount from the line so the author can keep the line
  replaying without the number; `winSymbolCycle.ts` sends empty strings when off (`WinLine`'s
  label is now gated on non-empty text). **Two latent bake-path bugs fixed on the way past:**
  (1) `POST /api/editor/export-symbols` was dropping `winCycle` AND `names` from its response
  destructure, so the win-symbol replay settings and symbol display names never reached the
  BAKE path (only the live runtime path, which uses the full `SymbolExportResult`, carried
  them) — both now forwarded; (2) `bake-editor-doc.mjs`'s winCycle whitelist tested
  `showLine === true`, inverted for the default-ON/sparse-off semantics, so a project that
  switched the line replay OFF re-enabled it through a bake — now `=== false` (and `showText`
  matches). Verified: `pnpm --filter launcher-api build` + `pnpm --filter lines build` green;
  14/14 offline checks over the REAL `normalizeSymbolsDoc` (fullPayline/fullPaylineColor +
  showText round-trip, sparse-default pruning, `.strict` rejects unknown keys). ⏳ **Owner
  visual-verify** (auth-gated tool + the drawn line on a real win). **Book of Borut (separate
  repo) needs an engine-submodule bump** to pick up the shared-engine renderer changes.

- 2026-07-24 — **`/symbols` never SAVED any `winCycle` setting** (found when an author flipped "Replay the win line too" on and Save put it back): `saveSymbolsDoc` in `symbols.client.ts` built the PUT body from a hand-copied field list (`version`/`symbols`/`highlight`/`boardGlow`/`winLine`), so the whole `winCycle` object — replay on/off, gap AND `showLine` — never left the browser; the server echoed a doc without it and the UI reset. The three older fields only survived because they predate the list. Fixed by spreading the doc (`{...doc, version: 1, …envelope}`) instead of enumerating it — the server re-validates and rebuilds from its own whitelist (`normalizeSymbolsDoc`, schema `.strip()`), so extra keys are harmless and a future doc-level field can't rot the same way. This is the third instance of the hand-copied-allowlist trap in this app (see `launcher-api/CLAUDE.md`); the guard is a Node fixture that stubs `fetch`, calls the REAL `saveSymbolsDoc` and feeds the captured body to the REAL `normalizeSymbolsDoc` — the earlier fixture only tested the server half, which is why this slipped through. `showLine` also flipped to **default ON** (owner request), so sparse persistence now keeps only the OFF.


- 2026-07-24 — **Symbols carry a DISPLAY NAME** (`names: { H1: { singular, plural } }`), authored
  in two boxes under each row's id. This tool already owns what a symbol *is*, so it now also owns
  what the game **calls** it: Invisible Win Text prints it as `{symbolName}`, which is what let win
  messages stop saying "3 of a kind" (a symbol id is unspeakable, so the match count was the only
  thing the text could state). Rename here → every win sentence follows, no template edit. Both
  forms are authored, never derived (`+s` gives "Cherrys" and means nothing translated); unset
  plural reuses the singular; an unnamed symbol falls back to its id. Shared resolution lives in
  `engine-layout/symbolNames.ts` (game + `/symbols` + `/win-text` — one answer). Assetless, sparse,
  full chain per rule 8: Zod + `normalizeSymbolsDoc` (blank-form pruning) → client type/setter/
  `docSignature` → `SymbolExportResult.names` → `bake-editor-doc.mjs` → `BakedBundle.symbols.names`
  → `bakedSymbolNames()` → `flowEffects`. **Found on the way past: `winCycle` was missing from the
  bake whitelist entirely** — the runtime-bundle path carried it, the bake path didn't, so a
  project that switched the win-symbol replay off shipped it ON through a bake. Both now carried.
  Also declared `winCycle` on the client `SymbolsDoc` type, which the helpers had been using
  without it (a type error the launcher build never checks). 26 offline checks:
  `node packages/engine-layout/scripts/test-win-text-symbol-names.mjs`. ⏳ **Owner visual-verify** —
  auth-gated, so the row-head boxes weren't browser-driven.

- 2026-07-20 — **Flipbook is a third binding kind in `/symbols`.** A `sprite` cell is ONE frozen frame, so Spine was previously the only way to animate a Spin/Land/Win state; an Invisible Flipbook clip (ordered, timed atlas frames) is far cheaper and is the fallback for the Tier-C spine-particle perf ceiling in `docs/status/fx.md`. The schema/engine side (`symbolCellSchema.type` widened to `'sprite'|'spine'|'flipbook'` + optional `clipId` + a `.refine()` rejecting a clip-less flipbook cell; `SymbolCellInfo`; `SymbolFlipbook.svelte` + the `Symbol.svelte` dispatch; `collectSymbolRefs` skipping flipbook cells) landed separately — this change is the **authoring UI** against it. `+page.server.ts` now also loads `listClips(clientKey, projectKey)` and returns it as `data.clips`. The cell panel's type toggle is generated from ONE exported runtime value (`SYMBOL_CELL_TYPES` in `symbols.client.ts`) rather than a hand-written pair of buttons — the `COMPONENT_PARAM_KINDS` precedent, because the launcher build transpiles TS without checking it. Picking a clip sets `type`/`clipId`/`assetKey` (the clip's PRIMARY sheet) together, so a flipbook cell is never assetless and every consumer reading `assetKey` keeps working. **Switching kind clears the fields that no longer apply** (`animationName` leaving Spine, `clipId` leaving Flipbook) and `applyDraft` rebuilds the cell field-by-field as a whitelist, so `.strict()` + `.refine()` cannot reject a save the author thinks is valid. With no clips in the project the Flipbook button is disabled with a `/flipbook` pointer instead of an empty select. Previews are STILL first frames, not players — grid cells caption the clip name + frame count (a deleted clip reads `<clipId> (missing)`), and the panel shows a 120px still; N per-cell tickers would cost far more than the one shared spine canvas, and scrub playback belongs to `/flipbook`. ONE storage change: `FlipbookClipRow` gained `assetKey` + `firstFrame`, both read from the JSON `listClips` already parses. Verified: `svelte/compiler` on the page reports **0 warnings** (3 pre-existing dead-CSS selectors removed to get there), `tsc --noEmit` on `launcher-api` is **0 errors**, `pnpm --filter launcher-api build` green, all five `flipbook-spike` fixtures pass, and an offline Node fixture over the REAL `normalizeSymbolsDoc` confirms the flipbook cell round-trips, a clip-less flipbook cell is refused, and `previewKey` is still refused by `.strict()`. ⏳ **Owner visual-verify** — the page is auth-gated so the picker/preview was not browser-driven.

- 2026-07-20 — **The coded defaults now preview instead of showing a "can't be previewed" placeholder.** Both built-in defaults — the free-spin board glow (`reelhouse`) and the highlight win frame (`anticipation`/`payframe`) — ship as LOCAL game assets, so `/api/editor/spine` (R2-only) could never resolve them and the panels rendered a dashed placeholder unless the project happened to carry a same-named R2 bundle. The launcher now vendors both spines under `apps/launcher-api/static/builtin/spines/` (~965 KB: skeleton `.json` + `.atlas` + `.webp`), and `editorSpine.client.ts` resolves a `builtin:<id>` key by synthesizing the descriptor `/api/editor/spine` would have returned — page names parsed from the atlas's own un-indented image lines, `pma` from the same `^pma: true$` header rule the server index uses, so a built-in renders byte-identically to the R2 path (no premultiply/halo divergence). One shared `resolveBuiltinBundle()` drives BOTH panels and still **prefers a real R2 bundle** when one matches, so a project carrying its own copy is unaffected. The placeholder branch is kept as a defensive fallback (its copy now says the coded default still ships and renders in-game). Verified live via the real loader on the dev launcher: `loadSpineInstance('builtin:reelhouse')` → the three `reelhouse_glow_*` animations + `reelhouse_glow.webp` page; `builtin:anticipation` → 16 animations incl. `payframe`; an unknown builtin id returns `null` (no crash). Note this is a launcher-only asset copy — it does NOT change what a game ships. ⏳ **Owner visual-verify** of the rendered panel (auth-gated, so the WebGL canvas itself wasn't browser-driven).

- 2026-07-16 — **Free-spin board glow is swappable in `/symbols`** (owner-requested: "a session in the symbol state machine where I can change the art/irig used"). New optional doc field `boardGlow: { type:'spine', assetKey, animations?: {start,idle,exit}, sizeRatios? }`, modelled on `highlight` (the existing non-per-symbol global). A **Free-spin board glow** panel sits between Highlight and Win lines, reusing the highlight's bundle `<select>` + `SymbolSpinePreview` (no new picker). `BoardFrame.svelte`'s five hard-coded literals (`key="reelhouse"`, the three `reelhouse_glow_*` names, `SPINE_SCALE`) became sparse reads off a new `bakedBoardGlow()` — each unset field falls through to its coded constant, so an un-authored game is byte-identical. The engine still OWNS the start→idle→exit chaining and the timing (the author swaps WHAT plays, not the sequence). **`.irig` rigs work here for free** — the bundle rides `refs.spineKeys` → `exportSpineBundle`, which already renames a Rigger `.irig` skeleton to `.json` (the PIXI parse-by-extension crash). Threaded the full chain per rule 8: Zod + `normalizeSymbolsDoc` copy → client type/setters/`docSignature`/`saveSymbolsDoc` body → `collectSymbolRefs` + `SymbolExportResult` → `export-symbols` endpoint → `bake-editor-doc.mjs` (defaults + response parse) → `BakedBundle.symbols` → `bakedBoardGlow()` → `BoardFrame`. `pull` needed nothing (reuses `editor-symbols`). Verified offline against the REAL schema + normalizer (10/10: full + art-only-sparse round-trip, parity emits no key, `.strict()` rejects unknown key / non-spine / missing / empty assetKey), **mutation-tested** — dropping the `normalizeSymbolsDoc` copy makes it fail, which is the silent-drop trap this repo has hit before. Both apps build clean. ⏳ **Live-verify pending** — the panel is auth-gated so it wasn't browser-driven; needs a real rig picked + saved + baked + a runtime release.

- 2026-07-24 — Winning **symbols** now **keep animating on the resting board until the next spin**, stepping through a multi-line spin's paying lines one at a time (`winSymbolCycle`, authored via the doc-level `winCycle`; default on; the line/amount are NOT replayed) ([detail in history](../history.md)).
- 2026-07-14 — Win-line renderer ported into the **shared engine** so `runtime:lines` games (incl. Book of Borut remake) draw it ([detail in history](../history.md)).
- 2026-07-14 — Rig FX in `/symbols` + Rigger overlay upgraded to the **full bone transform** to match the game ([detail in history](../history.md)).
- 2026-07-13 — `/symbols` stage gained **live rig-timeline FX preview** (parity with the Rigger) ([detail in history](../history.md)).
- 2026-07-06 — Symbol export now **scans all atlases for bound frames** (fixes new icons rendering blank, `7c94f4f`) ([detail in history](../history.md)).
