/**
 * Offline fixture for the AUTHORED WIN-BEAT BUDGET (Invisible Symbols → "Cap each win at").
 *
 * WHAT IT PROVES, in two parts.
 *
 *   1. `resolveWinBeatBudget` resolves the three numbers `Board.svelte` races against, and the
 *      UNSET case is byte-parity with the constants that shipped before the knob existed. That
 *      parity is the whole safety argument for putting a shaper next to a runaway guard: every
 *      project that never opens the setting must keep the pacing it has, in the shared
 *      `_runtime/lines` bundle every online game boots.
 *
 *      The two clamps are the part worth a fixture. `WIN_BEAT_MIN_MS` is a `Promise.all` PARTNER,
 *      not a `Math.min` — so an unclamped floor silently ignores any budget set below it and an
 *      author who types 300 still waits 650, with nothing anywhere to say why. Same for the
 *      unauthored fallback: it exists so a cell that can never report `oncomplete` costs the short
 *      transit beat instead of the guard, and it must not become the LONGEST thing a budgeted spin
 *      waits for.
 *
 *   2. THE CALL SITES ACTUALLY USE IT. This half exists because of PR #613 — two `verify-*` guards
 *      were slicing source that had moved and so guarded nothing. A budget that resolves perfectly
 *      and is then not passed to `awaitSymbolBeat` is exactly that failure, and it is invisible in
 *      a unit assertion. So the real `Board.svelte` is read and checked: both beats must take their
 *      cap from the budget, and NEITHER may still pass the bare `WIN_BEAT_CAP_MS`/`WIN_BEAT_MIN_MS`
 *      constant, which is what "the knob is wired" means here.
 *
 * Run: apps/launcher-api/node_modules/.bin/tsx scripts/verify-win-beat-budget.mts
 */

import { readFileSync } from 'node:fs';

import {
	resolveWinBeatBudget,
	TRANSIT_BEAT_CAP_MS,
	WIN_BEAT_CAP_MS,
	WIN_BEAT_MIN_MS,
} from '../apps/lines/src/game/symbolBeat';

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failures += 1;
	console.log(
		`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
	);
};

// 1. PARITY — an unauthored project gets exactly the constants it always had.
assert('unset ⇒ the coded guard', resolveWinBeatBudget(undefined).capMs, WIN_BEAT_CAP_MS);
assert('unset ⇒ the coded floor', resolveWinBeatBudget(undefined).minMs, WIN_BEAT_MIN_MS);
assert(
	'unset ⇒ the short beat for an unauthored cell',
	resolveWinBeatBudget(undefined).unauthoredMs,
	TRANSIT_BEAT_CAP_MS,
);

// 2. A BUDGET ABOVE THE FLOOR only lowers the ceiling — floor and fallback are untouched.
assert('a 2000ms budget caps the beat', resolveWinBeatBudget(2000).capMs, 2000);
assert('…and keeps the readable floor', resolveWinBeatBudget(2000).minMs, WIN_BEAT_MIN_MS);
assert(
	'…and keeps the unauthored fallback',
	resolveWinBeatBudget(2000).unauthoredMs,
	TRANSIT_BEAT_CAP_MS,
);

// 3. A BUDGET BELOW THE FLOOR drags the floor and the fallback down with it. Without this the
//    setting is a lie under ~650ms: `Promise.all` would settle on the floor, not the budget.
assert('a 300ms budget caps the beat', resolveWinBeatBudget(300).capMs, 300);
assert('…and clamps the floor to it', resolveWinBeatBudget(300).minMs, 300);
assert('…and clamps the unauthored fallback to it', resolveWinBeatBudget(300).unauthoredMs, 300);

// 4. THE BOUNDARY — exactly the floor is not "below" it.
assert('a budget equal to the floor leaves it alone', resolveWinBeatBudget(WIN_BEAT_MIN_MS).minMs, WIN_BEAT_MIN_MS); // prettier-ignore

// 5. THE CALL SITES — see the header. Read the real component, not a copy of it.
const board = readFileSync(
	new URL('../apps/lines/src/components/Board.svelte', import.meta.url),
	'utf8',
);
assert('Board resolves a budget for the win beat', board.includes('resolveWinBeatBudget(bakedWinBeatMaxMs())'), true); // prettier-ignore
assert('the win beat races the budget', /budget\.capMs\s*\n?\s*:\s*budget\.unauthoredMs/.test(board), true); // prettier-ignore
assert('the win beat floors on the budget', board.includes('waitForTimeout(budget.minMs)'), true);
assert(
	'no bare WIN_BEAT_CAP_MS survives at a call site',
	/awaitSymbolBeat\([^)]*WIN_BEAT_CAP_MS/.test(board),
	false,
);
assert('no bare WIN_BEAT_MIN_MS survives at a call site', board.includes('waitForTimeout(WIN_BEAT_MIN_MS)'), false); // prettier-ignore
assert(
	'the pop is budgeted too',
	(board.match(/resolveWinBeatBudget\(bakedWinBeatMaxMs\(\)\)/g) ?? []).length,
	2,
);
// The guard is only a guard if the unauthored branch asks the real question, per state.
assert("the win beat asks whether 'win' is authored", board.includes("hasAuthoredSymbolState(reelSymbol.rawSymbol.name, 'win')"), true); // prettier-ignore
assert("the pop asks whether 'explosion' is authored", board.includes("hasAuthoredSymbolState(reelSymbol.rawSymbol.name, 'explosion')"), true); // prettier-ignore

// 6. THE POP SKIPS A CELL IT CANNOT POP — the field bug, pinned.
//
// An unbound `explosion` resolves to the art already on screen, so no renderer re-mounts and no
// `oncomplete` can fire; the pop is ONE concurrent `Promise.all`, so one such winner made every
// paying spin containing it sit out the whole budget showing nothing. On the live `test6` that was
// `L4`, `L5` and the scatter `S` — 4 s of dead hold against 0.5 s for the symbols that do bind it.
// So the branch must RETURN BEFORE the await, and must still mark the cell gone, or the next
// board's clear pops it a second time.
const popBody = board.slice(board.indexOf('boardExplodeWinSymbols:'));
const skipAt = popBody.indexOf("!hasAuthoredSymbolState(reelSymbol.rawSymbol.name, 'explosion')");
const awaitAt = popBody.indexOf('awaitSymbolBeat(');
assert('the pop tests the unauthored case', skipAt >= 0, true);
assert('…and does so BEFORE it would await', skipAt >= 0 && skipAt < awaitAt, true);
const skipBranch = skipAt >= 0 ? popBody.slice(skipAt, awaitAt) : '';
assert('…skipping without a beat', skipBranch.includes('return;'), true);
assert('…but still marking the cell gone', skipBranch.includes('reelSymbol.removed = true;'), true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
