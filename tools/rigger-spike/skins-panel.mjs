// End-to-end browser gate for the /rigger SKINS — the Skin picker in the bottom bar, and the edits
// that write "into the active skin".
//
//   node tools/rigger-spike/skins-panel.mjs
//
// This drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium on a REAL
// shipped rig (`apps/lines/static/assets/spines/anticipation`), against a fake launcher API, the
// way an author works: ＋ Add skin, pick it in the Skin picker, ＋ add image… on a slot, rename it
// with ✎, delete it with 🗑, import a rig, click its skin in the skins list and add an image there.
// `linkedmesh.mjs` runs the same edits on the functions pulled out of the page; this is the half it
// cannot see — that the page's own wiring re-renders a real <select> (where a value no option
// carries reads back ""), that nothing the page sets fires the picker's `change`, and that the
// MINIFIED runtime puts the chosen skin on stage.
//
// The picker's options used to be built only when the rig opened, and the edits read the picker: in
// a skin added, renamed or imported since, it read "", ＋ add image wrote into the first skin, and
// every rebuild put the default skin back on stage.
//
// What it does NOT cover: R2, auth, saving.
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

const DIR_B64 = Buffer.from('anticipation', 'utf8').toString('base64url');
const rigJson = readFileSync(join(RIG_DIR, 'anticipation.json'), 'utf8');
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

