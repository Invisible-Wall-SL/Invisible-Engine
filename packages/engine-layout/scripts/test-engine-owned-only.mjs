// Verify engineOwnedOnly(defaultLayout('lines')) — the §19.4 scaffold projection.
//
//   node scripts/test-engine-owned-only.mjs
//
// Same esbuild-bundle trick as gen-scene-sets.mjs: the monorepo consumes
// packages as raw TS, so bundle the pure-data graph (no `.svelte`) into one ESM
// file Node can execute, then assert the projection's shape.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export { defaultLayout, engineOwnedOnly, getFullSceneSet } from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-engine-owned-only.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `engine-owned-only-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};

const input = mod.defaultLayout('lines');
const out = mod.engineOwnedOnly(input);

const allNodes = (nodes) => nodes.flatMap((n) => [n, ...(n.children ? allNodes(n.children) : [])]);
const sceneById = (doc, id) => doc.scenes.find((s) => s.id === id);
const findNode = (doc, id) => doc.scenes.flatMap((s) => allNodes(s.nodes)).find((n) => n.id === id);

// Purity: the input is untouched.
assert(
	JSON.stringify(input) === JSON.stringify(mod.defaultLayout('lines')),
	'input doc is not mutated',
);

// Header preserved verbatim.
assert(out.version === input.version, 'version preserved');
assert(out.projectKey === input.projectKey, 'projectKey preserved');
assert(out.gameType === input.gameType, 'gameType preserved');
assert(out.updatedAt === input.updatedAt, 'updatedAt preserved');
assert(
	JSON.stringify(out.mainSizesMap) === JSON.stringify(input.mainSizesMap),
	'mainSizesMap preserved',
);

// (a) every input scene still exists by id.
const inIds = input.scenes.map((s) => s.id);
const outIds = out.scenes.map((s) => s.id);
assert(
	inIds.length === outIds.length && inIds.every((id, i) => id === outIds[i]),
	`every scene emitted by id (${outIds.join(', ')})`,
);

// (b) the basegame board-FRAME sprites + the plain text watermark are GONE.
assert(!findNode(out, 'frame-bg'), 'plain board-frame sprite (frame-bg) dropped');
assert(!findNode(out, 'frame-edge'), 'plain board-frame edge sprite (frame-edge) dropped');
assert(!findNode(out, 'editor-watermark'), 'plain text watermark dropped');
assert(sceneById(out, 'basegame').nodes.length === 0, 'basegame scene unfurnished (0 nodes)');

// (c) bind anchors, componentInstance readouts, and HUD nodes are RETAINED.
assert(!!findNode(out, 'loading-screen'), 'loading bind anchor retained');
assert(!!findNode(out, 'bound-win'), 'Win bind anchor retained');
assert(!!findNode(out, 'bound-transition'), 'Transition bind anchor retained');
assert(!!findNode(out, 'fs-intro'), 'free-spin intro bind anchor retained');
assert(!!findNode(out, 'fs-outro'), 'free-spin outro bind anchor retained');
assert(
	findNode(out, 'fs-counter')?.kind === 'componentInstance',
	'free-spin counter componentInstance retained',
);
assert(!!findNode(out, 'hud-balance'), 'HUD balance readout (componentInstance) retained');
assert(!!findNode(out, 'hud-btn-menu'), 'HUD menu button node retained');
assert(!!findNode(out, 'hud-gamename'), 'HUD game-name corner retained');
assert(!!findNode(out, 'hud-logo'), 'HUD logo corner retained');

// --- §19.8 engine-skeleton kinds: ways / cluster / scatter ---
// Each must (a) return a full scene set, and (b) survive the scaffold projection
// keeping its reelGrid + HUD scenes, dropping nothing it shouldn't (every scene
// still emitted, since the skeletons carry only engine-owned nodes).
const SKELETON_BOARDS = {
	ways: { reels: 5, rows: 3, cellSize: 120 },
	cluster: { reels: 7, rows: 7, cellSize: 80 },
	scatter: { reels: 6, rows: 5, cellSize: 100 },
};

for (const [kind, board] of Object.entries(SKELETON_BOARDS)) {
	const full = mod.getFullSceneSet(kind);
	assert(!!full, `getFullSceneSet('${kind}') returns a doc`);
	if (!full) continue;
	assert(full.gameType === kind, `${kind} doc gameType is '${kind}'`);

	const scaffold = mod.engineOwnedOnly(full);

	// (a) every scene survives the projection (skeleton = engine-owned only).
	const fullIds = full.scenes.map((s) => s.id);
	const scaffoldIds = scaffold.scenes.map((s) => s.id);
	assert(
		fullIds.length === scaffoldIds.length && fullIds.every((id, i) => id === scaffoldIds[i]),
		`${kind} scaffold emits every scene (${scaffoldIds.join(', ')})`,
	);

	// (b) reelGrid retained with the kind's real board shape.
	const grid = findNode(scaffold, 'reel-grid');
	assert(grid?.kind === 'reelGrid', `${kind} reelGrid retained`);
	assert(
		grid?.reels === board.reels && grid?.rows === board.rows && grid?.cellSize === board.cellSize,
		`${kind} reelGrid is ${board.reels}×${board.rows} @ ${board.cellSize}px`,
	);

	// (c) HUD scenes retained intact (whole-scene engine-owned).
	const hudBar = sceneById(scaffold, 'hudBar');
	const hudCorners = sceneById(scaffold, 'hudCorners');
	assert(!!hudBar && hudBar.nodes.length > 0, `${kind} HUD bar retained`);
	assert(!!hudCorners && hudCorners.nodes.length > 0, `${kind} HUD corners retained`);
	assert(!!findNode(scaffold, 'hud-btn-menu'), `${kind} HUD button retained`);

	// (d) overlay + free-spin bind anchors retained.
	for (const id of [
		'loading-screen',
		'bg',
		'bound-win',
		'bound-transition',
		'fs-intro',
		'fs-counter',
		'fs-outro',
	]) {
		assert(!!findNode(scaffold, id), `${kind} bind anchor '${id}' retained`);
	}

	// (e) nothing dropped — the skeleton has no plain artist art, so node count holds.
	const countNodes = (doc) => doc.scenes.reduce((n, s) => n + allNodes(s.nodes).length, 0);
	assert(
		countNodes(scaffold) === countNodes(full),
		`${kind} scaffold drops nothing (${countNodes(scaffold)} nodes retained)`,
	);
}

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ engineOwnedOnly projection verified.');
