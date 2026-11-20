// Browser gate for the 3D turn in the graph editor and the transitions card (2.5D P3b, part two;
// docs/design/rig-2p5d.md §9), on the SHIPPED view.html and the committed vendor/rigger-2p5d.js in a
// real Chromium against a fake launcher API, with a real `half-body` rig built by `templateRig`.
// Checked:
//  - the graph draws a 3D bone's turn as rotation, tilt and twist curves read from its quaternions,
//    the slerp between keys (not a line), a turn past 180° as one curve; the legend offers them for a
//    3D bone only;
//  - dragging the tilt point with the mouse rewrites that key's quaternion (its rotation, twist and
//    time kept), bakes the clip again (the arm drawn cos 60° long) as one undo step, and the point
//    stays selected; a key's tilt and twist moved together both move; Alt-dragging the twist point
//    copies the whole key; right-click › Ease In eases the turn over the slerp's progress;
//  - a 3D bone's depth is drawn, eased and given tangents as one value in the 3D data, and a depth
//    point dragged past the next keeps the keys in time order;
//  - with two 3D clips the ⇄ Transitions card (description a tooltip) bakes a transition in the page
//    (＋, one undo step), bakes it again when its length changes and when it is opened (or Animate
//    opens on it) after a clip it joins changed, refuses a length of 0 or a start before 0 and shows
//    the stored value, 🗑 removes it and its clip, undo brings both back, and 💾 sends it;
//  - the old ⇄ Bake transition prompt is gone; the page throws nothing and shows no alert.
//   node tools/rigger-spike/rig-3d-curves-browser.mjs
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
const out = join(mkdtempSync(join(tmpdir(), 'rig-3d-curves-')), 'templates.mjs');
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
rig.animations = {
	take: {
		bones: {
			hand_l: {
				rotate: [
					{ time: 0, value: 0 },
					{ time: 1, value: 10 },
				],
			},
		},
	},
};
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
	name: 'rig-3d-curves',
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
const settled = () =>
	waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		30000,
	);
const mouse = (type, pt, modifiers = 0) =>
	send('Input.dispatchMouseEvent', {
		type,
		x: pt.x,
		y: pt.y,
		button: 'left',
		clickCount: 1,
		modifiers,
	});
const pickBone = (n) =>
	evaluate(
		`(() => { selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(n)})); renderBoneDetail(); return true; })()`,
	);
/** Type `value` into the bone panel's field `label` and commit it (Enter / leaving it). */
const typeField = (label, value) =>
	evaluate(`(() => {
		const row = [...document.querySelectorAll("#boneDetail label")].find((l) => l.querySelector("span") && l.querySelector("span").textContent === ${q(label)});
		const inp = row && row.querySelector("input"); if (!inp) return false;
		inp.value = ${q(String(value))}; inp.dispatchEvent(new Event("change")); return true;
	})()`);
/** The upper arm's turn keys in the take, read in its own terms. */
const armKeys = () =>
	evaluate(`(() => { const k = rig3d.doc.clips.take.bones.upper_arm_l;
		return (k.orient || []).map((x) => [x.time, Rigger2p5d.anglesAlong(x.value, boneAlong("upper_arm_l"))]); })()`);
/** The page coordinates of point (t, v) on the open graph. */
const graphAt = (t, v) =>
	evaluate(`(() => { const m = graphMap, r = m.svg.getBoundingClientRect();
		return { x: r.left + m.gutter + ${t} * m.pps, y: r.top + m.top + (m.maxV - ${v}) / (m.maxV - m.minV) * m.areaH }; })()`);
