import { normalizeArcadeCharacters, type ArcadeCharacter } from './arcadeCharacters';
import { isObject, num } from './normalizeParts';
import type { GameConfigDoc } from './types';

/**
 * THE GAME FAMILY and WHO DECIDES THE RESULT (`docs/design/game-families.md` §2.1, P10.1).
 *
 * A family is a way of playing: a slot, a match-3 board, an arcade play field. Every config
 * authored before Phase 10 is a slot whose results come from the RGS, so both fields default to
 * exactly that and the defaults are never stored — `normalizeGameConfigDoc` drops them, and every
 * existing doc normalizes byte-identically. Read them through {@link resolveFamily} and
 * {@link resolveOutcome}, never off the doc, for the reason `resolveWinModel` exists.
 *
 * The family ids mirror `GAME_FAMILIES` in `constants-shared/gameKinds` (this package stays
 * dependency-free); `family.fixture.ts` fails if the two lists part.
 */

/** The families a config can name. `slot` is the default and is never stored. */
export const CONFIG_FAMILIES = ['slot', 'match3', 'arcade'] as const;

export type ConfigFamily = (typeof CONFIG_FAMILIES)[number];

/**
 * Who decides a round: `rgs`, the server, for a real-money game (every slot), or `rules`, the
 * game's own Flow and board, for a free-play game that has no wallet (§2.3). `rgs` is the default.
 */
export const GAME_OUTCOMES = ['rgs', 'rules'] as const;

export type GameOutcome = (typeof GAME_OUTCOMES)[number];

/** What a match-3 rules game sets as its goal (§4.1). */
export type Match3Goal =
	{ type: 'score'; target: number } | { type: 'collect'; symbol: string; count: number };

/** Run length that matches when a match-3 config names none. */
export const DEFAULT_MATCH3_MIN_RUN = 3;

/**
 * The match-3 board's rules (§4.1). The board size is `numReels` × `numRows` and each column's
 * strip in `paddingReels` is its refill source, so neither lives here. SPARSE: an absent field is
 * its default, and a block with nothing in it is not stored.
 */
export type Match3Block = {
	/** Fewest gems in a row or column that match. Absent ⇒ {@link DEFAULT_MATCH3_MIN_RUN}. */
	minRun?: number;
	/** Rules games only: the moves a round allows. In an RGS game the server sends them. */
	moves?: number;
	/** Rules games only: what ends a round as won. */
	goals?: Match3Goal[];
	/** Rules games only: points per run length, keyed by the length (`{ '3': 50, '4': 120 }`). In an
	 *  RGS game the paytable prices a win, as for a cascade slot. */
	scoreTable?: Record<string, number>;
};

/** An arcade body's shape and what it collides as (§4.2). Keyed by the component it belongs to. */
export type ArcadeBody = (
	{ shape: 'box'; w: number; h: number } | { shape: 'circle'; r: number }
) & {
	/** Collision filters (`enemy`, `pickup`). */
	tags?: string[];
	/** Stops a mover (from tier A2). Absent ⇒ not solid. */
	solid?: true;
	/** Ground level (P10.13): a character in the air on a `hop` passes over it and neither touches
	 *  nor is stopped by it. Absent ⇒ as tall as the play field. */
	ground?: true;
	/** A one-way platform (P10.13): it stops a falling character from above only. Ignored on a
	 *  `solid` body. */
	oneWay?: true;
	/** How it meets the play field's edges (P10.8): held inside, carried round to the far edge, or let
	 *  out (it then raises `leaveBounds`). Absent ⇒ `clamp`. */
	edges?: ArcadeBodyEdges;
};

/** How an arcade body meets the play field's edges (`engine-mechanics` `motion.js`). */
export const ARCADE_BODY_EDGES = ['clamp', 'wrap', 'pass'] as const;

export type ArcadeBodyEdges = (typeof ARCADE_BODY_EDGES)[number];

/** A static rectangle of the play field (top-left, design px) that raises `enterZone` /
 *  `leaveZone` as a body crosses into or out of it. */
export type ArcadeZone = { id: string; x: number; y: number; w: number; h: number };

/** The fixed simulation rate an arcade config names when it names none. */
export const DEFAULT_ARCADE_FIXED_HZ = 60;

/** The rates an arcade simulation may step at: below the lower one motion visibly stutters, and
 *  above the upper one a slow device cannot keep up. */
export const ARCADE_FIXED_HZ_RANGE = { min: 30, max: 240 } as const;

/**
 * An arcade game's play field and bodies (§4.2). Its characters arrive in P10.11; the world and online
 * rooms join it in later tiers (P10.12–P10.14). SPARSE, like {@link Match3Block}.
 */
