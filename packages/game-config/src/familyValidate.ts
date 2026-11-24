import { validateCardGame } from './cardGame';
import { DEFAULT_ARCADE_TARGET_TAG, type ArcadeCharacter } from './arcadeCharacters';
import {
	ARCADE_FIXED_HZ_RANGE,
	ARCADE_ONLINE_BOT_DEFAULTS,
	ARCADE_ONLINE_DEFAULTS,
	ARCADE_ONLINE_LIMITS,
	ARCADE_POINTER_LIMITS,
	ONLINE_GENERATOR_IDS,
	ONLINE_LINE_MODULE_IDS,
	ONLINE_RULES_MODULE_IDS,
	ONLINE_ZONE_KINDS,
	botShareClasses,
	botShareCounts,
	botsByShares,
	resolveArcade,
	resolveFamily,
	resolveMatch3,
	resolveOutcome,
	type ArcadeOnline,
	type ArcadeOnlineBots,
} from './family';
import { resolveGrid } from './grid';
import { symbolsInPlay } from './inPlay';
import type { GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

/**
 * What is wrong with a match-3, arcade or card doc as that family (`docs/design/game-families.md` §2.1).
 * Nothing for a slot: every slot check lives where it always did, in `validateGameConfigDoc`.
 */
export function validateFamily(doc: GameConfigDoc): GameConfigIssue[] {
	const family = resolveFamily(doc);
	if (family === 'match3') return validateMatch3(doc);
	if (family === 'arcade') return validateArcade(doc);
	if (family === 'card') return validateCard(doc);
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

/** A card game is free play (`card-games.md` §9.1): an RGS-decided one is refused, then the library
 *  and decks are checked. */
function validateCard(doc: GameConfigDoc): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	if (resolveOutcome(doc) !== 'rules')
		issues.push({
			severity: 'error',
			path: 'outcome',
			message: 'A card game is decided by its own rules: set the outcome to Rules.',
		});
	return [...issues, ...validateCardGame(doc)];
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
	issues.push(...validateOfflineAbilities(doc));
	issues.push(...validateArcadeOnline(doc, bodies));
	return issues;
}

/** The offline abilities and zone forces (P11.5): names that exist, numbers in range; an online
 *  game plays its rules' instead, so it is warned that these do nothing. */
function validateOfflineAbilities(doc: GameConfigDoc): GameConfigIssue[] {
	const abilities = doc.arcade?.abilities ?? [];
	const forces = doc.arcade?.forces ?? [];
	if (!abilities.length && !forces.length) return [];
	const issues: GameConfigIssue[] = [];
	const characters = new Set((doc.arcade?.characters ?? []).map((c) => c.id));
	const zones = new Set((doc.arcade?.zones ?? []).map((z) => z.id));
	const L = ARCADE_ONLINE_LIMITS;
	const unknown = (list: readonly string[], path: string) => {
		for (const id of list)
			if (!characters.has(id))
				issues.push({ severity: 'error', path, message: `No character is "${id}".` });
	};
	if (doc.arcade?.online) {
		for (const [key, list] of [
			['abilities', abilities],
			['forces', forces],
		] as const) {
			if (!list.length) continue;
			issues.push({
				severity: 'warning',
				path: `arcade.${key}`,
				message: `An online game plays its rules' ${key === 'forces' ? 'currents' : 'abilities'} (arcade.online.rules); these do nothing.`,
			});
		}
	}
	abilities.forEach((ability, i) => {
		const path = `arcade.abilities[${i}]`;
		unknown([ability.character], `${path}.character`);
		unknown(ability.targets, `${path}.targets`);
		const ranged = [
			['reach', ability.reach, L.reach],
			['ms', ability.ms, L.effectMs],
			['cooldownMs', ability.cooldownMs, L.cooldownMs],
			['score', ability.score, L.score],
		] as const;
		for (const [key, value, range] of ranged) {
			if (value === undefined || (value >= range.min && value <= range.max)) continue;
			issues.push({
				severity: 'warning',
				path: `${path}.${key}`,
				message: `${key} is ${value}; it is held to ${range.min}–${range.max}.`,
			});
		}
		if (ability.effect === 'hook') {
			issues.push({
				severity: 'warning',
				path: `${path}.effect`,
				message:
					'Offline, a hook only raises `hit` on the nearest target (effect `hook`); there is no line.',
			});
		}
		for (const key of ['ahead', 'onPress'] as const) {
			if (ability[key] === undefined) continue;
			issues.push({
				severity: 'warning',
				path: `${path}.${key}`,
				message: `Offline, \`${key}\` is not played (an online room plays it); it does nothing here.`,
			});
		}
	});
	if (abilities.length > L.abilities.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.abilities',
			message: `At most ${L.abilities.max} abilities play; the rest do nothing.`,
		});
	}
	if (forces.length > L.zoneRules.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.forces',
			message: `At most ${L.zoneRules.max} zone forces push; the rest do nothing.`,
		});
	}
	forces.forEach((rule, i) => {
		const path = `arcade.forces[${i}]`;
		if (!zones.has(rule.zone)) {
			issues.push({
				severity: 'error',
				path,
				message: `The force names the zone "${rule.zone}", which arcade.zones does not have.`,
			});
		}
		unknown(rule.characters ?? [], `${path}.characters`);
		const { x, y } = rule.force;
		if ([x, y].some((v) => v < L.force.min || v > L.force.max)) {
			issues.push({
				severity: 'warning',
				path: `${path}.force`,
				message: `A zone's force is held to ${L.force.min}–${L.force.max} px/s.`,
			});
		}
	});
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
		const controller = character.controller;
		const jump = controller && 'jump' in controller ? controller.jump : undefined;
		if (controller && jump) {
			const wants = controller.kind === 'sideScroll' ? 'gravity' : 'hop';
			if (jump.kind !== wants) {
				error(
					`${at}.controller.jump.kind`,
					`"${character.id}" is a ${controller.kind} character, so its jump is a "${wants}" jump, not "${jump.kind}".`,
				);
			}
			if (jump.minHeight !== undefined && jump.minHeight > jump.height) {
				warn(
					`${at}.controller.jump.minHeight`,
					`"${character.id}"'s tap height (${jump.minHeight} px) is above its jump height (${jump.height} px), so a tap jumps as high as a held press.`,
				);
			}
		}
		if (controller?.kind === 'flap' && !(character.movement?.gravity ?? 0)) {
			warn(
				`${at}.movement.gravity`,
				`"${character.id}" flaps, but has no gravity, so one flap sends it up for ever.`,
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

/** An online arcade game (P10.14): what its room on the game server needs. */
function validateArcadeOnline(
	doc: GameConfigDoc,
	bodies: Record<string, unknown>,
): GameConfigIssue[] {
	const online = doc.arcade?.online;
	if (!online) return [];
	const issues: GameConfigIssue[] = [];
	const botBrains = new Set((online.bots?.characters ?? []).map((b) => b.brain));
	if (doc.arcade?.characters?.some((c) => !botBrains.has(c.id))) {
		issues.push({
			severity: 'warning',
			path: 'arcade.characters',
			message:
				'An online game plays only its online characters: a character no bot plays does not run in a room.',
		});
	}
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
				message:
					key === 'maxPlayers'
						? `The room size is ${value}; the game server holds a room to ${min}–${max} players.`
						: `${key} is ${value}; a room holds it to ${min}–${max}.`,
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
	const off = (p: { x: number; y: number }) =>
		!!field && (p.x < 0 || p.y < 0 || p.x > field.w || p.y > field.h);
	const spawnsOff = (path: string, points: readonly { x: number; y: number }[] | undefined) => {
		if (!points?.some(off)) return;
		issues.push({
			severity: 'warning',
			path,
			message: 'Players start outside the play field; a clamped body is pulled inside at once.',
		});
	};
	spawnsOff('arcade.online.spawn', online.spawn ? [online.spawn] : undefined);
	online.characters.forEach((c, i) => spawnsOff(`arcade.online.characters[${i}].spawns`, c.spawns));
	spawnsOff('arcade.online.bots.spawns', online.bots?.spawns);
	const nearby = online.nearby;
	const { min, max } = ARCADE_ONLINE_LIMITS.nearby;
	if (nearby && [nearby.w, nearby.h].some((v) => v < min || v > max)) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.nearby',
			message: `The box a device is sent players in is held to ${min}–${max} px a side.`,
		});
	}
	const most = nearby?.max;
	if (nearby && most && [most.w, most.h].some((v) => v < min || v > max)) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.nearby.max',
			message: `The most a device's own view is sent players in is held to ${min}–${max} px a side.`,
		});
	}
	if (nearby && most && (most.w < nearby.w || most.h < nearby.h)) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.nearby.max',
			message: `The most (${most.w} × ${most.h}) is smaller than the box (${nearby.w} × ${nearby.h}) on a side; a room plays the box's size there.`,
		});
	}
	if (online.generator && !ONLINE_GENERATOR_IDS.includes(online.generator)) {
		issues.push({
			severity: 'error',
			path: 'arcade.online.generator',
			message: `No field generator is "${online.generator}" (${ONLINE_GENERATOR_IDS.join(', ')}).`,
		});
	}
	if (online.levels && online.generator !== 'salmonsMap') {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.levels',
			message: 'Levels (pinned seeds and overlays) are played only by the "salmonsMap" generator.',
		});
	}
	issues.push(...validateOnlineRules(doc));
	issues.push(...validateOnlineBots(doc));
	issues.push(...validateOnlinePointer(doc));
	return issues;
}

