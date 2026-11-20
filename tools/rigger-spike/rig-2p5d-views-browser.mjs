// Browser check for drawings by angle (2.5D P5, docs/design/rig-2p5d.md §9), on the SHIPPED view.html
// and the committed vendor/rigger-2p5d.js in a real Chromium against a fake launcher API, with a real
// `half-body` rig built by the server's `templateRig` from art for every part. Checked:
//  - no views panel on a 2D rig; 🧊 Make 3D offers a full turnaround because the art has back
//    drawings; made 3D (side), each hand moves onto an image bone of its own, appended last, the
//    torso, head and hands get the drawings their art has, and every slot draws exactly where it did;
//  - the torso's panel lists the turnaround's angles with their drawings; its description is the
//    header's tooltip;
//  - turning the view (P3's slider) 45° either way shows the two ¾ torsos, 90° the side ones on the
//    same sides, each square to the viewer, and 0° the front;
//  - a drawing cleared in the panel: its row says what shows instead, the turned view shows the front
//    there turning as a card, one undo puts it back; the hold is set from the panel;
//  - a slot whose bone carries more is told so; ＋ hung from the chest puts it on an image bone that
//    follows the clavicle, drawn exactly where it was;
//  - 💾 Save sends the image bones in the .irig and the views and follower in the 3D data;
//  - the page throws nothing, shows no alert, sends nothing else.
//   node tools/rigger-spike/rig-2p5d-views-browser.mjs [--shot <file.png>]
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

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'rig-2p5d-views-browser-')), 'templates.mjs');
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
const seen_ = { saves: [], other: [] };
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
				etag: stored ? `e${seen_.saves.length}` : null,
				rig3d: stored3d ? { etag: `r${seen_.saves.length}`, doc: stored3d } : null,
			});
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const b = await body();
			seen_.saves.push(b);
			stored = b.skeleton;
			if (b.rig3d) stored3d = b.rig3d;
			const n = seen_.saves.length;
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
			if (req.method !== 'GET') seen_.other.push(req.method + ' ' + p);
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
	name: 'rig-2p5d-views',
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
/** The views panel's row selects, in order: [angle, label, value, blank option's text]. */
const rows = () =>
	evaluate(
		`[...document.querySelectorAll("#viewsPanel select[data-angle]")].map((s) => [Number(s.dataset.angle), s.parentElement.querySelector("span").textContent, s.value, s.options[0].textContent])`,
	);
/** What the turned view draws: the drawing chosen for `slot`, and how square its bone is drawn. */
const viewed = (slot, bone) =>
	evaluate(`(() => { const r = stage3d.res, b = skeleton.findBone(${q(bone)});
		const s = b.a * b.a + b.b * b.b + b.c * b.c + b.d * b.d, det = b.a * b.d - b.b * b.c, disc = Math.sqrt(Math.max(0, s * s - 4 * det * det));
		return { shown: r && r.pose ? r.pose.attachments[${q(slot)}] || null : null, square: Math.sqrt((s - disc) / 2) / Math.sqrt((s + disc) / 2), problems: r && r.problems || null }; })()`);
