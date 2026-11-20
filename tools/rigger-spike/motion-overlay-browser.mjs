// Browser gate for 🎥 Motion's reference overlay (rig templates, docs/design/rig-templates.md §5.5),
// on the SHIPPED view.html and the committed vendor/rigger-motion.js in a real Chromium against a
// fake launcher API, with a real `half-body` rig built by the server's `templateRig`. The import is
// a Flipbook clip whose six frames are solid colours, so which frame the overlay shows is read off a
// pixel; the tracker answers a fixed track (shoulders, elbows, wrists, eyes). Checked:
//  - after an import, the Motion row has a Reference block (header tooltip, icon buttons, an
//    opacity slider) and the import row a folded Auto-range block, body off and the rest full;
//  - 👁 shows the clip BEHIND the rig (a canvas under `#cv`, click-through), in Animate mode only;
//  - in sync with the playhead: the frame shown is the one at (playhead − the import's playhead) ×
//    the clip's rate, while scrubbing and while playing; before the import, nothing;
//  - the opacity slider sets its opacity;
//  - ⤢ lines it up by the motion map's scale and the shoulders: the picture's shoulders land on the
//    rig's (setup pose), whatever the stage zoom; the ✥ handles move it and scale it about its middle,
//    in rig units;
//  - ⦿ draws the tracked body lines over it;
//  - the alignment is the animation's: another animation shows no reference, coming back shows the
//    same alignment, and after a reload the clip, its alignment and the opacity come back;
//  - a video (a WebM recorded in the page), imported From three frames before it turns blue: the
//    import reads it from there (the frames it tracks), and the overlay seeks it to From +
//    the time since the import's playhead; after a reload it is not there (it is never uploaded) and
//    the row asks for it again;
//  - the page throws nothing and sends nothing.
//   node tools/rigger-spike/motion-overlay-browser.mjs [--shot <file.png>]
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
const out = join(mkdtempSync(join(tmpdir(), 'motion-overlay-')), 'templates.mjs');
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
rig.animations = { take: {}, other: {} };
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...lines].join('\n'),
	template: rigTemplateFromSidecar(JSON.stringify({ id: 'half-body', version: HALF_BODY.version })),
};

// The clip: six 64 × 36 frames, each one solid colour.
const FW = 64;
const FH = 36;
const FPS = 12;
const COLORS = [
	[230, 40, 40],
	[40, 200, 40],
	[40, 60, 230],
	[230, 200, 30],
	[200, 40, 210],
	[30, 210, 210],
];
const sheet = png(FW * COLORS.length, FH, (px) => [...COLORS[Math.floor(px / FW)], 0xff]);
const CLIP = {
	id: 'c1',
	name: 'colours',
	assetKey: 'p/sheets/a.json',
	frames: COLORS.map((_, i) => `f${i}`),
	fps: FPS,
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const seen = { other: [] };
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
				pageWidth: FW * COLORS.length,
				pageHeight: FH,
				regions: COLORS.map((_, i) => ({ name: `f${i}`, x: i * FW, y: 0, w: FW, h: FH })),
			});
		if (p === '/api/editor/asset') return send(200, 'image/png', sheet);
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
	name: 'motion-overlay',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
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
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const motionBtn = `[...document.querySelectorAll("#faceList button")].find((b) => b.textContent.includes("Motion"))`;
const keyBtn = `[...document.querySelectorAll("#faceList .faceMotion button")].find((b) => b.textContent.includes("Key at playhead"))`;
const refBtn = (cls) => `document.querySelector("#faceList .faceRef button.${cls}")`;
/** The overlay's pixel at the middle of the reference (drawn now, at this playhead). */
const centrePixel = `(() => {
	drawMotionRef();
	const cv = document.getElementById("refCv"), rec = motionRefOf(curAnim), a = rec.align;
	const p = fxProject(a.x, a.y), dpr = window.devicePixelRatio || 1;
	const d = cv.getContext("2d").getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data;
	return { rgba: [...d], shown: rec.shown };
})()`;
const isColour = (px, i) =>
	!!px && px.rgba[3] > 250 && COLORS[i].every((c, k) => near(px.rgba[k], c, 6));
