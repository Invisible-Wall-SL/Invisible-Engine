# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** shipped — an authored `/config` doc drives symbols, paytable (scatter pays
included), paylines, bet modes, grid (stepped too), win model, cascade, reel behaviour and win
tiers in the game, the mock RGS and the Scene Editor preview. The original five phases were
owner-verified live on 2026-08-04; later panels (paste-capture import, drift banner, History…)
are build/fixture-verified with the browser click-through listed under open items.

## Current state

**Phase 1 — schema + storage (done).**

- `packages/game-config` — dependency-free, Node-resolvable (mirrors `engine-flipbook`):
  - `types.ts` — `GameConfigDoc`, byte-compatible with the math export (`special_properties`,
    `max_win`, single-entry paytable rows kept verbatim so paste-in works).
  - `normalize.ts` — `normalizeGameConfigDoc`, idempotent. Returns **`undefined`**, never an empty
    config, when the input can't describe a game: "no doc" must mean _fall through to the template_,
    not _blank board_. Accepts the friendly shorthands (`numRows: 3`, bare-string strip cells,
    multi-key paytable objects) so a hand-written config isn't rejected for being tidier.
  - `inPlay.ts` — **the gate**: `symbolsInPlay` / `symbolsInPlayForGameType` / `isSymbolInPlay` /
    `symbolFrequencies`, all reading the STRIPS, not the dictionary. One implementation, so the
    `W`-never-lands class of bug has a single place to be right.
  - `validate.ts` — `validateGameConfigDoc` / `gameConfigErrors`, severity-tagged and field-pathed.
    Errors block a ship (payline off the grid, strip dealing an undrawable symbol, wrong reel
    count); warnings describe a config that renders but lies (`W` pays but is never dealt).
- `apps/launcher-api/src/lib/server/gameConfigStorage.ts` — load/save with the standard ETag
  compare-and-swap, `InvalidGameConfigError` (carries the issue list → a useful 400),
  `ConflictError` → 409. Key `gameConfigDocKey()` → `<client>/<project>/config/config.json`
  (new `SUB.config`).
- `tools/game-config-spike` — 40 offline checks, run against the **real** `apps/lines` config so
  the fixture breaks the day the template stops satisfying the contract:
  `pnpm --filter game-config-spike run doc`. All passing. It asserts the `W` case directly:
  `W` is in the dictionary, absent from the in-play set, and warned about.

**Phase 2 — seed from the template (done).**

- `apps/launcher-api/scripts/generate-game-config-defaults.ts` — derives
  `$lib/data/gameConfig/<gameType>.json` from that game type's own `src/game/config.ts`, so the
  committed default and the compiled template cannot drift. Refuses to write a default that has
  blocking errors. `pnpm --filter launcher-api gen:game-config-defaults` /
  `check:game-config-defaults` (the `--check` gate writes nothing and exits 1 on drift — verified
  by mutating the JSON).
- `$lib/data/gameConfig/lines.json` — generated, the only committed default today (`bookOf` has no
  config module in this repo; a shipped game generates its own with `--game-type` + `--config`).
  Unknown game types fall back to `lines`, the same fallback `symbolDefaultsFor` uses.
- `gameConfigDefaults.ts` — `gameConfigDefaultFor()`, `gameConfigPresetsFor()` (a kind with several
  starting configs — `holdAndWin` — see the Hold and Win section), and `resolveGameConfig()`, the ONE entry point that owns the precedence
  `authored R2 doc → committed template default → compiled config`. It returns provenance
  (`source: 'authored' | 'template'`) plus the ETag, so the tool can say "inherited from the lines
  template" and still send the right compare-and-swap precondition on first save.
- The spike re-derives the committed JSON and compares bytes, so drift fails a fixture run even if
  nobody runs `--check` — a generator nobody runs is a generator that lies. 44 checks, all passing.

**Phase 3 — the runtime carries it (done).** The risky one; it landed with the compile-time
guarantee traded for a runtime one, as planned.

- `config` joins the bundle on BOTH paths — `assembleRuntimeBundle` (live) and
  `bake-editor-doc.mjs` via the new token-gated `GET /api/game-config/doc` (baked). Omitted when
  un-authored, so an un-authored project's bundle is byte-identical and the game runs its compiled
  `config.ts`. Neither path seeds the template default: the default is what the TOOL opens with, so
  an author adopts it knowingly rather than having it ship the day a template changes.
- `bakedGameConfig()` in `editor-scenes.ts` beside `bakedSymbolMap()`; `game/gameConfig.ts` owns the
  `runtime → baked → compiled` resolution behind a memoised `getActiveGameConfig()`, with
  `resetGameConfigCache()` wired into `Game.svelte` next to `resetSymbolMapCache()` — without that
  reset an online game freezes to the template, which is the exact bug this tool exists to kill.
- **`SymbolName` widened from `keyof typeof config.symbols` to `string`.** The compile-time union
  described the _sample_ game, so it would have rejected a correct symbol id from an authored
  config. `BetMode`/`GameType` deliberately did NOT widen — they are shared vocabulary with the RGS,
  so they can't be freely invented per project.
- The lost guarantee is replaced by `warnOnGameConfigIssues()` at boot: every validator issue, plus
  an ERROR naming any symbol the strips deal that has no art (it would render as nothing mid-spin —
  the most expensive failure to diagnose).
- Consumers now read the active config instead of importing `config.ts`: `paytable.ts` (`NUM_LINES`
  → `numLines()`, `PAYTABLE` → `paytable()`), `constants.ts` (`PADDING_REELS` → `paddingReels()`,
  4 call sites), `infoManifest.ts` (config-derived fields are accessors now). They HAD to stop being
  module-scope constants: those evaluate before the async runtime bundle resolves.
- The paytable's display order became a PREFERENCE, not a filter — the old
  `LINE_ORDER.filter(...)` would have rendered an empty paytable for any project whose symbols
  aren't named `H1..L5`.
- **Verified in the running game** (`pnpm --filter lines dev`, modules imported live in the page):
  with no authored config it resolves the template (20 lines, 5×217-cell strips, paytable without
  the wild); with `bakedGameConfig()` temporarily stubbed to an authored 3-reel `ACE/KING/SCAT`
  config, the identity, line count (2), paytable rows, strips and the whole info manifest all
  followed, and the boot check correctly errored that the three symbols have no art. Stub reverted;
  re-verified back to template values.

**Deviation from the design doc, deliberate:** Phase 1 called for a Zod `GameConfigDoc` in the
launcher. It has none. A Zod mirror would be a second, hand-copied answer to "what is a valid
config" inside an app whose `build` is not a type-check — the `COMPONENT_PARAM_KINDS` failure mode
(see `apps/launcher-api/CLAUDE.md`). The canonicalizer + validator are that one answer and produce
better 400s. Reversible if a use case demands Zod.

## The grid-dimensions enhancement (numReels/numRows resize the board)

Authoring the grid now resizes the board everywhere, not just in the `/config` Grid panel. Three
commits, three surfaces:

- **Game** (`game-config-grid` Phase 1) — `boardDimensions()`/`boardSizes()`/`initialBoard()` in
  `gameConfig.ts` replace the hardcoded `BOARD_DIMENSIONS`/`INITIAL_BOARD`; `stateGame`'s board is a
  `buildBoard()` factory rebuilt by `Game.svelte`'s `rebuildBoard()` after the runtime bundle lands
  (the online async-freeze pattern). ~9 consumers read the accessors. **Verified in-browser**: a
  stubbed 6×4 config rebuilt the board to 6 reels × (4+2) cells; reverting → 5×3 (parity).
- **Mock RGS** (Phase 2) — `createMockRgs({ reels, rows, paylines })`; the test-server injects the
  config's grid from `lines.json`. The Play4Fun facade's one 5×3 assumption (a warning) is dropped;
  `clampBoardToGrid`/`padReel` already generalized. **Verified** with a node harness: a 6×4 reveal is
  6×4, defaults stay 5×3.
- **Scene Editor** (Phase 3) — `drawReelGrid` draws the config's grid count (node still owns layout);
  `reelGridWarnings` compares the node to the config, not the template. Build-verified; the rendered
  preview is owner-verify-owed (launcher-only).

**Only the board's reel/row count comes from the config.** The scene-geometry anchors and the HUD
layout stay authored in the Scene Editor per game.

## Stepped grids — SHIPPED (2026-08-24, #445 `553848a4`, runtime-released)

`numRows` finally means what it says.

> Design: [docs/design/stepped-grid.md](../design/stepped-grid.md)

`numRows` has been a per-reel array since Phase 1 and its doc comment always claimed "so a stepped
grid is expressible", but only the MATH read it that way (`activeWaysCount`, the per-reel payline
bounds check, `boardText`). Every renderer and dealer collapsed it to `Math.max(...)`. A non-uniform
config therefore SAVED, VALIDATED and SHIPPED while the board drew a rectangle against it — the
paytable pricing 720 ways over a 5×5 board, the RGS dealing five rows into a three-row column. It
was reachable by typing a number into the Grid panel. This closes that.

- **`packages/game-config/src/grid.ts`** — `resolveGrid`, the ONE resolver both halves read:
  `rowsForReel` (how tall) + `rowOffsetForReel` (where it sits, in rows, FRACTIONAL so a 4-row column
  centred in a 5-row box lands on the half-cell stagger that makes 3/4/5/4/3 a diamond).
  `stepped` is the parity gate — false for every board that exists, and every consumer early-returns
  its EXISTING path on it, not an equivalent one.
- **`gridAlign`** (`center` | `top` | `bottom`) is a new optional top-level field, stored only when
  it departs from `center` AND the grid is actually stepped, so a math-export paste-in round-trips
  byte-for-byte. Authored in the Grid panel, which shows the control only for a stepped grid.
- **Game** — `boardDimensions()` still reports the BOUNDING BOX (scene anchors are pinned to it) but
  stops claiming every column fills it. Each column gets its own clip window (`ReelColumn`) and its
  own cull bound; the offset rides into the reel as part of its `symbolLead` AND into the resting
  seat via `rowSeatIndex`, because `ReelSymbol` picks between those two y sources every frame.
- **Dealer chain** — `/config` doc → `mockContract` → manifest → test-server → mock, each hop sending
  `rowsPerReel` only when the columns differ. The mock declares what it dealt
  (`config.window.rowsPerReel`) and the facade clamps PER COLUMN against that declaration.
  The authored **bet modes** ride the same chain (`grid.betModes`, only when the project authors an
  ante or a buy) and make the lines-family mock a `betOptions` table game, so a card is charged its
  authored price. See `engine.md`, 2026-09-29.
  `ROWS=3,4,5,4,3` deals a diamond from the CLI.
- **Editor** — `reelGridGeometry` seats each column at its own height/offset from the SAME
  `resolveGrid` output, so the preview cannot show a board the game will not draw.

**Verified.** `verify-stepped-grid.mjs` (229 assertions, new) + a stepped section in
`verify-symbol-seat.mjs` (now 274,644). The two that matter are parity: the same seed dealt with
`rows: 3` and `rows: [3,3,3,3,3]` gives byte-identical responses (the RNG stream is untouched), and
a uniform seat is still literally `getSymbolX`/`getSymbolY` asserted with `Object.is`. Live in
`apps/lines` + mock, read off the Pixi scene graph: a 3/4/5/4/3 config draws five masked column
containers holding 3/4/5/4/3 symbols at offsets 1/0.5/0/0.5/1; reverting to 5×3 returns ONE mask
with all 15 symbol containers as direct children.

