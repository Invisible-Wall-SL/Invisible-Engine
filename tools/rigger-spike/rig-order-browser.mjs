// Browser gate for the Rigger's constraint order and constraint keying (docs/design/rig-controls.md
// §4.1, phase K0).
//
//   node tools/rigger-spike/rig-order-browser.mjs
//   node tools/rigger-spike/rig-order-browser.mjs --shot <file.png>   # also save the banner's screenshot
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's `W` symbol as the old ＋ Add IK left it (an IK at order 0, so W's path
// constraint `shake`, also at 0, never runs). Checked, the way an author meets it:
//   - opening the rig changes nothing: the banner offers 🩹 Repair and names what never runs, the
//     constraint list marks it, the rig is not unsaved;
//   - 🩹 Repair re-numbers the solve order, every constraint runs, the rig is unsaved and says what
//     changed; ↶ puts the clash back; the saved document carries the repair;
//   - ＋ Add constraint › IK on a clean rig takes the next free order;
//   - 💾 Save refuses an edit that adds a clash, with the reason, and posts nothing;
//   - in Animate mode the IK panel shows the values at the playhead, keys an edit there without
//     touching the setup, ◆ Key IK keys all five values as shown, setup-only controls are disabled;
//     a 1-bone IK shows compress, a 2-bone one softness and bend.
// What it does NOT cover: R2, auth, the server's own refusal (`check:rigger-writes`), the runtime's
// solve (`rig-controls.mjs` poses the same functions through engine-rig).
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { CLICK_SAVE } from './view-save.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const shotAt = process.argv.includes('--shot')
	? process.argv[process.argv.indexOf('--shot') + 1]
	: null;

const w = JSON.parse(readFileSync(join(SYMBOLS3, 'W.json'), 'utf8'));
const LEAF = 'exp_spark1';
const clash = structuredClone(w);
clash.ik = [
	{
		name: 'ik1',
		order: 0,
		bones: [LEAF],
		target: 'global',
		mix: 0.4,
		softness: 0,
		bendPositive: true,
	},
];
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const RIGS = { Wclash: clash, W: w };
const ENTRIES = Object.keys(RIGS).map((name, id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: `${name}.json`,
	atlas_file: 'symbols3.atlas',
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
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
			const rig = Object.keys(RIGS).find((n) => b64(n) === url.searchParams.get('dir'));
			if (rig && name === `${rig}.json`) return jsonOut(RIGS[rig]);
			if (rig && /^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name)))
				return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/save') {
			posted.push(JSON.parse(await readBody(req)));
			return jsonOut({ ok: true, saved: true, key: 'x', etag: `etag-${posted.length}`, count: 2 });
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
	name: 'rig-order',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
});
const { evaluate, waitFor, send, pageLog } = browser;

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
const orders = () =>
	evaluate(
		'JSON.stringify(["ik","transform","path","physics"].flatMap((k) => (rawDoc[k] || []).map((c) => [c.name, c.order ?? 0])))',
	);
const setMode = (m) =>
	evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const panel = () => evaluate('document.getElementById("consDetail").textContent');
const field = (label) =>
	`[...document.querySelectorAll("#consDetail .crow")].find((r) => r.querySelector("label").textContent === ${q(label)})?.querySelector("input,select")`;
const toggle = (label) =>
	`[...document.querySelectorAll("#consDetail label")].find((l) => l.textContent.trim() === ${q(label)})?.querySelector("input")`;
