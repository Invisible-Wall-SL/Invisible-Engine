# Stacked-picture reel mode (Lines) — a Flow-activatable tall-symbol visual

> Status: IMPLEMENTED (engine + mock, 2026-08-05), visuals only. Off by default ⇒ byte-parity until
> the Flow `enableStackedPictures` effect turns it on. LINES-only (a Book-of never stacks pictures).
> Follow-ups: real tall-picture art; wilds-substitute runs; win-math; a real RGS emitting stacked
> boards (only the local mock is wired). Authoring is done — the `/symbols` "Stacked pictures"
> section owns which symbols stack, their height, and each one's resting + winning picture.

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
  show **N/M** of the picture. N=M ⇒ whole picture. A partial happens when the reel window clips the
  tall symbol (e.g. a 5-tall Wild showing 3 rows → 3/5).
- **Two INDEPENDENT authored toggles** govern what a partial run does (both baked into
  `bundle.symbols.stacked`, authored in `/symbols`; both default OFF ⇒ byte-parity):
  - **`fullHeightOnly`** (signed off, unchanged) — the tall picture shows ONLY on a full-height stack;
    any other partial run falls back to the normal single icons. This is about coincidental mid-board
    partials that would otherwise draw a cropped picture.
  - **`edgeCutoffs`** (owner ask 2026-08-07) — a partial run pinned to the board's TOP or BOTTOM **edge**
    renders a **cut-off** tall picture (the visible slice of a symbol scrolled partly off-screen),
    **regardless of `fullHeightOnly`**. Any run length qualifies, **even N=1**. *Which* slice shows
    depends on the edge:
    - **Top edge** → show the **bottom N/M**; the top M−N cells continue off-screen above ("as if the
      reel spun a few more cells you'd see the whole picture").
    - **Bottom edge** → show the **top N/M**; the bottom runs off-screen below.
  - Carried on the run as `hiddenAbove` (picture cells hidden above the visible run: `0` = top-align,
    `M−N` = bottom-align — set only for a top-edge cut-off). Edges are **chunk-relative** so the crop is
    identical while a result is parked mid-scroll and once settled (no roll↔settle snap). With
    `edgeCutoffs` OFF every run top-aligns, byte-identical to before the toggle existed.
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
       stop. **Runs are capped at the authored height** here too (2026-08-10, #283) — a landed run LONGER
       than M splits into consecutive M-tall pictures (any remainder < M crops / `fullHeightOnly`s like a
       partial). Before the cap an over-height run stretched into ONE oversized picture, so the same
       symbol rendered at different sizes depending on how many landed.
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
   coordinates + the board window mask). **A spine tall art is placed with `anchor={0}` + `centreBox`,
   not the sprite/flipbook `anchor={0.5}`**: a spine pivots in its LOCAL skeleton frame, so anchor 0.5
   pivots by `box/2` and lifts the art by `boxH²/(2·skeleton.height)` — clipped at the top, gapped at
   the bottom (see Known issues, #286). `<SpineProvider centreBox>` then drops the centre of the rig's
   AUTHORED box on the box centre, so a rig whose skeleton origin is not its bounds centre lands right
   too — the same convention `SymbolSpineMain` uses ([rigger status](../status/rigger.md), 2026-09-02).
6. **Two picture slots — resting + winning** (owner ask 2026-08-25). A stacked symbol authors `art`
   (the picture it normally shows — typically a still) and an optional `winArt` (what it becomes while
   that stack is part of a **paying line** — the spine/flipbook it pays out with). Both are ordinary
   `SymbolCell` bindings on the same stacked entry, so `winArt` ships through the identical
   export→bake→register chain as `art` and needs no new asset class.
   - **The win signal is the covered cells' own `symbolState`.** A covered cell mounts no `<Symbol>`,
     but the win presentation still walks it — `Board.svelte` sets `symbolState = 'win'` on every
     paying cell and reverts it to `postWinStatic` after the beat — so `StackedPicture` reads those
     cells directly. **Any** lit covered cell lights the whole picture (a line usually crosses one
     cell of the run; half a picture cannot pay). No new event, no new state field.
   - **`winHoldMs`** (authored beside the other stacked toggles) sizes the win beat a covered cell
     holds — the fixed wait that exists *because* there is no per-icon `oncomplete` to await. It is
     therefore also how long an authored `winArt` animation plays; absent ⇒ the coded
     `STACKED_WIN_HOLD_MS` (650), byte-identical to before.
   - Sparse throughout: no `winArt` ⇒ the run carries none ⇒ `StackedPicture` never even reads the
     board, and the render path is what it was before the slot existed.
7. **Suppress doubles** — `ReelSymbol.svelte` skips a cell in `stackedCoverage()` so the single-cell
   icons under a run don't draw beneath the picture.

## Test data (mock)

`scripts/mock-rgs-server.mjs` has an opt-in **stacked deal** (`STACKED=1` env / `createMockRgs({
stacked: true })`). Because the real math rarely lands a partial at a board edge — the whole reason the
crop exists — the deal is **engineered to showcase every crop each spin**: reel 0 = a partial **WILD**
pinned to the **TOP** edge (a bottom-of-picture cutoff), reel 1 = a partial WILD pinned to the
**BOTTOM** edge (a top-of-picture cutoff), the **last reel** = a full-height WILD (whole picture), and
middle reels carry an occasional random high-symbol run. WILD is the tallest picture, so a short WILD
run is a partial regardless of the project's authored heights ⇒ the cutoffs are **guaranteed, not
probabilistic**. `WILD → 'W'` in the lines facade (`packages/rgs-translator-eagaming/src/gameMappings.ts`).

**Auto-enabled per project (online).** The test server (`services/test-server`) passes `stacked: true`
to the mock via the manifest `grid.stacked`, which `publishGame` sets at Publish when the project's
symbols doc has `stackedPictures.enabled` (the SAME master toggle the bake reads). So any online lines
project that turns the mode ON gets stacked boards after a republish + `/refresh` — no env, no
per-project hardcode. Test data only — no protocol change; the default (mode-off) deal is untouched.

## Verification

- Node fixture (`scratchpad/stacked-winart.fixture.ts`, run with a `$env` stub) proves the two-slot
  data contract: `art` + `winArt` round-trip through the tool's client model AND the server schema,
  a blank win picture is stripped client-side (and rejected server-side rather than silently saved),
  clearing it leaves the resting picture intact, `winHoldMs` stays sparse, and an un-authored project
  still persists no `stackedPictures` key at all — all pass.
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

## Known issues

- **An over-height run stretched the picture — FIXED (2026-08-10, #283).** A landed run LONGER than the
  symbol's authored height was scanned uncapped, so `naturalCells` grew past the height and the art
  stretched: the same symbol rendered at a different size depending on how many landed. The scan caps
  EVERY run at the authored height, so an over-height column tiles consecutive M-tall pictures and any
  remainder shorter than M takes the ordinary partial path. A genuine partial (run < M) is untouched.
  Detail: [symbols status](../status/symbols.md).
- **A spine tall art rendered vertically offset — FIXED (2026-08-10, #286).** A stacked symbol authored
  as a SPINE rendered clipped at the top and gapped at the bottom instead of filling the run, because
  `StackedPicture` mounted it with the sprite branch's `anchor={0.5}` (see §5 for the geometry). Fixed
  by `anchor={0}` on the spine branch. **Generalised on 2026-09-02** by `<SpineProvider centreBox>`,
  which centres the rig's AUTHORED box instead of assuming the skeleton origin sits in it — this fix's
  original reasoning ("symbol rigs are origin-centred") held only for the rigs we ship from the Spine
  editor. The shared `SpineProvider` pivot was deliberately NOT rewritten: that would move every symbol
  in every game. Detail: [symbols status](../status/symbols.md) + [rigger status](../status/rigger.md).
- **Win presentation hung on a covered cell — FIXED (2026-08-10).** A paying line crossing a stacked
  run stalled: `ReelSymbol` mounts no `<Symbol>` for a cell in `stackedCoverage()`, so its
  `oncomplete` never fired, and `Board.svelte`'s `boardWithAnimateSymbols` awaited it forever. The
  round's per-win narration froze on the first such line (only a tap's `roundSkip` forced it on) and
  the resting win-cycle (no skip token) stuck on it permanently. Fix: a covered cell holds a fixed
  win beat (`STACKED_WIN_HOLD_MS`) instead of awaiting an animation that can't complete — its win
  visual is the tall picture, not a per-icon spine. Non-stacked games have an empty coverage set ⇒
  every cell awaits the spine exactly as before.
- **1-tile snap at the roll↔settle boundary.** The scrolling scan reads the whole reel array (so tall
  blocks can roll) while the settled scan reads only the visible window (`1..numRows`, excluding the top
  padding row). When the padding row above a result matches that result's symbol, the scrolling scan
  groups the run one cell higher, so the picture jumps a tile as the reel transitions rolling↔landing.
  Fix (deferred) = make the scan respect the reel's padding-row boundaries so both modes group the same
  run. Shipped with this known, transient glitch (owner OK'd 2026-08-06).

## Non-goals / open

- Real tall-picture ART + the `/symbols` `stacked` authoring column (engine already reads it).
- Wild-substitution runs, non-contiguous same-symbol groups, win-math interplay — deferred (default:
  per-contiguous-run, Wild as its own picture).
- A real RGS emitting stacked boards (only the mock is wired).