**Cascade + stepped WORKS** (2026-08-24). It was first flagged as a gap on the reasoning that the
tumble overlay seats falling replacements against the board's row count — that was wrong. Every seat
in the cascade already goes through `getSymbolSeat(reelIndex, …)`, a drain drops by the COLUMN's own
length, `combineTumbleReel` is length-agnostic, and the mock refills exactly what it removed per
reel. What WAS board-wide was the same pair the reel board fixed: the CLIP (the resting cascade layer
is clipped by the board-wide `BoardMask`, so a short column's replacements — stacked deliberately
ABOVE its window — sit inside the bounding box and would be drawn hanging above it, and its drained
symbols would park below it instead of leaving) and the CULL (`TumbleSymbol` passed `SymbolWrap` no
`reelIndex`). `TumbleBoardBase` now wraps its columns in the same `ReelColumn`; grouping by COLUMN is
safe where grouping by row is not, since a symbol never changes column mid-cascade, so the object
keying that keeps a falling symbol's Tween alive is untouched. `cascadeBoard.fixture.ts` runs a ramp
and a diamond beside its rectangle — 937 assertions over 291 tumble steps.

**Perspective + stepped COMPOSES** (2026-08-24), and the fix was to change how a stepped board is
CLIPPED rather than to reconcile two paint orders. The first design gave each column its own
container + mask, which forces a COLUMN-major scene graph; perspective paints ROW-major so a
front-row character covers the row behind it, and that made them mutually exclusive. The clip is now
ONE compound mask whose geometry is the union of the per-column windows (`boardMaskColumns`), so
there is no grouping at all — the child list stays flat, both `BoardBase` branches are untouched, and
either mode (or both) can be authored. `ReelColumn` is deleted; `BoardBase` and `TumbleBoardBase` are
byte-identical to `main` again. The columns TILE rather than overlap, because an overlapping polygon
would let a tall neighbour cover the notch beside a short column. Under perspective each column is
sampled at every one of its ROW BOUNDARIES rather than drawn as a four-corner trapezoid — a trapezoid
interpolates linearly in y while the contraction is linear in the ROW, and the two disagree enough
mid-column that a cell can land inside its neighbour's polygon. The fixture caught that; it was not
foreseen.

**WAYS on a stepped board — a real bug found and fixed (2026-08-24).** The gap note said the ways
reach was "correct by construction" because `createWaysReach` takes each column's height off the
board it is handed. It does — but the board it was HANDED was wrong.
`buildAnticipationArming` sliced the padded reveal to the BOUNDING BOX (`reel.slice(1, 1 + y)`,
`y = max(numRows)`), so a 3-row column — which arrives as 5 padded cells — kept its bottom PADDING
row: four cells in a three-cell column. Undetectable downstream, because a ways pay is a product over
the per-reel counts divided by the ways count and BOTH move, so the round just pays the wrong
multiple (3x4x5x4x3 = 720 ways vs 3125 if every column is counted as five); for `lines` an off-screen
symbol can complete a run. Now sliced by `grid.rowsForReel(reelIndex)` — identical on a uniform
board. `anticipationWaysReach.fixture.ts` gained a ragged-board section that converges on the real
win AND asserts that padding the short columns out to the box gives a different answer, so the slice
cannot regress silently; `verify-stepped-grid.mjs` asserts the slice itself. The rest of the family
was already safe: `bookEventHandlerMap` and `flowEffects` walk the visible rows behind a
`row < symbols.length - 1` guard, which bounds them by the column's own strip.

**Open / not wired:**
- A stepped board has not been driven through a full ROUND in a browser: the pane would not
  composite, which also throttles the animation clock, so a round never settles and a second spin
  never arms. A single spin DOES fire (spacebar). The RESTING board is verified live and
  quantitatively — `renderer.extract` reads the painted pixels back, and a 3/4/5/4/3 config paints
  column spans of 2.98 / 3.95 / 5.00 / 3.94 / 2.92 rows starting at 1.03 / 0.54 / 0 / 0.63 / 1.10,
  which is the diamond including its half-row stagger (the sub-row deviations are the symbol art's
  own margins). Reverting to 5x3 puts the mask back on the `Rectangle` path (`fill`+`stroke`, not the
  compound `fill`) with 15 symbols at y 60/180/300. The reveal + cascade paths are covered offline.

## Phase 6 — bet modes authorable + localizable (the buy-features/bonus surface)

The buy-bonus / ante menu the player sees was hardcoded: `ModalBuyBonus` → `BonusCards` read
`stateMeta.betModeMeta`, and that was only ever `DEFAULT_BET_MODE_META` in `state-shared/constants.ts`
(placeholder `SAMURAI SPIN` copy, `test-fart-cdn` URLs). **Nothing per-project ever reassigned it** —
the bet-mode face of the "one hardcoded blob for everyone" bug. Design: `invisible-game-config.md`
Phase 6. **All four sub-phases (6a schema · 6b runtime · 6c tool panel · 6d localization) are done**;
6a/6b engine-verified live, 6c/6d build-verified (launcher render owner-verify-owed, as with the rest
of the tool).

**6a — schema + resolver (done, offline-verified).**

- `packages/game-config`: new OPTIONAL top-level `betModePresentation?: Record<mode, { kind?, order?,
text? }>` on `GameConfigDoc` — an Invisible-Engine extension a math-export paste-in omits, mirroring
  `paylineColors` (kept OFF `betModes` so those entries round-trip a math export byte-for-byte).
  `kind` = `base | ante | buy`; `text` = title/description/button/dialog/betAmountLabel SOURCE strings.
- `normalizeBetModePresentation` — sparse, drops an entry for a mode not in `betModes` (like a colour
  for a deleted line); the whole map omitted when un-authored ⇒ byte-identical to a math export.
- `betModes.ts` — `resolveBetModes(doc)`: the ONE place folding math + presentation into the ordered
  `ResolvedBetMode[]` the menu needs, owning the `buyBonus→kind` derivation (`ante` is explicit-only —
  the two booleans can't express a persistent toggle) and the default copy (id as title, verb per
  kind). The 6d Localization collector (`harvestBetModes`) reads `resolveBetModes` directly so each
  string keeps a per-field label.
- `validate.ts` — warns on a `buy` card over non-buyBonus math, and an `ante` with no title.
- `game-config-spike` — 14 new checks (resolve/order/derivation/warnings/collection/idempotence), all
  pass. (The lone spike failure is the **pre-existing CRLF `lines.json` drift**, unrelated — the file
  is git-clean and differs only in line endings.)

**6b — runtime assembly (done, verified in the running game).**

- `apps/lines/src/game/betModeMeta.ts` — `buildBetModeMeta()`/`syncBetModeMeta()` map
  `resolveBetModes(getActiveGameConfig())` into state-shared's `BetModeMeta` and push it into
  `stateMeta.betModeMeta`. The ONE bridge from the leaf `game-config` shape into Svelte state.
  - **Keys UPPERCASED** (`base`→`BASE`) so the wire value sent to the RGS (`mode:
activeBetModeKey`) and the `activeBetModeKey='BASE'` resets stay byte-identical to the placeholder;
    consistent with the case-insensitive lookups that already exist (`stateBet.activeBetMode`).
  - **Text stays SOURCE strings**; the bonus components translate at render (the "key IS source text"
    i18n model), so a language set after boot still localizes — no boot-order coupling.
  - Assets (icon/dialog art) left empty on purpose — an asset class for the live-asset pipeline, a
    later phase; nothing renders bet-mode `assets.*` as sprites today, so empty is inert.
- `Game.svelte` calls `syncBetModeMeta()` at boot after the runtime-bundle branch (beside
  `resetGameConfigCache`), so an online project's authored modes/cost/copy take effect.
- **`DEFAULT_BET_MODE_META` kept, not deleted** — the other dev apps (cluster/scatter/…) still seed
  from it and aren't wired yet. `apps/lines` OVERRIDES `betModeMeta` from its config at boot; deleting
  the shared placeholder is a later cleanup once every app seeds from config.
- Render-time `translate()` added to `BonusCards` (title/description/button), `ModalBuyBonusConfirm`
  (title/dialog), and the HUD `betAmountLabel` sites (`LabelBet`/`HudCaption`/`HudReadout`). Untranslated
  strings return themselves, so other apps' placeholder copy is visually unchanged.
- **Verified live** (`apps/lines` dev + mock, buy menu opened): `betModeMeta` resolved to `BASE`
  (default/PLAY/1×) + `BONUS` (buy/BUY/100×) from the lines config; the rendered card showed
  **BONUS · $100.00 · BUY** (= $1 base × 100). Placeholder cards gone. Build passes; no new console
  errors (the two pre-existing empty-sprite-key warnings are unrelated — no code reads bet-mode assets).

**6c — the tool panel (done, build-verified).** The `/config` Bet modes panel is now a per-mode card
(was a flat math table): the math fields (cost/rtp/max_win/feature/buyBonus) plus **Kind** (a
base/ante/buy select, "auto → <derived>" when unset), **Order**, and the **copy** fields
(title/button/bet-label + description/dialog textareas). A read-only **menu preview** shows the
resolved, ordered menu (title · cost× · kind), so the author sees the effect of `resolveBetModes`.
Presentation is written SPARSELY (setters prune an emptied entry / map, mirroring the payline-colour
helpers) so an un-presented config stays byte-identical to a paste-in; `removeBetMode` drops the
presentation with the mode. Inline `betModePresentation` validator issues render under the panel.

**6d — Localization auto-collect (done, build-verified).** `/localization` grows a **Bet modes**
section, exactly like its Win Text section:

- `harvestBetModes(config)` in `localizationHarvest.ts` collects the RESOLVED bet-mode source strings
  (`resolveBetModes` — same strings the runtime renders, so a translation authored here lands in-game),
  deduped, under synthetic section id `__betModes`, `origin: 'gameConfig'`.
- New `'gameConfig'` origin added to `LocalizationEntry.origin` + `normalizeEntry` + `HarvestSection`.
  It's an AUTO origin, so the page (which gates read-only + "no longer in scenes" by `=== 'manual'`)
  needed **no changes**, and the save action's `=== 'manual'` prune already drops untranslated rows.
- The loader harvests from the **authored** config only (`loadGameConfigDoc`, no template fallback) —
  parity with the scene/win-text collectors: a project that hasn't authored a config shows no bet-mode
  rows until it does.

## Win-tier presentation moved to the `win` component (structure/presentation split)

The `/config` **Big win tiers** panel now authors tier **STRUCTURE ONLY** — count / name /
threshold / type / escalation. The per-tier PRESENTATION free-text fields (spine key,
intro/idle/outro, duration, SFX, BGM) were removed from the panel; the `win` **component**
(Scene Editor) owns them, per tier keyed by ALIAS, generated from the active config's big tiers.
The schema fields (`animation`/`spineKey`/`durationMs`/`sound` on `WinLevelTier`) are KEPT as the
coded fallback (un-authored component ⇒ byte-identical), just no longer edited in `/config`.

- **engine-layout** (`builtinComponents.ts`) — `WIN_DEF` is now generated by `winComponentDef(tiers)`
  from `winTierPresentationParams(tiers)`; `DEFAULT_WIN_TIERS` (the coded `winLevelMap` big rows) is
  the un-authored default. Per big tier `<alias>`: `<alias>Spine` (spine picker, no default so it
  falls back to config `spineKey` at runtime), `<alias>Intro`/`Idle`/`Outro` (`spineAnimation`
  dropdowns of the tier's spine), `<alias>Duration`, `<alias>Sfx`, `<alias>Bgm`. Base/shared params
  (`winSpine`/`slotName`/`showCoins` + the shared "Animations (all tiers)" set) unchanged.
- **launcher `/editor`** — `+page.server.ts` resolves the config's big tiers (`resolveWinLevels` →
  `type==='big'`) into `winTiers`; the client (`+page.svelte` `withConfigWinTiers`) rebuilds the
  `win` def's per-tier groups from them so the component mirrors the config. `EditorProperties`
  `effectiveSpineBundle` now falls back to the def's first `spine`-kind param (`winSpine`), so a
  per-tier animation dropdown lists the base bundle's animations when the tier spine is unset.
- **runtime (`apps/lines`)** — animation + spine resolve IN the win tree (`WinVisual`: per-tier
  `<alias>*` ?? shared ?? config/coded convention, alias-keyed, replacing the old `TIER_PREFIX`);
  the single-tier `spineKey` gap is CLOSED (`activeSpine = <alias>Spine ?? winLevelData.spineKey ??
winSpine`). Duration + sound are consumed OUT of the tree (`WinGate` duration, `winLevelSoundsPlay`)
  so they bridge via a global: `bakedWinPresentationParams()` (walks the baked/runtime doc for the
  `win` instance) → `publishWinPresentation()` at boot → `gameConfig.ts` `withWinPresentation` overlays
  per-tier `<alias>Duration`/`Sfx`/`Bgm` onto `activeWinLevelData`/`ByAlias`/`Chain`. Empty overlay
  (no win instance / dev) ⇒ byte-identical.
