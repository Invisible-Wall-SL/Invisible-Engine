#!/usr/bin/env node
/**
 * FX PLAYBACK PAGE — the `/fx` preview keeps showing the WHOLE effect, every layer together, in the
 * real page played headless (`fxPage/entry.ts`; see `fxPage.mjs`).
 *
 * The stage's particles are read off its Pixi scene (`fxPage.apps`): a particle is a node with an
 * `emitter`, a `maxLife` and an `agePercent`, SHOWING when it is on stage, visible, renderable and
 * not fully transparent. Its emitters are `fxPage.emitters`.
 *
 * A. Looping layers (`?bake=1`: two continuous emitters): both show on open, long past one particle
 *    lifetime, after an edit to one of them, and after pause and play.
 * Every check runs on the stage's own ticker (`playDrive.onTicks`), not on a wall-clock sleep: an
 * action fires inside a tick, time is the ticker's `deltaMS` (what the stage's burst loop counts) and
 * a census is read right after the stage's update, so a loaded runner only makes the gate slower.
 *
 * B. One-shot layers (`?bursts=1`: three bursts over a continuous layer). The owner's report
 *    (2026-11-03): a burst played once on load and never again, and an edit re-fired only the
 *    edited layer, so the effect could not be seen whole. Now:
 *    1. every layer shows on open;
 *    2. long after the first bursts died, the bursts fire again, all together (looping);
 *    3. an edit to one burst re-fires every burst with it;
 *    4. ⟲ Replay restarts every layer from its start together;
 *    5. paused, the bursts do not re-fire.
 *
 *   pnpm --filter fx-spike fx-playback-page [--keep <dir>]
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { buildLauncherPage } from './launcherPage.mjs';

const keepAt = process.argv.includes('--keep')
	? resolve(process.argv[process.argv.indexOf('--keep') + 1])
	: undefined;
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'fx-playback-page-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** In-page: the stage's particles per emitter, the controls an author touches, and its ticker. */
const DRIVER = `(() => {
	const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
	const stageApp = () => {
		const canvas = document.querySelector('.stage canvas');
		return fxPage.apps.find((a) => a.canvas === canvas);
	};
	window.playDrive = {
		allShow: (c, n) => !!c && c.length === n && c.every((r) => r.showing > 0),
		bursts: (c) => (c ?? []).filter((r) => r.burst),
		burstsShow(c) {
			const b = playDrive.bursts(c);
			return b.length === 3 && b.every((r) => r.showing > 0);
		},
		/** Per live emitter, in creation order: particles on stage, how many show, the oldest age. */
		census() {
			const app = stageApp();
			if (!app) return null;
			const rows = new Map(fxPage.emitters.filter((e) => e.parent).map((e) => [e, {
				live: 0, showing: 0, oldest: 0, burst: e.emitterLifetime > 0,
			}]));
			const walk = (n, shown) => {
				const showing = shown && n.visible && n.renderable && n.alpha > 0;
				if (n.emitter && 'maxLife' in n && 'agePercent' in n) {
					const row = rows.get(n.emitter);
					if (row) {
						row.live++;
						if (showing) row.showing++;
						row.oldest = Math.max(row.oldest, n.age);
					}
				}
				for (const c of n.children ?? []) walk(c, showing);
			};
			walk(app.stage, true);
			return [...rows.values()];
		},
		pick(name) {
			const b = [...document.querySelectorAll('button.pick')].find((x) => x.textContent.includes(name));
			if (!b) throw new Error('no layer ' + name);
			b.click();
		},
		slide(label, value) {
			const row = [...document.querySelectorAll('.inspector .row')].find(
				(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
			const el = row?.querySelector('input[type=range]');
			if (!el) throw new Error('no slider ' + label);
			el.value = String(value); fire(el, 'input');
		},
		button(text) {
			const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
			if (!b) throw new Error('no button ' + text);
			b.click();
		},
		/**
		 * Run on the stage's ticker, after the stage's own update (a listener added later runs
		 * later). Once ms of ticker time (the deltaMS the stage advances by) has passed, each tick
		 * reads the census; at the first tick where until(census, elapsed) holds, act(census) runs in
		 * that same tick and the call resolves { ok: true, census, ms, value: act's result }. With
		 * once, only that first due tick is read. Not ok after timeout wall-clock ms, ticking or not
		 * (under the 30 s a page evaluate is given, so a stuck wait fails by its check's name).
		 */
		onTicks({ ms = 0, until = () => true, act, once = false, timeout = 20000 } = {}) {
			const app = stageApp();
			if (!app) return Promise.reject(new Error('no stage'));
			return new Promise((resolve, reject) => {
				let elapsed = 0;
				let last = null;
				const done = (result) => {
					app.ticker.remove(tick);
					clearTimeout(timer);
					resolve(result);
				};
				const timer = setTimeout(() => done({ ok: false, census: last, ms: elapsed }), timeout);
				const tick = (t) => {
					elapsed += t.deltaMS;
					if (elapsed < ms) return;
					try {
						last = playDrive.census();
						if (until(last, elapsed)) {
							const value = act?.(last);
							return done({ ok: true, census: last, ms: elapsed, value });
						}
						if (once) done({ ok: false, census: last, ms: elapsed });
					} catch (err) {
						app.ticker.remove(tick);
						clearTimeout(timer);
						reject(err);
					}
				};
				app.ticker.add(tick);
			});
		},
	};
})()`;

