# Board cell continuity — a symbol keeps playing when nothing about it changed

> Status: **stage 1 shipped, stage 2 designed** (2026-09-17). Owner report on `invisible_wall/test6`:
> "from each column that gets cleared, the symbol animation for each of the other columns gets reset
> and played again from the beginning — on the first column nothing, on the third column twice, on
> the fifth column four times." Only ever seen on a tumble/swap game, which is the clue: those are
> the only boards that change hands mid-round.

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

1. **The per-column beats are already correctly scoped.** Every timestamp between the two clusters
   touches ONE column. The clear, the removal and the refill do exactly what they say.
2. **The restarts are the board changing hands, and there are exactly two of them per board change.**
   `t=628` is `boardHide` → the cascade overlay mounts a clone of the standing board. `t=1936` is
   `tumbleBoardReset` → `tumbleBoardHide` → `boardShow`, the reel board mounting its own symbols
   again. Both are board-WIDE, which is why the player sees every column restart at once.

The count the owner reported — nothing on column 1, twice on column 3, four times on column 5 — is
those board-wide restarts counted per column: a column that has not had its own beat yet is still
showing its ORIGINAL symbols, so it visibly restarts once per board change it sits through before
finally submerging. The columns to the right sit through more of them.

## Why a hand-over rebuilds everything

The board is drawn by **two component trees that never coexist**:

- `Board.svelte` → `BoardBase` → `ReelSymbol` → `SymbolWrap` → `Symbol`, over the reel strips.
- `TumbleBoard.svelte` → `TumbleBoardBase` → `TumbleSymbol` → `SymbolWrap` → `Symbol`, over
  `stateTumble`'s `base` + `adding`.

`boardHide` unmounted the first; `tumbleBoardShow` mounted the second, whose survivor layer is built
by **cloning** the standing board (`initTumbleBoardBase` reads `boardRaw()` and makes fresh
`TumbleSymbol`s). Then the reverse on the way back. A new component starts its clip at frame one.

