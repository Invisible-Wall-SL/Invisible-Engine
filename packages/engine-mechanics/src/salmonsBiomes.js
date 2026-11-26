/**
 * SALMONS' BIOMES (`docs/design/salmons-levels.md` §6): the stretches of a level's river that each
 * grow their own forest, floor and riverbed (the art, `engine-layout` `salmonsArt/river.ts`) and
 * place their own share of rocks, whirlpools, sand, waterfalls and bridges (the generator,
 * `salmonsMap.js`). A config's `arcade.online.levels.biomes` defines them (`kinds`) and lays them
 * along the river from the source to the sea (`sequences`, by seed or `'*'`); with none it is the
 * original's forest: six kinds, each two of the six trees, in turn every {@link SALMONS_BIOME_CYCLE}
 * columns. A biome left at the generator's densities (all 1) changes nothing a room plays.
 *
 * The room, every device and `/editor` resolve them here ({@link resolveBiomes}), from the same
 * levels, so a seed makes the same biomes everywhere. Pure: no `Math.random`, no I/O.
 */

/** The original's forest floor and its nine riverbed sands (the old client's `game.js`). */
const FOREST_FLOOR = '#28591e';
const RIVERBED = Object.freeze([
	'#b89968',
	'#c4a576',
	'#a88858',
	'#d0b487',
	'#b09060',
	'#c8a878',
	'#a07050',
	'#b88f5d',
	'#c59f70',
]);

/** What a biome draws: `trees`, the tree variants (0–5) it grows, one picked at random per tree;
 *  `treeChance`, a grass cell's chance of a lone tree; `grass`, cells of grass past the water;
 *  `forest`, the forest wall's depth past the grass, cells; the grass's tint (white: the art's own
 *  green), the floor beyond and the riverbed's sands, `#rrggbb`. */
export const SALMONS_BIOME_LOOK = Object.freeze({
	treeChance: 0.07,
	grass: 5,
	forest: 12,
	grassTint: '#ffffff',
	forestFloor: FOREST_FLOOR,
	riverbed: RIVERBED,
});

/** What a biome plays: its rocks', whirlpools' and sand's density as a multiple of the
 *  generator's (1: the generator's own), the share of its waterfalls kept (1: all), and whether a
 *  bridge may cross it. */
export const SALMONS_BIOME_PLAY = Object.freeze({
	rocks: 1,
	whirlpools: 1,
	sand: 1,
	waterfalls: 1,
	bridges: true,
});

/** A built-in biome: two trees, the original's looks, the generator's densities. Spelled out, not
 *  spread from the two above, so a bundle that never draws a river drops it. */
const builtIn = (id, a, b) =>
	Object.freeze({
		id,
		trees: Object.freeze([a, b]),
		treeChance: 0.07,
		grass: 5,
		forest: 12,
		grassTint: '#ffffff',
		forestFloor: FOREST_FLOOR,
		riverbed: RIVERBED,
		rocks: 1,
		whirlpools: 1,
		sand: 1,
		waterfalls: 1,
		bridges: true,
	});

/** The original's six biomes, in their turn down the river. */
export const SALMONS_BIOMES = Object.freeze([
	/* @__PURE__ */ builtIn('forest1', 0, 1),
	/* @__PURE__ */ builtIn('forest2', 2, 3),
	/* @__PURE__ */ builtIn('forest3', 4, 5),
	/* @__PURE__ */ builtIn('forest4', 0, 3),
	/* @__PURE__ */ builtIn('forest5', 1, 4),
	/* @__PURE__ */ builtIn('forest6', 2, 5),
]);

/** Columns of the river each biome runs before the next takes over, when no sequence is laid. */
export const SALMONS_BIOME_CYCLE = 35;

/** The values a biome block may take: `[least, most]`. */
export const SALMONS_BIOME_LIMITS = Object.freeze({
	kinds: Object.freeze([1, 16]),
	tree: Object.freeze([0, 5]),
	treeChance: Object.freeze([0, 1]),
	grass: Object.freeze([0, 12]),
	forest: Object.freeze([0, 24]),
	riverbed: Object.freeze([1, 9]),
	rocks: Object.freeze([0, 3]),
	whirlpools: Object.freeze([0, 3]),
	sand: Object.freeze([0, 3]),
	waterfalls: Object.freeze([0, 1]),
	cycle: Object.freeze([1, 400]),
	from: Object.freeze([0, 800]),
	sequence: Object.freeze([0, 64]),
});

const BIOME_ID = /^[a-z0-9_-]{1,32}$/;
const COLOUR = /^#[0-9a-f]{6}$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clampTo = ([lo, hi], v, fallback, whole = false) => {
	if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
	const held = Math.min(hi, Math.max(lo, v));
	return whole ? Math.round(held) : held;
};
const colourOf = (v, fallback) => {
	const c = typeof v === 'string' ? v.toLowerCase() : '';
	return COLOUR.test(c) ? c : fallback;
};

/** A biome's name as kept: at most 40 characters, trimmed after the cut so it reads back as
 *  itself; '' for none. */
const nameOf = (v) => (typeof v === 'string' ? v.trim().slice(0, 40).trim() : '');

/** One authored kind, whole: a field left out (or out of its limits) takes the built-in kind of
 *  its id's, or for a new id {@link SALMONS_BIOME_LOOK} / {@link SALMONS_BIOME_PLAY} and all six
 *  trees. `undefined` for one with no usable id. */