const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v) => send(200, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], readFileSync(join(STATIC, 'rigger/view.html')));
		if (p === '/spine/skeletons')
			return jsonOut({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: [
					{
						id: 0,
						name: 'anticipation',
						folder: 'anticipation',
						dir_b64: DIR_B64,
						skeleton_file: 'anticipation.json',
						atlas_file: 'anticipation.atlas',
						format: 'json',
						runtime: '4.2',
						version: '4.2',
						pma: false,
					},
				],
			});
		// The rig's `.atlas` names `anticipation.webp`, and the tool asks with `pp=1` (prefer PNG),
		// which the real server answers with the `.png` sibling — the bundle has both.
		if (p === '/spine/file') {
			const name = url.searchParams.get('name') ?? '';
			if (/^anticipation\.(json|atlas|png|webp)$/.test(name))
				return send(200, MIME[extname(name)], readFileSync(join(RIG_DIR, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		// The conditional .irig write reads the stored tag on open (`null` = no .irig yet).
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: null });
		// ⤵ Import rig: the rig library's copy of this same rig, saved as "gem".
		if (p === '/api/rigger/rigs/get')
			return jsonOut({ name: 'gem', skeleton: JSON.parse(rigJson) });
		if (p === '/api/rigger/text') return send(404, 'text/plain', 'no text document');
		if (p.startsWith('/api/'))
			return jsonOut({ effects: [], atlases: [], rigs: [], animations: [] });
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

const profile = mkdtempSync(join(tmpdir(), 'skins-cdp-'));
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

// ------------------------------------------------------------------ the author's actions ----

const q = JSON.stringify;
/** The picker's options and value, the skin the runtime has on stage, the skins-list highlight. */
const skinState = () =>
	evaluate(`(() => {
		const s = document.getElementById("skin");
		return {
			options: [...s.options].map((o) => o.value),
			value: s.value,
			stage: skeleton && skeleton.skin ? skeleton.skin.name : null,
			listed: [...document.querySelectorAll("#skinList .trow.sel")].map((r) => r.dataset.skin),
		};
	})()`);
/** The picker offers exactly `options`; it, the stage and the skins list all show `skin`. */
async function shows(what, options, skin) {
	const s = await skinState();
	ok(`${what}: the picker offers [${options}]`, q(s.options) === q(options), q(s.options));
	ok(
		`…and the picker, the stage and the skins list all show "${skin}"`,
		s.value === skin && s.stage === skin && s.listed.join() === skin,
		q(s),
	);
}
/** A pick in the Skin picker — only of a skin it offers, as a user can — firing `change`. */
const pick = (skin) =>
	evaluate(`(() => {
		const s = document.getElementById("skin");
		if (![...s.options].some((o) => o.value === ${q(skin)})) return false;
		s.value = ${q(skin)};
		s.dispatchEvent(new Event("change"));
		return true;
	})()`);
/** A click on a skin's row in the SKINS list — the other way to put a skin on stage. */
const clickSkin = (skin) =>
	evaluate(`(() => {
		const r = document.querySelector('#skinList .trow[data-skin=${q(skin)}]');
		if (r) r.click();
		return !!r;
	})()`);
/** ＋ add image… on the selected slot, the way the slot panel offers it. */
const addImage = (region) =>
	evaluate(`(() => {
		const s = [...document.querySelectorAll("#slotDetail select")]
			.find((x) => x.options[0] && x.options[0].textContent === "＋ add image…");
		if (!s) return false;
		s.value = ${q(region)};
		s.dispatchEvent(new Event("change"));
		return true;
	})()`);
/** Click a skin row's button (✎ rename skin · 🗑 delete skin). */
const skinButton = (skin, title) =>
	evaluate(`(() => {
		const b = document.querySelector('#skinList .trow[data-skin=${q(skin)}] button[title=${q(title)}]');
		if (b) b.click();
		return !!b;
	})()`);
/**
 * A slot's attachments in one skin (with each one's placement), what the runtime draws there and
 * where, the slot's attachment list, and every other skin, serialised.
 */
const slotState = (skin, slot) =>
	evaluate(`(() => {
		const sk = rawDoc.skins.find((s) => s.name === ${q(skin)});
		const bag = ((sk && sk.attachments) || {})[${q(slot)}] || {};
		const si = skeletonData.slots.findIndex((s) => s.name === ${q(slot)});
		const drawn = skeleton.slots[si].attachment;
		const place = (a) => [a.x ?? 0, a.y ?? 0, a.rotation ?? 0, a.scaleX ?? 1, a.scaleY ?? 1];
		return {
			names: Object.keys(bag),
			placed: Object.fromEntries(Object.entries(bag).map(([n, a]) => [n, place(a)])),
			drawn: drawn ? drawn.name : null,
			drawnAt: drawn ? place(drawn) : null,
			regionOf: drawn && drawn.region ? drawn.region.name : null,
			listed: slotAttachmentList(${q(slot)}).map((d) => d.skin + "›" + d.name),
			others: JSON.stringify(rawDoc.skins.filter((s) => s.name !== ${q(skin)})),
		};
	})()`);

const SLOT = 'frame_radial1';
const REGION = 'dust1';

try {
	console.log('\n1. open the rig in Setup');
	{
		await waitFor('typeof skeletons !== "undefined" && skeletons.length > 0');
		await evaluate('selectSkeleton(skeletons[0])');
		await waitFor('!!rawDoc && !!skeletonData');
		await evaluate('setMode("setup")');
		await shows('the rig opens', ['default'], 'default');
		// Every `change` the picker fires from here on; only the one pick below may fire one.
		await evaluate(
			'window.__skinChanges = 0; document.getElementById("skin").addEventListener("change", () => window.__skinChanges++)',
		);
	}

	console.log('\n2. ＋ Add skin, then pick it in the Skin picker');
	{
		const clicked = await evaluate(`(() => {
			const b = [...document.querySelectorAll("#skinList button")].find((x) => x.textContent === "＋ Add skin");
			if (b) b.click();
			return !!b;
		})()`);
		ok('the skins panel has ＋ Add skin', clicked);
		await shows('＋ Add skin', ['default', 'skin1'], 'default');
		ok('"skin1" can be picked in the picker', await pick('skin1'));
		await shows('pick "skin1"', ['default', 'skin1'], 'skin1');
	}

	console.log(`\n3. ＋ add image… on ${SLOT}, in the new skin`);
	{
		// skin1 is empty, so the slot shows default's image — the one a new image takes its place from
		const before = await slotState('skin1', SLOT);
		await evaluate(`selectSlot(${q(SLOT)})`);
		ok('the slot panel offers ＋ add image…', await addImage(REGION));
		const after = await slotState('skin1', SLOT);
		ok(`the image went into "skin1"`, q(after.names) === q([REGION]), q(after.names));
		ok('…and no other skin changed', after.others === before.others);
		ok(
			`…placed like the ${before.drawn} the slot showed`,
			q(after.placed[REGION]) === q(before.drawnAt),
			`${q(after.placed[REGION])} vs ${q(before.drawnAt)}`,
		);
		ok(
			'…and the minified runtime draws it from its own region',
			after.drawn === REGION && after.regionOf === REGION,
			`${after.drawn} · ${after.regionOf}`,
		);
		ok(`…and the slot lists it first`, after.listed[0] === `skin1›${REGION}`, q(after.listed));
		await shows('＋ add image…', ['default', 'skin1'], 'skin1');
	}

	console.log('\n4. rename the skin with ✎, then delete it with 🗑');
	{
		await evaluate('window.prompt = () => "jade"; window.confirm = () => true');
		ok('"skin1" has ✎', await skinButton('skin1', 'rename skin'));
		await shows('✎ "skin1" → "jade"', ['default', 'jade'], 'jade');
		const jade = await slotState('jade', SLOT);
		ok(
			'…and the image went with it',
			q(jade.names) === q([REGION]) && jade.drawn === REGION,
			q(jade),
		);
		ok('"jade" has 🗑', await skinButton('jade', 'delete skin'));
		await shows('🗑 "jade"', ['default'], 'default');
	}

	console.log('\n5. ⤵ import a rig, then work in its skin');
	{
		await evaluate('importRig("gem")');
		await shows('import "gem"', ['default', 'gem_default'], 'default');
		ok('"gem_default" has a row in the skins list', await clickSkin('gem_default'));
		await shows('click "gem_default"', ['default', 'gem_default'], 'gem_default');
		const slot = 'gem_' + SLOT;
		const before = await slotState('gem_default', slot);
		await evaluate(`selectSlot(${q(slot)})`);
		ok('the imported slot offers ＋ add image…', await addImage(REGION));
		const after = await slotState('gem_default', slot);
		ok(
			'the image went into "gem_default"',
			q(after.names) === q([...before.names, REGION]),
			q(after.names),
		);
		ok('…and no other skin changed', after.others === before.others);
		ok(
			`…placed like the ${before.drawn} the slot showed`,
			q(after.placed[REGION]) === q(before.drawnAt),
			`${q(after.placed[REGION])} vs ${q(before.drawnAt)}`,
		);
		await shows('＋ add image… in "gem_default"', ['default', 'gem_default'], 'gem_default');
	}

	console.log('\n6. nothing the page set fired the picker');
	{
		const n = await evaluate('window.__skinChanges');
		ok('the picker fired `change` for the one pick and nothing else', n === 1, n);
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	}
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
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
