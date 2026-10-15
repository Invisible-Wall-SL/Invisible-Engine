// The authored button vs the coded one, frame for frame (Rive plan Phase 8d,
// docs/design/rive-style-editor.md §13.8.8). The twin of `scripts/freespin-parity/run.mjs`: boots the
// built `apps/lines` runtime in the headless shell on the harness's `cg-lines` stand-in snapshot with its
// doc replaced by the `apps/lines` fallback shape (the parametric `HUD_BUTTON_INSTANCES` cluster) — once
// as published (the coded `ButtonFrame`), once with `settings.authoredOverlays.buttons: true` (the
// built-in `buttonPresentation` and its machine; the press road unchanged) — under the determinism clock,
// with REAL pointer events (CDP mouse input at the coded buttons' centres, the same on both sides).
// Every capture is compared under `scripts/current-games/tolerance.json`'s default; the press sounds
// (the probe's `uiEvents`) must match event for event and frame for frame.
//
// VARIANTS, each a coded/authored pair (`--variant` picks one; default all):
//   tile         the reference tile buttons: idle, hover, pressed (held), a press released away,
//                selected (turbo on), the spin press and the round it starts (the stop label, every
//                other button disabled grey) at +1 … +30 frames, then idle again.
//   images       the same on a doc whose buttons carry `image*` frames: the hover / pressed / selected
//                frames, the greyed resting frame, and the spin button's asymmetric spinning frame
//                TURNING over several frames.
//   flow         the tile script with the committed reference flow (`?flowV2=lines`): the HUD mounted
//                by the flow instead of the coded `<UI>`.
//   ui-fade      `WIN_X=120` (the `max` tier fires `uiHide` / `uiShow`): captures through the HUD's
//                fade-out and fade-in, both anchored on the event's frame.
//   turbo        the tile script with turbo on at boot (`ie_turbo=1`).
// The positive control: the authored side mounts `buttonPresentation` (the probe's
// `buttonPresentation`), the coded side never does.
//
//   node scripts/button-parity/run.mjs [--build <dir>] [--chrome <exe>] [--out <dir>] [--seed <s>]
//                                      [--fresh] [--variant <name>]...

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
		out: { type: 'string', default: join(ROOT, '.cache/button-parity') },
		seed: { type: 'string', default: 'button-parity' },
		fresh: { type: 'boolean', default: false },
		variant: { type: 'string', multiple: true, default: [] },
	},
});
const out = resolve(opt.out);
const GAME = 'cg-lines';
const BOOT_PROBE_FRAMES = 10;
const BOOT_STOPPED = '[runtime] boot stopped — ';
const MAX_ROUND_FRAMES = 4000;
const TAP_EVERY = 600;
/** The bottom-bar buttons, left to right on desktop (`referenceLayouts/hud.ts`); buy-bonus may hide. */
const BAR = ['menu', 'buyBonus', 'autoSpin', 'spin', 'turbo', 'decrease', 'increase'];
/** Somewhere over the board, far from every button: where a pointer goes to leave one. */
const AWAY = { x: 640, y: 240 };
const SPIN_OFFSETS = [1, 2, 4, 8, 16, 30];
const FADE_OFFSETS = [1, 6, 12, 18, 24, 30];

const log = (line) => console.log(`[button-parity] ${line}`);

const VARIANTS = {
	tile: { doc: 'tile', script: 'interact' },
	images: { doc: 'images', script: 'interact', statesVisible: true },
	flow: { doc: 'tile', script: 'interact', query: { flowV2: 'lines' } },
	'ui-fade': { doc: 'tile', script: 'uiFade', env: { WIN_X: '120' } },
	turbo: { doc: 'tile', script: 'interact', query: { ie_turbo: '1' } },
};
const chosen = opt.variant.length ? opt.variant : Object.keys(VARIANTS);
for (const v of chosen)
	if (!VARIANTS[v]) throw new Error(`unknown variant ${v} (${Object.keys(VARIANTS).join(', ')})`);

// ---- the runtime and the snapshots -------------------------------------------------------------------

