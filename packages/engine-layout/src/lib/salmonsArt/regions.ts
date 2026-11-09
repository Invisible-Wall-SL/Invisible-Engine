/**
 * The regions Salmons' built-in art draws, by sheet (`sheets/<sheet>.json`, made by
 * `scripts/salmons/build-art.py`). Pure, so `check:salmons-art` holds the committed sheets to it.
 */

const COMPASS = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'] as const;
export type Compass = (typeof COMPASS)[number];

const numbered = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, i) => `${prefix}_${i}`);

export const SALMONS_REGIONS = {
	terrain: [...COMPASS.map((d) => `grass_${d}`), ...COMPASS.map((d) => `sand_${d}`)],
	props: [
		...numbered('rock', 9),
		...numbered('whirlpool', 4),
		...numbered('tree', 6),
		...numbered('waterfall_splash', 4),
		...numbered('waterfall_lip', 4),
	],
	characters: ['salmon_pink', 'salmon_golden', 'bear'],
} as const;

export type SalmonsSheet = keyof typeof SALMONS_REGIONS;

/** The tiles drawn by a TilingSprite, kept out of the sheets (`sheets/<name>.webp`). */
export const SALMONS_TILES = ['waterfall_face'] as const;

/**
 * The compass tile an autotile cell draws, from which of its four neighbours are the same ground
 * (`n` the cell above in the world, `e` right, `s` below, `w` left): an outer corner where two
 * neighbouring sides meet water, an edge where one does, the centre where none does (the old
 * client's `getGrassTileByMask`).
 */
export function compassTile(n: boolean, e: boolean, s: boolean, w: boolean): Compass {
	if (!n && !e) return 'ne';
	if (!e && !s) return 'se';
	if (!s && !w) return 'sw';
	if (!n && !w) return 'nw';
	if (!n) return 'n';
	if (!e) return 'e';
	if (!s) return 's';
	if (!w) return 'w';
	return 'c';
}
