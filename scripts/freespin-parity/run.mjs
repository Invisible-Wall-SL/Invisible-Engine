// The authored free-spin intro / outro vs the coded ones, frame for frame (Rive plan Phase 8c,
// docs/design/rive-style-editor.md §13.7.6). The twin of `scripts/win-parity/run.mjs`: boots the built
// `apps/lines` runtime in the headless shell on the harness's `cg-lines` stand-in snapshot — once as
// published (the coded `FreeSpinIntroVisual` / `FreeSpinOutroVisual` binds), once with
// `settings.authoredOverlays.freeSpins: true` in its layout doc (the built-in presentations, the coded
// outro driver, taps and holds unchanged) — with the committed reference flow (`?flowV2=lines`), the
// mock's `FORCE_TRIGGER=1` and one seed under the determinism clock. For each screen the frame BEFORE
// its show cue fired is the reference, the frames after the cue are compared under
// `scripts/current-games/tolerance.json`'s default, each coded frame must differ from the reference (the
// screen IS on screen), the player's tap lands on the same frame on both sides, and the hide cue must
// fire the same number of frames after the show cue (± 1).
//
// VARIANTS, each a coded/authored pair on the same inputs (`--variant` picks one; default all):
//   base        the intro (+6 … +180), the tap, the free spins, the outro through its count-up and
//               after it (+6 … +480), the tap.
//   slam        the outro's count-up slammed (Space 30 frames after `freeSpinOutroShow`; the screen
//               taps to skip): the total lands on the same frame on both sides.
//   retrigger   `FORCE_RETRIGGER=1`: the first free spin retriggers; the outro after it.
//   turbo       the base variant with turbo on at boot (`ie_turbo=1`).
// The positive control: the authored side mounts the two presentations (the probe's
// `presentations`), the coded side never does. No URL flag flips them: the authored side is a DOC
// with the flag set, served the way a published project is.
//
//   node scripts/freespin-parity/run.mjs [--build <dir>] [--chrome <exe>] [--out <dir>] [--seed <s>]
//                                        [--fresh] [--variant <name>]...

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
		out: { type: 'string', default: join(ROOT, '.cache/freespin-parity') },
		seed: { type: 'string', default: 'freespin-parity' },
		fresh: { type: 'boolean', default: false },
		variant: { type: 'string', multiple: true, default: [] },
	},
});
const out = resolve(opt.out);
const GAME = 'cg-lines';
const ON_SCREEN = 0.005;
const BOOT_PROBE_FRAMES = 10;
const BOOT_STOPPED = '[runtime] boot stopped — ';
const MAX_FRAMES_TO_SHOW = 12000;
const MAX_FRAMES_TO_HIDE = 6000;
const TAP_EVERY = 600;
const CUE_BATCH = 6;
const HIDE_BATCH = 10;
const PRESENTATIONS = ['freeSpinIntroPresentation', 'freeSpinOutroPresentation'];

const log = (line) => console.log(`[freespin-parity] ${line}`);

// ---- the variants ------------------------------------------------------------------------------------------

