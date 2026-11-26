// Browser gate for the rig-building workspaces, 🎞 Frame to rig and 🗺 From my sheet: full-window
// dialogs whose canvases zoom and pan through one camera (`wsCamera` … `wireWorkspaces` in view.html).
//
//   node tools/rigger-spike/rig-workspace-browser.mjs
//   node tools/rigger-spike/rig-workspace-browser.mjs --mutants   # every planted bug must fail a check
//   node tools/rigger-spike/rig-workspace-browser.mjs --mutants --only pinch   # the mutants named so
//   node tools/rigger-spike/rig-workspace-browser.mjs --png <dir>   # screenshots of the workspaces
//
// Drives the REAL view.html in a REAL Chromium at 1366×660 CSS px and a device pixel ratio of 1.25 (a
// 1366×768 laptop's window at Windows' 125%), against a fake launcher API on `sheet-rig.mjs`'s sheet
// (fixtures/sheet-rig/), with CDP's real mouse, wheel, keys, pen and touch:
//  - each workspace fills the window: its canvas takes the free space at the screen's resolution, the
//    side panel beside it, nothing wider than the window; at 1920×1080 too;
//  - the wheel zooms about the pointer (the picture's point under it stays put) on the frame stage,
//    ▭ One part and ◧ Arranged; Ctrl+wheel (a trackpad's pinch) zooms, a trackpad's small deltas pan;
//  - Space+drag, the middle button and the pen's barrel button pan by the drag, pressed on a joint
//    that stays put; two fingers pinch about their middle, the first finger's press let go;
//  - F fits, 1 is 100% (a pixel of the picture to one of the screen), + / − zoom by 1.25; the bar's
//    buttons do the same and its readout says the zoom;
//  - at 400% a joint grabbed off its middle lands on the picture pixel under the pointer, within
//    0.5 px, on ▭ One part and on the frame stage; a part dragged on ◧ Arranged moves by the drag
//    over the zoom;
//  - a joint dot is one size on the screen at 100% and at 400%;
//  - the zoom stays when the dialog closes (Esc) and opens again, and ◧ Arranged keeps its own across
//    ▭ One part and back;
//  - precision: a click picks a joint (its name and numbers at the top of the side panel); the arrows
//    move it one pixel of the picture, Shift ten, on ▭ One part and the frame stage, and on ◧ Arranged
//    move the picked part with the parts it holds; x / y typed put it there, a turn typed turns an
//    arranged part about its first joint; the joint or part under the pointer is ringed and named;
//    while a joint is dragged a loupe beside the pointer shows the picture round it pixel for pixel,
//    gone on release; Alt-drag snaps a ▭ One part joint onto the drawing's edge and lets an arranged
//    part go unsnapped; [ and ] size 🎞's brush, a size on the screen (a quarter of the frame's
//    pixels at 400% of what it covers at 100%);
//  - the page threw nothing.
// The frame stage is shown a painted frame whose joints are put straight into `f2r` (a clip needs the
// tracker; `frame-rig-browser.mjs` covers that path), so the brush (which needs a cut) is checked by
// its size alone; everything else goes through the page.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const VIEW = join(STATIC, 'rigger/view.html');
const SELF = fileURLToPath(import.meta.url);

/** Page mutants: each must turn this gate red. */
const MUTANTS = [
	[
		'the workspace a box, not the window',
		'.rigModal.ws > .modal-box { margin:0; width:100%; height:100%;',
		'.rigModal.ws > .modal-box { margin:0; width:60%; height:100%;',
	],
	[
		'the canvas drawn at CSS resolution',
		'const w = Math.round(wsPx(r.width)), h = Math.round(wsPx(r.height));',
		'const w = Math.round(r.width), h = Math.round(r.height);',
	],
	[
		'the wheel zooms about the middle, not the pointer',
		'else wsZoomAt(cam, wsAt(cv, e), Math.exp(',
		'else wsZoomAt(cam, [cv.width / 2, cv.height / 2], Math.exp(',
	],
	[
		"a trackpad's two-finger move zooms",
		'(dx !== 0 || Math.abs(dy) < 50)',
		'(dx !== 0)',
	],
	[
		'Space+drag does not pan',
		'const panning = e.button === 1 || (e.button === 0 && wsSpace);',
		'const panning = e.button === 1;',
	],
	[
		'the middle button does not pan',
		'const panning = e.button === 1 || (e.button === 0 && wsSpace);',
		'const panning = e.button === 0 && wsSpace;',
	],
	[
		"the pen's barrel is the right button on a workspace",
		'const pans = surface.id === "cv" || surface.classList.contains("wsCanvas");',
		'const pans = surface.id === "cv";',
	],
	[
		'a pan drags the joint under it too',
		'e.preventDefault(); e.stopImmediatePropagation();\n    if (!panning',
		'e.preventDefault();\n    if (!panning',
	],
	['a pinch does nothing', 'if (touches.size === 2){', 'if (false){'],
	[
		'a pinch drags the joint under the first finger too',
		'penDragCancel([...touches.values()][0]); pinch',
		'pinch',
	],
	['F does not fit', 'if (cmd === "fit"){ st.fit(); st.draw(); return; }', 'if (cmd === "fit"){ st.draw(); return; }'],
	[
		'100% is a pixel of the canvas, not of the screen',
		'cmd === "one" ? wsPx(1) / cam.k',
		'cmd === "one" ? 1 / cam.k',
	],
	[
		'a dragged joint jumps to the pointer (no grab offset)',
		'let moved = [Math.round(((x - b.x) / b.k + dr.off[0]) * 10) / 10, Math.round(((y - b.y) / b.k + dr.off[1]) * 10) / 10];',
		'let moved = [Math.round(((x - b.x) / b.k) * 10) / 10, Math.round(((y - b.y) / b.k) * 10) / 10];',
	],
	[
		'the frame stage ignores the camera',
		'const { k, x, y } = wsFollow(WS_CAM.f2r, cv, w + "x" + h, [0, 0, w, h], 8);',
		'const { k, x, y } = wsFit(wsCamera(), cv, [0, 0, w, h], 8);',
	],
	[
		'◧ Arranged reads the pointer in CSS px',
		'return [(ev.clientX - r.left) * av.width / r.width, (ev.clientY - r.top) * av.height / r.height];',
		'return [ev.clientX - r.left, ev.clientY - r.top];',
	],
	[
		'a joint dot grows with the zoom',
		'g.arc(px, py, wsPx(6), 0, Math.PI * 2)',
		'g.arc(px, py, wsPx(6) * b.k / wsPx(1), 0, Math.PI * 2)',
	],
	['◧ Arranged forgets its zoom when the dialog opens again', 'const k = !s2r.aview && cam.manual ? cam.k : null;', 'const k = null;'],
	[
		'◧ Arranged forgets its zoom on ▭ One part and back',
		'if (s2r.aview && !s2r.aview.manual) s2r.aview = null;',
		's2r.aview = null;',
	],
	['a click on a joint picks nothing', 's2r.joint = { part: sel.part, j: best };', ''],
	[
		'an arrow moves a joint half a pixel',
		'm.joints[j] = [wsTenth(m.joints[j][0] + dx), wsTenth(m.joints[j][1] + dy)];',
		'm.joints[j] = [wsTenth(m.joints[j][0] + dx / 2), wsTenth(m.joints[j][1] + dy / 2)];',
	],
	['Shift+arrow moves five', 'n = e.shiftKey ? 10 : 1;', 'n = e.shiftKey ? 5 : 1;'],
	["🎞 an arrow moves a joint in the frame's 0–1, not its pixels", 'h.move(dx / w, dy / hh);', 'h.move(dx / 100, dy / 100);'],
	['◧ an arrow leaves the parts the picked one holds', 'const parts = [it.part].concat(s2rBelow(it.part));', 'const parts = [it.part];'],
	['a typed turn turns about the middle', 'o = s2rHandle(it).pivot,', 'o = it.place.at,'],
	['a number typed in the side panel ignored', 'i.onchange = () => wsSelSet(dialog, f, Number(i.value));', 'i.onchange = () => {};'],
	['what is under the pointer never looked for', 'const hover = e.buttons || pan ? st.hover : st.hoverAt(st.at);', 'const hover = null;'],
	['▭ the joint under the pointer not ringed', 'if (j === wsSt("s2rStage").hover) wsRing(', 'if (false) wsRing('],
	['🎞 the joint under the pointer not named', 'if (picked === h || st.hover === key) wsLabel(', 'if (picked === h) wsLabel('],
	['no loupe', 'if (!l){ el.style.display = "none"; return; }', 'if (true){ el.style.display = "none"; return; }'],
	[
		'▭ the loupe two pixels off its joint',
		'at: d.prop ? d.prop.at : d.m.joints[d.joint], imgs: [d.c]',
		'at: d.prop ? d.prop.at : [d.m.joints[d.joint][0] + 2, d.m.joints[d.joint][1]], imgs: [d.c]',
	],
	['🎞 the loupe two pixels off its joint', 'return { at: [d.h.at[0] * w, d.h.at[1] * h],', 'return { at: [d.h.at[0] * w + 2, d.h.at[1] * h],'],
	['Alt never snaps a joint', 'if (wsAlt) moved = s2rSnap(dr, moved, b.k) || moved;', ''],
	['Alt does not let a part go unsnapped', 'const to = !wsAlt && first && target', 'const to = first && target'],
	[
		"the brush a size in the frame's pixels",
		'function f2rBrushRadius(){ return wsPx(Number($("#f2rRadius").value)) / f2rBox().k; }',
		'function f2rBrushRadius(){ return Number($("#f2rRadius").value); }',
	],
	['[ and ] do nothing', 'f2rBrushStep(e.key === "]");', 'void 0;'],
];

