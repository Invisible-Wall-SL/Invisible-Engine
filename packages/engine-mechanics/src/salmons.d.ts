/** Types for Salmons as data (`salmons.js`, P10.16). Pinned by `scripts/check-room-bots.mjs`. */

export type SalmonsBand = { y: number; h: number; left: number; right: number; current: number };
export type SalmonsWhirlpool = { x: number; y: number; r: number; spin: -1 | 1 };
export type SalmonsRect = { x: number; y: number; w: number; h: number };

export type SalmonsRiver = {
	seed: string | number;
	/** The generator that made it, when not P10.16's `salmonsRiver` (`salmonsMap.js`). */
	generator?: string;
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
	/** An original level's (`salmonsMap.js`): where salmon start, the room picking one. */
	salmonSpawns?: { x: number; y: number }[];
	/** An original level's bridges, as high as `height` cells: fishermen cross on them. */
	bridges?: (SalmonsRect & { height: number })[];
	/** An original level's cell ↔ world transform. */
	grid?: { cell: number; gyMin: number; sourceRows: number };
};

export const SALMONS_SEED: 'salmons-1';
/** What Salmons' bots are called, by class (`bots.characters[].names`). */
export const SALMONS_BOT_NAMES: Readonly<{
	salmon: readonly string[];
	fisherman: readonly string[];
	bear: readonly string[];
}>;
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
		/** A current that pushes only by the body's centre (the river's bands). */
		centre?: boolean;
		/** A pull towards the zone's centre (an original level's whirlpool), px/s and px, times
		 *  `d / unit` (px). */
		pull?: { strength: number; radius: number; unit?: number };
		/** A sandbank that is a run of cells this size, px (an original level's). */
		cell?: number;
		/** A waterfall passed only while a salmon is as high as it (an original level's). */
		aloft?: boolean;
	}[];
	spawn: { x: number; y: number };
	/** By online character id. */
	spawns: Record<string, { x: number; y: number }[]>;
	botSpawns: { x: number; y: number }[];
};
export function salmonsGeometry(river: SalmonsRiver): SalmonsGeometry;
/** The original's whirlpool pull on its own levels: within `radius` px,
 *  `strength · (d / unit) · (1 − d / radius)` px/s towards the centre. */
export const WHIRLPOOL_PULL: Readonly<{ radius: number; strength: number; unit: number }>;
/** The slide on the original's levels (`arcade.online.slide`). */
export const SALMONS_SLIDE: Readonly<{ corner: number }>;
/** The original's bounds on its own levels, cells: the bank limit past the water's edge, the
 *  columns kept from the source and the sea, and a bear's reach to a waterfall. */
export const SALMONS_BOUNDS: Readonly<{ bank: number; ends: number; fallReach: number }>;
/** Salmons' lobby: 4 people, or 60 s after the first, then a 10 s countdown. */
export const SALMONS_LOBBY: Readonly<{
	minPlayers: number;
	maxWaitSeconds: number;
	countdownSeconds: number;
}>;
/** A `GameConfigDoc` (as plain JSON: this package depends on nothing). */
export function salmonsConfig(
	river?: SalmonsRiver,
	options?: {
		lobby?: { minPlayers?: number; maxWaitSeconds?: number; countdownSeconds?: number };
		levels?: import('./salmonsMap').SalmonsLevels;
	},
): Record<string, unknown>;
/** Salmons' levels as the export ships them: a winding river and waterfalls 5 to 10 cells high. */
export const SALMONS_LEVELS: Readonly<{
	river: Readonly<{ winding: number; sharpestTurn: number; sourceBias: number }>;
	waterfalls: Readonly<{ count: number; heightMin: number; heightMax: number }>;
}>;
