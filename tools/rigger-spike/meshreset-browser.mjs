// Browser gate for the mesh panel's ⟲ Back to the saved shape and ▭ Back to the image.
//
//   node tools/rigger-spike/meshreset-browser.mjs
//   node tools/rigger-spike/meshreset-browser.mjs --mutants   # every planted mutant must fail the gate
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API: ▸ Convert to mesh, edit the mesh, then click the panel's own ⟲ / ▭, ↶ ↷ and 💾, and
// check that
//   - the two icon buttons are there with a tooltip naming what they do, and are off (saying why)
//     when there is nothing to go back to;
//   - ▭ puts the quad ▸ Convert made back, ⟲ the mesh as last SAVED (not as opened — also by a save
//     whose write landed but whose reindex failed), each one ↶; the buttons follow a 💾;
//   - a reset that throws work away asks first, naming it (weights), and one that doesn't asks nothing;
//   - the page throws nothing.
// The geometry, weights and deform keys of every case are gated headlessly by meshreset.mjs.
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));

const MUTANTS = {
	'the saved shape does not follow a 💾 save': ['    rawDocSaved = JSON.parse(body).skeleton; // what was sent, not edits made while it was on its way\n', ''],
	'a save that lands unlisted does not move "saved"': ['{ rigEtag = j.etag; rawDocSaved = JSON.parse(body).skeleton; }', '{ rigEtag = j.etag; }'],
	'the buttons do nothing': ['        b.onclick = () => resetMesh(kind);\n', ''],
	'the buttons keep their state from before 💾': ['    paintMeshResetButtons();\n    if (sent3d){', '    if (sent3d){'],
};
if (process.argv.includes('--mutants')) {
	const missed = [];
	for (const name of Object.keys(MUTANTS)) {
		const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, MESHRESET_BROWSER_MUTANT: name }, encoding: 'utf8' });
		const why = r.stdout.split('\n').filter((l) => l.startsWith('  ✗')).slice(0, 2);
		if (r.status === 1) console.log(`  ✓ caught: ${name}\n      ${why.join('\n      ')}`);
		else { missed.push(name); console.log(`  ✗ NOT caught: ${name} (exit ${r.status})\n${r.stdout.slice(-600)}${r.stderr.slice(-400)}`); }
	}
	const n = Object.keys(MUTANTS).length;
	console.log(`\n${missed.length ? '✗ FAIL' : '✅ PASS'} — ${n - missed.length}/${n} mutants caught`);
	process.exit(missed.length ? 1 : 0);
}

let html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8').replace(/\r\n/g, '\n');
const mutant = process.env.MESHRESET_BROWSER_MUTANT;
if (mutant) {
	const [from, to] = MUTANTS[mutant] ?? [];
	if (!from || !html.includes(from)) { console.log(`mutant "${mutant}" no longer applies — update it to the code`); process.exit(2); }
	html = html.replace(from, to);
}