// Each screen: its show / hide cues, the offsets (frames after the show cue) to capture, the frame
// the player taps on (after the captures, the same on both sides), and an optional slam (Space at
// that offset, before the later captures).
const INTRO = {
	name: 'intro',
	show: 'freeSpinIntroShow',
	hide: 'freeSpinIntroHide',
	offsets: [6, 12, 24, 48, 96, 180],
	tapAt: 240,
};
const OUTRO = {
	name: 'outro',
	show: 'freeSpinOutroShow',
	hide: 'freeSpinOutroHide',
	offsets: [6, 12, 24, 48, 96, 240, 480],
	tapAt: 720,
};
const VARIANTS = {
	base: { env: { FORCE_TRIGGER: '1' }, screens: [INTRO, OUTRO] },
	slam: {
		env: { FORCE_TRIGGER: '1' },
		screens: [INTRO, { ...OUTRO, offsets: [6, 24, 36, 48, 96, 240], slamAt: 30 }],
	},
	retrigger: { env: { FORCE_TRIGGER: '1', FORCE_RETRIGGER: '1' }, screens: [INTRO, OUTRO] },
	turbo: { env: { FORCE_TRIGGER: '1' }, query: { ie_turbo: '1' }, screens: [INTRO, OUTRO] },
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
					`[freespin-parity] reusing the cached runtime at ${cached} — it may be stale; pass --fresh to rebuild`,
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
// The authored side: the SAME snapshot with the per-project flag set in its layout doc.
const flagged = (bundle) => ({
	...bundle,
	doc: {
		...bundle.doc,
		settings: {
			...(bundle.doc.settings ?? {}),
			authoredOverlays: { ...(bundle.doc.settings?.authoredOverlays ?? {}), freeSpins: true },
		},
	},
});
const authoredFile = join(out, 'runtime-authored.json');
writeFileSync(authoredFile, JSON.stringify(flagged(published)));

const chrome = headlessShell(opt.chrome);
const tolerance = toleranceFor(
	loadTolerance(join(ROOT, 'scripts/current-games/tolerance.json')),
	'lines',
	'freeSpins',
);

// ---- one side of one variant ---------------------------------------------------------------------------

async function play(name, variant, side) {
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
		bundleFile: side === 'authored' ? authoredFile : undefined,
		name: game.name,
		snapshotId: `${name}-${side}`,
		assetBase: `${server.origin}/${GAME}/`,
	});
	const profile = mkdtempSync(join(tmpdir(), 'fp-profile-'));
	const page = await openPage(chrome, profile);
	const result = { variant: name, side, screens: {}, mounted: [], error: undefined };
	try {
		const sid = `fp-${name}-${side}`;
		const rgs = `${server.origin}/api/${GAME}/authoring`;
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? GAME,
			k: 'freespin-parity',
			editorDocBase: snap.origin,
			rgs_url: rgs.replace(/^http:\/\//, ''),
			sessionID: sid,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
			flowV2: 'lines',
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
		const fired = (s, cue) => s.cues.filter((c) => c.cue === cue);
		const noteMounted = (s) => {
			for (const id of s.presentations ?? [])
				if (!result.mounted.includes(id)) result.mounted.push(id);
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
		let s = await state();
		let sinceTap = 0;
		for (const screen of variant.screens) {
			const rec = { showFrame: undefined, hideFrame: undefined, pre: undefined, captures: {} };
			result.screens[screen.name] = rec;
			// To the show cue: the screenshot taken BEFORE the batch the cue fired in is the reference.
			// A Space every TAP_EVERY frames walks past anything waiting on the player (the same frames
			// on both sides); it never lands near a capture, which starts at the cue.
			let before;
			for (let i = 0; !fired(s, screen.show).length && i < MAX_FRAMES_TO_SHOW; i += CUE_BATCH) {
				before = await page.screenshot();
				await step(CUE_BATCH);
				sinceTap += CUE_BATCH;
				s = await state();
				if (!fired(s, screen.show).length && sinceTap >= TAP_EVERY) {
					await space();
					sinceTap = 0;
					s = await state();
				}
			}
			if (!fired(s, screen.show).length)
				throw new Error(`${screen.show} never fired within ${MAX_FRAMES_TO_SHOW} frames`);
			rec.showFrame = fired(s, screen.show).at(-1).frame;
			rec.pre = join(dir, `${screen.name}-pre.png`);
			writeFileSync(rec.pre, before);
			let slammed = false;
			for (const offset of screen.offsets) {
				const target = rec.showFrame + offset;
				if (screen.slamAt !== undefined && !slammed && target > rec.showFrame + screen.slamAt) {
					if (s.frame < rec.showFrame + screen.slamAt)
						await step(rec.showFrame + screen.slamAt - s.frame);
					await space();
					slammed = true;
					s = await state();
				}
				if (s.frame < target) {
					await step(target - s.frame);
					s = await state();
				}
				noteMounted(s);
				const file = join(dir, `${screen.name}-t+${offset}.png`);
				writeFileSync(file, await page.screenshot());
				rec.captures[offset] = { file, frame: s.frame };
			}
			// The player's tap, then on to the hide (a tap every TAP_EVERY frames past any second hold).
			if (s.frame < rec.showFrame + screen.tapAt)
				await step(rec.showFrame + screen.tapAt - s.frame);
			await space();
			s = await state();
			for (
				let ran = 0;
				!fired(s, screen.hide).length && ran < MAX_FRAMES_TO_HIDE;
				ran += HIDE_BATCH
			) {
				await step(HIDE_BATCH);
				s = await state();
				if (ran > 0 && ran % TAP_EVERY === 0 && !fired(s, screen.hide).length) await space();
			}
			if (!fired(s, screen.hide).length)
				throw new Error(`${screen.hide} never fired within ${MAX_FRAMES_TO_HIDE} frames`);
			rec.hideFrame = fired(s, screen.hide).at(-1).frame;
			sinceTap = 0;
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
	log(`— ${name} —`);
	const coded = await play(name, variant, 'coded');
	const authored = await play(name, variant, 'authored');
	const entry = { coded, authored, screens: {} };
	report.variants[name] = entry;
	if (coded.error) fail(`${name}/coded: ${coded.error}`);
	if (authored.error) fail(`${name}/authored: ${authored.error}`);
	if (coded.error || authored.error) continue;
	if (coded.mounted.length) fail(`${name}: the coded side mounted ${coded.mounted.join(', ')}`);
	const missing = PRESENTATIONS.filter((id) => !authored.mounted.includes(id));
	if (missing.length) fail(`${name}: the authored side never mounted ${missing.join(', ')}`);
	else log(`✓ ${name}: the authored side mounted both presentations, the coded side neither`);
	for (const screen of variant.screens) {
		const a = coded.screens[screen.name];
		const b = authored.screens[screen.name];
		const label = `${name} ${screen.name}`;
		const row = { frames: [], hide: undefined };
		entry.screens[screen.name] = row;
		const reference = readFileSync(a.pre);
		for (const offset of screen.offsets) {
			const ca = readFileSync(a.captures[offset].file);
			const cb = readFileSync(b.captures[offset].file);
			const moved = compareScreens(reference, ca, tolerance);
			const movedLine = `${label} t+${String(offset).padStart(3)}: the coded frame differs from the pre-cue frame by ${(moved.diffRatio * 100).toFixed(2)}% (floor ${ON_SCREEN * 100}%)`;
			if (moved.diffRatio > ON_SCREEN) log(`✓ ${movedLine}`);
			else fail(`${movedLine} — nothing on screen`);
			const same = identical(ca, cb);
			const cmp = same
				? { pass: true, diffPixels: 0, diffRatio: 0, maxBlockRatio: 0 }
				: compareScreens(ca, cb, tolerance);
			if (cmp.diffPng)
				writeFileSync(join(out, name, `diff-${screen.name}-t+${offset}.png`), cmp.diffPng);
			row.frames.push({
				offset,
				onScreen: moved.diffRatio,
				pass: cmp.pass && moved.diffRatio > ON_SCREEN,
				diffPixels: cmp.diffPixels,
				diffRatio: cmp.diffRatio,
				maxBlockRatio: cmp.maxBlockRatio,
				reason: cmp.reason,
			});
			const line = `${label} t+${String(offset).padStart(3)} frames (${String(Math.round((offset / 60) * 1000)).padStart(5)} ms): ${cmp.pass ? '✓' : '✗'} ${cmp.diffPixels} px differ (${(cmp.diffRatio * 100).toFixed(4)}%)${cmp.reason ? ` — ${cmp.reason}` : ''}`;
			if (cmp.pass) log(line);
			else fail(line);
			if (cmp.heatmap) console.error(cmp.heatmap.join('\n'));
		}
		const codedSpan = a.hideFrame - a.showFrame;
		const authoredSpan = b.hideFrame - b.showFrame;
		row.hide = {
			coded: codedSpan,
			authored: authoredSpan,
			pass: Math.abs(codedSpan - authoredSpan) <= 1,
		};
		const hideLine = `${label}: ${screen.hide} fired ${codedSpan} frames after ${screen.show} on the coded side, ${authoredSpan} on the authored side`;
		if (row.hide.pass) log(`✓ ${hideLine}`);
		else fail(hideLine);
	}
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
log(`report → ${join(out, 'report.json')}`);
if (!report.pass) process.exit(1);
log('✅ the authored free-spin intro / outro match the coded ones');
