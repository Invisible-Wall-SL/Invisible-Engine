// Browser gate for mesh-shape (deform) keys in Animate mode.
//
//   node tools/rigger-spike/deform-keys-browser.mjs
//   node tools/rigger-spike/deform-keys-browser.mjs --mutants   # every planted bug must fail a check
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W (the unweighted `wild_exp_w`, the weighted `wild_dynamite`), the way
// the owner met the bug ("no way to keyframe the shapes; even in the timeline they look different;
// strange results"):
//   - a mesh picked in the slot tree, a real mouse drag on a vertex at 0s and at 0.5s keys its shape
//     at the playhead, on both meshes;
//   - the dopesheet's shape row has both keys, drawn as every other channel's keys (not as slot
//     keys), and a ◆ that keys the shape;
//   - scrubbing, both meshes play as engine-rig plays the document, whichever is selected — or none;
//   - Setup mode shows the setup shape, and its vertex handles sit on it;
//   - ◆ Key / ✕ Key on a selected mesh slot key and delete its shape, the slot panel's "mesh shape"
//     row keys, deletes and eases it, and the eased key is drawn as an eased key;
//   - ↶ undoes a drag's key;
//   - 💾 Save posts the keys, and the rig reopened from what was posted plays them.
// What it does NOT cover: the math on every path (`deform-keys.mjs` plays the same functions
// headlessly against engine-rig, mutation-checked), the stretch (`stretch.mjs`).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const SHIPPED = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const W_JSON = readFileSync(join(SYMBOLS3, 'W.json'), 'utf8');

let html = SHIPPED;
let wDoc = W_JSON;
const posted = [];
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const ENTRIES = [{ id: 0, name: 'W', folder: 'W', dir_b64: b64('W'), skeleton_file: 'W.json', atlas_file: 'symbols3.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false }];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (url.searchParams.get('dir') !== b64('W')) return send(404, 'text/plain', 'no such bundle');
			if (name === 'W.json') return send(200, MIME['.json'], wDoc);
			if (/^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name))) return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') return jsonOut({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: null });
		if (p === '/api/rigger/save') {
			posted.push(JSON.parse(await readBody(req)));
			return jsonOut({ ok: true, saved: true, key: 'x', etag: `etag-${posted.length}`, count: 2 });
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) return jsonOut({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const browser = await launchChrome({ name: 'deform-keys', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, send, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const mouse = (type, pt, extra = {}) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, ...extra });
async function drag(from, to) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await mouse('mousePressed', from);
	for (let i = 1; i <= 6; i++)
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + ((to.x - from.x) * i) / 6), y: Math.round(from.y + ((to.y - from.y) * i) / 6), button: 'left', buttons: 1 });
	await mouse('mouseReleased', to);
	await frames(2);
}
/** Page coordinates of world point (x, y). */
const screenAt = (wx, wy) =>
	evaluate(`(() => {
		const cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(${wx}, ${wy}, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
	})()`);
/** The world vertices slot `s` shows now, on the page's live skeleton. */
const liveOf = (s) => evaluate(`(() => { const slot = skeleton.findSlot(${q(s)}), att = slot.attachment; const o = new Array(att.worldVerticesLength); att.computeWorldVertices(slot, 0, att.worldVerticesLength, o, 0, 2); return o; })()`);
/** engine-rig in the page: the document as it would save, clip `curAnim` at t (or the setup pose). */
const engineOf = (s, t) =>
	evaluate(`(() => {
		const sd = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(assetMgr.require(selected.atlas_file))).readSkeletonData(JSON.parse(JSON.stringify(rawDoc)));
		const sk = new RIG.Skeleton(sd); sk.setToSetupPose();
		${t == null ? '' : `sd.findAnimation(curAnim).apply(sk, 0, ${t}, false, [], 1, RIG.MixBlend.setup, RIG.MixDirection.mixIn);`}
		sk.updateWorldTransform(RIG.Physics.none);
		const slot = sk.findSlot(${q(s)}), att = slot.attachment; const o = new Array(att.worldVerticesLength); att.computeWorldVertices(slot, 0, att.worldVerticesLength, o, 0, 2); return o;
	})()`);