// ---- the fake launcher -------------------------------------------------------------------------------
const doc = JSON.parse(readFileSync(join(RIG_ASSETS, 'anticipation', 'anticipation.json'), 'utf8'));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const ENTRY = { id: 0, name: 'A', folder: 'A', dir_b64: b64('A'), skeleton_file: 'A.json', atlas_file: 'anticipation.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
let etag = null, reindexFails = false;
const saves = [];
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: [ENTRY] });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (name === 'A.json') return jsonOut(doc);
			if (['anticipation.atlas', 'anticipation.png', 'anticipation.webp'].includes(name)) return send(200, MIME[extname(name)], readFileSync(join(RIG_ASSETS, 'anticipation', name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') return jsonOut({ ok: true, projectKey: 'p', etag });
		if (p === '/api/rigger/save') {
			const body = JSON.parse(await readBody(req));
			saves.push(body);
			if (body.baseEtag !== etag) return jsonOut({ ok: false, error: 'conflict', etag, message: 'stale' }, 409);
			etag = `etag-${saves.length}`;
			// as /api/rigger/save answers: `saved` only when the write landed but the reindex did not
			if (reindexFails) return jsonOut({ ok: false, error: 'atlas-missing', saved: true, etag, message: 'no atlas' }, 400);
			return jsonOut({ ok: true, key: 'x', etag, count: 1 });
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/')) return jsonOut({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file)) return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) { send(500, 'text/plain', String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await launchChrome({ name: 'meshreset', url: `http://127.0.0.1:${server.address().port}/`, args: ['--window-size=1600,1000'] });
const { evaluate, waitFor, pageLog, send: cdp } = browser;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`); } return cond; };
async function step(title, fn) { console.log(`\n${title}`); try { await fn(); } catch (e) { fail++; console.log(`  ✗ the harness threw — ${e.message}`); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;

// ---- the author ------------------------------------------------------------------------------------
const install = () => evaluate(`(() => {
	window.__asked = [];
	window.confirm = (m) => { window.__asked.push(String(m)); return true; };
	window.T = {
		snap: () => JSON.stringify(rawDoc),
		past: () => rigHist.past.length,
		click(el) {
			const o = { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 };
			el.dispatchEvent(new PointerEvent("pointerdown", o)); el.dispatchEvent(new MouseEvent("mousedown", o));
			el.dispatchEvent(new PointerEvent("pointerup", o)); el.dispatchEvent(new MouseEvent("mouseup", o));
			el.click();
		},
		button: (text) => [...document.querySelectorAll("#slotDetail button")].find((b) => b.textContent.includes(text)) || null,
		reset: (kind) => document.querySelector('#slotDetail button[aria-label="' + (kind === "saved" ? "Back to the saved shape" : "Back to the image") + '"]'),
		state: (kind) => { const b = T.reset(kind); return b && { disabled: b.disabled, title: b.title, text: b.textContent }; },
		// an author's edit, as the canvas makes it: one step, then the panel redrawn as on mouseup
		edit(fn) { historyStep(fn); renderSlotDetail(); },
		def: () => rawDocMeshEntry(),
	};
	return true;
})()`);
const snap = () => evaluate('T.snap()');
const state = (kind) => evaluate(`T.state(${q(kind)})`);
const clickReset = async (kind) => { await evaluate(`(window.__asked = [], T.click(T.reset(${q(kind)})), true)`); await wait(60); return evaluate('window.__asked.slice()'); };
const clickId = async (id) => { await evaluate(`T.click(document.getElementById(${q(id)})); true`); await wait(60); };
const near = (a, b, e = 1e-6) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e);

let slot = null, converted = null;
try {
	await step('1. open a rig, ▸ Convert a region to a mesh', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 1');
		await install();
		await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const row = document.querySelector("#list .item"); if (row) row.click(); return !!row; })()`);
		await waitFor('!document.getElementById("loadingOverlay").classList.contains("on") && !!rawDoc', 30000);
		await evaluate('T.click(document.querySelector(\'#modeSeg button[data-mode="setup"]\')); true');
		slot = await evaluate(`(() => {
			for (const s of rawDoc.slots){
				const def = rawDoc.skins[0].attachments[s.name] && rawDoc.skins[0].attachments[s.name][s.attachment];
				if (def && (!def.type || def.type === "region") && rawDoc.bones.some((b) => b.parent === s.bone)) return s.name;
			}
			return null;
		})()`);
		ok('a region slot on a bone with children', !!slot, slot);
		await evaluate(`selectSlot(${q(slot)}); true`);
		await evaluate('T.click(T.button("Convert to mesh")); true');
		await wait(60);
		converted = await snap();
		ok('▸ Convert to mesh made a mesh', /"type":"mesh"/.test(converted));
		const saved = await state('saved'), image = await state('image');
		ok('⟲ and ▭ are in the mesh panel', !!saved && !!image && saved.text === '⟲' && image.text === '▭', q([saved, image]));
		ok('⟲ is off, saying the mesh was an image when last saved', saved?.disabled && /an image when last saved/.test(saved.title), saved?.title);
		ok('▭ is off on the quad ▸ Convert just made', image?.disabled && /already is its image's quad/.test(image.title), image?.title);
	});

	await step('2. edit, then ▭ Back to the image', async () => {
		await evaluate('T.edit(() => applyMeshVertexDelta(0, 14, -9)); true');
		await evaluate('T.edit(() => { const w = meshWorldVerts(); addMeshVertex((w[0] + w[2] + w[4]) / 3, (w[1] + w[3] + w[5]) / 3); }); true');
		const edited = await snap();
		const image = await state('image');
		ok('▭ is on, its tooltip saying what it does and that only the shape changes', !image.disabled && /Back to the image: the 4-corner mesh/.test(image.title) && /changes only the shape/.test(image.title), image.title);
		const past = await evaluate('T.past()');
		const asked = await clickReset('image');
		ok('nothing thrown away, so nothing asked', asked.length === 0, q(asked));
		const after = JSON.parse(await snap()), conv = JSON.parse(converted);
		const d = (x) => x.skins[0].attachments[slot][x.slots.find((s) => s.name === slot).attachment];
		ok('the mesh is the quad ▸ Convert made', near(d(after).vertices, d(conv).vertices, 1e-4) && near(d(after).uvs, d(conv).uvs, 1e-9) && d(after).hull === 4, q(d(after).vertices));
		ok('one undo step', (await evaluate('T.past()')) === past + 1);
		await clickId('undoBtn');
		ok('↶ brings the edited mesh back, exactly', (await snap()) === edited);
		await clickId('redoBtn');
		ok('↷ puts the quad back', near(d(JSON.parse(await snap())).vertices, d(conv).vertices, 1e-4));
	});

	await step('3. 💾, edit again, ⟲ Back to the saved shape', async () => {
		await evaluate('T.edit(() => applyMeshVertexDelta(2, -6, 11)); true');
		await evaluate('saveToR2()');
		await waitFor('!saveToR2.busy');
		const saved = await snap();
		ok('💾 saved', saves.length === 1 && (await evaluate('dirty')) === false);
		const after = await state('saved');
		ok('⟲ is off right after the save, saying it already has the saved shape', after.disabled && /already has the saved shape/.test(after.title), after.title);
		await evaluate('T.edit(() => applyMeshVertexDelta(1, 8, 8)); true');
		await evaluate('T.edit(() => { const w = meshWorldVerts(); addMeshVertex((w[0] + w[2] + w[4]) / 3, (w[1] + w[3] + w[5]) / 3); }); true');
		const edited = await snap();
		const st = await state('saved');
		ok('⟲ is on, its tooltip saying what it does', !st.disabled && /Back to the saved shape: this mesh as the rig was last opened or saved/.test(st.title), st.title);
		const asked = await clickReset('saved');
		ok('nothing thrown away, so nothing asked', asked.length === 0, q(asked));
		ok('⟲ = the mesh as SAVED (the drag before 💾 kept), exactly', (await snap()) === saved);
		await clickId('undoBtn');
		ok('↶ brings the edited mesh back, exactly', (await snap()) === edited);
	});

	await step('3b. a 💾 whose write lands but whose reindex fails still moves "saved"', async () => {
		reindexFails = true;
		await evaluate('saveToR2()');
		await waitFor('!saveToR2.busy');
		reindexFails = false;
		const landed = await snap();
		ok('the save answered "saved, not listed"', saves.length === 2);
		await evaluate('T.edit(() => applyMeshVertexDelta(0, -5, 4)); true');
		await clickReset('saved');
		ok('⟲ = the mesh as that save wrote it', (await snap()) === landed);
	});

	await step('4. weighted: ▭ asks before dropping the weights', async () => {
		const bone = await evaluate(`rawDoc.slots.find((s) => s.name === ${q(slot)}).bone`);
		await evaluate(`selectSlot(${q(slot)}); selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(bone)})); true`);
		await evaluate('T.click(T.button("Auto-weight to chain")); true');
		await wait(60);
		const weighted = await snap();
		ok('② Auto-weight weighted the mesh', (await evaluate('meshCtx && meshCtx.weighted')) === true);
		const image = await state('image');
		ok('▭\'s tooltip names the weights it drops', /drops its weights \(\d+ bones?\)/.test(image.title), image.title);
		const asked = await clickReset('image');
		ok('▭ asks first, naming the weights', asked.length === 1 && /Back to the image\?/.test(asked[0]) && /drops its weights/.test(asked[0]) && /↶ Undo brings the edited mesh back/.test(asked[0]), q(asked));
		const def = await evaluate('T.def()');
		ok('…an unweighted 4-corner mesh', def.uvs.length === 8 && def.vertices.length === 8);
		await clickId('undoBtn');
		ok('↶ brings the weighted mesh back, exactly', (await snap()) === weighted);
		const png = await cdp('Page.captureScreenshot', { format: 'png', clip: await evaluate('(() => { const r = document.getElementById("slotDetail").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 520), scale: 1 }; })()') });
		const out = process.env.MESHRESET_SHOT;
		if (out && png?.data) writeFileSync(out, Buffer.from(png.data, 'base64'));
	});

	await step('5. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length && !mutant) console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}${mutant ? ` (mutant: ${mutant})` : ''}`);
process.exit(fail === 0 ? 0 : 1);
