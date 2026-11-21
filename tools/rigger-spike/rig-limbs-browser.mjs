// Browser gate for FK / IK switches and spaces (docs/design/rig-controls.md §4.3, §4.5, §4.6, phase K2).
//
//   node tools/rigger-spike/rig-limbs-browser.mjs
//   node tools/rigger-spike/rig-limbs-browser.mjs --shot <file.png>   # also save the stage
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's `W` symbol (its wick is a real animated chain, under a parent its
// `wild_dynamite_land` clip moves) and on a small arm whose stored controls.json already has a limb
// with a pole. Checked, the way an author meets it:
//   - ＋ Two-bone IK on the wick, its setup mix 0, then the IK panel's Limb card: ＋ Make limb, and ＋
//     adds three spaces from its menu (the chain's parent, the world, a prop), each solved before the
//     IK; the card's description is its header's tooltip;
//   - Animate, on the stage as the frame loop draws it: ⇄ To IK and ⇄ Space switch with no jump; a
//     drag on the control's gizmo while it follows the prop keys the space bone and moves the control;
//     ⇄ To FK matched to the clip's end switches back with no jump; ↶ / ↷ undo and redo a switch;
//   - the dopesheet shows the space bone and the switch keys under the control;
//   - 💾 Save posts the limb with its spaces, a sidecar C1 accepts beside the skeleton saved with it,
//     and that skeleton, played by engine-rig as a game plays it, draws what the stage drew;
//   - the stored limb opens under its control's Control card, and a drag of its pole across the arm
//     keys the other bend;
//   - the page throws nothing.
// What it does NOT cover: the maths and its guards (`rig-limbs.mjs` plays the same functions through
// engine-rig, mutation-checked), the server's save (`check:rigger-writes`, C1).
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import vm from 'node:vm';
import { launchChrome } from './chrome.mjs';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, readIrig, exportSpine42Json } = RIG;

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const shotAt = process.argv.includes('--shot')
	? process.argv[process.argv.indexOf('--shot') + 1]
	: null;
const ATLAS = readFileSync(join(SYMBOLS3, 'symbols3.atlas'), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function poseAt(doc, anim, t) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	const skel = new Skeleton(data);
	if (data.defaultSkin) skel.setSkin(data.defaultSkin); // as a game shows it
	const state = new AnimationState(new AnimationStateData(data));
	skel.setToSetupPose();
	state.setAnimation(0, anim, false);
	state.update(t);
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	return skel;
}
const RC = (() => {
	const ctx = { structuredClone };
	vm.createContext(ctx);
	vm.runInContext(
		`${readFileSync(join(STATIC, 'rigger/vendor/rigger-controls.js'), 'utf8')}\n;globalThis.__rc = RiggerControls;`,
		ctx,
	);
	return ctx.__rc;
})();

