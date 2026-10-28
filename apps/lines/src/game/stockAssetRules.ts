/**
 * The REACH of the stock asset table (`assets.ts`): the names by which each key can be looked up at
 * runtime, and every place in the runtime sources that writes one of those names down.
 *
 * Import-free on purpose: `scripts/check-stock-asset-coverage.mjs` reads it under plain Node to hold
 * it to the sources and the asset files, and `stockAssets.ts` builds its walk on it. See
 * `stockAssets.ts` for what the walk does with it.
 */

/**
 * Every stock key and the names a lookup reaches it by. A rig, a single sprite, the coin sheet and
 * the audio sprite are looked up by their KEY. A `sprites` sheet never is: its frames are spread into
 * `loadedAssets` under their bare names (`pixi-svelte` `assetLoad.ts`), so its names are its frames.
 * A bitmap font is reached by the BMFont face it installs under. `*` stands for a language code.
 */
export const STOCK_NAMES = {
	loader: ['loader'],
	pressToContinueText: ['pressToContinueText_*.png'],
	H1: ['H1'],
	H2: ['H2'],
	H3: ['H3'],
	H4: ['H4'],
	H5: ['H5'],
	L1: ['L1'],
	L2: ['L2'],
	L3: ['L3'],
	L4: ['L4'],
	M: ['M'],
	S: ['S'],
	explosion: ['explosion'],
	W: ['W'],
	reelsFrame: [
		'frame_bg.png',
		'frame_edge.png',
		'frame_fade.png',
		'Frame_FSCounter.png',
		'Frame_Multiplier.png',
		'Frame_Tumble.png',
		'Frame_TumbleWin.png',
		'pressanywhere_fade.png',
	],
	payFrame: ['payFrame'],
	anticipation: ['anticipation'],
	goldFont: ['gold'],
	goldBlur: ['goldblur'],
	silverFont: ['silver'],
	purpleFont: ['purple'],
	bigwin: ['bigwin'],
	globalMultiplier: ['globalMultiplier'],
	fsIntro: ['fsIntro'],
	fsIntroNumber: ['fsIntroNumber'],
	fsOutroNumber: ['fsOutroNumber'],
	foregroundAnimation: ['foregroundAnimation'],
	foregroundFeatureAnimation: ['foregroundFeatureAnimation'],
	tumble_multiplier: ['tumble_multiplier'],
	tumble_win: ['tumble_win'],
	reelhouse: ['reelhouse'],
	progressBar: ['progressBar.png', 'progressBarBackground.png', 'progressBarFrame.png'],
	freeSpins: ['freespins.png', 'freespins_*.png', 'totalwin.png'],
	winSmall: ['winsmall_*.png', 'totalwin.png'],
	clusterWin: ['clusterWin'],
	transition: ['transition'],
	symbolsStatic: [
		'explodedW.png',
		'h1.webp',
		'h2.webp',
		'h3.webp',
		'h4.webp',
		'h5.webp',
		'l1.webp',
		'l2.webp',
		'l3.webp',
		'l4.webp',
		'm1_2x.png',
		'm1_4x.png',
		'm2_5x.png',
		'm2_7x.png',
		'm3_10x.png',
		's.png',
		'w.png',
	],
	coins: ['coins'],
	sound: ['sound'],
} as const satisfies Record<string, readonly string[]>;

export type StockKey = keyof typeof STOCK_NAMES;

export const STOCK_KEYS = Object.keys(STOCK_NAMES) as StockKey[];

/**
 * Stock keys that are ALSO symbol ids. In a game config `H1` is a symbol, not a rig, so the config is
 * read for every name except these; the symbol rule decides them.
 */
export const SYMBOL_RIG_KEYS: readonly StockKey[] = [
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'L1',
	'L2',
	'L3',
	'L4',
	'M',
	'S',
	'W',
];

/** Kept on every boot, whatever the project authored — see `stockAssets.ts` for each reason. */
export const ALWAYS_KEPT: readonly StockKey[] = [
	'sound',
	'goldFont',
	'pressToContinueText',
	'progressBar',
];

/** Sheets that pack the same frame (`totalwin.png`) into one flat texture map: kept together. */
export const KEPT_TOGETHER: readonly (readonly StockKey[])[] = [['freeSpins', 'winSmall']];

const str = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined;
const bool = (value: unknown): boolean | undefined =>
	typeof value === 'boolean' ? value : undefined;