function kindOf(raw) {
	if (!isObject(raw) || typeof raw.id !== 'string' || !BIOME_ID.test(raw.id)) return undefined;
	const L = SALMONS_BIOME_LIMITS;
	const base = SALMONS_BIOMES.find((b) => b.id === raw.id) ?? {
		trees: [0, 1, 2, 3, 4, 5],
		...SALMONS_BIOME_LOOK,
		...SALMONS_BIOME_PLAY,
	};
	const trees = Array.isArray(raw.trees)
		? [...new Set(raw.trees.filter((t) => Number.isInteger(t) && t >= L.tree[0] && t <= L.tree[1]))]
		: [];
	const beds = Array.isArray(raw.riverbed)
		? raw.riverbed.map((c) => colourOf(c, undefined)).filter((c) => c !== undefined)
		: [];
	return {
		id: raw.id,
		...(nameOf(raw.name) ? { name: nameOf(raw.name) } : {}),
		trees: trees.length ? trees : [...base.trees],
		treeChance: clampTo(L.treeChance, raw.treeChance, base.treeChance),
		grass: clampTo(L.grass, raw.grass, base.grass, true),
		forest: clampTo(L.forest, raw.forest, base.forest, true),
		grassTint: colourOf(raw.grassTint, base.grassTint),
		forestFloor: colourOf(raw.forestFloor, base.forestFloor),
		riverbed: beds.length ? beds.slice(0, L.riverbed[1]) : [...base.riverbed],
		rocks: clampTo(L.rocks, raw.rocks, base.rocks),
		whirlpools: clampTo(L.whirlpools, raw.whirlpools, base.whirlpools),
		sand: clampTo(L.sand, raw.sand, base.sand),
		waterfalls: clampTo(L.waterfalls, raw.waterfalls, base.waterfalls),
		bridges: typeof raw.bridges === 'boolean' ? raw.bridges : base.bridges,
	};
}

/** A sequence's entries naming a known kind, ordered from the source, one per column. */
function sequenceOf(raw, ids) {
	if (!Array.isArray(raw)) return [];
	const L = SALMONS_BIOME_LIMITS;
	const at = new Map();
	for (const entry of raw) {
		if (!isObject(entry) || !ids.includes(entry.biome)) continue;
		if (typeof entry.from !== 'number' || !Number.isFinite(entry.from)) continue;
		const from = clampTo(L.from, entry.from, 0, true);
		if (!at.has(from)) at.set(from, entry.biome);
	}
	return [...at]
		.sort((a, b) => a[0] - b[0])
		.slice(0, L.sequence[1])
		.map(([from, biome]) => ({ from, biome }));
}

/**
 * A config's `levels.biomes` as the level of `seed` plays them: `{ kinds, cycle, sequence? }`,
 * every kind whole, or `undefined` when the config has no `biomes` block (the original's forest,
 * and nothing in the level or its art moves). `kinds` absent: the six built-in ones; `sequence`
 * the seed's own (its decimal string), else `'*'`'s; with neither the kinds take turns every
 * `cycle` columns from the source.
 */
export function resolveBiomes(raw, seed) {
	if (!isObject(raw)) return undefined;
	const L = SALMONS_BIOME_LIMITS;
	const authored = Array.isArray(raw.kinds) ? raw.kinds.map(kindOf).filter(Boolean) : [];
	const seen = new Set();
	const kinds = (authored.length ? authored : SALMONS_BIOMES.map((b) => kindOf(b)))
		.filter((k) => !seen.has(k.id) && seen.add(k.id))
		.slice(0, L.kinds[1]);
	const ids = kinds.map((k) => k.id);
	const sequences = isObject(raw.sequences) ? raw.sequences : {};
	const sequence = sequenceOf(sequences[String(seed)] ?? sequences['*'], ids);
	return {
		kinds,
		cycle: clampTo(L.cycle, raw.cycle, SALMONS_BIOME_CYCLE, true),
		...(sequence.length ? { sequence } : {}),
	};
}

/** The stretch of river column `gx` lies in: its number from the source (a sequence's entry, or
 *  a turn of the cycle) and its kind. Columns above the first entry are the first's. */
export function biomeStretchAt(biomes, gx) {
	const { kinds, cycle, sequence } = biomes;
	if (sequence) {
		let at = 0;
		while (at + 1 < sequence.length && sequence[at + 1].from <= gx) at++;
		return { stretch: at, kind: kinds.find((k) => k.id === sequence[at].biome) ?? kinds[0] };
	}
	const turn = Math.floor(gx / cycle);
	return { stretch: turn, kind: kinds[((turn % kinds.length) + kinds.length) % kinds.length] };
}

/** The kind of biome at river column `gx` ({@link biomeStretchAt}). */
export const biomeAt = (biomes, gx) => biomeStretchAt(biomes, gx).kind;

/** Biomes' stretches over columns `from` to `to` (exclusive): `{ from, to, kind }`, in order. */
export function biomeStretches(biomes, from, to) {
	const stretches = [];
	for (let gx = from; gx < to;) {
		const { stretch, kind } = biomeStretchAt(biomes, gx);
		let end = gx + 1;
		while (end < to && biomeStretchAt(biomes, end).stretch === stretch) end++;
		stretches.push({ from: gx, to: end, kind });
		gx = end;
	}
	return stretches;
}

/** A biomes block in the form a config's `levels.biomes` takes, its sequence under `'*'`: what a
 *  room tells its devices (`salmonsMap.js` `seedLevels`), read again by {@link resolveBiomes} as
 *  itself. */
export const seedBiomes = (biomes) => ({
	kinds: biomes.kinds,
	cycle: biomes.cycle,
	...(biomes.sequence ? { sequences: { '*': biomes.sequence } } : {}),
});
