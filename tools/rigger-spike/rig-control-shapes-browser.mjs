// Browser gate for control shapes (docs/design/rig-controls.md §5.1–5.3, §5.5, §5.8, phase C2).
//
//   node tools/rigger-spike/rig-control-shapes-browser.mjs
//   node tools/rigger-spike/rig-control-shapes-browser.mjs --shot <file.png>   # also save the stage
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on a small arm rig whose stored `controls.json` (C1's GET answer) has a hand control,
// a ring on the arm with a rotation limit, a hidden head, a layer and a selection set — and on the
// repo's `W`, which has none. Checked, the way an author meets it:
//   - the stored sidecar opens: its shapes are drawn in their colours, the hidden head is not, the
//     Control layer section lists its layer and set, its description is the header's tooltip;
//   - a real click on a control's outline selects its bone; a click on the hidden head's origin does
//     not; 🎛 Controls (animator view) picks controls only;
//   - Animate: the ring's gizmo has the ring only, a drag on it keys a rotation held to the limit;
//     the hand's x arrow keys a move along x only; a set selects both hands and ⟲ keys their rest pose;
//   - the bone's Control card edits the sidecar, and ↶ undoes that edit;
//   - 💾 Save posts the sidecar under its ETag and the next save under the one the answer gave, and
//     none when it did not change; a control-only edit leaves the posted skeleton byte-identical;
//     W saves with no `controls` at all;
//   - ＋ Two-bone IK's new control is a control in the sidecar.
// What it does NOT cover: the geometry and the guards (`rig-control-shapes.mjs` plays the same
// functions headlessly, mutation-checked), the server's save (`check:rigger-writes`, C1).
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { CLICK_SAVE } from './view-save.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const shotAt = process.argv.includes('--shot')
	? process.argv[process.argv.indexOf('--shot') + 1]
	: null;

const w = JSON.parse(readFileSync(join(SYMBOLS3, 'W.json'), 'utf8'));
const arm = {
	skeleton: { spine: '4.2.0' },
	bones: [
		{ name: 'root' },
		{ name: 'body', parent: 'root', y: 100 },
		{ name: 'chest', parent: 'body', y: 60, rotation: 90, length: 60 },
		{ name: 'upper_arm_l', parent: 'chest', x: 40, y: -20, rotation: -90, length: 70 },
		{ name: 'lower_arm_l', parent: 'upper_arm_l', x: 70, rotation: 20, length: 60 },
		{ name: 'head', parent: 'chest', x: 75, length: 40 },
		{ name: 'hand_ik_l', parent: 'root', x: 160, y: 120 },
		{ name: 'hand_ik_r', parent: 'root', x: -160, y: 120 },
	],
	slots: [],
	skins: [{ name: 'default', attachments: {} }],
	animations: { idle: { bones: { body: { rotate: [{ time: 0 }, { time: 1, value: 3 }] } } } },
};
const STORED = {
	controls: 1,
	rig: 'Arm',
	irig: 'mark',
	bones: {
		hand_ik_l: {
			role: 'control',
			shape: 'square',
			size: 14,
			colour: '#12ab34',
			channels: ['translate'],
			layer: 'Body IK',
		},
		hand_ik_r: { role: 'control', shape: 'square', size: 14, layer: 'Body IK' },
		upper_arm_l: { shape: 'ring', size: 26, limits: { rotate: [-120, -60] } },
		head: { hidden: true },
	},
	layers: [{ name: 'Body IK', visible: true, locked: false }],
	sets: { hands: ['hand_ik_l', 'hand_ik_r'] },
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
			const arm = url.searchParams.get('stem') === 'Arm';
			return jsonOut({
				ok: true,
				projectKey: 'p',
				etag: null,
				rig3d: null,
				controls: arm ? { etag: '"c1"', doc: STORED } : null,
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
				...(body.controls ? { controlsEtag: `"c${n + 1}"` } : {}),
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
	name: 'rig-control-shapes',
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
const selName = () => evaluate('selBone != null ? skeletonData.bones[selBone].name : null');
/** Page coordinates of world point (x, y). */
const screenAt = (wx, wy) =>
	evaluate(`(() => {
		const cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(${wx}, ${wy}, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
	})()`);
/** Page coordinates of bone `n`'s origin, `dx` / `dy` CSS px off it (y down). */
const screenOf = async (n, dx = 0, dy = 0) => {
	const b = JSON.parse(
		await evaluate(
			`JSON.stringify((() => { const b = skeleton.findBone(${q(n)}); return [b.worldX, b.worldY]; })())`,
		),
	);
	const p = await screenAt(b[0], b[1]);
	return { x: p.x + dx, y: p.y + dy };
};
const mouse = (type, pt, extra = {}) =>
	send('Input.dispatchMouseEvent', {
		type,
		x: pt.x,
		y: pt.y,
		button: 'left',
		clickCount: 1,
		...extra,
	});
async function click(pt, modifiers = 0) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
	await mouse('mousePressed', pt, { modifiers });
	await mouse('mouseReleased', pt, { modifiers });
}
async function drag(from, to) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await mouse('mousePressed', from);
	for (let i = 1; i <= 6; i++)
		await send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x: Math.round(from.x + ((to.x - from.x) * i) / 6),
			y: Math.round(from.y + ((to.y - from.y) * i) / 6),
			button: 'left',
			buttons: 1,
		});
	await mouse('mouseReleased', to);
	await wait(30);
}
/** Filled polygons the stage draws in one frame, by colour: { "r,g,b": count }. */
const polysByColour = () =>
	evaluate(`new Promise((done) => {
		const seen = {}, poly = renderer.polygon;
		renderer.polygon = function (v, o, n, c){ const k = [c.r, c.g, c.b].map((x) => x.toFixed(2)).join(","); seen[k] = (seen[k] || 0) + 1; return poly.apply(this, arguments); };
		requestAnimationFrame(() => requestAnimationFrame(() => { renderer.polygon = poly; done(JSON.stringify(seen)); }));
	})`);
