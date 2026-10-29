import {
	ARCADE_ONLINE_BOT_DEFAULTS,
	ARCADE_ONLINE_DEFAULTS,
	ARCADE_ONLINE_LIMITS,
	type ArcadeOnline,
	type ArcadeOnlineHitEffect,
	type ArcadeOnlineRound,
	type ArcadeOnlineRules,
	type GameConfigDoc,
} from 'game-config';

/**
 * How `/config` edits an online arcade game (`arcade.online`, its `rules` and its `bots`;
 * `docs/design/realtime-multiplayer.md` §7, §9). Like `./familyDoc`, every setter writes what
 * `normalizeGameConfigDoc` stores and nothing else: a default is deleted, an entry the normalizer
 * would drop is never made (an edit that would empty one is refused), and an emptied block is
 * removed. `check:game-config-family` runs each and re-normalizes.
 */

type Point = { x: number; y: number };
type RoomInt = 'maxPlayers' | 'tickHz' | 'subSteps' | 'patchHz' | 'rejoinSeconds';

const numberOf = (value: string): number | undefined => {
	const n = Number(value);
	return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
};
const intAtLeast = (value: string, min: number): number | undefined => {
	const n = numberOf(value);
	return n !== undefined && Number.isInteger(n) && n >= min ? n : undefined;
};
const positive = (value: string): number | undefined => {
	const n = numberOf(value);
	return n !== undefined && n > 0 ? n : undefined;
};
const atLeastZero = (value: string): number | undefined => {
	const n = numberOf(value);
	return n !== undefined && n >= 0 ? n : undefined;
};
const idList = (text: string): string[] => [
	...new Set(
		text
			.split(',')
			.map((t) => t.trim())
			.filter((t) => t.length > 0),
	),
];
const freshId = (taken: string[], stem: string): string => {
	let n = taken.length + 1;
	while (taken.includes(`${stem}${n}`)) n += 1;
	return `${stem}${n}`;
};

const onlineOf = (doc: GameConfigDoc): ArcadeOnline | undefined => doc.arcade?.online;

/** Played online or not. On makes an empty block (the validator says what it still needs); off
 *  deletes the block and everything in it. */
export function setPlayedOnline(doc: GameConfigDoc, on: boolean): void {
	if (on) {
		doc.arcade ??= {};
		doc.arcade.online ??= { characters: [] };
		return;
	}
	if (!doc.arcade) return;
	delete doc.arcade.online;
	if (!Object.keys(doc.arcade).length) delete doc.arcade;
}

/** One of the room's whole numbers. Its default, or anything below its least, is not stored. */
export function setRoomInt(doc: GameConfigDoc, key: RoomInt, value: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const n = intAtLeast(value, key === 'rejoinSeconds' ? 0 : 1);
	if (n === undefined || n === ARCADE_ONLINE_DEFAULTS[key]) delete online[key];
	else online[key] = n;
}

/** Where a player starts: both coordinates, or neither (the field's centre). */
export function setRoomSpawn(doc: GameConfigDoc, x: string, y: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const px = numberOf(x);
	const py = numberOf(y);
	if (px !== undefined && py !== undefined) online.spawn = { x: px, y: py };
	else delete online.spawn;
}

/** The spawn layer players are drawn in. `field` is the default. */
export function setRoomLayer(doc: GameConfigDoc, value: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const layer = value.trim();
	if (!layer || layer === ARCADE_ONLINE_DEFAULTS.layer) delete online.layer;
	else online.layer = layer;
}

/** The box each device is sent the players of: both sides, or neither (every player). */
export function setNearby(doc: GameConfigDoc, w: string, h: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const bw = positive(w);
	const bh = positive(h);
	if (bw !== undefined && bh !== undefined) online.nearby = { w: bw, h: bh };
	else delete online.nearby;
}

/** Points as the page shows them: `100, 200; 300, 400`. */
export const pointsText = (points: Point[] | undefined): string =>
	(points ?? []).map((p) => `${p.x}, ${p.y}`).join('; ');

/** Parse {@link pointsText}; an unreadable point is skipped, and as many are kept as a room can
 *  hold players. */
const parsePoints = (text: string): Point[] =>
	text
		.split(';')
		.flatMap((part) => {
			const [x, y, ...rest] = part.split(',').map((s) => s.trim());
			const px = numberOf(x ?? '');
			const py = numberOf(y ?? '');
			return px !== undefined && py !== undefined && !rest.length ? [{ x: px, y: py }] : [];
		})
		.slice(0, ARCADE_ONLINE_LIMITS.fillTo.max);

/** Add a character a player can be, with a fresh id, on `body` at 300 px/s. No body ⇒ nothing:
 *  a character with no body is not stored. */
export function addOnlineCharacter(doc: GameConfigDoc, body: string): void {
	const online = onlineOf(doc);
	if (!online || !body.trim()) return;
	const id = freshId(
		online.characters.map((c) => c.id),
		'character',
	);
	online.characters.push({ id, body: body.trim(), speed: 300 });
}