const openRig = async () => {
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
	await evaluate('setCurAnim("take"); animTime = 0.5; playing = false; renderFacePanel(); true');
	await evaluate(`${motionBtn}.click(); true`);
	await waitFor(
		'!!document.querySelector("#faceList .faceMotion select") && projectClips !== null',
		10000,
	);
	if (!(await evaluate('ensureRiggerMotion()'))) throw new Error('the motion bundle did not load');
};
// The tracker answers a performer standing still: shoulders at 0.4 / 0.6 across, a third down.
const stubTracker = `(() => {
	RiggerMotion.track = async (kinds, src) => {
		let n = 0;
		window.__seen = [];
		const k = document.createElement("canvas"); k.width = 16; k.height = 9; const kg = k.getContext("2d");
		for await (const f of src.frames) {
			kg.drawImage(f.image, 0, 0, 16, 9);
			const d = kg.getImageData(8, 4, 1, 1).data;
			window.__seen.push(d[0] > 120 && d[2] < 110 ? "red" : d[2] > 120 && d[0] < 110 ? "blue" : d[1] > 120 ? "green" : "?");
			n++;
		}
		const stand = { 11: [0.6, 0.35], 12: [0.4, 0.35], 13: [0.62, 0.6], 14: [0.38, 0.6], 15: [0.63, 0.85], 16: [0.37, 0.85], 23: [0.56, 0.98], 24: [0.44, 0.98] };
		const eyes = Array(478).fill(null);
		eyes[33] = [0.46, 0.2]; eyes[133] = [0.48, 0.2]; eyes[362] = [0.52, 0.2]; eyes[263] = [0.54, 0.2];
		const frames = Array.from({ length: n }, (_, i) => {
			const lm = Array(33).fill(null);
			for (const [k, p] of Object.entries(stand)) lm[k] = [p[0], p[1], 0.99];
			return { t: i / ${FPS}, face: { landmarks: eyes, blend: {} }, pose: { landmarks: lm }, hands: [] };
		});
		return { width: src.width, height: src.height, frames };
	};
	return true;
})()`;