const maxDiff = (a, b) => (a.length !== b.length ? Infinity : a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0));
const keysOf = (s) => evaluate(`JSON.stringify(((((rawDoc.animations[curAnim] || {}).attachments || {}).default || {})[${q(s)}] || {})[${q(s)}]?.deform?.map((k) => ({ t: k.time, n: k.vertices.filter((v) => v).length, c: k.curve ?? null })) ?? null)`).then(JSON.parse);
const seek = async (t) => { await evaluate(`animTime = ${t}; syncPlayhead(); renderTimeline(); if (selSlot) renderSlotDetail(); true`); await frames(2); };
const pickSlot = async (s) => {
	await evaluate(`document.querySelector('#slotList .trow[data-slot=${q(s)}]').click(); true`);
	await frames(2);
};
/** Drag vertex `k` of the selected mesh by (dx, dy) CSS px with the real mouse. */
async function dragVertex(k, dx, dy) {
	const w = await evaluate('meshWorldVerts()');
	const p = await screenAt(w[k * 2], w[k * 2 + 1]);
	await drag(p, { x: p.x + dx, y: p.y + dy });
}
const rowDots = (s) => evaluate(`[...document.querySelectorAll('#timeline .tl-key')].filter((d) => d.dataset.tid === ${q('deform:' + s + ':' + s)}).map((d) => d.className)`);
const MESHES = ['wild_exp_w', 'wild_dynamite'];
// vertices no other vertex sits near on screen, so the drag's grab is unambiguous
const VERT = { wild_exp_w: 5, wild_dynamite: 20 };

