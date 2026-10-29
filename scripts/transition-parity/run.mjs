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
// Three pairs run: the reference overlays scene as published, a VARIANT with the Transition node
// moved into a flow container (`hudCorners`, canvas space, mounted by the flow), which proves the
// swap reaches the scenes the flow interpreters render, not only the overlays scene, and the same
// book with turbo on at boot (`ie_turbo=1`), under which measured waits are halved.
// A fourth set proves the `transition` cue's screen transition (Invisible Shader Graph 8e,
// docs/design/shader-graph-screens.md §9.2, §15 step 4): the doc's `settings.transitionCue` names a
// compiled crossfade that reads both screens (`screenEffects.mts`), shipped in the bundle's
// `shaderEffects`. On that side the flow goes on within 2 frames of the cue (the cue resolves once
// the old screen is frozen, not after the wipe), the shell filter is on the stage, every captured
// frame differs from the cue frame, the frames travel from the old screen to the new one, and no
// frame is darker than both screens at any pixel — the two screens read off two more sides that
// play the crossfade's halves alone (From: the frozen old screen, checked frozen and not blank; To:
// the live new one) on the same frames, all three drawing every frame. With the row's graph left
// out of `shaderEffects` the row is unplayable, and every frame is pixel-identical to the
// published wipe.
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

import { PNG } from 'pngjs';

