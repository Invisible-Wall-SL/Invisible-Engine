# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** All five build-plan phases landed AND the grid-dimensions enhancement — an
authored config now drives the symbols/paytable/paylines/bet-modes AND resizes the board in the
game, the mock RGS and the Scene Editor preview. **Live-verify owed:** the `/config` + `/editor`
pages render only inside the launcher (Postgres + R2 + session), and a non-5×3 end-to-end spin needs
the test-server; the game-board resize and the mock are verified locally, the launcher surfaces are
the owner's click-through.

## Current state

**Phase 1 — schema + storage (done).**
- `packages/game-config` — dependency-free, Node-resolvable (mirrors `engine-flipbook`):
  - `types.ts` — `GameConfigDoc`, byte-compatible with the Stake export (`special_properties`,
    `max_win`, single-entry paytable rows kept verbatim so paste-in works).
  - `normalize.ts` — `normalizeGameConfigDoc`, idempotent. Returns **`undefined`**, never an empty
    config, when the input can't describe a game: "no doc" must mean *fall through to the template*,
    not *blank board*. Accepts the friendly shorthands (`numRows: 3`, bare-string strip cells,
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
  described the *sample* game, so it would have rejected a correct symbol id from an authored
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

## Open items / next

1. **Live-verify the launcher surfaces** (owner click-through) — render `/config` (load a config,
   edit panels, off-grid payline blocks save, raw-JSON paste validates, save round-trips) AND
   `/editor` (the reelGrid preview draws the authored grid; a mismatched node warns). Plus a non-5×3
   end-to-end spin via the test-server + a dev game. The only things offline verification couldn't
   reach. **New this pass:** change the reel count → `Match grid` clears the errors and the new
   reels get strip boxes; colour a payline → its win line (and glow) draws in that colour in-game and
   `stateGame.winLineColor` carries it for the round.
2. **Validate against the RGS** (design doc open decision 3) — compare the config's symbol set to
   the first `reveal` and warn on a mismatch. `warnOnGameConfigIssues()` is the natural home; it
   would have caught the wild on the first spin.

**Not a gap:** `packages/game-spec`'s generator emits const-based `paytable.ts`/`infoManifest.ts`,
but it is a standalone CLI that `new-game.mjs` does NOT call — the scaffold copies `src/` from an
existing game (now `apps/lines`, with the accessor-based files), so a new game inherits the authored
-config wiring automatically. Left as-is on purpose.

## Blocked (owner / external)

- **Live-verify** waits on a launcher deploy + a click-through — the `/config` page can't render
  locally (Postgres + R2 + session). Not blocking the merge; it's a post-deploy check.

## Recent changes

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
