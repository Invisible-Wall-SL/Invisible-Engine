// The step-8 play of particle materials (Invisible Shader Graph step 8d.8,
// docs/design/shader-graph-particles.md §15 step 8, the calibration figures of §10): the `cg-lines`
// stand-in snapshot of the current-games harness with Invisible FX effects placed as `effect` nodes,
// their sprite layers drawing through the Pulse tint reference graph MADE FOR PARTICLES
// (`material: { kind: 'custom:pulsetint' }`), compiled and embedded as a publish embeds it
// (`shaderEffects`), so the effect carries its graph's cost and `?fxdebug=1` prints each layer's
// load. The particles' art is the stock coin sheet. The snapshot is served as the launcher serves it,
// the runtime is a RELEASE build of this checkout (the current-games env, below), the RGS is the
// real test server.
//
// Four runs, on WebGL2 and on WebGL1 (the page is refused a `webgl2` context, as a WebGL1-only phone
// refuses it; Pixi then takes `webgl`):
//  - published: one material layer (`embers/main`, 120 particles);
//  - unregistered: the same snapshot without its `shaderEffects` (the kind is unregistered, so the
//    layer must draw plain);
//  - none: without the effect node (no particles at all);
//  - cap: one effect with NINE material layers (`swarm/m1`…`m9`): the game's cap of 8 draws eight,
//    the ninth plain, decided at mount and kept.
// Each records the material meshes on the stage (sampled at five moments, a second apart), the
// particle sprites drawing, the `?fxdebug=1` lines read into each layer's state, peak covered pixels
// and load, a screenshot, console errors, failed requests and stalls.
//
// It PASSES (exit 0) when, on each WebGL version:
//  - the page drew on that version;
//  - published: the mesh is on the stage and drawing at every sample, its sprites hidden; its line
//    says `on`, and a peak line gives the load, which is the covered pixels × the graph's cost;
//  - unregistered: no mesh, its particle sprites draw, its line says `plain, not registered`;
//  - published differs from unregistered, and unregistered from none (plain particles are never
//    invisible);
//  - cap: eight `on` lines and one `plain, over the game cap`; eight meshes drawing at every sample,
//    their sprites hidden, and the ninth layer's sprites drawing (no pop either way);
//  - no layer turns plain while playing; no run has an error, a stall, a console error or a failed
//    request.
//
// `--calibrate` adds, to the published, unregistered and cap runs, the wall time of `--frames`
// frames (default 120), each run and drawn alone and waited on, after 10 unmeasured: median, p95,
// max, and the frames over twice the median. Headless Chromium renders in software (SwiftShader), so
// these compare the runs with one another; a phone's are read on the phone
// (docs/playtest/particle-material.md).
//
// Writes `result.json` (machine-readable), `summary.txt` (the same, short) and a screenshot a run
// into `--out`, and prints the summary.
//
//   PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/particle-material-play.mjs --runtime apps/lines/build --out <dir> \
//     [--gl 1|2|both] [--calibrate] [--frames 120] [--chrome <exe>]

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import {
	FX_MATERIAL_EFFECT_LOAD_BUDGET,
	FX_MATERIAL_LAYER_CAP,
	FX_MATERIAL_LAYER_LOAD_BUDGET,
	FX_MATERIAL_PARTICLE_CAP,
} from '../../packages/engine-fx/src/materialLayer.ts';
import {
	PARTICLE_COST_BUDGET,
	PARTICLE_SAMPLE_BUDGET,
	REFERENCE_GRAPHS,
	compileShaderEffect,
} from '../../packages/engine-shadergraph/index.ts';
import { FX_DEBUG_PANEL_ID } from '../../packages/pixi-svelte/src/lib/particleMaterial/debugPanel.ts';
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
		gl: { type: 'string', default: 'both' },
		calibrate: { type: 'boolean', default: false },
		frames: { type: 'string', default: '120' },
	},
});
if (!opt.runtime || !opt.out)
	throw new Error('--runtime <built apps/lines> and --out <dir> are required');
