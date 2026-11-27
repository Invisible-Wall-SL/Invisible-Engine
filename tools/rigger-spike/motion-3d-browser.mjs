// Browser gate for 🎥 Motion in 3D (2.5D P4, docs/design/rig-2p5d.md §8), on the SHIPPED view.html
// and the committed vendor/rigger-motion.js and vendor/rigger-2p5d.js in a real Chromium against a
// fake launcher API, with a real `half-body` rig built by the server's `templateRig`. The tracker
// answers a synthetic performer (`performer3d.mjs`) whose 3D pose is known: the left arm reaching
// toward the camera and back. Checked:
//  - the Motion row offers 🧊 3D or 2D, 3D by default on a 2.5D template (tooltip), and in 3D hides
//    the 2D depth effects (Shorten, Behind, Turn) the projection now does;
//  - with Angles only, 🎥 Key at playhead in 3D asks the solve for 3D, writes the rig's 3D data (the template's side
//    turnaround and its parts at depth, the clip's `orient` keys) and bakes the clip into the rig:
//    the page's engine-rig poses the forearm where the performer's points in the picture and as SHORT
//    as it is toward the camera (the third axis), its image at full width; the fingers keep their
//    own 2D keys; the report says what was baked and what the template cannot take in 3D; the
//    reference overlay records the import;
//  - one undo puts back the clip and the 3D data together, redo brings both back;
//  - 💾 Save sends the 3D data with no stored ETag and asks the save to bake the clip over (resolve),
//    takes the ETag the save answers, reads back the stored bake of the clips it baked, and a save
//    with nothing new in 3D sends no 3D data;
//  - Follow positions (the row's default, tooltip) asks the solve to follow from the reference's line-up,
//    keys the root in 2D and bends the neck's two bones, and the page's engine-rig puts the shoulders and each hand where
//    the reference overlay draws the performer's; the report says so; undo puts back the import before;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/motion-3d-browser.mjs
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
if (!existsSync(join(STATIC, 'rigger/vendor/mediapipe/vision_wasm_internal.wasm')))
	spawnSync('node', [join(APP, 'scripts/copy-mediapipe-wasm.mjs')], { stdio: 'inherit' });

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'motion-3d-browser-')), 'templates.mjs');
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
const PAGE_H = y + rowH;
const page = png(PAGE_W, PAGE_H, () => [120, 120, 170, 255]);
const rig = templateRig(
	HALF_BODY,
	HALF_BODY.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
).skeleton;
rig.animations = { take: {} };
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...lines].join('\n'),
	template: rigTemplateFromSidecar(JSON.stringify({ id: 'half-body', version: HALF_BODY.version })),
};

