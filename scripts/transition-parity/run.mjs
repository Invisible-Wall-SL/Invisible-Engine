// The authored Transition vs the coded one, frame for frame (Rive plan Phase 8a,
// docs/design/rive-style-editor.md §13.3). Boots the built `apps/lines` runtime twice in the headless
// shell on the harness's `cg-lines` stand-in snapshot — once as published (the coded `bind:Transition`
// wipe), once with `settings.authoredOverlays.transition: true` in its layout doc (the built-in
// `transitionWipe` component and its timeline) — with the committed reference book-of flow
// (`?flowV2=lines`, which fires the `transition` cue on free-spin entry), a forced scatter trigger
// and one seed under the determinism clock. Then:
//   - captures the frame the `transition` cue fires on (the reference: no wipe yet) and the frames
//     12, 24, 48, 72 and 96 frames later (200 / 400 / 800 / 1200 / 1600 ms at 60 fps) on both sides,
//     compares each pair under `scripts/current-games/tolerance.json`'s default (the harness's own
//     bar), and requires each coded frame to differ from the reference (the wipe IS on screen);
//   - reads the frame the NEXT cue (`freeSpinIntroShow`) fires on, on both sides: the point where the
//     flow continued, which must be the same frame (± 1).
// Both pairs run: the reference overlays scene as published, and a VARIANT with the Transition node
// moved into a flow container (`hudCorners`, canvas space, mounted by the flow), which proves the
// swap reaches the scenes the flow interpreters render, not only the overlays scene.
// Deterministic: a fixed seed, stepped frames, no wall clock. No URL flag flips the Transition: the
// authored side is a DOC with the flag set, served the way a published project is.
//
//   node scripts/transition-parity/run.mjs [--build <dir>] [--chrome <exe>] [--out <dir>] [--seed <s>] [--fresh]
//
// `--build` is a built `apps/lines` (default: the harness's `.cache/current-games/runtimes/working-tree`,
// built here when absent, reused with a warning when present, rebuilt with `--fresh` — `pnpm
// --filter lines build` with the release env). Exit 1 on any difference; the captures and diffs
// stay under `<out>` for reading.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { openPage } from '../current-games/lib/browser.mjs';
import {
	compareScreens,
	identical,
	loadTolerance,
	toleranceFor,
} from '../current-games/lib/compare.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { buildWorkingTree } from '../current-games/lib/runtimes.mjs';
import { headlessShell } from '../playtest/headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		build: { type: 'string' },
		chrome: { type: 'string' },
		out: { type: 'string', default: join(ROOT, '.cache/transition-parity') },
		seed: { type: 'string', default: 'transition-parity' },
		fresh: { type: 'boolean', default: false },
	},
});
const out = resolve(opt.out);
const GAME = 'cg-lines';
const CUE = 'transition';
const NEXT_CUE = 'freeSpinIntroShow';
// The cue frame is captured as the REFERENCE (no wipe yet on either side); the compared frames
// start off it, and each coded one must differ from the reference by more than `WIPE_ON_SCREEN`
// of the pixels, or the gate would pass two frames with no wipe on them.
const REFERENCE = 0;
const OFFSETS = [12, 24, 48, 72, 96];
const WIPE_ON_SCREEN = 0.005;
const BOOT_PROBE_FRAMES = 10;
const BOOT_STOPPED = '[runtime] boot stopped — ';
const MAX_FRAMES_TO_CUE = 3600;
const MAX_FRAMES_TO_NEXT = 1200;

const log = (line) => console.log(`[transition-parity] ${line}`);

// ---- the runtime and the snapshot ------------------------------------------------------------------

const build = opt.build
	? resolve(opt.build)
	: (() => {
			const cached = join(ROOT, '.cache/current-games/runtimes/working-tree');
			if (opt.fresh || !existsSync(join(cached, 'index.html'))) {
				log('building the working-tree runtime (pnpm --filter lines build, release env)…');
				buildWorkingTree(ROOT, join(ROOT, '.cache/current-games'));
			} else {
				console.warn(
					`[transition-parity] reusing the cached runtime at ${cached} — it may be stale; pass --fresh to rebuild`,
				);
			}
			return cached;
		})();
