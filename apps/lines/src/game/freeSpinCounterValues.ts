/**
 * The free-spin counter's readable values — the ONE home for "how many spins, and which one".
 *
 * Two independent consumers read this: the Flow's `$engine.freeSpinsRemaining`/`freeSpinsTotal`
 * engine reads (`flowRuntime.svelte.ts`, so a flow can branch on the count) and the editor-bindable
 * `freeSpinsRemaining`/`freeSpinsCurrent` component value sources (`Game.svelte`, so an authored
 * readout can render it). They MUST agree — a flow branching on "2 left" while the panel shows "3"
 * is the kind of drift nobody notices until a player does — so the expression lives here once
 * rather than being copied into both.
 *
 * FINITE-GUARDED, because the underlying `stateUi` fields are not trustworthy numbers. The effects
 * that write them (`setFreeSpinCounterTotal`, `updateFreeSpinCounter` in `flowEffects.ts`) take an
 * `unknown` flow payload and assert `payload.total as number` — so an unfilled or cross-event flow
 * pin writes `undefined`, and `undefined + 1` writes `NaN`, straight past a field declared `0`.
 * `Math.max(NaN, 0)` is `NaN`, so an unguarded read renders the literal text "NaN" to the player.
 * The authoring bug behind that is now caught by the flow validator (`signal-cross-event`), and the
 * `as number` assertions at the effect boundary are deliberately left LOUD rather than coerced —
 * but a player-facing readout should degrade to a sane number, not to "NaN".
 */

import { stateUi } from 'state-shared';

/** `n` when it is a real number, else `fallback` — the guard over the `as number` effect boundary. */
const finite = (n: number, fallback = 0): number => (Number.isFinite(n) ? n : fallback);

/** The free spins awarded for this session. */
export const freeSpinsTotal = (): number => finite(stateUi.freeSpinCounterTotal);

/** The free spin being played — counts UP from 1. */
export const freeSpinsCurrent = (): number => finite(stateUi.freeSpinCounterCurrent);

/** The free spins still to play — counts DOWN to 0, never negative. */
export const freeSpinsRemaining = (): number => Math.max(freeSpinsTotal() - freeSpinsCurrent(), 0);
