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
  - `types.ts` — `GameConfigDoc`, byte-compatible with the Stake export (`special_properties`,
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
no home in the Stake config shape; only the scatter's SYMBOL is read from the config now.

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
text? }>` on `GameConfigDoc` — an Invisible-Engine extension a Stake paste-in omits, mirroring
  `paylineColors` (kept OFF `betModes` so those entries round-trip a math export byte-for-byte).
  `kind` = `base | ante | buy`; `text` = title/description/button/dialog/betAmountLabel SOURCE strings.
- `normalizeBetModePresentation` — sparse, drops an entry for a mode not in `betModes` (like a colour
  for a deleted line); the whole map omitted when un-authored ⇒ byte-identical to a Stake export.
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
threshold ladder (`stakeFacade.ts` `computeWinLevel`) are now OPTIONALLY replaced by a config-authored
tier list. All four phases landed; engine + schema build + typecheck + spike verified. Launcher
`/config` panel render is owner-verify-owed (launcher-only), as with the rest of the tool.

**Schema (`packages/game-config`).** New OPTIONAL `winLevels?: WinLevelTier[]` on `GameConfigDoc` (an
ordered tier list — `alias`/`name`/`threshold` (win-as-bet-multiplier)/`type` (`small|medium|big`) +
optional `animation{intro,idle,outro}`/`spineKey`/`sound{sfx,bgm}`/`durationMs`) plus top-level
`escalateTiers?`/`escalateFrom?`. An Invisible-Engine extension a Stake paste-in omits, mirroring
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
`globalThis.__IE_WIN_LEVELS__`; `stakeFacade.ts` reads it in `computeWinLevel` (authored ladder, else
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

- **Facade → engine bridge.** `stakeFacade.ts` `captureConfig` publishes the server's boot config
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

## Open items / next

0. **Make `RegionPicker` store a SCOPEABLE atlas key** (root cause of the 2026-08-20 missing-card-art
   bug below). Its `sheets[].key` comes from `listSheets`, which reports the R2 output PREFIX
   (`…/sheets/S_Gem/`), so a frame picked from a Sheet-Maker sheet is stored as
   `…/sheets/S_Gem/::frame` — a namespace the editor-art export never registers. `/config` card
   params are now repaired on the ship path, but the Scene Editor's image params, `/components` and
   `/symbols` are NOT. Fix at the source: resolve each sheet entry to its manifest key
   (`resolveManifestKey`) where `pickSheets` is derived, so every new pick is canonical. Changing
   `SheetAsset.key` itself is the tempting one-liner and is WRONG — that field is an R2 prefix for
   the FTP browser and the sheet tool.

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

- 2026-08-20 — **A buy-feature card's button art was simply absent in-game — the region picker stores an atlas ref the runtime cannot scope by.** Owner's console on the live Borut remake: `Sprite: key "invisible_wall/bookofborutremake/sheets/S_Game_UI2/::T_UI_BuyBack_glow.png" is not found in the loadedAssets`. The frame exists and the sheet ships; the KEY is unresolvable. An `image`-kind card param stores `<atlas>::<frame>`, and `RegionPicker` builds the atlas half from its `sheets[].key` — which for a Sheet-Maker sheet is the R2 OUTPUT PREFIX (`…/sheets/S_Game_UI2/`), not the `<path>/<name>.json` manifest key. The editor-art export registers a sheet's frames under its MANIFEST key, so the ref named a namespace that is never registered.

  **Two failures, not one.** `parseScopedFrameRef` demands a full manifest key, and on anything else returned the WHOLE value as a bare region name — so the sprite looked up a key no sheet can ever carry (nothing draws), and `editorArtExport`'s `addImageRef`, which shares that helper, filed the same string as a dangling region (it is the sole entry in the project's `editorArt.missing`). Both readers were consistently wrong in the same way, which is why nothing flagged it.

  **Fixed on the ship path, with a degradation behind it.** `loadGameConfigDoc` — the loader `runtimeBundle`, `editorArtExport` and `publishGame` all go through, and the exact counterpart of `loadFlipbookDoc` — now repairs `betModePresentation.*.cardParams` refs through the shared `createAtlasRefResolver`, so the prefix resolves to the real manifest key and the export ships the sheet under the same key the runtime looks up. Gated on a repairable ref actually being present, so a correctly-authored config costs no R2 calls. The editor's own read path (`loadGameConfigDocWithEtag`) is deliberately NOT repaired — it backs the conditional-write contract, and a save must round-trip what was loaded. Behind that, `parseScopedFrameRef` now degrades an un-scopeable prefix to the BARE frame name (which the `sprites` loader registers alongside every scoped frame) instead of a guaranteed miss, so an unrepaired ref from anywhere still renders. That loses the atlas pin, so it is a safety net, not the fix.

  **The root cause is still open and is NOT config-specific:** `RegionPicker`'s `sheets[].key` comes from `listSheets`, which reports the R2 prefix, so every consumer — `/config` card params, the Scene Editor's image params, `/components`, `/symbols` — can still store an un-scopeable ref today. Only the config's is repaired on ship; the editor doc's is not. The clean fix is for the picker's sheet entries to carry the RESOLVED manifest key (`resolveManifestKey`), which would make every new pick canonical. Filed under Open items.

  Verified: new `node packages/engine-layout/scopedFrameRef.fixture.ts` (19 assertions) pins all three prefix shapes — full manifest key keeps the atlas pin, an un-scopeable prefix degrades to the bare region, and a region name that merely CONTAINS `::` survives whole (the parity case a naive split would break). Also fixed a pre-existing type error it exposed: `needsAtlasRefRepair` called `.includes` on a value TS had narrowed to `never` (its `ref is string` guards narrow an already-string argument away in their negative branches) — it shipped only because nothing type-checks `packages/`. `apps/lines` + `launcher-api` build clean; eslint clean.

- 2026-08-20 — **The lines template advertised a payout no player could win.** Owner's `/config` on `test4` showed `symbols.W.paytable — W pays in the paytable but appears on no reel strip`. It is not a `test4` problem: the committed **`lines.json` template** carried it (`W` = `{3:5, 4:10, 5:20}`, on no strip), so EVERY project seeded from lines inherited an unwinnable advertised payout — `ways` and `scatter` were already clean. `validateGameConfigDoc` has flagged exactly this for a while ("the `W` bug, generalized"), so the warning was correct and simply unactioned. **Behaviour-neutral to remove:** `projectWild` (publishGame) gates the mock's wild on the SAME `symbolsInPlay` set — "a wild that merely sits in the dictionary with a paytable but is never dealt stays wild-less" — so nothing read the row except the INFO PAGE, which showed three payouts a player cannot collect. Fixed at source (`apps/lines/src/game/config.ts` → `paytable: null`) and regenerated. **The alternative fix was deliberately NOT taken:** putting `W` on the strips would make the wild actually deal, which changes hit frequencies and starts feeding the mock a wild — that is game MATH and belongs with a math export, not a lint fix. The residual warning is now the milder branch of the same rule (`W is in the dictionary but appears on no reel strip`), which is the honest state: the sample declares a wild it does not deal. **Existing projects keep the old row** — their authored config lives in R2, so `test4` needs "Reset to template default" or W's paytable cleared by hand to clear the warning there. Also: the bet-mode **RTP** input gained the `min`/`max` bounds the identity RTP already had (both were already `type="number"` — an earlier claim that RTP was free text was wrong). Both apps build; eslint clean.

- 2026-08-20 — **A ways math VERIFIER — so an arriving math export can be checked instead of trusted.** `apps/ways` ships cosmetic padding reels and says so in `config.ts` ("inventing those here would be fabricating game math"); `apps/lines` ships real 217-cell strips that came from Stake's math export. The export itself has to come from a math engine, so the gap that COULD be closed here is the check that receives one. `pnpm --filter game-config-spike run waysmath` reads any Game Config doc, deals boards off its strips (independent uniform stop per reel, `numRows` consecutive cells with wraparound — the property a uniform strip set does not have), scores them with the ways rule priced per WAY (`totalBet / waysCount`, #357), and reports RTP, hit rate, best spin, scatter-trigger rate and per-symbol contribution. Everything is read from the doc — paying symbols, wilds, scatters, board shape — so it verifies any project, not just `apps/ways`. **What it says about the current placeholder:** 0.13% RTP against a declared `rtp: 0.97`, a 3+ scatter board **1 spin in 6** (lines, for contrast: 1 in 1,190), and a declared wild `W` that appears on no strip and therefore can never land. **Two guards against the tool itself lying.** `waysCrosscheck` holds the doc-scorer against `mock-rgs-server`'s `evaluateWays` over 40,000 random boards — symbol, run length, ways count AND pay amount, with and without wild substitution — because a second implementation of one rule is how a measurement quietly stops describing the game; the mock evaluator can't just be imported, being bound to its own PIC/SCAT vocabulary and hardcoded paytable. And the tool REFUSES to print an RTP for a non-`ways` doc (it would understate the return by the ratio of the two divisors and still read like a measurement) — it prints the strip diagnostic and stops. It also prints its own scope every run: base-game symbol pays only, no free-spin feature (the award structure isn't declared in the config, so no total RTP is computable), and the reminder that the client never computes wins — the RGS does, and in production it is external. Lives in `tools/game-config-spike` rather than a new workspace package, deliberately: adding one churned `pnpm-lock.yaml` with unrelated lingui peer re-resolution, which CI's `--frozen-lockfile` would have had to swallow. Verification tooling only — no engine or runtime change.
- 2026-08-19 — **`/config` can author the win model** — new "How wins are decided" panel above Paylines, picking lines / ways / cluster / scatter. **The picker DELETES `winModel` when Lines is chosen** rather than writing `{type:'lines'}`: the server normalizes that away on save, so writing it would leave the page permanently "Unsaved" (reloaded doc ≠ in-memory doc). Switching to another arm seeds exactly the defaults `normalizeWinModel` would fill, so the tool shows what would actually be stored. Paylines gain a banner when the model isn't lines — they stay saved (switching back restores them) but don't affect play, mirroring the validator, which already skips payline checks there. A blunt note warns that a non-lines model only changes what the config **declares** — the engine has no runtime for those types yet, so the game still plays as lines. ⏳ **NOT live-verified:** `/config` is auth-gated (correctly 303s to `/login`), so the panel needs an owner click-through — specifically that arms switch cleanly and a Lines project doesn't read dirty after saving.

- 2026-08-19 — **Per-type committed defaults: `scatter` ships its own, and a silently-dropped tier set was repaired.** `gameConfigDefaults` had exactly one template (`lines`) and fell back to it for every other type, so a project marked anything else inherited the lines dictionary and its 20 paylines. `scatter.json` now ships with `winModel: {type:'scatter', minCount:8}`, the minimum **derived from the game's own paytable** rather than written down (a game whose smallest paying row is 8 has `minCount: 8` by definition; hard-coding it would let the model drift from the payouts). Measured: ways 3, cluster 5, scatter 8. **⚠️ Regression found + fixed here:** the generator reads `winLevelMap.ts` as a sibling of the config, and Phase A moved `apps/lines`' copy into `engine-game` — the surrounding `try/catch` cannot tell "this game has no tiers" from "the file moved", so regenerating silently dropped **all 10 win tiers** (112 lines) from the lines default while still validating clean. Now tries sibling → `engine-game`, and **warns loudly** when neither is found. **`ways`/`cluster` are deliberately unregistered:** their upstream sample configs ship `paddingReels: { basegame: '', … }` — empty-string placeholders, and the strips are the in-play gate, so such a default would seed a blank board. Closing it needs real strips authored in those configs; synthesizing them is game math, not packaging. `--check` stays green and usable as a CI gate.

- 2026-08-19 — **`winModel` added to `GameConfigDoc` — a project can now state HOW it pays** (Phase C of [game-type-templates](../design/game-type-templates.md)). A discriminated union: `lines` | `ways` (direction, minKind) | `cluster` (minCluster, adjacency) | `scatter` (minCount). **The `lines` arm deliberately carries NO payline data** — `paylines`/`paylineColors` stay where they already live. Because `lines` is the default, `normalizeWinModel` **drops** it rather than storing it, so every config authored before this field normalizes byte-identically and **not one stored doc is rewritten**. The design doc's first sketch had the `lines` arm own `paylines`; that would have meant migrating every authored doc in R2 for no functional gain. Read it via **`resolveWinModel()`** — never `doc.winModel` directly — so "absent means lines" lives in exactly one place. Validation now follows the model: a non-lines doc **skips the payline checks** (that table is inert, not wrong, for a game that never reads it) and gets its own bounds check instead (more adjacent reels than the grid is wide; a cluster bigger than the board); the generic symbol checks still run for every model. 13 checks in `pnpm --filter game-config-spike run doc`, the load-bearing two being byte-identical round-trip and `lines`-explicit ≡ omitted. **Still lines-shaped and awaiting the next slice:** `getPaylines`/`getNumLines`/`paylineColor` in `engine-game`, and the `/config` UI (no per-arm editor yet — a `ways` model can be stored but not yet authored in the tool).

- 2026-08-18 — **Bet-mode card follow-up: fields overflowed their columns and the pickers sat on
  three different baselines.** The page had no `box-sizing` reset, so every `width: 100%` field was
  its track *plus* 20px of padding+border — the Description/Dialog textareas visibly spilled past
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
  pre-existing failure). Runtime routes `stakeFacade.ts` `computeWinLevel`/big-win gate (via the
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
    `GameConfigDoc` (an Invisible-Engine extension, NOT part of the Stake export; a paste-in config
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
