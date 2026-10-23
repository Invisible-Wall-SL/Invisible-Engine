import {
	DEFAULT_ARCADE_FIXED_HZ,
	DEFAULT_MATCH3_MIN_RUN,
	type ArcadeBody,
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
 *  cascade it no longer stores; an arcade game is decided by its own rules (an RGS-decided arcade
 *  game is not built yet). */
export function setFamily(doc: GameConfigDoc, family: ConfigFamily): void {
	if (family === 'slot') {
		delete doc.family;
		delete doc.outcome;
		delete doc.match3;
		delete doc.arcade;
		return;
	}
	doc.family = family;
	if (family === 'match3') {
		delete doc.arcade;
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

/** Switch a body between a box and a circle, keeping its size, tags and solidity. */
export function setBodyShape(doc: GameConfigDoc, id: string, shape: ArcadeBody['shape']): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body || body.shape === shape) return;
	const { tags, solid } = body;
	const size = body.shape === 'box' ? Math.max(body.w, body.h) : body.r * 2;
	const next: ArcadeBody =
		shape === 'circle' ? { shape, r: size / 2 } : { shape, w: size, h: size };
	if (tags) next.tags = tags;
	if (solid) next.solid = true;
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

/** Solid or not. Not solid is the default, so it deletes the field. */
export function setBodySolid(doc: GameConfigDoc, id: string, solid: boolean): void {
	const body = doc.arcade?.bodies?.[id];
	if (!body) return;
	if (solid) body.solid = true;
	else delete body.solid;
}
