// Browser gate for pen and touch drags in the Rigger.
//
//   node tools/rigger-spike/pen-drag-browser.mjs
//   node tools/rigger-spike/pen-drag-browser.mjs --mutants   # every planted bug must fail a check
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W, the way the owner's animator met the bug ("a pen tap selects on
// the canvas, but dragging with the pen does nothing"). Chrome on Windows hands the page a pen tip
// on the tablet as TOUCH input, so the pen tip here is CDP touch (`Input.dispatchTouchEvent`); the
// pen hovering or with its barrel button down comes as a mouse whose pointerType is "pen"
// (`Input.dispatchMouseEvent`). Each drag runs with the touch tip, the pen, and the mouse, and the
// mouse's result is the reference the other two must match:
//   - Setup: a drag on a bone moves it;
//   - Animate: a drag on a bone keys its translate at the playhead, a drag on the gizmo's ring keys
//     its rotate;
//   - a drag on a gizmo axis moves the bone along that axis only;
//   - box select: a drag on the graph editor's background and a Shift-drag on a dopesheet lane
//     select the keys inside;
//   - a drag on a dopesheet key retimes it, and the barrel button on one opens its easing menu;
//   - a press is played once (no second press from the browser's own mouse events);
//   - the barrel button pans the stage, even over a bone, and opens no menu (the mouse's right
//     button still does);
//   - the splitter, the Picker's board, the frame-to-rig stage and 🗺 From my sheet's two stages
//     take a pen drag; every drag surface says `touch-action:none`;
//   - a press on the stage takes the focus off a field being typed in, as the mouse's does, so the
//     field's change lands before the drag.
// What it does NOT cover: a real Wacom (CDP has no pen touch and no eraser button), Windows Ink's
// press-and-hold (headless Chrome turns no hold into a menu; the stage blocks a pen's menu either way).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const SHIPPED = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const W_JSON = readFileSync(join(SYMBOLS3, 'W.json'), 'utf8');

let html = SHIPPED;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const ENTRIES = [{ id: 0, name: 'W', folder: 'W', dir_b64: b64('W'), skeleton_file: 'W.json', atlas_file: 'symbols3.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false }];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v) => send(200, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (url.searchParams.get('dir') !== b64('W')) return send(404, 'text/plain', 'no such bundle');
			if (name === 'W.json') return send(200, MIME['.json'], W_JSON);
			if (/^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name))) return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') return jsonOut({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) return jsonOut({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const browser = await launchChrome({ name: 'pen-drag', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, send, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const lerp = (a, b, i, n) => Math.round(a + ((b - a) * i) / n);
const STEPS = 8;
const MASK = { left: 1, right: 2, middle: 4 };
const SHIFT = 8;

/** One drag from `from` to `to` in CSS px, by `how`: the pen tip (touch), the pen as a mouse, or the mouse. */
async function drag(how, from, to, { button = 'left', modifiers = 0, during } = {}) {
	if (how === 'tip') {
		const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts, modifiers });
		await touch('touchStart', [{ x: from.x, y: from.y, id: 1 }]);
		for (let i = 1; i <= STEPS; i++) await touch('touchMove', [{ x: lerp(from.x, to.x, i, STEPS), y: lerp(from.y, to.y, i, STEPS), id: 1 }]);
		await frames(1); // pointer moves are dispatched on the next frame
		if (during) await during();
		await touch('touchEnd', []);
	} else {
		const pointerType = how === 'pen' ? 'pen' : 'mouse';
		const mouse = (type, pt, extra) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, pointerType, modifiers, ...extra });
		await mouse('mouseMoved', from, {});
		await mouse('mousePressed', from, { button, buttons: MASK[button], clickCount: 1 });
		for (let i = 1; i <= STEPS; i++) await mouse('mouseMoved', { x: lerp(from.x, to.x, i, STEPS), y: lerp(from.y, to.y, i, STEPS) }, { button, buttons: MASK[button] });
		await frames(1);
		if (during) await during();
		await mouse('mouseReleased', to, { button, buttons: 0, clickCount: 1 });
	}
	await frames(2);
}
const HOW = ['tip', 'pen', 'mouse'];
const LABEL = { tip: 'pen tip (touch)', pen: 'pen (as a mouse)', mouse: 'mouse' };

