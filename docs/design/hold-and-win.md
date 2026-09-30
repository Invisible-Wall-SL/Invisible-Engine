# Hold and Win — a new game kind, end to end

> Status: living state in **[docs/status/hold-and-win.md](../status/hold-and-win.md)** — that file
> is also the **hub** other sessions report into. This file is the plan, not the progress.
> Related: [game-type-templates.md](game-type-templates.md) (a kind is data + a mechanic),
> [invisible-game-config.md](invisible-game-config.md), [invisible-flow-v2.md](invisible-flow-v2.md),
> [invisible-symbols-state-machine.md](invisible-symbols-state-machine.md),
> [invisible-win-text.md](invisible-win-text.md), [live-assets.md](live-assets.md),
> [play4fun-protocol](../reference/play4fun-protocol.md).

## Why this exists

We need to author and ship **Hold and Win** games (Hold & Spin / Cash Collect / Lightning-Link
lineage) through the same pipeline as our lines, Book-of and ways games. Every tool has to know
the kind: a Scene Editor template, a Flow vocabulary with its signals and receivers, a Symbols
State Machine that shows the coin options and hides the options this kind does not use, and the same
for Game Config and Win Text. None of that exists today, and the RGS contract for it is not settled.

## 1. The mechanic — what we must model

### 1.1 Core loop (every Hold and Win game)

1. **Base game = a normal lines game.** Low/high line symbols and a WILD (no scatter, no free spins
   in either reference game).
2. **Coin symbols** (called BONUS in 3 Oaks games) land during the base game. Each carries a
   **value**: either cash (a multiple of the total bet, e.g. 1/2/3/5/7/10/15×) or a **jackpot
   label** (MINI / MINOR / MAJOR / GRAND). A coin pays nothing on a line.
3. **Trigger** — enough coins (classic: **6+** on 5×3), or a positional pattern (see Hotfire), or a
   bought feature, or a random "metre" trigger.
4. **Respin feature** — the board switches to the respin board:
   - the coins that triggered **stick**;
   - every non-coin cell spins **on its own**, and only coins/blanks can land;
   - a counter starts at **3**; any respin that lands a new coin **resets it to 3**; a respin with
     nothing new decrements it;
   - the feature ends when the counter hits 0 or the board is full.
5. **Payout** — every coin's value is collected (a per-coin count-up into a Total Win bar), the
   jackpot labels pay their fixed prize, and the sum is paid as one win (then a big-win tier if it
   reaches one).
6. **Full board** classically awards the **GRAND** jackpot.

### 1.2 The two reference games (researched 2026-09-30 from 3 Oaks' own server config and rules)

| | **Grand** (3 Oaks) | **Super Hotfire Diamonds: Hold and Win** (3 Oaks) |
|---|---|---|
| Grid / lines | 5×3, 5 fixed lines | **3×3**, 5 fixed lines (3 rows + 2 diagonals) |
| Coin (BONUS) values | 1,2,3,4,5,6,7,10 × TB, all reels | 1,2,3,5,7,10,15 × TB, **reels 1 & 3 only** |
| Jackpot coins | MINI 15× · MINOR 30× · MAJOR 100× (Grand is not a coin) | MINI 25× · MINOR 50× · MAJOR 150× · **GRAND 1000× as a coin** |
| Special symbol | **BOOST star** (x2/x3/x5): multiplies every visible coin incl. jackpots. In the base game it also **collects** them as an instant win | **COLLECT** diamond, **reel 2 only**: gathers every visible coin. In the base game a COLLECT + any coin is an instant win |
| Trigger | 6+ coin/jackpot/boost symbols · **Diamond Metre** (random trigger dressed as a metre) · **Buy 70×** · **Super Buy 300×** (2 guaranteed boosts, more boosts all round) | ≥1 coin on reel 1 + ≥1 coin on reel 3 + ≥1 COLLECT on reel 2 · **Extra Bonus Game** metre (random; adds the symbols needed) · no buy |
| Pre-feature | — | **SUPER WHEEL** once per feature: diamond boost (raise coin values) · +1 / +2 extra collect (single→double→triple collector) · a jackpot |
| Stickiness | **All coins stick** | **Only COLLECTs stick**; coins are collected each respin and cleared (a "streak") |
| Board end | **G-R-A-N-D letters**: a column full of coins lights its letter, its coins **fly into the Total Win bar and the column clears**. All 5 letters = GRAND 1000× | Ends only when the respins run out; the collectors' values are summed |
| Reset | 3 respins, reset on every new symbol | 3 respins, reset on every new coin/jackpot/collect |
| Big-win tiers | 15 / 30 / 50 / 80 × TB | 20 / 30 / 50 / 100 × TB |

