# Stacked-picture reel mode (Lines) — a Flow-activatable tall-symbol visual

> Status: IMPLEMENTED (engine + mock, 2026-08-05), visuals only. Off by default ⇒ byte-parity until
> the Flow `enableStackedPictures` effect turns it on. LINES-only (a Book-of never stacks pictures).
> Follow-ups: real tall-picture art + the `/symbols` `stacked` column authoring; wilds-substitute
> runs; win-math; a real RGS emitting stacked boards (only the local mock is wired).

## The ask

The classic KA-Gaming / Elf-Castle "tall symbol" look: when a reel lands a contiguous vertical run
of the same high symbol, draw **one tall picture** for that symbol over the run instead of N repeated
icons. A partial stack shows part of the picture, **top-aligned**; a full stack shows all of it. It
must be **authorable per symbol** (sprite / spine / flipbook), **Flow-activatable on demand**,
**scalable per game** (3×3 / 5×5 / 10×10), and target the **lines** template only.

## The mechanic (owner-confirmed)

- Each stackable symbol has a **natural picture height M in cells** (H1=2, H2=3, … **Wild=5**). The
  crop denominator is M — **not** the reel height.
- A run's **visible length N** (contiguous same-symbol cells on the settled reel) drives the crop:
  show the **top N/M** of the picture, **top-aligned to the run's top cell**. N=M ⇒ whole picture.
  A partial happens when the reel window clips the tall symbol (e.g. a 5-tall Wild showing 3 rows →
  top 3/5).
- **Data source = infer from the board.** The server keeps sending symbol names per cell; a stacked
  column is just a contiguous run. No book-event/protocol change.
- **Off by default**, flipped by a Flow effect. Eligible set defaults to the high pays + Wild;
  `highPayOnly` / an explicit `symbols` list / `minRun` are Flow-payload overrides.

## Template

Mirrors reel **anticipation** (`docs/design/reel-anticipation.md`): an off-by-default **mode** flag on
`stateGame`, flipped by an `enable*/disable*` Flow effect declared in the v2 vocab, presented by a
dedicated component. Simpler than anticipation — it reads the **settled** `stateGame.board`, so there
is **no** reveal-path `computeArming` hook.

## Where each piece lives

1. **Config** — `apps/lines/src/game/constants.ts#STACKED_PICTURE` (`heights` per symbol, default
   `symbols` set = high pays + Wild, `minRun`). No magic ids in components; per-game, later
   overridable from the Invisible Game Config.
