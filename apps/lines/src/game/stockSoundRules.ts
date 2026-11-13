/**
 * The REACH of the engine's stock sounds from its own code: every place the runtime sources write a
 * stock sound's name, and why. `stockSounds.ts` loads a stock bank only when something can play a
 * sound in it, and the engine's code is one of those things — the `always` rows below.
 *
 * Import-free on purpose: `scripts/check-stock-sound-coverage.mjs` reads it under plain Node and holds
 * it to the sources, so a coded play added later cannot leave its bank unloaded unseen.
 */

/**
 * Why a stock sound's name is written in a runtime source.
 *
 * - `always` — the engine's own code plays it, whatever the game's data says: its bank always loads.
 * - `slot` — a slot's catalogue default (`game-config` `SOUND_SLOTS`): its bank loads when a slot
 *   resolves to it, which `stockSounds.ts` works out the way the game's `activeSounds()` does.
 * - `devFlow` — a reference flow: run only behind a dev opt-in (`?flowV2=lines`, `?flowV2=stacked`),
 *   which loads every bank, or seeded into a new project's flow doc, where the export reads it as
 *   that game's data.
 * - `declaration` — the `SoundName` union and its generated vocabulary enums: types and dropdown
 *   values, nothing that plays.
 */
export const STOCK_SOUND_RULES = ['always', 'slot', 'devFlow', 'declaration'] as const;
export type StockSoundRule = (typeof STOCK_SOUND_RULES)[number];
export type StockSoundConsumer = { file: string; rule: StockSoundRule; names: readonly string[] };

const WIN_LEVEL_BEDS = [
	'bgm_winlevel_big',
	'bgm_winlevel_epic',
	'bgm_winlevel_max',
	'bgm_winlevel_mega',
	'bgm_winlevel_superwin',
];
const ladder = (stem: string): string[] => [1, 2, 3, 4, 5].map((n) => `${stem}${n}`);

/** Every runtime source that writes a stock sound's name, and why. Paths are repo-relative. */
export const STOCK_SOUND_CONSUMERS: readonly StockSoundConsumer[] = [
	{
		file: 'apps/lines/src/components/Sound.svelte',
		rule: 'always',
		names: ['sfx_btn_general', 'sfx_btn_spin', 'sfx_btn_stop', 'sfx_winlevel_end'],
	},
	{
		file: 'apps/lines/src/game/anticipationPresentation.ts',
		rule: 'always',
		names: ['sfx_anticipation', 'sfx_anticipation_start'],
	},
	{
		file: 'apps/lines/src/game/bookEventHandlerMap.ts',
		rule: 'always',
		names: ['sfx_scatter_win_v2', 'sfx_winlevel_small'],
	},
	{ file: 'apps/lines/src/game/flowEffects.ts', rule: 'always', names: ['sfx_bigwin_coinloop'] },
	// The coded win ladder: the tiers a project with no authored `winLevels` presents, and the coded
	// row any authored tier falls back to by level or alias.
	{ file: 'packages/engine-game/src/game/winLevelMap.ts', rule: 'always', names: WIN_LEVEL_BEDS },
	// A Hold and Win preset's tiers: written into a new project's config, and read from code too.
	{ file: 'packages/game-config/src/holdAndWinPresets.ts', rule: 'always', names: WIN_LEVEL_BEDS },
	{
		file: 'packages/game-config/src/sounds.ts',
		rule: 'slot',
		names: [
			'bgm_main',
			'bgm_freespin',
			...ladder('tumble_win_'),
			...ladder('sfx_reel_stop_'),
			'sfx_symbols_landing',
			'sfx_royals_landing',
			...ladder('sfx_scatter_stop_'),
			'sfx_multiplier_landing',
			'sfx_wild_explode',
		],
	},
	{ file: 'apps/lines/src/game/flowV2StackedDoc.ts', rule: 'devFlow', names: ['bgm_main'] },
	{ file: 'packages/engine-flow-v2/src/reference/arcadeSeed.ts', rule: 'devFlow', names: ['bgm_main'] }, // prettier-ignore
	{
		file: 'packages/engine-flow-v2/src/reference/bookOfChoreo.ts',
		rule: 'devFlow',
		names: [
			'sfx_winlevel_small',
			'sfx_scatter_win_v2',
			'sfx_superfreespin',
			'jng_intro_fs',
			'bgm_freespin',
			'sfx_youwon_panel',
		],
	},
	{
		file: 'packages/engine-flow-v2/src/reference/drivenSeed.ts',
		rule: 'devFlow',
		names: ['bgm_main', 'bgm_freespin'],
	},
	{ file: 'packages/engine-flow-v2/src/reference/match3RgsSeed.ts', rule: 'devFlow', names: ['bgm_main'] }, // prettier-ignore
	{ file: 'packages/engine-flow-v2/src/reference/match3Seed.ts', rule: 'devFlow', names: ['bgm_main'] }, // prettier-ignore
	{ file: 'packages/engine-flow-v2/src/reference/starterDoc.ts', rule: 'devFlow', names: ['bgm_main'] }, // prettier-ignore
	{ file: 'apps/lines/src/game/sound.ts', rule: 'declaration', names: declaredStockSounds() },
	{
		file: 'packages/engine-flow-v2/src/reference/soundEnums.generated.ts',
		rule: 'declaration',
		names: declaredStockSounds(),
	},
];

/** Every stock sound: the `SoundName` union and its generated enums name each one. */
function declaredStockSounds(): string[] {
	return [
		'bgm_freespin',
		'bgm_main',
		...WIN_LEVEL_BEDS,
		'jng_intro_fs',
		'sfx_anticipation',
		'sfx_anticipation_start',
		'sfx_bigwin_coinloop',
		'sfx_btn_general',
		'sfx_btn_spin',
		'sfx_btn_stop',
		'sfx_fs_respins',
		'sfx_multiplier_combine_a',
		'sfx_multiplier_combine_b',
		'sfx_multiplier_explosion_a',
		'sfx_multiplier_explosion_b',
		'sfx_multiplier_explosion_c',
		'sfx_multiplier_landing',
		'sfx_multiplier_reset',
		'sfx_multiplier_up',
		'sfx_multiplier_update',
		'sfx_multiplier_win',
		...ladder('sfx_reel_stop_'),
		'sfx_royals_landing',
		'sfx_scatter_reveal',
		...ladder('sfx_scatter_stop_'),
		'sfx_scatter_win',
		'sfx_scatter_win_v2',
		'sfx_superfreespin',
		'sfx_symbols_landing',
		'sfx_wild_explode',
		'sfx_winlevel_end',
		'sfx_winlevel_nice',
		'sfx_winlevel_small',
		'sfx_winlevel_standard',
		'sfx_winlevel_substantial',
		'sfx_youwon_panel',
		...ladder('tumble_win_'),
	];
}

/** The stock sounds the engine's own code plays whatever a game's data says: their banks always load. */
export const CODED_STOCK_SOUNDS: readonly string[] = [
	...new Set(STOCK_SOUND_CONSUMERS.filter((c) => c.rule === 'always').flatMap((c) => c.names)),
].sort();
