// Browser gate for the built-in templates' IK (docs/design/rig-controls.md §6.1, T12b), on the SHIPPED
// view.html and the committed vendor bundles in a real Chromium against a fake launcher API. Half body
// and Full body are opened as ＋ New rig makes them (the server's `templateRig`, its controls.json as
// `newRigControls` writes it), then checked the way an animator meets them:
//   - the 2D rig: the Picker shows an FK / IK switch per limb (Half body's arms, Full body's arms and
//     legs) reading “3D”, the IK controls are shown, and a click says to make the rig 3D first;
//   - 🧊 Make 3D writes the template's 3D IKs; the switches then read FK;
//   - in a 3D clip with the arm (and the leg) bent in FK, a click on the Picker's switch goes to IK with
//     no jump as the stage draws it and reads IK; a second click, later in the clip, back to FK with no
//     jump; ⤳ on the other arm matches IK to FK over the clip (the mix 1 at its keys, the hand where it
//     was);
//   - every edit bakes (no error line), the page throws nothing and sends nothing.
// What it does NOT cover: the data and its guards (`check:rig-templates`, mutation-checked).
//   node tools/rigger-spike/template-ik-browser.mjs [--shot <dir>]
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const shotAt = process.argv.indexOf('--shot');
const SHOTS = shotAt > 0 ? process.argv[shotAt + 1] : null;

const esbuild = await import(ESBUILD);
const tmp = mkdtempSync(join(tmpdir(), 'template-ik-browser-'));
const entry = join(tmp, 'entry.ts');
const lib = (f) => JSON.stringify(join(APP, 'src/lib', f).replace(/\\/g, '/'));
writeFileSync(entry, [`export * from ${lib('server/rigTemplates.ts')};`].join('\n'));
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
const { RIG_TEMPLATES, templateRig, rigTemplateFromSidecar } = await import(
	pathToFileURL(out).href
);

const NAMES = { 'full-body': 'Body', 'half-body': 'Half' };
const RIGS = {};
for (const t of RIG_TEMPLATES) {
	const name = NAMES[t.id];
	if (!name) continue;
	const lines = [];
	let x = 0;
	for (const p of t.parts) {
		lines.push(p.name, `bounds:${x},0,${p.size[0]},${p.size[1]}`);
		x += p.size[0];
	}
	const fit = templateRig(
		t,
		t.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
	);
	const rig = { ...fit.skeleton, animations: { take: {} } };
	RIGS[name] = {
		t,
		rig,
		atlas: [`${name}.png`, `size:${x},512`, 'filter:Linear,Linear', ...lines].join('\n'),
		// As ＋ New rig writes it (`newRigControls`), less the pair mark this fake never checks.
		controls: { controls: 1, rig: name, ...fit.controls },
		template: rigTemplateFromSidecar(JSON.stringify({ id: t.id, version: t.version })),
	};
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const PNG1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);
const posted = [];
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.png': 'image/png',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const json = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	const rigOf = () => RIGS[unb64(url.searchParams.get('dir') ?? '')] ?? null;
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
			const r = rigOf();
			const name = url.searchParams.get('name') ?? '';
			if (r && name.endsWith('.irig')) return json(r.rig);
			if (r && name.endsWith('.atlas')) return send(200, 'text/plain', r.atlas);
			if (name.endsWith('.png')) return send(200, 'image/png', PNG1);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: rigOf()?.template ?? null });
		if (p === '/api/editor/flipbooks') return json({ clips: [] });
		if (p === '/api/rigger/save' && req.method === 'GET') {
			const r = rigOf();
			return json({
				ok: true,
				projectKey: 'p',
				etag: '"i1"',
				rig3d: null,
				controls: r ? { etag: '"c1"', doc: r.controls } : null,
			});
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) {
			if (req.method !== 'GET') posted.push(`${req.method} ${p}`);
			return json({
				effects: [],
				atlases: [],
				rigs: [],
				animations: [],
				clips: [],
				backups: [],
				templates: [],
			});
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
	name: 'template-ik',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1100', '--mute-audio'],
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
const frames = (n = 3) =>
	evaluate(
		`new Promise((done) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : done(true)); requestAnimationFrame(f); })`,
	);
const settled = async () => {
	await waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		30000,
	);
	await frames();
};
const pageError = () =>
	evaluate(
		'(() => { const e = document.getElementById("err"); return e && e.style.display === "block" && !e.classList.contains("notice") ? e.textContent : ""; })()',
	);
const hint = () => evaluate('document.getElementById("hint").textContent');
const drawn = (n) =>
	evaluate(
		`(() => { const b = skeleton.findBone(${q(n)}); return { x: b.worldX, y: b.worldY }; })()`,
	);
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const setMode = (m) =>
	evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const mouse = (type, pt) =>
	send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