/** Remove a character. What names it (abilities, zone rules, bots) is left for the validator to
 *  point at, so nothing else the author wrote disappears with it. */
export function removeOnlineCharacter(doc: GameConfigDoc, index: number): void {
	onlineOf(doc)?.characters.splice(index, 1);
}

/** Rename a character, and every rule and bot that names it. A blank or taken id is refused. */
function renameOnlineCharacter(online: ArcadeOnline, index: number, value: string): void {
	const character = online.characters[index];
	const id = value.trim();
	if (!character || !id || online.characters.some((c, i) => i !== index && c.id === id)) return;
	const from = character.id;
	const swap = (name: string) => (name === from ? id : name);
	character.id = id;
	for (const ability of online.rules?.abilities ?? []) {
		ability.character = swap(ability.character);
		ability.targets = [...new Set(ability.targets.map(swap))];
	}
	for (const rule of online.rules?.zones ?? [])
		if (rule.characters) rule.characters = [...new Set(rule.characters.map(swap))];
	for (const bot of online.bots?.characters ?? []) bot.character = swap(bot.character);
}

/** One field of a character. A speed must be positive and a body named; a cap is a whole number
 *  from 1, empty for none; spawns are {@link pointsText}. */
export function setOnlineCharacterField(
	doc: GameConfigDoc,
	index: number,
	field: 'id' | 'body' | 'speed' | 'max' | 'spawns',
	value: string,
): void {
	const online = onlineOf(doc);
	const character = online?.characters[index];
	if (!online || !character) return;
	if (field === 'id') return renameOnlineCharacter(online, index, value);
	if (field === 'body') {
		if (value.trim()) character.body = value.trim();
		return;
	}
	if (field === 'speed') {
		const n = positive(value);
		if (n !== undefined) character.speed = n;
		return;
	}
	if (field === 'max') {
		const n = intAtLeast(value, 1);
		if (n === undefined) delete character.max;
		else character.max = n;
		return;
	}
	const spawns = parsePoints(value);
	if (spawns.length) character.spawns = spawns;
	else delete character.spawns;
}

function rulesOf(online: ArcadeOnline): ArcadeOnlineRules {
	online.rules ??= {};
	return online.rules;
}

function pruneRules(online: ArcadeOnline): void {
	const rules = online.rules;
	if (!rules) return;
	if (rules.zones && !rules.zones.length) delete rules.zones;
	if (rules.abilities && !rules.abilities.length) delete rules.abilities;
	if (rules.round && !Object.keys(rules.round).length) delete rules.round;
	if (!Object.keys(rules).length) delete online.rules;
}

/** Add a zone rule on `zone`, as the round's goal (a rule that neither pushes nor is the goal is
 *  not stored). No zone ⇒ nothing. */
export function addZoneRule(doc: GameConfigDoc, zone: string): void {
	const online = onlineOf(doc);
	if (!online || !zone.trim()) return;
	(rulesOf(online).zones ??= []).push({ zone: zone.trim(), goal: true });
}

export function removeZoneRule(doc: GameConfigDoc, index: number): void {
	const online = onlineOf(doc);
	if (!online?.rules?.zones) return;
	online.rules.zones.splice(index, 1);
	pruneRules(online);
}

/** One field of a zone rule: its zone, the current's push (`forceX` / `forceY`, px/s), whether it
 *  is the goal, and the characters it applies to (a comma list, empty for every one). An edit that
 *  would leave a rule neither pushing nor the goal is refused. */
export function setZoneRuleField(
	doc: GameConfigDoc,
	index: number,
	field: 'zone' | 'forceX' | 'forceY' | 'goal' | 'characters',
	value: string | boolean,
): void {
	const rule = onlineOf(doc)?.rules?.zones?.[index];
	if (!rule) return;
	const text = String(value);
	if (field === 'zone') {
		if (text.trim()) rule.zone = text.trim();
		return;
	}
	if (field === 'characters') {
		const list = idList(text);
		if (list.length) rule.characters = list;
		else delete rule.characters;
		return;
	}
	const next = { force: rule.force, goal: rule.goal };
	if (field === 'goal') next.goal = value === true ? true : undefined;
	else {
		const n = numberOf(text) ?? 0;
		const force = { x: rule.force?.x ?? 0, y: rule.force?.y ?? 0 };
		force[field === 'forceX' ? 'x' : 'y'] = n;
		next.force = force.x || force.y ? force : undefined;
	}
	if (!next.force && !next.goal && !rule.solid && !rule.kind) return;
	if (next.force) rule.force = next.force;
	else delete rule.force;
	if (next.goal) rule.goal = true;
	else delete rule.goal;
}

/** Add an ability: the first character's first button, catching every other character (or
 *  itself, alone) within 100 px. No character ⇒ nothing. */
