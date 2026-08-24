# Stepped grids — a board whose columns are different heights

> Status: **BUILT** (2026-08-24), engine-verified live. Phases 1–3 landed on `engine/stepped-grid`.
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
box — so a 3-row column would roll visibly through the empty space its taller neighbours occupy. A
stepped board wraps each column in its own container carrying its own clip window (`ReelColumn`),
taken from `boardWindowForReel`. Horizontally it is `BoardMask`'s rectangle **verbatim**,
`SYMBOL_SIZE` of slack included, so a spine that overhangs its cell sideways is clipped exactly
where it is today; only the vertical edges differ per column. The animate layer stays unmasked, as
it is today — a winning symbol moves there precisely so it can draw outside the window.

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

### Not combined with perspective

A stepped board paints **column-major** (each column is its own container). Perspective paints
**row-major**, so a front-row character covers the row behind it. The orderings are mutually
exclusive; perspective wins the tie as the shipped mode, and the board draws as a rectangle.

The **config validator cannot see this** — perspective is authored on the `reelGrid` **node** in the
Scene Editor layout, not in the config doc. A check there would silently never fire, so the warning
lives in `reelGridWarnings`, the one surface where both facts are visible at once.

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
| `scripts/verify-symbol-seat.mjs` (274,644)                       | The seat contract, now including a stepped section across four alignments — and that the rolling y and the resting seat agree.                                                                                                                                         |

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

## Known gaps

- **Perspective + stepped** draws as a rectangle (above). Warned, not supported.
- The **`ways` reach** policy already counts per-column rows off the dealt board, so it is correct by
  construction — but it has not been exercised against a stepped deal.
- **Nothing stepped has been driven through a full round in a browser.** The preview pane will not
  composite, which also throttles the animation clock, so a round never settles and a second spin
  never arms. The static board was verified live off the Pixi scene graph; the cascade is covered by
  `cascadeBoard.fixture.ts` plus source-level assertions that the per-column window is actually wired
  into both symbol renderers (`verify-stepped-grid.mjs` §6) — the half no data-level test can see.
