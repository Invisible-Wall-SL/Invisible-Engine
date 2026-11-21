// Browser gate for mirror and the picker (docs/design/rig-controls.md §5.4, §5.6, phase C3).
//
//   node tools/rigger-spike/rig-mirror-browser.mjs
//   node tools/rigger-spike/rig-mirror-browser.mjs --shot <file.png>   # also save the page
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's `W` symbol and on a left-only body (hips, chest, head, a left arm with an
// IK hand control and a pole, an eye, images, an IK and a transform, a clip) whose stored controls.json
// has its controls, a limb and a set, under a template stub with a face board. Checked, the way an
// author meets it:
//   - Setup: ⧉ R from L builds the right side; engine-rig poses the page's rig with each right bone at
//     its left's mirror; one ↶ takes it all back and ↷ brings it back; 💾 Save posts a skeleton and a
//     sidecar C1 accepts, and engine-rig plays the saved skeleton mirrored;
//   - Animate: L→R at the playhead — the saved file played by engine-rig draws the right arm at the
//     mirror of the left, the left untouched; ⇄ swaps the sides;
//   - the Picker: its buttons where the controls are, a click selects, shift-click adds, a box across
//     the board selects the side it covers, ✥ moves a button and the layout is kept in the sidecar, the
//     limb's button switches it to IK at the playhead; the face board's gaze box keys both channels;
//   - the graph editor: an IK picked shows its mix curve, which a drag reshapes and engine-rig plays;
//   - W: two of its bones paired by ＋, mirrored at the playhead; ＋ puts them on the picker; a transform
//     constraint's keyed mix is drawn in the graph as engine-rig plays it; the save is one C1 accepts;
//   - the page throws nothing.
// What it does NOT cover: the maths and its guards (`rig-mirror.mjs` plays the same functions through
// engine-rig, mutation-checked), the server's save (`check:rigger-writes`, C1).
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import vm from 'node:vm';
import { launchChrome } from './chrome.mjs';
import { CLICK_SAVE } from './view-save.mjs';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, readIrig, exportSpine42Json } = RIG;

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const shotAt = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
const ATLAS = readFileSync(join(SYMBOLS3, 'symbols3.atlas'), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const stub = { getImage: () => ({ width: 1, height: 1 }), setFilters() {}, setWraps() {}, dispose() {} };
function poseAt(doc, anim, t) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	const skel = new Skeleton(data);
	if (data.defaultSkin) skel.setSkin(data.defaultSkin);
	const state = new AnimationState(new AnimationStateData(data));
	skel.setToSetupPose();
	if (anim) {
		state.setAnimation(0, anim, false);
		state.update(Math.max(t, Math.fround(t)));
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	return skel;
}
const RC = (() => {
	const ctx = { structuredClone };
	vm.createContext(ctx);
	vm.runInContext(`${readFileSync(join(STATIC, 'rigger/vendor/rigger-controls.js'), 'utf8')}\n;globalThis.__rc = RiggerControls;`, ctx);
	return ctx.__rc;
})();
const W = (b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY });
const mul = (A, B) => ({ a: A.a * B.a + A.b * B.c, b: A.a * B.b + A.b * B.d, c: A.c * B.a + A.d * B.c, d: A.c * B.b + A.d * B.d, x: A.a * B.x + A.b * B.y + A.x, y: A.c * B.x + A.d * B.y + A.y });
const inv = (A) => {
	const det = A.a * A.d - A.b * A.c;
	const a = A.d / det;
	const b = -A.b / det;
	const c = -A.c / det;
	const d = A.a / det;
	return { a, b, c, d, x: -(a * A.x + b * A.y), y: -(c * A.x + d * A.y) };
};
// Across line L (written apart from the page's): reflected, its y axis turned back.
function reflect(w, L) {
	const r11 = 2 * L.ux * L.ux - 1;
	const r12 = 2 * L.ux * L.uy;
	const r22 = 2 * L.uy * L.uy - 1;
	return {
		a: r11 * w.a + r12 * w.c,
		c: r12 * w.a + r22 * w.c,
		b: -(r11 * w.b + r12 * w.d),
		d: -(r12 * w.b + r22 * w.d),
		x: L.x + r11 * (w.x - L.x) + r12 * (w.y - L.y),
		y: L.y + r12 * (w.x - L.x) + r22 * (w.y - L.y),
	};
}
const rootLine = (s) => {
	const r = s.bones[0];
	const m = Math.hypot(r.b, r.d);
	return { x: r.worldX, y: r.worldY, ux: r.b / m, uy: r.d / m };
};
const gap = (a, b) => Math.max(Math.hypot(a.x - b.x, a.y - b.y), 10 * Math.hypot(a.a - b.a, a.c - b.c), 10 * Math.hypot(a.b - b.b, a.d - b.d));
/** The line along the chest, as posed. */
const chestLine = (s) => {
	const c = s.findBone('chest');
	const m = Math.hypot(c.a, c.c);
	return { x: c.worldX, y: c.worldY, ux: c.a / m, uy: c.c / m };
};
// Where the mirror puts `dst` at a pose: its pair's world reflected across `lineOf` (the root's x = 0
// by default), kept as far from that as its own setup is from the exact mirror of its pair's.
const mirrored = (sNow, sSetup, src, dst, lineOf = rootLine) => {
	const ws = W(sSetup.findBone(src));
	return mul(reflect(W(sNow.findBone(src)), lineOf(sNow)), mul(inv(reflect(ws, lineOf(sSetup))), W(sSetup.findBone(dst))));
};
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---- the left-only body (y up; the character faces the viewer, so its left is on screen right) ----
function bodyDoc() {
	const d = {
		skeleton: { spine: '4.2.0' },
		bones: [
			{ name: 'root' },
			{ name: 'hips', parent: 'root', y: 100, rotation: 90, length: 30 },
			{ name: 'chest', parent: 'hips', x: 30, length: 60 },
			{ name: 'head', parent: 'chest', x: 60, length: 30 },
			{ name: 'eye_l', parent: 'head', x: 15, y: -8 },
			{ name: 'upper_arm_l', parent: 'chest', x: 50, y: -25, rotation: -100, length: 50 },
			{ name: 'lower_arm_l', parent: 'upper_arm_l', x: 50, rotation: -30, length: 45 },
			{ name: 'hand_l', parent: 'lower_arm_l', x: 45, length: 15 },
			{ name: 'hand_ik_l', parent: 'root' },
			{ name: 'elbow_pole_l', parent: 'chest' },
		],
		slots: [
			{ name: 'body', bone: 'hips', attachment: 'radial' },
			{ name: 'arm_l', bone: 'upper_arm_l', attachment: 'rays1' },
			{ name: 'hand_l', bone: 'hand_l', attachment: 'radial' },
			{ name: 'head', bone: 'head', attachment: 'radial' },
			{ name: 'eye_l', bone: 'eye_l', attachment: 'radial' },
		],
		skins: [
			{
				name: 'default',
				attachments: {
					body: { radial: { x: 15, scaleX: 0.3, scaleY: 0.3, width: 100, height: 100 } },
					arm_l: { rays1: { x: 25, y: 4, rotation: 5, scaleX: 0.2, scaleY: 0.1, width: 100, height: 100 } },
					hand_l: { radial: { x: 6, rotation: 20, scaleX: 0.1, scaleY: 0.1, width: 100, height: 100 } },
					head: { radial: { x: 15, scaleX: 0.3, scaleY: 0.3, width: 100, height: 100 } },
					eye_l: { radial: { y: 2, scaleX: 0.05, scaleY: 0.05, width: 100, height: 100 } },
				},
			},
		],
		ik: [],
		transform: [],
		animations: { x: {} },
	};
	const s = poseAt(d, 'x', 0);
	const lower = s.findBone('lower_arm_l');
	const wrist = [lower.worldX + 45 * lower.a, lower.worldY + 45 * lower.c];
	Object.assign(d.bones[8], { x: r4(wrist[0]), y: r4(wrist[1]) });
	const sh = s.findBone('upper_arm_l');
	const mx = (sh.worldX + wrist[0]) / 2;
	const my = (sh.worldY + wrist[1]) / 2;
	const k = 60 / Math.hypot(lower.worldX - mx, lower.worldY - my);
	const p = { x: lower.worldX + (lower.worldX - mx) * k, y: lower.worldY + (lower.worldY - my) * k };
	s.findBone('chest').worldToLocal(p);
	Object.assign(d.bones[9], { x: r4(p.x), y: r4(p.y) });
	const bendOf = (bend) => {
		const t = clone(d);
		t.ik = [{ name: 'arm_ik_l', order: 0, bones: ['upper_arm_l', 'lower_arm_l'], target: 'hand_ik_l', mix: 1, bendPositive: bend }];
		const e = poseAt(t, 'x', 0).findBone('lower_arm_l');
		return Math.hypot(e.worldX - lower.worldX, e.worldY - lower.worldY);
	};
	const bend = bendOf(true) <= bendOf(false);
	d.ik = [{ name: 'arm_ik_l', order: 0, bones: ['upper_arm_l', 'lower_arm_l'], target: 'hand_ik_l', mix: 0, bendPositive: bend }];
	d.transform = [{ name: 'hand_l_orient', order: 1, bones: ['hand_l'], target: 'hand_ik_l', mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0, rotation: 15 }];
	d.animations = {
		act: {
			bones: {
				chest: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: 20 }] },
				head: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: -15 }] },
				upper_arm_l: { rotate: [{ time: 0, value: 0, curve: [0.126, 0, 0.174, 30] }, { time: 0.3, value: 30 }, { time: 1, value: -20 }] },
				lower_arm_l: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: 40 }] },
				hand_ik_l: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1.2, x: 20, y: 30 }] },
			},
			ik: { arm_ik_l: [{ time: 0, mix: 0, softness: 0, bendPositive: bend, compress: false, stretch: false }, { time: 1.2, mix: 0.4, softness: 0, bendPositive: bend, compress: false, stretch: false }] },
		},
	};
	return d;
}
const BODY = bodyDoc();
const STORED = {
	controls: 1,
	rig: 'Body',
	irig: 'mark',
	bones: {
		hand_ik_l: { role: 'control', shape: 'square', size: 14 },
		elbow_pole_l: { role: 'control', shape: 'diamond', size: 10 },
		upper_arm_l: { shape: 'ring', size: 40, sizeIn: 'rig' },
		head: { shape: 'circle' },
	},
	limbs: { arm_l: { ik: 'arm_ik_l', fk: ['upper_arm_l', 'lower_arm_l'], control: 'hand_ik_l', pole: 'elbow_pole_l' } },
	sets: { hand_left: ['hand_ik_l', 'elbow_pole_l'] },
};
const ch = (id, label, min, max, drives, ui) => ({ id, label, tip: label, min, max, rest: 0, drives, ui });
const TEMPLATE = {
	id: 'face-test',
	version: 1,
	label: 'Face test',
	bones: [],
	slots: [],
	parts: [],
	clips: [],
	channels: [
		ch('gaze_x', 'gaze x', -1, 1, [{ bone: 'eye_l', prop: 'x', per: 4 }], { box: 'gaze', axis: 'x', at: [0.3, 0.45] }),
		ch('gaze_y', 'gaze y', -1, 1, [{ bone: 'eye_l', prop: 'y', per: 4 }], { box: 'gaze', axis: 'y' }),
		ch('jaw', 'jaw', 0, 1, [{ bone: 'head', prop: 'rotate', per: 10 }], { at: [0.75, 0.45], axis: 'y' }),
	],
};
const LEFT = ['eye_l', 'upper_arm_l', 'lower_arm_l', 'hand_l', 'hand_ik_l', 'elbow_pole_l'];
const PAIRS = LEFT.map((n) => [n, n.replace(/_l$/, '_r')]);

