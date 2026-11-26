import {
	LEVELS_GENERATOR_DEFAULTS,
	LEVELS_GENERATOR_LIMITS,
	LEVELS_GENERATOR_WHOLE,
	type LevelsGenerator,
	type LevelsGeneratorParam,
} from 'game-config';

/**
 * `/editor`'s GENERATOR SETTINGS (`docs/design/salmons-levels.md` §6): every number of
 * `levels.generator`, grouped into the cards the Generated level shows them in, each with its
 * label and help. The values, defaults and limits are `engine-mechanics` `SALMONS_GENERATOR`'s,
 * read through Game Config; this file only says how a person reads them.
 */

export type LevelParam = {
	key: LevelsGeneratorParam;
	label: string;
	help: string;
	/** The step a slider and the field move by. */
	step: number;
};
export type LevelParamGroup = { id: string; title: string; info: string; params: LevelParam[] };

const p = (key: LevelsGeneratorParam, label: string, help: string, step?: number): LevelParam => ({
	key,
	label,
	help,
	step: step ?? (LEVELS_GENERATOR_WHOLE.includes(key) ? 1 : 0.01),
});

export const LEVEL_PARAM_GROUPS: readonly LevelParamGroup[] = [
	{
		id: 'level-river',
		title: 'River shape',
		info: 'How long the river is, how wide at its source and its mouth, and how the generator’s own river meanders. Columns run down the river from the source; cells are the generator’s grid.',
		params: [
			p('riverLength', 'Length (columns)', 'Columns from the source to the sea.'),
			p(
				'sourceHalfWidth',
				'Source half width',
				'Cells of water each side of the middle at the source.',
			),
			p(
				'mouthHalfWidth',
				'Mouth half width',
				'Cells of water each side of the middle at the sea, before the delta flares.',
			),
			p(
				'meanderAmp',
				'Meander (cells)',
				'How far the generator’s own river swings side to side. A winding river ignores it.',
				0.5,
			),
			p(
				'meanderFreq',
				'Meander frequency',
				'How often it swings: higher swings more often.',
				0.001,
			),
		],
	},
	{
		id: 'level-course',
		title: 'Course',
		info: 'How a winding river lays out its reaches: the straight runs, a reach’s length in river widths, how far it may wander and how its bends share the angle. Read only with Winding river on.',
		params: [
			p('sourceRun', 'Straight at source', 'Columns that run straight below the source.'),
			p(
				'fallRunMin',
				'Straight by a fall, least',
				'Columns that run straight each side of a waterfall, at the least.',
			),
			p('fallRunMax', 'Straight by a fall, most', 'And at the most (a wider river runs further).'),
			p(
				'windingEnd',
				'Bends end at',
				'Where the bends stop, as a share of the river; below it the delta runs straight.',
			),
			p('reachMin', 'Reach, shortest', 'The shortest a reach between two bends may be, cells.', 1),
			p('reachMax', 'Reach, longest', 'The longest a reach may be, cells.', 1),
			p(
				'reachSourceMin',
				'Reach at source, least',
				'A reach’s length near the source, in widths of the river there: the least.',
				0.1,
			),
			p('reachSourceMax', 'Reach at source, most', 'The most.', 0.1),
			p(
				'reachEndMin',
				'Reach at the end, least',
				'A reach’s length where the bends end, in river widths: the least.',
				0.1,
			),
			p('reachEndMax', 'Reach at the end, most', 'The most.', 0.1),
			p(
				'wander',
				'Wander (cells)',
				'How far the river’s middle may stray from the source’s line before it turns back.',
				1,
			),
			p(
				'bendMin',
				'Bend share, least',
				'A bending reach turns by this share of the sharpest turn, at the least.',
			),
			p('bendMax', 'Bend share, most', 'At the most.'),
			p(
				'quietMin',
				'Quiet share, least',
				'A nearly straight reach turns by this share, at the least.',
			),
			p('quietMax', 'Quiet share, most', 'At the most.'),
			p('firstBends', 'First bends', 'Reaches below the source that always bend.'),
			p(
				'falloff',
				'Falloff',
				'How fast the sharpness falls towards the sea: above 1 keeps it near the source.',
				0.05,
			),
		],
	},
	{
		id: 'level-waterfalls',
		title: 'Waterfalls',
		info: 'How many waterfalls a level has and how high, and where the generator’s own stand. A salmon climbs a waterfall a tap at a time.',
		params: [
			p('waterfallFrom', 'First column', 'The generator’s own waterfalls stand from this column…'),
			p(
				'waterfallEvery',
				'Every (columns)',
				'…on every column that is a whole number of this many. A count above spreads them evenly instead.',
			),
			p(
				'waterfallClearance',
				'Clearance',
				'Columns each side of a waterfall kept clear of rocks and whirlpools.',
			),
			p(
				'waterfallDrop',
				'Height drop',
				'With no heights given, how far under its place’s cap a waterfall may be, cells.',
			),
		],
	},
	{
		id: 'level-pieces',
		title: 'Rocks and whirlpools',
		info: 'Where rocks and whirlpools are laid, how many and how big. Each column above the sand may hold one; a biome can raise or lower the density over its stretch.',
		params: [
			p('obstacleFrom', 'First column', 'Pieces are laid from this column down to the sand.'),
			p('obstacleChance', 'Chance a column', 'A column’s chance of a rock or a whirlpool.'),
			p('whirlpoolShare', 'Whirlpools’ share', 'Of those pieces, the share that are whirlpools.'),
			p('obstacleMargin', 'Bank margin', 'Cells kept clear of each bank.'),
			p('rockSize', 'Rock size (cells)', 'A rock’s width and depth.', 0.1),
			p('whirlpoolRadius', 'Whirlpool radius (px)', 'A whirlpool’s pull reaches this far.', 1),
		],
	},
	{
		id: 'level-bridges',
		title: 'Bridges',
		info: 'The plank bridges fishermen cross on: how many, how high, and where they may stand.',
		params: [
			p('bridgeCount', 'Most', 'Bridges a level has at most.'),
			p('bridgeHeight', 'Height (cells)', 'A deck’s height over the water.'),
			p('bridgeFrom', 'First column', 'Bridges stand from this column down.'),
			p('bridgeFallClearance', 'From a waterfall', 'Columns a bridge keeps from a waterfall.'),
			p('bridgeSpacing', 'Apart', 'Columns two bridges keep apart.'),
			p('bridgeSandGap', 'Above the sand', 'Columns a bridge keeps above the sand.'),
		],
	},
	{
		id: 'level-delta',
		title: 'Sea and delta',
		info: 'The delta: where the river flares and its sand islands grow (a few passes of a cellular automaton), and the world past the river’s ends and banks.',
		params: [
			p('deltaStart', 'Delta from', 'Where the river starts to flare, as a share of its length.'),
			p('deltaFlare', 'Flare (cells)', 'How much wider the river grows by the sea.', 1),
			p(
				'sandStart',
				'Sand from',
				'Where the sand islands start, as a share of the length. No waterfall, rock or bridge below it.',
			),
			p('sandEndGap', 'Sand stops above sea', 'Columns above the sea the sand stops.'),
			p('sandSeed', 'Sand seeded', 'The share of the delta’s cells sand starts on.'),
			p('sandPasses', 'Passes', 'How many times the islands grow and shrink.'),
			p('sandBirth', 'Grows with', 'Sand neighbours a bare cell needs to become sand.'),
			p('sandSurvive', 'Stays with', 'Sand neighbours a sand cell needs to stay.'),
			p('sandMargin', 'Bank margin', 'Cells of the delta kept clear of each bank.'),
			p('sourceRows', 'Rows above source', 'Rows of world above the source.'),
			p('seaRows', 'Rows of sea', 'Rows of sea below the river.'),
			p(
				'bankCells',
				'Bank (cells)',
				'Cells of bank and forest past the widest water each side: the bears’ and fishermen’s room.',
			),
		],
	},
	{
		id: 'level-spawns',
		title: 'Spawns',
		info: 'Where the salmon start, across a line above the sea, and the places bears and fishermen start on, drawn from the seed; a room picks one at each spawn.',
		params: [
			p('salmonSpawnAbove', 'Salmon above sea', 'Columns above the sea the salmon start on.'),
			p(
				'salmonSpread',
				'Salmon spread',
				'How far across the river they start, as a share of its half width.',
			),
			p('catcherPlaces', 'Catcher places', 'Places a level offers bears and fishermen at most.'),
			p('catcherTries', 'Tries a place', 'Tries for each place before the list ends.'),
			p('catcherEnds', 'Clear of the ends', 'Columns kept clear at the source and the sea.'),
			p('catcherPast', 'Past the water', 'Cells past the water’s edge a place is at the least…'),
			p('catcherSpread', 'And up to', '…and up to this many more.'),
			p('catcherApart', 'Apart (cells)', 'How far apart two places are at the least.'),
		],
	},
];

