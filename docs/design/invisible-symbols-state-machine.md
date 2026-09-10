# Invisible Symbols State Machine — author the symbol→state→asset map (design)

A tool that turns the in-game **Symbol Debug** grid into an editable surface: per symbol,
per animation state, rebind the cell to a sprite / sprite-sheet animation / spine that
already lives in R2 — and ship those bindings to the game through the standard deploy chain.

Owner-named **Invisible Symbols State Machine** (2026-06-12). Standalone tool page, like
Atlas / Spine / Font Maker.

> Build status: see [docs/status/symbols.md](../status/symbols.md); detailed done-log in [docs/history.md](../history.md).

## The thing we are making data-driven

Today every game hardcodes a `SYMBOL_INFO_MAP` — see
[`apps/lines/src/game/constants.ts`](../../apps/lines/src/game/constants.ts) — a grid of
**symbol × state → asset binding**:

```
SYMBOL_INFO_MAP['H1']['win'] = {
  type: 'spine', assetKey: 'H1', animationName: 'h1', sizeRatios: { width, height },
}
SYMBOL_INFO_MAP['H1']['static'] = { type: 'sprite', assetKey: 'h1.webp', sizeRatios }
```

Symbols: `H1…H5`, `L1…L5`, `W`, `S`. States: `static`, `spin`, `land`, `win`,
`postWinStatic`, `explosion`, `clearReel`
(`packages/engine-layout/src/lib/symbolStates.ts#SYMBOL_STATES`). Each cell is
either a **sprite** (`assetKey` = a sheet frame key, e.g. `h1.webp`) or a **spine**
(`assetKey` = a registered spine bundle + `animationName`).

The Symbol Debug overlay
([`SymbolDebugOverlay.svelte`](../../packages/components-pixi/src/components/SymbolDebugOverlay.svelte),
gated behind `localStorage.IE_DEBUG=1` + the `d` hotkey) already renders this exact grid
live. This tool is that grid, **editable**, with the result authored to R2 and shipped.

## v1 scope (owner decisions 2026-06-12)

- **Bindings only.** The tool authors the symbol→state→asset map. Payline geometry (which
  board positions form each winning line) stays code/math-defined — OUT of v1.
- **Standalone tool page** (`/symbols` in the launcher), not a panel inside the editor —
  but it REUSES the editor's R2 library picker, doc endpoints, deploy-token plumbing, and
  the `bake-editor-doc.mjs` / `pull-project-assets.mjs` transport.
- **Spine included in v1.** Most states (`win`/`land`) are spine, so a sprites-only tool is
  useless. Spine support = a _copy/mirror_ of already-made spine bundles into `deploy/`
  (see below) — NOT spine authoring.

### Out of v1

- Payline geometry / which symbols pay on which lines.
- Creating or editing spine animations (we only reference existing ones).
- Adding/removing symbols or states (the symbol set + 6 states are fixed in v1; the tool
  edits bindings within that fixed grid). NOTE: the **global highlight** below is the one
  global binding now authorable on top of the fixed grid — it is not per-symbol-per-state.

## Symbol size lives on the reel (moved out 2026-06-18)

Symbol render size is **NOT** a Symbols State Machine concern. A short-lived global
`defaultSizeRatios` field on the symbols doc was added then **removed**: size is a _layout_
concern, so it now lives on the reel's `reelGrid.symbolSizeRatios` and is edited in the
**Scene Editor** — see
[`docs/design/invisible-editor.md`](./invisible-editor.md) ("Symbol size on the reel"). This
tool is once again only about _which asset maps to each symbol×state_.

- **Where size lives now:** `ReelGridNode.symbolSizeRatios?: { width, height }` on the layout
  doc (`scenes.json`), edited via the reel's "Symbol size (× cell)" control in the Scene
  Editor's `EditorProperties`. `1` = the art fills one reel cell; absent ⇒ the game's coded
  per-symbol sizes (parity). It travels on the layout doc like every other reelGrid field —
  no symbols-doc involvement and no bake step beyond the normal scene bake.
- **Back-compat only on the symbols side:** the per-cell `SymbolCell.sizeRatios` field stays
  **optional** purely for back-compat _reads_ — the engine's size resolver still honours a
  baked per-cell override ahead of the reel value — but the Symbols State Machine no longer
  **authors** size at any level (the size panel + per-cell size inputs were removed).
- **Resolution order (at render):** baked per-cell `sizeRatios` (legacy override) > reel
  `reelGrid.symbolSizeRatios` > coded `SYMBOL_INFO_MAP` size > `{ width: 1, height: 1 }`.
- **Scope reality.** cluster / scatter / ways / price keep self-contained `SYMBOL_INFO_MAP`s
  and don't use the baked symbols pipeline. Book of Borut (separate repo, lines/`bookOf`
  stack) takes the reel-size render path when it bumps the engine submodule.

## Global highlight (win frame) — added 2026-06-17

