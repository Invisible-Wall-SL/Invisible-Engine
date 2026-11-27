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
 *     reference overlays' Transition, a text in a stock font, a stock frame drawn by a component a
 *     spawn layer lists (placed nowhere: Flow spawns it).
 *  4. EFFECTIVE PARAMS: a def default no node consumes is not a reference; a consumed one is.
 *  5. DOUBT KEEPS ALL: a registered part with no rule, an unreadable def or doc. An unregistered
 *     bind draws nothing, so it is not doubt.
 *  6. THE REFERENCE GAME keeps everything its layout and template config use, and drops the keys
 *     nothing consumes.
 *  7. THE HOOK removes a stock entry only while it is still the stock one.
 *  8. THE SHARED SCENE SELECTION degrades the reference `Win` exactly when the doc places a `win`.
 * 12. A BOARDLESS GAME (a play field, a card table) keeps what its own scenes and data name and the
 *     coded background: Salmons, the arcade sample and the card sample load no slot art; a flow's
 *     transition cue, a free-spin switch, a text in `gold`, a placed `Win`, a named symbol rig each
 *     bring back exactly their keys; doubt still keeps all; a board's walk is unchanged. A play
 *     field that draws its own backdrop (Salmons) keeps no coded background, but a bone-placed
 *     effect still keeps the rig that hosts it.
 *
 * The tables against the sources, the asset files and `Game.svelte`'s bound parts are held by
 * `scripts/check-stock-asset-coverage.mjs`.
 */

