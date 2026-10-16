/**
 * Offline fixture for the stock-asset filter (`stockAssets.ts`): which keys of the shared runtime's
 * stock table (`assets.ts`) a project can never draw, so the loader never fetches them.
 *
 *   pnpm check:all --only stockAssets
 *
 * Pins, against the real reference layout, built-in defs, symbol map and asset files:
 *  1. NO DOC KEEPS ALL. A boot with no layout doc yet (dev, live-doc) keeps every key.
 *  2. A FULLY AUTHORED PROJECT keeps only the always-kept four.
 *  3. EACH FALLBACK COMES BACK: un-authoring one thing brings back exactly the stock key it falls
 *     back to — the highlight, a bone effect, the coin fountain, one symbol state, the win rig, the
 *     reference overlays' Transition, a text in a stock font.
 *  4. EFFECTIVE PARAMS: a def default no node consumes is not a reference; a consumed one is.
 *  5. DOUBT KEEPS ALL: a registered part with no rule, an unreadable def or doc. An unregistered
 *     bind draws nothing, so it is not doubt.
 *  6. THE REFERENCE GAME keeps everything its layout and template config use, and drops the keys
 *     nothing consumes.
 *  7. THE HOOK removes a stock entry only while it is still the stock one.
 *  8. THE SHARED SCENE SELECTION degrades the reference `Win` exactly when the doc places a `win`.
 *
 * The tables against the sources, the asset files and `Game.svelte`'s bound parts are held by
 * `scripts/check-stock-asset-coverage.mjs`.
 */