Separate from the per-symbol `symbols` map, the doc carries ONE optional global binding:
the **highlight** — the win-frame spine that loops over winning symbols (today the game
hardcodes a local spine named `payframe`, spine key `anticipation`).

```jsonc
{
	"version": 1,
	"symbols": {
		/* … */
	},
	"highlight": {
		"type": "spine",
		"assetKey": "<full R2 bundle prefix>",
		"animationName": "<loop anim>",
	},
}
```

- **Optional + spine-only.** Absent → the game keeps its built-in `payframe`. The tool
  shows the built-in default as a non-editable **Default (payframe)** placeholder (it's a
  LOCAL game asset, not in R2, so it can't be previewed) and lets the user override it
  with an R2 spine bundle via the SAME spine library picker the grid cells use.
- **Contract field (end to end):** `highlight?: { type: 'spine'; assetKey; animationName }`
  on `SymbolsDoc` (schema in `symbolsStorage.ts`). The coded default is represented on
  `SymbolDefaults.highlight` (`symbolDefaults.ts` + `lines.json`) for the "current =
  default" display only — never forced into an override.
- **Export/bake.** `symbolExport.ts` adds the highlight's `assetKey` to the spine bundles
  it copies into `deploy/editor-symbols/` (so it's in `index.spines`, keyed by the same
  `assetKey`), and returns a `highlight: { assetKey, animationName }` pointer.
  `bake-editor-doc.mjs` embeds it at `bundle.symbols.highlight`. The game loads the spine
  by `assetKey` like any per-symbol spine; an un-overridden project ships no `highlight`
  and renders byte-identical to before.

## Win-line overlay config — added 2026-06-17, styling added 2026-06-18

Alongside the highlight, the doc carries ONE more optional global setting: the **win-line
overlay** config — the line traced across each winning payline, with the win amount stamped
under its end. It started (2026-06-17) as a plain on/off flag and was widened (2026-06-18)
to also carry line + text **style**. It is still **pure config — no asset, no preview**
(the chosen text font travels via the existing font pipeline, not here).

```jsonc
{
	"version": 1,
	"symbols": {
		/* … */
	},
	"winLine": {
		"enabled": false, // present ONLY when turned OFF
		"line": {
			"color": "#ff3366",
			"width": 0.04,
			"glow": true,
			"glowColor": "#ff88aa",
			"animated": true,
			"speed": 1.5,
			"fullPayline": true,
			"fullPaylineColor": "#4a90d9",
		},
		"text": {
			"enabled": true,
			"font": "silver",
			"size": 0.6,
			"color": "#ffffff",
			"placement": "boardCenter",
		}, // enabled: present only when it DIFFERS from the line's
	},
}
```

- **Contract field (end to end):** `winLine?: { enabled?; line?; text? }` on `SymbolsDoc`
  (schema in `symbolsStorage.ts`; client type + sparse setters in `symbols.client.ts`).
  Every field is optional; each style field falls through to the game's coded default.
  Colours are CSS hex strings (Pixi 8 `ColorSource`); `line.width`/`text.size` are multiples
  of `SYMBOL_SIZE`; `line.speed` scales the animated-draw duration.
- **TWO switches, not one (2026-08-24).** The line and the stamped amount are separate
  sections in the tool, so a project can announce an amount with no line under it (or the
  reverse): the EFFECTIVE line on/off is `doc.winLine?.enabled ?? true`, the EFFECTIVE text
  on/off is `doc.winLine?.text?.enabled ?? <the line's>`. That fallback is what makes the
  split free: a doc written when one toggle governed both — including `{ enabled: false }` —
  still means exactly what it meant. `bakedWinLineEnabled()` is their OR (whether the overlay
  is broadcast at all); `WinLine.svelte` then draws each half on its own flag.
- **Amount placement.** `text.placement` (`'line'` default | `'boardCenter'`) moves the stamp
  from the winning line's end to the middle of the reel window. In `boardCenter` only the
  LAST-shown line stamps — with `line.allAtOnce` on, every amount would otherwise land on the
  identical spot.
- **Sparse on purpose.** Default (on, default style) writes nothing. Only the off-state
  (`enabled: false`), a `text.enabled` that DISAGREES with it, a non-default `text.placement`,
  and the individual fields the author changes are persisted; the two "Reset … style" buttons
  clear `line` / `text` respectively (keeping the on/off states); turning a toggle back to its
  default clears its flag. Client and server prune identically — they must, or the page reads
  dirty right after a clean save.
- **Show full payline (added 2026-07-27).** `line.fullPayline` (bool, default off) draws the
  WHOLE payline across all reels — not just the winning segment — as a static underlay beneath
  the winning line, in `line.fullPaylineColor` (its ONLY style option, coded default `#4a90d9`).
  Off ⇒ byte-identical to before (winning segment only). The full path is `win.positions`
  sorted by reel (a superset of the paying run); the renderer receives it as
  `winLineShow.fullPoints` (`flowEffects.ts#winLineFullPointsFor`, gated on the flag) and draws
  it complete under the animated winning segment. Rides `line` verbatim through export/bake.
- **Export/bake.** `symbolExport.ts` passes `winLine` straight through verbatim (no asset);
  `bake-editor-doc.mjs` embeds it at `bundle.symbols.winLine`, OMITTING it when absent.
- **Renderer (shared engine).** `apps/lines/src/components/WinLine.svelte` reads the resolved
  config via `editor-scenes.ts#bakedWinLineConfig()` (coded defaults applied) — line
  colour/thickness, an optional layered-stroke glow, an optional `svelte/motion` `Tween` draw
  (first→last, _then_ the amount), and the bitmap win-amount text (`style.fill` tint). The
  `winInfo` book-event handler traces the leftmost `kind` paying run (skipping scatter),
  gates on `bakedWinLineEnabled()`, and awaits the draw via `broadcastAsync` so an animated
  line completes before the symbol glow; non-animated resolves instantly, preserving the
  original timing. Because it lives in the shared engine, **every game on the `runtime:lines`
  bundle draws it** (default-on: `enabled ?? true`), so a project that authors win-line style
  online sees it in game with no per-game code.

## Explosion pattern — added 2026-09-08

**The problem.** The cascade blew the whole board up in one frame, and that was not a decision
anyone had made — it was the shape of a `Promise.all` over `explodingPositions`. A game that wanted
its board to come apart column by column had nowhere to say so.

**The shape.** One optional doc-global, a SIBLING of `transition` rather than a field inside it (the
transition covers the seam at one seat; this is the order the seats are reached in, and a project
routinely wants one without the other):

```ts
tumblePattern?: { pattern: TumblePatternName; stepMs?: number }
```

**Where the order lives.** `packages/engine-layout/src/lib/tumblePattern.ts` — a pure, dependency-
free `tumbleExplosionDelays(seats, config, bounds)` plus the pattern list and its labels. In
`engine-layout` for the same reason `symbolStates` is: the authoring tool and the game both depend on
that package, and a list re-declared on each side drifts silently (the launcher build transpiles TS
without checking it). The tool's live preview calls the same function the game does, with
`stepMs: 1`, so the delay it gets back IS the wave number.

**Three rules the ordering holds to**, because each is invisible when it is wrong:

1. **Dense ranking over the exploding seats, not the board.** The waves are numbered `0…n-1` across
   the seats that actually won, so a win on three reels pops in three waves rather than waiting
   through the empty ones in front of it. A pattern therefore reads the same on a small win as on a
   full board.
2. **The centre is the BOARD's.** `radial` / `columnsOut` / `columnsIn` measure from the middle of
   the board (the live column extents), so an off-centre win is seen to be off-centre. Every other
   pattern is monotonic, so the dense ranking cancels the origin out and the bounds do not matter.
3. **`all` and a zero gap both mean one frame**, and both short-circuit before any sort runs — the
   parity path, which is every project that never opens the panel.

**A seat stops being DRAWN when its own pop ends, which is not when it is removed.** Removal is
board-wide — `tumbleBoardRemoveExploded` runs once, after the whole step settles — and it has to
stay that way, because `TumbleBoardBase` seats a symbol by its index within its column, so taking
one out mid-step would shift everything below it and jump survivors that have not moved. A pattern
pulls those two moments apart by the length of the spread, and the symbol left in between kept
animating: a cell's `loop` is ABSENT by default and absent means loop, so a wave-0 seat re-played
its explosion two or three times over while the columns to its right were still popping. It is now
undrawn the moment its own animation reports (`TumbleSymbol.exploded`), which moves no index — so
the board genuinely comes apart in waves instead of coming apart and then sitting there half-dead.

The flag is set inside the ARMED callback, never after the `await`, and that placement is the guard.
The beat is raced against `TRANSIT_BEAT_CAP_MS` (650 ms), so settling after the await would fire on
the cap too and cut off any pop an artist authored longer than that — truncation, the failure this
codebase treats as worse than a blown guard because it looks like art. Armed instead, the two ends
of the race separate on their own: a long pop still reports late, into an already-settled promise,
and vanishes on its own last frame; one that can never report (no art, a spine animation missing
from the skeleton) is simply left for the board-wide removal, exactly as before. Owner report on
Waves/test6, 2026-09-09.

**What it must not change.** The step's contract: it still ends when the LAST seat's animation
reports, so a pattern lengthens it by exactly `(waves - 1) × stepMs` and nothing else. Which seats
explode, what they pay, and how they are refilled are all untouched. A wave that has not fired when
the board is swept (slam, skipped round, `tumbleBoardReset`) or has its column spliced under it is
DROPPED rather than popped — an off-board symbol has no renderer and can never report `oncomplete`.

**Two ceilings, and only the second one bounds the round.** `stepMs` is capped at 500, but that caps
ONE GAP, which caps nothing for a pattern whose wave count grows with the win: `sequential` pops one
seat per wave, so a 15-symbol cluster at 500 ms would spread over 7 seconds — and a swap-in-place
board with "clear the board" ticked explodes the whole board on EVERY spin, on a step that is not
raced against the round-skip token. So the whole SPREAD is capped too (`TUMBLE_SPREAD_MS_MAX`,
2 s), by scaling the step down to fit while every seat keeps the wave the pattern gave it. It is a
guard, not a shaper: a 5-column sweep at the maximum gap is exactly 2 s and passes through untouched.

**An unknown pattern name explodes in one frame — it never throws.** Zod stops one at save, so this
is not about a malformed doc; it is about the version skew this repo ships by design. The launcher
deploys from `main` on its own cadence while a shipped game vendors the engine as a submodule pinned
to an older commit, so a thirteenth pattern added today can reach a game whose `switch` has no case
for it. A throw would land inside `tumbleBoardExplode`, whose rejection takes `broadcastAsync` → the
`tumbleBoard` book event → the round with it, on the one step every cascading spin runs.

**The Transition rides its own seat's pop, and a pattern does not move it.** The bridge mounts the
authored `delayMs` after THAT seat's explosion, whatever wave the pattern put the seat in, so under
`columnsLeft` the bridges sweep across the board with the waves.

This was got wrong once, and the mistake is worth keeping written down because the argument for it
is a good one. Under a pattern the seam is two different shapes: the pop is per seat and staggered,
while the intro it bridges (`tumbleBoardAppear`) is one board-wide beat fired after the whole step
resolves. Reasoning from the intro end, every seat's bridge was made to wait out the remaining waves
so they all landed together, `delayMs` after the LAST wave. On the board that read as broken — a
wave-0 seat's cover arrived a whole spread after the symbol it was covering had finished popping,
and the two came apart.

One layer cannot sit on both ends. It sits on the POP, because that is the end the author authors
against: the tool's own words are "Plays at the seat when a symbol explodes… Delay = ms after the
explosion fires", and a delay measured from a seat's own pop is the only one an author can watch
themselves tuning. The board CLEAR was the tell — it is fanned out one column per call, so under a
column pattern every seat in a call shares a wave and the catch-up was always zero there. Same
authored transition, right on the clear and wrong after a tumble win. Reported by the owner on
Waves/test6, 2026-09-09.

**Where it applies, and the two ORDERING SCOPES that needs.** Both moments reach
`tumbleBoardExplode`: every cascade step, and the swap-in-place board CLEAR. Same gate as the
`Clear reel` grid column, for the same reason — but they hand the cue different things, and
one ranking rule cannot serve both.

- The CASCADE passes the whole winning set in one call, so it is DENSE-ranked (rule 1 above).
- The board CLEAR is fanned out ONE COLUMN PER CALL (`clearOutgoingSymbols(reelIndex)`, driven
  concurrently by `emergeRevealBoard` / `columnCascadeRevealBoard`). Dense-ranked, one column's
  seats share a column key and every column answers "wave 0" — so a column pattern did nothing at
  all on the beat a swap-in-place player watches on EVERY spin, which is precisely the
  whole-board-at-once this feature exists to break up. That call therefore sets
  `patternScope: 'board'` and the ordering ranks the column against the whole board instead.

Row/diagonal/radial patterns always worked on the clear (their keys vary WITHIN a column); only the
four column patterns were inert. Found on a live project, 2026-09-09.

## `clearReel` — the state that was `tumbleExplosion` (renamed 2026-09-10)

**Nothing about the behaviour moved.** The state is still what the cascade's win-removal and the
swap-in-place board CLEAR (`clearOutgoingSymbols`) both play, still gated on `cascade || clears`,
still inheriting `explosion` when unauthored. Only the key and the label changed:
`tumbleExplosion` → `clearReel`, "Tumble explosion" → **"Clear reel"**.

**Why.** The pair `explosion` / `tumbleExplosion` served three jobs under two names that described
none of them. `explosion` is a symbol popping WHERE IT STANDS while the reel keeps it (the Book-of
column morph); the other is a symbol being TAKEN OFF the board — and it is fired as much by the
board clear, which a swapping lines game runs every single round, as by a cascade. "Tumble" named
the one caller that happened to come first.

**Migration: fold on read, at one boundary.** Saved docs hold the old key in two state-keyed maps —
`symbols[name].tumbleExplosion` and `symbolSounds[name].tumbleExplosion` — and the same key can
appear in a game's PUBLISHED `defaults.json`, because a shipped game pins the engine as a submodule
and publishes the names its own commit knows. Both are folded before validation
(`symbolsStorage.ts#migrateLegacySymbolStates`, reused by `symbolDefaults.ts` on read AND on write).

It has to run before the Zod parse rather than being expressed as a schema union, and the reason is
worth keeping: the state records are keyed by `z.enum(SYMBOL_STATES)`, which Zod **rejects** an
unlisted key on, and `loadSymbolsDocWithEtag` answers a parse failure with `emptySymbolsDoc()`. An
un-folded legacy doc would therefore have read as a project that had never authored anything — every
binding and every per-symbol cue silently gone. Folding at the boundary also means the old name never
reaches export, bake or the game. The new key wins if a doc somehow carries both.

**What was deliberately NOT renamed**, because each is a different namespace and renaming it would
migrate a different doc for no gain: the `tumbleBoard*` emitter cues and `stateTumble` internals (the
tumble OVERLAY, a separate concept); `tumbleExplosionDelays` + the `TUMBLE_PATTERNS` family in
`engine-layout/tumblePattern.ts` (a lone `clearReelDelays` inside that module would read worse than
the churn saves); and the game-wide `tumbleExplosion` SOUND SLOT in `packages/game-config/src/sounds.ts`,
which is a `/config` → Sounds key, not a symbol state.

## Winning symbols explode — added 2026-09-10

**The problem.** `explosion` only ever meant "the Book-of column morph". A board that does not
cascade had no way to say _"the symbol goes out with a pop when the round is over"_ — the winner
played `win` and `Board.svelte` reverted it straight to `postWinStatic`.

**The shape.** One optional doc-global, a sibling of `winCycle`:

```ts
winExplode?: { enabled?: boolean }
```

On, the round's winning cells play their `explosion` state — all of them together, ONCE, after the
whole win presentation has narrated — awaited with the same bounded-beat treatment the win beat gets
(`awaitSymbolBeat` + `WIN_BEAT_CAP_MS`). No floor: `WIN_BEAT_MIN_MS` was already spent on the win,
and a second one would be added to every paying spin. Concurrent, so the whole pop costs one bounded
beat rather than one per cell.

**The pop IS the removal — "explode and be gone".** The cell is taken OFF the board at the end of
that beat — on both exits of the race, so a cell whose art can never report is just as gone — rather
than reverted to `postWinStatic` and left standing. Reverting made the pop a rehearsal for a removal
that arrived later and from somewhere else: on a project that clears its board before the new
symbols fall in (`/config` → Reel behaviour), the next spin's clear pops every visible cell, the
winners that had already exploded included, so a paying spin read Win → Explosion → Clear reel. The
winners now leave on their own beat and the clear only pops what is still standing. Symbols that did
NOT pay are untouched: taking those off stays the job of the cascade and the clear step
(`clearReel`).

**It happens at the END of the round, not at the end of each win, and that is the load-bearing
sequencing decision.** A round presents its wins ONE AFTER ANOTHER over the same board
(`bookEventHandlerMap.winInfo` → `sequence(bookEvent.wins, …)`) and overlapping paylines share
cells — line 1 `[0,0,0,0,0]`, line 6 `[0,0,1,2,2]` and line 18 `[0,0,2,0,0]` all pay on reels 0-1 of
row 0, and 1970 of the 7480 `winInfo` events in the reference books (26%) have at least one cell paid
by two wins. Popped at the end of its own win, a cell was therefore taken off the board that a LATER
win of the same round still had to light: the later win set `symbolState = 'win'` on an unmounted
cell whose `oncomplete` can never fire, the beat settled only on `WIN_BEAT_CAP_MS`, and the pop then
armed a second unfirable one — about eight seconds of frozen presentation, on a quarter of paying
spins, with nothing below the cap to bound it. Deferred, every win's narration is byte-identical to
the switch being OFF and the explosion is one extra beat at the end.

**Where "the end" is.** The seam is the point where the resting replay would otherwise start —
`playBet`'s `finally` (the one place every dispatch path crosses: coded handler map, v1 flow, v2
flow, a slammed round, a round whose book threw) and the between-spins hold
(`freeSpinHold.holdAfterBigWin`). `winSymbolCycle` already ACCUMULATES the round's wins across
`winInfo` events and dedupes them — it had to, because the Play4Fun facade the shipped games run on
flushes one event per win — so the set the pop needs is the set the replay was already building, and
the two cannot disagree about which cells the round paid on. `explodeRoundWinners` dedupes it once
more BY SEAT (the shared-cell case) and drops anything already gone, so the two seams are safe to
both run and a losing round broadcasts nothing at all.