// Page-side helpers, installed once per load.
const HELPERS = `(() => {
	const cv = document.getElementById("cv");
	window.__t = {
		screen(wx, wy) {
			const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = new RIG.Vector3(wx, wy, 0);
			renderer.camera.worldToScreen(v, cv.width, cv.height);
			return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
		},
		boneAt(name) { const b = skeleton.findBone(name); return this.screen(b.worldX, b.worldY); },
		// A bone whose origin is in the middle of the stage and picks that bone.
		pickable() {
			const r = cv.getBoundingClientRect();
			for (let i = 1; i < skeleton.bones.length; i++) {
				const b = skeleton.bones[i], p = this.screen(b.worldX, b.worldY);
				if (p.x < r.left + 200 || p.x > r.right - 200 || p.y < r.top + 200 || p.y > r.bottom - 200) continue;
				if (stageBoneAt({ clientX: p.x, clientY: p.y }) === i) return b.data.name;
			}
			return null;
		},
		setup(name) { const b = rawDoc.bones.find((x) => x.name === name); return { x: b.x || 0, y: b.y || 0 }; },
		keys(name, ch) { const t = ((rawDoc.animations[curAnim] || {}).bones || {})[name]; return ((t && t[ch]) || []).map((k) => ({ t: k.time || 0, x: k.x, y: k.y, v: k.value })); },
		select(name) { selectBone(name == null ? null : skeletonData.bones.findIndex((b) => b.name === name)); },
		seek(t) { animTime = t; syncPlayhead(); renderTimeline(); },
		gizmoPoint(id, deg) {
			const c = gizmoCenter(), G = gizmoGeom();
			if (id === "ring") { const a = deg * Math.PI / 180; return this.screen(c.x + Math.cos(a) * G.ringR, c.y + Math.sin(a) * G.ringR); }
			const p = gizmoParts(selBone).find((x) => x.id === id), m = (G.axisFrom + G.axisTo) / 2;
			return { at: this.screen(c.x + p.dir[0] * m, c.y + p.dir[1] * m), dir: p.dir };
		},
		dot(name, t) {
			for (const d of document.querySelectorAll("#timeline .tl-key")) {
				const tr = dopeTrackById[d.dataset.tid];
				if (!tr || tr.name !== name || Math.abs(parseFloat(d.dataset.t) - t) > 1e-4) continue;
				d.scrollIntoView({ block: "nearest", inline: "nearest" });
				const r = d.getBoundingClientRect();
				return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
			}
			return null;
		},
		// A box drag over el in the timeline: from the first point near its visible top-left where a press
		// lands on el itself (or on what hit accepts), clear of the splitter a touch would snap to, to its
		// visible bottom-right short of the scrollbars.
		box(el, hit) {
			const a = el.getBoundingClientRect(), b = document.getElementById("timeline").getBoundingClientRect();
			const l = Math.max(a.left, b.left), t = Math.max(a.top, b.top), r = Math.min(a.right - 1, b.right - 16), bt = Math.min(a.bottom - 1, b.bottom - 16);
			for (let y = t + Math.min(8, a.height / 2); y < bt; y += 3)
				for (let x = l + 24; x < Math.min(r, l + 240); x += 3) {
					const h = document.elementFromPoint(x, y);
					if (h === el || (hit && el.contains(h) && hit(h))) return { from: { x: Math.round(x), y: Math.round(y) }, to: { x: Math.round(r), y: Math.round(Math.min(bt, y + a.height)) } };
				}
			return null;
		},
		press: [], menus: [],
	};
	cv.addEventListener("mousedown", (e) => __t.press.push(e.isTrusted ? "browser" : "played"), true);
	window.addEventListener("contextmenu", (e) => { if (e.target === cv) __t.menus.push({ type: e.pointerType || "", prevented: e.defaultPrevented }); });
	return true;
})()`;
const T = (expr) => evaluate(`__t.${expr}`);

