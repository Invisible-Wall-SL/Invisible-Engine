import {
	ARCADE_NETCODES,
	ARCADE_ONLINE_DEFAULTS,
	CARD_GAME_RULE_DEFAULTS,
	DEFAULT_ARCADE_FIXED_HZ,
	DEFAULT_MATCH3_MIN_RUN,
	type ArcadeBody,
	type ArcadeBodyEdges,
	type ArcadeZone,
	type CardGameFirst,
	type CardGameRules,
	type ConfigFamily,
	type GameConfigDoc,
	type GameOutcome,
	type Match3Goal,
} from 'game-config';

/**
 * How `/config` edits the family fields (`docs/design/game-families.md` §2.1). Every setter writes
 * what `normalizeGameConfigDoc` would store and nothing else — a default is DELETED rather than
 * written — so the page never looks dirty for a value a save would drop. `check:game-config-family`
 * runs each setter and re-normalizes, so the mirror is gated.
 */

/** Pick the family. A slot deletes every family field; a match-3 doc drops the slot win model and
 *  cascade it no longer stores; an arcade or card game is decided by its own rules (an RGS-decided
 *  arcade game is not built yet, and a card game is never one). */
export function setFamily(doc: GameConfigDoc, family: ConfigFamily): void {
	if (family === 'slot') {
		delete doc.family;
		delete doc.outcome;
		delete doc.match3;
		delete doc.arcade;
		delete doc.card;
		return;
	}
	doc.family = family;
	if (family !== 'arcade') delete doc.arcade;
	if (family !== 'card') delete doc.card;
	if (family === 'match3') {
		delete doc.winModel;
		delete doc.cascade;
	} else {
		delete doc.match3;
		doc.outcome = 'rules';
	}
}

/** Pick who decides a round. `rgs` is the default, so it deletes the field. */
export function setOutcome(doc: GameConfigDoc, outcome: GameOutcome): void {
	if (outcome === 'rules' && doc.family) doc.outcome = 'rules';
	else delete doc.outcome;
}

const intAtLeast = (value: string, min: number): number | undefined => {
	const n = Number(value);
	return value.trim() !== '' && Number.isInteger(n) && n >= min ? n : undefined;
};

function match3Block(doc: GameConfigDoc) {
	doc.match3 ??= {};
	return doc.match3;
}

function pruneMatch3(doc: GameConfigDoc): void {
	if (doc.match3 && !Object.keys(doc.match3).length) delete doc.match3;
}

/** The fewest gems that match. The default (3), or anything below 2, is not stored. */
export function setMinRun(doc: GameConfigDoc, value: string): void {
	const n = intAtLeast(value, 2);
	if (n === undefined || n === DEFAULT_MATCH3_MIN_RUN) delete match3Block(doc).minRun;
	else match3Block(doc).minRun = n;
	pruneMatch3(doc);
}

/** The moves a rules round allows; empty clears it. */
export function setMoves(doc: GameConfigDoc, value: string): void {
	const n = intAtLeast(value, 1);
	if (n === undefined) delete match3Block(doc).moves;
	else match3Block(doc).moves = n;
	pruneMatch3(doc);
}

/** Add a goal: a score target, or a number of one gem to collect. */
export function addGoal(doc: GameConfigDoc, type: Match3Goal['type'], firstGem: string): void {
	const goal: Match3Goal =
		type === 'score' ? { type, target: 1000 } : { type, symbol: firstGem, count: 10 };
	(match3Block(doc).goals ??= []).push(goal);
}

/** Change one number or the gem of a goal. A number that is not a positive whole number is left
 *  as it was. */
export function setGoalField(
	doc: GameConfigDoc,
	index: number,
	field: 'target' | 'count' | 'symbol',
	value: string,
): void {
	const goal = doc.match3?.goals?.[index];
	if (!goal) return;
	if (field === 'symbol') {
		if (goal.type === 'collect' && value.trim()) goal.symbol = value.trim();
		return;
	}
	const n = intAtLeast(value, 1);
	if (n === undefined) return;
	if (goal.type === 'score' && field === 'target') goal.target = n;
	if (goal.type === 'collect' && field === 'count') goal.count = n;
}

