// End-to-end browser gate for the Rigger's UNDO / REDO of rig edits.
//
//   node tools/rigger-spike/rig-undo.mjs
//   node tools/rigger-spike/rig-undo.mjs --mutants   # every planted mutant must fail the gate
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, and edits rigs the way an author does — typing into the inspector, dragging on the
// canvas, scrubbing a colour, clicking 🗑 / ▸ Convert / ② Auto-weight / 🩹 Repair / ◆ Key, importing
// from the rig library — then checks, after every kind of edit, that one undo puts back EXACTLY the
// previous `rawDoc` (string-equal JSON) and one redo EXACTLY the next. Also checked:
//   - coalescing: typing in one field is one step; another field, or a pause past 800 ms, is
//     another; a drag is one step; an edit right after typing is its own step;
//   - one undo reverts a whole delete cascade (children, slots, constraints, timelines);
//   - the selection, the skin on stage and the open animation come back with the document;
//   - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and the ↶ ↷ buttons; the keys stay out of text fields;
//   - 🎬 Cinematic owns Ctrl+Z for its own document; tweaking keys the rig, so the rig's history
//     takes it there;
//   - undo never saves, leaves the rig unsaved (the close guard warns), and the next 💾 Save is a
//     normal conditional save of the undone document;
//   - opening another rig, and a failed open, clear the history;
//   - memory: the history is capped by entry count AND bytes, measured on the biggest checked-in rig
//     (mm_bigwin).
//
// What it does NOT cover: R2, auth, a real mouse (events are dispatched, through the same listeners).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_ASSETS = fileURLToPath(new URL('apps/lines/static/assets/spines/', ROOT));
const VIEW = join(STATIC, 'rigger/view.html');

// ------------------------------------------------------------------ mutants ----
// Each one breaks ONE guarantee; the gate must fail on every one of them.
const MUTANTS = {
	'no coalescing': ['typing ? RIG_HISTORY_COALESCE_MS : 0', '0'],
	'no step boundary at the next action': [
		'if (rigHist.pending && rigHist.pendingKey !== key) historyFlush();',
		'',
	],
	'a gesture is not one step': [
		'if (rigHist.batch || rigHist.gesture) return;',
		'if (rigHist.batch) return;',
	],
	'historyStep does not close the open step': [
		'  historyFlush();\n  rigHist.actionSel = historySel();\n  rigHist.batch++;',
		'  rigHist.actionSel = historySel();\n  rigHist.batch++;',
	],
	'undo leaves the rig clean': [
		'    rigHist.present = { doc: entry.doc, sel: s };\n    dirty = true;',
		'    rigHist.present = { doc: entry.doc, sel: s };',
	],
	'a failed open keeps the history': [
		'  skeletonData = null; skeleton = null; animState = null; curEntry = null;\n  historyReset();',
		'  skeletonData = null; skeleton = null; animState = null; curEntry = null;',
	],
	'no byte cap': ['|| rigHist.bytes + doc.length > RIG_HISTORY_MAX_BYTES', ''],
	'no entry cap': ['rigHist.past.length > RIG_HISTORY_LIMIT || ', ''],
	'selection not restored': ['rebuildFromRawDoc(s.bone, s.skin);', 'rebuildFromRawDoc(null);'],
	'a new edit keeps the redo branch': [
		'    for (const e of rigHist.future) rigHist.bytes -= e.doc.length;\n    rigHist.future = [];\n',
		'',
	],
	'the rig history takes Ctrl+Z in Cinematic': [
		'!!rawDoc && !!rigHist.present && !(cineMode && !tweakMode)',
		'!!rawDoc && !!rigHist.present',
	],
	'keys reach into text fields': [
		'    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;\n    const key = e.key.toLowerCase();\n    if (key === "z" && !e.shiftKey){ e.preventDefault(); rigUndo(); }',
		'    const key = e.key.toLowerCase();\n    if (key === "z" && !e.shiftKey){ e.preventDefault(); rigUndo(); }',
	],
};

if (process.argv.includes('--mutants')) {
	let caught = 0;
	const missed = [];
	for (const name of Object.keys(MUTANTS)) {
		const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
			env: { ...process.env, RIG_UNDO_MUTANT: name },
			encoding: 'utf8',
		});
		const verdict = r.stdout
			.split('\n')
			.filter((l) => l.startsWith('  ✗'))
			.slice(0, 2);
		if (r.status === 1) {
			caught++;
			console.log(`  ✓ caught: ${name}\n      ${verdict.join('\n      ')}`);
		} else {
			missed.push(name);
			console.log(
				`  ✗ NOT caught: ${name} (exit ${r.status})\n${r.stdout.slice(-600)}${r.stderr.slice(-400)}`,
			);
		}
	}
	console.log(
		`\n${missed.length ? '✗ FAIL' : '✅ PASS'} — ${caught}/${caught + missed.length} mutants caught`,
	);
	process.exit(missed.length ? 1 : 0);
}