// The performer: 2 s at 24 fps, the left arm reaching 0° → 70° toward the camera and back.
const FPS = 24;
const reach = (i) => 70 * Math.sin((Math.PI * i) / 47);
const poseAt = (i) => ({ arms: { l: { upper: P.dir(30, reach(i)), lower: P.dir(60, reach(i)) } } });
const TRACK = P.track(48, FPS, (i) => ({ pose: poseAt(i), opts: { hands: true, face: P.ry(0) } }));

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const seen = { saves: [], other: [], reads: 0 };
let stored = null;
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.wasm': 'application/wasm',
	'.task': 'application/octet-stream',
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
		if (p === '/track.json') return json(TRACK);
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
			if (name.endsWith('.irig')) {
				if (stored) seen.reads++;
				return json(stored ?? RIG.rig);
			}
			if (name.endsWith('.atlas')) return send(200, 'text/plain', RIG.atlas);
			if (name.endsWith('.png')) return send(200, 'image/png', page);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: RIG.template });
		if (p === '/api/editor/flipbooks') return json({ clips: [] });
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null, rig3d: null });
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const b = await body();
			seen.saves.push(b);
			stored = b.skeleton;
			const n = seen.saves.length;
			return json({
				ok: true,
				key: 'k',
				etag: `e${n}`,
				count: 1,
				rig3dEtag: b.rig3d ? `r${n}` : undefined,
				rebaked: b.rig3d ? Object.keys(b.rig3d.clips ?? {}) : [],
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
	name: 'motion-3d',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--mute-audio'],
});
const { evaluate, waitFor, pageLog } = browser;

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
const DEG = 180 / Math.PI;
const fold = (d) => d - 360 * Math.round(d / 360);
const keyBtn = `[...document.querySelectorAll("#faceList .faceMotion button")].find((b) => b.textContent.includes("Key at playhead"))`;
/** The page's rig posed by its own engine-rig at `t` in clip "take": the left arm in the picture. */
const posed = (t) => `(() => {
	const s = new RIG.Skeleton(skeletonData);
	const st = new RIG.AnimationState(new RIG.AnimationStateData(skeletonData));
	st.setAnimation(0, "take", false); st.update(${t}); st.apply(s);
	s.updateWorldTransform(RIG.Physics ? RIG.Physics.update : undefined);
	const b = (n) => s.findBone(n);
	const [e, w, img] = [b("lower_arm_l"), b("hand_l"), b("lower_arm_l_image")];
	return { dx: w.worldX - e.worldX, dy: w.worldY - e.worldY, width: Math.hypot(img.a, img.c) };
})()`;

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
	await new Promise((r) => setTimeout(r, 200));
	await evaluate(
		`(() => { document.querySelector('#modeSeg button[data-mode="animate"]').click(); return true; })()`,
	);
	await waitFor('!!rawDoc && animMode', 30000);
	await evaluate(
		'setCurAnim("take"); animTime = 0; playing = false; faceMotionOpen = true; renderFacePanel(); true',
	);
	await waitFor('!!document.querySelector("#faceList .faceMotion select")', 10000);
	if (!(await evaluate('ensureRiggerMotion()'))) throw new Error('the motion bundle did not load');

	// 1. The row.
	const row = await evaluate(`(() => {
		const three = document.querySelector("#faceList .faceMotion select.faceMotion3d");
		const follow = document.querySelector("#faceList .faceMotion select.faceMotionFollow");
		return three && { value: three.value, options: [...three.options].map((o) => o.textContent), tip: three.title.length > 60,
			depth: [...document.querySelectorAll("#faceList .faceMotion select.faceMotionDepth")].map((s) => s.dataset.effect),
			follow: follow && { value: follow.value, options: [...follow.options].map((o) => o.textContent), tip: follow.title.length > 60 } };
	})()`);
	ok(
		'the Motion row offers 🧊 3D or 2D, 3D by default (tooltip), with the 2D depth effects hidden',
		!!row &&
			row.value === '1' &&
			q(row.options) === q(['🧊 3D', '2D']) &&
			row.tip &&
			row.depth.length === 0,
		q(row),
	);
	ok(
		'…and 📍 Follow positions or Angles only, Follow positions by default (tooltip)',
		!!row?.follow &&
			row.follow.value === '1' &&
			q(row.follow.options) === q(['📍 Follow positions', 'Angles only']) &&
			row.follow.tip,
		q(row?.follow),
	);

	// 2. The import in 3D, angles only (the bones turn as the performer's, from where the rig stands).
	await evaluate(`(async () => {
		const track = await (await fetch("/track.json")).json();
		RiggerMotion.videoFrames = async () => ({ width: track.width, height: track.height, count: track.frames.length, seconds: 2, frames: (async function* () {})(), close() {} });
		RiggerMotion.track = async () => track;
		const solve = RiggerMotion.solve;
		RiggerMotion.solve = (tpl, tr, opts) => { window.__solveOpts = opts; return solve(tpl, tr, opts); };
		faceMotionFile = new File(["x"], "take.webm"); faceMotionSrc = "video";
		faceMotionFollow = false;
		renderFacePanel();
		return true;
	})()`);
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 120000);
	ok(
		'the solve is asked for 3D (and, Angles only, not to follow)',
		(await evaluate('window.__solveOpts && window.__solveOpts.three && !window.__solveOpts.follow')) === true,
	);
	const data = await evaluate(`(() => {
		const d = rig3d.doc, c = d && d.clips && d.clips.take;
		const a = rawDoc.animations.take, bones = a.bones || {};
		return d && { turnaround: d.turnaround, face: d.bones && d.bones.face && d.bones.face.depth,
			orient: !!(c && c.bones.upper_arm_l && c.bones.upper_arm_l.orient && c.bones.upper_arm_l.orient.length),
			baked: !!(bones.upper_arm_l && bones.upper_arm_l.sheary) || !!(bones.upper_arm_l && bones.upper_arm_l.scale),
			fingers: !!(bones.index_1_l && bones.index_1_l.scale) && !(c && c.bones.index_1_l),
			three: !!clip3d("take") };
	})()`);
	ok(
		'the 3D data is written: the template’s side turnaround and parts at depth, the clip’s orient keys',
		!!data && data.turnaround === 'side' && data.face === 95 && data.orient,
		q(data),
	);
	ok(
		'the clip is baked into the rig (the arm’s 2D keys are the bake’s)',
		!!data && data.baked,
		q(data),
	);
	ok(
		'the fingers keep their own 2D keys (they lie flat on the hand)',
		!!data && data.fingers,
		q(data),
	);
	ok('the clip is a 3D clip now (the save bakes it over)', !!data && data.three, q(data));
	const worst = { angle: 0, length: 0, width: 1 };
	for (const i of [0, 12, 24, 36, 47]) {
		const got = await evaluate(posed(i / FPS + 0.002));
		const v = P.sub(P.points(poseAt(i))[16], P.points(poseAt(i))[14]);
		const angle = Math.abs(fold(Math.atan2(got.dx, -got.dy) * DEG - Math.atan2(v[0], -v[1]) * DEG));
		const length = Math.abs(
			Math.hypot(got.dx, got.dy) / 170 - Math.hypot(v[0], v[1]) / Math.hypot(...v),
		);
		worst.angle = Math.max(worst.angle, angle);
		worst.length = Math.max(worst.length, length);
		worst.width = Math.min(worst.width, got.width);
	}
	ok(
		'posed by the page: the forearm points where the performer’s does (within 1.5°)',
		worst.angle < 1.5,
		q(worst),
	);
	ok(
		'…and is as short as it is toward the camera (the third axis, within 0.03 of its length)',
		worst.length < 0.03,
		q(worst),
	);
	ok('…its image at full width', worst.width > 0.98, q(worst));
	const report = await evaluate('faceMotionReport');
	ok(
		'the report says what was baked and what the template cannot take in 3D',
		report[0].startsWith('3D: ') &&
			report.some((l) => l.includes('mirrored')) &&
			!report.some((l) => l.includes('Shorten')),
		q(report.slice(0, 3)),
	);
	ok('the reference overlay recorded the import', await evaluate('!!motionRefOf("take")'));

	// 3. Undo and redo carry the clip and the 3D data together.
	await evaluate('rigUndo(); true');
	const undone = await evaluate(
		'({ doc: rig3d.doc, keys: Object.keys((rawDoc.animations.take || {}).bones || {}).length })',
	);
	ok(
		'one undo puts back the clip and the 3D data together',
		undone.doc === null && undone.keys === 0,
		q(undone),
	);
	await evaluate('rigRedo(); true');
	ok(
		'redo brings both back',
		await evaluate('!!(rig3d.doc && rig3d.doc.clips.take && rawDoc.animations.take.bones)'),
	);

	// 4. The save.
	await evaluate('saveToR2().then(() => true)');
	const first = seen.saves[0];
	ok(
		'💾 sends the 3D data (no stored ETag) and asks the save to bake the clip over',
		!!first &&
			!!first.rig3d &&
			first.rig3dBaseEtag === null &&
			q(first.resolve) === q({ take: 'rebake' }) &&
			!!first.rig3d.clips.take,
		q(first && { rig3d: !!first.rig3d, base: first.rig3dBaseEtag, resolve: first.resolve }),
	);
	ok(
		'…takes the ETag the save answers and reads back the stored bake',
		(await evaluate('rig3d.etag')) === 'r1' && seen.reads >= 1,
		q({ reads: seen.reads }),
	);
	await evaluate('dirty = true; saveToR2().then(() => true)');
	const second = seen.saves[1];
	ok(
		'a save with nothing new in 3D sends no 3D data',
		!!second && second.rig3d === undefined && second.resolve === undefined,
		q(second && Object.keys(second)),
	);

	// 5. Follow positions: the same take imported again, the rig placed on the reference.
	await evaluate(`(() => {
		faceMotionReport = null;
		faceMotionFollow = true;
		renderFacePanel();
		return true;
	})()`);
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 120000);
	const fol = await evaluate(`(() => {
		const o = window.__solveOpts, rec = motionRefOf("take"), a = rec.align, k = a.h / rec.height;
		const toRig = (p) => [a.x - k * rec.width / 2 + k * p[0] * rec.width, a.y + k * rec.height / 2 - k * p[1] * rec.height];
		const lu = o && o.follow && o.follow.lineUp;
		const anim = rawDoc.animations.take.bones;
		return { lineUp: !!lu && Math.abs(lu.k - k) < 1e-9 && Math.abs(lu.x0 - (a.x - k * rec.width / 2)) < 1e-6 && Math.abs(lu.y0 - (a.y + k * rec.height / 2)) < 1e-6,
			depth: o && o.follow && o.follow.depths.face === 95,
			keys: !!(anim.root && anim.root.translate && anim.root.translate.length) && ["neck", "neck_upper"].every((b) => { const k = rig3d.doc.clips.take.bones[b]; return !!(k && k.orient && k.orient.length); }),
			toRig: String(toRig) };
	})()`);
	ok('the solve is asked to follow from the reference overlay’s line-up and the rig’s depths', fol.lineUp && fol.depth, q(fol));
	ok('the root is keyed (2D translates) and the neck bent (its two bones’ 3D keys)', fol.keys, q(fol));
	const track = TRACK;
	let far = { shoulders: 0, hand: 0 };
	// Frames the arm can reach: tilted 60–70° toward the camera (straighter, the performer's arm is
	// longer than the rig's, and it turns as tracked).
	for (const i of [20, 22, 24, 26, 28]) {
		const t = track.frames[i].t + 0.002;
		const got = await evaluate(`(() => {
			const s = new RIG.Skeleton(skeletonData);
			const st = new RIG.AnimationState(new RIG.AnimationStateData(skeletonData));
			st.setAnimation(0, "take", false); st.update(${t}); st.apply(s);
			s.updateWorldTransform(RIG.Physics ? RIG.Physics.update : undefined);
			const rec = motionRefOf("take"), a = rec.align, k = a.h / rec.height;
			const toRig = (p) => [a.x - k * rec.width / 2 + k * p[0] * rec.width, a.y + k * rec.height / 2 - k * p[1] * rec.height];
			const f = ${q(track.frames[i])};
			const b = (n) => [s.findBone(n).worldX, s.findBone(n).worldY];
			const d = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1]);
			const lm = f.pose.landmarks, mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
			return { shoulders: d(mid(b("upper_arm_l"), b("upper_arm_r")), toRig(mid(lm[11], lm[12]))), hand: d(b("hand_l"), toRig(f.hands[0].landmarks[0])) };
		})()`);
		far = { shoulders: Math.max(far.shoulders, got.shoulders), hand: Math.max(far.hand, got.hand) };
	}
	ok('posed by the page: the shoulders sit on the reference’s (within 2)', far.shoulders < 2, q(far));
	ok('…and the left hand on its tracked wrist (within 8)', far.hand < 8, q(far));
	const fr = await evaluate('faceMotionReport');
	ok('the report says it followed positions', fr.some((l) => l.startsWith('📍 Followed positions')), q(fr.slice(0, 4)));
	await evaluate('rigUndo(); true');
	ok(
		'undo puts back the import before (no root translate)',
		await evaluate('!(rawDoc.animations.take.bones.root && rawDoc.animations.take.bones.root.translate)'),
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
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — motion 3D ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
