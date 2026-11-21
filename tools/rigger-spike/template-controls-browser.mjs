// Browser gate for the built-in templates' control layer (docs/design/rig-controls.md §6.1, T12a), on the
// SHIPPED view.html in a real Chromium against a fake launcher API. Each built-in (Bust with face, Full
// body, Half body) is opened as ＋ New rig makes it: the server's `templateRig` over placeholder art, its
// `controls.json` as `newRigControls` writes it (bound to the rig), its template as `/api/rigger/template`
// answers. Checked, per template, the way an animator meets it:
//   - the rig opens with its control layer: rings on the FK bones drawn on the stage, the IK controls
//     and the helpers hidden;
//   - the Picker shows the template's layout: a button per ring and square, the sets, none overlapping,
//     each whole on the board; a click selects its bone, a set button selects the set;
//   - the face board shows every channel the template places, none overlapping; dragging a slider keys
//     its channel at the playhead in Animate;
//   - Full body: turning the spine's ring keys Lean — the chest turns half as much and the Lean slider
//     reads it — and a ring past its channel's range is held to it; a ring on a free bone keys itself;
//   - the page throws nothing.
// What it does NOT cover: the data and its guards (`check:rig-templates`, mutation-checked), the routes
// writing it (`check:rigger-writes`).
//   node tools/rigger-spike/template-controls-browser.mjs [--shot <dir>]
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
const out = join(mkdtempSync(join(tmpdir(), 'template-controls-browser-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { RIG_TEMPLATES, templateRig, rigTemplateFromSidecar } = await import(pathToFileURL(out).href);

const NAMES = { 'bust-face': 'Bust', 'full-body': 'Body', 'half-body': 'Half' };
const RIGS = {};
for (const t of RIG_TEMPLATES) {
	const name = NAMES[t.id];
	const lines = [];
	let x = 0;
	for (const p of t.parts) {
		lines.push(p.name, `bounds:${x},0,${p.size[0]},${p.size[1]}`);
		x += p.size[0];
	}
	const fit = templateRig(t, t.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })));
	const rig = { ...fit.skeleton, animations: { take: {} } };
	RIGS[name] = {
		t,
		rig,
		atlas: [`${name}.png`, `size:${x},512`, 'filter:Linear,Linear', ...lines].join('\n'),
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' };
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
		if (p === '/api/rigger/save' && req.method === 'GET') {
			const r = rigOf();
			return json({ ok: true, projectKey: 'p', etag: '"i1"', rig3d: null, controls: r ? { etag: '"c1"', doc: r.controls } : null });
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) {
			if (req.method !== 'GET') posted.push(`${req.method} ${p}`);
			return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [], templates: [] });
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
const browser = await launchChrome({ name: 'template-controls', url: `http://127.0.0.1:${PORT}/`, args: ['--window-size=1600,1100', '--mute-audio'] });
const { evaluate, waitFor, send, pageLog } = browser;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) pass++;
	else fail++;
	console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
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
const settle = () => waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
async function openRig(name) {
	const found = await evaluate(`(() => {
		document.getElementById("loadRigBtn").click();
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === ${q(name)});
		if (row) row.click();
		return !!row;
	})()`);
	await settle();
	await waitFor(`!!skeleton && !!rawDoc && !!controlsDoc && controlsDoc.rig === ${q(name)} && !!rigTemplate`, 20000);
	return found;
}
const setMode = (m) => evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const mouse = (type, pt, extra = {}) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, ...extra });
async function click(pt) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
	await mouse('mousePressed', pt);
	await mouse('mouseReleased', pt);
	await wait(40);
}
async function drag(from, to) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await mouse('mousePressed', from);
	for (let i = 1; i <= 6; i++)
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + ((to.x - from.x) * i) / 6), y: Math.round(from.y + ((to.y - from.y) * i) / 6), button: 'left', buttons: 1 });
	await mouse('mouseReleased', to);
	await wait(60);
}
const centreOf = (sel) =>
	evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const selNames = async () => JSON.parse(await evaluate('JSON.stringify(selectedBoneNames().slice().sort())'));
