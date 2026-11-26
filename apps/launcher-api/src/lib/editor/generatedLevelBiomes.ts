import {
	SALMONS_BIOME_LOOK,
	biomeStretches,
	resolveBiomes,
	type SalmonsBiome,
	type SalmonsBiomes,
} from 'engine-mechanics';
import {
	LEVELS_BIOMES_BUILT_IN,
	LEVELS_BIOME_LIMITS,
	type LevelsBiome,
	type LevelsBiomeStart,
	type LevelsBiomes,
} from 'game-config';

/**
 * `/editor`'s BIOMES (`docs/design/salmons-levels.md` §6): pure edits of a config's
 * `levels.biomes` for the Biomes card (`EditorLevelBiomes.svelte`), and what its strip shows. The
 * level and its art read the same block through `engine-mechanics` `resolveBiomes`, so what the
 * strip paints is what a room plays and a device draws.
 */

/** A sequence's scope: one seed's own (its decimal string), or `'*'` for every level. */
export type BiomeScope = string;

/** The biomes the level of `seed` plays: the original's six when the config authors none. */
export const biomesOf = (biomes: LevelsBiomes | undefined, seed: number): SalmonsBiomes =>
	resolveBiomes(biomes ?? {}, seed);

/** The block a "use authored biomes" tick writes: the six built-in kinds by id, so the level is
 *  the one without it and a room draws it the same (the `/editor` stage marks each stretch's floor)
 *  until something is changed. */
export const builtInBiomes = (): LevelsBiomes => ({
	kinds: LEVELS_BIOMES_BUILT_IN.map((b) => ({ id: b.id })),
});

/** The authored kinds, the built-in six named by id when the block lists none. */
const kindsOf = (biomes: LevelsBiomes): LevelsBiome[] =>
	biomes.kinds?.length ? biomes.kinds : LEVELS_BIOMES_BUILT_IN.map((b) => ({ id: b.id }));

/** A new kind: the generator's own densities and the original's looks, all six trees. */
export function addBiome(biomes: LevelsBiomes): { biomes: LevelsBiomes; id: string } {
	const kinds = kindsOf(biomes);
	let n = kinds.length + 1;
	while (kinds.some((k) => k.id === `biome${n}`)) n++;
	const id = `biome${n}`;
	if (kinds.length >= LEVELS_BIOME_LIMITS.kinds[1]) return { biomes, id: kinds[0].id };
	return { biomes: { ...biomes, kinds: [...kinds, { id, name: `Biome ${n}` }] }, id };
}

/** `biomes` with kind `id` patched (a field set to `undefined` goes back to its default). */
export function patchBiome(
	biomes: LevelsBiomes,
	id: string,
	patch: Partial<Omit<LevelsBiome, 'id'>>,
): LevelsBiomes {
	return {
		...biomes,
		kinds: kindsOf(biomes).map((k) => {
			if (k.id !== id) return k;
			const next: LevelsBiome = { ...k, ...patch };
			for (const key of Object.keys(patch) as (keyof LevelsBiome)[])
				if (next[key] === undefined) delete next[key];
			return next;
		}),
	};
}

/** Kind `id` moved `by` places in the list (the order a cycle takes them in). */
export function moveBiome(biomes: LevelsBiomes, id: string, by: number): LevelsBiomes {
	const kinds = [...kindsOf(biomes)];
	const at = kinds.findIndex((k) => k.id === id);
	const to = at + by;
	if (at < 0 || to < 0 || to >= kinds.length) return biomes;
	[kinds[at], kinds[to]] = [kinds[to], kinds[at]];
	return { ...biomes, kinds };
}

/** Kind `id` removed, and every sequence entry that names it (a sequence left empty with it).
 *  The last kind stays. */
export function removeBiome(biomes: LevelsBiomes, id: string): LevelsBiomes {
	const kinds = kindsOf(biomes).filter((k) => k.id !== id);
	if (!kinds.length) return biomes;
	const sequences: Record<string, LevelsBiomeStart[]> = {};
	for (const [scope, list] of Object.entries(biomes.sequences ?? {})) {
		const kept = list.filter((e) => e.biome !== id);
		if (kept.length) sequences[scope] = kept;
	}
	const next: LevelsBiomes = { ...biomes, kinds, sequences };
	if (!Object.keys(sequences).length) delete next.sequences;
	return next;
}

