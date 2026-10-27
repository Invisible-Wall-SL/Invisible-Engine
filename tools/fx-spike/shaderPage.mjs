#!/usr/bin/env node
/**
 * SHADER PAGE — the `/shaders` page played headless (Invisible Shader Graph step 8d.7): an effect
 * made for particles, seen on particles, through the real page.
 *
 * `shaderPage/entry.ts` mounts the real `/shaders` `+page.svelte` outside SvelteKit (its requests
 * answered in memory, see there); this script builds it with Vite and the launcher's Svelte plugin
 * (`launcherPage.mjs`) and drives it in headless Chromium through the DOM, as an author would, on
 * WebGL1 and on WebGL2:
 *  1. opened on "Pulse" (made for elements): the preview shows the sample card with its `t`
 *     scrubber, the meter reads against 400 / 16, no particle notes;
 *  2. Made for → Particles: the preview's element turns to Particles and draws them through the
 *     game's renderer (`?fxdebug=1`: on), the `t` scrubber gives way to play / pause / restart, the
 *     meter and the node chips read against 150 / 4, and the notes name the glow pass and the
 *     motion;
 *  3. paused, nothing moves; played, it does; Restart empties the stage; the Emitter switches to
 *     the Fountain;
 *  4. paused, Strength changes the pixels with no remount (a uniform write); a param's default
 *     changed recompiles the effect and remounts it, the particles still shown, the pixels changed;
 *     the particles' art: a region overtaken by the soft dot leaves no "Loading art…", and a region
 *     that failed leaves no note on the sample card;
 *  5. it autosaves with `madeFor`; opening Frost (made for elements) brings the sample card back;
 *     reopening Pulse reads it back made for particles, on particles;
 *  6. Made for → Elements: the next save has no `madeFor`, and the meter reads 400 / 16 again;
 *     opening another effect shows its default element whatever the last one showed.
 *
 *   pnpm --filter fx-spike shader-page [--keep <dir>]
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
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'shader-page-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page's helpers: the DOM as an author touches it, and the preview's pixels. */
const DRIVE = `(() => {
	const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
	const preview = () => document.querySelector('.preview');
	const previewSelect = (label) => [...preview().querySelectorAll('label.row')].find(
		(r) => r.querySelector('.label')?.textContent.trim() === label)?.querySelector('select');
	window.drive = {
		madeFor: () => document.querySelector('select[aria-label="Made for"]')?.value,
		setMadeFor(value) {
			const el = document.querySelector('select[aria-label="Made for"]');
			if (!el) throw new Error('no Made for');
			el.value = value; fire(el, 'change');
		},
		element: () => previewSelect('Element')?.value,
		selectRow(label, value) {
			const el = previewSelect(label);
			if (!el) throw new Error('no select ' + label);
			el.value = value; fire(el, 'change');
		},
		loading: () => !!preview().querySelector('.loading'),
		hints: () => [...preview().querySelectorAll('.hint.warn')].map((n) => n.textContent.trim()),
		previewButton(label) {
			const b = preview().querySelector('button[aria-label="' + label + '"]');
			if (!b) throw new Error('no preview button ' + label);
			b.click();
		},
		hasButton: (label) => !!preview().querySelector('button[aria-label="' + label + '"]'),
		hasScrubber: () => !!preview().querySelector('input[aria-label="Progress t"]'),
		segment(text) {
			const b = [...preview().querySelectorAll('.seg button')].find((x) => x.textContent.trim() === text);
			if (!b) throw new Error('no segment ' + text);
			b.click();
		},
		intensity(value) {
			const el = preview().querySelector('input[aria-label="Intensity"]');
			el.value = String(value); fire(el, 'input');
		},
		meter: () => document.querySelector('.status .meter')?.textContent.replace(/\\s+/g, ' ').trim(),
		chips: () => [...document.querySelectorAll('.cost[title]')].map((c) => c.getAttribute('title')),
		notes: () => [...document.querySelectorAll('.graph-settings .ignored')].map((n) => n.textContent.trim()),
		overlay: () => [...preview().querySelectorAll('.overlay')].map((n) => n.textContent.trim()),
		open(name) {
			const b = [...document.querySelectorAll('ul.graphs button.name')].find(
				(x) => x.textContent.trim().startsWith(name));
			if (!b) throw new Error('no graph ' + name);
			b.click();
		},
		openSwatch() {
			const b = document.querySelector('.graph-settings .card .cf-swatch');
			if (!b) throw new Error('no colour swatch');
			b.click();
		},
		typeHex(hex) {
			const input = document.querySelector('.cf-pop .cf-hex');
			if (!input) throw new Error('no hex field');
			input.value = hex; fire(input, 'input');
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		},
		pixels() {
			const src = preview().querySelector('.stage canvas');
			const c = document.createElement('canvas');
			c.width = src.width; c.height = src.height;
			const g = c.getContext('2d');
			g.drawImage(src, 0, 0);
			const d = g.getImageData(0, 0, c.width, c.height).data;
			let drawn = 0;
			const sig = [];
			for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 30) drawn++;
			for (let i = 0; i < d.length; i += 4 * 53) sig.push(d[i], d[i + 1], d[i + 2], d[i + 3]);
			return { drawn, sig };
		},
	};
})()`;

