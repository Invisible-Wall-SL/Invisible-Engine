// Browser gate for ⤢ Fit rig to the capture (docs/design/frame-to-rig.md §4.6a), on the SHIPPED
// view.html and the committed vendor/rigger-motion.js in a real Chromium against a fake launcher
// API, with a real `half-body` rig built by the server's `templateRig`. The tracker answers the
// synthetic performer of `performer3d.mjs` with arms of known lengths (233.3 + 186.7 rig units on
// the overlay's line-up, against the template's 190 + 170). Checked:
//  - the 🎥 Motion row has the ⤢ button (its description a tooltip) next to 🎥 Key at playhead;
//  - after an import, ⤢ tracks nothing again (the import's capture is kept); it refits the open rig
//    — each limb to the performer's length, the art's image bones stretched, the hand controls on
//    the wrists — and says each length old → new;
//  - the template the page drives the rig with takes the lengths (a forearm's shortening by its new
//    length, the solve's bones), and an undo takes the fit back, the template with it; a redo, again;
//  - 💾 Save posts the rig, then asks the server to keep its lengths in template.json, and the page
//    takes the template it answers;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/capture-fit-browser.mjs [--shot <file.png>]
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const out = join(mkdtempSync(join(tmpdir(), 'capture-fit-browser-')), 'templates.mjs');
await esbuild.build({
	stdin: {
		contents: [
			"export * from './server/rigTemplates.ts';",
			"export { fitTemplate } from './server/rigTemplateFit.ts';",
			"export { mergeRigLengths } from './rigCaptureFit.ts';",
		].join('\n'),
		resolveDir: join(APP, 'src/lib'),
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const T = await import(pathToFileURL(out).href);
const { HALF_BODY } = T;

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
const page = png(PAGE_W, PAGE_H, () => [0x80, 0x80, 0xb0, 0xff]);
const rig = T.templateRig(
	HALF_BODY,
	HALF_BODY.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
).skeleton;
rig.animations = { take: {} };
const REF = JSON.stringify({ id: 'half-body', version: HALF_BODY.version });
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...lines].join('\n'),
	sidecar: REF,
};

// The capture: 24 frames, the arms 0.30 + 0.24 m on shoulders 0.36 m apart, the left forearm turned
// toward the camera on half of them.
const N = 24;
const FPS = 12;
const UPPER = (0.3 * 280) / 0.36;
const LOWER = (0.24 * 280) / 0.36;
const track = P.track(N, FPS, (i, t) => ({
	pose: {
		lengths: { upper: 0.3, lower: 0.24 },
		body: { lean: 6 * Math.sin(t * 3) },
		arms: {
			l: { upper: P.dir(-30, 8), lower: P.dir(-110 + 10 * Math.sin(t * 4), i % 2 ? 45 : 5) },
			r: { upper: P.dir(35, -6), lower: P.dir(100, -8) },
		},
	},
	opts: {},
}));
const FW = 64;
const FH = 64;
const sheet = png(FW * N, FH, () => [200, 200, 200, 0xff]);
const CLIP = {
	id: 'c1',
	name: 'take',
	assetKey: 'p/sheets/a.json',
	frames: Array.from({ length: N }, (_, i) => `f${i}`),
	fps: FPS,
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const posts = [];
const other = [];
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.wasm': 'application/wasm',
	'.task': 'application/octet-stream',
	'.png': 'image/png',
	'.json': 'application/json',
};
const body = (req) =>
	new Promise((ok) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => ok(s ? JSON.parse(s) : null));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, b) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(b);
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
		if (p === '/api/rigger/template' && req.method === 'GET')
			return json({ template: T.rigTemplateFromSidecar(RIG.sidecar) });
		if (p === '/api/rigger/template' && req.method === 'POST') {
			// As the route does: the SAVED rig's limb lengths into template.json, and its template back.
			const b = await body(req);
			posts.push(['template', b]);
			const fit = T.mergeRigLengths(HALF_BODY, null, RIG.rig.bones);
			RIG.sidecar = JSON.stringify(fit ? { ...JSON.parse(REF), fit } : JSON.parse(REF));
			return json({ ok: true, changed: true, template: T.rigTemplateFromSidecar(RIG.sidecar) });
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: '"e0"' });
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const b = await body(req);
			posts.push(['save', b]);
			RIG.rig = b.skeleton;
			return json({ ok: true, saved: true, key: 'k', etag: '"e1"', backupId: null, count: 1 });
		}
		if (p === '/api/editor/flipbooks') return json({ clips: [CLIP] });
		if (p === '/api/editor/regions')
			return json({
				assetKey: 'p/sheets/a.json',
				pageKey: 'p/sheets/a.png',
				pageVersion: 'v1',
				pageWidth: FW * N,
				pageHeight: FH,
				regions: CLIP.frames.map((name, i) => ({ name, x: i * FW, y: 0, w: FW, h: FH })),
			});
		if (p === '/api/editor/asset') return send(200, 'image/png', sheet);
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) {
			if (req.method !== 'GET') other.push(req.method + ' ' + p);
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
	name: 'capture-fit',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--mute-audio'],
});
const { evaluate, waitFor, send, pageLog } = browser;
const shotAt = process.argv.indexOf('--shot');
const SHOT = shotAt > 0 ? process.argv[shotAt + 1] : null;

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
const button = (text) =>
	`[...document.querySelectorAll("#faceList button")].find((b) => b.textContent.includes(${q(text)}))`;