const w = JSON.parse(readFileSync(join(SYMBOLS3, 'W.json'), 'utf8'));
// A small arm, y up: a chest, a two-bone arm, a hand control on the wrist, a pole off the elbow.
const arm = {
	skeleton: { spine: '4.2.0' },
	bones: [
		{ name: 'root' },
		{ name: 'chest', parent: 'root', y: 100, rotation: 90, length: 60 },
		{ name: 'upper_arm', parent: 'chest', x: 50, y: -20, rotation: 150, length: 60 },
		{ name: 'lower_arm', parent: 'upper_arm', x: 60, rotation: 40, length: 50 },
		{ name: 'hand_ctrl', parent: 'root' },
		{ name: 'elbow_pole', parent: 'chest' },
	],
	slots: [],
	skins: [{ name: 'default', attachments: {} }],
	ik: [],
	animations: {
		swing: {
			bones: {
				chest: { translate: [{ time: 0 }, { time: 1, y: 20 }, { time: 2 }] },
				upper_arm: { rotate: [{ time: 0 }, { time: 1, value: -40 }, { time: 2 }] },
			},
		},
	},
};
{
	const s = poseAt({ ...arm, animations: { x: {} } }, 'x', 0);
	const lower = s.findBone('lower_arm');
	const elbow = lower;
	const wrist = {
		x: lower.worldX + lower.data.length * lower.a,
		y: lower.worldY + lower.data.length * lower.c,
	};
	Object.assign(arm.bones[4], {
		x: Math.round(wrist.x * 1e4) / 1e4,
		y: Math.round(wrist.y * 1e4) / 1e4,
	});
	const sh = s.findBone('upper_arm');
	const mx = (sh.worldX + wrist.x) / 2;
	const my = (sh.worldY + wrist.y) / 2;
	const k = 60 / Math.hypot(elbow.worldX - mx, elbow.worldY - my);
	const p = {
		x: elbow.worldX + (elbow.worldX - mx) * k,
		y: elbow.worldY + (elbow.worldY - my) * k,
	};
	s.findBone('chest').worldToLocal(p);
	Object.assign(arm.bones[5], { x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 });
	const bendOf = (bend) => {
		const d = clone(arm);
		d.ik = [
			{
				name: 'arm_ik',
				order: 0,
				bones: ['upper_arm', 'lower_arm'],
				target: 'hand_ctrl',
				mix: 1,
				bendPositive: bend,
			},
		];
		d.animations = { x: {} };
		const e = poseAt(d, 'x', 0).findBone('lower_arm');
		return Math.hypot(e.worldX - elbow.worldX, e.worldY - elbow.worldY);
	};
	arm.ik = [
		{
			name: 'arm_ik',
			order: 0,
			bones: ['upper_arm', 'lower_arm'],
			target: 'hand_ctrl',
			mix: 0,
			bendPositive: bendOf(true) <= bendOf(false),
		},
	];
}
const STORED = {
	controls: 1,
	rig: 'Arm',
	irig: 'mark',
	bones: {
		hand_ctrl: { role: 'control', shape: 'square', size: 14 },
		elbow_pole: { role: 'control', shape: 'diamond', size: 10 },
	},
	limbs: {
		arm: { ik: 'arm_ik', fk: ['upper_arm', 'lower_arm'], control: 'hand_ctrl', pole: 'elbow_pole' },
	},
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const RIGS = { W: w, Arm: arm };
const ENTRIES = Object.keys(RIGS).map((name, id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: `${name}.json`,
	atlas_file: 'symbols3.atlas',
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
const posted = [];
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.json': 'application/json',
	'.atlas': 'text/plain',
	'.svg': 'image/svg+xml',
};
const readBody = (req) =>
	new Promise((r) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => r(s));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons')
			return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			const rig = Object.keys(RIGS).find((n) => b64(n) === url.searchParams.get('dir'));
			if (rig && name === `${rig}.json`) return jsonOut(RIGS[rig]);
			if (rig && /^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name)))
				return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') {
			const isArm = url.searchParams.get('stem') === 'Arm';
			return jsonOut({
				ok: true,
				projectKey: 'p',
				etag: null,
				rig3d: null,
				controls: isArm ? { etag: '"c1"', doc: STORED } : null,
			});
		}
		if (p === '/api/rigger/save') {
			const body = JSON.parse(await readBody(req));
			posted.push(body);
			const n = posted.length;
			return jsonOut({
				ok: true,
				saved: true,
				key: 'x',
				etag: `etag-${n}`,
				count: 2,
				...(body.controls ? { controlsEtag: `"s${n}"` } : {}),
			});
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/'))
			return jsonOut({
				effects: [],
				atlases: [],
				rigs: [],
				animations: [],
				clips: [],
				backups: [],
			});
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
	name: 'rig-limbs',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
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
async function step(title, fn) {
	console.log(`\n${title}`);
	try {
		await fn();
	} catch (e) {
		fail++;
		console.log(`  ✗ the harness threw — ${e.message}`);
	}
}
const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () =>
	waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
async function openRig(name) {
	const found = await evaluate(`(() => {
		document.getElementById("loadRigBtn").click();
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === ${q(name)});
		if (row) row.click();
		return !!row;
	})()`);
	await settle();
	await waitFor('!!skeleton && !!rawDoc', 15000);
	return found;
}
const setMode = (m) =>
	evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const select = (n) =>
	evaluate(`selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(n)})); true`);
const screenAt = (wx, wy) =>
	evaluate(`(() => {
		const cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(${wx}, ${wy}, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
	})()`);
const worldOfBone = async (n) =>
	JSON.parse(
		await evaluate(
			`JSON.stringify((() => { const b = skeleton.findBone(${q(n)}); return [b.worldX, b.worldY]; })())`,
		),
	);
const mouse = (type, pt, extra = {}) =>
	send('Input.dispatchMouseEvent', {
		type,
		x: pt.x,
		y: pt.y,
		button: 'left',
		clickCount: 1,
		...extra,
	});
async function drag(from, to) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await mouse('mousePressed', from);
	for (let i = 1; i <= 8; i++)
		await send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x: Math.round(from.x + ((to.x - from.x) * i) / 8),
			y: Math.round(from.y + ((to.y - from.y) * i) / 8),
			button: 'left',
			buttons: 1,
		});
	await mouse('mouseReleased', to);
	await wait(40);
}
// The stage at clip time `t`, as the frame loop draws it: each bone's origin and tip relative to the
// root, and the IK's live mix.
const stageAt = async (t, names, ik) =>
	JSON.parse(
		await evaluate(`new Promise((done) => {
			playing = false; animTime = ${t}; syncPlayhead();
			requestAnimationFrame(() => requestAnimationFrame(() => {
				const r = skeleton.bones[0], out = {};
				for (const n of ${q(names)}){ const b = skeleton.findBone(n); out[n] = [b.worldX - r.worldX, b.worldY - r.worldY, b.worldX + b.data.length * b.a - r.worldX, b.worldY + b.data.length * b.c - r.worldY]; }
				const c = skeleton.ikConstraints.find((x) => x.data.name === ${q(ik)});
				done(JSON.stringify({ out, mix: c ? c.mix : null }));
			}));
		})`),
	);