const differs = (a, b) => a.sig.reduce((n, v, i) => n + (v !== b.sig[i] ? 1 : 0), 0);

let browser;
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'shaderPage/entry.ts',
		name: 'shader-page',
		outDir: join(dir, 'out'),
		title: 'shader page',
	});
	console.log(`shader page built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({
		name: 'shader-page',
		args: ['--window-size=1600,1000'],
		logAll: true,
	});
	const ev = (expr) => browser.evaluate(expr);
	const waitFor = async (expr, what, ms = 30_000) => {
		const until = Date.now() + ms;
		for (;;) {
			if (await ev(expr).catch(() => false)) return true;
			if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
			await sleep(100);
		}
	};

	for (const gl of [1, 2]) {
		const logged = browser.pageLog.length;
		await browser.send('Page.navigate', {
			url: `${pathToFileURL(html).href}?fxdebug=1&gl=${gl}`,
		});
		const debugLines = () =>
			browser.pageLog.slice(logged).filter((l) => l.includes('material layer shaders/preview'));
		const mounts = () => debugLines().filter((l) => /: on \(|: plain/.test(l));
		await waitFor(`!!document.querySelector('.preview .stage canvas')`, 'the preview');
		await waitFor(`!!document.querySelector('select[aria-label="Made for"]')`, 'the settings');
		await ev(DRIVE);
		const pixels = () => ev('drive.pixels()');
		const glVersion = await ev(`(() => {
			const c = document.querySelector('.preview .stage canvas');
			const g = c.getContext('webgl2') ?? c.getContext('webgl');
			return g instanceof WebGL2RenderingContext ? 2 : 1;
		})()`);

		console.log(`\nWebGL${gl}`);
		check(`the preview draws on WebGL${gl}`, glVersion === gl, `WebGL${glVersion}`);
		console.log('1. made for elements');
		const start = await ev(`({
			madeFor: drive.madeFor(), element: drive.element(), scrubber: drive.hasScrubber(),
			meter: drive.meter(), notes: drive.notes() })`);
		check(
			'opened made for elements: the sample card with its t scrubber, the meter against 400 / 16, no notes',
			start.madeFor === 'elements' &&
				start.element === 'sample' &&
				start.scrubber &&
				start.meter === 'cost 12/400 · reads 1/16' &&
				start.notes.length === 0,
			JSON.stringify(start),
		);

		console.log('2. Made for → Particles');
		await ev(`drive.setMadeFor('particles')`);
		await waitFor(`drive.element() === 'particles'`, 'Particles as the preview element');
		await waitFor(`drive.hasButton('Restart')`, 'the particle transport');
		await sleep(600);
		const made = await ev(`({
			scrubber: drive.hasScrubber(), pause: drive.hasButton('Pause'), meter: drive.meter(),
			chips: drive.chips(), notes: drive.notes(), overlay: drive.overlay() })`);
		const shown = await pixels();
		check(
			'the preview turns to Particles, drawn through the game renderer (?fxdebug=1: on)',
			mounts().some((l) => l.includes('shaders/preview: on (custom:pulse; 1/8 drawing)')) &&
				shown.drawn > 200 &&
				made.overlay.length === 0,
			`${mounts().at(-1)}; ${shown.drawn} px drawn`,
		);
		check('the t scrubber gives way to play / pause / restart', !made.scrubber && made.pause);
		check(
			'the meter and every node chip read against 150 / 4',
			made.meter === 'cost 12/150 · reads 1/4' &&
				made.chips.length > 0 &&
				made.chips.every((t) => /of the 150 a particle material affords/.test(t)),
			`${made.meter}; ${made.chips.length} chips`,
		);
		check(
			'the notes name the glow pass and the motion as ignored on particles',
			made.notes.length === 2 &&
				made.notes[0].includes('passes (Glow)') &&
				made.notes[1].includes('motion (its curves)'),
			made.notes.join(' | '),
		);

		console.log('3. play, pause, restart, the Fountain');
		await ev(`drive.previewButton('Pause')`);
		await sleep(150);
		const paused = await pixels();
		await sleep(500);
		const pausedLater = await pixels();
		check(
			'paused, nothing moves',
			differs(paused, pausedLater) === 0 && paused.drawn > 200,
			`${paused.drawn} px`,
		);
		await ev(`drive.previewButton('Play')`);
		await sleep(400);
		const played = await pixels();
		check(
			'played, the particles move',
			differs(paused, played) > 0,
			`${differs(paused, played)} samples`,
		);
		await ev(`drive.previewButton('Pause')`);
		await ev(`drive.previewButton('Restart')`);
		await sleep(150);
		const restarted = await pixels();
		check(
			'Restart empties the stage (paused, the emitter waits at its first frame)',
			restarted.drawn === 0,
			`${restarted.drawn} px`,
		);
		await ev(`drive.previewButton('Play')`);
		const mountsBefore = mounts().length;
		await ev(`drive.segment('Fountain')`);
		await sleep(900);
		const fountain = await pixels();
		check(
			'the Emitter switches to the Fountain: remounted, drawing',
			mounts().length === mountsBefore + 1 &&
				mounts().at(-1)?.includes(': on (custom:pulse') &&
				fountain.drawn > 200,
			`${fountain.drawn} px`,
		);

		console.log('4. Strength and a param');
		await ev(`drive.previewButton('Pause')`);
		await sleep(150);
		const before = await pixels();
		const mountsAtStrength = mounts().length;
		await ev(`drive.intensity(4)`);
		await sleep(200);
		const strong = await pixels();
		check(
			'paused, Strength changes the pixels with no remount (a uniform write)',
			differs(before, strong) > 0 && mounts().length === mountsAtStrength,
			`${differs(before, strong)} samples differ`,
		);
		await ev(`drive.openSwatch()`);
		await waitFor(`!!document.querySelector('.cf-pop .cf-hex')`, 'the colour picker');
		await ev(`drive.typeHex('#ff2200')`);
		await sleep(600);
		const tinted = await pixels();
		check(
			"paused, a param's default changed recompiles the effect: remounted, the particles still shown, the pixels changed",
			mounts().length === mountsAtStrength + 1 && differs(strong, tinted) > 0 && tinted.drawn > 200,
			`${differs(strong, tinted)} samples differ; ${tinted.drawn} px`,
		);
		await ev(`drive.previewButton('Play')`);
		await ev(`drive.intensity(1)`);

		console.log("4b. the particles' art");
		await ev(`shaderPage.served.assetDelayMs = 800`);
		await ev(`drive.selectRow('Art', 'region')`);
		await sleep(100);
		const loadingRegion = await ev(`drive.loading()`);
		await ev(`drive.selectRow('Art', 'dot')`);
		await sleep(1200);
		check(
			'a region still loading when the art goes back to the soft dot leaves no "Loading art…" behind',
			loadingRegion && !(await ev(`drive.loading()`)),
		);
		await ev(`shaderPage.served.assetDelayMs = 0`);
		await ev(`drive.selectRow('Art', 'region')`);
		await waitFor(`!drive.loading()`, 'the region');
		await ev(`drive.selectRow('Region', 'broken')`);
		await waitFor(
			`drive.hints().some((h) => h.includes("Couldn't load broken"))`,
			'the failed region note',
		);
		await ev(`drive.selectRow('Element', 'sample')`);
		await sleep(200);
		const hintsOnCard = await ev(`drive.hints()`);
		check(
			"the particles' failed-region note goes with them: none on the sample card",
			hintsOnCard.length === 0,
			hintsOnCard.join(' | '),
		);
		await ev(`drive.selectRow('Element', 'particles')`);
		await ev(`drive.selectRow('Art', 'dot')`);
		await sleep(300);

		console.log('5. save, reopen');
		const savedWith = `shaderPage.saved.filter((d) => d.id === 'pulse').at(-1)`;
		await waitFor(
			`${savedWith}?.madeFor === 'particles' && ${savedWith}?.params[0].default === '#ff2200'`,
			'the autosave',
		).catch(() => false);
		const stored = await ev(savedWith);
		check(
			'it autosaves made for particles, the rest of the edit with it',
			stored?.madeFor === 'particles' && stored.params[0].default === '#ff2200',
			JSON.stringify({ madeFor: stored?.madeFor, tint: stored?.params[0].default }),
		);
		await ev(`drive.open('Frost')`);
		await waitFor(`document.querySelector('.status strong')?.textContent === 'Frost'`, 'Frost');
		await sleep(300);
		const frost = await ev(`({ madeFor: drive.madeFor(), element: drive.element(),
			meter: drive.meter(), scrubber: drive.hasScrubber() })`);
		check(
			'Frost, made for elements, brings the sample card and the element budget back',
			frost.madeFor === 'elements' &&
				frost.element === 'sample' &&
				frost.scrubber &&
				frost.meter === 'cost 169/400 · reads 6/16',
			JSON.stringify(frost),
		);
		await ev(`drive.open('Pulse')`);
		await waitFor(`document.querySelector('.status strong')?.textContent === 'Pulse'`, 'Pulse');
		await waitFor(`drive.element() === 'particles'`, 'Particles again');
		await sleep(600);
		const reopened = await ev(`({ madeFor: drive.madeFor(), meter: drive.meter() })`);
		const reshown = await pixels();
		check(
			'reopened, Pulse reads back made for particles, on particles, at 150 / 4',
			reopened.madeFor === 'particles' &&
				reopened.meter === 'cost 12/150 · reads 1/4' &&
				reshown.drawn > 200 &&
				(await ev(
					`shaderPage.requests.some((r) => r.startsWith('GET /api/shaders/doc?id=pulse'))`,
				)),
			JSON.stringify(reopened),
		);

		console.log('6. Made for → Elements');
		const savesBefore = await ev(`shaderPage.saved.length`);
		await ev(`drive.setMadeFor('elements')`);
		await waitFor(`shaderPage.saved.length > ${savesBefore}`, 'the autosave');
		const last = await ev(`shaderPage.saved.at(-1)`);
		const back = await ev(
			`({ element: drive.element(), meter: drive.meter(), notes: drive.notes() })`,
		);
		check(
			'back to Elements: saved without madeFor, the sample card, 400 / 16, no notes',
			!('madeFor' in last) &&
				back.element === 'sample' &&
				back.meter === 'cost 12/400 · reads 1/16' &&
				back.notes.length === 0,
			JSON.stringify(back),
		);
		await sleep(300);
		const released = debugLines().some((l) => l.includes('shaders/preview: released'));
		check('the particles were released with the element preview', released);
		await ev(`drive.selectRow('Element', 'region')`);
		await sleep(200);
		await ev(`drive.open('Frost')`);
		await waitFor(`document.querySelector('.status strong')?.textContent === 'Frost'`, 'Frost');
		await sleep(300);
		check(
			"opening another effect shows its default element, whatever the last one's was",
			(await ev(`drive.element()`)) === 'sample',
			await ev(`drive.element()`),
		);
		const errors = browser.pageLog.slice(logged).filter((l) => /^\[(error|uncaught)\]/.test(l));
		check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
	}
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
		`shader page: ${bad.length} of ${results.length} checks failed${failed ? ', and the run stopped' : ''}`,
	);
	process.exit(1);
}
console.log(
	`shader page: made for particles, seen on particles, played, tuned, saved → reopened — ${results.length}/${results.length} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
