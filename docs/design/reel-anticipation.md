# Reel anticipation — a client-computed, escalating tease mode

> Status: DESIGN (2026-08-04, owner-requested). Branch `engine/reel-anticipation-mode`.
> Phase 0 = this doc. Nothing shipped yet. Off by default → byte-parity when unauthored, the
> same discipline as [sequential reel stop](../../packages/utils-slots/src/createEnhanceBoardSpin.ts).

## The ask

Add reel **anticipation** as a swappable **mode** (like sequential reel stop — enable/disable +
signal-driven), but a much richer one than Stake's built-in:

- **Client-computed from the final board**, not a server `anticipation[]` flag.
- **Per reel column.** As reels settle one by one, decide per reel whether a qualifying win is
  still reachable from the reels not yet stopped.
- **Self-arming:** activate the moment a possible win can still trigger.
- **Self-disarming:** deactivate the instant no more qualifying win can be triggered.
- **Stacking / escalating FX:** each new win-possibility adds a layer — more anticipation spines,
  screen FX, and a zoom-in on the reels for suspense.
- **Tier-gated:** only arm once the _reachable_ win reaches the smallest **big-win tier**; add
  more FX for mega / massive. Ties into the config-authored `winLevels` tiers.
- **Grey-out** the reels we are NOT anticipating on.
- **Authored from Flow** (via the presentation state machine) with the per-reel overlay + FX
  configured in the **Symbols SM editor**.

This is the classic reel-tease mechanic (Gates of Olympus slowing the last reels, Book-of games
teasing the 3rd book). Stake's SDK ships only a thin, server-driven, binary version of it.

## What exists today (and why it's not enough)

- The RGS book carries `revealEvent.anticipation: number[]` — one flag per reel
  (`apps/lines/src/game/typesBookEvent.ts`).
- `createEnhanceBoardSpin.ts` reads it: from the first anticipated reel onward it sets `noStop`,
  and as each reel lands (`onSpinFinishing`) it arms `reelState.anticipating = true` on the NEXT
  reel.
- `Anticipations.svelte` / `Anticipation.svelte` render **one fixed spine overlay + one looping
  SFX** per anticipating reel. No stacking, no tiers, no zoom, no grey-out, no client calculation.
- `sequentialReelStop` is the mode template to copy: `enable/disableSequentialReelStop` effects
  (`flowEffects.ts`), v2 vocab palette entries (`engine-flow-v2/src/reference/bookOf.ts`), and
  `stateGame` flags, all off by default.

The gap: everything above is **server-driven and binary**. The new mode is **client-computed,
graded, and escalating**.

## Core idea — a reachable-win calculator with two bounds

The final board is fully known at reveal time (`revealEvent.board`). As reels lock left-to-right,
the set of still-achievable wins narrows. We compute, after _k_ reels are locked, the win **bounds**
still achievable from the reels not yet stopped, expressed as a **total-bet multiplier** (the same
quantity `resolveWinLevel` thresholds against):

```
bounds(lockedReelCount) → { min: number, max: number }
```

- **`max`** = optimistic: assume every not-yet-stopped reel lands the best-paying continuation.
  Starts high, collapses toward the true final win as reels lock.
- **`min`** = guaranteed: assume every not-yet-stopped reel lands the worst continuation. Starts at
  0 (or the already-locked wins), rises to the true final win.

A single bound pair yields **both honesty modes** the owner asked for, as a config enum
`anticipationConfidence`:

| confidence   | arm while …                      | feel                                                                                       |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `possible`   | `max ≥ smallestBigTierThreshold` | Suspenseful. Teases near-misses; drops the instant a landed reel kills every big-win line. |
| `guaranteed` | `min ≥ smallestBigTierThreshold` | Honest. Only fires once the big win is locked in; never lies, never spoils early.          |

The **tier** shown at any moment = `resolveWinLevel(activeBound)` where `activeBound` is `max`
(possible) or `min` (guaranteed) — so the escalation naturally climbs big → mega → massive as the
reachable ceiling/floor crosses each threshold. The **stack level** = how many big-tier steps are
still reachable (drives how many FX layers stack).

### Lines reachable-win math (the first concrete implementation)

Reads paylines + paytable from the active game config (`config.ts` `paylines`, `paytable.ts`) —
**no hardcoded symbol ids**. For each payline (a row-index array per reel):

- Walk reels left→right. The line's win depends on the run length of a single symbol (wilds
  substitute) starting at reel 0. Paytable rows give pay at run-length 3/4/5 in **bet-per-line**
  units; divide by `numLines` for the total-bet multiplier.
