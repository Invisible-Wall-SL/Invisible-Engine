/**
 * A GENERATED LEVEL'S SHAPE (`docs/design/salmons-levels.md` §5): how the river of an online game's
 * generated levels runs and how high its waterfalls are, as data. `arcade.online.levels.river` and
 * `.waterfalls`, beside the pinned seeds and overlays; `engine-mechanics` `salmonsMap.js` reads
 * them (`levelShape`, the same defaults and limits, held equal by `check:salmons-course`).
 *
 * CARRIED, NOT NORMALIZED, as the touch schemes are (`touchScheme.ts`): the slot, match-3 and card
 * bundles keep `normalizeArcade` and must stay the same bytes (`check:runtime-bytes`), so
 * `normalizeGameConfigDoc` drops the two blocks. The room and the device read them off the RAW doc
 * ({@link shapedOnlineGame}); the launcher's load and save put them back on the normalized doc
 * ({@link withLevelsShape}).
 */

import { normalizeLevels, type ArcadeOnlineLevels } from './family';
import type { GameConfigIssue } from './validate';

/** Present ⇒ the river winds; a field left out takes its default. Absent ⇒ the generator's own. */
export type LevelsRiver = {
	/** The share of reaches that bend, 0–1; the rest run nearly straight. */
	winding?: number;
	/** The most a bend turns the river, degrees (0–150). */
	sharpestTurn?: number;
	/** How much of that sharpness is kept for the source, 0–1 (0: as sharp all the way down). */
	sourceBias?: number;
};
export const LEVELS_RIVER_DEFAULTS = Object.freeze({
	winding: 0.75,
	sharpestTurn: 140,
	sourceBias: 0.6,
});

/**
 * `count` alone keeps the generator's own heights; a height given makes every waterfall a whole
 * number of cells between the two, the other end taking the generator's own limit. Absent ⇒ the
 * generator's own waterfalls.
 */
export type LevelsWaterfalls = {
	count?: number;
	/** Cells: a waterfall of `h` is a cliff of `(32 + 16·h) · 1.5` px. */
	heightMin?: number;
	heightMax?: number;
};

export type LevelsShape = { river?: LevelsRiver; waterfalls?: LevelsWaterfalls };

/** A config's levels with their shape: what the launcher edits and the generator is given. */
export type ShapedLevels = ArcadeOnlineLevels & LevelsShape;

/** The values a level's shape may take: `[least, most]`. */
export const LEVELS_SHAPE_LIMITS = Object.freeze({
	winding: Object.freeze([0, 1] as const),
	sharpestTurn: Object.freeze([0, 150] as const),
	sourceBias: Object.freeze([0, 1] as const),
	waterfallCount: Object.freeze([0, 12] as const),
	waterfallHeight: Object.freeze([1, 16] as const),
});

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlineOf = (doc: unknown): Raw | undefined => {
	const arcade = isObject(doc) ? doc.arcade : undefined;
	const online = isObject(arcade) ? arcade.online : undefined;
	return isObject(online) ? online : undefined;
};
const within = ([lo, hi]: readonly [number, number], v: unknown, whole = false) =>
	typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!whole || v % 1 === 0)
		? v
		: undefined;
const kept = <T extends object>(block: T): T =>
	Object.fromEntries(Object.entries(block).filter(([, v]) => v !== undefined)) as T;

/** The shape in a RAW `levels` block, or `undefined` for none: a value outside
 *  {@link LEVELS_SHAPE_LIMITS} is dropped (its default plays), a `river` with none left is kept
 *  (it still winds), a `waterfalls` with none left is dropped. */
export function normalizeLevelsShape(rawLevels: unknown): LevelsShape | undefined {
	if (!isObject(rawLevels)) return undefined;
	const L = LEVELS_SHAPE_LIMITS;
	const shape: LevelsShape = {};
	if (isObject(rawLevels.river))
		shape.river = kept({
			winding: within(L.winding, rawLevels.river.winding),
			sharpestTurn: within(L.sharpestTurn, rawLevels.river.sharpestTurn),
			sourceBias: within(L.sourceBias, rawLevels.river.sourceBias),
		});
	if (isObject(rawLevels.waterfalls)) {
		const falls = kept({
			count: within(L.waterfallCount, rawLevels.waterfalls.count, true),
			heightMin: within(L.waterfallHeight, rawLevels.waterfalls.heightMin, true),
			heightMax: within(L.waterfallHeight, rawLevels.waterfalls.heightMax, true),
		});
		if (Object.keys(falls).length) shape.waterfalls = falls;
	}
	return shape.river || shape.waterfalls ? shape : undefined;
}

