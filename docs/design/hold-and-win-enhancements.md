# Hold and Win — collector bonus with random enhancements (plan, Phase 14)

> Status: [docs/status/hold-and-win.md](../status/hold-and-win.md) (Phase 14) · Parent design:
> [hold-and-win.md](hold-and-win.md) · Asked for 2026-11-08 by the owner. Owner agent:
> `hold-and-win-games` (the second respin mode, buy routing and the overlay side are `bonus-games`).

## Why this exists

The owner wants a game that plays like the partner's own **Fortune Vault Force 5** (EAGaming /
Play4Fun), with our own art, names and theme. We copy the **mechanics only**. The art, the symbol
set, the names ("Gold Strike", "Force 5", "Power Roll") and the numbers stay theirs. Our math is set
in Game Config by a person, as for every game (targets.md).

About 70% of that game is already Hold and Win config. This plan builds the rest: four random
enhancements, two new trigger rules, a symbol top-up before the feature, and an ante that changes
the reels. Every new path is gated on a new, sparse config field. Its absence leaves every current
game byte-identical.

## 1. The reference game's rules (read 2026-11-08 from its in-game info pages)

- **Base game:** 5×3, 5 fixed lines, 9 paying symbols (×3 / ×4 / ×5).
- **Coin** lands on reels 1, 2, 4 and 5 only. It carries a cash value or a jackpot label (MINI,
  MINOR, MAJOR, GRAND at 25× / 50× / 150× / 1000× the total bet, all fixed).
- **Collector** ("Gold Strike") lands on reel 3 only.
- **Collect:** a collector on reel 3 with any coin in view pays every coin at once (base game).
- **Bonus** ("Gold Strike Bonus"):
  - Triggered by **3+ coins or collectors on consecutive reels**.
  - **More coins and collectors can be added** before the feature starts.
  - The trigger symbols stay, in place; every other cell becomes blank.
  - 3 respins. Any new coin or collector resets them to 3.
  - It always starts with **at least one** of four enhancements, drawn at random:
    - **Expand:** one more row, so the board is 4×5.
    - **Boost:** each respin may add 1–5× the total bet to one cash value in view.
    - **Multiply:** each respin may multiply one cash value in view by 2–5×.
    - **Respin:** the counter starts and resets at 4.
  - Boost and Multiply do not hit on every respin; a miss shows an **X** on the indicator.
  - It ends when the respins run out and pays the total collected.
- **Super bonus** ("Force 5"): a collector landing on reel 3 has a **random chance** to start it.
  It plays like the bonus, but with 5 respins (reset to 5) and **all four enhancements on**.
- **Ante** ("Power Roll"): a toggle costing 5× the bet. While it is on, **only collectors and coins
  land** (blanks elsewhere).
- **Buy:** two options, most likely the bonus and the super bonus. Not read: the demo crashed
  before that page. To confirm (§5).
- **Indicators:** four dials above the reels, one per enhancement, lit when active.

## 2. What we already have (config only, no code)

| Their mechanic                            | Ours                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| Lines base game, paytable                 | `lines` base, `paylines`, `paytable`                                         |
| Coins on 4 reels, cash + 4 fixed jackpots | `holdAndWin.coins[].reels`, `jackpots`                                       |
| Collector on reel 3 only                  | `specials.collector.reels: [2]`, `landsInBaseGame`                           |
| Base-game collect                         | `specials.collector.instantCollectInBaseGame`                                |
| Collector collecting in the respins       | `specials.collector.collects: 'perRespin'`                                   |
| Sticky coins, 3 respins, any-symbol reset | `stickiness: 'allCoins'`, `respins {start: 3, reset: 'anySpecial'}`          |
| A second bonus with 5 respins             | a second respin mode (`GameModeDecl.holdAndWin`, bonus-games), own `respins` |
| Two buys, each to its own bonus           | `coinOverlay.trigger` buy routes `{betMode, mode, guaranteed}`               |
| The ante's price and toggle               | a bet mode with `presentation.kind: 'ante'`                                  |
| Art, dials, jackpot bar, counter          | Scene Editor + skinnable parts (Phase 12c), Symbols, Win Text                |

## 3. What we build

### 3.1 Trigger rules (14a)

Two rules beside `count` and `pattern` in `HoldAndWinTrigger` (and as routes in
`coinOverlay.ts`, so a second mode can use them):

```ts
/** N+ symbols of `roles` on consecutive reels, starting at the leftmost reel (one per reel
 *  counts; a reel with none breaks the run). */
run?: { min: number; roles: HoldAndWinSymbolRole[] };
/** A server-side chance, rolled only when `role` lands on one of `reels`. */
chance?: { role: HoldAndWinSymbolRole; reels?: number[]; rate: number; name?: string };
```

