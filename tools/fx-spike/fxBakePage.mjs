#!/usr/bin/env node
/**
 * FX BAKE PAGE — "Bake now" in the real `/fx` page, headless (`fxPage/entry.ts?bake=1` mounts the
 * real `+page.svelte` on a saved effect — a normal puff under additive sparks; see `fxPage.mjs`):
 *  1. off by default: the Bake bar reads Live and the effect carries no `bake` block;
 *  2. turned on, not yet baked: the bar says so (games still run it live);
 *  3. Bake now: the page warms up, captures, composes one sheet, PUTs its PNG and writes its JSON;
 *     the bar reads Baked; the sheet has one cell per frame of each blend group (normal, then add),
 *     every cell draws something, and in each group the crossfaded seam (last frame → first) jumps
 *     no more than an ordinary step between frames;
 *  4. the preview plays the loop;
 *  5. Save stores the bake on the doc; a tuned emitter makes the bar read Stale.
 *
 *   pnpm --filter fx-spike fx-bake-page [--keep <dir>]
 *
 * `--keep` also writes there `sheet.png` (the baked sheet), `stage.png` (the live preview) and
 * `compare.png` (the live effect beside baked frame 0, each over the stage background, every group
 * drawn with its blend).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from '../rigger-spike/chrome.mjs';
import { buildLauncherPage } from './launcherPage.mjs';

const keepAt = process.argv.includes('--keep')
	? resolve(process.argv[process.argv.indexOf('--keep') + 1])
	: undefined;
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'fx-bake-page-'));
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
		name: 'fx-bake-page',
		outDir: join(dir, 'out'),
		title: 'fx bake page',
	});
	browser = await launchChrome({
		name: 'fx-bake-page',
		args: ['--window-size=1600,1000'],
		logAll: true,
	});
	await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?bake=1` });
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
		window.bakeDrive = {
			pill: () => document.querySelector('.bake .pill')?.textContent.trim() ?? '',
			bar: () => document.querySelector('.bake .bakebar')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
			open: () => document.querySelector('.bake .bakebar').click(),
			toggle: () => document.querySelector('.bake .toggle input').click(),
			button: (text) => {
				const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
				if (!b) throw new Error('no button ' + text);
				b.click();
			},
			slide(label, value) {
				const row = [...document.querySelectorAll('.inspector .row')].find(
					(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
				const el = row?.querySelector('input[type=range]');
				if (!el) throw new Error('no slider ' + label);
				el.value = String(value); fire(el, 'input');
			},
			async sheet() {
				const up = fxPage.uploads.at(-1);
				if (!up) return null;
				const bmp = await createImageBitmap(fxPage.r2.get(up.key));
				const c = document.createElement('canvas');
				c.width = bmp.width; c.height = bmp.height;
				const g = c.getContext('2d');
				g.drawImage(bmp, 0, 0);
				return { c, g, w: bmp.width, h: bmp.height, key: up.key, bytes: up.bytes };
			},
			/** Pixels that differ from the preview's stage background (#0b0e13). */
			canvasLit(cv) {
				const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
				let n = 0;
				for (let i = 0; i < d.length; i += 4)
					if (Math.abs(d[i] - 11) + Math.abs(d[i + 1] - 14) + Math.abs(d[i + 2] - 19) > 24) n++;
				return n;
			},
		};
	})()`);

	console.log('1. off by default');
	check(
		'the Bake bar reads Live',
		(await ev(`bakeDrive.pill()`)) === 'Live',
		await ev(`bakeDrive.bar()`),
	);

	console.log('2. on, not yet baked');
	await ev(`bakeDrive.open()`);
	await waitFor(`!!document.querySelector('.bake .toggle input')`, 'the bake settings');
	await ev(`bakeDrive.toggle()`);
	await waitFor(`bakeDrive.pill() === 'Not baked'`, 'the not-baked pill');
	check('turned on, it says it is not baked yet', true, await ev(`bakeDrive.bar()`));

	console.log('3. bake now');
	await ev(`bakeDrive.button('Bake now')`);
	await waitFor(`bakeDrive.pill() === 'Baked'`, 'the bake', 90_000);
	const bakeErrors = browser.pageLog.filter((l) => /^\[(error|uncaught)\]/.test(l));
	check('no errors while baking', bakeErrors.length === 0, bakeErrors.slice(0, 3).join(' | '));
	const reqs = await ev(
		`JSON.stringify(fxPage.requests.filter((r) => r.includes('bake') || r.includes('r2.test') || r.startsWith('PUT')))`,
	);
	check(
		'it signs, PUTs the page, then writes the sheet',
		/upload-url/.test(reqs) &&
			/PUT \/client\/project\/fx-bakes\/sparks\//.test(reqs) &&
			/POST \/api\/fx\/bake"/.test(reqs),
		reqs,
	);
	const sheet = JSON.parse(
		await ev(`(async () => {
			const s = await bakeDrive.sheet();
			const doc = document.querySelector('.bake .preview .hint')?.textContent ?? '';
			return JSON.stringify({ w: s.w, h: s.h, key: s.key, bytes: s.bytes, hint: doc });
		})()`),
	);
	check(
		'one PNG page under fx-bakes/sparks/',
		/fx-bakes\/sparks\/fxbake_sparks_[0-9a-f]{8}\.png$/.test(sheet.key),
		`${sheet.w}×${sheet.h}, ${sheet.bytes} bytes`,
	);
	check(
		'the panel names the frames, groups and page',
		/48 frames × 2 groups · \d+×\d+ px page/.test(sheet.hint),
		sheet.hint,
	);

	// Every cell draws, and the seam step is an ordinary step.
	const cells = JSON.parse(
		await ev(`(async () => {
			const s = await bakeDrive.sheet();
			const res = await fetch('/api/editor/regions?sheet=' + encodeURIComponent(s.key.replace(/\\.png$/, '.json')));
			const { regions } = await res.json();
			const pix = regions.map((r) => s.g.getImageData(r.x, r.y, r.w, r.h).data);
			const drawn = pix.map((d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; });
			const diff = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };
			const per = 48;
			const groups = [];
			for (let g = 0; g * per < pix.length; g++) {
				const run = pix.slice(g * per, (g + 1) * per);
				const steps = [];
				for (let i = 0; i + 1 < run.length; i++) steps.push(diff(run[i], run[i + 1]));
				const sorted = [...steps].sort((a, b) => a - b);
				groups.push({ seam: diff(run[run.length - 1], run[0]), median: sorted[sorted.length >> 1], max: sorted.at(-1) });
			}
			return JSON.stringify({ count: regions.length, minDrawn: Math.min(...drawn), groups });
		})()`),
	);
	check(
		'one cell per frame of each blend group (24 fps × 2 s × 2 groups)',
		cells.count === 96,
		`${cells.count}`,
	);
	check(
		'every cell draws its group',
		cells.minDrawn > 50,
		`fewest lit pixels in a cell: ${cells.minDrawn}`,
	);
	cells.groups.forEach((g, i) =>
		check(
			`group ${i}: the crossfaded seam is an ordinary step (last → first within 1.5× the median step)`,
			g.seam <= g.median * 1.5,
			`seam ${g.seam.toFixed(2)}, median step ${g.median.toFixed(2)}, largest ${g.max.toFixed(2)}`,
		),
	);

	console.log('4. the preview');
	await sleep(400);
	const lit = await ev(`bakeDrive.canvasLit(document.querySelector('.bake .preview canvas'))`);
	check(
		'the preview plays the baked loop over the stage background',
		lit > 50 && lit < 180 * 180,
		`${lit} lit pixels`,
	);

	console.log('5. save, then stale');
	await ev(`bakeDrive.button('⤓ Save')`);
	await waitFor(`fxPage.saved.length === 1`, 'the save');
	const stored = JSON.parse(await ev(`JSON.stringify(fxPage.saved[0].stored.bake)`));
	check(
		'Save stores the bake on the doc',
		stored?.enabled === true &&
			/^[0-9a-f]{8}$/.test(stored?.result?.hash ?? '') &&
			stored.result.groups?.map((g) => g.blendMode).join() === 'normal,add' &&
			stored.result.groups.every((g) => g.frames.length === 48),
		JSON.stringify({
			...stored,
			result: {
				...stored?.result,
				groups: stored?.result?.groups?.map((g) => `${g.blendMode}: ${g.frames.length} frames`),
			},
		}),
	);
	check('after Save it still reads Baked', (await ev(`bakeDrive.pill()`)) === 'Baked');
	if (keepAt) {
		const sheetPng = await ev(`(async () => (await bakeDrive.sheet()).c.toDataURL('image/png'))()`);
		writeFileSync(join(dir, 'sheet.png'), Buffer.from(sheetPng.split(',')[1], 'base64'));
		const stagePng = await ev(`document.querySelector('.stage canvas').toDataURL('image/png')`);
		writeFileSync(join(dir, 'stage.png'), Buffer.from(stagePng.split(',')[1], 'base64'));
		// Live (left) next to baked frame 0 (right): each over the stage background, at the stage's
		// 1:1 zoom, each group's frame 0 drawn with its blend at the stored bounds as <BakedEffect>
		// places it.
		const comparePng = await ev(`(async () => {
			const s = await bakeDrive.sheet();
			const bake = fxPage.saved[0].stored.bake.result;
			const res = await fetch('/api/editor/regions?sheet=' + encodeURIComponent(bake.assetKey));
			const byName = new Map((await res.json()).regions.map((r) => [r.name, r]));
			const stage = document.querySelector('.stage canvas');
			const half = 300;
			const out = document.createElement('canvas');
			out.width = half * 4; out.height = half * 2;
			const g = out.getContext('2d');
			g.fillStyle = '#0b0e13'; g.fillRect(0, 0, out.width, out.height);
			const k = stage.width / stage.clientWidth;
			g.drawImage(stage, stage.width / 2 - half * k, stage.height / 2 - half * k, 2 * half * k, 2 * half * k, 0, 0, 2 * half, 2 * half);
			for (const group of bake.groups) {
				const r = byName.get(group.frames[0]);
				g.globalCompositeOperation = group.blendMode === 'add' ? 'lighter' : 'source-over';
				g.drawImage(s.c, r.x, r.y, r.w, r.h, 3 * half + bake.bounds.x, half + bake.bounds.y, bake.bounds.w, bake.bounds.h);
			}
			return out.toDataURL('image/png');
		})()`);
		writeFileSync(join(dir, 'compare.png'), Buffer.from(comparePng.split(',')[1], 'base64'));
	}
	await ev(`bakeDrive.slide('Max particles', 200)`);
	await waitFor(`bakeDrive.pill() === 'Stale'`, 'the stale pill');
	check('a tuned emitter makes it Stale', true, await ev(`bakeDrive.bar()`));

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
		`fx bake page: ${bad.length} of ${results.length} checks failed${failed ? ', and the run stopped' : ''}`,
	);
	process.exit(1);
}
console.log(
	`fx bake page: off by default, baked to one seamless sheet of blend groups, previewed, saved and marked stale — ${results.length}/${results.length} (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