The removal is a flag on the reel CELL (`ReelSymbol.removed`, `utils-slots`), not a `reel:row` set,
and that is what makes it self-clearing: every board replacement builds fresh cells, so the next
board is un-removed by construction and no seam has to remember to wipe anything. A key set could
not manage that — the pre-spin doubles the strip under the same row indices, so a stale key would
punch a moving hole through the roll. It is published by position as `boardRemoved()` (a sibling of
`boardRaw()`) for the readers that address the board by seat, of which there are three: `ReelSymbol`
stops drawing the cell; the cascade overlay seeds its survivor layer from it (`createTumbleSymbol`,
so the winners do not come back for the length of a clear); and `winSymbolCycle` uses it both to
build the pop's own set and to drop those cells from the resting rotation. `expandBookColumns` uses
the same `explosion` state to morph a column and deliberately does NOT remove — the removal lives in
one cue handler (`boardExplodeWinSymbols`) and nowhere else. The win beat additionally REFUSES a cell
that is already removed, so a future caller cannot reintroduce the stall.

**It is an explicit switch, default OFF, and that is the load-bearing decision.** Inferring it from
"is `explosion` authored" was the obvious alternative and is wrong: every game already binds
`explosion` for the Book-of morph (`apps/lines/src/game/constants.ts`), so the inference is TRUE
everywhere and would re-time the one beat every paying spin in every shipped game runs.