/** An online game's mouse and touch control: each tap names a character, and a button it uses. */
function validateOnlinePointer(doc: GameConfigDoc): GameConfigIssue[] {
	const online = doc.arcade?.online;
	const pointer = online?.pointer;
	if (!online || !pointer) return [];
	const issues: GameConfigIssue[] = [];
	for (const key of ['deadZone', 'tapPx'] as const) {
		const value = pointer[key];
		const { min, max } = ARCADE_POINTER_LIMITS[key];
		if (value !== undefined && (value < min || value > max)) {
			issues.push({
				severity: 'warning',
				path: `arcade.online.pointer.${key}`,
				message: `${key} is ${value}; it is held to ${min}–${max}.`,
			});
		}
	}
	const abilities = online.rules?.abilities ?? [];
	for (const [id, button] of Object.entries(pointer.taps ?? {})) {
		const path = `arcade.online.pointer.taps.${id}`;
		if (!online.characters.some((c) => c.id === id)) {
			issues.push({
				severity: 'warning',
				path,
				message: `No online character is "${id}", so its tap does nothing.`,
			});
		} else if (
			button !== 'jump' &&
			!abilities.some((a) => a.character === id && a.button === button)
		) {
			issues.push({
				severity: 'warning',
				path,
				message: `"${id}" has no ability on ${button}, so its tap only steers.`,
			});
		}
	}
	return issues;
}

