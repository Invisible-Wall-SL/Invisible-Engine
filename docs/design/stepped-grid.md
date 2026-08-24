# Stepped grids — a board whose columns are different heights

> Status: **SHIPPED** (2026-08-24) — merged as #445 (`553848a4`) and carried to the online
> games by the automatic runtime release, verified in the live bundle.
> Off by default in the only sense that matters: `stepped` is false for every board authored before
> this, and every consumer early-returns its existing rectangular path on that answer — the same
> discipline as [perspective board mode](perspective-board-mode.md) and
> [stacked pictures](stacked-picture-mode.md).

## The ask

Author a board like `3/4/5/4/3` — a diamond — or `2/3/4/5/6` — a ramp — instead of a rectangle.
Each reel shows its own number of cells.

## Why it needed building at all

`numRows` has been a **per-reel array** in `GameConfigDoc` since the schema was written, and its
doc comment has said "so a stepped grid is expressible" the whole time. But only the game's **math**
ever read it that way:

- `activeWaysCount()` — the ways count is the product of the per-reel rows.
- `validateGameConfigDoc` — a payline is bounds-checked against the row count of **its own reel**.
- `gameProfile`'s `boardText` — prints `5 reels · 3/4/5/4/3 rows`.

Every **renderer and dealer** collapsed it to `Math.max(...numRows)`. So a non-uniform config
**saved, validated, and shipped** while the board drew a full rectangle against it: the paytable
priced 720 ways over a board showing 5×5, and the RGS dealt five rows to a column with three. That
is the client board diverging from the scored board — the quietest and most expensive class of bug
this pipeline can produce ([the cascade case](../../CLAUDE.md) is its loud cousin) — and it was
reachable by typing a number into `/config`.

The feature is therefore mostly about **removing a disagreement**, not adding a capability.

## The model

`resolveGrid(doc)` in `packages/game-config/src/grid.ts` is the one resolver both halves read. Two
numbers describe a column:

- **`rowsForReel(reel)`** — how many cells it shows.
- **`rowOffsetForReel(reel)`** — where its window starts, in **rows from the top of the bounding
  box**. Fractional on purpose: a 4-row column centred in a 5-row box sits at `0.5`, and that
  half-cell stagger is what makes `3/4/5/4/3` read as a diamond rather than as two ragged edges.

`gridAlign` (`center` | `top` | `bottom`, default `center`) decides how the slack is spent. It is an
Invisible-Engine extension, stored **only** when it departs from the default **and** the grid is
actually stepped — so a math-export paste-in round-trips byte-for-byte, and a rectangular board
cannot carry a field that can never do anything.

`boardDimensions()` deliberately still reports the **bounding box**. The board's pixel footprint,
its layout anchor and its scene coordinates are all pinned to it, and a stepped board still occupies
that whole rectangle. What changed is that the rectangle stopped claiming every column fills it.

### `stepped` is the parity gate

It is the load-bearing field. Every consumer branches on it and early-returns its **existing** path
when false — not an equivalent path, the same one. `apps/lines` ships as the shared `_runtime/lines`
bundle to every online game, so "byte-identical" is the bar, and it is asserted rather than assumed
(see Verification).

## How it draws

Two things had to stop being board-wide.

**The mask.** `BoardMask` is one rectangle over the whole `BoardContainer`, sized to the bounding
box — so a 3-row column would roll visibly through the empty space its taller neighbours occupy.

A stepped board is clipped instead by **one compound mask**, whose geometry is the **union of the
per-column windows** (`boardMaskColumns`). The obvious alternative — a container per column, each
carrying its own rectangle — works, and was built first, but it forces the scene graph to be
**column-major**, which is the one thing perspective cannot live with (see below). A single mask
needs no grouping at all: the child list stays exactly as flat as it is today, so paint order is
untouched.

The columns **tile**, they do not overlap. Each runs from the midpoint between it and its left
neighbour to the midpoint on its right, with `BoardMask`'s existing `SYMBOL_SIZE` of slack added
only at the two **outer** edges. Overlapping them — giving every column the full board width, which
a per-column container can safely do — would let a tall neighbour's rectangle cover the notch beside
a short column, and a symbol scrolling through that notch would be drawn where the board does not
exist. Exact tiling is what makes the union mean _the visible board_.

The horizontal cost is that a symbol overhanging past the midpoint is clipped **where its neighbour
has no window** — i.e. only in the notches, which is where the board genuinely ends. Everywhere two
columns' windows overlap vertically, the neighbour's own polygon covers the overhang and it draws
exactly as it does today. The animate layer stays unmasked, as it is now — a winning symbol moves
there precisely so it can draw outside the window.