- **Verified:** `game-config typecheck` + `game-config-spike` (all pass), `engine-layout build`,
  `lines build` + `svelte-check apps/lines` (0 errors), `launcher-api build`. Launcher render +
  live spin are owner-verify-owed (launcher-only). Reaching online games needs a Runtime release +
  republish (the reading code ships in `_runtime/lines`).
- **SFX / BGM dropdowns (landed).** The per-tier `<alias>Sfx` / `<alias>Bgm` params are dropdowns of
  the game's real sounds, not free text: `winTierPresentationParams(tiers, soundOptions?)` accepts an
  editor-only `{ bgm, sfx }` option list (`WinSoundOptions`); the `/editor` client (`withConfigWinTiers`)
  supplies it from the ONE generated sound enum (`engine-flow-v2` `MUSIC_NAMES` / `SOUND_EFFECT_NAMES`,
  now re-exported from the package index) — BGM = `bgm_*` beds, SFX = the non-bgm cues. Rendered via the
  existing `p.options` dropdown branch (empty "(inherit default)" option). Options are an editor-only
  hint (the runtime `WIN_DEF` passes no `soundOptions` ⇒ still `kind:'string'`), so the shipped def +
  saved doc are unchanged; empty ⇒ config/coded sound (byte-identical). CAVEAT: the enum is the shipped
  `apps/lines` sound set — a game with its own `sounds.json` isn't reflected yet (noted).
- **Canvas preview (landed).** Focusing a spine / spineAnimation param on the selected instance drives
  the Scene Editor's live WebGL spine preview to that bundle + animation (WYSIWYG): a `spine` param
  previews its bundle's first/idle animation, a `spineAnimation` param previews its sibling bundle
  playing THAT animation. Generic (any spine+spineAnimation component — win / free-spin visuals / book
  reveal benefit). `EditorProperties.onPreviewSpine` (focus/change on the spine + spineAnimation
  controls) → `+page.svelte` `spinePreview`/`spinePreviewNodeId` (reset on selection change) →
  `EditorCanvas` → `EditorSpineLayer` (overrides the previewed instance's bind spine bundle +
  `defaultAnimation`). PREVIEW-ONLY — never written to the doc; unfocused / non-instance ⇒ the base
  `winSpine` bundle (parity). Owner-verify-owed on the auth-gated canvas.

## Config-authored win tiers (big-win levels) + sequential escalation

The coded win-level table (`apps/lines/src/game/winLevelMap.ts`, 1..10) and the facade's hardcoded
threshold ladder (`engineFacade.ts` `computeWinLevel`) are now OPTIONALLY replaced by a config-authored
tier list. All four phases landed; engine + schema build + typecheck + spike verified. Launcher
`/config` panel render is owner-verify-owed (launcher-only), as with the rest of the tool.

**Schema (`packages/game-config`).** New OPTIONAL `winLevels?: WinLevelTier[]` on `GameConfigDoc` (an
ordered tier list — `alias`/`name`/`threshold` (win-as-bet-multiplier)/`type` (`small|medium|big`) +
optional `animation{intro,idle,outro}`/`spineKey`/`sound{sfx,bgm}`/`durationMs`) plus top-level
`escalateTiers?`/`escalateFrom?`. An Invisible-Engine extension a math-export paste-in omits, mirroring
`paylineColors`/`betModePresentation`. `normalizeWinLevels` is sparse (the whole block + flags omitted
when un-authored ⇒ byte-identical). `winLevels.ts` resolver: `resolveWinLevels` (assigns 1-based
`level`), `resolveWinLevel(doc, betMult)` (the threshold ladder), `winLevelType(doc, level)` (the
big-win gate), `resolveWinLevelChain(doc, level)` (the escalation chain, `undefined` when off).
`validate.ts` flags descending thresholds (error), a big tier with no animation (warning), a duplicate
alias (error), an `escalateFrom` naming no tier (error). `game-config-spike` gains ~30 checks incl.
the byte-identical-fallback proof; all pass (the sole failing check is the pre-existing CRLF
`lines.json` drift, unrelated — the file is git-clean and `winLevels` is absent from the derived doc).

**Runtime (`apps/lines`).** `winLevelMap.ts`'s `WinLevelData` widened from the coded table's literal
union to a STRUCTURAL type (+ optional `spineKey`) so a config-built tier satisfies it; the coded
entries stay assignable (un-authored path unchanged). `WinLevelAlias` widened to `string`.
`gameConfig.ts` owns the resolution: `activeWinLevelData(level)` (config tier → `WinLevelData`, else
the coded `winLevelMap[level]`), `activeWinLevelIsBig(level)`, `activeWinLevelChain(level)`,
`publishWinLevelsToFacade()`. The win consumers route through these instead of importing the coded
table: `bookEventHandlerMap.ts` (setWin/freeSpinEnd), `flowEffects.ts` (`winLevelDataOf`),
`unskippablePresentation.ts` (`startsCelebration`). `winLevelData` widened to `WinLevelData | undefined`
across the emitter events + state vars (runtime already permitted it; `winLevelSoundsPlay` already used
optional chaining). `Game.svelte` calls `publishWinLevelsToFacade()` at boot after `resetGameConfigCache`.

**The facade↔engine contract.** The facade can't import the app (it's a drop-in for `rgs-requests`),
so `publishWinLevelsToFacade()` writes the resolved tiers (level/threshold/type only) to
`globalThis.__IE_WIN_LEVELS__`; `engineFacade.ts` reads it in `computeWinLevel` (authored ladder, else
the coded ladder) and the big-win gate `isBigWinLevel` (authored `type === 'big'`, else `>= 6`), so a
3-tier config triggers big-win on its own big tier. Un-authored ⇒ the global is cleared ⇒ both fall back
byte-identically.

**Escalation (`WinAnimation.svelte`/`WinVisual.svelte`).** `WinAnimation` gains an optional `chain`
(ordered tiers, each with its own spine key) + `countUpComplete`: it plays each tier's intro + a single
idle cycle, advancing on the idle's `complete`, lands on the final tier's LOOPING idle, then plays the
final outro once the count-up latches (`winState.countUpComplete`). Different `spineKey` per tier
reloads the bundle. No `chain` ⇒ the original single-tier intro→looping-idle path (byte-identical, no
outro). `WinVisual` builds the chain from `activeWinLevelChain(winLevelData.level)` — present only when
`escalateTiers` is on AND tiers are authored; the count-up stays ONE continuous count (driven by
`WinGate`/`winState`, untouched).

**The `/config` Win tiers panel.** Add/remove/reorder tiers (↑/↓), name/threshold/type, an
escalation toggle + start-tier select, and a resolved-ladder preview (the per-tier presentation fields
moved to the `win` component — section above; the stings to Invisible Sound). Written SPARSELY (the block + flags exist only once a tier is added), so
an un-authored config stays byte-identical. Inline `winLevels`/`escalateFrom`/`escalateTiers` validator
issues render under the panel. `docs/tools/game-config.md` updated in the same change (rule 9).