if (!existsSync(join(build, 'index.html'))) {
	console.error(`no built runtime at ${build}`);
	process.exit(2);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fixtures'), { recursive: true });
log('writing the stand-in snapshot (scripts/current-games/fixtures.mjs)…');
execFileSync(
	process.execPath,
	[
		'--experimental-strip-types',
		'--import',
		'./scripts/ts-loader.mjs',
		'scripts/current-games/fixtures.mjs',
		'--out',
		join(out, 'fixtures'),
	],
	{ cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
);
const game = JSON.parse(readFileSync(join(out, 'fixtures', 'games.json'), 'utf8')).games.find(
	(g) => g.key === GAME,
);
if (!game) throw new Error(`the fixtures carry no ${GAME}`);
const snapshotDir = game.local.snapshot;
const published = JSON.parse(readFileSync(join(snapshotDir, 'runtime.json'), 'utf8'));
// The authored side: the SAME snapshot with the per-project flag set in its layout doc.
const flagged = (bundle) => ({
	...bundle,
	doc: {
		...bundle.doc,
		settings: { ...(bundle.doc.settings ?? {}), authoredOverlays: { transition: true } },
	},
});
// The flow-container variant: the Transition node moved out of the overlays scene into
// `hudCorners`, a canvas-space screen the flow mounts (`<FlowV2Mount>`), so a swap that reached
// only the overlays scene would leave the coded node there.
const VARIANT_SCENE = 'hudCorners';
const inContainer = (bundle) => {
	const overlays = bundle.doc.scenes.find((sc) => sc.id === 'basegameOverlays');
	const node = overlays?.nodes.find((n) => n.bind?.component === 'Transition');
	const target = bundle.doc.scenes.find((sc) => sc.id === VARIANT_SCENE);
	if (!node || !target)
		throw new Error(`the ${GAME} doc lacks the Transition node or ${VARIANT_SCENE}`);
	if ((target.space ?? 'game') !== 'canvas')
		throw new Error(`${VARIANT_SCENE} is not canvas space`);
	return {
		...bundle,
		doc: {
			...bundle.doc,
			scenes: bundle.doc.scenes.map((sc) =>
				sc.id === 'basegameOverlays'
					? { ...sc, nodes: sc.nodes.filter((n) => n !== node) }
					: sc.id === VARIANT_SCENE
						? { ...sc, nodes: [...sc.nodes, node] }
						: sc,
			),
		},
	};
};
const bundleFile = (name, bundle) => {
	const file = join(out, `runtime-${name}.json`);
	writeFileSync(file, JSON.stringify(bundle));
	return file;
};
const SIDES = {
	coded: undefined,
	authored: bundleFile('authored', flagged(published)),
	'coded-container': bundleFile('coded-container', inContainer(published)),
	'authored-container': bundleFile('authored-container', flagged(inContainer(published))),
};
const PAIRS = [
	['coded', 'authored'],
	['coded-container', 'authored-container'],
];

const chrome = headlessShell(opt.chrome);
const tolerance = toleranceFor(
	loadTolerance(join(ROOT, 'scripts/current-games/tolerance.json')),
	'lines',
	'transition',
);

// ---- one side ------------------------------------------------------------------------------------------

async function play(side) {
	const dir = join(out, side);
	mkdirSync(dir, { recursive: true });
	const tree = testServerTree(join(out, 'trees', side), build, GAME, game.local.manifestEntry);
	const server = await startTestServer(tree, { SEED: opt.seed, FORCE_TRIGGER: '1' });
	const snap = await serveSnapshot({
		dir: snapshotDir,
		bundleFile: SIDES[side],
		name: game.name,
		snapshotId: side,
		assetBase: `${server.origin}/${GAME}/`,
	});
	const profile = mkdtempSync(join(tmpdir(), 'tp-profile-'));
	const page = await openPage(chrome, profile);
	const result = {
		side,
		captures: {},
		cueFrame: undefined,
		nextCueFrame: undefined,
		held: undefined,
		firedCue: undefined,
		error: undefined,
	};
	try {
		const sid = `tp-${side}`;
		const rgs = `${server.origin}/api/${GAME}/authoring`;
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? GAME,
			k: 'transition-parity',
			editorDocBase: snap.origin,
			rgs_url: rgs.replace(/^http:\/\//, ''),
			sessionID: sid,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
			flowV2: 'lines',
			// The flow's trace (`window.__IE_FLOW_V2_TRACE__`): the positive control below reads which
			// side HELD the cue. Logging only; both sides carry it, so the frames are not affected.
			flowlog: '1',
		});
		await page.navigate(`${server.origin}/${GAME}/?${params}`);
		let ready = false;
		for (let i = 0; i < 300 && !ready; i++) {
			ready = await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false);
			if (!ready) await new Promise((r) => setTimeout(r, 100));
		}
		if (!ready) throw new Error('the runtime never installed determinism mode');
		const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
		const state = () => api('state()');
		const step = (frames) => api(`step(${Number(frames)}, { draw: 'last' })`);
		const waitFor = async (until, maxFrames = 7200) => {
			const r = await api(`waitFor(${JSON.stringify({ ...until, maxFrames, draw: 'last' })})`);
			if (!r.ok)
				throw new Error(`not reached: ${JSON.stringify(until)} — ${JSON.stringify(r.state)}`);
			return r.state;
		};
		const space = async () => {
			await page.key('keyDown');
			await step(2);
			await page.key('keyUp');
		};
		await step(BOOT_PROBE_FRAMES);
		const stopped = page.consoleLines.find((l) => l.includes(BOOT_STOPPED));
		if (stopped)
			throw new Error(
				`the runtime refused to boot: ${stopped.slice(stopped.indexOf(BOOT_STOPPED) + BOOT_STOPPED.length)}`,
			);
		await waitFor({ loaded: true, idle: true });
		if (!(await state()).playerIn) await space();
		await waitFor({ playerIn: true, idle: true });
		await step(30);
		await space();
		await waitFor({ idle: false }, 600);
		// One frame at a time until the cue fires, so the capture is anchored on its frame.
		const cueFired = (s, cue) => s.cues.find((c) => c.cue === cue);
		let s = await state();
		for (let n = 0; !cueFired(s, CUE) && n < MAX_FRAMES_TO_CUE; n++) {
			await step(1);
			s = await state();
		}
		const fired = cueFired(s, CUE);
		if (!fired) throw new Error(`the ${CUE} cue never fired within ${MAX_FRAMES_TO_CUE} frames`);
		result.cueFrame = s.frame;
		for (const offset of [REFERENCE, ...OFFSETS]) {
			const target = result.cueFrame + offset;
			if (s.frame < target) {
				await step(target - s.frame);
				s = await state();
			}
			const file = join(dir, `t+${offset}.png`);
			writeFileSync(file, await page.screenshot());
			result.captures[offset] = { file, frame: s.frame, screens: s.screens };
		}
		for (let n = 0; !cueFired(s, NEXT_CUE) && n < MAX_FRAMES_TO_NEXT; n++) {
			await step(1);
			s = await state();
		}
		const next = cueFired(s, NEXT_CUE);
		if (!next)
			throw new Error(
				`the ${NEXT_CUE} cue never fired within ${MAX_FRAMES_TO_NEXT} frames of the wipe`,
			);
		result.nextCueFrame = s.frame;
		const final = await page.evaluate(
			'window.__IE_DETERMINISM__ && { ...window.__IE_DETERMINISM__.state(), renderer: window.__PIXI_APP__?.renderer?.name }',
		);
		// The positive control: the authored side's awaited `transition` must have been HELD by the
		// authored instance (the runtime traces `⏳ held by N`), the coded side's never — so a pass can
		// never be two coded wipes compared with each other.
		const trace = (await page.evaluate('window.__IE_FLOW_V2_TRACE__ ?? []')) ?? [];
		result.held = trace.some((l) => /^cue transition .*held by [1-9]/.test(l));
		result.firedCue = trace.some((l) => /^cue transition\b/.test(l));
		if (final?.renderer && final.renderer !== 'webgl')
			throw new Error(`rendered with Pixi's ${final.renderer} renderer, not WebGL`);
		if (final?.errors)
			result.error = `${final.errors} uncaught error(s): ${page.consoleLines.slice(-5).join(' | ')}`;
	} catch (e) {
		result.error = e.message;
	} finally {
		await page.close();
		server.stop();
		await snap.close();
		rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	}
	return result;
}

