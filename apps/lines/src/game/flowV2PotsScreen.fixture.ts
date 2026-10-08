/**
 * Offline fixture for the add-on's Pots screen under a driven flow. Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/flowV2PotsScreen.fixture.ts
 *
 * Live, `borut-pots-sample` ran a hand-authored driven flow that never showed `pots`, so the Pot
 * Meter the owner placed never mounted and the coded pot drew at its hard-coded spot instead.
 * `enginePotsScreen` decides when the game mounts the screen itself. SIX claims, on real seeds,
 * scene sets and presets:
 *
 *  1. THE BORUT CASE MOUNTS. The Book-of driven seed (which never shows `pots`), the Book-of scene
 *     set with the 3 Pots add-on screens and the 3 Pots meters ⇒ the layout's own `pots` scene.
 *  2. THE Z IS THE SCREEN'S OWN. `sceneLayerZIndex`, as every flow container is re-stamped: above
 *     the board and the flow's `basegame` container, below the HUD and every overlay the flow shows.
 *     A Screens-list reorder or tick moves it as it moves any screen.
 *  3. DECLARING IS NOT SHOWING. A flow that declares `pots` (the `/flow-v2` editor declares every
 *     screen) still gets it; only a flow that SHOWS it anywhere owns it (nothing mounted).
 *  4. PARITY: no driven flow (a book-events-only doc), no meters (a coins-only overlay), or no `pots`
 *     scene (a plain Book-of layout) ⇒ nothing, so those games render exactly as before.
 *  5. THE HOLD AND WIN SEED, which shows `pots` itself, is left alone.
 *  6. #1032'S REPORT CANNOT FIRE FOR IT. The mount is not a flow container and needs the scene to
 *     exist, so `containersMissingScene` over the flow's containers is unchanged by it.
 */

import {
	containersMissingScene,
	flowScreenDrivingStatus,
	freshDrivenSeedDoc,
	type ContainerRef,
	type FlowDoc,
} from 'engine-flow-v2';
import {
	BOOK_OF_REFERENCE_SET,
	getFullSceneSet,
	LAYER_BAND_BASE,
	LAYER_BAND_BEHIND,
	LAYER_BAND_TAKEOVER,
	POTS_SCREEN,
	sceneLayerZIndex,
	type Scene,
} from 'engine-layout';
import { potsOverlayPreset, resolveMeters } from 'game-config';

import { enginePotsScreen } from './flowV2PotsScreen.ts';

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

const meterIds = (preset: 'threePots' | 'coinsOnly'): string[] =>
	resolveMeters({ potsOverlay: potsOverlayPreset(preset).potsOverlay }).map((m) => m.id);
const POT_IDS = meterIds('threePots');

const scenesOf = (gameType: string, options?: Parameters<typeof getFullSceneSet>[1]): Scene[] => {
	const doc = getFullSceneSet(gameType, options);
	if (!doc) throw new Error(`no scene set for ${gameType}`);
	return doc.scenes;
};
const BORUT_SCENES = scenesOf(BOOK_OF_REFERENCE_SET, {
	potsOverlay: true,
	holdAndWin: true,
	potIds: POT_IDS,
});
const BOOK_SCENES = scenesOf(BOOK_OF_REFERENCE_SET);

const BOOK_SEED = freshDrivenSeedDoc('bookOf');
const drives = (doc: FlowDoc): boolean => flowScreenDrivingStatus(doc).drivesScreens;

/** What the game decides for `doc` on `scenes`, the meters read from `meters`. */
const decide = (doc: FlowDoc, scenes: Scene[], meters: readonly string[] = POT_IDS) =>
	enginePotsScreen(doc, scenes, { drivesScreens: drives(doc), hasMeters: meters.length > 0 });
const mounted = (doc: FlowDoc, scenes: Scene[], meters?: readonly string[]) => {
	const out = decide(doc, scenes, meters);
	return out ? { sceneId: out.scene.id, z: out.z } : undefined;
};

console.log('1. the Borut case mounts');
check('the 3 Pots preset declares three meters', POT_IDS, ['red', 'blue', 'green']);
check('the Book-of seed drives the screens', drives(BOOK_SEED), true);
check(
	'the seed declares no pots container',
	BOOK_SEED.containers.some((c) => c.id === 'pots'),
	false,
);
const borut = decide(BOOK_SEED, BORUT_SCENES);
check(
	'the game mounts the layout’s own pots scene, Pot Meters and all',
	borut?.scene === BORUT_SCENES.find((s) => s.id === POTS_SCREEN),
	true,
);
check(
	'its Pot Meters are the configured meters',
	borut?.scene.nodes.map((n) => (n.kind === 'componentInstance' ? n.params?.meter : n.kind)),
	POT_IDS,
);

