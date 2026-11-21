// Browser gate for IK in 3D (rig-controls K4, docs/design/rig-controls.md §6.2), on the SHIPPED
// view.html and the committed vendor bundles in a real Chromium against a fake launcher API, with a
// real `half-body` rig built by the server's `templateRig` (its arm hangs on bones with no length, so
// the IK's end is the hand). Checked:
//  - ＋ Add constraint → Two-bone IK in 3D is offered on a 3D rig only; on the forearm, reaching the
//    template's `hand_ik_l`, it writes a rig3d `ik` entry (end `hand_l`) and a 3D limb in controls.json;
//    the Limb card's pole sets the 3D IK's pole;
//  - on a 3D clip, ⇄ To IK keys the switch with no jump as the stage draws it, and steps the mix;
//  - the view turned (45°): dragging the control's depth and X arrows with the mouse moves the arm with
//    it while dragging (the held pose solves the limb), the hand on the control, and keys the control in
//    3D on release; dragging the pole's depth arrow swings the elbow and the hand stays put;
//  - from the side (◧ 90°) the hand is on the control and the control's shape is on the stage;
//  - ⇄ To FK later in the clip: no jump, the mix steps to 0;
//  - 💾 Save sends the 3D IK and the 3D limb; the bake the page made is the one the save's modules make
//    of what it sent, and engine-rig plays the hand on the control;
//  - the page throws nothing and shows no alert.
//   node tools/rigger-spike/rig-ik3d-browser.mjs
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');

const esbuild = await import(ESBUILD);
const tmp = mkdtempSync(join(tmpdir(), 'rig-ik3d-browser-'));
const entry = join(tmp, 'entry.ts');
const lib = (f) => JSON.stringify(join(APP, 'src/lib', f).replace(/\\/g, '/'));
writeFileSync(
	entry,
	[
		`export * from ${lib('server/rigTemplates.ts')};`,
		`export { rebakeClip3d } from ${lib('rig3dImport.ts')};`,
		`export { rigOf, clipOf } from ${lib('rig3d.ts')};`,
		`export { pose3d } from ${lib('rig2p5d.ts')};`,
	].join('\n'),
);
const out = join(tmp, 'modules.mjs');
await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const M = await import(pathToFileURL(out).href);
const { HALF_BODY, templateRig, rigTemplateFromSidecar } = M;
const RIGC = await import(RIG_CORE);

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
const ATLAS = ['half.png', `size:${PAGE_W},${y + rowH}`, 'filter:Linear,Linear', ...lines].join(
	'\n',
);
const TEMPLATE = rigTemplateFromSidecar(
	JSON.stringify({ id: 'half-body', version: HALF_BODY.version }),
);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const seen = { saves: [], other: [] };
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
			if (name.endsWith('.irig')) return json(rig);
			if (name.endsWith('.atlas')) return send(200, 'text/plain', ATLAS);
			if (name.endsWith('.png')) return send(200, 'image/png', page);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: TEMPLATE });
		if (p === '/api/editor/flipbooks') return json({ clips: [] });
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: null });
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const b = await body();
			seen.saves.push(b);
			const n = seen.saves.length;
			return json({
				ok: true,
				key: 'k',
				etag: `e${n}`,
				count: 1,
				rig3dEtag: b.rig3d ? `r${n}` : undefined,
				...(b.controls ? { controlsEtag: `"c${n}"` } : {}),
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
	name: 'rig-ik3d',
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 3) =>
	evaluate(
		`new Promise((done) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : done(true)); requestAnimationFrame(f); })`,
	);
/** Let an edit's re-bake run and land. */
const settled = async () => {
	await waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		30000,
	);
	await frames();
};
/** A bone as the stage drew it last frame: its world origin. */
const drawn = (n) =>
	evaluate(
		`(() => { const b = skeleton.findBone(${q(n)}); return { x: b.worldX, y: b.worldY }; })()`,
	);
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** How far the hand is drawn from its control, now. */
const handOff = async () => apart(await drawn('hand_l'), await drawn('hand_ik_l'));
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
const pickBone = async (n) => {
	await evaluate(
		`(() => { selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(n)})); renderBoneDetail(); return true; })()`,
	);
	await frames();
};
/** Drag the selected bone's drawn arrow `id` by about `t` (world units along its drawing). */
async function dragArrow(id, t, mid) {
	const z = await evaluate(
		`(() => { const p = gizmoParts(selBone).find((x) => x.id === ${q(id)}); return p && { dir: p.dir, c: gizmoCenter(), G: gizmoGeom() }; })()`,
	);
	if (!z) return null;
	const at = async (s) => {
		const p = await screenAt(z.c.x + z.dir[0] * s, z.c.y + z.dir[1] * s);
		return { x: Math.round(p.x), y: Math.round(p.y) };
	};
	const m0 = (z.G.axisFrom + z.G.axisTo) / 2;
	const from = await at(m0);
	await mouse('mouseMoved', from);
	await mouse('mousePressed', from);
	for (let k = 1; k <= 8; k++) {
		await mouse('mouseMoved', await at(m0 + (t * k) / 8));
		if (mid && k === 6) await mid();
	}
	await mouse('mouseReleased', await at(m0 + t));
	await frames();
	return z;
}
/** Click the Limb card's button `label` (the selected bone's). */
const clickLimb = (label) =>
	evaluate(
		`(() => { const b = [...document.querySelectorAll(".limbCard button")].find((x) => x.textContent === ${q(label)}); if (!b || b.disabled) return b ? "disabled: " + b.title : "no button"; b.click(); return "ok"; })()`,
	);