**The cull.** `SymbolWrap` culled against `boardWindowHeight()`. On a stepped board that is not
merely imprecise: a short column is pushed **down** into the box, so its padding row — the buffer
cell above the visible window — lands at a y that is still inside the board-wide window. Culled
against the board it would be **drawn**: a phantom symbol hanging above a short column on the
unmasked animate layer.

### The offset lives on one axis, applied twice

`ReelSymbol` picks its `y` between two sources every frame — the resting **seat** under perspective,
the **live reel y** otherwise. So the offset has to reach both, in the same units, or a stepped
column jumps the instant it settles:

- the reel gets it as part of its **`symbolLead`** (`buildBoard`), so it travels with the symbols
  while they roll rather than only describing where they come to rest;
- the seat gets it through **`rowSeatIndex`**, folded into the row index before the seat algebra.

### It composes with perspective

A stepped board and a [perspective board](perspective-board-mode.md) work together, and the compound
mask is the reason. They were mutually exclusive under the per-column-container design: perspective
paints **row-major** so a front-row character covers the row behind it, and grouping the children by
column forces **column-major**. With one mask there is no grouping, so both `BoardBase` branches are
untouched and either mode — or both — can be authored.

Under perspective each column's polygon is sampled at **every one of its row boundaries**, down one
edge and back up the other, rather than being a four-corner trapezoid. That is worth recording,
because the trapezoid looks obviously right and is not: it interpolates its edges linearly in **y**,
while the contraction is linear in the **row** and y is a quadratic sum of compressed row pitches.
The two disagree enough in mid-column that a cell's centre can land inside its **neighbour's**
polygon — the symbol would then be clipped by the wrong column's window. One segment per row bounds
that error by a single row's contraction, which no cell can cross. The fixture caught this directly;
it was not reasoned out in advance.

## How it is dealt

Drawing a diamond while the server deals a rectangle is the same divergence in a different place, so
the dealer chain carries the shape end to end:

```
/config doc → mockContract → test-server manifest → test-server → mock RGS
```

Each hop sends `rowsPerReel` **only when the columns differ**, so a rectangular project's manifest
entry and config event are byte-identical to before. The test-server validates it defensively like
everything else off the external manifest (must be `reels` long, positive, within the bounding box)
so a malformed entry cannot deal a column of `NaN` cells.

The mock **declares** what it dealt (`config.window.rowsPerReel`) and the facade **clamps per
column** against that declaration. Clamping to the bounding box is what would let a full-height
column survive into a short window. `padReel` needed nothing — it already adds ±1 to whatever length
it is handed, and `createReelForSpinning` already takes each reel's length from the array it is
given.

`ROWS=3,4,5,4,3` on the mock CLI deals a diamond without a published project.

### Paylines on a stepped board

A line can only name a row its reel actually has — `validateGameConfigDoc` has always enforced this
per reel. Two helpers had to learn the same rule:

- `standardPaylines` pulls a line onto the nearest row a short column owns, so a horizontal across a
  diamond **bends with the board's silhouette** instead of pointing off it.
- `coversAllRows` judges coverage **per column**. A board-wide test can never be satisfied by a
  stepped grid, so the server would have regenerated lines forever.

## Verification

