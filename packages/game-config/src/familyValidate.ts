import { DEFAULT_ARCADE_TARGET_TAG, type ArcadeCharacter } from './arcadeCharacters';
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
	const { fixedHz, bodies, pairs, zones, characters } = resolveArcade(doc);
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
	issues.push(...validateCharacters(characters, bodies, carried));
	return issues;
}

/** The behaviours that look for the nearest body with a tag, and the tag they look for unset. */
const TARGETING = new Set(['chase', 'flee']);

function validateCharacters(
	characters: ArcadeCharacter[],
	bodies: Record<string, unknown>,
	carried: Set<string>,
): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	const error = (path: string, message: string) =>
		issues.push({ severity: 'error', path, message });
	const warn = (path: string, message: string) =>
		issues.push({ severity: 'warning', path, message });
	const ids = new Set<string>();
	const looks = new Map<string, string>();
	characters.forEach((character, i) => {
		const at = `arcade.characters[${i}]`;
		if (ids.has(character.id)) {
			error(`${at}.id`, `Two characters are called "${character.id}"; give each its own id.`);
		}
		ids.add(character.id);
		const look = character.component?.trim();
		if (!look) {
			error(`${at}.component`, `"${character.id}" has no component, so nothing can show it.`);
		} else if (looks.has(look)) {
			error(
				`${at}.component`,
				`"${character.id}" and "${looks.get(look)}" both use the component "${look}"; a component is one character.`,
			);
		} else {
			looks.set(look, character.id);
		}
		if (character.controller && look && !Object.hasOwn(bodies, look)) {
			warn(
				`${at}.controller`,
				`"${character.id}" is played, but its component "${look}" has no body, so it walks through everything and touches nothing.`,
			);
		}
		const brain = character.brain;
		const states = new Set((brain?.states ?? []).map((s) => s.id));
		if (brain && !states.has(brain.initial)) {
			error(
				`${at}.brain.initial`,
				`The brain starts in "${brain.initial}", which is not one of its states.`,
			);
		}
		brain?.transitions.forEach((transition, j) => {
			const unknown = [
				transition.from === '*' || states.has(transition.from) ? '' : transition.from,
				states.has(transition.to) ? '' : transition.to,
			].filter(Boolean);
			if (unknown.length) {
				error(
					`${at}.brain.transitions[${j}]`,
					`The transition "${transition.id}" names ${[...new Set(unknown)].map((s) => `"${s}"`).join(' and ')}, which is not a state of this brain.`,
				);
			}
		});
		brain?.states.forEach((state, k) => {
			const path = `${at}.brain.states[${k}]`;
			if (TARGETING.has(state.behaviour)) {
				const tag = state.params?.tag;
				const target =
					typeof tag === 'string' && tag.trim() ? tag.trim() : DEFAULT_ARCADE_TARGET_TAG;
				if (!carried.has(target)) {
					warn(
						path,
						`The state "${state.id}" ${state.behaviour === 'chase' ? 'chases' : 'flees'} bodies tagged "${target}", but no body has that tag, so it never moves.`,
					);
				}
			}
			if (state.behaviour === 'shootAt') {
				const missing = (['component', 'layer'] as const).filter((key) => {
					const value = state.params?.[key];
					return typeof value !== 'string' || !value.trim();
				});
				if (missing.length) {
					warn(
						path,
						`The state "${state.id}" shoots, but names no ${missing.join(' and no ')}, so it never fires.`,
					);
				}
			}
		});
		for (const [input, source] of Object.entries(character.animInputs ?? {})) {
			if (source.startsWith('state:') && !states.has(source.slice('state:'.length))) {
				warn(
					`${at}.animInputs.${input}`,
					`The input "${input}" follows the brain state "${source.slice('state:'.length)}", which ${brain ? 'the brain does not have' : 'does not exist: the character has no brain'}, so it is always false.`,
				);
			}
		}
	});
	return issues;
}
