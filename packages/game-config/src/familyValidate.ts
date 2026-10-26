import {
	ARCADE_FIXED_HZ_RANGE,
	ARCADE_ONLINE_DEFAULTS,
	ARCADE_ONLINE_LIMITS,
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
			message: goals?.length
				? 'No moves limit, so a round only ends when its goals are reached.'
				: 'No moves limit and no goal, so a round never ends.',
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
	const { fixedHz, bodies, pairs, zones } = resolveArcade(doc);
	// A pair naming a tag no body carries never collides: almost always a typo.
	const carried = new Set(Object.values(bodies).flatMap((body) => body.tags ?? []));
	pairs.forEach((pair, i) => {
		const missing = pair.filter((tag) => !carried.has(tag));
		if (missing.length) {
			issues.push({
				severity: 'warning',
				path: `arcade.pairs[${i}]`,
				message: `No body has the tag ${[...new Set(missing)].map((t) => `"${t}"`).join(' or ')}, so ${pair.join(' + ')} never collides.`,
			});
		}
	});
	const field = doc.arcade?.field;
	zones.forEach((zone, i) => {
		if (
			field &&
			(zone.x >= field.w || zone.y >= field.h || zone.x + zone.w <= 0 || zone.y + zone.h <= 0)
		) {
			issues.push({
				severity: 'warning',
				path: `arcade.zones[${i}]`,
				message: `The zone "${zone.id}" lies wholly outside the play field, so no body can enter it.`,
			});
		}
	});
	if (fixedHz < ARCADE_FIXED_HZ_RANGE.min || fixedHz > ARCADE_FIXED_HZ_RANGE.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.fixedHz',
			message: `The simulation steps ${fixedHz} times a second; between ${ARCADE_FIXED_HZ_RANGE.min} and ${ARCADE_FIXED_HZ_RANGE.max} keeps motion smooth on every device.`,
		});
	}
	issues.push(...validateArcadeOnline(doc, bodies));
	return issues;
}

/** An online arcade game (P10.14): what its room on the game server needs. */
function validateArcadeOnline(
	doc: GameConfigDoc,
	bodies: Record<string, unknown>,
): GameConfigIssue[] {
	const online = doc.arcade?.online;
	if (!online) return [];
	const issues: GameConfigIssue[] = [];
	const field = doc.arcade?.field;
	if (!field) {
		issues.push({
			severity: 'error',
			path: 'arcade.field',
			message: 'An online game needs a field size: the game server has no screen to take it from.',
		});
	}
	if (!online.characters.length) {
		issues.push({
			severity: 'error',
			path: 'arcade.online.characters',
			message: 'An online game needs at least one character for its players to be.',
		});
	}
	online.characters.forEach((character, i) => {
		if (!(character.body in bodies)) {
			issues.push({
				severity: 'error',
				path: `arcade.online.characters[${i}]`,
				message: `The character "${character.id}" is the body "${character.body}", which no arcade body names, so the server cannot place it.`,
			});
		}
		const { min, max } = ARCADE_ONLINE_LIMITS.speed;
		if (character.speed < min || character.speed > max) {
			issues.push({
				severity: 'warning',
				path: `arcade.online.characters[${i}].speed`,
				message: `The character "${character.id}" moves at ${character.speed} px/s; a room holds it to ${min}–${max}.`,
			});
		}
	});
	if (online.characters.length > ARCADE_ONLINE_LIMITS.characters.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.characters',
			message: `A room offers at most ${ARCADE_ONLINE_LIMITS.characters.max} characters; the rest are not playable.`,
		});
	}
	const ranged = ['maxPlayers', 'tickHz', 'subSteps', 'patchHz', 'rejoinSeconds'] as const;
	for (const key of ranged) {
		const value = online[key] ?? ARCADE_ONLINE_DEFAULTS[key];
		const { min, max } = ARCADE_ONLINE_LIMITS[key];
		if (value < min || value > max) {
			issues.push({
				severity: 'warning',
				path: `arcade.online.${key}`,
				message: `${key} is ${value}; a room holds it to ${min}–${max}.`,
			});
		}
	}
	const tickHz = online.tickHz ?? ARCADE_ONLINE_DEFAULTS.tickHz;
	const patchHz = online.patchHz ?? ARCADE_ONLINE_DEFAULTS.patchHz;
	if (patchHz > tickHz) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.patchHz',
			message: `State is sent ${patchHz} times a second but the room steps only ${tickHz} times, so a room sends it ${tickHz} times.`,
		});
	}
	const spawn = online.spawn;
	if (spawn && field && (spawn.x < 0 || spawn.y < 0 || spawn.x > field.w || spawn.y > field.h)) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.spawn',
			message: 'Players start outside the play field; a clamped body is pulled inside at once.',
		});
	}
	return issues;
}