/** An online game's bots (P10.16): each plays an online character with a character's brain. */
function validateOnlineBots(doc: GameConfigDoc): GameConfigIssue[] {
	const online = doc.arcade?.online;
	const bots = online?.bots;
	if (!online || !bots) return [];
	const issues: GameConfigIssue[] = [];
	const characters = new Set(online.characters.map((c) => c.id));
	const brains = new Map((doc.arcade?.characters ?? []).map((c) => [c.id, c.brain]));
	bots.characters.forEach((bot, i) => {
		const path = `arcade.online.bots.characters[${i}]`;
		if (!characters.has(bot.character)) {
			issues.push({
				severity: 'error',
				path: `${path}.character`,
				message: `No online character is "${bot.character}".`,
			});
		}
		if (!brains.get(bot.brain)) {
			issues.push({
				severity: 'error',
				path: `${path}.brain`,
				message: `No character "${bot.brain}" with a brain is in arcade.characters, so the bot cannot decide where to go.`,
			});
		}
	});
	const L = ARCADE_ONLINE_LIMITS;
	if (bots.characters.length > L.botCharacters.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.bots.characters',
			message: `Bots play at most ${L.botCharacters.max} characters; the rest are not played.`,
		});
	}
	const maxPlayers = online.maxPlayers ?? ARCADE_ONLINE_DEFAULTS.maxPlayers;
	const fillTo = bots.fillTo ?? ARCADE_ONLINE_BOT_DEFAULTS.fillTo;
	const holds = Math.min(L.maxPlayers.max, Math.max(L.maxPlayers.min, maxPlayers));
	const played = bots.characters.slice(0, L.botCharacters.max);
	if (played.some((b) => b.share !== undefined)) {
		if (botsByShares(bots)) issues.push(...validateBotShares(online, bots, holds));
		else {
			issues.push({
				severity: 'error',
				path: 'arcade.online.bots.characters',
				message:
					'Some bots have a share of the room and some have none: give every bot a share, or none.',
			});
		}
		return issues;
	}
	if (fillTo > holds) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.bots.fillTo',
			message: `Bots fill a room to ${fillTo}, but it holds ${holds}; a room fills to ${holds}.`,
		});
	}
	return issues;
}