// The rects of `sel` inside `board`: any two overlapping (by more than a pixel), any not whole on it.
const layoutOf = (board, sel) =>
	evaluate(`(() => {
		const b = document.querySelector(${q(board)}); if (!b) return null;
		const B = b.getBoundingClientRect();
		const rs = [...b.querySelectorAll(${q(sel)})].map((e) => ({ n: e.dataset.bone || e.textContent.trim().slice(0, 24), r: e.getBoundingClientRect() }));
		const over = [];
		rs.forEach((a, i) => rs.slice(i + 1).forEach((c) => {
			const x = Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left), y = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top);
			if (x > 1 && y > 1) over.push(a.n + " / " + c.n);
		}));
		const out = rs.filter((a) => a.r.left < B.left - 1 || a.r.right > B.right + 1 || a.r.top < B.top - 1 || a.r.bottom > B.bottom + 1).map((a) => a.n);
		return { n: rs.length, over, out, h: B.height, w: B.width };
	})()`);

try {
	await waitFor('typeof skeletons !== "undefined" && skeletons.length === 3', 30000);
	await evaluate('window.confirm = () => true; window.alert = () => {}; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	for (const [name, R] of Object.entries(RIGS)) {
		await step(`${R.t.label} (${name})`, async () => {
			ok('＋ New rig’s controls.json opens with the rig', await openRig(name));
			await setMode('setup');
			await evaluate('fitView(); document.getElementById("secCtl").open = true; document.getElementById("secPicker").open = true; renderControlPanel(); true');
			const rings = Object.entries(R.controls.bones).filter(([, c]) => c.shape === 'ring').map(([n]) => n);
			const drawn = JSON.parse(await evaluate(`JSON.stringify(stageControls().map((s) => s.name))`));
			ok(`its ${rings.length} rings are drawn on the stage`, rings.every((n) => drawn.includes(n)), drawn.join(','));
			const hidden = JSON.parse(await evaluate(`JSON.stringify(Object.keys(controlsDoc.bones).filter((n) => /_ik_|_pole_|_image$/.test(n)).filter((n) => !boneControlState(n).hidden))`));
			ok('the IK controls, space bones and image hinges are hidden', hidden.length === 0, hidden.join(','));

			const items = R.controls.picker.items;
			const pick = await layoutOf('#pickerPanel .pickBoard:not(.faceBoard)', '.pickBtn');
			ok(`the Picker shows the template's ${items.length} buttons (not the automatic layout)`, pick?.n === items.length && (await evaluate('!pickerLayout().auto')), q(pick));
			ok('…none overlapping, each whole on the board', pick && !pick.over.length && !pick.out.length, q(pick));
			await click(await centreOf('#pickerPanel .pickBtn[data-bone="head"]'));
			ok('a click on “head” selects the head', (await selNames()).join() === 'head');
			const set = items.find((it) => it.set);
			await click(
				await evaluate(`(() => { const b = [...document.querySelectorAll("#pickerPanel .pickBtn.set")].find((x) => x.textContent.includes(${q(set.label)})); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`),
			);
			ok(`a click on the “${set.label}” set selects its bones`, q(await selNames()) === q([...R.controls.sets[set.set]].sort()), q(await selNames()));

			const placed = R.t.channels.filter((c) => c.ui);
			const boxes = new Set(placed.filter((c) => c.ui.box).map((c) => c.ui.box)).size;
			const face = await layoutOf('#pickerPanel .faceBoard', '.faceItem');
			ok(`the face board shows its ${placed.length - boxes} items (${boxes} of them boxes)`, face?.n === placed.length - boxes, q(face));
			ok('…none overlapping, each whole on the board', face && !face.over.length && !face.out.length, q(face));

			await setMode('animate');
			await evaluate('animTime = 0.4; syncPlayhead(); renderControlPanel(); true');
			const slider = placed.find((c) => !c.ui.box && c.drives?.length);
			const track = await evaluate(`(() => { const it = [...document.querySelectorAll("#pickerPanel .faceBoard .faceItem")].find((e) => e.querySelector(".lab").textContent === ${q(slider.label)}); const t = it && it.querySelector(".faceTrack"); if (!t) return null; t.scrollIntoView({ block: "center" }); const r = t.getBoundingClientRect(); return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height }); })()`);
			const r = JSON.parse(track);
			await drag({ x: Math.round(r.l + r.w / 2), y: Math.round(r.t + r.h / 2) }, { x: Math.round(r.l + r.w - 1), y: Math.round(r.t + r.h / 2) });
			const v = await evaluate(`faceChannelValue(animOf(curAnim), rigTemplate.channels.find((c) => c.id === ${q(slider.id)}), 0.4, faceSetup, rigTemplate.channels, faceSlotOrder())`);
			ok(`dragging “${slider.label}” to its end keys it near its max at the playhead`, v > slider.max - (slider.max - slider.min) * 0.05, String(v));
			if (SHOTS) {
				const shot = await send('Page.captureScreenshot', { format: 'png' });
				writeFileSync(join(SHOTS, `t12a-${name}.png`), Buffer.from(shot.data, 'base64'));
			}
		});
	}

	await step('Full body: a ring on a channel’s bone keys the channel', async () => {
		await openRig('Body');
		await setMode('animate');
		const turn = async (bone, deg) =>
			JSON.parse(
				await evaluate(`(() => {
					animTime = 0.5; syncPlayhead();
					const i = skeleton.bones.findIndex((b) => b.data.name === ${q(bone)}); pickBone(i);
					skeleton.bones[i].rotation = skeleton.bones[i].data.rotation + ${deg};
					keyBone(${q(bone)}, { rotate: true }, true);
					const a = animOf(curAnim), at = (n) => { const k = ((a.bones[n] || {}).rotate || []).find((x) => Math.abs(x.time - 0.5) < 1e-3); return k ? k.value : null; };
					return JSON.stringify({ spine: at("spine"), chest: at("chest"), arm: at("upper_arm_l"), hand: at("hand_l"), hint: document.getElementById("hint").textContent,
						lean: faceChannelValue(a, rigTemplate.channels.find((c) => c.id === "lean"), 0.5, faceSetup, rigTemplate.channels, faceSlotOrder()),
						slider: (document.querySelector('#faceList .faceRow[data-ch="lean"] input') || {}).value });
				})()`),
			);
		const lean = await turn('spine', 10);
		ok('turning the spine ring 10° keys Lean: the spine 10°, the chest 5°', lean.spine === 10 && lean.chest === 5, q(lean));
		ok('…Lean reads 10, its slider there (to its 0.3 step), and the hint names the control', lean.lean === 10 && Math.abs(Number(lean.slider) - 10) <= 0.3 && /Lean control/.test(lean.hint), q(lean));
		const far = await turn('upper_arm_l', -400);
		ok('a ring turned past its channel’s range is held to it (the arm at −150°)', far.arm === -150, q(far));
		const free = await turn('hand_l', 30);
		ok('a ring on a bone no channel drives keys that bone only', free.hand === 30 && !/hand_l keyed as/.test(free.hint), q(free));
	});

	const errs = pageLog.filter((l) => /error|uncaught/i.test(l));
	ok('the page throws nothing', errs.length === 0, errs.slice(0, 3).join(' | '));
	ok('the page sends nothing', posted.length === 0, posted.join(', '));
} finally {
	await browser.close();
	server.close();
}
console.log(`\n${pass}/${pass + fail} template-controls browser checks pass`);
process.exit(fail ? 1 : 0);
