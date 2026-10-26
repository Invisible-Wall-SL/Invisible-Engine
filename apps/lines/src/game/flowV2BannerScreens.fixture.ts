/**
 * Offline fixture for the banner screens the game mounts itself under a driven flow. Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/flowV2BannerScreens.fixture.ts
 *
 * Every Hold and Win banner beat used to draw the coded banner unless a flow showed an authored screen
 * around it, and only four beats had such a screen. Each beat now has one; the nine new ones are
 * mounted by the game itself, so art put on one replaces the coded banner with no flow wiring.
 * `engineBannerScreens` decides which. SIX claims, on real seeds and scene sets:
 *
 *  1. THE STARTER FLOWS MOUNT EVERY NEW BANNER SCREEN. The Hold and Win seed (and its coin-board
 *     twin) never shows one, so each self-mounted banner screen in the layout is mounted — and none of
 *     the four older beat screens, which stay a flow's to show.
 *  2. A RESPIN MODE'S COPIES MOUNT TOO, each the copy of a self-mounted banner screen (the game gates
 *     them on the mode being on screen).
 *  3. THE Z IS THE SCREEN'S OWN and pinned: above the flights band, so a coin in flight passes under
 *     the banner as it does under the coded one.
 *  4. SHOWING IS OWNING. A flow that shows a banner screen anywhere owns it: the game leaves it alone.
 *  5. PARITY: no driven flow (the coded path mounts it with the other author screens), or a layout
 *     without the banner screens ⇒ nothing. That is every project scaffolded before them, and every
 *     new one too: the scaffold carries none, so a game keeps the built-in banner until an author
 *     adds a popup's screen.
 *  6. AN OVERLAY HOST'S BONUS (Book-of + the Hold and Win add-on, on the Book-of seed) gets its pot,
 *     base and feature banners mounted, and no Lucky Spin.
 */

import { freshDrivenSeedDoc, flowScreenDrivingStatus, type FlowDoc } from 'engine-flow-v2';
import {
	engineOwnedOnly,
	getFullSceneSet,
	LAYER_BAND_FLIGHTS,
	POT_BANNER_SCREENS,
	sceneLayerZIndex,
	SELF_MOUNTED_BANNER_SCREENS,
	type Scene,
} from 'engine-layout';

import { engineBannerScreens } from './flowV2BannerScreens.ts';
import { modeSceneBaseId } from './respinModes.ts';

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

const scenesOf = (gameType: string, options?: Parameters<typeof getFullSceneSet>[1]): Scene[] => {
	const doc = getFullSceneSet(gameType, options);
	if (!doc) throw new Error(`no scene set for ${gameType}`);
	return doc.scenes;
};
const decide = (doc: FlowDoc, scenes: Scene[]) =>
	engineBannerScreens(doc, scenes, {
		drivesScreens: flowScreenDrivingStatus(doc).drivesScreens,
	});
const ids = (doc: FlowDoc, scenes: Scene[]) => decide(doc, scenes).map(({ scene }) => scene.id);
const bannersIn = (scenes: Scene[]) =>
	scenes.filter((s) => SELF_MOUNTED_BANNER_SCREENS.includes(modeSceneBaseId(s))).map((s) => s.id);

const HW_SCENES = scenesOf('holdAndWin');
const HW_SEED = freshDrivenSeedDoc('holdAndWin');

console.log('1. the starter flows mount every new banner screen');
check(
	'the Hold and Win seed drives the screens',
	flowScreenDrivingStatus(HW_SEED).drivesScreens,
	true,
);
check(
	'every self-mounted banner screen is in the set',
	[...SELF_MOUNTED_BANNER_SCREENS].sort(),
	[...bannersIn(HW_SCENES)].sort(),
);
check('the seed mounts each one', ids(HW_SEED, HW_SCENES), bannersIn(HW_SCENES));
check(
	'…and none of the older beat screens',
	ids(HW_SEED, HW_SCENES).filter((id) =>
		['luckySpin', 'jackpotWin', 'featureIntro', 'featureOutro', 'wheel'].includes(id),
	),
	[],
);
check(
	'each is the layout’s own scene',
	decide(HW_SEED, HW_SCENES).every(({ scene }) => HW_SCENES.includes(scene)),
	true,
);
const COIN_SCENES = scenesOf('holdAndWin', { coinBoard: true });
check(
	'the coin-board seed mounts the coin board’s (no pot banners: it has no pots)',
	ids(freshDrivenSeedDoc('holdAndWin', { coinBoard: true }), COIN_SCENES).sort(),
	SELF_MOUNTED_BANNER_SCREENS.filter((id) => !POT_BANNER_SCREENS.includes(id)).sort(),
);