import {
	BUILTIN_COMPONENTS,
	type ComponentDef,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import { createGameConfig } from 'engine-game/src/game/gameConfig';
import { normalizeGameConfigDoc, symbolsInPlay, type GameConfigDoc } from 'game-config';

import stockAssets from './assets.ts';
import compiledConfig from './config.ts';
import { SYMBOL_INFO_MAP } from './constants.ts';
import { fallbackEditorScenes } from './fallbackLayout.ts';
import { basegameOverlaysSceneOf } from './sceneSelection.ts';
import {
	analyseStockAssets,
	withoutStockAssets,
	type StockAssetData,
	type StockAssetsInput,
	type StockSymbolsDoc,
} from './stockAssets.ts';
import { ALWAYS_KEPT, PART_NEEDS, STOCK_KEYS } from './stockAssetRules.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const sorted = (keys: Iterable<string>): string[] => [...keys].sort();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The game registers a bound part for every rule (`check-stock-asset-coverage.mjs` holds it). */
const isRegisteredPart = (name: string): boolean => name in PART_NEEDS;

// ---------------------------------------------------------------------------------------------
// A fully authored project: its own art for every fallback the game has.

const strip = ['H1', 'L1', 'S', 'L1', 'H1'].map((name) => ({ name }));
const config = normalizeGameConfigDoc({
	providerName: 'invisible_wall',
	gameName: 'stock_fixture',
	gameID: 'stock_fixture',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { '1': [1, 1, 1, 1, 1] },
	symbols: {
		H1: { paytable: [{ '3': 5 }] },
		L1: { paytable: [{ '3': 1 }] },
		S: { special_properties: ['scatter'] },
		W: { special_properties: ['wild'] },
	},
	paddingReels: { basegame: Array.from({ length: 5 }, () => strip) },
})!;

/** Every coded state of every dealt symbol bound to the project's own rig. */
const authoredMap = Object.fromEntries(
	['H1', 'L1', 'S'].map((name) => [
		name,
		Object.fromEntries(
			Object.keys(SYMBOL_INFO_MAP[name as keyof typeof SYMBOL_INFO_MAP]).map((state) => [
				state,
				{ type: 'spine', assetKey: `R_${name}`, animationName: state },
			]),
		),
	]),
);

const node = (fields: Record<string, unknown>): LayoutNode =>
	({ x: 0, y: 0, ...fields }) as unknown as LayoutNode;
const scene = (id: string, nodes: LayoutNode[], extra: Partial<Scene> = {}): Scene =>
	({ id, name: id, nodes, ...extra }) as Scene;

const authoredDoc = (): LayoutDoc =>
	({
		version: 1,
		scenes: [
			scene(
				'loading',
				[
					node({
						id: 'bar',
						kind: 'componentInstance',
						componentId: 'loadingBar',
						params: { imageProgress: 'proj/ui.json::T_Fill' },
					}),
				],
				{ role: 'loading', space: 'canvas' },
			),
			scene('background', [node({ id: 'bg', kind: 'sprite', assetKey: 'proj/bg.json' })], {
				space: 'background',
			}),
			scene('basegame', [node({ id: 'reels', kind: 'reelGrid' })], { role: 'basegame' }),
			scene('boardGlow', [node({ id: 'glow', kind: 'spine', assetKey: 'R_Glow' })]),
			scene(
				'basegameOverlays',
				[node({ id: 'gate', kind: 'container', bind: { component: 'WinGate' }, children: [] })],
				{ space: 'canvas' },
			),
			scene('winVisual', [
				node({
					id: 'win',
					kind: 'componentInstance',
					componentId: 'win',
					params: { winSpine: 'R_Win', showCoins: false },
				}),
			]),
			scene('freeSpinCounter', []),
			scene('specialBook', []),
			// Drawn by nothing: an unregistered bind renders nothing (the Borut remake carries one).
			scene('freeSpinIntro', [
				node({
					id: 'anchor',
					kind: 'container',
					bind: { component: 'FreeSpinIntro' },
					children: [],
				}),
			]),
		],
	}) as unknown as LayoutDoc;

const authoredData = (): StockAssetData => ({
	doc: authoredDoc(),
	symbols: {
		map: clone(authoredMap) as unknown as StockSymbolsDoc['map'],
		highlight: { assetKey: 'R_Frame' },
		boardGlow: { assetKey: 'R_Glow' },
		anticipation: { spineKey: 'R_Tease' },
	},
	effects: [{ id: 'fx_free', layers: [{ placement: { space: 'free' } }] }],
	rigFx: {},
	other: [],
});

const builtin = (id: string): ComponentDef | undefined =>
	BUILTIN_COMPONENTS.find((def) => def.id === id);

const input = (
	data: StockAssetData | undefined,
	overrides: Partial<StockAssetsInput> = {},
): StockAssetsInput => ({
	data,
	fallbackDoc: fallbackEditorScenes,
	resolveDef: (id) => builtin(id),
	componentDefaults: () => undefined,
	isBoundPart: isRegisteredPart,
	config,
	symbolsInPlay: symbolsInPlay(config),
	...overrides,
});

const kept = (inp: StockAssetsInput): string[] => sorted(analyseStockAssets(inp).needed);
const added = (inp: StockAssetsInput): string[] =>
	kept(inp).filter((key) => !(ALWAYS_KEPT as readonly string[]).includes(key));

console.log('\n1. no layout doc keeps every key');
const none = analyseStockAssets(input(undefined));
check('all 40 kept', sorted(none.needed), sorted(STOCK_KEYS));
check('and says why', none.keptAllBecause, 'no layout doc at boot');

console.log('\n2. a fully authored project');
const base = analyseStockAssets(input(authoredData()));
check('keeps only the always-kept keys', sorted(base.needed), sorted(ALWAYS_KEPT));
check('without keeping all', base.keptAllBecause, undefined);

console.log('\n3. each un-authored fallback brings back its stock key');
const mutate = (change: (data: StockAssetData) => void): StockAssetData => {
	const data = authoredData();
	change(data);
	return data;
};
check(
	'no highlight ⇒ the coded win frame rig',
	added(input(mutate((d) => delete d.symbols!.highlight))),
	['anticipation'],
);
check(
	'no anticipation rig ⇒ the coded tease rig',
	added(input(mutate((d) => delete d.symbols!.anticipation))),
	['anticipation'],
);
check(
	'a bone-placed effect ⇒ the foreground rig that hosts it',
	added(
		input(
			mutate((d) => {
				d.effects = [{ id: 'fx_bone', layers: [{ placement: { space: 'bone', bone: 'root' } }] }];
			}),
		),
	),
	['foregroundAnimation'],
);
check(
	'…but not once the effect is bound to a rig',
	added(
		input(
			mutate((d) => {
				d.effects = [{ id: 'fx_bone', layers: [{ placement: { space: 'bone', bone: 'root' } }] }];
				d.rigFx = { R_Hero: [{ effectId: 'fx_bone' }] };
			}),
		),
	),
	[],
);
const mapOf = (data: StockAssetData): Record<string, Record<string, unknown>> =>
	data.symbols!.map as unknown as Record<string, Record<string, unknown>>;
const winInstance = (data: StockAssetData): Record<string, unknown> =>
	(
		data.doc.scenes.find((s) => s.id === 'winVisual')!.nodes[0] as unknown as {
			params: Record<string, unknown>;
		}
	).params;
check(
	'showCoins on ⇒ the coin sheet',
	added(input(mutate((d) => (winInstance(d).showCoins = true)))),
	['coins'],
);
check(
	'a win instance without winSpine ⇒ the stock big-win rig',
	added(input(mutate((d) => delete winInstance(d).winSpine))),
	['bigwin'],
);
check(
	'one symbol state un-authored ⇒ that symbol rig',
	added(input(mutate((d) => delete mapOf(d).H1.win))),
	['H1'],
);
check(
	'the scatter spin un-authored ⇒ the scatter rig',
	added(input(mutate((d) => delete mapOf(d).S.spin))),
	['S'],
);
check(
	'the static state un-authored ⇒ the static sheet the coded cell names',
	added(input(mutate((d) => delete mapOf(d).L1.static))),
	['symbolsStatic'],
);
check(
	'no basegameOverlays scene ⇒ the reference overlays, and their Transition rig',
	added(
		input(
			mutate((d) => {
				d.doc.scenes = d.doc.scenes.filter((s) => s.id !== 'basegameOverlays');
			}),
		),
	),
	['transition'],
);
check(
	'an authored text in the stock silver font ⇒ that font',
	added(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({ id: 't', kind: 'text', text: '0', style: { fontFamily: 'silver' } }),
				),
			),
		),
	),
	['silverFont'],
);
check(
	'a stock rig named by an R2-style prefix is a reference too',
	added(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({ id: 'r', kind: 'spine', assetKey: 'invisible_wall/x/spines/tumble_win/' }),
				),
			),
		),
	),
	['tumble_win'],
);
check(
	'a dealt symbol with no binding ⇒ every coded cell it resolves to',
	added(input(mutate((d) => delete mapOf(d).L1))),
	['L1', 'explosion', 'symbolsStatic'],
);
check(
	'a dictionary symbol nothing deals stays off the board',
	analyseStockAssets(input(authoredData())).needed.has('W'),
	false,
);
check(
	'…until the server declares it',
	added(input(authoredData(), { symbolsInPlay: [...symbolsInPlay(config), 'W'] })),
	['W', 'explosion', 'symbolsStatic'],
);
check(
	'the authored-win flag ⇒ the built-in presentation it swaps in',
	added(
		input(
			mutate((d) => {
				d.doc.settings = { authoredOverlays: { win: true } };
			}),
		),
	),
	['bigwin', 'coins'],
);
check(
	'free spins and win-small sheets stay together',
	added(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(node({ id: 'c', kind: 'sprite', assetKey: 'freespins.png' })),
			),
		),
	),
	['freeSpins', 'winSmall'],
);

