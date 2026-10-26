// Plays a published game with a particle MATERIAL on it (Invisible Shader Graph step 8d.3,
// docs/design/shader-graph-particles.md §15 step 3): the `cg-lines` stand-in snapshot of the
// current-games harness with one Invisible FX effect placed as an `effect` node, its one sprite layer
// drawing through the Pulse tint reference graph (`material: { kind: 'custom:pulsetint' }`), the
// graph compiled and embedded as a publish embeds it (`shaderEffects`). The particles' art is the
// stock coin sheet (`art.assetKey: 'coins'`, the whole sheet). The snapshot is served as the launcher
// serves it, the runtime is a build of this checkout, the RGS is the real test server.
//
// Three runs of the same snapshot: as published; without its `shaderEffects` (the kind is then
// unregistered, so the layer must draw plain); and without the effect node (no particles at all).
// Each run records the material meshes on the stage, the particle sprites drawing, the `?fxdebug=1`
// lines, a screenshot, console errors and stalls. It PASSES (exit 0) when:
//  - the published run has the material's mesh on the stage, drawing, its sprites hidden, and its
//    `?fxdebug=1` line says the layer is on;
//  - the unregistered run has no mesh, its particle sprites draw, and its line says why it is plain;
//  - the published run differs from the unregistered one, and the unregistered one from no effect
//    (the plain particles are never invisible);
//  - no run has an error or a stall.
//
// Step 8d.8 grows this into the phone-calibration play; this is the 8d.3 proof that a game build
// plays an `EffectDoc` material.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/particle-material-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]

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
const work = mkdtempSync(join(tmpdir(), 'material-play-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

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

// 2. The graph, compiled as the export compiles it; the effect, as `/fx` saves it; its placement,
// as the Scene Editor saves an effect node.
const doc = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint');
const compiled = compileShaderEffect({ ...doc, id: 'pulsetint' });
if (!compiled.ok)
	throw new Error(`Pulse tint does not compile: ${JSON.stringify(compiled.issues)}`);
const KIND = 'custom:pulsetint';
const effect = {
	version: 1,
	id: 'embers',
	name: 'Embers',
	layers: [
		{
			key: 'main',
			config: {
				lifetime: { min: 1.2, max: 2 },
				frequency: 0.02,
				emitterLifetime: -1,
				maxParticles: 120,
				pos: { x: 0, y: 0 },
				addAtBack: false,
				behaviors: [
					{
						type: 'spawnShape',
						config: { type: 'rect', data: { x: -300, y: -160, w: 600, h: 320 } },
					},
					{
						type: 'scale',
						config: {
							scale: {
								list: [
									{ value: 0.8, time: 0 },
									{ value: 1.4, time: 1 },
								],
							},
							minMult: 0.6,
						},
					},
					{
						type: 'rotation',
						config: { minStart: 0, maxStart: 360, minSpeed: -90, maxSpeed: 90, accel: 0 },
					},
				],
			},
			art: { assetKey: 'coins', frames: [] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			trigger: { on: 'always' },
			material: { kind: KIND, intensity: 4, params: { color: '#ff3366' } },
		},
	],
};
const NODE = {
	id: 'fx-embers',
	label: 'Embers',
	kind: 'effect',
	effectId: effect.id,
	x: 718.11,
	y: 404,
};
const bundle = JSON.parse(readFileSync(join(game.local.snapshot, 'runtime.json'), 'utf8'));
const withNode = structuredClone(bundle);
const basegame = withNode.doc.scenes.find((s) => s.id === 'basegame');
if (!basegame) throw new Error('the stand-in has no basegame scene');
basegame.nodes.push(NODE);

const variants = {
	published: { ...withNode, effects: [effect], shaderEffects: [compiled.effect] },
	unregistered: { ...withNode, effects: [effect] },
	none: bundle,
};

// 3. Play each.
const STEP = 300;
const probe = `(() => {
	const found = { meshes: 0, meshesDrawing: 0, sprites: 0, hiddenSprites: 0 };
	const walk = (c, shown) => {
		const visible = shown && c.visible !== false;
		const fragment = c.shader?.glProgram?.fragment ?? '';
		if (/SHADER_NAME particle-material-custom-pulsetint/.test(fragment)) {
			found.meshes++;
			if (visible) found.meshesDrawing++;
		}
		if (c.label === 'particle material sprites') {
			found.sprites += c.children.length;
			if (!c.visible) found.hiddenSprites += c.children.length;
		}
		for (const child of c.children ?? []) walk(child, visible);
	};
	walk(globalThis.__PIXI_APP__.stage, true);
	return found;
})()`;
// The plain layer's sprites have no container of their own: they are the coin frames' sprites with
// the library's particle fields, counted where they draw.
const plainProbe = `(() => {
	let n = 0;
	const walk = (c, shown) => {
		const visible = shown && c.visible !== false;
		if (visible && typeof c.agePercent === 'number' && c.config && c.texture) n++;
		for (const child of c.children ?? []) walk(child, visible);
	};
	walk(globalThis.__PIXI_APP__.stage, true);
	return n;
})()`;

const report = { snapshot: game.key, material: KIND, runs: {} };
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
	const run = { shot: null, stage: null, drawingSprites: 0, state: null };
	try {
		const params = new URLSearchParams({
			runtime: '1',
			project: game.key,
			k: 'material-play',
			editorDocBase: snap.origin,
			rgs_url: `${server.origin}/api/${game.key}/authoring`.replace(/^http:\/\//, ''),
			sessionID: `material-${name}-${Date.now()}`,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
			fxdebug: '1',
		});
		// The harness keeps console errors only, so the `?fxdebug=1` lines are kept on the page.
		await page.page('Page.addScriptToEvaluateOnNewDocument', {
			source: `window.__fxdebug = []; const log = console.log; console.log = (...a) => { const line = a.map(String).join(' '); if (line.startsWith('[fxdebug] material layer')) window.__fxdebug.push(line); log(...a); };`,
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
		await api(`step(${STEP}, { draw: 'last' })`);
		await new Promise((r) => setTimeout(r, 200));
		run.shot = `${name}.png`;
		writeFileSync(join(out, run.shot), await page.screenshot());
		run.stage = await page.evaluate(probe);
		run.drawingSprites = await page.evaluate(plainProbe);
		run.state = await api('state()');
		run.fxdebug = await page.evaluate('window.__fxdebug');
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

// 4. What the material changed.
const diff = (a, b) => {
	const [pa, pb] = [a, b].map((f) => PNG.sync.read(readFileSync(join(out, f))));
	return pixelmatch(pa.data, pb.data, null, pa.width, pa.height, { threshold: 0.05 });
};
const { published, unregistered, none } = report.runs;
if (!published.error && !unregistered.error && !none.error) {
	report.pixels = {
		publishedVsUnregistered: diff(published.shot, unregistered.shot),
		unregisteredVsNone: diff(unregistered.shot, none.shot),
	};
}

// 5. The verdict. Typekit never loads in a container (docs/playtest/README.md); any other console
// error fails the run.
const KNOWN_CONSOLE = /Web font load inactive/;
const failures = [];
const expect = (ok, what) => ok || failures.push(what);
for (const [name, run] of Object.entries(report.runs)) {
	expect(!run.error, `${name}: ${run.error}`);
	expect(run.state?.errors === 0 && run.state?.stalls === 0, `${name}: errors or stalls`);
	expect(
		(run.console ?? []).every((line) => KNOWN_CONSOLE.test(line)),
		`${name}: console errors`,
	);
}
const said = (run, text) => (run.fxdebug ?? []).some((line) => String(line).includes(text));
expect(published.stage?.meshesDrawing === 1, 'published: the material mesh is not drawing');
expect(
	published.stage?.sprites > 0 && published.stage?.hiddenSprites === published.stage?.sprites,
	'published: the particles are not all hidden behind the mesh',
);
expect(said(published, `embers/main: on (${KIND}`), 'published: no `on` fxdebug line');
expect(unregistered.stage?.meshes === 0, 'unregistered: a material mesh is on the stage');
expect(unregistered.drawingSprites > 0, 'unregistered: no particle sprite draws');
expect(
	said(unregistered, `embers/main: plain, not registered (${KIND}`),
	'unregistered: no `plain, not registered` fxdebug line',
);
expect(none.drawingSprites === 0 && none.stage?.meshes === 0, 'none: particles on the stage');
const px = report.pixels ?? {};
expect(px.publishedVsUnregistered > 1000, 'the material changes fewer than 1,000 pixels');
expect(px.unregisteredVsNone > 1000, 'the plain particles draw fewer than 1,000 pixels');
report.verdict = failures.length ? { pass: false, failures } : { pass: true };

writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, '\t'));
console.log(JSON.stringify(report, null, '\t'));
process.exit(failures.length ? 1 : 0);
