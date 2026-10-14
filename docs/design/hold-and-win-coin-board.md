# Hold and Win — coin board as the base game (plan)

> Status: [docs/status/hold-and-win.md](../status/hold-and-win.md) (Phase 13) · Parent design:
> [hold-and-win.md](hold-and-win.md) · Asked for 2026-10-14 by the owner on `holdandwintestsolo`.

## Why this exists

Every Hold and Win game we ship today copies the three 3 Oaks references
([hold-and-win.md](hold-and-win.md) §1.1). The base game is a lines game, and 6+ coins switch to the
respin board as a bonus mode. Several things enforce that:

- the config validator refuses any base game that is not on the reels (`modes.ts`
  `validateGameModes`: "The base game plays on the reels");
- the mock deals line symbols and refuses a base game without paylines
  (`mock-holdandwin-engine.mjs` `createHoldAndWinEngine`);
- the runtime hides the respin board on every base reveal (`flowEffects.ts`).

The owner wants a game that is **only** the Hold and Win, with no line game:

1. Every spin deals coins and blanks onto the coin board.
2. If enough coins land **on paying lines**, the respins start: 3 respins, coins stick, and a new
   coin resets the counter.
3. The coins pay, the board clears, and the next bet starts again.
4. **Which lines pay is a choice**, shown with a colour overlay. It can be the middle line only, all
   lines, or anything in between.

## 1. Rules (owner answers, 2026-10-14)

| Question | Answer |
| --- | --- |
| How a spin plays | The coin board on every spin (option 1). |
| What "a line pays" means | **All three rules exist as options**, picked in Game Config (§1.2). |
| Who picks how many lines pay | **Optional in Game Config:** fixed by the designer, or chosen by the player per bet. |
| Coins off the paying lines | **Ignored entirely.** They never trigger, never stick, never reset the counter and never pay. |

### 1.1 Paying cells

A cell is **paying** when at least one active payline passes through it. Everything in this
variant reads that set of cells:

- **Dealing.** Only paying cells spin and deal coins. A non-paying cell is locked: it shows the
  blank under the inactive overlay and never deals. This is how "ignored entirely" reaches the
  screen. A coin the player can see always counts.
- **Trigger.** Coins (coin, jackpot and special roles) counted on paying cells reach `min`.
- **Stick and reset.** These apply to paying cells only, because nothing else lands.
- **Full board.** All paying cells are held. This is what pays GRAND under `fullBoardJackpot`.

With the middle line only on 5×3 there are 5 paying cells, so a trigger of 6 can never fire. The
trigger therefore has **a `min` per line choice** (§2). The validator refuses a `min` above that
choice's paying-cell count.

### 1.2 Pay rules (`payRule`)

When the feature ends, the held coins are paid by one of three rules. A jackpot coin pays its
prize under the same rule as a cash coin.

- **`coinsOnLines`** — the default and the classic rule. Every held coin pays its value once.
- **`lineFill`** — a paying line pays when its cells hold coins **from the left, `min` or more in a
  row** (`lineFill.min`, default 3). It pays the sum of the coins in that run. A coin that belongs
  to no run pays nothing. A coin in runs on two lines pays on both.
- **`perLine`** — every held coin pays its value **× the number of paying lines through its
  cell**. The middle-row coin under 5 lines pays more than a corner coin.

Under `coinsOnLines` with every line active, the game is exactly a classic Hold and Win on a coin
board. `lineFill` and `perLine` reward the coins that sit on lines.

### 1.3 Who picks the lines (`lines.selection`)

- **`fixed`** — the designer lists the active payline ids, for example `['1']` (the middle line)
  or all of them. The player never sees a line control.
- **`player`** — the player picks a line count from `choices` (for example `[1, 3, 5]`, default
  `default`). Lines switch on in the designer's `order` (for example middle, top, bottom, the two
  Vs). **The stake scales with lines:** total bet = lines × bet per line, as on a classic lines
  game. Coin values stay multiples of the total bet. The HUD gets a lines selector beside the
  bet, and changing it redraws the overlay.

### 1.4 The overlay

The board shows which lines pay, all the time, not only on a win:

- **paying cells** are drawn plain, with each active line marked in its payline colour (the
  existing `paylineColors`);
