// Browser gate for when a 3D clip bakes (the hotfix after 2.5D P3a: the Rigger baked a whole 3D clip
// behind a blocking overlay on every click), on the SHIPPED view.html and the committed
// vendor/rigger-2p5d.js in a real Chromium against a fake launcher API, with a real `half-body` rig
// built by the server's `templateRig`, its template's control layer, and a dense clip keyed in 3D on
// every bone (as a 3D motion import keys it). Checked:
//  - what is not an edit bakes nothing, shows no overlay and leaves the clip and the undo history as
//    they were: clicking bones and their controls on the stage, a press and release on the gizmo,
//    scrubbing the timeline, opening and closing panels, the picker, turning the view, hover, play;
//  - one real 3D key bakes ONCE, off the page (a job in the worker, none on the page, no overlay): the
//    page keeps answering while it runs, the 🧊 bar shows its mark, and the stage draws the clip's
//    3D pose meanwhile (as the bake then plays it);
//  - an edit while a bake runs cancels it: the next bake is of both edits, taken once;
//  - undo to a step closed before its bake landed bakes it again (and redo to a baked one does not);
//  - 💾 while a bake runs waits for it, and what it sends is the bake the save itself makes;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/rig-3d-bake-browser.mjs
// Mutation check: `MUTANT=<name>` serves the page with one guard undone, and the gate must fail —
// click (a click keys), blocking (the bake holds the page), cancel (an edit leaves the bake running),
// unbaked (undo trusts an unbaked step), held (the stage shows the old bake while one runs).
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
let html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');

const MUTANTS = {
	click: [
		'if (p.x !== p.from.x || p.y !== p.from.y || p.rotation !== p.from.rotation){',
		'if (true){',
	],
	blocking: ['if (bake3dJob.broken) return bakeOnPage(name);', 'return bakeOnPage(name);'],
	cancel: [
		'bake3d.editAt = performance.now();\n  cancelBake3d();',
		'bake3d.editAt = performance.now();',
	],
	unbaked: ['if (entry.unbaked){ bake3d.sig = {}; rebake3dSoon(); }', ''],
	held: [' || (bake3d.pending && animMode && !!clip3d(curAnim));', ';'],
};
const MUTANT = process.env.MUTANT;
if (MUTANT) {
	const m = MUTANTS[MUTANT];
	if (!m || !html.includes(m[0])) {
		console.log(`✗ mutant "${MUTANT}" does not apply to view.html — update MUTANTS`);
		process.exit(2);
	}
	html = html.replace(m[0], m[1]);
	console.log(`(mutant: ${MUTANT})`);
}