type Params = Record<string, unknown>;
type PartNeeds = (params: Params, props: Params) => readonly string[];

/** `WinVisual.svelte:31-34,59-61`: the rig is the `winSpine` param ?? prop ?? `bigwin` (a tier's own
 *  `<alias>Spine` is a param, collected by the walk); coins unless `showCoins` is false; the count is
 *  drawn in `gold`. */
const winVisualNeeds: PartNeeds = (params, props) => [
	str(params.winSpine) ?? str(props.winSpine) ?? 'bigwin',
	...((bool(params.showCoins) ?? bool(props.showCoins) ?? true) ? ['coins'] : []),
	'gold',
];

const none: PartNeeds = () => [];

/**
 * The stock names each coded part the game registers (`Game.svelte` `registerBoundComponents`)
 * falls back to, given the enclosing instance's params and the bind's props. A part drawn only from
 * its params or from symbols needs nothing here: the walk collects those params, and the symbol rule
 * the art. A registered part missing from this table keeps every stock key, and
 * `scripts/check-stock-asset-coverage.mjs` fails until it is added.
 */
export const PART_NEEDS: Record<string, PartNeeds> = {
	// `Win.svelte:45-46`: the gate plus a `WinVisual` fed the bind's props.
	Win: winVisualNeeds,
	WinVisual: winVisualNeeds,
	WinGate: none,
	// `WinCoinsPart.svelte:16-21`.
	WinCoins: (params) => (params.showCoins !== false ? ['coins'] : []),
	// `Transition.svelte:28-46` → `TransitionAnimation.svelte:23`. Awaited: a missing rig never
	// completes, so a mounted Transition keeps its rig even when nothing is known to fire it.
	Transition: () => ['transition'],
	// `FreeSpinIntroVisual.svelte:29,82,99,111` inside `FreeSpinAnimation.svelte:82`.
	FreeSpinIntroVisual: (params, props) => [
		'fsIntro',
		str(params.introSpine) ?? str(props.introSpine) ?? 'fsIntroNumber',
		'freespins_*.png',
		'freespins.png',
		'gold',
	],
	// `FreeSpinOutroVisual.svelte:23,90,97,114,127` inside `FreeSpinAnimation.svelte:82`.
	FreeSpinOutroVisual: (params, props) => [
		'fsIntro',
		str(params.outroSpine) ?? str(props.outroSpine) ?? 'fsOutroNumber',
		'freespins_*.png',
		'winsmall_*.png',
		'totalwin.png',
		'gold',
	],
	// `FreeSpinIntroSymbolReveal.svelte:25`.
	FreeSpinIntroSymbolReveal: (params, props) => [
		str(params.introSpine) ?? str(props.introSpine) ?? 'fsIntro',
	],
	// `FreeSpinCounter.svelte:17,75,86`.
	FreeSpinCounter: () => ['Frame_FSCounter.png', 'gold'],
	// `components-ui-pixi` `LoadingBar.svelte:50-52,65-67`.
	LoadingBar: (params) => [
		str(params.imageBackground) ?? 'progressBarBackground.png',
		str(params.imageProgress) ?? 'progressBar.png',
		str(params.imageFrame) ?? 'progressBarFrame.png',
	],
	// `TapToContinue.svelte:58` → `PressToContinue.svelte:39-49`.
	TapToContinue: () => ['pressToContinueText_*.png'],
	HudReadout: none,
	HudTicker: none,
	HudCaption: none,
	HudValue: none,
	HudGameName: none,
	HudLogo: none,
	ButtonFrame: none,
	ButtonLabel: none,
	SpecialBook: none,
	ExpandingSymbol: none,
	messageSymbol: none,
	revealSymbolRider: none,
	PotMeter: none,
	RespinCounterPart: none,
	JackpotTilePart: none,
	TotalWinBarPart: none,
	LettersStrip: none,
	LetterTilePart: none,
	CellTilePart: none,
	HoldAndWinWheelPart: none,
	RespinCellTiles: none,
	RespinLockedRows: none,
	LineOverlayPart: none,
};

