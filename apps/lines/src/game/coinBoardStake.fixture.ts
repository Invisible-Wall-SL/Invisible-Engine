/**
 * Offline fixture for the STAKE UNDER A PLAYER-PICKED LINE COUNT (`coinBoardStake.ts`, design
 * `hold-and-win-coin-board.md` §1.3, Phase 13d).
 *
 *   pnpm check:all --only coinBoardStake
 *
 * FOUR claims:
 *
 *  1. THE STAKE IS EXACT. Every rung of the placeholder ladder × every line count is a stake whose
 *     wire bet (`requestBet`: `[lines, max(1, round(cents / lines))]`) charges exactly that stake —
 *     no float residue (`0.1 × 3`) reaches the wire or the HUD.
 *  2. THE BET PER LINE SURVIVES A LINE CHANGE. `setCoinBoardLineCount` re-derives the stake from the
 *     current one; walking 5 → 1 → 3 → 5 lines keeps the rung the player chose.
 *  3. THE SELECTOR STEPS THROUGH THE CHOICES and stops at both ends.
 *  4. A RESUMED ROUND KEEPS ITS COUNT: the base reveal's `paylineIds`, when it is one of the choices.
 */

import {
	coinBoardBetPerLine,
	coinBoardLadder,
	coinBoardResumedLines,
	coinBoardStake,
	coinBoardStepLines,
} from './coinBoardStake.ts';

let passes = 0;
const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) passes += 1;
	else failures.push(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** The facade's placeholder ladder, in dollars (`engineFacade.ts` `requestAuthenticate`). */
const LADDER = [0.1, 0.2, 0.5, 1, 2, 5, 10, 50, 100];
/** What `requestBet` charges for a total, in cents: lines × round(cents / lines). */
const charged = (total: number, lines: number) =>
	lines * Math.max(1, Math.round(Math.max(1, Math.round(total * 100)) / lines));

// 1. Exact stakes.
for (const lines of [1, 2, 3, 5, 7, 10, 20, 25]) {
	const totals = coinBoardLadder(LADDER, lines);
	check(
		`${lines} lines: the ladder is lines × every rung`,
		totals,
		LADDER.map((level) => Math.round(level * lines * 100) / 100),
	);
	check(
		`${lines} lines: every stake is charged exactly`,
		totals.map((total) => charged(total, lines)),
		totals.map((total) => Math.round(total * 100)),
	);
	check(
		`${lines} lines: every stake gives back its rung per line`,
		totals.map((total) => coinBoardBetPerLine(total, lines)),
		LADDER,
	);
}
check('0.1 × 3 carries no float residue', coinBoardStake(0.1, 3), 0.3);

// 2. A line change keeps the bet per line (the setter's own arithmetic, in its order).
let lines = 5;
let stake = coinBoardStake(0.2, lines);
const walk: number[] = [];
for (const next of [1, 3, 5]) {
	stake = coinBoardStake(coinBoardBetPerLine(stake, lines), next);
	lines = next;
	walk.push(stake);
}
check('5 → 1 → 3 → 5 lines at $0.20 a line', walk, [0.2, 0.6, 1]);

// 3. Stepping.
const CHOICES = [5, 1, 3];
check('up from 1', coinBoardStepLines(CHOICES, 1, 1), 3);
check('up from 3', coinBoardStepLines(CHOICES, 3, 1), 5);
check('up from 5 (the end)', coinBoardStepLines(CHOICES, 5, 1), undefined);
check('down from 5', coinBoardStepLines(CHOICES, 5, -1), 3);
check('down from 1 (the end)', coinBoardStepLines(CHOICES, 1, -1), undefined);
check('the stepped choices are not reordered', CHOICES, [5, 1, 3]);

// 4. A resumed round.
const reveal = (ids: string[]) => ({ type: 'reveal', paylineIds: ids });
check(
	'resumed at 3 lines',
	coinBoardResumedLines([{ type: 'bet' }, reveal(['1', '4', '5'])], CHOICES),
	3,
);
check(
	'a count that is not a choice',
	coinBoardResumedLines([reveal(['1', '4'])], CHOICES),
	undefined,
);
check('a reveal with no lines', coinBoardResumedLines([{ type: 'reveal' }], CHOICES), undefined);
check('no round to resume', coinBoardResumedLines(undefined, CHOICES), undefined);

console.log(`\n${passes} coin board stake checks passed, ${failures.length} failed.`);
if (failures.length) throw new Error(failures.join('\n'));
