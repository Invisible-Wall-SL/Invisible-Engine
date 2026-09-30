// End-to-end browser gate for OPENING a rig in /rigger — what the tool holds once an open fails,
// and what happens to the rig it replaces.
//
//   node tools/rigger-spike/rig-switch.mjs
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API serving three copies of the shipped `anticipation` rig: S, T and "S-broken", whose
// linked mesh names a parent its skin does not have, so the minified runtime throws "Parent mesh
// not found" while reading it — after every other part of the rig has parsed.
//
// Reported 2026-09-30: open S, then S-broken. The open set the selection and the save precondition
// to S-broken's but, when the read threw, left S's document open — so 💾 posted S's skeleton as
// `S-broken` with S-broken's own ETag, the precondition passed, and S-broken.irig was overwritten
// with S; 📦 offered S to the library under S-broken's name. Checked here, the way an author gets
// there:
//   - opening another rig over unsaved edits asks first, and Cancel keeps them;
//   - a failed open leaves NO rig open: no document, nothing on stage, ⤓ .irig / 💾 / 📦 disabled,
//     and not a byte sent when they are called anyway; 🕘 History stays available for the rig that
//     failed, and restoring an earlier save opens it again;
//   - the cinematic's tweak, which opens a rig the same way, reports the failure;
//   - a rig that fails on BOOT restore leaves the same state, and a failed rig is never the one
//     the next visit reopens;
//   - while a rig loads, no document is open under its name;
//   - a save, or a text document, still in flight when another rig opens does not land on it.
//
// What it does NOT cover: R2, auth, the server's own refusals (the fake answers like it).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_DIR = fileURLToPath(new URL('apps/lines/static/assets/spines/anticipation/', ROOT));