/** The open rig's lengths and stretch, and the template the page drives it with. */
const state = `(() => {
	const bone = (n) => rawDoc.bones.find((b) => b.name === n);
	const len = (n) => Math.hypot(bone(n).x || 0, bone(n).y || 0);
	const at = (n) => { const b = skeleton.findBone(n); return [b.worldX, b.worldY]; };
	skeleton.setToSetupPose(); updateWorld();
	const hand = at("hand_l"), ik = at("hand_ik_l");
	const tb = (n) => rigTemplate.bones.find((b) => b.name === n);
	const drive = rigTemplate.channels.find((c) => c.id === "fore_lower_arm_l").drives.find((d) => d.bone === "hand_l" && d.prop === "y");
	return {
		upper: len("lower_arm_l"), fore: len("hand_r"),
		image: bone("upper_arm_l_image").scaleY || 1,
		ikOnWrist: Math.hypot(hand[0] - ik[0], hand[1] - ik[1]),
		tplFore: Math.abs(tb("hand_l").y), per: drive.per,
	};
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
		'[...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "half").click(); true',
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
		`setCurAnim("take"); animTime = 0; playing = false; renderFacePanel(); ${button('Motion')}.click(); true`,
	);
	await waitFor(
		'!!document.querySelector("#faceList .faceMotion select") && projectClips !== null',
		10000,
	);
	if (!(await evaluate('ensureRiggerMotion()'))) throw new Error('the motion bundle did not load');
	await evaluate(`(() => {
		const track = ${q(track)};
		window.__tracked = 0;
		RiggerMotion.track = async (kinds, src) => { window.__tracked++; for await (const f of src.frames) void f; return track; };
		const sel = document.querySelector("#faceList .faceMotion select");
		sel.value = "clip:c1"; sel.dispatchEvent(new Event("change"));
		return true;
	})()`);

	const btn = await evaluate(`(() => {
		const b = ${button('Fit rig to the capture')}, go = ${button('Key at playhead')};
		return b && { text: b.textContent, tip: b.title, afterKey: !!go && go.nextElementSibling === b };
	})()`);
	ok(
		'the Motion row has ⤢ Fit rig to the capture after 🎥 Key at playhead, its description a tooltip',
		!!btn &&
			btn.text === '⤢ Fit rig to the capture' &&
			btn.afterKey &&
			/art stretches/.test(btn.tip) &&
			/One undo step/.test(btn.tip),
		q(btn),
	);
	const before = await evaluate(state);

	// An import first: its capture is kept, so the fit tracks nothing again.
	await evaluate(`${button('Key at playhead')}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 30000);
	await evaluate(`faceMotionReport = null; ${button('Fit rig to the capture')}.click(); true`);
	await waitFor('(!!faceMotionReport && !faceMotionBusy) || window.__alerts.length > 0', 30000);
	const fitted = await evaluate(state);
	const report = await evaluate('faceMotionReport');
	if (SHOT) {
		const shot = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
	}
	ok(
		'after an import, ⤢ tracks nothing again',
		(await evaluate('window.__tracked')) === 1,
		await evaluate('window.__tracked'),
	);
	ok(
		'each limb takes the performer’s length (233.3 and 186.7), the art stretched with it, the hand control on the wrist',
		near(before.upper, 190, 1e-6) &&
			near(fitted.upper, UPPER, 0.5) &&
			near(fitted.fore, LOWER, 0.5) &&
			near(fitted.image, fitted.upper / 190, 1e-3) &&
			fitted.ikOnWrist < 1e-3,
		q({ before, fitted }),
	);
	ok(
		'the report says each length old → new',
		Array.isArray(report) &&
			/^⤢ Fitted the rig to the capture: 4 limb lengths/.test(report[0]) &&
			report.some((l) => /^Left upper arm: 190\.0 → 233\./.test(l)),
		q(report),
	);
	ok(
		'the template the page drives the rig with takes the lengths (the solve’s bones, a forearm’s shortening)',
		near(fitted.tplFore, fitted.fore, 1e-3) &&
			near(fitted.per / before.per, fitted.fore / 170, 1e-4),
		q(fitted),
	);
	await evaluate('document.getElementById("undoBtn").click(); true');
	await new Promise((r) => setTimeout(r, 300));
	const undone = await evaluate(state);
	await evaluate('document.getElementById("redoBtn").click(); true');
	await new Promise((r) => setTimeout(r, 300));
	const redone = await evaluate(state);
	ok(
		'one undo takes the fit back, the template with it; a redo fits it again',
		near(undone.upper, 190, 1e-6) &&
			near(undone.tplFore, 170, 1e-6) &&
			undone.image === 1 &&
			near(redone.upper, fitted.upper, 1e-6) &&
			near(redone.tplFore, fitted.fore, 1e-3),
		q({ undone, redone }),
	);

	await evaluate('document.getElementById("saveBtn").click(); true');
	await waitFor(
		'document.getElementById("saveBtn").textContent === "✓ saved" || window.__alerts.length > 0',
		15000,
	);
	const kinds = posts.map(([k]) => k);
	const tpl = posts.find(([k]) => k === 'template')?.[1];
	const after = await evaluate(state);
	ok(
		'💾 Save posts the rig, then asks for its lengths in template.json; the page takes the template answered',
		q(kinds) === q(['save', 'template']) &&
			tpl &&
			tpl.dir === b64('half') &&
			tpl.stem === 'half' &&
			tpl.projectKey === 'p' &&
			near(after.tplFore, fitted.fore, 1e-3) &&
			JSON.parse(RIG.sidecar).fit?.bones?.hand_l !== undefined,
		q({ kinds, tpl, sidecar: RIG.sidecar }),
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok('nothing else was sent', other.length === 0, q(other));
	ok(
		'no alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
	);
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — capture fit ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
