#!/usr/bin/env node
/**
 * FX PAGE — the `/fx` page played headless (Invisible Shader Graph step 8d.5): a layer's MATERIAL
 * picked, tuned, previewed and saved through the real page.
 *
 * `fxPage/entry.ts` mounts the real `/fx` `+page.svelte` outside SvelteKit (its requests answered in
 * memory, see there); this script builds it with Vite and the launcher's Svelte plugin and drives it
 * in headless Chromium through the DOM, as an author would:
 *  1. the Material picker lists the effects made for particles first, under their own heading;
 *     bind the atlas and a frame, pick a material: the page registered the compiled set, the stage
 *     mounts the material through the game's renderer (`?fxdebug=1`: on) and the layer's load turns
 *     from the §10 estimate into the measured peak;
 *  2. paused, drag a material param: the stage's pixels change, the particles are still there and the
 *     material is not remounted (a uniform write); Strength the same; ⚡ on the param makes a
 *     parameter whose preview slider moves the material live;
 *  3. switch the time mode: the material is remounted;
 *  4. raise Max particles over 512: the cap note, and the layer drawn plain;
 *  5. Apply preset: the material stays;
 *  6. save, start a new effect, reopen it: the doc and the Material section read back identical;
 *  7. on a graph that reads Strength, dragging it changes the pixels with no remount;
 *  8. reopen an effect whose material's graph is gone: named, badged and drawn plain;
 *  9. reload on an effect with a material while the compiled set answers late: the stage's first
 *     build is plain (not registered), and the material mounts once the set registers.
 *
 * The page's "Open in Shader Graph" is checked to be a plain same-tab link, with no iframe.
 *
 *   pnpm --filter fx-spike fx-page [--keep <dir>]
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
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'fx-page-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const build = () =>
	buildLauncherPage({
		entry: 'fxPage/entry.ts',
		name: 'fx-page',
		outDir: join(dir, 'out'),
		title: 'fx page',
	});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let failed = false;
try {
	const html = await build();
	console.log(`fx page built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({
		name: 'fx-page',
		args: ['--window-size=1600,1000'],
		logAll: true,
	});
	await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?fxdebug=1` });
	const ev = (expr) => browser.evaluate(expr);
	const waitFor = async (expr, what, ms = 30_000) => {
		const until = Date.now() + ms;
		for (;;) {
			if (await ev(expr).catch(() => false)) return true;
			if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
			await sleep(100);
		}
	};
	const debugLines = () => browser.pageLog.filter((l) => l.includes('[fxdebug]'));
	// A mount's line (`on (…)` or `plain, …`), not the peak lines a drawing layer adds.
	const mounts = () =>
		debugLines().filter((l) => /material layer fx\/[^:]+: (on \(|plain)/.test(l));

	// In-page helpers: the DOM as an author touches it, and the stage's pixels.
	await waitFor(`!!document.querySelector('.stage canvas')`, 'the stage');
	await ev(`(() => {
		const rowOf = (label) => [...document.querySelectorAll('.inspector .row')].find(
			(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
		const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
		window.fxDrive = {
			section: (title) => [...document.querySelectorAll('.inspector section')].find(
				(s) => s.querySelector('h3')?.textContent.trim() === title),
			select(label, value) {
				const el = rowOf(label)?.querySelector('select');
				if (!el) throw new Error('no select ' + label);
				el.value = value; fire(el, 'change');
			},
			selectValue: (label) => rowOf(label)?.querySelector('select')?.value,
			slide(label, value, { section } = {}) {
				const scope = section ? window.fxDrive.section(section) : document;
				const row = [...scope.querySelectorAll('.row.slider')].find(
					(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
				const el = row?.querySelector('input[type=range]');
				if (!el) throw new Error('no slider ' + label);
				el.value = String(value); fire(el, 'input');
			},
			sliderValue(label, section) {
				const scope = section ? window.fxDrive.section(section) : document;
				const row = [...scope.querySelectorAll('.row.slider')].find(
					(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
				return row?.querySelector('input[type=range]')?.value;
			},
			tick(name) {
				const box = [...document.querySelectorAll('.frames label')].find(
					(l) => l.textContent.trim() === name)?.querySelector('input');
				if (!box) throw new Error('no frame ' + name);
				box.click();
			},
			button: (text) => {
				const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
				if (!b) throw new Error('no button ' + text);
				b.click();
			},
			text: (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()),
			pixels() {
				const src = document.querySelector('.stage canvas');
				const c = document.createElement('canvas');
				c.width = src.width; c.height = src.height;
				const g = c.getContext('2d');
				g.drawImage(src, 0, 0);
				const d = g.getImageData(0, 0, c.width, c.height).data;
				let drawn = 0, sum = 0;
				const sig = [];
				for (let i = 0; i < d.length; i += 4) {
					const lit = d[i] + d[i + 1] + d[i + 2];
					if (lit > 60) drawn++;
					sum = (sum + lit * ((i >> 2) % 9973)) % 2147483647;
				}
				for (let i = 0; i < d.length; i += 4 * 97) sig.push(d[i], d[i + 1], d[i + 2]);
				return { drawn, sum, sig };
			},
		};
	})()`);
	const pixels = () => ev('fxDrive.pixels()');
	const differs = (a, b) => a.sig.reduce((n, v, i) => n + (v !== b.sig[i] ? 1 : 0), 0);
	const frame = () => sleep(250);

	console.log('1. pick a material');
	await waitFor(
		`[...document.querySelectorAll('.inspector option')].some((o) => o.value === 'custom:noiseDissolve')`,
		'the compiled set in the Material picker',
	);
	check(
		'the page read the compiled set from GET /api/shaders/effects',
		await ev(
			`fxPage.requests.some((r) => r.startsWith('GET /api/shaders/effects?projectKey=project'))`,
		),
	);
	const picker = await ev(
		`(() => {
			const select = [...document.querySelectorAll('.inspector .row')].find((r) => r.textContent.includes('Material')).querySelector('select');
			return {
				options: [...select.querySelectorAll('option')].map((o) => o.textContent.trim()),
				groups: [...select.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent.trim())]),
			};
		})()`,
	);
	const rest = picker.groups[1]?.[1] ?? [];
	check(
		'Material lists None first, then the effects made for particles (Ripple), then the rest, each by name',
		picker.options[0] === 'None (plain sprites)' &&
			picker.options[1] === 'Ripple' &&
			JSON.stringify(picker.groups[0]) === JSON.stringify(['Made for particles', ['Ripple']]) &&
			picker.groups[1]?.[0] === 'Other effects' &&
			rest.length === picker.options.length - 2 &&
			rest.join('|') === [...rest].sort((a, b) => a.localeCompare(b)).join('|'),
		picker.options.join(', '),
	);
	await ev(`fxDrive.select('Atlas', 'client/project/manifests/atlas_manifest_sparks.json')`);
	await waitFor(`document.querySelectorAll('.frames label').length === 2`, 'the regions');
	await ev(`fxDrive.tick('dot')`);
	// Paused, so the load reads the §10 estimate until the material has drawn.
	await ev(`fxDrive.button('❚❚ Pause')`);
	await ev(`fxDrive.select('Material', 'custom:noiseDissolve')`);
	await waitFor(`!!fxDrive.section('Material')?.querySelector('.loadrow')`, 'the load meter');
	await sleep(400);
	check(
		'the stage mounts the material through the game renderer (?fxdebug=1: on)',
		mounts().some((l) => l.includes('fx/layer-1: on (custom:noiseDissolve; 1/8 drawing)')),
		mounts().at(-1),
	);
	const params = await ev(
		`[...fxDrive.section('Material').querySelectorAll('.row')].map((r) => r.firstElementChild.textContent.trim())`,
	);
	check(
		'its rows: Material, Time, Strength, then its params Edge colour and Grain, then Load',
		params.join('|') === 'Material|Time|Strength|Edge colour|Grain|Load',
		params.join(', '),
	);
	check(
		'each param row has ⚡',
		await ev(`[...fxDrive.section('Material').querySelectorAll('.row')].slice(2, 5)
			.every((r) => !!r.querySelector('button.expose'))`),
	);
	const link = await ev(`(() => {
		const a = [...fxDrive.section('Material').querySelectorAll('a')].find(
			(x) => x.textContent.includes('Open in Shader Graph'));
		return a && { href: a.getAttribute('href'), target: a.getAttribute('target') };
	})()`);
	check(
		'"Open in Shader Graph" is a full-page link to the graph (no iframe, no new tab)',
		link?.href === '/shaders?graph=noiseDissolve&project=project' &&
			link.target === null &&
			(await ev(`document.querySelectorAll('iframe').length`)) === 0,
		link?.href,
	);
	const loadBefore = await ev(`fxDrive.section('Material').querySelector('.loadval').textContent`);
	// min(200, 1 a wave × 0.8 s ÷ 0.012 s) = 67 alive × the 48 × 48 dot × the default scale's
	// largest (0.5)² × no padding × Noise dissolve's cost 33 = 1,273,536.
	check(
		'before it has drawn, the load is the §10 estimate',
		loadBefore === '≈ 1.3 M / 32 M',
		loadBefore,
	);
	await ev(`fxDrive.button('▶ Play')`);
	await waitFor(
		`!fxDrive.section('Material').querySelector('.loadval').textContent.startsWith('≈')`,
		'the measured load',
	);
	const loadAfter = await ev(`fxDrive.section('Material').querySelector('.loadval').textContent`);
	const badge = await ev(`document.querySelector('.layers .mbadge')?.textContent.trim()`);
	const effectLoad = await ev(`document.querySelector('.subbar .eload')?.textContent.trim()`);
	check(
		'once it plays, the measured peak, a badge in the Layers list and the effect load beside the name',
		!!badge && /^◆ \d+%$/.test(badge) && !!effectLoad && /\/ 64 M$/.test(effectLoad),
		`${loadAfter}; badge ${badge}; effect ${effectLoad}`,
	);

	console.log('2. tune it live, paused');
	await ev(`fxDrive.button('❚❚ Pause')`);
	await frame();
	const a = await pixels();
	await frame();
	const a2 = await pixels();
	check(
		'paused, the stage holds still (control)',
		differs(a, a2) === 0 && a.sum === a2.sum && a.drawn > 200,
		`${a.drawn} px drawn`,
	);
	const mountsBefore = mounts().length;
	for (const v of [10, 14, 20, 26, 30]) {
		await ev(`fxDrive.slide('Grain', ${v}, { section: 'Material' })`);
		await sleep(40);
	}
	await frame();
	const b = await pixels();
	check(
		'dragging Grain changes the pixels',
		differs(a, b) > 0 && a.sum !== b.sum,
		`${differs(a, b)} sampled px differ`,
	);
	check(
		'…with the particles still there and the material not remounted (a uniform write, no reset)',
		b.drawn > 0.8 * a.drawn && mounts().length === mountsBefore,
		`${b.drawn} px drawn, ${mounts().length - mountsBefore} remounts`,
	);
	await ev(`fxDrive.slide('Strength', 3.5, { section: 'Material' })`);
	await frame();
	check('Strength is a uniform write too (no remount)', mounts().length === mountsBefore);
	// ⚡ on Grain → New parameter… → its preview slider moves the material live.
	await ev(`(() => {
		const row = [...fxDrive.section('Material').querySelectorAll('.row.slider')].find(
			(r) => r.querySelector(':scope > span').textContent.trim() === 'Grain');
		row.querySelector('button.expose').click();
	})()`);
	await waitFor(`!!document.querySelector('.exposemenu')`, 'the ⚡ menu');
	const menu = await ev(`document.querySelector('.exposemenu').textContent`);
	check(
		'⚡ on a material param offers New parameter',
		menu.includes('New parameter'),
		menu.replace(/\s+/g, ' '),
	);
	await ev(`fxDrive.button('New parameter…')`);
	await waitFor(`!!document.querySelector('dialog[open] input')`, 'the name dialog');
	await ev(`(() => {
		const input = document.querySelector('dialog[open] input');
		input.value = 'grain'; input.dispatchEvent(new Event('input', { bubbles: true }));
		const ok = [...document.querySelectorAll('dialog[open] button')].find(
			(x) => x.textContent.trim() === 'Create');
		ok.click();
	})()`);
	await waitFor(`!!document.getElementById('fx-param-grain')`, 'the exposed parameter');
	check(
		'the parameter drives material.param.grain',
		(await ev(`document.getElementById('fx-param-grain').textContent`)).includes(
			'material.param.grain',
		),
	);
	await frame();
	const d = await pixels();
	await frame();
	check('still paused, still the same pixels (control)', differs(d, await pixels()) === 0);
	await ev(`(() => {
		const el = document.querySelector('#fx-param-grain .preview input[type=range]');
		el.value = el.min; el.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await frame();
	const e = await pixels();
	check(
		'the ⚡ preview slider changes the material live, paused (a uniform write, no remount)',
		differs(d, e) > 0 && e.drawn > 0.5 * d.drawn && mounts().length === mountsBefore,
		`${differs(d, e)} sampled px differ, ${e.drawn}/${d.drawn} px drawn, ${mounts().length - mountsBefore} remounts`,
	);

	console.log('3. switch the time mode');
	await ev(`fxDrive.select('Time', 'loop')`);
	await sleep(400);
	check(
		'Loop at the effect’s length remounts the material (its time is read at mount)',
		mounts().length === mountsBefore + 1 && mounts().at(-1).includes(': on (custom:noiseDissolve'),
		mounts().at(-1),
	);
	await ev(`fxDrive.button('▶ Play')`);
	await sleep(600);
	check('…and it draws again', (await pixels()).drawn > 200);

	console.log('4. the cap');
	await ev(`fxDrive.slide('Max particles', 600)`);
	await waitFor(
		`fxDrive.text('.mnote').some((t) => t.includes('Max particles is 600') && t.includes('512'))`,
		'the cap note',
	);
	await sleep(300);
	check(
		'Max particles 600: the cap note, and the layer drawn plain (over capacity)',
		mounts().at(-1).includes('plain, over capacity'),
		mounts().at(-1),
	);
	await ev(`fxDrive.slide('Max particles', 200)`);
	await sleep(400);
	check(
		'back to 200: on again',
		mounts().at(-1).includes(': on (custom:noiseDissolve'),
		mounts().at(-1),
	);

	console.log('5. Apply preset');
	await ev(`fxDrive.select('Preset', [...[...document.querySelectorAll('.inspector .row')].find(
		(r) => r.querySelector(':scope > span')?.textContent.trim() === 'Preset').querySelectorAll('option')][1].value)`);
	await sleep(400);
	check(
		'Apply preset keeps the material, its time and Grain',
		(await ev(`fxDrive.selectValue('Material')`)) === 'custom:noiseDissolve' &&
			(await ev(`fxDrive.selectValue('Time')`)) === 'loop' &&
			(await ev(`fxDrive.sliderValue('Grain', 'Material')`)) === '30',
	);

	console.log('6. save → reopen');
	await ev(`(() => {
		const el = document.querySelector('.subbar input.name');
		el.value = 'Spark dissolve'; el.dispatchEvent(new Event('change', { bubbles: true }));
	})()`);
	await ev(`fxDrive.button('⤓ Save')`);
	await waitFor(`fxPage.saved.length === 1`, 'the save');
	const first = await ev(`JSON.stringify(fxPage.saved[0])`);
	const { sent, stored } = JSON.parse(first);
	check(
		'the saved doc stores the material exactly as the page held it',
		JSON.stringify(sent.layers[0].material) === JSON.stringify(stored.layers[0].material) &&
			stored.layers[0].material.kind === 'custom:noiseDissolve' &&
			stored.layers[0].material.time === 'loop' &&
			stored.layers[0].material.params.grain === 30,
		JSON.stringify(stored.layers[0].material),
	);
	const sectionBefore = await ev(`[fxDrive.selectValue('Material'), fxDrive.selectValue('Time'),
		fxDrive.sliderValue('Strength', 'Material'), fxDrive.sliderValue('Grain', 'Material')].join('|')`);
	await ev(`fxDrive.button('+ New')`);
	await waitFor(`fxDrive.selectValue('Material') === ''`, 'a new effect');
	await ev(`(() => {
		const el = document.querySelector('.subbar select.open');
		el.value = 'spark_dissolve'; el.dispatchEvent(new Event('change', { bubbles: true }));
	})()`);
	await waitFor(
		`fxDrive.selectValue('Material') === 'custom:noiseDissolve'`,
		'the reopened effect',
	);
	await sleep(300);
	const sectionAfter = await ev(`[fxDrive.selectValue('Material'), fxDrive.selectValue('Time'),
		fxDrive.sliderValue('Strength', 'Material'), fxDrive.sliderValue('Grain', 'Material')].join('|')`);
	check(
		'reopened, the Material section reads the same',
		sectionAfter === sectionBefore,
		sectionAfter,
	);
	await ev(`fxDrive.button('⤓ Save')`);
	await waitFor(`fxPage.saved.length === 2`, 'the second save');
	const second = JSON.parse(await ev(`JSON.stringify(fxPage.saved[1])`));
	check(
		'save → reopen → save stores the identical doc',
		JSON.stringify(second.stored) === JSON.stringify(stored),
	);
	check(
		'…and the reopened page held exactly what was stored',
		JSON.stringify(second.sent) === JSON.stringify(stored),
	);
	console.log('7. Strength on a graph that reads it');
	await ev(`fxDrive.select('Material', 'custom:pulseTint')`);
	await sleep(500);
	await ev(`fxDrive.button('❚❚ Pause')`);
	await frame();
	const tintMounts = mounts().length;
	const f = await pixels();
	await ev(`fxDrive.slide('Strength', 0, { section: 'Material' })`);
	await frame();
	const g = await pixels();
	check(
		'on Pulse tint, dragging Strength changes the pixels, the particles kept, no remount',
		differs(f, g) > 0 && g.drawn > 0.8 * f.drawn && mounts().length === tintMounts,
		`${differs(f, g)} sampled px differ`,
	);
	console.log('8. a material whose graph is gone');
	await ev(`(() => {
		const el = document.querySelector('.subbar select.open');
		el.value = 'ghost'; el.dispatchEvent(new Event('change', { bubbles: true }));
	})()`);
	await waitFor(`!!document.querySelector('dialog[open]')`, 'the discard prompt');
	await ev(`fxDrive.button('Discard them')`);
	await waitFor(
		`fxDrive.selectValue('Material') === 'custom:gone'`,
		'the effect with a missing graph',
	);
	await sleep(400);
	const ghost = await ev(`({
		option: [...[...document.querySelectorAll('.inspector .row')].find((r) => r.firstElementChild.textContent.trim() === 'Material')
			.querySelectorAll('option')].find((o) => o.selected)?.textContent.trim(),
		notes: fxDrive.text('.mnote'),
		badge: document.querySelector('.layers .mbadge')?.textContent.trim(),
	})`);
	check(
		'validateEffectMaterials names it: the picker keeps it, one note, the layer badged plain',
		ghost.option === 'custom:gone (not compiled)' &&
			ghost.notes.length === 1 &&
			ghost.notes[0].includes('not a Shader Graph effect of this project') &&
			ghost.badge === '◆ plain',
		JSON.stringify(ghost),
	);
	check(
		'…and the stage draws it plain (not registered), as a game would',
		mounts().at(-1).includes('fx/main: plain, not registered (custom:gone'),
		mounts().at(-1),
	);
	check(
		"?fxdebug=1 prints a drawing layer's peak as it grows (covered px, at most every 2 s)",
		debugLines().some((l) =>
			/material layer fx\/layer-1: on, its peak [\d.]+ (k|M)?px covered/.test(l),
		),
		debugLines().find((l) => l.includes('its peak')),
	);

	console.log('9. reopened at page load, the compiled set answering late');
	const loggedBefore = browser.pageLog.length;
	await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?fxdebug=1&opened=1` });
	const sinceReload = () =>
		browser.pageLog
			.slice(loggedBefore)
			.filter((l) => /material layer fx\/main: (on \(|plain)/.test(l));
	await waitFor(
		`[...document.querySelectorAll('.inspector option')].some((o) => o.value === 'custom:noiseDissolve' && o.selected)`,
		'the opened effect',
	);
	await waitFor(
		`!!document.querySelector('.loadval') && !document.querySelector('.loadval').textContent.startsWith('≈')`,
		'the measured load',
	);
	const reload = await ev(`({
		notes: [...document.querySelectorAll('.mnote')].map((n) => n.textContent.trim()),
		load: document.querySelector('.loadval').textContent,
	})`);
	check(
		'built before the set was registered (plain, not registered), it mounts once registered: on, measured, no note',
		sinceReload()[0]?.includes('plain, not registered (custom:noiseDissolve') &&
			sinceReload().at(-1)?.includes(': on (custom:noiseDissolve') &&
			reload.notes.length === 0,
		`${sinceReload().join(' → ')}; load ${reload.load}`,
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
		`fx page: ${bad.length} of ${results.length} checks failed${failed ? ', and the run stopped' : ''}`,
	);
	process.exit(1);
}
console.log(
	`fx page: a material picked, tuned live, switched, capped, kept by a preset and saved → reopened identical — ${results.length}/${results.length} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
