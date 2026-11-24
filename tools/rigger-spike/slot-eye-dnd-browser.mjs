// Browser gate for the Slots (draw order) panel: the 👁 slot eye and drag-and-drop reorder.
//
//   node tools/rigger-spike/slot-eye-dnd-browser.mjs
//   node tools/rigger-spike/slot-eye-dnd-browser.mjs --mutants   # every planted bug must fail a check
//   node tools/rigger-spike/slot-eye-dnd-browser.mjs --mutants --only grip   # the mutants whose name has "grip"
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W (40 slots, additive ones among them, a clip with draw-order keys):
//   - the eye hides a slot on the stage (its art is not drawn, in Setup, Animate and Preview) and from
//     picking (a drag on its mesh moves no vertex), puts the attachment back after every draw, and is
//     no edit: the rig stays saved, no undo step, and the exported .irig and the saved skeleton are
//     byte-identical with and without hidden slots;
//   - Alt-click and right-click solo a slot (again: all show), 👁 in the header shows all, a template's
//     groups get a group eye, an eye on a selected row hides the whole selection;
//   - the hidden set survives a reload, and the first save (the open rig becomes its .irig);
//   - a drag on ⋮⋮ moves one slot, or the Shift / Ctrl selection as a block, to the place under the
//     pointer, as ONE undo step, writing what ↑ ↓ write (draw-order keys kept); the list scrolls near
//     its edge; a press without a move selects; Esc cancels;
//   - the pen tip (CDP touch) and the pen as a mouse drag a row as the mouse does;
//   - Ctrl+] / Ctrl+[ move the selection one place, with Shift to the front / back (Setup only).
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
const SOURCE = { id: 0, name: 'W', folder: 'W', dir_b64: b64('W'), skeleton_file: 'W.json', atlas_file: 'symbols3.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false };
let entries = [SOURCE];
let saves = [];
let savedIrig = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v) => send(200, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: entries });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (url.searchParams.get('dir') !== b64('W')) return send(404, 'text/plain', 'no such bundle');
			if (name === 'W.json') return send(200, MIME['.json'], W_JSON);
			if (name === 'W.irig' && savedIrig) return send(200, MIME['.json'], savedIrig);
			if (/^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name))) return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') return jsonOut({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: null });
		if (p === '/api/rigger/save' && req.method === 'POST') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				saves.push(body);
				savedIrig = JSON.stringify(JSON.parse(body).skeleton);
				// As the endpoint answers a save that landed: the new tag, and the index now lists the .irig.
				entries = [SOURCE, { ...SOURCE, id: 1, skeleton_file: 'W.irig', format: 'json' }];
				jsonOut({ ok: true, saved: true, etag: `"e${saves.length}"` });
			});
			return;
		}
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
const browser = await launchChrome({ name: 'slot-eye-dnd', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, send, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const lerp = (a, b, i, n) => Math.round(a + ((b - a) * i) / n);
const STEPS = 8;
const MOD = { alt: 1, ctrl: 2, shift: 8 };

/** One drag from `from` to `to` in CSS px: the pen tip (touch), the pen as a mouse, or the mouse. */
async function drag(how, from, to, { during } = {}) {
	if (how === 'tip') {
		const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts });
		await touch('touchStart', [{ x: from.x, y: from.y, id: 1 }]);
		for (let i = 1; i <= STEPS; i++) await touch('touchMove', [{ x: lerp(from.x, to.x, i, STEPS), y: lerp(from.y, to.y, i, STEPS), id: 1 }]);
		await frames(1);
		if (during) await during();
		await touch('touchEnd', []);
	} else {
		const pointerType = how === 'pen' ? 'pen' : 'mouse';
		const mouse = (type, pt, extra) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, pointerType, ...extra });
		await mouse('mouseMoved', from, {});
		await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
		for (let i = 1; i <= STEPS; i++) await mouse('mouseMoved', { x: lerp(from.x, to.x, i, STEPS), y: lerp(from.y, to.y, i, STEPS) }, { button: 'left', buttons: 1 });
		await frames(1);
		if (during) await during();
		await mouse('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1 });
	}
	await frames(2);
}
/** A click at `at` (modifiers: MOD bits; button: left / right). */
async function click(at, { modifiers = 0, button = 'left' } = {}) {
	const buttons = button === 'right' ? 2 : 1;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, modifiers });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button, buttons, clickCount: 1, modifiers });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button, buttons: 0, clickCount: 1, modifiers });
	await frames(2);
}
async function key(code, keyName, vk, modifiers) {
	await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
	await frames(2);
}