const LIMB = 'lower_arm_l_ik3d';
/** The page's error line, when it shows one (a bake the page could not make says so there). */
const pageError = () =>
	evaluate(
		'(() => { const e = document.getElementById("err"); return e && e.style.display === "block" && !e.classList.contains("notice") ? e.textContent : ""; })()',
	);
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
	await pickBone('lower_arm_l');
	ok(
		'a 2D rig is not offered Two-bone IK in 3D',
		/3D rig/.test((await evaluate('presetProblem("ik3d", "lower_arm_l")')) || ''),
		await evaluate('presetProblem("ik3d", "lower_arm_l")'),
	);

	// 1. Make it 3D, then the 3D IK from the preset, on the template's own control and pole.
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="preview"]\').click(); true');
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc && !!window.Rigger2p5d', 15000);
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="setup"]\').click(); true');
	await pickBone('lower_arm_l');
	ok(
		'a 3D rig is offered Two-bone IK in 3D on the forearm',
		(await evaluate('presetProblem("ik3d", "lower_arm_l")')) === null,
		await evaluate('presetProblem("ik3d", "lower_arm_l")'),
	);
	await evaluate('addConstraintPreset("ik3d", "hand_ik_l"); true');
	await frames();
	const made = await evaluate(
		'JSON.stringify({ ik: rig3d.doc.ik, limb: controlsDoc && controlsDoc.limbs && controlsDoc.limbs[' +
			q(LIMB) +
			'] })',
	);
	const m = JSON.parse(made);
	ok(
		'it writes a 3D IK (upper → forearm, its end the hand, reaching hand_ik_l) and a 3D limb',
		m.ik?.length === 1 &&
			q(m.ik[0].bones) === q(['upper_arm_l', 'lower_arm_l']) &&
			m.ik[0].end === 'hand_l' &&
			m.ik[0].target === 'hand_ik_l' &&
			m.limb?.ik3d === true,
		made,
	);
	await evaluate(`setLimbPole(${q(LIMB)}, "elbow_pole_l"); true`);
	ok(
		'the Limb card’s pole sets the 3D IK’s pole',
		(await evaluate('rig3d.doc.ik[0].pole')) === 'elbow_pole_l',
	);

	// 2. A 3D clip: the arm posed in FK, then ⇄ To IK at 0.
	await evaluate('document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); true');
	await waitFor('animMode', 10000);
	await evaluate('setCurAnim("take"); animTime = 0; playing = false; convertClip3d("take"); true');
	await settled();
	// An empty clip has no length to bake (the page says so): give it one, and start the error line over.
	await evaluate('clearErr(); rig3d.doc.clips.take.duration = 1; markDirty(); true');
	await settled();
	ok('the 3D clip bakes', !(await pageError()), await pageError());
	await pickBone('upper_arm_l');
	// The elbow bent, so the control has room to move within the arm's reach.
	await evaluate(
		'set3dValue("upper_arm_l", "tilt", 35); set3dValue("upper_arm_l", "rotate", skeletonData.findBone("upper_arm_l").rotation + 30); set3dValue("lower_arm_l", "rotate", skeletonData.findBone("lower_arm_l").rotation + 80); markDirty(); true',
	);
	await settled();
	await pickBone('lower_arm_l');
	const fkHand = await drawn('hand_l');
	ok(
		'the forearm shows the Limb card with ⇄ To IK',
		(await evaluate('!!document.querySelector(".limbCard")')) === true,
	);
	const r1 = await clickLimb('⇄ To IK');
	await settled();
	const ikHand = await drawn('hand_l');
	ok(
		'⇄ To IK: no jump as the stage draws it, the mix stepped to 1',
		r1 === 'ok' &&
			!(await pageError()) &&
			apart(fkHand, ikHand) < 0.5 &&
			(await evaluate(`Rigger2p5d.ik3dMixAt(rig3d.doc, "take", ${q(LIMB)}, 0.01)`)) === 1,
		q({
			r1,
			err: await pageError(),
			fkHand,
			ikHand,
			hint: await evaluate('document.getElementById("hint").textContent'),
		}),
	);

	// 3. The view turned: drag the control's depth and X arrows.
	await evaluate('setViewTurn(45); true');
	await pickBone('hand_ik_l');
	const before = await drawn('hand_l');
	let during = null;
	const z = await dragArrow('z', 25, async () => {
		await frames();
		during = await handOff();
	});
	await settled();
	const after = await drawn('hand_l');
	const keyed = await evaluate('JSON.stringify(rig3d.doc.clips.take.bones.hand_ik_l || null)');
	ok(
		'turned 45°: dragging the control’s depth arrow moves the arm with it as it drags, the hand on the control',
		!!z && during !== null && during < 1 && apart(before, after) > 5 && (await handOff()) < 1,
		q({
			during,
			moved: apart(before, after),
			off: await handOff(),
			parts: await evaluate('gizmoParts(selBone).map((p) => p.id)'),
		}),
	);
	ok('…and keys the control’s depth in 3D on release', /"depth":\[\{/.test(keyed), keyed);
	const beforeX = await drawn('hand_l');
	await dragArrow('x', -25);
	await settled();
	ok(
		'…its X arrow too',
		apart(beforeX, await drawn('hand_l')) > 5 && (await handOff()) < 1,
		q({ moved: apart(beforeX, await drawn('hand_l')), off: await handOff() }),
	);

	// 4. The pole: its depth arrow swings the elbow; the hand stays on the control.
	await pickBone('elbow_pole_l');
	const elbow0 = await drawn('lower_arm_l');
	const hand0 = await drawn('hand_l');
	await dragArrow('z', 200);
	await settled();
	const elbow1 = await drawn('lower_arm_l');
	ok(
		'dragging the pole across the arm swings the elbow, the hand stays put',
		apart(elbow0, elbow1) > 5 && apart(hand0, await drawn('hand_l')) < 1,
		q({ elbow: apart(elbow0, elbow1), hand: apart(hand0, await drawn('hand_l')) }),
	);

	// 5. From the side.
	await evaluate('document.getElementById("viewSide").click(); true');
	await frames();
	ok(
		'◧ the side view: the hand on the control, the control’s shape on the stage',
		(await evaluate('viewTurn')) === 90 &&
			(await handOff()) < 1 &&
			(await evaluate(
				'(() => { const st = boneControlState("hand_ik_l"); return st.onStage && boneShown(st); })()',
			)),
		q({ turn: await evaluate('viewTurn'), off: await handOff() }),
	);
	await evaluate('setViewTurn(0); true');
	await frames();

	// 6. ⇄ To FK later in the clip.
	await evaluate('playing = false; animTime = 0.5; syncPlayhead(); buildInspector(selected); true');
	await frames();
	await pickBone('lower_arm_l');
	const atIk = await drawn('hand_l');
	const r2 = await clickLimb('⇄ To FK');
	await settled();
	ok(
		'⇄ To FK at 0.5: no jump, the mix stepped to 0',
		r2 === 'ok' &&
			!(await pageError()) &&
			apart(atIk, await drawn('hand_l')) < 0.5 &&
			(await evaluate(`Rigger2p5d.ik3dMixAt(rig3d.doc, "take", ${q(LIMB)}, 0.51)`)) === 0,
		q({ r2, err: await pageError(), atIk, now: await drawn('hand_l') }),
	);

	// 7. 💾 Save.
	const n = seen.saves.length;
	await evaluate('saveToR2(); true');
	for (let i = 0; i < 200 && seen.saves.length === n; i++) await wait(50);
	const saved = seen.saves.at(-1);
	ok(
		'💾 Save sends the 3D IK, its clip’s mix keys and the 3D limb',
		seen.saves.length === n + 1 &&
			saved.rig3d?.ik?.[0]?.name === LIMB &&
			saved.rig3d.clips.take.ik?.[LIMB]?.length >= 2 &&
			saved.controls?.limbs?.[LIMB]?.ik3d === true,
		saved &&
			q({ ik: saved.rig3d?.ik, mix: saved.rig3d?.clips?.take?.ik, limb: saved.controls?.limbs }),
	);
	if (saved) {
		const again = M.rebakeClip3d({ irig: saved.skeleton, doc: saved.rig3d, clip: 'take' });
		const same =
			JSON.stringify(again.irig.animations.take) === JSON.stringify(saved.skeleton.animations.take);
		ok('…the page’s bake is the one the save’s modules make of what it sent', same);
		// engine-rig plays the hand on the control while the IK is on (before 0.5).
		const atlas = new RIGC.TextureAtlas(ATLAS);
		for (const pg of atlas.pages)
			pg.setTexture({
				getImage: () => ({ width: 1, height: 1 }),
				setFilters() {},
				setWraps() {},
				dispose() {},
			});
		const data = new RIGC.SkeletonJson(new RIGC.AtlasAttachmentLoader(atlas)).readSkeletonData(
			structuredClone(saved.skeleton),
		);
		const skel = new RIGC.Skeleton(data);
		const state = new RIGC.AnimationState(new RIGC.AnimationStateData(data));
		state.setAnimation(0, 'take', false);
		state.update(0.25);
		state.apply(skel);
		skel.updateWorldTransform(RIGC.Physics.update);
		const rig3 = M.rigOf(saved.skeleton, saved.rig3d);
		const w = M.pose3d(rig3, M.clipOf(rig3, saved.skeleton, saved.rig3d, 'take').clip, 0.25);
		const h = skel.findBone('hand_l');
		const c = w.get('hand_ik_l').o;
		ok(
			'…and engine-rig plays the hand on the control',
			Math.hypot(h.worldX - c[0], h.worldY - c[1]) < 0.5,
			q({ hand: [h.worldX, h.worldY], control: c }),
		);
	}

	ok('every edit baked (the page shows no error)', !(await pageError()), await pageError());
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
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — IK in 3D ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