import {
	BUILTIN_COMPONENTS,
	arcadeReferenceLayout,
	cardReferenceLayout,
	getFullSceneSet,
	type ComponentDef,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import { createGameConfig } from 'engine-game/src/game/gameConfig';
import { normalizeGameConfigDoc, symbolsInPlay, type GameConfigDoc } from 'game-config';
import { ARCADE_DRIVEN_SEED_DOC, CARD_DRIVEN_SEED_DOC } from 'engine-flow-v2';
import { SALMONS_SEED_DOC } from '../../../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { salmonsReferenceLayout } from '../../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_LEVELS, SALMONS_LOBBY, salmonsConfig } from 'engine-mechanics/src/salmons.js';
import { SALMONS_MAP_SEED, levelShape, salmonsMapRiver } from 'engine-mechanics/src/salmonsMap.js';

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
import { stockAssetDataOf } from './stockAssetData.ts';
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
	'the win frame turned off ⇒ no rig, swapped or coded',
	added(
		input(
			mutate((d) => {
				delete d.symbols!.highlight;
				d.symbols!.off = { highlight: true };
			}),
		),
	),
	[],
);
const armsTease = [{ graph: { nodes: [{ kind: 'action', ref: 'enableAnticipationMode' }] } }];
check(
	'no anticipation rig ⇒ the coded tease rig, once a flow arms the tease',
	added(
		input(
			mutate((d) => {
				delete d.symbols!.anticipation;
				d.other = armsTease;
			}),
		),
	),
	['anticipation'],
);
check(
	'…and none while nothing arms it',
	added(input(mutate((d) => delete d.symbols!.anticipation))),
	[],
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
	'…but not a frame a project symbol sheet registers under the same name',
	added(
		input(
			mutate((d) => {
				delete mapOf(d).L1.static;
				d.symbols!.index = { sheets: [{ names: ['l1.webp', 'myFrame.png'] }] };
			}),
		),
	),
	[],
);
check(
	'…while a frame no project sheet registers still keeps it',
	added(
		input(
			mutate((d) => {
				delete mapOf(d).L1.static;
				d.symbols!.index = { sheets: [{ names: ['h1.webp'] }] };
			}),
		),
	),
	['symbolsStatic'],
);
check(
	'…and a font of a project frame’s name still keeps that font',
	added(
		input(
			mutate((d) => {
				d.symbols!.winLine = { text: { font: 'purple' } };
				d.symbols!.index = { sheets: [{ names: ['purple'] }] };
			}),
		),
	),
	['purpleFont'],
);
check(
	'…as does a rig of a project frame’s name',
	added(
		input(
			mutate((d) => {
				delete winInstance(d).winSpine;
				d.symbols!.index = { sheets: [{ names: ['bigwin'] }] };
			}),
		),
	),
	['bigwin'],
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
// test2 and test1 on the live harness: the win amount drawn on a line win is styled under
// `symbols.winLine.text`, and skipping every `text` field skipped the font inside it.
check(
	'the win amount’s font, under symbols.winLine.text ⇒ that font',
	added(input(mutate((d) => (d.symbols!.winLine = { text: { font: 'purple', size: 0.3 } })))),
	['purpleFont'],
);
check(
	'a label styled in a stock font ⇒ that font, though the label text is not a name',
	added(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({
						id: 'l',
						kind: 'text',
						label: { text: 'payFrame', style: { fontFamily: 'goldblur' } },
					}),
				),
			),
		),
	),
	['goldBlur'],
);
check(
	'a text that reads like a stock key is still only text',
	added(
		input(
			mutate((d) => d.doc.scenes[2].nodes.push(node({ id: 'x', kind: 'text', text: 'payFrame' }))),
		),
	),
	[],
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
	'a retired overlay-swap flag left in a stored doc needs nothing',
	added(
		input(
			mutate((d) => {
				d.doc.settings = { authoredOverlays: { win: true } } as unknown as LayoutDoc['settings'];
			}),
		),
	),
	[],
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

{
	// A component placed nowhere but listed by a spawn layer is drawn when Flow spawns it.
	const coin = {
		id: 'spawnCoin',
		name: 'Coin',
		version: 1,
		params: [],
		root: {
			id: 'r',
			kind: 'container',
			x: 0,
			y: 0,
			children: [{ id: 's', kind: 'sprite', x: 0, y: 0, assetKey: 'payFrame' }],
		},
	} as unknown as ComponentDef;
	const withLayer = mutate((d) =>
		d.doc.scenes[0].nodes.push({
			id: 'field',
			kind: 'spawnLayer',
			x: 0,
			y: 0,
			spawnable: ['spawnCoin'],
			placement: 'free',
		} as LayoutNode),
	);
	check(
		'a stock frame a spawnable draws',
		added(input(withLayer, { resolveDef: (id) => (id === coin.id ? coin : builtin(id)) })),
		['payFrame'],
	);
}

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
	basegameOverlaysSceneOf({ scenes: [] }, fallbackEditorScenes) === fallbackOverlays,
	true,
);
check(
	'a doc that places a `win` degrades the reference composer to its gate',
	basegameOverlaysSceneOf(authoredDoc(), fallbackEditorScenes)
		.nodes.map((n) => n.bind?.component)
		.sort(),
	['WinGate'],
);
check(
	'…and without an overlays scene of its own, keeps the reference Transition beside it',
	basegameOverlaysSceneOf(
		{ scenes: authoredDoc().scenes.filter((s) => s.id !== 'basegameOverlays') },
		fallbackEditorScenes,
	)
		.nodes.map((n) => n.bind?.component)
		.sort(),
	['Transition', 'WinGate'],
);

// overlay-buffaloduel (2026-11-03): a Hold and Win game with free spins off kept the stock free-spin
// sheets and the board glow for parts it mounts but never shows, and two stock symbol rigs for map
// entries of symbols it never deals.
console.log('\n9. a game that cannot enter free spins');
const noFreeSpins = { ...config, freeSpins: { enabled: false } } as GameConfigDoc;
const withFreeSpinParts = (): StockAssetData =>
	mutate((d) => {
		delete d.symbols!.boardGlow;
		d.doc.scenes = d.doc.scenes.map((s) =>
			s.id === 'boardGlow'
				? scene('boardGlow', [
						node({ id: 'glow', kind: 'container', bind: { component: 'BoardFrame' } }),
					])
				: s,
		);
		d.doc.scenes.push(
			scene('fsIntro', [
				node({
					id: 'intro',
					kind: 'container',
					bind: { component: 'FreeSpinIntroVisual', props: { introSpine: 'fsIntroNumber' } },
				}),
				node({ id: 'outro', kind: 'container', bind: { component: 'FreeSpinOutroVisual' } }),
				node({ id: 'counter', kind: 'container', bind: { component: 'FreeSpinCounter' } }),
			]),
		);
	});