**Three edges, decided rather than left to fall out:**

1. **The resting replay has nothing left to replay.** The winners are gone by the time the round
   ends — the pop is awaited immediately before `startWinCycle`, which is what makes this true rather
   than a race — so every entry drops out of the rotation (`cycleEntries` filters by `boardRemoved()`)
   and the board simply rests. Turning the pop on is a choice against the resting replay rather than a
   modifier of it; the alternative was a cycle re-lighting seats that draw nothing and awaiting a beat
   cap per pass for each.
2. **A stacked-covered cell is skipped.** It mounts no `<Symbol>` at all (`ReelSymbol` skips it so the
   tall picture does not double with the icons it replaces), so there is nothing to draw the pop with
   and nothing that could ever report it finishing. Popping it would be a dead hold that also ended
   the tall picture's win art early, for no picture. The stacked mode's win beat stays the tall
   picture itself, and a covered cell is never removed.
3. **A cascade owns only the seats the BOOK names.** The overlay's survivor layer is built from the
   resting board, so a seat the pop emptied arrives in it — born UNDRAWN (`exploded`) but in the
   ORDINARY `static` state. Those two halves are separate on purpose: `tumbleBoardRemoveExploded`
   filters `base` by `symbolState === 'clearReel'`, i.e. by what THAT step popped, while `adding` is
   sized to `bookEvent.explodingSymbols`. A seat born `clearReel` would therefore be swept by a step
   that never named it, the combined column would settle SHORT, and `combineTumbleReel`'s "baseReel[0]
   is the top pad" assumption would start pointing at a real symbol — every later step of the chain
   addressing the wrong rows, invisibly. The explode step instead MARKS an already-gone seat and
   returns without waiting on it, so the board CLEAR (which names every visible seat) still sweeps it
   with the rest while a cascade leaves it exactly where it is.