async function open(browser, html, query) {
	await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?${query}` });
	const ev = (expr) => browser.evaluate(expr);
	await browser.waitFor(`!!document.querySelector('.stage canvas') && !!window.fxPage`, 30_000);
	await ev(DRIVER);
	return ev;
}

const describe = (c) => (c ? c.map((r) => `${r.showing}/${r.live}`).join(', ') : 'no stage');
const ages = (c) => (c ?? []).map((r) => `${r.showing}/${r.live} oldest ${r.oldest.toFixed(2)} s`);

/**
 * A burst's particles are all born in its first 0.12 emitter s and each lives 0.4–0.8 s, so from
 * 0.25 s every one is still alive, and from then on, until the burst is re-fired, its oldest is 0.25
 * s or more (past 0.4 s the survivors were born by 0.12 s). A tick advances the emitters by at most
 * 0.234 s (Pixi's 100 ms `deltaMS` cap × `DEFAULT_EMIT_SPEED`), so a re-fired burst reads under
 * 0.25 s on its first tick.
 */
const MID_BURST = 0.25;
/** FxStage's `BURST_GAP_MS`: the bursts re-fire on their own only after this much ticker time
 * with every burst particle dead. */
const BURST_GAP_MS = 600;

let browser;
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'fxPage/entry.ts',
		name: 'fx-playback-page',
		outDir: join(dir, 'out'),
		title: 'fx playback page',
	});
	console.log(`fx page built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({ name: 'fx-playback-page', args: ['--window-size=1600,1000'] });

	console.log('A. looping layers');
	let ev = await open(browser, html, 'bake=1');
	/** `playDrive.onTicks` with its options written as page source. */
	const ticks = (opts = '') => ev(`playDrive.onTicks({ ${opts} })`);
	const both = `until: (c) => playDrive.allShow(c, 2)`;
	let r = await ticks(both);
	check('both layers show particles on open', r.ok, describe(r.census));
	r = await ticks(`ms: 4000, once: true, ${both}`);
	check('both still show, long past one particle lifetime', r.ok, describe(r.census));
	await ev(`playDrive.slide('Max particles', 200)`);
	const landed = await ticks(
		`until: () => fxPage.emitters.some((e) => e.parent && e.maxParticles === 200)`,
	);
	r = await ticks(`ms: 1500, once: true, ${both}`);
	check('after an edit to one, both show', landed.ok && r.ok, describe(r.census));
	await ticks(`act: () => playDrive.button('❚❚ Pause')`);
	await ticks(`ms: 300, act: () => playDrive.button('▶ Play')`);
	r = await ticks(`ms: 1500, once: true, ${both}`);
	check('after pause and play, both show', r.ok, describe(r.census));

	console.log('B. one-shot layers');
	ev = await open(browser, html, 'bursts=1');
	r = await ticks(`until: (c) => playDrive.burstsShow(c) && playDrive.allShow(c, 4)`);
	check('every layer shows on open (three bursts, one continuous)', r.ok, describe(r.census));
	// A burst particle lives at most 0.8 emitter s (342 ticker ms): 2500 ticker ms on, the first
	// bursts are long gone.
	r = await ticks(`ms: 2500, until: (c) => playDrive.burstsShow(c)`);
	check(
		'long after the first bursts died, every burst fires again, together (looping)',
		r.ok,
		describe(r.census),
	);

	// Mid-burst (so the loop is not due), edit one burst in the same tick as the reading before it;
	// then, from the next tick, wait for every burst to read freshly fired.
	await ev(`playDrive.pick('burst-b')`);
	const edit = await ev(`(async () => {
		const at = await playDrive.onTicks({
			until: (c) => playDrive.burstsShow(c) &&
				playDrive.bursts(c).every((r) => r.oldest >= ${MID_BURST}),
			act: (c) => {
				playDrive.slide('Max particles', 150);
				return playDrive.bursts(c).map((r) => r.oldest);
			},
		});
		const refired = await playDrive.onTicks({
			until: (c) => playDrive.burstsShow(c) &&
				playDrive.bursts(c).every((r) => r.oldest < ${MID_BURST}),
		});
		return { at, refired };
	})()`);
	const before = edit.at.value ?? [];
	const after = edit.refired.census ? edit.refired.census.filter((row) => row.burst) : [];
	const edited = await ev(`fxPage.emitters.filter((e) => e.parent).map((e) => e.maxParticles)`);
	check(
		'an edit to one burst re-fires every burst with it',
		edit.at.ok && edited.includes(150) && edit.refired.ok && edit.refired.ms < BURST_GAP_MS,
		`oldest before ${before.map((a) => a.toFixed(2)).join('/')} s, after ${after
			.map((row) => row.oldest.toFixed(2))
			.join('/')} s, ${Math.round(edit.refired.ms)} ticker ms after the edit`,
	);

	// Replay in a tick; the next tick that has every layer spawning is read.
	r = await ev(`(async () => {
		await playDrive.onTicks({ act: () => playDrive.button('⟲ Replay') });
		return playDrive.onTicks({ until: (c) => !!c && c.every((r) => r.live > 0) });
	})()`);
	const c = r.census;
	check(
		'⟲ Replay restarts every layer from its start, together',
		// Started on one frame: every layer's oldest particle is the same age (to a frame or two).
		r.ok &&
			!!c &&
			c.length === 4 &&
			c.every((row) => row.showing > 0) &&
			Math.max(...c.map((row) => row.oldest)) - Math.min(...c.map((row) => row.oldest)) < 0.05,
		ages(c).join(', '),
	);

	// Paused for 2500 ticker ms: had the loop run, the bursts would have died and re-fired by then.
	await ticks(`act: () => playDrive.button('❚❚ Pause')`);
	r = await ticks(`ms: 2500`);
	const emitting = await ev(
		`fxPage.emitters.filter((e) => e.parent && e.emitterLifetime > 0).map((e) => e.emit)`,
	);
	check(
		'paused, the bursts do not re-fire',
		r.ok && emitting.length === 3 && emitting.every((e) => !e),
		describe(await ev(`playDrive.census()`)),
	);
	await ev(`playDrive.button('▶ Play')`);

	const errors = browser.pageLog.filter((l) => /^\[(error|uncaught)\]/.test(l));
	check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
	failed = true;
	console.error(err);
} finally {
	await browser?.close();
	if (!keepAt) rmSync(dir, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(
	`\nfx-playback-page: ${results.length - bad.length}/${results.length} passed (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
process.exit(failed || bad.length ? 1 : 0);