- **`max` for a line** given reels `0..k` locked: for every candidate symbol still viable at reel 0
  (i.e. the locked cells `0..k` on that line are all that symbol or wild), assume the unlocked
  reels all continue it → take the best line pay. If the run already broke within `0..k`, the line
  is capped at its locked run.
- **`min` for a line**: use the ACTUAL symbols on the unlocked reels too (final board is known) —
  which is just that line's true final pay. (`min` = the win that is already guaranteed regardless
  of tease framing.)
- Board `max`/`min` = sum over paylines (+ scatter row if the scatter can still reach its pay
  count). Scatter reachability also feeds the **feature-trigger** tease when the game wants it.

Ways / cluster / scatter games each get their own `AnticipationReach` implementation behind the
same interface, later. Lines first — that's the Book-of remake.

## Where each piece lives

### 1. Calculator (pure, `packages/utils-slots/src/anticipationReach.ts`)

```ts
export interface AnticipationReach {
	bounds(lockedReelCount: number): { min: number; max: number }; // total-bet multiplier
}
export function createLinesReach(args: {
	board: RawSymbol[][]; // final revealed board
	paylines: number[][]; // row index per reel
	linePay: (symbol, runLength) => number; // bet-per-line units
	numLines: number;
	isWild: (symbol) => boolean;
}): AnticipationReach;
```

Node-fixture tested against real Borut books BEFORE any UI. Dependency-free like the rest of the
package.

### 2. Per-reel state (`stateGame` + `reelState`)

- `reelState.anticipationLevel: number` (stack count, 0 = off)
- `reelState.anticipationTier: 'big' | 'mega' | 'massive' | null`
- `stateGame.anticipationMode: boolean` + `anticipationConfidence: 'possible' | 'guaranteed'` +
  tier gate + zoom/grey-out toggles, all set by the Flow effect.

Arms/disarms at the SAME hook the binary flag uses today, in `createEnhanceBoardSpin` — the new
mode and the server-driven mode share one code path. When `anticipationMode` is off, the arming
block is skipped entirely (byte-parity).

### 3. Presentation (escalation)

Driven by an XState presentation machine reacting to level/tier changes ("using the help of the
state machine"):

- **Spine stack** — N overlays per reel, N = `anticipationLevel`.
- **Grey-out** — a `ColorMatrixFilter` desaturate + dim on reels NOT in the anticipating set.
- **Zoom** — a board-container scale/pan toward the anticipating reels (a `ZoomController`).
- **Screen FX + tier extras** — mega / massive add layers.

### 4. Authoring surfaces

- **Symbols SM editor** (`/symbols`) owns the per-reel overlay: which anticipation spine, and the
  FX-per-tier mapping — exactly as it already owns the win-frame highlight spine.
- **Flow** (`/flow-v2`) owns the mode: `enableAnticipationMode` / `disableAnticipationMode`
  effects (payload: confidence, tier gate, zoom, grey-out) + v2 vocab palette entries + live
  signals, modelled on `enableSequentialReelStop`.
- **Off by default → byte-parity** when unauthored.

## Build plan (phases)

0. **Design doc** (this file). ✅
1. **Calculator** — `anticipationReach.ts` (lines impl) + Node fixture test (`possible` + `guaranteed`
   bounds vs real books). Pure, no UI — prove the math first.
2. **State wiring** — `anticipationLevel`/`anticipationTier` in `reelState`; arm/disarm in
   `createEnhanceBoardSpin`; the `possible`/`guaranteed` switch.
3. **Presentation** — spine stacking, grey-out filter, zoom controller, tier FX; XState escalation
   machine.
4. **Flow mode** — enable/disable effects, vocab palette, signals.
5. **Symbols SM authoring** — overlay spine + tier-FX config in the `/symbols` doc + bake/pull/register.
6. **Ship** — runtime release + refresh + submodule bump; update `docs/status/engine.md` +
   `docs/status/symbols.md`.

## Non-goals / open questions

- Ways/cluster/scatter reachability math (interface is designed for it; implementations deferred).
- Whether the feature-trigger (scatter-count) tease is a separate arming source layered on top of
  the big-win-amount tease, or folded into `bounds` via the scatter row. Start with the big-win
  amount; add scatter-count arming if the owner wants the Book-of 3rd-book tease too.
- Zoom framing when anticipating reels are non-contiguous (e.g. reels 0 and 4) — likely zoom to the
  bounding span; revisit in Phase 3.
