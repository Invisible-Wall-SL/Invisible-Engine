// Browser gate for the Slots list's folders, its order (the front at the top) and a folder's view
// opacity.
//
//   node tools/rigger-spike/slot-folders-browser.mjs
//   node tools/rigger-spike/slot-folders-browser.mjs --mutants   # every planted bug must fail a check
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W (40 slots, a clip with draw-order keys and split rgb / alpha keys):
//   - the list shows the front at the top; ↑ moves a slot to the front;
//   - ＋📁 / Ctrl+G makes a folder of the selection, gathering a spread one at its frontmost slot
//     (Setup only) as one undo step, every draw-order key drawing what it did; the folder is saved in
//     controls.json and a reopen has it;
//   - a drag into a folder (between its slots, under a closed folder's row) puts slots in it, out of
//     it takes them out; a folder's row drags its slots as a block; ↑ ↓ and Ctrl+] / [ pass a whole
//     folder, move inside one and out at its edge, and move a folder whole;
//   - ▸ / ▾ close and open a folder (kept in this browser); its eye hides and solos its slots;
//   - its slider dims its slots on the stage alone; ⤓ writes it (Setup: setup alpha ×, Animate: an
//     opacity key on the timeline the clip uses), the slider back to 100%;
//   - a renamed slot is renamed in its folder, a deleted one leaves it, an emptied folder goes; ✎
//     renames a folder (its opacity and closed state with it), 🗑 ungroups;
//   - the folders stay true after any edit: a duplicate of a member joins it, a slot placed inside a
//     folder's run joins it, one moved out leaves, ＋ Add slot joins none;
//   - the loose slot groups of #1906 become folders when their slots are together, the others are
//     left out (named in the status line), the draw order untouched.
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

const MUTANTS = [
	['the list shows the back at the top', 'for (let z = names.length - 1; z >= 0; z--){\n    const n = names[z], f = slotFolderOf(folders, n);', 'for (let z = 0; z < names.length; z++){\n    const n = names[z], f = slotFolderOf(folders, n);'],
	['↑ moves a slot to the back', '["↑", 1, upOff,', '["↑", -1, upOff,'],
	['gathering keeps the slots where they are', '  return slotOrderDrop(names, sel, front + 1);\n}', '  return names.slice();\n}'],
	['gathering drops the draw-order keys', 'changeSlotsKeepingDrawOrder(rawDoc, () => { rawDoc.slots.splice(0, rawDoc.slots.length, ...order.map((n) => by.get(n))); });', 'rawDoc.slots.splice(0, rawDoc.slots.length, ...order.map((n) => by.get(n)));'],
	['a drop between a folder’s slots leaves them out', '  if (into) out[into].push(...moving);\n', ''],
	['a slot passes a folder one slot at a time', 'const id = f != null && (f === folder || !folders[f].some((m) => set.has(m))) ? "\\u0000" + f : n;', 'const id = n;'],
	['a member at the edge moves on instead of leaving', '      let i = 0; while (i < edge.length && set.has(edge[i])) i++;\n', '      const i = 0;\n'],
	['a closed folder still shows its slots', '    if (!shut.has(f)) out.push({ kind: "slot", name: n, z, folder: f });', '    out.push({ kind: "slot", name: n, z, folder: f });'],
	['the view opacity is not put back after a draw', 'dim.forEach((s, i) => { s.color.a = was[i]; });', ''],
	['⤓ leaves the slider where it was', '  setSlotGroupAlpha(g.id, 1);\n  renderSlotList();\n}', '  renderSlotList();\n}'],
	['a duplicate of a member stays out of its folder', '  slotFolderAdopt(newName, slotName);\n', ''],
	['the folder rename leaves its opacity behind', '  setSlotGroupAlpha("f:" + from, 1); setSlotGroupAlpha("f:" + to, a);\n', ''],
];