const w = JSON.parse(readFileSync(join(SYMBOLS3, 'W.json'), 'utf8'));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const RIGS = { W: w, Body: BODY };
const ENTRIES = Object.keys(RIGS).map((name, id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: `${name}.json`,
	atlas_file: 'symbols3.atlas',
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
const posted = [];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const readBody = (req) =>
	new Promise((r) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => r(s));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			const rig = Object.keys(RIGS).find((n) => b64(n) === url.searchParams.get('dir'));
			if (rig && name === `${rig}.json`) return jsonOut(RIGS[rig]);
			if (rig && /^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name)))
				return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/template') {
			if (url.searchParams.get('dir') === b64('Body')) return jsonOut({ template: TEMPLATE });
			return send(404, 'text/plain', 'none');
		}
		if (p === '/api/rigger/save' && req.method === 'GET') {
			const isBody = url.searchParams.get('stem') === 'Body';
			return jsonOut({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: isBody ? { etag: '"c1"', doc: STORED } : null });
		}
		if (p === '/api/rigger/save') {
			const body = JSON.parse(await readBody(req));
			posted.push(body);
			const n = posted.length;
			return jsonOut({ ok: true, saved: true, key: 'x', etag: `etag-${n}`, count: 2, ...(body.controls ? { controlsEtag: `"s${n}"` } : {}) });
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
const PORT = server.address().port;
const browser = await launchChrome({ name: 'rig-mirror', url: `http://127.0.0.1:${PORT}/`, args: ['--window-size=1600,1000'] });
const { evaluate, waitFor, send, pageLog } = browser;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) pass++;
	else fail++;
	console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
	return cond;
};
async function step(title, fn) {
	console.log(`\n${title}`);
	try {
		await fn();
	} catch (e) {
		fail++;
		console.log(`  ✗ the harness threw — ${e.message}`);
	}
}
const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
async function openRig(name) {
	const found = await evaluate(`(() => {
		document.getElementById("loadRigBtn").click();
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === ${q(name)});
		if (row) row.click();
		return !!row;
	})()`);
	await settle();
	await waitFor('!!skeleton && !!rawDoc', 15000);
	return found;
}
const setMode = (m) => evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const docNow = async () => JSON.parse(await evaluate('JSON.stringify(rawDoc)'));
const mouse = (type, pt, extra = {}) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, ...extra });
async function click(pt, modifiers = 0) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, modifiers });
	await mouse('mousePressed', pt, { modifiers });
	await mouse('mouseReleased', pt, { modifiers });
	await wait(40);
}
async function drag(from, to, modifiers = 0) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await mouse('mousePressed', from, { modifiers });
	for (let i = 1; i <= 8; i++)
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + ((to.x - from.x) * i) / 8), y: Math.round(from.y + ((to.y - from.y) * i) / 8), button: 'left', buttons: 1, modifiers });
	await mouse('mouseReleased', to, { modifiers });
	await wait(60);
}
// The middle of the first element `sel` matches (scrolled into view), on screen.
const centreOf = (sel) =>
	evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const clickButton = (root, text) =>
	evaluate(`(() => { const b = [...document.querySelectorAll(${q(root)} + " button")].find((x) => x.textContent.trim() === ${q(text)} && !x.disabled); if (b) b.click(); return !!b; })()`);
