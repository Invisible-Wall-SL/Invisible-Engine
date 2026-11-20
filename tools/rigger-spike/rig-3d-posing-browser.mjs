// Browser gate for posing a 2.5D rig in 3D (2.5D P3, docs/design/rig-2p5d.md §9), on the SHIPPED
// view.html and the committed vendor/rigger-2p5d.js in a real Chromium against a fake launcher API,
// with a real `half-body` rig built by the server's `templateRig`. Checked:
//  - 🧊 3D: a 2D rig offers its template's 3D setup (tooltip); making it 3D writes the template's
//    turnaround and parts at depth, and the view bar shows in Setup and Animate;
//  - turning the view (the bar's slider) draws the rig turned: from the side, the face (95 in front
//    of the head) is 95 across the stage; the setup itself is untouched once the view is back;
//  - 🧊 3D from this clip; the Tilt field turns the upper arm out of the picture: it is keyed as an
//    `orient` quaternion in the 3D data and the paused stage draws it shortened at once (cos 50°);
//  - the live bake writes the arm's baked keys into the clip, and the clip played from those keys
//    poses it where the held pose does;
//  - the dopesheet hides the bake's 2D tracks (and the draw order) and shows a 🧊 row of 3D keys,
//    which retimes; the graph names the 🧊 row;
//  - the rotate ring, dragged with the mouse on the 3D bone, turns it in 3D (its tilt kept);
//  - ◆ Key keys the 3D pose; undo takes back the last step; a 2D edit reaching a baked track some
//    other way is baked over;
//  - 💾 Save sends the 3D data with `resolve: rebake` and the clip baked (not the authored keys); a
//    reload brings the 3D keys back;
//  - ✂ Detach makes the clip plain 2D: the 3D keys go, the baked keys stay, the 2D rows come back;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/rig-3d-posing-browser.mjs
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
const out = join(mkdtempSync(join(tmpdir(), 'rig-3d-posing-')), 'templates.mjs');
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
	name: 'rig-3d-posing',
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
/** A bone as the stage drew it last frame: its world x axis length and its origin. */
const drawn = (n) =>
	evaluate(
		`(() => { const b = skeleton.findBone(${q(n)}); return { len: Math.hypot(b.a, b.c), x: b.worldX, y: b.worldY }; })()`,
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
const sideKeys = () =>
	evaluate(`(() => { const c = rig3d.doc && rig3d.doc.clips && rig3d.doc.clips.take, k = c && c.bones.upper_arm_l;
		return k ? { orient: (k.orient || []).map((x) => [x.time, Rigger2p5d.anglesOf(x.value)]), rotate: !!k.rotate } : null; })()`);
const typeInto = (label, value) =>
	evaluate(`(() => {
		const row = [...document.querySelectorAll("#boneDetail label")].find((l) => l.querySelector("span") && l.querySelector("span").textContent === ${q(label)});
		const inp = row && row.querySelector("input"); if (!inp) return false;
		inp.value = ${q(String(value))}; inp.dispatchEvent(new Event("input", { bubbles: true })); return true;
	})()`);

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
	await evaluate('document.getElementById("sec3d").open = true; render3dPanel(); true');
	await waitFor('!!window.Rigger2p5d && !!document.querySelector("#panel3d .ctlIcon")', 30000);

	// 1. 🧊 3D.
	const offer = await evaluate(`(() => {
		const b = document.querySelector("#panel3d .ctlIcon");
		return { glyph: b.textContent, tip: b.title, bar: document.getElementById("view3dSeg").style.display, section: document.querySelector("#sec3d summary").title.length };
	})()`);
	ok(
		'a 2D rig offers its template’s 3D setup (tooltip), with no view bar yet',
		offer.glyph === '🧊' &&
			/side views/.test(offer.tip) &&
			offer.bar === 'none' &&
			offer.section > 80,
		q(offer),
	);
	await evaluate('document.querySelector("#panel3d .ctlIcon").click(); true');
	const made = await evaluate(
		'({ turnaround: rig3d.doc && rig3d.doc.turnaround, face: rig3d.doc && rig3d.doc.bones && rig3d.doc.bones.face && rig3d.doc.bones.face.depth, bar: document.getElementById("view3dSeg").style.display })',
	);
	ok(
		'🧊 makes the rig 3D: the template’s side turnaround and its parts at depth (no view bar in Preview)',
		made.turnaround === 'side' && made.face === 95 && made.bar === 'none',
		q(made),
	);

	// 2. Turning the view (Setup).
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
		'…and the head’s card is seen edge-on (its width is the floor’s sliver)',
		side.head.len < 0.05,
		q(side.head),
	);
	await evaluate('document.getElementById("viewTurnNum").click(); true');
	await frames();
	const back = await drawn('face');
	ok(
		'⟲ 0° puts the front view back, the setup untouched',
		Math.abs(back.x - front.face.x) < 1e-3 && (await evaluate('viewTurn')) === 0,
		q({ back, front: front.face }),
	);

	// 3. A 3D clip, and a tilt from the panel.
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); true');
	await waitFor('animMode', 10000);
	await evaluate('setCurAnim("take"); animTime = 0; playing = false; render3dPanel(); true');
	await evaluate(
		'[...document.querySelectorAll("#panel3d .ctlHead .ctlIcon")].find((b) => b.textContent === "＋").click(); true',
	);
	ok(
		'🧊 ＋ makes the open clip a 3D clip',
		await evaluate('!!(rig3d.doc.clips && rig3d.doc.clips.take)'),
	);
	await evaluate('selectBone(skeletonData.bones.findIndex((b) => b.name === "upper_arm_l")); true');
	const flat = await drawn('upper_arm_l');
	ok('the bone panel offers tilt, twist and depth in a 3D clip', await typeInto('tilt', 50));
	await frames();
	const keys1 = await sideKeys();
	ok(
		'the tilt is keyed as an orient quaternion in the 3D data (50° at 0 s)',
		!!keys1 && keys1.orient.length === 1 && Math.abs(keys1.orient[0][1].tilt - 50) < 1e-6,
		q(keys1),
	);
	const held = await drawn('upper_arm_l');
	ok(
		'the paused stage draws the arm turned at once: its card shortened to cos 50°',
		Math.abs(held.len / flat.len - Math.cos((50 * Math.PI) / 180)) < 0.01,
		q({ flat, held }),
	);
	await waitFor('!bake3d.clip', 5000);
	const baked = await evaluate(`(() => {
		const t = rawDoc.animations.take.bones.upper_arm_l;
		skeleton.setToSetupPose(); poseAtTime("take", 0); updateWorld();
		const b = skeleton.findBone("upper_arm_l");
		return { timelines: Object.keys(t || {}), len: Math.hypot(b.a, b.c), unmet: (bake3d.unmet.take || []).length };
	})()`);
	ok(
		'the live bake keys the arm in the clip, and the clip played from its keys draws it as held',
		baked.timelines.length > 0 && Math.abs(baked.len - held.len) < 0.01 && baked.unmet === 0,
		q(baked),
	);

	// 4. The dopesheet.
	await evaluate('tlView = "dope"; tlSelOnly = false; renderTimeline(); true');
	const rows = await evaluate('Object.keys(dopeTrackById)');
	ok(
		'the dopesheet hides the bake’s 2D tracks and the draw order, and shows a 🧊 row of 3D keys',
		rows.includes('bone3d:upper_arm_l:') &&
			!rows.includes('bone:upper_arm_l:') &&
			!rows.some((r) => r.startsWith('draworder')),
		q(rows),
	);
	await evaluate('tlView = "graph"; renderTimeline(); true');
	ok(
		'the graph names the 🧊 row for a 3D bone',
		/keyed in 3D/.test(await evaluate('document.getElementById("timeline").textContent')),
	);
	await evaluate('tlView = "dope"; renderTimeline(); true');

	// 5. The rotate ring, dragged with the mouse, turns the 3D bone (its tilt kept).
	await evaluate('animTime = 0; true');
	await frames();
	const ring = await evaluate(
		'(() => { const c = gizmoCenter(), G = gizmoGeom(); return { cx: c.x, cy: c.y, r: G.ringR }; })()',
	);
	const at = (deg) => {
		const a = (deg * Math.PI) / 180;
		return screenAt(ring.cx + ring.r * Math.cos(a), ring.cy + ring.r * Math.sin(a));
	};
	const p0 = await at(0);
	await mouse('mouseMoved', p0);
	await mouse('mousePressed', p0);
	for (const d of [10, 20, 30]) await mouse('mouseMoved', await at(d));
	await mouse('mouseReleased', await at(30));
	await frames();
	const keys2 = await sideKeys();
	const turned = keys2 && keys2.orient[0][1];
	ok(
		'the rotate ring turns the 3D bone 30° about the view, keyed in 3D with its tilt kept',
		!!turned && Math.abs(turned.rotate - 30) < 1.5 && Math.abs(turned.tilt - 50) < 1e-6,
		q(keys2),
	);

	// 6. ◆ Key, retime, undo.
	await evaluate('animTime = 0.5; document.getElementById("keyBtn").click(); true');
	const keys3 = await sideKeys();
	ok(
		'◆ Key keys the 3D pose at the playhead',
		!!keys3 && keys3.orient.length === 2 && keys3.orient[1][0] === 0.5,
		q(keys3),
	);
	ok(
		'the bone panel lists the 3D keys',
		/3D keys \(2\): 0\.00s, 0\.50s/.test(
			await evaluate('document.getElementById("boneDetail").textContent'),
		),
		await evaluate('document.getElementById("boneDetail").textContent.slice(-120)'),
	);
	await evaluate('historyFlush(); document.getElementById("delKey").click(); historyFlush(); true');
	const deleted = await sideKeys();
	ok(
		'✕ Key deletes the 3D key at the playhead',
		!!deleted && deleted.orient.length === 1,
		q(deleted),
	);
	await evaluate('rigUndo(); true');
	await evaluate(
		'historyFlush(); retimeTrackKey({ kind: "bone3d", name: "upper_arm_l" }, 0.5, 0.8); historyFlush(); true',
	);
	const keys4 = await sideKeys();
	ok('a 🧊 key retimes', !!keys4 && keys4.orient[1][0] === 0.8, q(keys4));
	await evaluate('rigUndo(); true');
	const keys5 = await sideKeys();
	ok('undo takes the retime back', !!keys5 && keys5.orient[1][0] === 0.5, q(keys5));

	// A 2D edit reaching a baked track some other way is baked over: the 3D keys win.
	await waitFor('!bake3d.clip', 5000);
	await evaluate(
		'rawDoc.animations.take.bones.upper_arm_l.rotate = [{ time: 0, value: 77 }]; markDirty(); true',
	);
	await waitFor('!bake3d.clip', 5000);
	const over = await evaluate(`(() => {
		const r = rawDoc.animations.take.bones.upper_arm_l.rotate || [];
		return { stray: r.some((k) => k.value === 77), bakes: !!bake3d.unmet.take };
	})()`);
	ok(
		'a 2D edit of a baked track is baked over (the 3D keys win)',
		!over.stray && over.bakes,
		q(over),
	);

	// 7. Save (right after an edit, its bake still pending) and reload.
	await evaluate('animTime = 0; key3dBone("upper_arm_l", { tilt: 20 }, false); saveToR2(); true');
	await waitFor('!saveToR2.busy && rig3d.etag === "r1" || window.__alerts.length > 0', 30000);
	const sent = seen.saves[0];
	const arm =
		sent && sent.skeleton.animations.take.bones && sent.skeleton.animations.take.bones.upper_arm_l;
	const sx = arm && arm.scale ? arm.scale[0].x : null;
	ok(
		'💾 sends the 3D data with resolve: rebake, and the clip as baked with the last edit (not the authored keys)',
		!!sent &&
			!!sent.rig3d &&
			q(sent.resolve) === q({ take: 'rebake' }) &&
			!!sent.rig3d.clips.take.bones.upper_arm_l.orient &&
			sx !== null &&
			Math.abs(sx - Math.cos((20 * Math.PI) / 180)) < 0.01,
		q(sent && { resolve: sent.resolve, arm: arm && Object.keys(arm), sx }),
	);
	const gen = await evaluate('rigGen');
	await evaluate('refreshFromR2(); true');
	await waitFor(
		`rigGen > ${gen} && !!rawDoc && !!skeleton && selected && selected.name === "half" && rig3d.etag === "r1" && !!(rig3d.doc && rig3d.doc.clips && rig3d.doc.clips.take)`,
		30000,
	);
	await frames();
	await evaluate(
		'if (!animMode) document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); setCurAnim("take"); true',
	);
	const keys6 = await sideKeys();
	ok('a reload brings the 3D keys back', !!keys6 && keys6.orient.length === 2, q(keys6));

	// 8. Detach.
	await evaluate('detach3dClip("take"); renderTimeline(); true');
	const detached = await evaluate(`(() => ({
		clip: !!(rig3d.doc.clips && rig3d.doc.clips.take),
		baked: Object.keys((rawDoc.animations.take.bones || {}).upper_arm_l || {}),
		rows: Object.keys(dopeTrackById),
	}))()`);
	ok(
		'✂ Detach: the 3D keys go, the baked keys stay, the 2D rows come back',
		!detached.clip && detached.baked.length > 0 && detached.rows.includes('bone:upper_arm_l:'),
		q(detached),
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
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — 3D posing ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