export function removeGoal(doc: GameConfigDoc, index: number): void {
	const goals = doc.match3?.goals;
	if (!goals) return;
	goals.splice(index, 1);
	if (!goals.length) delete match3Block(doc).goals;
	pruneMatch3(doc);
}

/** The score table as the page shows it: `3:50, 4:120`. */
export const scoreTableText = (doc: GameConfigDoc): string =>
	Object.entries(doc.match3?.scoreTable ?? {})
		.map(([run, points]) => `${run}:${points}`)
		.join(', ');

/** Parse `run:points` pairs. Unreadable pairs are skipped, rows are kept ascending by run length. */
export function setScoreTable(doc: GameConfigDoc, text: string): void {
	const rows: [number, number][] = [];
	for (const part of text.split(',')) {
		const [run, points] = part.split(':').map((s) => s.trim());
		const length = intAtLeast(run ?? '', 1);
		const value = Number(points);
		if (length !== undefined && points !== '' && Number.isFinite(value) && value >= 0) {
			rows.push([length, value]);
		}
	}
	rows.sort((a, b) => a[0] - b[0]);
	if (rows.length) {
		match3Block(doc).scoreTable = Object.fromEntries(rows.map(([r, p]) => [String(r), p]));
	} else {
		delete match3Block(doc).scoreTable;
	}
	pruneMatch3(doc);
}

/** One column's refill strip as the page shows it: `A, B, C`. */
export const stripText = (doc: GameConfigDoc, gameType: string, column: number): string =>
	(doc.paddingReels[gameType]?.[column] ?? []).map((cell) => cell.name).join(', ');

/** Set one column's refill strip from a comma list of gem ids. */
export function setStrip(doc: GameConfigDoc, gameType: string, column: number, text: string): void {
	const strips = doc.paddingReels[gameType];
	if (!strips || column >= strips.length) return;
	strips[column] = text
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name.length > 0)
		.map((name) => ({ name }));
}

function arcadeBlock(doc: GameConfigDoc) {
	doc.arcade ??= {};
	return doc.arcade;
}

function pruneArcade(doc: GameConfigDoc): void {
	if (doc.arcade && !Object.keys(doc.arcade).length) delete doc.arcade;
}

const positive = (value: string): number | undefined => {
	const n = Number(value);
	return value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The play field. Both sides, or neither (the screen's design size). */
export function setField(doc: GameConfigDoc, w: string, h: string): void {
	const width = positive(w);
	const height = positive(h);
	if (width !== undefined && height !== undefined) arcadeBlock(doc).field = { w: width, h: height };
	else delete arcadeBlock(doc).field;
	pruneArcade(doc);
}

/** Simulation steps per second. The default (60), or anything not a positive whole number, is not
 *  stored. */
export function setFixedHz(doc: GameConfigDoc, value: string): void {
	const n = intAtLeast(value, 1);
	if (n === undefined || n === DEFAULT_ARCADE_FIXED_HZ) delete arcadeBlock(doc).fixedHz;
	else arcadeBlock(doc).fixedHz = n;
	pruneArcade(doc);
}

/** An online game's netcode. The default (`engine`), or a value no build knows, is not stored; a
 *  game that is not online is left alone. */
export function setNetcode(doc: GameConfigDoc, value: string): void {
	const online = doc.arcade?.online;
	if (!online) return;
	const netcode = ARCADE_NETCODES.find((n) => n === value);
	if (!netcode || netcode === ARCADE_ONLINE_DEFAULTS.netcode) delete online.netcode;
	else online.netcode = netcode;
}

/** Add a body for a component id, as a 100 × 100 box. An id already given a body is left alone. */
export function addBody(doc: GameConfigDoc, componentId: string): void {
	const id = componentId.trim();
	if (!id) return;
	const bodies = (arcadeBlock(doc).bodies ??= {});
	bodies[id] ??= { shape: 'box', w: 100, h: 100 };
}

export function removeBody(doc: GameConfigDoc, id: string): void {
	const bodies = doc.arcade?.bodies;
	if (!bodies) return;
	delete bodies[id];
	if (!Object.keys(bodies).length) delete arcadeBlock(doc).bodies;
	pruneArcade(doc);
}

/** Switch a body between a box and a circle, keeping its size, tags, solidity and edges. */
export function setBodyShape(doc: GameConfigDoc, id: string, shape: ArcadeBody['shape']): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body || body.shape === shape) return;
	const { tags, solid, ground, oneWay, edges } = body;
	const size = body.shape === 'box' ? Math.max(body.w, body.h) : body.r * 2;
	const next: ArcadeBody =
		shape === 'circle' ? { shape, r: size / 2 } : { shape, w: size, h: size };
	if (tags) next.tags = tags;
	if (solid) next.solid = true;
	else if (oneWay) next.oneWay = true;
	if (ground) next.ground = true;
	if (edges) next.edges = edges;
	doc.arcade!.bodies![id] = next;
}