- **`run`** gets a predicate, a forced placer (`satisfyTrigger`), a cause and a validator check
  (`min ≤ numReels`; every role reachable on the reels it needs). Mock: `mock-holdandwin-engine.mjs`
  around `countTriggered` / `patternTriggered` and the cause order in `playBase`.
- **`chance`** replaces the hard-coded `RANDOM_METRE_RATE` pattern for this case: the roll moves
  **after** the deal (it needs the dealt board), and it fires only when the role landed. Its
  `rate` is math, so it lives in Game Config. It emits the existing `randomMetreTrigger` shape
  with a `chance` cause, so the current presentation (`presentRandomMetreTrigger`) works unchanged.
- New `HoldAndWinCause` values `run` and `chance` (`engine-game/src/game/holdAndWin.ts`).

### 3.2 Top-up before the feature (14b)

```ts
/** On a trigger, the server may add symbols to blank cells before the board locks. */
topUp?: { rate: number; count: WeightedValue[]; roles: HoldAndWinSymbolRole[] };
```

- Mock: after the trigger is decided and before `holdAndWinTrigger`, roll `rate`; place `count`
  symbols of `roles` on empty cells their reels allow. New event `featureTopUp {cells}` (each
  `{reel, row, symbol, value?}`), so the client knows which cells are new (Lucky Spin does not).
- Runtime: a beat that drops each added symbol onto the base board (`coinStick`), then the
  usual trigger. Coded default first; a flow event `featureTopUp` and a Win Text line.
- The added symbols count in the trigger's `cells` and in the respin board seed.

### 3.3 Entry enhancements (14c engine, 14d presentation)

```ts
enhancements?: {
	/** Each enhancement the feature can draw, with its weight in the draw. */
	pool: Enhancement[];
	/** `atLeastOne` — draw 1..pool.length, never zero (weights per count); `all` — every one. */
	draw: { type: 'atLeastOne'; counts: WeightedValue[] } | { type: 'all' };
};
type Enhancement =
	| { kind: 'extraRow'; weight: number } // opens one row at entry (needs `expansion`)
	| { kind: 'extraRespins'; weight: number; start: number } // the counter starts and resets here
	| { kind: 'boost'; weight: number; hitRate: number; values: WeightedValue[] } // × total bet
	| { kind: 'multiply'; weight: number; hitRate: number; values: WeightedValue[] }; // factors
```

The super bonus is the same block with `draw: {type: 'all'}` in its own respin mode.

- **Wire.** `holdAndWinTrigger.context.enhancements: string[]` (the drawn kinds), beside
  `activeModifiers`. The respin counter's start is already carried by `respinUpdate.start`, so
  `extraRespins` just changes the server's start. Per respin, after the landed specials:
  - a hit sends `coinPay {source: 'enhancement', cells: [{reel, row, from, to}]}` (boost) or
    `coinBoost {source: 'enhancement', multiplier, cells}` (multiply), one cash coin each, chosen at
    random among the cash coins held;
  - a miss sends `enhancementMiss {kind}` (the X);
  - with no cash coin held, it is a miss.
    Both events exist today with `source` values for specials and the wheel, so the reducer and the
    sums `check:holdandwin` re-derives keep one rule. Their `payer` / `booster` fields become optional
    when `source` is `enhancement`.
- **`extraRow`** uses the existing expansion. New expansion rule value `atEntry`: the board opens
  one row below the base grid when the feature starts, through the existing
  `rowsUnlocked {cause: 'enhancement'}` sent right after `holdAndWinTrigger`. `startRows` still
  equals the grid rows, so the validator's rule stays. The reducer already honours `rows`.
- **Order inside a respin** (to confirm, §5): landed specials, then boost, then multiply. So a
  multiply can double a boosted coin.
- **Validation:** `extraRow` requires `expansion` with `maxRows > startRows` and rule `atEntry`.
  `boost` / `multiply` need cash coins in the coin table. `atLeastOne` counts are 1..pool size.
- **Presentation (14d):**
  - An **Enhancement Dial** coded part, a skinnable component with a scope of kind `enhancement`
    (12a). It has unlit, lit, hit and miss states, and signals `enhancementOn`, `enhancementHit`
    and `enhancementMiss`. A Scene Editor template places four of them above the board.
  - Beats: the dials light at entry, each with a banner ("BOOST ACTIVE"). A boost or multiply
    beam goes from the dial to its coin, reusing the payer and booster beam and its count-up. A
    miss pulses the dial's X.
  - Flow vocabulary: `enhancementsDrawn`, `enhancementHit`, `enhancementMiss`. Starter-flow step.
  - Symbols / Win Text: Win Text lines per kind; value sources `enhancement.<kind>.on` (visibility
    - value).

### 3.4 Ante reel set (14e)

The ante today changes the price only. Here it changes **what the base reels deal**.