const esbuild = await import(ESBUILD);
const tmp = mkdtempSync(join(tmpdir(), 'rig-3d-bake-'));
const out = join(tmp, 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { HALF_BODY, templateRig, rigTemplateFromSidecar } = await import(pathToFileURL(out).href);
// The save's bake, from the bundle the page runs (the same modules as `server/rigger3d.ts`).
const bundled = join(tmp, 'rigger-2p5d.mjs');
writeFileSync(
	bundled,
	readFileSync(join(STATIC, 'rigger/vendor/rigger-2p5d.js'), 'utf8') +
		'\nexport default Rigger2p5d;\n',
);
const R2 = (await import(pathToFileURL(bundled).href)).default;

function png(w, h, at) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0;
		for (let x = 0; x < w; x++) raw.set(at(x, y), y * (w * 4 + 1) + 1 + x * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

// The rig: flat grey parts, packed in rows; a 2 s clip keyed on every bone at 30 fps.
const PAGE_W = 2048;
let x = 0;
let y = 0;
let rowH = 0;
const lines = [];
const ART = HALF_BODY.parts.filter(
	(p) =>
		!/^(head|hand_[lr])_(3q_[lr]|side_[lr]|3q_back_[lr]|back)$|^torso_(3q_back_[lr]|back)$/.test(
			p.name,
		),
);
for (const p of ART) {
	const [w, h] = p.size;
	if (x + w > PAGE_W) {
		x = 0;
		y += rowH;
		rowH = 0;
	}
	lines.push(p.name, `bounds:${x},${y},${w},${h}`);
	x += w;
	rowH = Math.max(rowH, h);
}
const PAGE_H = y + rowH;
const page = png(PAGE_W, PAGE_H, () => [120, 120, 170, 255]);
const rig = templateRig(
	HALF_BODY,
	ART.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
).skeleton;
const SECONDS = 2;
const FPS = 30;
const bones = {};
for (const [i, b] of rig.bones.entries()) {
	if (b.name === 'root') continue;
	const rotate = [];
	for (let f = 0; f <= SECONDS * FPS; f++)
		rotate.push({ time: f / FPS, value: Math.round(1200 * Math.sin((f / FPS) * 3 + i)) / 100 });
	bones[b.name] = { rotate };
}
rig.animations = { animation: { bones } };
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...lines].join('\n'),
	template: rigTemplateFromSidecar(JSON.stringify({ id: 'half-body', version: HALF_BODY.version })),
	controls: { ...HALF_BODY.controls, controls: 1, rig: 'half-body' },
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const seen = { saves: [], other: [] };
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.png': 'image/png',
	'.json': 'application/json',
};
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
		if (p === '/rig-viewer/skeletons')
			return json({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: [
					{
						id: 0,
						name: 'half',
						folder: 'half',
						dir_b64: b64('half'),
						skeleton_file: 'half.irig',
						atlas_file: 'half.atlas',
						format: 'json',
						runtime: '4.2',
						version: '4.2',
						pma: false,
					},
				],
			});
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (name.endsWith('.irig')) return json(RIG.rig);
			if (name.endsWith('.atlas')) return send(200, 'text/plain', RIG.atlas);
			if (name.endsWith('.png')) return send(200, 'image/png', page);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: RIG.template });
		if (p === '/api/editor/flipbooks') return json({ clips: [] });
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({
				ok: true,
				projectKey: 'p',
				etag: null,
				rig3d: null,
				controls: { etag: '"c1"', doc: RIG.controls },
			});
		if (p === '/api/rigger/save' && req.method === 'POST') {
			let t = '';
			for await (const c of req) t += c;
			const b = JSON.parse(t);
			seen.saves.push(b);
			const n = seen.saves.length;
			return json({
				ok: true,
				key: 'k',
				etag: `e${n}`,
				count: 1,
				rig3dEtag: b.rig3d ? `r${n}` : undefined,
				controlsEtag: b.controls ? `"c${n + 1}"` : undefined,
				rebaked: [],
				detached: [],
				unmet: [],
			});
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) {
			if (req.method !== 'GET') seen.other.push(req.method + ' ' + p);
			return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		}
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await launchChrome({
	name: 'rig-3d-bake',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--mute-audio'],
});
const { evaluate, waitFor, pageLog, send } = browser;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) pass++;
	else fail++;
	console.log(
		`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`,
	);
	return cond;
};
const q = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Let a bake under way (or one an edit just asked for) run and land. */
const settled = () =>
	waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		300000,
	);
/** Past the time an edit's bake waits for the edits to settle, then settled. */
const quiet = async () => {
	await sleep(500);
	await settled();
};
const SHOWN_ERR =
	'(() => { const e = document.getElementById("err"); return e && e.style.display === "block" ? e.textContent : ""; })()';
const boneIndex = (n) => `skeletonData.bones.findIndex((b) => b.name === ${q(n)})`;
/** Page coordinates of bone `n`'s origin as the stage draws it. */
const screenOf = (n) =>
	evaluate(`(() => {
		const b = skeleton.findBone(${q(n)}), cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(b.worldX, b.worldY, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
	})()`);