console.log('\n4. effective params');
const counterDef = (bound: boolean): ComponentDef =>
	({
		id: 'counter',
		name: 'Counter',
		version: 1,
		root: {
			id: 'root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: 'frame',
					kind: 'sprite',
					x: 0,
					y: 0,
					assetKey: '',
					...(bound ? { paramBindings: { region: 'frameImage' } } : {}),
				},
			],
		},
		params: [{ key: 'frameImage', kind: 'image', default: 'Frame_FSCounter.png' }],
	}) as unknown as ComponentDef;
const withCounter = (bound: boolean, params?: Record<string, unknown>) =>
	input(
		mutate((d) =>
			d.doc.scenes[2].nodes.push(
				node({ id: 'n', kind: 'componentInstance', componentId: 'counter', params }),
			),
		),
		{ resolveDef: (id) => (id === 'counter' ? counterDef(bound) : builtin(id)) },
	);
check('a default no node binds is not a reference', added(withCounter(false)), []);
check('a default a node binds is', added(withCounter(true)), ['reelsFrame']);
check(
	'an instance value always counts',
	added(withCounter(false, { frameImage: 'Frame_FSCounter.png' })),
	['reelsFrame'],
);
check(
	'a project default replaces the def default',
	added({
		...withCounter(true),
		componentDefaults: (id) =>
			id === 'counter' ? { frameImage: 'proj/ui.json::T_Frame' } : undefined,
	}),
	[],
);
/** The counter nested in a panel that forwards its own `frame` param into the counter's `frameImage`. */
const panelDef = {
	id: 'panel',
	name: 'Panel',
	version: 1,
	root: {
		id: 'panel-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'inner',
				kind: 'componentInstance',
				componentId: 'counter',
				x: 0,
				y: 0,
				paramBindings: { 'params.frameImage': 'frame' },
			},
		],
	},
	params: [{ key: 'frame', kind: 'image' }],
} as unknown as ComponentDef;
const withPanel = (params?: Record<string, unknown>) =>
	input(
		mutate((d) =>
			d.doc.scenes[2].nodes.push(
				node({ id: 'p', kind: 'componentInstance', componentId: 'panel', params }),
			),
		),
		{
			resolveDef: (id) =>
				id === 'panel' ? panelDef : id === 'counter' ? counterDef(false) : builtin(id),
		},
	);
check(
	'a param forwarded from an enclosing param that holds nothing may be live: every default counts',
	added(withPanel()),
	['reelsFrame'],
);
check(
	'…and one the enclosing instance fills is resolved',
	added(withPanel({ frame: 'proj/ui.json::T_Frame' })),
	[],
);

