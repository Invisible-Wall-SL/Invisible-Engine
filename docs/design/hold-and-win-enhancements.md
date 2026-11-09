# Hold and Win — collector bonus with random enhancements (plan, Phase 14)

> Status: [docs/status/hold-and-win.md](../status/hold-and-win.md) (Phase 14) · Parent design:
> [hold-and-win.md](hold-and-win.md) · Asked for 2026-11-08 by the owner. Owner agent:
> `hold-and-win-games` (the second respin mode, buy routing and the overlay side are `bonus-games`).

**On the partner's server** (their word, 2026-11-09): the game is named **Getting Hot**, game id
**8**. Their CDN alias is the name without spaces, `GettingHot`, so the launcher card must be named
"Getting Hot" for deliveries to find it (or the launch link passes `&alias=GettingHot`).

## Scope (owner, 2026-11-09): their math, our visuals

**The partner's server owns the math and every outcome.** Getting Hot is their proven Fortune Vault
Force 5 game: same math, same server logic, same wire. **We build the client:** it must read their
wire exactly and present it with our own art, names and theme. We copy no art or names
("Gold Strike", "Force 5", "Power Roll" stay theirs).

So the work is, in order of importance:

1. **Read their wire.** Map the captured events
   ([play4fun-collector-respin-capture.md](../reference/play4fun-collector-respin-capture.md)) into
   our engine's book events in the facade. For this game this is Phase 10.
2. **Show it.** The beats, parts and art for what is new to our engine (§4, slice 14b).
3. **Author and test without their server.** Our mock only has to speak their wire with
   plausible rounds; its numbers are pacing, not math.

Every config field in §3.1–§3.4 below that sets a rate, a weight or a table is therefore **mock
pacing only**: it shapes the rounds our mock deals for authoring and tests, never what a player
gets. The partner's server decides those.

## Why this exists

The owner wants a game that plays like the partner's own **Fortune Vault Force 5** (EAGaming /
Play4Fun), with our own art, names and theme, on the partner's server as game 8.

About 70% of that game's presentation already exists in our Hold and Win kind. This plan builds
the rest: four random enhancements, two trigger rules, a symbol top-up before the feature, and an
ante and buys that change the reels. Every new path is gated on a new, sparse config field. Its
absence leaves every current game byte-identical.

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
    `coinBoost {source: 'enhancement', multiplier, cells}` (multiply), on one **cash coin that
    landed this respin**, never a jackpot coin (capture, second session);
  - a miss sends `enhancementMiss {kind}` (the X);
  - with no cash coin landing, it is a miss.
    Both events exist today with `source` values for specials and the wheel, so the reducer and the
    sums `check:holdandwin` re-derives keep one rule. Their `payer` / `booster` fields become optional
    when `source` is `enhancement`.
- **`extraRow`** uses the existing expansion. New expansion rule value `atEntry`: the board opens
  one row below the base grid when the feature starts, through the existing
  `rowsUnlocked {cause: 'enhancement'}` sent right after `holdAndWinTrigger`. `startRows` still
  equals the grid rows, so the validator's rule stays. The reducer already honours `rows`.
- **Order inside a respin:** boost and multiply apply to the landed coin before the collectors
  gather it. A respin with both on was not seen, so boost-then-multiply stays an assumption.
- **Collect with two collectors:** each collector adds the full value of every coin (capture), so
  a coin pays once per collector. 14c checks that our collector streak counts it the same way.
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

  Its numbers are mock pacing only; the partner's server holds the real math.

- A sample project scaffolded from it with our own art (Atlas Maker / ComfyUI), a playtest playbook
  `docs/playtest/hw-enhancements-sample.md`, guide updates (`docs/tools/game-config.md`,
  `symbols.md`, `editor.md`), and `scripts/current-games/screens/holdAndWin.json` gains the dials
  and a boost hit.

## 4. Build plan (each a PR on its own branch; pipeline rules apply)

