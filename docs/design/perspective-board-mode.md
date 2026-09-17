# Perspective board mode — a swap-in-place board on a converging grid

> Status: PROPOSED (2026-08-20), unbuilt. Driven by the "Knights of the Golden Label" concept art:
> an isometric tavern-yard board whose tiles converge toward the back, with upright characters
> standing on them. Owner decisions (2026-08-20) are folded in below: **the board does not roll**
> (symbols swap in place), **the win dim stays a per-symbol grey** (no cell geometry involved), and
> when the mode is on **the reel-shaped behaviours stand down** rather than being ported to a
> trapezoid. Off by default ⇒ byte-parity, the same discipline as
> [reel anticipation](reel-anticipation.md) and [stacked pictures](stacked-picture-mode.md).

## The ask

Lay the board out in **perspective** instead of as a flat rectangle: cells converge toward a
vanishing point, rows further back sit closer together and draw smaller. Symbols are ordinary art
drawn in perspective by the artist (upright characters, feet on a tile) — the engine does not skew
or project them, it only decides **where each seat is and how big it is**.

Because the grid reads as ground rather than as reel strips, the board **must not roll**. A round
replaces symbols in place: the outgoing ones play out and the incoming ones fall in from above.

## The mechanic (owner-confirmed)

- **No spin.** In perspective mode the reel path is not used. The opening board of a round drops in;
  a win explodes its cells and the survivors slide down while replacements fall in — i.e. the
  cascade that already shipped.
- **Win dim = per-symbol grey/opacity.** The paying cells stay bright, the rest darken. This is
  already how it works: `SYMBOL_DIM_TINT` (`0x666666`) is passed as `SymbolWrap`'s `tint` and
  cascades to the sprite/spine/flipbook through Pixi v8 `Container.tint`
  (`apps/lines/src/components/ReelSymbol.svelte`). It reads a per-cell set, touches **no geometry**,
  and therefore needs no perspective work at all. The rectangular, geometry-matched dim is the
  _anticipation_ grey-out, which is a different feature and stands down with the roll.
- **The mode swaps defaults, it does not delete paths.** `apps/lines` is the shared runtime bundle
  for every online game, so the reel path stays fully intact — lines and book-of still roll. Turning
  perspective on changes which behaviours are wired, not which code ships.