/** Bots by shares (`botsByShares`): a room of `size` must hold one of each class, and what the
 *  shares decide (the room is full, each class's places) is said where an authored value is not read. */
function validateBotShares(
	online: ArcadeOnline,
	bots: ArcadeOnlineBots,
	size: number,
): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	const L = ARCADE_ONLINE_LIMITS;
	const seen = new Set<string>();
	bots.characters.slice(0, L.botCharacters.max).forEach((bot, i) => {
		const path = `arcade.online.bots.characters[${i}]`;
		if (seen.has(bot.character)) {
			issues.push({
				severity: 'error',
				path: `${path}.character`,
				message: `Two bots with a share play "${bot.character}": a class has one share of the room.`,
			});
		}
		seen.add(bot.character);
		const { min, max } = L.botShare;
		if (bot.share !== undefined && (bot.share < min || bot.share > max)) {
			issues.push({
				severity: 'warning',
				path: `${path}.share`,
				message: `The share of "${bot.character}" is ${bot.share}; a room holds it to ${min}–${max}.`,
			});
		}
	});
	const classes = botShareClasses(bots);
	if (size < classes.length) {
		issues.push({
			severity: 'error',
			path: 'arcade.online.maxPlayers',
			message: `A room of ${size} cannot hold one of each of ${classes.length} classes: the bots' shares need a room size of at least ${classes.length}.`,
		});
		return issues;
	}
	const counts = botShareCounts(size, classes);
	// The room is kept full and every place is a share class's: a class with no share has none.
	const placeless = online.characters
		.map((c) => c.id)
		.filter((id) => !classes.some((c) => c.character === id));
	if (placeless.length) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.bots.characters',
			message: `No bot has a share for ${placeless
				.map((id) => `"${id}"`)
				.join(
					', ',
				)}: every place of the room belongs to a class with a share, so nobody can play it. Give it a share.`,
		});
	}
	if (bots.fillTo !== undefined) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.bots.fillTo',
			message: `fillTo (${bots.fillTo}) is not read: bots with shares keep the room full (${size}).`,
		});
	}
	online.characters.forEach((character, i) => {
		const count = counts[character.id];
		if (count === undefined || character.max === undefined) return;
		issues.push({
			severity: 'warning',
			path: `arcade.online.characters[${i}].max`,
			message: `The most of "${character.id}" (${character.max}) is not read: its places follow from its share of the room (${count} of ${size}).`,
		});
	});
	// A bot starts on its class's own spawns (in turn, or at random); else on the bots' spawns in
	// turn; else on the one room spawn (the game server's `roomSim.ts`). A generator makes its own.
	const stacked = classes
		.map((c) => c.character)
		.filter((id) => {
			const character = online.characters.find((c) => c.id === id);
			return counts[id] > 1 && !character?.spawns?.length;
		});
	if (stacked.length && !bots.spawns?.length && !online.generator) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.bots.spawns',
			message: `The bots have no spawns, so every bot of ${stacked
				.map((id) => `"${id}" (${counts[id]})`)
				.join(
					', ',
				)} starts on the room's one spawn: give the bots spawns, or each class spawns of its own.`,
		});
	}
	return issues;
}