export type ArcadeBlock = {
	/** The play field's bounds, in design pixels. Absent ⇒ the screen's design size. */
	field?: { w: number; h: number };
	/** Simulation steps per second. Absent ⇒ {@link DEFAULT_ARCADE_FIXED_HZ}. */
	fixedHz?: number;
	/** Bodies by component id. */
	bodies?: Record<string, ArcadeBody>;
	/** The tag pairs whose touching raises `collide` (`[['player', 'hazard']]`). Bodies whose tags no
	 *  pair names never test each other. */
	pairs?: [string, string][];
	/** The field's zones (P10.8). */
	zones?: ArcadeZone[];
	/** The characters: what moves by itself, played or run by a brain (P10.11, §9 #14). */
	characters?: ArcadeCharacter[];
};

type FamilyDoc = Pick<GameConfigDoc, 'family' | 'outcome'> | null | undefined;

/** The family a config plays as. Absent ⇒ `slot`, which is every config authored before P10.1. */
export const resolveFamily = (doc: FamilyDoc): ConfigFamily => doc?.family ?? 'slot';

/** Who decides the config's rounds. Absent ⇒ `rgs`. A slot is always `rgs`. */
export const resolveOutcome = (doc: FamilyDoc): GameOutcome =>
	resolveFamily(doc) !== 'slot' && doc?.outcome === 'rules' ? 'rules' : 'rgs';

/** The match-3 rules with their defaults applied. */
export const resolveMatch3 = (
	doc: Pick<GameConfigDoc, 'match3'> | null | undefined,
): { minRun: number } & Omit<Match3Block, 'minRun'> => ({
	...doc?.match3,
	minRun: doc?.match3?.minRun ?? DEFAULT_MATCH3_MIN_RUN,
});

/** The arcade settings with their defaults applied. */
export const resolveArcade = (
	doc: Pick<GameConfigDoc, 'arcade'> | null | undefined,
): {
	fixedHz: number;
	bodies: Record<string, ArcadeBody>;
	pairs: [string, string][];
	zones: ArcadeZone[];
	characters: ArcadeCharacter[];
} & Pick<ArcadeBlock, 'field'> => ({
	...(doc?.arcade?.field ? { field: doc.arcade.field } : {}),
	fixedHz: doc?.arcade?.fixedHz ?? DEFAULT_ARCADE_FIXED_HZ,
	bodies: doc?.arcade?.bodies ?? {},
	pairs: doc?.arcade?.pairs ?? [],
	zones: doc?.arcade?.zones ?? [],
	characters: doc?.arcade?.characters ?? [],
});

/** A stored family, or `undefined` for the default and for anything unreadable. */
export const normalizeFamily = (raw: unknown): GameConfigDoc['family'] =>
	raw === 'match3' || raw === 'arcade' ? raw : undefined;

/** A stored outcome: only `rules`, and only beside a family that can be one (a slot cannot). */
export const normalizeOutcome = (
	raw: unknown,
	family: GameConfigDoc['family'],
): GameConfigDoc['outcome'] => (family && raw === 'rules' ? 'rules' : undefined);

const posInt = (v: unknown): number | undefined => {
	const n = num(v);
	return n !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
};

const positive = (v: unknown): number | undefined => {
	const n = num(v);
	return n !== undefined && n > 0 ? n : undefined;
};

const normalizeMatch3Goal = (raw: unknown): Match3Goal | undefined => {
	if (!isObject(raw)) return undefined;
	if (raw.type === 'score') {
		const target = posInt(raw.target);
		return target ? { type: 'score', target } : undefined;
	}
	if (raw.type === 'collect') {
		const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim() : '';
		const count = posInt(raw.count);
		return symbol && count ? { type: 'collect', symbol, count } : undefined;
	}
	return undefined;
};

const normalizeScoreTable = (raw: unknown): Record<string, number> | undefined => {
	if (!isObject(raw)) return undefined;
	const rows: [number, number][] = [];
	for (const [key, value] of Object.entries(raw)) {
		const run = posInt(Number(key));
		const points = num(value);
		if (run && points !== undefined && points >= 0) rows.push([run, points]);
	}
	// Ascending by run length, so the table reads in a stable order whatever order it was typed in.
	rows.sort((a, b) => a[0] - b[0]);
	return rows.length
		? Object.fromEntries(rows.map(([run, points]) => [String(run), points]))
		: undefined;
};

/**
 * Normalize an authored `match3` block, or `undefined` when nothing in it departs from the
 * defaults. The rules-only fields are kept in an RGS game too: switching the outcome to compare
 * must not discard them, and the validator only reads them where they apply.
 */