- **Two swap styles, and a clear step.** `dropIn` is the original: the whole board falls at once.
  `columnCascade` (#425) drains the standing board column by column, left to right, refilling each
  column as it empties, with `columnStaggerMs` as the single knob covering both readings of "left to
  right" (short ⇒ a wave, longer than a column ⇒ strictly sequential, `0` ⇒ all at once). `clearBoard`
  makes the outgoing symbols play their authored `explosion` state and leave, rather than simply
  being replaced: the whole board at once under `dropIn`, and per column — in place of that column's
  DRAIN — under `columnCascade`.

## What already exists (and why this is small)

1. **The cascade.** #375 landed `tumbleBoard` in the shared runtime as an **overlay** that mounts for
   the duration of a cascade and unmounts again — `boardHide → tumbleBoardShow → init → explode →
removeExploded → slideDown → boardSettle → tumbleBoardHide → boardShow`
   (`apps/lines/src/game/bookEventHandlerMap.ts`, `stateTumble.svelte.ts`, `TumbleBoard.svelte`).
   Seats come from the shared `getSymbolY`, not a fixed `SYMBOL_SIZE` step, precisely so a cascade
   drops symbols onto the same seat a settled board would give them.
2. **`explosion` is an authorable symbol state.** It has been in `SYMBOL_STATES` all along, so the
   "symbol pops and is replaced" animation is authored per symbol in `/symbols`. The mechanic needs
   no symbol tooling of its own.
3. **One lattice, one definition.** `getSymbolX(reel)` / `getSymbolY(row)` / `getSymbolLead()` in
   `packages/engine-game/src/game/gameState.svelte.ts` are read by _everything_ — reel symbols,
   tumble symbols, win lines, book VFX, the multiplier board, anticipation — and mirrored for the
   editor by `reelGridGeometry()` in
   `apps/launcher-api/src/routes/(app)/editor/editorCanvas.helpers.ts`. `BoardMask` and `SymbolWrap`
   already derive their window from that geometry rather than from constants. **There are two
   expressions to make perspective-aware and one mirror to match.**
4. **The art pipeline is untouched.** Perspective symbols are ordinary sprites/spines. Atlas Maker,
   Sheet Maker, `/symbols`, Rigger, FX and the whole export → `deploy/` → bake → pull → register
   chain are indifferent to where a seat sits. The ground plane is a scene image in the editor.

**No new tool is needed.** The Scene Editor's existing `reelGrid` node grows a section.

## What actually changes — the three breaks in the lattice

Today the board is a **separable, uniform** lattice: `x = f(reel)`, `y = g(row)`, one cell size, one
board scale. Perspective breaks exactly three of those assumptions:

| Assumption today              | Under perspective                                                 |
| ----------------------------- | ----------------------------------------------------------------- |
| `x` depends only on the reel  | `x` depends on the **row** too — columns converge toward the back |
| every row has the same pitch  | the pitch **compresses** with depth                               |
| one scale for the whole board | each row has **its own scale**                                    |

Everything else — non-square cells, gaps, reel/row lead, per-cell seat alignment, board nudge,
per-ratio overrides — survives untouched, because the formulation below _contracts the existing
expression_ rather than replacing it.

## The model

Two shape knobs. Let `t = rows > 1 ? row / (rows − 1) : 0` — `t = 0` is the **back** row (board-space
row 0, visually furthest), `t = 1` is the **front** row.

```
scale(row)   = farScale + (1 − farScale) · t
x(reel,row)  = vanishX + (getSymbolX(reel) − vanishX) · scale(row)
y(row)       = Σ_{k<row} rowPitchLocal · scale(k)  +  rowPitchLocal · scale(row) · getSymbolLead()
```

- **`farScale`** ∈ (0, 1] — the back row's size relative to the front row. `1` = flat = off.
- **`vanishX`** — the board-local x the columns converge toward. Defaults to the lattice centre;
  authorable so the vanishing point can sit off-centre to match painted ground art.

Three properties make this the right formulation:

- **The row pitch is not a separate knob.** A row's pitch is the base pitch times _that row's_
  scale, so the vertical compression is automatically consistent with the size shrink. One knob
  drives both, and they cannot drift apart.
- **Every existing knob keeps working.** `getSymbolX(reel)` is reused verbatim and merely contracted
  toward the vanishing point, so reel lead, gaps, non-square cells and seat alignment all continue to
  mean what they mean today — and they shrink with their row, which is what perspective requires.
- **Parity falls out.** `farScale = 1` ⇒ `scale ≡ 1` ⇒ `x = getSymbolX(reel)` and
  `y = rowPitchLocal · (row + lead)` — byte-identical to today's expressions. The off state is not a
  special case, it is the same algebra.

**Symbol anchoring needs no new knob.** Characters stand _on_ a tile, which is `symbolAlignY = 1`
(bottom-aligned within the cell) — already authorable, and already scaled per row because the
alignment term rides inside the contracted expression.

## Schema

A `perspective` block on `ReelGridNode` (`packages/engine-layout/src/lib/types.ts`), read by
`resolveReelGridFromNode` (`reelGrid.ts`) exactly like `spin` and `anticipation`:

```ts
perspective?: {
	/** Back row's scale relative to the front row. Absent / 1 ⇒ flat board (parity). */
	farScale?: number;
	/** Board-local x the columns converge toward. Absent ⇒ the lattice centre. */
	vanishX?: number;
};
```

**SHAPE ONLY — the behaviour lives in the game config.** `swapInPlace` was originally specified
here (and shipped here, alongside `swapStyle` / `columnStaggerMs` in #425), and that was the wrong
home. A `reelGrid` node is authored **per `layoutType`**, so the schema allowed a board that rolled
in portrait and swapped in landscape, or that swept at two different speeds depending on the phone —
not a configuration anyone would author on purpose, and not a bug anyone would think to look for.
Whether and how a round swaps is **one fact about the game**, so it moved to the Invisible Game
Config's `reelBehaviour` block (`packages/game-config/src/reelBehaviour.ts`), authored in `/config`
→ **Reel behaviour**:

```ts
reelBehaviour?: {
	/** Replace symbols in place instead of rolling the reels. Absent ⇒ false. */
	swapInPlace?: boolean;
	/** How a swap presents. Absent ⇒ 'dropIn' (the shipped whole-board fall). */
	swapStyle?: 'dropIn' | 'columnCascade';
	/** Ms between one column starting its swap and the next. Absent ⇒ the presentation's 140. */
	columnStaggerMs?: number;
	/** The outgoing symbols play their `explosion` state and leave first. Absent ⇒ false. */
	clearBoard?: boolean;
};
```

`resolveReelBehaviour` owns every default AND `clearBoard`'s one precondition — it needs the mode,
because a rolling round replaces nothing, it re-spins. One answer, so the engine and the authoring
tool cannot disagree about whether a knob is live.

`clearBoard` is deliberately NOT gated on the style. The first cut of it was, on the grounds that a
`columnCascade` "already empties each column by draining it" — which was wrong, and the owner said
so on first use. A drain and a clear are two different PICTURES of the same beat: one slides the
column out of the window, the other pops it in place. So under a cascade the clear REPLACES the
drain, per column, and choosing between them is exactly what this block exists for. The gate had
quietly removed a real choice.
The engine reads the block through `deps.reelBehaviour` on `createGameState`, the same seam the
board grid already arrives on.

The knobs remain **independent of `farScale`** — that was always the point ("a stylised game may
want a converging grid that still rolls, or a flat board that swaps") and the move does not change
it; `boardSwapsInPlace` is still deliberately not derived from `boardPerspective()`.

`swapInPlace` is kept separate from `farScale` on purpose: a stylised game may want a converging grid
that still rolls, or a flat board that swaps. They are independent decisions and the schema should
not force them together — which is also why they ended up in two different docs entirely, one per
ratio and one per game.

**Open decision:** whether `perspective` needs per-`layoutType` overrides. `resolveTransform` already
resolves position/scale per ratio; if a portrait layout wants a shallower perspective than landscape,
the block has to travel the same override path. Cheap to add, but only if it is actually wanted.

## The engine change

1. **`getSymbolSeat(reel, row) → {x, y, scale}`** added to `gameState.svelte.ts` beside the existing
   getters, implementing the model above. `getSymbolX`/`getSymbolY` stay as the flat expressions the
   seat function composes, so nothing that legitimately wants a column x (win-line grouping) breaks.
2. **Call sites migrate** to the seat function — `ReelSymbol.svelte`, `TumbleSymbol.svelte`,
   `TumbleBoard.svelte`, `MultiplierBoard.svelte`, `BookVfx.svelte`, `WinLine.svelte`,
   `flowEffects.ts`, `anticipationPresentation.ts`. Mechanical: each already asks for a seat, it just
   asks with one argument today.
3. **`SymbolWrap` gains `scale`**, applied to the container it already renders. Spine symbols
   contain-fit to `SYMBOL_SIZE × SYMBOL_SPINE_FILL` _inside_ that container, so the row scale
   multiplies cleanly — verify there is no double-application.
4. **`BoardMask` height becomes `Σ rowPitchLocal · scale(k)`**. It stays a **rectangle**: in a
   symmetric one-point projection the far edge is a straight horizontal line, and the mask already
   over-extends horizontally by `SYMBOL_SIZE` each side, so the widest (front) row is never clipped.
   No polygon mask is required.
5. **Draw order becomes back-to-front.** `Board.svelte` iterates column-major today; under perspective
   a front-row character must paint over the tile behind it. Prefer restructuring the iteration to
   row-major (deterministic, no per-frame sort) over `zIndex` + `sortChildren()`. This only matters
   once art overhangs its cell — which the concept requires, since a standing knight is taller than
   his tile. `TumbleBoardBase` needs the same treatment.

## The mode switch

When `swapInPlace` is on, `apps/lines` wires a different set of defaults. Nothing is deleted.

- **`reveal` does not spin.** Instead of `enhancedBoard.spin(…)`, the opening board drops in through
  the tumble overlay — the existing sequence minus the explode step (`tumbleBoardShow` →
  `tumbleBoardInit` with the full new board as the adding layer → `slideDown` → settle → hide). Same
  components, same cues, no new presentation code.
- **Three swap STYLES**, each an arm of its own in `presentReveal` rather than one parameterised
  path, because `apps/lines` is the shared `_runtime/lines` bundle and the shipped path must stay
  the shipped path:

  - `dropIn` — the whole board falls at once (the sequence above; what an absent `swapStyle` means).
  - `columnCascade` — the resting board drains column by column, left to right, each column
    refilling as it empties.
  - `emerge` — **nothing travels.** Each symbol is placed on its own seat at `duration: 0` and plays
    its authored `intro` state there, so the arrival ANIMATION is the whole presentation. This is
    the only style reachable for "the symbols rise out of the water", and it is not reachable by
    shortening a fall: a fall that lands in 1 ms is still a fall, and its `land` beat still fires
    _after_ the movement rather than instead of it. `columnStaggerMs` sweeps it, defaulting to `0`
    (the un-swept surfacing) where the cascade defaults to 140 ms.

    It governs the CASCADE's refill as well as the reveal — a game that surfaces on the spin and
    drops on a win has exactly the two behaviours the style exists to remove. Only the refills,
    though: `combineTumbleReel` stacks them ABOVE the survivors, which is the engine's gravity model
    and the board the SERVER scored the next step against, so a symbol that did not win still
    changes seat and must be seen to travel there. It slides and plays `land` — an emerge is about
    how a symbol ARRIVES, and a survivor is not arriving.

    Two rules the first cut of that got wrong, both reported from a live game. The survivors must
    VACATE before anything is placed — the refills stack directly above them, so the topmost
    survivor's old seat IS the bottom refill's new one, and placing instantly drops the new symbol
    on top of one that has not left yet. And the long `INTRO_BEAT_CAP_MS` must be spent only on art
    someone AUTHORED: an inherited `intro` reports nothing, so an un-authored board paid the whole
    cap on every arrival (2650 ms a cascade step against the shipped slide's 1500).

    The seam itself — pop out, then intro in, at the same seat — is a hard cut by construction, and
    an authored style will usually want something to cover it. That is the **Transition** (Invisible
    Symbols → Transition, added 2026-09-03): one project-global spine / flipbook / FX the cascade
    overlay mounts at every exploding seat `delayMs` after `clearReel` fires, drawn above the
    symbols and torn down on its own completion. It is fire-and-forget on purpose — it never joins the
    beat, so the intro starts exactly when it does without it and a slow effect can cost the round
    nothing — and it is gated on this style, since a sliding refill has no intro to bridge. It ships as
    a symbols-doc global (`bundle.symbols.transition`), so nothing new travels the layout doc.

- **`intro` is a symbol state, not a presentation flag.** It joins `SYMBOL_STATES` in
  `engine-layout`, gets its own `/symbols` column (gated on the project actually emerging, the way
  `clearReel` is gated on cascading), and inherits `land` when unauthored — so switching the
  style on before any art is bound gives a board that appears and plays its ordinary landing.
- **Stood down with the roll:** reel anticipation (a spin-slowing tease by definition, and the owner
  of the only geometry-bound dim), the anticipation camera, sequential reel stop, and stacked-picture
  mode (lines-only, and it scans a scrolling strip that no longer exists).
- **Unaffected:** the win dim, the cascade, multiplier-collect, win lines (they read seats, so they
  follow the trapezoid for free — though a cluster/scatter game may not draw them at all), the flow
  interpreter, the HUD, and every authored screen.

## The tiles — a recommendation

**Do not let the ground art carry a baked tile grid.** If the tiles are painted into the background
image, the lattice has to be hand-matched to pixels, and every per-ratio override risks drifting out
of alignment with them.

Ask for the ground **without** tiles and draw the tile quads from the same lattice that seats the
symbols: an optional art key on the `reelGrid` node, stamped once per cell at the seat and scaled by
the row. They can then never desync, they re-fit per aspect ratio for free, and per-tile highlight or
explode effects on a win become available. This is a small addition and is listed as its own phase.

## Build plan

0. **Seat-function refactor — no behaviour change.** Add `getSymbolSeat`, migrate the call sites, ship
   with no schema. Verify with an offline fixture asserting seat equality against the current
   expressions across a matrix of grids (square, non-square, gapped, nudged, off-centre lead) — the
   validate-the-contract-offline discipline, not live whack-a-mole.
1. **Schema + render.** The `perspective` block, `SymbolWrap` scale, mask height, back-to-front draw
   order. Still inert until authored.
2. **The mode switch.** `swapInPlace`: the drop-in reveal, and the reel behaviours stood down.
3. **Editor.** Mirror the model in `reelGridGeometry()`, draw trapezoid cells and per-row-scaled seats
   on the 2D canvas, apply per-seat scale in `EditorSpineLayer`, and add a "Perspective" section to
   `EditorProperties`. The mirror is load-bearing: a sprite symbol and a spine symbol must land on the
   same seat in the editor as in the game.
4. **Tiles from the lattice** (optional) + per-tile win highlight.
5. **Ship.** Nothing new to bake — this is `reelGrid` node data, which already travels the layout doc.
   Runtime release + reconcile to reach online games; the standalone bundles need a submodule bump.
6. **The `emerge` style + the `intro` symbol state** (added 2026-08-27, after 0–5 shipped). Nothing
   new to bake here either: the style is a `reelBehaviour` field and `intro` is an ordinary member of
   the symbol doc, so both ride chains that already exist (`z.enum(SYMBOL_STATES)` in
   `symbolsStorage`, verbatim pass-through in `symbolExport`).

## Risks and open questions

- **Overhang vs the mask.** A tall back-row character pokes above the board window and the mask that
  hides falling symbols will clip its head. Preferred answer: let the **background art occlude** the
  fall-in (the tavern, the horizon) instead of relying on a hard top edge. The alternative — keeping
  back-row art inside its cell — costs the look the concept is buying.
- **Per-ratio perspective** (see the schema section) — decide before Phase 1 rather than retrofitting.
- **Win lines across a trapezoid** are geometrically free but have never been looked at; they may need
  a thickness that scales with the row.
- **Board-level filters.** `filterArea` is container-local and has bitten us before; any full-board
  filter under a non-rectangular board wants a live check.
- **Symbol authoring convention.** `/symbols` previews a square cell. Authors should design
  feet-at-the-bottom art and set `symbolAlignY = 1`; the tool itself needs no change, but the guide
  does.

## Explicitly out of scope

- **An `intro` on the ROLLING path.** The state is scoped to the emerge arrival. A rolling reel
  already has `land` for "the symbol arrived", and giving it a second arrival beat would mean every
  game answering which of the two a reel stop fires.
- **Perspective spinning reels.** `createReelForSpinning` assumes a constant pitch and a wrapping
  strip; making a rolling symbol rescale as it travels is the expensive half of this feature and the
  design removes the need for it. If a future game wants both, it is a separate plan.
- **True 3D.** No projection matrices, no camera. This is a 2D lattice with a depth-dependent scale.
- **Skewing or rotating symbol art.** The perspective lives in the artwork.
