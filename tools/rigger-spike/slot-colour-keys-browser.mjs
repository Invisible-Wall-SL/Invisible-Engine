// Browser gate for keying a slot's colour and opacity in Animate (the slot panel, ◆ Key all, ⤓):
// each key goes on the colour timeline the clip already uses for that slot.
//
//   node tools/rigger-spike/slot-colour-keys-browser.mjs
//   node tools/rigger-spike/slot-colour-keys-browser.mjs --mutants   # every planted bug must fail a check
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W (its `wild_dynamite` clip colours `rays1` with the split 4.2 `rgb` +
// `alpha` timelines and most slots with `rgba`), and plays every result through engine-rig (a fresh
// Skeleton from the rig as rawDoc has it, the clip applied at the playhead):
//   - a split slot: the opacity slider and ◆ Key opacity key `alpha` (no rgba, no rgb key), the
//     clip's rgb keys still play; the colour picker keys `rgb` and leaves the alpha; the panel shows
//     the opacity engine-rig plays, and the Animate stage draws it; ✕ deletes the key;
//   - a slot with no colour keys and an rgba slot: rgba as before; re-keying an eased key refits its
//     handles to the new value;
//   - two-colour slots: rgba2 as before; a split one keys `alpha`, and its dark colour on `rgb2`;
//   - ◆ Key all adds no colour timeline kind to a split slot, and no clip ends with rgba and split
//     timelines on one slot.
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
	['a split slot keys rgba as before', 'if (slotSplitColour(slotName)){ keySlotSplit(slotName, hex, part, null); return; }', 'if (false){ keySlotSplit(slotName, hex, part, null); return; }'],
	['an opacity change keys rgb too', 'if (part === "rgb" || part === "dark" || (!part && cs[light])){', 'if (true){'],
	['the opacity slider says nothing changed but its alpha', 'hex2(parseInt(av.value, 10) / 100), "alpha");', 'hex2(parseInt(av.value, 10) / 100));'],
	['a re-keyed eased key keeps its old handles', '    if (next && Array.isArray(key.curve)) refit(key, old, next, key, next);\n', ''],
	['the panel reads a split slot’s opacity off its setup', '  if (slotSplitColour(slotName)) return rgbaToHex(splitColourAt(', '  if (false) return rgbaToHex(splitColourAt('],
	['the Animate stage does not play split keys', '      if (ch.rgb || ch.rgb2 || ch.alpha){', '      if (false){'],
	['✕ does not see an alpha key', 'const colour = ["rgba", "rgba2", "rgb", "alpha", "rgb2"];', 'const colour = ["rgba", "rgba2"];'],
	['a dark key on a split slot goes on rgba2', 'keySlotSplit(slotName, slotColorAt(slotName, animTime), "dark", darkHex.slice(0, 6));', 'keySlotRgba2(slotName, slotColorAt(slotName, animTime).slice(0, 8), darkHex.slice(0, 6));'],
];

