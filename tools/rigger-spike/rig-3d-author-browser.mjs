// Browser gate for authoring a 3D clip (2.5D P3, docs/design/rig-2p5d.md §9), on the SHIPPED
// view.html and the committed vendor/rigger-2p5d.js in a real Chromium against a fake launcher API,
// with a real `half-body` rig built by the server's `templateRig` and a 2D clip keyed on it (its art
// as P4 shipped it — the torso's ¾ and side drawings, none of P5's head, hand or back ones). Checked:
//  - 🧊 in the Animations tools makes the rig 3D with its template's turnaround and parts at depth;
//  - 🧊 3D from this clip keeps the clip as it plays (it bakes back to itself within the tolerance);
//  - the bone panel shows rotation / tilt / twist / depth; a tilt typed in turns the upper arm in 3D
//    (its 2D turns become `orient` keys) and the baked clip shows it SHORT on screen (the third axis);
//    a flat bone keeps its 2D keys in the clip until a depth makes it 3D, when they move with it;
//  - the dopesheet lists the keys as authored (not the bake's), drops the draw-order row, retimes and
//    deletes a 3D key (each re-bakes), and one undo puts back the clip with its bake;
//  - an edit's bake runs off the page, in a worker: no loading overlay, the 🧊 bar's mark while it
//    runs, and it lands in the edit's undo step;
//  - the tolerance re-bakes; a rename carries the 3D keys; ⇲ Detach makes a plain 2D clip of the
//    bake, and undo makes it 3D again;
//  - 💾 sends the 3D data and asks the save to bake the clip over; 🧊 Turn 3D off sends `rig3d: null`;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/rig-3d-author-browser.mjs
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
const out = join(mkdtempSync(join(tmpdir(), 'rig-3d-author-')), 'templates.mjs');
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