let html = readFileSync(VIEW, 'utf8').replace(/\r\n/g, '\n');
const mutant = process.env.RIG_UNDO_MUTANT;
if (mutant) {
	const [from, to] = MUTANTS[mutant] ?? [];
	if (!from || !html.includes(from)) {
		console.log(`mutant "${mutant}" no longer applies — update it to the code`);
		process.exit(2);
	}
	html = html.replace(from, to);
}

// ------------------------------------------------------------------ the fake launcher ----

const read = (dir, file) => JSON.parse(readFileSync(join(RIG_ASSETS, dir, file), 'utf8'));
const anticipation = read('anticipation', 'anticipation.json');
const rigDoc = (base, hash, mutate) => {
	const d = structuredClone(base);
	d.skeleton = { ...d.skeleton, hash };
	mutate?.(d);
	return d;
};
const breakIt = (d) => {
	const skin = d.skins.find((s) => s.name === 'default');
	skin.attachments[Object.keys(skin.attachments)[0]].broken_link = {
		type: 'linkedmesh',
		parent: 'no_such_mesh',
		width: 10,
		height: 10,
	};
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const RIGS = {
	A: {
		dir: 'anticipation',
		file: 'A.json',
		atlas: 'anticipation.atlas',
		doc: rigDoc(anticipation, 'rig-A'),
	},
	B: {
		dir: 'anticipation',
		file: 'B.json',
		atlas: 'anticipation.atlas',
		doc: rigDoc(anticipation, 'rig-B'),
	},
	'A-broken': {
		dir: 'anticipation',
		file: 'A-broken.json',
		atlas: 'anticipation.atlas',
		doc: rigDoc(anticipation, 'rig-X', breakIt),
	},
	BIG: {
		dir: 'bigwin',
		file: 'mm_bigwin.json',
		atlas: 'big_wins.atlas',
		doc: read('bigwin', 'mm_bigwin.json'),
	},
};
const ENTRIES = Object.entries(RIGS).map(([name, rig], id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: rig.file,
	atlas_file: rig.atlas,
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
// A library rig to import: one bone, nothing else.
const LIBRARY_RIG = {
	name: 'arm',
	skeleton: {
		skeleton: { spine: '4.2.43' },
		bones: [{ name: 'root' }, { name: 'forearm', parent: 'root', length: 40, x: 12 }],
		slots: [],
		skins: [{ name: 'default', attachments: {} }],
		animations: {},
	},
};
const etags = {};
const posted = { saves: [] };

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
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
			const rig = Object.entries(RIGS).find(([n]) => b64(n) === url.searchParams.get('dir'))?.[1];
			if (rig && name === rig.file) return jsonOut(rig.doc);
			const stem = rig?.atlas.replace(/\.atlas$/, '');
			if (rig && (name === rig.atlas || name === `${stem}.png` || name === `${stem}.webp`))
				return send(200, MIME[extname(name)], readFileSync(join(RIG_ASSETS, rig.dir, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({
				ok: true,
				projectKey: 'p',
				etag: etags[url.searchParams.get('stem')] ?? null,
			});
		if (p === '/api/rigger/save') {
			const body = JSON.parse(await readBody(req));
			posted.saves.push(body);
			const stored = etags[body.stem] ?? null;
			if (body.baseEtag !== stored)
				return jsonOut({ ok: false, error: 'conflict', etag: stored, message: 'stale' }, 409);
			etags[body.stem] = `etag-${body.stem}-${posted.saves.length}`;
			return jsonOut({ ok: true, saved: true, key: 'x', etag: etags[body.stem], count: 3 });
		}
		if (p === '/api/rigger/rigs/get') return jsonOut(LIBRARY_RIG);
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

// ------------------------------------------------------------------ CDP ----

const browser = await launchChrome({
	name: 'rig-undo',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
});
const { evaluate, waitFor, pageLog } = browser;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
	}
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;

// ------------------------------------------------------------------ the author's actions ----

// Page-side helpers. Every event goes through `dispatchEvent`, so the page's own capture listeners
// and handlers see it exactly as they see a real one.
const install = () =>
	evaluate(`(() => {
		window.__asked = []; window.__alerts = [];
		window.confirm = (m) => { window.__asked.push(String(m)); return true; };
		window.alert = (m) => { window.__alerts.push(String(m)); };
		window.prompt = () => "x";
		window.T = {
			snap: () => JSON.stringify(rawDoc),
			hist: () => ({ past: rigHist.past.length, future: rigHist.future.length, bytes: rigHist.bytes, pending: rigHist.pending }),
			sel: () => ({ bone: selBone != null && skeletonData ? skeletonData.bones[selBone].name : null, slot: selSlot, skin: skeleton ? activeSkinName() : null, anim: curAnim }),
			// One keystroke into a field: keydown, the new value, input — what a browser does.
			key(el, ch, first) {
				el.focus();
				el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
				el.value = (first ? "" : el.value) + ch;
				el.dispatchEvent(new Event("input", { bubbles: true }));
			},
			set(el, v) {
				el.focus();
				el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
				el.value = String(v);
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
			},
			click(el) {
				const o = { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 };
				el.dispatchEvent(new PointerEvent("pointerdown", o));
				el.dispatchEvent(new MouseEvent("mousedown", o));
				el.dispatchEvent(new PointerEvent("pointerup", o));
				el.dispatchEvent(new MouseEvent("mouseup", o));
				el.click();
			},
			button(root, text) {
				return [...document.querySelectorAll(root + " button")].find((b) => b.textContent.includes(text)) || null;
			},
			chord(key, mods) {
				const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, metaKey: !!mods.meta });
				(document.activeElement || document.body).dispatchEvent(e);
				return e.defaultPrevented;
			},
			blur() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); },
		};
		return true;
	})()`);
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
	return found;
}
const snap = () => evaluate('T.snap()');
const hist = () => evaluate('T.hist()');
const sel = () => evaluate('T.sel()');
/** Wait out the coalescing window, so the open step is closed. */
const quiet = () => wait(1000);
const setMode = (m) =>
	evaluate(`T.click(document.querySelector('#modeSeg button[data-mode="${m}"]')); mode`);
const undoKey = () => evaluate('T.blur(); T.chord("z", { ctrl: true })');
const redoKey = (y) =>
	evaluate(`T.blur(); T.chord(${y ? '"y", { ctrl: true }' : '"z", { ctrl: true, shift: true }'})`);
/**
 * Select the setup bone field `idx` (x, y, rotation…) and type `text` over it, one keystroke per
 * task. The value typed is new each time (a digit appended to a long float may not change it).
 */
let typedSeq = 0;
async function typeBone(idx, text, gap = 80) {
	const chars = [...String(++typedSeq), ...text];
	for (const [i, ch] of chars.entries()) {
		await evaluate(
			`T.key(document.querySelectorAll('#boneDetail input[type=number]')[${idx}], ${q(ch)}, ${i === 0}); true`,
		);
		await wait(gap);
	}
}
const selectBoneNamed = (n) =>
	evaluate(
		`(() => { const i = skeletonData.bones.findIndex((b) => b.name === ${q(n)}); selectBone(i); return i; })()`,
	);

/**
 * Undo every step back to `snaps[0]`, checking each lands EXACTLY on the snapshot before it, then
 * redo every step forward, checking each lands exactly on the next.
 */
async function walk(label, snaps, how = 'buttons') {
	let good = true;
	for (let i = snaps.length - 2; i >= 0; i--) {
		if (how === 'keys') await undoKey();
		else await evaluate('T.click(document.getElementById("undoBtn")); true');
		const s = await snap();
		if (s !== snaps[i])
			good = ok(
				`${label}: undo ${snaps.length - 1 - i} → exactly the previous rawDoc`,
				false,
				`differs from step ${i}`,
			);
	}
	if (good) ok(`${label}: ${snaps.length - 1} undos, each EXACTLY the previous rawDoc`, true);
	good = true;
	for (let i = 1; i < snaps.length; i++) {
		if (how === 'keys') await redoKey(i % 2 === 0);
		else await evaluate('T.click(document.getElementById("redoBtn")); true');
		const s = await snap();
		if (s !== snaps[i])
			good = ok(`${label}: redo ${i} → exactly the next rawDoc`, false, `differs from step ${i}`);
	}
	if (good) ok(`${label}: ${snaps.length - 1} redos, each EXACTLY the next rawDoc`, true);
}

try {
	await step('1. open A', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 4');
		await install();
		ok('A is in the rig list', await openRig('A'));
		const h = await hist();
		ok('a fresh rig has nothing to undo', h.past === 0 && h.future === 0, q(h));
		const ui = await evaluate(
			'({ shown: document.getElementById("undoSeg").style.display !== "none", u: document.getElementById("undoBtn").disabled, r: document.getElementById("redoBtn").disabled })',
		);
		ok('↶ ↷ are shown, both disabled', ui.shown && ui.u && ui.r, q(ui));
	});

	// The bone with the most below it: its delete is a real cascade.
	const victim = await evaluate(`(() => {
		const count = (n) => rawDoc.bones.filter((b) => b.parent === n).reduce((s, b) => s + 1 + count(b.name), 0)
			+ (rawDoc.slots || []).filter((s) => s.bone === n).length;
		return rawDoc.bones.filter((b) => b.parent).map((b) => [b.name, count(b.name)]).sort((a, b) => b[1] - a[1])[0][0];
	})()`);

	const typed = [];
	await step('2. Setup: typing into the inspector', async () => {
		ok('✎ Setup', (await setMode('setup')) === 'setup');
		await selectBoneNamed(victim);
		typed.push(await snap());
		await typeBone(0, '123');
		await quiet();
		typed.push(await snap());
		let h = await hist();
		ok('"123" typed into x is ONE step', h.past === 1, q(h));
		await typeBone(1, '5');
		await wait(200);
		await typeBone(0, '4');
		await quiet();
		h = await hist();
		ok('y, then x 200 ms later: another field is another step', h.past === 3, q(h));
		await typeBone(0, '7');
		await wait(1200);
		await typeBone(0, '8');
		await quiet();
		h = await hist();
		ok('x again after a 1.2 s pause: a new step', h.past === 5, q(h));
		const s = await snap();
		ok('the edits reached rawDoc', s !== typed[0]);
		// Undo all five recording each state, then walk them with the keys.
		const states = [s];
		for (let i = 0; i < 5; i++) {
			await evaluate('rigUndo()');
			states.unshift(await snap());
		}
		ok('five undos reach the rig as opened', states[0] === typed[0]);
		ok('…and the first undo of "123" is exact', states[1] === typed[1]);
		for (let i = 0; i < 5; i++) await evaluate('rigRedo()');
		ok('five redos reach the end state', (await snap()) === s);
		await walk('typing (keys)', states, 'keys');
		ok('the bone is still selected', (await sel()).bone === victim, q(await sel()));
		await undoKey();
		await typeBone(2, '5');
		await quiet();
		const hb = await hist();
		ok('an edit after an undo drops the redo branch', hb.future === 0, q(hb));
		ok('…so redo does nothing', (await evaluate('rigRedo()')) === false);
		ok('↷ is disabled', await evaluate('document.getElementById("redoBtn").disabled'));
	});

	await step('3. Setup: a canvas drag is one step', async () => {
		const before = await snap();
		const h0 = await hist();
		await evaluate(`(() => {
			const b = skeleton.bones[selBone], p = fxProject(b.worldX, b.worldY), r = document.getElementById("cv").getBoundingClientRect();
			window.__xy = [r.left + p.x, r.top + p.y];
			const o = { bubbles: true, cancelable: true, button: 0, clientX: __xy[0], clientY: __xy[1] };
			const cv = document.getElementById("cv");
			cv.dispatchEvent(new PointerEvent("pointerdown", o)); cv.dispatchEvent(new MouseEvent("mousedown", o));
			return true;
		})()`);
		for (let i = 1; i <= 6; i++) {
			await evaluate(`(() => {
				const o = { bubbles: true, clientX: __xy[0] + ${i * 7}, clientY: __xy[1] + ${i * 3} };
				window.dispatchEvent(new PointerEvent("pointermove", o)); window.dispatchEvent(new MouseEvent("mousemove", o));
				return true;
			})()`);
			await wait(40);
		}
		await evaluate(`(() => {
			const o = { bubbles: true, button: 0, clientX: __xy[0] + 42, clientY: __xy[1] + 18 };
			window.dispatchEvent(new PointerEvent("pointerup", o)); window.dispatchEvent(new MouseEvent("mouseup", o));
			return true;
		})()`);
		await wait(100);
		const after = await snap();
		const h = await hist();
		ok('the drag moved the bone', after !== before);
		ok('…as ONE step', h.past === h0.past + 1, `${h0.past} → ${h.past}`);
		await walk('drag', [before, after]);
	});

	await step('4. Animate: a colour scrub, a slider stepped from the keyboard, ◆ Key', async () => {
		ok('◆ Animate', (await setMode('animate')) === 'animate');
		const slot = await evaluate(
			`(() => { const s = rawDoc.slots.find((x) => x.attachment); selectSlot(s.name); return s.name; })()`,
		);
		const s0 = await snap();
		const h0 = await hist();
		for (const c of ['#ff0000', '#ee1100', '#dd2200', '#cc3300', '#bb4400']) {
			await evaluate(
				`(() => { const el = document.querySelector('#slotDetail input[type=color]'); el.focus(); el.value = ${q(c)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
			);
			await wait(90);
		}
		await quiet();
		const s1 = await snap();
		let h = await hist();
		ok(
			`scrubbing ${slot}'s tint through 5 colours is ONE step`,
			s1 !== s0 && h.past === h0.past + 1,
			`${h0.past} → ${h.past}`,
		);
		for (let v = 60; v >= 40; v -= 5) {
			await evaluate(`T.set(document.querySelector('#slotDetail input[type=range]'), ${v}); true`);
			await wait(90);
		}
		await quiet();
		const s2 = await snap();
		h = await hist();
		ok(
			'stepping the opacity slider 5 times from the keyboard is ONE step',
			s2 !== s1 && h.past === h0.past + 2,
			`${h0.past} → ${h.past}`,
		);
		await selectBoneNamed(victim);
		await evaluate(
			`(() => { skeleton.bones[selBone].rotation += 25; updateWorld(); T.click(document.getElementById("keyBtn")); return true; })()`,
		);
		await wait(50);
		const s3 = await snap();
		h = await hist();
		ok('◆ Key is ONE step', s3 !== s2 && h.past === h0.past + 3, `${h0.past} → ${h.past}`);
		const anim = (await sel()).anim;
		await walk('animate', [s0, s1, s2, s3]);
		ok('the open animation is still the one keyed', (await sel()).anim === anim, q(await sel()));
	});

	await step('5. the animation and the skin come back with the document', async () => {
		const anim = (await sel()).anim;
		const s0 = await snap();
		await evaluate('T.click(T.button("#animList", "＋") || T.button("#animList", "New")); true');
		await wait(50);
		const made = (await sel()).anim;
		ok('＋ New animation opens the new clip', made && made !== anim, `${anim} → ${made}`);
		await undoKey();
		ok('undo removes it…', (await snap()) === s0);
		ok('…and reopens the clip that was open', (await sel()).anim === anim, q(await sel()));
		await redoKey();
		ok('redo brings it back, open', (await sel()).anim === made, q(await sel()));
		await undoKey();

		await setMode('setup');
		const s1 = await snap();
		await evaluate('addSkin(); markDirty(); true');
		await evaluate('T.click(document.body); true');
		await wait(50);
		const skin = await evaluate('rawDoc.skins.at(-1).name');
		await evaluate(
			`(() => { const s = document.getElementById("skin"); s.value = ${q(skin)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
		);
		await selectBoneNamed(victim);
		await typeBone(1, '9');
		await quiet();
		const s2 = await snap();
		await evaluate(
			`(() => { const s = document.getElementById("skin"); s.value = "default"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
		);
		ok('the skin on stage is "default" again', (await sel()).skin === 'default');
		await undoKey();
		ok(
			`undo of an edit made in "${skin}" puts "${skin}" back on stage`,
			(await sel()).skin === skin && (await snap()) !== s2,
			q(await sel()),
		);
		await undoKey();
		ok(
			'undo of ＋ skin removes it, back to default',
			(await snap()) === s1 && (await sel()).skin === 'default',
			q(await sel()),
		);
	});

	await step('6. a delete cascade is ONE undo', async () => {
		await selectBoneNamed(victim);
		const s0 = await snap();
		const h0 = await hist();
		await typeBone(0, '6');
		await wait(100);
		const s1 = await snap();
		await evaluate('T.click(T.button("#boneDetail", "Delete bone")); true');
		await wait(50);
		const s2 = await snap();
		const gone = await evaluate(`(() => {
			const d = JSON.parse(T.snap());
			return { bone: d.bones.some((b) => b.name === ${q(victim)}), bones: d.bones.length };
		})()`);
		const h = await hist();
		ok(`🗑 deleted "${victim}"`, !gone.bone, q(gone));
		ok(
			'typing, then 🗑 100 ms later: two steps, not one',
			h.past === h0.past + 2,
			`${h0.past} → ${h.past}`,
		);
		const nBefore = JSON.parse(s1).bones.length;
		ok(
			`the cascade changed more than the one bone (${nBefore} → ${gone.bones} bones, slots and timelines moved)`,
			nBefore - gone.bones >= 1,
		);
		await undoKey();
		ok('ONE undo restores the whole cascade, exactly', (await snap()) === s1);
		ok('…with the deleted bone selected again', (await sel()).bone === victim, q(await sel()));
		await undoKey();
		ok('a second undo takes back the typing, exactly', (await snap()) === s0);
		await redoKey();
		await redoKey(true);
		ok('two redos land on the deleted state, exactly', (await snap()) === s2);
		await walk('delete', [s0, s1, s2]);
		await undoKey();
		await undoKey();
		ok('(rewound to before the delete)', (await snap()) === s0);
	});

	await step('7. ▸ Convert to mesh, ② Auto-weight, 🩹 Repair', async () => {
		// A region on a bone with a child, so the chain has length.
		const target = await evaluate(`(() => {
			for (const s of rawDoc.slots){
				const def = rawDoc.skins[0].attachments[s.name] && rawDoc.skins[0].attachments[s.name][s.attachment];
				if (!def || (def.type && def.type !== "region")) continue;
				if (rawDoc.bones.some((b) => b.parent === s.bone)) return s.name;
			}
			return null;
		})()`);
		ok('a region slot on a bone with children', !!target, target);
		await evaluate(`selectSlot(${q(target)}); true`);
		const s0 = await snap();
		await evaluate('T.click(T.button("#slotDetail", "Convert to mesh")); true');
		await wait(50);
		const s1 = await snap();
		ok('▸ Convert to mesh made a mesh', /"type":"mesh"/.test(s1) && s1 !== s0);
		const bone = await evaluate(`rawDoc.slots.find((s) => s.name === ${q(target)}).bone`);
		await evaluate(
			`selectSlot(${q(target)}); selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(bone)})); true`,
		);
		const auto = await evaluate('!!T.button("#slotDetail", "Auto-weight to chain")');
		ok('② Auto-weight to chain is offered', auto);
		await evaluate('T.click(T.button("#slotDetail", "Auto-weight to chain")); true');
		await wait(50);
		const s2 = await snap();
		ok('② Auto-weight weighted the mesh', s2 !== s1);

		// A mesh as the pre-fix ▸ Convert made it from a trimmed image: UVs 0..1 across the ink. Made in
		// two steps of its own (a convert, then the old mapping), then repaired.
		const trimmed = await evaluate(`(() => {
			const atlas = assetMgr.require(selected.atlas_file);
			for (const reg of atlas.regions){
				if (!(reg.offsetX || reg.offsetY || reg.width !== reg.originalWidth || reg.height !== reg.originalHeight)) continue;
				const s = rawDoc.slots.find((x) => x.attachment === reg.name && rawDoc.skins[0].attachments[x.name] && !rawDoc.skins[0].attachments[x.name][reg.name].type);
				if (s) return { slot: s.name, region: reg.name };
			}
			return null;
		})()`);
		ok('a slot showing a trimmed image', !!trimmed, q(trimmed));
		await evaluate(
			`selectSlot(${q(trimmed.slot)}); T.click(T.button("#slotDetail", "Convert to mesh")); true`,
		);
		await wait(50);
		const s3 = await snap();
		const offered = await evaluate(`(() => {
			const reg = assetMgr.require(selected.atlas_file).regions.find((r) => r.name === ${q(trimmed.region)});
			historyStep(() => {
				const def = rawDoc.skins[0].attachments[${q(trimmed.slot)}][${q(trimmed.region)}];
				const ink = regionInkUVs(reg);
				for (let i = 0; i + 1 < def.uvs.length; i += 2){
					def.uvs[i] = (def.uvs[i] - ink.u0) / (ink.u1 - ink.u0);
					def.uvs[i + 1] = (def.uvs[i + 1] - ink.v0) / (ink.v1 - ink.v0);
				}
				rebuildFromRawDoc(null); markDirty();
			});
			refreshArtWarn();
			return meshRepairs().length;
		})()`);
		const s4 = await snap();
		ok('the stale trimmed-image mesh is offered 🩹 Repair', offered > 0, offered);
		await evaluate('T.click(T.button("#artWarn", "Repair")); true');
		await wait(50);
		const s5 = await snap();
		ok('🩹 Repair repaired it', s5 !== s4 && (await evaluate('meshRepairs().length')) === 0);
		await walk('convert / auto-weight / repair', [s0, s1, s2, s3, s4, s5]);
	});

	await step('8. import from the rig library, right after typing', async () => {
		await setMode('setup');
		await selectBoneNamed('root');
		const s0 = await snap();
		const h0 = await hist();
		await typeBone(0, '3');
		await wait(50);
		const s1 = await snap();
		// Programmatic, mid-burst: the import's edit lands after a fetch, outside any user action.
		await evaluate('importRig("lib1")');
		await wait(100);
		const s2 = await snap();
		const h = await hist();
		ok('the import merged the library rig', /forearm/.test(s2) && !/forearm/.test(s1));
		ok('the typing and the import are two steps', h.past === h0.past + 2, `${h0.past} → ${h.past}`);
		await walk('import', [s0, s1, s2]);
	});

	await step('9. Ctrl+Z in a text field is the browser’s, not the rig’s', async () => {
		await selectBoneNamed('root');
		const s0 = await snap();
		const h0 = await hist();
		const took = await evaluate(
			`(() => { const el = document.querySelectorAll('#boneDetail input[type=number]')[0]; el.focus(); return T.chord("z", { ctrl: true }); })()`,
		);
		ok(
			'the rig ignores Ctrl+Z with focus in a field',
			!took && (await snap()) === s0 && (await hist()).past === h0.past,
		);
		await evaluate('T.blur(); true');
	});

	await step(
		'10. 🎬 Cinematic owns Ctrl+Z; a tweak keys the rig, so the rig takes it',
		async () => {
			const s0 = await snap();
			const h0 = await hist();
			await setMode('cinematic');
			await waitFor('!!window.RiggerCinematic', 20000);
			ok(
				'↶ ↷ are hidden in Cinematic',
				(await evaluate('document.getElementById("undoSeg").style.display')) === 'none',
			);
			await undoKey();
			ok(
				'Ctrl+Z in Cinematic leaves the rig alone',
				(await snap()) === s0 && (await hist()).past === h0.past,
			);
			const anim = await evaluate('firstAnimName()');
			const r = await evaluate(
				`beginTweak({ actorId: "a1", clip: ${q(anim)}, label: "t", stripId: "s1" })`,
			);
			ok('a tweak opens on the rig', r === null && (await evaluate('tweakMode')), q(r));
			ok(
				'↶ ↷ are shown while tweaking',
				(await evaluate('document.getElementById("undoSeg").style.display')) !== 'none',
			);
			await evaluate(
				`(() => { selectBone(0); skeleton.bones[0].rotation += 10; updateWorld(); T.click(document.getElementById("keyBtn")); return true; })()`,
			);
			await wait(50);
			const s1 = await snap();
			ok('◆ Key while tweaking edits the rig', s1 !== s0);
			await undoKey();
			ok('Ctrl+Z while tweaking undoes the key, exactly', (await snap()) === s0);
			await redoKey(true);
			ok('Ctrl+Y redoes it, exactly', (await snap()) === s1);
			await evaluate(
				'window.RiggerCinematic.exitTweak ? window.RiggerCinematic.exitTweak() : endTweak(); true',
			);
			await setMode('setup');
		},
	);

	await step('11. undo never saves; the next 💾 is a normal conditional save', async () => {
		await selectBoneNamed('root');
		const n = posted.saves.length;
		await typeBone(1, '1');
		await quiet();
		await evaluate('saveToR2()');
		const saved = await snap();
		const etag = await evaluate('rigEtag');
		ok(
			'💾 saved, the rig is clean',
			posted.saves.length === n + 1 && (await evaluate('dirty')) === false,
		);
		// Undoing an edit the save already holds: the rig on screen is no longer what was saved.
		await undoKey();
		ok('undo straight after 💾 marks the rig unsaved', (await evaluate('dirty')) === true);
		await redoKey();
		ok('(redo back to the saved document)', (await snap()) === saved);
		await typeBone(1, '2');
		await quiet();
		await undoKey();
		ok('undo back to the saved document…', (await snap()) === saved);
		ok('…saves nothing', posted.saves.length === n + 1);
		ok('…and leaves the rig unsaved', (await evaluate('dirty')) === true);
		ok(
			'closing the tab warns',
			await evaluate(
				'(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()',
			),
		);
		await undoKey();
		const undone = await snap();
		await evaluate('saveToR2()');
		const body = posted.saves.at(-1);
		ok(
			'💾 after undo is conditional on the last save’s tag',
			posted.saves.length === n + 2 && body.baseEtag === etag,
			`${body?.baseEtag} vs ${etag}`,
		);
		const rootX = (d) => d.bones.find((b) => b.name === 'root').y;
		ok(
			'…and saves the undone document',
			rootX(body.skeleton) === rootX(JSON.parse(undone)),
			`${rootX(body.skeleton)} vs ${rootX(JSON.parse(undone))}`,
		);
	});

	await step('12. opening another rig, or failing to, clears the history', async () => {
		ok('A has history', (await hist()).past > 0);
		await openRig('B');
		let h = await hist();
		ok('opening B starts it empty', h.past === 0 && h.future === 0, q(h));
		ok('↶ is disabled', await evaluate('document.getElementById("undoBtn").disabled'));
		await setMode('setup');
		await selectBoneNamed('root');
		await typeBone(0, '1');
		await quiet();
		ok('B has history', (await hist()).past === 1);
		await openRig('A-broken');
		h = await hist();
		ok(
			'a failed open clears it',
			h.past === 0 && h.future === 0 && (await evaluate('rigHist.present')) === null,
			q(h),
		);
		ok(
			'↶ ↷ are hidden with no rig open',
			(await evaluate('document.getElementById("undoSeg").style.display')) === 'none',
		);
		await undoKey();
		ok('Ctrl+Z with no rig open does nothing', (await evaluate('rawDoc')) === null);
	});

	await step('13. memory: capped by entries and by bytes', async () => {
		await openRig('A');
		const base = await evaluate('rawDoc.bones[1].x || 0');
		await evaluate(
			`(() => { for (let i = 1; i <= ${110}; i++) historyStep(() => { rawDoc.bones[1].x = ${base} + i; markDirty(); }); return true; })()`,
		);
		let h = await hist();
		const limit = await evaluate('RIG_HISTORY_LIMIT');
		ok(`110 steps on A keep the last ${limit}`, h.past === limit, q(h));
		while (await evaluate('rigUndo()'));
		ok('the oldest kept is step 10', (await evaluate('rawDoc.bones[1].x')) === base + 10);

		await openRig('BIG');
		const m = await evaluate(`(() => {
			const t0 = performance.now(); let s; for (let i = 0; i < 5; i++) s = JSON.stringify(rawDoc);
			const ser = (performance.now() - t0) / 5;
			const t1 = performance.now(); historyStep(() => { rawDoc.bones[1].x = (rawDoc.bones[1].x || 0) + 1; markDirty(); });
			return { bytes: s.length, ser, step: performance.now() - t1, cap: RIG_HISTORY_MAX_BYTES };
		})()`);
		const fits = Math.floor(m.cap / m.bytes) - 1;
		console.log(
			`  · mm_bigwin: ${(m.bytes / 1048576).toFixed(2)} MB per snapshot, JSON.stringify ${m.ser.toFixed(1)} ms, a step ${m.step.toFixed(1)} ms; ${(m.cap / 1048576).toFixed(0)} MB keeps ${fits} steps`,
		);
		const bx = await evaluate('rawDoc.bones[1].x');
		const n = fits + 10;
		await evaluate(
			`(() => { for (let i = 1; i <= ${n}; i++) historyStep(() => { rawDoc.bones[1].x = ${bx} + i; markDirty(); }); return true; })()`,
		);
		h = await hist();
		const sum = await evaluate(
			'rigHist.past.concat(rigHist.future).reduce((s, e) => s + e.doc.length, 0)',
		);
		ok(
			`${n + 1} steps on mm_bigwin stay under the byte cap`,
			h.bytes + m.bytes <= m.cap && h.past < n,
			q(h),
		);
		ok('…and the byte count is exact', sum === h.bytes, `${sum} vs ${h.bytes}`);
		const kept = h.past;
		while (await evaluate('rigUndo()'));
		ok(
			`undo walks back exactly ${kept} steps`,
			(await evaluate('rawDoc.bones[1].x')) === bx + n - kept,
			`${await evaluate('rawDoc.bones[1].x')} vs ${bx + n - kept}`,
		);
		h = await hist();
		ok('…and after undoing them all, still under the cap', h.bytes + m.bytes <= m.cap, q(h));
	});

	await step('14. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length && !mutant)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}

console.log(
	`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}${mutant ? ` (mutant: ${mutant})` : ''}`,
);
process.exit(fail === 0 ? 0 : 1);
