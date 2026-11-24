import {
	ARCADE_ONLINE_BOT_DEFAULTS,
	ARCADE_ONLINE_DEFAULTS,
	ARCADE_ONLINE_LIMITS,
	ARCADE_POINTER_DEFAULTS,
	ARCADE_POINTER_MOUSE_MODES,
	ARCADE_POINTER_TAP_BUTTONS,
	type ArcadeOnline,
	type ArcadeOnlineCharacter,
	type ArcadeOnlineHitEffect,
	type ArcadeOnlineLobby,
	type ArcadeOnlineRules,
	type GameConfigDoc,
	type GameConfigIssue,
	botShareClasses,
	botShareCounts,
	botsByShares,
	onlineClassSheetOf,
	onlineTestSizeRange,
} from 'game-config';
import { removeTouchClass, renameTouchClass } from './touchDoc';

/**
 * How `/config` edits an online arcade game (`arcade.online`, its `rules` and its `bots`;
 * `docs/design/realtime-multiplayer.md` §7, §9). Like `./familyDoc`, every setter writes what
 * `normalizeGameConfigDoc` stores and nothing else: a default is deleted, an entry the normalizer
 * would drop is never made (an edit that would empty one is refused), and an emptied block is
 * removed. `check:game-config-family` runs each and re-normalizes.
 *
 * A class may name a CHARACTER SHEET (`sheet`, an `arcade.characters` id; `game-config`
 * `characterSheet.ts`), made in Invisible Characters. No setter here rebuilds a class, so every
 * edit that keeps a class keeps its `sheet`; the one that puts it out of force, a change of body,
 * removes it and answers what it removed ({@link setOnlineCharacterField}).
 * `check:config-character-sheets` runs each.
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
 *  deletes the block and everything in it, each class's `sheet` link too (`./pageDoc`
 *  `sheetLinksRemovedNote` is what the confirmation says of them). */
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

/** The box each device is sent the players of: both sides, or neither (every player). Its `max`
 *  stays with the box and goes with it. */
export function setNearby(doc: GameConfigDoc, w: string, h: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const bw = positive(w);
	const bh = positive(h);
	const max = online.nearby?.max;
	if (bw !== undefined && bh !== undefined)
		online.nearby = { w: bw, h: bh, ...(max ? { max } : {}) };
	else delete online.nearby;
}

/** How far a device's own view adds players to the box's (`nearby.max`): both sides, or neither
 *  (every device has the box alone). Refused with no box: a `max` alone is not stored. */
export function setNearbyMax(doc: GameConfigDoc, w: string, h: string): void {
	const nearby = onlineOf(doc)?.nearby;
	if (!nearby) return;
	const mw = positive(w);
	const mh = positive(h);
	if (mw !== undefined && mh !== undefined) nearby.max = { w: mw, h: mh };
	else delete nearby.max;
}

/** How near a solid's end a stopped player is carried round it (`arcade.online.slide.corner`,
 *  field px): a positive number, or none (empty or unreadable: players stop at a corner). */
export function setSlideCorner(doc: GameConfigDoc, value: string): void {
	const online = onlineOf(doc);
	if (!online) return;
	const corner = positive(value);
	if (corner !== undefined) online.slide = { corner };
	else delete online.slide;
}

/** Mouse and touch control of the own player (`arcade.online.pointer`): on makes an empty block
 *  (every default), off deletes it. */
export function setPointerOn(doc: GameConfigDoc, on: boolean): void {
	const online = onlineOf(doc);
	if (!online) return;
	if (on) online.pointer ??= {};
	else delete online.pointer;
}

/** One setting of the pointer control: the mouse mode, or a number from 0. A default, empty or
 *  unreadable value clears it. */