**Chain (rule 8).** `.strict` Zod + sparse prune (`enabled: true` only) → client
type/`winExplodeEnabled`/`setWinExplodeEnabled`/`docSignature` → the spread PUT → `symbolExport.ts`
verbatim → `/api/editor/export-symbols` response → `bake-editor-doc.mjs` whitelist AND the runtime
bundle → `BakedBundle.symbols.winExplode` → `bakedWinExplodeEnabled()` → `Board.svelte`. A
`gameProfile` chip reports it. Absent ⇒ byte-identical.

## "Spine export" demystified

A spine asset is a **bundle of sibling files that travel together**, e.g. for `H1`
(`apps/lines/src/game/assets.ts`):

```
symbols.atlas   ← libGDX region map (SHARED by H1…L4)
h1.json         ← this symbol's skeleton
symbols.webp    ← the page image the .atlas references (SHARED)
```

Several symbols share one atlas + page (`symbols`=H1–L4, `symbols2`=M+S, `symbols3`=W+
explosion). These are made by an artist in Spine Editor and already exist in R2 (the
Invisible Spine Viewer streams them). **We import them as-is.** "Export" = the same humble
copy step `fontExport.ts` does for bitmap fonts: mirror the existing files into the
project's `deploy/` subtree with their sibling files + names intact, so the build pull drops
them into `static/assets/` and the game registers them. The ONE new capability vs the
existing editor-art exporter (which only handles single-file sprite sheets) is gathering the
multi-file spine bundle (atlas + N skeletons + shared page) and keeping the relative names
lined up.