### 1.3 The option space the kind must expose

These are the knobs that turn one template into either reference game (or a Lightning-Link classic):

- **Trigger:** `count` (N+ coins) · `pattern` (per-reel requirements) · `buy` tiers (price, guaranteed
  specials) · `randomMetre` (presentation only — the server decides).
- **Stickiness:** `allCoins` (classic) · `collectorsOnly` (streak).
- **Respins:** start count, reset rule (`anyCoin` / `anySpecial`), cap.
- **Board end:** `fullBoardJackpot` (tier) · `columnLetters` (letters word, jackpot, clear-on-complete)
  · `none`.
- **Coin value table:** cash values (× TB) and jackpot labels, and which reels each can land on.
- **Special symbols (each optional):** collector (single/double/triple, sticky, collects per respin
  or at the end) · boost/multiplier (values, scope, whether it multiplies jackpots) · add-respins ·
  upgrade · mystery reveal · payer.
- **Base-game instant collect** (collector or boost + coins pays without the feature).
- **Pre-feature modifier:** wheel with prize list.
- **Jackpots:** list of tiers (name, × TB, fixed). Progressive/platform jackpots are a separate topic
  (§3.3) and not part of the first build.
- **Board expansion** (rows unlock 3→4→5→6) — industry variant, not in either reference; later.

## 2. What we already carry (inventory, 2026-09-30)

