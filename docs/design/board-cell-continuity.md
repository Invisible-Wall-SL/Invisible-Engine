# Board cell continuity — a symbol keeps playing when nothing about it changed

> Status: **shipped** (2026-09-17), in two stages on one branch. Owner report on
> `invisible_wall/test6`: "from each column that gets cleared, the symbol animation for each of the
> other columns gets reset and played again from the beginning — on the first column nothing, on the
> third column twice, on the fifth column four times." Only ever seen on a tumble/swap game, which is
> the clue: those are the only boards that change hands mid-round.

## The measurement (live board, `ie_authoring=1`)

A first probe, keyed by seat, counted every re-created sprite and every playback rewind. It proved
the clear sweep itself is CORRECT — the in-place rewinds land 213 / 206 / 178 ms apart (the authored
`columnsLeft` @ 200 ms) and the frame each one interrupts climbs **2 → 4 → 7 → 9** across the
columns, exactly a clip that keeps running while its column waits its turn. One rewind per column,
at its own wave, touching nobody else.

It could not, however, tell a **cell being re-created** from a **cell changing its art** — both show
up as a new sprite, and only the first is a bug. The second probe does, by keying on the cell's own
Pixi container (`SymbolWrap`'s) instead of on a position, and comparing the art signature either
side of the swap. One base spin, `emerge` + "clear outgoing", 5 columns:

```
t=628   360|495|630|765|810|900|945   19 cells mount   ← EVERY column, 16 of them SAME ART
t=1234  360                            3 cells mount   ← one column's refill
t=1466  495                            4
t=1549  630                            4
t=1775  765|810                        4
t=1936  360|495|630|765|810|900|945   19 cells mount   ← EVERY column, 6 of them SAME ART
t=2679  855                            1
```

Totals for the spin: **23 `MOUNT SAME-ART`** (a cell torn down and rebuilt around art that did not
change — the bug), 30 `MOUNT NEW-ART` (a cell rebuilt because its symbol or state genuinely changed —
correct), 54 `UNMOUNT`.

Two things this settles:

1. **The per-column beats were already correctly scoped.** Every timestamp between the two clusters
   touches ONE column. The clear, the removal and the refill do exactly what they say.
2. **The restarts are the board changing hands, and there are exactly two of them per board change.**
   `t=628` is `boardHide` → the cascade overlay mounting a clone of the standing board. `t=1936` is
   `tumbleBoardReset` → `tumbleBoardHide` → `boardShow`, the reel board mounting its own symbols
   again. Both are board-WIDE, which is why the player sees every column restart at once.

The count the owner reported — nothing on column 1, twice on column 3, four times on column 5 — is
those board-wide restarts counted per column: a column that has not had its own beat yet is still
showing its ORIGINAL symbols, so it visibly restarts once per board change it sits through before
finally submerging. The columns to the right sit through more of them.

## Why a hand-over rebuilt everything

The board used to be drawn by **two component trees that never coexisted**:

- `Board.svelte` → `BoardBase` → `ReelSymbol` → `SymbolWrap` → `Symbol`, over the reel strips.
- `TumbleBoard.svelte` → `TumbleBoardBase` → `TumbleSymbol` → `SymbolWrap` → `Symbol`, over
  `stateTumble`'s `base` + `adding`.

`boardHide` unmounted the first; `tumbleBoardShow` mounted the second, whose survivor layer was built
by **cloning** the standing board. Then the reverse on the way back. A new component starts its clip
at frame one.

Note what was NOT the cause: replacing a cell's _data_ was already safe. A board replacement builds
fresh cell objects, but Svelte reuses the component and `getSymbolInfo`'s memo keeps the resolved art
referentially stable ([#628](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/628)). An
unchanged symbol survives a settle. What it cannot survive is its component being unmounted.

## Stage 1 — the reel board is hidden, not dismantled

`Board.svelte` stays MOUNTED while a cascade step runs, instead of being taken apart and rebuilt. It
mirrors the step's own `tumbleBoardShow` / `tumbleBoardHide` cues (subscribing a second time observes
a cue, it does not take it over) and mounts on `show || overlayShown`.

This removed the `t=1936` cluster — the hand-over BACK — and nothing else. It shipped with an
optional `visible` prop on `BoardContainer` so the board could be hidden without being dismantled;
stage 2 made that unnecessary and the prop was reverted, because the board now DRAWS throughout.

## Stage 2 — one layer draws the cells

The remaining half could not be fixed by keeping data stable, because the cell was drawn by a
_different component_ before and after. Three things had to be true together, and any one alone buys
nothing.

### 1. One cell component

`TumbleSymbol.svelte` is gone; `ReelSymbol.svelte` draws the board whoever is driving it. The two
differed in only four ways:

- **`y`.** The reel cell reads the strip (`symbolY()`, or the seat under perspective at rest); a
  cascading cell reads a Tween. The cell now takes the Tween when one is attached
  (`ReelSymbolCascadeSeat`, `null` on every game that never cascades) and the strip otherwise.
- **The undrawn gate.** `removed` (the reel's win-explosion pop) and `exploded` (the cascade's
  played-out pop) were the same picture — a cell that holds its row but draws nothing — and are now
  one flag. The win beat's "refuse a removed cell" guard and the cascade's "already gone, mark it and
  return" branch read the same field.
- **Which LAYER draws it.** The reel cell put a spine on the unmasked animating layer only in `land`
  / `win` / `explosion`; the overlay put EVERY spine there. That difference is itself a remount — a
  symbol that changes layer is re-created, because `SymbolWrap` mounts on exactly one of the two
  `BoardContext`s — so one predicate has to hold throughout. It is the reel's, widened to the
  cascade's own two states: `land | win | explosion | clearReel | intro`. A game that never cascades
  never reaches the new ones, so its layer assignment is unchanged.

- **Who a completion belongs to.** The overlay forwarded every renderer completion to its cell; the
  reel cell forwarded only the states it had armed. The merged cell keys the forward on the STATE —
  `win` / `explosion` (the reel board's), `clearReel` / `intro` (a step's), and `land`, the one both
  arm — and on nothing else, so a settled win beat is never re-fired by a looping clip on a cell that
  has since moved on.

  **The first cut of this asked whether a cascade seat was attached, and that was a bug** (fixed
  2026-09-17). A seat says where a cell IS, not who is waiting on it, and the two come apart on one
  real path: with "let the next spin start as soon as the symbols are back" turned on,
  `tumbleBoardAppear` does not await its intro beats, so `boardSettle` adopts the cells — detaching
  every seat — while those intros are still playing. Gated on the seat, the completions were
  swallowed and every arriving symbol sat frozen on its intro for the whole `INTRO_BEAT_CAP_MS` (2 s)
  before the cap settled it. The overlay never showed this, because it DESTROYED the cell at
  `tumbleBoardHide` and the reel board mounted a fresh resting one — the restart this merge removes
  was hiding the freeze behind it.

The reel-board-only presentation stands down while a step is driving a cell: the win dim and the
stacked-picture cover are both keyed by the RESTING board's rows, which a cascade is in the middle of
rearranging, and the overlay never applied either.

### 2. One mount site

`TumbleBoardBase.svelte` is gone. `BoardBase` reads `stateTumble.active` and renders either the
cascade's combined columns or the reel strips. `TumbleBoard.svelte` keeps its cue handlers and its
transition layer, and loses its cells, its ground tiles and its board mask — with one board on screen
there is one of each, and it is the board's.

That also retires the tile layer's double-draw guard (`overlayTileArt` / `reelBoardShown`), which
existed only because two boards took turns owning the ground.

`Board.svelte` therefore DRAWS while a step runs rather than merely staying mounted: the step IS the
board, so honouring a `boardHide` broadcast by a cascading reveal would black the screen for the
length of every cascade. Outside a step it is `{#if show}` exactly as it always was, so an authored
`boardHide` for a cinematic still hides the board.

The mask's overflow policy follows the owner. `allowOverflow` is gated on reel motion, which a
swap-in-place board can never answer (it never spins, so every reel reads settled mid-fall and the
spill would be granted 100% of the time), so `BoardMask` takes `allowOverflow={!stateTumble.active}`
and the step's own transit counter otherwise. The counter moved from `TumbleBoard` to `stateTumble`
so both sides can read it.

Under PERSPECTIVE, `BoardBase` emits ONE FLAT LIST ordered back-to-front rather than nested row/reel
loops. That is not cosmetic: a cell whose row shifts — a step filters survivors and splices refills
above them — would MOVE BETWEEN nested row blocks, which destroys and rebuilds it.

### 3. One cell object, keyed by identity

The step ADOPTS the board's cells rather than cloning them, and `BoardBase` keys the `{#each}` by the
cell itself. Both halves are needed: adoption alone still loses the component when a survivor's index
shifts, and identity keying alone has nothing stable to key on across the seam.

That makes every seam that replaces a strip a place identity has to survive:

- **Into a step.** `initTumbleBoardBaseReel` takes `reelState.symbols` where they sit and attaches a
  seat. Two properties come along for free because they are properties OF the cell: a seat the
  end-of-win pop emptied is already `removed`, and it is still in the ORDINARY `static` state. The
  clone had to re-derive both from `boardRemoved()`, and got the first one wrong until it was taught
  to.
- **Out of a step.** Every cascading reveal settles on `tumbleBoardCombined()` — the cells on screen —
  so the reels ADOPT those objects (`setSymbolsWithReelSymbols`, which detaches the seats and
  renumbers them) instead of minting a fresh strip. The match is CHECKED, not assumed: `boardSettle`
  is an authorable cue, and a board that is not cell-for-cell the one the step is holding settles from
  raw symbols exactly as before.
- **Mid-step.** A cell the step drops — drained, swept, or declared gone by a scoped init — is
  released back to its strip (`releaseCascadeCells`). A Tween left attached would pin the symbol
  wherever the step abandoned it for the rest of the round.
- **Into a spin.** `prepareToSpin` mints a fresh strip, and that one is fine: every symbol goes to the
  `spin` state in the same breath, so the art changes anyway. The settle at the END of a spin
  actually improves — `targetSymbols` are the same objects the spin strip carried, so identity keying
  MOVES them where index keying re-created them.

### What did not change

`stateTumble` keeps both layers and keeps filtering `base`; the reel strip, the roll and the pre-spin
are untouched. What is shared is the **settled cell**, which is the only thing both presenters ever
drew. `perspective-board-mode.md` warned against "teaching [the reel model] to delete cells
mid-flight, which is exactly the coupling that would put the cascade's risk onto every game that
never tumbles" — the strip is still never shortened mid-flight. What a step filters is its own `base`
array; the cell it drops goes back to the strip unchanged.

## What the offline gates now pin

`verify-swap-in-place-mode.mjs` (644 checks) drives the real cue handlers on a virtual clock against
a stand-in for the reels — it has to mint reel-shaped cells now, because the step adopts them. Its
part 6 changed from "exactly one tile layer at a time" to the claims that keep one board on screen:
one mount site, identity keying, adoption at the settle, and the step drawing no second copy of the
cells, the tiles or the mask. `verify-tumble-pattern.mjs` (97) and
`check-clear-reel-and-win-explode.ts` (111) follow the same rename and assert adoption in place of
the clone's re-derivation.

Three fixtures had to learn about the cascade gate rather than change meaning:
`verify-board-tiles.mjs`, `verify-stepped-grid.mjs` and `verify-symbol-overflow.mjs`.

**Two fixtures were repaired along the way; both were red on `main` before any of this.**
`verify-swap-in-place-mode.mjs` threw `bakedArrivalReleaseEnabled is not defined` before a single
part-9 claim could run, so parts 9–12 were unreachable. `verify-win-explode-pop.mjs` threw
`resolveWinBeatBudget is not defined` and was dead in its entirety; behind the crash, four of its
claims had also gone stale against the authored win-beat ceiling (the pop removes at two exits now,
not one, and it is bounded by `budget.capMs` rather than the literal cap). Both are green. This is the
third time a new free identifier in a handler has silently taken one of these files out — the slice
throws before any claim runs, and a fixture that cannot start looks exactly like one that passes if
nobody reads the output.

**What a fixture still cannot check is the picture.** Whether a survivor's slide reads, whether the
mask clips a cascading symbol, whether paint order survives under perspective — those need a browser
pass on a cascading board, and this change is not done until one has been taken.

## How to re-measure

Paste into the game's console, `__p.reset()`, spin once, let it settle, `copy(__p.dump())`.
`MOUNT SAME-ART` is the bug — a cell re-created around art that did not change. `MOUNT NEW-ART` is
correct. Keyed on the cell's own container, so the two draw layers cannot be confused for each other.

```js
window.__p = (() => {
	const app = window.__PIXI_APP__;
	const cells = new Map(),
		lastAt = new Map(),
		log = [];
	let t0 = performance.now();
	const key = (x, y) => `${Math.round(x / 45) * 45},${Math.round(y / 45) * 45}`;
	const collect = (n, d, out, parent) => {
		if (!n || d > 30) return out;
		if (typeof n.gotoAndPlay === 'function' && 'textures' in n) {
			out.push({ o: n, kind: 'as', parent });
			return out;
		}
		if (n.state && n.skeleton && typeof n.state.setAnimation === 'function') {
			out.push({ o: n, kind: 'spine', parent });
			return out;
		}
		for (const c of n.children || []) collect(c, d + 1, out, n);
		return out;
	};
	const sig = (e) => {
		if (e.kind === 'as') {
			const t = e.o.textures || [];
			const f = t[0];
			return String((f && (f.label || (f.source && f.source.label))) || '?').replace(
				/_?\d{4}$/,
				'',
			);
		}
		const tr = e.o.state && e.o.state.tracks && e.o.state.tracks[0];
		return `sp:${(tr && tr.animation && tr.animation.name) || '-'}`;
	};
	const tick = () => {
		try {
			const t = Math.round(performance.now() - t0),
				seen = new Set();
			for (const e of collect(app.stage, 0, [], null)) {
				const cell = e.parent || e.o;
				seen.add(cell);
				const s = sig(e);
				let x = 0,
					y = 0;
				try {
					const g = e.o.getGlobalPosition();
					x = g.x;
					y = g.y;
				} catch {}
				const pos = key(x, y);
				let rec = cells.get(cell);
				if (!rec) {
					const prev = lastAt.get(pos);
					log.push(
						`${t} ${pos} MOUNT ${prev === undefined ? 'FIRST' : prev === s ? 'SAME-ART' : 'NEW-ART'} ${s}`,
					);
					cells.set(cell, { sig: s, pos, sprite: e.o });
					lastAt.set(pos, s);
					continue;
				}
				if (rec.sprite !== e.o) {
					log.push(`${t} ${pos} RESTATE ${rec.sig}>${s}`);
					rec.sprite = e.o;
					rec.sig = s;
				}
				rec.pos = pos;
				lastAt.set(pos, s);
			}
			for (const [cell, rec] of cells)
				if (!seen.has(cell)) {
					log.push(`${t} ${rec.pos} UNMOUNT ${rec.sig}`);
					cells.delete(cell);
				}
		} catch (err) {
			log.push('ERR ' + err);
		}
	};
	app.ticker.add(tick);
	return {
		tick,
		reset: () => {
			log.length = 0;
			t0 = performance.now();
		},
		dump: () => log.join('\n'),
		counts: () => {
			const c = {};
			for (const l of log) {
				const p = l.split(' ');
				const w = p[2] === 'MOUNT' ? 'MOUNT:' + p[3] : p[2];
				c[w] = (c[w] || 0) + 1;
			}
			return c;
		},
	};
})();
```

Two notes if you drive it from a headless or hidden pane rather than by hand: `requestAnimationFrame`
callbacks registered from an injected context never fire there, which is why the probe rides
`app.ticker` — and the ticker itself only advances while something forces a frame, so sample with
`app.ticker.update(performance.now())` in a loop, or take screenshots.
