/** Types for Salmons as data (`salmons.js`, P10.16). Pinned by `scripts/check-salmons.mjs`. */

export type SalmonsBand = { y: number; h: number; left: number; right: number; current: number };
export type SalmonsWhirlpool = { x: number; y: number; r: number; spin: -1 | 1 };
export type SalmonsRect = { x: number; y: number; w: number; h: number };

export type SalmonsRiver = {
	seed: string | number;
	world: { w: number; h: number };
	bands: SalmonsBand[];
	whirlpools: SalmonsWhirlpool[];
	source: SalmonsRect;
	sea: SalmonsRect;
	spawn: { x: number; y: number };
	botSpawns: { x: number; y: number }[];
};

export const SALMONS_SEED: 'salmons-1';
export const SALMONS_WORLD: Readonly<{ w: 1800; h: 7200 }>;
export const SALMONS_COMPONENTS: Readonly<{
	salmon: 'salmonsSalmon';
	bear: 'salmonsBear';
	fisherman: 'salmonsFisherman';
}>;

export function salmonsRiver(seed?: string | number): SalmonsRiver;
/** A `GameConfigDoc` (as plain JSON: this package depends on nothing). */
export function salmonsConfig(river?: SalmonsRiver): Record<string, unknown>;