import { openPage } from '../current-games/lib/browser.mjs';
import {
	compareScreens,
	identical,
	loadTolerance,
	toleranceFor,
} from '../current-games/lib/compare.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { buildWorkingTree, runtimeDirFor } from '../current-games/lib/runtimes.mjs';
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
			if (opt.fresh || !existsSync(join(runtimeDirFor(cached, 'lines'), 'index.html'))) {
				log('building the working-tree runtime (pnpm --filter lines build, release env)…');
				buildWorkingTree(ROOT, join(ROOT, '.cache/current-games'), ['lines']);
			} else {
				console.warn(
					`[transition-parity] reusing the cached runtime at ${cached} — it may be stale; pass --fresh to rebuild`,
				);
			}
			return runtimeDirFor(cached, 'lines');
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
// The transition cue row: its compiled effects, and a bundle naming one of them (or, `effects`
// empty, naming one it does not ship).
const SCREEN_EFFECTS = JSON.parse(
	execFileSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--import',
			'./scripts/ts-loader.mjs',
			'scripts/transition-parity/screenEffects.mts',
		],
		{ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
	),
);
const SCREEN_MS = 2000;
const withCue = (bundle, kind, effects) => ({
	...bundle,
	doc: {
		...bundle.doc,
		settings: { ...(bundle.doc.settings ?? {}), transitionCue: { kind, durationMs: SCREEN_MS } },
	},
	shaderEffects: [...(bundle.shaderEffects ?? []), ...effects],
});
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
	'coded-turbo': undefined,
	'authored-turbo': bundleFile('authored-turbo', flagged(published)),
	screen: bundleFile('screen', withCue(published, 'custom:tp-crossfade', SCREEN_EFFECTS)),
	'screen-from': bundleFile('screen-from', withCue(published, 'custom:tp-from', SCREEN_EFFECTS)),
	'screen-to': bundleFile('screen-to', withCue(published, 'custom:tp-to', SCREEN_EFFECTS)),
	'screen-missing': bundleFile('screen-missing', withCue(published, 'custom:tp-crossfade', [])),
};
// The row's sides draw every frame: the still is a render to a texture, and under `draw: 'last'`
// the determinism clock skips every render but the last, so a still taken between would be blank.
// Each comparison stays within one mode: the row's sides with each other, `screen-missing` (no
// still) with the published wipe.
const DRAW = { screen: 'every', 'screen-from': 'every', 'screen-to': 'every' };
// The flow goes on this soon after the cue under the row (the frame the still is taken on, ± 1).
const SCREEN_CONTINUES_WITHIN = 2;
// The still is the screen a frame after the cue frame: the backdrop's own animation moves this
// much of it, where a blank still is ~90% off.
const STILL_NEAR_CUE = 0.1;
// A channel value this far below both screens' counts as darker (8-bit steps, the screen-fx bar).
const DARKER_STEP = 2;
// The turbo variant (Rive plan Phase 8b, condition 1): the same book with turbo on at boot
// (`ie_turbo=1`, honoured with `ie_determinism` only). The runtime divides measured cue waits by
// `timeScale`; the rigs ride the ticker, so the wipe must track the coded one here too.
const QUERY = { 'coded-turbo': { ie_turbo: '1' }, 'authored-turbo': { ie_turbo: '1' } };
const PAIRS = [
	['coded', 'authored'],
	['coded-container', 'authored-container'],
	['coded-turbo', 'authored-turbo'],
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
			...(QUERY[side] ?? {}),
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
		const step = (frames) => api(`step(${Number(frames)}, { draw: '${DRAW[side] ?? 'last'}' })`);
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
			const stageFilters = await page.evaluate('window.__PIXI_APP__?.stage?.filters?.length ?? 0');
			result.captures[offset] = { file, frame: s.frame, screens: s.screens, stageFilters };
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
		// The frame it fired on, which under the cue row comes before the last capture.
		result.nextCueFrame = next.frame;
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

// ---- the transition cue row --------------------------------------------------------------------------------

const cueRow = ['screen', 'screen-from', 'screen-to', 'screen-missing'].map(
	(side) => results[side],
);
if (!results.coded.error && cueRow.every((r) => !r.error)) {
	const [screen, from, to, missing] = cueRow;
	const coded = results.coded;
	const row = { screen: [], missing: [], continues: undefined, pass: true };
	report.pairs.push({ cueRow: row });
	const check = (ok, line) => {
		if (ok) log(`✓ ${line}`);
		else {
			row.pass = false;
			fail(line);
		}
	};
	log('— the transition cue row —');
	const span = screen.nextCueFrame - screen.cueFrame;
	row.continues = span;
	check(
		span <= SCREEN_CONTINUES_WITHIN,
		`the flow continued (${NEXT_CUE}) ${span} frames after the cue (within ${SCREEN_CONTINUES_WITHIN}; the wipe took ${coded.nextCueFrame - coded.cueFrame})`,
	);
	check(
		[from, to].every((r) => r.cueFrame === screen.cueFrame),
		`the From and To sides reach the cue on the same frame (${[screen, from, to].map((r) => r.cueFrame).join(' / ')})`,
	);
	check(
		OFFSETS.every((offset) => screen.captures[offset].stageFilters > 0),
		`the shell filter is on the stage at every captured frame (${OFFSETS.map((o) => screen.captures[o].stageFilters).join(' ')})`,
	);
	// The two screens: From holds the frozen old screen (one still, so every capture is the same
	// image, and it is the cue frame's screen a frame later: close to it, never blank); To is the
	// live new screen.
	const png = (r, offset) => readFileSync(r.captures[offset].file);
	const reference = png(screen, REFERENCE);
	const still = compareScreens(reference, png(from, OFFSETS[0]), tolerance);
	check(
		still.diffRatio < STILL_NEAR_CUE,
		`Screens → From is the old screen: ${(still.diffRatio * 100).toFixed(2)}% off the cue frame, one frame earlier (under ${STILL_NEAR_CUE * 100}%)`,
	);
	check(
		OFFSETS.every((offset) => identical(png(from, OFFSETS[0]), png(from, offset))),
		'Screens → From is frozen: the same image at every captured frame',
	);
	for (const offset of OFFSETS) {
		const frame = png(screen, offset);
		const at = `t+${String(offset).padStart(2)}`;
		const moved = compareScreens(reference, frame, tolerance).diffRatio;
		const fromOld = compareScreens(png(from, offset), frame, tolerance).diffRatio;
		const fromNew = compareScreens(png(to, offset), frame, tolerance).diffRatio;
		const a = PNG.sync.read(frame).data;
		const old = PNG.sync.read(png(from, offset)).data;
		const now = PNG.sync.read(png(to, offset)).data;
		let darker = 0;
		for (let i = 0; i < a.length; i++)
			if ((i & 3) !== 3 && a[i] < Math.min(old[i], now[i]) - DARKER_STEP) darker++;
		row.screen.push({ offset, diffRatio: moved, fromOld, fromNew, darker });
		check(
			moved > WIPE_ON_SCREEN,
			`${at}: differs from the cue frame by ${(moved * 100).toFixed(2)}% (floor ${WIPE_ON_SCREEN * 100}%)`,
		);
		check(darker === 0, `${at}: ${darker} values darker than both screens`);
	}
	// …and it travels from one to the other: off the old screen more at each capture, off the new
	// one less (a frame that stays on either screen fails this).
	const series = (key) => row.screen.map((f) => f[key]);
	const rising = (list) => list.every((v, i) => i === 0 || v >= list[i - 1]);
	const percent = (list) => list.map((v) => (v * 100).toFixed(2)).join(' → ');
	check(
		rising(series('fromOld')) && series('fromOld').at(-1) > WIPE_ON_SCREEN,
		`it leaves the old screen: ${percent(series('fromOld'))}% off it`,
	);
	check(
		rising(series('fromNew').toReversed()) && series('fromNew')[0] > WIPE_ON_SCREEN,
		`it reaches the new screen: ${percent(series('fromNew'))}% off it`,
	);
	check(
		!missing.held && !coded.held,
		'the row left unplayable holds the cue as published (no instance)',
	);
	for (const offset of [REFERENCE, ...OFFSETS]) {
		const same = identical(
			readFileSync(coded.captures[offset].file),
			readFileSync(missing.captures[offset].file),
		);
		row.missing.push({ offset, identical: same });
		check(
			same,
			`t+${String(offset).padStart(2)}: the row with its graph left out is pixel-identical to the published wipe`,
		);
	}
	check(
		missing.nextCueFrame - missing.cueFrame === coded.nextCueFrame - coded.cueFrame &&
			missing.cueFrame === coded.cueFrame,
		`…and the flow continues on the same frame (${missing.nextCueFrame - missing.cueFrame} / ${coded.nextCueFrame - coded.cueFrame})`,
	);
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
log(`report → ${join(out, 'report.json')}`);
if (!report.pass) process.exit(1);
log(
	'✅ the authored Transition matches the coded one; the transition cue row plays its screen transition',
);