- **non-paying cells** sit under a colour overlay (`inactiveOverlay`, colour plus alpha; default
  dark at 0.6).

It is a Scene Editor part, **Line Overlay**, built on the Phase 12c pattern: coded by default,
skinnable, and driven by a `payingLines` value.

## 2. Config shape (`packages/game-config`)

The config gains one sparse top-level block, present only on this variant. Its absence leaves
every current game byte-identical.

```ts
coinBoard?: {
	lines:
		| { selection: 'fixed'; active: string[] } // payline ids
		| { selection: 'player'; choices: number[]; default: number; order: string[] };
	payRule: 'coinsOnLines' | 'lineFill' | 'perLine';
	lineFill?: { min: number }; // lineFill only; default 3
	/** Trigger min per line count (`fixed`: one entry, its active count). */
	triggerMin: Record<string, number>;
	inactiveOverlay?: { color: string; alpha: number };
};
```

- **The base mode:** with `coinBoard` present, `basegame` resolves to `board: 'respinBoard'`.
  `validateGameModes` allows that only when `coinBoard` is present. Without it, the lines error
  stands. The `holdAndWin` respin mode stays the bonus mode, and it plays on the same board without
  a screen switch.
- **No line symbols:** the paytable carries only the coin, jackpot, blank and special roles.
  `paylines` stay, because they define the lines.
- **Validation** (`validate.ts`): `active` and `order` name real paylines, and `choices` are
  1…lines. `triggerMin` has one entry per choice, each ≤ that choice's paying cells.
  `lineFill.min` must be ≤ the reel count.
- **New template:** `holdAndWin.coinBoard`, generated like the others by
  `generate-game-config-defaults.ts`. It is 5×3 with 5 lines, `coinsOnLines`, selection `fixed` on
  all 5 lines, and `triggerMin` 6.

## 3. Build plan (each a PR on its own branch; pipeline rules apply)

| # | Phase | What lands | Owner agent |
| --- | --- | --- | --- |
| 13a | Config + tools | The `coinBoard` schema, normalize and validate. The relaxed base-mode rule. The `holdAndWin.coinBoard` default. A **Coin board** section in `/config` (base game: Lines / Coin board, lines selection, pay rule, trigger per choice, overlay colour). In Game Maker, a **Base game: Lines game · Coin board only** choice on Hold and Win, plus the scaffold. | invisible-game-config, invisible-game-maker |
| 13b | Mock RGS | `dealBase` on the coin board, with only paying cells dealing. Line-masked trigger, stick and full board. The three pay rules in `finishFeature`. `bet[0]` as the line count under `player`, with the evaluated lines narrowed to the first N of `order`. The bet echo's `paylines` lists **only the active lines**, so the client learns them from the wire. Fixtures for each rule and selection. | engine-pixi-svelte |
| 13c | Runtime | The base game on the respin board: shown from boot and never hidden by a base reveal. Each base spin is a respin-board deal, and a trigger keeps the board and its held coins. Locked cells. A per-rule tally: `lineFill` runs light up their line, and `perLine` shows the ×N. The coded **Line Overlay**. | engine-pixi-svelte |
| 13d | Player lines | The HUD lines selector (only under `player`). `requestBet` sends the chosen count. The stake display and the overlay follow the choice. | engine-pixi-svelte |
| 13e | Authoring + docs | The starter flow and vocab for a coin-board base. The Scene Editor template (no reels screen, Line Overlay placed). The Symbols gating (no line symbols). Guides in `docs/tools/` (game-config, game-maker, symbols). A playtest playbook. `holdandwintestsolo` re-created or switched onto it. | invisible-flow, docs-keeper, game-playtester |

13a and 13b can run in parallel. 13c needs 13b's wire, and 13d needs 13c. Every phase proves that
no current game changes, because every new path is gated on `coinBoard`.

## 4. Open questions

- **The partner wire.** Production is already blocked on the partner's Hold and Win format (Phase
  10). This variant adds two asks: does their server support a coin-board base game, and does
  `bet[0]` carry a **line count** for it? The reference
  ([play4fun-protocol.md](../reference/play4fun-protocol.md)) says a line game sends the bet
  multiplier there. We build mock-first, as for the rest of Hold and Win.
- **Base-game specials** (Boost, Collector…). They fit the same paying-cell rule. They stay off in
  the template until someone asks.