const freeSpinArt = [
	'freeSpins',
	'fsIntro',
	'fsIntroNumber',
	'fsOutroNumber',
	'reelhouse',
	'reelsFrame',
	'winSmall',
];
check(
	'with free spins on, the parts keep their art',
	added(input(withFreeSpinParts())),
	freeSpinArt,
);
check('with them off, nothing', added(input(withFreeSpinParts(), { config: noFreeSpins })), []);
check(
	'with them on and the board glow turned off, the glow keeps nothing',
	added(
		input(
			((data) => ({ ...data, symbols: { ...data.symbols, off: { boardGlow: true } } }))(
				withFreeSpinParts(),
			),
		),
	),
	freeSpinArt.filter((key) => key !== 'reelhouse'),
);
check(
	'…unless a flow fires a free-spin cue',
	added(
		input(
			{
				...withFreeSpinParts(),
				other: [{ graph: { nodes: [{ kind: 'fireCue', ref: 'freeSpinIntroShow' }] } }],
			},
			{ config: noFreeSpins },
		),
	),
	freeSpinArt,
);
check(
	'…or a cinematic fires one as a scoped cue',
	added(
		input(
			{
				...withFreeSpinParts(),
				other: [[{ id: 'intro', keys: [{ time: 0, cue: 'signal:boardFrameGlowShow' }] }]],
			},
			{ config: noFreeSpins },
		),
	),
	freeSpinArt,
);
check(
	'…or a full pot starts them',
	added(
		input(withFreeSpinParts(), {
			config: {
				...noFreeSpins,
				coinOverlay: {
					style: 'pots',
					pots: [{ id: 'red', token: 'POT_RED', maxLevel: 20, bonus: { mode: 'freeSpins' } }],
				},
			} as unknown as GameConfigDoc,
		}),
	),
	freeSpinArt,
);
check(
	'…or the project plays a reels mode of its own',
	added(
		input(withFreeSpinParts(), {
			config: { ...noFreeSpins, modes: [{ id: 'imported', board: 'reels' }] } as GameConfigDoc,
		}),
	),
	freeSpinArt,
);
check(
	'an instance a free-spin feed hides still keeps its frame (it stays mounted)',
	added(
		input(
			mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({
						id: 'fs',
						kind: 'componentInstance',
						componentId: 'freeSpinCounter',
						params: { visibleSource: 'freeSpinCounterShow' },
					}),
				),
			),
			{ config: noFreeSpins },
		),
	),
	['reelsFrame'],
);

console.log('\n10. symbol bindings for symbols the board never shows');
const boostBound = (): StockAssetData =>
	mutate((d) => (mapOf(d).BOOST = { win: { type: 'spine', assetKey: 'M', animationName: 'win' } }));
check('a binding of an undealt symbol keeps nothing', added(input(boostBound())), []);
check(
	'…until the server declares it',
	added(input(boostBound(), { symbolsInPlay: [...symbolsInPlay(config), 'BOOST'] })),
	['M'],
);
check(
	'a binding naming a coded symbol does not deal that symbol',
	added(
		input(
			mutate(
				(d) => (mapOf(d).MYSTERY = { win: { type: 'spine', assetKey: 'W', animationName: 'win' } }),
			),
		),
	),
	[],
);

// overlay-buffaloduel (2026-11-03): the shared `hudReadout` def defaults its frame to test6's 4096²
// UI sheet and a shared button def its rig to `R_SpinButtonNew`; every placement overrides both, yet
// the export ships them and the game loaded 94 MB of textures it never drew.
console.log('\n11. project art only an overridden component default names');
const FOREIGN = 'other/proj/manifests/ui.json';
const OWN = 'proj/manifests/ui.json';
const panelArtDef = {
	id: 'panel',
	name: 'Panel',
	version: 3,
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
				assetKey: FOREIGN,
				region: 'Widget',
				paramBindings: { region: 'frameImage' },
			},
			{ id: 'rig', kind: 'spine', x: 0, y: 0, assetKey: '', paramBindings: { assetKey: 'rig' } },
		],
	},
	params: [
		{ key: 'frameImage', kind: 'image', default: `${FOREIGN}::Widget` },
		{ key: 'rig', kind: 'spine', default: 'R_Unused' },
	],
} as unknown as ComponentDef;
const projectArt = {
	sheets: [
		{ key: FOREIGN, json: 'editor-art/ui/ui.1.json', names: ['Widget'] },
		{ key: OWN, json: 'editor-art/ui_2/ui_2.1.json', names: ['OwnFrame'] },
	],
	spines: [{ key: 'R_Unused' }, { key: 'R_Used' }],
};
const placedPanel = (params: Record<string, unknown>, extra: Partial<StockAssetData> = {}) =>
	input(
		{
			...mutate((d) =>
				d.doc.scenes[2].nodes.push(
					node({ id: 'p', kind: 'componentInstance', componentId: 'panel', params }),
				),
			),
			editorArt: projectArt,
			componentDefs: [panelArtDef],
			...extra,
		},
		{ resolveDef: (id) => (id === 'panel' ? panelArtDef : builtin(id)) },
	);