const GREEN = [0x12 / 255, 0xab / 255, 0x34 / 255].map((v) => v.toFixed(2)).join(',');

try {
	await step('1. the stored control layer opens with the rig', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2');
		await evaluate('window.confirm = () => true; window.alert = () => {}; true');
		await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
		ok('Arm opens', await openRig('Arm'));
		await setMode('setup');
		await evaluate('fitView(); true');
		ok(
			'the control layer’s code loaded (vendor/rigger-controls.js)',
			await evaluate('!!window.RiggerControls && controlsLocked === null'),
		);
		ok(
			'the stored sidecar is the page’s, under its ETag',
			await evaluate(
				'controlsEtag === \'"c1"\' && !!controlsDoc && controlsDoc.bones.hand_ik_l.shape === "square"',
			),
		);
		const seen = JSON.parse(await polysByColour());
		ok(
			'the hand control is drawn in its own colour',
			(seen[GREEN] || 0) >= 4,
			JSON.stringify(seen),
		);
		ok(
			'the hidden head’s tree row says so',
			await evaluate(
				'[...document.querySelectorAll("#boneTree .trow")].some((r) => r.classList.contains("ctlHidden") && r.textContent.includes("head"))',
			),
		);
		const panel = await evaluate('document.getElementById("ctlPanel").textContent');
		ok(
			'the Control layer section lists the layer and the set',
			/Body IK/.test(panel) && /hands/.test(panel),
			panel,
		);
		ok(
			'its description is the header’s tooltip',
			/controls\.json/.test(await evaluate('document.querySelector("#secCtl > summary").title')),
		);
	});

	await step('2. clicks on the stage pick controls; hidden bones are not picked', async () => {
		await evaluate('selectBone(0); true');
		const z = await evaluate('renderer.camera.zoom');
		// the square's right edge: 14 screen (device) px from the bone, in CSS px
		const dpr = await evaluate('window.devicePixelRatio || 1');
		await click(await screenOf('hand_ik_l', 14 / dpr, 5 / dpr));
		ok(
			'a click on the hand control’s outline selects it',
			(await selName()) === 'hand_ik_l',
			`${await selName()} (zoom ${z})`,
		);
		await evaluate('selectBone(0); true');
		await click(await screenOf('head', 0, 0));
		ok(
			'a click on the hidden head’s origin does not',
			(await selName()) !== 'head',
			await selName(),
		);
		await click(await screenOf('hand_ik_r', 0, 0), 8); // shift
		await evaluate('selectBone(skeletonData.bones.findIndex((b) => b.name === "hand_ik_l")); true');
		await click(await screenOf('hand_ik_r', 0, 0), 8);
		ok(
			'shift-click adds a control to the selection',
			await evaluate('selectedBoneNames().sort().join() === "hand_ik_l,hand_ik_r"'),
			await evaluate('selectedBoneNames().join()'),
		);
		await evaluate('document.getElementById("animViewBtn").click(); selectBone(0); true');
		await click(await screenOf('chest', 0, 0));
		ok(
			'🎛 Controls: a click on a deform bone picks nothing',
			(await selName()) === 'root',
			await selName(),
		);
		await click(await screenOf('hand_ik_r', 0, 0));
		ok('🎛 Controls: a control is still picked', (await selName()) === 'hand_ik_r', await selName());
		const seen = JSON.parse(await polysByColour());
		ok('🎛 Controls: the shapes are still drawn', (seen[GREEN] || 0) >= 4);
		await evaluate('document.getElementById("animViewBtn").click(); true');
	});

	await step('3. Animate: locks, limits and an axis drag key what the control allows', async () => {
		await setMode('animate');
		await evaluate(
			'selectBone(skeletonData.bones.findIndex((b) => b.name === "upper_arm_l")); true',
		);
		ok(
			'the ring’s gizmo is the ring only',
			(await evaluate('gizmoParts(selBone).map((p) => p.id).join()')) === 'rotate',
		);
		const c = await screenOf('upper_arm_l');
		const R =
			(await evaluate('gizmoGeom().ringR / renderer.camera.zoom')) /
			(await evaluate('window.devicePixelRatio || 1'));
		await drag({ x: c.x + Math.round(R), y: c.y }, { x: c.x, y: c.y - Math.round(R) }); // a quarter turn up
		const key = JSON.parse(
			await evaluate('JSON.stringify(rawDoc.animations[curAnim].bones.upper_arm_l || null)'),
		);
		const rot = key && key.rotate && key.rotate[0].value;
		ok(
			'a drag on the ring keys a rotation held to the limit (setup −90, limit [−120, −60])',
			rot !== undefined && Math.abs(rot - 30) < 0.01 && !key.translate,
			JSON.stringify(key),
		);
		await evaluate(
			'selectBone(skeletonData.bones.findIndex((b) => b.name === "hand_ik_l")); gizmoSpace = "view"; true',
		);
		ok(
			'the hand’s gizmo moves only (no ring)',
			(await evaluate('gizmoParts(selBone).map((p) => p.id).join()')) === 'move,x,y',
		);
		const h = await screenOf('hand_ik_l');
		const a = Math.round(
			(await evaluate('(gizmoGeom().axisFrom + gizmoGeom().axisTo) / 2 / renderer.camera.zoom')) /
				(await evaluate('window.devicePixelRatio || 1')),
		);
		await drag({ x: h.x + a, y: h.y }, { x: h.x + a + 40, y: h.y - 30 });
		const t = JSON.parse(
			await evaluate('JSON.stringify(rawDoc.animations[curAnim].bones.hand_ik_l.translate)'),
		);
		ok(
			'a drag on the x arrow keys a move along x only',
			t && t[0].x > 1 && Math.abs(t[0].y) < 1e-6,
			JSON.stringify(t),
		);
	});

	await step('4. a set selects both hands, ⟲ keys their rest pose', async () => {
		await evaluate(
			'[...document.querySelectorAll("#ctlPanel .ctlLine")].find((r) => r.textContent.startsWith("hands")).click(); true',
		);
		ok(
			'the set row selects both hands',
			await evaluate('selectedBoneNames().sort().join() === "hand_ik_l,hand_ik_r"'),
		);
		await evaluate('animTime = 0.5; syncPlayhead(); true');
		await evaluate(
			'[...document.querySelectorAll("#ctlPanel .ctlBar .ctlIcon")].find((b) => b.textContent === "⟲").click(); true',
		);
		const keys = JSON.parse(
			await evaluate(
				'JSON.stringify(["hand_ik_l", "hand_ik_r"].map((n) => rawDoc.animations[curAnim].bones[n]))',
			),
		);
		ok(
			'⟲ keys translate 0 at the playhead on both, and nothing the hand’s control locks',
			keys.every((k) =>
				k.translate.some((x) => Math.abs(x.time - 0.5) < 1e-3 && x.x === 0 && x.y === 0),
			) &&
				!keys[0].rotate &&
				keys[1].rotate,
			JSON.stringify(keys),
		);
	});

	await step('5. the Control card edits the sidecar; ↶ undoes it', async () => {
		await setMode('setup');
		await evaluate(
			'selectBone(skeletonData.bones.findIndex((b) => b.name === "lower_arm_l")); true',
		);
		ok(
			'the bone has a Control card, its description in its header tooltip',
			await evaluate('!!document.querySelector("#boneDetail .ctlCard > summary[title]")'),
		);
		const irig0 = await evaluate('JSON.stringify(rawDoc)');
		await evaluate(`(() => {
			const card = document.querySelector("#boneDetail .ctlCard"); card.open = true;
			const s = [...card.querySelectorAll(".ctlRow")].find((r) => r.firstChild.textContent === "shape").querySelector("select");
			s.value = "diamond"; s.dispatchEvent(new Event("change", { bubbles: true }));
		})(); true`);
		await wait(30);
		ok(
			'a shape picked in the card is the bone’s control',
			await evaluate(
				'controlsDoc.bones.lower_arm_l && controlsDoc.bones.lower_arm_l.shape === "diamond"',
			),
		);
		ok('the irig is untouched by it', (await evaluate('JSON.stringify(rawDoc)')) === irig0);
		await evaluate('historyFlush(); rigUndo(); true');
		ok('↶ undoes it', await evaluate('!(controlsDoc.bones && controlsDoc.bones.lower_arm_l)'));
		await evaluate('rigRedo(); true');
		ok('↷ redoes it', await evaluate('!!(controlsDoc.bones && controlsDoc.bones.lower_arm_l)'));
	});

	await step(
		'6. 💾 Save posts the sidecar under its ETag; a control edit leaves the skeleton as it was',
		async () => {
			const before = posted.length;
			await evaluate('saveToR2().then(() => true)');
			const first = posted.at(-1);
			ok('one save posted', posted.length === before + 1, `${posted.length - before}`);
			ok(
				'the save sends the sidecar and its base ETag',
				first &&
					first.controls &&
					first.controlsBaseEtag === '"c1"' &&
					first.controls.bones.lower_arm_l.shape === 'diamond',
				first && JSON.stringify(first.controlsBaseEtag),
			);
			ok(
				'the page takes the ETag the answer gave',
				await evaluate('controlsEtag === \'"c' + (posted.length + 1) + '"\''),
				await evaluate('controlsEtag'),
			);
			await evaluate(
				'setControlFields("lower_arm_l", { shape: "cross", colour: "#ff00ff" }); addControlLayer("Arms FK", ["upper_arm_l", "lower_arm_l"]); setLayerFlag("Arms FK", "visible", false); true',
			);
			await evaluate('saveToR2().then(() => true)');
			const second = posted.at(-1);
			ok('a second save posted', posted.length === before + 2, `${posted.length - before}`);
			ok(
				'the next save is conditional on that ETag',
				second.controlsBaseEtag === `"c${before + 2}"` && first !== second,
				second.controlsBaseEtag,
			);
			ok(
				'a control-only edit leaves the posted skeleton byte-identical',
				JSON.stringify(second.skeleton) === JSON.stringify(first.skeleton),
			);
			ok(
				'the sidecar says what was edited',
				second.controls.bones.lower_arm_l.shape === 'cross' &&
					second.controls.layers.some((l) => l.name === 'Arms FK' && l.visible === false),
			);
			await evaluate('saveToR2().then(() => true)');
			const third = posted.at(-1);
			ok(
				'a save with the layer unchanged does not send it (the stored one stays)',
				posted.length === before + 3 && !('controls' in third) && !('controlsBaseEtag' in third),
				`${posted.length - before} posts`,
			);
		},
	);

	await step('7. ＋ Two-bone IK’s new control is a control', async () => {
		await evaluate(
			'selectBone(skeletonData.bones.findIndex((b) => b.name === "lower_arm_l")); addConstraintPreset("twoBoneIk", null); true',
		);
		const made = JSON.parse(
			await evaluate(
				'JSON.stringify(Object.entries(controlsDoc.bones).filter(([, c]) => c.role === "control" && c.shape === "square").map(([n]) => n))',
			),
		);
		ok(
			'a square control, its preset recorded',
			made.includes('lower_arm_l_ik') &&
				(await evaluate(
					'controlsDoc.presets && controlsDoc.presets.lower_arm_l_ik === "twoBoneIk"',
				)),
			made.join(),
		);
		if (shotAt) {
			await wait(100);
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(shotAt, Buffer.from(shot.data, 'base64'));
			console.log(`  (stage saved to ${shotAt})`);
		}
	});

	await step('8. a rig with no control layer saves none', async () => {
		ok('W opens', await openRig('W'));
		await setMode('setup');
		ok(
			'no sidecar, editable',
			await evaluate('controlsDoc === null && controlsEtag === null && controlsLocked === null'),
		);
		const n = posted.length;
		await evaluate(CLICK_SAVE);
		ok(
			'💾 Save sends no controls at all',
			posted.length === n + 1 &&
				!('controls' in posted.at(-1)) &&
				!('controlsBaseEtag' in posted.at(-1)),
		);
		await evaluate(
			'setControlFields(skeletonData.bones[1].name, { hidden: true }); setControlFields(skeletonData.bones[1].name, { hidden: undefined }); true',
		);
		ok('a sidecar made and emptied again goes away', await evaluate('controlsDoc === null'));
	});

	await step('9. the page threw nothing', async () => {
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
