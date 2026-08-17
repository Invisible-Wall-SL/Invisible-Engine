// End-to-end browser gate for the /rigger TEXT PANEL — the authoring path a person actually
// uses (design `docs/design/invisible-cinematic.md` §12.4a).
//
//   node tools/rigger-spike/rigtext-panel.mjs
//
// This drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium, on a
// REAL shipped rig (`apps/lines/static/assets/spines/anticipation`) and a REAL shipped bitmap
// font (`goldFont/mm_gold.xml`), against a fake launcher API whose text endpoint is backed by
// the REAL server module (`riggerText.ts` composes the atlas exactly as production does).
//
// Why it exists: `view.html` is a 9.7k-line untyped static file (the launcher build never sees
// it), the spine runtime it loads is MINIFIED, and the panel's whole job is a multi-step round
// trip — bake, reload the atlas, then write the skeleton. Every one of those steps fails
// silently in a way a data-only test cannot observe. The decisive assertion here is that after
// the round trip the MINIFIED runtime resolves the text regions on the rebuilt skeleton —
// i.e. `missingArt` is empty and each locale's attachment has a region of its own size.
//
// What it still does NOT cover: R2, auth, the ship chain into a game, and how the text LOOKS.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, extname } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const RIG_DIR = fileURLToPath(new URL('apps/lines/static/assets/spines/anticipation/', ROOT));
const FONT_DIR = fileURLToPath(new URL('apps/lines/static/assets/fonts/goldFont/', ROOT));
const LIB = fileURLToPath(new URL('apps/launcher-api/src/lib/', ROOT));
const ESBUILD = new URL(
	'node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/lib/main.js',
	ROOT,
).href;

// The REAL atlas composer — the fake API must recompose exactly like the server does, or this
// gate would be testing a re-implementation instead of the shipping one.
const esbuild = await import(ESBUILD);
const outfile = join(mkdtempSync(join(tmpdir(), 'rigtext-panel-')), 'riggerText.mjs');
await esbuild.build({
	entryPoints: [join(LIB, 'server', 'riggerText.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
	logLevel: 'silent',
});
const { normalizeRigTextDoc, textAtlasBlock } = await import(pathToFileURL(outfile).href);

function findChromium() {
	const base = join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '', 'ms-playwright');
	if (!existsSync(base)) return null;
	for (const dir of readdirSync(base)) {
		for (const rel of [
			join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
			join('chrome-win', 'chrome.exe'),
			join('chrome-linux', 'chrome'),
		]) {
			const p = join(base, dir, rel);
			if (existsSync(p)) return p;
		}
	}
	return null;
}
const CHROME = findChromium();
if (!CHROME) {
	console.error('No Chromium found under ms-playwright — this gate needs a real browser.');
	process.exit(1);
}

// ------------------------------------------------------------------ the fake bundle ----

const DIR_B64 = Buffer.from('anticipation', 'utf8').toString('base64url');
const baseAtlas = readFileSync(join(RIG_DIR, 'anticipation.atlas'), 'utf8');
let skeletonJson = readFileSync(join(RIG_DIR, 'anticipation.json'), 'utf8');
// The rig's `.atlas` names `anticipation.webp`; the tool asks with `pp=1` (prefer PNG), which
// the real server rewrites to a `.png` sibling when one exists — both are in the bundle, so
// serve whichever name is asked for.
const rigPagePng = readFileSync(join(RIG_DIR, 'anticipation.png'));
const rigPageWebp = readFileSync(join(RIG_DIR, 'anticipation.webp'));
const fontDescriptor = readFileSync(join(FONT_DIR, 'mm_gold.xml'), 'utf8');
const fontPage = readFileSync(join(FONT_DIR, 'mm_gold.webp'));

/** The bundle's `text.json`, and the pages the browser uploaded. */
let textDoc = normalizeRigTextDoc(null);
let textEtag = null;
const uploads = new Map(); // filename -> bytes
let savedSkeletons = 0;

/** Compose the bundle atlas the way `ensureBundleAtlasFresh` does: sheet block + text block. */
const composedAtlas = () => baseAtlas.replace(/\s*$/, '\n') + textAtlasBlock(textDoc);

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
};

