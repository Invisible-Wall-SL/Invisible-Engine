# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** ✅ **SHIPPED + live-verified (owner-confirmed 2026-08-04).** All five build-plan
phases landed AND the grid-dimensions enhancement — an authored config drives the
symbols/paytable/paylines/bet-modes AND resizes the board in the game, the mock RGS and the Scene
Editor preview — and the owner has clicked through the `/config` + `/editor` launcher surfaces and
tested it end-to-end. The live-verify gap that was the last open item is closed.

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
- `gameConfigDefaults.ts` — `gameConfigDefaultFor()`, `listGameConfigTemplates()` (the "Reset to
  template default" menu), and `resolveGameConfig()`, the ONE entry point that owns the precedence
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

**Still hardcoded, on purpose:** grid dimensions. `BOARD_DIMENSIONS`/`BOARD_SIZES` derive from
`INITIAL_BOARD`, not from `numReels`/`numRows`, so an authored grid size does NOT yet resize the
board — scene geometry and layout coordinates are pinned to it, and that deserves its own change.
The scatter paytable row is also still synthesized (`[2, 20, 200]`) because those multipliers have
no home in the engine config shape; only the scatter's SYMBOL is read from the config now.

**Deviation from the design doc, deliberate:** Phase 1 called for a Zod `GameConfigDoc` in the
launcher. It has none. A Zod mirror would be a second, hand-copied answer to "what is a valid
config" inside an app whose `build` is not a type-check — the `COMPONENT_PARAM_KINDS` failure mode
(see `apps/launcher-api/CLAUDE.md`). The canonicalizer + validator are that one answer and produce
better 400s. Reversible if a use case demands Zod.

All five build-plan phases are done, plus the grid-dimensions enhancement. What remains is
verification the local environment couldn't reach, plus one deferred follow-up.

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

**Deliberately still hardcoded:** grid dimensions are the board COUNT + pixel size. Nothing else
about the grid (the scene-geometry anchors, the HUD layout) is config-driven — those remain authored
in the Scene Editor per game.

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

**The `/config` Win tiers panel.** New section after Bet modes: add/remove/reorder tiers (↑/↓), edit
name/threshold/type/spineKey/duration/animation names/sfx/bgm, an escalation toggle + start-tier select,
and a resolved-ladder preview. Written SPARSELY (the block + flags exist only once a tier is added), so
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

## Sounds panel — the game-wide sound SLOTS (2026-08-25)

New `sounds` block on `GameConfigDoc` + a **Sounds** section in `/config`: which cue the game plays
at each named presentation moment. This is the game-wide half of the sound-binding work; the
per-symbol half is `/symbols` → Symbol sounds. **The full story — why 26 of 53 shipped sounds had
never played, and the slot model — is in `docs/status/engine.md` (2026-08-25).**

What is specific to this tool:

- **`packages/game-config/src/sounds.ts`** owns the catalogue (`SOUND_SLOTS`), the binding type
  (`GameSounds`), the resolver (`resolveSounds` → `slot`/`pick`), the departure-only normalizer
  (`normalizeSounds`), and the id-free picture/royal routing (`landSlotForSymbol`). Dependency-free
  like the rest of the package, so it is fixture-verifiable offline —
  `packages/game-config/sounds.fixture.ts`, 36 claims.
- **The default is INVERTED from every other optional block here.** Elsewhere absent means "what the
  engine did before this block existed"; for sound that was *nothing*, so absent resolves to the full
  catalogue instead. A block that defaulted to the old behaviour would ship the fix switched off.
- **The panel stores only DEPARTURES.** A binding equal to the catalogue is dropped on normalize, so
  a config that opens the panel and saves serialises byte-identically to one written before the block
  existed — and keeps TRACKING the catalogue rather than pinning that day's copy. `resolveSounds`
  is read through everywhere for the same reason `resolveReelBehaviour` is: the tool and the engine
  must not be able to answer "what does absent mean" differently.
- **`enabled: false` is the only silence**; an empty `names` list means "give me the default back",
  which is the far likelier accident. The `+`/`−` rung controls refuse to go below one for that
  reason.
- Verified: the fixture above, `pnpm --filter launcher-api build` (green — a bundle check, not
  types), `pnpm --filter launcher-api check:sound-bindings`, and a live spin in `apps/lines` proving
  the resolved bindings reach Howler. ⏳ **The `/config` Sounds panel itself is not owner-verified in
  the browser** — build-green only, same caveat every launcher panel carries.

## Open items / next

0. ✅ ~~**Un-scopeable atlas refs**~~ — CLOSED (2026-08-20, three changes, see Recent changes):
   `parseScopedFrameRef` degrades one instead of dropping the art; `RegionPicker` no longer writes
   them (`SheetAsset.manifestKey` + the shared `pickSheetsFrom`); and every doc that already holds
   one — clips, card params, the layout doc, component defs — is repaired on the ship path. The one
   deliberate gap left: the repair's candidate test is loose by design (`needsAtlasRefRepair`
   accepts any path-shaped prefix), so a non-art string containing `::` is offered to the resolver
   and survives only because the resolver declines it. Tightening that would need the component
   DEFS at `loadDoc` time, which it cannot see; the fixture pins the behaviour instead.

1. ✅ ~~**Live-verify the launcher surfaces**~~ — DONE (owner click-through, 2026-08-04): `/config`
   panels, off-grid payline block, raw-JSON paste, save round-trip, the `Match grid` repair flow,
   per-payline colour in-game, AND a non-5×3 end-to-end spin all verified live. The one gap offline
   verification couldn't reach is closed.
2. **Validate against the RGS** (design doc open decision 3) — compare the config's symbol set to
   the first `reveal` and warn on a mismatch. `warnOnGameConfigIssues()` is the natural home; it
   would have caught the wild on the first spin.

