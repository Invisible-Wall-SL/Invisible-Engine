// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Pin the Scene Editor's "In-game view" screen selection (`restingScenes.ts`): the idle base game
// shows the board, the background, the HUD and (Hold and Win) the jackpot bar and the pots — never a
// menu, a takeover, a feature or a beat screen — a mode on screen adds its non-beat screens whichever
// screen is edited, and editing a screen adds it.
//
//   node scripts/test-resting-scenes.mjs
//
// Same esbuild-bundle trick as test-hold-and-win-template.mjs: the package is raw TS.
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: [
			`export { getFullSceneSet } from '../src/lib/referenceLayouts/index.ts';`,
			`export { isShownAtRest, inGameViewSceneIds, viewableModeIds } from '../src/lib/restingScenes.ts';`,
		].join('\n'),
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-resting-scenes.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `resting-scenes-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}
const { getFullSceneSet, isShownAtRest, inGameViewSceneIds, viewableModeIds } = mod;

const atRest = (kind) =>
	getFullSceneSet(kind)
		.scenes.filter(isShownAtRest)
		.map((s) => s.id);

if (process.argv.includes('--print')) {
	for (const kind of ['lines', 'bookOf', 'ways', 'cluster', 'scatter', 'holdAndWin']) {
		console.log(kind, JSON.stringify(atRest(kind)));
	}
	process.exit(0);
}

const holdAndWin = getFullSceneSet('holdAndWin').scenes;
const rest = atRest('holdAndWin');
for (const id of ['basegame', 'jackpotBar', 'pots']) assert.ok(rest.includes(id), `at rest: ${id}`);
for (const id of [
	'loading',
	'respinBoard',
	'respinCounter',
	'totalWinBar',
	'letters',
	'wheel',
	'featureIntro',
	'featureOutro',
	'jackpotWin',
	'luckySpin',
	'buyFeature',
	'buyConfirm',
]) {
	if (holdAndWin.some((s) => s.id === id)) assert.ok(!rest.includes(id), `not at rest: ${id}`);
}
for (const kind of ['lines', 'bookOf']) {
	const ids = atRest(kind);
	assert.ok(ids.includes('basegame'), `${kind}: basegame at rest`);
	for (const id of ['freeSpinIntro', 'freeSpinOutro', 'freeSpinCounter', 'loading', 'buyFeature']) {
		assert.ok(!ids.includes(id), `${kind}: ${id} not at rest`);
	}
}

const byId = (id) => holdAndWin.find((s) => s.id === id);

const MODE = 'holdAndWin';
assert.deepEqual(viewableModeIds(holdAndWin), [MODE], 'the kind has one mode to view');
for (const kind of ['lines', 'bookOf', 'ways', 'cluster', 'scatter']) {
	assert.deepEqual(viewableModeIds(getFullSceneSet(kind).scenes), [], `${kind}: no mode to view`);
}

const editingBuy = inGameViewSceneIds(holdAndWin, byId('buyFeature') ?? byId('buyConfirm'));
assert.ok(editingBuy.has('basegame'), 'editing a takeover keeps the base game under it');
assert.ok(!editingBuy.has('respinCounter'), 'editing a takeover shows no feature screen');

const FEATURE = ['respinBoard', 'respinCounter', 'totalWinBar', 'letters'];
const BEATS = ['wheel', 'featureIntro', 'featureOutro', 'jackpotWin'];

const editingCounter = inGameViewSceneIds(holdAndWin, byId('respinCounter'), MODE);
for (const id of [...FEATURE, 'basegame', 'jackpotBar', 'pots']) {
	assert.ok(editingCounter.has(id), `editing the counter in the feature shows ${id}`);
}
for (const id of BEATS) {
	assert.ok(!editingCounter.has(id), `editing the counter hides the beat screen ${id}`);
}

// The feature's screens stay on screen while a base screen they share the feature with is edited.
for (const id of ['basegame', 'jackpotBar', 'pots', 'hudBar']) {
	const shown = inGameViewSceneIds(holdAndWin, byId(id), MODE);
	for (const feature of FEATURE) assert.ok(shown.has(feature), `editing ${id}: ${feature} shows`);
	for (const beat of BEATS) assert.ok(!shown.has(beat), `editing ${id}: ${beat} stays off`);
}

const baseOnly = inGameViewSceneIds(holdAndWin, byId('basegame'));
for (const id of [...FEATURE, ...BEATS]) assert.ok(!baseOnly.has(id), `base game: ${id} stays off`);

const editingCounterInBase = inGameViewSceneIds(holdAndWin, byId('respinCounter'));
assert.ok(
	editingCounterInBase.has('respinCounter'),
	'the edited mode screen shows in the base game',
);
assert.ok(!editingCounterInBase.has('totalWinBar'), 'the base game adds no other feature screen');

assert.ok(
	inGameViewSceneIds(holdAndWin, byId('wheel'), MODE).has('wheel'),
	'the edited beat screen shows',
);
const freeSpinMode = [
	{ id: 'basegame', role: 'basegame', nodes: [] },
	{ id: 'freeSpinCounter', role: 'mode', modeId: 'freeSpins', nodes: [] },
	{ id: 'freeSpinIntro', role: 'mode', modeId: 'freeSpins', nodes: [] },
];
const inFreeSpins = inGameViewSceneIds(freeSpinMode, freeSpinMode[0], 'freeSpins');
assert.ok(inFreeSpins.has('freeSpinCounter'), "a mode's counter stays on screen");
assert.ok(!inFreeSpins.has('freeSpinIntro'), "a mode's intro is a beat");

assert.deepEqual(
	[...inGameViewSceneIds(holdAndWin, byId('basegame'), 'noSuchMode')].sort(),
	[...baseOnly].sort(),
	'a mode with no screens adds nothing',
);

console.log(`resting scenes: ok (holdAndWin at rest: ${rest.join(', ')})`);