try {
	await openRig();
	await evaluate(stubTracker);
	await evaluate(`(() => {
		const sel = document.querySelector("#faceList .faceMotion select");
		sel.value = "clip:c1"; sel.dispatchEvent(new Event("change"));
		return true;
	})()`);
	// 1. The rows.
	const fit = await evaluate(`(() => {
		const box = document.querySelector("#faceList .faceMotion details.faceMotionFit");
		return box && {
			open: box.open, tip: box.querySelector("summary").title.length > 40,
			groups: [...box.querySelectorAll("select")].map((s) => s.dataset.group + "=" + s.value),
		};
	})()`);
	ok(
		'the import row has a folded Auto-range block (tooltip header): body off, the face and hands full',
		!!fit &&
			!fit.open &&
			fit.tip &&
			q(fit.groups) ===
				q(['mouth=1', 'eyes=1', 'brows=1', 'gaze=1', 'head=1', 'body=0', 'hands=1']),
		q(fit),
	);
	ok(
		'no Reference block before the animation has an import',
		!(await evaluate('!!document.querySelector("#faceList .faceRef")')),
	);
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 20000);
	const ref = await evaluate(`(() => {
		const box = document.querySelector("#faceList .faceRef");
		return box && {
			tip: box.querySelector("summary").title,
			buttons: [...box.querySelectorAll("button")].map((b) => b.className.split(" ")[0] + ":" + b.textContent),
			slider: !!box.querySelector("input.refOpacity[type=range]"),
			text: [...box.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(""),
		};
	})()`);
	ok(
		'after the import the Motion row has a Reference block: header tooltip, icon buttons, opacity',
		!!ref &&
			ref.tip.includes('behind the rig') &&
			ref.tip.includes('0.5 s') &&
			q(ref.buttons) === q(['refShow:👁', 'refMarks:⦿', 'refAdjust:✥', 'refFit:⤢']) &&
			ref.slider &&
			ref.text === '',
		q(ref),
	);
	const rec = await evaluate(
		'(() => { const r = motionRefOf("take"); return r && { src: r.src, clipId: r.clipId, at: r.at, fps: r.fps, frames: r.track.length, align: !!r.align }; })()',
	);
	ok(
		'the import is recorded as the animation’s reference: the clip, at the import’s playhead, at its rate',
		q(rec) === q({ src: 'clip', clipId: 'c1', at: 0.5, fps: FPS, frames: 6, align: true }),
		q(rec),
	);

	// 2. Behind the rig, in sync with the playhead.
	ok(
		'hidden until 👁',
		(await evaluate(
			'drawMotionRef(); getComputedStyle(document.getElementById("refCv")).display',
		)) === 'none',
	);
	await evaluate(`${refBtn('refShow')}.click(); true`);
	await evaluate(
		'document.querySelector("#faceList .faceRef input.refOpacity").value = "1"; document.querySelector("#faceList .faceRef input.refOpacity").dispatchEvent(new Event("input")); true',
	);
	await waitFor('!!motionRefOf("take").clipSrc', 10000);
	const layers = await evaluate(`(() => {
		const r = document.getElementById("refCv"), c = document.getElementById("cv"), s = getComputedStyle(r);
		return { z: [s.zIndex, getComputedStyle(c).zIndex], click: s.pointerEvents, before: r.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false, shown: s.display };
	})()`);
	ok(
		'👁 shows it on a canvas under the rig’s (z 0 under 1, before it in the stage), click-through',
		q(layers) === q({ z: ['0', '1'], click: 'none', before: true, shown: 'block' }),
		q(layers),
	);
	const at = async (t) => {
		await evaluate(`animTime = ${t}; true`);
		return evaluate(centrePixel);
	};
	const sync = [];
	for (const [t, i] of [
		[0.5, 0],
		[0.5 + 1 / FPS, 1],
		[0.5 + 3 / FPS, 3],
		[0.5 + 3.4 / FPS, 3],
		[0.5 + 5 / FPS, 5],
	]) {
		const px = await at(t);
		sync.push([t.toFixed(3), i, px.shown, isColour(px, i)]);
	}
	ok(
		'in sync with the playhead: (playhead − 0.5 s) × 12 fps is the frame shown',
		sync.every(([, i, shown, colour]) => shown === i && colour),
		q(sync),
	);
	const before = await at(0.4);
	ok(
		'before the import’s playhead nothing is drawn',
		before.shown === -1 && before.rgba[3] === 0,
		q(before),
	);
	await evaluate('animTime = 0.5; playing = true; playSpeed = 1; looping = true; true');
	await new Promise((r) => setTimeout(r, 250));
	const playing = await evaluate(`(() => {
		const t = animTime, px = ${centrePixel};
		playing = false;
		return { t, want: Math.round((t - 0.5) * ${FPS}), px };
	})()`);
	ok(
		'and while playing: the frame follows the moving playhead',
		playing.t > 0.55 &&
			(playing.want > 5 ||
				(playing.px.shown === playing.want && isColour(playing.px, playing.want))),
		q(playing),
	);
	const preview = await evaluate(`(() => {
		document.querySelector('#modeSeg button[data-mode="preview"]').click();
		drawMotionRef();
		const d = getComputedStyle(document.getElementById("refCv")).display;
		document.querySelector('#modeSeg button[data-mode="animate"]').click();
		return d;
	})()`);
	ok('Animate mode only: hidden in Preview', preview === 'none', preview);
	await evaluate('setCurAnim("take"); animTime = 0.5 + 2 / 12; renderFacePanel(); true');
	await waitFor('!!document.querySelector("#faceList .faceRef")', 5000);

	// 3. Opacity.
	const alphaAt = async (v) => {
		await evaluate(
			`(() => { const i = document.querySelector("#faceList .faceRef input.refOpacity"); i.value = "${v}"; i.dispatchEvent(new Event("input")); return true; })()`,
		);
		return (await evaluate(centrePixel)).rgba[3];
	};
	const alphas = [await alphaAt(0.25), await alphaAt(0.6), await alphaAt(1)];
	ok(
		'the opacity slider sets the reference’s opacity',
		near(alphas[0], 64, 3) && near(alphas[1], 153, 3) && alphas[2] === 255,
		q(alphas),
	);

	// 4. Alignment.
	const fitted = await evaluate(`(() => {
		const rec = motionRefOf("take"), a = rec.align, k = a.h / rec.height, aw = a.h * rec.width / rec.height;
		const world = (px, py) => [a.x - aw / 2 + px * rec.width * k, a.y + a.h / 2 - py * rec.height * k];
		skeleton.setToSetupPose(); updateWorld();
		const bone = (n) => { const b = skeleton.findBone(n); return [b.worldX, b.worldY]; };
		return { l: world(0.4, 0.35), r: world(0.6, 0.35), rigL: bone("upper_arm_l"), rigR: bone("upper_arm_r"), k, unit: 280 / (0.2 * rec.width) };
	})()`);
	const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
	ok(
		'⤢ sizes it by the motion map’s scale (shoulder spread = 280 rig units)',
		near(fitted.k, fitted.unit, 1e-6),
		q(fitted),
	);
	ok(
		'…and puts the picture’s shoulders on the rig’s (setup pose)',
		d2(fitted.l, fitted.rigL) < 0.5 && d2(fitted.r, fitted.rigR) < 0.5,
		q(fitted),
	);
	const zoomed = await evaluate(`(() => {
		const cam = renderer.camera, z0 = cam.zoom;
		cam.zoom = z0 * 1.7; cam.update();
		const rec = motionRefOf("take"), a = rec.align;
		const l = fxProject(rigWorld("upper_arm_l")[0], rigWorld("upper_arm_l")[1]);
		drawMotionRef();
		const aw = a.h * rec.width / rec.height, tl = fxProject(a.x - aw / 2, a.y + a.h / 2), br = fxProject(a.x + aw / 2, a.y - a.h / 2);
		const pic = [tl.x + 0.4 * (br.x - tl.x), tl.y + 0.35 * (br.y - tl.y)];
		cam.zoom = z0; cam.update();
		return { l: [l.x, l.y], pic };
		function rigWorld(n){ skeleton.setToSetupPose(); updateWorld(); const b = skeleton.findBone(n); return [b.worldX, b.worldY]; }
	})()`);
	ok(
		'the alignment is in rig units: zoomed in, the shoulder still sits on the rig’s on screen',
		d2(zoomed.l, zoomed.pic) < 1,
		q(zoomed),
	);
	await evaluate(`${refBtn('refAdjust')}.click(); true`);
	const drag = async (id, dx, dy) => {
		const box = await evaluate(
			`(() => { drawMotionRef(); const r = document.getElementById("${id}").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, shown: getComputedStyle(document.getElementById("${id}")).display }; })()`,
		);
		for (const [type, x1, y1] of [
			['mousePressed', box.x, box.y],
			['mouseMoved', box.x + dx / 2, box.y + dy / 2],
			['mouseMoved', box.x + dx, box.y + dy],
			['mouseReleased', box.x + dx, box.y + dy],
		])
			await send('Input.dispatchMouseEvent', {
				type,
				x: x1,
				y: y1,
				button: 'left',
				buttons: type === 'mouseReleased' ? 0 : 1,
				clickCount: 1,
			});
		return box;
	};
	const a0 = await evaluate('Object.assign({}, motionRefOf("take").align)');
	const scale0 = await evaluate(
		'(() => { const p0 = fxProject(0, 0), p1 = fxProject(100, 0); return (p1.x - p0.x) / 100; })()',
	);
	const mv = await drag('refMove', 40, -30);
	const a1 = await evaluate('Object.assign({}, motionRefOf("take").align)');
	ok(
		'✥ shows the handles; dragging the middle one moves it by the drag, in rig units',
		mv.shown === 'block' &&
			near(a1.x - a0.x, 40 / scale0, 1.5 / scale0) &&
			near(a1.y - a0.y, 30 / scale0, 1.5 / scale0) &&
			a1.h === a0.h,
		q({ a0, a1, scale0 }),
	);
	// Toward the middle, half the way: wherever the handle is (it is kept on the stage), 0.5×.
	const toMiddle = await evaluate(`(() => {
		const a = motionRefOf("take").align, c = fxProject(a.x, a.y), r = document.getElementById("cv").getBoundingClientRect();
		const h = document.getElementById("refScale").getBoundingClientRect();
		return { dx: (r.left + c.x - (h.left + h.width / 2)) / 2, dy: (r.top + c.y - (h.top + h.height / 2)) / 2 };
	})()`);
	await drag('refScale', toMiddle.dx, toMiddle.dy);
	const a2 = await evaluate('Object.assign({}, motionRefOf("take").align)');
	ok(
		'dragging the corner scales it about its middle (half way in: 0.5×), kept on the stage',
		near(a2.h / a1.h, 0.5, 0.03) && a2.x === a1.x && a2.y === a1.y,
		q({ a1, a2, toMiddle }),
	);

	// 5. Landmarks.
	const marks = await evaluate(`(() => {
		const i = document.querySelector("#faceList .faceRef input.refOpacity"); i.value = "0"; i.dispatchEvent(new Event("input"));
		const rec = motionRefOf("take"), a = rec.align, aw = a.h * rec.width / rec.height;
		const tl = fxProject(a.x - aw / 2, a.y + a.h / 2), br = fxProject(a.x + aw / 2, a.y - a.h / 2);
		const at = (px, py) => { drawMotionRef(); const dpr = window.devicePixelRatio || 1; return [...document.getElementById("refCv").getContext("2d").getImageData(Math.round((tl.x + px * (br.x - tl.x)) * dpr), Math.round((tl.y + py * (br.y - tl.y)) * dpr), 1, 1).data]; };
		const on = at(0.5, 0.35);
		motionRefView.marks = false;
		const off = at(0.5, 0.35);
		motionRefView.marks = true;
		return { on, off };
	})()`);
	ok(
		'⦿ draws the tracked body lines over it (the shoulder line, at opacity 0)',
		marks.on[0] > 200 && marks.on[1] > 150 && marks.on[2] < 90 && marks.off[3] === 0,
		q(marks),
	);
	await evaluate(
		'(() => { const i = document.querySelector("#faceList .faceRef input.refOpacity"); i.value = "0.7"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new Event("change")); return true; })()',
	);

	// 6. Per animation, and for the session.
	const other = await evaluate(`(() => {
		setCurAnim("other"); drawMotionRef();
		const d = getComputedStyle(document.getElementById("refCv")).display, block = !!document.querySelector("#faceList .faceRef");
		setCurAnim("take"); animTime = 0.5 + 4 / 12; drawMotionRef();
		return { d, block, back: Object.assign({}, motionRefOf("take").align), shown: !!document.querySelector("#faceList .faceRef") };
	})()`);
	ok(
		'another animation shows no reference; coming back shows the same alignment',
		other.d === 'none' && !other.block && other.shown && q(other.back) === q(a2),
		q(other),
	);
	const stored = await evaluate('JSON.parse(sessionStorage.getItem("rigger.motionRef.v1"))');
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await new Promise((r) => setTimeout(r, 500));
	await openRig();
	await waitFor('!!document.querySelector("#faceList .faceRef")', 10000);
	await waitFor('!!motionRefOf("take") && !!motionRefOf("take").clipSrc', 10000).catch(() =>
		evaluate('drawMotionRef(); true'),
	);
	await waitFor('!!motionRefOf("take").clipSrc', 10000);
	const reloaded = await evaluate(`(() => {
		animTime = 0.5 + 4 / 12;
		const px = ${centrePixel};
		return { align: Object.assign({}, motionRefOf("take").align), opacity: motionRefView.opacity, show: motionRefView.show, px };
	})()`);
	ok(
		'after a reload the clip, its alignment and the opacity come back (sessionStorage)',
		!!stored.refs &&
			q(reloaded.align) === q(a2) &&
			reloaded.opacity === 0.7 &&
			reloaded.show === true &&
			reloaded.px.shown === 4 &&
			near(reloaded.px.rgba[3], 179, 3),
		q({ reloaded, stored: Object.keys(stored.refs ?? {}) }),
	);

	// 7. A video: recorded in the page, picked as a file, never uploaded.
	await evaluate(stubTracker);
	// Recorded in the page: red, then blue, then green. Headless Chrome's recorder runs late against
	// the wall clock, so what the video holds at a time is read back from it on its own first.
	const made = await evaluate(`(async () => {
		const c = document.createElement("canvas"); c.width = 160; c.height = 90;
		const g = c.getContext("2d");
		const stream = c.captureStream(30);
		const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
		const parts = [];
		rec.ondataavailable = (e) => parts.push(e.data);
		let t0 = 0;
		const paint = () => {
			const s = t0 ? (performance.now() - t0) / 1000 : 0;
			g.fillStyle = s < 0.8 ? "rgb(230,40,40)" : s < 2 ? "rgb(40,60,230)" : "rgb(40,200,40)";
			g.fillRect(0, 0, 160, 90);
		};
		paint(); rec.start(100);
		await new Promise((ok) => (rec.onstart = ok));
		t0 = performance.now();
		await new Promise((done) => { const tick = () => { paint(); if (performance.now() - t0 < 2600) setTimeout(tick, 15); else done(); }; tick(); });
		await new Promise((done) => { rec.onstop = done; rec.stop(); });
		const file = new File(parts, "take.webm", { type: "video/webm" });
		const v = document.createElement("video"); v.muted = true; v.src = URL.createObjectURL(file);
		await new Promise((ok) => (v.onloadeddata = ok));
		const k = document.createElement("canvas"); k.width = 16; k.height = 9; const kg = k.getContext("2d");
		if (!Number.isFinite(v.duration)) await new Promise((ok) => { v.onseeked = ok; v.currentTime = 1e7; });
		const truth = [];
		for (let i = 0; i <= Math.min(72, Math.floor(v.duration * 12)); i++){
			await new Promise((ok) => { v.onseeked = ok; v.currentTime = i / 12; });
			kg.drawImage(v, 0, 0, 16, 9);
			const d = kg.getImageData(8, 4, 1, 1).data;
			truth.push(d[0] > 120 && d[2] < 110 ? "red" : d[2] > 120 && d[0] < 110 ? "blue" : d[1] > 120 ? "green" : "?");
		}
		URL.revokeObjectURL(v.src);
		faceMotionFile = file; faceMotionSrc = "video";
		setCurAnim("other"); animTime = 1; renderFacePanel();
		return { size: file.size, truth };
	})()`);
	// From three frames before the video turns blue: what it reads from there differs from its start.
	const FROM_AT = made.truth.indexOf('blue') - 3;
	if (!(FROM_AT >= 3)) throw new Error(`the recorded video holds ${q(made.truth)}`);
	await waitFor('!!document.querySelector("#faceList .faceMotion select")', 5000);
	const fromShown = await evaluate(`(() => {
		const rate = [...document.querySelectorAll("#faceList .faceMotion select")].find((s) => s.title.startsWith("Frames read"));
		rate.value = "12";
		const from = document.querySelector("#faceList .faceMotion input.faceMotionFrom");
		from.value = String(${FROM_AT} / 12); from.dispatchEvent(new Event("input"));
		return getComputedStyle(from).display !== "none";
	})()`);
	ok('a video offers From (seconds into it)', fromShown === true);
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!motionRefOf("other") || window.__alerts.length > 0', 60000);
	const vrec = await evaluate(
		'(() => { const r = motionRefOf("other"); return r && { src: r.src, file: r.file && r.file.name, at: r.at, start: r.start, fps: r.fps }; })()',
	);
	ok(
		'a video import is the animation’s reference too: the file (kept in the browser), from From',
		q(vrec) === q({ src: 'video', file: 'take.webm', at: 1, start: FROM_AT / 12, fps: 12 }),
		q({ vrec, made, alerts: await evaluate('window.__alerts') }),
	);
	const seekTo = async (t) => {
		await evaluate(`animTime = ${t}; drawMotionRef(); true`);
		await waitFor(
			`(() => { const v = motionRefOf("other").video; return !!v && !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - ${FROM_AT / 12 + Math.round((t - 1) * 12) / 12}) < 1e-3; })()`,
			15000,
		);
		await new Promise((r) => setTimeout(r, 120));
		return evaluate(`(() => {
			drawMotionRef();
			const cv = document.getElementById("refCv"), rec = motionRefOf("other"), a = rec.align;
			const p = fxProject(a.x, a.y), dpr = window.devicePixelRatio || 1;
			return { t: rec.video.currentTime, rgba: [...cv.getContext("2d").getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data] };
		})()`);
	};
	// Frames from From (index FROM_AT): the playhead at 1 s + (i − FROM_AT) / 12 shows frame i.
	const tracked = await evaluate('window.__seen');
	ok(
		'From: the import reads the video from there (the frames it tracks are the video’s from From)',
		tracked.length > 6 &&
			q(tracked.slice(0, 6)) === q(made.truth.slice(FROM_AT, FROM_AT + 6)) &&
			q(tracked.slice(0, 6)) !== q(made.truth.slice(0, 6)),
		q({ tracked: tracked.slice(0, 6), truth: made.truth.slice(FROM_AT, FROM_AT + 6) }),
	);
	const red = made.truth.findIndex((c, i) => i >= FROM_AT && c === 'red');
	const blue = made.truth.findIndex((c, i) => i >= FROM_AT && c === 'blue');
	const colourOf = (px) =>
		px.rgba[0] > 120 && px.rgba[2] < 110
			? 'red'
			: px.rgba[2] > 120 && px.rgba[0] < 110
				? 'blue'
				: px.rgba[1] > 120
					? 'green'
					: '?';
	const v1 = await seekTo(1 + (red - FROM_AT) / 12);
	const v2 = await seekTo(1 + (blue - FROM_AT) / 12);
	ok(
		'the overlay seeks the video to From + (playhead − the import’s playhead): the frame the video holds there',
		red >= 0 &&
			blue > red &&
			near(v1.t, red / 12, 1e-3) &&
			colourOf(v1) === 'red' &&
			near(v2.t, blue / 12, 1e-3) &&
			colourOf(v2) === 'blue',
		q({ v1, v2, truth: made.truth }),
	);
	if (SHOT) {
		await evaluate(
			'setCurAnim("take"); animTime = 0.5 + 2 / 12; motionRefView.opacity = 0.5; showBones = true; true',
		);
		await new Promise((r) => setTimeout(r, 400));
		const shot = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
		console.log(`  screenshot: ${SHOT}`);
	}
	await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
	await new Promise((r) => setTimeout(r, 500));
	await openRig();
	await evaluate('setCurAnim("other"); animTime = 1.2; renderFacePanel(); true');
	await waitFor('!!document.querySelector("#faceList .faceRef")', 10000);
	const gone = await evaluate(`(() => {
		const r = motionRefOf("other"), b = document.querySelector("#faceList .faceRef button.refRepick");
		drawMotionRef();
		return { file: r.file, video: !!r.video, button: b && b.textContent };
	})()`);
	ok(
		'after a reload the video is not there (never uploaded): the row asks for it again',
		gone.file === null && !gone.video && gone.button === '🎞 Pick take.webm again',
		q(gone),
	);

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
			'JSON.stringify({ sel: selected && selected.name, skel: !!skeleton, tpl: rigTemplate && rigTemplate.id, raw: !!rawDoc, anim: animMode, hint: document.getElementById("hint").textContent, alerts: window.__alerts })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — motion overlay ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