let html = SHIPPED;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const SOURCE = { id: 0, name: 'W', folder: 'W', dir_b64: b64('W'), skeleton_file: 'W.json', atlas_file: 'symbols3.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false };
let entries = [SOURCE];
let saves = [];
let savedIrig = null;
let savedControls = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v) => send(200, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: entries });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (url.searchParams.get('dir') !== b64('W')) return send(404, 'text/plain', 'no such bundle');
			if (name === 'W.json') return send(200, MIME['.json'], W_JSON);
			if (name === 'W.irig' && savedIrig) return send(200, MIME['.json'], savedIrig);
			if (/^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name))) return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: savedIrig ? `"e${saves.length}"` : null, rig3d: null, controls: savedControls ? { etag: `"c${saves.length}"`, ...savedControls } : null });
		if (p === '/api/rigger/save' && req.method === 'POST') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				saves.push(body);
				const j = JSON.parse(body);
				savedIrig = JSON.stringify(j.skeleton);
				if (j.controls) savedControls = { doc: { ...j.controls, rig: 'W' } };
				entries = [SOURCE, { ...SOURCE, id: 1, skeleton_file: 'W.irig', format: 'json' }];
				jsonOut({ ok: true, saved: true, etag: `"e${saves.length}"`, ...(j.controls ? { controlsEtag: `"c${saves.length}"` } : {}) });
			});
			return;
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
const browser = await launchChrome({ name: 'slot-folders', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, send, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const lerp = (a, b, i, n) => Math.round(a + ((b - a) * i) / n);
const near = (a, b) => Math.abs(a - b) < 1.5 / 255;
const same = (a, b) => q(a) === q(b);
const CLIP = 'wild_dynamite';

async function drag(from, to) {
	const mouse = (type, pt, extra) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, pointerType: 'mouse', ...extra });
	await mouse('mouseMoved', from, {});
	await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
	for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: lerp(from.x, to.x, i, 8), y: lerp(from.y, to.y, i, 8) }, { button: 'left', buttons: 1 });
	await frames(1);
	await mouse('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1 });
	await frames(2);
}
async function key(code, keyName, vk, modifiers) {
	await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
	await frames(2);
}

const HELPERS = `(() => {
	window.__t = {
		names() { return rawDoc.slots.map((s) => s.name); },
		folders() { return JSON.parse(JSON.stringify((controlsDoc && controlsDoc.slotFolders) || {})); },
		// The rows as the list shows them, top to bottom: a folder's as "📁name", a slot's as its name.
		rows() { return [...document.querySelectorAll("#slotList .trow[data-slot], #slotList .trow[data-folder]")].map((r) => r.dataset.folder ? "📁" + r.dataset.folder : r.dataset.slot); },
		indented(n) { const r = this.slot(n); return !!r && r.classList.contains("inFolder"); },
		slot(n) { return [...document.querySelectorAll("#slotList .trow[data-slot]")].find((r) => r.dataset.slot === n); },
		folder(f) { return [...document.querySelectorAll("#slotList .trow[data-folder]")].find((r) => r.dataset.folder === f); },
		opac(f) { return [...document.querySelectorAll("#slotList .slotFolderOpac")].find((r) => r.dataset.folder === f); },
		at(el, fy) { el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * (fy == null ? 0.5 : fy)) }; },
		grip(el) { return this.at(el.querySelector(".slotGrip")); },
		steps() { return rigHist.past.length; },
		order(anim) {
			const names = this.names();
			return (rawDoc.animations[anim].drawOrder || []).map((fr) => fr.offsets ? drawOrderOfOffsets(fr.offsets, names).map((i) => names[i]) : names);
		},
		select(ns) { slotMulti = new Set(ns); slotAnchor = ns[0]; selectSlot(ns[0]); selFolder = null; markSlotRows(); return true; },
		slide(f, v) { const r = this.opac(f).querySelector("input"); r.value = String(v); r.dispatchEvent(new Event("input")); return true; },
		drawnA: {},
		exportText() {
			return new Promise((res) => {
				const ou = URL.createObjectURL, ac = HTMLAnchorElement.prototype.click;
				HTMLAnchorElement.prototype.click = function () {};
				URL.createObjectURL = (b) => { b.text().then(res); return "blob:none"; };
				try { exportIrig(); } finally { URL.createObjectURL = ou; HTMLAnchorElement.prototype.click = ac; }
			});
		},
		played(n, t) {
			rebuildFromRawDoc(null);
			const sk = new RIG.Skeleton(skeletonData); sk.setToSetupPose();
			skeletonData.findAnimation(${q(CLIP)}).apply(sk, 0, t, false, null, 1, RIG.MixBlend.setup, RIG.MixDirection.mixIn);
			return sk.findSlot(n).color.a;
		},
	};
	const draw = renderer.drawSkeleton.bind(renderer);
	renderer.drawSkeleton = (sk, ...rest) => { if (sk === skeleton) for (const s of sk.slots) __t.drawnA[s.data.name] = s.color.a; return draw(sk, ...rest); };
	return true;
})()`;
const T = (expr) => evaluate(`__t.${expr}`);
const drawn = async () => { await evaluate('__t.drawnA = {}; true'); await frames(3); return T('drawnA'); };