if (process.argv.includes('--mutants')) {
	const src = readFileSync(VIEW, 'utf8');
	const tmp = mkdtempSync(join(tmpdir(), 'rig-workspace-mutants-'));
	const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
	const picked = MUTANTS.filter(([what]) => what.includes(only));
	let caught = 0;
	console.log('rig-workspace-browser mutants (each must fail a check):');
	for (const [what, from, to] of picked) {
		const n = src.split(from).length - 1;
		if (n !== 1) {
			console.log(`  ✗ ${what}: its text is in view.html ${n} times — the mutant is stale`);
			continue;
		}
		const file = join(tmp, 'view.html');
		writeFileSync(file, src.replace(from, to));
		const run = spawnSync(process.execPath, [SELF], { env: { ...process.env, RWS_HTML: file }, encoding: 'utf8' });
		const red = run.status !== 0;
		if (red) caught++;
		const why = red ? (run.stdout.match(/^ {2}✗ .*$/m) || [''])[0].trim().slice(0, 110) : '';
		console.log(`  ${red ? '✓' : '✗'} ${what}${red ? ` (${why})` : ' — NOT caught'}`);
	}
	console.log(`\n${caught === picked.length ? '✅ PASS' : '✗ FAIL'} — ${caught}/${picked.length} mutants caught`);
	process.exit(caught === picked.length ? 0 : 1);
}
const html = readFileSync(process.env.RWS_HTML || VIEW, 'utf8');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'rig-workspace-browser-')), 'server.mjs');
await esbuild.build({
	stdin: {
		contents: [
			"export * from './server/rigTemplates.ts';",
			"export * from './server/rigSheetFit.ts';",
			"export * from './rigSheetMap.ts';",
		].join('\n'),
		resolveDir: join(APP, 'src/lib'),
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
	plugins: [
		{
			name: 'env',
			setup(b) {
				b.onResolve({ filter: /^\$env\/dynamic\/private$/ }, () => ({ path: 'env', namespace: 's' }));
				b.onLoad({ filter: /.*/, namespace: 's' }, () => ({ contents: 'export const env = {};', loader: 'js' }));
			},
		},
	],
});
const S = await import(pathToFileURL(out).href);

const SHEET = JSON.parse(readFileSync(join(FIX, 'sheet.json'), 'utf8'));
const SHEET_PNG = readFileSync(join(FIX, 'sheet.png'));
const MANIFEST = 'c/p/manifests/atlas_manifest_Sheet.json';
const PAGE_KEY = 'c/p/sheets/Sheet.png';
const REGIONS = SHEET.regions.map(({ name, w, h, origW, origH }) => ({ name, w, h, origW, origH }));
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.wasm': 'application/wasm',
};
const readBody = (req) =>
	new Promise((r) => {
		const parts = [];
		req.on('data', (c) => parts.push(c));
		req.on('end', () => r(JSON.parse(Buffer.concat(parts).toString() || '{}')));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const json = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/api/rigger/templates') return json({ templates: S.rigTemplateList() });
		if (p === '/api/rigger/atlases')
			return json({ atlases: [{ manifestKey: MANIFEST, label: 'Sheet', regions: REGIONS.map((r) => r.name) }] });
		if (p === '/api/editor/regions' && url.searchParams.get('sheet') === MANIFEST)
			return json({
				assetKey: MANIFEST,
				pageKey: PAGE_KEY,
				pageVersion: 'v1',
				pageWidth: SHEET.width,
				pageHeight: SHEET.height,
				regions: SHEET.regions,
			});
		if (p === '/api/editor/asset' && url.searchParams.get('key') === PAGE_KEY) return send(200, 'image/png', SHEET_PNG);
		if (p === '/api/rigger/from-sheet') return json({ sheet: null, etag: null });
		if (p === '/api/rigger/from-sheet/preview') {
			const parsed = S.parseSheetMapping((await readBody(req)).sheet);
			if ('problem' in parsed) return json({ message: parsed.problem }, 400);
			const pv = S.sheetPreview(S.HALF_BODY, REGIONS, parsed.mapping);
			return pv.ok ? json(pv.value) : json({ message: pv.problem }, 400);
		}
		if (p === '/rig-viewer/skeletons') return json({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: [] });
		if (p === '/api/rigger/save' && req.method === 'GET') return json({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e && e.stack));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await launchChrome({
	name: 'rig-workspace',
	url: `http://127.0.0.1:${server.address().port}/`,
	args: ['--window-size=1366,768', '--mute-audio'],
});
const { evaluate, waitFor, send, pageLog } = browser;
const PNG = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
async function shot(name) {
	if (!PNG) return;
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(join(PNG, name), Buffer.from(data, 'base64'));
}

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) pass++;
	else fail++;
	console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
	return cond;
};
const q = JSON.stringify;
const near = (a, b, e) => Math.abs(a - b) <= e;
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DPR = 1.25;
const frames = (n = 2) =>
	evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const viewport = async (width, height, deviceScaleFactor) => {
	await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
	await frames(3);
};