/** Whether `value` names `name`, where `*` in `name` stands for any run of characters. */
export const nameMatches = (name: string, value: string): boolean =>
	name.includes('*')
		? new RegExp(`^${name.split('*').map(escapeRegExp).join('.+')}$`).test(value)
		: name === value;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Why a stock name is written in a runtime source. Every literal the coverage guard finds must be
 * listed below under one of these, so a new consumer cannot reach a stock key unseen.
 *
 * - `symbols` — a coded symbol cell, a symbol state or a symbol id: the symbol rule.
 * - `part` — a bound coded part: {@link PART_NEEDS}.
 * - `mount` — a coded mount the game always makes: `codedMountNeeds` in `stockAssets.ts`.
 * - `always` — a key in {@link ALWAYS_KEPT}.
 * - `flags` — a built-in the authored-overlay flags swap in: `AUTHORED_OVERLAY_DEFS` there.
 * - `builtinDef` — a built-in ComponentDef; the reference walk expands it where it is placed.
 * - `fallbackScene` — reference-layout content: walked when the game mounts it as a fallback scene
 *   (`sceneSelection.ts`), otherwise only reachable once copied into a project's doc.
 * - `reference` — declares the name so authored data can use it; kept only when it does.
 * - `editorOnly` — editor metadata or previews; the game never looks it up.
 * - `notAsset` — the same word naming something else (an event, a pot, an overlay id).
 */
export type StockRule =
	| 'symbols'
	| 'part'
	| 'mount'
	| 'always'
	| 'flags'
	| 'builtinDef'
	| 'fallbackScene'
	| 'reference'
	| 'editorOnly'
	| 'notAsset';

export type StockConsumer = { file: string; rule: StockRule; names: readonly string[] };