// `CHROME_PATH` wins (a CI image's system Chrome needs no download); otherwise any Playwright
// Chromium, in Playwright's own cache locations per platform.
function findChromium() {
	if (process.env.CHROME_PATH)
		return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
	const bases = [
		process.env.PLAYWRIGHT_BROWSERS_PATH,
		process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
		join(homedir(), '.cache', 'ms-playwright'),
		join(homedir(), 'Library', 'Caches', 'ms-playwright'),
	].filter((b) => b && existsSync(b));
	const rels = [
		join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
		join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
		join('chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
		join('chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
		join('chrome-win', 'chrome.exe'),
		join('chrome-linux64', 'chrome'),
		join('chrome-linux', 'chrome'),
	];
	for (const base of bases)
		for (const dir of readdirSync(base))
			for (const rel of rels) {
				const p = join(base, dir, rel);
				if (existsSync(p)) return p;
			}
	return null;
}
const CHROME = findChromium();
if (!CHROME) {
	console.error(
		'No Chromium found (set CHROME_PATH, or: npx playwright install chromium-headless-shell) — this gate needs a real browser.',
	);
	process.exit(1);
}

// ------------------------------------------------------------------ the fake launcher ----

const base = JSON.parse(readFileSync(join(RIG_DIR, 'anticipation.json'), 'utf8'));
/** A copy of the shipped rig, told apart by `skeleton.hash` — which is how a save is traced. */
const rigDoc = (hash, mutate) => {
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
	S: { file: 'S.json', doc: rigDoc('rig-S') },
	'S-broken': { file: 'S-broken.json', doc: rigDoc('rig-B', breakIt) },
	T: { file: 'T.json', doc: rigDoc('rig-T') },
};
const ENTRIES = Object.entries(RIGS).map(([name, rig], id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: rig.file,
	atlas_file: 'anticipation.atlas',
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
// The stored `.irig` ETag per stem (null = none yet). S-broken HAS one — its precondition passing is
// what let the cross-rig save through.
const etags = { S: null, 'S-broken': 'etag-B-1', T: null };
const posted = { saves: [], library: [], restores: [], creates: 0 };
// Slow answers, to hold the page inside a window: a save in flight, a rig loading, a text document
// still on its way.
const delay = { save: 0, skeleton: 0, text: 0 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Rig text documents (localized art), by rig — given to S only for the step that checks one.
const TEXT = {};

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
	const traced = (body) => body.skeleton?.skeleton?.hash ?? null;
	try {
		if (p === '/') return send(200, MIME['.html'], readFileSync(join(STATIC, 'rigger/view.html')));
		if (p === '/spine/skeletons')
			return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/spine/file') {
			const name = url.searchParams.get('name') ?? '';
			const rig = Object.entries(RIGS).find(([n]) => b64(n) === url.searchParams.get('dir'))?.[1];
			if (rig && name === rig.file) {
				await wait(delay.skeleton);
				return jsonOut(rig.doc);
			}
			// The `.atlas` names `anticipation.webp`; the bundle has a `.png` sibling too.
			if (rig && /^anticipation\.(atlas|png|webp)$/.test(name))
				return send(200, MIME[extname(name)], readFileSync(join(RIG_DIR, name)));
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
			await wait(delay.save);
			posted.saves.push({ stem: body.stem, baseEtag: body.baseEtag, doc: traced(body) });
			const stored = etags[body.stem] ?? null;
			if (body.baseEtag !== stored)
				return jsonOut({ ok: false, error: 'conflict', etag: stored, message: 'stale' }, 409);
			etags[body.stem] = `etag-${body.stem}-${posted.saves.length}`;
			return jsonOut({ ok: true, saved: true, key: 'x', etag: etags[body.stem], count: 3 });
		}
		if (p === '/api/rigger/rigs/save') {
			const body = JSON.parse(await readBody(req));
			posted.library.push({ name: body.name, doc: traced(body) });
			return jsonOut({ ok: true, etag: 'lib-1' });
		}
		if (p === '/api/rigger/backups' && req.method === 'GET')
			return jsonOut({
				ok: true,
				backups:
					url.searchParams.get('stem') === 'S-broken'
						? [{ id: 'b1', savedAt: '2026-09-29T10:00:00Z', size: 204800 }]
						: [],
			});
		if (p === '/api/rigger/backups') {
			const body = JSON.parse(await readBody(req));
			posted.restores.push({ stem: body.stem, id: body.id, baseEtag: body.baseEtag });
			const stored = etags[body.stem] ?? null;
			if (body.baseEtag !== stored)
				return jsonOut({ ok: false, error: 'conflict', etag: stored, message: 'stale' }, 409);
			// The backup is the version saved before the rig broke.
			RIGS[body.stem].doc = rigDoc('rig-B-restored');
			etags[body.stem] = 'etag-B-2';
			return jsonOut({ ok: true, etag: etags[body.stem] });
		}
		if (p === '/api/rigger/new') {
			posted.creates++;
			return send(500, 'text/plain', 'this gate creates no rigs');
		}
		if (p === '/api/rigger/text' && req.method === 'GET') {
			const name = Object.keys(RIGS).find((n) => b64(n) === url.searchParams.get('dir'));
			if (!TEXT[name]) return send(404, 'text/plain', 'no text document');
			await wait(delay.text);
			return jsonOut({ doc: TEXT[name], etag: `text-${name}`, regions: [] });
		}
		if (p.startsWith('/api/'))
			return jsonOut({ effects: [], atlases: [], rigs: [], animations: [], clips: [] });
		// Everything else: the launcher's static tree (view.html's scripts + vendored runtimes).
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

const profile = mkdtempSync(join(tmpdir(), 'rig-switch-cdp-'));
const chrome = spawn(
	CHROME,
	[
		'--headless',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--no-sandbox',
		'--disable-dev-shm-usage',
		'--use-gl=angle',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--window-size=1600,1000',
		`http://127.0.0.1:${PORT}/`,
	],
	{ stdio: ['ignore', 'pipe', 'pipe'] },
);
const wsUrl = await new Promise((resolve, reject) => {
	const t = setTimeout(() => reject(new Error('no devtools endpoint')), 20000);
	let buf = '';
	chrome.stderr.on('data', (c) => {
		buf += c;
		const m = /ws:\/\/[^\s]+/.exec(buf);
		if (m) {
			clearTimeout(t);
			resolve(m[0]);
		}
	});
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pendingMsgs = new Map();
const pageLog = [];
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pendingMsgs.has(msg.id)) {
		pendingMsgs.get(msg.id)(msg);
		pendingMsgs.delete(msg.id);
		return;
	}
	if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'log')
		pageLog.push(
			`[${msg.params.type}] ` +
				msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
		);
	if (msg.method === 'Runtime.exceptionThrown')
		pageLog.push(
			`[uncaught] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
		);
};
// A page that never answers must fail this gate, not hang it until the runner kills it (which
// would leave Chrome running).
const cdp = (method, params = {}, sessionId) =>
	new Promise((resolve, reject) => {
		const id = ++msgId;
		const timer = setTimeout(() => {
			pendingMsgs.delete(id);
			reject(new Error(`${method} got no answer in 30 s`));
		}, 30000);
		pendingMsgs.set(id, (msg) => {
			clearTimeout(timer);
			resolve(msg);
		});
		ws.send(JSON.stringify({ id, method, params, sessionId }));
	});

const { result: targets } = await cdp('Target.getTargets');
const target = targets.targetInfos.find((t) => t.type === 'page');
const { result: attached } = await cdp('Target.attachToTarget', {
	targetId: target.targetId,
	flatten: true,
});
const session = attached.sessionId;
await cdp('Runtime.enable', {}, session);

async function evaluate(expression) {
	const res = await cdp(
		'Runtime.evaluate',
		{ expression, awaitPromise: true, returnByValue: true },
		session,
	);
	const r = res.result;
	if (r.exceptionDetails)
		throw new Error(
			r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails),
		);
	return r.result.value;
}
const waitFor = async (expr, ms = 20000) => {
	const t0 = Date.now();
	for (;;) {
		const v = await evaluate(expr).catch(() => false);
		if (v) return v;
		if (Date.now() - t0 > ms) throw new Error('timed out waiting for: ' + expr);
		await new Promise((r) => setTimeout(r, 120));
	}
};

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
};
// Each step reports on its own, so a page that fails one still shows how it does on the rest.
async function step(title, fn) {
	console.log(`\n${title}`);
	try {
		await fn();
	} catch (e) {
		fail++;
		console.log(`  ✗ the harness threw — ${e.message}`);
	}
}

// ------------------------------------------------------------------ the author's actions ----

const q = JSON.stringify;
/**
 * Every confirm is recorded and answered with `__answer`, alerts are recorded (a native dialog would
 * block the page), and ⤓ downloads are recorded, not made.
 */
const stubDialogs = () =>
	evaluate(`(() => {
		window.__asked = []; window.__answer = true; window.__downloads = []; window.__alerts = [];
		window.confirm = (m) => { window.__asked.push(String(m)); return window.__answer; };
		window.alert = (m) => { window.__alerts.push(String(m)); };
		window.prompt = () => "library-copy";
		const click = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function () {
			if (this.download) { window.__downloads.push(this.download); return; }
			return click.call(this);
		};
		return true;
	})()`);
const answer = (yes) => evaluate(`window.__asked = []; window.__answer = ${yes}; true`);
/** What the tool holds and shows: selection, document, stage, precondition, buttons, outline. */
const state = () =>
	evaluate(`(() => {
		const err = document.getElementById("err");
		const on = (id) => !document.getElementById(id).disabled;
		return {
			selected: selected ? selected.skeleton_file : null,
			doc: rawDoc ? rawDoc.skeleton.hash : null,
			data: !!skeletonData,
			stage: !!skeleton,
			dirty,
			etag: rigEtag === undefined ? "(unknown)" : rigEtag,
			err: err.style.display === "block" ? err.textContent : "",
			irig: on("exportBtn"), save: on("saveBtn"), library: on("saveRigLibBtn"), history: on("histBtn"),
			insName: document.getElementById("insName").textContent,
			insSub: document.getElementById("insSub").textContent,
			bones: document.querySelectorAll("#boneTree .trow").length,
		};
	})()`);
const settle = () =>
	waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
/** ⤓ Load spine, then a click on the rig's row — the way an author opens one. */
const clickRig = (name) =>
	evaluate(`(() => {
		document.getElementById("loadSpineBtn").click();
		const row = [...document.querySelectorAll("#list .item")]
			.find((d) => d.querySelector(".nm").textContent === ${q(name)});
		if (row) row.click();
		return !!row;
	})()`);
async function openFromList(name) {
	const found = await clickRig(name);
	await settle();
	return found;
}
/** The rig the next visit reopens. */
const remembered = () =>
	evaluate('(JSON.parse(localStorage.getItem(riggerStateKey()) || "null") || {}).file ?? null');
const edit = () => evaluate('rawDoc.bones[0].x = (rawDoc.bones[0].x || 0) + 5; markDirty(); dirty');
const closeWarns = () =>
	evaluate(
		'(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()',
	);

try {
	await step('1. open S', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 3');
		await stubDialogs();
		ok('S is in the rig list', await openFromList('S'));
		const s = await state();
		ok('S is open', s.selected === 'S.json' && s.doc === 'rig-S' && s.stage, q(s));
		ok('…with ⤓ .irig, 💾, 📦 and 🕘 enabled', s.irig && s.save && s.library && s.history, q(s));
	});

	await step('2. edit S, pick S-broken — and Cancel', async () => {
		ok('an edit leaves S unsaved', (await edit()) === true);
		await answer(false);
		await openFromList('S-broken');
		const asked = await evaluate('window.__asked');
		ok(
			'opening another rig asks first, naming both',
			asked.length === 1 &&
				/unsaved/.test(asked[0]) &&
				asked[0].includes('“S”') &&
				asked[0].includes('S-broken'),
			q(asked),
		);
		const s = await state();
		ok(
			'…and Cancel keeps S open, edits and all',
			s.selected === 'S.json' && s.doc === 'rig-S' && s.stage && s.dirty === true,
			q(s),
		);
	});

	await step('3. pick S-broken again — and discard the edits', async () => {
		await answer(true);
		await openFromList('S-broken');
		const s = await state();
		ok(
			'the open fails, and says why',
			/Load failed/.test(s.err) && /Parent mesh not found/.test(s.err),
			s.err,
		);
		ok('S-broken is the selection', s.selected === 'S-broken.json', s.selected);
		ok(
			'…and NO rig is open: no document, no skeleton, nothing unsaved',
			s.doc === null && !s.data && !s.stage && s.dirty === false,
			q(s),
		);
		ok('⤓ .irig, 💾 and 📦 are disabled', !s.irig && !s.save && !s.library, q(s));
		ok('🕘 stays available — restoring an earlier save is the repair', s.history, q(s));
		ok(
			'the outline names S-broken as not open',
			s.insName === 'S-broken' && /not open/.test(s.insSub) && s.bones === 0,
			`${s.insName} · ${s.insSub} · ${s.bones} bones`,
		);
		ok('closing the tab does not warn — nothing is unsaved', !(await closeWarns()));
		ok('the next visit reopens S, the last rig that opened', (await remembered()) === 'S.json');
	});

	await step('4. save anyway: 💾, 📦 and ⤓ .irig, clicked and called', async () => {
		const [saves, library] = [posted.saves.length, posted.library.length];
		await evaluate(
			'["saveBtn", "saveRigLibBtn", "exportBtn"].forEach((id) => document.getElementById(id).click()); true',
		);
		await evaluate(
			'(async () => { await saveToR2(); await saveRigToLibrary(); exportIrig(); return true; })()',
		);
		await new Promise((r) => setTimeout(r, 300));
		ok('nothing is saved to R2', posted.saves.length === saves, q(posted.saves.slice(saves)));
		ok(
			'nothing is offered to the rig library',
			posted.library.length === library,
			q(posted.library.slice(library)),
		);
		const downloads = await evaluate('window.__downloads');
		ok('nothing is downloaded', downloads.length === 0, q(downloads));
	});

	await step('5. a cinematic tweak opens S-broken the same way', async () => {
		await openFromList('S');
		const res = await evaluate('openRigForTweak(skeletons.find((s) => s.name === "S-broken"))');
		const s = await state();
		ok('the tweak reports the rig did not open', /could not open/.test(res ?? ''), q(res));
		ok('…and there is no rig for it to key into', s.doc === null && !s.stage, q(s));
	});

	await step('6. S-broken is the rig a reload reopens', async () => {
		await evaluate(
			`localStorage.setItem(riggerStateKey(), ${q(
				JSON.stringify({ dir: b64('S-broken'), file: 'S-broken.json', mode: 'setup' }),
			)}); window.__before = true; setTimeout(() => location.reload(), 50); true`,
		);
		await waitFor(
			'!window.__before && typeof skeletons !== "undefined" && skeletons.length === 3 && !!selected && !document.getElementById("loadingOverlay").classList.contains("on")',
			40000,
		);
		await stubDialogs();
		const s = await state();
		ok('boot restore fails, and says why', /Parent mesh not found/.test(s.err), s.err);
		ok(
			'…leaving S-broken selected and nothing open',
			s.selected === 'S-broken.json' && s.doc === null && !s.stage,
			q(s),
		);
		ok(
			'⤓ .irig, 💾 and 📦 disabled; 🕘 available',
			!s.irig && !s.save && !s.library && s.history,
			q(s),
		);
		ok(
			'the remembered Setup mode is not applied to nothing',
			(await evaluate('mode')) === 'preview',
		);
	});

	await step('7. 🕘 restore an earlier save of S-broken', async () => {
		await evaluate('openRigHistory()');
		await waitFor('document.querySelectorAll("#rigHistList .item button").length === 1');
		await evaluate('document.querySelector("#rigHistList .item button").click(); true');
		await waitFor('!!rawDoc && rawDoc.skeleton.hash === "rig-B-restored"', 30000);
		await settle();
		const r = posted.restores.at(-1);
		ok(
			'the restore is of S-broken, conditional on the tag it was opened with',
			r && r.stem === 'S-broken' && r.id === 'b1' && r.baseEtag === 'etag-B-1',
			q(r),
		);
		const s = await state();
		ok(
			'…and S-broken opens as restored, ready to save',
			s.selected === 'S-broken.json' &&
				s.doc === 'rig-B-restored' &&
				s.stage &&
				s.save &&
				s.etag === 'etag-B-2',
			q(s),
		);
	});

	await step('8. a switch that works still asks, and saves under the right name', async () => {
		await edit();
		await answer(true);
		delay.skeleton = 1200;
		await clickRig('T');
		await wait(400);
		const loading = await state();
		delay.skeleton = 0;
		await settle();
		const asked = await evaluate('window.__asked');
		ok(
			'opening T over unsaved edits asks first',
			asked.length === 1 && asked[0].includes('“S-broken”'),
			q(asked),
		);
		// The switch drops the open document before anything is fetched, so there is no moment in
		// which one rig's document sits under another's name.
		ok(
			'while T loads, no document is open under its name',
			loading.selected === 'T.json' && loading.doc === null && !loading.save && !loading.stage,
			q(loading),
		);
		const s = await state();
		ok('T is open, clean', s.selected === 'T.json' && s.doc === 'rig-T' && s.dirty === false, q(s));
		await edit();
		const n = posted.saves.length;
		await evaluate('saveToR2()');
		const saved = posted.saves.slice(n);
		ok(
			"💾 saves T's skeleton as T",
			saved.length === 1 &&
				saved[0].stem === 'T' &&
				saved[0].doc === 'rig-T' &&
				saved[0].baseEtag === null,
			q(saved),
		);
	});

	await step('9. ＋ New rig over unsaved edits — and Cancel', async () => {
		await edit();
		await answer(false);
		await evaluate('document.getElementById("newRigName").value = "fresh"; createNewRig()');
		const asked = await evaluate('window.__asked');
		ok('creating a rig asks first', asked.length === 1 && asked[0].includes('“T”'), q(asked));
		ok('…and Cancel creates nothing', posted.creates === 0, posted.creates);
		const s = await state();
		ok(
			'…and keeps T open, edits and all',
			s.selected === 'T.json' && s.doc === 'rig-T' && s.dirty === true,
			q(s),
		);
	});

	await step('10. a save still in flight when another rig opens', async () => {
		await answer(true);
		await openFromList('S');
		await edit();
		delay.save = 1500;
		const n = posted.saves.length;
		await evaluate('window.__saving = saveToR2(); true');
		await wait(150);
		await openFromList('T');
		await evaluate('window.__saving');
		delay.save = 0;
		const saved = posted.saves.slice(n);
		ok(
			'the save in flight wrote S as S',
			saved.length === 1 && saved[0].stem === 'S' && saved[0].doc === 'rig-S',
			q(saved),
		);
		const s = await state();
		ok(
			"T is open, holding T's own ETag",
			s.selected === 'T.json' && s.doc === 'rig-T' && s.etag === etags.T,
			`${q(s)} — T's is ${etags.T}`,
		);
		ok(
			'💾 is ready for T',
			(await evaluate('document.getElementById("saveBtn").textContent')) === '💾 Save' && s.save,
		);
	});

	await step("11. a rig's text document still on its way when another rig opens", async () => {
		TEXT.S = { elements: [{ id: 'title', key: 'FREE_SPINS', slot: 'text_title', variants: [] }] };
		delay.text = 1500;
		await openFromList('S');
		await openFromList('T');
		await wait(1800); // S's text document answers once T is open
		delay.text = 0;
		delete TEXT.S;
		const text = await evaluate(
			'({ loaded: rigText.loaded, elements: rigText.elements.length, listed: document.getElementById("cText").textContent })',
		);
		ok(
			"T does not take S's text document",
			!text.loaded && text.elements === 0 && text.listed === '',
			q(text),
		);
	});

	await step('12. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	// Close Chrome from the inside: a killed one leaves child processes holding its profile open.
	if (chrome.exitCode === null && chrome.signalCode === null) {
		const exited = new Promise((r) => chrome.once('exit', r));
		ws.send(JSON.stringify({ id: ++msgId, method: 'Browser.close' }));
		await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
		chrome.kill();
	}
	ws.close();
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
	} catch {
		// a temp profile Chrome still holds is not worth failing the gate over
	}
}

console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
