// Browser gate for the stage of a 2.5D rig (2.5D P3b, docs/design/rig-2p5d.md §9), on the SHIPPED
// view.html and the committed vendor/rigger-2p5d.js in a real Chromium against a fake launcher API,
// with a real `half-body` rig built by the server's `templateRig`. Checked:
//  - the bar's view slider shows on a 3D rig in Setup and Animate (not in Preview, not on a 2D rig);
//    from the side (90°) the face (95 in front of the head) is drawn 95 across the stage, the head's
//    card edge-on, and 0° puts the front view back with nothing changed;
//  - in Setup with the view turned, the depth arrow sets the setup depth (one undo takes it back);
//  - on a 3D clip the gizmo is the 3D one: the X, Y and depth arrows and the rotate, tilt and twist
//    rings, its X along the bone's length (as #1834 reads tilt and twist); each ring, dragged with
//    the mouse, turns the arm 30° about its axis as drawn, drawn while dragged (the held pose) and
//    keyed in 3D on release; one undo takes back the last drag;
//  - in View with the view turned, the stage's depth arrow moves the arm along the stage's depth with
//    the point under the cursor (on the stage as engine-rig draws it), keyed as depth;
//  - a control keying only its rotate keeps the rotate ring alone, offers Tilt / Twist / Depth on its
//    card, locks the bone panel's tilt and twist, and a View ring leaves its locked angles; a tilt
//    limit holds a ring drag;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/rig-3d-stage-browser.mjs
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'rig-3d-stage-')), 'templates.mjs');
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

