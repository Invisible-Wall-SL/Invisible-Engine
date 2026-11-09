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
  - Triggered by **3+ coins or collectors on adjacent reels, anywhere** (reels 3–4–5 triggered in
    the capture).
  - **More coins and collectors can be added** before the feature starts.
  - **Only the collectors stay.** A collector in the trigger spin first collects the coins in view;
    the bonus board then opens with just the collector(s), carrying that total. Every other cell is
    blank.
  - 3 respins. Any new coin or collector resets them to 3. **Coins do not stick:** each respin the
    collectors in view gather the new coins, which then vanish. Collectors land on reel 3 only and
    each keeps its own total. The bonus pays the sum of the collectors.
  - It always starts with **at least one** of four enhancements, drawn at random:
    - **Expand:** one more row, so the board is 4×5.
    - **Boost:** each respin may add 1–5× the total bet to one cash value in view.
    - **Multiply:** each respin may multiply one cash value in view by 2–5×.
    - **Respin:** the counter starts and resets at 4.
  - Boost and Multiply do not hit on every respin; a miss shows an **X** on the indicator.
  - It ends when the respins run out and pays the total collected.
- **Super bonus** ("Force 5"): a collector landing on reel 3 has a **random chance** to start it.
  It plays like the bonus, but with 5 respins (reset to 5) and **all four enhancements on, each
  stronger**: the grid can grow to a full 5×5, and boosts and multipliers go higher (the game's
  web page; exact values not read).
- **Ante** ("Power Roll", operator dependent): a toggle costing 5× the bet. While it is on, **only
  collectors and coins land** (blanks elsewhere). Coin values stay multiples of the base bet.
- **Buy** (two options, read 2026-11-09): **Center Coin** at 50× the bet deals the ante's coin-only
  reels with a collector guaranteed on reel 3; **Gold Strike** at 100× buys the bonus. There is no
  super-bonus buy.
- **Indicators:** four dials above the reels, one per enhancement, lit when active.
- **The wire** of all of this, captured 2026-11-09:
  [play4fun-collector-respin-capture.md](../reference/play4fun-collector-respin-capture.md).

## 2. What we already have (config only, no code)

| Their mechanic                                                    | Ours                                                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lines base game, paytable                                         | `lines` base, `paylines`, `paytable`                                                                                                                      |
| Coins on 4 reels, cash + 4 fixed jackpots                         | `holdAndWin.coins[].reels`, `jackpots`                                                                                                                    |
| Collector on reel 3 only                                          | `specials.collector.reels: [2]`, `landsInBaseGame`                                                                                                        |
| Base-game collect                                                 | `specials.collector.instantCollectInBaseGame`                                                                                                             |
| Collector collecting in the respins                               | `specials.collector.collects: 'perRespin'`                                                                                                                |
| Collectors stick, coins are gathered, 3 respins, any-symbol reset | `stickiness: 'collectorsOnly'`, `respins {start: 3, reset: 'anySpecial'}` (14c checks that our `collectorsOnly` opens the board with only the collectors) |
| A second bonus with 5 respins                                     | a second respin mode (`GameModeDecl.holdAndWin`, bonus-games), own `respins`                                                                              |
| The bonus buy (100×)                                              | `coinOverlay.trigger` buy route `{betMode, mode, guaranteed}`                                                                                             |
| The Center Coin buy (50×)                                         | a buy bet mode dealing its own strips (14e) with reel 3 all collectors                                                                                    |
| The ante's price and toggle                                       | a bet mode with `presentation.kind: 'ante'`                                                                                                               |
| Art, dials, jackpot bar, counter                                  | Scene Editor + skinnable parts (Phase 12c), Symbols, Win Text                                                                                             |

## 3. What we build

### 3.1 Trigger rules (14a)

Two rules beside `count` and `pattern` in `HoldAndWinTrigger` (and as routes in
`coinOverlay.ts`, so a second mode can use them):

```ts
/** N+ symbols of `roles` on adjacent reels, anywhere on the board (a reel counts when it shows at
 *  least one; a reel with none breaks the run). */
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
	| { kind: 'extraRow'; weight: number; rows: number } // opens rows at entry (needs `expansion`); 1 = 4×5, 2 = 5×5
	| { kind: 'extraRespins'; weight: number; start: number } // the counter starts and resets here
	| { kind: 'boost'; weight: number; hitRate: number; values: WeightedValue[] } // × total bet
	| { kind: 'multiply'; weight: number; hitRate: number; values: WeightedValue[] }; // factors
```

The super bonus is the same block with `draw: {type: 'all'}` and its own, stronger values
(`extraRow.rows: 2`, higher boost and multiply tables) in its own respin mode.

**Follow the partner's shapes where we now know them** (capture 2026-11-09): the drawn set as five
0/1 flags (`boostsAwarded`, repeated per respin as `boostsEnabled`), a multiply miss as
`multiplier {multiplier: "X"}` and a hit as `[{reel, row, startingPay, multiplier}]`, applied to a
coin as it lands, before the collect. The mock's new events should carry the same fields, so Phase
10's facade mapping for this game is a rename, not a redesign.

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
- **Order inside a respin:** the capture shows multiply applied to a newly landed cash coin before
  the collectors gather it. Boost's place was not seen (assumed the same: boost, then multiply,
  then the collect).
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
- The **Center Coin buy** is the same field on a buy bet mode: coin-only strips whose reel 3 is all
  collectors, so every bought spin shows one.
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

Answered by the 2026-11-09 capture: adjacent reels anywhere (not only from reel 1); the collector
gathers every respin and coins do not stick; the two buys (Center Coin 50×, the bonus 100×); the
ante at 5× with coin values on the base bet; multiply hits a cash coin as it lands.

Still open, for the owner:

- **Boost / multiply targets:** can either hit a jackpot coin? Can both hit the same coin in one
  respin? Not seen in the capture.
- **Two collectors:** how a coin is shared between two collectors in view. One round showed them
  rising by different amounts.
- **Our names, theme and math.** The math is not copied.

For Phase 10: the capture
([play4fun-collector-respin-capture.md](../reference/play4fun-collector-respin-capture.md)) is the
partner's real respin wire for this game. It is enough to start mapping the facade for a collector
respin game. Jackpot coins, meters and other partner titles are still unseen.