async function click(pt) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
	await mouse('mousePressed', pt);
	await mouse('mouseReleased', pt);
	await wait(40);
}
/** The Picker's switch for limb `limb` (`part`: its body, or its ⤳): its centre on screen. */
const switchAt = (limb, part = '') =>
	evaluate(`(() => {
		const b = [...document.querySelectorAll("#pickerPanel .pickBtn.limb")].find((x) => pickerLayout().items[Number(x.dataset.i)].limb === ${q(limb)});
		const e = b && (${q(part)} ? b.querySelector(${q(part)}) : b.querySelector(".nm"));
		if (!e) return null;
		e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
const stateOf = (limb) =>
	evaluate(
		`(() => { const b = [...document.querySelectorAll("#pickerPanel .pickBtn.limb")].find((x) => pickerLayout().items[Number(x.dataset.i)].limb === ${q(limb)}); return b ? b.querySelector(".st").textContent.trim().split(" · ")[0] : null; })()`,
	);
const spaceOf = (limb) =>
	evaluate(
		`(() => { const b = [...document.querySelectorAll("#pickerPanel .pickBtn.limb")].find((x) => pickerLayout().items[Number(x.dataset.i)].limb === ${q(limb)}); return b ? b.querySelector(".st").textContent.trim().split(" · ")[1] ?? null : null; })()`,
	);
const repaint = () => evaluate('renderControlPanel(); true');
const screenAt = (wx, wy) =>
	evaluate(`(() => {
		const cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(${wx}, ${wy}, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: r.left + v.x / dpr, y: r.top + cv.clientHeight - v.y / dpr };
	})()`);
const pickBone = async (n) => {
	await evaluate(
		`(() => { selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(n)})); renderBoneDetail(); return true; })()`,
	);
	await frames();
};
/** Drag the selected bone's drawn arrow `id` by about `t` (world units along its drawing). */
async function dragArrow(id, t) {
	const z = await evaluate(
		`(() => { const p = gizmoParts(selBone).find((x) => x.id === ${q(id)}); return p && { dir: p.dir, c: gizmoCenter(), G: gizmoGeom() }; })()`,
	);
	if (!z) return null;
	const at = async (u) => {
		const p = await screenAt(z.c.x + z.dir[0] * u, z.c.y + z.dir[1] * u);
		return { x: Math.round(p.x), y: Math.round(p.y) };
	};
	const m0 = (z.G.axisFrom + z.G.axisTo) / 2;
	const from = await at(m0);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await mouse('mousePressed', from);
	for (let k = 1; k <= 8; k++) {
		const p = await at(m0 + (t * k) / 8);
		await send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x: p.x,
			y: p.y,
			button: 'left',
			buttons: 1,
		});
	}
	await mouse('mouseReleased', await at(m0 + t));
	await frames();
	return z;
}
// The Picker's buttons: any two overlapping (by more than a pixel), any not whole on the board.
const pickerClash = () =>
	evaluate(`(() => {
		const b = document.querySelector("#pickerPanel .pickBoard:not(.faceBoard)"); if (!b) return "no board";
		const B = b.getBoundingClientRect();
		const rs = [...b.querySelectorAll(".pickBtn")].map((e) => ({ n: e.textContent.trim(), r: e.getBoundingClientRect() }));
		const bad = [];
		rs.forEach((a, i) => rs.slice(i + 1).forEach((c) => {
			const x = Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left), y = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top);
			if (x > 1 && y > 1) bad.push(a.n + " / " + c.n);
		}));
		for (const a of rs) if (a.r.left < B.left - 1 || a.r.right > B.right + 1 || a.r.top < B.top - 1 || a.r.bottom > B.bottom + 1) bad.push(a.n + " off");
		return bad.join(", ");
	})()`);
async function openRig(name) {
	await evaluate(`(() => {
		document.getElementById("loadRigBtn").click();
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === ${q(name)});
		if (row) row.click();
		return !!row;
	})()`);
	await waitFor(
		`!!skeleton && !!rawDoc && !!controlsDoc && controlsDoc.rig === ${q(name)} && !!rigTemplate`,
		30000,
	);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
}

try {
	await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2', 30000);
	await evaluate(
		'window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true',
	);
	for (const [name, R] of Object.entries(RIGS)) {
		const limbs = Object.keys(R.controls.limbs);
		const legs = limbs.includes('leg_l');
		await step(`${R.t.label} (${name}): ${limbs.join(', ')}`, async () => {
			await openRig(name);
			await setMode('setup');
			await evaluate(
				'fitView(); document.getElementById("secCtl").open = true; document.getElementById("secPicker").open = true; renderControlPanel(); true',
			);
			const states = await Promise.all(limbs.map((l) => stateOf(l)));
			ok(
				`the 2D rig's Picker shows a switch per limb, each reading 3D`,
				states.every((s) => s === '3D'),
				q(states),
			);
			const shown = JSON.parse(
				await evaluate(
					`JSON.stringify(Object.keys(controlsDoc.bones).filter((n) => /^(hand|foot)_ik_[lr]$|_pole_[lr]$/.test(n)).filter((n) => boneControlState(n).hidden))`,
				),
			);
			ok('the IK controls and poles are shown (Body IK on)', shown.length === 0, shown.join(','));
			await setMode('animate');
			await click(await switchAt('arm_l'));
			ok(
				'a click on the 2D rig says to make it 3D first, and keys nothing',
				/make the rig 3D first/.test(await hint()) &&
					(await evaluate('JSON.stringify(animOf("take"))')) === '{}',
				await hint(),
			);

			await setMode('preview');
			await evaluate(
				'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
			);
			await waitFor('!!rig3d.doc && !!window.Rigger2p5d', 15000);
			const ik = JSON.parse(
				await evaluate('JSON.stringify((rig3d.doc.ik || []).map((e) => e.name))'),
			);
			ok(
				`🧊 Make 3D writes the template's 3D IKs`,
				q(ik) === q(R.t.rig3d.ik.map((e) => e.name)),
				q(ik),
			);
			const dup = await evaluate('presetTargetProblem("ik3d", "lower_arm_l", "hand_ik_l")');
			ok(
				'a second Two-bone IK in 3D reaching the hand control is refused, naming its limb',
				/already limb arm_l's control/.test(dup || ''),
				String(dup),
			);

			await setMode('animate');
			await waitFor('animMode', 10000);
			await evaluate(
				'setCurAnim("take"); animTime = 0; playing = false; convertClip3d("take"); true',
			);
			await settled();
			await evaluate('clearErr(); rig3d.doc.clips.take.duration = 1; markDirty(); true');
			await settled();
			// The arm (and the leg) bent in FK, so the control has room within the limb's reach.
			await evaluate(`(() => {
				const r = (n) => skeletonData.findBone(n).rotation;
				for (const s of ["l", "r"]){
					set3dValue("upper_arm_" + s, "rotate", r("upper_arm_" + s) + (s === "l" ? 30 : -30));
					set3dValue("lower_arm_" + s, "rotate", r("lower_arm_" + s) + (s === "l" ? 70 : -70));
					${legs ? 'set3dValue("thigh_" + s, "rotate", r("thigh_" + s) + (s === "l" ? 15 : -15)); set3dValue("shin_" + s, "rotate", r("shin_" + s) + (s === "l" ? -40 : 40));' : ''}
				}
				markDirty(); return true;
			})()`);
			await settled();
			await evaluate('animTime = 1; syncPlayhead(); true');
			await evaluate(
				`(() => { const r = (n) => skeletonData.findBone(n).rotation; set3dValue("lower_arm_l", "rotate", r("lower_arm_l") + 40); set3dValue("lower_arm_r", "rotate", r("lower_arm_r") - 40); markDirty(); return true; })()`,
			);
			await settled();
			ok('the posed 3D clip bakes', !(await pageError()), await pageError());
			await evaluate('animTime = 0; syncPlayhead(); true');
			await frames();
			await repaint();
			const st3 = await Promise.all(limbs.map(async (l) => [await stateOf(l), await spaceOf(l)]));
			ok(
				'the switches read FK on the 3D rig, the hands in chest space and the feet in world space',
				st3.every(
					([s, sp], i) => s === 'FK' && sp === (limbs[i].startsWith('arm') ? 'chest' : 'world'),
				),
				q(st3),
			);

			// A click on the switch: FK → IK at 0.
			const fk0 = await drawn('hand_l');
			await click(await switchAt('arm_l'));
			await settled();
			await repaint();
			const ik0 = await drawn('hand_l');
			ok(
				'a click on IK arm L switches it to IK with no jump, and it reads IK',
				!(await pageError()) &&
					apart(fk0, ik0) < 0.5 &&
					(await stateOf('arm_l')) === 'IK' &&
					(await evaluate('Rigger2p5d.ik3dMixAt(rig3d.doc, "take", "arm_ik_l", 0.01)')) === 1,
				q({ fk0, ik0, err: await pageError(), hint: await hint(), st: await stateOf('arm_l') }),
			);
			// Turned 45°, drag the hand control: it follows its chest space, so the drag keys the space bone
			// carrying it, and the hand rides the control.
			await setMode('animate');
			await evaluate('setViewTurn(45); true');
			await pickBone('hand_ik_l');
			const beforeDrag = await drawn('hand_l');
			const keysOf = () =>
				evaluate(
					'JSON.stringify([rig3d.doc.clips.take.bones.hand_ik_l_chest || null, rig3d.doc.clips.take.bones.hand_ik_l || null, ((animOf("take").bones || {}).hand_ik_l || null)])',
				);
			const keysBefore = await keysOf();
			const z = await dragArrow('x', 25);
			await settled();
			const afterDrag = await drawn('hand_l');
			const onCtl = apart(afterDrag, await drawn('hand_ik_l'));
			const [sp0, own0, own2d0] = JSON.parse(keysBefore);
			const [sp1, own1, own2d1] = JSON.parse(await keysOf());
			const carried = q(sp0) !== q(sp1) && q(own0) === q(own1) && q(own2d0) === q(own2d1);
			ok(
				'turned 45°: dragging the hand control moves the arm, the hand on the control, keyed on its chest space bone',
				!!z && !(await pageError()) && apart(beforeDrag, afterDrag) > 5 && onCtl < 1 && carried,
				q({
					moved: apart(beforeDrag, afterDrag),
					onCtl,
					sp0,
					sp1,
					own0,
					own1,
					err: await pageError(),
					hint: await hint(),
				}),
			);
			await evaluate('setViewTurn(0); true');
			await frames();
			// Later in the clip, back to FK.
			await evaluate('animTime = 0.6; syncPlayhead(); true');
			await frames();
			await repaint();
			const ik6 = await drawn('hand_l');
			await click(await switchAt('arm_l'));
			await settled();
			await repaint();
			const fk6 = await drawn('hand_l');
			ok(
				'a second click at 0.6s goes back to FK with no jump, and it reads FK',
				!(await pageError()) &&
					apart(ik6, fk6) < 0.5 &&
					(await stateOf('arm_l')) === 'FK' &&
					(await evaluate('Rigger2p5d.ik3dMixAt(rig3d.doc, "take", "arm_ik_l", 0.61)')) === 0,
				q({ ik6, fk6, err: await pageError(), hint: await hint() }),
			);

			// ⤳ on the right arm: matched to IK over the clip.
			const atR = async (t) => {
				await evaluate(`animTime = ${t}; syncPlayhead(); true`);
				await frames();
				return drawn('hand_r');
			};
			const r0 = await atR(0);
			const r1 = await atR(1);
			await evaluate('animTime = 0.3; syncPlayhead(); true');
			await repaint();
			await click(await switchAt('arm_r', '.mt'));
			await settled();
			const mixes = JSON.parse(
				await evaluate('JSON.stringify((rig3d.doc.clips.take.ik || {}).arm_ik_r || [])'),
			);
			const m0 = await atR(0);
			const m1 = await atR(1);
			ok(
				'⤳ on IK arm R matches IK to FK over the clip: the mix 1 from the start, the hand where FK put it at its keys',
				!(await pageError()) &&
					mixes.length >= 2 &&
					mixes.every((m) => m.mix === 1) &&
					apart(r0, m0) < 0.5 &&
					apart(r1, m1) < 0.5,
				q({ mixes, d0: apart(r0, m0), d1: apart(r1, m1), hint: await hint() }),
			);

			await evaluate('animTime = 0.3; syncPlayhead(); true');
			await repaint();
			ok(
				'with the switches reading IK and their space, no two Picker buttons overlap, each whole on the board',
				(await pickerClash()) === '',
				await pickerClash(),
			);
			if (legs) {
				await evaluate('animTime = 0; syncPlayhead(); true');
				await frames();
				await repaint();
				const f0 = await drawn('foot_l');
				await click(await switchAt('leg_l'));
				await settled();
				await repaint();
				const f1 = await drawn('foot_l');
				ok(
					'a click on IK leg L switches it to IK with no jump, and it reads IK',
					!(await pageError()) && apart(f0, f1) < 0.5 && (await stateOf('leg_l')) === 'IK',
					q({ f0, f1, err: await pageError(), hint: await hint() }),
				);
			}
			if (SHOTS) {
				const shot = await send('Page.captureScreenshot', { format: 'png' });
				writeFileSync(join(SHOTS, `t12b-${name}.png`), Buffer.from(shot.data, 'base64'));
			}
		});
	}
	const errs = pageLog.filter((l) => /error|uncaught/i.test(l));
	ok(
		'the page throws nothing and shows no alert',
		errs.length === 0 && (await evaluate('window.__alerts.length')) === 0,
		errs.slice(0, 3).join(' | ') + (await evaluate('window.__alerts.join(" | ")')),
	);
	ok('the page sends nothing', posted.length === 0, posted.join(', '));
} finally {
	await browser.close();
	server.close();
}
console.log(`\n${pass}/${pass + fail} template-ik browser checks pass`);
process.exit(fail ? 1 : 0);