const selNames = async () => JSON.parse(await evaluate('JSON.stringify(selectedBoneNames().slice().sort())'));
const openSection = (id) => evaluate(`document.getElementById(${q(id)}).open = true; renderControlPanel(); true`);

try {
	await step('1. Body, Setup: ⧉ R from L builds the right side; ↶ / ↷', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2');
		await evaluate('window.confirm = () => true; window.alert = () => {}; true');
		await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
		ok('Body opens with its stored controls', (await openRig('Body')) && (await evaluate('!!controlsDoc && !!controlsDoc.limbs.arm_l')));
		await setMode('setup');
		await evaluate('fitView(); true');
		await openSection('secCtl');
		ok(
			'the Control layer’s Mirror block: its description is the header’s tooltip, and it names the bones with no other side',
			await evaluate('[...document.querySelectorAll("#ctlPanel .ctlHead")].some((h) => h.textContent.startsWith("Mirror") && /builds the side the rig is missing/.test(h.title)) && /No other side: .*hand_ik_l/.test(document.getElementById("ctlPanel").textContent)'),
		);
		ok('Mirror pose is off in Setup', await evaluate('[...document.querySelectorAll("#ctlPanel button")].filter((b) => ["L→R", "R→L", "⇄"].includes(b.textContent)).every((b) => b.disabled)'));
		ok('⧉ R from L', await clickButton('#ctlPanel', '⧉ R from L'));
		const d = await docNow();
		const s = poseAt({ ...d, animations: { x: {} } }, 'x', 0);
		const worst = Math.max(...PAIRS.map(([l, r]) => gap(W(s.findBone(r)), reflect(W(s.findBone(l)), rootLine(s)))));
		ok(
			`engine-rig poses the page’s rig with every right bone at its left’s mirror (${worst.toExponential(1)})`,
			PAIRS.every(([, r]) => d.bones.some((b) => b.name === r)) && worst < 1e-3 && d.ik.some((c) => c.name === 'arm_ik_r') && d.slots.some((x) => x.name === 'arm_r'),
			d.bones.map((b) => b.name).join(' '),
		);
		ok('its limb, set and controls follow in the sidecar', await evaluate('!!controlsDoc.limbs.arm_r && controlsDoc.limbs.arm_r.control === "hand_ik_r" && !!controlsDoc.sets.hand_right && controlsDoc.bones.hand_ik_r.shape === "square"'));
		ok('the bones are on the stage and nothing is left with no other side', await evaluate('!!skeleton.findBone("hand_r") && !/No other side/.test(document.getElementById("ctlPanel").textContent)'));
		await evaluate('historyFlush(); rigUndo(); true');
		const undone = await evaluate('!rawDoc.bones.some((b) => b.name === "upper_arm_r") && !controlsDoc.limbs.arm_r');
		await evaluate('rigRedo(); true');
		const redone = await evaluate('rawDoc.bones.some((b) => b.name === "upper_arm_r") && !!controlsDoc.limbs.arm_r');
		ok('one ↶ takes the whole side back, ↷ brings it back', undone && redone);
	});

	await step('2. 💾 Save: the built side and its sidecar', async () => {
		const n = posted.length;
		await evaluate(CLICK_SAVE);
		const body = posted.at(-1);
		ok('one save posted, with the sidecar', posted.length === n + 1 && !!body.controls);
		const irig = body.skeleton.irig ? exportSpine42Json(readIrig(body.skeleton)) : body.skeleton;
		const checked = RC.checkedControls(clone(body.controls), 'Body', irig);
		ok('C1 accepts that sidecar beside that skeleton', checked.problems.length === 0, checked.problems.join('; '));
		const s = poseAt({ ...irig, animations: { x: {} } }, 'x', 0);
		const worst = Math.max(...PAIRS.map(([l, r]) => gap(W(s.findBone(r)), reflect(W(s.findBone(l)), rootLine(s)))));
		ok(`engine-rig plays the saved skeleton with the right side mirrored (${worst.toExponential(1)})`, worst < 1e-3);
	});

	await step('3. Animate: the line along the chest, L→R and ⇄ at the playhead, played from the saved file', async () => {
		await setMode('animate');
		await evaluate('setCurAnim("act"); animTime = 0.6; syncPlayhead(); renderControlPanel(); true');
		// The chest turns in this clip, and the arm's ring keys only its turn: mirrored across the chest,
		// the shoulders stay where they hang.
		const lined = await evaluate(`(() => {
			const s = [...document.querySelectorAll("#ctlPanel .ctlBar select")].find((x) => [...x.options].some((o) => o.value === "chest"));
			if (!s) return false;
			s.value = "chest"; s.dispatchEvent(new Event("change", { bubbles: true }));
			return controlsDoc.mirror && controlsDoc.mirror.line === "chest";
		})()`);
		ok('the line select puts the mirror line along the chest (kept in the sidecar)', lined);
		const before = await docNow();
		ok('L→R', await clickButton('#ctlPanel', 'L→R'));
		const hint = await evaluate('document.getElementById("hint").textContent');
		ok('the hint says what it keyed, and nothing is off the mirror', /Mirrored left → right @ 0\.60s — \d+ bones/.test(hint) && !/off the mirror/.test(hint), hint);
		const n = posted.length;
		await evaluate(CLICK_SAVE);
		ok('one save posted', posted.length === n + 1);
		const saved = posted.at(-1).skeleton;
		const irig = saved.irig ? exportSpine42Json(readIrig(saved)) : saved;
		const was = poseAt(before, 'act', 0.6);
		const now = poseAt(irig, 'act', 0.6);
		const setup = poseAt({ ...before, animations: { x: {} } }, 'x', 0);
		const off = Math.max(...PAIRS.map(([l, r]) => gap(W(now.findBone(r)), mirrored(was, setup, l, r, chestLine))));
		let kept = 0;
		for (const t of [0, 0.3, 0.6, 0.9, 1.2]) {
			const a = poseAt(irig, 'act', t);
			const b = poseAt(before, 'act', t);
			for (const nm of [...LEFT, 'chest', 'head']) kept = Math.max(kept, gap(W(a.findBone(nm)), W(b.findBone(nm))));
		}
		ok(
			`the saved clip draws each right bone at its left’s mirror across the turned chest at 0.6 s (${off.toExponential(1)}), the left side and the centre as before at every time (${kept.toExponential(1)})`,
			off < 2e-3 && kept < 1e-6,
			PAIRS.map(([l, r]) => r + ' ' + gap(W(now.findBone(r)), mirrored(was, setup, l, r, chestLine)).toFixed(4)).join(', '),
		);
		const pre = await docNow();
		ok('⇄', await clickButton('#ctlPanel', '⇄'));
		const after = poseAt(await docNow(), 'act', 0.6);
		const was2 = poseAt(pre, 'act', 0.6);
		const swapped = Math.max(...PAIRS.flatMap(([l, r]) => [gap(W(after.findBone(r)), mirrored(was2, setup, l, r, chestLine)), gap(W(after.findBone(l)), mirrored(was2, setup, r, l, chestLine))]));
		const head = gap(W(after.findBone('head')), mirrored(was2, setup, 'head', 'head', chestLine));
		ok(`⇄ swaps the sides (${swapped.toExponential(1)}) and flips the head under the chest (${head.toExponential(1)})`, swapped < 2e-3 && head < 2e-3);
		await evaluate('historyFlush(); rigUndo(); true');
	});
	await step('4. the Picker: select, shift-add, box, move, the limb switch', async () => {
		await openSection('secPicker');
		const items = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("#pickerPanel .pickBoard:not(.faceBoard) .pickBtn")].map((b) => b.dataset.bone || b.textContent))'));
		ok('a button per control, the limbs and the sets (automatic)', items.filter((x) => /^(hand_ik|elbow_pole|upper_arm|head)/.test(x)).length === 7 && items.some((x) => /arm_l/.test(x)) && items.some((x) => /hand_left/.test(x)), items.join(' | '));
		ok('its description is the header’s tooltip', await evaluate('/drag across the board/.test(document.querySelector("#secPicker > summary").title)'));
		await click(await centreOf('#pickerPanel .pickBtn[data-bone="hand_ik_l"]'));
		ok('a click selects its bone', (await selNames()).join() === 'hand_ik_l');
		await click(await centreOf('#pickerPanel .pickBtn[data-bone="hand_ik_r"]'), 8);
		ok('shift-click adds one', (await selNames()).join() === 'hand_ik_l,hand_ik_r');
		const board = JSON.parse(await evaluate('(() => { const r = document.querySelector("#pickerPanel .pickBoard").getBoundingClientRect(); return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height }); })()'));
		await drag({ x: Math.round(board.l + 2), y: Math.round(board.t + 2) }, { x: Math.round(board.l + board.w * 0.45), y: Math.round(board.t + board.h - 2) });
		ok('a box across the left of the board selects the right side’s buttons', (await selNames()).join() === 'elbow_pole_r,hand_ik_r,upper_arm_r', (await selNames()).join());
		await evaluate('pickerMoving = true; renderPickerPanel(); true');
		const from = await centreOf('#pickerPanel .pickBtn[data-bone="head"]');
		await drag(from, { x: from.x + 30, y: from.y - 10 });
		const stored = JSON.parse(await evaluate('JSON.stringify(controlsDoc.picker && controlsDoc.picker.items)'));
		ok('✥ a dragged button keeps its new place, and the layout is kept in the sidecar', !!stored && stored.length === items.length && stored.find((it) => it.bone === 'head').at[0] > 0.55, JSON.stringify(stored && stored.find((it) => it.bone === 'head')));
		await evaluate('pickerMoving = false; renderPickerPanel(); animTime = 0.5; syncPlayhead(); renderControlPanel(); true');
		const limbBtn = await evaluate('(() => { const b = [...document.querySelectorAll("#pickerPanel .pickBtn.limb")].find((x) => x.textContent.includes("arm_l")); return b ? b.textContent : null; })()');
		ok('the limb’s button says where its IK blend is at the playhead', /arm_l blend 0.17/.test(limbBtn || ''), limbBtn);
		await click(await evaluate('(() => { const b = [...document.querySelectorAll("#pickerPanel .pickBtn.limb")].find((x) => x.textContent.includes("arm_l")); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) }; })()'));
		const mix = await evaluate('constraintValuesAt(rawDoc, curAnim, "ik", "arm_ik_l", 0.5).values.mix');
		await wait(60);
		ok('a click on it switches the limb to IK there (its mix 1), and its button says so', mix === 1 && (await evaluate('[...document.querySelectorAll("#pickerPanel .pickBtn.limb")].some((x) => /arm_l IK/.test(x.textContent))')), String(mix));
	});

	await step('5. the face board keys the template’s channels', async () => {
		ok('a gaze box and a jaw slider, where their `ui` puts them', await evaluate('document.querySelectorAll("#pickerPanel .faceBoard .faceTrack.box").length === 1 && document.querySelectorAll("#pickerPanel .faceBoard .faceTrack.v").length === 1'));
		await evaluate('animTime = 0.7; syncPlayhead(); true');
		const box = JSON.parse(await evaluate('(() => { const e = document.querySelector("#pickerPanel .faceBoard .faceTrack.box"); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height }); })()'));
		await drag({ x: Math.round(box.l + box.w / 2), y: Math.round(box.t + box.h / 2) }, { x: Math.round(box.l + box.w - 1), y: Math.round(box.t + 1) });
		const key = JSON.parse(await evaluate('JSON.stringify(((rawDoc.animations.act.bones.eye_l || {}).translate || []).find((k) => Math.abs(k.time - 0.7) < 1e-3) || null)'));
		ok('dragging its dot to the top right keys gaze x and y near their max on the eye at the playhead', key && key.x > 3.5 && key.y > 3.5, JSON.stringify(key));
		// a release the window never sees (outside it): the next move without a button ends the drag
		const mid = { x: Math.round(box.l + box.w / 2), y: Math.round(box.t + box.h / 2) };
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x, y: mid.y });
		await mouse('mousePressed', mid);
		ok('a press on the box starts a drag', await evaluate('!!pickerDrag && !!pickerDrag.face'));
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x + 200, y: mid.y, buttons: 0 });
		const keys0 = await evaluate('JSON.stringify(rawDoc.animations.act.bones.eye_l)');
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x - 20, y: mid.y + 20, buttons: 0 });
		ok('a move with no button down ends it, and later moves key nothing', (await evaluate('pickerDrag === null')) && keys0 === (await evaluate('JSON.stringify(rawDoc.animations.act.bones.eye_l)')));
		await mouse('mouseReleased', mid);
		if (shotAt) {
			await evaluate('document.getElementById("secBones").open = false; document.getElementById("secPicker").scrollIntoView({ block: "end" }); true');
			await wait(120);
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(shotAt, Buffer.from(shot.data, 'base64'));
			console.log(`  (page saved to ${shotAt})`);
		}
	});

	await step('6. the graph editor: an IK’s mix curve', async () => {
		await evaluate('selectIk("arm_ik_l"); tlView = "graph"; renderTimeline(); true');
		const curves = JSON.parse(await evaluate('JSON.stringify(graphMap && graphMap.src ? { kind: graphMap.src.kind, labels: graphMap.curves.map((c) => c.label) } : null)'));
		ok('an IK picked: the graph shows its mix and softness', curves && curves.kind === 'ik' && curves.labels.join() === 'mix,softness', JSON.stringify(curves));
		ok('the legend’s menu names it', await evaluate('[...document.querySelectorAll("#timeline select option")].some((o) => o.textContent === "IK arm_ik_l")'));
		const dot = JSON.parse(await evaluate(`(() => {
			const c = graphMap.curves.find((x) => x.label === "mix"), k = c.keys.find((x) => Math.abs(x.time - 0.5) < 1e-3), r = graphMap.svg.getBoundingClientRect();
			const y = graphMap.top + (graphMap.maxV - k.mix) / (graphMap.maxV - graphMap.minV) * graphMap.areaH;
			return JSON.stringify({ x: Math.round(r.left + graphMap.gutter + k.time * graphMap.pps), y: Math.round(r.top + y), t: k.time, mix: k.mix, perPx: (graphMap.maxV - graphMap.minV) / graphMap.areaH });
		})()`));
		ok('the key’s dot is under the pointer', await evaluate(`(() => { const e = document.elementFromPoint(${dot.x}, ${dot.y}); return !!e && e.tagName === "circle"; })()`));
		await drag({ x: dot.x, y: dot.y }, { x: dot.x, y: dot.y + Math.round(0.3 / dot.perPx) });
		const after = await evaluate(`rawDoc.animations.act.ik.arm_ik_l.find((k) => Math.abs(k.time - ${dot.t}) < 1e-3).mix`);
		ok(`dragging the mix key at the switch down lowers it (${dot.mix} → ${after})`, dot.mix === 1 && after < 0.8 && after >= 0.6);
		const mid = await evaluate('graphValueAt(graphMap.curves.find((c) => c.label === "mix"), 0.85)');
		const game = poseAt(await docNow(), 'act', 0.85).ikConstraints.find((c) => c.data.name === 'arm_ik_l').mix;
		ok(`and the curve the graph draws is what engine-rig plays (${mid.toFixed(4)} / ${game.toFixed(4)})`, Math.abs(mid - game) < 1e-4);
		// a click on the bone already selected, in the tree: the graph shows the bone's channels again
		await evaluate('document.getElementById("secBones").open = true; true');
		await click(await centreOf(`#boneTree .trow[data-bone="${await evaluate('selBone')}"]`));
		ok('a click on the selected bone’s row brings the graph back to the bone', await evaluate('!!graphMap && graphMap.src.kind === "bone"'), await evaluate('JSON.stringify(graphMap && graphMap.src && graphMap.src.kind)'));
		await evaluate('tlView = "dope"; renderTimeline(); true');
	});

	await step('7. W: pair two bones, mirror them; the picker; a transform’s mix curve; save', async () => {
		ok('W opens', await openRig('W'));
		await setMode('animate');
		await evaluate('setCurAnim("wild_dynamite"); fitView(); true');
		await openSection('secCtl');
		ok('its Mirror says it has no pairs', await evaluate('mirrorPairs(rawDoc, controlsDoc).pairs.length === 0'));
		await evaluate('selectBone(skeletonData.bones.findIndex((b) => b.name === "exp_spark1")); toggleBoneSelected(skeletonData.bones.findIndex((b) => b.name === "exp_spark5")); true');
		await evaluate('[...document.querySelectorAll("#ctlPanel .ctlHead")].find((h) => h.textContent.startsWith("Mirror")).querySelector("button").click(); true');
		ok('＋ pairs the two selected bones, the first one left', await evaluate('!!controlsDoc && controlsDoc.mirror && controlsDoc.mirror.pairs.exp_spark1 === "exp_spark5"'));
		const L = await evaluate('workLen(curAnim)');
		const t = Math.round(L * 0.4 * 100) / 100;
		await evaluate(`animTime = ${t}; syncPlayhead(); renderControlPanel(); true`);
		const before = await docNow();
		ok('L→R', await clickButton('#ctlPanel', 'L→R'));
		const now = poseAt(await docNow(), 'wild_dynamite', t);
		const was = poseAt(before, 'wild_dynamite', t);
		const setup = poseAt({ ...before, animations: { x: {} } }, 'x', 0);
		const off = gap(W(now.findBone('exp_spark5')), mirrored(was, setup, 'exp_spark1', 'exp_spark5'));
		ok(`the right one takes the left one’s pose, mirrored across the root, as engine-rig plays it (${off.toExponential(1)})`, off < 2e-3);
		await openSection('secPicker');
		ok('the picker has no controls to show yet', await evaluate('!!document.querySelector("#pickerPanel .pickEmpty")'));
		await evaluate('[...document.querySelectorAll("#pickerPanel .ctlBar button")].find((b) => b.textContent === "＋").click(); true');
		await evaluate('(() => { const b = [...document.querySelectorAll("#curveMenu button")].find((x) => x.textContent.startsWith("the selected bones")); b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); })(); true');
		ok('＋ the selected bones: two buttons, kept in the sidecar', await evaluate('document.querySelectorAll("#pickerPanel .pickBtn.bone").length === 2 && controlsDoc.picker.items.length === 2'));
		// a transform's mix keyed at two times, then graphed
		await evaluate(`animTime = 0.1; keyConstraintField("transform", "wild_clock2", "mixRotate", 0.2); animTime = ${Math.round(L * 0.8 * 100) / 100}; keyConstraintField("transform", "wild_clock2", "mixRotate", 0.9); selectTc("wild_clock2"); tlView = "graph"; renderTimeline(); true`);
		const labels = JSON.parse(await evaluate('JSON.stringify(graphMap && graphMap.curves.map((c) => c.label))'));
		ok('the graph shows the transform’s six mixes', labels && labels.join() === 'mixRotate,mixX,mixY,mixScaleX,mixScaleY,mixShearY', JSON.stringify(labels));
		const mid = await evaluate(`graphValueAt(graphMap.curves.find((c) => c.label === "mixRotate"), ${Math.round(L * 0.45 * 100) / 100})`);
		const game = poseAt(await docNow(), 'wild_dynamite', Math.round(L * 0.45 * 100) / 100).transformConstraints.find((c) => c.data.name === 'wild_clock2').mixRotate;
		ok(`its mixRotate curve is what engine-rig plays (${mid.toFixed(4)} / ${game.toFixed(4)})`, Math.abs(mid - game) < 1e-4);
		await evaluate('tlView = "dope"; renderTimeline(); true');
		const n = posted.length;
		await evaluate(CLICK_SAVE);
		ok('one save posted', posted.length === n + 1);
		const body = posted.at(-1);
		const irig = body.skeleton.irig ? exportSpine42Json(readIrig(body.skeleton)) : body.skeleton;
		const checked = body.controls ? RC.checkedControls(clone(body.controls), 'W', irig) : { problems: ['no sidecar sent'] };
		ok('the save sends the pair and the picker, and C1 accepts them beside the skeleton', checked.problems.length === 0 && !!body.controls.mirror && body.controls.picker.items.length === 2, checked.problems.join('; '));
		if (shotAt) {
			const file = shotAt.replace(/(.png)?$/, '-w.png');
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(file, Buffer.from(shot.data, 'base64'));
			console.log(`  (page saved to ${file})`);
		}
	});

	await step('8. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length) console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass}/${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