const GL_VERSIONS = { both: [2, 1], 1: [1], 2: [2] }[opt.gl];
if (!GL_VERSIONS) throw new Error('--gl is 1, 2 or both');
const FRAMES = Number(opt.frames);
if (!(Number.isInteger(FRAMES) && FRAMES > 0))
	throw new Error('--frames is a whole number above 0');
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

// 2. The graph, made for particles and compiled as the export compiles it; the effects, as `/fx`
// saves them; their placements, as the Scene Editor saves an effect node.
const doc = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint');
const compiled = compileShaderEffect({ ...doc, id: 'pulsetint', madeFor: 'particles' });
if (!compiled.ok)
	throw new Error(`Pulse tint does not compile: ${JSON.stringify(compiled.issues)}`);
if (typeof compiled.effect.cost !== 'number')
	throw new Error('the compiled effect carries no cost: is it made for particles?');
const KIND = 'custom:pulsetint';

const layerConfig = ({ maxParticles, frequency, rect }) => ({
	lifetime: { min: 1.2, max: 2 },
	frequency,
	emitterLifetime: -1,
	maxParticles,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [
		{ type: 'spawnShape', config: { type: 'rect', data: rect } },
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
});
const spriteLayer = (key, config, color) => ({
	key,
	config,
	art: { assetKey: 'coins', frames: [] },
	placement: { space: 'free' },
	particleKind: 'sprite',
	trigger: { on: 'always' },
	material: { kind: KIND, intensity: 4, params: { color } },
});
const embers = {
	version: 1,
	id: 'embers',
	name: 'Embers',
	layers: [
		spriteLayer(
			'main',
			layerConfig({
				maxParticles: 120,
				frequency: 0.02,
				rect: { x: -300, y: -160, w: 600, h: 320 },
			}),
			'#ff3366',
		),
	],
};
const CAP_LAYERS = FX_MATERIAL_LAYER_CAP + 1;
const swarm = {
	version: 1,
	id: 'swarm',
	name: 'Swarm',
	layers: Array.from({ length: CAP_LAYERS }, (_, i) =>
		spriteLayer(
			`m${i + 1}`,
			layerConfig({
				maxParticles: 24,
				frequency: 0.08,
				rect: { x: -450 + i * 100, y: -160, w: 100, h: 320 },
			}),
			['#ff3366', '#33ccff'][i % 2],
		),
	),
};
const bundle = JSON.parse(readFileSync(join(game.local.snapshot, 'runtime.json'), 'utf8'));
const withNode = (effect) => {
	const next = structuredClone(bundle);
	const basegame = next.doc.scenes.find((s) => s.id === 'basegame');
	if (!basegame) throw new Error('the stand-in has no basegame scene');
	basegame.nodes.push({
		id: `fx-${effect.id}`,
		label: effect.name,
		kind: 'effect',
		effectId: effect.id,
		x: 718.11,
		y: 404,
	});
	return next;
};

const variants = {
	published: {
		bundle: { ...withNode(embers), effects: [embers], shaderEffects: [compiled.effect] },
		timed: true,
	},
	unregistered: { bundle: { ...withNode(embers), effects: [embers] }, timed: true },
	none: { bundle, timed: false },
	cap: {
		bundle: { ...withNode(swarm), effects: [swarm], shaderEffects: [compiled.effect] },
		timed: true,
	},
};

// 3. What a run reads off the page.
const STEP = 300;
const SAMPLES = 5;
const SAMPLE_EVERY = 60;
const WARM_UP = 10;
// The material meshes (and the quads they draw), the hidden sprite containers, and the particle
// sprites drawing as plain sprites (the coin frames' sprites with the library's particle fields,
// counted where they draw).
const probe = `(() => {
	const found = { meshes: 0, meshesDrawing: 0, quads: 0, containers: 0, sprites: 0, hiddenSprites: 0, plainSprites: 0 };
	const walk = (c, shown) => {
		const visible = shown && c.visible !== false;
		const fragment = c.shader?.glProgram?.fragment ?? '';
		if (/SHADER_NAME particle-material-custom-pulsetint/.test(fragment)) {
			found.meshes++;
			if (visible) {
				found.meshesDrawing++;
				found.quads += c.geometry.indexCount / 6;
			}
		}
		if (c.label === 'particle material sprites') {
			found.containers++;
			found.sprites += c.children.length;
			if (!c.visible) found.hiddenSprites += c.children.length;
		}
		if (visible && typeof c.agePercent === 'number' && c.config && c.texture) found.plainSprites++;
		for (const child of c.children ?? []) walk(child, visible);
	};
	walk(globalThis.__PIXI_APP__.stage, true);
	return found;
})()`;
const rendererProbe = `(() => {
	const r = globalThis.__PIXI_APP__.renderer;
	const gl = r.gl;
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	return {
		webgl: r.context.webGLVersion,
		gpu: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
	};
})()`;
// Each frame run and drawn alone, and waited on, on the page's real clock (the determinism clock is
// virtual). `__realNow` is kept before the runtime replaces `performance.now`. A one-pixel read waits
// for the GPU to finish the frame; Chromium's `gl.finish()` does not (it measured 1 ms frames with
// 3 s ones between).
const timing = (frames) => `(async () => {
	const api = window.__IE_DETERMINISM__;
	const gl = globalThis.__PIXI_APP__.renderer.gl;
	const ms = [];
	const pixel = new Uint8Array(4);
	for (let i = 0; i < ${WARM_UP + frames}; i++) {
		const began = window.__realNow();
		await api.step(1);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		if (i >= ${WARM_UP}) ms.push(window.__realNow() - began);
	}
	return ms;
})()`;
const pageSetup = (gl) =>
	[
		'window.__realNow = performance.now.bind(performance);',
		'window.__fxdebug = [];',
		'window.__failedRequests = [];',
		// The harness keeps console errors only, so the `?fxdebug=1` lines are kept on the page.
		`{ const log = console.log; console.log = (...a) => { const line = a.map(String).join(' '); if (line.startsWith('[fxdebug] material layer')) window.__fxdebug.push(line); log(...a); }; }`,
		`{ const f = window.fetch; window.fetch = (...a) => f(...a).catch((e) => { const r = a[0]; window.__failedRequests.push(String(r && r.url ? r.url : r)); throw e; }); }`,
		gl === 1
			? `{ const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : get.call(this, type, ...rest); }; }`
			: '',
	].join('\n');

const LINE = /^\[fxdebug\] material layer (\S+): (.*) \((custom:[^;]+); (\d+)\/(\d+) drawing\)$/;
const PEAK = /its peak ([\d.]+) ?(k|M)?px covered(?:, load ([\d.]+) ?(k|M)?)?/;
const UNIT = { k: 1e3, M: 1e6 };
const amountOf = (n, unit) => Number(n) * (UNIT[unit] ?? 1);

/** Each layer as its `?fxdebug=1` lines tell it: its state at mount, its peak and its load. */
function readLayers(lines) {
	const layers = {};
	for (const line of lines) {
		const m = LINE.exec(line);
		if (!m) continue;
		const [, label, state, kind, drawing, cap] = m;
		const layer = (layers[label] ??= {
			kind,
			mount: undefined,
			plainWhilePlaying: undefined,
			peakLines: 0,
		});
		const peak = PEAK.exec(state);
		if (peak) {
			layer.peakLines++;
			layer.peakCovered = amountOf(peak[1], peak[2]);
			if (peak[3] !== undefined) layer.peakLoad = amountOf(peak[3], peak[4]);
		} else if (state.startsWith('plain while playing, ')) {
			layer.plainWhilePlaying = state.slice('plain while playing, '.length);
		} else if (layer.mount === undefined) {
			layer.mount = state;
			layer.drawingAtMount = `${drawing}/${cap}`;
		}
	}
	for (const layer of Object.values(layers))
		if (layer.peakLoad !== undefined)
			layer.layerBudgetShare = layer.peakLoad / FX_MATERIAL_LAYER_LOAD_BUDGET;
	return layers;
}

function stats(ms) {
	const sorted = [...ms].sort((a, b) => a - b);
	const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
	const median = at(0.5);
	const round = (n) => Math.round(n * 10) / 10;
	return {
		frames: ms.length,
		medianMs: round(median),
		p95Ms: round(at(0.95)),
		maxMs: round(sorted[sorted.length - 1]),
		meanMs: round(ms.reduce((s, v) => s + v, 0) / ms.length),
		overTwiceMedian: ms.filter((v) => v > 2 * median).length,
	};
}

async function play(name, variant, gl) {
	const tag = `${name}-gl${gl}`;
	const dir = join(work, tag);
	cpSync(game.local.snapshot, dir, { recursive: true });
	writeFileSync(join(dir, 'runtime.json'), JSON.stringify(variant.bundle));
	const tree = testServerTree(
		join(work, `tree-${tag}`),
		opt.runtime,
		game.key,
		game.local.manifestEntry,
	);
	const server = await startTestServer(tree, { SEED: opt.seed });
	const snap = await serveSnapshot({
		dir,
		name: game.key,
		snapshotId: tag,
		assetBase: `${server.origin}/${game.key}/`,
	});
	const page = await openPage(headlessShell(opt.chrome), join(work, `profile-${tag}`));
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const run = { shot: null, samples: [] };
	try {
		const params = new URLSearchParams({
			runtime: '1',
			project: game.key,
			k: 'material-play',
			editorDocBase: snap.origin,
			rgs_url: `${server.origin}/api/${game.key}/authoring`.replace(/^http:\/\//, ''),
			sessionID: `material-${tag}-${Date.now()}`,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
			fxdebug: '1',
		});
		await page.page('Page.addScriptToEvaluateOnNewDocument', { source: pageSetup(gl) });
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
		run.renderer = await page.evaluate(rendererProbe);
		for (let i = 0; i < SAMPLES; i++) {
			if (i) await api(`step(${SAMPLE_EVERY}, { draw: 'last' })`);
			run.samples.push(await page.evaluate(probe));
		}
		// The page's own `?fxdebug=1` readout (what the owner reads on a phone), then hidden so the
		// screenshots compare the canvas alone.
		run.panel = await page.evaluate(
			`(() => { const p = document.getElementById(${JSON.stringify(FX_DEBUG_PANEL_ID)}); if (!p) return null; p.style.display = 'none'; return p.textContent; })()`,
		);
		await new Promise((r) => setTimeout(r, 200));
		run.shot = `${tag}.png`;
		writeFileSync(join(out, run.shot), await page.screenshot());
		if (opt.calibrate && variant.timed) run.frameTime = stats(await page.evaluate(timing(FRAMES)));
		run.state = await api('state()');
		run.fxdebug = await page.evaluate('window.__fxdebug');
		run.failedRequests = await page.evaluate('window.__failedRequests');
		run.console = page.consoleLines.filter((l) => /error/i.test(String(l)));
	} catch (e) {
		run.error = e instanceof Error ? e.message : String(e);
	} finally {
		await page.close();
		await snap.close();
		server.stop();
	}
	run.layers = readLayers(run.fxdebug ?? []);
	run.stage = run.samples[0];
	return run;
}

// 4. Play each, on each WebGL version.
const report = {
	snapshot: game.key,
	material: {
		kind: KIND,
		madeFor: compiled.effect.madeFor,
		cost: compiled.effect.cost,
		samples: compiled.effect.samples,
		padding: compiled.effect.padding,
	},
	budgets: {
		cost: PARTICLE_COST_BUDGET,
		samples: PARTICLE_SAMPLE_BUDGET,
		particles: FX_MATERIAL_PARTICLE_CAP,
		layerLoad: FX_MATERIAL_LAYER_LOAD_BUDGET,
		effectLoad: FX_MATERIAL_EFFECT_LOAD_BUDGET,
		layers: FX_MATERIAL_LAYER_CAP,
	},
	calibrate: opt.calibrate ? { frames: FRAMES, warmUp: WARM_UP } : false,
	gl: {},
};
const diff = (a, b) => {
	const [pa, pb] = [a, b].map((f) => PNG.sync.read(readFileSync(join(out, f))));
	return pixelmatch(pa.data, pb.data, null, pa.width, pa.height, { threshold: 0.05 });
};
for (const gl of GL_VERSIONS) {
	const runs = {};
	for (const [name, variant] of Object.entries(variants))
		runs[name] = await play(name, variant, gl);
	const { published, unregistered, none, cap } = runs;
	const pixels =
		published.error || unregistered.error || none.error
			? undefined
			: {
					publishedVsUnregistered: diff(published.shot, unregistered.shot),
					unregisteredVsNone: diff(unregistered.shot, none.shot),
				};
	const swarmLoad = Object.values(cap.layers).reduce((s, l) => s + (l.peakLoad ?? 0), 0);
	report.gl[`webgl${gl}`] = {
		runs,
		pixels,
		effectLoad: { embers: published.layers['embers/main']?.peakLoad, swarm: swarmLoad },
	};
}

// 5. The verdict. Typekit never loads in a container (docs/playtest/README.md); any other console
// error fails the run.
const KNOWN_CONSOLE = /Web font load inactive/;
const failures = [];
for (const [gl, { runs, pixels }] of Object.entries(report.gl)) {
	const version = Number(gl.slice('webgl'.length));
	const expect = (ok, what) => ok || failures.push(`WebGL${version} ${what}`);
	for (const [name, run] of Object.entries(runs)) {
		expect(!run.error, `${name}: ${run.error}`);
		expect(run.renderer?.webgl === version, `${name}: drew on WebGL${run.renderer?.webgl}`);
		expect(run.state?.errors === 0 && run.state?.stalls === 0, `${name}: errors or stalls`);
		expect(
			(run.console ?? []).every((line) => KNOWN_CONSOLE.test(line)),
			`${name}: console errors`,
		);
		const failed = run.failedRequests ?? [];
		if (failed.some((url) => /^https:\/\/127\.0\.0\.1:\d+\/api\//.test(url)))
			failures.push(
				`WebGL${version} ${name}: the game asked the test server over https: build the runtime with the release env (see the header)`,
			);
		else expect(failed.length === 0, `${name}: failed requests ${failed.join(', ')}`);
		for (const [label, layer] of Object.entries(run.layers))
			expect(!layer.plainWhilePlaying, `${name}: ${label} turned plain while playing`);
	}
	const { published, unregistered, none, cap } = runs;
	const main = published.layers['embers/main'];
	expect(
		published.samples.length === SAMPLES &&
			published.samples.every(
				(s) => s.meshesDrawing === 1 && s.sprites > 0 && s.hiddenSprites === s.sprites,
			),
		'published: the material mesh is not drawing, its particles hidden, at every sample',
	);
	expect(main?.mount === 'on', 'published: no `on` fxdebug line');
	expect(main?.peakLoad > 0, 'published: no peak line with a load');
	expect(
		main?.peakLines > 1,
		'published: the peak was printed once, at its first frame, and not as it grew and settled',
	);
	expect(
		main?.peakLoad > 0 &&
			Math.abs(main.peakLoad / (main.peakCovered * report.material.cost) - 1) < 0.01,
		'published: the load is not the covered pixels × the graph cost',
	);
	expect(
		published.panel?.includes(`WebGL${version} · `) &&
			/frames \(last 120\): [\d.]+ ms median/.test(published.panel) &&
			published.panel.includes('embers/main: on, its peak') &&
			unregistered.panel?.includes('embers/main: plain, not registered') &&
			cap.panel?.includes('swarm/m9: plain, over the game cap') &&
			none.panel === null,
		'the on-page readout does not show the GPU, the frame times and each layer (and only with a material)',
	);
	expect(unregistered.stage?.meshes === 0, 'unregistered: a material mesh is on the stage');
	expect(unregistered.stage?.plainSprites > 0, 'unregistered: no particle sprite draws');
	expect(
		unregistered.layers['embers/main']?.mount === 'plain, not registered',
		'unregistered: no `plain, not registered` fxdebug line',
	);
	expect(
		none.stage?.plainSprites === 0 && none.stage?.meshes === 0,
		'none: particles on the stage',
	);
	expect(pixels?.publishedVsUnregistered > 1000, 'the material changes fewer than 1,000 pixels');
	expect(pixels?.unregisteredVsNone > 1000, 'the plain particles draw fewer than 1,000 pixels');
	const mounts = Object.values(cap.layers).map((l) => l.mount);
	expect(
		mounts.length === CAP_LAYERS &&
			mounts.filter((m) => m === 'on').length === FX_MATERIAL_LAYER_CAP &&
			mounts.filter((m) => m === 'plain, over the game cap').length === 1,
		`cap: not ${FX_MATERIAL_LAYER_CAP} layers on and one plain, over the game cap`,
	);
	expect(
		cap.samples.length === SAMPLES &&
			cap.samples.every(
				(s) =>
					s.meshesDrawing === FX_MATERIAL_LAYER_CAP &&
					s.containers === FX_MATERIAL_LAYER_CAP &&
					s.hiddenSprites === s.sprites &&
					s.plainSprites > 0,
			),
		'cap: not eight meshes drawing and the ninth layer plain at every sample',
	);
}
report.verdict = failures.length ? { pass: false, failures } : { pass: true };

// 6. The summary.
const short = (n) =>
	n === undefined
		? '?'
		: n >= 1e6
			? `${(n / 1e6).toFixed(2)} M`
			: n >= 1e3
				? `${(n / 1e3).toFixed(1)} k`
				: String(Math.round(n));
const pct = (n, of) => (n === undefined ? '?' : `${((100 * n) / of).toFixed(1)} %`);
const timed = (run) =>
	run.frameTime
		? `; frame ${run.frameTime.medianMs} ms median, ${run.frameTime.p95Ms} p95, ${run.frameTime.maxMs} max, ${run.frameTime.overTwiceMedian} over 2× median`
		: '';
const lines = [
	`particle-material-play: ${report.verdict.pass ? 'PASS' : 'FAIL'}`,
	`material ${KIND}, made for particles: cost ${report.material.cost} of ${PARTICLE_COST_BUDGET}, ${report.material.samples} read(s) of ${PARTICLE_SAMPLE_BUDGET}`,
];
for (const [gl, { runs, effectLoad }] of Object.entries(report.gl)) {
	const { published, unregistered, cap } = runs;
	const main = published.layers['embers/main'] ?? {};
	const plain = Object.entries(cap.layers).filter(([, l]) => l.mount !== 'on');
	const largest = Math.max(0, ...Object.values(cap.layers).map((l) => l.peakLoad ?? 0));
	lines.push(
		`${gl.replace('webgl', 'WebGL')} (${published.renderer?.gpu ?? '?'})`,
		`  published     ${main.mount ?? '?'}; ${published.stage?.quads ?? '?'} quads; peak ${short(main.peakCovered)}px covered, load ${short(main.peakLoad)} (${pct(main.peakLoad, FX_MATERIAL_LAYER_LOAD_BUDGET)} of ${short(FX_MATERIAL_LAYER_LOAD_BUDGET)})${timed(published)}`,
		`  unregistered  ${unregistered.layers['embers/main']?.mount ?? '?'}; ${unregistered.stage?.plainSprites ?? '?'} sprites${timed(unregistered)}`,
		`  cap           ${CAP_LAYERS - plain.length} on, ${plain.map(([label, l]) => `${label} ${l.mount}`).join(', ') || 'none plain'}; ${cap.samples.map((s) => s.meshesDrawing).join('/')} meshes drawing over ${SAMPLES} samples; largest layer load ${short(largest)} (${pct(largest, FX_MATERIAL_LAYER_LOAD_BUDGET)}), effect load ${short(effectLoad.swarm)} (${pct(effectLoad.swarm, FX_MATERIAL_EFFECT_LOAD_BUDGET)} of ${short(FX_MATERIAL_EFFECT_LOAD_BUDGET)})${timed(cap)}`,
	);
}
for (const failure of report.verdict.failures ?? []) lines.push(`  FAIL ${failure}`);
const summary = lines.join('\n');
writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, '\t'));
writeFileSync(join(out, 'summary.txt'), `${summary}\n`);
console.log(summary);
process.exit(failures.length ? 1 : 0);
