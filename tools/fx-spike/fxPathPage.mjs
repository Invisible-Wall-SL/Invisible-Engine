#!/usr/bin/env node
/**
 * FX PATH PAGE — particles on paths authored in the real `/fx` page played headless
 * (`fxPage/entry.ts`; see `fxPage.mjs`; design `docs/design/fx-paths.md`).
 *
 *  1. Spawn → Path: the layer's emitter gets an `fxPath` (along), and the curve with its points is
 *     drawn over the stage;
 *  2. drag a point on the stage (a real pointer): the doc's point moves, the stage does not pan;
 *  3. double-click the curve: a point is added there; Alt-click a point: it is removed;
 *  4. a points-table number edits the point;
 *  5. Movement → Follow path: the emitter follows; back to a Circle spawn the path stays (Follow
 *     still uses it); "Move the emitter along a path" turns on travel;
 *  6. Movement → Eased speed and spawn Circle: the path is gone from the config and the stage;
 *  7. a saved travel time past the slider's range is shown and kept when the slider is touched;
 *     a blank points-table cell writes nothing;
 *  8. a drag cancelled mid-way (a touch `pointercancel`) writes nothing and puts the live emitter's
 *     own path back; switching layer mid-drag ends it — the other layer shows its own points and
 *     neither layer gets the dragged curve, and the next drag edits only the layer it is on;
 *  9. at the point cap (256) the + buttons are disabled and a double-click adds nothing.
 *
 *   pnpm --filter fx-spike fx-path-page [--keep <dir>]
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
const dir = keepAt ?? mkdtempSync(join(tmpdir(), 'fx-path-page-'));
mkdirSync(dir, { recursive: true });
const began = Date.now();
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-page: the controls an author touches, and what the stage shows. */
const DRIVER = `(() => {
	const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
	const row = (label) => [...document.querySelectorAll('.inspector .row')].find(
		(r) => r.querySelector(':scope > span')?.textContent.trim() === label);
	window.pathDrive = {
		pickFirst() { document.querySelector('button.pick').click(); },
		/** The n-th select whose row is labelled \`label\` (Spawn and Movement both have one). */
		choose(label, value) {
			const el = [...document.querySelectorAll('.inspector .row')]
				.filter((r) => r.querySelector(':scope > span')?.textContent.trim() === label)
				.map((r) => r.querySelector('select'))
				.find((s) => s && [...s.options].some((o) => o.value === value));
			if (!el) throw new Error('no select ' + label + ' with ' + value);
			el.value = value; fire(el, 'change');
		},
		check(text, on) {
			const l = [...document.querySelectorAll('.inspector label')].find(
				(x) => x.textContent.trim() === text);
			const el = l?.querySelector('input[type=checkbox]');
			if (!el) throw new Error('no checkbox ' + text);
			if (el.checked !== on) el.click();
		},
		anchors() {
			return [...document.querySelectorAll('.pathsvg circle.anchor')].map((c) => {
				const r = c.getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			});
		},
		curvePoint(frac) {
			const p = document.querySelector('.pathsvg path.curve');
			if (!p) return null;
			const q = p.getPointAtLength(p.getTotalLength() * frac);
			const r = document.querySelector('.pathsvg').getBoundingClientRect();
			return { x: r.left + q.x, y: r.top + q.y };
		},
		rows() {
			return [...document.querySelectorAll('table.pathpoints tbody tr')].map((tr) =>
				[...tr.querySelectorAll('input')].map((i) => Number(i.value)));
		},
		/** Every live path emitter's first point, rounded. */
		livePoints() {
			return fxPage.emitters.filter((e) => e.parent && e.getBehavior('fxPath')).map((e) => {
				const p = e.getBehavior('fxPath').path.curve.points[0];
				return [Math.round(p.x), Math.round(p.y)];
			});
		},
		pickLayer(key) {
			const b = [...document.querySelectorAll('.layers button.pick')].find(
				(x) => x.firstChild.textContent.trim() === key);
			if (!b) throw new Error('no layer ' + key);
			b.click();
		},
		selectedLayer() {
			return document.querySelector('.layers li.active button.pick').firstChild.textContent.trim();
		},
		duplicate() { document.querySelector('.layers li.active button[title="Duplicate layer"]').click(); },
		copyLayer() {
			document.querySelector('.layers .clip button').click();
		},
		/** Paste the copied layer as a new one, its path given \`n\` points. */
		pasteWithPoints(n) {
			const key = 'invisible-fx.layer-clipboard';
			const layer = JSON.parse(localStorage.getItem(key));
			const b = layer.config.behaviors.find((x) => x.type === 'fxPath');
			// All but the last packed into 128 px, the last 470 px past them: the long last segment
			// has no anchor over it, so a double-click there reaches the curve.
			b.config.curve.points = Array.from({ length: n }, (_, i) =>
				({ x: i === n - 1 ? 300 : -300 + i * 0.5, y: 0 }));
			localStorage.setItem(key, JSON.stringify(layer));
			[...document.querySelectorAll('.layers .clip button')].find((x) => x.textContent.includes('Paste')).click();
		},
		plusDisabled() {
			return [...document.querySelectorAll('table.pathpoints td.acts button:first-child')].map((x) => x.disabled);
		},
		sliderRow(label) {
			const r = row(label);
			const [range, box] = r.querySelectorAll('input');
			return { range: Number(range.value), max: Number(range.max), box: Number(box.value) };
		},
		setSlider(label, kind, value) {
			const el = row(label).querySelectorAll('input')[kind === 'range' ? 0 : 1];
			el.value = String(value); fire(el, kind === 'range' ? 'input' : 'change');
		},
		cellText(row, col) {
			return document.querySelectorAll('table.pathpoints tbody tr')[row].querySelectorAll('input')[col].value;
		},
		setCell(row, col, value) {
			const tr = document.querySelectorAll('table.pathpoints tbody tr')[row];
			const el = tr.querySelectorAll('input')[col];
			el.value = String(value); fire(el, 'change');
		},
		/** The selected layer's live emitter's path, as the runtime read it. */
		livePath() {
			const em = fxPage.emitters.find((e) => e.parent && e.getBehavior('fxPath'));
			const b = em?.getBehavior('fxPath');
			return b ? { emit: b.path.emit, follow: b.path.follow.enabled, points: b.path.curve.points.length } : null;
		},
		hasPathEmitter() { return fxPage.emitters.some((e) => e.parent && e.getBehavior('fxPath')); },
		worldPos() {
			const canvas = document.querySelector('.stage canvas');
			const app = fxPage.apps.find((a) => a.canvas === canvas);
			const w = app?.stage.children[0];
			return w ? { x: w.position.x, y: w.position.y } : null;
		},
	};
})()`;