## The R2 doc (new asset class)

`<client>/<project>/symbols/symbols.json` — the authored binding map. Coded
`SYMBOL_INFO_MAP` is the **fallback/default** (dev parity), exactly as
`fallbackEditorScenes` is for the layout doc.

```jsonc
{
	"version": 1,
	"symbols": {
		"H1": {
			"static": { "type": "sprite", "assetKey": "h1.webp" },
			"win": { "type": "spine", "assetKey": "H1", "animationName": "h1" },
			// sizeRatios is OPTIONAL on a cell (back-compat reads only; size is now set on the
			// reel — reelGrid.symbolSizeRatios in the Scene Editor). One entry per authored
			// state; unset states fall through.
		},
		// … only symbols/states the user changed need appear (sparse overrides)
	},
}
```

Sparse: an unset symbol/state falls through to the coded default, so the doc only carries
edits. Same merge philosophy as `componentDefaults`.

## Engine contract (build FIRST — everything hangs off it)

`getSymbolInfo` ([`apps/lines/src/game/utils.ts`](../../apps/lines/src/game/utils.ts))
currently reads `SYMBOL_INFO_MAP[name][state]` straight from the constant. Change:

1. **`apps/lines/src/game/symbolMap.ts`** (new) — exports `activeSymbolInfoMap`, computed
   once as `mergeSymbolMap(SYMBOL_INFO_MAP, bakedSymbolMap())`. `mergeSymbolMap` deep-merges
   per symbol/state (override wins; unset falls through). `utils.ts#getSymbolInfo` reads
   from `activeSymbolInfoMap`.