const drag = async (from, to, modifiers = 0) => {
	await mouse('mouseMoved', from, modifiers);
	await mouse('mousePressed', from, modifiers);
	await mouse('mouseMoved', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, modifiers);
	await mouse('mouseMoved', to, modifiers);
	await mouse('mouseReleased', to, modifiers);
};
const until = async (test, ms) => {
	for (const end = Date.now() + ms; Date.now() < end;) {
		if (test()) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
};

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
		'(() => { document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); return true; })()',
	);
	await waitFor('!!rawDoc && animMode', 30000);
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc && !!window.Rigger2p5d', 15000);

	// 1. A 3D clip: the arm tilted 40° at 0 s, and tilted 70° and twisted 60° at 0.5 s.
	await evaluate('setCurAnim("take"); animTime = 0; playing = false; convertClip3d("take"); true');
	await waitFor('!!clip3d("take")', 15000);
	await settled();
	ok(
		'the ⇄ Bake transition prompt is gone',
		!(await evaluate(
			'[...document.querySelectorAll("button")].some((b) => /Bake transition/.test(b.textContent))',
		)),
	);
	await pickBone('upper_arm_l');
	await typeField('tilt', 40);
	await settled();
	await evaluate('animTime = 0.5; renderBoneDetail(); true');
	await typeField('tilt', 70);
	await settled();
	await typeField('twist', 60);
	await settled();
	const keys0 = await armKeys();
	ok(
		'the arm is keyed in 3D at 0 s and 0.5 s',
		keys0.length === 2 &&
			Math.abs(keys0[0][1].tilt - 40) < 1e-6 &&
			Math.abs(keys0[1][1].tilt - 70) < 1e-6 &&
			Math.abs(keys0[1][1].twist - 60) < 1e-6,
		q(keys0),
	);

	// 2. The graph: the 3D turn as angle curves.
	await evaluate('tlView = "graph"; renderTimeline(); true');
	const graph = await evaluate(`(() => {
		const labels = graphMap.curves.map((c) => c.label);
		const tilt = graphMap.curves.find((c) => c.label === "tilt");
		const node = rig3d.doc.clips.take.bones.upper_arm_l, along = boneAlong("upper_arm_l");
		const truth = Rigger2p5d.anglesAlong(Rigger2p5d.boneKeysAt(node, 0.25).orient, along, Rigger2p5d.anglesAlong(node.orient[0].value, along)).tilt;
		return { labels, keys: tilt && tilt.keys.map((k) => [k.time, k.tilt]), mid: tilt && graphValueAt(tilt, 0.25), truth,
			legend: [...document.querySelectorAll("#timeline span")].map((x) => x.textContent) };
	})()`);
	ok(
		'the graph draws a 3D bone’s turn as rotation, tilt and twist curves read from its quaternions',
		['rotation 3D', 'tilt', 'twist'].every((l) => graph.labels.includes(l)) &&
			q((graph.keys ?? []).map(([t, v]) => [t, Math.round(v)])) ===
				q([
					[0, 40],
					[0.5, 70],
				]),
		q(graph),
	);
	ok(
		`…between keys the curve is the slerp read as angles, not a line between them (tilt ${graph.mid?.toFixed(2)} at 0.25 s)`,
		Math.abs(graph.mid - graph.truth) < 1e-9 && Math.abs(graph.mid - 55) > 0.2,
		q(graph),
	);
	ok(
		'…and the legend offers them for this bone',
		graph.legend.includes('tilt') && graph.legend.includes('twist'),
		q(graph.legend),
	);
	await pickBone('hand_l');
	await evaluate('renderTimeline(); true');
	ok(
		'a 2D bone’s legend has no 3D curves',
		!(await evaluate(
			'[...document.querySelectorAll("#timeline span")].some((x) => x.textContent === "tilt")',
		)),
	);
	await pickBone('upper_arm_l');
	await evaluate('renderTimeline(); true');
	const undoBefore = await evaluate('historyFlush(), rigHist.past.length');
	// a point is placed to the pixel: the graph's degrees per pixel
	const perPx = await evaluate('(graphMap.maxV - graphMap.minV) / graphMap.areaH * 1.01');
	// Drag the tilt point at 0.5 s from 70° to 60° with the mouse.
	await drag(await graphAt(0.5, 70), await graphAt(0.5, 60));
	await settled();
	const keys1 = await armKeys();
	ok(
		'dragging the tilt point to 60° rewrites that key’s quaternion: tilt 60, its rotation, twist and time kept',
		keys1.length === 2 &&
			Math.abs(keys1[1][1].tilt - 60) < perPx &&
			Math.abs(keys1[1][1].rotate - keys0[1][1].rotate) < 1e-6 &&
			Math.abs(keys1[1][1].twist - keys0[1][1].twist) < 1e-6 &&
			Math.abs(keys1[1][0] - 0.5) < 0.02 &&
			Math.abs(keys1[0][1].tilt - 40) < 1e-6,
		q({ keys0, keys1 }),
	);
	ok(
		'…the point stays selected after the graph is drawn again',
		await evaluate(
			'graphSel.length === 1 && graphSel[0].keyObj === graphMap.curves.find((c) => c.label === "tilt").keys[1]',
		),
	);
	const replay = await evaluate(`(() => {
		const len = () => { const a = skeleton.findBone("upper_arm_l"), c = skeleton.findBone("lower_arm_l"); return Math.hypot(c.worldX - a.worldX, c.worldY - a.worldY); };
		skeleton.setToSetupPose(); updateWorld(); const flat = len();
		skeleton.setToSetupPose(); poseAtTime("take", 0.5); updateWorld(); const turned = len();
		return { ratio: turned / flat, fresh: bake3dSig("take") === bake3d.sig.take };
	})()`);
	ok(
		'…and the clip is baked again: played at 0.5 s the arm is drawn cos 60° of its length',
		replay.fresh && Math.abs(replay.ratio - Math.cos((60 * Math.PI) / 180)) < 0.02,
		q(replay),
	);
	ok(
		'…as one undo step',
		(await evaluate('historyFlush(), rigHist.past.length')) === undoBefore + 1,
		String(undoBefore) + ' → ' + (await evaluate('rigHist.past.length')),
	);
	// The key's tilt and twist points selected together, dragged 10° down with the mouse.
	await evaluate(`(() => { const of = (l) => graphMap.curves.find((c) => c.label === l);
		graphSel = ["tilt", "twist"].map((l) => ({ keyObj: of(l).keys[1], ch: "orient", field: l, vi: 0 })); renderTimeline(); return true; })()`);
	const both0 = (await armKeys())[1][1];
	// (two points at one time sit under the selection box's handles, so the move is started as a
	// press on the tilt point starts it, and the page's own mousemove / mouseup handlers carry it)
	const bFrom = await graphAt(0.5, both0.tilt);
	const bTo = await graphAt(0.5, both0.tilt - 10);
	await evaluate(`(() => { startGraphMove({ clientX: ${bFrom.x}, clientY: ${bFrom.y}, altKey: false }, graphSel[0].keyObj);
		window.dispatchEvent(new MouseEvent("mousemove", { clientX: ${bTo.x}, clientY: ${bTo.y} }));
		window.dispatchEvent(new MouseEvent("mouseup", { clientX: ${bTo.x}, clientY: ${bTo.y} })); return true; })()`);
	await settled();
	const both1 = (await armKeys())[1][1];
	ok(
		'a key’s tilt and twist points dragged together both move (10° down), its rotation kept',
		Math.abs(both1.tilt - (both0.tilt - 10)) < perPx &&
			Math.abs(both1.twist - (both0.twist - 10)) < perPx &&
			Math.abs(both1.rotate - both0.rotate) < 1e-6,
		q({ both0, both1 }),
	);
	const keys1b = await armKeys();
	await evaluate('graphSel = []; renderTimeline(); true');
	// Alt-drag the twist point at 0.5 s to 0.75 s: a copy of the whole key, the twist moved with it.
	await evaluate('renderTimeline(); true');
	const twistAt = (
		await evaluate('graphMap.curves.find((c) => c.label === "twist").keys.map((k) => k.twist)')
	)[1];
	await drag(await graphAt(0.5, twistAt), await graphAt(0.75, twistAt - 20), 1);
	await settled();
	const keys2 = await armKeys();
	ok(
		'Alt-dragging the twist point copies the key: the copy at 0.75 s keeps the tilt, its twist 20° less; the original stays',
		keys2.length === 3 &&
			Math.abs(keys2[1][1].twist - keys1b[1][1].twist) < 1e-6 &&
			Math.abs(keys2[2][0] - 0.75) < 0.02 &&
			Math.abs(keys2[2][1].tilt - keys1b[1][1].tilt) < 1e-3 &&
			Math.abs(keys2[2][1].twist - (keys1b[1][1].twist - 20)) < perPx,
		q({ keys1b, keys2 }),
	);
	// Right-click the tilt point at 0 s: its easing is the key's, over the slerp's progress.
	const at0 = await graphAt(0, 40);
	for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
		await send('Input.dispatchMouseEvent', {
			type,
			x: at0.x,
			y: at0.y,
			button: 'right',
			clickCount: 1,
		});
	const menu = await evaluate(
		'(() => { const b = [...document.querySelectorAll("#curveMenu button")].find((x) => /Ease In$/.test(x.textContent)); if (!b) return false; b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return true; })()',
	);
	await settled();
	const eased = await evaluate('rig3d.doc.clips.take.bones.upper_arm_l.orient[0].curve');
	ok(
		'right-click › Ease In eases the key’s turn over the slerp’s progress (0 to 1)',
		menu && Array.isArray(eased) && eased.length === 4 && eased[1] === 0 && eased[3] === 1,
		q({ menu, eased }),
	);
	// Depth keys, one dragged past the other: the 3D data stays in time order.
	await evaluate('animTime = 0; renderBoneDetail(); true');
	await typeField('depth', 10);
	await settled();
	await evaluate('animTime = 0.5; renderBoneDetail(); true');
	await typeField('depth', 30);
	await settled();
	await evaluate('renderTimeline(); true');
	const depthKeys = await evaluate(
		'(graphMap.curves.find((c) => c.label === "depth") || { keys: [] }).keys.map((k) => [k.time, k.value])',
	);
	const depthCurve =
		await evaluate(`(() => { const c = graphMap.curves.find((x) => x.label === "depth");
		return c ? { mid: graphValueAt(c, 0.25), tangents: linEquivCurve(c.keys[0], c.keys[1], "depth").length } : null; })()`);
	ok(
		'a 3D bone’s depth is drawn from its keys (20 between 10 and 30), its tangents one value’s',
		!!depthCurve && Math.abs(depthCurve.mid - 20) < 1e-6 && depthCurve.tangents === 4,
		q(depthCurve),
	);
	const menuAt = async (pt, label) => {
		for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
			await send('Input.dispatchMouseEvent', {
				type,
				x: pt.x,
				y: pt.y,
				button: 'right',
				clickCount: 1,
			});
		return evaluate(`(() => { const items = [...document.querySelectorAll("#curveMenu button")].map((b) => b.textContent);
			const b = [...document.querySelectorAll("#curveMenu button")].find((x) => x.textContent.replace("✓ ", "") === ${q(label)});
			if (b) b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return items; })()`);
	};
	await menuAt(await graphAt(depthKeys[0][0], depthKeys[0][1]), 'Ease In');
	await settled();
	const depthEased = await evaluate('rig3d.doc.clips.take.bones.upper_arm_l.depth[0].curve');
	const ticked = (await menuAt(await graphAt(depthKeys[0][0], depthKeys[0][1]), 'Ease In')).find(
		(t) => t.startsWith('✓'),
	);
	await settled();
	ok(
		'right-click › Ease In eases the depth key in the 3D data as one value, and the menu reads it back',
		Array.isArray(depthEased) &&
			depthEased.length === 4 &&
			Math.abs(depthEased[1] - 10) < 1e-6 &&
			Math.abs(depthEased[3] - 30) < 1e-6 &&
			ticked === '✓ Ease In-Out',
		q({ depthEased, ticked }),
	);
	if (depthKeys.length === 2)
		await drag(
			await graphAt(depthKeys[0][0], depthKeys[0][1]),
			await graphAt(0.8, depthKeys[0][1]),
		);
	await settled();
	const depthAfter = await evaluate(
		'rig3d.doc.clips.take.bones.upper_arm_l.depth.map((k) => k.time)',
	);
	ok(
		'a depth point dragged past the next keeps the 3D data in time order',
		depthKeys.length === 2 &&
			depthAfter.length === 2 &&
			depthAfter[0] === 0.5 &&
			depthAfter[1] > 0.7,
		q({ depthKeys, depthAfter }),
	);
	// A turn past 180°: the forearm turned 170° from its setup at 0 s and 200° at 0.5 s, tilted 10°.
	await pickBone('lower_arm_l');
	const setupTurn = await evaluate('skeletonData.findBone("lower_arm_l").rotation');
	await evaluate('animTime = 0; renderBoneDetail(); true');
	await typeField('tilt', 10);
	await settled();
	await typeField('rotation', setupTurn + 170);
	await settled();
	await evaluate('animTime = 0.5; renderBoneDetail(); true');
	await typeField('rotation', setupTurn + 200);
	await settled();
	await evaluate('renderTimeline(); true');
	const past180 = await evaluate(`(() => { const c = graphMap.curves.find((x) => x.label === "rotation 3D");
		return c ? { keys: c.keys.map((k) => k.rotate), mid: graphValueAt(c, 0.25) } : null; })()`);
	ok(
		'a turn past 180° stays one curve: its keys read 170° then 200°, the slerp between them 185°',
		!!past180 &&
			Math.abs(past180.keys[1] - past180.keys[0] - 30) < 0.01 &&
			Math.abs(past180.mid - (past180.keys[0] + 15)) < 1,
		q(past180),
	);
	await evaluate('tlView = "dope"; renderTimeline(); true');

	// 3. Transitions.
	await evaluate('newAnimation(); true');
	const second = await evaluate('curAnim');
	await evaluate(`convertClip3d(${q(second)}); true`);
	await waitFor(`!!clip3d(${q(second)})`, 15000);
	await settled();
	await pickBone('upper_arm_l');
	await evaluate('animTime = 0; renderBoneDetail(); true');
	await typeField('twist', 30);
	await settled();
	await evaluate('setCurAnim("take"); true');
	await settled();
	const panel =
		await evaluate(`(() => { const p = document.getElementById("trPanel"); if (!p) return null;
		const sels = [...p.querySelectorAll("select")];
		return { tip: p.querySelector("summary").title.length, options: sels.map((s) => [...s.options].map((o) => o.value)) }; })()`);
	ok(
		'with two 3D clips the Animations section has a ⇄ Transitions card (its description a tooltip) offering them',
		!!panel &&
			panel.tip > 80 &&
			panel.options.length === 2 &&
			panel.options.every((o) => o.includes('take') && o.includes(second)),
		q(panel),
	);
	const histBefore = await evaluate('historyFlush(), rigHist.past.length');
	await evaluate(`(() => { document.getElementById("trPanel").open = true;
		const s = [...document.querySelectorAll("#trPanel select")]; s[0].value = "take"; s[1].value = ${q(second)};
		const n = [...document.querySelectorAll("#trPanel .ctlLine input")].slice(-1)[0]; n.value = "0.3"; n.dispatchEvent(new Event("change"));
		[...document.querySelectorAll("#trPanel .ctlIcon")].find((b) => b.textContent === "＋").click(); return true; })()`);
	const name = `take_to_${second}`;
	const tr =
		await evaluate(`(() => ({ side: rig3d.doc.clips[${q(name)}], bones: Object.keys(((rawDoc.animations || {})[${q(name)}] || {}).bones || {}),
		dur: animDuration(${q(name)}), rows: [...document.querySelectorAll("#trPanel .ctlName")].map((x) => x.textContent), fresh: bake3dSig(${q(name)}) === bake3d.sig[${q(name)}], open: document.getElementById("trPanel").open }))()`);
	ok(
		'＋ bakes the transition in the page: declared in the 3D data, its clip baked into the rig, listed in the open card',
		!!tr.side &&
			tr.side.transition.duration === 0.3 &&
			tr.bones.includes('upper_arm_l') &&
			Math.abs(tr.dur - 0.3) < 0.01 &&
			tr.fresh &&
			tr.open &&
			tr.rows.includes(`take → ${second}`),
		q(tr),
	);
	ok(
		'…as one undo step',
		(await evaluate('historyFlush(), rigHist.past.length')) === histBefore + 1,
		String(histBefore),
	);
	await evaluate(`(() => { const r = [...document.querySelectorAll("#trPanel .ctlLine")].find((x) => x.querySelector(".ctlName") && x.querySelector(".ctlName").textContent === ${q(`take → ${second}`)});
		const inps = r.querySelectorAll("input"); inps[1].value = "0.5"; inps[1].dispatchEvent(new Event("change")); return true; })()`);
	const tr2 = await evaluate(
		`({ dur: rig3d.doc.clips[${q(name)}].transition.duration, clip: animDuration(${q(name)}) })`,
	);
	ok(
		'changing its length bakes it again (0.5 s)',
		tr2.dur === 0.5 && Math.abs(tr2.clip - 0.5) < 0.01,
		q(tr2),
	);
	const row = `[...document.querySelectorAll("#trPanel .ctlLine")].find((x) => x.querySelector(".ctlName") && x.querySelector(".ctlName").textContent === ${q(`take → ${second}`)}).querySelectorAll("input")[1]`;
	await evaluate(
		`(() => { const i = ${row}; i.value = "0"; i.dispatchEvent(new Event("change")); return true; })()`,
	);
	const refused = await evaluate(
		`({ err: document.getElementById("err").style.display === "block" ? document.getElementById("err").textContent : "", dur: rig3d.doc.clips[${q(name)}].transition.duration, shown: ${row}.value })`,
	);
	ok(
		'a length of 0 is refused, said why, and the row shows the stored length again',
		/more than 0 seconds/.test(refused.err) && refused.dur === 0.5 && refused.shown === '0.5',
		q(refused),
	);
	const atRow = row.replace('querySelectorAll("input")[1]', 'querySelectorAll("input")[0]');
	await evaluate(
		`(() => { const i = ${atRow}; i.value = "-1"; i.dispatchEvent(new Event("change")); return true; })()`,
	);
	const refusedAt = await evaluate(
		`({ err: document.getElementById("err").textContent, at: rig3d.doc.clips[${q(name)}].transition.at, shown: ${atRow}.value })`,
	);
	ok(
		'a start before 0 s is refused and the row shows the stored start (its end) again',
		/0 s or later/.test(refusedAt.err) && refusedAt.at === undefined && refusedAt.shown === '',
		q(refusedAt),
	);
	await evaluate('clearErr(); true');
	// A change to a clip it joins: opened, the transition bakes again.
	await evaluate(`(() => { setCurAnim(${q(second)}); return true; })()`);
	await settled();
	await pickBone('upper_arm_l');
	await evaluate('animTime = 0; renderBoneDetail(); true');
	await typeField('twist', 50);
	await settled();
	const staleBefore = await evaluate(`bake3dSig(${q(name)}) !== bake3d.sig[${q(name)}]`);
	await evaluate(`setCurAnim(${q(name)}); true`);
	await settled();
	ok(
		'a transition whose clip changed is baked again when it is opened',
		staleBefore && (await evaluate(`bake3dSig(${q(name)}) === bake3d.sig[${q(name)}]`)),
		String(staleBefore),
	);
	// …and when Animate opens on it: the clip changed again, the transition opened in Setup.
	await evaluate(`(() => { setCurAnim(${q(second)}); return true; })()`);
	await settled();
	await pickBone('upper_arm_l');
	await evaluate('animTime = 0; renderBoneDetail(); true');
	await typeField('twist', 60);
	await settled();
	await evaluate(`(() => { setMode("setup"); setCurAnim(${q(name)}); return true; })()`);
	const staleInSetup = await evaluate(`bake3dSig(${q(name)}) !== bake3d.sig[${q(name)}]`);
	await evaluate('setMode("animate"); true');
	await settled();
	ok(
		'…and when Animate opens on it',
		staleInSetup && (await evaluate(`bake3dSig(${q(name)}) === bake3d.sig[${q(name)}]`)),
		String(staleInSetup),
	);
	await evaluate(`removeTransition3d(${q(name)}); true`);
	const gone = await evaluate(
		`({ side: !!rig3d.doc.clips[${q(name)}], clip: !!(rawDoc.animations || {})[${q(name)}], cur: curAnim })`,
	);
	ok(
		'🗑 removes the transition and its clip',
		!gone.side && !gone.clip && gone.cur !== name,
		q(gone),
	);
	await evaluate('rigUndo(); true');
	ok(
		'…and undo brings both back, taken as baked',
		await evaluate(
			`!!rig3d.doc.clips[${q(name)}] && !!rawDoc.animations[${q(name)}] && bake3d.sig[${q(name)}] === bake3dSig(${q(name)})`,
		),
	);
	const saves = seen.saves.length;
	await evaluate('saveToR2(); true');
	await until(() => seen.saves.length > saves, 30000);
	const sent = seen.saves[seen.saves.length - 1];
	ok(
		'💾 sends the transition in the 3D data, and its clip',
		seen.saves.length > saves &&
			!!sent.rig3d?.clips?.[name] &&
			sent.rig3d.clips[name].transition.duration === 0.5 &&
			!!sent.skeleton.animations[name],
		q(sent && sent.rig3d && Object.keys(sent.rig3d.clips)),
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
console.log(
	`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — 3D angle curves and transitions ${pass}/${pass + fail}`,
);
process.exit(fail === 0 ? 0 : 1);