async function openW() {
	await evaluate('dirty = false; location.reload(); true').catch(() => {});
	await wait(300);
	await waitFor('typeof skeletons !== "undefined" && skeletons.length >= 1', 30000);
	await evaluate('window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	const want = entries.length > 1 ? 'W.irig' : 'W.json';
	await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const rows = [...document.querySelectorAll("#list .item")].filter((d) => d.querySelector(".nm").textContent === "W"); const row = rows.find((d) => d.textContent.includes(${q(want)})) || rows[rows.length - 1]; row.click(); return true; })()`);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await waitFor('!!skeleton && !!rawDoc', 15000);
	await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); fitView(); document.getElementById("secBones").open = false; document.getElementById("secSlots").open = true; true');
	await frames(3);
	await evaluate(HELPERS);
	await frames(2);
}
const setMode = async (m) => { await evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); true`); await frames(2); };
const answer = (name) => `prompt = () => ${q(name)}`;
const makeFolder = async (name, how = 'button') => {
	await evaluate(`window.${answer(name)}; true`);
	if (how === 'button') await evaluate('document.getElementById("slotFolderAdd").click(); true');
	else { await evaluate('document.activeElement && document.activeElement.blur(); true'); await key('KeyG', 'g', 71, 2); }
	await evaluate('window.prompt = () => null; true');
	await frames(2);
};

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
	entries = [SOURCE]; saves = []; savedIrig = null; savedControls = null;
	try {
		await openW();
		await evaluate('localStorage.clear(); true');
		await openW();
	} catch (e) {
		ok('W opens', false, e.message);
		return { pass, fail };
	}
	await setMode('setup');
	const names = await T('names()');
	const keys0 = await T(`order(${q(CLIP)})`);

	await step('1. the front is at the top, and ↑ moves a slot to the front', async () => {
		ok('the top row is the last slot drawn, the bottom the first', same(await T('rows()'), names.slice().reverse()), q((await T('rows()')).slice(0, 4)));
		ok('no “drawn first” caption in the list', !(await evaluate('document.getElementById("slotList").textContent.includes("drawn first")')));
		const n = names[5], s0 = await T('steps()');
		await evaluate(`[...__t.slot(${q(n)}).querySelectorAll("button")].find((b) => b.textContent === "↑").click(); true`);
		await frames(2);
		ok('↑ moves it one place to the front (later in the draw order)', (await T('names()')).indexOf(n) === 6 && (await T('steps()')) === s0 + 1);
		ok('and up the list', (await T('rows()')).indexOf(n) === names.length - 1 - 6);
		ok('every draw-order key draws what it did', same(await T(`order(${q(CLIP)})`), keys0));
		await evaluate(`[...__t.slot(${q(n)}).querySelectorAll("button")].find((b) => b.textContent === "↓").click(); true`);
		await frames(2);
		ok('↓ takes it back', same(await T('names()'), names));
	});

	const A = names.slice(10, 13); // together
	await step('2. ＋📁 makes a folder of slots that are together: no order change', async () => {
		await T(`select(${q(A)})`);
		const s0 = await T('steps()');
		await makeFolder('arm');
		ok('the folder holds them, back to front', same(await T('folders()'), { arm: A }), q(await T('folders()')));
		ok('the draw order is unchanged', same(await T('names()'), names));
		const rows = await T('rows()'), at = rows.indexOf('📁arm');
		ok('its row sits above its slots, which are indented under it', at >= 0 && same(rows.slice(at + 1, at + 4), A.slice().reverse()) && (await evaluate(`${q(A)}.every((n) => __t.indented(n))`)), q(rows.slice(at - 1, at + 5)));
		ok('one undo step', (await T('steps()')) === s0 + 1);
	});

	const S = [names[2], names[20], names[30]]; // spread out
	await step('3. Ctrl+G on a spread selection gathers it at its frontmost slot (Setup), one undo step', async () => {
		await setMode('animate');
		await T(`select(${q(S)})`);
		await makeFolder('spread', 'key');
		ok('in Animate it is refused: nothing moves', !('spread' in (await T('folders()'))) && same(await T('names()'), names));
		await setMode('setup');
		await T(`select(${q(S)})`);
		const s0 = await T('steps()');
		await makeFolder('spread', 'key');
		const want = [...names.slice(0, 31).filter((n) => !S.includes(n)), ...S, ...names.slice(31)];
		ok('the three gathered where the frontmost was', same(await T('names()'), want), q((await T('names()')).slice(18, 32)));
		ok('they are the folder', same((await T('folders()')).spread, S));
		ok('every draw-order key draws what it did', same(await T(`order(${q(CLIP)})`), keys0), q((await T(`order(${q(CLIP)})`))[0]));
		ok('one undo step (order and folder together)', (await T('steps()')) === s0 + 1);
		await evaluate('rigUndo(); true'); await frames(2);
		ok('undo takes both back', same(await T('names()'), names) && !('spread' in (await T('folders()'))));
	});

	await step('4. drag: into a folder, out of it, a folder as a block', async () => {
		const n = names[14], s0 = await T('steps()');
		// The line between the folder's top two slots (shown A[2], A[1]): drop on A[1]'s upper part.
		await drag(await T(`grip(__t.slot(${q(n)}))`), await T(`at(__t.slot(${q(A[1])}), 0.25)`));
		ok('a slot dropped between a folder’s slots joins it there', same((await T('folders()')).arm, [A[0], A[1], n, A[2]]), q(await T('folders()')));
		ok('one undo step, the keys kept', (await T('steps()')) === s0 + 1 && same(await T(`order(${q(CLIP)})`), keys0));
		await drag(await T(`grip(__t.slot(${q(n)}))`), await T(`at(__t.folder("arm"), 0.25)`));
		ok('dropped above the folder’s row it leaves it', same((await T('folders()')).arm, A) && (await T('rows()')).indexOf(n) === (await T('rows()')).indexOf('📁arm') - 1, q(await T('rows()')));
		const to = names[17];
		await drag(await T('grip(__t.folder("arm"))'), await T(`at(__t.slot(${q(to)}), 0.25)`));
		const after = await T('names()'), at = after.indexOf(A[0]);
		ok('a folder’s row drags its slots as a block, in front of the row it is dropped on', same(after.slice(at, at + 3), A) && at === after.indexOf(to) + 1 && same((await T('folders()')).arm, A), q({ at, slice: after.slice(10, 20) }));
		ok('the keys kept', same(await T(`order(${q(CLIP)})`), keys0));
		await evaluate('rigUndo(); rigUndo(); rigUndo(); true'); await frames(2);
		ok('three undos put it all back', same(await T('names()'), names) && same(await T('folders()'), { arm: A }), q(await T('folders()')));
	});

	await step('5. ↑ ↓ and Ctrl+] / [ with folders', async () => {
		const up = (n) => evaluate(`[...__t.slot(${q(n)}).querySelectorAll("button")].find((b) => b.textContent === "↑").click(); true`);
		const below = names[9]; // just behind the folder
		await up(below); await frames(2);
		ok('a slot behind a folder passes the whole folder', (await T('names()')).indexOf(below) === 12 && same((await T('folders()')).arm, A), q((await T('names()')).slice(8, 14)));
		await evaluate('rigUndo(); true'); await frames(2);
		await up(A[2]); await frames(2);
		ok('the frontmost slot of a folder leaves it where it is', same(await T('names()'), names) && same((await T('folders()')).arm, A.slice(0, 2)), q(await T('folders()')));
		await up(A[2]); await frames(2);
		ok('one more ↑ takes it on', (await T('names()')).indexOf(A[2]) === 13);
		await evaluate('rigUndo(); rigUndo(); true'); await frames(2);
		await up(A[0]); await frames(2);
		ok('inside a folder a slot moves among its slots', same((await T('folders()')).arm, [A[1], A[0], A[2]]));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate('selectSlotFolder("arm"); document.activeElement && document.activeElement.blur(); true');
		await key('BracketRight', ']', 221, 2);
		ok('Ctrl+] on a selected folder moves it whole past the next slot', (await T('names()')).indexOf(A[0]) === 11 && same((await T('folders()')).arm, A), q((await T('names()')).slice(9, 15)));
		await key('BracketLeft', '{', 219, 2 | 8);
		ok('Shift+Ctrl+[ takes it to the back', same((await T('names()')).slice(0, 3), A));
		await evaluate('rigUndo(); rigUndo(); true'); await frames(2);
		ok('(undone)', same(await T('names()'), names) && same(await T('folders()'), { arm: A }));
	});

	await step('6. ▸ / ▾ and the folder’s eye', async () => {
		await evaluate('__t.folder("arm").querySelector(".slotFold").click(); true'); await frames(1);
		ok('▾ closes it: its slots are not shown', (await T('rows()')).includes('📁arm') && !(await T('rows()')).some((r) => A.includes(r)), q(await T('rows()')));
		const n = names[14];
		await drag(await T(`grip(__t.slot(${q(n)}))`), await T('at(__t.folder("arm"), 0.8)'));
		ok('a slot dropped under a closed folder’s row joins it at its front', same((await T('folders()')).arm, [...A, n]), q(await T('folders()')));
		await evaluate('rigUndo(); true'); await frames(2);
		ok('it stays closed: kept per rig in this browser', await evaluate('(() => { const k = slotShut.key; slotShut.key = null; const shut = slotFoldersShut().has("arm"); return shut && k === slotViewKey("slotFolderShut") && JSON.parse(localStorage.getItem(k)).includes("arm"); })()'));
		await evaluate('__t.folder("arm").querySelector(".slotFold").click(); true'); await frames(1);
		ok('▸ opens it again', (await T('rows()')).filter((r) => A.includes(r)).length === 3);
	});

	await step('7. the folders ride the save; the eye, the view opacity and ⤓', async () => {
		await evaluate('saveToR2(); true');
		await waitFor('rigEtag === "\\"e1\\""', 10000);
		const sent = JSON.parse(saves[saves.length - 1]);
		ok('the save sends the folder in controls.json', same(sent.controls && sent.controls.slotFolders, { arm: A }), q(sent.controls));
		await openW();
		await setMode('setup');
		ok('a reopen has it', same(await T('folders()'), { arm: A }), q(await T('folders()')));
		// W draws these slots at 0 alpha in its setup: give them some, one between 0 and 1.
		await evaluate(`historyStep(() => { for (const n of ${q(A)}) rawDoc.slots.find((s) => s.name === n).color = n === ${q(A[0])} ? "ffffff80" : "ffffffff"; rebuildFromRawDoc(null); markDirty(); }); true`);
		await evaluate('__t.folder("arm").querySelector(".slotEye").click(); true');
		ok('its eye hides its slots', same(await evaluate('[...slotEyeHidden()].sort()'), A.slice().sort()));
		await evaluate('__t.folder("arm").querySelector(".slotEye").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); true');
		ok('right-click shows only them', same(await evaluate('[...slotEyeHidden()].sort()'), names.filter((n) => !A.includes(n)).sort()));
		await evaluate('setSlotEye([]); true');
		ok('its opacity line is hidden until the folder is selected', !(await evaluate('__t.opac("arm").classList.contains("on")')));
		await evaluate('__t.folder("arm").click(); true');
		ok('a click selects its slots and shows it', (await evaluate('__t.opac("arm").classList.contains("on")')) && same(await evaluate('selectedSlotNames()'), A));
		const setupA = await evaluate('Object.fromEntries(skeleton.slots.map((s) => [s.data.name, s.color.a]))');
		const out0 = await T('exportText()');
		await evaluate('dirty = false; true');
		await T('slide("arm", 40)');
		const d = await drawn();
		ok('the slider dims its slots on the stage', A.every((n) => near(d[n], setupA[n] * 0.4)), q(A.map((n) => [d[n], setupA[n]])));
		ok('and nothing else, put back after the draw, no edit', names.filter((n) => !A.includes(n)).every((n) => d[n] === setupA[n]) && same(await evaluate('Object.fromEntries(skeleton.slots.map((s) => [s.data.name, s.color.a]))'), setupA) && !(await evaluate('dirty')) && (await T('exportText()')) === out0);
		const s0 = await T('steps()');
		await evaluate('__t.opac("arm").querySelector(".slotGroupApply").click(); true'); await frames(2);
		const after = await drawn();
		const colors = await evaluate(`${q(A)}.map((n) => rawDoc.slots.find((s) => s.name === n).color)`);
		ok('⤓ in Setup multiplies each setup alpha by 40% (80 → 33, ff → 66)', same(colors, ['ffffff33', 'ffffff66', 'ffffff66']), q(colors));
		ok('the stage the same, the slider back at 100%, one step',
			A.every((n) => near(after[n], d[n])) && (await evaluate('slotGroupAlpha("f:arm")')) === 1 && (await T('steps()')) === s0 + 1, q(A.map((n) => [d[n], after[n]])));
		await evaluate('rigUndo(); true'); await frames(2);
		// Animate: a folder holding a slot the clip fades with split rgb / alpha keys.
		await evaluate('historyStep(() => ctlEdit((doc) => { doc.slotFolders.fx = ["rays1"]; })); rebuildFromRawDoc(null); true');
		await setMode('animate');
		await evaluate(`playing = false; setCurAnim(${q(CLIP)}); animTime = 0.9; syncPlayhead(); renderSlotList(); true`);
		const a0 = await T('played("rays1", 0.9)');
		await evaluate('selectSlotFolder("fx"); __t.slide("fx", 50); __t.opac("fx").querySelector(".slotGroupApply").click(); true');
		const ch = await evaluate(`JSON.parse(JSON.stringify(rawDoc.animations[${q(CLIP)}].slots.rays1))`);
		ok('⤓ in Animate keys the opacity on the clip’s alpha keys, no rgba', !ch.rgba && ch.alpha.some((k) => Math.abs(k.time - 0.9) < 1e-4), q(Object.keys(ch)));
		ok('engine-rig plays it at its opacity there × 50%', near(await T('played("rays1", 0.9)'), a0 * 0.5), q({ a0, a1: await T('played("rays1", 0.9)') }));
		await evaluate('rigUndo(); rigUndo(); true'); await frames(2);
		await setMode('setup');
	});

	await step('8. renames, deletes, ungroup', async () => {
		await evaluate(`renameSlot(${q(A[0])}, "renamed_slot"); true`);
		ok('a renamed slot is renamed in its folder', same((await T('folders()')).arm, ['renamed_slot', A[1], A[2]]), q(await T('folders()')));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate(`deleteSlot(${q(A[1])}); true`); await frames(2);
		ok('a deleted slot leaves it', same((await T('folders()')).arm, [A[0], A[2]]), q(await T('folders()')));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate('setSlotGroupAlpha("f:arm", 0.3); setSlotFolderShut("arm", true); window.prompt = () => "limb"; renameSlotFolder("arm"); window.prompt = () => null; true');
		ok('✎ renames the folder, its opacity and closed state with it', same(Object.keys(await T('folders()')), ['limb']) && (await evaluate('slotGroupAlpha("f:limb")')) === 0.3 && (await evaluate('slotFoldersShut().has("limb")')));
		await evaluate('ungroupSlotFolder("limb"); true'); await frames(1);
		ok('🗑 ungroups: the folder goes, its slots stay where they are', same(await T('folders()'), {}) && same(await T('names()'), names) && same(await T('rows()'), names.slice().reverse()));
		await evaluate('rigUndo(); rigUndo(); true'); await frames(2);
		ok('(undone)', same(await T('folders()'), { arm: A }), q(await T('folders()')));
		await evaluate('setSlotFolderShut("arm", false); setSlotFolderShut("limb", false); setSlotGroupAlpha("f:limb", 1); renderSlotList(); true');
	});

	await step('9. the folders stay true after any edit', async () => {
		await evaluate(`duplicateSlotCore(${q(A[2])}, "copy_front", "after"); duplicateSlotCore(${q(A[0])}, "copy_back", "before"); rebuildFromRawDoc(null); markDirty(); true`);
		ok('a copy of a member joins its folder, either side (⧉ Duplicate, ✨ Auto FX)', same((await T('folders()')).arm, ['copy_back', ...A, 'copy_front']), q(await T('folders()')));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate(`historyStep(() => { rawDoc.slots.splice(12, 0, { name: "new_inside", bone: rawDoc.slots[12].bone }); rebuildFromRawDoc(null); markDirty(); }); true`);
		ok('a new slot placed inside a folder’s run (a mirror, an import) joins it', same((await T('folders()')).arm, [A[0], A[1], 'new_inside', A[2]]), q(await T('folders()')));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate(`historyStep(() => applySlotOrder(slotOrderDrop(setupSlotNames(), [${q(A[0])}], 0))); true`);
		ok('one moved out of the run by any path leaves it', same((await T('folders()')).arm, A.slice(1)), q(await T('folders()')));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate(`historyStep(() => applySlotOrder(slotOrderDrop(setupSlotNames(), ${q(A)}, setupSlotNames().length))); true`);
		await evaluate('addSlot(null); true'); await frames(2);
		const added = (await T('names()')).slice(-1)[0];
		ok('＋ Add slot next to a folder joins none', !Object.values(await T('folders()')).flat().includes(added) && (await T('names()')).slice(-2)[0] === A[2], q({ added, f: await T('folders()') }));
		await evaluate('rigUndo(); rigUndo(); true'); await frames(2);
		ok('(undone)', same(await T('names()'), names) && same(await T('folders()'), { arm: A }));
	});

	await step('10. the slot groups of #1906 become folders, or are left out and named', async () => {
		savedControls = { doc: { controls: 1, rig: 'W', slotGroups: { together: names.slice(4, 7), spread: [names[0], names[9]] } } };
		await openW();
		ok('a group whose slots are together is a folder', same(await T('folders()'), { together: names.slice(4, 7) }), q(await T('folders()')));
		ok('the draw order is untouched', same(await T('names()'), names));
		ok('the notice names the group left out, once', /could not become folders.*: spread$/.test(await evaluate('document.getElementById("err").textContent')), q(await evaluate('document.getElementById("err").textContent')));
	});
	return { pass, fail };
}

let code;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		console.log('slot-folders-browser mutants (each must fail a check):');
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
		console.log('slot-folders-browser — the Slots list’s folders and order in the real Rigger (W)');
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