**Not a gap:** `packages/game-spec`'s generator emits const-based `paytable.ts`/`infoManifest.ts`,
but it is a standalone CLI that `new-game.mjs` does NOT call — the scaffold copies `src/` from an
existing game (now `apps/lines`, with the accessor-based files), so a new game inherits the authored
-config wiring automatically. Left as-is on purpose.

## Blocked (owner / external)

- _None._ The live-verify that was the standing external gate is done (owner-confirmed 2026-08-04).

## Recent changes

- 2026-08-27 (fix) — **`gen:game-config-defaults` silently stripped every win tier from all three committed defaults, exited 0, and reported success.** Found while chasing what looked like a pre-existing `check:game-config-defaults` failure on `main`. **There is no drift and the three JSONs are correct** — `lines/ways/scatter.json` each carry their 10 tiers and the check is green on a complete install. What actually fails is the generator under an INCOMPLETE one. Every `winLevelMap.ts` opens with `import { SECOND } from 'constants-shared/time'`, so after `pnpm install --filter launcher-api...` — which installs launcher-api and its deps but not `apps/ways`, `apps/scatter` or `packages/engine-game` — that import throws `Cannot find package 'constants-shared'`. The candidate loop caught it with a bare `catch {}` meant for "this game keeps its table elsewhere", so the failure was indistinguishable from absence: `--check` blamed the committed JSON (`is stale — re-run without --check to regenerate`) and the WRITE path did exactly what that invites — **measured: all three files rewritten with `winLevels: []`, 10 tiers lost each, exit code 0.** Fixed by splitting the two cases: a candidate that does not exist is skipped as before, while one that EXISTS and will not import now prints the module and the underlying error, names a partial install as the likely cause, and **refuses to write** (exit 1). Verified four ways on a full install and with `constants-shared` hidden from all three packages: green when complete; the real cause named instead of "stale" when broken; the write path exits 1 and leaves the files untouched; and the pre-fix generator reproduced against the same broken tree to confirm it really did rewrite them at exit 0. **Note for the reader of the 2026-08-05 entry below:** its aside that "the sole failing check is the pre-existing CRLF `lines.json` drift … `winLevels` is absent from the derived doc" describes this same symptom and should not be trusted as a CRLF diagnosis.

- 2026-08-27 (fix) — **The emerge cascade shipped with two real defects; both are fixed and both now have a test that fails without the fix.** Reported within minutes of the previous entry going live: _"the behaviour now seems very broken and there is a long delay between the landing and the explosion of the matching symbols"_. Both were invisible to the 548 checks that were passing, and both are worth recording because the assertions that missed them were the obvious ones. **(1) THE REFILLS OVERLAPPED THE SURVIVORS.** `tumbleBoardAppear` placed every arriving symbol in the same pass that started the survivors' slide — and a refill's seat is very often the seat a survivor is still sitting in, because the refills stack DIRECTLY above the survivors, making the topmost survivor's old seat the bottom refill's new one. For the whole 200 ms slide the new symbol sat on top of a symbol that had not left yet. The handler is now two phases: the survivors vacate (awaited), then the arrivals surface. The survivors' own `land` beat moved into phase 2 so it runs ALONGSIDE the arrivals rather than gating them — putting it in phase 1 would have added its entire cap to every step for a picture nobody is waiting on. A reveal has no survivors, so phase 1 is empty there and that path is unchanged. **(2) THE LONG BEAT CAP WAS PAID ON ART NOBODY AUTHORED.** `INTRO_BEAT_CAP_MS` is 2000 ms, sized off the reference spines so an authored emerge sets its own pace. But an un-authored `intro` INHERITS `land` (or the resting `static` art), and neither reliably reports completion — so every project that had not yet bound an intro, which is every project, paid the full 2000 ms on every arrival. Measured: **2650 virtual ms per cascade step against the shipped slide's 1500**. A cap the common case always pays is not a runaway guard, it is the pace. A new `hasAuthoredSymbolState` (reusing `resolveSymbolState`, so "authored" means exactly what the renderer means) decides it: authored art gets the long cap, everything else gets `TRANSIT_BEAT_CAP_MS` — what the landing it fell back to would have cost anyway. The cascade is back to **1500 ms, identical to the slide**, asserted as that equality rather than as "is fast" so it cannot drift as either presentation is re-timed. **Verification:** 548 → **553 checks**. The two new behavioural assertions are stated on the virtual CLOCK, because that is what the player experiences: no refill is placed before the LAST survivor slide has finished, and an un-authored emerge costs exactly what the slide costs — plus a third confirming an authored intro still gets the longer cap, and a fourth pinning the difference to the two constants (read out of `symbolBeat.ts`, not restated). The harness gained a controllable `authoredIntro` predicate, defaulting to nothing-authored, because a fixture that could only exercise one answer would not be testing the rule. Mutation-tested three ways — the cap paid unconditionally, the phases collapsed back into one, and the cap policy inverted — all three fail it. **The lesson for the next timing feature:** every assertion in part 10 was about ORDER and CONTENT, and both defects were about TIME. A presentation fixture needs at least one assertion denominated in milliseconds.