async function openW() {
	await evaluate('location.reload(); true').catch(() => {});
	await wait(300);
	await waitFor('typeof skeletons !== "undefined" && skeletons.length === 1', 30000);
	// 🧲 Snap to bone off: W's sparks share one origin, and a drag measured against the mouse's must not snap
	await evaluate('window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; boneSnap = false; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "W"); row.click(); return true; })()`);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await waitFor('!!skeleton && !!rawDoc', 15000);
	await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); fitView(); true');
	await frames(3);
	await evaluate(HELPERS);
}
const setMode = async (m) => { await evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); true`); await frames(2); };
const close = (a, b, tol) => Math.abs(a - b) <= tol;

async function suite(quiet) {
	let pass = 0, fail = 0;
	const ok = (name, cond, detail) => {
		if (cond) pass++;
		else fail++;
		if (!quiet) console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
		return cond;
	};
	async function step(title, fn) {
		if (!quiet) console.log(`\n${title}`);
		try { await fn(); } catch (e) { fail++; if (!quiet) console.log(`  ✗ the harness threw — ${e.message}`); }
	}

	await openW();
	await setMode('setup');
	const bone = await T('pickable()');
	if (!quiet) console.log(`(dragging bone "${bone}")`);

	await step('1. Setup: a drag on a bone moves it', async () => {
		ok('W has a bone in the middle of the stage that a press picks', !!bone);
		const moved = {};
		for (const how of HOW) {
			await T(`select(null)`);
			const at = await T(`boneAt(${q(bone)})`), s0 = await T(`setup(${q(bone)})`);
			await drag(how, at, { x: at.x + 48, y: at.y - 24 });
			const s1 = await T(`setup(${q(bone)})`);
			moved[how] = { x: s1.x - s0.x, y: s1.y - s0.y };
		}
		const m = moved.mouse;
		ok('the mouse moves it (the reference)', Math.hypot(m.x, m.y) > 5, q(moved));
		for (const how of ['tip', 'pen']) ok(`the ${LABEL[how]} moves it as far as the mouse does`, close(moved[how].x, m.x, 0.5) && close(moved[how].y, m.y, 0.5), q(moved));
	});

	await step('2. a drag on a gizmo axis moves the bone along that axis only', async () => {
		const got = {};
		for (const how of HOW) {
			await T(`select(${q(bone)})`);
			await frames(1);
			const { at, dir } = await T('gizmoPoint("x")');
			const w0 = await evaluate(`(() => { const b = skeleton.findBone(${q(bone)}); return [b.worldX, b.worldY]; })()`);
			await drag(how, at, { x: at.x + 36, y: at.y - 36 });
			const w1 = await evaluate(`(() => { const b = skeleton.findBone(${q(bone)}); return [b.worldX, b.worldY]; })()`);
			const d = [w1[0] - w0[0], w1[1] - w0[1]];
			got[how] = { along: d[0] * dir[0] + d[1] * dir[1], across: d[0] * -dir[1] + d[1] * dir[0] };
		}
		const m = got.mouse;
		ok('the mouse moves it along the axis only (the reference)', Math.abs(m.along) > 5 && Math.abs(m.across) < 0.05, q(got));
		for (const how of ['tip', 'pen']) ok(`the ${LABEL[how]} moves it as far along the axis, and not across it`, close(got[how].along, m.along, 0.5) && Math.abs(got[how].across) < 0.05, q(got));
	});

	await step('3. Animate: a drag on a bone keys its translate, a drag on the ring keys its rotate', async () => {
		await setMode('animate');
		await evaluate('newAnimation(); animWorkLen[curAnim] = 1; graphSnap = false; tlSelOnly = true; true');
		await frames(2);
		// What the bone's pose adds to its setup now: a key is written as that, so a drag's own share is
		// the key less this.
		const pose = () => evaluate(`(() => { const b = skeleton.findBone(${q(bone)}), d = b.data; return { x: b.x - d.x, y: b.y - d.y, r: b.rotation - d.rotation }; })()`);
		const times = { tip: 0.1, pen: 0.3, mouse: 0.5 }, moved = {};
		for (const how of HOW) {
			await T(`select(null)`);
			await T(`seek(${times[how]})`);
			await frames(1);
			const p0 = await pose(), at = await T(`boneAt(${q(bone)})`);
			await drag(how, at, { x: at.x + 30, y: at.y + 30 });
			const k = (await T(`keys(${q(bone)}, "translate")`)).find((x) => close(x.t, times[how], 1e-4));
			moved[how] = k ? { x: (k.x || 0) - p0.x, y: (k.y || 0) - p0.y } : null;
		}
		ok('the mouse keys the translate at the playhead (the reference)', !!moved.mouse && Math.hypot(moved.mouse.x, moved.mouse.y) > 5, q(moved));
		for (const how of ['tip', 'pen']) ok(`the ${LABEL[how]} keys it at ${times[how]}s, moved as far as the mouse’s`, !!moved[how] && !!moved.mouse && close(moved[how].x, moved.mouse.x, 0.5) && close(moved[how].y, moved.mouse.y, 0.5), q(moved));
		const rot = { tip: 0.7, pen: 0.8, mouse: 0.9 }, turned = {};
		for (const how of HOW) {
			await T(`select(${q(bone)})`);
			await T(`seek(${rot[how]})`);
			await frames(1);
			const p0 = await pose();
			await drag(how, await T('gizmoPoint("ring", 20)'), await T('gizmoPoint("ring", 65)'));
			const k = (await T(`keys(${q(bone)}, "rotate")`)).find((x) => close(x.t, rot[how], 1e-4));
			turned[how] = k ? (k.v ?? 0) - p0.r : null;
		}
		ok('the mouse keys the rotate on the ring (the reference)', Math.abs(turned.mouse ?? 0) > 20, q(turned));
		for (const how of ['tip', 'pen']) ok(`the ${LABEL[how]} keys it at ${rot[how]}s, turned as far as the mouse’s`, turned[how] != null && close(turned[how], turned.mouse ?? NaN, 0.5), q(turned));
	});

	await step('4. a drag on a dopesheet key retimes it', async () => {
		await T(`select(${q(bone)})`);
		await evaluate('tlView = "dope"; renderTimeline(); true');
		await frames(2);
		const pps = await evaluate('tlPps');
		for (const [how, t] of [['tip', 0.1], ['pen', 0.3], ['mouse', 0.5]]) {
			const at = await T(`dot(${q(bone)}, ${t})`);
			if (!ok(`${LABEL[how]}: the key at ${t}s is on the dopesheet`, !!at)) continue;
			await drag(how, at, { x: at.x + Math.round(0.05 * pps), y: at.y });
			const ts = (await T(`keys(${q(bone)}, "translate")`)).map((k) => k.t);
			ok(`${LABEL[how]}: the key moved from ${t}s to ~${(t + 0.05).toFixed(2)}s`, !ts.some((x) => close(x, t, 1e-4)) && ts.some((x) => close(x, t + 0.05, 0.006)), q(ts));
		}
		const t = (await T(`keys(${q(bone)}, "translate")`))[0].t, at = await T(`dot(${q(bone)}, ${t})`);
		await drag('pen', at, at, { button: 'right' });
		await wait(100);
		ok('the pen’s barrel on a key opens its easing menu, as the right button does', await evaluate('!!document.getElementById("curveMenu")'));
		await evaluate('closeCurveMenu(); true');
	});

	await step('5. box select: the graph editor’s background and a Shift-drag on a dopesheet lane', async () => {
		await evaluate('tlView = "graph"; renderTimeline(); true');
		await frames(2);
		const got = {};
		for (const how of HOW) {
			await evaluate('graphSel = []; renderTimeline(); true');
			const v = await T('box(document.querySelector("#timeline svg"), (h) => !h.dataset.key)');
			if (!v) { got[how] = 'no room'; continue; }
			await drag(how, v.from, v.to);
			got[how] = await evaluate('graphSel.length');
		}
		ok('the mouse selects keys in the graph (the reference)', got.mouse > 0, q(got));
		for (const how of ['tip', 'pen']) ok(`the ${LABEL[how]} selects the same keys in the graph`, got[how] === got.mouse, q(got));
		await evaluate('graphSel = []; tlView = "dope"; renderTimeline(); true');
		await frames(2);
		const dope = {};
		for (const how of HOW) {
			await evaluate('dopeSel = []; renderTimeline(); true');
			const lane = await evaluate(`(() => { const d = [...document.querySelectorAll("#timeline .tl-key")].find((x) => dopeTrackById[x.dataset.tid] && dopeTrackById[x.dataset.tid].name === ${q(bone)}); if (!d) return null; const l = d.closest(".tl-lane"); l.scrollIntoView({ block: "nearest" }); return __t.box(l); })()`);
			if (!lane) { dope[how] = 'no lane'; continue; }
			await drag(how, lane.from, { x: lane.to.x, y: lane.from.y + 8 }, { modifiers: SHIFT }); // across the dots' middle
			dope[how] = await evaluate('dopeSel.length');
		}
		ok('the mouse Shift-drag selects the lane’s keys (the reference)', dope.mouse > 0, q(dope));
		for (const how of ['tip', 'pen']) ok(`the ${LABEL[how]} Shift-drag selects the same keys`, dope[how] === dope.mouse, q(dope));
	});

	await step('6. a press is played once, and the browser’s own mouse events stay out', async () => {
		await setMode('setup');
		await T(`select(null)`);
		const r = await evaluate('(() => { const r = document.getElementById("cv").getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 60) }; })()');
		for (const how of HOW) {
			await evaluate('__t.press = []; true');
			await drag(how, r, r);
			await wait(500); // a tap's own mouse events come after the double-tap wait
			const press = await evaluate('__t.press');
			const want = how === 'mouse' ? ['browser'] : ['played'];
			ok(`${LABEL[how]}: one press on the stage (${press.join(', ') || 'none'})`, q(press) === q(want), q(press));
		}
	});

	await step('7. the barrel button pans the stage, over a bone too, and opens no menu', async () => {
		await T(`select(null)`);
		const at = await T(`boneAt(${q(bone)})`), s0 = await T(`setup(${q(bone)})`);
		const c0 = await evaluate('[renderer.camera.position.x, renderer.camera.position.y]');
		await evaluate('__t.menus = []; true');
		await drag('pen', at, { x: at.x + 60, y: at.y + 20 }, { button: 'right' });
		await wait(100);
		const c1 = await evaluate('[renderer.camera.position.x, renderer.camera.position.y]'), s1 = await T(`setup(${q(bone)})`);
		ok('the camera moved', Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 5, q({ c0, c1 }));
		ok('the bone under it did not', s1.x === s0.x && s1.y === s0.y, q({ s0, s1 }));
		const menus = await evaluate('__t.menus');
		ok('the barrel’s click opens no menu', menus.length > 0 && menus.every((m) => m.prevented), q(menus));
		await evaluate('__t.menus = []; true');
		const r = await evaluate('(() => { const r = document.getElementById("cv").getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 60) }; })()');
		await drag('mouse', r, r, { button: 'right' });
		await wait(100);
		const mm = await evaluate('__t.menus');
		ok('the mouse’s right button still opens the browser’s menu', mm.length > 0 && mm.every((m) => !m.prevented), q(mm));
	});

	await step('8. the splitter, the Picker, the frame-to-rig stage and the sheet’s stages take a pen drag', async () => {
		for (const how of HOW) {
			const w0 = await evaluate('document.getElementById("side").offsetWidth');
			const h = await evaluate('(() => { const r = document.getElementById("resSide").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
			await drag(how, h, { x: h.x + 40, y: h.y });
			const w1 = await evaluate('document.getElementById("side").offsetWidth');
			ok(`${LABEL[how]}: the left splitter widened the panel ${w1 - w0}px`, close(w1 - w0, 40, 2), q({ w0, w1 }));
			await evaluate('document.getElementById("resSide").dispatchEvent(new MouseEvent("dblclick")); true');
			await frames(1);
		}
		await evaluate('document.getElementById("secPicker").open = true; renderPickerPanel(); true');
		await frames(2);
		for (const how of HOW) {
			const b = await evaluate('(() => { const el = document.querySelector("#pickerPanel .pickBoard"); el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { l: Math.round(r.left + 4), t: Math.round(r.top + 4), r: Math.round(r.right - 4), b: Math.round(r.bottom - 4) }; })()');
			let box = null;
			await drag(how, { x: b.l, y: b.t }, { x: b.r, y: b.b }, { during: async () => { box = await evaluate('(() => { const m = document.querySelector(".pickMarquee"); return m ? m.getBoundingClientRect().width : 0; })()'); } });
			ok(`${LABEL[how]}: a drag across the Picker’s board draws its box across it (${box ? Math.round(box) : 0} of ${b.r - b.l}px)`, close(box, b.r - b.l, 3), q(box));
		}
		await evaluate(`(() => {
			document.getElementById("f2rModal").classList.add("open");
			const cv = document.getElementById("f2rStage");
			__t.f2r = { down: 0, move: 0, up: 0 };
			cv.addEventListener("mousedown", () => __t.f2r.down++);
			window.addEventListener("mousemove", () => { if (__t.f2r.down && !__t.f2r.up) __t.f2r.move++; });
			window.addEventListener("mouseup", () => { if (__t.f2r.down) __t.f2r.up++; });
			return true;
		})()`);
		await frames(1);
		const f = await evaluate('(() => { const r = document.getElementById("f2rStage").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
		await drag('tip', f, { x: f.x + 50, y: f.y + 30 });
		const got = await evaluate('__t.f2r');
		ok('the pen tip on the frame-to-rig stage arrives as a press, its moves and a release', got.down === 1 && got.move >= STEPS && got.up === 1, q(got));
		await evaluate('document.getElementById("f2rModal").classList.remove("open"); true');
		for (const id of ['s2rStage', 's2rArrange']) {
			await evaluate(`(() => {
				document.getElementById("s2rModal").classList.add("open");
				document.getElementById("s2rStage").style.display = ${q(id === 's2rStage' ? '' : 'none')};
				document.getElementById("s2rArrange").style.display = ${q(id === 's2rArrange' ? '' : 'none')};
				const cv = document.getElementById(${q(id)}), n = { down: 0, move: 0, up: 0 };
				__t[${q(id)}] = n;
				cv.addEventListener("mousedown", () => n.down++);
				window.addEventListener("mousemove", () => { if (n.down && !n.up) n.move++; });
				window.addEventListener("mouseup", () => { if (n.down) n.up++; });
				return true;
			})()`);
			await frames(1);
			const sp = await evaluate(`(() => { const r = document.getElementById(${q(id)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
			await drag('tip', sp, { x: sp.x + 40, y: sp.y + 25 });
			const on = await evaluate(`__t[${q(id)}]`);
			ok(`the pen tip on 🗺 From my sheet’s #${id} arrives as a press, its moves and a release`, on.down === 1 && on.move >= STEPS && on.up === 1, q(on));
		}
		await evaluate('document.getElementById("s2rModal").classList.remove("open"); document.getElementById("s2rStage").style.display = ""; document.getElementById("s2rArrange").style.display = "none"; true');
	});

	await step('9. every drag surface says touch-action:none', async () => {
		await setMode('animate');
		await T(`select(${q(bone)})`);
		await evaluate('tlView = "graph"; renderTimeline(); true');
		await frames(1);
		const graph = await evaluate('getComputedStyle(document.getElementById("tlGraph")).touchAction');
		await evaluate('tlView = "dope"; renderTimeline(); true');
		await frames(1);
		const ta = await evaluate(`(() => {
			const o = {}, of = (k, el) => { o[k] = el ? getComputedStyle(el).touchAction : "missing"; };
			of("#cv", document.getElementById("cv")); of("#f2rStage", document.getElementById("f2rStage"));
			of("#tlRuler", document.getElementById("tlRuler")); of(".tl-lane", document.querySelector(".tl-lane"));
			of(".pickBoard", document.querySelector(".pickBoard")); of("#resSide", document.getElementById("resSide"));
			of("#resTimeline", document.getElementById("resTimeline"));
			of("#s2rStage", document.getElementById("s2rStage")); of("#s2rArrange", document.getElementById("s2rArrange"));
			return o;
		})()`);
		ta['#tlGraph'] = graph;
		ok('stage, frame-to-rig stage, the sheet’s stages, ruler, lanes, graph, Picker, splitters', Object.values(ta).every((v) => v === 'none'), q(ta));
		ok('the timeline itself still scrolls by touch', (await evaluate('getComputedStyle(document.getElementById("timeline")).touchAction')) === 'auto');
	});

	await step('10. a press on the stage takes the focus off a field, so the typing lands first', async () => {
		await setMode('setup');
		let name = bone;
		for (const how of HOW) {
			await T(`select(${q(name)})`);
			await frames(1);
			await evaluate('(() => { const i = document.querySelector("#boneDetail input[type=text]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return true; })()');
			await send('Input.insertText', { text: '_' + how });
			const r = await evaluate('(() => { const r = document.getElementById("cv").getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 60) }; })()');
			await drag(how, r, r);
			const want = name + '_' + how;
			const got = await evaluate(`({ renamed: !!skeletonData.findBone(${q(want)}), field: document.activeElement.tagName })`);
			ok(`${LABEL[how]}: the typed name is in when the press lands (${q(got)})`, got.renamed && got.field !== 'INPUT', q(got));
			if (got.renamed) name = want;
		}
	});
	return { pass, fail };
}