/** The sequence authored for `scope`, or none. */
export const sequenceOf = (biomes: LevelsBiomes | undefined, scope: BiomeScope) =>
	biomes?.sequences?.[scope];

/** `biomes` with `scope`'s sequence set (`undefined` or empty: none, the cycle or `'*'`'s plays). */
export function setSequence(
	biomes: LevelsBiomes,
	scope: BiomeScope,
	entries: LevelsBiomeStart[] | undefined,
): LevelsBiomes {
	const sequences = { ...(biomes.sequences ?? {}) };
	if (entries?.length) sequences[scope] = [...entries].sort((a, b) => a.from - b.from);
	else delete sequences[scope];
	const next: LevelsBiomes = { ...biomes, sequences };
	if (!Object.keys(sequences).length) delete next.sequences;
	return next;
}

/** The stretches the level of `seed` plays, `riverLength` columns from the source, as a sequence:
 *  what laying one out starts from (the cycle's turns, or the sequence in effect). */
export function sequenceFrom(
	biomes: LevelsBiomes,
	seed: number,
	riverLength: number,
): LevelsBiomeStart[] {
	return biomeStretches(biomesOf(biomes, seed), 0, riverLength)
		.slice(0, LEVELS_BIOME_LIMITS.sequence[1])
		.map(({ from, kind }) => ({ from, biome: kind.id }));
}

/** Entry `i`'s start moved to `from`, kept a column past the one before it and short of the one
 *  after (the first starts at the source). */
export function moveStart(
	entries: LevelsBiomeStart[],
	i: number,
	from: number,
	riverLength: number,
): LevelsBiomeStart[] {
	if (i <= 0 || i >= entries.length) return entries;
	const lo = entries[i - 1].from + 1;
	const hi = (entries[i + 1]?.from ?? riverLength) - 1;
	const at = Math.round(Math.min(hi, Math.max(lo, from)));
	return entries.map((e, k) => (k === i ? { ...e, from: at } : e));
}

/** Stretch `i` split at its middle, the new half the same biome; none when it is one column. */
export function splitStretch(
	entries: LevelsBiomeStart[],
	i: number,
	riverLength: number,
): LevelsBiomeStart[] {
	const from = entries[i].from;
	const to = entries[i + 1]?.from ?? riverLength;
	if (to - from < 2 || entries.length >= LEVELS_BIOME_LIMITS.sequence[1]) return entries;
	const mid = Math.round((from + to) / 2);
	return [
		...entries.slice(0, i + 1),
		{ from: mid, biome: entries[i].biome },
		...entries.slice(i + 1),
	];
}

/** Stretch `i` taken out: the one before it runs on over its columns (the first's next starts
 *  at the source). */
export function dropStretch(entries: LevelsBiomeStart[], i: number): LevelsBiomeStart[] {
	if (entries.length <= 1) return entries;
	const next = entries.filter((_, k) => k !== i);
	return next.map((e, k) => (k === 0 ? { ...e, from: 0 } : e));
}

/** The art's grass, untinted: the green its `grass_*` tiles read as from afar. */
const GRASS = '#5d8c35';

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) =>
	`#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** A biome's grass as the art tints it (a tint multiplies). */
export const grassOf = (kind: SalmonsBiome): string => {
	const tint = channels(kind.grassTint ?? SALMONS_BIOME_LOOK.grassTint);
	return toHex(channels(GRASS).map((v, i) => (v * tint[i]) / 255));
};

/** Text that reads on `hex`: near-black on a light colour, white on a dark one. */
export function inkOn(hex: string): string {
	const [r, g, b] = channels(hex).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#111318' : '#ffffff';
}

/** A biome's name as shown: its own, else its id. */
export const biomeName = (kind: Pick<SalmonsBiome, 'id' | 'name'>): string => kind.name ?? kind.id;