```ts
/** Per bet mode, the base strips it deals with — a key into `paddingReels`. Absent ⇒ `basegame`. */
betModeStrips?: Record<string, string>;
```

- Math: the ante's strips (collectors, coins and blanks only) are authored like any strip set in
  `/config` → Reels. A bet mode with no entry deals the base strips (parity).
- Mock: `dealBase` picks the strip set by `round.betMode`; the line evaluation is unchanged (no
  line symbols means no line wins).
- Runtime: the spinning filler uses the active bet mode's strips, so the reels look right while
  the ante is on. The ante toggle and its badge already exist (`BetModeText.betAmountLabel`).
- Validation: the key names a real strip set with the base grid's reel count. Every symbol on it
  exists.
- This is not the coin board (Phase 13). The coin board replaces the whole base game. This is a
  per-bet-mode strip swap on a lines game. It is generic, so any kind's ante can use it.

### 3.5 Sample game and docs (14f)

- A Game Maker preset **Collector + enhancements**, with all of the above set (`holdAndWinPresets.ts`):
  - 5×3, 5 lines;
  - collector on reel 3 with instant collect, coins on reels 1, 2, 4 and 5;
  - the bonus (3 respins, at least one enhancement) and the super bonus (5 respins, all four);
  - two buys and the ante.

  Placeholder numbers until the owner's math lands.

- A sample project scaffolded from it with our own art (Atlas Maker / ComfyUI), a playtest playbook
  `docs/playtest/hw-enhancements-sample.md`, guide updates (`docs/tools/game-config.md`,
  `symbols.md`, `editor.md`), and `scripts/current-games/screens/holdAndWin.json` gains the dials
  and a boost hit.

## 4. Build plan (each a PR on its own branch; pipeline rules apply)

Every slice ships the whole pipeline in one go: config + validator + `/config` UI → mock + forced
beat + wire doc → facade → reducer → coded beat → flow vocab → Scene Editor part (where it has one)
→ Symbols / Win Text → docs. `check:holdandwin`'s parity digests (400 seeded rounds per preset)
must stay equal for every existing preset.

| #   | Slice                                                                            | Forced beat                                                 | Owner agent                                              |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| 14a | Trigger rules `run` + `chance`                                                   | `force:run`, `force:chance`                                 | hold-and-win-games                                       |
| 14b | Top-up before the feature (`featureTopUp`)                                       | `force:topUp`                                               | hold-and-win-games                                       |
| 14c | Enhancements: config, draw, wire, mock, facade, reducer, `atEntry` expansion     | `force:enhancements:<kinds>`, `force:enhancementHit:<kind>` | hold-and-win-games                                       |
| 14d | Enhancements: dials, beats, flow vocab, Scene Editor template, Win Text, Symbols | —                                                           | hold-and-win-games, invisible-flow, invisible-components |
| 14e | Ante reel set `betModeStrips`                                                    | `force:betMode:<mode>`                                      | invisible-game-config, engine-pixi-svelte                |
| 14f | Preset, sample game, playbook, guides                                            | —                                                           | invisible-game-maker, docs-keeper, game-playtester       |

**Order.** 14a → 14b → 14c all edit `playBase` / `startFeature` in the one mock file, so they
merge in that order. 14e can be built in parallel (its own fields, `dealBase` only) and rebased.
14d needs 14c's wire. 14f needs everything.

**Size (against the code, 2026-11-08).** 14a and 14b are small: they follow the count, pattern
and random-metre paths. 14c is the largest: a new per-respin loop step with two event sources and
a new expansion rule. 14d is medium, because the dial copies the Jackpot Tile part pattern. 14e is
medium: a config field, a mock branch, and the runtime's spinning strips.

## 5. Open questions

For the owner:

- **"Consecutive reels"**: from reel 1 only (assumed), or any 3 adjacent reels?
- **Boost / multiply targets**: cash coins only (the rules say "cash value"), or also jackpot
  coins? Can both hit the same coin in one respin, and in which order?
- **The collector in the respins**: we assume it collects every coin in view each respin it lands
  (`perRespin`). The rules page does not say.
- **The buy options and the ante's full rules**: not read (demo crashed). The owner, or the next
  session, opens the demo and reads the Buy Feature dialog and the Power Roll page.
- **Our names, theme and math.** The math is not copied.

For the partner (Phase 10 asks):

- **The wire.** All of this is mock-first on our own event family, like the rest of Hold and Win.
- **Unblocking Phase 10.** This game runs on the partner's own RGS, so capturing a few of its rounds
  would show their real Hold and Win format. Use `scripts/console-sniffer.js` in a real browser tab
  on the game's origin (Cloudflare blocks server-side fetches). That covers the respins, the
  enhancements, the ante and a buy. It may unblock Phase 10 for every Hold and Win game, so it is
  worth doing before 14c fixes our own event names.