console.log('\n5. doubt keeps every key');
const unknownPart = analyseStockAssets(
	input(
		mutate((d) =>
			d.doc.scenes[2].nodes.push(
				node({ id: 'p', kind: 'container', bind: { component: 'NewPart' }, children: [] }),
			),
		),
		{ isBoundPart: (name) => name === 'NewPart' || isRegisteredPart(name) },
	),
);
check(
	'a registered part with no rule',
	unknownPart.keptAllBecause,
	"bound part 'NewPart' has no stock rule",
);
check('…keeps all 40', unknownPart.needed.size, STOCK_KEYS.length);
check(
	'an unreadable def',
	analyseStockAssets(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({ id: 'q', kind: 'componentInstance', componentId: 'bad' }),
				),
			),
			{
				resolveDef: (id) =>
					id === 'bad' ? ({ id: 'bad', version: 1 } as unknown as ComponentDef) : builtin(id),
			},
		),
	).keptAllBecause,
	"component 'bad' is not a readable def",
);
check(
	'a scene with no node list',
	analyseStockAssets(
		input(
			mutate((d) => {
				(d.doc.scenes[0] as unknown as { nodes: unknown }).nodes = undefined;
			}),
		),
	).keptAllBecause,
	'a scene of the layout doc has no node list',
);
check(
	'an unregistered def id draws nothing, so it is not doubt',
	added(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({ id: 'u', kind: 'componentInstance', componentId: 'gone' }),
				),
			),
		),
	),
	[],
);

console.log('\n6. the reference game');
const template = createGameConfig({ bakedConfig: () => undefined, compiledConfig });
const reference = analyseStockAssets(
	input(
		{ doc: fallbackEditorScenes, symbols: {}, effects: [], rigFx: {}, other: [] },
		{
			config: template.getActiveGameConfig() as GameConfigDoc,
			symbolsInPlay: template.getSymbolsInPlay(),
		},
	),
);
check(
	'drops only what nothing it shows consumes',
	sorted(STOCK_KEYS.filter((key) => !reference.needed.has(key))),
	sorted([
		'loader',
		'payFrame',
		'goldBlur',
		'silverFont',
		'purpleFont',
		'globalMultiplier',
		'tumble_multiplier',
		'tumble_win',
		'clusterWin',
		// Not on the template's strips (`W` sits only in its dictionary).
		'H5',
		'W',
	]),
);

console.log('\n7. the hook removes stock entries only');
const projectTransition = {
	type: 'spine',
	src: { atlas: 'proj/transition.atlas', skeleton: 'proj/transition.json', scale: 1 },
};
const registered: Record<string, unknown> = {
	...stockAssets,
	transition: projectTransition,
	'editorArt/x.json': { type: 'sprites', src: 'proj/x.json' },
};
const hooked = withoutStockAssets(registered, stockAssets, new Set(ALWAYS_KEPT));
check(
	'a project asset under a stock key survives',
	hooked.assets.transition === projectTransition,
	true,
);
check('…and is not reported as skipped', hooked.skipped.includes('transition'), false);
check('a project-only key is untouched', 'editorArt/x.json' in hooked.assets, true);
check(
	'every other unneeded stock key is gone',
	sorted(Object.keys(hooked.assets)),
	sorted([...ALWAYS_KEPT, 'transition', 'editorArt/x.json']),
);
check(
	'nothing to skip ⇒ the same table back',
	withoutStockAssets(registered, stockAssets, new Set(STOCK_KEYS)).assets === registered,
	true,
);

console.log('\n8. the shared scene selection');
const fallbackOverlays = fallbackEditorScenes.scenes.find((s) => s.id === 'basegameOverlays')!;
check(
	'a doc with no overlays scene and no win instance mounts the reference overlays as is',
	basegameOverlaysSceneOf({ scenes: [] }, fallbackEditorScenes, false) === fallbackOverlays,
	true,
);
check(
	'a doc that places a `win` degrades the reference composer to its gate',
	basegameOverlaysSceneOf(authoredDoc(), fallbackEditorScenes, false)
		.nodes.map((n) => n.bind?.component)
		.sort(),
	['WinGate'],
);
check(
	'…and without an overlays scene of its own, keeps the reference Transition beside it',
	basegameOverlaysSceneOf(
		{ scenes: authoredDoc().scenes.filter((s) => s.id !== 'basegameOverlays') },
		fallbackEditorScenes,
		false,
	)
		.nodes.map((n) => n.bind?.component)
		.sort(),
	['Transition', 'WinGate'],
);

if (failures) throw new Error(`${failures} stock-asset assertion(s) FAILED`);
console.log('\nAll stock-asset assertions passed.\n');