**Deliberately NOT touched:** `flowDoc.ts`'s `BIG_WIN_LEVELS = [6..10]` — a module-scope DEV-hook
fixture (`window.__IE_FLOW_WIN__`), not the production path (online games run authored flow-v2 graphs);
config is async so it can't be read at that module's init. Left as-is. And the coded `winLevelMap` table
stays as the un-authored fallback (byte-identical requirement #4).

**Runtime bundle:** `winLevels` rides the existing config bake→pull chain (it's part of `GameConfigDoc`,
already in `assembleRuntimeBundle` + the bake) — no new asset class. But the ENGINE code that reads it
(`gameConfig.ts`, the facade, the win components) ships in the shared `_runtime/lines` bundle, so an
online game needs a **Runtime release + republish** to pick up this behavior; a `main` merge alone does
not reach a live game.

## Server-authoritative paylines & reel strips (Phase 7)

Paylines and the in-play symbol set are now **server-authoritative at runtime**, and the `/config`
paylines + strips panels are locked to **colour-only** / read-only. Design: `invisible-game-config.md`
Phase 7. Engine + facade typecheck + build verified; the facade→engine bridge verified end-to-end
against the book mock (18-check node harness, all pass). Launcher render is owner-verify-owed
(launcher-only), as with the rest of the tool. Needs a **Runtime release + republish** to reach online
games (the reading code ships in `_runtime/lines`).

- **Facade → engine bridge.** `engineFacade.ts` `captureConfig` publishes the server's boot config
  (`{ availablePayLines, symbols, window }`, `symbols` mapped into client space) to
  `globalThis.__IE_SERVER_CONFIG__` — the `__IE_WIN_LEVELS__` pattern in reverse (facade→engine),
  since the facade can't import the app. Cleared/undefined when no `config` event ⇒ parity.
- **Engine overlay.** `game/gameConfig.ts` gains `serverConfig()` — a LIVE read of the global, NOT
  folded into the memoised `getActiveGameConfig()` doc (the config event lands async, after the memo
  resets; accessors run per-render/per-spin, so a fresh read picks it up with no cache to reset —
  documented beside `resetGameConfigCache` in `Game.svelte`). When present it drives `getPaylines()`
  / `getNumLines()` (server `availablePayLines`), `getSymbolsInPlay()` (server `symbols` = the in-play
  GATE), and `paddingReels()`/`getPaddingReels()` (auto-generated cosmetic strips from the in-play set
  — a per-reel rotated repeat, ≥ `rows+2` long). `paylineColor()` keeps the AUTHORED colours mapped by
  the server payline index (unchanged code — colours read the authored doc, which is what keeps it
  colour-only). Absent server config ⇒ every accessor falls through to the authored/compiled doc,
  byte-identical.
- **Consumers follow for free.** `paytable.ts` (`numLines`/in-play filter), `infoManifest.ts`
  (paylines/numLines/paylineColors), `anticipation.ts` (paylines/numLines/reach), `initialBoard()` and
  the spinning reel all read those accessors, so line count, per-line pay display, the info page, the
  in-play badges and the anticipation reach re-point at the server with no per-consumer change.
- **Tool.** `/config` Paylines panel: cell grid + add-line + remove-line disabled with a banner
  (server owns the lines); the per-line colour swatch + clear stay editable (sparse `paylineColors`).
  Reel-strips panel: textareas read-only, add/remove game-type disabled, banner. Other panels + raw
  JSON untouched. Dead `setPaylineCell`/`setStrip` removed.
- **Verified:** `game-config typecheck` + `game-config-spike` (pass; the CRLF `lines.json` drift is
  the lone pre-existing failure, unrelated), `lines build`, `launcher-api build`, facade isolated tsc.
  The bridge + overlay contract were proven with a node harness that drives the real `requestAuthenticate`
  against the book mock: with the config event present, `getPaylines()`/`getNumLines()` reflect the 10
  server lines, `getSymbolsInPlay()` the 10 book symbols (SCAT included), and strips auto-generate 5×;
  with it absent, all fall back to the authored doc (18/18).

## Paylines panel auto-loads the live server set + reel-strips panel removed (Phase 8)

The `/config` Paylines panel no longer renders the SAVED doc's lines — when the page opens it fetches
the game's REAL paylines from its mock RGS and previews THOSE, so the tool reflects what actually
ships at runtime (e.g. Book of Borut = 10, not 20 authored). The now-defunct **Reel-strips panel was
removed entirely** (strips are server-defined / auto-generated at runtime — there was nothing left to
author). Best-effort + additive: a project with no mock, or an unreachable RGS, renders exactly as
before (the saved doc). Build-verified + node-harness-verified; launcher render owner-verify-owed.

- **Server helper.** `apps/launcher-api/src/lib/server/rgsConfig.ts` — `fetchServerPaylines(gameKey)`
  POSTs an empty-body heartbeat (`[]`) to `${TEST_SERVER_URL}/api/<gameKey>/rgs/engine?sid=…&seq=0`
  with a FRESH sid per call (both mocks emit the boot `config` event on a session's first call; the
  lines mock ONLY then), reads `events.find(e => e.event==='config').context.availablePayLines ??
.paylines`, and returns `null` on ANY failure (network / 3s-timeout / 404 / parse / no config).
  Safe global-reachable fetch: OUR test server, not the Cloudflare-blocked production Play4Fun. New
  `ENV.TEST_SERVER_URL` (code default `https://games.invisiblewall.org`, same host as `GAMES_BASE_URL`
  but kept separate).
- **Load.** `+page.server.ts` resolves the gameKey as the project key VERBATIM (confirmed in
  `publishGame.ts`: `const key = projectKey`), only probes when `loadTestServerManifest().games[key]`
  exists (project has a mock), and passes `serverPaylines: number[][] | null`. Wrapped so it can never
  block/fail the page.
- **Page.** Paylines panel renders `data.serverPaylines` (read-only grid, one row-index per reel) when
  non-null with a "live server set" banner; the colour editor keys colour `i` to
  `Object.keys(doc.paylines)[i]` (matching the runtime `paylineColor(lineIndex)` mapping exactly),
  falling back to `String(i + 1)` for a server line past the authored doc. Null ⇒ renders `doc.paylines`
  with a muted "couldn't reach the RGS" note. The sparse `paylineColors` swatch stays editable + saving.
  Reel-strips `<section>` + the dead `stripText` helper + the strip-only `frequencies`/`symbolFrequencies`
  derived/import + strip-only CSS all removed. `inPlay` KEPT (Symbols in-play badges); `gameTypes` KEPT
  (`gridMismatch`).
- **Verified:** `pnpm --filter launcher-api build` (green — a bundle check, not types). A node harness
  mounting BOTH mocks in-process and calling the helper's core logic returned **10 lines** from the book
  mock (`availablePayLines`), **5** from the lines mock (`paylines`), and **`null`** for an unreachable
  host — exactly as intended.

## Paytable import from the game server (2026-09-28)

The Symbols panel's **Import paytable from server** button reads the paytable the project's
published game server DECLARES and offers it as a reviewed edit. Built on the boot cross-check
(#799): that one only WARNS when the info page and the server disagree; this is the deliberate
authoring action that fixes it. It never saves and the game never adopts a server paytable at
runtime. Fixture-verified + build-green; the dialog itself is owner-verify-owed in a browser.

- **Server read.** `GET /api/game-config/server-paytable?project=[&game=]`
  (`routes/api/game-config/server-paytable/+server.ts`), same session gate as `/api/game-config`
  (now shared: `$lib/server/gameConfigAccess.ts`). Finds the project's test-server game keys
  (`projectServerGameKeys` in `rgsConfig.ts`: the Game Maker's own `key = projectKey` first, then
  any key the manifest pins to the project or the games table says it owns), posts an empty-body
  heartbeat with a fresh sid and a 10 s timeout (`fetchServerBootConfig`, now also behind the
  Paylines preview), maps names with the vocabulary-picked mapping, and returns
  `{ gameKey, gameKeys, mapping, mappingDetected, serverSymbols, serverNames, lines, scatter,
  skipped }`. Failures are `json({ error }, { status })` — 404 "publish it first", 502 unreachable /
  bad answer (the cause is named), 422 no paytable declared.
- **One reading of the wire.** `pickMappingForConfig` moved from `engineFacade.ts` into
  `gameMappings.ts`, and the facade's scatter-symbol + name-mapping read became
  `readMappedPaytable` in `paytable.ts` (new `rgs-translator-eagaming/paytable` export) — the facade
  and the launcher now make the same call, no behaviour change in the facade.
- **Stored shape.** `toImportedPaytable` + `planPaytableImport` in `game-config/serverPaytable.ts`:
  line rows as `doc.symbols[name].paytable` (single-key rows, ascending, zero pays dropped). Scatter
  rows were information only here; since 2026-09-29 they are imported onto the scatter symbol's own
  paytable (see the next section). The plan updates dictionary symbols only — server symbols with no
  entry are `skipped`, authored rows the server does not price are `undeclared` and left alone.
- **Page.** The review is the canonical `ConfirmDialog` with a `body` snippet (not another hand-rolled
  `.modal-backdrop`): per symbol `now → server` or *unchanged*, the skipped/left-as-authored lists,
  one scatter information line, and **Apply N changes** (locked when nothing differs). The plan is
  made against the page's LIVE doc, so unsaved edits count; Apply writes only changed rows and the
  page goes dirty. Disabled with "Publish the game first" when the project has no server.
- **Verified:** `node scripts/verify-server-paytable-import.mts` (31 checks — both real wire shapes,
  engine names, stored shape, zero dropping, scatter apart, the plan, and "after Apply the boot
  cross-check finds no line drift"); `verify-server-paytable.mts` still 21/21; svelte-check clean on
  every touched file; `pnpm --filter launcher-api build` green. Live read of
  `games.invisiblewall.org/api/bookofborutremake` through the same helpers: book mapping detected,
  nine line symbols in engine names, scatter `3:2 4:20 5:200` matching the shown row; planned against
  the lines template it lists 9 changes, and 9/9 unchanged after applying. **Not verified:** the
  endpoint against the live DB/manifest, and the dialog in a browser.
- ~~**Duplicate on purpose:** `SHOWN_SCATTER_ROWS`~~ — gone 2026-09-29: the game and the tool now
  share `shownPaytable` (next section).

## Scatter pays, pasted partner captures, the paytable gate, RTP + max win (2026-09-29)

Four gaps around the paytable, closed together because they share one comparison.

- **Scatter pays are authorable.** A `scatter` symbol's own `paytable` in the dictionary IS its
  scatter pay (× total bet, anywhere) — never a line row. Unauthored it pays
  `DEFAULT_SCATTER_PAYTABLE` (`3:2 4:20 5:200`), the row the info page hard-coded before, so every
  existing project shows exactly what it showed. `shownPaytable(symbols, inPlay)`
  (`game-config/serverPaytable.ts`) is now the ONE statement of what the info page shows: in-play
  line rows in dictionary order, then the first in-play scatter's row. `apps/lines/src/game/paytable.ts`
  is a thin sort over it (the `[2, 20, 200]` literal and `SHOWN_SCATTER_ROWS` are gone). The
  import plans scatter rows too (`mode: 'scatter'`, planned against the shown row, default
  included); a server scatter row naming a non-scatter symbol is `skipped`, never priced as a line.
  The Symbols table's placeholder for a scatter says the default. Two readers of the scatter row
  were made NOT to follow it: the anticipation tease's trigger count is `SCATTER_TRIGGER_COUNT` (3,
  what it always was), not the row's lowest count — a row paying from 2 must not tease at 2 — and
  the land-sound picture/royal median (`landSlotForSymbol`) leaves scatters out, so authoring a 200×
  scatter pay does not turn a picture into a royal. A read-only scan of R2 on 2026-09-29 found 8
  authored configs, every scatter named `S` and none with a paytable, so no live project's info page
  changes on merge.
- **The lines mock pays and declares an authored scatter row.** `mockContract.projectScatterPaytable`
  → manifest `grid.scatterPaytable` → test-server `validGrid` → `createMockRgs({ scatterPaytable })`,
  which pays it and adds a `SCAT` row to the declared paytable. Unauthored ⇒ nothing is sent and the
  mock keeps its placeholder table, paid but undeclared — byte-identical. The book mock is unchanged.
- **Import from a pasted capture.** The Play4Fun edge challenges server-side fetches, so the launcher
  cannot read a partner's `config` itself. **Import from a pasted capture** (Symbols panel) takes the
  text someone copied in a browser on the partner's game. `findCapturedConfig`
  (`rgs-translator-eagaming/paytable`) finds the config inside a bare context, the event, a whole
  response, a list of them, or a `console-sniffer.js` dump (JSON-string bodies included), in the
  BROWSER — only the config is posted, to the new `POST /api/game-config/server-paytable`, which
  answers the same review shape as the GET plus `declared` / `dealt`. The same `ConfirmDialog`
  reviews it; Apply writes the changed rows AND stores `doc.partnerPaytable`
  (`{ capturedAt, source, entries, dealt? }`, engine names, normalized by
  `normalizePartnerPaytable`) — even with zero changes ("Keep as reference"). It never ships:
  `withoutPartnerPaytable` strips it from the online runtime bundle and from the bake's
  `/api/game-config/doc` answer (the partner's table and a free-text source have no business in a
  public bundle).
- **Drift is an authoring banner and a ship gate, not only a console line.** `partnerPaytableDrift`
  compares `shownPaytable` with the stored reference (`comparePaytables`, so `differs` / `unshown` /
  `undeclared` mean what the boot check means). `/config` shows it live against unsaved edits (a
  red box above the panels, plus a "Partner reference … matches / N rows differ · Forget it" line in
  Symbols). The online **Publish** refuses with a `paytable-drift` `PublishBlockedError`
  (`$lib/server/paytableDrift.ts`), overridable by the admin role only (`OWNER_ROLE`) — same model as
  `invalid-flow`; the Game Maker page asks. The desktop half: `GET /api/game-config/doc` answers 409
  `{ reason: 'paytable-drift', details }` and `bake-editor-doc.mjs` bails listing the rows unless
  run with `--allow-paytable-drift` (env `ALLOW_PAYTABLE_DRIFT=1`) — it used to treat any non-200
  there as "bake without a config", which here would have shipped the template's prices.
  `publish-symbol-defaults.mjs` reads that doc for its symbol gate only, so it passes the override.
  **No reference ⇒ no gate**: a project that never pasted a capture is never blocked.
- **RTP + max win on the info page.** `infoPageFigures(doc, displayRTP, formatNumber)`
  (`game-config/infoFigures.ts`) → `infoRulesWithFigures` (`engine-layout` `uiText.ts`). A rule may
  carry a `figure` printed BESIDE its heading: MAX WIN reads **"MAX WIN — 5,000× BET"** (the base
  bet mode's `max_win`, in the game's i18n number format), and an **RTP** rule — "RTP — 96.50%" plus
  one new body sentence — appears ONLY when `jurisdiction.displayRTP`, which the facade sets from the
  operator's `showTheoreticalPayback` and is false wherever nobody said otherwise (figure: the
  config's `rtp`, else the base mode's). **Why beside the heading:** the first cut rewrote the MAX
  WIN body as an ICU template (`{maxWin}`), and the pre-merge boot rendered "The maximum win is ×
  the total bet" — Lingui compiles a message with no values by BLANKING its placeholders. The review
  then pointed out a new body would also put an English paragraph into every localized game until
  translated. The figure uses only strings every game already translates (`MAX WIN`, `BET`), keeps
  the body untouched, and no rules string carries a `{…}` (the fixture asserts it). Unstated figures
  leave the page exactly as it was. **Note:** every game's rules now state its config's base-mode
  `max_win` — a partner-math game must author the real cap in Bet modes.
- **Verified:** `pnpm check:paytable` (import fixture 31 → 51: scatter planning, a pasted capture in
  six shapes, the partner reference + drift, what the page shows; `verify-server-paytable.mts`
  21/21), `pnpm check:info-figures` (new, 18 — incl. "no placeholder in any rules string"), both now
  a CI step in `lint.yml`; `sounds.fixture.ts` gained the scatter-excluded split (fails without the
  fix); `pnpm check:rgs` with the
  new `check:lines-scatter-paytable` (placeholder unchanged + undeclared, authored paid + declared,
  malformed ignored); svelte-check on `apps/lines` and the launcher — no error in any touched file;
  `pnpm --filter launcher-api build` green. **Booted the Book of Borut remake from this branch**
  (its live authored runtime through a local proxy, the book mock): no stale fallback, no drift
  warning, the paytable byte-identical to before (nine line rows + `S` 3:2 4:20 5:200 `feature`),
  rules page showing "MAX WIN — 5,000× BET" and, with `displayRTP` on, "RTP — 97.00%". Reviewed by
  the `code-reviewer` agent; every blocking and should-fix item addressed except two recorded
  below (a transient R2 error at the gate fails the publish, like its neighbours; a partner scatter
  under a different name than the project's cannot be imported).
  **Not verified:** the `/config` capture dialog and banner in a browser (needs a launcher login —
  owner-verify, below).

## Sounds — authored in Invisible Sound

The `sounds` block still lives on `GameConfigDoc` (`packages/game-config/src/sounds.ts`: slot
catalogue, resolver, departure-only normalizer, `sounds.fixture.ts`), but it is authored in
[Invisible Sound](sound.md); `/config`'s **Sounds** section is only a pointer. The slot model and
its inverted default are in [sound.md](sound.md) and [engine.md](engine.md) (2026-08-25).

## Hold and Win block + three presets (2026-09-30, Hold and Win Phase 2)

Plan: [hold-and-win.md](../design/hold-and-win.md) §1.3/§5; hub: [hold-and-win.md](hold-and-win.md).

- **`packages/game-config/src/holdAndWin.ts`** — `doc.holdAndWin?: HoldAndWin`, the whole §1.3
  option space: `trigger` (`count` {min, roles} · `pattern` [{reel, roles, min}] · `buy` [{mode,
  guaranteed, boostedSpecials}] · `randomMetre` {name} · `luckySpin`), `stickiness` (`allCoins` |
  `collectorsOnly`), `respins` {start, reset `anyCoin`|`anySpecial`, cap?}, `boardEnd` (`none` |
  `fullBoardJackpot` {jackpot, roles} | `columnLetters` {letters, jackpot, clearOnComplete}), `coins`
  (cash × TB with decimals, or a jackpot label; weight; reels?), `jackpots` [{name, multiplier × TB,
  fixed}], `specials` {collector, multiplier, payer, mystery — each optional, each with its own
  table, reels?, base-game flags; multiplier `leaveBehind` none | becomesCoin + table; mystery
  reveals coin | jackpot | special + `unlocksInactive`}, `applyOrder`, `activeModifiers` {atEntry,
  fromTriggeringSpecials}, `meters?` [{id, symbol, maxLevel, sizeStages, activates}], `wheel?`
  {prizes: coinBoost | extraCollect | jackpot}. `normalizeHoldAndWin` (structural; the block's
  presence IS the kind, so any object normalizes to a full block with defaults) and
  `validateHoldAndWin` (folded into `validateGameConfigDoc`, paths `holdAndWin.…`).
- **Roles live in the dictionary, tables in the block.** A symbol's Hold and Win role is a
  `special_properties` value: `coin`, `jackpot`, `collector`, `coinMultiplier`, `payer`, `mystery`,
  `meterSpecial`, `blank`. Specials never name their symbol; a meter does (three meters, three
  symbols). **`coinMultiplier`, not `multiplier`:** the lines family already reads `multiplier`
  (the mock contract deals multiplier cells for it — `mockContract.ts` `projectMultiplierSymbol`).
- **A buy tier's price is its bet mode's `cost`** — the block stores the mode key, never a price.
- **Validator catches** a pattern on a reel that doesn't exist or where none of its roles can land,
  more required symbols than rows/cells, `collectorsOnly` with no collector, unknown jackpot names
  (coins, mystery, wheel, board end), letters ≠ reel count, a buy on a missing / non-buy mode, a
  configured special with no tagged symbol (and the reverse, as a warning), apply order missing a
  special, a meter activating an unconfigured special or a size stage past its max, a wheel
  extra-collect past the collector's max, a Hold and Win game whose win model isn't `lines`, and a
  Hold and Win symbol carrying a line paytable (warning).
- **Presets** — `src/holdAndWinPresets.ts` (`pots` = 3 Pots of Egypt, `classic` = Grand,
  `collector` = Super Hotfire Diamonds), raw configs the generator normalizes into
  `data/gameConfig/holdAndWin.<preset>.json`. The generator gained a PRESET source path beside the
  `apps/<type>/config.ts` one (no fake apps); a preset authors its own `winLevels` (the §1.2 big-win
  thresholds), so the `winLevelMap` lookup is skipped for it. `gameConfigDefaultFor('holdAndWin')`
  → `pots`; `gameConfigPresetsFor('holdAndWin')` → all three for `/config`'s "Reset to preset".
  Line pays, draw weights, the payer's and leave-behind coin's steps are placeholders (the design
  records only the ranges).
- **`/config`** — a Hold and Win section (gated on the project kind until Phase 1's
  `kindCapabilities()` lands), preset picker, paytable shows coin rows as a value table, win-model
  picker locked to lines. Guide: [game-config.md](../tools/game-config.md#hold-and-win).
- **Game Maker profile** — `gameProfile.ts` `FEATURE_DETECTORS` +10 (`respin`, `jackpots`,
  `collector`, `boost`, `payer`, `mystery`, `pots`, `luckySpin`, `columnLetters`, `wheel`), all read
  `config.holdAndWin`.
- **Tests:** `packages/game-config/holdAndWin.fixture.ts` (discovered by `check:all`): each preset is
  a normalize fixed point with zero issues, the block round-trips byte-for-byte, a config without it
  gets no key, shorthand/garbage handling, and 19 impossible configs each named by path.
  `check:game-config-defaults` covers the three new JSONs.
- **Not in this phase:** nothing reads the block at runtime yet (Phase 4), the mock doesn't generate
  from it (Phase 3), and the symbol roles aren't offered in `/symbols` (Phase 7).

## Open items / next

1. **Validate against the RGS** (design doc open decision 3) — compare the config's symbol set to
   the first `reveal` and warn on a mismatch. `warnOnGameConfigIssues()` is the natural home; it
   would have caught the wild on the first spin. (The PAYTABLE half is done: the boot cross-check
   warns, and **Import paytable from server** fixes it — see above.)
2. **Owner-verify the paytable import dialog** in a browser on a published project (Book of Borut
   remake should show nine *unchanged* rows now that its config was authored from the server) —
   and the **pasted-capture** path: paste a partner `config` response, Keep as reference, Save, see
   the "matches" line; edit one price, see the red banner, and see Publish refuse (admin: publish
   anyway). Also click-test a config restore from **History…** (the flow restore was tested; same
   modal).
3. **Scatter math the mocks still disagree on (owner decision).** The lines mock's placeholder pays
   `3:2 4:10 5:100` while the info page's default shows `3:2 4:20 5:200` — undeclared, so no check
   sees it; authoring the scatter row fixes it per project. The book mock DECLARES `3:2 4:20 5:200`
   but pays 0 (its scatter only triggers the feature). Neither is changed here: both are payouts on
   live test games.
4. **Max win from the server.** The book wire declares `maxWinMp: [10000]`; the info page states the
   config's base-mode `max_win` (the remake: 5,000). Since 2026-09-30 the boot compares
   `maxWinMp[0]` with it and warns (never adopts) — so the remake warns until one side changes; what
   later entries cap is still unknown. RTP per bet mode is shown when the operator asks
   (`showBuyBonusPayback` / `showHighChancePayback`) — see [engine.md](engine.md), 2026-09-30.
5. **A partner scatter under another name.** The mapping names a partner's scatter `S`; a project
   whose scatter is called something else gets it `skipped` on import and a permanent
   `undeclared`/`unshown` pair in the drift check. Every live config names it `S` today.

**Not a gap:** `packages/game-spec`'s generator emits const-based `paytable.ts`/`infoManifest.ts`,
but it is a standalone CLI that `new-game.mjs` does NOT call — the scaffold copies `src/` from an
existing game (now `apps/lines`, with the accessor-based files), so a new game inherits the authored
-config wiring automatically. Left as-is on purpose.

## Blocked (owner / external)

- _None._

## Recent changes

- 2026-10-01 — **Game modes registry** (Hold and Win Phase 4M, part 1; design
  [hold-and-win §4.5](../design/hold-and-win.md)). New optional `doc.modes` (`packages/game-config/src/modes.ts`):
  a mode is `{ id, board: reels|respinBoard|wheel|none, gameType?, hud?, music?, counter?, values?, label? }`.
  The built-ins come from `builtinGameModes`: `basegame`, `freeSpins` (game type `freegame`, so every
  mock, facade and padding strip keeps its name), and `holdAndWin` (respin board, game type `respin`)
  when the config has a `holdAndWin` block. `doc.modes` stores only overrides of a built-in and the
  project's own modes; `normalizeGameModes` drops restatements, so every committed default normalizes
  with no block. Read through `resolveGameModes` / `gameModeById` / `gameTypeForMode` /
  `modeIdForGameType`. The validator refuses a base game off the reels and warns on a project reels mode
  with no padding strips. `/config` gains a **Game modes** section (`GameModesSection.svelte`: built-in rows
  with greyed defaults and a Reset, own modes added by id). The Scene Editor gains the screen role
  **game mode** + a mode id (`Scene.modeId`, kept by `normalizeScene` only on that role). Nothing in the
  game reads either yet; the engine mode stack (part 2) mounts mode screens and uses the game types.
  Verified: `packages/game-config/modes.fixture.ts` and `pnpm --filter launcher-api check:scene-mode-role`.

- 2026-09-30 — **Hold and Win block + three presets** (Hold and Win Phase 2). New `doc.holdAndWin`
  (the full option space of the three reference games), `pots` / `classic` / `collector` committed
  defaults generated from `packages/game-config/src/holdAndWinPresets.ts`, `/config` Hold and Win
  section + "Reset to preset", ten Game Maker profile detectors. Dead `listGameConfigTemplates()`
  removed (no caller). Detail: _Hold and Win block + three presets_ above.

- 2026-09-30 (follow-up) — **A History… restore no longer raises "Leave site?".** The restore reloads the page, and with unsaved edits the leave guard added on 2026-09-29 (#869) fired the browser prompt over a restore the server had already applied (cancelling it left a pre-restore doc on a stale ETag). The history dialog already warns that restoring discards unsaved edits, so the restore now marks the doc settled before reloading.
- 2026-09-29 — **Leaving with unsaved config edits now asks first.** The page tracked a dirty state but
  registered no leave guard, so a tool-bar switch, Back, a reload or a tab close discarded unsaved
  edits silently. It now calls the shared `guardUnsavedWork` (`src/lib/unsavedGuard.ts`) — the
  in-app confirm for a client-side navigation, the browser's own "Leave site?" for a real unload.
  See the launcher status entry of the same date for the guard change.
- 2026-09-29 (follow-up, review of #870) — **`/config`'s own server reads ask the authoring mock.** The Paylines preview and "Import from server" (`rgsConfig.ts` `fetchServerBootConfig`) probed `/api/<key>/rgs/engine` — the PLAYER mock, which #870 moved to the published contract. So an author saw their published paylines as "the server's", and an import offered the published prices as changes over unpublished edits (Apply would revert them). Both now probe `/api/<key>/authoring/rgs/engine` (a desktop build's single mock answers that path too). Also: the published derivation now runs the snapshot's config through `normalizeGameConfigDoc`, as the live read and the client do, so a future `normalize.ts` migration reaches the mock and the game alike; and the test server's `refreshContract` re-reads its registry entry after the fetch, so a `/refresh` landing mid-fetch no longer leaves the twin one spin on the published board or resurrects a dropped game. Tests: `check:mock-contract` +1 (drives the real `fetchServerBootConfig`), `verify-test-server-project-pin` 21 → 23, and its register-game guard re-pointed at `testServerRefresh.ts`, where #868 moved the refresh POST (it had been red on `main` since).

- 2026-09-29 (fix) — **The mock deals the board its CLIENT boots: published for players, live for authoring.** Published runtime snapshots (#841) made player boots read the Game Config frozen at Publish, but `/api/game-config/mock` kept serving the LIVE config — so after an unpublished grid/paylines/pool change the mock dealt the NEW board into the players' OLD client (the exact split the endpoint was built to prevent). **Contract now:** `GET /api/game-config/mock?…&source=published|live` (default `published`). `published` reads the snapshot through the same pointer/bundle caches as the player boot (`currentPointer`/`readSnapshotBundle`), including the symbols half (stacked mode, multiplier art from the bundle's baked symbols); a game with no snapshot answers from live and says `source: 'live-fallback'`, like `/api/editor/runtime`; an R2 failure is a 502, never a silent live answer. `live` is the authoring data. Publish's manifest copy is now derived from the bundle it freezes (`mockContractOfBundle`), not a live read. **Test server:** a runtime game gets an authoring TWIN mock at `/api/<key>/authoring/…` that follows `live`; the player mock follows `published`; a standalone build's single mock keeps following `live` (its config is baked from live data). Each channel has its own fingerprint and poll clock. **Launcher:** Live ↗ (Game Maker) and the home game cards build authoring links via `asAuthoringLaunch()` (`$lib/gameLaunch.ts`), which sets `ie_authoring=1` and moves `rgs_url` from `<host>/api/<key>` to `<host>/api/<key>/authoring` — only for the test server's own shape (partner/other RGS untouched). No engine change: the facade uses `rgs_url` as its base and the mock matches routes by suffix. **Tests:** new `pnpm --filter launcher-api check:mock-contract` (16 checks over the real `mockContract`/`publishedRuntime`/route, in-memory R2); `scripts/verify-test-server-project-pin.mjs` 16 → 21 (source per channel, twin swap, separate clocks). **Known seam:** an old test server (before this deploys) asks without `source` and so gets `published` for desktop titles too, until it redeploys.

- 2026-09-29 — **Version history.** Every config save backs up the version it replaces
  (`config/backups/`, newest 20, at most one every 5 minutes; a restore or an overwrite always
  backs up) — server side in [launcher.md](launcher.md) 2026-09-29. `/config` has a
  **History…** button (shared `$lib/DocHistoryModal.svelte`) that lists them and restores one through
  `POST /api/game-config/backups?project=` with this tab's ETag, then reloads. Build + checks green;
  Live (#847): the button renders and `GET /api/game-config/backups?project=test2` answers 200 (empty —
  no config save since deploy). ⏳ A config restore not click-tested (the flow restore was; same modal).
- 2026-09-29 — **Scatter pays authorable, import from a pasted partner capture, a paytable drift
  banner + publish/deliver gate, RTP + max win on the info page.** Full write-up: _Scatter pays,
  pasted partner captures, the paytable gate, RTP + max win_ above. New: `shownPaytable`,
  `DEFAULT_SCATTER_PAYTABLE`, `partnerPaytableDrift`, `doc.partnerPaytable`,
  `POST /api/game-config/server-paytable`, `paytable-drift` publish refusal, `--allow-paytable-drift`,
  `infoPageFigures`, rule `figure`s, `SCATTER_TRIGGER_COUNT`. Engine change ⇒ a runtime release.

- 2026-09-28 (security) — **`/api/game-config` and `server-paytable` now refuse a project the
  caller cannot access.** Both resolved whatever `?project=` they were handed once the ROLE had the
  `gameConfig` tool, so any Game Config user could read — and, through `PUT`, overwrite in R2 —
  another client's math contract by editing one query param. `gameConfigScope` is gone; the routes
  call the launcher-wide `requireProjectScope(user, project)` (`toolScope.ts`) after
  `requireGameConfigAccess`, which now returns the user. The rule is the selector's own
  `canAccessProject`; an inaccessible or unknown key is a **403** (never a 404, so the endpoint is
  no oracle for which keys exist). The no-`?project=` default (`cloud`) is checked like any other
  key: every user is granted it, so it is refused only when its row is gone, and then there is
  nothing to write. The `/config` page always sends `?project=` from its loader, so an author on a
  project they can reach sees no change. Shared with win-text, symbols, sounds, the component
  routes and publish — the whole story, the checks and what is still owed are in
  [launcher.md](launcher.md) Recent changes.

- 2026-09-28 — **Import paytable from server.** A reviewed, never-auto-saved way to author the
  paytable a published game's server declares: button in the Symbols panel → `ConfirmDialog` with
  `now → server` per symbol → Apply writes the changed rows → Save as usual. New endpoint
  `GET /api/game-config/server-paytable`; `pickMappingForConfig` and `readMappedPaytable` moved into
  `rgs-translator-eagaming` so the facade and the launcher share one reading of the wire; the
  `/api/game-config` gate extracted to `gameConfigAccess.ts`. Full write-up: _Paytable import from
  the game server_ above. Fixture `scripts/verify-server-paytable-import.mts` (31).

- 2026-09-10 (follow-up) — **The desktop publish path pins itself, with no desktop-launcher change.** The desktop launcher's `publish_game()` writes `test_server/games.json` itself and REPLACES the entry, so every desktop publish shipped unpinned and wiped any pin a CLI run had set. `POST /api/launcher/register-game`, which that launcher calls right after, already carries a validated `project`, so it re-stamps the pointer via `pinTestServerGameToProject()` (same If-Match + retry CAS as `upsertTestServerGame`) — idempotent on every publish. Four rules, each with a failing-without-it test in `verify-test-server-project-pin.mjs` (14 checks): it PATCHES and never CREATES (`no-entry` is reported instead); it spreads the existing entry; it writes nothing when the pin is already right (the `/refresh` it triggers re-hydrates every bundle); and it is non-fatal (`pin` rides back in the response). Seam: `/refresh` coalesces, so a pin written mid-refresh lands on the server's next hydrate. **Lesson:** scope a mutation test to the function under test — an unscoped `replace(…, 1)` mutated the sibling writer and the suite "passed" on the wrong code.

- 2026-09-10 (fix) — **The live contract pull asked for the GAME key where it needed the PROJECT key, so every desktop-published game ignored its config.** `refreshContract` requested `project=<gameKey>`, right only because online publishes use `key = projectKey`; a desktop title (`waysofwavesbuild` → project `test6`) got a 401 and fell back to the mock's built-in 5×3 Hot Fruits default while its client drew the authored stepped `ways` board. Symptoms looked purely presentational: an undeclared `L5` (from `PIC7`) drawn as a flat sprite, and the bottom row never exploding because the client's last visible row was the facade's padding. **Fix:** `TestServerGameEntry.projectKey`, written by `publishGame.ts` and `publish-game-bundle.mjs` (`--project` / `--launcher` / `--read-token`); `refreshContract` reads `meta.projectKey ?? key`. The CLI publisher now spreads the previous entry and accepts `--protocol ways|cluster|scatter`; a game with no pointer logs one line on its first spin. **Lesson:** a synchronous `check()` over async assertions printed ✓ unconditionally — make one async check fail on purpose before trusting a green run.

- 2026-08-27 (fix) — **Emerge: refills overlapped survivors, and un-authored intros paid the long cap.** (1) `tumbleBoardAppear` now runs in two phases — survivors vacate (awaited), then arrivals surface — because a refill's seat is often the seat a survivor is still leaving; the survivors' `land` beat runs alongside the arrivals, not before them. (2) `INTRO_BEAT_CAP_MS` (2000 ms) is paid only when `hasAuthoredSymbolState` says the intro is authored; an inherited `land`/`static` gets `TRANSIT_BEAT_CAP_MS`, so an un-authored emerge costs exactly what the slide costs (1500 ms/step, asserted as that equality). `verify-swap-in-place-mode.mjs` asserts both on the virtual clock. **Lesson:** a presentation fixture needs at least one assertion denominated in milliseconds — every earlier assertion was about order and content, and both defects were about time.

- 2026-08-27 — **Emerge governs a cascade WIN too, asymmetrically.** `bookEventHandlerMap.tumbleBoard` picks its arrival from the same `swapStyle` as the reveal. A cascade has two populations: refills APPEAR (`duration: 0`, `intro`, emerge cue) while survivors still SLIDE (200 ms, `land`), identified by object identity against `stateTumble.adding`. Filling holes in place instead would produce a board different from the one the server scored — refills stay stacked above survivors (`combineTumbleReel`'s gravity model). Known seam: a flow-v2 doc that owns `tumbleBoard` bypasses this branch and must author `tumbleBoardAppear` itself.

- 2026-08-27 — **Third swap style `emerge`: the board surfaces in place, nothing travels.** `SWAP_STYLES` gained `'emerge'`; `emergeRevealBoard` is the column cascade's skeleton with both motions removed, and a new `tumbleBoardAppear` cue places each symbol at `duration: 0` playing a new authored `intro` state. Decisions: a cue of its own rather than a zero-duration slide (a slide keeps its tween-then-`land` contract); the intro state is set BEFORE placement, or the resting art pops for one frame; default stagger `0` (an emerge "appears", a cascade is sequential). `normalizeReelBehaviour` is written against `SWAP_STYLES` — a per-literal check silently dropped `'emerge'` on save. `swapStyleUsesColumnStagger` is the one home for which styles spend the stagger.

- 2026-08-21 — **The clear step works under a column cascade, per column.** `clearBoard` needs only `swapInPlace` now: under `dropIn` it clears the whole board before the drop, under `columnCascade` it REPLACES that column's drain (`clearOutgoingSymbols(reelIndex?)`; resolved flag `boardClearsOutgoing`). The cascade reads the flag once before the sweep. **Load-bearing:** `tumbleBoardRemoveExploded` takes an optional `reelIndex`, because concurrently staggered columns would otherwise remove a neighbour's mid-explosion symbols; absent ⇒ every column (parity).

- 2026-08-21 — **Reel behaviour moved from the Scene Editor into this config.** `swapInPlace` / `swapStyle` / `columnStaggerMs` lived on the per-`layoutType` `reelGrid` node, so one game could roll in portrait and swap in landscape. They moved verbatim into a `reelBehaviour` block (`packages/game-config/src/reelBehaviour.ts`, **Reel behaviour** panel), plus `clearBoard`. Dependencies live in `resolveReelBehaviour`, never re-gated at a call site; a stored value survives its preconditions being switched off (panel + validator say it is inert). The engine reads it through `deps.reelBehaviour` on `createGameState`, passed as an accessor so the live runtime bundle isn't frozen out. Fixtures: `reelBehaviour.fixture.ts`, `verify-swap-in-place-mode.mjs`.

- 2026-08-21 — **A `ways` game's grid never reached the mock at all** (#432, follow-up to the entry below). Probing the newly-live contract endpoint for `test3` returned `{"protocol":"ways","cascade":true}` — **no `grid`**. `projectGrid` derived a board for `lines`/`cluster`/`scatter` and returned `undefined` for everything else, on the written reasoning that "`ways` needs nothing beyond the board". That is backwards: for the lines mock **the board IS the grid**, so every ways project has silently fallen back to the shared `apps/lines` 5×3 no matter what it authored — which is the whole of the reported 8×4-vs-5×3 mismatch, and was invisible while the contract only ever moved at publish time. Now only `book` is exempt (it runs `createBookMock`, which owns its own board and is handed no grid).

  A ways/cluster/scatter config legitimately carries **no paylines**; the payline requirement already applied only to `lines`, and the mock generates a full-coverage set from the dimensions for its reveal shape (the ways evaluator ignores it). Also removed a stale "Lines protocol only" claim on an orphaned doc comment that described `projectGrid` but sat above `projectCascade`.

  **Verified live** — `GET /api/game-config/mock?project=test3` now answers `grid: { reels: 8, rows: 4, paylines: [], symbols: [PIC1…PIC6, SCAT] }`. **Note the general lesson:** making the pipe live is what proved the pipe was empty. The endpoint is now the cheapest way to ask "what math is this project actually dealt?" — worth reaching for before a network-probe session.

- 2026-08-21 — **The mock RGS now FOLLOWS the config instead of being pushed a copy of it — no republish.** Owner hit `[game-config] error: the RGS deals a 5×3 board but this game draws 8×4` on the live `test3` and asked the right question: _"I want the RGS to always work with whatever I set in the project config — why do we always have to update the server manually?"_ The answer was that the mock's whole math contract (grid, paylines, in-play symbol pool, wild, cluster/scatter shape, `cascade`, protocol) travelled ONLY at publish time, frozen into `test_server/games.json`, while the client reads `/config` LIVE. Two sources for one fact, one of them a snapshot — so drift wasn't a bug in the sync, it was the design. The 2026-08-20 mismatch check below made the drift visible; this removes it.

  **The mock PULLS.** `publishGame` stamps `docBase` + `readToken` into the manifest entry — a pointer, not a copy — and `services/test-server/server.mjs` re-reads `GET <docBase>/api/game-config/mock?project=…&k=…` (TTL ~10s per game, awaited on the RGS path so a change lands on the very next spin, not the one after) and rebuilds that game's mock the moment the answer's fingerprint changes. Player **balances carry across** the swap; open rounds are dropped (a round dealt on the old grid cannot settle on the new one) and `configSent` resets, so the client's next `config` event describes the board actually being dealt.

  **One derivation, two paths.** All of `projectGrid`/`projectWild`/`projectLineSymbols`/`projectSymbolPaytable`/`projectCascade`/`protocolFor` moved out of `publishGame.ts` into `mockContract.ts` behind `resolveMockContract(projectKey)`; publish snapshots what it returns and the new endpoint serves it verbatim. The snapshot can therefore only ever be an OLDER copy of the live answer, never a different one — which is the property that makes the fallback safe. The endpoint is gated by `projectAllowsRead` (the same public read token the running game already uses; the test server needs no secret of its own) and the live answer goes through the same defensive `validGrid` the external manifest does.

  **Best-effort by construction:** no pointer (an entry published before this, or by the standalone/desktop script — neither can mint a read token), an unreachable launcher, or a malformed answer all leave the running mock untouched, and a failure is cached for the same TTL so a down launcher is asked once per window. Verified end to end offline — a fake launcher + the real server in `TEST_SERVER_LOCAL` mode: a published 5×3 snapshot deals 5×3, the "author" edits to 8×4 with no publish and no `/refresh`, the very next spin's `config` event declares **8×4**, and killing the launcher entirely keeps it dealing 8×4 rather than breaking play.

  **What did NOT change, deliberately:** a real RGS stays authoritative. That direction is a certification requirement, and `__IE_SERVER_CONFIG__` still outranks the local config. This only makes OUR mock — which has no math of its own to defend — derive its answer from the project instead of from a stale copy of it. `warnOnServerGridMismatch` stays for exactly the cases where the server genuinely isn't following (no pointer, launcher unreachable, real RGS) and its message now says so instead of "re-publish the game". Tool guides updated ([game-config](../tools/game-config.md) _Reaching the server_, [test-server](../tools/test-server.md)).

- 2026-08-21 — **A scatter math verifier — and it says the live `test5` pays 413x per spin.** `waysmath` measures a ways doc; `scattermath` is its sibling for the model that pays by COUNT ANYWHERE, with the two things that model needs and a per-line tool cannot express.

  **A threshold has to be read against the BOARD.** `minCount` only means anything if it sits meaningfully above the average number of a symbol on a board; below that, paying is the DEFAULT state and not paying is the rare event — a different game from the one the config appears to describe, and invisible in every number a per-line tool prints. So the headline is not the RTP, it is `expected` vs `minCount` per symbol. The RTP follows from it.

  **And the cascade is part of the measurement.** A scatter game tumbles, so its return is chain-dependent and a single-board RTP understates it by whatever the chain multiplies. `docs/design/game-type-templates.md` recorded that as the reason the ways verifier does not cover cascade RTP; this closes it. Each spin is played to the end of its chain, refilling from the same strips, and the tool reports how often the chain hits the mock's 12-step cap — a chain that keeps hitting it is a game that never settles.

  **What it says about `test5`** (8x8, 64 cells, `minCount: 9`): four of eight symbols average AT OR ABOVE the threshold (H4 11.4, L2 11.7, H2 9.9, L3 9.0 per board), so H4 pays on 80% of dealt boards and L2 on 81%. Hit rate **100.00%**, average chain **12.00** tumbles, **99.8%** of spins hit the cap, RTP **41,355%**. That is the measured form of the owner's report that the win frames looked wrong — the board comes to rest still paying because the cascade is cut off, every spin. A `--min-count` sweep (the flag exists so a threshold can be TRIED before it is authored) puts the knee around 16-20: 14 → 8,029% / 71% hit / 2.7% capped; 16 → 1,082% / 33%; 18 → 233% / 12%; 20 → 51% / 3.2%.

  **`scattercrosscheck` holds the doc-scorer against the mock's `evaluateScatterPays`** over 80,000 random boards, in four configurations — with and without a wild, against a SPARSE table (whose gaps are where a threshold lookup and an exact-match lookup diverge — the mock shipped that bug once) and a DENSE one that makes every board pay so the agreement is not mostly-empty. The dense case earned its place immediately: the first version used a low `minCount` against the sparse table and produced identical win counts at 8 and 2, because a count below the table's floor finds no row to price it — agreement about nothing, which the numbers made obvious.

  Scope is stated in the output and is narrower than it looks: base-game symbol pays only, no free-spin feature (its award structure is not in the config), and no multiplier COLLECT — which symbol carries a multiplier and what values it takes are invented by the test server, not declared. Lives in `tools/game-config-spike` beside the ways arm. eslint clean.

- 2026-08-21 — **`cascade`: the first BOARD MECHANIC the config states, and it defaults off the win model.** Owner's live `test5` scatter game was not tumbling, and asked for the switch to live in the pipeline UI — "but I also think it should be automatic, since we already set the game's type". Both, and in that order: `cascadeDefaultFor(type)` says `cluster`/`scatter` tumble and `lines`/`ways` do not, and `doc.cascade` overrides it when a project disagrees. Read through `resolveCascade`, never off the field, for the same reason `resolveWinModel` exists — otherwise "absent means it depends on the type" gets re-implemented at each site and eventually mis-implemented at one.

  **Deliberately NOT a field inside `winModel`.** A cascade is a board mechanic rather than a template ([game-type-templates.md](../design/game-type-templates.md) Phase F), so a lines game is allowed to tumble and a cluster game is allowed not to. Folding it into the model would have made those two states unsayable.

  **The storage rule is the whole risk.** `normalizeCascade` keeps the field ONLY when it departs from the type's default, so a cluster game that simply tumbles stores nothing and every doc authored before this is byte-identical — the same invariant `normalizeWinModel` holds by dropping `lines`. `/config`'s setter mirrors it exactly (choosing the default DELETES the field), because a page that writes the agreeing value back makes the doc look dirty, save, and come back changed. 26 assertions in `packages/game-config/cascade.fixture.ts` pin both halves; `check:game-config-defaults` confirms all three committed templates unmoved.

  **Reaching the game:** `publishGame` syncs an explicit departure into the test-server manifest entry (`cascade`), where it outranks the protocol default. Also fixed on the way past: the panel's hint still said a non-lines model "plays as lines regardless of what is saved here", which stopped being true when the ways, cluster and scatter evaluators landed — it now says the model is honoured end to end and that changing it needs a republish. Tool guide updated ([docs/tools/game-config.md](../tools/game-config.md), _Tumbling (cascade)_).

- 2026-08-20 — **A client/server board mismatch is no longer silent: the game says so at boot.** `test4` (a cluster project) "stopped working" the moment its grid went to 6×6. It was not the grid: `boardDimensions()` sizes the board off the authored `numReels`/`numRows`, which an online project fetches LIVE, while the mock RGS sizes ITS board off the copy of that grid synced into the test-server manifest (`test_server/games.json`, field `grid`) at PUBLISH time. `test4`'s entry carried no valid grid, so `makeMock` fell back to the shared `linesGrid` default — the client drew 6×6 cluster while the server dealt `apps/lines`' 5×3, 20-payline, PIC/SCAT board. Diagnosing that took a network-probe session, because **both numbers were already in the client and nothing compared them**: the server overlay only ever consumed `window` to size the cosmetic spin blur (`serverPaddingReels`).

  **The check is `warnOnServerGridMismatch()` in `engine-game`'s `gameConfig.ts`**, and it is fired from BOTH ends because neither alone is sound. `Game.svelte` calls it at boot — deterministic today, since `<Authenticate>` gates the game's mount on the very request whose `config` event publishes `__IE_SERVER_CONFIG__`, so the declared window is already in. `serverConfig()` calls it too, so a host that mounts the game first and authenticates after still gets the check on the next accessor read instead of silently never. It latches on the first config that actually declares a `window`, so it costs one comparison rather than one per render, and `resetGameConfigCache()` releases the latch — a verdict reached before the live runtime bundle landed was reached against the COMPILED template's board, not the authored one.

  **`console.error`, not `warn`**, matching this file's existing rule: an error is for a config that cannot render what it claims. Every cell outside the server's board stays empty and wins are scored on a grid nobody is looking at, which is not a cosmetic drift. A config with no `window` decides nothing, so a host that omits it (plain `rgs-requests`, the real engine RGS) is byte-identical to before.

  Verified live, both directions, against `apps/lines` on the Play4Fun facade + the standalone mock: `REELS=7 ROWS=7 node scripts/mock-rgs-server.mjs` → `[game-config] error: the RGS deals a 7×7 board but this game draws 5×3 …`, exactly once despite the dev double-mount that prints the neighbouring `symbols.W` warning twice; the same mock at its default 5×3 → silent. `tsc --noEmit` on `engine-game` shows the same three pre-existing errors as `origin/main` and no new ones; eslint + prettier clean.

- 2026-08-20 — **Docs that already hold an un-scopeable atlas ref are repaired on the ship path — the layout doc and component defs join the clips and card params.** The picker no longer writes these refs, but every doc authored before that still carries them. **What this restores is the atlas PIN, not missing art:** since `parseScopedFrameRef` degrades an un-scopeable prefix to the bare frame name, the art already renders — what it loses is the scoping, so two sheets packing the same frame name collide in the flat texture cache and the last-loaded one wins. That is the silent wrong-art-in-game failure the scoping was introduced to end, and it is what this closes.

  **One new repair, wired at the seams that already existed.** `repairLayoutDocAtlasRefs` runs inside `editorStorage.loadDoc` — the ship-path loader every downstream reader goes through (the runtime bundle, the editor-art export, the bake's `/api/editor/doc`) — while the editor's own `loadDocWithEtag` stays untouched, because it backs the compare-and-swap and a save must round-trip what it loaded. It covers a sprite's `assetKey` (a WHOLE atlas ref, unlike every other field) and its `region`, plus `componentInstance` param values. Component defs need a second entry point: `loadComponent` has no client key, so `repairComponentDefsAtlasRefs` runs where the defs are resolved and the client key is in hand — beside `resolveSpineKeysForComponentDefs`, the post-resolve fixup it is the atlas twin of.

  **A false alarm found while wiring it:** `collectArtRefs` added a sprite's `region` to `usedRegions` RAW, but a region can itself be a scoped ref (what an image-kind param binding stores). The dangling guard then compared `<assetKey>::<frame>` against bare region names and reported a perfectly good frame as "in NO shipped atlas". It now parses the region the same way `LayoutNodeView` does, and adds the pinned manifest to the export set.

  **The candidate test is deliberately loose**, matching the clip and card-param repairs: `needsAtlasRefRepair` accepts any path-shaped prefix, so a non-art param value containing `::` IS offered to the resolver. That is safe — a repair can only make a ref MORE specific, so an unresolvable prefix comes back untouched — and costs one cached R2 listing. The fixture pins it rather than pretending otherwise, because the alternative (tightening by param KIND) needs the component defs at `loadDoc` time, which it cannot see.

  Verified: new `apps/launcher-api/atlasRefRepair.fixture.ts` (18 assertions, bundled with the esbuild recipe in `apps/launcher-api/CLAUDE.md`) drives the walk with a STUB resolver, so what is under test is which fields carry an atlas ref and — the half that matters more — what is left strictly alone: prose, a spine bundle name shaped like a scoped ref, a `spine`-kind param default, a text node, a non-string param, and a correct ref. The stubbed resolver is also how the loose-candidate behaviour got caught: the first run showed a prose value being offered to it, and the assertion now states that contract instead of a wrong one. `launcher-api` builds clean; eslint clean on the changed files.

- 2026-08-20 — **The region picker now stores a scopeable atlas key — the root cause behind the missing card art, fixed at the source.** The earlier fix repaired `/config`'s refs on the way out; this stops them being written wrong. `RegionPicker` scopes a pick by its `sheets[].key`, and for a Sheet-Maker sheet that key came from `listSheets`, which reports the R2 output PREFIX (`…/sheets/S_Gem/`). The editor-art export registers a sheet's textures under its MANIFEST key, so every scoped pick from a sheet named a namespace nothing registers — silently, in all four tools that write scoped refs (`/editor`, `/components`, `/symbols`, `/config`), not just the config.

  **`SheetAsset` gains `manifestKey`; `key` is untouched.** Changing `key` is the tempting one-liner and is wrong — that field is the R2 prefix the FTP browser and the sheet tool address a sheet by. The new field is resolved in `listSheets` from ONE recursive listing of the sheets root rather than a `resolveManifestKey` round trip per sheet: this runs on ordinary page loads, and N sequential R2 listings is the sort of cost that quietly makes a tool slow to open. Only files DIRECTLY in a sheet folder count — not a shortcut, but a match for what `resolveManifestKey`'s delimited listing can see, since counting a nested JSON here would let the picker name a manifest the repair pass would never resolve to.

  **All four picker lists were the SAME hand-copied derivation**, which is how they could have drifted apart without anyone noticing. They now share `pickSheetsFrom` (`$lib/pickSheets.ts`), and `pickManifestKey` — "which of a folder's JSONs IS the manifest" — has one implementation used by both the picker's listing and `resolveManifestKey`. A disagreement between those two is precisely the bug, so they no longer get to disagree. A sheet with no resolvable manifest is still listed under its prefix: its frames stay pickable, and a ref scoped by it degrades to the bare frame name rather than vanishing.

  Verified: new `node apps/launcher-api/pickSheets.fixture.ts` (12 assertions, runs directly because `$lib/pickSheets.ts` is dependency-free by design) pins the manifest choice, the folder attribution including the nested-JSON trap and a JSON-less sheet, and — the regression itself — that a sheet WITH a manifest can never yield its output prefix. `launcher-api` builds clean; eslint clean on the changed files.

- 2026-08-20 — **`/config`'s Identity section is gone — three of its four fields were write-only.** Owner: "I want you to do that only if they are used, otherwise I want them removed". They are not used. A whole-repo search for `providerName` / `gameName` / `gameID` found **no reader**: only the `GameConfigDoc` type requiring them, the six `apps/*/game/config.ts` samples declaring them, the committed defaults, and fixtures setting them to satisfy the type. The section's own hint claimed they were "shown on the info page and used in the RGS handshake" — neither is true here: the info page renders from `infoManifest`, the RGS handshake goes through the Play4Fun facade which sends none of them, and the on-screen title comes from the launcher's project name via `applyHudGameNameDefault`. The only `gameID` in the RGS code is a COMMENT in `Authenticate.svelte` showing what a Stake RGS sends BACK. So the fields asked an author to invent values that changed nothing, which is why every project still read `sample_provider` / `0_0_lines` — there was never a reason to edit them. **`rtp` stays** (it is read — `gameProfile.ts` renders the "97% RTP" line), so the section is now "Return to player" with that one field. **The doc fields stay in `GameConfigDoc`**: that shape mirrors the upstream Stake config and is the contract if this ever talks to a Stake RGS directly, and removing them would churn six app configs, three committed defaults, the normalizer and every fixture for no gain. A comment at the old site records what happened and the condition for giving them a UI again — something reads them, and then seeded from the project's client + name rather than typed. This supersedes the previous suggestion to seed them from the project: seeding a field nobody reads is still a field nobody reads. Doc (rule 9): `docs/tools/game-config.md`'s panel list now describes a **Return to player** panel and records why the Identity trio went.

- 2026-08-20 — **The lines template advertised a payout no player could win.** Owner's `/config` on `test4` showed `symbols.W.paytable — W pays in the paytable but appears on no reel strip`. It is not a `test4` problem: the committed **`lines.json` template** carried it (`W` = `{3:5, 4:10, 5:20}`, on no strip), so EVERY project seeded from lines inherited an unwinnable advertised payout — `ways` and `scatter` were already clean. `validateGameConfigDoc` has flagged exactly this for a while ("the `W` bug, generalized"), so the warning was correct and simply unactioned. **Behaviour-neutral to remove:** `projectWild` (publishGame) gates the mock's wild on the SAME `symbolsInPlay` set — "a wild that merely sits in the dictionary with a paytable but is never dealt stays wild-less" — so nothing read the row except the INFO PAGE, which showed three payouts a player cannot collect. Fixed at source (`apps/lines/src/game/config.ts` → `paytable: null`) and regenerated. **The alternative fix was deliberately NOT taken:** putting `W` on the strips would make the wild actually deal, which changes hit frequencies and starts feeding the mock a wild — that is game MATH and belongs with a math export, not a lint fix. The residual warning is now the milder branch of the same rule (`W is in the dictionary but appears on no reel strip`), which is the honest state: the sample declares a wild it does not deal. **Existing projects keep the old row** — their authored config lives in R2, so `test4` needs "Reset to template default" or W's paytable cleared by hand to clear the warning there. Also: the bet-mode **RTP** input gained the `min`/`max` bounds the identity RTP already had (both were already `type="number"` — an earlier claim that RTP was free text was wrong). Both apps build; eslint clean.

- 2026-08-20 — **A ways math VERIFIER — so an arriving math export can be checked instead of trusted.** `apps/ways` ships cosmetic padding reels and says so in `config.ts` ("inventing those here would be fabricating game math"); `apps/lines` ships real 217-cell strips that came from the math SDK export. The export itself has to come from a math engine, so the gap that COULD be closed here is the check that receives one. `pnpm --filter game-config-spike run waysmath` reads any Game Config doc, deals boards off its strips (independent uniform stop per reel, `numRows` consecutive cells with wraparound — the property a uniform strip set does not have), scores them with the ways rule priced per WAY (`totalBet / waysCount`, #357), and reports RTP, hit rate, best spin, scatter-trigger rate and per-symbol contribution. Everything is read from the doc — paying symbols, wilds, scatters, board shape — so it verifies any project, not just `apps/ways`. **What it says about the current placeholder:** 0.13% RTP against a declared `rtp: 0.97`, a 3+ scatter board **1 spin in 6** (lines, for contrast: 1 in 1,190), and a declared wild `W` that appears on no strip and therefore can never land. **Two guards against the tool itself lying.** `waysCrosscheck` holds the doc-scorer against `mock-rgs-server`'s `evaluateWays` over 40,000 random boards — symbol, run length, ways count AND pay amount, with and without wild substitution — because a second implementation of one rule is how a measurement quietly stops describing the game; the mock evaluator can't just be imported, being bound to its own PIC/SCAT vocabulary and hardcoded paytable. And the tool REFUSES to print an RTP for a non-`ways` doc (it would understate the return by the ratio of the two divisors and still read like a measurement) — it prints the strip diagnostic and stops. It also prints its own scope every run: base-game symbol pays only, no free-spin feature (the award structure isn't declared in the config, so no total RTP is computable), and the reminder that the client never computes wins — the RGS does, and in production it is external. Lives in `tools/game-config-spike` rather than a new workspace package, deliberately: adding one churned `pnpm-lock.yaml` with unrelated lingui peer re-resolution, which CI's `--frozen-lockfile` would have had to swallow. Verification tooling only — no engine or runtime change.
- 2026-08-19 — **Per-type committed defaults: `scatter` ships its own, and a silently-dropped tier set was repaired.** `gameConfigDefaults` had exactly one template (`lines`) and fell back to it for every other type, so a project marked anything else inherited the lines dictionary and its 20 paylines. `scatter.json` now ships with `winModel: {type:'scatter', minCount:8}`, the minimum **derived from the game's own paytable** rather than written down (a game whose smallest paying row is 8 has `minCount: 8` by definition; hard-coding it would let the model drift from the payouts). Measured: ways 3, cluster 5, scatter 8. **⚠️ Regression found + fixed here:** the generator reads `winLevelMap.ts` as a sibling of the config, and Phase A moved `apps/lines`' copy into `engine-game` — the surrounding `try/catch` cannot tell "this game has no tiers" from "the file moved", so regenerating silently dropped **all 10 win tiers** (112 lines) from the lines default while still validating clean. Now tries sibling → `engine-game`, and **warns loudly** when neither is found. **`ways`/`cluster` are deliberately unregistered:** their upstream sample configs ship `paddingReels: { basegame: '', … }` — empty-string placeholders, and the strips are the in-play gate, so such a default would seed a blank board. Closing it needs real strips authored in those configs; synthesizing them is game math, not packaging. `--check` stays green and usable as a CI gate.

- 2026-08-19 — **`winModel` on `GameConfigDoc`** — `lines` | `ways` | `cluster` | `scatter`. The
  `lines` arm carries no payline data and `normalizeWinModel` DROPS it, so every older doc is
  byte-identical; read it via `resolveWinModel()`, never `doc.winModel`. A non-lines doc skips the
  payline checks and gets its own bounds check.

- 2026-08-07 — **Payline coverage-regeneration + per-project wild on the mock RGS.** Two follow-ups to
  the per-project grid (#259): (a) the lines mock now regenerates a full-coverage payline set
  (`standardPaylines`/`coversAllRows` in `scripts/mock-rgs-server.mjs`) when a game's authored lines
  don't touch every row of its (resized) grid — fixes "nothing pays on the bottom row" on a board that
  outgrew its 5×3 lines; (b) when a wild symbol is IN PLAY (on the strips) with a paytable, the mock
  declares/deals/pays `WILD` with left-align substitution (facade maps `WILD → W`), so an in-play `W`
  finally pays. Chain: `publishGame.projectGrid` adds `wild` (via `symbolsInPlay` + the symbol's
  `special_properties`) to the manifest `grid`; `testServerManifest` carries `grid.wild`; the test
  server's `validGrid` passes it through to the lines mock. Wild keys off the SAME in-play gate as the
  paytable, the roll and `/symbols` — a dictionary-only paytable stays dead everywhere. No snapshot /
  no in-play wild ⇒ committed default ⇒ Hot Fruits / Book of Borut byte-identical. Verified offline
  (`node` fixture, 20 assertions: default parity, 5×5 coverage, wild-substitution math).
- 2026-07-27 — **Per-payline colours.** Optional `paylineColors: Record<lineId, '#rrggbb'>`
  (not part of a math export); `paylineColor(lineIndex)` feeds all three `winLineShow` sites, and
  `WinLine.svelte` publishes the colour as `stateGame.winLineColor` — the hook any component can
  read to tint itself to the winning line.

- 2026-07-27 — **Fix: online reel stopped rolling.** The grid-dimensions `rebuildBoard()` reassigned
  `stateGame.board = buildBoard()`, orphaning the `enhancedBoard` (createEnhanceBoard) that closes
  over the board array at module init and drives every preSpin/spin/settle — so online (the only path
  that calls `rebuildBoard`, after the live bundle lands) the rendered reels were static while spin
  animated the old detached reels. Fixed by rebuilding IN PLACE (`stateGame.board.splice(0, len,
...buildBoard())`) so render + enhancedBoard stay on the same reels. Also repointed the dangling
  `boardRaw()` `board` reference (left undeclared when #97 removed `const board`) to `stateGame.board`.
  Ships to online games via a Runtime release.
- 2026-07-24 — Phase 5: `publish-symbol-defaults.mjs` now gates its symbol set on the AUTHORED game
  config (fetched from `GET /api/game-config/doc`) when a project has one, falling back to the
  compiled module — so the Symbols grid mirrors what actually ships. Fixed a self-inflicted
  regression: `constants.ts` (imported standalone by that script) must not pull in
  `gameConfig`→`editor-scenes`, so the `paddingReels()` accessor moved to `gameConfig.ts` and its
  consumers import it there.