- 2026-08-27 (follow-up) — **The emerge style governs a WIN too, not just the spin.** Owner, first thing on trying it: _"it seems to work for the Spin, but when the symbols match for a win, the New symbols still fall down from the top, and I think we should really have the same behaviour, not 2 different one!"_ Correct, and the gap was structural: the style was wired into `presentReveal` (the `reveal` book event), while a cascade step is a DIFFERENT book event handled in `bookEventHandlerMap.tumbleBoard`, which always broadcast `tumbleBoardSlideDown`. That handler now picks its arrival from the same `swapStyle`, so there is one answer for the whole game. **The fix is deliberately ASYMMETRIC, and that is the part to remember.** A cascade has two populations on the overlay, and only one of them is arriving: `combineTumbleReel` stacks the refills ABOVE the survivors — the engine's gravity model, and the board the SERVER scored the next step against — so a symbol that did not win still changes seat. Placing everything instantly would land on the RIGHT board and show the player a non-winning symbol teleporting down its column; the tempting "nothing moves at all" reading is worse still, because filling the hole in place produces a DIFFERENT board from the one the server scored ([[gotcha_cascade_client_board_diverges_from_server_board]] is that bug, already paid for once). So `tumbleBoardAppear` now asks which LAYER a symbol came from — by object identity against `stateTumble.adding`, since a survivor and a refill can hold equal `rawSymbol`s — and answers twice: a refill appears (`duration: 0`, `intro`, its own emerge cue), a survivor slides (200 ms `backOut`, `land`), exactly as the slide moves it. A REVEAL has no survivors (`keepBase: false`), so it reduces to the previous behaviour and the reveal path is byte-identical. **Verification:** `verify-swap-in-place-mode.mjs` 533 → **548 checks**, with a part 10 that drives a REAL cascade step against a board that has survivors — the BOTTOM visible row explodes, deliberately, because a survivor below an exploded cell keeps its seat and exploding the top row would leave nothing moving for the assertions to catch. It asserts both halves (one instant placement per column, two 200 ms ones), that only the refills ask for an emerge cue, that every visible cell still reports a landing whichever way it arrived, and that the settled column is `[pad, refill, survivor, survivor, pad]` — refill above, not in the hole. Mutation-tested five ways (the branch removed, the branch inverted, survivors placed instantly, refills treated as survivors, and the refill spliced into the hole instead of above); all five fail it, including the board-divergence one. The coded handler's branch is asserted at SOURCE level, because `bookEventHandlerMap.ts` reaches XState, the flow interpreter and the RGS and cannot be stood up in a Node fixture. **Known seam:** `tumbleBoard` is a flow-ownable book event, so a flow-v2 doc that owns it drives the cascade with its own Broadcast cues and this branch is bypassed — `tumbleBoardAppear` is in the generated vocabulary, so such a doc can author the appear directly.

- 2026-08-27 — **A third swap style: `emerge` — the board surfaces in place, and NOTHING travels.** Owner ask, for a marine slot: _"I would like the symbols after the explosion to emerge from the water… I do not think right now I am able to do this, as the symbols always seem to roll from the top."_ They were right, and the gap was narrower than it looked: `swapInPlace` already killed the roll, and `clearBoard` already gave them the sink (the outgoing symbols play their authored explosion and leave). What was missing was the other half — every existing style still ARRIVES from somewhere. `dropIn` queues the new board a strip above the window and slides it into its seats over 200 ms; `columnCascade` does the same per column. Neither is reachable-by-shortening: a fall that lands in 1 ms is still a fall, and its `land` beat still fires AFTER the movement rather than instead of it. **What changed:** `SWAP_STYLES` gained `'emerge'`; `emergeRevealBoard` is the column cascade's skeleton with both motions removed (same opener, same absolute per-column stagger, same scoped re-init, same settle — only the column's own beat differs); a new `tumbleBoardAppear` cue places every symbol at `duration: 0` and plays a new authored `intro` state there. **Three decisions worth keeping.** (1) **A cue of its own, not a flag on `tumbleBoardSlideDown`** — a slide with `duration: 0` reaches the same seats but keeps the slide's contract (tween, then `land`), and the whole point of this style is that the arrival animation REPLACES the landing one; folding a "do not actually move" branch into the step every cascade runs is also the one change that could not be made without touching the shared bundle's hot path. (2) **The state is set BEFORE the placement** — one Svelte flush, so the cell's first painted frame is already the intro art; reversed, the symbol's resting art paints for one frame at full size on its final seat, a hard pop of the whole board, which is exactly the picture the style exists to avoid. (3) **The stagger default differs from the cascade's** (`0`, not 140 ms) because the defining picture does: a cascade is sequential by nature, an emerge is "the board appears" with a sweep as an opt-in flourish. `normalizeReelBehaviour` also stopped comparing `swapStyle` against the one non-default literal by hand — a per-literal check silently DROPPED `'emerge'` on the next save, handing the author back a drop-in; it is written against `SWAP_STYLES` now, and the fixture guards that. `swapStyleUsesColumnStagger` is the one home for "which styles spend the stagger", so the validator, the picker and the presentation cannot disagree. **Verification:** `reelBehaviour.fixture.ts` 56 → **76 checks** (round-trip, the unrecognised-style fallback, the stagger live for both staggered styles and inert for the drop-in); `verify-swap-in-place-mode.mjs` 412 → **533 checks**, with a new part 9 whose central assertion is a MEASUREMENT rather than an inference — the harness's `Tween` now keeps a ledger of every `set` it is asked for, because an emerge and a drop-in broadcast nearly the same cues, settle on identical boards and leave every symbol on the same seat, so the only place the difference lives is the duration. Every emerge placement is `0`; the shipped drop-in in the same run is not, which is what stops "nothing travels" passing for want of anything that could travel. Mutation-tested seven ways (the appear travels, it inherits the cascade default stagger, the padding guard is removed, the state is set after the placement, the appear is swapped back to a slide, the intro cue is dropped, the scatter counter is dropped) — all seven fail it. **Also verified live** in `apps/lines` against the mock, in real Chrome (the in-app preview pane suspends rAF, so the game never boots there): `dropIn` issues 25 tweens at `duration: 200`, `emerge` issues 31 at `duration: 0` and none above; with no `reelBehaviour` at all the reels still roll. **One fixture bug found on the way:** its ordering assertion used an `indexOf` over the whole handler block, where `tumbleBoardDrain`'s earlier `symbolY.set(` would have made it pass by accident; it is scoped to the appear handler and whitespace-collapsed now, so prettier folding a call across lines cannot fail it either.

