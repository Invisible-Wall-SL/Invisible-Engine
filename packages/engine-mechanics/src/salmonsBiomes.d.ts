/** Types for `salmonsBiomes.js`, Salmons' biomes. Pinned by `scripts/check-salmons-levels.mjs`. */

/** A biome whole, as a level plays and draws it. */
export type SalmonsBiome = {
	id: string;
	name?: string;
	/** Tree variants (0–5) it grows. */
	trees: number[];
	treeChance: number;
	/** Cells of grass past the water. */
	grass: number;
	/** The forest wall's depth past the grass, cells. */
	forest: number;
	/** `#rrggbb`: the grass's tint (white: the art's own), the floor beyond, the riverbed's sands. */
	grassTint: string;
	forestFloor: string;
	riverbed: string[];
	/** Densities as a multiple of the generator's (1: its own). */
	rocks: number;
	whirlpools: number;
	sand: number;
	/** The share of its waterfalls kept, 0–1. */
	waterfalls: number;
	bridges: boolean;
};
/** One entry of a biome sequence: the biome from river column `from` down. */
export type SalmonsBiomeStart = { from: number; biome: string };
/** A config's `levels.biomes`, as authored: every part optional. */
export type SalmonsBiomesBlock = {
	kinds?: (Partial<SalmonsBiome> & { id: string })[];
	cycle?: number;
	sequences?: Record<string, SalmonsBiomeStart[]>;
};
/** The biomes the level of one seed plays. */
export type SalmonsBiomes = {
	kinds: SalmonsBiome[];
	cycle: number;
	sequence?: SalmonsBiomeStart[];
};

export const SALMONS_BIOME_LOOK: Readonly<
	Pick<SalmonsBiome, 'treeChance' | 'grass' | 'forest' | 'grassTint' | 'forestFloor'> & {
		riverbed: readonly string[];
	}
>;
export const SALMONS_BIOME_PLAY: Readonly<
	Pick<SalmonsBiome, 'rocks' | 'whirlpools' | 'sand' | 'waterfalls' | 'bridges'>
>;
export const SALMONS_BIOMES: readonly Readonly<SalmonsBiome>[];
export const SALMONS_BIOME_CYCLE: 35;
export const SALMONS_BIOME_LIMITS: Readonly<
	Record<
		| 'kinds'
		| 'tree'
		| 'treeChance'
		| 'grass'
		| 'forest'
		| 'riverbed'
		| 'rocks'
		| 'whirlpools'
		| 'sand'
		| 'waterfalls'
		| 'cycle'
		| 'from'
		| 'sequence',
		readonly [number, number]
	>
>;
export function resolveBiomes(raw: unknown, seed: string | number): SalmonsBiomes | undefined;
export function biomeStretchAt(
	biomes: SalmonsBiomes,
	gx: number,
): { stretch: number; kind: SalmonsBiome };
export function biomeAt(biomes: SalmonsBiomes, gx: number): SalmonsBiome;
export function biomeStretches(
	biomes: SalmonsBiomes,
	from: number,
	to: number,
): { from: number; to: number; kind: SalmonsBiome }[];
export function seedBiomes(
	biomes: SalmonsBiomes,
): Required<Omit<SalmonsBiomesBlock, 'sequences'>> & Pick<SalmonsBiomesBlock, 'sequences'>;