export function normalizeMatch3(raw: unknown): Match3Block | undefined {
	if (!isObject(raw)) return undefined;
	const block: Match3Block = {};
	// A run of one is every cell, so the smallest run that means anything is two.
	const minRun = posInt(raw.minRun);
	if (minRun && minRun >= 2 && minRun !== DEFAULT_MATCH3_MIN_RUN) block.minRun = minRun;
	const moves = posInt(raw.moves);
	if (moves) block.moves = moves;
	const goals = Array.isArray(raw.goals)
		? raw.goals.map(normalizeMatch3Goal).filter((g): g is Match3Goal => g !== undefined)
		: [];
	if (goals.length) block.goals = goals;
	const scoreTable = normalizeScoreTable(raw.scoreTable);
	if (scoreTable) block.scoreTable = scoreTable;
	return Object.keys(block).length ? block : undefined;
}

const normalizeTags = (raw: unknown): string[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const tags = [
		...new Set(raw.map((t) => (typeof t === 'string' ? t.trim() : '')).filter((t) => t.length > 0)),
	];
	return tags.length ? tags : undefined;
};

const normalizeArcadeBody = (raw: unknown): ArcadeBody | undefined => {
	if (!isObject(raw)) return undefined;
	let body: ArcadeBody;
	if (raw.shape === 'circle') {
		const r = positive(raw.r);
		if (!r) return undefined;
		body = { shape: 'circle', r };
	} else if (raw.shape === 'box') {
		const w = positive(raw.w);
		const h = positive(raw.h);
		if (!w || !h) return undefined;
		body = { shape: 'box', w, h };
	} else {
		return undefined;
	}
	const tags = normalizeTags(raw.tags);
	if (tags) body.tags = tags;
	if (raw.solid === true) body.solid = true;
	else if (raw.oneWay === true) body.oneWay = true;
	if (raw.ground === true) body.ground = true;
	if (raw.edges === 'wrap' || raw.edges === 'pass') body.edges = raw.edges;
	return body;
};

const tagOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Distinct, non-empty tag pairs; `['a', 'b']` and `['b', 'a']` are one pair, kept as first typed. */
const normalizePairs = (raw: unknown): [string, string][] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const pairs: [string, string][] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const a = tagOf(entry[0]);
		const b = tagOf(entry[1]);
		if (!a || !b) continue;
		const key = [a, b].sort().join('\u0000');
		if (seen.has(key)) continue;
		seen.add(key);
		pairs.push([a, b]);
	}
	return pairs.length ? pairs : undefined;
};

/** Zones with a unique id, a finite corner and a positive size; the first of a repeated id wins. */
const normalizeZones = (raw: unknown): ArcadeZone[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const zones: ArcadeZone[] = [];
	for (const entry of raw) {
		if (!isObject(entry)) continue;
		const id = tagOf(entry.id);
		const x = num(entry.x);
		const y = num(entry.y);
		const w = positive(entry.w);
		const h = positive(entry.h);
		if (!id || x === undefined || y === undefined || !w || !h) continue;
		if (zones.some((z) => z.id === id)) continue;
		zones.push({ id, x, y, w, h });
	}
	return zones.length ? zones : undefined;
};

/** Normalize an authored `arcade` block, or `undefined` when nothing in it departs from the
 *  defaults. A body with no usable shape is dropped: it cannot be drawn or collided. */
export function normalizeArcade(raw: unknown): ArcadeBlock | undefined {
	if (!isObject(raw)) return undefined;
	const block: ArcadeBlock = {};
	if (isObject(raw.field)) {
		const w = positive(raw.field.w);
		const h = positive(raw.field.h);
		if (w && h) block.field = { w, h };
	}
	const fixedHz = posInt(raw.fixedHz);
	if (fixedHz && fixedHz !== DEFAULT_ARCADE_FIXED_HZ) block.fixedHz = fixedHz;
	if (isObject(raw.bodies)) {
		const bodies: Record<string, ArcadeBody> = {};
		for (const [id, entry] of Object.entries(raw.bodies)) {
			const body = id ? normalizeArcadeBody(entry) : undefined;
			if (body) bodies[id] = body;
		}
		if (Object.keys(bodies).length) block.bodies = bodies;
	}
	const pairs = normalizePairs(raw.pairs);
	if (pairs) block.pairs = pairs;
	const zones = normalizeZones(raw.zones);
	if (zones) block.zones = zones;
	const characters = normalizeArcadeCharacters(raw.characters);
	if (characters) block.characters = characters;
	return Object.keys(block).length ? block : undefined;
}