// The rig: flat grey parts, packed in rows.
const PAGE_W = 2048;
let x = 0;
let y = 0;
let rowH = 0;
const lines = [];
for (const p of HALF_BODY.parts) {
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
const page = png(PAGE_W, y + rowH, () => [120, 120, 170, 255]);
const rig = templateRig(
	HALF_BODY,
	HALF_BODY.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
).skeleton;
rig.animations = { take: {} };
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${y + rowH}`, 'filter:Linear,Linear', ...lines].join('\n'),
	template: rigTemplateFromSidecar(JSON.stringify({ id: 'half-body', version: HALF_BODY.version })),
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const seen = { saves: [], other: [] };
let stored = null;
let stored3d = null;
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
	const body = async () => {
		let t = '';
		for await (const c of req) t += c;
		return JSON.parse(t);
	};
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
			if (name.endsWith('.irig')) return json(stored ?? RIG.rig);
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
				etag: stored ? `e${seen.saves.length}` : null,
				rig3d: stored3d ? { etag: `r${seen.saves.length}`, doc: stored3d } : null,
			});
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const b = await body();
			seen.saves.push(b);
			stored = b.skeleton;
			if (b.rig3d) stored3d = b.rig3d;
			const n = seen.saves.length;
			return json({
				ok: true,
				key: 'k',
				etag: `e${n}`,
				count: 1,
				rig3dEtag: b.rig3d ? `r${n}` : undefined,
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
	name: 'rig-3d-stage',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--mute-audio'],
});
const { evaluate, waitFor, send, pageLog } = browser;

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
const frames = (n = 3) =>
	evaluate(
		`new Promise((done) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : done(true)); requestAnimationFrame(f); })`,
	);
/** Let an edit's re-bake run and land. */
const settled = () =>
	waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		30000,
	);
/** A bone as the stage drew it last frame: its world origin. */
const drawn = (n) =>
	evaluate(
		`(() => { const b = skeleton.findBone(${q(n)}); return { x: b.worldX, y: b.worldY }; })()`,
	);
/** Page coordinates of world point (wx, wy). */
const screenAt = (wx, wy) =>
	evaluate(`(() => {
		const cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(${wx}, ${wy}, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: r.left + v.x / dpr, y: r.top + cv.clientHeight - v.y / dpr };
	})()`);
const mouse = (type, pt) =>
	send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
/** The upper arm's turn keys in the 3D data, read in its own terms (its tilt and twist about its length). */
const sideKeys = () =>
	evaluate(`(() => { const c = rig3d.doc && rig3d.doc.clips && rig3d.doc.clips.take, k = c && c.bones.upper_arm_l;
		return k ? { orient: (k.orient || []).map((x) => [x.time, Rigger2p5d.anglesAlong(x.value, boneAlong("upper_arm_l"))]), depth: (k.depth || []).map((x) => [x.time, x.value]) } : null; })()`);
const typeField = (label, value) =>
	evaluate(`(() => {
		const row = [...document.querySelectorAll("#boneDetail label")].find((l) => l.querySelector("span") && l.querySelector("span").textContent === ${q(label)});
		const inp = row && row.querySelector("input"); if (!inp) return false;
		inp.value = ${q(String(value))}; inp.dispatchEvent(new Event("change")); return true;
	})()`);
/** The arm's drawn rotation (its frame's rotation part, x first), as the stage holds it. */
const armFrame = () =>
	evaluate(
		'(() => { const f = stage3d.frames.get("upper_arm_l"); return { r: Rigger2p5d.rotationOf(f.m), o: f.o }; })()',
	);
const mul = (a, b) =>
	Array.from({ length: 9 }, (_, i) => {
		const r = (i / 3) | 0;
		const k = i % 3;
		return a[r * 3] * b[k] + a[r * 3 + 1] * b[3 + k] + a[r * 3 + 2] * b[6 + k];
	});
const off = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const pickBone = (n) =>
	evaluate(
		`(() => { selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(n)})); return true; })()`,
	);
/**
 * Drag along the drawn arrow `id` of the selected bone from its middle by `t` (world units along its
 * drawing). `tol` is how far from `t` the move may land: the page reads the cursor to the pixel, so a
 * stage drawn small (CI's) makes a pixel more than half a unit along a foreshortened arrow.
 */
async function dragArrow(id, t, mid) {
	const z = await evaluate(
		`(() => { const p = gizmoParts(selBone).find((x) => x.id === ${q(id)}); return p && { dir: p.dir, dir3: p.dir3, c: gizmoCenter(), G: gizmoGeom() }; })()`,
	);
	if (!z) return null;
	const at = (s) => screenAt(z.c.x + z.dir[0] * s, z.c.y + z.dir[1] * s);
	const m0 = (z.G.axisFrom + z.G.axisTo) / 2;
	const from = await at(m0);
	const to = await at(m0 + t);
	await mouse('mouseMoved', from);
	await mouse('mousePressed', from);
	await mouse('mouseMoved', await at(m0 + t / 2));
	if (mid) await mid();
	await mouse('mouseMoved', to);
	await mouse('mouseReleased', to);
	await frames();
	return { ...z, tol: Math.max(0.5, (1.5 * t) / Math.hypot(to.x - from.x, to.y - from.y)) };
}
/**
 * Drag the drawn ring `id` `deg` degrees along itself, a degree at a time, from a point of it where it
 * is what the stage picks (clear of the arrows and the other rings) and moves fastest as drawn (where a
 * whole-pixel cursor is a small turn).
 */
async function dragRing(id, deg, mid) {
	const g = await evaluate(
		`(() => { const c = gizmoCenter(), parts = gizmoParts(selBone), p = parts.find((x) => x.id === ${q(id)}); if (!p) return null;
			const at = (u) => ({ x: c.x + p.m[0] * Math.cos(u) + p.m[1] * Math.sin(u), y: c.y + p.m[2] * Math.cos(u) + p.m[3] * Math.sin(u) });
			const speed = (u) => Math.hypot(-p.m[0] * Math.sin(u) + p.m[1] * Math.cos(u), -p.m[2] * Math.sin(u) + p.m[3] * Math.cos(u));
			const span = ${Math.abs(deg)} * Math.PI / 180 * Math.sign(${deg});
			let from = null, best = -1;
			for (let k = 0; k < 36; k++){
				const u = k * Math.PI / 18;
				if (gizmoPartAt(parts, c, at(u), gizmoGeom()) !== p) continue;
				const s = Math.min(speed(u), speed(u + span / 2), speed(u + span));
				if (s > best){ best = s; from = u; }
			}
			return { c, m: p.m, axis: p.axis, from }; })()`,
	);
	if (!g || g.from === null) return null;
	const from = g.from;
	const pt = (u) =>
		screenAt(
			g.c.x + g.m[0] * Math.cos(u) + g.m[1] * Math.sin(u),
			g.c.y + g.m[2] * Math.cos(u) + g.m[3] * Math.sin(u),
		);
	await mouse('mouseMoved', await pt(from));
	await mouse('mousePressed', await pt(from));
	for (let k = 1; k <= Math.abs(deg); k++) {
		await mouse('mouseMoved', await pt(from + (Math.sign(deg) * k * Math.PI) / 180));
		if (mid && k === Math.round(Math.abs(deg) / 2)) await mid();
	}
	await mouse('mouseReleased', await pt(from + (deg * Math.PI) / 180));
	await frames();
	return g.axis;
}

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("loadRigBtn")', 30000);
	await evaluate(`(() => {
		window.__alerts = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = () => true;
		document.querySelectorAll(".iw-crt").forEach((e) => e.remove());
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
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="setup"]\').click(); true');
	ok(
		'a 2D rig shows no view bar, in Setup either',
		(await evaluate('document.getElementById("view3dSeg").style.display')) === 'none',
	);
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="preview"]\').click(); true');
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc && !!window.Rigger2p5d', 15000);
	ok(
		'a 3D rig in Preview shows no view bar (the view turns in Setup and Animate)',
		(await evaluate('document.getElementById("view3dSeg").style.display')) === 'none',
	);

	// 1. Turning the view (Setup).
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="setup"]\').click(); true');
	await frames();
	ok(
		'the view bar shows in Setup',
		(await evaluate('document.getElementById("view3dSeg").style.display')) === '',
	);
	const front = { face: await drawn('face'), head: await drawn('head') };
	await evaluate(
		'const r = document.getElementById("viewTurn"); r.value = "90"; r.dispatchEvent(new Event("input", { bubbles: true })); true',
	);
	await frames();
	const side = { face: await drawn('face'), head: await drawn('head') };
	const gap = (v) => v.face.x - v.head.x;
	ok(
		'from the side (90°), the face sits 95 across the stage from the head (it is 95 in front)',
		Math.abs(gap(side) - gap(front) - 95) < 1.5 && (await evaluate('viewTurn')) === 90,
		q({ front: gap(front), side: gap(side) }),
	);
	ok(
		'…and the head’s card is seen edge-on (its width the floor’s sliver)',
		(await evaluate(
			'(() => { const b = skeleton.findBone("head"); return Math.abs(b.a * b.d - b.b * b.c); })()',
		)) < 0.05,
	);
	await evaluate('document.getElementById("viewTurnNum").click(); true');
	await frames();
	const back = await drawn('face');
	ok(
		'0° puts the front view back, the setup untouched',
		Math.abs(back.x - front.face.x) < 1e-3 && (await evaluate('viewTurn')) === 0,
		q({ back, front: front.face }),
	);
	// Setup, the view turned: the depth arrow (View: the stage's depth) sets the setup depth.
	await pickBone('head');
	await evaluate('gizmoSpace = "view"; syncControlBar(); setViewTurn(60); true');
	await frames();
	const depth0 = await evaluate('setupDepth("head")');
	const z = await dragArrow('z', 20);
	const depth1 = await evaluate('setupDepth("head")');
	ok(
		'Setup, the view turned: the depth arrow sets the setup depth (20 along it), x and y unchanged',
		!!z &&
			Math.abs(depth1 - depth0 - 20) < z.tol &&
			(await evaluate(
				'Math.abs(skeletonData.findBone("head").x - rawDoc.bones.find((b) => b.name === "head").x) < 1e-9',
			)),
		q({ depth0, depth1 }),
	);
	await evaluate('rigUndo(); true');
	ok('…and one undo takes it back', (await evaluate('setupDepth("head")')) === depth0);
	await evaluate('setViewTurn(0); gizmoSpace = "local"; syncControlBar(); true');

	// 2. A 3D clip, the arm tilted from the panel.
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); true');
	await waitFor('animMode', 10000);
	await evaluate('setCurAnim("take"); animTime = 0; playing = false; convertClip3d("take"); true');
	await settled();
	await pickBone('upper_arm_l');
	await evaluate('renderBoneDetail(); true');
	ok('the bone panel offers tilt in a 3D clip', await typeField('tilt', 50));
	await settled();
	await frames();
	const tilted = await sideKeys();
	ok(
		'…the tilt is keyed as an orient key (50° in the bone’s terms)',
		!!tilted && tilted.orient.length >= 1 && Math.abs(tilted.orient[0][1].tilt - 50) < 1e-6,
		q(tilted),
	);

	// 3. The gizmo in 3D, dragged with the mouse.
	// The chest turned 20° in 2D (it stays a 2D bone): the arm's parent is not drawn as the view is.
	await pickBone('chest');
	await evaluate('renderBoneDetail(); true');
	await typeField('rotation', (await evaluate('skeletonData.findBone("chest").rotation')) + 20);
	await settled();
	await pickBone('upper_arm_l');
	await evaluate('renderBoneDetail(); true');
	await frames();
	const ids = await evaluate('gizmoParts(selBone).map((p) => p.id)');
	ok(
		'in a 3D clip the gizmo has the X, Y and depth arrows and the rotate, tilt and twist rings',
		['move', 'x', 'y', 'z', 'ringz', 'ringy', 'ringx'].every((id) => ids.includes(id)),
		q(ids),
	);
	const along = await evaluate(
		'(() => { const ax = gizmoAxesOf("upper_arm_l"), a = stage3d.frames.get("upper_arm_l"), c = stage3d.frames.get("lower_arm_l"); const d = [c.o[0] - a.o[0], c.o[1] - a.o[1], c.o[2] - a.o[2]], l = Math.hypot(...d); return ax.x[0] * d[0] / l + ax.x[1] * d[1] / l + ax.x[2] * d[2] / l; })()',
	);
	ok(
		'Local: the X arrow runs along the bone’s length (toward its child), as its tilt and twist are read',
		along > 0.999,
		String(along),
	);
	for (const [id, what] of [
		['ringz', 'the rotate ring turns it 30° in its card’s plane'],
		['ringy', 'the tilt ring turns it 30° across its length'],
		['ringx', 'the twist ring turns it 30° about its length'],
	]) {
		const before = await armFrame();
		const arm = () =>
			evaluate(
				'(() => { const b = skeleton.findBone("upper_arm_l"), c = skeleton.findBone("lower_arm_l"); return { x: c.worldX - b.worldX, y: c.worldY - b.worldY }; })()',
			);
		const drawnBefore = await arm();
		await evaluate('historyFlush(); dirty = false; true');
		let mid = null;
		const axis = await dragRing(id, 30, async () => {
			await frames(2);
			mid = await arm();
		});
		await settled();
		await frames();
		const after = await armFrame();
		const turn = await evaluate(`Rigger2p5d.axisTurn(${q(axis)}, 30)`);
		const e = off(after.r, mul(turn, before.r));
		ok(
			`Local: ${what}, keyed in 3D (the drawn frame within ${e.toFixed(3)} of the turn)`,
			!!axis && e < 0.015,
			q({ before: before.r, after: after.r }),
		);
		if (id === 'ringz')
			ok(
				'…the drag leaves the rig unsaved (💾), its own undo step',
				await evaluate('dirty && rigHist.past.length > 0'),
			);
		if (id === 'ringy')
			ok(
				'…the stage draws the turn while it is dragged (the held pose), before it is keyed',
				!!mid && Math.hypot(mid.x - drawnBefore.x, mid.y - drawnBefore.y) > 5,
				q({ drawnBefore, mid }),
			);
	}
	const keyed = await sideKeys();
	ok('…each drag keyed in 3D at the playhead', !!keyed && keyed.orient.length === 1, q(keyed));
	await evaluate('rigUndo(); true');
	await settled();
	const undone = await sideKeys();
	ok(
		'one undo takes back the last ring drag (its keys and its bake)',
		!!undone && off([undone.orient[0][1].twist], [keyed.orient[0][1].twist]) > 1,
		q({ undone, keyed }),
	);
	await evaluate('rigRedo(); true');
	await settled();

	// View space, the view turned: the stage's depth arrow moves the arm along the stage's depth.
	await evaluate('gizmoSpace = "view"; syncControlBar(); setViewTurn(-40); true');
	await frames();
	const beforeF = await armFrame();
	const stageBefore = await drawn('upper_arm_l');
	let midDepth = null;
	const za = await dragArrow('z', 30, async () => {
		midDepth = await evaluate('!!(gizmo3dDrag && gizmo3dDrag.over)');
	});
	await settled();
	await frames();
	const afterF = await armFrame();
	const stageAfter = await drawn('upper_arm_l');
	const moved = afterF.o.map((v, i) => v - beforeF.o[i]);
	const cursor = za ? 30 * Math.hypot(...za.dir) : 0;
	const depthKeys = (await sideKeys()).depth;
	ok(
		'View, turned: the stage’s depth arrow moves the arm along the stage’s depth with the point under the cursor, keyed as a depth of 30',
		!!za &&
			midDepth &&
			Math.abs(Math.hypot(moved[0], moved[1]) - cursor) < za.tol * Math.hypot(...za.dir) &&
			Math.abs(Math.hypot(stageAfter.x - stageBefore.x, stageAfter.y - stageBefore.y) - cursor) <
				za.tol * Math.hypot(...za.dir) + 0.1 &&
			off(
				moved.map((v) => v / Math.hypot(...moved)),
				za.dir3,
			) < 0.02 &&
			depthKeys.length === 1 &&
			Math.abs(depthKeys[0][1] - 30) < za.tol,
		q({ moved, cursor, depthKeys, midDepth, tol: za?.tol }),
	);
	await evaluate('setViewTurn(0); gizmoSpace = "local"; syncControlBar(); true');

	// 4. Controls: the 3D channels lock and limit.
	await evaluate(
		'setControlFields("upper_arm_l", { channels: ["rotate"] }); renderBoneDetail(); true',
	);
	await frames();
	const locked = await evaluate('gizmoParts(selBone).map((p) => p.id)');
	ok(
		'a control keying only its rotate has the rotate ring alone',
		q(locked) === q(['ringz']),
		q(locked),
	);
	const chips = await evaluate(
		'[...document.querySelectorAll("#boneDetail .ctlChip")].map((b) => b.textContent)',
	);
	ok(
		'the control card offers the 3D channels (Tilt, Twist, Depth) on a 3D rig',
		['Tilt', 'Twist', 'Depth'].every((c) => chips.includes(c)),
		q(chips),
	);
	ok(
		'…and the bone panel locks the tilt and twist it does not key',
		await evaluate(
			'(() => { const f = (l) => [...document.querySelectorAll("#boneDetail label")].find((r) => r.querySelector("span") && r.querySelector("span").textContent === l); return f("tilt").querySelector("input").disabled && f("twist").querySelector("input").disabled; })()',
		),
	);
	await evaluate('gizmoSpace = "view"; syncControlBar(); true');
	await frames();
	const lockedBefore = await sideKeys();
	await dragRing('ringx', 20);
	await settled();
	const lockedAfter = await sideKeys();
	const ang = (k) => k.orient[0][1];
	ok(
		'…a View ring turning it leaves the locked tilt and twist as they were',
		Math.abs(ang(lockedAfter).tilt - ang(lockedBefore).tilt) < 1e-6 &&
			Math.abs(ang(lockedAfter).twist - ang(lockedBefore).twist) < 1e-6,
		q({ lockedBefore, lockedAfter }),
	);
	await evaluate(
		'setControlFields("upper_arm_l", { limits: { tilt: [-10, 10] }, channels: undefined }); gizmoSpace = "local"; syncControlBar(); true',
	);
	await frames();
	await dragRing('ringy', 40);
	await settled();
	const limited = await sideKeys();
	ok(
		'a control’s tilt limit holds what a ring drag keys',
		Math.abs(ang(limited).tilt) <= 10 + 1e-6,
		q(limited),
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok(
		'no alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
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
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — 3D stage ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
