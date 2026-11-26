/**
 * What Salmons' own drawing code (`engine-layout` `salmonsArt/river.ts`) draws for each zone family
 * it draws, as `/config`'s Zone art card shows it under **Default**: a line, and its pictures by
 * built-in sheet (a `SALMONS_PROJECT_SHEETS` key) and region name, the names its project sheets
 * keep. Import-free, so `check:salmons-art` holds every name to `SALMONS_REGIONS` and every family
 * to `SALMONS_DRAWN_ZONE_FAMILIES` without reaching the art.
 */
export type SalmonsBuiltInSheet = 'terrain' | 'props' | 'waterfall_face' | 'cliff';

export const SALMONS_BUILT_IN_ZONE_ART: Readonly<
	Record<string, { label: string; pictures: readonly [SalmonsBuiltInSheet, string][] }>
> = {
	'rock#': {
		label: 'Built-in rocks, one of 9 per rock',
		pictures: Array.from({ length: 9 }, (_, i): [SalmonsBuiltInSheet, string] => [
			'props',
			`rock_${i}`,
		]),
	},
	'whirlpool#': { label: 'Built-in whirlpool, 4 frames', pictures: [['props', 'whirlpool_0']] },
	'waterfall#': {
		label: 'Built-in lip, splash, face and cliff',
		pictures: [
			['props', 'waterfall_lip_0'],
			['props', 'waterfall_splash_0'],
			['waterfall_face', 'waterfall_face'],
			['cliff', 'cliff'],
		],
	},
	'sandbank#': { label: 'Built-in sand tiles', pictures: [['terrain', 'sand_c']] },
	'bridge#': { label: 'Built-in placeholder bridge, drawn in code', pictures: [] },
	source: { label: 'Built-in river water and forest', pictures: [] },
	sea: { label: 'Built-in sea water', pictures: [] },
};
