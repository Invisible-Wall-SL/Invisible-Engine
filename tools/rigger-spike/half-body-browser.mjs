// Browser gate for the Half body template's Controls section and its face + body + hand import (rig
// templates, docs/design/rig-templates.md §3.5, §5.3), on the SHIPPED view.html and the committed
// vendor/rigger-motion.js in a real Chromium against a fake launcher API, with a real `half-body` rig
// built by the server's `templateRig`. Checked:
//  - the tracker loads for real: Face, Pose and Hand Landmarker (`hand_landmarker.task`) are
//    fetched from /rigger/vendor/mediapipe/ and run over the same frames in one pass (blank frames
//    find no face, no body and no hands, and say so);
//  - 🎥 Motion offers the face, body and hands, with Bust with face's Neutral at and per-group gains;
//    the Controls section has the face tools (mouth shapes, blink, talk, lip-sync);
//  - 🎥 Key at playhead tracks the three together, keys the finger curls, thumb and spread the fixed
//    hand track shows at the playhead, under the picture-left hand, and the jaw the face track opens,
//    as ONE undo step, and reports what it cannot take;
//  - the Curl hand slider keys every finger and the thumb; the hand pose slider shows a drawn pose
//    and hides that hand's finger images, and back on the finger rig shows them again;
//  - the page throws nothing and sends nothing.
// The finger solve itself is gated headlessly by half-body.mjs.
//   node tools/rigger-spike/half-body-browser.mjs [--shot <file.png>]
import { spawnSync } from 'node:child_process';
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
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
if (!existsSync(join(STATIC, 'rigger/vendor/mediapipe/vision_wasm_internal.wasm')))
	spawnSync('node', [join(APP, 'scripts/copy-mediapipe-wasm.mjs')], { stdio: 'inherit' });
const shotAt = process.argv.indexOf('--shot');
const SHOT = shotAt > 0 ? process.argv[shotAt + 1] : null;

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'half-body-browser-')), 'templates.mjs');
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