export function setPointerField(
	doc: GameConfigDoc,
	field: 'mouse' | 'deadZone' | 'tapPx',
	value: string,
): void {
	const pointer = onlineOf(doc)?.pointer;
	if (!pointer) return;
	if (field === 'mouse') {
		const mouse = ARCADE_POINTER_MOUSE_MODES.find((m) => m === value);
		if (mouse && mouse !== ARCADE_POINTER_DEFAULTS.mouse) pointer.mouse = mouse;
		else delete pointer.mouse;
		return;
	}
	const n = atLeastZero(value);
	if (n === undefined || n === ARCADE_POINTER_DEFAULTS[field]) delete pointer[field];
	else pointer[field] = n;
}

/** The button a tap presses for `character`; empty or unknown ⇒ a tap only steers. */
export function setPointerTap(doc: GameConfigDoc, character: string, value: string): void {
	const pointer = onlineOf(doc)?.pointer;
	if (!pointer) return;
	const button = ARCADE_POINTER_TAP_BUTTONS.find((b) => b === value);
	const taps = { ...pointer.taps };
	if (button) taps[character] = button;
	else delete taps[character];
	if (Object.keys(taps).length) pointer.taps = taps;
	else delete pointer.taps;
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

/** Remove a character, and with it its `sheet` (the link; the sheet is on `arcade.characters`)
 *  and the touch scheme it was given (`./touchDoc`; the scheme stays). What else names it
 *  (abilities, zone rules, bots) is left for the validator to point at, so nothing else the author
 *  wrote disappears with it. */
export function removeOnlineCharacter(doc: GameConfigDoc, index: number): void {
	const online = onlineOf(doc);
	const [removed] = online?.characters.splice(index, 1) ?? [];
	if (online && removed && !online.characters.some((c) => c.id === removed.id))
		removeTouchClass(online, removed.id);
}

const sheetNamed = (character: Pick<ArcadeOnlineCharacter, 'sheet'>): string =>
	typeof character.sheet === 'string' ? character.sheet.trim() : '';

/** The sheet the class at `index` names, and whether the game draws the class with it (the
 *  character exists, has a sheet and uses the class's component); `undefined` when it names none. */
export function classSheet(
	doc: GameConfigDoc,
	index: number,
): { id: string; inForce: boolean } | undefined {
	const character = onlineOf(doc)?.characters[index];
	const id = character ? sheetNamed(character) : '';
	if (!character || !id) return undefined;
	return { id, inForce: onlineClassSheetOf(doc, character.id)?.id === id };
}

/** A class's link to its sheet, removed because the class changed body. */
export type SheetUnlinked = {
	/** The class. */
	classId: string;
	/** The character whose sheet it named. */
	sheet: string;
	/** The component that character is drawn as. */
	component: string;
	/** The class's new body. */
	body: string;
};

/** {@link SheetUnlinked} for the person who changed the body. */
export const sheetUnlinkedNote = (u: SheetUnlinked): string =>
	`"${u.classId}" no longer uses the sheet of "${u.sheet}": that character is drawn as "${u.component}", and the class's body is now "${u.body}". A class and its sheet use the same component, so the link was removed; the sheet itself is untouched.`;

/** The issues of one class (`arcade.online.characters[i]…`), a sheet's among them: what the
 *  Online room panel lists under its Characters table. */
export const onlineClassIssues = (issues: GameConfigIssue[]): GameConfigIssue[] =>
	issues.filter((i) => i.path.startsWith('arcade.online.characters['));

/** Rename a character, every rule and bot that names it, and the touch scheme it is given
 *  (`./touchDoc`). A blank or taken id is refused. Its `sheet` names an `arcade.characters` entry,
 *  not the class, so it is kept. */
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
	renameTouchClass(online, from, id);
}

/**
 * One field of a character. A speed must be positive and a body named; a cap is a whole number
 * from 1, empty for none; spawns are {@link pointsText}.
 *
 * A new body takes the class's `sheet` off when the character it names is drawn as another
 * component: the class would be drawn as before the sheet while still naming it. The removal is
 * answered, for the page to say. A sheet whose character is the new body's is kept, and so is one
 * naming no character (the body does not decide that; the validator warns of it).
 */