console.log('2. a respin mode’s copies mount too');
const TWO_MODES = scenesOf('holdAndWin', {
	respinModes: [{ id: 'holdAndWin' }, { id: 'superRespins', label: 'Super' }],
});
const copies = ids(HW_SEED, TWO_MODES).filter((id) => id.endsWith('-superRespins'));
check('the second mode’s feature banners', copies, [
	'coinJackpotBanner-superRespins',
	'jackpotUpgradeBanner-superRespins',
	'upgradeBanner-superRespins',
	'modifiersUnlockedBanner-superRespins',
	'wheelPrizeBanner-superRespins',
	'rowUnlockedBanner-superRespins',
	'featureTotalBanner-superRespins',
]);
check(
	'each copy is tagged with its mode',
	decide(HW_SEED, TWO_MODES)
		.filter(({ scene }) => copies.includes(scene.id))
		.every(({ scene }) => scene.role === 'mode' && scene.modeId === 'superRespins'),
	true,
);

console.log('3. the z is the screen’s own, pinned above the flights');
check(
	'z = sceneLayerZIndex',
	decide(HW_SEED, HW_SCENES).every(({ scene, z }) => z === sceneLayerZIndex(HW_SCENES, scene.id)),
	true,
);
check(
	'above the coded banner’s flights band',
	decide(HW_SEED, HW_SCENES).every(({ z }) => z > LAYER_BAND_FLIGHTS),
	true,
);

console.log('4. showing is owning');
const showing = (doc: FlowDoc, sceneId: string): FlowDoc => ({
	...doc,
	containers: [...doc.containers, { id: 'mine', sceneId, z: 0 }],
	graph: {
		...doc.graph,
		nodes: [
			...doc.graph.nodes,
			{ id: 'show_mine', kind: 'showContainer', ref: 'mine', pos: { x: 0, y: 0 } },
		],
	},
});
check(
	'a flow that shows the coin jackpot banner owns it',
	ids(showing(HW_SEED, 'coinJackpotBanner'), HW_SCENES).includes('coinJackpotBanner'),
	false,
);
check(
	'…and the game still mounts the others',
	ids(showing(HW_SEED, 'coinJackpotBanner'), HW_SCENES).length,
	bannersIn(HW_SCENES).length - 1,
);
const declaring: FlowDoc = {
	...HW_SEED,
	containers: [...HW_SEED.containers, { id: 'declared', sceneId: 'coinJackpotBanner', z: 0 }],
};
check(
	'declaring it is not showing it',
	ids(declaring, HW_SCENES).includes('coinJackpotBanner'),
	true,
);

console.log('5. parity');
const NOT_DRIVEN: FlowDoc = { ...HW_SEED, graph: { nodes: [], exec: [], data: [] } };
check(
	'a flow that does not drive the screens',
	flowScreenDrivingStatus(NOT_DRIVEN).drivesScreens,
	false,
);
check('…mounts nothing itself (the coded path does)', decide(NOT_DRIVEN, HW_SCENES), []);
const BEFORE_BANNERS = HW_SCENES.filter((s) => !bannersIn(HW_SCENES).includes(s.id));
check('a layout scaffolded before the banner screens', decide(HW_SEED, BEFORE_BANNERS), []);
const HW_DOC = getFullSceneSet('holdAndWin');
if (!HW_DOC) throw new Error('no scene set for holdAndWin');
check(
	'a new game’s scaffold (it carries no banner screen)',
	decide(HW_SEED, engineOwnedOnly(HW_DOC).scenes),
	[],
);
check('a Book-of layout on its seed', decide(freshDrivenSeedDoc('bookOf'), scenesOf('bookOf')), []);

console.log('6. an overlay host’s bonus');
const HOST = scenesOf('bookOf', {
	potsOverlay: true,
	holdAndWin: true,
	potIds: ['red', 'blue', 'green'],
});
check('its banners, on the Book-of seed', ids(freshDrivenSeedDoc('bookOf'), HOST), [
	'instantWinBanner',
	'randomMetreBanner',
	'potFullBanner',
	'modifiersActiveBanner',
	'platformJackpotBanner',
	'coinJackpotBanner',
	'jackpotUpgradeBanner',
	'upgradeBanner',
	'modifiersUnlockedBanner',
	'wheelPrizeBanner',
	'rowUnlockedBanner',
	'featureTotalBanner',
]);
check(
	'no Lucky Spin',
	HOST.some((s) => s.id === 'luckySpin'),
	false,
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
if (failures > 0) throw new Error('flow v2 banner screens fixture failed');