// The clip at `t` as a game plays it: the page's engine-rig pose of the doc as it is (`poseClipAt`).
const gameAt = async (t, names, ik) =>
	JSON.parse(
		await evaluate(`(() => {
			const s = poseClipAt(curAnim, ${t}), r = s.bones[0], out = {};
			for (const n of ${q(names)}){ const b = s.findBone(n); out[n] = [b.worldX - r.worldX, b.worldY - r.worldY, b.worldX + b.data.length * b.a - r.worldX, b.worldY + b.data.length * b.c - r.worldY]; }
			const c = s.ikConstraints.find((x) => x.data.name === ${q(ik)});
			return JSON.stringify({ out, mix: c ? c.mix : null });
		})()`),
	);
const gap = (a, b) =>
	Math.max(
		...Object.keys(a.out).map((n) =>
			Math.max(
				Math.hypot(a.out[n][0] - b.out[n][0], a.out[n][1] - b.out[n][1]),
				Math.hypot(a.out[n][2] - b.out[n][2], a.out[n][3] - b.out[n][3]),
			),
		),
	);
// A switch at `t` made by `click`, as the game plays it: `match` — the pose AT t after the click
// against the one before it (no jump), and `kept` — half a millisecond before t, where nothing may
// change. Each compares one instant, so the clip's own motion (W's wick tip sweeps 3,500 units a
// second) is in neither.
async function judged(t, names, ik, click) {
	const at0 = await gameAt(t, names, ik);
	const pre0 = await gameAt(t - 5e-4, names, ik);
	const clicked = await click();
	const at1 = await gameAt(t, names, ik);
	const pre1 = await gameAt(t - 5e-4, names, ik);
	return { clicked, match: gap(at0, at1), kept: gap(pre0, pre1), mix0: at0.mix, mix1: at1.mix };
}
const clickIn = (root, text) =>
	evaluate(
		`(() => { const b = [...document.querySelectorAll(${q(root)} + " button")].find((x) => x.textContent.trim() === ${q(text)} && !x.disabled); if (b) b.click(); return !!b; })()`,
	);
const clickLineIcon = (root, line, glyph) =>
	evaluate(`(() => {
		const r = [...document.querySelectorAll(${q(root)} + " .limbCard .ctlLine")].find((x) => x.querySelector(".ctlName").textContent.slice(2) === ${q(line)});
		const b = r && [...r.querySelectorAll("button")].find((x) => x.textContent === ${q(glyph)} && !x.disabled);
		if (b) b.click(); return !!b;
	})()`);

const BONE = 'wi_wick_bone_11';
const IK = `${BONE}_ik`;
const CTL = `${BONE}_ik`;
const CHAIN = ['wi_wick_bone_10', BONE, CTL];
const CLIP = 'wild_dynamite_land';
let L = 0;
const T = {};
const samples = {};

