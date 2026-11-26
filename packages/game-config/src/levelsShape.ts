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

import {
	SALMONS_BIOMES,
	SALMONS_BIOME_LIMITS,
	SALMONS_GENERATOR,
	SALMONS_GENERATOR_LIMITS,
	SALMONS_GENERATOR_PAIRS,
	SALMONS_GENERATOR_WHOLE,
	type SalmonsBiome,
	type SalmonsBiomeStart,
} from 'engine-mechanics';
import { normalizeLevels, seedKey, type ArcadeOnlineLevels } from './family';
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

/** A parameter of the generator (`engine-mechanics` `SALMONS_GENERATOR`, its defaults). */
export type LevelsGeneratorParam = keyof typeof SALMONS_GENERATOR;
/** Every number that shapes a level; one left out takes its default. Absent ⇒ every default. */
export type LevelsGenerator = Partial<Record<LevelsGeneratorParam, number>>;
export const LEVELS_GENERATOR_DEFAULTS = SALMONS_GENERATOR;
export const LEVELS_GENERATOR_LIMITS = SALMONS_GENERATOR_LIMITS;
export const LEVELS_GENERATOR_WHOLE: readonly LevelsGeneratorParam[] = SALMONS_GENERATOR_WHOLE;
export const LEVELS_GENERATOR_PAIRS = SALMONS_GENERATOR_PAIRS;

/** An authored biome: its id, and any of its looks and densities (one left out takes the
 *  built-in biome of that id's, or for a new id the generator's own). */
export type LevelsBiome = { id: string } & Partial<Omit<SalmonsBiome, 'id'>>;
export type LevelsBiomeStart = SalmonsBiomeStart;
/**
 * The biomes (`engine-mechanics` `salmonsBiomes.js`): `kinds` (none: the six built-in ones,
 * `forest1`…`forest6`), and the sequence each level lays along its river from the source, by seed
 * or `'*'` (a seed's own wins whole). With no sequence the kinds take turns every `cycle` columns.
 * Absent ⇒ the original's forest, and nothing a level plays or draws moves.
 */
export type LevelsBiomes = {
	kinds?: LevelsBiome[];
	cycle?: number;
	sequences?: Record<string, LevelsBiomeStart[]>;
};
export const LEVELS_BIOMES_BUILT_IN = SALMONS_BIOMES;
export const LEVELS_BIOME_LIMITS = SALMONS_BIOME_LIMITS;

export type LevelsShape = {
	river?: LevelsRiver;
	waterfalls?: LevelsWaterfalls;
	generator?: LevelsGenerator;
	biomes?: LevelsBiomes;
};

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

const BIOME_ID = /^[a-z0-9_-]{1,32}$/;
const COLOUR = /^#[0-9a-f]{6}$/i;
const colour = (v: unknown) =>
	typeof v === 'string' && COLOUR.test(v) ? v.toLowerCase() : undefined;

/** A RAW `levels.generator` with only its values within {@link LEVELS_GENERATOR_LIMITS} (whole
 *  where they must be); `undefined` for none. An empty block is kept (every default). */
export function normalizeLevelsGenerator(raw: unknown): LevelsGenerator | undefined {
	if (!isObject(raw)) return undefined;
	const generator: LevelsGenerator = {};
	for (const key of Object.keys(SALMONS_GENERATOR) as LevelsGeneratorParam[]) {
		const v = within(LEVELS_GENERATOR_LIMITS[key], raw[key], LEVELS_GENERATOR_WHOLE.includes(key));
		if (v !== undefined) generator[key] = v;
	}
	return generator;
}

/** One RAW biome with only its usable fields; `undefined` for one with no usable id. */
function normalizeBiome(raw: unknown): LevelsBiome | undefined {
	if (!isObject(raw) || typeof raw.id !== 'string' || !BIOME_ID.test(raw.id)) return undefined;
	const L = LEVELS_BIOME_LIMITS;
	const trees = Array.isArray(raw.trees)
		? [...new Set(raw.trees.filter((t) => within(L.tree, t, true) !== undefined))]
		: [];
	const riverbed = Array.isArray(raw.riverbed)
		? raw.riverbed.map(colour).filter((c): c is string => c !== undefined)
		: [];
	const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
	return kept({
		id: raw.id,
		name: name || undefined,
		trees: trees.length ? (trees as number[]) : undefined,
		treeChance: within(L.treeChance, raw.treeChance),
		grass: within(L.grass, raw.grass, true),
		forest: within(L.forest, raw.forest, true),
		grassTint: colour(raw.grassTint),
		forestFloor: colour(raw.forestFloor),
		riverbed: riverbed.length ? riverbed.slice(0, L.riverbed[1]) : undefined,
		rocks: within(L.rocks, raw.rocks),
		whirlpools: within(L.whirlpools, raw.whirlpools),
		sand: within(L.sand, raw.sand),
		waterfalls: within(L.waterfalls, raw.waterfalls),
		bridges: typeof raw.bridges === 'boolean' ? raw.bridges : undefined,
	});
}

/** A RAW `levels.biomes`: its usable kinds (first of an id), its cycle within its limits, and its
 *  sequences keyed by seed or `'*'`, each entry naming a kind it has (or a built-in one when it
 *  has none), at a whole column, one per column, in order. `undefined` for none; an empty block
 *  is kept (the built-in biomes, as a level without). */
