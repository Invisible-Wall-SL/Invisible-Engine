// Browser gate for 📐 Save as template (rig templates T8, docs/design/rig-templates.md §7), on the
// SHIPPED view.html in a real Chromium against a fake launcher API, with a real `bust-face` rig built
// by the server's `templateRig`. The fake save runs the REAL derivation, spec parse and contract check
// (`rigTemplateFromRig`, `parseTemplateSpec`, `rigTemplateProblem`) and answers the store's 409 / etag
// contract; the real routes and R2 are `check:rigger-writes`. Checked:
//  - the modal opens pre-filled from the rig's template (name, needed parts, controls, motion);
//  - a control's preview slider poses the stage (bone from setup, mouth image + jaw) and keys
//    nothing; closing the modal puts the pose back;
//  - Save posts the rig and the author's choices (a part made optional, a starter clip picked);
//  - a taken name asks, names the next version, and retries conditional on the etag it was shown;
//  - a refused template (min above max) is said in the modal, which stays open, and nothing is stored;
//  - the shared list shows the saved template and 🗑 deletes it conditional on its etag.
//   node tools/rigger-spike/template-save-browser.mjs
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'template-save-')), 'server.mjs');
await esbuild.build({
	stdin: {
		contents: [
			"export * from './rigTemplates.ts';",
			"export { rigTemplateFromRig } from './rigTemplateFromRig.ts';",
			"export { parseTemplateSpec } from './rigTemplateSchema.ts';",
		].join('\n'),
		resolveDir: join(APP, 'src/lib/server'),
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const {
	BUST_FACE,
	templateRig,
	rigTemplateFromSidecar,
	rigTemplateFromRig,
	parseTemplateSpec,
	rigTemplateProblem,
} = await import(pathToFileURL(out).href);

const PAGE_W = 1024;
let x = 0,
	y = 0,
	rowH = 0;
const atlasLines = [];
const regions = BUST_FACE.parts.map((p) => {
	const [w, h] = p.size;
	if (x + w > PAGE_W) {
		x = 0;
		y += rowH;
		rowH = 0;
	}
	atlasLines.push(p.name, `bounds:${x},${y},${w},${h}`);
	x += w;
	rowH = Math.max(rowH, h);
	return { name: p.name, w, h };
});
const PAGE_H = y + rowH;
const ATLAS = ['face.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear', ...atlasLines].join(
	'\n',
);
function png(w, h) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const raw = Buffer.alloc((w * 4 + 1) * h, 0x80);
	for (let r = 0; r < h; r++) raw[r * (w * 4 + 1)] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}
const PNG = png(PAGE_W, PAGE_H);
const RIG = templateRig(BUST_FACE, regions).skeleton;
RIG.animations = {
	wave: {
		bones: { head: { rotate: [{ value: 0 }, { time: 0.5, value: 6 }, { time: 1, value: 0 }] } },
	},
};
const TEMPLATE = rigTemplateFromSidecar('{"id":"bust-face","version":1}');
const DIR = Buffer.from('face', 'utf8').toString('base64url');

/** The fake store: id → { version, etag, label, template }. */
const store = new Map();
const seen = { saves: [], deletes: [] };
const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';
function fakeSave(body) {
	seen.saves.push(body);
	const spec = parseTemplateSpec(body.spec);
	if (typeof spec === 'string') return [422, { message: `Not saved — ${spec}.` }];
	const id = slug(body.name);
	const derived = rigTemplateFromRig(body.rig, spec, id, 0);
	if (typeof derived === 'string') return [422, { message: `Not saved — ${derived}.` }];
	const problem = rigTemplateProblem(derived.template);
	if (problem) return [422, { message: `Not saved — ${problem}.` }];
	const cur = store.get(id);
	if (body.baseEtag === null && cur)
		return [
			409,
			{
				ok: false,
				error: 'exists',
				id,
				etag: cur.etag,
				version: cur.version,
				message: `There is already a template "${cur.label}" saved by Ana from project "p" (version ${cur.version}).`,
			},
		];
	if (body.baseEtag !== null && cur?.etag !== body.baseEtag)
		return [409, { ok: false, error: 'conflict', id, etag: cur?.etag ?? null, message: 'changed' }];
	const version = (cur?.version ?? 0) + 1;
	store.set(id, {
		version,
		etag: `"e${id}${version}"`,
		label: spec.label,
		template: derived.template,
	});
	return [200, { ok: true, id, version, etag: `"e${id}${version}"`, notes: derived.notes }];
}

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
};
const readBody = (req) =>
	new Promise((r) => {
		const parts = [];
		req.on('data', (c) => parts.push(c));
		req.on('end', () => r(Buffer.concat(parts)));
	});
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
		if (p === '/rig-viewer/skeletons')
			return json({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: [
					{
						id: 0,
						name: 'face',
						folder: 'face',
						dir_b64: DIR,
						skeleton_file: 'face.irig',
						atlas_file: 'face.atlas',
						format: 'json',
						runtime: '4.2',
						version: '4.2',
						pma: false,
					},
				],
			});
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name');
			if (name === 'face.irig') return json(RIG);
			if (name === 'face.atlas') return send(200, 'text/plain', ATLAS);
			if (name === 'face.png') return send(200, 'image/png', PNG);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template') return json({ template: TEMPLATE });
		if (p === '/api/rigger/templates')
			return json({
				templates: [
					TEMPLATE,
					...[...store.entries()].map(([id, s]) => ({
						id,
						version: s.version,
						label: s.label,
						origin: 'user',
						parts: [],
						channels: [],
						clips: [],
						bones: [],
						motion: null,
						saved: {
							savedAt: '2026-11-18T10:00:00Z',
							savedBy: { uid: 'u', name: 'Ana' },
							project: 'p',
							etag: s.etag,
						},
					})),
				],
			});
		if (p === '/api/rigger/templates/save') {
			const [code, body] = fakeSave(JSON.parse((await readBody(req)).toString()));
			return json(body, code);
		}
		if (p === '/api/rigger/templates/delete') {
			const body = JSON.parse((await readBody(req)).toString());
			seen.deletes.push(body);
			if (store.get(body.id)?.etag !== body.etag) return json({ message: 'changed' }, 409);
			store.delete(body.id);
			return json({ ok: true });
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/'))
			return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
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
	name: 'template-save',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
});
const { evaluate, waitFor, pageLog } = browser;

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
const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (id) => `document.querySelector('#tplControls .tplCard[data-ch="${id}"]')`;
const openModal = async () => {
	await evaluate('document.getElementById("saveTplBtn").click(); true');
	await waitFor(
		'document.getElementById("tplModal").classList.contains("open") && !!tplDraft',
		5000,
	);
};
const clickSave = async (until) => {
	await evaluate('document.getElementById("tplSave").click(); true');
	await waitFor(until, 10000);
};

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("loadRigBtn")', 30000);
	await evaluate(`(() => {
		window.__alerts = []; window.__confirms = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = (m) => { window.__confirms.push(String(m)); return true; };
		document.getElementById("loadRigBtn").click();
		return true;
	})()`);
	await waitFor(
		'[...document.querySelectorAll("#list .item .nm")].some((n) => n.textContent === "face")',
		30000,
	);
	await evaluate(`(() => {
		[...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "face").click();
		return true;
	})()`);
	await waitFor('!!skeleton && !!rigTemplate', 30000);
	ok(
		'📐 is enabled once a rig is open',
		await evaluate('!document.getElementById("saveTplBtn").disabled'),
	);

	await openModal();
	const pre = await evaluate(`({
		name: document.getElementById("tplName").value,
		needed: [...document.querySelectorAll("#tplParts input[type=checkbox]")].filter((c) => c.checked).map((c) => c.dataset.part).sort(),
		cards: document.querySelectorAll("#tplControls .tplCard").length,
		clips: [...document.querySelectorAll("#tplClips input[type=checkbox]")].map((c) => c.dataset.clip + ":" + c.checked),
		motion: !!document.getElementById("tplKeepMotion") && document.getElementById("tplKeepMotion").checked,
	})`);
	const required = BUST_FACE.parts
		.filter((p) => p.required)
		.map((p) => p.name)
		.sort();
	ok(
		'the name starts from the template and the rig',
		pre.name === 'Bust with face – face',
		pre.name,
	);
	ok('the needed parts start as the template’s', q(pre.needed) === q(required), q(pre.needed));
	ok(
		'every control of the template is a card',
		pre.cards === BUST_FACE.channels.length,
		String(pre.cards),
	);
	ok(
		'the rig’s own animation is offered, unticked',
		q(pre.clips) === q(['wave:false']),
		q(pre.clips),
	);
	ok('the motion map is kept by default', pre.motion === true);

	// Preview: the jaw slider and the mouth picker pose the stage; nothing is keyed.
	const docBefore = await evaluate('JSON.stringify(rawDoc)');
	await evaluate(`(() => {
		const inp = ${card('jaw')}.querySelector(".tplHead input[type=range]");
		inp.value = "1"; inp.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await wait(150);
	const jaw = await evaluate(
		'(() => { const b = skeleton.findBone("jaw"); return [b.y, b.data.y]; })()',
	);
	ok(
		'the jaw preview drops the jaw by its per unit (−14)',
		Math.abs(jaw[0] - (jaw[1] - 14)) < 1e-6,
		q(jaw),
	);
	await evaluate(`(() => {
		const s = ${card('mouth')}.querySelector(".tplHead select");
		s.value = "mouth_O"; s.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`);
	await wait(150);
	const mouth = await evaluate(
		'(() => { const s = skeleton.findSlot("mouth"), b = skeleton.findBone("jaw"); return [s.getAttachment() && s.getAttachment().name, b.y - b.data.y]; })()',
	);
	ok(
		'the mouth preview shows the shape and opens the jaw by its amount',
		mouth[0] === 'mouth_O' && Math.abs(mouth[1] + 14 * 0.9) < 1e-6,
		q(mouth),
	);
	ok('previewing keyed nothing', (await evaluate('JSON.stringify(rawDoc)')) === docBefore);

	// Make a part optional, pick the clip, name it, save.
	await evaluate(`(() => {
		const cb = document.querySelector('#tplParts input[data-part="mouth_O"]');
		cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true }));
		const clip = document.querySelector('#tplClips input[data-clip="wave"]');
		clip.checked = true; clip.dispatchEvent(new Event("change", { bubbles: true }));
		const n = document.getElementById("tplName");
		n.value = "Hero bust"; n.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await clickSave('!document.getElementById("tplModal").classList.contains("open")');
	const first = seen.saves[0];
	ok(
		'Save posts the rig and the choices: the part made optional, the clip, every control, the motion map',
		first.name === 'Hero bust' &&
			first.baseEtag === null &&
			!first.spec.required.includes('mouth_O') &&
			first.spec.required.length === required.length - 1 &&
			q(first.spec.clips) === q(['wave']) &&
			first.spec.channels.length === BUST_FACE.channels.length &&
			first.spec.motion?.face?.entries.length === BUST_FACE.motion.face.entries.length &&
			q(first.rig.bones) === q(RIG.bones),
		q({
			name: first.name,
			req: first.spec.required.length,
			clips: first.spec.clips,
			m: !!first.spec.motion,
		}),
	);
	ok('it is version 1', store.get('hero_bust')?.version === 1);
	ok(
		'the author is told it saved, and its version',
		await evaluate(
			'document.getElementById("alertModal").classList.contains("open") && /version 1/.test(document.getElementById("alertMsg").textContent)',
		),
	);
	await wait(100);
	const jawBack = await evaluate(
		'(() => { const b = skeleton.findBone("jaw"), s = skeleton.findSlot("mouth"); return [b.y === b.data.y, s.getAttachment() && s.getAttachment().name]; })()',
	);
	ok(
		'closing put the stage back to its pose',
		jawBack[0] === true && jawBack[1] === 'mouth_rest',
		q(jawBack),
	);
	await evaluate('closeAlert(); true');

	// A taken name: asked, named the next version, retried on the etag it was shown.
	await openModal();
	await evaluate(
		'(() => { const n = document.getElementById("tplName"); n.value = "Hero bust"; n.dispatchEvent(new Event("input", { bubbles: true })); return true; })()',
	);
	await clickSave('!document.getElementById("tplModal").classList.contains("open")');
	const [, taken, retry] = seen.saves;
	ok(
		'a taken name asks first, naming who saved it and the next version',
		(await evaluate('window.__confirms.length')) === 1 &&
			(await evaluate(
				'/saved by Ana/.test(window.__confirms[0]) && /version 2/.test(window.__confirms[0])',
			)),
		await evaluate('window.__confirms.join(" | ")'),
	);
	ok(
		'the retry is conditional on the etag the author was shown',
		taken.baseEtag === null &&
			retry.baseEtag === '"ehero_bust1"' &&
			store.get('hero_bust')?.version === 2,
		q([taken.baseEtag, retry?.baseEtag, store.get('hero_bust')?.version]),
	);
	await evaluate('closeAlert(); true');

	// A refusal: min above max on the jaw. The reason shows in the modal, nothing is stored.
	await openModal();
	await evaluate(`(() => {
		${card('jaw')}.querySelector(".tplHead button").click();
		return true;
	})()`);
	await evaluate(`(() => {
		const min = [...${card('jaw')}.querySelectorAll(".tplBody label.tplF")].find((l) => l.textContent.startsWith("min")).querySelector("input");
		min.value = "5"; min.dispatchEvent(new Event("change", { bubbles: true }));
		const n = document.getElementById("tplName"); n.value = "Broken"; n.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await clickSave('/min < max/.test(document.getElementById("tplNote").textContent)');
	ok(
		'a refused template says why and stays open; nothing is stored',
		(await evaluate('document.getElementById("tplModal").classList.contains("open")')) &&
			!store.has('broken'),
		await evaluate('document.getElementById("tplNote").textContent'),
	);

	// The shared list, and a delete conditional on the etag shown.
	await evaluate('document.getElementById("tplSecShared").open = true; true');
	await waitFor('!!document.querySelector(\'#tplShared [data-tpl="hero_bust"]\')', 5000);
	ok(
		'the shared list shows the saved template at its version',
		(
			await evaluate('document.querySelector(\'#tplShared [data-tpl="hero_bust"]\').textContent')
		).includes('Hero bust · v2'),
	);
	await evaluate(
		`document.querySelector('#tplShared [data-tpl="hero_bust"] button').click(); true`,
	);
	await waitFor('/None yet/.test(document.getElementById("tplShared").textContent)', 5000);
	ok(
		'🗑 asks, then deletes conditional on the etag it listed',
		q(seen.deletes) === q([{ id: 'hero_bust', etag: '"ehero_bust2"' }]) &&
			!store.has('hero_bust') &&
			(await evaluate('/for every project/.test(window.__confirms[window.__confirms.length - 1])')),
		q(seen.deletes),
	);
	await evaluate('closeTemplateModal(); true');

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok(
		'no native alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
	);
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
	console.log(
		await evaluate(
			'JSON.stringify({ raw: !!rawDoc, draft: !!tplDraft, note: document.getElementById("tplNote").textContent, hint: document.getElementById("hint").textContent })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — template save ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
