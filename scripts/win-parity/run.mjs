// The authored Win vs the coded one, frame for frame (Rive plan Phase 8b,
// docs/design/rive-style-editor.md §13.6.7). The twin of `scripts/transition-parity/run.mjs`: boots the
// built `apps/lines` runtime in the headless shell on the harness's `cg-lines` stand-in snapshot — once
// as published (the coded `bind:Win` composer), once with `settings.authoredOverlays.win: true` in its
// layout doc (the built-in `winPresentation` component and its generated tier timelines, the coded
// `WinGate` conducting them) — with the committed reference flow (`?flowV2=lines`, which fires the
// `winShow` / `winHide` cues around every win), the mock's `WIN_X` forcing and one seed under the
// determinism clock. Per win: the frame BEFORE the `winShow` cue fired is the reference (nothing of
// the win on screen yet), the frames after the cue are compared under `scripts/current-games/tolerance.json`'s
// default, each coded frame must differ from the reference (the presentation IS on screen), and the
// `winHide` cue must fire the same number of frames after `winShow` on both sides (± 1).
//
// VARIANTS, each a coded/authored pair on the same inputs (`--variant` picks one; default all):
//   base         WIN_X=10,20,40,70,120 — five consecutive base spins land one big tier each; the
//                intro (+12 +24 +48 +96) and the idle (+120 +240) of every tier.
//   slam-plain   the PLAIN-NUMBER presentation (no tier rig: the `winPlain` walk), Space 6 frames
//                after `winShow`. The Play4Fun facade every shipped game runs announces a win with
//                `setWin` only at a `big`-typed tier (`engineFacade.ts`, `isBigWinLevel`), so a
//                small / medium win never shows the overlay at all; the plain number is what a big
//                tier with no animation anywhere draws. The variant config strips the `big` row's
//                animation (`plainTier`) and WIN_X=10 deals it.
//   slam-big     WIN_X=10, Space 6 frames after `winShow`: ends on the same frame on both sides.
//   escalation   the snapshot's config with `escalateTiers: true` (the gate writes the variant as it
//                writes the flagged doc), WIN_X=120: the walk climbs the tiers; the authored side
//                reports PENDING cue holds while it climbs (the positive control), the coded none.
//   held         the escalation config and the reference flow with `holdToSpeedUp: true` authored on
//                its `winUpdate` (`flow-variant.ts`; no reference game authors it), the POINTER held
//                on the board from 30 frames after `winShow` until `winHide` (Space is the round's
//                slam key, which ends the win at the press): the coded ramp vs the authored play rate.
//   turbo        WIN_X=10 with turbo on at boot (`ie_turbo=1`, honoured with `ie_determinism` only).
//   placed       a `componentInstance(win)` placed at a moved position in a game-space scene (the
//                live Borut shape): the degrade applies, ONE presentation, where the author put it.
// Deterministic: a fixed seed, stepped frames, no wall clock. No URL flag flips the Win: the authored
// side is a DOC with the flag set, served the way a published project is.
//
//   node scripts/win-parity/run.mjs [--build <dir>] [--chrome <exe>] [--out <dir>] [--seed <s>]
//                                   [--fresh] [--variant <name>]...
//
// `--build` is a built `apps/lines` (default: the harness's `.cache/current-games/runtimes/working-tree`,
// built here when absent, reused with a warning when present, rebuilt with `--fresh`). Exit 1 on any
// difference; the captures and diffs stay under `<out>` for reading.

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
		out: { type: 'string', default: join(ROOT, '.cache/win-parity') },
		seed: { type: 'string', default: 'win-parity' },
		fresh: { type: 'boolean', default: false },
		variant: { type: 'string', multiple: true, default: [] },
	},
});
const out = resolve(opt.out);
const GAME = 'cg-lines';
const SHOW = 'winShow';
const HIDE = 'winHide';
const BIG_TIERS = ['big', 'superwin', 'mega', 'epic', 'max'];
const ON_SCREEN = 0.005;
const BOOT_PROBE_FRAMES = 10;
const BOOT_STOPPED = '[runtime] boot stopped — ';
const MAX_FRAMES_TO_SHOW = 3600;
const MAX_FRAMES_TO_HIDE = 9000;
const TAP_EVERY = 600;
const SLAM_AT = 6;
// The coded `FadeContainer`'s 400 ms fade-out: frames past `winHide` still on screen.
const FADE_FRAMES = 24;
// A hold starts once the count-up runs (`winUpdate` follows `winShow` by a beat), so the press is
// a hold on the count, not a tap on the cue.
const HOLD_AT = 30;
// Every `step` draws its last frame (software GL: ~100 ms), so the walk to a cue steps in batches:
// the probe records the frame each cue fired on, which keeps the anchors exact, and a batch
// smaller than the first capture offset (12) never overshoots one. The hide is only a frame.
const CUE_BATCH = 6;
const HIDE_BATCH = 20;
// Every spin is pressed on the same ABSOLUTE frame on both sides: the next multiple of this. The
// virtual clock adds 1000/60 ms a frame, so a frame's delta differs from the next in its last bits
// with the clock's magnitude, and whether a clip's summed deltas reach its length on its last frame
// or one later depends on the frame it started on. Two sides that boot a few frames apart (a CI
// runner's boot is not this machine's) would run the same walk on different deltas and hand off a
// frame apart — under a hold's play rate, within 30 frames of the press.
const PRESS_EVERY = 600;