- 2026-08-21 — **The clear step works under a column cascade too, per column — un-gating a choice the first cut wrongly removed.** Owner, on first live use: _"I do not understand why when I select column cascade, I can't select Clear the board before the new symbols fall in anymore. I would like that option also available in the cascade but per column."_ They were right and the original reasoning was wrong. `clearBoard` shipped gated to `swapStyle: 'dropIn'`, justified as "a `columnCascade` already empties each column by DRAINING it, so a clear there would be two clears for one round". A drain and a clear are not the same beat done twice — they are two different PICTURES of one beat: a drain slides the column out of the bottom of the window, a clear pops it in place. Under a cascade the clear therefore REPLACES the drain, per column, and deciding between them is exactly what this block exists for. **What changed:** the schema's only remaining precondition is `swapInPlace` (a rolling round replaces nothing, it re-spins); `clearBoardBeforeDrop` became `boardClearsOutgoing`, because what clears depends on the style and the old name asserted otherwise; `clearBoardBeforeDrop()` became `clearOutgoingSymbols(reelIndex?)`, one implementation serving both styles — absent ⇒ the whole board ahead of the drop-in, a column ⇒ that column on its own beat, in place of `tumbleBoardDrain`. The cascade reads the flag ONCE before the sweep, so a mid-round config swap cannot produce a board that half drained and half popped. **The load-bearing part is not the feature, it is the SCOPING**: `tumbleBoardRemoveExploded` filtered EVERY column, and a cascade runs its columns concurrently on an absolute stagger — so column `i + 1` can be mid-explosion when column `i` reaches its removal, and an unscoped filter takes the neighbour's symbols with it. Invisible in the end state (each column's own `keepBase: false` init resets `base` regardless) and visible in the live game only as a column emptying before its turn. The cue gained an optional `reelIndex` (absent ⇒ every column, byte-parity for the existing cascade and for the drop-in clear), mirroring the scoping `tumbleBoardInit` / `tumbleBoardSlideDown` already had. **Verification:** `verify-swap-in-place-mode.mjs` 355 → **411 checks**, with a new part 8 driving the per-column clear on the virtual clock: the clear takes the drain's place rather than joining it, each column runs explode → remove → refill → slide in order, each explode is aimed at exactly its own visible rows, the sweep stays strictly left to right, and the settle contract survives by object identity. The scoping hazard is asserted DIRECTLY — every removal's before/after column lengths must differ at exactly one index — plus a guard that the columns genuinely overlap in that run, so the assertion is not passing for want of anything to catch. Mutation-tested four ways (unscoped removal, clear-in-addition-to-drain, exploding the whole board per column, re-gating the schema to `dropIn`); all four fail it.

- 2026-08-21 — **Reel behaviour: the board's mode moved out of the Scene Editor and into this config, and grew a clear step.** Owner call: _"I do not think the scene editor and especially the Perspective option should be the place where we control this from a UI — it should be something we set in the config, in a new section called Reel behaviour, per game."_ They were right, and for a reason worth recording: a `reelGrid` node is authored **per `layoutType`**, so `perspective.swapInPlace` / `swapStyle` / `columnStaggerMs` (shipped in #407 and #425) let a schema express a board that ROLLED IN PORTRAIT AND SWAPPED IN LANDSCAPE, or swept at two speeds depending on the phone — not a configuration anyone would author on purpose, and not a bug anyone would think to look for. All three moved verbatim into a new `reelBehaviour` block on `GameConfigDoc` (`packages/game-config/src/reelBehaviour.ts`), authored in a new **Reel behaviour** panel, and were DELETED from `ReelGridPerspective` + its resolver + the editor panel (nothing authored them yet, so there is nothing to migrate — the editor section now says where they went). A fourth knob joins them: **`clearBoard`**, the drop-in's own opener — every visible cell plays its authored `explosion` state and leaves before the new board falls, reusing `tumbleBoardInit` → `tumbleBoardExplode` → `tumbleBoardRemoveExploded`, i.e. exactly the two cascade steps the drop-in omits, run for their own sake. **No new cues.** **The dependencies live in `resolveReelBehaviour`, not in a consumer** — `clearBoard` needs `swapInPlace` AND the `dropIn` style (a `columnCascade` already empties each column by DRAINING it, so a clear there would be two clears for one round), because resolving it honestly and re-gating it at the call site is the same rule written twice and one of the two eventually gets it wrong. But the STORED value survives its preconditions being switched off: a setting the author ticked must not vanish because they changed style to compare — the panel and the validator say it is inert instead. The engine reads the block through a new `deps.reelBehaviour` on `createGameState`, the same seam the board grid already arrives on, passed as the ACCESSOR so the live runtime bundle (which resolves after module evaluation) is not frozen out. Off by default end to end: an un-authored project stores no block, and `verify-swap-in-place-mode.mjs` asserts its drop-in sequence is unchanged cue for cue. **Verification:** new `reelBehaviour.fixture.ts` (56 offline checks — defaults, the two dependency rules, `0`-vs-absent for the stagger, sparse storage, the validator's four "saves but does nothing" warnings) and `verify-swap-in-place-mode.mjs` grew to **355 checks** (was 288), now driving the REAL `resolveReelBehaviour` rather than a stub so the whole chain `/config` block → resolver → engine accessors is exercised, plus a new part 7 that drives the clear step on the virtual clock (order, that the explode is awaited, that only the visible rows explode, and that the settle contract survives the clear — by object identity). Mutation-tested: ignoring the preconditions, clearing after the new board is queued, exploding the padding rows, and re-reading the stale node field each fail it.

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

  **What this does NOT fix:** docs authored before today keep their un-scopeable refs. `/config`'s are repaired on the ship path; the Scene Editor doc's are not, so they resolve through the bare-name degradation — right art wherever the frame name is unique, ambiguous wherever it isn't. See Open item 0.

  Verified: new `node apps/launcher-api/pickSheets.fixture.ts` (12 assertions, runs directly because `$lib/pickSheets.ts` is dependency-free by design) pins the manifest choice, the folder attribution including the nested-JSON trap and a JSON-less sheet, and — the regression itself — that a sheet WITH a manifest can never yield its output prefix. `launcher-api` builds clean; eslint clean on the changed files.

- 2026-08-20 — **A buy-feature card's button art was simply absent in-game — the region picker stores an atlas ref the runtime cannot scope by.** Owner's console on the live Borut remake: `Sprite: key "invisible_wall/bookofborutremake/sheets/S_Game_UI2/::T_UI_BuyBack_glow.png" is not found in the loadedAssets`. The frame exists and the sheet ships; the KEY is unresolvable. An `image`-kind card param stores `<atlas>::<frame>`, and `RegionPicker` builds the atlas half from its `sheets[].key` — which for a Sheet-Maker sheet is the R2 OUTPUT PREFIX (`…/sheets/S_Game_UI2/`), not the `<path>/<name>.json` manifest key. The editor-art export registers a sheet's frames under its MANIFEST key, so the ref named a namespace that is never registered.

  **Two failures, not one.** `parseScopedFrameRef` demands a full manifest key, and on anything else returned the WHOLE value as a bare region name — so the sprite looked up a key no sheet can ever carry (nothing draws), and `editorArtExport`'s `addImageRef`, which shares that helper, filed the same string as a dangling region (it is the sole entry in the project's `editorArt.missing`). Both readers were consistently wrong in the same way, which is why nothing flagged it.

  **Fixed on the ship path, with a degradation behind it.** `loadGameConfigDoc` — the loader `runtimeBundle`, `editorArtExport` and `publishGame` all go through, and the exact counterpart of `loadFlipbookDoc` — now repairs `betModePresentation.*.cardParams` refs through the shared `createAtlasRefResolver`, so the prefix resolves to the real manifest key and the export ships the sheet under the same key the runtime looks up. Gated on a repairable ref actually being present, so a correctly-authored config costs no R2 calls. The editor's own read path (`loadGameConfigDocWithEtag`) is deliberately NOT repaired — it backs the conditional-write contract, and a save must round-trip what was loaded. Behind that, `parseScopedFrameRef` now degrades an un-scopeable prefix to the BARE frame name (which the `sprites` loader registers alongside every scoped frame) instead of a guaranteed miss, so an unrepaired ref from anywhere still renders. That loses the atlas pin, so it is a safety net, not the fix.

  **The root cause is still open and is NOT config-specific:** `RegionPicker`'s `sheets[].key` comes from `listSheets`, which reports the R2 prefix, so every consumer — `/config` card params, the Scene Editor's image params, `/components`, `/symbols` — can still store an un-scopeable ref today. Only the config's is repaired on ship; the editor doc's is not. The clean fix is for the picker's sheet entries to carry the RESOLVED manifest key (`resolveManifestKey`), which would make every new pick canonical. Filed under Open items.

  Verified: new `node packages/engine-layout/scopedFrameRef.fixture.ts` (19 assertions) pins all three prefix shapes — full manifest key keeps the atlas pin, an un-scopeable prefix degrades to the bare region, and a region name that merely CONTAINS `::` survives whole (the parity case a naive split would break). Also fixed a pre-existing type error it exposed: `needsAtlasRefRepair` called `.includes` on a value TS had narrowed to `never` (its `ref is string` guards narrow an already-string argument away in their negative branches) — it shipped only because nothing type-checks `packages/`. `apps/lines` + `launcher-api` build clean; eslint clean.

- 2026-08-20 — **The lines template advertised a payout no player could win.** Owner's `/config` on `test4` showed `symbols.W.paytable — W pays in the paytable but appears on no reel strip`. It is not a `test4` problem: the committed **`lines.json` template** carried it (`W` = `{3:5, 4:10, 5:20}`, on no strip), so EVERY project seeded from lines inherited an unwinnable advertised payout — `ways` and `scatter` were already clean. `validateGameConfigDoc` has flagged exactly this for a while ("the `W` bug, generalized"), so the warning was correct and simply unactioned. **Behaviour-neutral to remove:** `projectWild` (publishGame) gates the mock's wild on the SAME `symbolsInPlay` set — "a wild that merely sits in the dictionary with a paytable but is never dealt stays wild-less" — so nothing read the row except the INFO PAGE, which showed three payouts a player cannot collect. Fixed at source (`apps/lines/src/game/config.ts` → `paytable: null`) and regenerated. **The alternative fix was deliberately NOT taken:** putting `W` on the strips would make the wild actually deal, which changes hit frequencies and starts feeding the mock a wild — that is game MATH and belongs with a math export, not a lint fix. The residual warning is now the milder branch of the same rule (`W is in the dictionary but appears on no reel strip`), which is the honest state: the sample declares a wild it does not deal. **Existing projects keep the old row** — their authored config lives in R2, so `test4` needs "Reset to template default" or W's paytable cleared by hand to clear the warning there. Also: the bet-mode **RTP** input gained the `min`/`max` bounds the identity RTP already had (both were already `type="number"` — an earlier claim that RTP was free text was wrong). Both apps build; eslint clean.

- 2026-08-20 — **A ways math VERIFIER — so an arriving math export can be checked instead of trusted.** `apps/ways` ships cosmetic padding reels and says so in `config.ts` ("inventing those here would be fabricating game math"); `apps/lines` ships real 217-cell strips that came from the math SDK export. The export itself has to come from a math engine, so the gap that COULD be closed here is the check that receives one. `pnpm --filter game-config-spike run waysmath` reads any Game Config doc, deals boards off its strips (independent uniform stop per reel, `numRows` consecutive cells with wraparound — the property a uniform strip set does not have), scores them with the ways rule priced per WAY (`totalBet / waysCount`, #357), and reports RTP, hit rate, best spin, scatter-trigger rate and per-symbol contribution. Everything is read from the doc — paying symbols, wilds, scatters, board shape — so it verifies any project, not just `apps/ways`. **What it says about the current placeholder:** 0.13% RTP against a declared `rtp: 0.97`, a 3+ scatter board **1 spin in 6** (lines, for contrast: 1 in 1,190), and a declared wild `W` that appears on no strip and therefore can never land. **Two guards against the tool itself lying.** `waysCrosscheck` holds the doc-scorer against `mock-rgs-server`'s `evaluateWays` over 40,000 random boards — symbol, run length, ways count AND pay amount, with and without wild substitution — because a second implementation of one rule is how a measurement quietly stops describing the game; the mock evaluator can't just be imported, being bound to its own PIC/SCAT vocabulary and hardcoded paytable. And the tool REFUSES to print an RTP for a non-`ways` doc (it would understate the return by the ratio of the two divisors and still read like a measurement) — it prints the strip diagnostic and stops. It also prints its own scope every run: base-game symbol pays only, no free-spin feature (the award structure isn't declared in the config, so no total RTP is computable), and the reminder that the client never computes wins — the RGS does, and in production it is external. Lives in `tools/game-config-spike` rather than a new workspace package, deliberately: adding one churned `pnpm-lock.yaml` with unrelated lingui peer re-resolution, which CI's `--frozen-lockfile` would have had to swallow. Verification tooling only — no engine or runtime change.
- 2026-08-19 — **`/config` can author the win model** — new "How wins are decided" panel above Paylines, picking lines / ways / cluster / scatter. **The picker DELETES `winModel` when Lines is chosen** rather than writing `{type:'lines'}`: the server normalizes that away on save, so writing it would leave the page permanently "Unsaved" (reloaded doc ≠ in-memory doc). Switching to another arm seeds exactly the defaults `normalizeWinModel` would fill, so the tool shows what would actually be stored. Paylines gain a banner when the model isn't lines — they stay saved (switching back restores them) but don't affect play, mirroring the validator, which already skips payline checks there. A blunt note warns that a non-lines model only changes what the config **declares** — the engine has no runtime for those types yet, so the game still plays as lines. ⏳ **NOT live-verified:** `/config` is auth-gated (correctly 303s to `/login`), so the panel needs an owner click-through — specifically that arms switch cleanly and a Lines project doesn't read dirty after saving.

- 2026-08-19 — **Per-type committed defaults: `scatter` ships its own, and a silently-dropped tier set was repaired.** `gameConfigDefaults` had exactly one template (`lines`) and fell back to it for every other type, so a project marked anything else inherited the lines dictionary and its 20 paylines. `scatter.json` now ships with `winModel: {type:'scatter', minCount:8}`, the minimum **derived from the game's own paytable** rather than written down (a game whose smallest paying row is 8 has `minCount: 8` by definition; hard-coding it would let the model drift from the payouts). Measured: ways 3, cluster 5, scatter 8. **⚠️ Regression found + fixed here:** the generator reads `winLevelMap.ts` as a sibling of the config, and Phase A moved `apps/lines`' copy into `engine-game` — the surrounding `try/catch` cannot tell "this game has no tiers" from "the file moved", so regenerating silently dropped **all 10 win tiers** (112 lines) from the lines default while still validating clean. Now tries sibling → `engine-game`, and **warns loudly** when neither is found. **`ways`/`cluster` are deliberately unregistered:** their upstream sample configs ship `paddingReels: { basegame: '', … }` — empty-string placeholders, and the strips are the in-play gate, so such a default would seed a blank board. Closing it needs real strips authored in those configs; synthesizing them is game math, not packaging. `--check` stays green and usable as a CI gate.

- 2026-08-19 — **`winModel` added to `GameConfigDoc` — a project can now state HOW it pays** (Phase C of [game-type-templates](../design/game-type-templates.md)). A discriminated union: `lines` | `ways` (direction, minKind) | `cluster` (minCluster, adjacency) | `scatter` (minCount). **The `lines` arm deliberately carries NO payline data** — `paylines`/`paylineColors` stay where they already live. Because `lines` is the default, `normalizeWinModel` **drops** it rather than storing it, so every config authored before this field normalizes byte-identically and **not one stored doc is rewritten**. The design doc's first sketch had the `lines` arm own `paylines`; that would have meant migrating every authored doc in R2 for no functional gain. Read it via **`resolveWinModel()`** — never `doc.winModel` directly — so "absent means lines" lives in exactly one place. Validation now follows the model: a non-lines doc **skips the payline checks** (that table is inert, not wrong, for a game that never reads it) and gets its own bounds check instead (more adjacent reels than the grid is wide; a cluster bigger than the board); the generic symbol checks still run for every model. 13 checks in `pnpm --filter game-config-spike run doc`, the load-bearing two being byte-identical round-trip and `lines`-explicit ≡ omitted. **Still lines-shaped and awaiting the next slice:** `getPaylines`/`getNumLines`/`paylineColor` in `engine-game`, and the `/config` UI (no per-arm editor yet — a `ways` model can be stored but not yet authored in the tool).

- 2026-08-18 — **Bet-mode card follow-up: fields overflowed their columns and the pickers sat on
  three different baselines.** The page had no `box-sizing` reset, so every `width: 100%` field was
  its track _plus_ 20px of padding+border — the Description/Dialog textareas visibly spilled past
  their column edge, and the same held for the paytable-grid inputs. Border-box now applies to
  `.fld` controls, `.grid td input` and `.body`. The Card-graphics cluster was the other half: its
  `repeat(auto-fill, minmax(100px, 1fr))` tracks fitted 1–3 fields per group depending on how wide
  that group's column happened to land, so a colour swatch could sit beside an unrelated text field
  and no two groups shared a row — and the three control types size themselves independently (a
  22px `ColorField` swatch, a 28px `RegionPicker` bar, a 34px `<select>`). Each group is now a
  one-field-per-row stack inside its own panel, and every control is pinned to one `--fld-h: 34px`
  (the two child components via `:global` + border-box, or the pinned height would have grown them
  by their own padding). Measured in a harness built from the page's real CSS: all groups top-align,
  row 1 at one Y and row 2 at another across all five, zero overflow past any field or the card.
- 2026-08-18 — **The bet-mode card was rebuilt: it was hard to read, and one line of CSS was why.**
  `label input { width: 180px }` applied to CHECKBOXES too, so **Feature** / **Buy bonus** were
  stretched 180px wide and their words sat a label-width from the box they belonged to, floating in
  the dead space between Max win and Kind — the single thing that made the row look broken. Fixed
  page-wide (`input[type='checkbox']` keeps its intrinsic width), which also tidies the Big-win
  tiers' escalation toggle. On top of that the card is now four labelled blocks — **Math · Menu ·
  Copy · Card graphics** — on fixed grid tracks so fields line up down the page instead of a
  wrapping flex that re-flowed per mode; **colour-coded by kind** (blue `base` / gold `buy` / teal
  `ante`) on the rail, key and header tags, reusing the menu-preview chip palette so a card and its
  chip match (and `mp-base`, which had no colour at all, got one); card-graphics params **bucketed
  by their declared `group`** and laid out in columns, so Panel/Icon/Spine/Button read as clusters
  and the group is named once instead of suffixing every field. Also: a win tier's **Name** was on
  the 52px numeric `label.mini` width and truncated every one of them ("SUPER W"). Dead CSS from the
  old layout removed — the page now builds with **zero** unused-selector warnings. Verified live
  against `bookofborutremake` (4 modes, picked card art) and `test2`.
- 2026-08-18 — **Per-mode Button copy set on Book of Borut Remake.** All three buy modes had no
  `text.button`, so the card fell back to the derived `BUY`; each now carries `BUY FEATURE`, which
  also makes it a translatable row (the wording is additionally baked into the `T_UI_BuyBack*`
  ribbon art, which no config field or translation can reach — see the tool guide's note).
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
- 2026-08-05 — **Phase 8: Paylines panel auto-loads the live server set; Reel-strips panel removed.**
  New `apps/launcher-api/src/lib/server/rgsConfig.ts` (`fetchServerPaylines`, best-effort, returns
  `null` on any failure) + `ENV.TEST_SERVER_URL`; `+page.server.ts` probes only when the project has a
  mock (test-server manifest) and passes `serverPaylines`; the Paylines panel previews the RGS's real
  lines (colour editor keyed to match the runtime `paylineColor` mapping) or falls back to the saved doc.
  Reel-strips section + dead `stripText`/`frequencies` helpers + strip CSS deleted. Build + node-harness
  verified (book=10, lines=5, unreachable=null). See the Phase 8 section above.

- 2026-08-05 — **Phase 7: server-authoritative paylines & reel strips (colour-only in the tool).**
  The facade publishes the RGS's declared boot config to `globalThis.__IE_SERVER_CONFIG__`
  (`captureConfig`, the `__IE_WIN_LEVELS__` bridge in reverse); `game/gameConfig.ts` reads it live
  (`serverConfig()`, not memoised) so `getPaylines`/`getNumLines`/`getSymbolsInPlay` follow the server
  and `paddingReels` auto-generates cosmetic strips from the in-play set. `/config` paylines + strips
  panels locked read-only (paylines keep the colour swatch). Absent server config ⇒ byte-identical.
  Engine/facade build + typecheck; 18-check node harness against the book mock (all pass). Needs a
  Runtime release + republish to reach online games. See the Phase 7 section above.

- 2026-08-04 — **Live-verified + closed (owner-confirmed).** The owner clicked through `/config` +
  `/editor` in the deployed launcher and ran an end-to-end (incl. non-5×3) spin. The one remaining
  open item — the launcher-only live-verify — is done; the tool is shipped and verified.

- 2026-08-03 — **Config-authored win tiers (big-win levels) + sequential escalation.** New OPTIONAL
  `winLevels?` tier list + `escalateTiers?`/`escalateFrom?` on `GameConfigDoc`, resolver in
  `winLevels.ts`, validators, ~30 spike checks (all pass; the CRLF `lines.json` drift is the lone
  pre-existing failure). Runtime routes `engineFacade.ts` `computeWinLevel`/big-win gate (via the
  `globalThis.__IE_WIN_LEVELS__` bridge) and the engine's win-level lookup (`activeWinLevelData` in
  `gameConfig.ts`, consumed by `bookEventHandlerMap`/`flowEffects`/`unskippablePresentation`) through
  the authored tiers. Escalation in `WinAnimation`/`WinVisual` (per-tier intro+idle chain, final-tier
  outro on count-up, one continuous count). `/config` "Win tiers" panel + guide. Un-authored ⇒
  byte-identical (coded `winLevelMap` + coded ladder, both untouched). Needs a Runtime release +
  republish to reach online games. See the "Config-authored win tiers" section above.

- 2026-07-28 — **Phase 6 (all four sub-phases): bet modes authorable + localizable.** Engine +
  schema build + typecheck + spike verified; 6a/6b verified live in the running game; 6c/6d
  build-verified (launcher render owner-verify-owed).

  - **6a** `betModePresentation` schema + `resolveBetModes` + validator warnings
    in `packages/game-config` (14 new spike checks).
  - **6b** `apps/lines/src/game/betModeMeta.ts` builds `stateMeta.betModeMeta` from the active config
    (uppercased keys preserve the RGS wire contract; source strings translated at render); `Game.svelte`
    seeds it at boot; render-time `translate()` in `BonusCards`/`ModalBuyBonusConfirm`/HUD
    `betAmountLabel`. Live buy menu shows the config's BONUS·$100·BUY card, not the placeholder.
    `DEFAULT_BET_MODE_META` kept for the un-wired dev apps.
  - **6c** the `/config` Bet modes panel becomes per-mode cards with kind/order/copy + a resolved-menu
    preview; presentation written sparsely.
  - **6d** `/localization` auto-collects the bet-mode copy into a "Bet modes" section (`harvestBetModes`,
    new `gameConfig` origin), read-only source, same pattern as its Win Text section.
  - See Phase 6 above. Remaining Phase-6 follow-up: bet-mode ASSETS (icon/dialog art) via the
    live-asset pipeline, and retiring `DEFAULT_BET_MODE_META` once every dev app seeds from config.

- 2026-07-27 — **Grid-resize repair UX + per-payline colours** (this change; launcher surface
  owner-verify-owed, engine + schema build + typecheck-verified):

  - **`/config` Grid** — a `Match grid` button appears whenever a strip set or payline no longer
    matches `numReels` (the state a reel-count change leaves), padding/truncating every strip and
    payline to the grid in one click (new reels clone the last reel; new payline cells start on row
    0). The Reel-strips editor now renders a column PER `numReels`, not per existing strip entry, so
    the reels a widen added are authorable instead of a dead-end error. Fixes the "changed board
    size → error with no way to add strips" report.
  - **Per-payline colour** — new OPTIONAL `paylineColors: Record<lineId, '#rrggbb'>` on
    `GameConfigDoc` (an Invisible-Engine extension, NOT part of the math export; a paste-in config
    omits it). `normalizePaylineColors` keeps only colours for a line that exists and is a valid hex
    (`#rgb`/`#rrggbb`, expanded), so it's idempotent and an un-coloured config is byte-identical to
    before. Rides the existing config bake→pull chain — no new asset class. `/config` Paylines panel
    gets a colour swatch per line (tints the line id + active cells; ⌫ clears).
  - **Runtime** — `paylineColor(lineIndex)` in `game/gameConfig.ts` maps a win's `meta.lineIndex` →
    payline id → colour. `winLineColorFor()` in `flowEffects.ts` feeds it to all three `winLineShow`
    dispatch sites (coded `winInfo` handler, `showWinLine` flow effect, resting win cycle) as a new
    `winLineShow.color`. `WinLine.svelte` draws the core line + glow in that colour when set (else
    the single Symbols-tool default → parity), and publishes it as `stateGame.winLineColor` (cleared
    on hide) — the REUSABLE win-colour hook any asset component can read to tint itself to the
    winning line. `apps/lines` build passes; `game-config` typecheck + spike pass (the pre-existing
    CRLF `lines.json` byte-identical drift check is unrelated).

- 2026-07-27 — **Fix: online reel stopped rolling.** The grid-dimensions `rebuildBoard()` reassigned
  `stateGame.board = buildBoard()`, orphaning the `enhancedBoard` (createEnhanceBoard) that closes
  over the board array at module init and drives every preSpin/spin/settle — so online (the only path
  that calls `rebuildBoard`, after the live bundle lands) the rendered reels were static while spin
  animated the old detached reels. Fixed by rebuilding IN PLACE (`stateGame.board.splice(0, len,
...buildBoard())`) so render + enhancedBoard stay on the same reels. Also repointed the dangling
  `boardRaw()` `board` reference (left undeclared when #97 removed `const board`) to `stateGame.board`.
  Ships to online games via a Runtime release.
- 2026-07-27 — Grid-dimensions enhancement (branch `game-config-grid`): the authored numReels/numRows
  resize the board in the game (`boardDimensions()` + `rebuildBoard()`), the mock RGS (parameterized
  `createMockRgs`), and the Scene Editor preview (`drawReelGrid` from config, `reelGridWarnings` vs
  config). Fixed a latent CRLF drift-gate bug (`.gitattributes` `eol=lf` for the generated config
  JSON). Game + mock verified locally; launcher surfaces owner-verify-owed.
- 2026-07-24 — Phase 5: `publish-symbol-defaults.mjs` now gates its symbol set on the AUTHORED game
  config (fetched from `GET /api/game-config/doc`) when a project has one, falling back to the
  compiled module — so the Symbols grid mirrors what actually ships. Fixed a self-inflicted
  regression: `constants.ts` (imported standalone by that script) must not pull in
  `gameConfig`→`editor-scenes`, so the `paddingReels()` accessor moved to `gameConfig.ts` and its
  consumers import it there.

- 2026-07-24 — Phase 4: the `/config` tool — `roles.ts` registration (icon, TOOLS, ROLE_TOOLS,
  TOOL_BAR_ORDER, TOOL_DOC_SLUG), the page (Identity/Grid/Bet modes/Symbols/Paylines/Reel
  strips/raw-JSON panels, in-play badges + strip frequencies from the gate, inline validation), the
  session-gated `PUT/GET /api/game-config`, and the `docs/tools/game-config.md` guide. Page render +
  save round-trip are live-verify owed (needs the launcher); build + parsers fixture-verified.

- 2026-07-24 — Phase 3: `config` in both bundle paths + `GET /api/game-config/doc`,
  `bakedGameConfig()`, `game/gameConfig.ts` (memoised resolution + boot validation), `SymbolName`
  widened to `string`, and the paytable/strips/info-manifest consumers moved off the compiled
  module. Verified live in the running game.

- 2026-07-24 — Phase 2: `generate-game-config-defaults.ts` + the committed
  `$lib/data/gameConfig/lines.json`, `gameConfigDefaults.ts` (`resolveGameConfig` owns the
  precedence + provenance), drift gate in both the script and the fixture.
- 2026-07-24 — Phase 1: `packages/game-config` (schema + in-play gate + validator),
  `gameConfigStorage.ts` with ETag CAS, `game-config-spike` fixture, `invisible-game-config` agent.