const turnTo = async (deg) => {
	await evaluate(`setViewTurn(${deg}); true`);
	await frames(4);
};
/** Every slot's drawn vertices, as engine-rig computes them. */
const vertices = () =>
	evaluate(`(() => { skeleton.updateWorldTransform(RIG.Physics.update); const out = {};
		for (const s of skeleton.slots){ const a = s.getAttachment(); if (!a) continue; const v = [];
			if (a.worldVerticesLength !== undefined) a.computeWorldVertices(s, 0, a.worldVerticesLength, v, 0, 2);
			else if (a.computeWorldVertices) a.computeWorldVertices(s, v, 0, 2);
			out[s.data.name] = v.map((n) => Math.round(n * 1000) / 1000); }
		return out; })()`);

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
	await evaluate('selectSlot("torso"); true');
	ok(
		'a 2D rig shows no drawings by angle',
		!(await evaluate('!!document.getElementById("viewsPanel")')),
	);

	// 1. Make 3D: a full turnaround is offered (the art has back drawings), and image bones are made.
	await waitFor(
		'[...document.getElementById("rig3dSel").options].some((o) => o.value === "full")',
		15000,
	);
	ok(
		'🧊 Make 3D offers side and full: the art has back drawings',
		q(await evaluate('[...document.getElementById("rig3dSel").options].map((o) => o.value)')) ===
			q(['', 'side', 'full']),
	);
	const before = await vertices();
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc && !!window.Rigger2p5d', 15000);
	await frames();
	const made = await evaluate(`({
		bones: rawDoc.bones.filter((b) => /_image$/.test(b.name) && /^hand_/.test(b.name)).map((b) => b.name + "<" + b.parent),
		last: rawDoc.bones.slice(-2).map((b) => b.name),
		slot: rawDoc.slots.find((s) => s.name === "hand_l").bone,
		views: Object.fromEntries(Object.entries(rig3d.doc.views || {}).map(([k, v]) => [k, v.drawings.length])),
	})`);
	ok(
		'made 3D: each hand moves onto an image bone of its own (it carries the fingers), appended last',
		q(made.bones) === q(['hand_l_image<hand_l', 'hand_r_image<hand_r']) &&
			q(made.last) === q(['hand_l_image', 'hand_r_image']) &&
			made.slot === 'hand_l_image',
		q(made),
	);
	ok(
		'…with the drawings its art has: front, ¾ and side for the torso, head and hands',
		q(made.views) === q({ torso: 5, head: 5, hand_l: 5, hand_r: 5 }),
		q(made.views),
	);
	const after = await vertices();
	const moved = Object.keys(before).filter((k) => q(before[k]) !== q(after[k]));
	ok('…and every slot draws exactly where it did', moved.length === 0, moved.join(', '));

	// 2. The views panel on the torso.
	await evaluate('selectSlot("torso"); true');
	const r0 = await rows();
	ok(
		'the torso’s panel lists its turnaround’s angles with their drawings',
		q(r0.map((r) => [r[0], r[1], r[2]])) ===
			q([
				[0, 'front', 'torso'],
				[-45, '¾ right', 'torso_3q_r'],
				[45, '¾ left', 'torso_3q_l'],
				[-90, 'side right', 'torso_side_r'],
				[90, 'side left', 'torso_side_l'],
			]),
		q(r0),
	);
	ok(
		'its section header is a tooltip, the body controls',
		await evaluate(
			'(() => { const s = document.querySelector("#viewsPanel > summary"); return s.title.length > 80 && !document.querySelector("#viewsPanel p"); })()',
		),
	);

	// 3. Turning the view shows each drawing, square to the viewer.
	const seen = {};
	for (const deg of [45, -45, 90, -90]) {
		await turnTo(deg);
		seen[deg] = await viewed('torso', 'torso_image');
	}
	await turnTo(0);
	const front = await evaluate('skeleton.findSlot("torso").getAttachment().name');
	const side = (n) => (n || '').slice(-1);
	ok(
		'turning the view 45° either way shows the two ¾ torsos, 90° the side ones on the same sides',
		/_3q_[lr]$/.test(seen[45].shown) &&
			/_3q_[lr]$/.test(seen[-45].shown) &&
			side(seen[45].shown) !== side(seen[-45].shown) &&
			seen[90].shown === `torso_side_${side(seen[45].shown)}` &&
			seen[-90].shown === `torso_side_${side(seen[-45].shown)}`,
		q(seen),
	);
	ok(
		'…each drawn square to the viewer',
		Object.values(seen).every((v) => v.square > 0.98),
		q(Object.values(seen).map((v) => v.square.toFixed(3))),
	);
	ok('0° shows the front again', front === 'torso', front);
	const shot = process.argv.includes('--shot')
		? process.argv[process.argv.indexOf('--shot') + 1]
		: null;
	if (shot) {
		await turnTo(45);
		await evaluate(
			'selectSlot("torso"); document.getElementById("viewsPanel").scrollIntoView(); true',
		);
		await frames(4);
		const { data } = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(shot, Buffer.from(data, 'base64'));
		await turnTo(0);
	}

	// 4. A missing drawing falls back toward the front.
	const quarter = seen[45].shown;
	const angle = r0.find((r) => r[2] === quarter)[0];
	await evaluate(
		`(() => { const s = document.querySelector('#viewsPanel select[data-angle="${angle}"]'); s.value = ""; s.dispatchEvent(new Event("change")); return true; })()`,
	);
	await frames();
	const r1 = await rows();
	const blank = r1.find((r) => r[0] === angle);
	ok(
		'a drawing cleared in the panel: its row shows what it falls back to',
		blank[2] === '' && blank[3] === '— shows torso',
		q(blank),
	);
	await turnTo(45);
	const fell = await viewed('torso', 'torso_image');
	ok(
		'…and the turned view shows the front there, turning as a card',
		fell.shown === 'torso' && Math.abs(fell.square - Math.cos(Math.PI / 4)) < 0.03,
		q(fell),
	);
	await evaluate('rigUndo(); true');
	await frames(4);
	ok(
		'one undo puts the drawing back',
		(await evaluate(
			`rig3d.doc.views.torso.drawings.some((d) => d.attachment === ${q(quarter)})`,
		)) && (await viewed('torso', 'torso_image')).shown === quarter,
	);
	await turnTo(0);
	await evaluate('selectSlot("torso"); true');
	await evaluate(
		'(() => { const i = document.querySelector(\'#viewsPanel input[data-field="hold"]\'); i.value = "0.25"; i.dispatchEvent(new Event("change")); return true; })()',
	);
	ok('the hold is set from the panel', (await evaluate('rig3d.doc.views.torso.hold')) === 0.25);

	// 5. An image bone hung from a steadier bone, following the slot's: drawn where it was.
	await evaluate('selectSlot("shoulder_l"); true');
	const hosts = await evaluate(
		'[...document.querySelectorAll("#viewsPanel select:not([data-angle])")].map((s) => [...s.options].map((o) => o.value))[0] || null',
	);
	ok(
		'a slot whose bone carries more is told so, with where an image bone may hang',
		hosts &&
			hosts[0] === 'clavicle_l' &&
			hosts.includes('chest') &&
			(await evaluate(
				'document.querySelector("#viewsPanel").textContent.includes("also carries upper_arm_l")',
			)),
		q(hosts),
	);
	const arm0 = (await vertices()).shoulder_l;
	await evaluate(`(() => {
		const s = [...document.querySelectorAll("#viewsPanel select:not([data-angle])")][0];
		s.value = "chest"; s.dispatchEvent(new Event("change"));
		s.parentElement.querySelector("button.ctlIcon").click(); return true; })()`);
	await frames();
	const img = await evaluate(`({
		bone: rawDoc.bones.find((b) => b.name === "shoulder_l_image"),
		slot: rawDoc.slots.find((s) => s.name === "shoulder_l").bone,
		follow: rig3d.doc.bones.shoulder_l_image,
		note: document.getElementById("viewsPanel").textContent,
	})`);
	ok(
		'＋ puts it on its own image bone, hung from the chest, following the clavicle',
		img.bone &&
			img.bone.parent === 'chest' &&
			img.slot === 'shoulder_l_image' &&
			img.follow &&
			img.follow.follow === 'clavicle_l' &&
			img.note.includes('it moves only in 3D clips'),
		q(img),
	);
	const arm1 = (await vertices()).shoulder_l;
	ok(
		'…drawn exactly where it was',
		arm1 && arm0.every((v, i) => Math.abs(v - arm1[i]) < 1e-2),
		q({ arm0, arm1 }),
	);

	// 6. Saved with the rig: the image bones in the .irig, the views in its 3D data.
	const saves = seen_.saves.length;
	await evaluate('document.getElementById("saveBtn").click(); true');
	for (let i = 0; i < 100 && seen_.saves.length === saves; i++)
		await new Promise((r) => setTimeout(r, 100));
	const last = seen_.saves[seen_.saves.length - 1];
	ok(
		'💾 Save sends the image bones and the views',
		last &&
			last.skeleton.bones.some((b) => b.name === 'hand_l_image') &&
			last.rig3d &&
			last.rig3d.views.torso.hold === 0.25 &&
			last.rig3d.bones.shoulder_l_image.follow === 'clavicle_l',
		last ? q(Object.keys(last.rig3d || {})) : 'no save',
	);

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok(
		'no alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
	);
	ok('nothing else was sent to the server', seen_.other.length === 0, q(seen_.other));
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — drawings by angle ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