async function openW() {
	await evaluate('location.reload(); true').catch(() => {});
	await wait(300);
	await waitFor('typeof skeletons !== "undefined" && skeletons.length === 1', 30000);
	await evaluate('window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "W"); row.click(); return true; })()`);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await waitFor('!!skeleton && !!rawDoc', 15000);
	await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
}

async function suite(quiet) {
	let pass = 0, fail = 0;
	const ok = (name, cond, detail) => {
		if (cond) pass++;
		else fail++;
		if (!quiet) console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
		return cond;
	};
	async function step(title, fn) {
		if (!quiet) console.log(`\n${title}`);
		try { await fn(); } catch (e) { fail++; if (!quiet) console.log(`  ✗ the harness threw — ${e.message}`); }
	}
	wDoc = W_JSON;
	posted.length = 0;

	await step('1. a vertex drag keys the mesh’s shape at the playhead', async () => {
		await openW();
		await evaluate('document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); newAnimation(); fitView(); selectBone(null); true');
		await frames(3);
		for (const s of MESHES) {
			await seek(0);
			await pickSlot(s);
			ok(`${s}: picked in the slot tree, its vertices are handles`, await evaluate(`!!meshCtx && meshCtx.attName === ${q(s)}`));
			await dragVertex(VERT[s], 30, 0);
			await seek(0.5);
			await dragVertex(VERT[s], 0, -30);
			const keys = await keysOf(s);
			ok(`${s}: two shape keys, at 0s and 0.5s`, keys && keys.length === 2 && keys[0].t === 0 && keys[1].t === 0.5, JSON.stringify(keys));
		}
	});

	await step('2. the dopesheet draws them as keys, with a ◆ on the row', async () => {
		await pickSlot('wild_dynamite');
		const dots = await rowDots('wild_dynamite');
		ok('the shape row has its two keys', dots.length === 2, JSON.stringify(dots));
		ok('drawn as channel keys, not as slot keys', dots.length > 0 && dots.every((c) => !/\bslot\b/.test(c)), JSON.stringify(dots));
		await seek(0.3);
		ok('the row’s ◆ keys the shape at the playhead', await evaluate(`(() => { const row = [...document.querySelectorAll('#timeline .tl-key')].find((d) => d.dataset.tid === "deform:wild_dynamite:wild_dynamite").parentElement.parentElement; const b = [...row.querySelectorAll('button')].find((x) => x.textContent === "◆"); b.click(); return true; })()`) && (await keysOf('wild_dynamite')).length === 3);
	});

	await step('3. scrubbing plays both meshes as engine-rig does, selected or not', async () => {
		for (const [label, pick] of [['wild_exp_w selected', 'wild_exp_w'], ['nothing selected', null]]) {
			if (pick) await pickSlot(pick);
			else { await evaluate('selSlot = null; meshCtx = null; renderSlotDetail(); true'); await frames(1); }
			let worst = 0, where = '';
			for (const t of [0, 0.15, 0.3, 0.4, 0.5, 0.8]) {
				await seek(t);
				for (const s of MESHES) {
					const d = maxDiff(await liveOf(s), await engineOf(s, t));
					if (d > worst) { worst = d; where = `${s} @ ${t}s`; }
				}
			}
			ok(`${label}: both match engine-rig (worst ${worst.toExponential(2)})`, worst < 1e-2, where);
		}
	});

	await step('4. Setup mode shows the setup shape', async () => {
		await pickSlot('wild_dynamite');
		await seek(0.5);
		await evaluate('document.querySelector(\'#modeSeg button[data-mode="setup"]\').click(); true');
		await frames(3);
		for (const s of MESHES) ok(`${s} is in its setup shape`, maxDiff(await liveOf(s), await engineOf(s, null)) < 1e-3);
		ok('the selected mesh’s handles sit on it', maxDiff(await evaluate('meshWorldVerts()'), await engineOf('wild_dynamite', null)) < 1e-3);
	});

	await step('5. ◆ Key, ✕ Key and the slot panel key the shape of a selected mesh', async () => {
		await evaluate('document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); true');
		await frames(2);
		await pickSlot('wild_dynamite');
		await evaluate('selectBone(null); true');
		await seek(1);
		await evaluate('document.getElementById("keyBtn").click(); true');
		ok('◆ Key keys the shape at 1s', (await keysOf('wild_dynamite')).some((k) => k.t === 1));
		await seek(0.5);
		await evaluate('document.getElementById("delKey").click(); true');
		ok('✕ Key deletes the shape key at 0.5s', !(await keysOf('wild_dynamite')).some((k) => k.t === 0.5), JSON.stringify(await keysOf('wild_dynamite')));
		await seek(0.75);
		const head = await evaluate('(() => { const h = [...document.querySelectorAll("#slotDetail .chead")].find((x) => x.textContent.includes("mesh shape")); return h ? { title: h.title, buttons: [...h.querySelectorAll("button")].map((b) => b.textContent) } : null; })()');
		ok('the slot panel has a "mesh shape" row whose help is its tooltip', !!head && /Drag a vertex/.test(head.title), JSON.stringify(head));
		await evaluate('[...document.querySelectorAll("#slotDetail .chead")].find((x) => x.textContent.includes("mesh shape")).querySelector("button").click(); true');
		ok('its ◆ keys the shape at 0.75s', (await keysOf('wild_dynamite')).some((k) => k.t === 0.75));
		await seek(0);
		await evaluate('[...document.querySelectorAll("#slotDetail button")].find((b) => b.textContent === "Ease In").click(); true');
		const k0 = (await keysOf('wild_dynamite'))[0];
		ok('Ease In on the 0s key eases it', Array.isArray(k0.c), JSON.stringify(k0));
		ok('…and the dopesheet draws it as an eased key', (await rowDots('wild_dynamite'))[0].includes('bez'), JSON.stringify(await rowDots('wild_dynamite')));
		await seek(0.75);
		await evaluate('[...document.querySelectorAll("#slotDetail .chead")].find((x) => x.textContent.includes("mesh shape")).querySelectorAll("button")[1].click(); true');
		ok('its ✕ deletes the key at 0.75s', !(await keysOf('wild_dynamite')).some((k) => k.t === 0.75));
	});

	await step('6. ↶ undoes a drag’s key', async () => {
		await seek(0.6);
		await pickSlot('wild_exp_w');
		const before = await keysOf('wild_exp_w');
		await dragVertex(VERT.wild_exp_w, -25, 10);
		ok('the drag keyed 0.6s', (await keysOf('wild_exp_w')).some((k) => k.t === 0.6));
		await evaluate('rigUndo(); true');
		await frames(2);
		ok('undo takes it back', JSON.stringify(await keysOf('wild_exp_w')) === JSON.stringify(before), JSON.stringify(await keysOf('wild_exp_w')));
	});

	await step('7. 💾 Save posts the keys; the rig reopened from it plays them', async () => {
		const clip = await evaluate('curAnim');
		const want = await evaluate('JSON.stringify(rawDoc.animations[curAnim].attachments)');
		await evaluate('saveToR2(); true');
		for (let i = 0; i < 50 && !posted.length; i++) await wait(100);
		const body = posted.at(-1);
		const skel = body && (typeof body.skeleton === 'string' ? JSON.parse(body.skeleton) : body.skeleton);
		ok('the posted skeleton carries every shape key', !!skel && JSON.stringify(skel.animations?.[clip]?.attachments) === want, skel ? 'differs' : 'nothing posted');
		if (!skel) return;
		wDoc = JSON.stringify(skel);
		await openW();
		await evaluate(`document.querySelector('#modeSeg button[data-mode="animate"]').click(); setCurAnim(${q(clip)}); true`);
		await frames(2);
		let worst = 0, moved = 0;
		for (const t of [0, 0.3, 1]) {
			await seek(t);
			for (const s of MESHES) {
				worst = Math.max(worst, maxDiff(await liveOf(s), await engineOf(s, t)));
				moved = Math.max(moved, maxDiff(await liveOf(s), await engineOf(s, null)));
			}
		}
		ok(`reopened, nothing selected: the shapes play as engine-rig plays them (worst ${worst.toExponential(2)})`, worst < 1e-2 && moved > 1, `moved ${moved}`);
	});
	return { pass, fail };
}

const MUTANTS = [
	['shapes pose only for the selected mesh', 'function poseDeforms(a, t, additive){\n  const at = a && a.attachments; if (!at) return;', 'function poseDeforms(a, t, additive){\n  const at = a && a.attachments; if (!at || !meshCtx) return;'],
	['shape keys drawn as slot keys', '(isSlotKind && !isDeform ? " slot" : "")', '(isSlotKind ? " slot" : "")'],
	['◆ Key on a slot skips the shape', 'historyStep(() => { keyDeform(selSlot); keySlotAttachment(', 'historyStep(() => { keySlotAttachment('],
	['✕ Key ignores a slot', 'else if (selSlot) historyStep(() => { deleteDeformKeyOfSlot(selSlot, animTime); deleteSlotKeyAt(selSlot, animTime); });', ''],
	['the shape row is not in the slot panel', 'if (meshCtx && meshCtx.slotIndex === slotIndex) renderShapeKeys(det, sd.name);', ''],
	['the drag writes the setup vertices', 'setDeformOffsets(slot, att, d); // shows at once', 'for (let i = 0; i < d.length && !isWeightedAtt(att); i++) att.vertices[i] += d[i]; // shows at once'],
];

let code = 0;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		console.log('deform-keys-browser mutants (each must fail a check):');
		for (const [name, find, replace] of MUTANTS) {
			const n = SHIPPED.split(find).length - 1;
			if (n !== 1) { console.log(`  ✗ ${name}: its line is in view.html ${n} times — the mutant is stale`); continue; }
			html = SHIPPED.replace(find, replace);
			const r = await suite(true);
			if (r.fail) caught++;
			console.log(`  ${r.fail ? '✓' : '✗'} ${name}${r.fail ? ` (${r.fail} check(s) failed)` : ' — NOT caught'}`);
		}
		console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
		code = caught === MUTANTS.length ? 0 : 1;
	} else {
		console.log('deform-keys-browser — shape keys in the real Rigger (W)');
		const r = await suite(false);
		console.log(`\n${r.pass} passed, ${r.fail} failed`);
		if (r.fail && pageLog.length) console.log('page log:\n  ' + pageLog.slice(-15).join('\n  '));
		code = r.fail ? 1 : 0;
	}
} finally {
	server.close();
	await browser.close();
}
process.exit(code);