/** A setting's value as the level plays it: the authored one, else its default. */
export const paramValue = (generator: LevelsGenerator | undefined, key: LevelsGeneratorParam) =>
	generator?.[key] ?? LEVELS_GENERATOR_DEFAULTS[key];

/** A typed or slid value held to its setting's limits (whole where it must be). */
export function heldParam(key: LevelsGeneratorParam, value: number): number {
	const [lo, hi] = LEVELS_GENERATOR_LIMITS[key];
	const held = Math.min(hi, Math.max(lo, value));
	return LEVELS_GENERATOR_WHOLE.includes(key) ? Math.round(held) : held;
}

/** `generator` with `key` set (its default, or nothing: left out, the default plays). */
export function withParam(
	generator: LevelsGenerator | undefined,
	key: LevelsGeneratorParam,
	value: number | undefined,
): LevelsGenerator {
	const next = { ...generator };
	if (value === undefined || !Number.isFinite(value) || value === LEVELS_GENERATOR_DEFAULTS[key])
		delete next[key];
	else next[key] = heldParam(key, value);
	return next;
}

/** `generator` with every setting of `group` back to its default. */
export function withoutGroup(
	generator: LevelsGenerator | undefined,
	group: LevelParamGroup,
): LevelsGenerator {
	const next = { ...generator };
	for (const { key } of group.params) delete next[key];
	return next;
}
