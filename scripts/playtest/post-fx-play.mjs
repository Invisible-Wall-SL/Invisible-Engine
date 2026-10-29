// Plays a published game whose doc carries POST FX (Invisible Shader Graph step 8e.3,
// docs/design/shader-graph-screens.md §6.5 and §15 step 3): the `cg-lines` stand-in snapshot of the
// current-games harness, its `settings.postFx` set as the Scene Editor saves them — a compiled graph
// (Pulse tint, embedded as a publish embeds it, in the bundle's `shaderEffects`) and the built-in
// Shine, both Always. The snapshot is served as the launcher serves it, the runtime is a build of
// this checkout, the RGS is the real test server.
//
// Three runs of the same snapshot: with the post FX, with them and `settings.stageFxAntialias`, and
// as it was (no post FX). Each records the stage's own filter list (each filter's program and
// anti-aliasing) and filter area, a screenshot at two moments, console errors and stalls. It PASSES
// (exit 0) when:
//  - with post FX: both programs are on the stage, in the entries' order, every one drawing without
//    MSAA, bounded to an area; with the setting: the same filters inheriting it;
//  - without: the stage has no filter and no area;
//  - the post FX change and move the picture, and no run has an error or a stall.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/post-fx-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]

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
const work = mkdtempSync(join(tmpdir(), 'post-fx-play-'));
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

// 2. The graph, compiled as the export compiles it; the post FX as the Scene Editor saves them.
const doc = REFERENCE_GRAPHS.find((d) => d.id === 'pulseTint');
const compiled = compileShaderEffect({ ...doc, id: 'pulsetint' });
if (!compiled.ok) throw new Error(`pulseTint does not compile: ${JSON.stringify(compiled.issues)}`);
const POST_FX = [
	{ id: 'grade', kind: 'custom:pulsetint', trigger: 'always' },
	{ id: 'sheen', kind: 'shine', trigger: 'always' },
];
const bundle = JSON.parse(readFileSync(join(game.local.snapshot, 'runtime.json'), 'utf8'));
const withPostFx = (extra) => ({
	...bundle,
	shaderEffects: [compiled.effect],
	doc: { ...bundle.doc, settings: { ...bundle.doc.settings, postFx: POST_FX, ...extra } },
});
const variants = {
	postFx: withPostFx({}),
	antialias: withPostFx({ stageFxAntialias: true }),
	none: bundle,
};

// 3. Play each.
const STEPS = [
	['a', 400],
	['b', 23],
];
const probe = `(() => {
	const stage = globalThis.__PIXI_APP__.stage;
	return {
		filters: (stage.filters ?? []).map((f) => ({
			program: /SHADER_NAME (\\S+)/.exec(f.glProgram?.fragment ?? '')?.[1] ?? f.glProgram?.name ?? '?',
			antialias: f.antialias,
		})),
		area: stage.filterArea ? { width: stage.filterArea.width, height: stage.filterArea.height } : null,
	};
})()`;

const report = { snapshot: game.key, postFx: POST_FX, runs: {} };
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
	const run = { shots: {}, stage: null, state: null };
	try {
		const params = new URLSearchParams({
			runtime: '1',
			project: game.key,
			k: 'post-fx-play',
			editorDocBase: snap.origin,
			rgs_url: `${server.origin}/api/${game.key}/authoring`.replace(/^http:\/\//, ''),
			sessionID: `post-fx-${name}-${Date.now()}`,
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
		run.stage = await page.evaluate(probe);
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

// 4. What the post FX changed.
const diff = (a, b) => {
	const [pa, pb] = [a, b].map((f) => PNG.sync.read(readFileSync(join(out, f))));
	return pixelmatch(pa.data, pb.data, null, pa.width, pa.height, { threshold: 0.05 });
};
const { postFx, antialias, none } = report.runs;
if (!postFx.error && !none.error) {
	report.pixels = {
		postFxVsNone: diff(postFx.shots.a, none.shots.a),
		postFxOverTime: diff(postFx.shots.a, postFx.shots.b),
		noneOverTime: diff(none.shots.a, none.shots.b),
	};
}

// 5. The verdict. A console error the run without post FX logs too is the container's (Typekit never
// loads in one, docs/playtest/README.md; a request to a host it cannot reach): any other fails.
const headOf = (line) => String(line).split('\n')[0];
const baseline = new Set((none.console ?? []).map(headOf));
const failures = [];
const expect = (ok, what) => ok || failures.push(what);
for (const [name, run] of Object.entries(report.runs)) {
	expect(!run.error, `${name}: ${run.error}`);
	expect(run.state?.errors === 0 && run.state?.stalls === 0, `${name}: errors or stalls`);
	const own = (run.console ?? []).map(headOf).filter((line) => !baseline.has(line));
	expect(!own.length, `${name}: console errors ${JSON.stringify(own)}`);
}
report.consoleBaseline = [...baseline];
const programs = (run) => (run.stage?.filters ?? []).map((f) => f.program);
const ordered = (run) => {
	const list = programs(run);
	const grade = list.findIndex((p) => p.startsWith('element-fx-custom-pulsetint'));
	const sheen = list.findIndex((p) => p.startsWith('element-fx-shine'));
	return grade >= 0 && sheen > grade;
};
for (const [name, run, antialiasOf] of [
	['postFx', postFx, 'off'],
	['antialias', antialias, 'inherit'],
]) {
	expect(ordered(run), `${name}: Pulse tint then Shine are not on the stage (${programs(run)})`);
	expect(
		(run.stage?.filters ?? []).every((f) => f.antialias === antialiasOf),
		`${name}: a stage filter's anti-aliasing is not ${antialiasOf}`,
	);
	expect(!!run.stage?.area, `${name}: the stage's filters have no area`);
}
expect(!none.stage?.filters.length && !none.stage?.area, 'none: the stage has a filter or an area');
const px = report.pixels ?? {};
expect(px.postFxVsNone > 1000, 'the post FX change fewer than 1,000 pixels');
expect(px.postFxOverTime > px.noneOverTime, 'the post FX do not move the picture');
report.verdict = failures.length ? { pass: false, failures } : { pass: true };

writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, '\t'));
console.log(JSON.stringify(report, null, '\t'));
process.exit(failures.length ? 1 : 0);