2. **`editor-scenes.ts#bakedSymbolMap()`** — returns `bundle.symbols?.map` (the authored
   overrides) or `undefined` when un-baked → dev keeps the coded map byte-for-byte.
3. **`editor-scenes.ts#bakedSymbolAssets()`** — turns the bundle's `symbols.index` into
   engine asset entries for any assetKey the overrides introduce that the coded `assets.ts`
   doesn't already register:
   - sprite sheet → `{ type:'sprites', src:'assets/editor-symbols/<stem>/<stem>.json', namespace? }`
   - standalone image → `{ type:'sprite', src }`
   - spine bundle → `{ type:'spine', src:{ atlas, skeleton, scale } }` (paths under
     `assets/editor-symbols/…`)
     Spread into `createApp({assets})` in
     [`stateApp.ts`](../../apps/lines/src/game/stateApp.ts) beside `bakedEditorArtAssets()`.
4. No boot-order surprise: the map is pure data (no registration call), so reading
   `activeSymbolInfoMap` at first render is enough. Assets register at `createApp` as today.

Un-baked repos (`apps/lines` dev, any game before first symbol edit) get `undefined` map +
`{}` assets → identical to today.

## The deploy chain (mirror `editorArtExport.ts` / `fontExport.ts` exactly)

Per the hard rule (`docs/design/live-assets.md`, CLAUDE.md §8): a new R2 asset class is only
done when it travels **export → `deploy/` → bake → pull → register**.

1. **Export (server)** — `apps/launcher-api/src/lib/server/symbolExport.ts#exportEditorSymbols`:
   read `symbols.json`, resolve each referenced sprite sheet / standalone image / **spine
   bundle**, copy into `deploy/editor-symbols/<stem>/` (preserving sibling file names so a
   spine `.atlas`'s page refs + a skeleton's atlas ref resolve), write `index.json` (sprite
   sheets, images, spine bundles with their atlas/skeleton/scale). Prune stale; idempotent.
2. **Trigger** — `POST /api/editor/export-symbols?project=<key>&k=<token>` (same deploy-token
   gate as `export-art` / `export-fonts`). `bake-editor-doc.mjs` calls it alongside the
   other exports and embeds the returned `{ map, index }` as `bundle.symbols`.
3. **Bake** — `baked-editor-bundle.json` gains a `symbols?: { map, index }` field
   (`editor-scenes.ts`'s `BakedBundle` type).
4. **Pull** — `pull-project-assets.mjs` already mirrors ALL of `deploy/` → `static/assets/`;
   just add `editor-symbols/` to its prune-aware list. ⚠ Same build-order rule: `bake:doc`
   BEFORE `pull:assets`.
5. **Register** — `bakedSymbolAssets()` + `bakedSymbolMap()` above.

## The tool UI (`/symbols`, "Invisible Symbols State Machine")

- Auth gate + client/project selector + tool top bar — REUSE existing launcher helpers
  (run `/reuse-check` before building any of these surfaces).
- Grid: rows = symbols, columns = the 6 states. Each cell shows a **live preview** of the
  current binding (sprite frame or spine animation playing), mirroring the debug overlay.
- Click a cell → open the **R2 asset library picker** (same component the editor uses) to
  choose a sprite-sheet frame or a spine bundle; for spine, choose `animationName`; edit
  `sizeRatios` (numeric, minimal in v1).
- Save → write `symbols.json` to R2. A "Deploy" affordance can call the export, consistent
  with how the editor triggers art export.

## Build plan (ordered)

- **S1 — Engine contract.** `symbolMap.ts` + `getSymbolInfo` reads the merged map;
  `bakedSymbolMap()` / `bakedSymbolAssets()` stubs in `editor-scenes.ts` (return
  `undefined`/`{}` until the bundle carries `symbols`); `BakedBundle.symbols` type;
  `stateApp.ts` spread. **Pure parity** — no behaviour change until a doc is baked. Verify
  the game renders byte-identical.
- **S2 — Doc schema + R2 read/write + server.** `symbols.json` schema (Zod, shared),
  project path helper (`projectPaths.ts#symbolsDocKey`), `GET/PUT` doc endpoints.
- **S3 — Tool page.** `/symbols` grid UI with live previews + library picker + save.
- **S4 — Export + bake + pull (spine-aware).** `symbolExport.ts`, `export-symbols`
  endpoint, `bake-editor-doc.mjs` wiring, `pull-project-assets.mjs` prune entry.
- **S5 — Prove end-to-end** on Book of Borut: rebind a symbol state online → `pnpm build`
  → republish → new asset/animation shows in the game.
- **S6 — Global config (post-v1).** The doc-level globals authored on top of the fixed grid:
  `highlight` (2026-06-17) and `winLine` (2026-06-17, styled 2026-06-18) — see their sections
  above. Each is sparse (absent = byte-identical to before), forwarded verbatim through
  `symbolExport.ts` → `bake-editor-doc.mjs` → `bundle.symbols.*`, and consumed by the per-game
  engine accessor (`bakedWinLineConfig()`). Book of Borut needs the same mirror as a follow-up
  (bump the engine submodule for the
  launcher/bake changes). (Symbol _size_ was briefly a doc global here too —
  `defaultSizeRatios` — but it has since moved to `reelGrid.symbolSizeRatios` on the reel,
  edited in the Scene Editor; see "Symbol size lives on the reel" above.)

## Per-project defaults — automatic publish (added 2026-06-12)

The grid is scaffolded from each game's coded `SYMBOL_INFO_MAP` (the symbol list, the 6
states, every cell's default binding). The launcher is cloud and can't import a game's
source, so — like every other asset class — the game **publishes** its map to R2 and the
tool reads it. No hand-maintained per-game JSON.

1. **Publish (game build)** — `apps/launcher-api/scripts/publish-symbol-defaults.mjs` imports
   the game's `SYMBOL_INFO_MAP` (under `node --experimental-strip-types`, since it's a TS
   module with computed ratios) and `PUT`s `{ version, gameType, symbols }` to
   `POST`-sibling `PUT /api/editor/symbol-defaults?project=&k=` (deploy-token gated). The
   endpoint writes `<client>/<project>/symbols/defaults.json`. `--optional` keeps a build
   green when un-tokened (mirrors `bake:doc`/`pull:assets`).
   - **Filtered to the in-play set (2026-06-18).** `SYMBOL_INFO_MAP` carries visual/animation
     defaults for every symbol the engine _can_ render (e.g. an unused `H5`). The script also
     imports the game config module (`--config`, default `./src/game/config.ts`) and keeps
     only the symbols whose names appear in its default-export `symbols` map — the authoritative
     in-play set the game builds against — so the tool grid mirrors the game instead of showing
     dead rows. Ordering follows `SYMBOL_INFO_MAP` (only absent keys are dropped). Best-effort:
     a missing/odd config, an empty `symbols` map, or `--no-config-filter` publishes the full
     set (prior behaviour) so a build never loses symbols to a config it couldn't read. A config
     symbol with no map entry is warned (no silent gap). The committed `lines.json` fallback is
     filtered the same way (no `H5`).
