// Browser gate for the Controls section's motion import (rig templates T5 / T7b), on the SHIPPED
// view.html and the committed vendor/rigger-motion.js in a real Chromium against a fake launcher API,
// with real template rigs built by the server's `templateRig`. Checked:
//  - the tracker loads for real: MediaPipe's WASM runtime and both `.task` models are fetched from
//    /rigger/vendor/mediapipe/ and run over frames (blank ones find nothing — and say so);
//  - 🎥 Motion opens a panel listing the project's Flipbook clips and a local video pick;
//  - a clip's frames are read from their sheets (scoped and bare names, at the untrimmed size), in
//    order, at the clip's rate; a video is read from the picked file at the chosen rate, never sent;
//  - 🎥 Key at playhead keys the solved track at the playhead, replacing the imported controls'
//    keys under it, as ONE undo step, and lists what did not carry over (untracked frames, the
//    template's "cannot" lines);
//  - a source is closed (its object URL or sheet images freed) whatever the import's outcome;
//  - one import at a time: a panel re-rendered mid-import keeps its button off;
//  - a body template offers the same action for the body, and a rig without a template none.
// The solve itself is gated headlessly by motion-solve.mjs; how MediaPipe copes with real footage
// is in docs/status/rigger.md (needs footage, not a gate).
//   node tools/rigger-spike/face-motion-browser.mjs
import { spawnSync } from 'node:child_process';
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
if (!existsSync(join(STATIC, 'rigger/vendor/mediapipe/vision_wasm_internal.wasm')))
	spawnSync('node', [join(APP, 'scripts/copy-mediapipe-wasm.mjs')], { stdio: 'inherit' });

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'face-motion-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { BUST_FACE, FULL_BODY, templateRig, rigTemplateFromSidecar } = await import(
	pathToFileURL(out).href
);

function png(w, h, shade = 0x80) {
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
	const raw = Buffer.alloc((w * 4 + 1) * h, shade);
	for (let r = 0; r < h; r++) raw[r * (w * 4 + 1)] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function rigOf(key, tpl, anim) {
	const PAGE_W = 1024;
	let x = 0,
		y = 0,
		rowH = 0;
	const lines = [];
	const regions = tpl.parts.map((p) => {
		const [w, h] = p.size;
		if (x + w > PAGE_W) {
			x = 0;
			y += rowH;
			rowH = 0;
		}
		lines.push(p.name, `bounds:${x},${y},${w},${h}`);
		const r = { name: p.name, w, h };
		x += w;
		rowH = Math.max(rowH, h);
		return r;
	});
	const rig = templateRig(tpl, regions).skeleton;
	rig.animations = { [anim]: {} };
	return {
		rig,
		atlas: [`${key}.png`, `size:${PAGE_W},${y + rowH}`, 'filter:Linear,Linear', ...lines].join(
			'\n',
		),
		png: png(PAGE_W, y + rowH),
		template: rigTemplateFromSidecar(JSON.stringify({ id: tpl.id, version: 1 })),
	};
}
const RIGS = {
	face: rigOf('face', BUST_FACE, 'take'),
	body: rigOf('body', FULL_BODY, 'take'),
	plain: { ...rigOf('plain', BUST_FACE, 'take'), template: null },
	still: (() => {
		const r = rigOf('still', BUST_FACE, 'take');
		return { ...r, template: { ...r.template, motion: null } };
	})(),
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

// A Flipbook clip over two sheets: three bare frames (trimmed, placed by offX/offY in a 40×40
// frame) and one scoped to the second sheet.
const CLIP = {
	id: 'c1',
	name: 'wink',
	assetKey: 'p/sheets/a.json',
	frames: ['f0', 'f1', 'f2', 'p/sheets/b.json::g0'],
	fps: 12,
};
const SHEETS = {
	'p/sheets/a.json': {
		pageKey: 'p/sheets/a.png',
		regions: ['f0', 'f1', 'f2'].map((name, i) => ({
			name,
			x: i * 32,
			y: 0,
			w: 32,
			h: 32,
			offX: 4,
			offY: 4,
			origW: 40,
			origH: 40,
		})),
	},
	'p/sheets/b.json': {
		pageKey: 'p/sheets/b.png',
		regions: [{ name: 'g0', x: 0, y: 0, w: 36, h: 36, offX: 2, offY: 2, origW: 40, origH: 40 }],
	},
};
const seen = { regions: [], assets: [], other: [] };

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
				skeletons: Object.keys(RIGS).map((name, id) => ({
					id,
					name,
					folder: name,
					dir_b64: b64(name),
					skeleton_file: `${name}.irig`,
					atlas_file: `${name}.atlas`,
					format: 'json',
					runtime: '4.2',
					version: '4.2',
					pma: false,
				})),
			});
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			const rig = RIGS[name.split('.')[0]];
			if (rig && name.endsWith('.irig')) return json(rig.rig);
			if (rig && name.endsWith('.atlas')) return send(200, 'text/plain', rig.atlas);
			if (rig && name.endsWith('.png')) return send(200, 'image/png', rig.png);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') {
			const dir = Buffer.from(url.searchParams.get('dir') ?? '', 'base64url').toString();
			return json({ template: RIGS[dir]?.template ?? null });
		}
		if (p === '/api/editor/flipbooks') return json({ clips: [CLIP] });
		if (p === '/api/editor/regions') {
			const key = url.searchParams.get('sheet');
			seen.regions.push(key);
			const s = SHEETS[key];
			if (!s) return json({ regions: [] });
			return json({
				assetKey: key,
				pageKey: s.pageKey,
				pageVersion: 'v1',
				pageWidth: 128,
				pageHeight: 40,
				regions: s.regions,
			});
		}
		if (p === '/api/editor/asset') {
			seen.assets.push(url.searchParams.get('key') + '@' + url.searchParams.get('v'));
			return send(200, 'image/png', png(128, 40, 0x60));
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null });
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
	name: 'face-motion',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
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