// Page-side helpers, installed once per load.
const HELPERS = `(() => {
	const cv = document.getElementById("cv");
	window.__t = {
		screen(wx, wy) {
			const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = new RIG.Vector3(wx, wy, 0);
			renderer.camera.worldToScreen(v, cv.width, cv.height);
			return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
		},
		names() { return rawDoc.slots.map((s) => s.name); },
		row(name) { return [...document.querySelectorAll("#slotList .trow[data-slot]")].find((r) => r.dataset.slot === name); },
		// The centre of a part of a slot's row (".slotGrip", ".slotEye", or the row at a fraction of its height).
		at(name, part, fy) {
			const row = this.row(name); if (!row) return null;
			row.scrollIntoView({ block: "nearest" });
			const el = part ? row.querySelector(part) : row; if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * (fy == null ? 0.5 : fy)) };
		},
		y(name, fy) { const r = this.row(name).getBoundingClientRect(); return Math.round(r.top + r.height * fy); },
		hidden() { return [...slotEyeHidden()].sort(); },
		drawn: null, lit: 0, grab: false,
		steps() { return rigHist.past.length; },
		order(anim) { // each draw-order key of a clip as slot names
			const names = this.names();
			return (rawDoc.animations[anim].drawOrder || []).map((fr) => fr.offsets ? drawOrderOfOffsets(fr.offsets, names).map((i) => names[i]) : names);
		},
		exportText() {
			return new Promise((res) => {
				const ou = URL.createObjectURL, ac = HTMLAnchorElement.prototype.click;
				HTMLAnchorElement.prototype.click = function () {};
				URL.createObjectURL = (b) => { b.text().then(res); return "blob:none"; };
				try { exportIrig(); } finally { URL.createObjectURL = ou; HTMLAnchorElement.prototype.click = ac; }
			});
		},
	};
	// What the stage draws: the slots holding an attachment while the rig is drawn, and (on request) how
	// many canvas pixels the frame lit.
	const draw = renderer.drawSkeleton.bind(renderer);
	renderer.drawSkeleton = (sk, ...rest) => { if (sk === skeleton) __t.drawn = sk.drawOrder.filter((s) => s.attachment).map((s) => s.data.name); return draw(sk, ...rest); };
	const end = renderer.end.bind(renderer);
	renderer.end = () => {
		end();
		if (!__t.grab) return;
		__t.grab = false;
		const w = cv.width, h = cv.height, px = new Uint8Array(w * h * 4);
		gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
		let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++;
		__t.lit = n;
	};
	return true;
})()`;
const T = (expr) => evaluate(`__t.${expr}`);
const lit = async () => { await evaluate('__t.grab = true'); await frames(3); return T('lit'); };