const unusedArt = (inp: StockAssetsInput): string[] =>
	sorted(analyseStockAssets(inp).editorArtUnused);
const overridden = { frameImage: `${OWN}::OwnFrame`, rig: 'R_Used' };
check(
	'every placement overriding both defaults ⇒ the foreign sheet and the rig are skipped',
	unusedArt(placedPanel(overridden)),
	['R_Unused', 'editorArt/editor-art/ui/ui.1.json'],
);
check(
	'a placement leaving the frame unset draws the default ⇒ its sheet stays',
	unusedArt(placedPanel({ rig: 'R_Used' })),
	['R_Unused', 'editorArt/editor-art/ui_2/ui_2.1.json'],
);
check(
	'a bare frame override keeps the node’s own sheet (it scopes the frame)',
	unusedArt(placedPanel({ frameImage: 'Widget', rig: 'R_Used' })),
	['R_Unused', 'editorArt/editor-art/ui_2/ui_2.1.json'],
);
check(
	'a def nothing places may be mounted by code ⇒ every name it holds stays',
	unusedArt({
		...placedPanel(overridden),
		data: {
			...placedPanel(overridden).data!,
			doc: authoredDoc(),
		},
	}),
	['R_Used', 'editorArt/editor-art/ui_2/ui_2.1.json'],
);
check(
	'a project default naming the art keeps it',
	unusedArt(placedPanel(overridden, { artReferences: [{ panel: { rig: 'R_Unused' } }] })),
	['editorArt/editor-art/ui/ui.1.json'],
);
check(
	'a sheet exported before frame names were recorded is always kept',
	unusedArt(
		placedPanel(overridden, {
			editorArt: { ...projectArt, sheets: projectArt.sheets.map(({ names: _, ...s }) => s) },
		}),
	),
	['R_Unused'],
);
check(
	'a doubt that keeps every stock key keeps every exported asset too',
	analyseStockAssets(
		input({ ...authoredData(), editorArt: projectArt }, { isBoundPart: () => true }),
	).editorArtUnused,
	[],
);
check(
	'a bundle’s `characterArt` (a character sheet’s rig and still image) keeps the rig and the sheet',
	unusedArt(
		placedPanel(overridden, {
			other: stockAssetDataOf({
				doc: authoredDoc(),
				characterArt: ['R_Unused', `${FOREIGN}::Widget`],
			} as Parameters<typeof stockAssetDataOf>[0]).other,
		}),
	),
	[],
);