| Fixture                                                          | What it holds                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/verify-stepped-grid.mjs` (240)                          | The resolver's placement under all three alignments; the deal is ragged end-to-end through a real bet; the server declares its shape; `clampBoardToGrid` (sliced from the real facade) cuts per column; and the per-column window is wired into both symbol renderers. |
| `packages/rgs-translator-eagaming/cascadeBoard.fixture.ts` (937) | A cascade's one invariant — the board the client shows is the board the server scored — over a rectangle, a ramp and a diamond.                                                                                                                                        |
| `packages/utils-slots/anticipationWaysReach.fixture.ts`          | Ways reach on a ragged board: the bounds converge on the real win, and padding a short column out to the bounding box provably changes it — so the per-column slice cannot regress silently.                                                                           |
| `scripts/verify-symbol-seat.mjs` (274,644)                       | The seat contract, now including a stepped section across four alignments; that the rolling y and the resting seat agree; and that the compound mask covers every cell exactly once, under three perspective settings.                                                 |

**The two load-bearing parity assertions:**

1. **The RNG stream is untouched.** The same seed dealt with `rows: 3` and with `rows: [3,3,3,3,3]`
   produces byte-identical responses. If the array path perturbed the stream by one draw, every
   existing game's deal would shift the day this shipped, with nothing to blame it on.
2. **The flat seat is the same call.** `verify-symbol-seat` still asserts, with `Object.is`, that a
   uniform board's seat is literally `getSymbolX(reel)` / `getSymbolY(row)` at scale 1.

One assertion is deliberately a **tolerance** rather than exact: the rolling y and the resting seat
associate their multiply and add differently and have never been bit-equal — a uniform board already
drifts ~2.8e-14 between them today. The failure it guards (an offset reaching one path only)
misplaces a column by at least half a row, fifteen orders of magnitude clear of that noise.

**Live** (`apps/lines` + mock, Pixi scene graph read directly — the browser pane would not
composite, so a screenshot would have proved less):

- `3/4/5/4/3` authored → five masked column containers holding **3/4/5/4/3** symbols at row offsets
  **1 / 0.5 / 0 / 0.5 / 1**, cells centred on the board's own centre. No padding row leaked.
- reverted to `5×3` → **one** mask, on the board container, all 15 symbol containers as its direct
  children at y 60/180/300. The flat structure is unchanged, not merely equivalent.

## The cascade

A cascade explodes the paying cells, drops the survivors and refills the gaps from above — and every
part of that is naturally per-column, which is why it needed less work than it first appeared.

It was initially flagged as a gap on the reasoning that the tumble overlay seats its falling
replacements against the board's row count. **That was wrong.** Every seat in the cascade already
goes through `getSymbolSeat(reelIndex, …)`; a drain drops each symbol by the **column's own** length
(`dropRows = draining.length`); the refills are stacked `addingReel.length` rows above **that
column's** window; `combineTumbleReel` is length-agnostic; and the mock's `applyExplosion` refills
exactly as many cells as it removed from each reel. The mechanic was per-column already.

What was **not** per-column was the same pair the reel board had to fix — the **clip** and the
**cull**:

- the resting cascade layer is clipped by the board-wide `BoardMask` rectangle, so a short column's
  replacements — stacked deliberately _above_ its window, waiting to fall — sit at a y that is still
  inside the bounding box and would simply be drawn, hanging above the column;
- its drained symbols slide out _below_ that window, likewise still inside the box, so they would
  fall a little way and then park there instead of leaving;
- `TumbleSymbol` handed `SymbolWrap` no `reelIndex`, so the unmasked animate layer culled board-wide.

`TumbleBoardBase` now wraps each column in the same `ReelColumn` the reel board uses, and
`TumbleSymbol` passes its column down. The columns were already the outer loop, so this is a wrapper
rather than a restructure — and grouping by **column** is safe where grouping by row is not: a symbol
never changes column during a cascade, so the object keying that keeps a falling symbol's `symbolY`
Tween alive across a mid-cascade filter is untouched.

## Ways, and the bug the gap note was hiding

`ways` is the win model a stepped grid moves most. A pay is the **product** of the per-reel matching
counts, divided by the **ways count** — itself the product of the per-reel **row** counts. So one
column measured at the wrong height moves every number in the round: `3×4×5×4×3` is 720 ways, and
counting all five columns as five gives 3125.

`createWaysReach` was already correct: it takes each column's height from the board it is handed
(`board[reel].length`), which is why the gap note said "correct by construction". What that note
missed is that **the board it was handed was wrong**.

`buildAnticipationArming` sliced the padded reveal to the **bounding box**:

```ts
const { y } = boardDimensions();
reel.slice(1, 1 + y); // y = max(numRows)
```

A reveal is padded one row top and bottom, so a 3-row column arrives as 5 cells and that slice keeps
its **bottom padding row** — four cells in a three-cell column. Nothing downstream can detect it: the
ways pay simply comes out at the wrong multiple, and for `lines` an off-screen symbol can complete a
run. It now slices by `grid.rowsForReel(reelIndex)`; on a uniform board that is the same number, so
the slice is unchanged.

The rest of the family was already safe, and worth recording as such: `bookEventHandlerMap` and
`flowEffects` walk the visible rows with a `row < symbols.length - 1` guard, which bounds them by the
column's own strip rather than by the board.

## Known gaps

- Nothing outstanding on the board itself. See the verification notes above for what is covered
  offline versus live.
- **Nothing stepped has been driven through a full round in a browser.** The preview pane will not
  composite, which also throttles the animation clock, so a round never settles and a second spin
  never arms. The static board was verified live off the Pixi scene graph; the cascade is covered by
  `cascadeBoard.fixture.ts` plus source-level assertions that the per-column window is actually wired
  into both symbol renderers (`verify-stepped-grid.mjs` §6) — the half no data-level test can see.