// A page whose parts are flat greys (one shade per part), so a screenshot reads as a mannequin.
function png(w, h, at = () => [0x80, 0x80, 0x80, 0xff]) {
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
const PAGE_W = 2048;
let x = 0;
let y = 0;
let rowH = 0;
const boxes = [];
const lines = [];
for (const [i, p] of HALF_BODY.parts.entries()) {
	const [w, h] = p.size;
	if (x + w > PAGE_W) {
		x = 0;
		y += rowH;
		rowH = 0;
	}
	lines.push(p.name, `bounds:${x},${y},${w},${h}`);
	boxes.push({ x, y, w, h, shade: 0x50 + ((i * 37) % 0x90) });
	x += w;
	rowH = Math.max(rowH, h);
}
const PAGE_H = y + rowH;
const page = png(PAGE_W, PAGE_H, (px, py) => {
	const b = boxes.find((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);
	return b ? [b.shade, b.shade, 0xb0, 0xff] : [0, 0, 0, 0];
});
const rig = templateRig(
	HALF_BODY,
	HALF_BODY.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
).skeleton;
rig.animations = { take: {} };
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...lines].join('\n'),
	template: rigTemplateFromSidecar(JSON.stringify({ id: 'half-body', version: 1 })),
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const CLIP = {
	id: 'c1',
	name: 'hands',
	assetKey: 'p/sheets/a.json',
	frames: ['f0', 'f1'],
	fps: 12,
};
const seen = { models: [], other: [] };

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
		if (p === '/api/editor/flipbooks') return json({ clips: [CLIP] });
		if (p === '/api/editor/regions')
			return json({
				assetKey: 'p/sheets/a.json',
				pageKey: 'p/sheets/a.png',
				pageVersion: 'v1',
				pageWidth: 64,
				pageHeight: 32,
				regions: ['f0', 'f1'].map((name, i) => ({ name, x: i * 32, y: 0, w: 32, h: 32 })),
			});
		if (p === '/api/editor/asset') return send(200, 'image/png', png(64, 32));
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) {
			if (req.method !== 'GET') seen.other.push(req.method + ' ' + p);
			return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		}
		if (p.startsWith('/rigger/vendor/mediapipe/') && p.endsWith('.task'))
			seen.models.push(p.split('/').pop());
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
	name: 'half-body',
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
const motionBtn = `[...document.querySelectorAll("#faceList button")].find((b) => b.textContent.includes("Motion"))`;
const keyBtn = `[...document.querySelectorAll("#faceList .faceMotion button")].find((b) => b.textContent.includes("Key at playhead"))`;
const slider = (id) => `document.querySelector('#faceList .faceRow[data-ch="${id}"] input')`;
const drag = (id, v) =>
	evaluate(
		`(() => { const i = ${slider(id)}; i.value = ${v}; i.dispatchEvent(new Event("input")); i.dispatchEvent(new Event("change")); return true; })()`,
	);

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

	// 1. The real trackers, body and hands over the same blank frames in one pass.
	ok('the motion bundle loads', await evaluate('ensureRiggerMotion()'));
	const real = await evaluate(`(async () => {
		const c = document.createElement("canvas"); c.width = 64; c.height = 64;
		const g = c.getContext("2d"); g.fillStyle = "#777"; g.fillRect(0, 0, 64, 64);
		async function* frames(){ for (let i = 0; i < 3; i++) yield { t: i / 10, image: c }; }
		const r = await RiggerMotion.track(["face", "body", "hand"], { width: 64, height: 64, frames: frames() });
		return r.frames.map((f) => ({ face: f.face, pose: f.pose, hands: f.hands }));
	})()`);
	ok(
		'MediaPipe runs the face, pose and hand models together: nothing found in blank frames',
		q(real) === q([0, 1, 2].map(() => ({ face: null, pose: null, hands: [] }))),
		q(real),
	);
	ok(
		'the hand model is fetched same-origin, once, beside the face and pose models',
		q([...seen.models].sort()) ===
			q(['face_landmarker.task', 'hand_landmarker.task', 'pose_landmarker_full.task']),
		q(seen.models),
	);

	// 2. The rig, its Controls and the panel.
	await evaluate(`(() => {
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "half");
		row.click(); return true;
	})()`);
	await waitFor(
		'!!skeleton && selected && selected.name === "half" && rigTemplate !== null',
		30000,
	);
	await new Promise((r) => setTimeout(r, 200));
	await evaluate(
		`(() => { document.querySelector('#modeSeg button[data-mode="animate"]').click(); return true; })()`,
	);
	await waitFor('!!rawDoc && animMode', 30000);
	await evaluate('curAnim = "take"; animTime = 0.5; playing = false; renderFacePanel(); true');
	ok(
		'the Controls section lists every Half body control',
		(await evaluate('document.querySelectorAll("#faceList .faceRow").length')) ===
			HALF_BODY.channels.length,
		String(await evaluate('document.querySelectorAll("#faceList .faceRow").length')),
	);
	ok(
		'🎥 Motion offers the face, body and hands',
		(await evaluate(`${motionBtn} && ${motionBtn}.title`))?.includes('face, body and hands'),
		await evaluate(`${motionBtn} && ${motionBtn}.title`),
	);
	await evaluate(`${motionBtn}.click(); true`);
	await waitFor(
		'!!document.querySelector("#faceList .faceMotion select") && projectClips !== null',
		10000,
	);
	const faceOpts = await evaluate(`(() => ({
		neutral: !!document.querySelector("#faceList .faceMotion .faceMotionNeutral"),
		gains: [...document.querySelectorAll("#faceList .faceMotion .faceMotionGain")].map((s) => s.dataset.group),
	}))()`);
	ok(
		'the face reads with a Neutral at moment and a gain per face group, as on Bust with face',
		faceOpts.neutral && q(faceOpts.gains) === q(['mouth', 'eyes', 'brows', 'gaze', 'head']),
		q(faceOpts),
	);
	const faceButtons = await evaluate(
		`[...document.querySelectorAll("#faceList button")].map((b) => b.textContent)`,
	);
	ok(
		'the Controls section has the face tools: mouth shapes, blink, talk and lip-sync',
		['Blink', 'Talk', 'Lip-sync'].every((w) => faceButtons.some((t) => t.includes(w))) &&
			faceButtons.some((t) => /^A$/.test(t.trim())),
		q(faceButtons),
	);

	// 3. The import, with the tracker answering a fixed body + hands track.
	await evaluate(`(() => {
		window.__tracked = [];
		RiggerMotion.track = async (kinds, src, onProgress) => {
			for await (const f of src.frames) void f;
			window.__tracked.push(kinds);
			const D = Math.PI / 180;
			const hand = (flex) => {
				const w = Array(21).fill(null); w[0] = [0, 0, 0];
				for (let f = 0; f < 4; f++){
					let p = [0, -0.09, 0], a = 0; w[5 + 4 * f] = p;
					for (const [j, len] of [0.045, 0.027, 0.02].entries()){
						a += (f === 0 ? flex : 0) * D;
						p = [0, p[1] - Math.cos(a) * len, p[2] + Math.sin(a) * len];
						w[6 + 4 * f + j] = p;
					}
				}
				for (let j = 1; j <= 4; j++) w[j] = [0.03 * j, -0.02 * j, 0];
				return w;
			};
			const stand = { 11: [0.6, 0.4], 12: [0.4, 0.4], 13: [0.6, 0.55], 14: [0.4, 0.55], 15: [0.6, 0.7], 16: [0.4, 0.7] };
			const eyes = Array(478).fill(null);
			eyes[33] = [0.45, 0.3]; eyes[263] = [0.55, 0.3]; eyes[1] = [0.5, 0.34];
			const frames = Array.from({ length: 24 }, (_, i) => {
				const lm = Array(33).fill(null);
				for (const [k, p] of Object.entries(stand)) lm[k] = [p[0], p[1], 0.99];
				return {
					t: i / 12,
					face: { landmarks: eyes, blend: i >= 14 ? { jawOpen: 0.5 } : {} },
					pose: { landmarks: lm },
					hands: i === 23 ? [] : [{ label: "Right", landmarks: Array.from({ length: 21 }, () => [0.4, 0.7]), world: hand(i >= 8 ? 80 : 0) }],
				};
			});
			onProgress && onProgress(frames.length);
			return { width: src.width, height: src.height, frames };
		};
		const solve = RiggerMotion.solve;
		RiggerMotion.solve = (t, tr, o) => { window.__solveOpts = o; return solve(t, tr, o); };
		const sel = document.querySelector("#faceList .faceMotion select");
		sel.value = "clip:c1"; sel.dispatchEvent(new Event("change"));
		return true;
	})()`);
	const before = await evaluate('JSON.stringify(rawDoc)');
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 20000);
	ok(
		'the clip is tracked for the face, the body and the hands in one pass',
		q(await evaluate('window.__tracked')) === q([['face', 'body', 'hand']]),
		q(await evaluate('window.__tracked')),
	);
	ok(
		'the solve takes the face (gains at 1×), the body and the hands',
		q(await evaluate('window.__solveOpts')) ===
			q({
				face: true,
				body: true,
				hand: true,
				gain: { mouth: 1, eyes: 1, brows: 1, gaze: 1, head: 1 },
			}),
		q(await evaluate('window.__solveOpts')),
	);
	const after = await evaluate(`(() => {
		const a = rawDoc.animations.take;
		const sy = (b) => ((a.bones[b] && a.bones[b].scale) || []).map((k) => [k.time, k.y]);
		const jaw = ((a.bones.jaw && a.bones.jaw.translate) || []).map((k) => [k.time, k.y]);
		return { index: sy("index_1_l"), middle: sy("middle_1_l"), right: sy("index_1_r"), jaw };
	})()`);
	// 3 × 80° = 240°: a full curl, index_1 folded to 0.3, from the playhead (0.5 s) + 8 / 12 s.
	ok(
		'the picture-left index is curled from the playhead on, the others are not',
		after.index.some(([t, v]) => t > 1.3 && Math.abs(v - 0.3) < 0.02) &&
			after.index.every(([t]) => t >= 0.5 - 1e-6) &&
			after.middle.every(([, v]) => Math.abs(v - 1) < 0.01) &&
			after.right.length === 0,
		q(after),
	);
	// jawOpen from frame 14 (14 / 12 s): shut through the resting first second, then it drops.
	ok(
		'the same import drops the jaw with the performer’s, from the playhead on',
		after.jaw.some(([t, y]) => t > 0.5 + 14 / 12 && y < -5) &&
			after.jaw.every(([t, y]) => t >= 0.5 - 1e-6 && (t > 0.5 + 1 || Math.abs(y) < 0.5)),
		q(after.jaw),
	);
	const report = await evaluate(
		`[...document.querySelectorAll("#faceList .faceMotionReport li")].map((li) => li.textContent)`,
	);
	ok(
		'the report names the controls never seen (the other hand) and what it cannot take',
		report.some((l) => l.startsWith('Never seen') && l.includes('Curl right index')) &&
			report.some((l) => l.startsWith('Not carried: The drawn hand poses')),
		q(report),
	);
	await evaluate('document.getElementById("undoBtn").click(); true');
	ok(
		'one undo gives back exactly the document before the import',
		(await evaluate('JSON.stringify(rawDoc)')) === before,
	);

	// 4. The hand controls, through the sliders.
	await evaluate('animTime = 1; renderFacePanel(); true');
	await drag('curl_l', 1);
	const curled = await evaluate(`(() => {
		const a = rawDoc.animations.take;
		const at = (b, tl, f) => ((a.bones[b] || {})[tl] || []).filter((k) => Math.abs(k.time - 1) < 1e-6).map((k) => k[f]);
		return {
			fingers: ["index", "middle", "ring", "pinky"].map((f) => at(f + "_1_l", "scale", "y")[0]),
			thumb: at("thumb_1_l", "rotate", "value")[0],
			slider: Number(${slider('curl_l')}.value),
		};
	})()`);
	ok(
		'Curl left hand keys every finger and the thumb at the playhead',
		q(curled.fingers) === q([0.3, 0.3, 0.3, 0.3]) && curled.thumb === -40 && curled.slider === 1,
		q(curled),
	);
	await drag('hand_l', 2);
	await evaluate('animTime = 1.5; renderFacePanel(); true');
	await drag('hand_l', 0);
	const poses = await evaluate(`(() => {
		const a = rawDoc.animations.take;
		const img = (slot, t) => { const k = ((a.slots[slot] || {}).attachment || []).find((x) => Math.abs(x.time - t) < 1e-6); return k ? k.name || null : "unkeyed"; };
		return {
			hand: [img("hand_l", 1), img("hand_l", 1.5)],
			fingers: [img("index_2_l", 1), img("thumb_3_l", 1), img("index_2_l", 1.5)],
			other: img("index_2_r", 1),
		};
	})()`);
	ok(
		'a fist pose shows the drawn fist and hides the left fingers; the finger rig shows them again',
		q(poses) ===
			q({
				hand: ['hand_l_fist', 'hand_l'],
				fingers: [null, null, 'index_2_l'],
				other: 'unkeyed',
			}),
		q(poses),
	);
	// 5. 📐 Save as template's editor: a hand curl and a hand pose preview on the stage, and the
	// curl's list follows a finger control renamed or removed.
	const editor = await evaluate(`(() => {
		openTemplateModal();
		const find = (id) => tplDraft.channels.find((c) => c.id === id);
		const bone = (n) => skeleton.findBone(n);
		const img = (s) => { const a = skeleton.findSlot(s).getAttachment(); return a ? a.name : null; };
		tplStartPreview(find("curl_l"), 1); tplPreviewPose();
		const curl = { index: bone("index_1_l").scaleY, thumb: bone("thumb_1_l").rotation - bone("thumb_1_l").data.rotation };
		tplStopPreview();
		tplStartPreview(find("hand_l"), 2); tplPreviewPose();
		const fist = { hand: img("hand_l"), finger: img("index_1_l") };
		tplStopPreview();
		const back = { hand: img("hand_l"), finger: img("index_1_l"), index: bone("index_1_l").scaleY };
		const card = (id) => document.querySelector('#tplControls .tplCard[data-ch="' + id + '"]');
		[...card("curl_index_l").querySelectorAll("button")].find((b) => b.title === "Remove this control").click();
		[...card("curl_middle_l").querySelectorAll("button")].find((b) => b.title === "Edit this control").click();
		const idInput = card("curl_middle_l").querySelector(".tplBody input");
		idInput.value = "curl_mid_l"; idInput.dispatchEvent(new Event("change"));
		const sets = tplSpec(tplDraft).channels.find((c) => c.id === "curl_l").sets.map((s) => s.channel);
		$("#tplModal").classList.remove("open"); tplDraft = null;
		return { curl, fist, back, sets };
	})()`);
	ok(
		'📐 preview: a hand curl folds the fingers and the thumb, and puts them back',
		Math.abs(editor.curl.index - 0.3) < 1e-6 &&
			Math.abs(editor.curl.thumb + 40) < 1e-6 &&
			editor.back.index === 1,
		q(editor),
	);
	ok(
		'📐 preview: a fist pose shows the drawn fist over hidden fingers, and puts them back',
		q(editor.fist) === q({ hand: 'hand_l_fist', finger: null }) &&
			q(editor.back) === q({ hand: 'hand_l', finger: 'index_1_l', index: 1 }),
		q(editor),
	);
	ok(
		'📐 a hand curl drops a removed finger and follows a renamed one',
		q(editor.sets) === q(['curl_mid_l', 'curl_ring_l', 'curl_pinky_l', 'thumb_l']),
		q(editor.sets),
	);

	if (SHOT) {
		await evaluate('animTime = 1; drawOnce && drawOnce(); true').catch(() => {});
		await new Promise((r) => setTimeout(r, 400));
		const shot = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
		console.log(`  screenshot: ${SHOT}`);
	}

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok('nothing was sent to the server', seen.other.length === 0, q(seen.other));
	ok(
		'no alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
	);
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
	console.log(
		await evaluate(
			'JSON.stringify({ sel: selected && selected.name, skel: !!skeleton, tpl: rigTemplate && rigTemplate.id, raw: !!rawDoc, anim: animMode, hint: document.getElementById("hint").textContent })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — half body ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