console.log('2. the z is the screen’s own');
const potsIndex = BORUT_SCENES.findIndex((s) => s.id === POTS_SCREEN);
check('z = the Screens-list band + its index', borut?.z, LAYER_BAND_BASE + potsIndex);
check(
	'z = sceneLayerZIndex, as the coded generic mount',
	borut?.z,
	sceneLayerZIndex(BORUT_SCENES, POTS_SCREEN),
);
const layered = (c: ContainerRef): number => sceneLayerZIndex(BORUT_SCENES, c.sceneId) ?? c.z;
const z = borut?.z ?? Number.NaN;
check('above the board (z 0)', z > 0, true);
check(
	'above the flow’s basegame container and no other (loading is hidden before the board shows)',
	BOOK_SEED.containers.filter((c) => layered(c) < z && c.id !== 'loading').map((c) => c.id),
	['basegame'],
);
check(
	'below every other screen the flow shows (HUD, counter, book, intro/outro, buy)',
	BOOK_SEED.containers
		.filter((c) => !['basegame', 'loading'].includes(c.id))
		.every((c) => layered(c) > z),
	true,
);
const reordered = [...BORUT_SCENES.filter((s) => s.id !== POTS_SCREEN), BORUT_SCENES[potsIndex]];
check(
	'moved to the end of the Screens list, it follows the list',
	mounted(BOOK_SEED, reordered)?.z,
	LAYER_BAND_BASE + reordered.length - 1,
);
const ticked = (tick: Partial<Scene>): Scene[] =>
	BORUT_SCENES.map((s) => (s.id === POTS_SCREEN ? { ...s, ...tick } : s));
check(
	'"Always on top" pins it, as any screen',
	mounted(BOOK_SEED, ticked({ alwaysOnTop: true }))?.z,
	LAYER_BAND_TAKEOVER + potsIndex,
);
check(
	'"Behind the reels" puts it under the board, as any screen',
	mounted(BOOK_SEED, ticked({ behindReels: true }))?.z,
	LAYER_BAND_BEHIND + potsIndex,
);

console.log('3. declaring is not showing');
const declared: FlowDoc = {
	...BOOK_SEED,
	containers: [...BOOK_SEED.containers, { id: 'pots', sceneId: 'pots', z: 999 }],
};
check('a declared pots container still mounts', mounted(declared, BORUT_SCENES), {
	sceneId: 'pots',
	z: LAYER_BAND_BASE + potsIndex,
});
const showsPots: FlowDoc = {
	...declared,
	graph: {
		...declared.graph,
		nodes: [
			...declared.graph.nodes,
			{ id: 'show_pots', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: 'pots' },
		],
	},
};
check('a flow that shows pots owns it', mounted(showsPots, BORUT_SCENES), undefined);
const hidesPots: FlowDoc = {
	...declared,
	graph: {
		...declared.graph,
		nodes: [
			...declared.graph.nodes,
			{ id: 'hide_pots', kind: 'hideContainer', pos: { x: 0, y: 0 }, ref: 'pots' },
		],
	},
};
check('a hide alone mounts nothing, so it does not own it', mounted(hidesPots, BORUT_SCENES), {
	sceneId: 'pots',
	z: LAYER_BAND_BASE + potsIndex,
});
const renamed: FlowDoc = {
	...BOOK_SEED,
	containers: [...BOOK_SEED.containers, { id: 'thePots', sceneId: 'pots', z: 5 }],
	modes: {
		holdAndWin: {
			graph: {
				nodes: [{ id: 'hw_pots', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: 'thePots' }],
				exec: [],
				data: [],
			},
		},
	},
};
check(
	'a show in a mode section, of a container named otherwise, owns it',
	mounted(renamed, BORUT_SCENES),
	undefined,
);

console.log('4. parity');
const bookEventsOnly: FlowDoc = {
	...BOOK_SEED,
	graph: {
		nodes: [{ id: 'on_reveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' }],
		exec: [],
		data: [],
	},
};
check('a book-events-only flow does not drive the screens', drives(bookEventsOnly), false);
check(
	'no driven flow: nothing (the coded/v1 path mounts the scene)',
	mounted(bookEventsOnly, BORUT_SCENES),
	undefined,
);
check('the coins-only preset declares no meters', meterIds('coinsOnly'), []);
check('no meters: nothing', mounted(BOOK_SEED, BORUT_SCENES, meterIds('coinsOnly')), undefined);
check(
	'the plain Book-of scene set has no pots scene',
	BOOK_SCENES.some((s) => s.id === POTS_SCREEN),
	false,
);
check('no pots scene: nothing (the coded pots draw)', mounted(BOOK_SEED, BOOK_SCENES), undefined);
check('an unknown (empty) layout: nothing', mounted(BOOK_SEED, []), undefined);

console.log('5. the Hold and Win seed shows pots itself');
const HW_SEED = freshDrivenSeedDoc('holdAndWin');
check('it drives the screens', drives(HW_SEED), true);
check('it is left alone', mounted(HW_SEED, scenesOf('holdAndWin', { potIds: POT_IDS })), undefined);

console.log('6. #1032’s missing-screen report');
const sceneIds = BORUT_SCENES.map((s) => s.id);
check(
	'the Borut-shaped flow and layout agree',
	containersMissingScene(BOOK_SEED.containers, sceneIds),
	[],
);
check(
	'the mounted screen is never one of the flow’s containers',
	BOOK_SEED.containers.some((c) => c.sceneId === borut?.scene.id),
	false,
);
check(
	'a declared pots container whose scene was lost is reported, and nothing is mounted for it',
	[
		containersMissingScene(
			declared.containers,
			sceneIds.filter((id) => id !== 'pots'),
		).map((c) => c.id),
		mounted(
			declared,
			BORUT_SCENES.filter((s) => s.id !== POTS_SCREEN),
		),
	],
	[['pots'], undefined],
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
if (failures > 0) throw new Error('flow v2 pots screen fixture failed');