Re-ordered 2026-11-09 for the owner's scope: the partner's wire first, then the look, then our mock.
Each slice ships with its fixture and docs. `check:holdandwin`'s parity digests (400 seeded rounds
per preset) must stay equal for every existing preset.

| #   | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owner agent                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 14a | **Facade: read the partner's collector-respin wire.** Map the captured events into engine book events: `COIN_<n>` / `COIN_<TIER>` and `COLLECT_<cents>` cells; `collect`, `bonusWin`, `cellPayAmount`; `boostsAwarded` / `boostsEnabled` flags; `boost` and `multiplier` hits and X misses; `retrigger` and `left`; 4- and 5-row boards; the base-game collect round closed by `collect`; `betOptions` (Base, ante, two buys). A fixture built from the capture's shapes. This is Phase 10 for this game. | hold-and-win-games                                       |
| 14b | **Presentation of what is new:** the collectors-only bonus board (per-collector totals; each collector takes a coin's full value; the trigger spin's collect carried in), the four enhancement dials (off / on / hit / miss), boost and multiply beams onto the landing coin, Expand opening its row(s) at entry, the super-bonus entry, the base-game collect. Flow vocabulary, Scene Editor template, Symbols states, Win Text.                                                                         | hold-and-win-games, invisible-flow, invisible-components |
| 14c | **Ante and buys in the HUD:** the ante toggle and the two buy cards from `betOptions`; while the ante is on, the spinning filler reels show only coins, collectors and blanks (a client-side strip set, no math).                                                                                                                                                                                                                                                                                         | engine-pixi-svelte, invisible-game-config                |
| 14d | **Our mock speaks their wire** for authoring and tests without their server: same events and shapes, forced beats (`force:enhancements:<bits>`, `force:boostHit`, `force:multiplyHit`, `force:superBonus`, `force:twoCollectors`), rates as pacing. §3.1–§3.4's config fields live here.                                                                                                                                                                                                                  | hold-and-win-games                                       |
| 14e | **Getting Hot itself:** the project from a preset, our art (Atlas Maker / ComfyUI), a playtest playbook, the delivery to the partner CDN as `GettingHot`, and a first launch against their server as game 8 (`&on=partner&game=8`).                                                                                                                                                                                                                                                                       | invisible-game-maker, docs-keeper, game-playtester       |

**Order.** 14a first: everything visible depends on reading their events right. 14b and 14d can
then run in parallel (14b against 14a's fixture, 14d against the capture), and 14c beside them.
14e needs the others; its art can start now from the brief.

**What we no longer build as math:** the trigger rules, top-up rate, enhancement draw and hit
rates, and per-bet-mode strips are the partner server's. They stay in the plan only as mock pacing
(14d). The `run` / `chance` triggers and `featureTopUp` matter to the client only if their server
sends something for them; the capture never showed a top-up event, so 14a records what it finds.

## 5. Open questions

Answered by the 2026-11-09 capture: adjacent reels anywhere (not only from reel 1); the collector
gathers every respin and coins do not stick; the two buys (Center Coin 50×, the bonus 100×); the
ante at 5× with coin values on the base bet. The second session added: boost and multiply hit only
a cash coin landing that respin, never a jackpot coin; two collectors each take a coin's full
value; Expand opens its row at entry.

Still open:

- **Boost and Multiply on the same respin:** can both hit one coin, and in which order? No bonus
  in 17 had both on. The plan assumes boost, then multiply.
- **Our names and theme** for Getting Hot (the art brief uses placeholders). The math is the
  partner's and already proven; nothing to decide on our side.

For Phase 10: the capture
([play4fun-collector-respin-capture.md](../reference/play4fun-collector-respin-capture.md)) is the
partner's real respin wire for this game. It is enough to start mapping the facade for a collector
respin game. Jackpot coins, meters and other partner titles are still unseen.