// ---- both, then the comparison ----------------------------------------------------------------------------

const results = {};
for (const side of Object.keys(SIDES)) results[side] = await play(side);
const report = { build, seed: opt.seed, tolerance, sides: results, pairs: [], pass: true };
const fail = (why) => {
	report.pass = false;
	console.error(`✗ ${why}`);
};
for (const r of Object.values(results)) if (r.error) fail(`${r.side}: ${r.error}`);
for (const [codedSide, authoredSide] of PAIRS) {
	const coded = results[codedSide];
	const authored = results[authoredSide];
	if (coded.error || authored.error) continue;
	const pair = { coded: codedSide, authored: authoredSide, frames: [], continues: undefined };
	report.pairs.push(pair);
	log(`— ${codedSide} vs ${authoredSide} —`);
	if (!coded.firedCue || !authored.firedCue)
		fail(`${codedSide}/${authoredSide}: the flow never traced the transition cue`);
	if (coded.held)
		fail(`${codedSide} held the cue: the authored path ran where the coded one should`);
	if (!authored.held)
		fail(`${authoredSide} did not hold the cue: the coded path ran where the authored one should`);
	if (!coded.held && authored.held) log('✓ the authored side held the cue, the coded side did not');
	const reference = readFileSync(coded.captures[REFERENCE].file);
	for (const offset of OFFSETS) {
		const a = readFileSync(coded.captures[offset].file);
		const b = readFileSync(authored.captures[offset].file);
		const moved = compareScreens(reference, a, tolerance);
		pair.frames.push({
			offset,
			kind: 'wipe-on-screen',
			diffRatio: moved.diffRatio,
			pass: moved.diffRatio > WIPE_ON_SCREEN,
		});
		const movedLine = `t+${String(offset).padStart(2)}: the coded frame differs from the cue frame by ${(moved.diffRatio * 100).toFixed(2)}% (floor ${WIPE_ON_SCREEN * 100}%)`;
		if (moved.diffRatio > WIPE_ON_SCREEN) log(`✓ ${movedLine}`);
		else fail(`${movedLine} — no wipe on screen`);
		const same = identical(a, b);
		const cmp = same
			? { pass: true, diffPixels: 0, diffRatio: 0, maxBlockRatio: 0 }
			: compareScreens(a, b, tolerance);
		if (cmp.diffPng) writeFileSync(join(out, `diff-${authoredSide}-t+${offset}.png`), cmp.diffPng);
		pair.frames.push({
			offset,
			kind: 'parity',
			ms: Math.round((offset / 60) * 1000),
			pass: cmp.pass,
			diffPixels: cmp.diffPixels,
			diffRatio: cmp.diffRatio,
			maxBlockRatio: cmp.maxBlockRatio,
			reason: cmp.reason,
		});
		const line = `t+${String(offset).padStart(2)} frames (${String(Math.round((offset / 60) * 1000)).padStart(4)} ms): ${cmp.pass ? '✓' : '✗'} ${cmp.diffPixels} px differ (${(cmp.diffRatio * 100).toFixed(4)}%)${cmp.reason ? ` — ${cmp.reason}` : ''}`;
		if (cmp.pass) log(line);
		else fail(line);
		if (cmp.heatmap) console.error(cmp.heatmap.join('\n'));
	}
	const codedSpan = coded.nextCueFrame - coded.cueFrame;
	const authoredSpan = authored.nextCueFrame - authored.cueFrame;
	pair.continues = {
		coded: codedSpan,
		authored: authoredSpan,
		pass: Math.abs(codedSpan - authoredSpan) <= 1,
	};
	const line = `the flow continued (${NEXT_CUE}) ${codedSpan} frames after the cue on the coded side, ${authoredSpan} on the authored side`;
	if (pair.continues.pass) log(`✓ ${line}`);
	else fail(line);
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
log(`report → ${join(out, 'report.json')}`);
if (!report.pass) process.exit(1);
log('✅ the authored Transition matches the coded one');