/** Page coordinates of element `sel` at fraction (fx, fy) of its box. */
const elAt = (sel, fx = 0.5, fy = 0.5) =>
	evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null;
		const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) }; })()`);
const mouse = (type, pt, buttons = 0) =>
	send('Input.dispatchMouseEvent', {
		type,
		x: pt.x,
		y: pt.y,
		button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left',
		buttons,
		clickCount: 1,
	});
const click = async (pt) => {
	await mouse('mouseMoved', pt);
	await mouse('mousePressed', pt, 1);
	await mouse('mouseReleased', pt);
};
/** Type `value` into the bone panel's field `label` and commit it (as leaving the field does). */
const typeField = (label, value) =>
	evaluate(`(() => {
		const row = [...document.querySelectorAll("#boneDetail label")].find((l) => l.querySelector("span") && l.querySelector("span").textContent === ${q(label)});
		const inp = row && row.querySelector("input"); if (!inp) return false;
		inp.focus(); inp.value = ${q(String(value))}; inp.dispatchEvent(new Event("change")); inp.blur(); return true;
	})()`);
const pick = (bone, t) =>
	evaluate(
		`(() => { animTime = ${t}; syncPlayhead(); selectBone(${boneIndex(bone)}); renderBoneDetail(); return true; })()`,
	);
/** What the page did since the last call: bake jobs, bakes on the page, bakes taken, overlays, … */
const counts = () =>
	evaluate(
		'(() => { const c = Object.assign({}, window.__c); for (const k of Object.keys(window.__c)) window.__c[k] = 0; return c; })()',
	);
const unchanged = () =>
	evaluate(
		'({ doc: historyText() === window.__snap, steps: rigHist.past.length === window.__steps && !rigHist.pending })',
	);
const snap = () =>
	evaluate(
		'(historyFlush(), window.__snap = historyText(), window.__steps = rigHist.past.length, true)',
	);
const current = () => evaluate('bake3dSig("animation") === bake3d.sig.animation');
const nothing = (c) => c.jobs === 0 && c.onPage === 0 && c.overlay === 0 && c.adopts === 0;

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("loadRigBtn")', 30000);
	await evaluate(`(() => {
		window.__alerts = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = () => true;
		document.getElementById("loadRigBtn").click();
		return true;
	})()`);
	await waitFor(
		'[...document.querySelectorAll("#list .item .nm")].some((n) => n.textContent === "half")',
		30000,
	);
	await evaluate(
		`(() => { [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "half").click(); return true; })()`,
	);
	await waitFor(
		'!!skeleton && selected && selected.name === "half" && rigTemplate !== null',
		30000,
	);
	await sleep(200);
	await evaluate(
		`(() => { document.querySelector('#modeSeg button[data-mode="animate"]').click(); return true; })()`,
	);
	await waitFor('!!rawDoc && animMode', 30000);
	await evaluate('setCurAnim("animation"); animTime = 0; playing = false; true');
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc', 15000);
	await evaluate(
		'(() => { [...document.querySelectorAll("#clip3dRow button")].find((b) => b.textContent.includes("3D from this clip")).click(); return true; })()',
	);
	await waitFor('!!clip3d("animation")', 30000);
	await quiet();
	// Every bone turns in 3D, keyed at 30 fps (rotate, tilt, twist), as a 3D motion import keys it.
	await evaluate(`(() => {
		const R = Rigger2p5d, c = rig3d.doc.clips.animation;
		skeletonData.bones.forEach((b, i) => {
			if (b.name === "root") return;
			const orient = [];
			for (let f = 0; f <= ${SECONDS * FPS}; f++){
				const t = f / ${FPS};
				orient.push({ time: t, value: R.orientAlong(12 * Math.sin(t * 3 + i), 20 * Math.sin(t * 2 + i), 10 * Math.cos(t * 2 + i), boneAlong(b.name)) });
			}
			c.bones[b.name] = { orient };
			const a = rawDoc.animations.animation.bones[b.name]; if (a) delete a.rotate;
		});
		markDirty();
		return true;
	})()`);
	await quiet();
	const setup = await evaluate(
		'({ owned: bake3d.owned.animation.size, current: bake3dSig("animation") === bake3d.sig.animation, controls: !!controlsDoc && Object.keys(controlsDoc.bones || {}).length })',
	);
	ok(
		'the rig: every bone keyed in 3D, baked, with its template’s control layer',
		setup.owned > 50 && setup.current && setup.controls > 10,
		q(setup),
	);

	await evaluate(`(() => {
		window.__c = { jobs: 0, terminated: 0, onPage: 0, adopts: 0, overlay: 0, busy: 0 };
		const post = Worker.prototype.postMessage, stop = Worker.prototype.terminate;
		Worker.prototype.postMessage = function () { window.__c.jobs++; return post.apply(this, arguments); };
		Worker.prototype.terminate = function () { window.__c.terminated++; return stop.apply(this, arguments); };
		const R = window.Rigger2p5d;
		for (const f of ["rebakeClip3d", "bakeTransition3d"]){ const g = R[f]; R[f] = function () { window.__c.onPage++; return g.apply(this, arguments); }; }
		const adopt = adoptBake3d;
		adoptBake3d = function () { window.__c.adopts++; return adopt.apply(this, arguments); };
		const mark = showBake3dBusy;
		showBake3dBusy = (n) => { if (n && document.getElementById("bake3dBusy")) window.__c.busy++; mark(n); };
		const ov = document.getElementById("loadingOverlay");
		new MutationObserver(() => { if (ov.classList.contains("on")){ window.__c.overlay++; window.__overlayText = document.getElementById("loadingMsg").textContent; } }).observe(ov, { attributes: true });
		// The page's heartbeat: the longest it went without running a timer.
		window.__gap = 0; let last = performance.now();
		setInterval(() => { const now = performance.now(); window.__gap = Math.max(window.__gap, now - last); last = now; }, 20);
		window.__beat = () => { window.__gap = 0; last = performance.now(); };
		return true;
	})()`);

	// 1. What is not an edit bakes nothing. First on the rig as made before its control layer (T12a),
	// where a click on a bone poses it (a drag would move it), then on the template's control layer.
	const clickBones = async (names) => {
		const picked = [];
		for (const n of names) {
			await click(await screenOf(n));
			await sleep(80);
			picked.push(await evaluate('selBone != null ? skeletonData.bones[selBone].name : null'));
		}
		return picked;
	};
	await evaluate('window.__ctl = controlsDoc; controlsDoc = null; true');
	await snap();
	await counts();
	let picked = await clickBones(['lower_arm_l', 'head', 'upper_arm_r']);
	await quiet();
	let c = await counts();
	let u = await unchanged();
	ok(
		'clicking bones on the stage selects them and bakes nothing (no job, no overlay, no key, no undo step)',
		picked.every(Boolean) && new Set(picked).size === 3 && nothing(c) && u.doc && u.steps,
		q({ picked, c, u }),
	);
	await evaluate('controlsDoc = window.__ctl; true');
	await snap();
	picked = await clickBones(['upper_arm_l', 'neck']);
	const ringed = await evaluate(
		`${q(picked)}.filter((n) => { const c = n && (controlsDoc.bones || {})[n]; return !!c && !!(c.shape || c.role); }).length`,
	);
	await quiet();
	c = await counts();
	u = await unchanged();
	ok(
		'…and clicking their controls’ shapes (the template’s rings) does too',
		picked.every(Boolean) && ringed >= 1 && nothing(c) && u.doc && u.steps,
		q({ picked, ringed, c, u }),
	);
	const sel = await screenOf(picked.at(-1));
	await mouse('mouseMoved', sel);
	await mouse('mousePressed', sel, 1);
	await sleep(60);
	await mouse('mouseReleased', sel);
	await quiet();
	c = await counts();
	u = await unchanged();
	ok(
		'a press and release on the gizmo, nothing moved, bakes nothing',
		nothing(c) && u.doc && u.steps,
		q({ c, u }),
	);
	const r0 = await elAt('#tlRuler', 0.3, 0.5);
	const r1 = await elAt('#tlRuler', 0.7, 0.5);
	await mouse('mouseMoved', r0);
	await mouse('mousePressed', r0, 1);
	for (let k = 1; k <= 5; k++)
		await mouse('mouseMoved', { x: Math.round(r0.x + ((r1.x - r0.x) * k) / 5), y: r0.y }, 1);
	await mouse('mouseReleased', r1);
	await click(await elAt('#tlRuler', 0.5, 0.5));
	const scrubbed = await evaluate('animTime');
	await quiet();
	c = await counts();
	u = await unchanged();
	ok(
		'scrubbing the timeline (a drag and a click on the ruler) bakes nothing',
		scrubbed > 0.5 && scrubbed < 1.5 && nothing(c) && u.doc && u.steps,
		q({ scrubbed, c, u }),
	);
	for (const id of ['secPicker', 'secCtl', 'secConstraints', 'secSlots', 'secAnims'])
		for (let k = 0; k < 2; k++) {
			const s = await elAt(`#${id} > summary`, 0.3, 0.5);
			if (s) await click(s);
			await sleep(40);
		}
	await evaluate('document.getElementById("secPicker").open = true; true');
	await sleep(100);
	const btn = await elAt('#secPicker .pickBtn.bone');
	if (btn) await click(btn);
	const viaPicker = await evaluate('selBone != null ? skeletonData.bones[selBone].name : null');
	await quiet();
	c = await counts();
	u = await unchanged();
	ok(
		'opening and closing panels, and picking a control in the picker, bake nothing',
		!!btn && nothing(c) && u.doc && u.steps,
		q({ btn: !!btn, viaPicker, c, u }),
	);
	await evaluate(
		'(() => { const r = document.getElementById("viewTurn"); r.value = "40"; r.dispatchEvent(new Event("input")); return true; })()',
	);
	await sleep(120);
	await click(await elAt('#viewSide'));
	await sleep(120);
	await click(await elAt('#viewTurnNum'));
	for (const n of ['hand_l', 'neck', 'upper_arm_l']) await mouse('mouseMoved', await screenOf(n));
	await click(await elAt('#play'));
	await sleep(400);
	await click(await elAt('#play'));
	await quiet();
	c = await counts();
	u = await unchanged();
	ok(
		'turning the view, hovering bones and playing bake nothing',
		nothing(c) && u.doc && u.steps && (await evaluate('viewTurn === 0 && !playing')),
		q({ c, u }),
	);

	// 2. One real 3D key: one bake, off the page.
	await pick('upper_arm_l', 0.5);
	await counts();
	await evaluate('window.__beat(); window.__heldSeen = null; true');
	await typeField('tilt', 40);
	// While it bakes: the stage draws the clip's held 3D pose; read the arm as it is drawn.
	await waitFor('window.__c.jobs > 0 || window.__c.onPage > 0', 60000);
	const during = await evaluate(`(() => {
		const held = bake3d.pending && view3dHeld(), up = () => skeleton.updateWorldTransform(RIG.Physics ? RIG.Physics.update : undefined);
		applyView3d(); up();
		const a = skeleton.findBone("upper_arm_l"), l = skeleton.findBone("lower_arm_l");
		const drawn = [a.worldX, a.worldY, l.worldX, l.worldY];
		restoreView3d(); up();
		return { held, drawn, pending: bake3d.pending, busy: getComputedStyle(document.getElementById("bake3dBusy")).display !== "none" };
	})()`);
	await settled();
	const gap = await evaluate('window.__gap');
	c = await counts();
	const after = await evaluate(`(() => {
		rebuildFromRawDoc(null);
		const s2 = new RIG.Skeleton(skeletonData), st2 = new RIG.AnimationState(new RIG.AnimationStateData(skeletonData));
		st2.setAnimation(0, "animation", false); st2.update(0.5); st2.apply(s2);
		s2.updateWorldTransform(RIG.Physics ? RIG.Physics.update : undefined);
		const a = s2.findBone("upper_arm_l"), l = s2.findBone("lower_arm_l");
		return { played: [a.worldX, a.worldY, l.worldX, l.worldY], bakeMs: (bake3d.msPerSec.animation || 0) * ${SECONDS},
			tilt: authored3dAt("upper_arm_l", 0.5).tilt, current: bake3dSig("animation") === bake3d.sig.animation };
	})()`);
	ok(
		'one 3D key bakes once, off the page: one job in the worker, none on the page, no overlay, taken once, current',
		c.jobs === 1 &&
			c.onPage === 0 &&
			c.overlay === 0 &&
			c.adopts === 1 &&
			after.current &&
			Math.abs(after.tilt - 40) < 0.01,
		q({ c, after }),
	);
	// A bake on the page stalls it for the whole bake; off the page the longest stall is a frame, the
	// job's post or the panels redrawn when it lands (machine-bound, so held against the bake's time).
	ok(
		'…the page keeps answering while it bakes (its longest stall well under the bake), the 🧊 bar showing its mark',
		after.bakeMs > 1000 && gap < after.bakeMs / 4 && c.busy >= 1 && during.busy,
		q({ gap: Math.round(gap), bakeMs: Math.round(after.bakeMs), busy: c.busy, shown: during.busy }),
	);
	// The bake keeps every bone within its tolerance (0.45 rig units) of the 3D pose.
	const drift = Math.max(
		Math.hypot(during.drawn[0] - after.played[0], during.drawn[1] - after.played[1]),
		Math.hypot(during.drawn[2] - after.played[2], during.drawn[3] - after.played[3]),
	);
	ok(
		'…and the stage draws the clip’s 3D pose meanwhile, as the bake then plays it',
		during.held && during.pending && drift < 1,
		q({ during, played: after.played, drift }),
	);

	// 3. An edit while a bake runs cancels it.
	await pick('upper_arm_l', 0.5);
	await counts();
	await typeField('twist', 25);
	await waitFor('window.__c.jobs > 0 || window.__c.onPage > 0', 60000);
	await typeField('depth', 12);
	await settled();
	c = await counts();
	const both = await evaluate(
		'(() => { const v = authored3dAt("upper_arm_l", 0.5); return { twist: v.twist, depth: v.depth - ((rig3d.doc.bones.upper_arm_l || {}).depth || 0) }; })()',
	);
	ok(
		'an edit while a bake runs cancels it: the next bake is of both edits, taken once',
		c.jobs === 2 &&
			c.terminated >= 1 &&
			c.adopts === 1 &&
			c.onPage === 0 &&
			c.overlay === 0 &&
			Math.abs(both.twist - 25) < 0.01 &&
			Math.abs(both.depth - 12) < 0.01 &&
			(await current()),
		q({ c, both }),
	);

	// 4. Undo to a step closed before its bake landed bakes it; redo to a baked one does not.
	await evaluate('rigUndo(); true');
	await quiet();
	c = await counts();
	const undone = await evaluate(`(() => {
		const v = authored3dAt("upper_arm_l", 0.5), d = v.depth - ((rig3d.doc.bones.upper_arm_l || {}).depth || 0);
		const fresh = Rigger2p5d.rebakeClip3d({ irig: rawDoc, doc: rig3d.doc, clip: "animation", owned: [...bake3d.owned.animation] });
		return { twist: v.twist, depth: d, same: JSON.stringify(fresh.irig.animations.animation) === JSON.stringify(rawDoc.animations.animation) };
	})()`);
	ok(
		'undo to the twist (its step closed while its bake ran) bakes it again: the clip plays its own bake',
		c.jobs === 1 &&
			c.adopts === 1 &&
			c.overlay === 0 &&
			Math.abs(undone.twist - 25) < 0.01 &&
			Math.abs(undone.depth) < 0.01 &&
			undone.same &&
			(await current()),
		q({ c, undone }),
	);
	await counts();
	await evaluate('rigRedo(); true');
	await quiet();
	c = await counts();
	ok(
		'…and redo to the baked depth step bakes nothing',
		c.jobs === 0 && c.adopts === 0 && (await current()),
		q(c),
	);

	// 5. 💾 while a bake runs waits for it; what it sends is the save's own bake.
	await pick('lower_arm_l', 1);
	await typeField('tilt', 20);
	await evaluate('saveToR2().then(() => true)');
	c = await counts();
	const body = seen.saves.at(-1);
	const sent = body && body.skeleton.animations.animation;
	let saveBake = null;
	if (body) {
		const irigIn = structuredClone(body.skeleton);
		const r = R2.rigOf(irigIn, body.rig3d);
		const plan = R2.clipOf(r, irigIn, body.rig3d, 'animation');
		const irig = R2.withBake(
			irigIn,
			'animation',
			plan,
			R2.bake2p5d(r, plan.clip),
			R2.followersOf(body.rig3d),
		);
		saveBake = irig.animations.animation;
	}
	const overlayText = await evaluate('window.__overlayText || ""');
	ok(
		'💾 while a bake runs waits for it (behind the overlay, saying so), then sends the clip with it',
		seen.saves.length === 1 &&
			c.jobs === 1 &&
			c.adopts === 1 &&
			/before saving/.test(overlayText) &&
			!!body.rig3d &&
			Math.abs(
				R2.anglesAlong(
					R2.boneKeysAt(body.rig3d.clips.animation.bones.lower_arm_l, 1).orient,
					await evaluate('boneAlong("lower_arm_l")'),
				).tilt - 20,
			) < 0.01,
		q({ saves: seen.saves.length, c, overlayText }),
	);
	// The same keys, every number within 1e-6: the page bakes in Chromium and the save in Node, whose
	// last digits of a value near 0 (a finger's translate, 1e-8) may differ.
	const apart = (a, b) => {
		if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
		if (Array.isArray(a) !== Array.isArray(b) || typeof a !== typeof b) return Infinity;
		if (a === null || typeof a !== 'object') return a === b ? 0 : Infinity;
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		let most = 0;
		for (const k of keys) most = Math.max(most, k in a && k in b ? apart(a[k], b[k]) : Infinity);
		return most;
	};
	const bakeGap = sent && saveBake ? apart(sent, saveBake) : Infinity;
	ok(
		'…and the bake it sends is the one the save makes of it',
		bakeGap <= 1e-6,
		sent && saveBake ? `numbers up to ${bakeGap} apart` : 'nothing sent',
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok(
		'no alert, no error shown',
		(await evaluate('window.__alerts.length')) === 0 && !(await evaluate(SHOWN_ERR)),
		await evaluate(`window.__alerts.join(" | ") + " " + ${SHOWN_ERR}`),
	);
	ok('nothing else was sent to the server', seen.other.length === 0, q(seen.other));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(
	`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — 3D bake on edits only, off the page ${pass}/${pass + fail}`,
);
process.exit(fail === 0 ? 0 : 1);
