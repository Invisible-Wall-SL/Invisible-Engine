// Browser gate for the slot duplicate under draw-order keys (the node gate is rig-duplicate-slot.mjs).
//
//   node tools/rigger-spike/rig-duplicate-slot-browser.mjs
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake launcher
// API, on a five-slot rig whose clip keys the draw order four times (and once back to the setup).
// Checked, the way an author meets it:
//   - Setup: ⧉ Duplicate slot on a middle slot puts the copy in front of it;
//   - Animate: at every key the page's own player draws the order the key had, the copy beside its
//     source, and the page throws nothing while it plays them;
//   - 💾 Save: engine-rig plays the saved file the same way at every key;
//   - ↓ on the bottom slot swaps the setup order only: the page's player and the saved file draw each
//     key as it was keyed, a key back to the setup the new setup.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { CLICK_SAVE } from './view-save.mjs';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, readIrig, exportSpine42Json } = RIG;

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const ATLAS = readFileSync(join(SYMBOLS3, 'symbols3.atlas'), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function drawnAt(doc, anim, t) {
	// SkeletonJson walks a key's offsets in slot order; one out of order never ends (rig-duplicate-slot.mjs).
	const index = new Map(doc.slots.map((s, i) => [s.name, i]));
	for (const a of Object.values(doc.animations || {}))
		for (const k of a.drawOrder || [])
			(k.offsets || []).forEach((o, i, all) => {
				if (i > 0 && index.get(o.slot) <= index.get(all[i - 1].slot))
					throw new Error('a draw-order key’s offsets out of slot order');
			});
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	const skel = new Skeleton(data);
	skel.setToSetupPose();
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, anim, false);
	state.update(t);
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	return skel.drawOrder.map((s) => s.data.name);
}

const NAMES = ['back', 'body', 'arm', 'head', 'hat'];
const offsetsOf = (order) =>
	NAMES.flatMap((n, i) =>
		order.indexOf(n) !== i ? [{ slot: n, offset: order.indexOf(n) - i }] : [],
	);