let browser;
let failed = false;
try {
	const html = await buildLauncherPage({
		entry: 'fxPage/entry.ts',
		name: 'fx-path-page',
		outDir: join(dir, 'out'),
		title: 'fx path page',
	});
	console.log(`fx page built (${((Date.now() - began) / 1000).toFixed(1)} s)`);
	browser = await launchChrome({ name: 'fx-path-page', args: ['--window-size=1600,1000'] });
	await browser.send('Page.navigate', { url: `${pathToFileURL(html).href}?bake=1` });
	const ev = (expr) => browser.evaluate(expr);
	const until = Date.now() + 30_000;
	while (
		!(await ev(`!!document.querySelector('.stage canvas') && !!window.fxPage`).catch(() => false))
	) {
		if (Date.now() > until) throw new Error('timed out waiting for the stage');
		await sleep(100);
	}
	await ev(DRIVER);
	const mouse = async (type, x, y, extra = {}) =>
		browser.send('Input.dispatchMouseEvent', {
			type,
			x,
			y,
			button: 'left',
			buttons: type === 'mouseReleased' ? 0 : 1,
			clickCount: 1,
			...extra,
		});

	await ev(`pathDrive.pickFirst()`);
	await sleep(300);
	check('no path drawn before one is used', (await ev(`pathDrive.anchors().length`)) === 0);
	await ev(`pathDrive.choose('Kind', 'path')`);
	await sleep(800);
	let live = await ev(`pathDrive.livePath()`);
	check(
		'Spawn → Path: the emitter spawns along an fxPath',
		live?.emit === 'along',
		JSON.stringify(live),
	);
	let anchors = await ev(`pathDrive.anchors()`);
	check('the curve and its three points are drawn over the stage', anchors.length === 3);

	const rowsBefore = await ev(`pathDrive.rows()`);
	const worldBefore = await ev(`pathDrive.worldPos()`);
	const a0 = anchors[0];
	await mouse('mouseMoved', a0.x, a0.y, { buttons: 0 });
	await mouse('mousePressed', a0.x, a0.y);
	for (let i = 1; i <= 5; i++) await mouse('mouseMoved', a0.x + i * 8, a0.y + i * 6);
	await mouse('mouseReleased', a0.x + 40, a0.y + 30);
	await sleep(500);
	const rowsAfter = await ev(`pathDrive.rows()`);
	const worldAfter = await ev(`pathDrive.worldPos()`);
	check(
		'dragging a point on the stage moves it in the doc by the drag',
		Math.round(rowsAfter[0][0] - rowsBefore[0][0]) === 40 &&
			Math.round(rowsAfter[0][1] - rowsBefore[0][1]) === 30,
		`${rowsBefore[0].slice(0, 2)} → ${rowsAfter[0].slice(0, 2)}`,
	);
	check(
		'…and does not pan the stage',
		worldBefore.x === worldAfter.x && worldBefore.y === worldAfter.y,
	);

	const onCurve = await ev(`pathDrive.curvePoint(0.25)`);
	await mouse('mouseMoved', onCurve.x, onCurve.y, { buttons: 0 });
	await mouse('mousePressed', onCurve.x, onCurve.y);
	await mouse('mouseReleased', onCurve.x, onCurve.y);
	await mouse('mousePressed', onCurve.x, onCurve.y, { clickCount: 2 });
	await mouse('mouseReleased', onCurve.x, onCurve.y, { clickCount: 2 });
	await sleep(500);
	anchors = await ev(`pathDrive.anchors()`);
	const added = await ev(`pathDrive.rows()`);
	check('double-clicking the curve adds a point there', anchors.length === 4 && added.length === 4);
	const mid = anchors[1];
	check(
		'…between the first two points, where it was clicked',
		Math.hypot(mid.x - onCurve.x, mid.y - onCurve.y) < 3,
		`${mid.x.toFixed(0)},${mid.y.toFixed(0)} vs ${onCurve.x.toFixed(0)},${onCurve.y.toFixed(0)}`,
	);
	await mouse('mousePressed', mid.x, mid.y, { modifiers: 1 });
	await mouse('mouseReleased', mid.x, mid.y, { modifiers: 1 });
	await sleep(500);
	check('Alt-clicking a point removes it', (await ev(`pathDrive.anchors().length`)) === 3);

	await ev(`pathDrive.setCell(2, 1, 77)`);
	await sleep(400);
	check('a points-table number edits the point', (await ev(`pathDrive.rows()[2][1]`)) === 77);

	await ev(`pathDrive.choose('Model', 'follow')`);
	await sleep(600);
	live = await ev(`pathDrive.livePath()`);
	check('Movement → Follow path: particles follow it', live?.follow === true, JSON.stringify(live));
	await ev(`pathDrive.choose('Kind', 'circle')`);
	await sleep(600);
	live = await ev(`pathDrive.livePath()`);
	check(
		'back to a Circle spawn, the path stays for Follow (born at the circle)',
		live?.emit === 'shape' && live.follow && (await ev(`pathDrive.anchors().length`)) === 3,
		JSON.stringify(live),
	);
	if (keepAt) {
		await ev(`pathDrive.choose('Curve', 'bezier')`);
		await sleep(1500);
		const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(join(dir, 'follow.png'), Buffer.from(shot.data, 'base64'));
		await ev(`pathDrive.choose('Curve', 'catmullRom')`);
	}
	await ev(`pathDrive.check('Move the emitter along a path', true)`);
	await sleep(600);
	live = await ev(`pathDrive.livePath()`);
	check(
		'"Move the emitter along a path" turns on travel',
		live?.emit === 'travel',
		JSON.stringify(live),
	);

	await ev(`pathDrive.setSlider('Travel time (s)', 'box', 50)`);
	await sleep(400);
	let travel = await ev(`pathDrive.sliderRow('Travel time (s)')`);
	check(
		'a travel time past the slider (50 s) is shown on it, not pinned to its end',
		travel.box === 50 && travel.range === 50 && travel.max >= 50,
		JSON.stringify(travel),
	);
	await ev(`pathDrive.setSlider('Travel time (s)', 'range', 50)`);
	await sleep(400);
	travel = await ev(`pathDrive.sliderRow('Travel time (s)')`);
	check('…and touching the slider keeps it', travel.box === 50, JSON.stringify(travel));

	await ev(`pathDrive.check('Move the emitter along a path', false)`);
	await ev(`pathDrive.choose('Model', 'speed')`);
	await sleep(600);
	check(
		'with nothing using it, the path leaves the config and the stage',
		!(await ev(`pathDrive.hasPathEmitter()`)) && (await ev(`pathDrive.anchors().length`)) === 0,
	);

	// --- 7–9: edits that must write nothing, cancelled and cross-layer drags, the point cap -------
	const touch = (type, x, y) =>
		browser.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchCancel' ? [] : [{ x, y, id: 7 }],
		});
	const near = (a, b) => Math.abs(a.x - b.x) < 1.5 && Math.abs(a.y - b.y) < 1.5;
	const sameRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);

	await ev(`pathDrive.choose('Kind', 'path')`);
	await sleep(800);
	const layerA = await ev(`pathDrive.selectedLayer()`);
	const rowsA = await ev(`pathDrive.rows()`);
	await ev(`pathDrive.setCell(1, 0, '')`);
	await sleep(400);
	check(
		'a blank points-table cell writes nothing (not 0) and shows the value again',
		sameRows(await ev(`pathDrive.rows()`), rowsA) &&
			(await ev(`pathDrive.cellText(1, 0)`)) === String(rowsA[1][0]),
		JSON.stringify(await ev(`pathDrive.rows()[1]`)),
	);

	anchors = await ev(`pathDrive.anchors()`);
	const p0 = anchors[0];
	await touch('touchStart', p0.x, p0.y);
	for (let i = 1; i <= 5; i++) await touch('touchMove', p0.x + i * 10, p0.y + i * 8);
	await sleep(300);
	const midLive = await ev(`pathDrive.livePoints()`);
	const midAnchor = (await ev(`pathDrive.anchors()`))[0];
	await touch('touchCancel');
	await sleep(500);
	const afterLive = await ev(`pathDrive.livePoints()`);
	check(
		'mid-drag, the live emitter previews the dragged point',
		midLive[0][0] === rowsA[0][0] + 50 && midLive[0][1] === rowsA[0][1] + 40,
		`${JSON.stringify(midLive)} (doc ${rowsA[0].slice(0, 2)}), anchor ${midAnchor.x.toFixed(0)},${midAnchor.y.toFixed(0)}`,
	);
	check(
		'a cancelled drag (pointercancel) writes nothing and draws the doc again',
		sameRows(await ev(`pathDrive.rows()`), rowsA) && near((await ev(`pathDrive.anchors()`))[0], p0),
	);
	check(
		'…and the live emitter has its own path back, not the preview',
		afterLive[0][0] === Math.round(rowsA[0][0]) && afterLive[0][1] === Math.round(rowsA[0][1]),
		JSON.stringify(afterLive),
	);

	await ev(`pathDrive.duplicate()`);
	await sleep(600);
	const layerB = await ev(`pathDrive.selectedLayer()`);
	await ev(`pathDrive.setCell(0, 1, 120)`);
	await sleep(500);
	const rowsB = await ev(`pathDrive.rows()`);
	const anchorsB = await ev(`pathDrive.anchors()`);
	await ev(`pathDrive.pickLayer(${JSON.stringify(layerA)})`);
	await sleep(500);
	const a0A = (await ev(`pathDrive.anchors()`))[0];
	await mouse('mouseMoved', a0A.x, a0A.y, { buttons: 0 });
	await mouse('mousePressed', a0A.x, a0A.y);
	for (let i = 1; i <= 5; i++) await mouse('mouseMoved', a0A.x + i * 8, a0A.y + i * 6);
	await ev(`pathDrive.pickLayer(${JSON.stringify(layerB)})`);
	await sleep(500);
	const shownB = await ev(`pathDrive.anchors()`);
	check(
		'switching layer mid-drag: the other layer shows its own points',
		layerB !== layerA &&
			shownB.length === anchorsB.length &&
			shownB.every((a, i) => near(a, anchorsB[i])),
		`${layerA} → ${layerB}`,
	);
	await mouse('mouseMoved', a0A.x + 60, a0A.y + 50);
	await mouse('mouseReleased', a0A.x + 60, a0A.y + 50);
	await sleep(500);
	check(
		'…and the release writes nothing into it',
		sameRows(await ev(`pathDrive.rows()`), rowsB),
		JSON.stringify(await ev(`pathDrive.rows()[0]`)),
	);
	const liveAfterSwitch = (await ev(`pathDrive.livePoints()`)).map(String).sort();
	const docFirsts = [rowsA[0], rowsB[0]]
		.map((r) => String([Math.round(r[0]), Math.round(r[1])]))
		.sort();
	check(
		'…and no live emitter keeps the dragged preview',
		JSON.stringify(liveAfterSwitch) === JSON.stringify(docFirsts),
		JSON.stringify(liveAfterSwitch),
	);
	const b0 = shownB[0];
	await mouse('mouseMoved', b0.x, b0.y, { buttons: 0 });
	await mouse('mousePressed', b0.x, b0.y);
	for (let i = 1; i <= 4; i++) await mouse('mouseMoved', b0.x + i * 5, b0.y + i * 5);
	await mouse('mouseReleased', b0.x + 20, b0.y + 20);
	await sleep(500);
	const rowsB2 = await ev(`pathDrive.rows()`);
	await ev(`pathDrive.pickLayer(${JSON.stringify(layerA)})`);
	await sleep(400);
	check(
		'the next drag moves only the layer it is on',
		Math.round(rowsB2[0][0] - rowsB[0][0]) === 20 &&
			Math.round(rowsB2[0][1] - rowsB[0][1]) === 20 &&
			sameRows(await ev(`pathDrive.rows()`), rowsA),
		`${rowsB[0].slice(0, 2)} → ${rowsB2[0].slice(0, 2)}`,
	);

	await ev(`pathDrive.copyLayer()`);
	await sleep(200);
	await ev(`pathDrive.pasteWithPoints(256)`);
	await sleep(800);
	const full = await ev(`pathDrive.rows()`);
	const plus = await ev(`pathDrive.plusDisabled()`);
	check(
		'at the cap (256 points) every + is disabled',
		full.length === 256 && plus.length === 256 && plus.every(Boolean),
		`${full.length} rows`,
	);
	const onFull = await ev(`pathDrive.curvePoint(0.6)`);
	await mouse('mouseMoved', onFull.x, onFull.y, { buttons: 0 });
	await mouse('mousePressed', onFull.x, onFull.y);
	await mouse('mouseReleased', onFull.x, onFull.y);
	await mouse('mousePressed', onFull.x, onFull.y, { clickCount: 2 });
	await mouse('mouseReleased', onFull.x, onFull.y, { clickCount: 2 });
	await sleep(600);
	check(
		'…and a double-click on the curve adds nothing (the last point is not dropped)',
		sameRows(await ev(`pathDrive.rows()`), full),
	);

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
	`\nfx-path-page: ${results.length - bad.length}/${results.length} passed (${((Date.now() - began) / 1000).toFixed(1)} s)`,
);
process.exit(failed || bad.length ? 1 : 0);
