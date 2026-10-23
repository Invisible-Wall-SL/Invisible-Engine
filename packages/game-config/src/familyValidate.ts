import {
	ARCADE_FIXED_HZ_RANGE,
	resolveArcade,
	resolveFamily,
	resolveMatch3,
	resolveOutcome,
} from './family';
import { resolveGrid } from './grid';
import { symbolsInPlay } from './inPlay';
import type { GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

/**
 * What is wrong with a match-3 or arcade doc as that family (`docs/design/game-families.md` §2.1).
 * Nothing for a slot: every slot check lives where it always did, in `validateGameConfigDoc`.
 */
export function validateFamily(doc: GameConfigDoc): GameConfigIssue[] {
	const family = resolveFamily(doc);
	if (family === 'match3') return validateMatch3(doc);
	if (family === 'arcade') return validateArcade(doc);
	return [];
}

function validateMatch3(doc: GameConfigDoc): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	const grid = resolveGrid(doc);
	const { minRun, moves, goals, scoreTable } = resolveMatch3(doc);

	// The board module is rectangular in v1: gems fall straight down a column of the board's height.
	if (grid.stepped) {
		issues.push({
			severity: 'error',
			path: 'numRows',
			message: 'A match-3 board is rectangular: give every column the same number of rows.',
		});
	}
	if (minRun > Math.max(grid.reels, grid.maxRows)) {
		issues.push({
			severity: 'error',
			path: 'match3.minRun',
			message: `A match needs ${minRun} gems in a row, but the board is ${grid.reels} × ${grid.maxRows}, so nothing can ever match.`,
		});
	}
	if (resolveOutcome(doc) !== 'rules') return issues;

	// The rules-only fields: in an RGS game the server sends the moves and the paytable prices wins.
	if (moves === undefined) {
		issues.push({
			severity: 'warning',
			path: 'match3.moves',
			message: 'No moves limit, so a round only ends when a goal is reached.',
		});
	}
	const inPlay = new Set(symbolsInPlay(doc));
	const scores = Object.keys(scoreTable ?? {}).map(Number);
	(goals ?? []).forEach((goal, index) => {
		if (goal.type === 'collect' && !inPlay.has(goal.symbol)) {
			issues.push({
				severity: 'error',
				path: `match3.goals.${index}`,
				message: `The goal collects ${goal.symbol}, which no column's strip deals, so it can never be met.`,
			});
		}
		if (goal.type === 'score' && !scores.some((run) => run >= minRun && scoreTable?.[run])) {
			issues.push({
				severity: 'error',
				path: `match3.goals.${index}`,
				message:
					'The goal is a score, but no run length scores any points, so it can never be met.',
			});
		}
	});
	for (const run of scores.filter((length) => length < minRun)) {
		issues.push({
			severity: 'warning',
			path: `match3.scoreTable.${run}`,
			message: `A run of ${run} scores points, but a match needs at least ${minRun}, so it never scores.`,
		});
	}
	return issues;
}

function validateArcade(doc: GameConfigDoc): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	// An RGS-decided arcade game is the optional P10.10; until it exists an arcade game is free play.
	if (resolveOutcome(doc) !== 'rules') {
		issues.push({
			severity: 'error',
			path: 'outcome',
			message:
				'An arcade game decided by the RGS is not built yet, so an arcade game is decided by its own rules.',
		});
	}
	const { fixedHz } = resolveArcade(doc);
	if (fixedHz < ARCADE_FIXED_HZ_RANGE.min || fixedHz > ARCADE_FIXED_HZ_RANGE.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.fixedHz',
			message: `The simulation steps ${fixedHz} times a second; between ${ARCADE_FIXED_HZ_RANGE.min} and ${ARCADE_FIXED_HZ_RANGE.max} keeps motion smooth on every device.`,
		});
	}
	return issues;
}