export function addAbility(doc: GameConfigDoc): void {
	const online = onlineOf(doc);
	const user = online?.characters[0]?.id;
	if (!online || !user) return;
	const others = online.characters.map((c) => c.id).filter((id) => id !== user);
	(rulesOf(online).abilities ??= []).push({
		character: user,
		button: 'ability1',
		reach: 100,
		targets: others.length ? others : [user],
		effect: 'catch',
	});
}

export function removeAbility(doc: GameConfigDoc, index: number): void {
	const online = onlineOf(doc);
	if (!online?.rules?.abilities) return;
	online.rules.abilities.splice(index, 1);
	pruneRules(online);
}

/** One field of an ability. A reach is positive and the targets a non-empty comma list; `ms` and
 *  `cooldownMs` are whole numbers from 0, empty for the default; `score` 0 or empty is none. */
export function setAbilityField(
	doc: GameConfigDoc,
	index: number,
	field: 'character' | 'button' | 'reach' | 'targets' | 'effect' | 'ms' | 'score' | 'cooldownMs',
	value: string,
): void {
	const ability = onlineOf(doc)?.rules?.abilities?.[index];
	if (!ability) return;
	if (field === 'character') {
		if (value.trim()) ability.character = value.trim();
	} else if (field === 'button') {
		if (value === 'ability1' || value === 'ability2') ability.button = value;
	} else if (field === 'effect') {
		if (value === 'catch' || value === 'stun' || value === 'hook')
			ability.effect = value as ArcadeOnlineHitEffect;
	} else if (field === 'reach') {
		const n = positive(value);
		if (n !== undefined) ability.reach = n;
	} else if (field === 'targets') {
		const list = idList(value);
		if (list.length) ability.targets = list;
	} else if (field === 'score') {
		const n = numberOf(value);
		if (n) ability.score = n;
		else delete ability.score;
	} else {
		const n = intAtLeast(value, 0);
		if (n === undefined) delete ability[field];
		else ability[field] = n;
	}
}

/** One number of the round: `seconds` positive (empty: until the goal), `nextRoundSeconds` from 0,
 *  `goalScore` any number. Empty or unreadable clears it (its default). */
export function setRoundField(
	doc: GameConfigDoc,
	field: keyof ArcadeOnlineRound,
	value: string,
): void {
	const online = onlineOf(doc);
	if (!online) return;
	const parse = { seconds: positive, nextRoundSeconds: atLeastZero, goalScore: numberOf }[field];
	const n = parse(value);
	const rules = rulesOf(online);
	if (n === undefined) {
		if (rules.round) delete rules.round[field];
	} else (rules.round ??= {})[field] = n;
	pruneRules(online);
}

/** The named rules module the room also runs; empty for none. */
export function setRulesModule(doc: GameConfigDoc, value: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const module = value.trim();
	if (module) rulesOf(online).module = module;
	else if (online.rules) delete online.rules.module;
	pruneRules(online);
}

/** Add a bot: `character` played with `brain` (an `arcade.characters` id). Either missing ⇒
 *  nothing, as a bot without both is not stored. */
export function addBot(doc: GameConfigDoc, character: string, brain: string): void {
	const online = onlineOf(doc);
	if (!online || !character.trim() || !brain.trim()) return;
	online.bots ??= { characters: [] };
	online.bots.characters.push({ character: character.trim(), brain: brain.trim() });
}

/** Remove a bot; the last one removes the bots block (a block with none is not stored). */
export function removeBot(doc: GameConfigDoc, index: number): void {
	const online = onlineOf(doc);
	if (!online?.bots) return;
	online.bots.characters.splice(index, 1);
	if (!online.bots.characters.length) delete online.bots;
}

export function setBotField(
	doc: GameConfigDoc,
	index: number,
	field: 'character' | 'brain',
	value: string,
): void {
	const bot = onlineOf(doc)?.bots?.characters[index];
	if (bot && value.trim()) bot[field] = value.trim();
}

/** The bots block's own settings: `fillTo` (a whole number from 0, 20 the default), `canWin`
 *  (false the default) and `spawns` ({@link pointsText}). */
export function setBotsField(
	doc: GameConfigDoc,
	field: 'fillTo' | 'canWin' | 'spawns',
	value: string | boolean,
): void {
	const bots = onlineOf(doc)?.bots;
	if (!bots) return;
	if (field === 'canWin') {
		if (value === ARCADE_ONLINE_BOT_DEFAULTS.canWin) delete bots.canWin;
		else bots.canWin = value === true;
		return;
	}
	const text = String(value);
	if (field === 'fillTo') {
		const n = intAtLeast(text, 0);
		if (n === undefined || n === ARCADE_ONLINE_BOT_DEFAULTS.fillTo) delete bots.fillTo;
		else bots.fillTo = n;
		return;
	}
	const spawns = parsePoints(text);
	if (spawns.length) bots.spawns = spawns;
	else delete bots.spawns;
}