2. **Scaffold (automatic for new games)** — `scripts/new-game.mjs` adds a `publish:symbols`
   script and chains it into `build` (`… && pnpm publish:symbols --optional && vite build`),
   so every new game publishes its symbol map on build with zero per-game wiring.
3. **Read (tool)** — `symbols/+page.server.ts` prefers `loadPublishedSymbolDefaults(...)`
   (R2) and falls back to the committed `symbolDefaultsFor(gameType)` (`lines.json`) for an
   un-published project or `apps/lines` dev. So Book of Borut shows ITS symbols once it has
   built once with a deploy token; an un-published project shows the coded `lines` set.

`lines.json` stays committed as the offline fallback / dev parity.

## Seeding a game's symbol assets into R2 (so previews render)

The tool previews ONLY from R2, under the per-project prefixes `listProjectAssets` scans:
sprites → `sheets/` + `manifests/`, spines → `spines/`. A game's BASE symbol art lives in
its repo (`static/assets/…`), not those prefixes, so default cells render as placeholder
chips until the art is seeded. Two sibling syncs (run from the engine repo with `R2_*` creds):

- **Sprites** — `apps/launcher-api/scripts/r2-sync-sheets.mjs <spritesDir> <client> <project>`
  uploads each TexturePacker sheet folder to `<client>/<project>/sheets/<folder>/`.
  `loadRegionSet` reads the TexturePacker JSON directly + resolves the page beside it, so a
  game's own `symbolsStatic` (frames `h1.png … w.png`) becomes previewable with no re-author.
- **Spines** — `apps/launcher-api/scripts/r2-sync-spines.mjs <spinesDir> <client> <project>`
  uploads bundles + writes the `skeletons.json` index. (Spine _default_ cells still render as
  chips — the coded map's short keys like `H1` aren't R2 bundle prefixes; only a rebind, which
  stores the full bundle prefix, gets a live preview.)

## Open decisions

- **Existing standalone games must build once to publish.** Book of Borut (and any game that
  predates this) needs (a) the S1 engine contract mirrored in (its own `src/game/*`), and
  (b) one tokened build (or a manual `publish:symbols` run) to populate
  `symbols/defaults.json`. New games get it from the scaffolder automatically.
- **Per-game `getSymbolInfo`** — each `apps/<game>/src/game/utils.ts` has its own copy;
  S1 lands in `apps/lines` first, then mirrors into Book of Borut (record-every-engine-change
  rule) and the other reference games.
- **Spine in editor-art convergence** — once spine export exists here, the editor-art
  exporter's parked spine support (live-assets.md open decision) can share this code.