async function openW() {
	await evaluate('location.reload(); true').catch(() => {});
	await wait(300);
	await waitFor('typeof skeletons !== "undefined" && skeletons.length >= 1', 30000);
	await evaluate('window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "W"); row.click(); return true; })()`);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await waitFor('!!skeleton && !!rawDoc', 15000);
	await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); fitView(); document.getElementById("secBones").open = false; document.getElementById("secSlots").open = true; true');
	await frames(3);
	await evaluate(HELPERS);
	await frames(2);
}
const setMode = async (m) => { await evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); true`); await frames(2); };
const same = (a, b) => q(a) === q(b);

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
	entries = [SOURCE]; saves = []; savedIrig = null;
	try {
		await openW();
		await evaluate('localStorage.clear(); true');
		await openW();
	} catch (e) {
		ok('W opens', false, e.message);
		return { pass, fail };
	}
	await setMode('setup');
	await evaluate('showBones = false; showMesh = false; showBounds = false; true');
	await frames(2);
	const names = await T('names()');

	// The slot whose art lights the most of the stage on its own.
	let big = null;
	await step('1. the eye hides a slot on the stage, and is no edit', async () => {
		const all = await lit();
		ok('W lights the stage with every slot shown', all > 1000, all);
		let best = 0;
		for (const n of names) {
			await evaluate(`soloSlots([${q(n)}]); true`);
			const k = await lit();
			if (k > best) { best = k; big = n; }
		}
		await evaluate('setSlotEye([]); true');
		if (!quiet) console.log(`  (the biggest slot: "${big}")`);
		const steps0 = await T('steps()'), dirty0 = await evaluate('dirty');
		await click(await T(`at(${q(big)}, ".slotEye")`));
		ok('its 👁 hides it', same(await T('hidden()'), [big]), q(await T('hidden()')));
		ok('its row says so', await evaluate(`__t.row(${q(big)}).classList.contains("eyeOff") && __t.row(${q(big)}).querySelector(".slotEye").getAttribute("aria-pressed") === "true"`));
		const off = await lit();
		ok('the stage no longer draws its art', !(await T('drawn')).includes(big) && off < all, q({ all, off }));
		ok('its attachment is back after the draw', await evaluate(`!!skeleton.findSlot(${q(big)}).attachment`));
		ok('the rig is not marked unsaved, and no undo step was made', (await evaluate('dirty')) === dirty0 && (await T('steps()')) === steps0, q({ dirty0, steps0, steps: await T('steps()') }));
		ok('the header counts it', (await evaluate('document.getElementById("cSlots").textContent')).includes('1 hidden'));
		await setMode('animate');
		await frames(2);
		ok('Animate does not draw it either', !(await T('drawn')).includes(big));
		await setMode('preview');
		await frames(2);
		ok('nor Preview', !(await T('drawn')).includes(big));
		await setMode('setup');
		await click(await T(`at(${q(big)}, ".slotEye")`));
		ok('its 👁 again shows it', (await T('hidden()')).length === 0 && (await T('drawn')).includes(big));
		ok('the stage lights as before', (await lit()) === all);
	});

	await step('2. a hidden slot is not picked on the stage', async () => {
		const slot = 'wild_dynamite';
		await evaluate(`selectSlot(${q(slot)}); true`);
		await frames(2);
		ok(`"${slot}" is a mesh open for editing`, await evaluate('!!meshCtx'));
		// The vertex furthest from every bone, so nothing else is picked where it is.
		const v = await evaluate(`(() => {
			const w = meshWorldVerts(); let best = -1, bd = -1;
			for (let k = 0; k < w.length / 2; k++) {
				let d = Infinity; for (const b of skeleton.bones) d = Math.min(d, Math.hypot(b.worldX - w[k * 2], b.worldY - w[k * 2 + 1]));
				if (d > bd) { bd = d; best = k; }
			}
			return __t.screen(w[best * 2], w[best * 2 + 1]);
		})()`);
		const verts = () => evaluate('JSON.stringify(rawDocMeshEntry().vertices)');
		const v0 = await verts();
		await drag('mouse', v, { x: v.x + 30, y: v.y + 20 });
		ok('shown, a drag on its vertex moves it', (await verts()) !== v0);
		await evaluate('rigUndo(); true');
		await frames(2);
		ok('(undone)', (await verts()) === v0);
		await click(await T(`at(${q(slot)}, ".slotEye")`));
		ok('the eye kept the slot open', (await evaluate('selSlot')) === slot);
		const s0 = await T('steps()');
		await drag('mouse', v, { x: v.x + 30, y: v.y + 20 });
		ok('hidden, the same drag moves no vertex', (await verts()) === v0);
		if ((await T('steps()')) !== s0) await evaluate('rigUndo(); true');
		await click(await T(`at(${q(slot)}, ".slotEye")`));
		await evaluate('selectSlot(null); true');
	});

	await step('3. the exported .irig and the saved skeleton are byte-identical with and without hidden slots', async () => {
		await T('exportText()'); // a first export settles the rig's bounds
		const a = await T('exportText()');
		await evaluate(`setSlotEye(${q(names.slice(0, 12))}); soloSlots([${q(names[20])}]); true`);
		await frames(2);
		ok('(all but one hidden)', (await T('hidden()')).length === names.length - 1);
		const b = await T('exportText()');
		await evaluate('setSlotEye([]); true');
		const c = await T('exportText()');
		ok('the .irig with slots hidden is byte-identical to the one without', a === b && b === c, q({ a: a.length, b: b.length, c: c.length }));
		await evaluate(`setSlotEye(${q(names.slice(0, 5))}); dirty = true; true`);
		await evaluate('saveToR2().then(() => true)');
		await waitFor('saveToR2.busy === false', 15000);
		await evaluate('setSlotEye([]); dirty = true; true');
		await evaluate('saveToR2().then(() => true)');
		await waitFor('saveToR2.busy === false', 15000);
		const sk = saves.map((s) => JSON.stringify(JSON.parse(s).skeleton));
		ok('two saves were sent', saves.length === 2, saves.length);
		ok('the skeleton saved with slots hidden is the one saved without', sk.length === 2 && sk[0] === sk[1] && sk[0] === a);
		ok('the save names nothing of the eye', !saves.some((s) => /slotEye|eyeOff/.test(s)));
	});

	await step('4. the first save opens the .irig: the hidden set goes with it, and survives a reload', async () => {
		ok('the open rig is now its .irig', (await evaluate('selected.skeleton_file')) === 'W.irig');
		const hide = [names[1], names[7]].sort();
		await evaluate(`setSlotEye(${q(hide)}); true`);
		await openW();
		ok('after a reload the same slots are hidden', same(await T('hidden()'), hide), q(await T('hidden()')));
		ok('and not drawn', !(await T('drawn')).some((n) => hide.includes(n)));
		ok('their rows say so', await evaluate(`${q(hide)}.every((n) => __t.row(n).classList.contains("eyeOff"))`));
		await evaluate('setSlotEye([]); true');
		entries = [SOURCE];
	});

	await step('5. solo, show all, a group eye, a selection', async () => {
		await setMode('setup');
		const n = names[4];
		await click(await T(`at(${q(n)}, ".slotEye")`), { modifiers: MOD.alt });
		ok('Alt-click shows that slot alone', same(await T('hidden()'), names.filter((x) => x !== n).sort()) && (await T('drawn')).every((x) => x === n));
		await click(await T(`at(${q(n)}, ".slotEye")`), { modifiers: MOD.alt });
		ok('Alt-click again shows them all', (await T('hidden()')).length === 0);
		await click(await T(`at(${q(n)}, ".slotEye")`), { button: 'right' });
		ok('right-click (a pen’s barrel) solos it too', (await T('hidden()')).length === names.length - 1);
		const all = await evaluate('(() => { const b = document.getElementById("slotEyeAll"); b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: b.disabled }; })()');
		ok('👁 in the header is on while slots are hidden', !all.disabled);
		await click(all);
		ok('and shows every slot', (await T('hidden()')).length === 0);
		ok('without folding the section', await evaluate('document.getElementById("secSlots").open'));
		ok('then it is off', await evaluate('document.getElementById("slotEyeAll").disabled'));
		// A template with a draw-order layer and a swap that hides slots (the fingers of a drawn hand pose).
		const layer = names.slice(3, 8), hides = names.slice(10, 13);
		await evaluate(`rigTemplate = { channels: [{ id: "hand_l", label: "Left hand pose", hides: ${q(hides.map((s) => ({ slot: s, part: s })))} }, { id: "same", label: "Same", hides: ${q(layer.map((s) => ({ slot: s, part: s })))} }], rig3d: { layers: { hand_l: ${q(layer)} } } }; renderSlotGroups(); true`);
		const chips = await evaluate('[...document.querySelectorAll("#slotList .slotGroupEye")].map((b) => b.textContent)');
		ok('the template’s layer and its swap’s hidden slots each get a group eye, once', chips.length === 2, q(chips));
		const chip = (i) => evaluate(`(() => { const b = document.querySelectorAll("#slotList .slotGroupEye")[${i}]; b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
		await click(await chip(1));
		ok('a group eye hides its slots', same(await T('hidden()'), hides.slice().sort()));
		await click(await chip(1));
		ok('and shows them again', (await T('hidden()')).length === 0);
		await click(await chip(0), { modifiers: MOD.alt });
		ok('Alt-click shows only the group', same(await T('hidden()'), names.filter((x) => !layer.includes(x)).sort()));
		await evaluate('setSlotEye([]); rigTemplate = null; renderSlotGroups(); true');
		await click(await T(`at(${q(names[2])}, ".slotName")`));
		await click(await T(`at(${q(names[5])}, ".slotName")`), { modifiers: MOD.shift });
		await click(await T(`at(${q(names[9])}, ".slotName")`), { modifiers: MOD.ctrl });
		const sel = await evaluate('selectedSlotNames()');
		ok('Shift-click and Ctrl-click select rows', same(sel, [...names.slice(2, 6), names[9]]), q(sel));
		ok('the selection is marked', await evaluate('document.querySelectorAll("#slotList .trow.sel, #slotList .trow.sel2").length') === 5);
		await click(await T(`at(${q(names[3])}, ".slotEye")`));
		ok('an eye on a selected row hides the whole selection', same(await T('hidden()'), sel.slice().sort()), q(await T('hidden()')));
		await evaluate('setSlotEye([]); true');
	});

	await step('6. a drag on ⋮⋮ moves a slot, as ONE undo step, writing what ↑ ↓ write', async () => {
		await setMode('setup');
		await evaluate('selectSlot(null); true');
		const before = await T('names()'), keys0 = await T('order("wild_dynamite")');
		const src = before[3], to = before[8];
		const s0 = await T('steps()');
		let lines = null;
		await drag('mouse', await T(`at(${q(src)}, ".slotGrip")`), { x: (await T(`at(${q(to)})`)).x, y: await T(`y(${q(to)}, 0.25)`) }, {
			during: async () => { lines = await evaluate('[...document.querySelectorAll("#slotList .drop-before, #slotList .drop-after")].map((r) => r.dataset.slot)'); },
		});
		const after = await T('names()');
		const want = [...before.slice(0, 3), ...before.slice(4, 8), src, ...before.slice(8)];
		ok('the drop line shows one place, above the row under the pointer', same(lines, [to]), q(lines));
		ok(`"${src}" lands just before "${to}"`, same(after, want), q(after.slice(0, 10)));
		ok('the stage draws it there', same(await evaluate('skeleton.drawOrder.map((s) => s.data.name)'), want));
		ok('one undo step', (await T('steps()')) === s0 + 1, q({ s0, s: await T('steps()') }));
		ok('the clip’s draw-order keys draw what they drew', same(await T('order("wild_dynamite")'), keys0), q(await T('order("wild_dynamite")')));
		await evaluate('rigUndo(); true');
		await frames(2);
		ok('one undo puts it back', same(await T('names()'), before));
		// One place down by drag and by ↓ write the same rig.
		await drag('mouse', await T(`at(${q(before[5])}, ".slotGrip")`), { x: (await T(`at(${q(before[7])})`)).x, y: await T(`y(${q(before[7])}, 0.25)`) });
		const byDrag = await evaluate('JSON.stringify(rawDoc)');
		await evaluate('rigUndo(); true');
		await frames(2);
		await evaluate(`__t.row(${q(before[5])}).querySelectorAll("button")[[...__t.row(${q(before[5])}).querySelectorAll("button")].findIndex((b) => b.textContent === "↓")].click(); true`);
		await frames(2);
		ok('a slot dragged one place down is the rig ↓ makes', (await evaluate('JSON.stringify(rawDoc)')) === byDrag);
		await evaluate('rigUndo(); true');
		await frames(2);
		ok('(undone)', same(await T('names()'), before));
		const s1 = await T('steps()');
		const tap = await T(`at(${q(before[6])}, ".slotGrip")`);
		await drag('mouse', tap, { x: tap.x + 1, y: tap.y + 2 }); // a tap jitters, a pen's most of all
		ok('a press on ⋮⋮ that hardly moves selects the row and moves nothing', (await evaluate('selSlot')) === before[6] && same(await T('names()'), before) && (await T('steps()')) === s1, q({ sel: await evaluate('selSlot') }));
		const g = await T(`at(${q(before[2])}, ".slotGrip")`);
		await drag('mouse', g, { x: g.x, y: await T(`y(${q(before[9])}, 0.25)`) }, { during: () => key('Escape', 'Escape', 27, 0) });
		ok('Esc during a drag cancels it', same(await T('names()'), before) && (await T('steps()')) === s1);
	});

	await step('7. the Shift / Ctrl selection drags as a block', async () => {
		const before = await T('names()');
		await click(await T(`at(${q(before[10])}, ".slotName")`));
		await click(await T(`at(${q(before[12])}, ".slotName")`), { modifiers: MOD.shift });
		await click(await T(`at(${q(before[15])}, ".slotName")`), { modifiers: MOD.ctrl });
		const block = [before[10], before[11], before[12], before[15]];
		const s0 = await T('steps()');
		await drag('mouse', await T(`at(${q(before[11])}, ".slotGrip")`), { x: (await T(`at(${q(before[4])})`)).x, y: await T(`y(${q(before[4])}, 0.25)`) });
		const want = [...before.slice(0, 4), ...block, ...before.slice(4).filter((n) => !block.includes(n))];
		ok('the four land together before the row under the pointer, in their order', same(await T('names()'), want), q((await T('names()')).slice(0, 12)));
		ok('one undo step', (await T('steps()')) === s0 + 1);
		await evaluate('rigUndo(); true');
		await frames(2);
		ok('one undo puts them all back', same(await T('names()'), before));
		await evaluate('selectSlot(null); true');
	});

	await step('8. the list scrolls while a row is held near its edge', async () => {
		await evaluate('document.getElementById("outline").style.flex = "0 0 320px"; true');
		await frames(2);
		const before = await T('names()');
		const src = before[30];
		await evaluate(`__t.row(${q(src)}).scrollIntoView({ block: "center" }); true`);
		await frames(1);
		const top0 = await evaluate('document.getElementById("outline").scrollTop');
		const edge = await evaluate('(() => { const r = document.getElementById("outline").getBoundingClientRect(); return Math.round(r.top + 6); })()');
		const g = await evaluate(`(() => { const r = __t.row(${q(src)}).querySelector(".slotGrip").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
		// Held until the list stops at its top (a loaded CI runner draws few frames), at most 10 s.
		const held = async () => { for (let t = 0; t < 100 && (await evaluate('document.getElementById("outline").scrollTop')) > 0; t++) await wait(100); };
		await drag('mouse', g, { x: g.x, y: edge }, { during: held });
		const top1 = await evaluate('document.getElementById("outline").scrollTop');
		ok('the list scrolled up', top1 < top0 - 100, q({ top0, top1 }));
		ok(`"${src}" was carried up past the rows that were out of sight, to the back`, (await T('names()')).indexOf(src) === 0, (await T('names()')).indexOf(src));
		await evaluate('rigUndo(); document.getElementById("outline").style.flex = ""; true');
		await frames(2);
	});

	await step('9. the pen tip and the pen as a mouse drag a row as the mouse does', async () => {
		ok('⋮⋮ says touch-action:none', (await evaluate('getComputedStyle(document.querySelector("#slotList .slotGrip")).touchAction')) === 'none');
		for (const how of ['tip', 'pen']) {
			const before = await T('names()'), s0 = await T('steps()');
			await drag(how, await T(`at(${q(before[1])}, ".slotGrip")`), { x: (await T(`at(${q(before[6])})`)).x, y: await T(`y(${q(before[6])}, 0.25)`) });
			const want = [before[0], ...before.slice(2, 6), before[1], ...before.slice(6)];
			ok(`the ${how === 'tip' ? 'pen tip (touch)' : 'pen (as a mouse)'} moves it, one undo step`, same(await T('names()'), want) && (await T('steps()')) === s0 + 1, q((await T('names()')).slice(0, 8)));
			await evaluate('rigUndo(); true');
			await frames(2);
		}
	});

	await step('10. Ctrl+] / Ctrl+[ move the selection one place, with Shift to the front / back', async () => {
		await evaluate('document.activeElement && document.activeElement.blur(); true');
		const before = await T('names()'), n = before[6];
		await click(await T(`at(${q(n)}, ".slotName")`));
		const s0 = await T('steps()');
		await key('BracketRight', ']', 221, MOD.ctrl);
		ok('Ctrl+] one place forward', (await T('names()')).indexOf(n) === 7);
		ok('one undo step per key', (await T('steps()')) === s0 + 1);
		await key('BracketLeft', '[', 219, MOD.ctrl);
		ok('Ctrl+[ one place back', same(await T('names()'), before));
		await key('BracketRight', '}', 221, MOD.ctrl | MOD.shift);
		ok('Shift+Ctrl+] to the front', (await T('names()')).indexOf(n) === before.length - 1);
		await key('BracketLeft', '{', 219, MOD.ctrl | MOD.shift);
		ok('Shift+Ctrl+[ to the back', (await T('names()')).indexOf(n) === 0);
		await evaluate('while (rigHist.past.length > ' + s0 + ') rigUndo(); true');
		await frames(2);
		await click(await T(`at(${q(before[3])}, ".slotName")`));
		await click(await T(`at(${q(before[4])}, ".slotName")`), { modifiers: MOD.shift });
		await key('BracketRight', ']', 221, MOD.ctrl);
		ok('a selection moves together', same((await T('names()')).slice(3, 6), [before[5], before[3], before[4]]), q((await T('names()')).slice(2, 7)));
		await evaluate('rigUndo(); true');
		await setMode('animate');
		const a0 = await T('names()');
		await key('BracketRight', ']', 221, MOD.ctrl);
		ok('in Animate the keys reorder nothing', same(await T('names()'), a0));
		await setMode('setup');
	});
	return { pass, fail };
}

const MUTANTS = [
	['the eye draws every slot', 'const off = set && set.size ? skeleton.slots.filter((s) => set.has(s.data.name)) : [];', 'const off = [];'],
	['the attachment is not put back after the draw', 'try { draw(); } finally { off.forEach((s, i) => { s.attachment = kept[i]; }); }', 'draw();'],
	['a hidden slot is still picked', 'const eyeOff = slotEyeOffSel();', 'const eyeOff = false;'],
	['the hidden set is kept in the rig', '  storeSlotEye();\n  refreshSlotEyes();', '  storeSlotEye();\n  if (rawDoc) rawDoc.slotEye = [...set];\n  refreshSlotEyes();'],
	['the eye is not remembered', '  storeSlotEye();\n  refreshSlotEyes();', '  refreshSlotEyes();'],
	['the set is kept by file, not by rig', '"/" + irigStem(selected) : null', '"/" + (selected.skeleton_file || "") : null'],
	['a second solo does not show them all', 'setSlotEye(all.every((n) => keep.has(n) !== set.has(n)) ? [] : all.filter((n) => !keep.has(n)));', 'setSlotEye(all.filter((n) => !keep.has(n)));'],
	['the header’s show-all never works', '  all.disabled = !off;', '  all.disabled = true;'],
	['a swap’s hidden slots get no group eye', '    add(ch.label, "The slots “" + ch.label + "” hides while it shows a drawn pose", ch.hides.map((h) => h.slot));', '    void ch;'],
	['an eye hides only its own row', 'names = sel.includes(name) ? sel : [name];\n  setSlotEye', 'names = [name];\n  setSlotEye'],
	['the drop lands a row late', 'if (d.y < r.top + r.height / 2){ ins = i; break; }', 'if (d.y < r.top){ ins = i; break; }'],
	['a drag moves one slot of the selection', 'names: sel.includes(name) ? sel : [name], x:', 'names: [name], x:'],
	// The same final order, reached one slot at a time (each before the row the block was dropped on).
	['a block drop is a step per slot', 'if (d.moved && d.ins != null) historyStep(() => applySlotOrder(slotOrderDrop(setupSlotNames(), d.names, d.ins)));', 'if (d.moved && d.ins != null){ const t = setupSlotNames()[d.ins]; for (const n of d.names) historyStep(() => { const now = setupSlotNames(); return applySlotOrder(slotOrderDrop(now, [n], t === undefined ? now.length : now.indexOf(t))); }); }'],
	['the drop drops the draw-order keys', 'changeSlotsKeepingDrawOrder(rawDoc, () => { rawDoc.slots.splice(0, rawDoc.slots.length, ...order.map((n) => by.get(n))); });', 'rawDoc.slots.splice(0, rawDoc.slots.length, ...order.map((n) => by.get(n)));'],
	['the list does not scroll', '    d.raf = requestAnimationFrame(slotDragScroll);', ''],
	['the grip lets the browser pan', 'cursor:grab; touch-action:none;', 'cursor:grab;'],
	['the grip is no tap target (a touch lands on the eye)', 'const g = document.createElement("button"); g.type = "button";', 'const g = document.createElement("span");'],
	['the grip takes the mouse only', 'if (e.button !== 0 || !e.isPrimary ||', 'if (e.pointerType !== "mouse" || e.button !== 0 || !e.isPrimary ||'],
	['a press on the grip drags at once', 'if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;', ''],
	['Shift does not reach the front', '(fwd ? 1 : -1) * (e.shiftKey ? Infinity : 1)', '(fwd ? 1 : -1)'],
	['the keys reorder in Animate too', 'if (!(e.ctrlKey || e.metaKey) || !editMode || !rawDoc || cineMode) return;', 'if (!(e.ctrlKey || e.metaKey) || !rawDoc || cineMode) return;'],
];

let code;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
		const run = MUTANTS.filter(([name]) => !only || name.includes(only));
		console.log('slot-eye-dnd-browser mutants (each must fail a check):');
		for (const [name, find, replace] of run) {
			const n = SHIPPED.split(find).length - 1;
			if (n !== 1) { console.log(`  ✗ ${name}: its line is in view.html ${n} times — the mutant is stale`); continue; }
			html = SHIPPED.replace(find, replace);
			const r = await suite(true);
			if (r.fail) caught++;
			console.log(`  ${r.fail ? '✓' : '✗'} ${name}${r.fail ? ` (${r.fail} check(s) failed)` : ' — NOT caught'}`);
		}
		console.log(`\n${caught}/${run.length} mutants caught`);
		code = caught === run.length ? 0 : 1;
	} else {
		console.log('slot-eye-dnd-browser — the slot eye and drag-and-drop reorder in the real Rigger (W)');
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
