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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-page: the stage's particles per emitter, and the controls an author touches. */
const DRIVER = `(() => {
	const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
	window.playDrive = {
		/** Per live emitter, in creation order: particles on stage, how many show, the oldest age. */
		census() {
			const canvas = document.querySelector('.stage canvas');
			const app = fxPage.apps.find((a) => a.canvas === canvas);
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
	};
})()`;

async function open(browser, html, query) {
	await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?${query}` });
	const ev = (expr) => browser.evaluate(expr);
	const until = Date.now() + 30_000;
	while (
		!(await ev(`!!document.querySelector('.stage canvas') && !!window.fxPage`).catch(() => false))
	) {
		if (Date.now() > until) throw new Error('timed out waiting for the stage');
		await sleep(100);
	}
	await ev(DRIVER);
	return ev;
}

const describe = (c) => (c ? c.map((r) => `${r.showing}/${r.live}`).join(', ') : 'no stage');
const allShow = (c, n) => !!c && c.length === n && c.every((r) => r.showing > 0);

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
	const census = () => ev(`playDrive.census()`);
	await sleep(1500);
	let c = await census();
	check('both layers show particles on open', allShow(c, 2), describe(c));
	await sleep(4000);
	c = await census();
	check('both still show, long past one particle lifetime', allShow(c, 2), describe(c));
	await ev(`playDrive.slide('Max particles', 200)`);
	await sleep(1500);
	c = await census();
	check('after an edit to one, both show', allShow(c, 2), describe(c));
	await ev(`playDrive.button('❚❚ Pause')`);
	await sleep(300);
	await ev(`playDrive.button('▶ Play')`);
	await sleep(1500);
	c = await census();
	check('after pause and play, both show', allShow(c, 2), describe(c));

	console.log('B. one-shot layers');
	ev = await open(browser, html, 'bursts=1');
	const bursts = (rows) => (rows ?? []).filter((r) => r.burst);
	/** Sample for `ms`: whether every burst layer was seen showing in ONE sample (fired together). */
	const burstsTogether = async (ms) => {
		const until = Date.now() + ms;
		let last;
		while (Date.now() < until) {
			last = await census();
			const b = bursts(last);
			if (b.length === 3 && b.every((r) => r.showing > 0)) return { ok: true, last };
			await sleep(50);
		}
		return { ok: false, last };
	};
	let seen = await burstsTogether(2000);
	check(
		'every layer shows on open (three bursts, one continuous)',
		seen.ok && allShow(seen.last, 4),
		describe(seen.last),
	);
	// A burst particle lives at most 0.8 emitter seconds (well under a second): past 2.5 s the first
	// bursts are long gone.
	await sleep(2500);
	seen = await burstsTogether(3000);
	check(
		'long after the first bursts died, every burst fires again, together (looping)',
		seen.ok,
		describe(seen.last),
	);

	// Mid-burst (so the loop is not due), edit one burst: every burst starts over, not only it.
	await ev(`playDrive.pick('burst-b')`);
	await burstsTogether(3000);
	await sleep(150);
	const before = bursts(await census()).map((r) => r.oldest);
	await ev(`playDrive.slide('Max particles', 150)`);
	await sleep(100);
	const after = bursts(await census());
	const edited = await ev(`fxPage.emitters.filter((e) => e.parent).map((e) => e.maxParticles)`);
	check(
		'an edit to one burst re-fires every burst with it',
		edited.includes(150) &&
			after.length === 3 &&
			after.every((r, i) => r.showing > 0 && r.oldest < before[i]),
		`oldest before ${before.map((a) => a.toFixed(2)).join('/')} s, after ${after
			.map((r) => r.oldest.toFixed(2))
			.join('/')} s`,
	);

	await sleep(300);
	await ev(`playDrive.button('⟲ Replay')`);
	await sleep(150);
	c = await census();
	check(
		'⟲ Replay restarts every layer from its start, together',
		// Started on one frame: every layer's oldest particle is the same age (to a frame or two).
		allShow(c, 4) &&
			Math.max(...c.map((r) => r.oldest)) - Math.min(...c.map((r) => r.oldest)) < 0.05,
		c?.map((r) => `${r.showing}/${r.live} oldest ${r.oldest.toFixed(2)} s`).join(', '),
	);

	await ev(`playDrive.button('❚❚ Pause')`);
	await sleep(2500);
	const emitting = await ev(
		`fxPage.emitters.filter((e) => e.parent && e.emitterLifetime > 0).map((e) => e.emit)`,
	);
	check(
		'paused, the bursts do not re-fire',
		emitting.every((e) => !e),
		describe(await census()),
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
