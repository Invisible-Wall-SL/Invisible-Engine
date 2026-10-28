# Expanding stacks and the spreading symbol (Lines) — two optional base-game features

> Status: PLAN (2026-10-28). Owner agent: `lines-games`. Reference game: Slotmotion's *Fairy's
> Charm* (owner's ask, 2026-10-28). Both features are **optional Game Config blocks**: a config
> without them is dealt, translated and drawn byte for byte as before.

## The ask

The owner wants to make games like *Fairy's Charm*, a lines game with two base-game features we do
not have:

1. **Expanding stacks.** A tall (stacked) picture lands partly on a reel. *Only if it is part of at
   least one win* does it expand to fill its reel. Then every win is counted again on the expanded
   board.
2. **The spreading symbol** (the game's clover). It only lands on the centre row and then copies
   itself onto the cells next to it.

The game's bonus could not be triggered (it has no buy button), so it is out of scope until someone
sees it. Our existing free spins and buy feature still apply.

The game's public rules could not be found and its site is not reachable from the build container,
so the rules below come from the owner's description. Where the description leaves a choice open,
it is a **setting** with the reading we think is most likely as its default (§4).

## 1. Config

Two new optional blocks on `GameConfigDoc`, both **lines win model only** (validator error
elsewhere). A block's presence turns its feature on.

```ts
/** A stacked symbol that, when on a win, grows to fill its reel. */
expandingStacks?: {
	symbols: string[];        // which symbols expand; each must pay on a line and not be a scatter
	minRun?: number;          // shortest landed run that may expand (default 1)
	repeat?: boolean;         // after an expansion, may a newly winning stack expand too (default true)
};

/** A symbol that lands only on some cells and copies itself onto its neighbours. */
spreadingSymbol?: {
	symbol: string;           // the clover; usually also wild (its `special_properties` say so)
	rows?: number[];          // rows it may land on (default: the centre row of each reel)
	reels?: number[];         // reels it may land on (default: every reel)
	spread?: 'orthogonal' | 'vertical' | 'horizontal' | 'all8';  // default 'orthogonal'
};
```

Resolvers and validators live in `packages/game-config/src/expandingStacks.ts` and
`spreadingSymbol.ts`, mirroring `expandingSymbol.ts` (`normalize…`, `resolve…`, `validate…`), wired
into `normalize.ts` and `validate.ts`. Validator rules: every named symbol exists, is in play and
pays on a line; a spreading symbol is not a scatter or a Hold and Win symbol; rows and reels are on
the grid; not in a cascade game (the spread and the expansion are one-shot, before wins).

## 2. The round, in order (server side; the client presents it)

1. **Land** the board. A spreading symbol that the strips would put outside its rows or reels is
   dealt as the cell's ordinary next draw instead (the mock's rule; a partner RGS uses its own math).
2. **Spread.** Each spreading symbol copies itself onto its neighbour cells (`spread` pattern). It
   overwrites ordinary paying symbols only, never a scatter, a Hold and Win symbol or another
   spreading symbol. A copy does not spread again.
3. **Count wins** on the spread board.
4. **Expand.** For each reel holding a run (≥ `minRun`) of an `expandingStacks` symbol where at
   least one winning line passes through a cell of that run, the whole reel becomes that symbol.
   A reel already full does not "expand". With `repeat`, count again and expand any newly winning
   stack, until nothing changes (each pass only adds reels, so this ends within `numReels` passes).
5. **Count wins again** on the final board. **Only the final count pays.** The step 3 count only
   decides which stacks expand.

Free spins use the same rules on each free spin.

## 3. Wire and book events

New book events in `apps/lines/src/game/typesBookEvent.ts`, emitted between `reveal` and `winInfo`:

- `spreadSymbol { symbol, from: {reel,row}[], to: {reel,row}[] }`: one event for all spreads.
- `expandStacks { reels: { reel, symbol }[] }`: one event per expansion pass.

The board in `reveal` is the **landed** board. The two events turn it into the final board, and
`winInfo` carries the final wins. The lines mock (`scripts/mock-rgs-server.mjs`) emits them on our own
wire. The facade (`packages/rgs-translator-eagaming/src/engineFacade.ts`) passes them through and
also updates its board, so the win-line positions are read off the final board. Both run off
`stateGame.board`, so a resume replays them.

## 4. Settings, and why each default

| Open point | Setting | Default | Why |
|---|---|---|---|
| Which "near cells" the clover fills | `spread` | `orthogonal` (up, down, left, right) | "Near cells" to a centre-row symbol reads as the plus shape. `vertical` fills its reel. |
| Must a run be partial to expand? | — | A full reel is already full | Nothing to show. |
| Does a single visible cell of a stack expand? | `minRun` | 1 | A cut-off stack at the board edge is still a stack. |
| Can one expansion set off another? | `repeat` | true | "Then calculate all the other matches once expanded." |
| Is the clover wild? | the symbol's own `special_properties` | — | The dictionary already says it. |

## 5. Presentation

- **Spread:** each target cell plays the existing per-cell morph used by `expandBookColumns` (the
  `explosion` transit, capped at `TRANSIT_BEAT_CAP_MS`) into the spreading symbol, from its source
  cell outwards.
- **Expand:** with stacked pictures on, the run's `StackedPicture` grows from its visible N cells to
  the full reel (and its winning art then plays on the final win). Without stacked art, the column
  morphs cell by cell, like the Book-of column morph.
- Both events go in the lines Flow vocabulary, so a Flow can own them like any other event. Coded
  handlers in `bookEventHandlerMap.ts` are the default.

## 6. Tools

- `/config`: a section for each block, on lines games only.
- Game Maker: no new template. A *Fairy's Charm*-like game is a lines game with both blocks set.

## 7. Gates

- Fixtures for normalize, resolve and validate of both blocks.
- A mock fixture: byte-identical deal without the blocks; the spread pattern and row rule; an
  expansion only on a win; the final count is what pays; `repeat` ends.
- `check:rgs`: the facade's money and win lines agree with the mock on spread and expanded boards.
- `check:all`, `check:svelte`, `check:undefined-names`; the current-games harness unchanged.
- A playtest note in `docs/playtest/lines.md` with a forced spread and expansion.

## Open

- The bonus round of the reference game (not seen yet).
- Whether the reference game's clover is wild, and its exact spread shape. Confirm from a video or a
  longer session, then set the defaults.