// The rig: flat grey parts, packed in rows; a 1 s clip keyed in 2D (the arm swings, the hand turns,
// the body walks).
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
rig.animations = {
	take: {
		bones: {
			upper_arm_l: {
				rotate: [
					{ time: 0, value: 0 },
					{ time: 1, value: 30 },
				],
			},
			hand_l: {
				rotate: [
					{ time: 0, value: 0 },
					{ time: 1, value: 10 },
				],
			},
			root: {
				translate: [
					{ time: 0, x: 0, y: 0 },
					{ time: 1, x: 20, y: 0 },
				],
			},
		},
	},
};
const RIG = {
	rig,
	atlas: ['half.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...lines].join('\n'),
	template: rigTemplateFromSidecar(JSON.stringify({ id: 'half-body', version: HALF_BODY.version })),
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const seen = { saves: [], other: [] };
let stored = null;
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
				rig3dEtag: b.rig3d ? `r${n}` : b.rig3d === null ? null : undefined,
				rebaked: b.rig3d ? Object.keys(b.rig3d.clips ?? {}) : [],
				detached: b.rig3d === null ? ['take'] : [],
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
	name: 'rig-3d-author',
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
/** Let an edit's re-bake run and land. */
const settled = () =>
	waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		30000,
	);
/** Every bone's world position in clip "take" at `t`, as the page's engine-rig plays the rig. */
const posed = (t) => `(() => {
	rebuildFromRawDoc(null);
	const s = new RIG.Skeleton(skeletonData);
	const st = new RIG.AnimationState(new RIG.AnimationStateData(skeletonData));
	st.setAnimation(0, "take", false); st.update(${t}); st.apply(s);
	s.updateWorldTransform(RIG.Physics ? RIG.Physics.update : undefined);
	return Object.fromEntries(s.bones.map((b) => [b.data.name, [b.worldX, b.worldY]]));
})()`;
const armLength = (p) =>
	Math.hypot(p.lower_arm_l[0] - p.upper_arm_l[0], p.lower_arm_l[1] - p.upper_arm_l[1]);
const drift = (a, b, skip) =>
	Math.max(
		...Object.keys(a)
			.filter((n) => !skip.includes(n) && b[n])
			.map((n) => Math.hypot(a[n][0] - b[n][0], a[n][1] - b[n][1])),
	);
/** Type `value` into the bone panel's field `label` and commit it (Enter / leaving it). */
const typeField = (label, value) => `(() => {
	const row = [...document.querySelectorAll("#boneDetail label")].find((l) => l.querySelector("span") && l.querySelector("span").textContent === ${q(label)});
	if (!row) return false;
	const inp = row.querySelector("input"); inp.value = ${q(String(value))}; inp.dispatchEvent(new Event("change"));
	return true;
})()`;
const pick = (bone, t) =>
	evaluate(
		`(() => { animTime = ${t}; selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(bone)})); renderBoneDetail(); return true; })()`,
	);
const SHOWN_ERR =
	'(() => { const e = document.getElementById("err"); return e && e.style.display === "block" ? e.textContent : ""; })()';
const sideBones = () =>
	evaluate(
		'rig3d.doc && rig3d.doc.clips && rig3d.doc.clips.take ? rig3d.doc.clips.take.bones : null',
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
	await evaluate('setCurAnim("take"); animTime = 0; playing = false; true');

	// 1. 🧊 Make 3D.
	const sel = await evaluate(`(() => {
		const s = document.getElementById("rig3dSel");
		return s && { value: s.value, options: [...s.options].map((o) => o.value + "|" + o.textContent), tip: s.title.length > 60 };
	})()`);
	ok(
		'🧊 offers making the rig 3D with its template’s turnaround (tooltip)',
		!!sel &&
			sel.value === '' &&
			sel.options.length === 2 &&
			sel.options[1].startsWith('side|') &&
			sel.tip,
		q(sel),
	);
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc', 15000);
	const doc = await evaluate(
		'({ turnaround: rig3d.doc.turnaround, face: rig3d.doc.bones.face.depth, views: Object.keys(rig3d.doc.views || {}), row: (document.getElementById("clip3dRow") || {}).textContent })',
	);
	ok(
		'…it writes the 3D data from the template (side, parts at depth, the torso by angle), the clip still 2D',
		doc.turnaround === 'side' &&
			doc.face === 95 &&
			doc.views.includes('torso') &&
			/3D from this clip/.test(doc.row ?? ''),
		q(doc),
	);

	// 2. 🧊 3D from this clip.
	const before = {};
	for (const t of [0, 0.5, 1]) before[t] = await evaluate(posed(t));
	await evaluate(
		'(() => { [...document.querySelectorAll("#clip3dRow button")].find((b) => b.textContent.includes("3D from this clip")).click(); return true; })()',
	);
	await waitFor('!!clip3d("take")', 15000);
	await settled();
	let back = 0;
	for (const t of [0, 0.5, 1])
		back = Math.max(back, drift(before[t], await evaluate(posed(t)), ['torso_image']));
	ok(
		'🧊 3D from this clip: the clip bakes back to itself (no bone moves past the tolerance)',
		back < 0.45,
		`drift ${back.toFixed(3)}`,
	);
	ok(
		'…its 2D keys still the author’s',
		await evaluate(
			'rawDoc.animations.take.bones.upper_arm_l.rotate.length === 2 && !rig3d.doc.clips.take.bones.upper_arm_l',
		),
	);
	ok(
		'…and the clip settings say so, with ⇲ Detach',
		await evaluate(
			'/🧊 3D clip/.test(document.getElementById("clip3dRow").textContent) && [...document.querySelectorAll("#clip3dRow button")].some((b) => b.textContent.includes("Detach"))',
		),
	);

	// 3. A tilt typed into the bone panel.
	await pick('upper_arm_l', 0.5);
	const fields = await evaluate(
		'[...document.querySelectorAll("#boneDetail label span")].map((s) => s.textContent)',
	);
	ok(
		'the bone panel shows rotation, tilt, twist and depth in a 3D clip',
		['rotation', 'tilt', 'twist', 'depth', 'x', 'y'].every((f) => fields.includes(f)) &&
			!fields.includes('shearX'),
		q(fields),
	);
	const L0 = armLength(await evaluate(posed(0)));
	await evaluate(typeField('tilt', 60));
	await settled();
	const arm = await sideBones();
	const keyTimes =
		arm && arm.upper_arm_l && arm.upper_arm_l.orient
			? arm.upper_arm_l.orient.map((k) => k.time)
			: null;
	ok(
		'a tilt turns the arm in 3D: its 2D turns become orient keys, with the new one at the playhead',
		q(keyTimes) === q([0, 0.5, 1]) && !arm.upper_arm_l.rotate,
		q(arm && arm.upper_arm_l),
	);
	const at05 = armLength(await evaluate(posed(0.5)));
	ok(
		'…and the baked clip shows the upper arm at half its length at 60° (the third axis), whole at 0',
		Math.abs(at05 / L0 - 0.5) < 0.02 &&
			Math.abs(armLength(await evaluate(posed(0))) / L0 - 1) < 0.01,
		`${(at05 / L0).toFixed(4)}`,
	);
	ok(
		'…the arm’s keys in the clip are the bake’s; the hand, flat on the forearm, keeps its own 2D keys',
		await evaluate(
			'!!rawDoc.animations.take.bones.upper_arm_l.scale && rawDoc.animations.take.bones.hand_l.rotate.length === 2 && !rig3d.doc.clips.take.bones.hand_l',
		),
	);
	await pick('upper_arm_l', 0.5);
	const shown = await evaluate(`(() => {
		const v = (l) => parseFloat([...document.querySelectorAll("#boneDetail label")].find((r) => r.querySelector("span").textContent === l).querySelector("input").value);
		return { tilt: v("tilt"), rotation: v("rotation") - skeletonData.findBone("upper_arm_l").rotation };
	})()`);
	ok(
		'the panel reads the keys back: tilt 60°, rotation the 2D turn halfway (15°)',
		Math.abs(shown.tilt - 60) < 0.01 && Math.abs(shown.rotation - 15) < 0.01,
		q(shown),
	);

	// 4. The dopesheet.
	const rows = await evaluate(`(() => {
		tlSelOnly = false;
		const all = timelineTracks();
		const armRow = all.find((t) => t.kind === "bone" && t.name === "upper_arm_l");
		tlSelOnly = true;
		const mine = timelineTracks().filter((t) => t.kind === "bonech").map((t) => t.label);
		tlSelOnly = false;
		return { kinds: all.map((t) => t.kind), arm: armRow && trackKeyTimes(armRow), mine };
	})()`);
	ok(
		'the dopesheet lists the arm’s keys as authored (not the bake’s), as a 3D turn row, with no draw-order row',
		q(rows.arm) === q([0, 0.5, 1]) &&
			rows.mine.includes('3D turn') &&
			!rows.kinds.includes('draworder'),
		q(rows),
	);
	await evaluate('retimeTrackKey({ kind: "bone", name: "upper_arm_l" }, 0.5, 0.6); true');
	await settled();
	const retimed = await sideBones();
	ok(
		'retiming the key moves the 3D key and re-bakes: the arm is shortest at 0.6 now',
		q(retimed.upper_arm_l.orient.map((k) => k.time)) === q([0, 0.6, 1]) &&
			Math.abs(armLength(await evaluate(posed(0.6))) / L0 - 0.5) < 0.02,
		q(retimed.upper_arm_l.orient.map((k) => k.time)),
	);
	await evaluate('deleteBoneKeyAt("upper_arm_l", 0.6); true');
	await settled();
	ok(
		'deleting it re-bakes: the arm is whole again at 0.6',
		Math.abs(armLength(await evaluate(posed(0.6))) / L0 - 1) < 0.02,
	);
	await evaluate('rigUndo(); true');
	await settled();
	ok(
		'one undo puts the key back with its bake (the arm short at 0.6 again)',
		q((await sideBones()).upper_arm_l.orient.map((k) => k.time)) === q([0, 0.6, 1]) &&
			Math.abs(armLength(await evaluate(posed(0.6))) / L0 - 0.5) < 0.02,
	);

	// 5. A depth on the flat hand: it becomes 3D and its 2D keys go with it.
	await pick('hand_l', 0.5);
	await evaluate(typeField('depth', 20));
	await settled();
	const hand = (await sideBones()).hand_l;
	ok(
		'a depth on a flat bone makes it 3D: its 2D keys move into the 3D data with the depth key',
		!!hand && hand.depth && hand.depth[0].value === 20 && hand.rotate && hand.rotate.length === 2,
		q(hand),
	);

	// 6. An edit's bake runs off the page (the hotfix after P3a): in a worker, with no overlay, the 🧊
	// bar's mark showing while it runs.
	await evaluate(`(() => {
		window.__bakes = []; window.__onPage = 0; window.__busy = false; window.__overlay = false;
		const post = Worker.prototype.postMessage;
		Worker.prototype.postMessage = function (m) { window.__bakes.push(m && m.name); return post.apply(this, arguments); };
		const R = window.Rigger2p5d, bake = R.rebakeClip3d;
		R.rebakeClip3d = (x) => { window.__onPage++; return bake(x); };
		const mark = showBake3dBusy;
		showBake3dBusy = (n) => { if (n && document.getElementById("bake3dBusy")) window.__busy = true; mark(n); };
		const ov = document.getElementById("loadingOverlay");
		new MutationObserver(() => { if (ov.classList.contains("on")) window.__overlay = true; }).observe(ov, { attributes: true });
		return true;
	})()`);
	await pick('upper_arm_l', 0.25);
	await evaluate(typeField('twist', 10));
	await settled();
	const off = await evaluate(
		'({ jobs: window.__bakes.length, onPage: window.__onPage, busy: window.__busy, overlay: window.__overlay, current: bake3dSig("take") === bake3d.sig.take })',
	);
	ok(
		"an edit's bake runs off the page: one job in the worker, none on the page, no overlay, the 🧊 bar's mark while it runs",
		off.jobs === 1 && off.onPage === 0 && off.busy && !off.overlay && off.current,
		q(off),
	);
	await pick('upper_arm_l', 0.25);
	await evaluate(typeField('twist', 20));
	await settled();
	// An action's undo step closes at once, while its bake still runs: the bake lands in that step all
	// the same, so undo and redo never restore a stale bake.
	await evaluate('historyFlush(); deleteBoneKeyAt("upper_arm_l", 0.25); true');
	await settled();
	ok(
		'a bake landing after its action’s undo step closed lands in that step (the history holds the clip with its bake)',
		await evaluate('historyFlush(), rigHist.present.doc === historyText()'),
	);
	await evaluate('rigUndo(); true');
	await settled();
	ok(
		'…and undo puts the deleted 3D key back',
		await evaluate(
			'(rig3d.doc.clips.take.bones.upper_arm_l.orient || []).some((k) => Math.abs(k.time - 0.25) < 1e-4)',
		),
	);

	// 7. The tolerance; a rename.
	await evaluate(
		'(() => { const i = document.getElementById("rig3dTol"); i.value = "0.3"; i.dispatchEvent(new Event("change")); return true; })()',
	);
	await settled();
	ok(
		'the tolerance is kept in the 3D data and bakes the clip again',
		(await evaluate('rig3d.doc.tolerance')) === 0.3 &&
			(await evaluate('window.__bakes.length')) === 4,
		await evaluate('window.__bakes.length'),
	);
	await evaluate('renameAnimation("take", "reach"); true');
	const renamed = await evaluate(
		'({ reach: !!rig3d.doc.clips.reach, take: !!rig3d.doc.clips.take })',
	);
	await evaluate('renameAnimation("reach", "take"); setCurAnim("take"); true');
	await settled();
	ok('a rename carries the clip’s 3D keys', renamed.reach && !renamed.take, q(renamed));
	await evaluate('keyDrawOrder(0.5, skeletonData.slots.map((s, i) => i).reverse()); true');
	ok(
		'a 3D clip’s draw order is its bake’s: keying it is refused',
		await evaluate(
			'!(rawDoc.animations.take.drawOrder || []).some((k) => Math.abs(k.time - 0.5) < 1e-4)',
		),
	);
	await evaluate('animTime = 0.45; keySlotAttachment("torso", "torso_3q_r"); true');
	ok(
		'…and so is a drawing slot’s image: keying the torso’s is refused, its row hides those keys',
		await evaluate(
			'!(((rawDoc.animations.take.slots || {}).torso || {}).attachment || []).some((k) => Math.abs(k.time - 0.45) < 1e-4) && !slotChs("torso").includes("attachment")',
		),
	);

	// A setup edit: the clip bakes again when it is opened in Animate.
	await evaluate(
		'(() => { const n = window.__bakes.length; setMode("setup"); setDepth3d("lower_arm_l", 40); window.__before = n; setMode("animate"); setCurAnim("take"); return true; })()',
	);
	await settled();
	const setupDepth = await evaluate(`(() => {
		animTime = 0.5; selectBone(skeletonData.bones.findIndex((b) => b.name === "lower_arm_l")); renderBoneDetail();
		const row = [...document.querySelectorAll("#boneDetail label")].find((l) => l.querySelector("span").textContent === "depth");
		return { baked: window.__bakes.length - window.__before, depth: rig3d.doc.bones.lower_arm_l.depth, shown: parseFloat(row.querySelector("input").value) };
	})()`);
	ok(
		'a depth set in Setup is kept, shown in the bone panel, and bakes the clip when Animate opens it',
		setupDepth.baked >= 1 && setupDepth.depth === 40 && setupDepth.shown === 40,
		q(setupDepth),
	);
	await evaluate('rigUndo(); true');
	await settled();

	// Stretch: the 3D keys stretch with the clip.
	await evaluate('stretchAnimation("take", 2); true');
	await settled();
	const stretched = await evaluate(
		'rig3d.doc.clips.take.bones.upper_arm_l.orient.map((k) => k.time)',
	);
	ok(
		'stretching a 3D clip stretches its 3D keys',
		stretched[stretched.length - 1] === 2 && stretched.includes(1.2),
		q(stretched),
	);
	await evaluate('rigUndo(); true');
	await settled();

	// Deleting a 3D clip takes its 3D keys with it.
	await evaluate('duplicateAnimation("take"); true');
	await evaluate('convertClip3d("take_copy")');
	await waitFor('!!clip3d("take_copy")', 10000);
	await evaluate('deleteAnimation("take_copy"); setCurAnim("take"); true');
	await settled();
	ok(
		'a duplicate is a 2D clip of the bake; made 3D and deleted, its 3D keys go too',
		await evaluate('!rig3d.doc.clips.take_copy && !rawDoc.animations.take_copy'),
	);

	// A drag on the canvas commits as keyBone on the posed bone: what it turned is added to the keys as
	// authored (the bone on the stage is posed by the bake).
	const dragged = await evaluate(`(() => {
		animTime = 0.9;
		const b = skeleton.findBone("upper_arm_l"), before = authored3dAt("upper_arm_l", 0.9);
		skeleton.setToSetupPose(); poseAtTime("take", 0.9); b.rotation += 10;
		keyBone("upper_arm_l", { rotate: true }, true);
		const after = authored3dAt("upper_arm_l", 0.9);
		return { turn: after.rotate - before.rotate, tilt: after.tilt - before.tilt };
	})()`);
	await settled();
	ok(
		'a drag that turns the bone 10° on the canvas adds 10° to its turn as authored, its tilt kept',
		Math.abs(dragged.turn - 10) < 0.01 && Math.abs(dragged.tilt) < 0.01,
		q(dragged),
	);

	// 8. ⇲ Detach, and undo.
	const bakedArm = await evaluate('JSON.stringify(rawDoc.animations.take.bones.upper_arm_l)');
	await evaluate(
		'(() => { [...document.querySelectorAll("#clip3dRow button")].find((b) => b.textContent.includes("Detach")).click(); return true; })()',
	);
	await settled();
	const detached = await evaluate(`(() => {
		const row = timelineTracks().find((t) => t.kind === "bone" && t.name === "upper_arm_l");
		return { side: !!rig3d.doc.clips.take, same: JSON.stringify(rawDoc.animations.take.bones.upper_arm_l) === ${q(bakedArm)},
			keys: row ? trackKeyTimes(row).length : 0 };
	})()`);
	ok(
		'⇲ Detach makes a plain 2D clip of the bake: its keys stay, now editable in 2D',
		!detached.side && detached.same && detached.keys > 3,
		q(detached),
	);
	await evaluate('rigUndo(); true');
	await settled();
	await pick('upper_arm_l', 0.9);
	await evaluate(typeField('twist', 5));
	await settled();
	ok(
		'…and undo makes it 3D again: an edit then bakes from its 3D keys (none of the bake taken as authored)',
		await evaluate(
			`!!clip3d("take") && !rig3d.doc.clips.take.bones.upper_arm_l.rotate && Math.abs(authored3dAt("upper_arm_l", 0.9).twist - 5) < 0.01 && bake3dSig("take") === bake3d.sig.take && !${SHOWN_ERR}`,
		),
	);

	// 9. The save; 🧊 Turn 3D off.
	await evaluate('saveToR2().then(() => true)');
	const first = seen.saves[0];
	ok(
		'💾 sends the 3D data and asks the save to bake the clip over',
		!!first &&
			!!first.rig3d &&
			!!first.rig3d.clips.take &&
			q(first.resolve) === q({ take: 'rebake' }),
		q(first && { rig3d: !!first.rig3d, resolve: first.resolve }),
	);
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "off"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('rig3d.doc === null', 10000);
	await evaluate('saveToR2().then(() => true)');
	const second = seen.saves[1];
	ok(
		'🧊 Turn 3D off: the save sends `rig3d: null` on the stored 3D data’s ETag, the clips staying as baked',
		!!second &&
			second.rig3d === null &&
			second.rig3dBaseEtag === 'r1' &&
			!!second.skeleton.animations.take.bones.upper_arm_l.scale &&
			(await evaluate('rig3d.text === ""')),
		q(second && { rig3d: second.rig3d, base: second.rig3dBaseEtag }),
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
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — 3D authoring ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