console.log('\n12. a boardless game');
{
	const river = salmonsMapRiver(SALMONS_MAP_SEED, undefined, levelShape(SALMONS_LEVELS));
	const salmonsGame = normalizeGameConfigDoc(
		salmonsConfig(river, { lobby: SALMONS_LOBBY, levels: SALMONS_LEVELS }),
	) as GameConfigDoc;
	const salmonsDoc = salmonsReferenceLayout(river);
	const arcadeGame = normalizeGameConfigDoc({ family: 'arcade' }) as GameConfigDoc;
	const cardGame = normalizeGameConfigDoc({ family: 'card' }) as GameConfigDoc;
	const field = (
		doc: LayoutDoc,
		game: GameConfigDoc,
		flow: unknown,
		over: Partial<StockAssetData> = {},
		inp: Partial<StockAssetsInput> = {},
	): StockAssetsInput =>
		input(
			{ ...stockAssetDataOf({ doc, config: game, flowV2: flow } as never), ...over },
			{ config: game, symbolsInPlay: symbolsInPlay(game), boardless: true, ...inp },
		);
	const BACKGROUND = ['foregroundAnimation', 'pressToContinueText', 'progressBar', 'sound'];
	const salmons = field(salmonsDoc, salmonsGame, SALMONS_SEED_DOC);
	check('Salmons keeps its coded background, the press, the loading bar and the audio', kept(salmons), BACKGROUND); // prettier-ignore
	check('…and keeps all on no question', analyseStockAssets(salmons).keptAllBecause, undefined);
	const OWN = BACKGROUND.filter((key) => key !== 'foregroundAnimation');
	check('Salmons drawing its own backdrop keeps no coded background', kept({ ...salmons, ownBackdrop: true }), OWN); // prettier-ignore
	check(
		'…but a bone-placed effect still keeps the rig that hosts it',
		kept({
			...field(salmonsDoc, salmonsGame, SALMONS_SEED_DOC, { effects: [{ id: 'fx', layers: [{ placement: { space: 'bone', bone: 'b' } }] }] }), // prettier-ignore
			ownBackdrop: true,
		}),
		BACKGROUND,
	);
	check(
		'…and a free-spin switch brings back no feature background',
		kept({
			...field(salmonsDoc, salmonsGame, {
				...SALMONS_SEED_DOC,
				graph: { ...SALMONS_SEED_DOC.graph, nodes: [...SALMONS_SEED_DOC.graph.nodes, { id: 'c', kind: 'fireCue', ref: 'freeSpinCounterShow' }] }, // prettier-ignore
			}),
			ownBackdrop: true,
		}).filter((key) => key.startsWith('foreground')),
		[],
	);
	check(
		'on a board the same data keeps the slot art it kept before',
		kept({ ...salmons, boardless: undefined }),
		sorted([...BACKGROUND, 'H1', 'explosion', 'symbolsStatic', 'reelsFrame', 'anticipation', 'goldFont', 'bigwin', 'coins', 'foregroundFeatureAnimation', 'reelhouse', 'transition']), // prettier-ignore
	);
	check('the arcade sample keeps the same', kept(field(arcadeReferenceLayout(), arcadeGame, ARCADE_DRIVEN_SEED_DOC)), BACKGROUND); // prettier-ignore
	check('the card sample keeps the same', kept(field(cardReferenceLayout(), cardGame, CARD_DRIVEN_SEED_DOC)), BACKGROUND); // prettier-ignore

	const withFlow = (flow: unknown) => field(salmonsDoc, salmonsGame, flow);
	const cue = (ref: string) => ({
		...SALMONS_SEED_DOC,
		graph: {
			...SALMONS_SEED_DOC.graph,
			nodes: [...SALMONS_SEED_DOC.graph.nodes, { id: 'cue_x', kind: 'fireCue', ref }],
		},
	});
	check('a flow firing the transition cue keeps its rig', kept(withFlow(cue('transition'))), sorted([...BACKGROUND, 'transition'])); // prettier-ignore
	check(
		'a flow firing a free-spin switch brings back the slot fallbacks and the feature background',
		kept(withFlow(cue('freeSpinCounterShow'))).filter((key) => !BACKGROUND.includes(key)),
		sorted(['reelsFrame', 'goldFont', 'bigwin', 'coins', 'transition', 'foregroundFeatureAnimation']), // prettier-ignore
	);
	const placed = (nodes: LayoutNode[], scenes: Scene[] = []) =>
		({
			...salmonsDoc,
			scenes: [
				...salmonsDoc.scenes,
				...(nodes.length ? [scene('extra', nodes, { space: 'canvas' })] : []),
				...scenes,
			],
		}) as LayoutDoc;
	check(
		'a text in the stock gold face keeps its font',
		kept(field(placed([node({ id: 't', kind: 'text', text: 'x', font: 'gold' })]), salmonsGame, SALMONS_SEED_DOC)), // prettier-ignore
		sorted([...BACKGROUND, 'goldFont']),
	);
	check(
		'a placed Win keeps the win rig, the coins and gold',
		kept(field(placed([node({ id: 'w', kind: 'container', bind: { component: 'Win' }, children: [] })]), salmonsGame, SALMONS_SEED_DOC)), // prettier-ignore
		sorted([...BACKGROUND, 'bigwin', 'coins', 'goldFont']),
	);
	check(
		'a named stock symbol rig is kept by its name',
		kept(field(placed([node({ id: 's', kind: 'spine', assetKey: 'W' })]), salmonsGame, SALMONS_SEED_DOC)), // prettier-ignore
		sorted([...BACKGROUND, 'W']),
	);
	check(
		'a bone-placed effect keeps the foreground rig that hosts it, the background authored',
		kept(
			field(
				placed([], [scene('ownBackground', [node({ id: 'bg', kind: 'sprite', assetKey: 'proj/bg.json' })], { space: 'background' })]), // prettier-ignore
				salmonsGame,
				SALMONS_SEED_DOC,
				{ effects: [{ id: 'fx', layers: [{ placement: { space: 'bone', bone: 'b' } }] }] },
			),
		),
		BACKGROUND,
	);
	check(
		'an authored background drops the coded one',
		kept(
			field(
				placed(
					[],
					[
						scene('ownBackground', [node({ id: 'bg', kind: 'sprite', assetKey: 'proj/bg.json' })], {
							space: 'background',
						}),
					],
				),
				salmonsGame,
				SALMONS_SEED_DOC,
			),
		),
		BACKGROUND.filter((key) => key !== 'foregroundAnimation'),
	);
	check(
		'a registered part with no rule still keeps every key',
		analyseStockAssets(field(placed([node({ id: 'p', kind: 'container', bind: { component: 'NoRule' }, children: [] })]), salmonsGame, SALMONS_SEED_DOC, {}, { isBoundPart: (name) => name === 'NoRule' })).keptAllBecause, // prettier-ignore
		"bound part 'NoRule' has no stock rule",
	);
	// What each board kind's own scene set leaves out, recorded before boardless games existed: the
	// slot and match-3 kinds load exactly the files they loaded.
	const COMMON = ['loader', 'H5', 'W', 'payFrame', 'goldBlur', 'silverFont', 'purpleFont', 'globalMultiplier']; // prettier-ignore
	const TUMBLE = ['tumble_multiplier', 'tumble_win', 'clusterWin'];
	const NO_FREE_SPINS = ['fsIntro', 'fsIntroNumber', 'fsOutroNumber', 'freeSpins', 'winSmall'];
	const BOARD_SKIPS: Record<string, string[]> = {
		lines: [...COMMON, ...TUMBLE],
		bookOf: [...COMMON, ...TUMBLE],
		ways: [...COMMON, ...TUMBLE],
		cluster: [...COMMON, ...TUMBLE],
		scatter: [...COMMON, ...TUMBLE],
		holdAndWin: [...COMMON, ...TUMBLE, ...NO_FREE_SPINS],
		match3: [...COMMON, ...TUMBLE, ...NO_FREE_SPINS],
	};
	for (const [kind, skips] of Object.entries(BOARD_SKIPS)) {
		const baked = kind === 'match3' ? normalizeGameConfigDoc({ family: 'match3' }) : undefined;
		const game = createGameConfig({ bakedConfig: () => baked as never, compiledConfig });
		const board = input(stockAssetDataOf({ doc: getFullSceneSet(kind) } as never), {
			resolveDef: (id) => builtin(id),
			isBoundPart: (name) => name in PART_NEEDS,
			config: game.getActiveGameConfig(),
			symbolsInPlay: game.getSymbolsInPlay(),
		});
		check(`the ${kind} scene set leaves out what it did`, sorted(STOCK_KEYS.filter((key) => !analyseStockAssets(board).needed.has(key))), sorted(skips)); // prettier-ignore
	}
	check(
		'a board keeps what it kept with the field unset',
		kept(input(authoredData(), { boardless: false })),
		kept(input(authoredData())),
	);
	check(
		'the reference game keeps what it kept with the field unset',
		kept(input({ doc: fallbackEditorScenes, other: [] }, { boardless: false })),
		kept(input({ doc: fallbackEditorScenes, other: [] })),
	);
}

if (failures) throw new Error(`${failures} stock-asset assertion(s) FAILED`);
console.log('\nAll stock-asset assertions passed.\n');
