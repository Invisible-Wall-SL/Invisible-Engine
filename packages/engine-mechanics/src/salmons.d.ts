/** Types for Salmons as data (`salmons.js`, P10.16). Pinned by `scripts/check-room-bots.mjs`. */

export type SalmonsBand = { y: number; h: number; left: number; right: number; current: number };
export type SalmonsWhirlpool = { x: number; y: number; r: number; spin: -1 | 1 };
export type SalmonsRect = { x: number; y: number; w: number; h: number };

export type SalmonsRiver = {
	seed: string | number;
	world: { w: number; h: number };
	bands: SalmonsBand[];
	whirlpools: SalmonsWhirlpool[];
	/** Solid in the water (P11.3). */
	rocks: SalmonsRect[];
	/** Ground a salmon until it jumps. */
	sandbanks: SalmonsRect[];
	/** Stop a salmon from below until it climbs; across the whole river. */
	waterfalls: SalmonsRect[];
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

/** What of the game a river decides, as `onlineGenerators.js` swaps it into a room's game. */
export type SalmonsGeometry = {
	field: { w: number; h: number };
	zones: { id: string; x: number; y: number; w: number; h: number }[];
	zoneRules: {
		zone: string;
		force?: { x: number; y: number };
		solid?: true | 'below';
		kind?: string;
		goal?: boolean;
		characters?: string[];
	}[];
	spawn: { x: number; y: number };
	/** By online character id. */
	spawns: Record<string, { x: number; y: number }[]>;
	botSpawns: { x: number; y: number }[];
};
export function salmonsGeometry(river: SalmonsRiver): SalmonsGeometry;
/** A `GameConfigDoc` (as plain JSON: this package depends on nothing). */
export function salmonsConfig(river?: SalmonsRiver): Record<string, unknown>;