/** A body's size: `w` / `h` for a box, `r` for a circle. Not a positive number ⇒ left as it was. */
export function setBodySize(
	doc: GameConfigDoc,
	id: string,
	field: 'w' | 'h' | 'r',
	value: string,
): void {
	const body = doc.arcade?.bodies?.[id];
	const n = positive(value);
	if (!body || n === undefined) return;
	if (body.shape === 'box' && (field === 'w' || field === 'h')) body[field] = n;
	if (body.shape === 'circle' && field === 'r') body.r = n;
}

/** A body's tags from a comma list; duplicates and blanks dropped. */
export function setBodyTags(doc: GameConfigDoc, id: string, text: string): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body) return;
	const tags = [
		...new Set(
			text
				.split(',')
				.map((t) => t.trim())
				.filter((t) => t.length > 0),
		),
	];
	if (tags.length) body.tags = tags;
	else delete body.tags;
}

/** Solid or not. Not solid is the default, so it deletes the field; a solid body is no one-way
 *  platform (the normalizer drops `oneWay` beside `solid`). */
export function setBodySolid(doc: GameConfigDoc, id: string, solid: boolean): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body) return;
	if (solid) {
		body.solid = true;
		delete body.oneWay;
	} else delete body.solid;
}

/** Ground level (P10.13: a hop in the air passes over it) or not; not is the default. */
export function setBodyGround(doc: GameConfigDoc, id: string, ground: boolean): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body) return;
	if (ground) body.ground = true;
	else delete body.ground;
}

/** A one-way platform (P10.13) or not; not is the default. Refused on a solid body. */
export function setBodyOneWay(doc: GameConfigDoc, id: string, oneWay: boolean): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body || (oneWay && body.solid)) return;
	if (oneWay) body.oneWay = true;
	else delete body.oneWay;
}

/** How a body meets the field's edges. `clamp` is the default, so it deletes the field. */
export function setBodyEdges(doc: GameConfigDoc, id: string, edges: ArcadeBodyEdges): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body) return;
	if (edges === 'clamp') delete body.edges;
	else body.edges = edges;
}

/** The collision pairs from a comma list of `a + b` (`player + hazard, player + pickup`): blanks,
 *  halves and repeats (either way round) dropped. None ⇒ the field is deleted. */
