#!/usr/bin/env node
/**
 * FX COST PAGE — the `/fx` page's PERFORMANCE COST panel, played headless in the real page
 * (`fxPage/entry.ts` mounts the real `+page.svelte`; see `fxPage.mjs`):
 *  1. the default layer: the bar under the preview reads live particles and screens, under budget;
 *  2. opened: it says what coverage is measured against (the preview viewport, its size and zoom)
 *     and lists the layer with its settings;
 *  3. the overlay-wishworld beam shape (1000/s, long-lived, a high cap): the layer and the effect
 *     go over budget and the "sits at its cap" hint shows; nothing in the doc changed by reading;
 *  4. short-lived, additive and zoomed in 8×: coverage climbs with the zoom, the additive hint shows, and the
 *     viewport line names the zoom;
 *  5. a layer name in the panel selects the layer.
 *
 *   pnpm --filter fx-spike fx-cost-page [--keep <dir>]
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
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'fx-cost-page-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'fxPage/entry.ts',
		name: 'fx-cost-page',
		outDir: join(dir, 'out'),
		title: 'fx cost page',
	});
	browser = await launchChrome({
		name: 'fx-cost-page',
		args: ['--window-size=1600,1000'],
		logAll: true,
	});
	await browser.send('Page.navigate', { url: pathToFileURL(html).href });
	const ev = (expr) => browser.evaluate(expr);
	const waitFor = async (expr, what, ms = 30_000) => {
		const until = Date.now() + ms;
		for (;;) {
			if (await ev(expr).catch(() => false)) return true;
			if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
			await sleep(100);
		}
	};
	await waitFor(`!!document.querySelector('.stage canvas')`, 'the stage');
	await ev(`(() => {
		const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
		const rowOf = (label) => [...document.querySelectorAll('.inspector .row')].find(
			(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
		window.costDrive = {
			slide(label, value) {
				const el = rowOf(label)?.querySelector('input[type=range]');
				if (!el) throw new Error('no slider ' + label);
				el.value = String(value); fire(el, 'input');
			},
			select(label, value) {
				const el = rowOf(label)?.querySelector('select');
				if (!el) throw new Error('no select ' + label);
				el.value = value; fire(el, 'change');
			},
			bar: () => document.querySelector('.cost .costbar')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
			body: () => document.querySelector('.cost .costbody')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
			rows: () => [...document.querySelectorAll('.cost tbody tr:not(.hintrow)')].map((r) => ({
				cells: [...r.querySelectorAll('td')].map((td) => td.textContent.replace(/\\s+/g, ' ').trim()),
				over: r.classList.contains('over'),
			})),
			hints: () => [...document.querySelectorAll('.cost tr.hintrow')].map((r) => r.textContent.trim()),
			live: () => Number(/(\\d+) live/.exec(window.costDrive.bar())?.[1] ?? -1),
			screens: () => Number(/([\\d.]+)× screens/.exec(window.costDrive.bar())?.[1] ?? -1),
		};
	})()`);

	console.log('1. the default layer');
	await waitFor(`costDrive.live() > 0`, 'a live count in the Cost bar');
	const first = await ev(`costDrive.bar()`);
	check(
		'the bar under the preview reads live particles and screens against the totals budget',
		/\d+ live peak \d+ \/ 800/.test(first) && /× screens peak [\d.]+× \/ 4\.00×/.test(first),
		first,
	);
	check('the default layer is under budget', !/over budget/i.test(first), first);

	console.log('2. opened');
	await ev(`document.querySelector('.cost .costbar').click()`);
	await waitFor(`!!document.querySelector('.cost .costbody')`, 'the panel body');
	const body = await ev(`costDrive.body()`);
	check(
		'it names what coverage is measured against: the preview viewport, its size and zoom',
		/preview viewport \(\d+×\d+ px at 100% zoom\)/.test(body),
		body.slice(0, 120),
	);
	const rows = await ev(`costDrive.rows()`);
	check(
		'one row per layer: name, live, coverage, Max 200, rate 83.3/s, life 0.5–0.8s, normal',
		rows.length === 1 &&
			rows[0].cells[0] === 'layer-1' &&
			rows[0].cells[3] === '200' &&
			rows[0].cells[4] === '83.3/s' &&
			rows[0].cells[5] === '0.5–0.8s' &&
			rows[0].cells[6] === 'normal',
		JSON.stringify(rows[0]?.cells),
	);

	console.log('3. the beam shape');
	await ev(`costDrive.slide('Frequency (s)', 0.001)`);
	await ev(`costDrive.slide('Max particles', 1000)`);
	await ev(`costDrive.slide('Lifetime max (s)', 5)`);
	await ev(`costDrive.slide('Lifetime min (s)', 4.6)`);
	await waitFor(`costDrive.live() > 800`, 'the beam filling up', 15_000);
	const beamBar = await ev(`costDrive.bar()`);
	check('the effect goes over budget (> 800 live)', /Over budget/.test(beamBar), beamBar);
	const beamRow = (await ev(`costDrive.rows()`))[0];
	check(
		'the layer row is marked over, at 1000/s',
		beamRow.over && beamRow.cells[4] === '1000/s',
		JSON.stringify(beamRow.cells),
	);
	const beamHints = await ev(`costDrive.hints()`);
	check(
		'the hint says it sits at its cap and what rate fills it',
		beamHints.some(
			(h) => /Asks for 1000\/s but Max particles is 1000/.test(h) && /About 208\/s/.test(h),
		),
		beamHints.join(' | '),
	);
	check('reading the cost saved nothing', (await ev(`fxPage.saved.length`)) === 0);

	console.log('4. additive, zoomed in 8×');
	// Short-lived, so the newest particles crowd the centre the zoom looks at (the beam's old ones
	// have flown out of an 8× view, which the readout rightly counts as covering nothing).
	await ev(`costDrive.slide('Lifetime min (s)', 0.3)`);
	await ev(`costDrive.slide('Lifetime max (s)', 0.3)`);
	await ev(`costDrive.slide('Max particles', 300)`);
	await ev(`costDrive.select('Blend', 'add')`);
	await sleep(1000);
	const before = await ev(`costDrive.screens()`);
	await ev(`(() => {
		const stage = document.querySelector('.stage');
		const r = stage.getBoundingClientRect();
		for (let i = 0; i < 30; i++)
			stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true }));
	})()`);
	await waitFor(`/at 800% zoom/.test(costDrive.body())`, 'the zoom in the viewport line', 5_000);
	await sleep(800);
	const after = await ev(`costDrive.screens()`);
	check(
		'coverage climbs with the zoom (8× zoom on the same particles)',
		after > before * 4,
		`${before}× → ${after}×`,
	);
	const zoomHints = await ev(`costDrive.hints()`);
	check(
		'the additive hint shows once it stacks over a screen',
		zoomHints.some((h) => /^Additive blending stacks/.test(h)),
		zoomHints.join(' | '),
	);

	console.log('5. select from the panel');
	await ev(`document.querySelector('.inspector .row input')?.blur()`);
	await ev(`document.querySelector('.cost td.name button').click()`);
	await sleep(100);
	check(
		'a layer name in the panel selects that layer',
		await ev(`!!document.querySelector('.cost tr.sel')`),
	);
	const errors = browser.pageLog.filter((l) => /^\[(error|uncaught)\]/.test(l));
	check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
	failed = true;
	console.error(error);
	if (browser) console.error(browser.pageLog.slice(-20).join('\n'));
} finally {
	await browser?.close();
	if (!keepAt) rmSync(dir, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
if (failed || bad.length) {
	console.error(
		`fx cost page: ${bad.length} of ${results.length} checks failed${failed ? ', and the run stopped' : ''}`,
	);
	process.exit(1);
}
console.log(
	`fx cost page: the Cost panel measures, warns, hints and stays read-only — ${results.length}/${results.length} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
