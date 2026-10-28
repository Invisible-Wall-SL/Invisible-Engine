# Expanding wild and growing wild (Lines) — two optional features

> Status: PLAN (2026-10-28), rewritten after playing the reference game. Owner agent:
> `lines-games`. Reference game: Slotmotion's *Fairy's Charm* (owner's ask, 2026-10-28). Both
> features are **optional Game Config blocks**: a config without them is dealt, translated and
> drawn byte for byte as before.

## The ask

The owner wants to make games like *Fairy's Charm*: a lines game with a stacked picture that
expands and a clover that copies itself onto the cells next to it. The first draft of this plan was
written from the owner's description only. This version comes from playing the game.

## How the reference game was read

The game was played in a headless browser from the build container, in fun mode, on
2026-10-28: about 1,270 spins (1,178 base, 90 free), several free-spin rounds, and screenshot
sequences of the fairy and the clover. Its client talks to `wss://service.slotmotion.com` over
socket.io. The wire is very close to our Play4Fun one:

- the request is `[{action, context}]` (`config`, `bet [lines, betPerLine]`, `play`, `resume`);
- the answer is an `events` list: `bet`, `gameStart`, `spinStart`, `playedSpin`, `spinWin`,
  `gameEnd`, `gameRoundOver`, `spinTrigger`, `enterBonus`, `playedBonusSpin`, `bonusWin`, …

So the game's own events show its rules directly, without guessing from the animation.

## What the game does (observed)

**Board.** 5 reels × 4 rows, 50 fixed lines, left to right. 14 symbols: the leprechaun pays from 2;
the rest pay from 3. Base spins draw one of 5 weighted reel sets; free spins use their own set.

**1. The fairy: an expanding wild** (`FAIRY`, wild, reels 2–4)

- On the reel strip it is one cell: the visible slice of a tall picture.
- **When it lands, it expands over its whole reel before any win is counted.** The server sends
  `expandedWild {wild, reel, row}`, then one `symbolSetInMatrix {reel, row, symbol, oldSymbol}`
  per cell of that reel. The wins (`spinWin`) are those of the expanded board.
- It expanded **every time** it landed: 109 of 109 times in the first sample, and 97 of 320
  expansions paid nothing. The server does **not** require a win to expand.
- On screen, the landed cell shows the fairy's head. The rest of the reel clears and the full-height
  fairy picture grows into it. This is our stacked-picture art (`docs/design/stacked-picture-mode.md`)
  drawn at full height.
- Two or three fairies can land on one spin (20 base spins); each expands.

**2. The clover: a growing wild** (`CLOVER`, wild)

- In the base game it lands **only on the centre reel** (reel 3, any row: 140 of 140). In free spins
  it lands on reels 2–4.
- When it lands it copies itself **up, down, left and right** (a plus shape, clipped at the board
  edge). The server sends `growingWild {wild, reel, row}`, then one `symbolSetInMatrix` per new cell.
- It runs **after** the fairy's expansion and overwrites what is there, fairies included (34 times).
  It was never seen next to a scatter.
- In free spins, `unsetCloverSymbols [{reel,row}]` put the copied cells back after a clover that
  paid nothing (1 case). This looks like presentation only.

**Round end.** A winning spin leaves the round open (`gameEnd {win}` with no `gameRoundOver`). The
client sends `collect`, and the server answers `gameRoundOver {win}` and credits the balance. This
is our existing Play4Fun collect flow, so nothing new is needed. The first version of this plan read
a "respin on win" into the capture: the capture script sent `play` on the open round instead of
`collect`, and the server dealt another spin. The real client never does that, so there is no such
feature.

**Free spins.** 2 `SCAT` (they land on reels 1 and 5 only) pay 1× the stake and start 10 free
spins, using their own reel set (`spinTrigger`, `enterBonus`, `playedBonusSpin` … `playedBonusSpins`).
There is no buy button. `CLOVER_SCAT` (wild and scatter) is in the symbol list but did not appear in
90 free spins.

**What does not match the owner's description.** The owner saw the stack expand "only if there is at
least 1 match". The server expands the fairy on every landing. The likely reading is that a fairy
almost always makes a win once it covers its reel. A no-win expansion is being screenshotted to
check what is drawn (see Open).

## 1. Config

Two new optional blocks on `GameConfigDoc`, **lines win model only** (validator error
elsewhere). A block's presence turns its feature on.

```ts
/** Wilds that fill their reel when they land (the fairy). */
expandingWilds?: {
	symbols: string[];          // each must be a wild
	onlyOnWin?: boolean;        // default false (the reference game); true = expand only if the
	                            // landed cell is on a winning line (the owner's first reading)
};

/** A wild that copies itself onto its neighbours when it lands (the clover). */
growingWild?: {
	symbol: string;             // must be a wild
	reels?: number[];           // reels it may land on in the base game (0-based; default: centre)
	freeSpinReels?: number[];   // in free spins (default: same as reels)
	pattern?: 'plus' | 'vertical' | 'horizontal' | 'all8';   // default 'plus'
};
```

The resolvers and validators live in `packages/game-config/src/expandingWilds.ts` and
`growingWild.ts`. They mirror `expandingSymbol.ts` and are wired into
`normalize.ts` and `validate.ts`. The validator checks:
- every named symbol exists, is in play and is a wild;
- reels are on the grid;
- none of the blocks is used in a cascade game;
- `growingWild` never overwrites a scatter or a Hold and Win symbol.

Which reels a symbol lands on stays a fact of the **reel strips**, which a person sets. The
`reels` setting only lets the mock refuse a landing outside them.

## 2. The spin, in order (server side; the client presents it)

1. **Land** the board (`playedSpin` is the landed board).
2. **Expand** each expanding wild over its reel (with `onlyOnWin`, only those on a winning line of
   the landed board).
3. **Grow** each growing wild into its pattern. It overwrites anything except a scatter and a Hold
   and Win symbol, and a copy does not grow again.
4. **Count** the line and scatter wins on the final board. This is the only count that pays.

## 3. Wire and book events

We take the reference game's event names, because they are already in the shape of our wire:

- `expandedWild { wild, reel, row }` and `growingWild { wild, reel, row }`;
- `symbolSetInMatrix { reel, row, symbol, oldSymbol }`: one per changed cell, after its parent
  event.

`apps/lines/src/game/typesBookEvent.ts` gets one book event per feature:
- `expandWild { reel, symbol }`;
- `growWild { origin, cells }`.

The facade (`packages/rgs-translator-eagaming/src/engineFacade.ts`) builds them from the wire events
and applies the cell changes to its board, so the win-line positions are read off the final board.

The lines mock (`scripts/mock-rgs-server.mjs`) deals both features from the config blocks.

## 4. Presentation

- **Expand:** the landed cell keeps its stacked slice. The other cells of the reel clear, and the
  symbol's stacked picture grows to full height (`StackedPicture` from N to M cells). Without
  stacked art, the column morphs cell by cell like the Book-of column morph (capped at
  `TRANSIT_BEAT_CAP_MS`).
- **Grow:** the origin cell plays a burst, then each new cell morphs into the symbol, outwards.
- Both go in the lines Flow vocabulary, so a Flow can own them like any other event. Coded
  handlers in `bookEventHandlerMap.ts` are the default.

## 5. Tools

- `/config`: a section for each block, on lines games only.
- Game Maker: no new template. A *Fairy's Charm*-like game is a lines game with the two blocks
  set and the fairy authored as a stacked picture in `/symbols`.

## 6. Gates

- Fixtures for normalize, resolve and validate of the two blocks.
- A mock fixture with these cases:
  - without the blocks, the deal is byte-identical;
  - expansion order and `onlyOnWin`;
  - the plus pattern at the board edge;
  - the grow runs after the expansion.
- `check:rgs`:
  - the facade's money and win lines agree with the mock on expanded and grown boards.
- `check:all`, `check:svelte`, `check:undefined-names`; the current-games harness unchanged.
- A playtest note in `docs/playtest/lines.md` with a forced expansion and grow.

## Build order

One PR for both features, because they share the wire event (`symbolSetInMatrix`), the board
step between landing and counting, and the cell morph. Off by default.

## Open

- **A no-win expansion on screen.** Is it drawn as fully as a winning one? This decides whether
  `onlyOnWin` is ever needed.
- `CLOVER_SCAT` and how free spins retrigger: not seen yet.
- Whether to keep the captured wire log (it includes the reference game's reel strips and
  paytable) in the repo as a fixture or out of it. Math is a person's call: we copy mechanics, not
  numbers, unless the owner says otherwise.
