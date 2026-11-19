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

/** The tiles built beside the sheets (`sheets/<name>.webp`), drawn or not yet. */
export const SALMONS_TILES = ['waterfall_face', 'cliff'] as const;

/**
 * The tiles the drawing code draws (a TilingSprite each), so `load.ts` loads and a project sheet may
 * replace them: the waterfall's face and the cliff under it (`river.ts`). A tile built but not yet
 * drawn joins only when something draws it: every name here must resolve, or the whole art fails to
 * load.
 */
export const SALMONS_DRAWN_TILES = ['waterfall_face', 'cliff'] as const;

/** Every name the drawing code draws: the sheets' regions and the drawn tiles. */
export const SALMONS_DRAWN: readonly string[] = [
	...Object.values(SALMONS_REGIONS).flat(),
	...SALMONS_DRAWN_TILES,
];

/** The built-in sheets a draw still needs: those with a region the project's art does not ship. */
export function builtinSheetsNeeded(project: Readonly<Record<string, unknown>>): SalmonsSheet[] {
	return (Object.keys(SALMONS_REGIONS) as SalmonsSheet[]).filter((sheet) =>
		SALMONS_REGIONS[sheet].some((name) => !project[name]),
	);
}

/**
 * Each drawn name's art: the project's (its published sheets) when it ships the name, else the
 * built-in copy's. Throws for a name neither has, so a broken load keeps the placeholders.
 */
export function pickSalmonsRegions<T>(
	project: Readonly<Record<string, T | undefined>>,
	builtin: Readonly<Record<string, T | undefined>>,
): Record<string, T> {
	const out: Record<string, T> = {};
	for (const name of SALMONS_DRAWN) {
		const art = project[name] ?? builtin[name];
		if (!art) throw new Error(`[salmons-art] no art for the region "${name}"`);
		out[name] = art;
	}
	return out;
}

/**
 * The compass tile an autotile cell draws, from which of its four neighbours are the same ground,
 * named by the side of the diamond they are drawn across (`n` its up-right edge, `e` down-right,
 * `s` down-left, `w` up-left: the art's own names; `river.ts` reads each world neighbour on the side
 * the projector draws it): an outer corner where two neighbouring sides meet water, an edge where
 * one does, the centre where none does (the old client's `getGrassTileByMask`).
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