| Area | State | Where |
|---|---|---|
| **Respin loop** | **EXISTS in the upstream `apps/price` sample (`superspin` mode) and nowhere else.** Sticky prize coins with a cash label, 3 respins that reset, a blank `X` strip symbol, `newStickySymbols` → `prizeWinInfo` collect. Never ported into `apps/lines`. | `apps/price/src/components/StickyBoard*.svelte`, `StickySymbol.svelte`, `SymbolPrize.svelte`, `apps/price/src/game/{types,stateGame.svelte,config}.ts`, `apps/price/src/stories/data/superspin_books.ts` |
| Reel board | **Column strips only** — one tween per column; no cell can be held while others spin. A per-cell hide seam exists (`ReelSymbol` `covered`/`removed`), and the tumble/swap-in-place overlay already has per-cell seats and tweens. | `packages/utils-slots/src/createReelForSpinning.svelte.ts`, `createEnhanceBoardSpin.ts`, `engine-game/src/game/gameState.svelte.ts`, `apps/lines/src/game/stateTumble.svelte.ts` |
| Value on a symbol | Partial: lines hardcodes `${multiplier}X` BitmapText; price renders a currency label. Engine `RawSymbol` has no `prize`/`jackpot`. | `apps/lines/.../Symbol.svelte:234`, `engine-game/src/game/types.ts` |
| Collect / count-up | Reusable: `boardMultiplierInfo` collect beat, `updateTumbleWin` running meter, `WinCountUpProvider` (`jumpTo`), free-spin outro count-up, win tiers. | `apps/lines/src/game/bookEventHandlerMap.ts`, `components-pixi`, `FreeSpinOutroDriver.svelte` |
| Respin counter | Reusable with care: the free-spin counter (lines shows `amount + 1`; price's superspin counts used spins). | `FreeSpinCounter.svelte`, `state-shared stateUi.freeSpinCounter*` |
| Mock RGS | Missing: protocols are `lines/book/ways/cluster/scatter`. The free-spin **open round over several `play`s** is the template for respins. | `scripts/mock-rgs-server.mjs`, `services/test-server/server.mjs:483`, `launcher mockProtocol.ts` |
| Facade | Missing respin/jackpot cases; unknown events pass through as `_name`. `parseCell` only yields `multiplier`; `gameType` is `basegame|freegame`. | `packages/rgs-translator-eagaming/src/engineFacade.ts` |
| Game kind lists | `holdAndWin` missing from **every** hand-copied list (roles.ts `GAME_KINDS`, editor `GAME_TYPES`, game-spec `GameTypeSchema`, publish-gate `GAME_TYPES`, `gen-flow-vocabulary.mjs`, `protocolFor`, `FULL_SCENE_SOURCES`, `TEMPLATES`, vocab `registry`, `DRIVEN_SEEDS`, `gameProfile` detectors). | see status file §"Touch list" |
| Kind gating in tools | Only narrow: `/symbols` state columns (`visibleStatesFor`), scene sets, flow vocab by `templateId`, config sections by `winModel`. **No gating** for Symbols sections, builtin components, Win Text, config symbol properties. Flow and seed **silently fall back to bookOf**. | tooling report in the status file |

## 3. The RGS contract — the biggest open question

### 3.1 What the partner's reference client does (read 2026-09-30)

The Play4Fun/HyperGaming generic slot core (`p4f-slotty-core`, on disk, read-only):

- **Has a generic respin feature:** each respin is its own context-less `play` (seq +1, with `gid`);
  progress comes from `playedBonusSpin {playing, bonusPlayed, spins}`; `spinTrigger.bonus` names the
  respin key and `occurs` the count; the round closes with `gameEnd` + `collect`. A "reset to 3" would
  surface as the server's `spins` count going back to 3 (inference — nothing handles it explicitly).
- **Has `symbolSetInMatrix {reel,row,symbol}`** — the most plausible existing carrier for held cells,
  but it carries **no value**.
- **Has NO coin values, sticky lists, collector events or per-cell data** in the generic core. A real
  H&W game would subclass the handler (`_handleEventUnknownEvent` etc.); no such game is in the drop.
- **Has a platform jackpot** — `platform.jackpots[] {id,name,value,minValue,maxValue}` (Mini/Minor/
  Major/Grand) refreshed on the balance heartbeat, won via `platform.gameRound.jackpot
  {winJackpotId,win}` with a `lockedPoint` balance hold. That is the **operator's progressive/mystery
  jackpot**, brand-gated, *not* the fixed coin jackpots of a Hold and Win.

### 3.2 Decision: mock-first with our own event family, partner confirmation owed

We cannot wait for the partner, and the engine should not be shaped around a guess of their wire.
So: **we define the engine-side book events** (§4.3), the **mock RGS speaks an invented wire family
for them** (precedent: `tumbleStep` / `multiplierCollect`, also invented), and the facade maps them.
When the partner gives us a Hold and Win sample (owed — ask for a real H&W game's responses or its
handler subclass), only the facade mapping changes.

**Owed to the partner (blocks production only, not authoring):** a sample round from a Hold and Win
game — how coin values, jackpot labels, held cells, the respin counter/reset, collectors and the
feature total travel; whether fixed coin jackpots ever use `platform.gameRound.jackpot`.

### 3.3 Out of scope for the first build

The operator platform jackpot (`platform.jackpots[]`, lockedPoint, fake-spin teaser) — a separate,
kind-independent feature. Board expansion. Free spins inside a H&W game (the kind keeps the free-spin
scenes optional, so a hybrid can still be authored later).

## 4. The engine shape

### 4.1 Kind = `holdAndWin`, win model = lines, mechanic = a `holdAndWin` config block

Following [game-type-templates.md](game-type-templates.md): the base game pays by the existing
`lines` win model; the feature is a **mechanic** with a Game Config block, like `cascade` /
`reelBehaviour`. `holdAndWin` is a project **kind** (like `bookOf`), not a `winModel` arm.

### 4.2 The respin board — a dedicated per-cell board, not a rewrite of the reel board

The shared reel board is column-strip based, and everything (anticipation, sequential stop, win
positions, tumble) assumes one reel per column. Rewriting it for per-cell spins would risk every live
game. Instead:

- **Base game** keeps the normal column reels.
- **The feature** mounts a **`RespinBoard`**: `numReels × numRows` one-cell reels, each with its own
  mask (reusing `createReelForSpinning` with a 1-row window), plus a **held layer** that draws the
  stuck coins. A respin spins only the unheld cells; a new coin moves from its cell reel into the
  held layer. Coins keep their value label.
- Hand-over at trigger/end is a swap between the two boards over the same seats (the swap-in-place
  seat maths already exists).
- Ported from `apps/price`: `StickyBoard*` / `StickySymbol` / `SymbolPrize` behaviour, rebuilt on
  engine-game primitives (not copied as an app fork).

### 4.3 Engine book events (the contract the flow, the mock and the facade share)

| Event | Payload | Meaning |
|---|---|---|
| `reveal` (existing) | board with coin cells carrying `{value}` or `{jackpot}` | base-game board, coins labelled |
| `coinInstantCollect` | `collector:{reel,row}`, `from:[{reel,row,amount}]`, `total` | base-game collect/boost instant win |
| `holdAndWinTrigger` | `coins:[cell]`, `respins`, `variant` | feature starts; the triggering coins stick |
| `holdAndWinWheel` | `prize` (`boost`/`extraCollect:n`/`jackpot:<tier>`) | optional pre-feature wheel |
| `respinUpdate` | `left`, `total`, `reset:boolean` | counter changed (reset or decrement) |
| `respinReveal` | `cells:[{reel,row,symbol,value?,jackpot?}]` | the unheld cells' outcome for this respin |
| `coinsLand` | `cells:[cell]` | new coins stick (per-reel land cue) |
| `coinBoost` | `booster:{reel,row}`, `multiplier`, `cells:[{reel,row,from,to}]` | boost multiplies visible coins |
| `coinCollect` | `collector:{reel,row}`, `from:[{reel,row,amount}]`, `collectorTotal` | collector gathers (streak) |
| `columnComplete` | `reel`, `letter`, `amount`, `cleared:boolean` | Grand-style letter lit, column swept |
| `jackpotWin` | `tier`, `amount` | a jackpot is awarded (coin, letters or full board) |
| `holdAndWinEnd` | `coins:[{reel,row,amount}]`, `total` | per-coin collection into the total, then pay |
| `setWin` / `setTotalWin` / `finalWin` (existing) | — | normal win presentation + big-win tier |

A resume snapshot (`createBonusSnapshot`) must carry the held board, the counter and the running
total, so a reload mid-feature rebuilds the respin board.

## 5. Tool by tool — what each authoring surface gets

**Cross-cutting first: one kind-capability source.** Today each tool gates on its own ad-hoc test
(`gameType === 'bookOf'`, `winModel`, cascade flags) and several gate on nothing. Add one
**`kindCapabilities(gameType, config)`** in `engine-layout` (e.g. `{freeSpins, bookReveal,
stackedPictures, cascade, holdAndWin, coinSymbols, winLines}`) and make `/symbols`, `/config`,
`/win-text`, the editor palette and the flow palette read it. This is what "hide the extra options"
means in practice. It also retires the five hand-copied kind lists in favour of one `GAME_KINDS`.

| Tool | Hold and Win gets | Hides for this kind |
|---|---|---|
| **Game Maker** | `holdAndWin` in the picker with two presets — **Classic sticky** (Grand-like 5×3) and **Collector streak** (Hotfire-like 3×3); scaffold seeds scenes, flow, **Game Config**, **Symbols** and **Win Text** defaults (today the last three aren't seeded for any kind); hub profile feature chips (`respin`, `jackpots`, `collector`, `boost`, `columnLetters`, `wheel`) | — |
| **Scene Editor** | `referenceLayouts/holdAndWin.ts` + template: `basegame`, `respinBoard` scene (new role `respinFeature`), `respinCounter`, `totalWinBar`, `jackpotBar` (MINI/MINOR/MAJOR/GRAND values, live × bet), `letters` (G-R-A-N-D), `wheel`, `featureIntro` / `featureOutro` (total count-up), `jackpotWin` celebration, `buyFeature`/`buyConfirm`; new builtin components for counter / jackpot bar / letters / total bar | `specialBook`, free-spin intro/counter/outro (optional add) |
| **Flow editor** | `engine-flow-v2/src/reference/holdAndWin.ts` vocab: events §4.3; actions `showRespinBoard`/`hideRespinBoard`, `stickCoins`, `spinRespin`, `setRespinCounter`, `collectCoins`, `boostCoins`, `lightLetter`, `clearColumn`, `awardJackpot`, `showJackpotWin`, `countUpTotal`, `spinWheel`; cues `respinBoard*`, `coinLand`, `coinCollect*`, `coinBoost*`, `letter*`, `jackpot*`, `wheel*`, `totalWinBar*`; values `respinsLeft`, `respinTotal`, `jackpot.mini…grand`, `featureTotal`; a registered **driven seed** + choreography so a new project plays end-to-end with zero authoring | the Book-of expanding-symbol events/actions, tumble/multiplier-board entries |
| **Symbols SM** | symbol roles: `coin`, `jackpotCoin`, `collector`, `boost`, `blank`; states `coinIdle`, `coinLand`, `coinStick`, `coinCollect`, `coinBoost`, `jackpotReveal`; a **coin value label** section (font, format per cash/jackpot, placement, per-tier styling) through the full ship chain; respin-cell spin blur / land FX | Book symbol VFX, bookIntro/bookIdle, stacked pictures, explosion / tumble pattern, clearReel, transition (unless used); win-line section stays (base game pays lines) |
| **Game Config** | `holdAndWin` block: trigger, respins, reset rule, stickiness, board end, coin value table (value, weight, reels), jackpot tiers (× TB), specials (collector/boost/…), wheel prizes, buy tiers; symbol `special_properties` `coin`/`jackpot`/`collector`/`boost`/`blank`; validator + in-play gate; `data/gameConfig/holdAndWin.json` default (both presets); paytable UI shows coin rows as "value table", not pays | win-model picker locked to lines; scatter paytable hints |
| **Win Text** | `jackpots` captions (`MINI`…`GRAND`, award text "{jackpot} JACKPOT {amount}"), respin copy ("{count} RESPINS", "RESPINS RESET"), feature total ("BONUS WIN {amount}"), instant-collect toast; all harvested for Localization | `toast.expanded` ("on N reels", Book-of) |
| **Mock RGS** | `holdAndWin` protocol + generator for both presets, deterministic forced outcomes (trigger, full board/letters, each jackpot, boost, wheel prizes) for playtests | — |
| **Facade** | map the invented wire → §4.3 events; `parseCell` coin values/jackpot labels; `gameType: 'respin'`; resume of the held board | — |
| **Playtester** | `docs/playtest/<game>.md` playbook for both presets | — |

## 6. Build plan (phases — each a PR, each updates the status file)

0. **Hub + plan** (this doc, the status file). ✔ when merged.
1. **Kind plumbing + capability source** — one `GAME_KINDS`, `kindCapabilities()`, `holdAndWin` in
   every list, game-spec symbol kinds, `protocolFor` → `holdAndWin`. No behaviour change for
   existing kinds (parity gate).
2. **Game Config block** — schema, normalizer, validator, `/config` UI section, defaults JSON for both
   presets, `gameProfile` detectors. Agent: `invisible-game-config`.
3. **Mock RGS protocol** — wire family, generator, forced outcomes, `pnpm check:*` fixture gate.
4. **Engine runtime** — `RawSymbol.prize/jackpot`, the coin value label, `RespinBoard` + held layer,
   §4.3 handlers + effects + cues, resume snapshot, facade mapping. Engine change ⇒ a runtime
   release on merge: svelte-check + boot a lines game unchanged first. Agent: `engine-pixi-svelte`.
5. **Flow vocabulary + driven seed** — `holdAndWin.ts`, registry, seed + choreography, publish gate,
   `gen-flow-vocabulary`. Agent: `invisible-flow`.
6. **Scene Editor template + components** — reference layout, template, roles, builtin components.
   Agent: `invisible-components`.
7. **Symbols SM** — roles, states, value-label section + ship chain, kind-gated sections.
   Agent: `invisible-symbols`.
8. **Win Text** — new families + harvest + gating.
9. **Game Maker** — presets in the picker, seed config/symbols/win-text, docs (`docs/tools/*`),
   playtest playbook; then build one sample game per preset and play it end to end.
10. **Variants round 2** — wheel, random metre, Super Buy, board expansion, platform jackpot (§3.3).

Phases 2 and 3 can run in parallel once 1 lands; 5–8 in parallel once 4's event contract is merged
(the contract can land ahead of the rendering).