const MUTANTS = [
	['the surfaces keep the browser’s pan', '  .cineLane, .cineCurveWrap { touch-action:none; }', '  .cineLane, .cineCurveWrap { touch-action:auto; }'],
	['mouse events only (no pen bridge)', '  initResizers();\n  wirePenDrags();', '  initResizers();'],
	['the pen’s moves are not played', 'if (penDrag && e.pointerId === penDrag.id) document.dispatchEvent(penMouseEvent("mousemove", e, 0, penDrag.buttons));', ''],
	['the browser’s own press runs too', '    e.preventDefault();\n    const field = document.activeElement;', '    const field = document.activeElement;'],
	['the barrel is the right button on the stage', '(pans ? 1 : 2)', '2'],
	['the stage opens a pen’s menu', 'if (penDrag || e.pointerType === "pen" || e.pointerType === "touch") e.preventDefault();', ''],
	['dopesheet lanes are not a surface', 'track.className = "tl-lane";', ''],
	['the graph is not a surface', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, .pickBoard, .resizer, .resizer-h";'],
	['the Picker is not a surface', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .resizer, .resizer-h";'],
	['the splitters are not a surface', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer-h";'],
	['the frame-to-rig stage is not a surface', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";', 'const PEN_DRAG = "#cv, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";'],
	['the sheet’s stages are not a surface', 'const PEN_DRAG = "#cv, #f2rStage, #s2rStage, #s2rArrange, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";', 'const PEN_DRAG = "#cv, #f2rStage, #tlRuler, .tl-lane, #tlGraph, .pickBoard, .resizer, .resizer-h";'],
	['a pen press leaves the focus on a field', '    if (field && field !== document.body && !field.contains(t)) field.blur();\n', ''],
];

let code;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		console.log('pen-drag-browser mutants (each must fail a check):');
		for (const [name, find, replace] of MUTANTS) {
			const n = SHIPPED.split(find).length - 1;
			if (n !== 1) { console.log(`  ✗ ${name}: its line is in view.html ${n} times — the mutant is stale`); continue; }
			html = SHIPPED.replace(find, replace);
			const r = await suite(true);
			if (r.fail) caught++;
			console.log(`  ${r.fail ? '✓' : '✗'} ${name}${r.fail ? ` (${r.fail} check(s) failed)` : ' — NOT caught'}`);
		}
		console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
		code = caught === MUTANTS.length ? 0 : 1;
	} else {
		console.log('pen-drag-browser — pen and touch drags in the real Rigger (W)');
		const r = await suite(false);
		console.log(`\n${r.pass} passed, ${r.fail} failed`);
		if (r.fail && pageLog.length) console.log('page log:\n  ' + pageLog.slice(-15).join('\n  '));
		code = r.fail ? 1 : 0;
	}
} finally {
	server.close();
	await browser.close();
}
process.exit(code);