// Real input, in CSS px.
const MASK = { left: 1, right: 2, middle: 4, none: 0 };
const mouse = (type, [x, y], extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
async function drag(from, to, { button = 'left', pointerType = 'mouse', steps = 6 } = {}) {
	await mouse('mouseMoved', from, { pointerType });
	await mouse('mousePressed', from, { button, buttons: MASK[button], clickCount: 1, pointerType });
	for (let i = 1; i <= steps; i++)
		await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps], {
			button,
			buttons: MASK[button],
			pointerType,
		});
	await mouse('mouseReleased', to, { button, buttons: 0, clickCount: 1, pointerType });
	await frames(1);
}
const wheel = async (at, deltaY, { deltaX = 0, modifiers = 0 } = {}) => {
	await mouse('mouseMoved', at);
	await mouse('mouseWheel', at, { deltaX, deltaY, modifiers });
	await frames(1);
};
const KEYS = {
	Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
	f: { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, text: 'f' },
	1: { key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, text: '1' },
	'=': { key: '=', code: 'Equal', windowsVirtualKeyCode: 187, text: '=' },
	'-': { key: '-', code: 'Minus', windowsVirtualKeyCode: 189, text: '-' },
	Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
	ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
	ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
	ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
	ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
	'[': { key: '[', code: 'BracketLeft', windowsVirtualKeyCode: 219, text: '[' },
	']': { key: ']', code: 'BracketRight', windowsVirtualKeyCode: 221, text: ']' },
	Alt: { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
};
const ALT = 1, SHIFT = 8;
const keyDown = (k, modifiers = 0) => send('Input.dispatchKeyEvent', { type: KEYS[k].text ? 'keyDown' : 'rawKeyDown', modifiers, ...KEYS[k] });
const keyUp = (k, modifiers = 0) => send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...KEYS[k] });
const press = async (k, modifiers = 0) => {
	await keyDown(k, modifiers);
	await keyUp(k, modifiers);
	await frames(1);
};
/** A click (press and release, no move) at `at`; the mouse then rests there. */
const click = async (at) => {
	await mouse('mouseMoved', at);
	await mouse('mousePressed', at, { button: 'left', buttons: 1, clickCount: 1 });
	await mouse('mouseReleased', at, { button: 'left', buttons: 0, clickCount: 1 });
	await frames(1);
};
/** The side panel's number for `f` typed in: focused, replaced, then left (its change). */
async function typeSel(dialog, f, value) {
	await evaluate(`(() => { const i = document.querySelector('#${dialog}Sel input[data-f="${f}"]'); i.focus(); i.select(); return true; })()`);
	await send('Input.insertText', { text: String(value) });
	await evaluate(`document.querySelector('#${dialog}Sel input[data-f="${f}"]').blur(); true`);
	await frames(1);
}
const selPanel = (dialog) =>
	evaluate(`(() => { const b = document.getElementById("${dialog}Sel"); return { name: (b.querySelector("b") || {}).textContent || "", ...Object.fromEntries([...b.querySelectorAll("input")].map((i) => [i.dataset.f, Number(i.value)])) }; })()`);
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });

// The page's camera as the gate reads it: a picture point (its px) on the screen and back, from the
// canvas's box and the camera alone (not the page's own conversion).
const HELPERS = `(() => {
	const st = (id) => WS_STAGES.find((s) => s.id === id);
	// The wheel as the page gets it (CDP's deltas are divided by the pixel ratio on the way in).
	window.addEventListener("wheel", (e) => { __w.wheel = { dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, ctrl: e.ctrlKey, on: e.target.id }; }, true);
	window.__w = {
		cam(id) { const c = st(id).cam(); return c && { k: c.k, x: c.x, y: c.y, manual: c.manual, fitK: c.fitK }; },
		box(id) { const cv = document.getElementById(id), r = cv.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: cv.width, ch: cv.height }; },
		toClient(id, p) { const cv = document.getElementById(id), r = cv.getBoundingClientRect(), c = st(id).cam();
			return [r.left + (c.x + p[0] * c.k) * r.width / cv.width, r.top + (c.y + p[1] * c.k) * r.height / cv.height]; },
		fromClient(id, q) { const cv = document.getElementById(id), r = cv.getBoundingClientRect(), c = st(id).cam();
			return [((q[0] - r.left) * cv.width / r.width - c.x) / c.k, ((q[1] - r.top) * cv.height / r.height - c.y) / c.k]; },
		// Pixels of colour rgb (within 24) in a square of half-side h CSS px round client point q.
		ink(id, q, rgb, h) { const cv = document.getElementById(id), r = cv.getBoundingClientRect(), s = cv.width / r.width;
			const x0 = Math.round((q[0] - r.left - h) * s), y0 = Math.round((q[1] - r.top - h) * s), n = Math.round(2 * h * s);
			const d = cv.getContext("2d").getImageData(x0, y0, n, n).data; let c = 0;
			for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 24 && Math.abs(d[i + 1] - rgb[1]) < 24 && Math.abs(d[i + 2] - rgb[2]) < 24) c++;
			return c / (s * s); },
		hover(id) { return st(id).hover ?? null; },
		// Every channel of the canvas's pixels in a square of half-side h CSS px round client point q, summed.
		patch(id, q, h) { const cv = document.getElementById(id), r = cv.getBoundingClientRect(), s = cv.width / r.width;
			const d = cv.getContext("2d").getImageData(Math.round((q[0] - r.left - h) * s), Math.round((q[1] - r.top - h) * s), Math.round(2 * h * s), Math.round(2 * h * s)).data;
			let sum = 0; for (const v of d) sum += v; return sum; },
		loupe(id) { const el = document.getElementById(id).parentElement.querySelector(".wsLoupe"), r = el.getBoundingClientRect();
			return { on: getComputedStyle(el).display !== "none", c: [r.left + r.width / 2, r.top + r.height / 2], w: r.width }; },
		// The loupe against picture img round point at: each pixel within 2 of at's, its middle read in
		// the loupe (4× the zoom, 6 to 32 CSS px a pixel, off its cross) and in img over the loupe's grey.
		loupeCheck(id, img, at) {
			const el = document.getElementById(id).parentElement.querySelector(".wsLoupe"), n = el.width, lg = el.getContext("2d");
			const cv = document.getElementById(id), c = st(id).cam(), css = c.k / (cv.width / cv.getBoundingClientRect().width);
			const m = Math.max(6, Math.min(32, css * 4)) * n / 144, ig = img.getContext("2d"), cross = 3 * n / 144;
			let worst = 0, seen = 0, lo = 255, hi = 0;
			for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
				const px = Math.floor(at[0]) + dx, py = Math.floor(at[1]) + dy;
				if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
				const lx = Math.round(n / 2 + (px + 0.5 - at[0]) * m), ly = Math.round(n / 2 + (py + 0.5 - at[1]) * m);
				if (Math.abs(lx - n / 2) < cross || Math.abs(ly - n / 2) < cross) continue;
				const a = ig.getImageData(px, py, 1, 1).data, b = lg.getImageData(lx, ly, 1, 1).data, al = a[3] / 255;
				for (let k = 0; k < 3; k++) {
					const want = a[k] * al + 128 * (1 - al);
					worst = Math.max(worst, Math.abs(b[k] - want));
					lo = Math.min(lo, want); hi = Math.max(hi, want);
				}
				seen++;
			}
			return { worst, seen, spread: Math.round(hi - lo) };
		},
		zoomTo(id, p, pct) { const c = st(id).cam(), cv = document.getElementById(id); wsZoomAt(c, [c.x + p[0] * c.k, c.y + p[1] * c.k], wsPx(pct / 100) / c.k); st(id).draw(); },
		layout(modal) {
			const m = document.getElementById(modal), box = m.querySelector(".modal-box").getBoundingClientRect(), side = m.querySelector(".wsSide").getBoundingClientRect();
			const bar = m.querySelector(".wsBar").getBoundingClientRect(), mb = m.querySelector(".modal-box");
			return { w: innerWidth, h: innerHeight, box: [box.left, box.top, box.width, box.height], side: [side.left, side.width], bar: bar.height,
				wide: Math.max(document.documentElement.scrollWidth - innerWidth, mb.scrollWidth - mb.clientWidth, m.querySelector(".wsMain").scrollWidth - m.querySelector(".wsMain").clientWidth) };
		},
	};
	return true;
})()`;
const cam = (id) => evaluate(`__w.cam(${q(id)})`);
const box = (id) => evaluate(`__w.box(${q(id)})`);
const toClient = (id, p) => evaluate(`__w.toClient(${q(id)}, ${q(p)})`);
const fromClient = (id, p) => evaluate(`__w.fromClient(${q(id)}, ${q(p)})`);
const round = (p) => [Math.round(p[0]), Math.round(p[1])];