const build = opt.build
	? resolve(opt.build)
	: (() => {
			const cached = join(ROOT, '.cache/current-games/runtimes/working-tree');
			if (opt.fresh || !existsSync(join(cached, 'index.html'))) {
				log('building the working-tree runtime (pnpm --filter lines build, release env)…');
				buildWorkingTree(ROOT, join(ROOT, '.cache/current-games'));
			} else {
				console.warn(
					`[button-parity] reusing the cached runtime at ${cached} — it may be stale; pass --fresh to rebuild`,
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
const tsNode = (script, args, stdio = ['ignore', 'ignore', 'inherit']) =>
	execFileSync(
		process.execPath,
		['--experimental-strip-types', '--import', './scripts/ts-loader.mjs', script, ...args],
		{ cwd: ROOT, stdio },
	);
log('writing the stand-in snapshot (scripts/current-games/fixtures.mjs)…');
tsNode('scripts/current-games/fixtures.mjs', ['--out', join(out, 'fixtures')]);
const game = JSON.parse(readFileSync(join(out, 'fixtures', 'games.json'), 'utf8')).games.find(
	(g) => g.key === GAME,
);
if (!game) throw new Error(`the fixtures carry no ${GAME}`);
const snapshotDir = game.local.snapshot;
const bundles = {};
for (const doc of ['tile', 'images']) {
	const coded = join(out, `runtime-${doc}-coded.json`);
	tsNode('scripts/button-parity/snapshot.mjs', [
		'--in',
		join(snapshotDir, 'runtime.json'),
		'--out',
		coded,
		...(doc === 'images' ? ['--images'] : []),
	]);
	const bundle = JSON.parse(readFileSync(coded, 'utf8'));
	const authored = join(out, `runtime-${doc}-authored.json`);
	writeFileSync(
		authored,
		JSON.stringify({
			...bundle,
			doc: {
				...bundle.doc,
				settings: {
					...(bundle.doc.settings ?? {}),
					authoredOverlays: { ...(bundle.doc.settings?.authoredOverlays ?? {}), buttons: true },
				},
			},
		}),
	);
	bundles[doc] = { coded, authored };
}

const chrome = headlessShell(opt.chrome);
const tolerance = toleranceFor(
	loadTolerance(join(ROOT, 'scripts/current-games/tolerance.json')),
	'lines',
	'buttons',
);

// ---- the in-page helpers --------------------------------------------------------------------------------

/** Every square pointer-cursor hit surface in the bottom band (a button), as global centres, left
 *  to right. */
const FIND_BUTTONS = `(() => {
	const app = window.__PIXI_APP__;
	const height = app.renderer.height / app.renderer.resolution;
	const found = [];
	const walk = (c) => {
		if (!c.visible) return;
		if (c.eventMode === 'static' && c.cursor === 'pointer') {
			const b = c.getBounds();
			const x = b.x + b.width / 2;
			const y = b.y + b.height / 2;
			if (b.width > 50 && b.width < 300 && Math.abs(b.width - b.height) < 10 && y > height * 0.6) found.push({ x, y, w: b.width, h: b.height });
		}
		for (const child of c.children ?? []) walk(child);
	};
	walk(app.stage);
	return found.sort((a, b) => a.x - b.x);
})()`;

// ---- one side of one variant ---------------------------------------------------------------------------

async function play(name, variant, side, aim) {
	const dir = join(out, name, side);
	mkdirSync(dir, { recursive: true });
	const tree = testServerTree(
		join(out, 'trees', `${name}-${side}`),
		build,
		GAME,
		game.local.manifestEntry,
	);
	const server = await startTestServer(tree, { SEED: opt.seed, ...(variant.env ?? {}) });
	const snap = await serveSnapshot({
		dir: snapshotDir,
		bundleFile: bundles[variant.doc][side],
		name: game.name,
		snapshotId: `${name}-${side}`,
		assetBase: `${server.origin}/${GAME}/`,
	});
	const profile = mkdtempSync(join(tmpdir(), 'bp-profile-'));
	const page = await openPage(chrome, profile);
	const result = {
		variant: name,
		side,
		captures: {},
		buttons: [],
		mounted: false,
		sounds: [],
		fades: {},
		error: undefined,
	};
	try {
		const sid = `bp-${name}-${side}`;
		const rgs = `${server.origin}/api/${GAME}/authoring`;
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? GAME,
			k: 'button-parity',
			editorDocBase: snap.origin,
			rgs_url: rgs.replace(/^http:\/\//, ''),
			sessionID: sid,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: opt.seed,
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
		const mouse = (type, at) =>
			page.page('Input.dispatchMouseEvent', {
				type,
				x: at.x,
				y: at.y,
				button: type === 'mouseMoved' ? 'none' : 'left',
				buttons: type === 'mousePressed' ? 1 : 0,
				clickCount: type === 'mouseMoved' ? 0 : 1,
				pointerType: 'mouse',
			});
		const capture = async (label) => {
			const s = await state();
			const file = join(dir, `${label}.png`);
			writeFileSync(file, await page.screenshot());
			result.captures[label] = { file, frame: s.frame };
			if (s.buttonPresentation) result.mounted = true;
		};
		const click = async (at) => {
			await mouse('mouseMoved', at);
			await step(2);
			await mouse('mousePressed', at);
			await step(2);
			await mouse('mouseReleased', at);
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
		await mouse('mouseMoved', AWAY);
		await step(30);
		result.buttons = await page.evaluate(FIND_BUTTONS);
		const at = aim ?? result.buttons;
		const named = Object.fromEntries(
			(at.length === BAR.length ? BAR : BAR.filter((b) => b !== 'buyBonus')).map((b, i) => [
				b,
				at[i],
			]),
		);
		if (!named.spin || !named.turbo)
			throw new Error(`expected the bar's buttons, found ${at.length}: ${JSON.stringify(at)}`);

		if (variant.script === 'interact') {
			await capture('idle');
			await mouse('mouseMoved', named.turbo);
			await step(4);
			await capture('hover');
			await mouse('mousePressed', named.turbo);
			await step(4);
			await capture('pressed');
			await mouse('mouseMoved', AWAY);
			await step(2);
			await mouse('mouseReleased', AWAY);
			await step(4);
			await capture('released-away');
			await click(named.turbo);
			await mouse('mouseMoved', AWAY);
			await step(4);
			await capture('selected');
			await click(named.turbo);
			await mouse('mouseMoved', AWAY);
			await step(4);
			await capture('deselected');
			// The spin press: the round starts; the pointer stays on the button (the STOP hover).
			await click(named.spin);
			let s = await state();
			const pressed = s.frame;
			for (const offset of SPIN_OFFSETS) {
				if (s.frame < pressed + offset) await step(pressed + offset - s.frame);
				await capture(`spin+${offset}`);
				s = await state();
			}
			await mouse('mouseMoved', AWAY);
			await step(2);
			await capture('spinning-away');
			for (let ran = 0; !(await state()).idle && ran < MAX_ROUND_FRAMES; ran += 10) {
				await step(10);
				if (ran > 0 && ran % TAP_EVERY === 0) await space();
			}
			await step(30);
			await capture('after');
		} else {
			// The UI fades: one spin whose `max` win hides the HUD, then shows it again.
			await space();
			const fadeAt = async (event, nth) => {
				let s = await state();
				for (
					let ran = 0;
					s.uiEvents.filter((e) => e.event === event).length < nth && ran < MAX_ROUND_FRAMES;
					ran++
				) {
					await step(1);
					s = await state();
					if (ran > 0 && ran % TAP_EVERY === 0) await space();
				}
				const hit = s.uiEvents.filter((e) => e.event === event)[nth - 1];
				if (!hit) throw new Error(`${event} never fired within ${MAX_ROUND_FRAMES} frames`);
				result.fades[event] = hit.frame;
				for (const offset of FADE_OFFSETS) {
					s = await state();
					if (s.frame < hit.frame + offset) await step(hit.frame + offset - s.frame);
					await capture(`${event}+${offset}`);
				}
			};
			await fadeAt('uiHide', 1);
			await fadeAt('uiShow', 1);
		}
		const final = await page.evaluate(
			'window.__IE_DETERMINISM__ && { ...window.__IE_DETERMINISM__.state(), renderer: window.__PIXI_APP__?.renderer?.name }',
		);
		result.sounds = (final?.uiEvents ?? []).filter((e) => e.event.startsWith('soundPress'));
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
	const authored = await play(name, variant, 'authored', coded.buttons);
	const entry = { coded, authored, frames: [] };
	report.variants[name] = entry;
	if (coded.error) fail(`${name}/coded: ${coded.error}`);
	if (authored.error) fail(`${name}/authored: ${authored.error}`);
	if (coded.error || authored.error) continue;
	if (coded.mounted) fail(`${name}: the coded side mounted buttonPresentation`);
	if (!authored.mounted) fail(`${name}: the authored side never mounted buttonPresentation`);
	else log(`✓ ${name}: the authored side mounted buttonPresentation, the coded side did not`);
	const moved =
		authored.buttons.length !== coded.buttons.length
			? ['count']
			: coded.buttons.filter(
					(b, i) => Math.hypot(b.x - authored.buttons[i].x, b.y - authored.buttons[i].y) > 3,
				);
	if (moved.length)
		fail(
			`${name}: the hit surfaces differ — coded ${JSON.stringify(coded.buttons)}, authored ${JSON.stringify(authored.buttons)}`,
		);
	// The interaction script presses turbo twice and spin once, the fade script spins: a recorder that
	// heard nothing must not pass as two empty lists that agree.
	const expected =
		variant.script === 'interact' ? ['soundPressGeneral', 'soundPressBet'] : ['soundPressBet'];
	const missingSound = expected.filter((e) => !coded.sounds.some((s) => s.event === e));
	if (missingSound.length) fail(`${name}: the coded side recorded no ${missingSound.join(', ')}`);
	const soundLine = (s) => s.map((e) => `${e.event}@${e.frame}`).join(', ') || 'none';
	if (soundLine(coded.sounds) !== soundLine(authored.sounds))
		fail(
			`${name}: press sounds differ — coded ${soundLine(coded.sounds)}; authored ${soundLine(authored.sounds)}`,
		);
	else log(`✓ ${name}: press sounds match (${soundLine(coded.sounds)})`);
	for (const event of Object.keys(coded.fades)) {
		if (coded.fades[event] !== authored.fades[event])
			fail(
				`${name}: ${event} fired on frame ${coded.fades[event]} coded, ${authored.fades[event]} authored`,
			);
		else log(`✓ ${name}: ${event} on frame ${coded.fades[event]} on both sides`);
	}
	const idle = coded.captures.idle ? readFileSync(coded.captures.idle.file) : undefined;
	for (const label of Object.keys(coded.captures)) {
		const a = coded.captures[label];
		const b = authored.captures[label];
		if (!b) {
			fail(`${name} ${label}: no authored capture`);
			continue;
		}
		if (a.frame !== b.frame)
			fail(`${name} ${label}: captured on frame ${a.frame} coded, ${b.frame} authored`);
		const ca = readFileSync(a.file);
		const cb = readFileSync(b.file);
		const same = identical(ca, cb);
		const cmp = same
			? { pass: true, diffPixels: 0, diffRatio: 0, maxBlockRatio: 0 }
			: compareScreens(ca, cb, tolerance);
		if (cmp.diffPng) writeFileSync(join(out, name, `diff-${label}.png`), cmp.diffPng);
		// What the state changed against idle (the state is ON screen): reported, and required for
		// the image doc's interaction states.
		const vsIdle =
			idle && label !== 'idle' ? compareScreens(idle, ca, tolerance).diffRatio : undefined;
		entry.frames.push({
			label,
			frame: a.frame,
			pass: cmp.pass,
			diffPixels: cmp.diffPixels,
			diffRatio: cmp.diffRatio,
			maxBlockRatio: cmp.maxBlockRatio,
			vsIdle,
			reason: cmp.reason,
		});
		const line = `${name} ${label.padEnd(14)} (frame ${a.frame}): ${cmp.pass ? '✓' : '✗'} ${cmp.diffPixels} px differ (${(cmp.diffRatio * 100).toFixed(4)}%)${vsIdle !== undefined ? ` · vs idle ${(vsIdle * 100).toFixed(3)}%` : ''}${cmp.reason ? ` — ${cmp.reason}` : ''}`;
		if (cmp.pass) log(line);
		else fail(line);
		if (cmp.heatmap) console.error(cmp.heatmap.join('\n'));
		if (
			variant.statesVisible &&
			['hover', 'pressed', 'selected', 'spin+8'].includes(label) &&
			!(vsIdle > 0)
		)
			fail(`${name} ${label}: the state is not on screen (identical to idle)`);
	}
	if (variant.statesVisible) {
		const turning = ['spin+4', 'spin+8', 'spin+16'].map((l) =>
			readFileSync(coded.captures[l].file),
		);
		if (identical(turning[0], turning[1]) || identical(turning[1], turning[2]))
			fail(`${name}: the spinning frame does not turn between +4, +8 and +16`);
		else log(`✓ ${name}: the spinning frame turns between +4, +8 and +16 on the coded side`);
	}
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
log(`report → ${join(out, 'report.json')}`);
if (!report.pass) process.exit(1);
log('✅ the authored buttons match the coded ones');
