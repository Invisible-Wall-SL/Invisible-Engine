// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Pin the Scene Editor's "In-game view" screen selection (`restingScenes.ts`): the idle base game
// shows the board, the background, the HUD and (Hold and Win) the jackpot bar and the pots — never a
// menu, a takeover, a feature or a beat screen — and editing a screen adds it (and, for a mode
// screen, its mode's non-beat screens).
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
			`export { isShownAtRest, inGameViewSceneIds } from '../src/lib/restingScenes.ts';`,
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
const { getFullSceneSet, isShownAtRest, inGameViewSceneIds } = mod;

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

const editingBuy = inGameViewSceneIds(holdAndWin, byId('buyFeature') ?? byId('buyConfirm'));
assert.ok(editingBuy.has('basegame'), 'editing a takeover keeps the base game under it');
assert.ok(!editingBuy.has('respinCounter'), 'editing a takeover shows no feature screen');

const editingCounter = inGameViewSceneIds(holdAndWin, byId('respinCounter'));
for (const id of ['respinCounter', 'respinBoard', 'totalWinBar', 'letters', 'basegame']) {
	assert.ok(editingCounter.has(id), `editing the counter shows ${id}`);
}
for (const id of ['wheel', 'featureIntro', 'featureOutro', 'jackpotWin']) {
	assert.ok(!editingCounter.has(id), `editing the counter hides the beat screen ${id}`);
}
assert.ok(
	inGameViewSceneIds(holdAndWin, byId('wheel')).has('wheel'),
	'the edited beat screen shows',
);

console.log(`resting scenes: ok (holdAndWin at rest: ${rest.join(', ')})`);