const log = (line) => console.log(`[win-parity] ${line}`);

// ---- the variants ------------------------------------------------------------------------------------------

// `env` goes to the mock; `query` to the page URL; `config` patches the snapshot's game config
// (`plainTier` retypes that ladder row `big` with no animation); `place` moves the Win into a placed
// instance; `spins` is the list of wins to measure, each with the offsets (frames after `winShow`) to
// capture and an optional press (`slam` taps Space at `SLAM_AT`, `hold` presses the pointer at
// `HOLD_AT` and releases it after `winHide`).
const INTRO_AND_IDLE = [12, 24, 48, 96, 120, 240];
// The two fade-out residues the owner accepted on 2026-10-15 (design §13.6.11): per capture offset,
// the diff ratio a capture may reach when it fails the shared tolerance. escalation is the winning
// symbols' post-win pulse; held is the coded rewind running at the frozen hold speed. Any other
// capture, or a larger diff, still fails.
const ACCEPTED_FADE_OUT = {
	escalation: { 1956: 0.0025, 1966: 0.0025 },
	held: { 380: 0.02, 390: 0.11 },
};
const VARIANTS = {
	base: {
		env: { WIN_X: '10,20,40,70,120' },
		spins: BIG_TIERS.map((tier) => ({ tier, offsets: INTRO_AND_IDLE })),
	},
	'slam-plain': {
		env: { WIN_X: '10' },
		config: { plainTier: 'big' },
		spins: [{ tier: 'big', offsets: [12, 24, 48], press: 'slam' }],
	},
	'slam-big': {
		env: { WIN_X: '10' },
		spins: [{ tier: 'big', offsets: [12, 24, 48, 96], press: 'slam' }],
	},
	escalation: {
		env: { WIN_X: '120' },
		config: { escalateTiers: true },
		// +1956 / +1966: the hide's fade-out, where the coded walk rewinds to the first tier's intro.
		spins: [
			{
				tier: 'max',
				offsets: [12, 48, 120, 240, 840, 1680, 1956, 1966],
				expectHolds: true,
				accepted: ACCEPTED_FADE_OUT.escalation,
			},
		],
	},
	held: {
		env: { WIN_X: '120' },
		config: { escalateTiers: true },
		flow: 'holdToSpeedUp',
		// The hold ends the chain early (the count lands at the held speed, then the outro): the
		// presentation spans 375 frames, and +380 / +390 are inside the hide's fade-out, with the
		// pointer still held. `maxSpan` proves the hold engaged: unheld, the same win spans 1951.
		spins: [
			{
				tier: 'max',
				offsets: [60, 120, 240, 360, 374, 380, 390],
				press: 'hold',
				maxSpan: 900,
				accepted: ACCEPTED_FADE_OUT.held,
			},
		],
	},
	turbo: {
		env: { WIN_X: '10' },
		query: { ie_turbo: '1' },
		spins: [{ tier: 'big', offsets: INTRO_AND_IDLE }],
	},
	placed: {
		env: { WIN_X: '10,40' },
		place: true,
		spins: [
			{ tier: 'big', offsets: INTRO_AND_IDLE },
			{ tier: 'mega', offsets: [12, 120] },
		],
	},
};
const chosen = opt.variant.length ? opt.variant : Object.keys(VARIANTS);
for (const v of chosen)
	if (!VARIANTS[v]) throw new Error(`unknown variant ${v} (${Object.keys(VARIANTS).join(', ')})`);

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
					`[win-parity] reusing the cached runtime at ${cached} — it may be stale; pass --fresh to rebuild`,
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
if (!published.config) throw new Error(`the ${GAME} snapshot carries no game config`);
// The flow the `held` variant serves in the bundle instead of the `?flowV2=lines` opt-in: the same
// reference doc with hold-to-fast-forward authored on the win count-up (see `flow-variant.ts`).
const flowVariants = {};
if (chosen.some((v) => VARIANTS[v].flow)) {
	const file = join(out, 'flow-holdToSpeedUp.json');
	execFileSync(
		'pnpm',
		[
			'--filter',
			'launcher-api',
			'exec',
			'tsx',
			join(ROOT, 'scripts/win-parity/flow-variant.ts'),
			file,
		],
		{ cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
	);
	flowVariants.holdToSpeedUp = JSON.parse(readFileSync(file, 'utf8'));
}
const withFlow = (bundle, flow) => (flow ? { ...bundle, ...flowVariants[flow] } : bundle);

// The authored side: the SAME snapshot with the per-project flag set in its layout doc.
const flagged = (bundle) => ({
	...bundle,
	doc: {
		...bundle.doc,
		settings: { ...(bundle.doc.settings ?? {}), authoredOverlays: { win: true } },
	},
});
// A config variant (escalation): the snapshot's own config with the row set, as a project that
// authored it would publish.
const withConfig = (bundle, patch) => {
	if (!patch) return bundle;
	const { plainTier, ...rows } = patch;
	const config = { ...bundle.config, ...rows };
	if (plainTier) {
		if (!config.winLevels?.some((level) => level.alias === plainTier))
			throw new Error(`the ${GAME} ladder has no ${plainTier} row`);
		config.winLevels = config.winLevels.map((level) => {
			if (level.alias !== plainTier) return level;
			const plain = { ...level, type: 'big' };
			delete plain.animation;
			delete plain.spineKey;
			return plain;
		});
	}
	return { ...bundle, config };
};
// The placed-twin variant: the overlays scene keeps its coded node (the game degrades it to the
// gate) and a `win` instance sits at a moved position in a game-space scene, as the live Borut
// project places it. Natural size, where the author put it, on both sides.
const PLACED_SCENE = 'basegame';
const PLACED_NODE = {
	id: 'placed-win',
	label: 'Win (placed)',
	kind: 'componentInstance',
	componentId: 'win',
	x: 120,
	y: -40,
	params: {},
};
const placed = (bundle) => {
	const target = bundle.doc.scenes.find((sc) => sc.id === PLACED_SCENE);
	if (!target) throw new Error(`the ${GAME} doc lacks ${PLACED_SCENE}`);
	if ((target.space ?? 'game') !== 'game') throw new Error(`${PLACED_SCENE} is not game space`);
	return {
		...bundle,
		doc: {
			...bundle.doc,
			scenes: bundle.doc.scenes.map((sc) =>
				sc.id === PLACED_SCENE ? { ...sc, nodes: [...sc.nodes, PLACED_NODE] } : sc,
			),
		},
	};
};
const bundleFile = (name, bundle) => {
	const file = join(out, `runtime-${name}.json`);
	writeFileSync(file, JSON.stringify(bundle));
	return file;
};
const sidesOf = (name, variant) => {
	let base = withFlow(withConfig(published, variant.config), variant.flow);
	if (variant.place) base = placed(base);
	return {
		coded:
			variant.config || variant.place || variant.flow
				? bundleFile(`${name}-coded`, base)
				: undefined,
		authored: bundleFile(`${name}-authored`, flagged(base)),
	};
};

const chrome = headlessShell(opt.chrome);
const tolerance = toleranceFor(
	loadTolerance(join(ROOT, 'scripts/current-games/tolerance.json')),
	'lines',
	'win',
);

// ---- one side of one variant ---------------------------------------------------------------------------

async function play(name, variant, side, bundle) {
	const dir = join(out, name, side);
	mkdirSync(dir, { recursive: true });
	const tree = testServerTree(
		join(out, 'trees', `${name}-${side}`),
		build,
		GAME,
		game.local.manifestEntry,
	);
	const server = await startTestServer(tree, { SEED: opt.seed, ...variant.env });
	const snap = await serveSnapshot({
		dir: snapshotDir,
		bundleFile: bundle,
		name: game.name,
		snapshotId: `${name}-${side}`,
		assetBase: `${server.origin}/${GAME}/`,
	});
	const profile = mkdtempSync(join(tmpdir(), 'wp-profile-'));
	const page = await openPage(chrome, profile);
	const result = { variant: name, side, spins: [], error: undefined };
	try {
		const sid = `wp-${name}-${side}`;
		const rgs = `${server.origin}/api/${GAME}/authoring`;
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? GAME,
			k: 'win-parity',
			editorDocBase: snap.origin,
			rgs_url: rgs.replace(/^http:\/\//, ''),
			sessionID: sid,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
			// A variant that serves its flow in the bundle boots it the published way (no opt-in).
			...(variant.flow ? {} : { flowV2: 'lines' }),
			flowlog: '1',
			...(variant.query ?? {}),
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
		// The board centre of the 1280×720 viewport: the gate's canvas-wide hold surface.
		const pointer = (type) =>
			page.page('Input.dispatchMouseEvent', {
				type,
				x: 640,
				y: 360,
				button: 'left',
				buttons: type === 'mousePressed' ? 1 : 0,
				clickCount: 1,
			});
		const count = (s, cue) => s.cues.filter((c) => c.cue === cue).length;
		// Step until the n-th `cue` has fired; the probe's record says which frame, so a capture is
		// anchored on it exactly. The screenshot taken BEFORE the batch the cue fired in is the
		// pre-cue reference: the frame before anything of the win is on screen.
		const stepToCue = async (cue, n, max) => {
			let s = await state();
			let before;
			for (let i = 0; count(s, cue) < n && i < max; i += CUE_BATCH) {
				before = await page.screenshot();
				await step(CUE_BATCH);
				s = await state();
			}
			if (count(s, cue) < n) throw new Error(`${cue} #${n} never fired within ${max} frames`);
			return { s, before };
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
		// Step until idle, tapping past any hold every TAP_EVERY frames (the harness's `settle`).
		const settle = async () => {
			let settled = false;
			for (let ran = 0; ran < 7200 && !settled; ran += TAP_EVERY) {
				const r = await api(
					`waitFor(${JSON.stringify({ idle: true, maxFrames: TAP_EVERY, draw: 'last' })})`,
				);
				settled = Boolean(r.ok);
				if (!settled) await space();
			}
			if (!settled) throw new Error('the round never settled');
			await step(30);
			return state();
		};
		let shows = 0;
		let hides = 0;
		for (const [index, spin] of variant.spins.entries()) {
			const rec = {
				index,
				tier: spin.tier,
				pressFrame: undefined,
				showFrame: undefined,
				hideFrame: undefined,
				pre: undefined,
				captures: {},
				holds: {},
				winLevel: undefined,
			};
			result.spins.push(rec);
			const frame = (await state()).frame;
			rec.pressFrame = (Math.floor(frame / PRESS_EVERY) + 1) * PRESS_EVERY;
			await step(rec.pressFrame - frame);
			await space();
			await waitFor({ idle: false }, 600);
			let { s, before } = await stepToCue(SHOW, shows + 1, MAX_FRAMES_TO_SHOW);
			shows = count(s, SHOW);
			rec.showFrame = s.cues.filter((c) => c.cue === SHOW).at(-1).frame;
			const pre = join(dir, `spin${index}-pre.png`);
			writeFileSync(pre, before);
			rec.pre = pre;
			let held = false;
			const capture = async (offset) => {
				const file = join(dir, `spin${index}-t+${offset}.png`);
				writeFileSync(file, await page.screenshot());
				rec.captures[offset] = { file, frame: s.frame };
				rec.holds[offset] = s.holds ?? [];
			};
			for (const offset of spin.offsets) {
				const target = rec.showFrame + offset;
				const pressAt = rec.showFrame + (spin.press === 'hold' ? HOLD_AT : SLAM_AT);
				if (spin.press && !held && target > pressAt) {
					if (s.frame < pressAt) await step(pressAt - s.frame);
					if (spin.press === 'slam') await space();
					else await pointer('mousePressed');
					held = true;
					s = await state();
				}
				if (s.frame < target) {
					await step(target - s.frame);
					s = await state();
				}
				await capture(offset);
			}
			// Read after the captures: `winLevel` follows `winUpdate`, a beat after the cue.
			rec.winLevel = s.winLevel ?? null;
			// To the hide: tap past any press-to-continue every TAP_EVERY frames, the same frames on
			// both sides (a held pointer is released after the hide).
			for (let ran = 0; count(s, HIDE) <= hides && ran < MAX_FRAMES_TO_HIDE; ran += HIDE_BATCH) {
				await step(HIDE_BATCH);
				s = await state();
				if (ran > 0 && ran % TAP_EVERY === 0 && count(s, HIDE) <= hides && spin.press !== 'hold')
					await space();
			}
			if (count(s, HIDE) <= hides)
				throw new Error(`${HIDE} never fired within ${MAX_FRAMES_TO_HIDE} frames of ${SHOW}`);
			hides = count(s, HIDE);
			rec.hideFrame = s.cues.filter((c) => c.cue === HIDE).at(-1).frame;
			if (spin.press === 'hold') await pointer('mouseReleased');
			s = await settle();
		}
		const final = await page.evaluate(
			'window.__IE_DETERMINISM__ && { ...window.__IE_DETERMINISM__.state(), renderer: window.__PIXI_APP__?.renderer?.name }',
		);
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

// ---- every variant, both sides, then the comparison ----------------------------------------------------

const report = { build, seed: opt.seed, tolerance, variants: {}, pass: true };
const fail = (why) => {
	report.pass = false;
	console.error(`✗ ${why}`);
};
for (const name of chosen) {
	const variant = VARIANTS[name];
	const sides = sidesOf(name, variant);
	log(`— ${name} —`);
	const coded = await play(name, variant, 'coded', sides.coded);
	const authored = await play(name, variant, 'authored', sides.authored);
	const entry = { coded, authored, spins: [] };
	report.variants[name] = entry;
	if (coded.error) fail(`${name}/coded: ${coded.error}`);
	if (authored.error) fail(`${name}/authored: ${authored.error}`);
	if (coded.error || authored.error) continue;
	for (const [i, spin] of variant.spins.entries()) {
		const a = coded.spins[i];
		const b = authored.spins[i];
		const label = spin.tier
			? `${name} ${spin.tier}`
			: `${name} spin ${i} (${a.winLevel ?? 'no level'})`;
		const row = {
			tier: spin.tier,
			winLevel: [a.winLevel, b.winLevel],
			frames: [],
			hide: undefined,
			holds: undefined,
		};
		entry.spins.push(row);
		if (spin.tier && a.winLevel !== spin.tier)
			fail(`${label}: the coded side showed ${a.winLevel}, not ${spin.tier}`);
		if (a.winLevel !== b.winLevel)
			fail(`${label}: win levels differ (${a.winLevel} vs ${b.winLevel})`);
		// Equal inputs: both sides pressed the spin and saw the cue on the same absolute frame.
		if (a.pressFrame !== b.pressFrame || a.showFrame !== b.showFrame)
			fail(
				`${label}: the sides ran on different frames — pressed ${a.pressFrame} / ${b.pressFrame}, ${SHOW} ${a.showFrame} / ${b.showFrame} (coded / authored)`,
			);
		const codedSpan = a.hideFrame - a.showFrame;
		const authoredSpan = b.hideFrame - b.showFrame;
		// A press that never engaged passes every capture on both sides: the span says it did.
		if (spin.maxSpan !== undefined && Math.max(codedSpan, authoredSpan) > spin.maxSpan)
			fail(
				`${label}: the presentation spanned ${codedSpan} / ${authoredSpan} frames, over ${spin.maxSpan} — the hold never engaged`,
			);
		// A capture after the hide's fade-out compares two empty frames: the presentation must
		// outlast every capture (its 400 ms fade included) — except a slam, which ends it early by design; its proof is the hide on the same
		// frame (checked above) and every capture, before or after the hide, matching.
		const compared = spin.offsets;
		if (spin.press !== 'slam' && Math.max(...compared) >= codedSpan + FADE_FRAMES)
			fail(
				`${label}: the presentation ended ${codedSpan} frames after ${SHOW}, before the capture at t+${Math.max(...spin.offsets)}`,
			);
		const reference = readFileSync(a.pre);
		for (const offset of compared) {
			const ca = readFileSync(a.captures[offset].file);
			const cb = readFileSync(b.captures[offset].file);
			const moved = compareScreens(reference, ca, tolerance);
			const movedLine = `${label} t+${String(offset).padStart(4)}: the coded frame differs from the pre-cue frame by ${(moved.diffRatio * 100).toFixed(2)}% (floor ${ON_SCREEN * 100}%)`;
			if (moved.diffRatio > ON_SCREEN) log(`✓ ${movedLine}`);
			else fail(`${movedLine} — nothing on screen`);
			const same = identical(ca, cb);
			const cmp = same
				? { pass: true, diffPixels: 0, diffRatio: 0, maxBlockRatio: 0 }
				: compareScreens(ca, cb, tolerance);
			const ceiling = spin.accepted?.[offset];
			if (!cmp.pass && ceiling !== undefined && cmp.diffRatio <= ceiling) {
				cmp.pass = true;
				cmp.reason = `accepted fade-out residue (≤ ${(ceiling * 100).toFixed(2)}%, owner 2026-10-15)${cmp.reason ? `; ${cmp.reason}` : ''}`;
			}
			if (cmp.diffPng) writeFileSync(join(out, name, `diff-spin${i}-t+${offset}.png`), cmp.diffPng);
			row.frames.push({
				offset,
				onScreen: moved.diffRatio,
				pass: cmp.pass && moved.diffRatio > ON_SCREEN,
				diffPixels: cmp.diffPixels,
				diffRatio: cmp.diffRatio,
				maxBlockRatio: cmp.maxBlockRatio,
				reason: cmp.reason,
			});
			const line = `${label} t+${String(offset).padStart(4)} frames (${String(Math.round((offset / 60) * 1000)).padStart(5)} ms): ${cmp.pass ? '✓' : '✗'} ${cmp.diffPixels} px differ (${(cmp.diffRatio * 100).toFixed(4)}%)${cmp.reason ? ` — ${cmp.reason}` : ''}`;
			if (cmp.pass) log(line);
			else fail(line);
			if (cmp.heatmap) console.error(cmp.heatmap.join('\n'));
		}
		row.hide = {
			coded: codedSpan,
			authored: authoredSpan,
			pass: Math.abs(codedSpan - authoredSpan) <= 1,
		};
		const hideLine = `${label}: ${HIDE} fired ${codedSpan} frames after ${SHOW} on the coded side, ${authoredSpan} on the authored side`;
		if (row.hide.pass) log(`✓ ${hideLine}`);
		else fail(hideLine);
		// The positive control: while the authored walk runs, the authored instance HOLDS the tier
		// signal (the probe lists pending holds); the coded side never holds anything.
		const codedHeld = Object.values(a.holds).some((h) => h.length);
		const authoredHeld = Object.values(b.holds).some((h) => h.length);
		row.holds = { coded: codedHeld, authored: authoredHeld };
		if (codedHeld) fail(`${label}: the coded side reported a pending cue hold`);
		if (spin.expectHolds || (spin.tier && !spin.press)) {
			if (!authoredHeld) fail(`${label}: the authored side never reported a pending cue hold`);
			else log(`✓ ${label}: the authored side held its tier signal, the coded side held nothing`);
		}
	}
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
log(`report → ${join(out, 'report.json')}`);
if (!report.pass) process.exit(1);
log('✅ the authored Win matches the coded one');