let html = SHIPPED;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const SOURCE = { id: 0, name: 'W', folder: 'W', dir_b64: b64('W'), skeleton_file: 'W.json', atlas_file: 'symbols3.atlas', format: 'json', runtime: '4.2', version: '4.2', pma: false };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.atlas': 'text/plain', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
	const jsonOut = (v) => send(200, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons') return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: [SOURCE] });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			if (url.searchParams.get('dir') !== b64('W')) return send(404, 'text/plain', 'no such bundle');
			if (name === 'W.json') return send(200, MIME['.json'], W_JSON);
			if (/^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name))) return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET') return jsonOut({ ok: true, projectKey: 'p', etag: null, rig3d: null, controls: null });
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
const browser = await launchChrome({ name: 'slot-colour-keys', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const near = (a, b, eps = 1.5 / 255) => Math.abs(a - b) < eps;
const same = (a, b) => q(a) === q(b);
const CLIP = 'wild_dynamite';
const T = 0.9; // between two of rays1's keys, on none

const HELPERS = `(() => {
	window.__t = {
		drawnA: {},
		ch(n) { const a = rawDoc.animations[${q(CLIP)}]; return JSON.parse(JSON.stringify((a.slots || {})[n] || {})); },
		kinds(n) { return Object.keys(this.ch(n)).filter((k) => k !== "attachment").sort(); },
		// What engine-rig plays for slot n at t: light rgba and dark rgb.
		played(n, t) {
			rebuildFromRawDoc(null);
			const sk = new RIG.Skeleton(skeletonData); sk.setToSetupPose();
			skeletonData.findAnimation(${q(CLIP)}).apply(sk, 0, t, false, null, 1, RIG.MixBlend.setup, RIG.MixDirection.mixIn);
			const s = sk.findSlot(n);
			return { c: [s.color.r, s.color.g, s.color.b, s.color.a], d: s.darkColor ? [s.darkColor.r, s.darkColor.g, s.darkColor.b] : null };
		},
		open(n) { playing = false; setCurAnim(${q(CLIP)}); animTime = ${T}; selectSlot(n); renderSlotDetail(); return true; },
		opacity() { return document.querySelector("#slotDetail input[type=range]"); },
		slide(v) { const r = this.opacity(); r.value = String(v); r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); return true; },
		pick(i, hex) { const c = document.querySelectorAll("#slotDetail input[type=color]")[i]; c.value = hex; c.dispatchEvent(new Event("input")); return true; },
		button(prefix) { const b = [...document.querySelectorAll("#slotDetail button")].find((x) => x.textContent.startsWith(prefix)); b.click(); return true; },
		mixed() {
			return Object.entries(rawDoc.animations).flatMap(([an, a]) => Object.entries(a.slots || {})
				.filter(([, c]) => (c.rgba || c.rgba2) && (c.rgb || c.alpha || c.rgb2)).map(([s]) => an + "/" + s));
		},
	};
	const draw = renderer.drawSkeleton.bind(renderer);
	renderer.drawSkeleton = (sk, ...rest) => { if (sk === skeleton) for (const s of sk.slots) __t.drawnA[s.data.name] = s.color.a; return draw(sk, ...rest); };
	return true;
})()`;
const H = (expr) => evaluate(`__t.${expr}`);

async function openW() {
	await evaluate('location.reload(); true').catch(() => {});
	await wait(300);
	await waitFor('typeof skeletons !== "undefined" && skeletons.length >= 1', 30000);
	await evaluate('window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; localStorage.clear(); document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "W"); row.click(); return true; })()`);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await waitFor('!!skeleton && !!rawDoc', 15000);
	await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); fitView(); true');
	await evaluate(`document.querySelector('#modeSeg button[data-mode="animate"]').click(); true`);
	await frames(3);
	await evaluate(HELPERS);
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
	try {
		await openW();
	} catch (e) {
		ok('W opens', false, e.message);
		return { pass, fail };
	}
	const mixed0 = await H('mixed()');

	await step('1. a split slot (rgb + alpha keys): the opacity slider and ◆ Key opacity key alpha', async () => {
		const n = 'rays1';
		const kinds0 = await H(`kinds(${q(n)})`), rgb0 = (await H(`ch(${q(n)})`)).rgb;
		ok('rays1 is coloured with rgb + alpha keys', same(kinds0, ['alpha', 'rgb']), q(kinds0));
		const p0 = await H(`played(${q(n)}, ${T})`), later0 = await H(`played(${q(n)}, 1.1)`);
		await H(`open(${q(n)})`);
		ok('the panel shows the opacity engine-rig plays', (await evaluate('Number(__t.opacity().value)')) === Math.round(p0.c[3] * 100), q({ panel: await evaluate('__t.opacity().value'), played: p0.c[3] }));
		await evaluate('__t.drawnA = {}; true'); await frames(3);
		ok('the Animate stage draws it at that opacity', near((await H('drawnA'))[n], p0.c[3]), q({ drawn: (await H('drawnA'))[n], played: p0.c[3] }));
		await H('slide(40)');
		const ch1 = await H(`ch(${q(n)})`);
		ok('the slider keys alpha at the playhead', (ch1.alpha || []).some((k) => Math.abs(k.time - T) < 1e-4 && near(k.value, 0.4, 1e-3)), q(ch1.alpha));
		ok('no rgba, and no rgb key at the playhead', !ch1.rgba && same(ch1.rgb, rgb0), q(Object.keys(ch1)));
		const p1 = await H(`played(${q(n)}, ${T})`);
		ok('engine-rig plays it at 40%, its rgb as before', near(p1.c[3], 0.4) && [0, 1, 2].every((i) => near(p1.c[i], p0.c[i])), q({ p0, p1 }));
		const later1 = await H(`played(${q(n)}, 1.1)`);
		ok('past the next key the clip plays as before', same(later1, later0), q({ later0, later1 }));
		await H(`open(${q(n)})`);
		await H('button("◆ Key opacity")');
		const ch2 = await H(`ch(${q(n)})`);
		ok('◆ Key opacity re-keys alpha at its value, nothing else', same(ch2, ch1), q({ ch1: ch1.alpha, ch2: ch2.alpha }));
		await H(`open(${q(n)})`);
		await H('pick(0, "#00ff00")');
		const ch3 = await H(`ch(${q(n)})`), p3 = await H(`played(${q(n)}, ${T})`);
		ok('the colour picker keys rgb, leaving alpha', (ch3.rgb || []).some((k) => Math.abs(k.time - T) < 1e-4 && k.color === '00ff00') && same(ch3.alpha, ch1.alpha) && !ch3.rgba, q(ch3));
		ok('engine-rig plays the green at 40%', near(p3.c[0], 0) && near(p3.c[1], 1) && near(p3.c[3], 0.4), q(p3));
		await H(`open(${q(n)})`);
		await evaluate(`deleteSlotKeyAt(${q(n)}, ${T}); true`);
		const ch4 = await H(`ch(${q(n)})`);
		ok('✕ takes the keys at the playhead off again', same(ch4.alpha, ch1.alpha.filter((k) => Math.abs(k.time - T) >= 1e-4)) && same(ch4.rgb, rgb0), q(ch4));
	});

	await step('2. a slot with no colour keys, and an eased rgba key: rgba as before, the handles refitted', async () => {
		const plain = await evaluate(`rawDoc.slots.map((s) => s.name).find((n) => !rawDoc.animations[${q(CLIP)}].slots[n] && !rawDoc.slots.find((x) => x.name === n).dark)`);
		await H(`open(${q(plain)})`);
		await H('slide(40)');
		const ch = await H(`ch(${q(plain)})`), p = await H(`played(${q(plain)}, ${T})`);
		ok(`"${plain}": the slider keys rgba (as before), no alpha timeline`, same(Object.keys(ch).filter((k) => k !== 'attachment'), ['rgba']) && ch.rgba[0].color.endsWith('66'), q(ch));
		ok('engine-rig plays it at 40%', near(p.c[3], 0.4), q(p));
		// An eased rgba key at the playhead, fading 0 → 1 to the next: re-keyed to 50%, the segment's
		// alpha handles move into 0.5…1, its rgb handles stay.
		const curve = [0.95, 0.9, 1.05, 0.9, 0.95, 0.9, 1.05, 0.9, 0.95, 0.9, 1.05, 0.9, 0.95, 0.2, 1.05, 0.8];
		await evaluate(`historyStep(() => { const cs = rawDoc.animations[${q(CLIP)}].slots[${q(plain)}]; cs.rgba = [{ time: ${T}, color: "e6e6e600", curve: ${q(curve)} }, { time: 1.2, color: "e6e6e6ff" }]; markDirty(); }); true`);
		await H(`open(${q(plain)})`);
		await H('slide(50)');
		const k0 = (await H(`ch(${q(plain)})`)).rgba[0];
		ok('the re-keyed key keeps its ease', Array.isArray(k0.curve), q(k0));
		ok('its alpha handles are refitted to 50% → 100%', k0.curve && near(k0.curve[13], 0.6, 2e-3) && near(k0.curve[15], 0.9, 2e-3), q(k0.curve));
		ok('its colour handles are left', k0.curve && same(k0.curve.slice(0, 12), curve.slice(0, 12)), q(k0.curve));
	});

	await step('3. two-colour slots: rgba2 as before; a split one keys alpha, and its dark on rgb2', async () => {
		const two = 'wild_clock_w_add';
		ok(`"${two}" is a two-colour slot coloured with rgba2`, same(await H(`kinds(${q(two)})`), ['rgba2']) && (await evaluate(`!!rawDoc.slots.find((s) => s.name === ${q(two)}).dark`)));
		await H(`open(${q(two)})`);
		await H('slide(40)');
		const k = ((await H(`ch(${q(two)})`)).rgba2 || []).find((x) => Math.abs(x.time - T) < 1e-4);
		ok('the slider keys rgba2 (light at 40%, the dark carried)', !!k && k.light.endsWith('66') && same(await H(`kinds(${q(two)})`), ['rgba2']), q(k));
		ok('engine-rig plays it at 40%', near((await H(`played(${q(two)}, ${T})`)).c[3], 0.4));
		// A two-colour slot the clip fades with alpha keys alone: its dark colour keys rgb2.
		const n = 'radial8';
		await evaluate(`historyStep(() => { rawDoc.slots.find((s) => s.name === ${q(n)}).dark = "000000"; delete rawDoc.animations[${q(CLIP)}].slots[${q(n)}].rgb; rebuildFromRawDoc(null); markDirty(); }); true`);
		const alpha0 = (await H(`ch(${q(n)})`)).alpha;
		await H(`open(${q(n)})`);
		await H('pick(1, "#ff0000")');
		const ch = await H(`ch(${q(n)})`), p = await H(`played(${q(n)}, 1.1)`);
		ok('the dark colour keys rgb2, leaving alpha', same(Object.keys(ch).filter((x) => x !== 'attachment').sort(), ['alpha', 'rgb2']) && same(ch.alpha, alpha0) && ch.rgb2[0].dark === 'ff0000', q(ch));
		ok('engine-rig plays the dark red', !!p.d && near(p.d[0], 1) && near(p.d[1], 0), q(p));
		await H(`open(${q(n)})`);
		await H('slide(30)');
		ok('its opacity keys alpha', ((await H(`ch(${q(n)})`)).alpha || []).some((x) => Math.abs(x.time - T) < 1e-4 && near(x.value, 0.3, 3e-3)) && !(await H(`ch(${q(n)})`)).rgba2, q(await H(`ch(${q(n)})`)));
		// One with rgb keys: rgb carries no dark, so its dark is not keyed (rgba2 would override both).
		const m = 'radial9';
		await evaluate(`historyStep(() => { rawDoc.slots.find((s) => s.name === ${q(m)}).dark = "000000"; rebuildFromRawDoc(null); markDirty(); }); true`);
		const before = await H(`ch(${q(m)})`);
		await H(`open(${q(m)})`);
		await H('pick(1, "#ff0000")');
		ok('a dark colour over rgb keys is refused, nothing keyed', same(await H(`ch(${q(m)})`), before) && /no dark colour/.test(await evaluate('document.getElementById("hint").textContent')));
	});

	await step('4. ◆ Key all adds no timeline kind, and no clip mixes rgba with split keys', async () => {
		const splits = ['rays1', 'rays2', 'radial10'];
		const kinds0 = await Promise.all(splits.map((n) => H(`kinds(${q(n)})`)));
		const p0 = await Promise.all(splits.map((n) => H(`played(${q(n)}, ${T})`)));
		await evaluate(`playing = false; setCurAnim(${q(CLIP)}); animTime = ${T}; keyAll(); true`);
		const kinds1 = await Promise.all(splits.map((n) => H(`kinds(${q(n)})`)));
		ok('◆ Key all keys each split slot on the timelines it has', same(kinds1, kinds0), q({ kinds0, kinds1 }));
		const p1 = await Promise.all(splits.map((n) => H(`played(${q(n)}, ${T})`)));
		ok('and engine-rig plays them as before at the playhead', p1.every((p, i) => p.c.every((v, j) => near(v, p0[i].c[j]))), q({ p0, p1 }));
		ok('no clip has a slot with both rgba and split colour keys it did not have', same(await H('mixed()'), mixed0), q(await H('mixed()')));
	});
	return { pass, fail };
}

let code;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		console.log('slot-colour-keys-browser mutants (each must fail a check):');
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
		console.log('slot-colour-keys-browser — colour and opacity keys on the timeline each slot’s clip uses (W)');
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