/** A RAW `levels` block whole: its seeds and overlays (`normalizeLevels`) and its shape. */
export function normalizeShapedLevels(rawLevels: unknown): ShapedLevels | undefined {
	const levels = normalizeLevels(rawLevels);
	const shape = normalizeLevelsShape(rawLevels);
	return levels || shape ? { ...levels, ...shape } : undefined;
}

/** The shape of a RAW config's levels, or `undefined` for none. */
export const levelsShapeOf = (rawDoc: unknown): LevelsShape | undefined =>
	normalizeLevelsShape(onlineOf(rawDoc)?.levels);

/**
 * The launcher's carry: the NORMALIZED config `doc` with the levels' shape of `rawDoc` put back on
 * its `arcade.online.levels`. Returns `doc` itself when `rawDoc` has none or `doc` is not an
 * online game; neither argument is changed.
 */
export function withLevelsShape<T>(doc: T, rawDoc: unknown): T {
	const shape = levelsShapeOf(rawDoc);
	const online = onlineOf(doc);
	if (!shape || !online) return doc;
	const levels = { ...(isObject(online.levels) ? online.levels : {}), ...shape };
	const arcade = (doc as Raw).arcade as Raw;
	return { ...(doc as Raw), arcade: { ...arcade, online: { ...online, levels } } } as T;
}

/**
 * A resolved online game (`onlineGameOf` of the normalized doc) with the levels' shape of the RAW
 * doc it came from: what a room and a device give their generator. `game` itself when there is
 * none, or when it is no game (`undefined`, a refusal).
 */
export function shapedOnlineGame<G extends object | undefined>(game: G, rawDoc: unknown): G {
	const shape = levelsShapeOf(rawDoc);
	if (!shape || !game || !('online' in game) || !isObject(game.online)) return game;
	const levels = isObject(game.online.levels) ? game.online.levels : {};
	return { ...game, online: { ...game.online, levels: { ...levels, ...shape } } };
}

/** What is wrong with a RAW config's level shape, for a save. All warnings: a value that cannot
 *  be played is left out and its default plays. */
export function validateLevelsShape(rawDoc: unknown): GameConfigIssue[] {
	const online = onlineOf(rawDoc);
	const raw = online?.levels;
	if (!isObject(raw) || (!isObject(raw.river) && !isObject(raw.waterfalls))) return [];
	const issues: GameConfigIssue[] = [];
	const warn = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: `arcade.online.levels.${path}`, message });
	if (online?.generator !== 'salmonsMap')
		warn(
			isObject(raw.river) ? 'river' : 'waterfalls',
			'A river shape and waterfalls are played only by the "salmonsMap" generator.',
		);
	const L = LEVELS_SHAPE_LIMITS;
	const held = (block: unknown, path: string, key: string, limit: readonly [number, number]) => {
		const v = isObject(block) ? block[key] : undefined;
		if (v !== undefined && within(limit, v, path === 'waterfalls') === undefined)
			warn(
				`${path}.${key}`,
				`${JSON.stringify(v)} is not ${path === 'waterfalls' ? 'a whole number ' : ''}from ${limit[0]} to ${limit[1]}; it is left out.`,
			);
	};
	held(raw.river, 'river', 'winding', L.winding);
	held(raw.river, 'river', 'sharpestTurn', L.sharpestTurn);
	held(raw.river, 'river', 'sourceBias', L.sourceBias);
	held(raw.waterfalls, 'waterfalls', 'count', L.waterfallCount);
	held(raw.waterfalls, 'waterfalls', 'heightMin', L.waterfallHeight);
	held(raw.waterfalls, 'waterfalls', 'heightMax', L.waterfallHeight);
	const falls = normalizeLevelsShape(raw)?.waterfalls;
	if (
		falls?.heightMin !== undefined &&
		falls.heightMax !== undefined &&
		falls.heightMin > falls.heightMax
	)
		warn(
			'waterfalls',
			`The lowest waterfall (${falls.heightMin}) is higher than the highest (${falls.heightMax}); a level plays them the other way round.`,
		);
	return issues;
}