/** An online game's rules (P10.15): every name they use must exist, or the room cannot run them. */
function validateOnlineRules(doc: GameConfigDoc): GameConfigIssue[] {
	const online = doc.arcade?.online;
	const rules = online?.rules;
	if (!online || !rules) return [];
	const issues: GameConfigIssue[] = [];
	const characters = new Set(online.characters.map((c) => c.id));
	const zones = new Set((doc.arcade?.zones ?? []).map((z) => z.id));
	const unknownCharacters = (list: readonly string[], path: string) => {
		for (const id of list) {
			if (characters.has(id)) continue;
			issues.push({
				severity: 'error',
				path,
				message: `No online character is "${id}".`,
			});
		}
	};
	const L = ARCADE_ONLINE_LIMITS;
	(rules.zones ?? []).forEach((rule, i) => {
		const path = `arcade.online.rules.zones[${i}]`;
		if (!zones.has(rule.zone)) {
			issues.push({
				severity: 'error',
				path,
				message: `The rule names the zone "${rule.zone}", which arcade.zones does not have.`,
			});
		}
		unknownCharacters(rule.characters ?? [], `${path}.characters`);
		const force = rule.force;
		if (force && [force.x, force.y].some((v) => v < L.force.min || v > L.force.max)) {
			issues.push({
				severity: 'warning',
				path: `${path}.force`,
				message: `A current's force is held to ${L.force.min}–${L.force.max} px/s.`,
			});
		}
	});
	if ((rules.zones?.length ?? 0) > L.zoneRules.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.rules.zones',
			message: `A room runs at most ${L.zoneRules.max} zone rules; the rest do nothing.`,
		});
	}
	(rules.abilities ?? []).forEach((ability, i) => {
		const path = `arcade.online.rules.abilities[${i}]`;
		unknownCharacters([ability.character], `${path}.character`);
		unknownCharacters(ability.targets, `${path}.targets`);
		const ranged = [
			['reach', ability.reach, L.reach],
			['ms', ability.ms, L.effectMs],
			['cooldownMs', ability.cooldownMs, L.cooldownMs],
			['score', ability.score, L.score],
		] as const;
		for (const [key, value, range] of ranged) {
			if (value === undefined || (value >= range.min && value <= range.max)) continue;
			issues.push({
				severity: 'warning',
				path: `${path}.${key}`,
				message: `${key} is ${value}; a room holds it to ${range.min}–${range.max}.`,
			});
		}
		if (!ability.carry) return;
		if (ability.effect !== 'hook') {
			issues.push({
				severity: 'warning',
				path: `${path}.carry`,
				message: 'Only a hook holds and throws what its line lands; this carry does nothing.',
			});
			return;
		}
		const carried = [
			['holdMs', ability.carry.holdMs, L.carryHoldMs],
			['throwPx', ability.carry.throwPx, L.reach],
			['flightMs', ability.carry.flightMs, L.carryFlightMs],
		] as const;
		for (const [key, value, range] of carried) {
			if (value === undefined || (value >= range.min && value <= range.max)) continue;
			issues.push({
				severity: 'warning',
				path: `${path}.carry.${key}`,
				message: `${key} is ${value}; a room holds it to ${range.min}–${range.max}.`,
			});
		}
	});
	for (const key of ['opacity', 'trailOpacity'] as const) {
		const value = rules.stains?.[key];
		if (value === undefined || (value >= 0 && value <= 1)) continue;
		issues.push({
			severity: 'warning',
			path: `arcade.online.rules.stains.${key}`,
			message: `${key} is ${value}; an opacity is 0 (not drawn) to 1 (solid).`,
		});
	}
	if ((rules.abilities?.length ?? 0) > L.abilities.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.rules.abilities',
			message: `A room runs at most ${L.abilities.max} abilities; the rest do nothing.`,
		});
	}
	const seconds = rules.round?.seconds;
	if (seconds !== undefined && (seconds < L.roundSeconds.min || seconds > L.roundSeconds.max)) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.rules.round.seconds',
			message: `A round lasts ${L.roundSeconds.min}–${L.roundSeconds.max} seconds.`,
		});
	}
	const next = rules.round?.nextRoundSeconds;
	if (next !== undefined && next > L.nextRoundSeconds.max) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.rules.round.nextRoundSeconds',
			message: `The pause between rounds is at most ${L.nextRoundSeconds.max} seconds.`,
		});
	}
	const lobby = rules.lobby;
	const outside = (v: number | undefined, r: { min: number; max: number }) =>
		v !== undefined && (v < r.min || v > r.max);
	if (
		lobby &&
		(outside(lobby.minPlayers, L.lobbyMinPlayers) ||
			outside(lobby.maxWaitSeconds, L.lobbyMaxWaitSeconds) ||
			outside(lobby.countdownSeconds, L.lobbyCountdownSeconds))
	) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.rules.lobby',
			message: `A lobby waits for ${L.lobbyMinPlayers.min}–${L.lobbyMinPlayers.max} players or ${L.lobbyMaxWaitSeconds.min}–${L.lobbyMaxWaitSeconds.max} seconds, then counts down ${L.lobbyCountdownSeconds.min}–${L.lobbyCountdownSeconds.max} seconds.`,
		});
	}
	if (
		lobby?.minPlayers !== undefined &&
		lobby.minPlayers > (doc.arcade?.online?.maxPlayers ?? ARCADE_ONLINE_DEFAULTS.maxPlayers)
	) {
		issues.push({
			severity: 'warning',
			path: 'arcade.online.rules.lobby.minPlayers',
			message: 'The lobby waits for more players than a room holds: it starts on its timer.',
		});
	}
	if (rules.module && !ONLINE_RULES_MODULE_IDS.includes(rules.module)) {
		issues.push({
			severity: 'error',
			path: 'arcade.online.rules.module',
			message: `No rules module is "${rules.module}" (${ONLINE_RULES_MODULE_IDS.join(', ')}).`,
		});
	}
	const lined = !!rules.module && ONLINE_LINE_MODULE_IDS.includes(rules.module);
	(rules.abilities ?? []).forEach((ability, i) => {
		if (ability.effect !== 'hook' || lined) return;
		issues.push({
			severity: 'warning',
			path: `arcade.online.rules.abilities[${i}].effect`,
			message: `A hook needs a rules module with a line (${ONLINE_LINE_MODULE_IDS.join(', ')}); without one it does nothing.`,
		});
	});
	(rules.zones ?? []).forEach((rule, i) => {
		if (rule.kind === undefined) return;
		if (!ONLINE_ZONE_KINDS.includes(rule.kind)) {
			issues.push({
				severity: 'warning',
				path: `arcade.online.rules.zones[${i}].kind`,
				message: `No rules module acts on a zone of kind "${rule.kind}" (${ONLINE_ZONE_KINDS.join(', ')}).`,
			});
		} else if (!rules.module) {
			issues.push({
				severity: 'warning',
				path: `arcade.online.rules.zones[${i}].kind`,
				message: `A ${rule.kind} zone does nothing without a rules module.`,
			});
		}
	});
	return issues;
}
