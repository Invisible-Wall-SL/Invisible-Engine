// Browser gate for foot plant (rig-controls K3, docs/design/rig-controls.md §6.3), on the SHIPPED
// view.html and the committed vendor bundles in a real Chromium against a fake launcher API. A Full
// body rig as ＋ New rig makes it (the server's `templateRig`, its controls.json), made 3D, takes a 🎥
// Motion import in 3D of a performer stepping in place (`performer3d.mjs`) with 📍 Follow positions.
// Checked the way an animator meets it:
//  - the Motion row offers 👣 Plant feet or Feet as tracked, Plant feet by default (tooltip);
//  - imported as tracked, the legs keep their FK (no IK key) and a stance foot slides;
//  - imported with the feet planted, one undo step: each stance is a contact at IK mix 1 and the foot
//    holds where it landed as the page's engine-rig plays the bake, with no jump where it lands or
//    lifts, and between contacts the feet are where the as-tracked import put them; the report says
//    so; the clip bakes; imported again over it, the feet are planted afresh; one undo takes an
//    import and its plant back together;
//  - the leg's Limb card: 👣 Plant on an as-tracked import plants that foot only; a second click is
//    refused (the leg is in IK already) and keys nothing;
//  - the page throws nothing, shows no alert and sends nothing.
// `--track <file>` imports a saved MediaPipe track instead (a capture's `{ width, height, frames }`)
// and prints what foot plant made of it — the measurement on real footage, not a gate.
//   node tools/rigger-spike/foot-plant-browser.mjs
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
if (!existsSync(join(STATIC, 'rigger/vendor/mediapipe/vision_wasm_internal.wasm')))
	spawnSync('node', [join(APP, 'scripts/copy-mediapipe-wasm.mjs')], { stdio: 'inherit' });
const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : null;
};
const TRACK_FILE = arg('--track');
const SHOTS = arg('--shot');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'foot-plant-browser-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { rigTemplateById, templateRig, rigTemplateFromSidecar } = await import(
	pathToFileURL(out).href
);

const T = rigTemplateById('full-body');
const lines = [];
let x = 0;
for (const p of T.parts) {
	lines.push(p.name, `bounds:${x},0,${p.size[0]},${p.size[1]}`);
	x += p.size[0];
}
const fit = templateRig(
	T,
	T.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
);
const RIG = {
	rig: { ...fit.skeleton, animations: { take: {} } },
	atlas: ['Body.png', `size:${x},512`, 'filter:Linear,Linear', ...lines].join('\n'),
	controls: { controls: 1, rig: 'Body', ...fit.controls },
	template: rigTemplateFromSidecar(JSON.stringify({ id: T.id, version: T.version })),
};

// The performer: 3 s at 24 fps stepping in place — leg l up over [0.1, 0.45) of each second, leg r
// over [0.6, 0.95) — each stance thigh swaying ±4° in the picture (the FK foot slides).
const FPS = 24;
const SECS = 3;
const lift = (s, t) => {
	const ph = t % 1;
	const a = s === 'l' ? 0.1 : 0.6;
	return ph >= a && ph < a + 0.35 ? Math.sin((Math.PI * (ph - a)) / 0.35) : 0;
};
const poseAt = (t) => {
	const legs = {};
	for (const s of ['l', 'r']) {
		const u = lift(s, t);
		const sway = u ? 0 : 4 * Math.sin(2 * Math.PI * t);
		legs[s] = { upper: P.dir(sway, 70 * u), lower: P.dir(sway, -20 * u) };
	}
	return { legs };
};
const TRACK = TRACK_FILE
	? (() => {
			const j = JSON.parse(readFileSync(TRACK_FILE, 'utf8'));
			return j.track ?? j[0]?.track ?? j;
		})()
	: P.track(SECS * FPS + 1, FPS, (i, t) => ({ pose: poseAt(t), opts: { face: P.ry(0) } }));