export function normalizeLevelsBiomes(raw: unknown): LevelsBiomes | undefined {
	if (!isObject(raw)) return undefined;
	const L = LEVELS_BIOME_LIMITS;
	const biomes: LevelsBiomes = {};
	const seen = new Set<string>();
	const kinds = (Array.isArray(raw.kinds) ? raw.kinds : [])
		.map(normalizeBiome)
		.filter((k): k is LevelsBiome => !!k && !seen.has(k.id) && !!seen.add(k.id))
		.slice(0, L.kinds[1]);
	if (kinds.length) biomes.kinds = kinds;
	const cycle = within(L.cycle, raw.cycle, true);
	if (cycle !== undefined) biomes.cycle = cycle;
	const ids = (kinds.length ? kinds : LEVELS_BIOMES_BUILT_IN).map((k) => k.id);
	if (isObject(raw.sequences)) {
		const sequences: Record<string, LevelsBiomeStart[]> = {};
		for (const [key, list] of Object.entries(raw.sequences)) {
			if (key !== '*' && !seedKey(key)) continue;
			const at = new Map<number, string>();
			for (const entry of Array.isArray(list) ? list : []) {
				if (!isObject(entry) || typeof entry.biome !== 'string' || !ids.includes(entry.biome))
					continue;
				const from = within(L.from, entry.from, true);
				if (from !== undefined && !at.has(from)) at.set(from, entry.biome);
			}
			const sequence = [...at]
				.sort((a, b) => a[0] - b[0])
				.slice(0, L.sequence[1])
				.map(([from, biome]) => ({ from, biome }));
			if (sequence.length) sequences[key] = sequence;
		}
		if (Object.keys(sequences).length) biomes.sequences = sequences;
	}
	return biomes;
}

/** The shape in a RAW `levels` block, or `undefined` for none: a value outside
 *  {@link LEVELS_SHAPE_LIMITS} is dropped (its default plays), a `river` with none left is kept
 *  (it still winds), a `waterfalls` with none left is dropped; a `generator` and a `biomes` block
 *  are kept even empty ({@link normalizeLevelsGenerator}, {@link normalizeLevelsBiomes}). */
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
	const generator = normalizeLevelsGenerator(rawLevels.generator);
	if (generator) shape.generator = generator;
	const biomes = normalizeLevelsBiomes(rawLevels.biomes);
	if (biomes) shape.biomes = biomes;
	return shape.river || shape.waterfalls || shape.generator || shape.biomes ? shape : undefined;
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
	if (
		!isObject(raw) ||
		(!isObject(raw.river) &&
			!isObject(raw.waterfalls) &&
			!isObject(raw.generator) &&
			!isObject(raw.biomes))
	)
		return [];
	const issues: GameConfigIssue[] = [];
	const warn = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: `arcade.online.levels.${path}`, message });
	if (online?.generator !== 'salmonsMap')
		warn(
			(['river', 'waterfalls', 'generator', 'biomes'] as const).find((k) => isObject(raw[k])) ??
				'river',
			'A river shape, waterfalls, generator settings and biomes are played only by the "salmonsMap" generator.',
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
	if (isObject(raw.generator)) {
		for (const key of Object.keys(raw.generator)) {
			if (!(key in SALMONS_GENERATOR)) {
				warn(`generator.${key}`, `"${key}" is not a generator setting; it is left out.`);
				continue;
			}
			const param = key as LevelsGeneratorParam;
			const whole = LEVELS_GENERATOR_WHOLE.includes(param);
			const limit = LEVELS_GENERATOR_LIMITS[param];
			const v = raw.generator[key];
			if (within(limit, v, whole) === undefined)
				warn(
					`generator.${key}`,
					`${JSON.stringify(v)} is not ${whole ? 'a whole number ' : ''}from ${limit[0]} to ${limit[1]}; it is left out.`,
				);
		}
		const kept = normalizeLevelsGenerator(raw.generator) ?? {};
		for (const [lo, hi] of LEVELS_GENERATOR_PAIRS) {
			const a = kept[lo] ?? SALMONS_GENERATOR[lo];
			const b = kept[hi] ?? SALMONS_GENERATOR[hi];
			if (a > b)
				warn(
					`generator.${lo}`,
					`${lo} (${a}) is above ${hi} (${b}); a level plays them the other way round.`,
				);
		}
	}
	if (isObject(raw.biomes)) {
		const kinds = Array.isArray(raw.biomes.kinds) ? raw.biomes.kinds : [];
		const usable = normalizeLevelsBiomes(raw.biomes);
		if (kinds.length && (usable?.kinds?.length ?? 0) < kinds.length)
			warn(
				'biomes.kinds',
				'A biome with no id (lower-case letters, digits, - and _), or the same id as one before it, is left out.',
			);
		const ids = (usable?.kinds ?? LEVELS_BIOMES_BUILT_IN).map((k) => k.id);
		const sequences = isObject(raw.biomes.sequences) ? raw.biomes.sequences : {};
		for (const [key, list] of Object.entries(sequences)) {
			if (key !== '*' && !seedKey(key)) {
				warn(`biomes.sequences.${key}`, `"${key}" is not a seed or "*"; it is left out.`);
				continue;
			}
			for (const entry of Array.isArray(list) ? list : [])
				if (!isObject(entry) || typeof entry.biome !== 'string' || !ids.includes(entry.biome))
					warn(
						`biomes.sequences.${key}`,
						`${JSON.stringify(isObject(entry) ? entry.biome : entry)} is not one of the biomes; its entry is left out.`,
					);
		}
	}
	return issues;
}