const KEYS = [
	{ time: 0, order: ['back', 'body', 'head', 'hat', 'arm'] },
	{ time: 0.25, order: ['body', 'arm', 'head', 'back', 'hat'] },
	{ time: 0.5, order: ['hat', 'back', 'body', 'arm', 'head'] },
	{ time: 0.75, order: ['back', 'arm', 'hat', 'body', 'head'] },
	{ time: 1, order: null },
];
const DOC = {
	skeleton: { spine: '4.2.0' },
	bones: [{ name: 'root' }],
	slots: NAMES.map((n) => ({ name: n, bone: 'root', attachment: 'radial' })),
	skins: [
		{
			name: 'default',
			attachments: Object.fromEntries(
				NAMES.map((n, i) => [
					n,
					{ radial: { x: i * 20, scaleX: 0.3, scaleY: 0.3, width: 100, height: 100 } },
				]),
			),
		},
	],
	animations: {
		walk: {
			bones: {
				root: {
					rotate: [
						{ time: 0, value: 0 },
						{ time: 1, value: 10 },
					],
				},
			},
			drawOrder: KEYS.map((k) =>
				k.order ? { time: k.time, offsets: offsetsOf(k.order) } : { time: k.time },
			),
		},
	},
};
const SRC = 'arm';
const COPY = 'arm_shine';
const want = (order) => (order || NAMES).flatMap((n) => (n === SRC ? [n, COPY] : [n]));

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const ENTRIES = [
	{
		id: 0,
		name: 'Dup',
		folder: 'Dup',
		dir_b64: b64('Dup'),
		skeleton_file: 'Dup.json',
		atlas_file: 'symbols3.atlas',
		format: 'json',
		runtime: '4.2',
		version: '4.2',
		pma: false,
	},
];
const posted = [];
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
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
			if (name === 'Dup.json') return jsonOut(DOC);
			if (/^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name)))
				return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/template') return send(404, 'text/plain', 'none');
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: null });
		if (p === '/api/rigger/save') {
			posted.push(JSON.parse(await readBody(req)));
			return jsonOut({ ok: true, saved: true, key: 'x', etag: `etag-${posted.length}`, count: 1 });
		}
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
const browser = await launchChrome({
	name: 'rig-duplicate-slot',
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
const frames = () =>
	evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');

try {
	await step('1. Setup: ⧉ Duplicate slot on a middle slot', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 1');
		await evaluate(
			`window.confirm = () => true; window.alert = () => {}; window.prompt = () => ${q(COPY)}; true`,
		);
		await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
		await evaluate(`(() => {
			document.getElementById("loadRigBtn").click();
			const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "Dup");
			if (row) row.click();
		})()`);
		await waitFor(
			'!!skeleton && !!rawDoc && !document.getElementById("loadingOverlay").classList.contains("on")',
			30000,
		);
		await evaluate('document.querySelector(\'#modeSeg button[data-mode="setup"]\').click(); true');
		await evaluate(`selectSlot(${q(SRC)}); true`);
		const clicked = await evaluate(
			'(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "⧉ Duplicate slot"); if (b) b.click(); return !!b; })()',
		);
		const slots = JSON.parse(await evaluate('JSON.stringify(rawDoc.slots.map((s) => s.name))'));
		ok(
			'the copy sits just in front of its source in the setup order',
			clicked && q(slots) === q(want(null)),
			q(slots),
		);
	});

	await step('2. Animate: the page’s own player at every key', async () => {
		await evaluate(
			'document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); setCurAnim("walk"); true',
		);
		for (const k of KEYS) {
			await evaluate(`animTime = ${k.time}; syncPlayhead(); true`);
			await frames();
			await wait(30);
			const drawn = JSON.parse(
				await evaluate('JSON.stringify(skeleton.drawOrder.map((s) => s ? s.data.name : null))'),
			);
			ok(`at ${k.time}: ${q(drawn)}`, q(drawn) === q(want(k.order)), `want ${q(want(k.order))}`);
		}
	});

	await step('3. 💾 Save: engine-rig plays the saved file the same way', async () => {
		const n = posted.length;
		await evaluate(CLICK_SAVE);
		ok('one save posted', posted.length === n + 1);
		const body = posted.at(-1);
		const saved = body.skeleton.irig ? exportSpine42Json(readIrig(body.skeleton)) : body.skeleton;
		for (const k of KEYS) {
			let drawn;
			try {
				drawn = drawnAt(saved, 'walk', k.time);
			} catch (e) {
				drawn = `threw: ${e.message}`;
			}
			ok(`at ${k.time}: ${q(drawn)}`, q(drawn) === q(want(k.order)), `want ${q(want(k.order))}`);
		}
	});

	await step('4. Setup: ↓ on the bottom slot changes the setup order only', async () => {
		await evaluate('document.querySelector(\'#modeSeg button[data-mode="setup"]\').click(); true');
		const clicked = await evaluate(
			'(() => { const b = [...document.querySelectorAll(\'#slotList .trow[data-slot="back"] button\')].find((x) => x.textContent === "↓"); if (b) b.click(); return !!b; })()',
		);
		const setup = ['body', 'back', 'arm', COPY, 'head', 'hat'];
		const moved = (order) => (order ? want(order) : setup);
		const slots = JSON.parse(await evaluate('JSON.stringify(rawDoc.slots.map((s) => s.name))'));
		ok('↓ swaps the bottom two slots', clicked && q(slots) === q(setup), q(slots));
		await evaluate(
			'document.querySelector(\'#modeSeg button[data-mode="animate"]\').click(); setCurAnim("walk"); true',
		);
		for (const k of KEYS) {
			await evaluate(`animTime = ${k.time}; syncPlayhead(); true`);
			await frames();
			await wait(30);
			const drawn = JSON.parse(
				await evaluate('JSON.stringify(skeleton.drawOrder.map((s) => s ? s.data.name : null))'),
			);
			ok(
				`the page’s player at ${k.time}: ${q(drawn)}`,
				q(drawn) === q(moved(k.order)),
				`want ${q(moved(k.order))}`,
			);
		}
		const n = posted.length;
		await evaluate(CLICK_SAVE);
		ok('one save posted', posted.length === n + 1);
		const body = posted.at(-1);
		const saved = body.skeleton.irig ? exportSpine42Json(readIrig(body.skeleton)) : body.skeleton;
		for (const k of KEYS) {
			let drawn;
			try {
				drawn = drawnAt(saved, 'walk', k.time);
			} catch (e) {
				drawn = `threw: ${e.message}`;
			}
			ok(
				`engine-rig, the saved file at ${k.time}: ${q(drawn)}`,
				q(drawn) === q(moved(k.order)),
				`want ${q(moved(k.order))}`,
			);
		}
	});

	await step('5. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.slice(0, 3).join(' | '));
	});
} finally {
	if (fail && pageLog.length)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass}/${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