try {
	await step('1. W: a two-bone IK on its wick, made a limb', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2');
		await evaluate('window.confirm = () => true; window.alert = () => {}; true');
		await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
		ok('W opens', await openRig('W'));
		await setMode('setup');
		await evaluate('fitView(); true');
		await select(BONE);
		await evaluate('addConstraintPreset("twoBoneIk", null); true');
		ok(
			'＋ Two-bone IK makes the IK and its control',
			await evaluate(`!!ikByName(${q(IK)}) && !!skeletonData.findBone(${q(CTL)})`),
		);
		await evaluate(`selectIk(${q(IK)}); editIk("mix", 0); selectIk(${q(IK)}); true`);
		ok(
			'its setup mix is 0 (off until a clip turns it on)',
			await evaluate(`ikByName(${q(IK)}).mix === 0`),
		);
		ok(
			'the IK panel has a Limb card, its description in its header’s tooltip',
			await evaluate(
				'/without a jump/.test((document.querySelector("#consDetail .limbCard > summary") || {}).title || "")',
			),
		);
		ok('＋ Make limb', await clickIn('#consDetail .limbCard', '＋ Make limb'));
		const limb = JSON.parse(
			await evaluate(
				`JSON.stringify(controlsDoc && controlsDoc.limbs && controlsDoc.limbs[${q(IK)}])`,
			),
		);
		ok(
			'the limb is in the sidecar: the chain is its FK side, the IK’s target its control',
			limb &&
				limb.ik === IK &&
				limb.fk.join() === `wi_wick_bone_10,${BONE}` &&
				limb.control === CTL,
			JSON.stringify(limb),
		);
	});

	await step('2. ＋ adds three spaces, each solved before the IK', async () => {
		for (const pick of ["wi_wick_bone_9 (the chain's parent)", 'world', 'wild_clock']) {
			await evaluate(
				`[...document.querySelectorAll("#consDetail .limbCard .ctlHead button")].find((b) => b.textContent === "＋").click(); true`,
			);
			const chose = await evaluate(`(() => {
				const b = [...document.querySelectorAll("#curveMenu button")].find((x) => x.textContent.startsWith(${q(pick)}) && !x.disabled);
				if (b) b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
				return !!b;
			})()`);
			ok(`the menu offers ${pick.split(' ')[0]}`, chose);
		}
		const spaces = JSON.parse(await evaluate(`JSON.stringify(controlsDoc.limbs[${q(IK)}].spaces)`));
		ok(
			'the sidecar names three spaces',
			spaces && Object.keys(spaces).sort().join() === 'wi_wick_bone_9,wild_clock,world',
			JSON.stringify(spaces),
		);
		const order = JSON.parse(
			await evaluate(
				'JSON.stringify(solveOrderList(rawDoc).filter((e) => !e.why).map((e) => e.kind + ":" + e.c.name))',
			),
		);
		const ikAt = order.indexOf(`ik:${IK}`);
		ok(
			'each space solves before the IK (and W’s own constraints still run)',
			Object.values(spaces).every(
				(sp) =>
					order.indexOf(`transform:${sp.constraint}`) >= 0 &&
					order.indexOf(`transform:${sp.constraint}`) < ikAt,
			) &&
				order.includes('path:shake') &&
				order.includes('transform:wild_clock2'),
			order.join(' '),
		);
		ok(
			'their space bones are helpers',
			await evaluate(
				`Object.values(controlsDoc.limbs[${q(IK)}].spaces).every((sp) => controlsDoc.bones[sp.bone] && controlsDoc.bones[sp.bone].role === "helper")`,
			),
		);
	});

	await step(
		'3. Animate: ⇄ To IK, ⇄ Space and the gizmo keying the space bone, on the stage',
		async () => {
			await setMode('animate');
			await evaluate(`setCurAnim(${q(CLIP)}); tlSelOnly = false; true`);
			L = await evaluate(`workLen(${q(CLIP)})`);
			T.ik = Math.round(L * 0.25 * 100) / 100;
			T.space = Math.round(L * 0.45 * 100) / 100;
			T.drag = Math.round(L * 0.55 * 100) / 100;
			T.fk = Math.round(L * 0.75 * 100) / 100;
			await evaluate(
				`selectIk(${q(IK)}); limbRangeTo = null; animTime = ${T.ik}; syncPlayhead(); buildInspector(selected); true`,
			);
			const toIk = await judged(T.ik, CHAIN.slice(0, 2), IK, () =>
				clickIn('#consDetail .limbCard', '⇄ To IK'),
			);
			ok('⇄ To IK', toIk.clicked);
			ok(
				`the mix steps 0 → 1 there, the wick where FK had it (${toIk.match.toExponential(1)} units) and untouched just before (${toIk.kept.toExponential(1)})`,
				toIk.mix0 === 0 && toIk.mix1 === 1 && toIk.match < 0.01 && toIk.kept < 1e-6,
				JSON.stringify(toIk),
			);
			await evaluate(`animTime = ${T.space}; syncPlayhead(); buildInspector(selected); true`);
			const toProp = await judged(T.space, CHAIN, IK, () =>
				clickLineIcon('#consDetail', 'wild_clock', '⇄'),
			);
			ok('⇄ on the prop space', toProp.clicked);
			ok(
				`the control starts to follow the prop where it was (${toProp.match.toExponential(1)} units), untouched just before (${toProp.kept.toExponential(1)})`,
				toProp.match < 0.01 && toProp.kept < 1e-6,
				JSON.stringify(toProp),
			);
			ok(
				'the card says what it follows',
				/in wild_clock/.test(
					await evaluate(
						'document.querySelector("#consDetail .limbCard > summary span").textContent',
					),
				),
			);
			// The gizmo on the control, while it follows the prop: the drag keys the space bone.
			const spaceBone = await evaluate(`controlsDoc.limbs[${q(IK)}].spaces.wild_clock.bone`);
			await stageAt(T.drag, CHAIN, IK);
			await select(CTL);
			const c0 = await worldOfBone(CTL);
			const from = await screenAt(c0[0], c0[1]);
			await drag(from, { x: from.x + 40, y: from.y - 30 });
			const keys = JSON.parse(
				await evaluate(
					`JSON.stringify({ space: ((rawDoc.animations[curAnim].bones[${q(spaceBone)}] || {}).translate || []).map((k) => k.time), ctl: ((rawDoc.animations[curAnim].bones[${q(CTL)}] || {}).translate || []).map((k) => k.time) })`,
				),
			);
			ok(
				'a gizmo drag on the control keys its space bone at the playhead, not the control',
				keys.space.some((x) => Math.abs(x - T.drag) < 1e-3) &&
					!keys.ctl.some((x) => Math.abs(x - T.drag) < 1e-3),
				JSON.stringify(keys),
			);
			ok(
				'the hint says so',
				(await evaluate('document.getElementById("hint").textContent')).includes(spaceBone),
			);
			const c1 = await worldOfBone(CTL);
			const want = await evaluate(
				'(() => { const z = renderer.camera.zoom, dpr = window.devicePixelRatio || 1; return [40 * dpr * z, 30 * dpr * z]; })()',
			);
			ok(
				`and the control moves where it was dragged (${(c1[0] - c0[0]).toFixed(1)}, ${(c1[1] - c0[1]).toFixed(1)} for ${want[0].toFixed(1)}, ${want[1].toFixed(1)})`,
				Math.hypot(c1[0] - c0[0] - want[0], c1[1] - c0[1] - want[1]) < 2,
			);
		},
	);

	await step('4. ⇄ To FK matched to the clip’s end; ↶ / ↷', async () => {
		await evaluate(
			`selectIk(${q(IK)}); animTime = ${T.fk}; syncPlayhead(); buildInspector(selected); true`,
		);
		const set = await evaluate(`(() => {
			const t = [...document.querySelectorAll("#consDetail .limbCard button")].find((b) => b.textContent === "⇥"); if (!t) return false; t.click();
			return limbRangeTo;
		})()`);
		ok(`⇥ matches to the clip’s end (${set})`, Math.abs(set - L) < 1e-3, set);
		const toFk = await judged(T.fk, CHAIN.slice(0, 2), IK, () =>
			clickIn('#consDetail .limbCard', '⇄ To FK'),
		);
		ok('⇄ To FK', toFk.clicked);
		const after = await gameAt((T.fk + L) / 2, CHAIN.slice(0, 2), IK);
		ok(
			`the mix steps 1 → 0, the wick where the IK had it (${toFk.match.toExponential(1)} units), untouched just before (${toFk.kept.toExponential(1)}), the IK off after`,
			toFk.mix0 === 1 &&
				toFk.mix1 === 0 &&
				toFk.match < 0.01 &&
				toFk.kept < 1e-6 &&
				after.mix === 0,
			JSON.stringify(toFk),
		);
		const fkKeys = await evaluate(
			`rawDoc.animations[curAnim].bones[${q(BONE)}].rotate.filter((k) => k.time >= ${T.fk} - 1e-3).length`,
		);
		ok(`the wick is keyed at every key up to the end (${fkKeys})`, fkKeys >= 2);
		await evaluate('historyFlush(); rigUndo(); true');
		const undone = await gameAt((T.fk + L) / 2, CHAIN.slice(0, 2), IK);
		ok('↶ undoes the switch (the IK is on again)', undone.mix === 1, undone.mix);
		await evaluate('rigRedo(); true');
		const redone = await gameAt((T.fk + L) / 2, CHAIN.slice(0, 2), IK);
		ok('↷ redoes it', redone.mix === 0, redone.mix);
		let drift = 0;
		for (const t of [T.ik + 0.01, T.space + 0.01, T.drag + 0.01, T.fk + 0.01, L * 0.95]) {
			samples[t] = await gameAt(t, CHAIN, IK);
			drift = Math.max(drift, gap(samples[t], await stageAt(t, CHAIN, IK)));
		}
		console.log(
			`  (the stage draws eased keys exactly, the 4.2 format at ten points: here up to ${drift.toFixed(2)} units apart)`,
		);
	});

	await step(
		'5. the dopesheet puts the space bone and the switch keys under the control',
		async () => {
			await evaluate('renderTimeline(); true');
			const rows = JSON.parse(
				await evaluate(
					`JSON.stringify([...document.querySelectorAll("span")].map((s) => s.textContent).filter((t) => t.startsWith("↳ ") || t === ${q(CTL)}))`,
				),
			);
			const at = rows.indexOf(CTL);
			const under = rows.slice(at + 1).filter((t) => t.startsWith('↳ '));
			ok(
				'↳ the prop space bone, the IK mix and its spaces’ mixes follow the control’s row',
				at >= 0 &&
					under.some((t) => t.includes('_wild_clock')) &&
					under.some((t) => t.includes('IK mix')) &&
					under.some((t) => t.includes('transform mix')),
				rows.join(' | '),
			);
		},
	);

	await step(
		'6. 💾 Save: the limb and its spaces, and a skeleton the game plays as the page measured it',
		async () => {
			const n = posted.length;
			await evaluate('saveToR2(); true');
			for (let i = 0; i < 200 && posted.length === n; i++) await wait(50);
			const body = posted.at(-1);
			ok(
				'one save posted, with the sidecar (W had none)',
				posted.length === n + 1 && !!body.controls && body.controlsBaseEtag === null,
				body && JSON.stringify(body.controlsBaseEtag),
			);
			const limb = body.controls.limbs[IK];
			ok(
				'it carries the limb with its three spaces',
				limb && Object.keys(limb.spaces || {}).length === 3,
				JSON.stringify(limb),
			);
			const irig = body.skeleton.irig ? exportSpine42Json(readIrig(body.skeleton)) : body.skeleton;
			const checked = RC.checkedControls(clone(body.controls), 'W', irig);
			ok(
				'C1 accepts that sidecar beside that skeleton',
				checked.problems.length === 0,
				checked.problems.join('; '),
			);
			let worst = 0;
			for (const [t, stage] of Object.entries(samples)) {
				const s = poseAt(irig, CLIP, Math.max(Number(t), Math.fround(Number(t))));
				const r = s.bones[0];
				for (const n of CHAIN) {
					const b = s.findBone(n);
					const [ox, oy, tx, ty] = stage.out[n];
					worst = Math.max(
						worst,
						Math.hypot(b.worldX - r.worldX - ox, b.worldY - r.worldY - oy),
						Math.hypot(
							b.worldX + b.data.length * b.a - r.worldX - tx,
							b.worldY + b.data.length * b.c - r.worldY - ty,
						),
					);
				}
			}
			ok(
				`engine-rig plays the saved skeleton as the page measured it (${worst.toExponential(1)} units at worst)`,
				worst < 1e-4,
			);
			if (shotAt) {
				await stageAt(T.drag + 0.01, CHAIN, IK);
				const shot = await send('Page.captureScreenshot', { format: 'png' });
				writeFileSync(shotAt, Buffer.from(shot.data, 'base64'));
				console.log(`  (stage saved to ${shotAt})`);
			}
		},
	);

	await step('7. a stored limb opens under its control; its pole keys the bend', async () => {
		ok('Arm opens', await openRig('Arm'));
		await setMode('animate');
		await evaluate('setCurAnim("swing"); fitView(); true');
		await select('hand_ctrl');
		ok(
			'the control’s Control card is followed by its Limb card',
			/Limb · arm · FK/.test(
				await evaluate(
					'(document.querySelector("#boneDetail .limbCard > summary span") || {}).textContent || ""',
				),
			),
		);
		await evaluate(
			'limbRangeTo = null; animTime = 0.3; syncPlayhead(); buildInspector(selected); true',
		);
		ok('⇄ To IK from the control’s card', await clickIn('#boneDetail .limbCard', '⇄ To IK'));
		const bend0 = await evaluate('rawDoc.animations.swing.ik.arm_ik.at(-1).bendPositive');
		// Drag the pole across the shoulder → control line, at a time the IK is on.
		await stageAt(0.5, ['upper_arm', 'lower_arm'], 'arm_ik');
		await select('elbow_pole');
		const [sx, sy] = await worldOfBone('upper_arm');
		const [cx, cy] = await worldOfBone('hand_ctrl');
		const [px, py] = await worldOfBone('elbow_pole');
		const lx = cx - sx;
		const ly = cy - sy;
		const u = ((px - sx) * lx + (py - sy) * ly) / (lx * lx + ly * ly);
		const mirror = [2 * (sx + lx * u) - px, 2 * (sy + ly * u) - py];
		await drag(await screenAt(px, py), await screenAt(mirror[0], mirror[1]));
		const keys = JSON.parse(
			await evaluate(
				'JSON.stringify(rawDoc.animations.swing.ik.arm_ik.filter((k) => Math.abs(k.time - 0.5) < 1e-3))',
			),
		);
		const poleKeys = await evaluate(
			'JSON.stringify((rawDoc.animations.swing.bones.elbow_pole || {}).translate || null)',
		);
		const hint = await evaluate('document.getElementById("hint").textContent');
		ok(
			'dragging the pole across keys the other bend there',
			keys.length === 1 && keys[0].bendPositive === !bend0,
			`${JSON.stringify(keys)} · pole ${poleKeys} · ${hint} · t ${await evaluate('animTime')}`,
		);
		ok('the hint says so', /bends/.test(hint), hint);
		const side = JSON.parse(
			await evaluate(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
				const a = skeleton.findBone("upper_arm"), c = skeleton.findBone("hand_ctrl"), e = skeleton.findBone("lower_arm"), p = skeleton.findBone("elbow_pole");
				const s = (q) => Math.sign((c.worldX - a.worldX) * (q.worldY - a.worldY) - (c.worldY - a.worldY) * (q.worldX - a.worldX));
				done(JSON.stringify([s(e), s(p)]));
			})))`),
		);
		ok(
			'the stage draws the elbow on the pole’s side',
			side[0] === side[1] && side[0] !== 0,
			JSON.stringify(side),
		);
		const at05 = () =>
			evaluate(
				'JSON.stringify([((rawDoc.animations.swing.bones.elbow_pole || {}).translate || []).some((k) => Math.abs(k.time - 0.5) < 1e-3), rawDoc.animations.swing.ik.arm_ik.some((k) => Math.abs(k.time - 0.5) < 1e-3)])',
			).then(JSON.parse);
		await evaluate('historyFlush(); rigUndo(); true');
		const undone = await at05();
		await evaluate('rigRedo(); true');
		const redone = await at05();
		ok(
			'one ↶ takes back the pole’s key and the bend it keyed together; ↷ brings both back',
			!undone[0] && !undone[1] && redone[0] && redone[1],
			JSON.stringify({ undone, redone }),
		);
	});

	await step('8. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass}/${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