/** A workspace fills the window, its canvas the free space at the screen's resolution. */
async function fills(modal, id, label, dpr) {
	const l = await evaluate(`__w.layout(${q(modal)})`);
	const b = await box(id);
	ok(
		`${label}: the workspace fills the window (${l.w}×${l.h}), its canvas ${Math.round(b.w)}×${Math.round(b.h)} beside a ${Math.round(l.side[1])} px side panel, nothing wider than the window`,
		near(l.box[0], 0, 1) &&
			near(l.box[1], 0, 1) &&
			near(l.box[2], l.w, 1) &&
			near(l.box[3], l.h, 1) &&
			b.w >= 0.55 * l.w &&
			b.h >= 0.6 * l.h &&
			l.side[1] >= 300 &&
			l.side[0] >= b.l + b.w &&
			l.side[0] + l.side[1] <= l.w + 1 &&
			l.bar < 40 &&
			l.wide <= 0,
		q({ l, b }),
	);
	ok(
		`${label}: the canvas is drawn at the screen's resolution (×${dpr})`,
		near(b.cw, Math.round(b.w * dpr), 1) && near(b.ch, Math.round(b.h * dpr), 1),
		q(b),
	);
}

/** The wheel zooms about the pointer: the picture's point under it stays put. */
async function wheelZooms(id, label) {
	const b = await box(id);
	const at = round([b.l + b.w * 0.3, b.t + b.h * 0.35]);
	const zoom = (w) => Math.exp(-w.dy * (Math.abs(w.dy) < 50 ? 0.01 : 0.0015));
	const c0 = await cam(id), p0 = await fromClient(id, at);
	await wheel(at, -100);
	const c1 = await cam(id), p1 = await fromClient(id, at), w1 = await evaluate('__w.wheel');
	ok(
		`${label}: a wheel notch zooms in about the pointer (×${(c1.k / c0.k).toFixed(3)}; the point under it moved ${d2(p0, p1).toExponential(1)} px)`,
		w1.on === id && w1.dy < -50 && near(c1.k / c0.k, zoom(w1), 1e-9) && d2(p0, p1) < 1e-6 && c1.manual,
		q({ c0, c1, p0, p1, w1 }),
	);
	await wheel(at, 8, { modifiers: 2 });
	const c2 = await cam(id), p2 = await fromClient(id, at), w2 = await evaluate('__w.wheel');
	ok(
		`${label}: Ctrl+wheel (a trackpad's pinch) zooms about the pointer too`,
		w2.ctrl && near(c2.k / c1.k, zoom(w2), 1e-9) && d2(p0, p2) < 1e-6,
		q({ c1, c2, p2, w2 }),
	);
	// Up and down (small deltas, none sideways), then sideways.
	const [sx, sy] = [b.cw / b.w, b.ch / b.h];
	await wheel(at, 12);
	const c3 = await cam(id), w3 = await evaluate('__w.wheel');
	await wheel(at, 0, { deltaX: -5 });
	const c4 = await cam(id), w4 = await evaluate('__w.wheel');
	ok(
		`${label}: a trackpad's two-finger move pans, up and down and sideways`,
		c3.k === c2.k && w3.dx === 0 && near(c3.x, c2.x, 1e-9) && near(c3.y - c2.y, -w3.dy * sy, 1e-9) &&
			c4.k === c3.k && w4.dy === 0 && near(c4.x - c3.x, -w4.dx * sx, 1e-9) && near(c4.y, c3.y, 1e-9),
		q({ c2, c3, c4, w3, w4 }),
	);
}

/** Space+drag, the middle button and the pen's barrel pan by the drag, pressed on `on` (a joint). */
async function pans(id, label, on, joints) {
	const b = await box(id), [sx, sy] = [b.cw / b.w, b.ch / b.h];
	for (const [how, go] of [
		['Space+drag', async (a, z) => { await keyDown('Space'); await drag(a, z); await keyUp('Space'); }],
		['the middle button', (a, z) => drag(a, z, { button: 'middle' })],
		["the pen's barrel button", (a, z) => drag(a, z, { button: 'right', pointerType: 'pen' })],
	]) {
		const from = round(await toClient(id, await on()));
		const c0 = await cam(id), j0 = await joints();
		await go(from, [from[0] + 40, from[1] + 25]);
		const c1 = await cam(id), j1 = await joints();
		ok(
			`${label}: ${how} pans by the drag, from on a joint that stays put`,
			near(c1.x - c0.x, 40 * sx, 1e-6) && near(c1.y - c0.y, 25 * sy, 1e-6) && c1.k === c0.k && q(j0) === q(j1),
			q({ c0, c1, j0, j1 }),
		);
	}
}

