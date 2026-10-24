// Plays a published game that carries shader graphs (Invisible Shader Graph, docs/design/
// invisible-shader-graph.md §8 step 4): the `cg-lines` stand-in snapshot of the current-games
// harness, with two reference graphs compiled and embedded as a publish embeds them (the bundle's
// `shaderEffects`) and placed as Element FX the way the Scene Editor saves them — Pulse tint looping
// on the reel frame, Power-up looping on the frame's caption. The snapshot is served as the launcher
// serves it, the runtime is a build of this checkout, the RGS is the real test server.
//
// The same snapshot is played twice: as published, and without its `shaderEffects` (an entry
// naming an effect the game has not registered plays nothing). Each run records the shader
// programs on the stage, a screenshot at two moments, console errors and stalls; the report says
// how many pixels the effects changed.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/shader-effect-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { REFERENCE_GRAPHS, compileShaderEffect } from '../../packages/engine-shadergraph/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string' },
		out: { type: 'string' },
		chrome: { type: 'string' },
		seed: { type: 'string', default: '7' },
	},
});
if (!opt.runtime || !opt.out)
	throw new Error('--runtime <built apps/lines> and --out <dir> are required');
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'shader-play-'));

// 1. The stand-in published snapshot.
const fixtures = join(work, 'fixtures');
const made = spawnSync(
	process.execPath,
	[
		'--experimental-strip-types',
		'--import',
		'./scripts/ts-loader.mjs',
		'scripts/current-games/fixtures.mjs',
		'--out',
		fixtures,
	],
	{ cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
);
if (made.status !== 0) throw new Error('the current-games fixtures did not build');
const game = JSON.parse(readFileSync(join(fixtures, 'games.json'), 'utf8')).games.find(
	(g) => g.key === 'cg-lines',
);

// 2. The graphs, compiled as the export compiles them, and placed as the Scene Editor saves them.
const compiled = (id) => {
	const doc = REFERENCE_GRAPHS.find((d) => d.id === id);
	const result = compileShaderEffect({ ...doc, id: id.toLowerCase() });
	if (!result.ok) throw new Error(`${id} does not compile: ${JSON.stringify(result.issues)}`);
	return result.effect;
};
const shaderEffects = [compiled('pulseTint'), compiled('powerUp')];
const PLACED = {
	'frame-edge': [{ id: 'efx1', kind: 'custom:pulsetint', trigger: 'always' }],
	'editor-watermark': [{ id: 'efx1', kind: 'custom:powerup', trigger: 'always' }],
};
const bundle = JSON.parse(readFileSync(join(game.local.snapshot, 'runtime.json'), 'utf8'));
let placed = 0;
const place = (nodes) => {
	for (const node of nodes ?? []) {
		if (PLACED[node.id]) {
			node.elementFx = PLACED[node.id];
			placed++;
		}
		place(node.children);
	}
};
for (const scene of bundle.doc.scenes) place(scene.nodes);
if (placed !== Object.keys(PLACED).length) throw new Error(`placed ${placed} of the entries`);

const variants = {
	published: { ...bundle, shaderEffects },
	unregistered: bundle,
};

// 3. Play each.
const STEPS = [
	['a', 400],
	['b', 23],
];
const probe = `(() => {
	const names = {};
	const walk = (c) => {
		for (const f of c.filters ?? []) {
			const name = /SHADER_NAME (\\S+)/.exec(f.glProgram?.fragment ?? '')?.[1] ?? '?';
			names[name] = (names[name] ?? 0) + 1;
		}
		for (const child of c.children ?? []) walk(child);
	};
	walk(globalThis.__PIXI_APP__.stage);
	return names;
})()`;

const report = {
	snapshot: game.key,
	shaderEffects: shaderEffects.map((e) => e.spec.kind),
	runs: {},
};
for (const [name, runtimeJson] of Object.entries(variants)) {
	const dir = join(work, name);
	cpSync(game.local.snapshot, dir, { recursive: true });
	writeFileSync(join(dir, 'runtime.json'), JSON.stringify(runtimeJson));
	const tree = testServerTree(
		join(work, `tree-${name}`),
		opt.runtime,
		game.key,
		game.local.manifestEntry,
	);
	const server = await startTestServer(tree, { SEED: opt.seed });
	const snap = await serveSnapshot({
		dir,
		name: game.key,
		snapshotId: name,
		assetBase: `${server.origin}/${game.key}/`,
	});
	const page = await openPage(headlessShell(opt.chrome), join(work, `profile-${name}`));
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const run = { shots: {}, programs: null, state: null };
	try {
		const params = new URLSearchParams({
			runtime: '1',
			project: game.key,
			k: 'shader-play',
			editorDocBase: snap.origin,
			rgs_url: `${server.origin}/api/${game.key}/authoring`.replace(/^http:\/\//, ''),
			sessionID: `shader-${name}-${Date.now()}`,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
		});
		await page.navigate(`${server.origin}/${game.key}/?${params}`);
		let ready = false;
		for (let i = 0; i < 300 && !ready; i++) {
			ready = await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false);
			if (!ready) await new Promise((r) => setTimeout(r, 100));
		}
		if (!ready) throw new Error('the runtime never installed determinism mode');
		await api(`waitFor(${JSON.stringify({ loaded: true, maxFrames: 3600, draw: 'last' })})`);
		for (let i = 0; i < 20 && !(await api('state()')).playerIn; i++) {
			await page.key('keyDown');
			await api(`step(2, { draw: 'last' })`);
			await page.key('keyUp');
			await api(`step(60, { draw: 'last' })`);
		}
		for (const [label, frames] of STEPS) {
			await api(`step(${frames}, { draw: 'last' })`);
			await new Promise((r) => setTimeout(r, 200));
			const file = `${name}-${label}.png`;
			writeFileSync(join(out, file), await page.screenshot());
			run.shots[label] = file;
		}
		run.programs = await page.evaluate(probe);
		run.state = await api('state()');
		run.console = page.consoleLines.filter((l) => /error/i.test(String(l)));
	} catch (e) {
		run.error = e instanceof Error ? e.message : String(e);
	} finally {
		await page.close();
		await snap.close();
		server.stop();
	}
	report.runs[name] = run;
}

// 4. What the effects changed.
const diff = (a, b) => {
	const [pa, pb] = [a, b].map((f) => PNG.sync.read(readFileSync(join(out, f))));
	return pixelmatch(pa.data, pb.data, null, pa.width, pa.height, { threshold: 0.05 });
};
const { published, unregistered } = report.runs;
if (!published.error && !unregistered.error) {
	report.pixels = {
		publishedVsUnregistered: diff(published.shots.a, unregistered.shots.a),
		publishedOverTime: diff(published.shots.a, published.shots.b),
		unregisteredOverTime: diff(unregistered.shots.a, unregistered.shots.b),
	};
}
writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, '\t'));
console.log(JSON.stringify(report, null, '\t'));
rmSync(work, { recursive: true, force: true });