/** Every runtime source that writes a stock name, and why. Paths are repo-relative. */
export const STOCK_CONSUMERS: readonly StockConsumer[] = [
	{ file: 'apps/lines/src/components/Board.svelte', rule: 'symbols', names: ['explosion'] },
	{ file: 'apps/lines/src/components/BoardFrame.svelte', rule: 'mount', names: ['reelhouse'] },
	{
		file: 'apps/lines/src/components/Effects.svelte',
		rule: 'mount',
		names: ['foregroundAnimation'],
	},
	{ file: 'apps/lines/src/components/EnableSound.svelte', rule: 'always', names: ['sound'] },
	{ file: 'apps/lines/src/components/FreeSpinAnimation.svelte', rule: 'part', names: ['fsIntro'] },
	{
		file: 'apps/lines/src/components/FreeSpinCounter.svelte',
		rule: 'part',
		names: ['Frame_FSCounter.png', 'gold'],
	},
	{
		file: 'apps/lines/src/components/FreeSpinIntroSymbolReveal.svelte',
		rule: 'part',
		names: ['fsIntro'],
	},
	{
		file: 'apps/lines/src/components/FreeSpinIntroVisual.svelte',
		rule: 'part',
		names: ['fsIntroNumber', 'freespins_*.png', 'freespins.png', 'gold'],
	},
	{
		file: 'apps/lines/src/components/FreeSpinOutroVisual.svelte',
		rule: 'part',
		names: ['fsOutroNumber', 'freespins_*.png', 'winsmall_*.png', 'totalwin.png', 'gold'],
	},
	{
		file: 'apps/lines/src/components/Game.svelte',
		rule: 'reference',
		names: ['gold', 'goldblur', 'silver', 'purple'],
	},
	{
		file: 'apps/lines/src/components/Game.svelte',
		rule: 'notAsset',
		names: ['anticipation', 'transition'],
	},
	{ file: 'apps/lines/src/components/ReelSymbol.svelte', rule: 'symbols', names: ['explosion'] },
	{ file: 'apps/lines/src/components/Symbol.svelte', rule: 'symbols', names: ['M'] },
	{ file: 'apps/lines/src/components/Symbol.svelte', rule: 'always', names: ['gold'] },
	{
		file: 'apps/lines/src/components/SymbolWinFrame.svelte',
		rule: 'mount',
		names: ['anticipation'],
	},
	{ file: 'apps/lines/src/components/WinVisual.svelte', rule: 'part', names: ['bigwin', 'gold'] },
	{ file: 'apps/lines/src/editor-scenes.ts', rule: 'notAsset', names: ['anticipation'] },
	{ file: 'apps/lines/src/editor-scenes.ts', rule: 'always', names: ['gold'] },
	{
		file: 'apps/lines/src/game/anticipationPresentation.ts',
		rule: 'mount',
		names: ['anticipation'],
	},
	{ file: 'apps/lines/src/game/bookEventHandlerMap.ts', rule: 'symbols', names: ['explosion'] },
	{
		file: 'apps/lines/src/game/config.ts',
		rule: 'symbols',
		names: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'S'],
	},
	{
		file: 'apps/lines/src/game/constants.ts',
		rule: 'symbols',
		names: [
			'H1',
			'H2',
			'H3',
			'H4',
			'H5',
			'L1',
			'L2',
			'L3',
			'L4',
			'M',
			'S',
			'W',
			'explosion',
			'explodedW.png',
			'h1.webp',
			'h2.webp',
			'h3.webp',
			'h4.webp',
			'h5.webp',
			'l1.webp',
			'l2.webp',
			'l3.webp',
			'l4.webp',
			's.png',
			'w.png',
		],
	},
	{ file: 'apps/lines/src/game/emitterVocabulary.ts', rule: 'notAsset', names: ['transition'] },
	{ file: 'apps/lines/src/game/flowDoc.ts', rule: 'notAsset', names: ['transition'] },
	{ file: 'apps/lines/src/game/flowEffects.ts', rule: 'symbols', names: ['explosion'] },
	{ file: 'apps/lines/src/game/flowV2Runtime.svelte.ts', rule: 'part', names: ['transition'] },
	{
		file: 'apps/lines/src/game/paytable.ts',
		rule: 'symbols',
		names: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'W'],
	},
	{
		file: 'packages/components-shared/src/components/LoaderImage.svelte',
		rule: 'notAsset',
		names: ['loader'],
	},
	{
		file: 'packages/components-ui-pixi/src/components/LoadingBar.svelte',
		rule: 'part',
		names: ['progressBar.png', 'progressBarBackground.png', 'progressBarFrame.png'],
	},
	{
		file: 'packages/engine-flow-v2/src/reference/arcade.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{
		file: 'packages/engine-flow-v2/src/reference/bookOfChoreo.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{
		file: 'packages/engine-flow-v2/src/reference/cards.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{
		file: 'packages/engine-flow-v2/src/reference/match3.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{
		file: 'packages/engine-flow-v2/src/reference/standardVocab.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{
		file: 'packages/engine-flow/src/emitterVocabulary.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{ file: 'packages/engine-flow/src/previewExecutor.ts', rule: 'symbols', names: ['H1', 'H2'] },
	{
		file: 'packages/engine-game/src/components/Background.svelte',
		rule: 'mount',
		names: ['foregroundAnimation', 'foregroundFeatureAnimation'],
	},
	{
		file: 'packages/engine-game/src/components/PressToContinue.svelte',
		rule: 'always',
		names: ['pressToContinueText_*.png'],
	},
	{
		file: 'packages/engine-game/src/components/Transition.svelte',
		rule: 'notAsset',
		names: ['transition'],
	},
	{
		file: 'packages/engine-game/src/components/TransitionAnimation.svelte',
		rule: 'part',
		names: ['transition'],
	},
	{
		file: 'packages/engine-game/src/components/WinAnimation.svelte',
		rule: 'part',
		names: ['bigwin'],
	},
	{ file: 'packages/engine-game/src/components/WinCoins.svelte', rule: 'part', names: ['coins'] },
	{
		file: 'packages/engine-game/src/game/codedOverlays.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{ file: 'packages/engine-game/src/game/gameConfig.ts', rule: 'symbols', names: ['H1'] },
	{ file: 'packages/engine-game/src/game/symbolCell.ts', rule: 'symbols', names: ['explosion'] },
	{
		file: 'packages/engine-layout/src/lib/authoredOverlays.ts',
		rule: 'flags',
		names: ['fsIntroNumber', 'fsOutroNumber'],
	},
	{
		file: 'packages/engine-layout/src/lib/boundComponentCatalog.ts',
		rule: 'editorOnly',
		names: [
			'loader',
			'foregroundAnimation',
			'bigwin',
			'transition',
			'fsIntro',
			'fsIntroNumber',
			'fsOutroNumber',
		],
	},
	{
		file: 'packages/engine-layout/src/lib/builtinComponents.ts',
		rule: 'builtinDef',
		names: [
			'gold',
			'loader',
			'transition',
			'fsIntroNumber',
			'fsOutroNumber',
			'bigwin',
			'coins',
			'fsIntro',
			'freespins_*.png',
			'freespins.png',
			'winsmall_*.png',
			'totalwin.png',
		],
	},
	{
		file: 'packages/engine-layout/src/lib/builtinComponents.ts',
		rule: 'notAsset',
		names: ['sound'],
	},
	{
		file: 'packages/engine-layout/src/lib/builtinRegions.ts',
		rule: 'builtinDef',
		names: [
			'progressBar.png',
			'progressBarBackground.png',
			'progressBarFrame.png',
			'Frame_FSCounter.png',
		],
	},
	{
		file: 'packages/engine-layout/src/lib/builtinRegions.ts',
		rule: 'editorOnly',
		names: [
			'frame_bg.png',
			'frame_edge.png',
			'frame_fade.png',
			'Frame_Multiplier.png',
			'Frame_Tumble.png',
			'Frame_TumbleWin.png',
			'pressanywhere_fade.png',
			'explodedW.png',
			'h1.webp',
			'h2.webp',
			'h3.webp',
			'h4.webp',
			'h5.webp',
			'l1.webp',
			'l2.webp',
			'l3.webp',
			'l4.webp',
			'm1_2x.png',
			'm1_4x.png',
			'm2_5x.png',
			'm2_7x.png',
			'm3_10x.png',
			's.png',
			'w.png',
		],
	},
	{
		file: 'packages/engine-layout/src/lib/builtinRigMeta.generated.ts',
		rule: 'editorOnly',
		names: [
			'H1',
			'H2',
			'H3',
			'H4',
			'H5',
			'L1',
			'L2',
			'L3',
			'L4',
			'M',
			'S',
			'W',
			'anticipation',
			'bigwin',
			'clusterWin',
			'explosion',
			'foregroundAnimation',
			'foregroundFeatureAnimation',
			'fsIntro',
			'fsIntroNumber',
			'fsOutroNumber',
			'globalMultiplier',
			'loader',
			'reelhouse',
			'transition',
			'tumble_multiplier',
			'tumble_win',
		],
	},
	{
		file: 'packages/engine-layout/src/lib/builtinTimelines.ts',
		rule: 'notAsset',
		names: ['transition'],
	},
	{ file: 'packages/engine-layout/src/lib/coinLabel.ts', rule: 'always', names: ['gold'] },
	// A timeline cue's route kind (`routeComponentCue`), not the stock sound-toggle art.
	{ file: 'packages/engine-layout/src/lib/ComponentInstance.svelte', rule: 'notAsset', names: ['sound'] }, // prettier-ignore
	{ file: 'packages/engine-layout/src/lib/componentEvents.ts', rule: 'notAsset', names: ['sound'] },
	{
		file: 'packages/engine-layout/src/lib/freeSpinScenes.ts',
		rule: 'fallbackScene',
		names: ['fsIntroNumber', 'fsOutroNumber'],
	},
	{
		file: 'packages/engine-layout/src/lib/referenceLayouts/bookof.ts',
		rule: 'fallbackScene',
		names: ['frame_bg.png', 'frame_edge.png'],
	},
	{
		file: 'packages/engine-layout/src/lib/referenceLayouts/lines.ts',
		rule: 'fallbackScene',
		names: ['transition', 'bigwin', 'frame_bg.png', 'frame_edge.png'],
	},
	{ file: 'packages/engine-layout/src/lib/symbolStates.ts', rule: 'symbols', names: ['explosion'] },
	{ file: 'packages/engine-layout/src/lib/winText.ts', rule: 'symbols', names: ['S'] },
	{ file: 'packages/engine-shadergraph/src/nodes.ts', rule: 'notAsset', names: ['W'] },
	{ file: 'packages/engine-shadergraph/src/reference.ts', rule: 'notAsset', names: ['gold'] },
	{
		file: 'packages/game-config/src/bookOfPresets.ts',
		rule: 'symbols',
		names: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'S'],
	},
	{ file: 'packages/game-config/src/holdAndWin.ts', rule: 'notAsset', names: ['coins'] },
	{
		file: 'packages/game-config/src/holdAndWinPresets.ts',
		rule: 'symbols',
		names: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'W'],
	},
	{ file: 'packages/game-config/src/potsOverlay.ts', rule: 'notAsset', names: ['gold', 'purple'] },
	{ file: 'packages/game-config/src/potsOverlayPresets.ts', rule: 'notAsset', names: ['gold'] },
	{
		file: 'packages/rgs-translator-eagaming/src/gameMappings.ts',
		rule: 'symbols',
		names: ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'M', 'S', 'W'],
	},
];