async function openRig(name) {
	await evaluate(`(() => {
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === ${q(name)});
		row.click();
		return true;
	})()`);
	await waitFor(
		`!!skeleton && selected && selected.name === ${q(name)} && (rigTemplate !== null || ${q(name)} === "plain")`,
		30000,
	);
	await new Promise((r) => setTimeout(r, 200));
	await evaluate(
		`(() => { document.querySelector('#modeSeg button[data-mode="animate"]').click(); return true; })()`,
	);
	await waitFor('!!rawDoc && animMode', 30000);
	await evaluate('curAnim = "take"; renderFacePanel(); true');
}
const motionBtn = `[...document.querySelectorAll("#faceList button")].find((b) => b.textContent.includes("Motion"))`;
const keyBtn = `[...document.querySelectorAll("#faceList .faceMotion button")].find((b) => b.textContent.includes("Key at playhead"))`;

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
		'[...document.querySelectorAll("#list .item .nm")].some((n) => n.textContent === "face")',
		30000,
	);

	// 1. The real tracker, on blank frames.
	ok('the motion bundle loads', await evaluate('ensureRiggerMotion()'));
	const real = await evaluate(`(async () => {
		const c = document.createElement("canvas"); c.width = 64; c.height = 64;
		const g = c.getContext("2d"); g.fillStyle = "#777"; g.fillRect(0, 0, 64, 64);
		async function* frames(){ for (let i = 0; i < 3; i++) yield { t: i / 10, image: c }; }
		const f = await RiggerMotion.track("face", { width: 64, height: 64, frames: frames() });
		const b = await RiggerMotion.track("body", { width: 64, height: 64, frames: frames() });
		return { f: f.frames.map((x) => x.face), b: b.frames.map((x) => x.pose) };
	})()`);
	ok(
		'MediaPipe runs the face model: three frames, no face in blank ones',
		q(real.f) === q([null, null, null]),
		q(real),
	);
	ok(
		'MediaPipe runs the pose model: three frames, no body in blank ones',
		q(real.b) === q([null, null, null]),
		q(real),
	);

	// 2. The panel and the clip import, with the tracker answering a fixed blink + open mouth.
	await openRig('face');
	ok('a face template offers 🎥 Motion', await evaluate(`!!${motionBtn}`));
	await evaluate(`${motionBtn}.click(); true`);
	await waitFor(
		'!!document.querySelector("#faceList .faceMotion select") && projectClips !== null',
		10000,
	);
	await new Promise((r) => setTimeout(r, 100));
	const options = await evaluate(
		`[...document.querySelector("#faceList .faceMotion select").options].map((o) => o.textContent)`,
	);
	ok(
		'the panel lists the Flipbook clips and a video pick',
		options.some((o) => o.includes('wink (4f)')) && options.some((o) => o.includes('Video file')),
		q(options),
	);

	await evaluate(`(() => {
		window.__tracked = [];
		const real = RiggerMotion.track;
		RiggerMotion.track = async (kind, src, onProgress) => {
			const got = [];
			for await (const f of src.frames) got.push({ t: f.t, w: f.image.width, h: f.image.height });
			window.__tracked.push({ kind, width: src.width, height: src.height, count: src.count, seconds: src.seconds, got });
			const lm = (tilt) => { const a = Array(478).fill(null); a[33] = [0.4, 0.45]; a[263] = [0.6, 0.45]; a[1] = [0.5, 0.55]; return a; };
			const frames = Array.from({ length: 24 }, (_, i) => ({
				t: i / 12,
				face: i === 23 ? null : { landmarks: lm(), blend: Object.assign({}, i >= 4 && i <= 6 ? { eyeBlinkLeft: 1, eyeBlinkRight: 1 } : {}, i >= 10 && i <= 16 ? { jawOpen: 0.7 } : {}) },
			}));
			onProgress && onProgress(frames.length);
			return { width: src.width, height: src.height, frames };
		};
		window.__realTrack = real;
		const solve = RiggerMotion.solve;
		RiggerMotion.solve = (t, tr, o) => { window.__solveOpts = o; return solve(t, tr, o); };
		return true;
	})()`);
	const before = await evaluate(`(() => {
		const a = rawDoc.animations.take, ch = rigTemplate.channels;
		historyStep(() => {
			faceKeyChannel(a, ch.find((c) => c.id === "jaw"), 0.3, 0.2, faceHas);
			faceKeyChannel(a, ch.find((c) => c.id === "jaw"), 0.9, 1.5, faceHas);
			faceKeyChannel(a, ch.find((c) => c.id === "head_nod"), 5, 1.5, faceHas);
			markDirty();
		});
		animTime = 1; playing = false;
		const sel = document.querySelector("#faceList .faceMotion select");
		sel.value = "clip:c1"; sel.dispatchEvent(new Event("change"));
		return JSON.stringify(rawDoc);
	})()`);
	await evaluate(
		`(() => { const s = [...document.querySelectorAll('#faceList .faceMotion select')].find((x) => [...x.options].some((o) => o.value === '2')); s.value = '2'; s.dispatchEvent(new Event('change')); return true; })()`,
	);
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 20000);
	ok(
		'the face solve gets the chosen expression strength',
		q(await evaluate('window.__solveOpts')) ===
			q({ face: true, body: false, hand: false, strength: 2 }),
		q(await evaluate('window.__solveOpts')),
	);
	const tr = (await evaluate('window.__tracked'))[0];
	ok('the clip is tracked for the face', q(tr?.kind) === q(['face']), q(tr));
	ok(
		'all four frames are read, in order, at the clip’s 12 fps',
		q(tr?.got.map((g) => g.t)) === q([0, 1 / 12, 2 / 12, 3 / 12]),
		q(tr?.got),
	);
	ok(
		'frames are drawn at the untrimmed 40 × 40',
		tr?.width === 40 && tr?.height === 40 && tr?.count === 4,
		q(tr),
	);
	ok(
		'both sheets are read, the bare frames from the clip’s own',
		q([...new Set(seen.regions)].sort()) === q(['p/sheets/a.json', 'p/sheets/b.json']),
		q(seen.regions),
	);
	ok(
		'the sheet images are fetched at their page version',
		seen.assets.every((a) => a.endsWith('@v1')) && seen.assets.length === 2,
		q(seen.assets),
	);

	const after = await evaluate(`(() => {
		const a = rawDoc.animations.take;
		return {
			jaw: a.bones.jaw.translate.map((k) => [k.time, k.y]),
			nod: a.bones.neck.rotate.map((k) => [k.time, k.value]),
			lid: (a.slots.eyelid_l.attachment || []).map((k) => [k.time, k.name || null]),
			mouth: a.slots.mouth.attachment.map((k) => [k.time, k.name || null]),
		};
	})()`);
	ok(
		'a key before the import is kept',
		after.jaw[0][0] === 0.2 && after.jaw[0][1] === -4.2,
		q(after.jaw),
	);
	ok(
		'the jaw keys under the import are the video’s',
		!after.jaw.some(([t, y]) => t === 1.5 && y === -12.6) &&
			after.jaw.some(([t, y]) => t > 1.8 && t < 2.4 && y < -13),
		q(after.jaw),
	);
	ok(
		'a control the import does not drive is left alone',
		q(after.nod) === q([[1.5, 5]]),
		q(after.nod),
	);
	ok(
		'the blink is keyed at the playhead: closed then open',
		after.lid.some(([t, n]) => n === 'eyelid_l_closed' && t >= 1.3 && t <= 1.5) &&
			after.lid.at(-1)[1] === null,
		q(after.lid),
	);
	ok(
		'the open mouth is keyed',
		after.mouth.some(([t, n]) => n === 'mouth_A' && t > 1.8 && t < 2),
		q(after.mouth),
	);
	const report = await evaluate(
		`[...document.querySelectorAll("#faceList .faceMotionReport li")].map((li) => li.textContent)`,
	);
	ok(
		'the report counts the frame with no face',
		report.some((l) => l.startsWith('1 of 24 frames had no face')),
		q(report),
	);
	ok(
		'the report says what the template cannot take',
		report.some((l) => l.startsWith('Not carried: Nods')),
		q(report),
	);
	ok(
		'the hint names the keys and the playhead',
		/🎥 \d+ keys on \d+ controls .* @ 1\.00s/.test(
			await evaluate('document.getElementById("hint").textContent'),
		),
		await evaluate('document.getElementById("hint").textContent'),
	);
	await evaluate('document.getElementById("undoBtn").click(); true');
	ok(
		'one undo gives back exactly the document before the import',
		(await evaluate('JSON.stringify(rawDoc)')) === before,
	);

	// 3. A video: recorded here, read from the picked File at the chosen rate.
	await evaluate(`(async () => {
		const c = document.createElement("canvas"); c.width = 160; c.height = 120;
		const g = c.getContext("2d");
		const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
		const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
		rec.start();
		const t0 = performance.now();
		await new Promise((done) => { (function draw(){ g.fillStyle = "hsl(" + ((performance.now() - t0) / 5) + ",50%,50%)"; g.fillRect(0, 0, 160, 120); if (performance.now() - t0 < 1200) setTimeout(draw, 30); else done(); })(); });
		rec.stop();
		await new Promise((r) => (rec.onstop = r));
		const file = new File(parts, "take.webm", { type: "video/webm" });
		const input = document.querySelector("#faceList .faceMotion input[type=file]");
		const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`);
	await waitFor(
		'faceMotionSrc === "video" && !!document.querySelector("#faceList .faceMotion select")',
		10000,
	);
	await evaluate(`(() => {
		const r = [...document.querySelectorAll("#faceList .faceMotion select")][1];
		r.value = "12"; r.dispatchEvent(new Event("change"));
		faceMotionReport = null; window.__tracked = [];
		${keyBtn}.click(); return true;
	})()`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 30000);
	const vt = (await evaluate('window.__tracked'))[0];
	ok(
		'the video is read at 12 fps over its whole length, scaled to its picture',
		!!vt &&
			vt.seconds > 0.15 &&
			vt.count === Math.floor(vt.seconds * 12) &&
			vt.got.length === vt.count &&
			Math.abs(vt.got[1].t - 1 / 12) < 1e-9 &&
			vt.width === 160 &&
			vt.height === 120,
		q(vt && { count: vt.count, s: vt.seconds, w: vt.width, h: vt.height, t1: vt.got[1]?.t }),
	);
	ok('nothing was sent to the server', seen.other.length === 0, q(seen.other));

	// 3b. Clean-up: a source is closed when tracking fails, and an unreadable video frees its URL.
	const cleanup = await evaluate(`(async () => {
		let closed = 0;
		async function* broken(){ throw new Error("unreadable frame"); }
		await window.__realTrack("face", { width: 8, height: 8, frames: broken(), close(){ closed++; } }).catch(() => {});
		const made = [], freed = [];
		const mk = URL.createObjectURL, rv = URL.revokeObjectURL;
		URL.createObjectURL = (b) => { const u = mk.call(URL, b); made.push(u); return u; };
		URL.revokeObjectURL = (u) => { freed.push(u); return rv.call(URL, u); };
		const failed = await RiggerMotion.videoFrames(new Blob(["not a video"], { type: "video/webm" }), 12).then(() => false, () => true);
		URL.createObjectURL = mk; URL.revokeObjectURL = rv;
		return { closed, failed, made, freed };
	})()`);
	ok('a source is closed when tracking it fails', cleanup.closed === 1, q(cleanup));
	ok(
		'an unreadable video frees its object URL',
		cleanup.failed && cleanup.made.length === 1 && q(cleanup.freed) === q(cleanup.made),
		q(cleanup),
	);

	// 3c. One import at a time: a panel re-rendered mid-import keeps its button off, and a second
	// click starts nothing.
	await evaluate(`(() => {
		window.__tracked = []; faceMotionReport = null;
		const stub = RiggerMotion.track;
		RiggerMotion.track = (kind, src, onProgress) => new Promise((done) => {
			window.__release = () => { RiggerMotion.track = stub; done(stub(kind, src, onProgress)); };
		});
		${keyBtn}.click();
		return true;
	})()`);
	await waitFor('typeof window.__release === "function"', 10000);
	const busy = await evaluate(`(() => {
		renderFacePanel();
		const fresh = ${keyBtn};
		const off = !!fresh && fresh.disabled;
		fresh.disabled = false; fresh.click();
		return { off, busy: faceMotionBusy };
	})()`);
	await evaluate('window.__release(); true');
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 20000);
	ok('a panel re-rendered mid-import keeps its button off', busy.off && busy.busy, q(busy));
	ok(
		'a second click mid-import starts no second import',
		(await evaluate('window.__tracked.length')) === 1,
		String(await evaluate('window.__tracked.length')),
	);
	ok(
		'the button is back on once the import ends',
		await evaluate(`!faceMotionBusy && !${keyBtn}.disabled`),
	);

	// 4. Body template: the same action for the body; a rig with no template has none.
	await openRig('body');
	ok(
		'a body template offers 🎥 Motion for the body',
		(await evaluate(`${motionBtn} && ${motionBtn}.title`))?.includes('body'),
	);
	await openRig('plain');
	ok('a rig without a template has no Motion button', await evaluate(`!${motionBtn}`));
	await openRig('still');
	ok(
		'a template with no motion map has Controls but no Motion button',
		await evaluate(`document.getElementById('secFace').style.display !== 'none' && !${motionBtn}`),
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
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
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — face motion ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