const change = (sel, v) =>
	evaluate(
		`(() => { const el = ${sel}; el.value = ${q(String(v))}; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
	);

try {
	await step('1. open W as the old ＋ Add IK left it', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2');
		await evaluate(
			'window.confirm = () => true; window.alert = () => {}; window.prompt = () => "x"; true',
		);
		ok('the rig opens', await openRig('Wclash'));
		ok(
			'opening changes nothing: same orders, not unsaved',
			(await orders()) ===
				q([
					['ik1', 0],
					['wild_clock2', 1],
					['shake', 0],
				]) && !(await evaluate('dirty')),
			await orders(),
		);
		const banner = await evaluate(
			'(() => { const b = document.getElementById("orderClash"); return b && b.offsetParent ? b.innerText : null; })()',
		);
		ok(
			'the banner says what never runs and offers 🩹 Repair',
			!!banner &&
				/1 constraint never runs/.test(banner) &&
				/path "shake" shares order 0 with ik "ik1", which runs instead/.test(banner) &&
				/🩹 Repair/.test(banner),
			banner,
		);
		const tag = await evaluate(
			'[...document.querySelectorAll("#consList .trow")].filter((r) => r.textContent.includes("never runs")).map((r) => r.textContent).join("|")',
		);
		ok('the constraint list marks `shake` ⚠ never runs', /^–shake⚠ never runs/.test(tag), tag);
		if (shotAt) {
			await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
			const { data } = await send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(shotAt, Buffer.from(data, 'base64'));
		}
	});

	await step('2. 🩹 Repair', async () => {
		// An earlier refusal still on screen (a save the clash failed): Repair must not leave it over its notice.
		await evaluate('showErr("Not saved — an earlier refusal"); true');
		await evaluate(
			'[...document.querySelectorAll("#orderClash button")].find((b) => b.textContent.includes("Repair")).click(); true',
		);
		ok(
			'every constraint runs: ik1 0, shake 1, wild_clock2 2',
			(await orders()) ===
				q([
					['ik1', 0],
					['wild_clock2', 2],
					['shake', 1],
				]),
			await orders(),
		);
		ok(
			'the banner and the ⚠ tag are gone',
			await evaluate(
				'!document.getElementById("orderClash") && ![...document.querySelectorAll("#consList .trow")].some((r) => r.textContent.includes("never runs"))',
			),
		);
		const note = await evaluate('document.getElementById("err").innerText');
		ok(
			'the rig is unsaved and the author is told what changed',
			(await evaluate('dirty')) && /shake" now runs/.test(note) && /Save/.test(note),
			note,
		);
		await wait(50);
		await evaluate('document.getElementById("undoBtn").click(); true');
		ok(
			'↶ puts the clash back',
			(await orders()) ===
				q([
					['ik1', 0],
					['wild_clock2', 1],
					['shake', 0],
				]) && (await evaluate('!!document.getElementById("orderClash")')),
			await orders(),
		);
		await evaluate('document.getElementById("redoBtn").click(); true');
		await evaluate(CLICK_SAVE);
		const sent = posted.at(-1)?.skeleton;
		ok(
			'💾 Save posts the repaired rig',
			!!sent && sent.path[0].order === 1 && sent.transform[0].order === 2 && sent.ik[0].order === 0,
			q(sent && [sent.ik[0].order, sent.transform[0].order, sent.path[0].order]),
		);
	});

	await step('3. Animate mode: the IK panel keys what it shows (1-bone ik1)', async () => {
		await evaluate('selectIk("ik1"); true');
		await setMode('animate');
		await evaluate('selectIk("ik1"); true');
		const t = await panel();
		ok('it says where its values come from', /the setup's value — an edit keys it/.test(t), t);
		ok(
			'a 1-bone IK shows compress, not softness or bend',
			/compress/.test(t) && !/softness/.test(t) && !/bend \+/.test(t),
			t,
		);
		ok(
			'target and uniform are disabled (setup only)',
			await evaluate(`${field('target')}.disabled && ${toggle('uniform')}.disabled`),
		);
		await change(field('mix'), 0.9);
		const keys = await evaluate('JSON.stringify(rawDoc.animations[curAnim].ik.ik1)');
		ok(
			'editing mix keys it at the playhead with the other four as shown; the setup keeps 0.4',
			/"mix":0.9/.test(keys) &&
				/"bendPositive":true/.test(keys) &&
				(await evaluate('rawDoc.ik[0].mix')) === 0.4,
			keys,
		);
		ok(
			'the panel now reads the key',
			/keyed — an edit re-keys it/.test(await panel()) &&
				(await evaluate(`${field('mix')}.value`)) === '0.9',
		);
		await evaluate('animTime = 0.5; true');
		await wait(400);
		ok(
			'it follows the playhead (redrawn at 0.5 s)',
			/at 0\.5 s/.test(await panel()),
			await panel(),
		);
		await evaluate(
			'[...document.querySelectorAll("#consDetail button")].find((b) => b.textContent.includes("Key IK")).click(); true',
		);
		const k = await evaluate(
			'JSON.stringify(rawDoc.animations[curAnim].ik.ik1.find((x) => x.time === 0.5))',
		);
		ok(
			'◆ Key IK keys all five as shown at 0.5 s',
			k ===
				q({
					time: 0.5,
					mix: 0.9,
					softness: 0,
					bendPositive: true,
					compress: false,
					stretch: false,
				}),
			k,
		);
	});

	await step('4. ＋ Add constraint › IK on a clean rig, then its 2-bone panel', async () => {
		ok(
			'W opens with no banner',
			(await openRig('W')) && (await evaluate('!document.getElementById("orderClash")')),
		);
		await setMode('setup');
		await evaluate(`selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(LEAF)})); true`);
		await evaluate(
			'document.getElementById("consAdd").click(); [...document.querySelectorAll("#curveMenu button")].find((b) => b.firstChild.textContent === "IK").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); true',
		);
		ok(
			'the new IK takes the next free order (2); nothing clashes',
			(await orders()) ===
				q([
					['ik1', 2],
					['wild_clock2', 1],
					['shake', 0],
				]) && (await evaluate('!document.getElementById("orderClash")')),
			await orders(),
		);
		const t = await panel();
		ok(
			'a 2-bone IK shows softness and bend, not compress',
			/softness/.test(t) && /bend \+/.test(t) && !/compress/.test(t),
			t,
		);
		ok('in Setup mode the target is editable', await evaluate(`!${field('target')}.disabled`));
	});

	// No button makes a clash any more, so the edit is planted; the save must still refuse it.
	await step('5. 💾 Save refuses an edit that adds a clash', async () => {
		const before = posted.length;
		await evaluate('rawDoc.transform[0].order = 2; true');
		await evaluate(CLICK_SAVE);
		const err = await evaluate('document.getElementById("err").textContent');
		ok(
			'refused with the reason, nothing posted',
			/Not saved — transform "wild_clock2" would never run: it shares order 2 with ik "ik1"/.test(
				err,
			) && posted.length === before,
			`${err} · posts ${posted.length - before}`,
		);
	});

	await step('6. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