const LEN = TRACK.frames.at(-1).t;
/** How long a planted foot takes to let go as it lifts (`FOOT_PLANT.release`). */
const RELEASE = 0.15;
/** The stances, by the performer's construction (those long enough to be a contact). */
function stances(s) {
	const out = [];
	let from = 0;
	for (let c = 0; c < SECS; c++) {
		const a = c + (s === 'l' ? 0.1 : 0.6);
		if (a > from) out.push([from, Math.min(a, SECS)]);
		from = a + 0.35;
	}
	if (from < SECS) out.push([from, SECS]);
	return out.filter(([a, b]) => b - a >= 0.15);
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const posted = [];
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.png': 'image/png',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.task': 'application/octet-stream',
};
const PNG1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);
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
		if (p === '/track.json') return json(TRACK);
		if (p === '/rig-viewer/skeletons')
			return json({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: [
					{
						id: 0,
						name: 'Body',
						folder: 'Body',
						dir_b64: b64('Body'),
						skeleton_file: 'Body.irig',
						atlas_file: 'Body.atlas',
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
			if (name.endsWith('.png')) return send(200, 'image/png', PNG1);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: RIG.template });
		if (p === '/api/editor/flipbooks') return json({ clips: [] });
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({
				ok: true,
				projectKey: 'p',
				etag: '"i1"',
				rig3d: null,
				controls: { etag: '"c1"', doc: RIG.controls },
			});
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
	name: 'foot-plant',
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
const frames = (n = 3) =>
	evaluate(
		`new Promise((done) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : done(true)); requestAnimationFrame(f); })`,
	);
const settled = async () => {
	await waitFor(
		'!bake3d.pending && !document.getElementById("loadingOverlay").classList.contains("on")',
		120000,
	);
	await frames();
};
const pageError = () =>
	evaluate(
		'(() => { const e = document.getElementById("err"); return e && e.style.display === "block" && !e.classList.contains("notice") ? e.textContent : ""; })()',
	);
const hint = () => evaluate('document.getElementById("hint").textContent');
const setMode = (m) =>
	evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const keyBtn = `[...document.querySelectorAll("#faceList .faceMotion button")].find((b) => b.textContent.includes("Key at playhead"))`;
/**
 * The feet (and the shins) as the page's engine-rig plays clip "take" as baked (the rig rebuilt from
 * the page's irig, as the save sends it), every `dt` s over [0, end].
 */
const played = (dt = 1 / 60) =>
	evaluate(`(() => {
		rebuildFromRawDoc(null);
		const out = [];
		for (let t = 0; t <= ${LEN} + 1e-9; t += ${dt}) {
			const s = new RIG.Skeleton(skeletonData);
			const st = new RIG.AnimationState(new RIG.AnimationStateData(skeletonData));
			st.setAnimation(0, "take", false); st.update(t); st.apply(s);
			s.updateWorldTransform(RIG.Physics ? RIG.Physics.update : undefined);
			const b = (n) => [s.findBone(n).worldX, s.findBone(n).worldY];
			out.push({ t, foot_l: b("foot_l"), foot_r: b("foot_r"), shin_l: b("shin_l"), shin_r: b("shin_r") });
		}
		return out;
	})()`);
const contactsOf = () =>
	evaluate(`(() => {
		const out = {};
		for (const s of ["l", "r"]) {
			const keys = ((rig3d.doc.clips.take || {}).ik || {})["leg_ik_" + s] || [];
			// From its first key at mix 1 to its last before the mix lets go.
			const runs = []; let from = null, last = null;
			for (const k of keys) {
				if (k.mix === 1){ if (from === null) from = k.time; last = k.time; }
				else if (from !== null) { runs.push([from, last]); from = null; }
			}
			if (from !== null) runs.push([from, ${LEN}]);
			out[s] = runs;
		}
		return out;
	})()`);
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
async function importTake(plant) {
	await evaluate(`(async () => {
		faceMotionReport = null; faceMotionPlant = ${plant}; faceMotionFollow = true; renderFacePanel();
		return true;
	})()`);
	await evaluate(`${keyBtn}.click(); true`);
	await waitFor('!!faceMotionReport || window.__alerts.length > 0', 180000);
	await settled();
}
/** How far each foot moves within each run of `runs`, and the worst jump across a run's ends. */
function measure(poses, runs) {
	let held = 0;
	let jump = 0;
	for (const s of ['l', 'r'])
		for (const [a, b] of runs[s]) {
			const inside = poses.filter((p) => p.t > a + 1e-3 && p.t < b - 1e-3);
			if (!inside.length) continue;
			for (const p of inside) held = Math.max(held, apart(p[`foot_${s}`], inside[0][`foot_${s}`]));
		}
	return { held, jump };
}

try {
	await waitFor('typeof skeletons !== "undefined" && skeletons.length === 1', 30000);
	await evaluate(
		'window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true',
	);
	await evaluate(`(() => {
		document.getElementById("loadRigBtn").click();
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "Body");
		if (row) row.click();
		return !!row;
	})()`);
	await waitFor('!!skeleton && !!rawDoc && !!controlsDoc && !!rigTemplate', 30000);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await setMode('preview');
	await evaluate(
		'(() => { const s = document.getElementById("rig3dSel"); s.value = "side"; s.dispatchEvent(new Event("change")); return true; })()',
	);
	await waitFor('!!rig3d.doc && !!window.Rigger2p5d', 15000);
	await setMode('animate');
	await waitFor('animMode', 10000);
	await evaluate(
		'setCurAnim("take"); animTime = 0; playing = false; faceMotionOpen = true; renderFacePanel(); true',
	);
	await waitFor('!!document.querySelector("#faceList .faceMotion select")', 10000);
	if (!(await evaluate('ensureRiggerMotion()'))) throw new Error('the motion bundle did not load');
	await evaluate(`(async () => {
		const track = await (await fetch("/track.json")).json();
		RiggerMotion.videoFrames = async () => ({ width: track.width, height: track.height, count: track.frames.length, seconds: ${LEN}, frames: (async function* () {})(), close() {} });
		RiggerMotion.track = async () => track;
		faceMotionFile = new File(["x"], "take.webm"); faceMotionSrc = "video";
		renderFacePanel();
		return true;
	})()`);

	if (TRACK_FILE) {
		await importTake(false);
		const tracked = await played();
		await evaluate('rigUndo(); true');
		const t0 = Date.now();
		await importTake(true);
		const ms = Date.now() - t0;
		const runs = await contactsOf();
		const planted = await played();
		const slide = { l: [], r: [] };
		for (const s of ['l', 'r'])
			for (const [a, b] of runs[s]) {
				const inside = tracked.filter((p) => p.t > a + 1e-3 && p.t < b - 1e-3);
				let m = 0;
				for (const p of inside) m = Math.max(m, apart(p[`foot_${s}`], inside[0][`foot_${s}`]));
				slide[s].push(+m.toFixed(1));
			}
		console.log(q({ runs, slide, planted: measure(planted, runs), ms }, null, 1));
		console.log((await evaluate('faceMotionReport')).slice(0, 3).join('\n'));
		if (SHOTS) {
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(join(SHOTS, 'foot-plant-track.png'), Buffer.from(shot.data, 'base64'));
		}
		process.exitCode = 0;
	} else {
		let tracked = null;
		let slid = 0;
		await step('1. the Motion row', async () => {
			const row = await evaluate(`(() => {
				const s = document.querySelector("#faceList .faceMotion select.faceMotionPlant");
				return s && { value: s.value, options: [...s.options].map((o) => o.textContent), tip: s.title.length > 80 };
			})()`);
			ok(
				'the Motion row offers 👣 Plant feet or Feet as tracked, Plant feet by default (tooltip)',
				!!row &&
					row.value === '1' &&
					q(row.options) === q(['👣 Plant feet', 'Feet as tracked']) &&
					row.tip,
				q(row),
			);
		});
		await step('2. imported as tracked', async () => {
			await importTake(false);
			tracked = await played();
			const keys = await evaluate('JSON.stringify(((rig3d.doc.clips.take || {}).ik) || {})');
			slid = measure(tracked, { l: stances('l'), r: stances('r') }).held;
			ok(
				'the legs keep their FK (no IK key), the clip bakes, and a stance foot slides',
				keys === '{}' && !(await pageError()) && slid > 3,
				q({ keys, slid, err: await pageError() }),
			);
		});
		await step('3. imported with the feet planted', async () => {
			await evaluate('rigUndo(); true');
			await settled();
			await importTake(true);
			const runs = await contactsOf();
			const want = { l: stances('l'), r: stances('r') };
			const found = ['l', 'r'].every(
				(s) =>
					runs[s].length === want[s].length &&
					runs[s].every(
						([a, b], i) =>
							Math.abs(a - want[s][i][0]) < 3 / FPS && Math.abs(b - want[s][i][1]) < 3 / FPS,
					),
			);
			ok('each stance is a contact at IK mix 1, and only the stances', found, q({ runs, want }));
			const planted = await played();
			const m = measure(planted, runs);
			if (process.env.DEBUG_PLANT) {
				console.log(q(runs));
				for (const s of ['l', 'r'])
					for (const [a, b] of runs[s]) {
						const inside = planted.filter((p) => p.t > a + 1e-3 && p.t < b - 1e-3);
						console.log(
							s,
							a,
							b,
							inside.map((p) => p[`foot_${s}`].map((v) => v.toFixed(1)).join(',')).join(' | '),
						);
					}
				console.log(
					await evaluate(
						`(() => { const R = Rigger2p5d, rig = R.rigOf(rawDoc, rig3d.doc), plan = R.clipOf(rig, rawDoc, rig3d.doc, "take"); const sol = R.solveIk3d(rig, plan.clip); const out = []; for (const t of [0.7, 0.8, 0.9, 1.0]) { const w = R.pose3d(rig, sol, t); out.push(t + ": " + w.get("foot_l").o.map((v) => v.toFixed(1)).join(",") + " ctl " + w.get("foot_ik_l_world").o.map((v) => v.toFixed(1)).join(",")); } return out.join(" | ") + " sig " + (bake3d.sig.take === bake3dSig("take")); })()`,
					),
				);
			}
			ok(
				'…each foot holds where it landed as the page’s engine-rig plays the bake (within 0.5)',
				m.held < 0.5,
				q(m),
			);
			let jump = 0;
			let away = 0;
			for (const s of ['l', 'r'])
				for (const [a, b] of runs[s])
					for (const t of [a, b]) {
						if (t <= 0 || t >= LEN - 1e-3) continue;
						const i = planted.findIndex((p) => p.t > t + 1e-4);
						for (const n of [`foot_${s}`, `shin_${s}`])
							jump = Math.max(
								jump,
								apart(planted[i][n], planted[i - 1][n]) - apart(tracked[i][n], tracked[i - 1][n]),
							);
					}
			for (const p of planted) {
				const inRun = (s) =>
					runs[s].some(([a, b]) => p.t > a - 2 / FPS && p.t < b + RELEASE + 2 / FPS);
				const i = planted.indexOf(p);
				for (const s of ['l', 'r'])
					if (!inRun(s)) away = Math.max(away, apart(p[`foot_${s}`], tracked[i][`foot_${s}`]));
			}
			const step60 = Math.max(
				...tracked
					.slice(1)
					.flatMap((p, i) => ['foot_l', 'foot_r'].map((n) => apart(p[n], tracked[i][n]))),
			);
			ok(
				`…no jump where a foot lands or lifts: ${jump.toFixed(2)} more than the as-tracked foot moves in a 60th of a second (the slide it lets go of, ${slid.toFixed(1)}, spread over ${RELEASE} s; the swing ${step60.toFixed(1)})`,
				jump < 1 + (2 * slid) / 60 / RELEASE,
				q({ jump, step60 }),
			);
			ok(
				'…and between contacts the feet are where the as-tracked import put them (within 0.5)',
				away < 0.5,
				away.toFixed(3),
			);
			const report = await evaluate('faceMotionReport');
			ok(
				'the report says the feet were planted, and the clip bakes',
				report.some((l) => l.startsWith('👣 Feet planted — contacts: leg ik l ')) &&
					!(await pageError()),
				q(report.slice(0, 3)),
			);
			// The same take imported again over the planted clip: planted afresh, not refused.
			await importTake(true);
			const again = await contactsOf();
			const said = await evaluate('faceMotionReport');
			ok(
				'imported again over the planted clip, the feet are planted afresh (the same contacts)',
				q(again) === q(runs) && said.some((l) => l.startsWith('👣 Feet planted')),
				q({ again, said: said.slice(0, 3) }),
			);
			await evaluate('rigUndo(); true');
			await settled();
			await evaluate('rigUndo(); true');
			await settled();
			const undone = await evaluate(
				'({ ik: JSON.stringify((((rig3d.doc.clips || {}).take || {}).ik) || {}), keys: Object.keys((rawDoc.animations.take || {}).bones || {}).length })',
			);
			ok(
				'one undo takes the import and the plant back together',
				undone.ik === '{}' && undone.keys === 0,
				q(undone),
			);
		});
		await step('4. the leg’s Limb card', async () => {
			await importTake(false);
			await evaluate(
				'selectBone(skeletonData.bones.findIndex((b) => b.name === "foot_ik_l")); animTime = 0; syncPlayhead(); buildInspector(selected); true',
			);
			await frames();
			const card = await evaluate(
				'(document.querySelector("#boneDetail .limbCard > summary span") || {}).textContent || ""',
			);
			const clicked = await evaluate(
				`(() => { const b = [...document.querySelectorAll("#boneDetail .limbCard button")].find((x) => x.textContent.trim() === "👣 Plant" && !x.disabled); if (b) b.click(); return !!b; })()`,
			);
			await settled();
			const runs = await contactsOf();
			ok(
				'👣 Plant on leg l’s card plants that foot only',
				/Limb · leg_l/.test(card) &&
					clicked &&
					runs.l.length === stances('l').length &&
					runs.r.length === 0 &&
					/👣 leg_l planted in \d+ contacts/.test(await hint()) &&
					!(await pageError()),
				q({ card, clicked, runs, hint: await hint(), err: await pageError() }),
			);
			const before = await evaluate('JSON.stringify(rig3d.doc.clips.take)');
			await evaluate('buildInspector(selected); true');
			await evaluate(
				`(() => { const b = [...document.querySelectorAll("#boneDetail .limbCard button")].find((x) => x.textContent.trim() === "👣 Plant" && !x.disabled); if (b) b.click(); return !!b; })()`,
			);
			ok(
				'a second click is refused (the leg is in IK already) and keys nothing',
				/already switches to IK/.test(await hint()) &&
					(await evaluate('JSON.stringify(rig3d.doc.clips.take)')) === before,
				await hint(),
			);
			if (SHOTS) {
				const shot = await send('Page.captureScreenshot', { format: 'png' });
				writeFileSync(join(SHOTS, 'foot-plant.png'), Buffer.from(shot.data, 'base64'));
			}
		});
		const errs = pageLog.filter((l) => /error|uncaught/i.test(l));
		ok(
			'the page throws nothing and shows no alert',
			errs.length === 0 && (await evaluate('window.__alerts.length')) === 0,
			errs.slice(0, 3).join(' | ') + (await evaluate('window.__alerts.join(" | ")')),
		);
		ok('the page sends nothing', posted.length === 0, posted.join(', '));
	}
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	await browser.close();
	server.close();
}
if (!TRACK_FILE) console.log(`\n${pass}/${pass + fail} foot-plant browser checks pass`);
process.exit(fail ? 1 : 0);