2. **Mode state + scan** — `apps/lines/src/game/stateGame.svelte.ts`:
   - `stackedPictureMode` (+ `stackedPictureSymbols`/`highPayOnly`/`minRun` overrides), all off/default.
   - `stackedPictureRuns()` — a `$derived` scan producing one
     `StackedPictureRun {reel, name, topRow, visibleCells N, naturalCells M, x, topEdgeY}` per contiguous
     eligible run (length ≥ minRun; `M = max(N, heights[name] ?? N)`), positioned off the **live
     `symbolY()`** so the pictures move WITH the reel. Two scan windows (owner decision 2026-08-06 — tall
     symbols must roll, no post-settle "swap"):
     - **Rolling** reel (a long scrolling array, `length > numRows+2`): scan the WHOLE strip so every
       contiguous BLOCK renders as a tall picture that scrolls through the reel (capped at the symbol's
       natural height so blocks don't merge; the board-window mask clips it). This needs the strip to
       carry blocks — see `stackedScrollStrip` below.
     - **Settled** reel (the compact result set, `length ≤ numRows+2` — placed at the START of the bounce
       by `removePaddingAndBounceBack`): scan only the visible window (symbolIndex `1..numRows`) so a
       partial result crops to the top N/M and the picture **drops in with the bounce**, not after full
       stop.
   - `stackedScrollStrip(strips)` — seeds the reel's SCROLL filler (`paddingBoard`) with natural-height
     BLOCKS of each eligible symbol (H2 → 3 cells, W → 5, …) so the tall symbols exist to roll. Applied
     at both spin call sites (`flowEffects.ts` revealBoard + `bookEventHandlerMap.ts` reveal); a no-op
     when the mode is off (byte-parity). Cosmetic only — the RESULT board is separate.
   - `stackedCoverage()` — the `reel:row` set the runs cover, reusing `winDimCellKey`.
   - Empty when the mode is off ⇒ byte-parity.
3. **Flow effect + vocab** — `flowEffects.ts#enableStackedPictures`/`disableStackedPictures`
   (mirrors `enableAnticipationMode`); declared in `packages/engine-flow-v2/src/reference/bookOf.ts`
   (`symbols?: list<SymbolName>`, `highPayOnly?: bool`, `minRun?: int`).
4. **Authoring art (`stacked` state)** — a new **`stacked`** entry in `engine-layout`'s fixed
   `SYMBOL_STATES` (+ label; `LINES_SYMBOL_STATES` gates the `/symbols` column to lines games).
   `getSymbolInfo` falls the `stacked` state back to `static` when unauthored, so the mode renders the
   icon (stretched/cropped) before real tall art is bound in the Symbols State Machine.
5. **Presentation** — `apps/lines/src/components/StackedPicture.svelte` renders the run symbol's
   `stacked` binding (sprite/spine/flipbook) into a box `naturalCells` tall, **stretched to the box**
   (a tall picture authored at the box aspect is undistorted; a placeholder icon still fills+crops),
   then a `<Rectangle isMask>` reveals only the top `visibleCells`. `StackedPictures.svelte` maps the
   runs; mounted in `Board.svelte` inside the resting board container (shares `getSymbolX`/`symbolY`
   coordinates + the board window mask).
6. **Suppress doubles** — `ReelSymbol.svelte` skips a cell in `stackedCoverage()` so the single-cell
   icons under a run don't draw beneath the picture.

## Test data (mock)

`scripts/mock-rgs-server.mjs` gains an opt-in **stacked deal** (`STACKED=1` env / `createMockRgs({
stacked: true })`): most reels carry one contiguous high-symbol run (partial + full crops) and the
last reel is a full-height **WILD**. `WILD → 'W'` added to the lines facade
(`packages/rgs-translator-eagaming/src/gameMappings.ts`). Test data only — no protocol change; the
default deal is untouched.

## Verification

- Node fixture (`scratchpad/stacked-scan.fixture.mjs`) proves the run-scan + crop math: the owner's
  example (H4 run → top 3/4), Wild full 5/5 & clipped 3/5, min-run gate, distinct runs, high-pay-only
  gating, and 3×3 / 10×10 scaling — all pass.
- Live (apps/lines vs the `STACKED=1` mock, `PUBLIC_RGS_GAME=lines`): the Pixi scene shows the
  StackedPicture as a Container + stretched Sprite + rect mask; off ⇒ no stacked containers
  (byte-parity). Full-pixel screenshot of a partial crop pending a displayed Browser pane.
- **Real Flow-activation path** — `apps/lines/src/game/flowV2StackedDoc.ts` (`LINES_FLOW_V2_STACKED_DOC`)
  is the canonical book-events-only reference flow with an `enableStackedPictures` effect node
  PREPENDED to the `reveal` choreography. Loaded via **`?flowV2=stacked`** (or
  `window.__IE_FLOW_V2_STACKED__`); wired in `flowV2Runtime.svelte.ts#loadFlowV2Doc`. So the mode is
  turned on through the actual interpreter (authored node → `flowEffect('enableStackedPictures')`),
  not the default flag — verified: the doc loads + validates (0 errors), the handle `ownsEvent('reveal')`
  is true and `ownsEvent('load')` is false (coded screens), and the mode arms on the first spin's reveal.

## Non-goals / open

- Real tall-picture ART + the `/symbols` `stacked` authoring column (engine already reads it).
- Wild-substitution runs, non-contiguous same-symbol groups, win-math interplay — deferred (default:
  per-contiguous-run, Wild as its own picture).
- A real RGS emitting stacked boards (only the mock is wired).