Note what is NOT the cause: replacing a cell's *data* is already safe. `setSymbolsWithRawSymbols`
builds fresh cell objects, but both `{#each}`s over a strip are index-keyed, so Svelte reuses the
component and `getSymbolInfo`'s memo keeps the resolved art referentially stable
([#628](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/628)). An unchanged symbol
survives a settle. What it cannot survive is its component being unmounted.

## Stage 1 — the reel board is hidden, not dismantled (shipped)

`Board.svelte` now stays MOUNTED while the overlay holds the screen and simply stops drawing:

- `BoardContainer` takes an optional `visible`. Absent ⇒ the prop is never assigned
  (`propsSyncEffect` skips `undefined`) ⇒ every other caller keeps the scene graph it had.
- `Board.svelte` mirrors the overlay's own `tumbleBoardShow` / `tumbleBoardHide` (the same trick
  `TumbleBoard` already uses to watch `boardShow` / `boardHide` for its ground tiles) and mounts on
  `show || overlayShown`, drawing on `show`.

**Gated on the overlay on purpose.** `boardHide` is also an authorable Broadcast cue — a doc may hide
the board for a cinematic, a transition, a bonus screen — and those have no reason to keep a board of
spines and flipbooks ticking behind the curtain. Without the overlay this is `{#if show}` exactly as
it was, so a game that never cascades is byte-identical.

This removes the `t=1936` cluster: the hand-over BACK. It does not touch `t=628`, the hand-over OUT,
which is the larger of the two (16 same-art rebuilds against 6).

## Stage 2 — one layer draws the cells (designed, not implemented)

The remaining half cannot be fixed by keeping data stable, because the cell is drawn by a *different
component* before and after. Three things have to be true together, and any one alone buys nothing.

### 1. One cell component

`ReelSymbol.svelte` and `TumbleSymbol.svelte` collapse into one cell. They already differ in only
three ways, and each has an answer:

- **`y`.** The reel cell reads the strip (`symbolY()`, or the seat under perspective at rest); the
  cascade cell reads a Tween. The merged cell takes an optional per-cell **y override** and uses it
  when present. `null` on every game that never cascades.
- **The undrawn gate.** `removed` (the reel's win-explosion pop) and `exploded` (the cascade's
  played-out pop) are the same picture — a cell that holds its slot but draws nothing. They merge
  into `removed`.
- **Which LAYER draws it.** The reel cell puts a spine on the unmasked animating layer only in
  `land` / `win` / `explosion`; the overlay puts EVERY spine there. That difference is itself a
  remount — a symbol that changes layer is re-created — so the merged cell must use one predicate
  throughout. The reel's, widened to the cascade's own states: `land | win | explosion | clearReel |
  intro`. A non-cascading game never reaches the two new ones, so it is byte-identical; a cascading
  one gains masking on a resting spine symbol, which is what the board shows either side of the
  cascade anyway.

### 2. One mount site

`TumbleBoardBase` stops rendering cells; the persistent `BoardBase` renders whichever source owns the
board. `TumbleBoard` keeps its handlers and its transition layer and loses its cells, its ground
tiles and its mask — with the reel board drawing throughout, the overlay's copies of those would be
a second draw of the same thing. Which means:

- `Board.svelte` must DRAW while the overlay is up, not merely stay mounted, so stage 1's
  `visible={show}` becomes unconditional and `BoardContainer`'s new prop is no longer needed.
- The board mask's overflow policy has to follow the owner. `allowOverflow` is gated on reel motion,
  which a swap-in-place board can never answer (it never spins), so the mask takes the overlay's
  transit counter — `overlaySettled`, which already exists — whenever the cascade owns the board.
  The counter moves from `TumbleBoard` into `stateTumble` so both can read it.

### 3. One cell object, KEYED BY IDENTITY

This is the part the first draft of this document got wrong, and the reason it is worth writing down.

The overlay must ADOPT the reel cells rather than clone them — otherwise the `{#each}`'s keys change
at the hand-over and the components are rebuilt anyway. But adoption alone is not enough, because the
cascade also REORDERS cells: refills splice in above the survivors (`combineTumbleReel`), so a
survivor's index moves. Under the index keying `BoardBase` uses today, a cell that changes index is
handed to a different component — which is the same tear-down by another name. `TumbleBoardBase` keys
by object identity for exactly this reason, and that property must survive the merge.

So `BoardBase` keys by the cell object, and every seam that replaces the strip has to preserve
identity or it becomes a board-wide rebuild of its own:

- **The settle** (`boardSettle` → `setSymbolsWithRawSymbols`) currently mints fresh cells. During a
  cascade the reel must instead ADOPT the cells the cascade is already drawing — they are the same
  symbols on the same seats. That needs the cascade to mint its `adding` cells through the reel's own
  factory, so the two sides trade one shape of object. `createReelForSpinning` exports the factory
  and an adopt entry point; `enhancedBoard` grows `adopt(cells)` beside `settle(board)`.
- **The spin** (`prepareToSpin`) mints a fresh strip, and that one is fine: every symbol goes to the
  `spin` state in the same breath, so the art changes anyway. The settle at the END of a spin
  actually improves — `targetSymbols` are the same objects the spin strip carried, so identity keying
  MOVES them where index keying re-created them.

### What stage 2 does not change

`stateTumble` keeps both layers. The reel strip, the roll and the pre-spin are untouched — this
shares the **settled** cell, which is the only thing both presenters ever draw. The y override is
`null` and the cascade state is empty on every game that never cascades.

**The risk to weigh.** `perspective-board-mode.md` deliberately kept the two models apart: "reusing
the reel model would mean teaching it to delete cells mid-flight, which is exactly the coupling that
would put the cascade's risk onto every game that never tumbles." What removal becomes here is a
per-cell MARK, not a splice of the strip — the cascade's own `base` array is what gets filtered, and
the strip is never shortened mid-flight. The coupling that warning is about stays out.

**Verification this needs.** Offline fixtures can pin the cue order and the settle contract, and
`verify-swap-in-place-mode.mjs` already drives the real reveal functions on a virtual clock. What
they cannot check is the picture: whether a survivor's slide still reads, whether the mask still
clips a cascading symbol, whether paint order survives under perspective. Stage 2 must not land
without a browser pass on a cascading board, and the probe below is how to take it.

## How to re-measure

Paste into the game's console, `__p.reset()`, spin once, let it settle, `copy(__p.dump())`.
`MOUNT SAME-ART` is the bug — a cell re-created around art that did not change. `MOUNT NEW-ART` is
correct. Keyed on the cell's own container, so the two draw layers cannot be confused for each other.

```js
window.__p = (() => { const app = window.__PIXI_APP__; const cells = new Map(), lastAt = new Map(), log = []; let t0 = performance.now(); const key = (x, y) => `${Math.round(x / 45) * 45},${Math.round(y / 45) * 45}`; const collect = (n, d, out, parent) => { if (!n || d > 30) return out; if (typeof n.gotoAndPlay === 'function' && 'textures' in n) { out.push({ o: n, kind: 'as', parent }); return out; } if (n.state && n.skeleton && typeof n.state.setAnimation === 'function') { out.push({ o: n, kind: 'spine', parent }); return out; } for (const c of n.children || []) collect(c, d + 1, out, n); return out; }; const sig = (e) => { if (e.kind === 'as') { const t = e.o.textures || []; const f = t[0]; return String((f && (f.label || (f.source && f.source.label))) || '?').replace(/_?\d{4}$/, ''); } const tr = e.o.state && e.o.state.tracks && e.o.state.tracks[0]; return `sp:${(tr && tr.animation && tr.animation.name) || '-'}`; }; const tick = () => { try { const t = Math.round(performance.now() - t0), seen = new Set(); for (const e of collect(app.stage, 0, [], null)) { const cell = e.parent || e.o; seen.add(cell); const s = sig(e); let x = 0, y = 0; try { const g = e.o.getGlobalPosition(); x = g.x; y = g.y; } catch {} const pos = key(x, y); let rec = cells.get(cell); if (!rec) { const prev = lastAt.get(pos); log.push(`${t} ${pos} MOUNT ${prev === undefined ? 'FIRST' : (prev === s ? 'SAME-ART' : 'NEW-ART')} ${s}`); cells.set(cell, { sig: s, pos, sprite: e.o }); lastAt.set(pos, s); continue; } if (rec.sprite !== e.o) { log.push(`${t} ${pos} RESTATE ${rec.sig}>${s}`); rec.sprite = e.o; rec.sig = s; } rec.pos = pos; lastAt.set(pos, s); } for (const [cell, rec] of cells) if (!seen.has(cell)) { log.push(`${t} ${rec.pos} UNMOUNT ${rec.sig}`); cells.delete(cell); } } catch (err) { log.push('ERR ' + err); } }; app.ticker.add(tick); return { tick, reset: () => { log.length = 0; t0 = performance.now(); }, dump: () => log.join('\n'), counts: () => { const c = {}; for (const l of log) { const p = l.split(' '); const w = p[2] === 'MOUNT' ? 'MOUNT:' + p[3] : p[2]; c[w] = (c[w] || 0) + 1; } return c; } }; })();
```

Two notes if you drive it from a headless/hidden pane rather than by hand: `requestAnimationFrame`
callbacks registered from an injected context never fire there, which is why the probe rides
`app.ticker` instead — and the ticker itself only advances while something forces a frame, so
sample with `app.ticker.update(performance.now())` in a loop, or take screenshots.