/** F, 1, + and − and the bar's buttons. */
async function keysAndButtons(modal, id, label, size) {
	const fitted = async () => {
		const c = await cam(id), b = await box(id);
		return !c.manual && c.k === c.fitK && near(c.x + (size[0] * c.k) / 2, b.cw / 2, 1e-6) && near(c.y + (size[1] * c.k) / 2, b.ch / 2, 1e-6);
	};
	await press('1');
	const one = await cam(id);
	const readout = await evaluate(`document.querySelector("#${modal} .wsZoom").textContent`);
	ok(`${label}: 1 is 100%, a pixel of the picture to one of the screen; the readout says so`, near(one.k, DPR, 1e-9) && readout === '100%', q({ one, readout }));
	await press('=');
	const inn = await cam(id);
	await press('-');
	const back = await cam(id);
	ok(`${label}: + and − zoom by 1.25`, near(inn.k, DPR * 1.25, 1e-9) && near(back.k, DPR, 1e-9), q({ inn, back }));
	await press('f');
	ok(`${label}: F fits the picture again`, await fitted(), q(await cam(id)));
	const click = async (cmd) => {
		const r = await evaluate(`(() => { const r = document.querySelector('#${modal} .wsCamBar [data-cam="${cmd}"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
		await mouse('mouseMoved', r);
		await mouse('mousePressed', r, { button: 'left', buttons: 1, clickCount: 1 });
		await mouse('mouseReleased', r, { button: 'left', buttons: 0, clickCount: 1 });
		await frames(1);
	};
	await click('one');
	const b1 = await cam(id);
	await click('in');
	const b2 = await cam(id);
	await click('fit');
	ok(`${label}: the bar's 1:1, + and Fit buttons do the same`, near(b1.k, DPR, 1e-9) && near(b2.k, DPR * 1.25, 1e-9) && (await fitted()), q({ b1, b2 }));
}

/**
 * At 400% a joint grabbed 2 CSS px off its middle and dragged so it should land on the middle of the
 * pixel 3 right and 3 up: it lands within 0.5 px of it, in that pixel.
 */
async function jointDrag(id, label, joint, exact) {
	const j0 = await joint();
	await evaluate(`__w.zoomTo(${q(id)}, ${q(j0)}, 400)`);
	const c = await cam(id);
	const target = [Math.floor(j0[0]) + 3.5, Math.floor(j0[1]) - 2.5];
	const grab = round(await toClient(id, j0)).map((v) => v + 2);
	const gp = await fromClient(id, grab), off = [j0[0] - gp[0], j0[1] - gp[1]];
	const to = round(await toClient(id, [target[0] - off[0], target[1] - off[1]]));
	const tp = await fromClient(id, to), want = [tp[0] + off[0], tp[1] + off[1]];
	await drag(grab, to, { steps: 9 });
	const j1 = await joint();
	ok(
		`${label}: at 400% a joint dragged lands on the picture pixel under the pointer (${d2(j1, target).toFixed(3)} px from its middle, ${d2(j1, want).toFixed(3)} from where the pointer put it)`,
		near(c.k, 4 * DPR, 1e-9) &&
			d2(j1, target) < 0.5 &&
			Math.floor(j1[0]) === Math.floor(target[0]) &&
			Math.floor(j1[1]) === Math.floor(target[1]) &&
			d2(j1, want) <= exact,
		q({ j0, j1, target, want, k: c.k }),
	);
}

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("newRigBtn")', 30000);
	await viewport(1366, 660, DPR);
	// The boot splash goes with the page's first rig list; here it is taken away before any input.
	await evaluate(`(() => { window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true;
		document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); document.getElementById("newRigBtn").click(); return true; })()`);
	await waitFor(
		`!!document.querySelector('#newRigApply option[value="template:half-body"]') && !!document.querySelector('#newRigAtlas option[value=${q(MANIFEST)}]')`,
		15000,
	);
	await evaluate(`(async () => {
		document.getElementById("newRigApply").value = "template:half-body";
		document.getElementById("newRigAtlas").value = ${q(MANIFEST)};
		document.getElementById("newRigName").value = "Wsp";
		await ensureRiggerMotion();
		window.RiggerMotion.track = async (kinds, src) => ({ width: src.width, height: src.height, frames: [{ t: 0 }] });
		document.getElementById("newRigFromSheet").click();
		return true;
	})()`);
	await waitFor('document.getElementById("s2rModal").classList.contains("open") && !!s2r.sheet && !!s2r.map.upper_arm_l', 20000);
	await evaluate(HELPERS);
	await evaluate(`document.querySelector('#s2rParts [data-part="upper_arm_l"]').click(); true`);
	await frames(2);

	// ---- 🗺 From my sheet, ▭ One part --------------------------------------------------------------
	await fills('s2rModal', 's2rStage', '🗺 1366×660', DPR);
	const arm = await evaluate(`(() => { const m = s2r.map.upper_arm_l, c = s2rCanvas(m.region), names = window.RiggerMotion.SHEET_JOINTS[s2rKind("upper_arm_l")];
		return { size: [c.width, c.height], names, colours: names.map((_, i) => S2R_JOINT_COLOURS[i % S2R_JOINT_COLOURS.length]) }; })()`);
	const jointName = arm.names[arm.names.length - 1];
	const jointOf = () => evaluate(`[...s2r.map.upper_arm_l.joints[${q(jointName)}]]`);
	const allJoints = () => evaluate('JSON.parse(JSON.stringify(s2r.map.upper_arm_l.joints))');
	await wheelZooms('s2rStage', '▭ One part');
	await pans('s2rStage', '▭ One part', jointOf, allJoints);
	await keysAndButtons('s2rModal', 's2rStage', '▭ One part', arm.size);

	// A joint dot, measured at 100% and at 400% about it.
	const rgb = [1, 3, 5].map((i) => parseInt(arm.colours[arm.names.length - 1].slice(i, i + 2), 16));
	await press('1');
	const at100 = round(await toClient('s2rStage', await jointOf()));
	const dot100 = await evaluate(`__w.ink("s2rStage", ${q(at100)}, ${q(rgb)}, 24)`);
	await jointDrag('s2rStage', '▭ One part', jointOf, 0.06);
	const at400 = round(await toClient('s2rStage', await jointOf()));
	const dot400 = await evaluate(`__w.ink("s2rStage", ${q(at400)}, ${q(rgb)}, 24)`);
	ok(
		`▭ One part: a joint dot is one size on the screen at 100% and 400% (${dot100.toFixed(0)} and ${dot400.toFixed(0)} CSS px²)`,
		dot100 > 40 && dot100 < 160 && near(dot400 / dot100, 1, 0.2),
		q({ dot100, dot400 }),
	);

	// Two fingers on the joint and beside it, spread apart: the camera zooms about their middle, the
	// joint under the first finger stays.
	await press('f');
	{
		const j0 = await jointOf(), c0 = await cam('s2rStage');
		const a = round(await toClient('s2rStage', j0)), b2 = [a[0] + 90, a[1]], mid = [(a[0] + b2[0]) / 2, a[1]];
		const m0 = await fromClient('s2rStage', mid);
		await touch('touchStart', [a]);
		await touch('touchStart', [a, b2]);
		for (let i = 1; i <= 4; i++) await touch('touchMove', [[a[0] - 7.5 * i, a[1]], [b2[0] + 7.5 * i, b2[1]]]);
		await frames(1);
		await touch('touchEnd', []);
		await frames(1);
		const c1 = await cam('s2rStage'), m1 = await fromClient('s2rStage', mid), j1 = await jointOf();
		ok(
			`▭ One part: two fingers spread zoom about their middle (×${(c1.k / c0.k).toFixed(3)}), the joint under the first one stays`,
			near(c1.k / c0.k, 150 / 90, 0.02) && d2(m0, m1) < 0.05 * (90 / c0.k) && d2(j0, j1) < 1e-9,
			q({ c0, c1, m0, m1, j0, j1 }),
		);
	}

	// The selection: a click on a joint picks it (ringed, its numbers in the side panel); the arrows move
	// it a pixel of the drawing, Shift ten; a number typed puts it there.
	await press('f');
	{
		const j0 = await jointOf();
		await click(round(await toClient('s2rStage', j0)));
		const picked = await selPanel('s2r');
		await shot('rws-part-picked.png');
		await press('ArrowRight');
		const right = await jointOf();
		await press('ArrowDown', SHIFT);
		const down = await jointOf();
		await press('ArrowLeft');
		ok(
			`▭ One part: a click picks the joint (the side panel says “${picked.name}”); → moves it 1 px, Shift+↓ 10 px`,
			picked.name.includes(jointName) && near(picked.x, j0[0], 0.051) && near(picked.y, j0[1], 0.051) &&
				near(right[0] - j0[0], 1, 1e-9) && right[1] === j0[1] && near(down[1] - right[1], 10, 1e-9) && down[0] === right[0],
			q({ picked, j0, right, down }),
		);
		await typeSel('s2r', 'x', 50.3);
		const typed = await jointOf(), shown = await selPanel('s2r');
		ok('▭ One part: x typed in the side panel puts the joint there', typed[0] === 50.3 && typed[1] === down[1] && shown.x === 50.3, q({ typed, shown }));
	}
	// The name under the pointer: the other joint ringed while the pointer is on it.
	{
		const other = arm.names[0];
		const at = round(await toClient('s2rStage', await evaluate(`[...s2r.map.upper_arm_l.joints[${q(other)}]]`)));
		await mouse('mouseMoved', [at[0] + 60, at[1] + 60]);
		await frames(1);
		const off = await evaluate(`__w.patch("s2rStage", ${q(at)}, 20)`);
		await mouse('mouseMoved', at);
		await frames(1);
		const on = await evaluate(`__w.patch("s2rStage", ${q(at)}, 20)`), hover = await evaluate('__w.hover("s2rStage")');
		await mouse('mouseMoved', [at[0] + 60, at[1] + 60]);
		await frames(1);
		const back = await evaluate(`__w.patch("s2rStage", ${q(at)}, 20)`);
		ok(`▭ One part: the joint under the pointer (${hover}) is ringed, and not once it leaves`, hover === other && on > off * 1.01 && back === off, q({ hover, off, on, back }));
	}
	// Alt during a drag snaps the joint onto the drawing's edge (an inked pixel beside a clear one) or its
	// other joint; without Alt it goes where the pointer puts it.
	{
		const edge = await evaluate(`(() => { const c = s2rCanvas(s2r.map.upper_arm_l.region), e = wsEdgeOf(c), j = s2r.map.upper_arm_l.joints[${q(jointName)}];
			let best = null, d = Infinity; for (let i = 0; i < e.length; i += 2){ const dd = Math.hypot(e[i] - j[0], e[i + 1] - j[1]); if (dd < d && dd > 6){ d = dd; best = [e[i], e[i + 1]]; } } return best; })()`);
		const isEdge = (p) => evaluate(`(() => { const e = wsEdgeOf(s2rCanvas(s2r.map.upper_arm_l.region)); for (let i = 0; i < e.length; i += 2) if (e[i] === ${p[0]} && e[i + 1] === ${p[1]}) return true; return false; })()`);
		const dragTo = async (target, alt) => {
			const j0 = await jointOf(), from = round(await toClient('s2rStage', j0)), to = round(await toClient('s2rStage', target));
			if (alt) await keyDown('Alt', ALT);
			const m = alt ? ALT : 0;
			await mouse('mouseMoved', from, { modifiers: m });
			await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1, modifiers: m });
			for (let i = 1; i <= 4; i++) await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4], { button: 'left', buttons: 1, modifiers: m });
			await mouse('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1, modifiers: m });
			if (alt) await keyUp('Alt');
			await frames(1);
			return jointOf();
		};
		const near1 = [edge[0] + 1.3, edge[1] + 0.8], near2 = [edge[0] - 1.1, edge[1] + 1.4];
		const free = await dragTo(near1, false);
		const snapped = await dragTo(near2, true);
		ok(
			`▭ One part: Alt-drag snaps a joint onto the drawing's edge (${q(snapped)}); a plain drag lands where the pointer puts it`,
			snapped[0] % 1 === 0.5 && snapped[1] % 1 === 0.5 && (await isEdge(snapped)) && d2(free, near1) < 1 && !(await isEdge(free)),
			q({ edge, snapped, free }),
		);
	}
	// The loupe: beside the pointer while a joint is dragged, the drawing round the joint pixel for pixel
	// (the joint is on the drawing's edge now, so ink and clear pixels are both in what is compared).
	{
		const j0 = await jointOf(), from = round(await toClient('s2rStage', j0)), to = [from[0] + 2, from[1] + 1];
		await mouse('mouseMoved', from);
		await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
		await mouse('mouseMoved', [from[0] + 1, from[1]], { button: 'left', buttons: 1 });
		await mouse('mouseMoved', to, { button: 'left', buttons: 1 });
		await frames(1);
		const l = await evaluate('__w.loupe("s2rStage")');
		await shot('rws-part-loupe.png');
		const check = await evaluate(`__w.loupeCheck("s2rStage", s2rCanvas(s2r.map.upper_arm_l.region), [...s2r.map.upper_arm_l.joints[${q(jointName)}]])`);
		await mouse('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1 });
		await frames(1);
		const after = await evaluate('__w.loupe("s2rStage")');
		ok(
			`▭ One part: a loupe beside the pointer while a joint is dragged shows the drawing round it (${check.seen} pixels spanning ${check.spread} levels, off by ${check.worst.toFixed(1)} at most), gone on release`,
			l.on && d2(l.c, to) < 160 && check.seen >= 12 && check.spread > 40 && check.worst <= 3 && !after.on,
			q({ l, check, after }),
		);
	}

	// ---- ◧ Arranged ------------------------------------------------------------------------------------
	const clickView = async (v) => {
		const r = await evaluate(`(() => { const r = document.querySelector('#s2rView button[data-view="${v}"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
		await mouse('mouseMoved', r);
		await mouse('mousePressed', r, { button: 'left', buttons: 1, clickCount: 1 });
		await mouse('mouseReleased', r, { button: 'left', buttons: 0, clickCount: 1 });
		await frames(1);
	};
	await clickView('arranged');
	await waitFor('!!s2r.preview && !!s2r.aview && getComputedStyle(document.getElementById("s2rArrange")).display !== "none"', 15000);
	await frames(2);
	await fills('s2rModal', 's2rArrange', '◧ Arranged', DPR);
	await wheelZooms('s2rArrange', '◧ Arranged');
	{
		const place = () => evaluate('(() => { const p = s2rPlaceOf("lower_arm_r"); return [...p.at]; })()');
		const grabAt = () => evaluate('(() => { const e = s2rJointAt("lower_arm_r", "elbow"), w = s2rJointAt("lower_arm_r", "wrist"); return [e[0] + (w[0] - e[0]) * 0.4, e[1] + (w[1] - e[1]) * 0.4]; })()');
		await evaluate(`document.querySelector('#s2rParts [data-part="lower_arm_r"]').click(); true`);
		await evaluate(`__w.zoomTo("s2rArrange", ${q(await grabAt())}, 400)`);
		const b = await box('s2rArrange'), c = await cam('s2rArrange');
		const p0 = await place(), from = round(await toClient('s2rArrange', await grabAt()));
		await drag(from, [from[0] + 30, from[1] + 20], { steps: 5 });
		const p1 = await place(), [sx, sy] = [b.cw / b.w, b.ch / b.h];
		ok(
			'◧ Arranged: at 400% a part dragged moves by the drag over the zoom',
			near(c.k, 4 * DPR, 1e-9) && near(p1[0] - p0[0], (30 * sx) / c.k, 1e-6) && near(p1[1] - p0[1], (20 * sy) / c.k, 1e-6),
			q({ p0, p1, k: c.k }),
		);
	}
	{
		const before = await cam('s2rArrange');
		await clickView('part');
		await clickView('arranged');
		const after = await cam('s2rArrange');
		ok('◧ Arranged keeps its own zoom across ▭ One part and back', q(before) === q(after), q({ before, after }));
	}
	// The arrows move the picked part with the parts it holds, a pixel of the sheet (Shift ten); its
	// turn typed in the side panel turns it about its first joint, the hand with it.
	await press('f');
	{
		const placeOf = (n) => evaluate(`(() => { const p = s2rPlaceOf(${q(n)}); return { at: [...p.at], turn: p.turn }; })()`);
		const f0 = await placeOf('lower_arm_r'), h0 = await placeOf('hand_r');
		await press('ArrowUp');
		await press('ArrowLeft', SHIFT);
		const f1 = await placeOf('lower_arm_r'), h1 = await placeOf('hand_r'), panel = await selPanel('s2r');
		ok(
			`◧ Arranged: ↑ and Shift+← move the picked part (${panel.name}) 1 and 10 px of the sheet, the hand it holds with it`,
			panel.name === 'lower_arm_r' && near(f1.at[1] - f0.at[1], -1, 1e-9) && near(f1.at[0] - f0.at[0], -10, 1e-9) &&
				near(h1.at[1] - h0.at[1], -1, 1e-9) && near(h1.at[0] - h0.at[0], -10, 1e-9) && near(panel.x, f1.at[0], 0.051),
			q({ f0, f1, h0, h1, panel }),
		);
		const elbow0 = await evaluate('s2rJointAt("lower_arm_r", "elbow")');
		await typeSel('s2r', 'turn', Math.round(f1.turn) + 30);
		const f2 = await placeOf('lower_arm_r'), h2 = await placeOf('hand_r'), elbow1 = await evaluate('s2rJointAt("lower_arm_r", "elbow")');
		const want = Math.round(f1.turn) + 30;
		ok(
			'◧ Arranged: a turn typed in the side panel turns the part about its first joint, the hand with it',
			near(f2.turn, want, 1e-9) && near(h2.turn - h1.turn, want - f1.turn, 1e-9) && d2(elbow0, elbow1) < 1e-6,
			q({ f1, f2, h1, h2, elbow0, elbow1 }),
		);
	}
	// Alt lets a part go near the joint it meets without snapping onto it.
	{
		const first = await evaluate('s2rJointAt("lower_arm_r", "elbow")'), target = await evaluate('s2rJointAt("upper_arm_r", "elbow")');
		const grab = await evaluate('(() => { const e = s2rJointAt("lower_arm_r", "elbow"), w = s2rJointAt("lower_arm_r", "wrist"); return [e[0] + (w[0] - e[0]) * 0.4, e[1] + (w[1] - e[1]) * 0.4]; })()');
		const from = round(await toClient('s2rArrange', grab)), a = await toClient('s2rArrange', first), t = await toClient('s2rArrange', target);
		const to = round([from[0] + t[0] - a[0] + 3, from[1] + t[1] - a[1] + 2]);
		await keyDown('Alt', ALT);
		await mouse('mouseMoved', from, { modifiers: ALT });
		await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1, modifiers: ALT });
		for (let i = 1; i <= 5; i++) await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * i) / 5, from[1] + ((to[1] - from[1]) * i) / 5], { button: 'left', buttons: 1, modifiers: ALT });
		await mouse('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1, modifiers: ALT });
		await keyUp('Alt');
		await frames(1);
		const landed = await evaluate('s2rJointAt("lower_arm_r", "elbow")'), k = (await cam('s2rArrange')).k;
		ok(
			`◧ Arranged: Alt-dragged next to the joint it meets, a part is not snapped onto it (${(d2(landed, target) * k / DPR).toFixed(1)} screen px off)`,
			d2(landed, target) * k > 1.5 * DPR,
			q({ first, target, landed, k }),
		);
	}
	// The part under the pointer is named.
	{
		const at = round(await toClient('s2rArrange', (await evaluate('s2rPlaceOf("torso")')).at));
		await mouse('mouseMoved', at);
		await frames(1);
		const hover = await evaluate('__w.hover("s2rArrange")');
		await shot('rws-arranged-hover.png');
		ok(`◧ Arranged: the part under the pointer is named (${hover})`, typeof hover === 'string' && hover.length > 0, q(hover));
	}

	// ---- The zoom stays when the dialog closes and opens again ---------------------------------------
	// A new rig's dialog opens as the first time (its mapping guessed again), so ◧ Arranged shows a new
	// arrangement: at the zoom it had, about its middle; ▭ One part keeps its view as it was.
	{
		await evaluate('__w.zoomTo("s2rStage", [20, 20], 250)');
		const ab = await box('s2rArrange');
		await wheel(round([ab.l + ab.w / 2, ab.t + ab.h / 2]), -100);
		const keep = { part: await cam('s2rStage'), arranged: await cam('s2rArrange') };
		await press('Escape');
		const closed = await evaluate('!document.getElementById("s2rModal").classList.contains("open")');
		await evaluate('openSheetToRig(); true');
		await waitFor('document.getElementById("s2rModal").classList.contains("open") && !!s2r.aview', 15000);
		await frames(2);
		const back = { part: await cam('s2rStage'), arranged: await cam('s2rArrange') };
		ok(
			'🗺: Esc closes it; opened again, ▭ One part keeps its view and ◧ Arranged its zoom',
			closed && keep.part.manual && q(back.part) === q(keep.part) && keep.arranged.manual && back.arranged.manual && near(back.arranged.k, keep.arranged.k, 1e-9),
			q({ keep, back }),
		);
		await evaluate('closeSheetToRig(); true');
	}

	// ---- 🎞 Frame to rig: a painted frame and its joints ------------------------------------------------
	const FW = 400, FH = 600;
	await evaluate(`(() => { document.getElementById("newRigApply").value = "template:half-body"; openFrameToRig(); return true; })()`);
	await waitFor('document.getElementById("f2rModal").classList.contains("open")', 10000);
	await evaluate(`(() => {
		const c = document.createElement("canvas"); c.width = ${FW}; c.height = ${FH};
		// Every pixel its own colour, so a picture shifted by a pixel shows.
		const g = c.getContext("2d"), img = g.createImageData(${FW}, ${FH});
		for (let i = 0; i < ${FW} * ${FH}; i++){ const x = i % ${FW}, y = (i / ${FW}) | 0; img.data.set([(x * 37 + y * 11) % 256, (x * 13 + y * 29) % 256, (x * 7 ^ y * 5) % 256, 255], i * 4); }
		g.putImageData(img, 0, 0);
		const L = Array.from({ length: 33 }, () => [0.5, 0.3]);
		Object.assign(L, { 11: [0.65, 0.3], 12: [0.35, 0.3], 13: [0.72, 0.45], 14: [0.28, 0.45], 15: [0.75, 0.6], 16: [0.25, 0.6], 23: [0.6, 0.65], 24: [0.4, 0.65] });
		Object.assign(f2r, { src: { width: ${FW}, height: ${FH}, draw: () => c, close() {} }, sel: 0, frame: { pose: { landmarks: L } }, cut: null, plan: null });
		f2rDraw();
		return true;
	})()`);
	await frames(2);
	await fills('f2rModal', 'f2rStage', '🎞 1366×660', DPR);
	const elbowOf = () => evaluate(`[f2r.frame.pose.landmarks[13][0] * ${FW}, f2r.frame.pose.landmarks[13][1] * ${FH}]`);
	const pose = () => evaluate('JSON.parse(JSON.stringify(f2r.frame.pose.landmarks))');
	await wheelZooms('f2rStage', '🎞 the frame stage');
	await pans('f2rStage', '🎞 the frame stage', elbowOf, pose);
	await keysAndButtons('f2rModal', 'f2rStage', '🎞 the frame stage', [FW, FH]);
	await jointDrag('f2rStage', '🎞 the frame stage', elbowOf, 1e-6);
	await press('f');
	{
		const e0 = await elbowOf();
		await click(round(await toClient('f2rStage', e0)));
		const picked = await selPanel('f2r');
		await press('ArrowLeft');
		const e1 = await elbowOf();
		await press('ArrowUp', SHIFT);
		const e2 = await elbowOf();
		await typeSel('f2r', 'y', 300);
		const e3 = await elbowOf();
		ok(
			`🎞: a click picks the joint (the side panel says “${picked.name}”); ← moves it 1 px of the frame, Shift+↑ 10, y typed puts it there`,
			picked.name === 'elbow_r' && near(e1[0] - e0[0], -1, 1e-9) && near(e1[1], e0[1], 1e-9) && near(e2[1] - e1[1], -10, 1e-9) &&
				near(e3[1], 300, 1e-9) && near(e3[0], e2[0], 1e-9),
			q({ picked, e0, e1, e2, e3 }),
		);
	}
	{
		const sh = round(await toClient('f2rStage', await evaluate(`[f2r.frame.pose.landmarks[11][0] * ${FW}, f2r.frame.pose.landmarks[11][1] * ${FH}]`)));
		const tag = [sh[0] + 40, sh[1] - 16];
		await mouse('mouseMoved', [sh[0] - 80, sh[1] + 80]);
		await frames(1);
		const off = await evaluate(`__w.patch("f2rStage", ${q(tag)}, 14)`);
		await mouse('mouseMoved', sh);
		await frames(1);
		const on = await evaluate(`__w.patch("f2rStage", ${q(tag)}, 14)`), hover = await evaluate('__w.hover("f2rStage")');
		ok(`🎞: the joint under the pointer is named beside it (${hover})`, hover === 'pose:11' && Math.abs(on - off) > off * 0.02, q({ hover, off, on }));
	}
	{
		const e0 = await elbowOf(), from = round(await toClient('f2rStage', e0));
		await mouse('mouseMoved', from);
		await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
		await mouse('mouseMoved', [from[0] + 4, from[1] + 7], { button: 'left', buttons: 1 });
		await mouse('mouseMoved', [from[0] + 8, from[1] + 13], { button: 'left', buttons: 1 });
		await frames(1);
		const l = await evaluate('__w.loupe("f2rStage")');
		await shot('rws-frame-loupe.png');
		const check = await evaluate(`__w.loupeCheck("f2rStage", f2r.src.draw(0), [f2r.frame.pose.landmarks[13][0] * ${FW}, f2r.frame.pose.landmarks[13][1] * ${FH}])`);
		await mouse('mouseReleased', [from[0] + 8, from[1] + 13], { button: 'left', buttons: 0, clickCount: 1 });
		await frames(1);
		const after = await evaluate('__w.loupe("f2rStage")');
		ok(
			`🎞: a loupe beside the pointer while a joint is dragged shows the frame round it (${check.seen} pixels, off by ${check.worst.toFixed(1)} at most), gone on release`,
			l.on && check.seen >= 12 && check.spread > 40 && check.worst <= 3 && !after.on,
			q({ l, check, after }),
		);
	}
	{
		const radius = () => evaluate('({ r: Number(document.getElementById("f2rRadius").value), f: f2rBrushRadius() })');
		const r0 = await radius();
		await press(']');
		const up = await radius();
		await press('[');
		await press('[');
		const down = await radius();
		await press('1');
		const at100 = await radius();
		await evaluate(`__w.zoomTo("f2rStage", ${q(await elbowOf())}, 400)`);
		const at400 = await radius();
		ok(
			`🎞: ] and [ change the brush's size (${r0.r} → ${up.r} → ${down.r}); it is a size on the screen, so at 400% it paints a quarter of the frame's pixels it does at 100%`,
			up.r > r0.r && down.r < r0.r && near(at100.f, (down.r * DPR) / DPR, 1e-9) && near(at400.f * 4, at100.f, 1e-9),
			q({ r0, up, down, at100, at400 }),
		);
	}
	{
		const keep = await cam('f2rStage');
		await press('Escape');
		await evaluate('openFrameToRig(); true');
		await waitFor('document.getElementById("f2rModal").classList.contains("open")', 10000);
		await frames(2);
		const back = await cam('f2rStage');
		ok('🎞: closed and opened again, it keeps its zoom', back.manual && q(back) === q(keep), q({ keep, back }));
	}

	// ---- A bigger screen at 100% ------------------------------------------------------------------------
	await viewport(1920, 1080, 1);
	await fills('f2rModal', 'f2rStage', '🎞 1920×1080', 1);
	await press('1');
	ok('🎞 1920×1080: 1 is 100% at a pixel ratio of 1', near((await cam('f2rStage')).k, 1, 1e-9), q(await cam('f2rStage')));
	await evaluate('closeFrameToRig(); openSheetToRig(); true');
	await waitFor('document.getElementById("s2rModal").classList.contains("open")', 10000);
	await frames(2);
	await fills('s2rModal', 's2rArrange', '🗺 1920×1080', 1);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok('no alert', (await evaluate('window.__alerts.length')) === 0, await evaluate('window.__alerts.join(" | ")'));
} catch (e) {
	ok('the harness threw', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
} finally {
	await browser.close();
	server.close();
}
if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
console.log(`\n${fail ? '✗ FAIL' : '✅ PASS'} — rig workspaces ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