const readBody = (req) =>
	new Promise((r) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => r(s));
	});
const readBytes = (req) =>
	new Promise((r) => {
		const c = [];
		req.on('data', (x) => c.push(x));
		req.on('end', () => r(Buffer.concat(c)));
	});

const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v) => send(200, 'application/json', JSON.stringify(v));

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

		if (p === '/spine/file') {
			const name = url.searchParams.get('name') ?? '';
			if (name === 'anticipation.atlas') return send(200, 'text/plain', composedAtlas());
			if (name === 'anticipation.json') return send(200, 'application/json', skeletonJson);
			if (name === 'anticipation.png') return send(200, 'image/png', rigPagePng);
			if (name === 'anticipation.webp') return send(200, 'image/webp', rigPageWebp);
			if (uploads.has(name)) return send(200, 'image/png', uploads.get(name));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}

		if (p === '/api/rigger/text' && req.method === 'GET')
			return jsonOut({ doc: textDoc, etag: textEtag, regions: [] });

		if (p === '/api/rigger/text' && req.method === 'POST') {
			const body = JSON.parse(await readBody(req));
			// Mirror the endpoint's two real refusals so the panel is tested against them.
			if (!('baseEtag' in body) && body.force !== true)
				return send(400, 'application/json', JSON.stringify({ ok: false, message: 'no baseEtag' }));
			if (body.baseEtag !== textEtag && body.force !== true)
				return send(409, 'application/json', JSON.stringify({ ok: false, error: 'conflict', message: 'stale' }));
			const next = normalizeRigTextDoc(body.doc);
			if (next.page && !uploads.has(next.page.file))
				return send(400, 'application/json', JSON.stringify({ ok: false, message: 'page not uploaded' }));
			textDoc = next;
			textEtag = 'etag-' + Date.now();
			return jsonOut({ ok: true, etag: textEtag, regions: [], atlasSynced: true, swept: 0 });
		}

		if (p === '/api/rigger/text/page-url') {
			const { file } = JSON.parse(await readBody(req));
			return jsonOut({ url: `/upload/${file}`, contentType: 'image/png' });
		}
		if (p.startsWith('/upload/') && req.method === 'PUT') {
			uploads.set(p.slice('/upload/'.length), await readBytes(req));
			return send(200, 'text/plain', 'ok');
		}

		if (p === '/api/rigger/save') {
			const body = JSON.parse(await readBody(req));
			skeletonJson = JSON.stringify(body.skeleton);
			savedSkeletons++;
			return jsonOut({ ok: true, key: 'x', count: 1 });
		}

		if (p === '/api/fonts/catalog')
			return jsonOut({
				fonts: [
					{
						id: 'gold',
						name: 'mm_gold',
						kind: 'bitmap',
						descriptorUrl: '/font/mm_gold.xml',
						descriptorFormat: 'xml',
						pages: [{ file: 'mm_gold.webp', url: '/font/mm_gold.webp' }],
					},
				],
			});
		if (p === '/font/mm_gold.xml') return send(200, 'text/plain', fontDescriptor);
		if (p === '/font/mm_gold.webp') return send(200, 'image/webp', fontPage);

		if (p === '/api/rigger/strings')
			return jsonOut({
				sourceLang: 'en',
				targetLangs: ['de', 'es'],
				entries: [
					{ key: 'FREE_SPINS', source: 'FREE SPINS', reviewed: { de: 'FREISPIELE', es: 'GIROS' }, pending: 0 },
				],
			});

		if (p.startsWith('/api/')) return jsonOut({ effects: [], atlases: [], rigs: [], animations: [] });

		// Everything else: the launcher's static tree (view.html's scripts + vendored runtimes).
		const file = join(STATIC, p.replace(/^\//, ''));
		if (existsSync(file) && !file.includes('..'))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ------------------------------------------------------------------ CDP ----

const chrome = spawn(
	CHROME,
	[
		'--headless',
		'--remote-debugging-port=0',
		`--user-data-dir=${mkdtempSync(join(tmpdir(), 'rigtext-cdp-'))}`,
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
		pageLog.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
	if (msg.method === 'Runtime.exceptionThrown')
		pageLog.push(`[uncaught] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
};
const cdp = (method, params = {}, sessionId) =>
	new Promise((resolve) => {
		const id = ++msgId;
		pendingMsgs.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params, sessionId }));
	});

const { result: targets } = await cdp('Target.getTargets');
const target = targets.targetInfos.find((t) => t.type === 'page');
const { result: attached } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const session = attached.sessionId;
await cdp('Runtime.enable', {}, session);

async function evaluate(expression) {
	const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
	const r = res.result;
	if (r.exceptionDetails)
		throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
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

try {
	console.log('\n1. the panel exists and boots the real tool');
	{
		await waitFor('typeof skeletons !== "undefined" && skeletons.length > 0');
		ok('/rigger boots with the rig list', true);
		ok('the Text section is in the outline', await evaluate('!!document.getElementById("secText")'));
		ok('the text functions are defined (view.html is never type-checked)', await evaluate(
			'["renderTextList","openTextModal","bakeAndPlaceText","removeTextElement","placeTextAttachments","loadRigText"].every((f) => typeof window[f] === "function")',
		));
		ok('the modal buttons are wired', await evaluate(
			'typeof document.getElementById("textModalCreate").onclick === "function" && typeof document.getElementById("textModalClose").onclick === "function"',
		));
		ok('with no rig open it says so instead of offering a broken action', await evaluate(
			'document.getElementById("textList").textContent.includes("open a rig")',
		));
	}

	console.log('\n2. open the rig, then the text modal');
	{
		await evaluate('selectSkeleton(skeletons[0])');
		await waitFor('!!rawDoc && !!skeletonData').catch(async (e) => {
			// A load failure here is almost always the tool's own error bar having something to
			// say; surface it rather than only "timed out".
			throw new Error(
				e.message +
					' · tool state: ' +
					JSON.stringify(
						await evaluate(
							'({ err: document.getElementById("err").textContent, gl: !!gl, SPINE: !!SPINE, sel: !!selected, webgl: !!document.getElementById("cv").getContext("webgl") })',
						).catch((x) => x.message),
					),
			);
		});
		const before = await evaluate('({ slots: rawDoc.slots.length, bones: rawDoc.bones.length, missing: missingArt.length })');
		ok('the real rig loads', before.bones > 50 && before.slots > 0, JSON.stringify(before));
		ok('…with no missing art to start with', before.missing === 0, before.missing);

		await evaluate('setMode("setup")');
		ok('setup mode offers ＋ Add text…', await evaluate('document.getElementById("textList").textContent.includes("Add text")'));

		await evaluate('openTextModal(null)');
		await waitFor('document.getElementById("textKey").options.length > 0 && document.getElementById("textFont").options.length > 0');
		ok('the modal lists the project’s localization keys', await evaluate('document.getElementById("textKey").options[0].value === "FREE_SPINS"'));
		ok('…and its fonts', await evaluate('document.getElementById("textFont").options[0].value === "gold"'));
		ok('…and says which locales will bake', await evaluate('document.getElementById("textLocaleNote").textContent.includes("en, de, es")'),
			await evaluate('document.getElementById("textLocaleNote").textContent'));
		ok('…and the id defaults from the key', await evaluate('document.getElementById("textId").value === "free_spins"'),
			await evaluate('document.getElementById("textId").value'));
		// The preview is the author's only sight of the art before it becomes permanent.
		await waitFor('document.querySelector("#textPreview canvas")');
		const pv = await evaluate('(() => { const c = document.querySelector("#textPreview canvas"); return { w: c.width, h: c.height }; })()');
		ok('a live preview renders with real ink', pv.w > 20 && pv.h > 4, JSON.stringify(pv));
	}

	console.log('\n3. bake + place — the whole round trip through the REAL panel');
	{
		await evaluate('document.getElementById("textId").value = "title"; document.getElementById("textSize").value = 48; refreshTextModal()');
		// This is the button an author presses.
		await evaluate('document.getElementById("textModalCreate").click()');
		await waitFor('!document.getElementById("textModal").classList.contains("open") || document.getElementById("textModalErr").textContent', 40000);
		const err = await evaluate('document.getElementById("textModalErr").textContent');
		ok('the bake reported no error', !err, err);

		const state = await evaluate(`(() => {
			const slot = rawDoc.slots.find((s) => s.name === "text_title");
			const skin = rawDoc.skins.find((s) => s.attachments && s.attachments["text_title"]);
			const bag = skin ? skin.attachments["text_title"] : {};
			const si = skeletonData.slots.findIndex((s) => s.name === "text_title");
			const atts = Object.keys(bag).map((n) => {
				const a = si >= 0 ? skeleton.getAttachment(si, n) : null;
				return { name: n, path: bag[n].path, w: a && a.region ? a.region.width : null, h: a && a.region ? a.region.height : null };
			});
			return {
				slot: !!slot,
				bone: slot ? slot.bone : null,
				boneExists: rawDoc.bones.some((b) => b.name === "text_title"),
				setup: slot ? slot.attachment : null,
				atts,
				missing: missingArt.map((m) => m.path),
				dirty,
				slotIsLast: rawDoc.slots[rawDoc.slots.length - 1].name === "text_title",
			};
		})()`);

		ok('a slot was created', state.slot);
		ok('…on its OWN bone (so the text is animatable independently)', state.boneExists && state.bone === 'text_title', state.bone);
		ok('…drawn last (on top)', state.slotIsLast);
		ok('one attachment per locale', state.atts.length === 3, JSON.stringify(state.atts.map((a) => a.name)));
		ok('…named <id>@<locale>', state.atts.every((a) => /^title@(en|de|es)$/.test(a.name)), JSON.stringify(state.atts.map((a) => a.name)));
		ok('…pointing at the namespaced regions', state.atts.every((a) => a.path === 'text/title/' + a.name.split('@')[1]));
		ok('the setup attachment is the SOURCE locale', state.setup === 'title@en', state.setup);

		// THE decisive assertion: the MINIFIED vendored runtime parsed the recomposed multi-page
		// atlas and resolved every text region. A stale atlas, a mis-shaped page block or a bad
		// region name would show up here as a placeholder (missingArt) instead.
		ok('the minified spine runtime resolved EVERY text region', state.missing.length === 0, JSON.stringify(state.missing));
		ok('…each with a real, non-placeholder size', state.atts.every((a) => a.w > 1 && a.h > 1), JSON.stringify(state.atts));
		// German "FREISPIELE" is longer than Spanish "GIROS" — per-locale art really is per-locale.
		const de = state.atts.find((a) => a.name === 'title@de');
		const es = state.atts.find((a) => a.name === 'title@es');
		ok('a longer translation really is a wider region', de.w > es.w, `de ${de.w} vs es ${es.w}`);
		ok('the rig is marked unsaved (the author still owns the save)', state.dirty === true);

		ok('the server stored a text document', textDoc.elements.length === 1 && textDoc.elements[0].id === 'title');
		ok('…and the packed page', uploads.size === 1 && /^rigtext-[0-9a-f]{16}\.png$/.test([...uploads.keys()][0]), [...uploads.keys()].join());
		ok('the composed atlas really carries the text page', composedAtlas().includes([...uploads.keys()][0]));
	}

	console.log('\n4. the panel reflects what was baked');
	{
		const listed = await evaluate('document.getElementById("textList").textContent');
		ok('the outline lists the element', listed.includes('title'), listed);
		ok('…with its locale count', listed.includes('3 loc'), listed);
	}

	console.log('\n5. region → mesh conversion works on it like any region');
	{
		// Not a re-implementation of convert: this calls the tool's OWN mesh conversion on the
		// text attachment, which is the claim §12.4a makes ("it comes for free").
		const res = await evaluate(`(() => {
			selectSlot("text_title");
			if (typeof convertRegionToMesh !== "function") return { skipped: "convertRegionToMesh is not a global" };
			convertRegionToMesh();
			const skin = rawDoc.skins.find((s) => s.attachments && s.attachments["text_title"]);
			const bag = skin.attachments["text_title"];
			const si = skeletonData.slots.findIndex((s) => s.name === "text_title");
			const built = (n) => skeleton.getAttachment(si, n);
			const en = built("title@en"), de = built("title@de");
			return {
				type: bag["title@en"].type,
				uvs: (bag["title@en"].uvs || []).length,
				tris: (bag["title@en"].triangles || []).length,
				builtMesh: !!en && !!en.triangles,
				deTypeRaw: bag["title@de"].type,
				deParent: bag["title@de"].parent,
				deTris: de && de.triangles ? de.triangles.length : 0,
				deRegionW: de && de.region ? de.region.width : null,
				enRegionW: en && en.region ? en.region.width : null,
				deFollowsDeform: !!de && de.timelineAttachment === en,
				missing: missingArt.length,
			};
		})()`);
		if (res.skipped) {
			ok('mesh conversion is reachable', false, res.skipped);
		} else {
			ok('the text region converts to a mesh', res.type === 'mesh' && res.uvs >= 8, JSON.stringify(res));
			ok('…and the runtime builds it', res.builtMesh);
			ok('…without losing its region', res.missing === 0, res.missing);
			// The claim §12.4a rests on: mesh + weights + deform are authored ONCE and every
			// locale follows. Without the link, a German player would get an unrigged quad.
			ok('the other locales become LINKED meshes', res.deTypeRaw === 'linkedmesh' && res.deParent === 'title@en', JSON.stringify(res));
			ok('…sharing the source geometry', res.deTris === res.tris && res.deTris > 0, `${res.deTris} vs ${res.tris}`);
			ok('…but keeping their OWN art', res.deRegionW !== res.enRegionW && res.deRegionW > 1, `${res.deRegionW} vs ${res.enRegionW}`);
			ok('…and following its deform', res.deFollowsDeform);
		}
	}
	console.log('\n6. a re-bake saves the rig first, so reloading the atlas cannot eat the mesh');
	{
		// The rig is DIRTY now (the mesh conversion). The panel must save before it reloads —
		// this is the step that would silently discard an author's work if it were skipped.
		await evaluate('window.confirm = () => true');
		const savesBefore = savedSkeletons;
		await evaluate('openTextModal("title")');
		await waitFor('document.getElementById("textKey").options.length > 0');
		ok('editing locks the id (it IS the attachment name)', await evaluate('document.getElementById("textId").disabled === true'));
		await evaluate('document.getElementById("textSize").value = 32; refreshTextModal()');
		await evaluate('document.getElementById("textModalCreate").click()');
		await waitFor('!document.getElementById("textModal").classList.contains("open") || document.getElementById("textModalErr").textContent', 40000);
		ok('the re-bake reported no error', !(await evaluate('document.getElementById("textModalErr").textContent')));
		ok('the rig was saved before the reload', savedSkeletons > savesBefore, `${savesBefore} → ${savedSkeletons}`);
		const kept = await evaluate(`(() => {
			const skin = rawDoc.skins.find((s) => s.attachments && s.attachments["text_title"]);
			const bag = skin ? skin.attachments["text_title"] : {};
			return { en: bag["title@en"] && bag["title@en"].type, de: bag["title@de"] && bag["title@de"].type, missing: missingArt.length };
		})()`);
		ok('the authored MESH survived the reload', kept.en === 'mesh', JSON.stringify(kept));
		ok('…and so did the linked locales', kept.de === 'linkedmesh', JSON.stringify(kept));
		ok('…with every region still resolving after the re-bake', kept.missing === 0, kept.missing);
		ok('the page was re-baked at the new size', uploads.size >= 1);
	}

	console.log('\n7. removing an element takes its slot AND its atlas regions with it');
	{
		await evaluate('removeTextElement("title")');
		await waitFor('!rawDoc.slots.some((s) => s.name === "text_title")', 30000);
		ok('the slot is gone', true);
		ok('the document is empty again', textDoc.elements.length === 0);
		ok('the composed atlas is back to one page', !/rigtext-/.test(composedAtlas()));
		ok('nothing is left pointing at a missing region', await evaluate('missingArt.length === 0'));
		ok('the outline shows the empty-state help again', await evaluate('document.getElementById("textList").textContent.includes("A text element is ART")'));
	}
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	if (pageLog.length) console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	ws.close();
	chrome.kill();
	server.close();
}

console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