export function setOnlineCharacterField(
	doc: GameConfigDoc,
	index: number,
	field: 'id' | 'body' | 'speed' | 'max' | 'spawns',
	value: string,
): SheetUnlinked | undefined {
	const online = onlineOf(doc);
	const character = online?.characters[index];
	if (!online || !character) return;
	if (field === 'id') {
		renameOnlineCharacter(online, index, value);
		return;
	}
	if (field === 'body') {
		const body = value.trim();
		if (!body || body === character.body) return;
		character.body = body;
		const sheet = sheetNamed(character);
		const component = doc.arcade?.characters?.find((c) => c.id === sheet)?.component;
		if (!sheet || component === undefined || component === body) return;
		delete character.sheet;
		return { classId: character.id, sheet, component, body };
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
	field: 'seconds' | 'nextRoundSeconds' | 'goalScore',
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

/** Give the room a lobby (Salmons' numbers as the defaults) or take it away. */
export function setLobbyOn(doc: GameConfigDoc, on: boolean): void {
	const online = onlineOf(doc);
	if (!online) return;
	if (on) rulesOf(online).lobby ??= {};
	else if (online.rules) delete online.rules.lobby;
	pruneRules(online);
}

/** One number of the lobby: `minPlayers` a whole number from 1, the seconds from 0. Empty or
 *  unreadable clears it (its default). */
export function setLobbyField(
	doc: GameConfigDoc,
	field: keyof ArcadeOnlineLobby,
	value: string,
): void {
	const online = onlineOf(doc);
	if (!online?.rules?.lobby) return;
	const n = field === 'minPlayers' ? intAtLeast(value, 1) : atLeastZero(value);
	if (n === undefined) delete online.rules.lobby[field];
	else online.rules.lobby[field] = n;
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

const twoPlaces = (n: number): number => Math.round(n * 100) / 100;

/** Add a bot: `character` played with `brain` (an `arcade.characters` id). Either missing ⇒
 *  nothing, as a bot without both is not stored. By shares it takes the others' average share,
 *  and a class that already has a share is refused (a class has one). */
export function addBot(doc: GameConfigDoc, character: string, brain: string): void {
	const online = onlineOf(doc);
	if (!online || !character.trim() || !brain.trim()) return;
	const classes = botShareClasses(online.bots);
	if (classes.some((c) => c.character === character.trim())) return;
	const share = classes.length
		? Math.max(
				ARCADE_ONLINE_LIMITS.botShare.min,
				twoPlaces(classes.reduce((sum, c) => sum + c.share, 0) / classes.length),
			)
		: undefined;
	online.bots ??= { characters: [] };
	online.bots.characters.push({
		character: character.trim(),
		brain: brain.trim(),
		...(share !== undefined ? { share } : {}),
	});
}

/** The room's size as a room plays it: `maxPlayers`, or its default, within the server's limits. */
const roomSizeOf = (online: ArcadeOnline): number => onlineTestSizeRange(online).max;

/**
 * Bots by shares, or by count. Each way is converted so the room plays about as it did:
 *
 * - TO SHARES: one entry per class (a class listed more than once keeps its first brain). A
 *   class's share is its `max` when every class the bots play has one, else how many entries
 *   named it. `fillTo` and those classes' `max` are removed: by shares neither is read.
 * - TO COUNT: the shares are removed, each class's `max` becomes the places its share gave it at
 *   the room's size, and `fillTo` becomes that size.
 */
export function setBotsByShares(doc: GameConfigDoc, on: boolean): void {
	const online = onlineOf(doc);
	const bots = online?.bots;
	if (!online || !bots || botsByShares(bots) === on) return;
	if (!on) {
		const size = roomSizeOf(online);
		const counts = botShareCounts(size, botShareClasses(bots));
		for (const bot of bots.characters) delete bot.share;
		for (const character of online.characters)
			if (counts[character.id] !== undefined) character.max = counts[character.id];
		if (size === ARCADE_ONLINE_BOT_DEFAULTS.fillTo) delete bots.fillTo;
		else bots.fillTo = size;
		return;
	}
	const classes: { character: string; brain: string; entries: number }[] = [];
	for (const bot of bots.characters) {
		const listed = classes.find((c) => c.character === bot.character);
		if (listed) listed.entries += 1;
		else classes.push({ character: bot.character, brain: bot.brain, entries: 1 });
	}
	const mostOf = (id: string) => online.characters.find((c) => c.id === id)?.max;
	const byMost = classes.every((c) => mostOf(c.character) !== undefined);
	bots.characters = classes.map((c) => ({
		character: c.character,
		brain: c.brain,
		share: Math.min(
			ARCADE_ONLINE_LIMITS.botShare.max,
			(byMost ? mostOf(c.character) : undefined) ?? c.entries,
		),
	}));
	delete bots.fillTo;
	for (const character of online.characters)
		if (classes.some((c) => c.character === character.id)) delete character.max;
}

/** A bot's share of the room: a positive number. Anything else is refused (by shares, an entry
 *  without one is an error), and so is a share on bots by count ({@link setBotsByShares}). */
export function setBotShare(doc: GameConfigDoc, index: number, value: string): void {
	const bots = onlineOf(doc)?.bots;
	const bot = bots?.characters[index];
	const share = positive(value);
	if (bot && share !== undefined && botsByShares(bots)) bot.share = share;
}

/** What the Bots panel shows of bots by shares: each class's share as a whole percentage of the
 *  shares' sum, and its bots (its places) in a room of each of `sizes`. Empty for bots by count. */
export function botShareRows(
	online: ArcadeOnline,
	sizes: readonly number[],
): { character: string; percent: number; counts: number[] }[] {
	const classes = botShareClasses(online.bots);
	const sum = classes.reduce((total, c) => total + c.share, 0);
	const bySize = sizes.map((size) => botShareCounts(size, classes));
	return classes.map((c) => ({
		character: c.character,
		percent: Math.round((c.share / sum) * 100),
		counts: bySize.map((counts) => counts[c.character]),
	}));
}

/** The sizes the Bots panel shows the shares at: the room's own first, then the samples a test
 *  room of this game could have. */
export function botShareSizes(online: ArcadeOnline): number[] {
	const { min, max } = onlineTestSizeRange(online);
	return [max, ...[10, 20, 50].filter((size) => size >= min && size < max)];
}

/** The launch parameter that plays a test room of `value` players, held to the sizes a test room
 *  of this game may have; empty when no size is typed. */
export function testSizeParam(online: ArcadeOnline, value: string): string {
	const n = numberOf(value);
	if (n === undefined) return '';
	const { min, max } = onlineTestSizeRange(online);
	return `room_size=${Math.round(Math.min(max, Math.max(min, n)))}`;
}

/** Remove a bot; the last one removes the bots block (a block with none is not stored). */
export function removeBot(doc: GameConfigDoc, index: number): void {
	const online = onlineOf(doc);
	if (!online?.bots) return;
	online.bots.characters.splice(index, 1);
	if (!online.bots.characters.length) delete online.bots;
}

/** A bot's character or brain. By shares, a class another entry already plays is refused. */
export function setBotField(
	doc: GameConfigDoc,
	index: number,
	field: 'character' | 'brain',
	value: string,
): void {
	const bots = onlineOf(doc)?.bots;
	const bot = bots?.characters[index];
	if (!bot || !value.trim()) return;
	const taken =
		field === 'character' &&
		botsByShares(bots) &&
		bots?.characters.some((b, i) => i !== index && b.character === value.trim());
	if (!taken) bot[field] = value.trim();
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