export function setPairs(doc: GameConfigDoc, text: string): void {
	const pairs: [string, string][] = [];
	const seen = new Set<string>();
	for (const item of text.split(',')) {
		const [a, b, ...rest] = item.split('+').map((t) => t.trim());
		if (!a || !b || rest.length) continue;
		const key = [a, b].sort().join('+');
		if (seen.has(key)) continue;
		seen.add(key);
		pairs.push([a, b]);
	}
	if (pairs.length) arcadeBlock(doc).pairs = pairs;
	else delete arcadeBlock(doc).pairs;
	pruneArcade(doc);
}

/** The pairs as the comma list {@link setPairs} reads. */
export const pairsText = (doc: GameConfigDoc): string =>
	(doc.arcade?.pairs ?? []).map(([a, b]) => `${a} + ${b}`).join(', ');

/** Add a zone with a fresh id, as a 200 × 200 square at the field's corner. */
export function addZone(doc: GameConfigDoc): void {
	const zones = (arcadeBlock(doc).zones ??= []);
	let n = zones.length + 1;
	while (zones.some((z) => z.id === `zone${n}`)) n += 1;
	zones.push({ id: `zone${n}`, x: 0, y: 0, w: 200, h: 200 });
}

export function removeZone(doc: GameConfigDoc, index: number): void {
	const zones = doc.arcade?.zones;
	if (!zones) return;
	zones.splice(index, 1);
	if (!zones.length) delete arcadeBlock(doc).zones;
	pruneArcade(doc);
}

/** One field of a zone. An id must be new and not blank, a size positive, a corner a number;
 *  anything else leaves the zone as it was. */
export function setZoneField(
	doc: GameConfigDoc,
	index: number,
	field: keyof ArcadeZone,
	value: string,
): void {
	const zone = doc.arcade?.zones?.[index];
	if (!zone) return;
	if (field === 'id') {
		const id = value.trim();
		if (id && !doc.arcade!.zones!.some((z, i) => i !== index && z.id === id)) zone.id = id;
		return;
	}
	if (field === 'w' || field === 'h') {
		const n = positive(value);
		if (n !== undefined) zone[field] = n;
		return;
	}
	const n = Number(value);
	if (value.trim() !== '' && Number.isFinite(n)) zone[field] = n;
}

type CardRuleKey = Exclude<keyof CardGameRules, 'resource' | 'first'>;

function pruneCard(doc: GameConfigDoc): void {
	if (doc.card?.rules?.resource && !Object.keys(doc.card.rules.resource).length)
		delete doc.card.rules.resource;
	if (doc.card?.rules && !Object.keys(doc.card.rules).length) delete doc.card.rules;
	if (doc.card && !Object.keys(doc.card).length) delete doc.card;
}

/** A card game's rule number. Its default, or anything below the rule's minimum, is not stored. */
export function setCardRule(doc: GameConfigDoc, key: CardRuleKey, value: string): void {
	const n = intAtLeast(value, key === 'openingHand' ? 0 : 1);
	doc.card ??= {};
	doc.card.rules ??= {};
	if (n === undefined || n === CARD_GAME_RULE_DEFAULTS[key]) delete doc.card.rules[key];
	else doc.card.rules[key] = n;
	pruneCard(doc);
}

/** The resource's start, growth per turn or cap. */
export function setCardResource(
	doc: GameConfigDoc,
	key: 'start' | 'perTurn' | 'max',
	value: string,
): void {
	const n = intAtLeast(value, key === 'max' ? 1 : 0);
	doc.card ??= {};
	doc.card.rules ??= {};
	doc.card.rules.resource ??= {};
	if (n === undefined || n === CARD_GAME_RULE_DEFAULTS.resource[key])
		delete doc.card.rules.resource[key];
	else doc.card.rules.resource[key] = n;
	pruneCard(doc);
}

/** Who goes first. `random` is the default. */
export function setCardFirst(doc: GameConfigDoc, first: CardGameFirst): void {
	doc.card ??= {};
	doc.card.rules ??= {};
	if (first === CARD_GAME_RULE_DEFAULTS.first) delete doc.card.rules.first;
	else doc.card.rules.first = first;
	pruneCard(doc);
}
