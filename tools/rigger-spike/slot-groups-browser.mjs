// Browser gate for the Slots list's own slot groups and their view opacity.
//
//   node tools/rigger-spike/slot-groups-browser.mjs
//   node tools/rigger-spike/slot-groups-browser.mjs --mutants   # every planted bug must fail a check
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W (40 slots, a clip with draw-order keys):
//   - ＋ in the Slots header saves the Shift / Ctrl selection as a group in the rig's controls.json, as
//     one undo step; the save sends it and a reopen has it; its eye hides and solos like a template's;
//   - the group's slider dims its slots on the stage alone: the drawn alpha is setup × slider (× the
//     other group's, for a slot in two), put back after every draw, in Setup, Animate and Preview; the
//     rig is not dirtied, no undo step, the exported .irig is byte-identical; it survives a reload;
//   - a slot renamed in the rig is renamed in the group, a deleted one leaves it, a group left with no
//     slot goes; ✎ renames a group (its opacity goes with it) and 🗑 deletes one;
//   - ⤓ in Setup multiplies the members' setup alpha by the slider and resets it to 100%, the stage
//     drawing the same alphas; in Animate it keys each member's opacity at the playhead (alpha there ×
//     slider), keeping an existing key's curve and the clip's draw-order keys; each is one undo step.
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
	['the view opacity is not put back after a draw', 'dim.forEach((s, i) => { s.color.a = was[i]; });', ''],
	['a slot in two groups gets one opacity, not the product', 'out.set(n, (out.has(n) ? out.get(n) : 1) * a)', 'out.set(n, a)'],
	['⤓ in Setup sets the alpha instead of multiplying it', 'const alphaTimes = (hex, k) => hex.slice(0, 6) + hex2(parseInt(hex.slice(6, 8) || "ff", 16) / 255 * k);', 'const alphaTimes = (hex, k) => hex.slice(0, 6) + hex2(k);'],
	['⤓ leaves the slider where it was', '  setSlotGroupAlpha(g.id, 1);\n  renderSlotGroups();\n}\n\n// The group eyes again', '  renderSlotGroups();\n}\n\n// The group eyes again'],
	['a slot rename does not follow into the groups', '  renameInControls("slot", oldName, newName);\n', ''],
	['⤓ in Animate keys rgba over split rgb / alpha keys', '      if (slotSplitColour(n)) keySlotSplitAlpha', '      if (false) keySlotSplitAlpha'],
	['the group rename leaves its opacity behind', '  setSlotGroupAlpha("u:" + from, 1); setSlotGroupAlpha("u:" + to, a);\n', ''],
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
			return jsonOut({ ok: true, projectKey: 'p', etag: savedIrig ? `"e${saves.length}"` : null, rig3d: null, controls: savedControls ? { etag: `"c${saves.length}"`, doc: savedControls } : null });
		if (p === '/api/rigger/save' && req.method === 'POST') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				saves.push(body);
				const j = JSON.parse(body);
				savedIrig = JSON.stringify(j.skeleton);
				if (j.controls) savedControls = { ...j.controls, rig: 'W' };
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
const browser = await launchChrome({ name: 'slot-groups', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const near = (a, b) => Math.abs(a - b) < 1.5 / 255;

// Page-side helpers: the alpha each slot is drawn with (read inside the stage's draw), the export.
const HELPERS = `(() => {
	window.__t = {
		names() { return rawDoc.slots.map((s) => s.name); },
		drawnA: {},
		steps() { return rigHist.past.length; },
		groups() { return JSON.parse(JSON.stringify((controlsDoc && controlsDoc.slotGroups) || null)); },
		rows() { return [...document.querySelectorAll("#slotList .slotGroupRow")].map((r) => r.querySelector(".slotGroupEye").textContent); },
		row(label) { return [...document.querySelectorAll("#slotList .slotGroupRow")].find((r) => r.querySelector(".slotGroupEye").textContent.split(" ").slice(1).join(" ") === label); },
		slide(label, v) { const r = this.row(label).querySelector("input[type=range]"); r.value = String(v); r.dispatchEvent(new Event("input")); return true; },
		order(anim) {
			const names = this.names();
			return (rawDoc.animations[anim].drawOrder || []).map((fr) => fr.offsets ? drawOrderOfOffsets(fr.offsets, names).map((i) => names[i]) : names);
		},
		exportText() {
			return new Promise((res) => {
				const ou = URL.createObjectURL, ac = HTMLAnchorElement.prototype.click;
				HTMLAnchorElement.prototype.click = function () {};
				URL.createObjectURL = (b) => { b.text().then(res); return "blob:none"; };
				try { exportIrig(); } finally { URL.createObjectURL = ou; HTMLAnchorElement.prototype.click = ac; }
			});
		},
	};
	const draw = renderer.drawSkeleton.bind(renderer);
	renderer.drawSkeleton = (sk, ...rest) => { if (sk === skeleton) for (const s of sk.slots) __t.drawnA[s.data.name] = s.color.a; return draw(sk, ...rest); };
	return true;
})()`;
const T = (expr) => evaluate(`__t.${expr}`);
// The alpha each slot is drawn with now, and the one it has outside the draw.
const drawn = async () => { await evaluate('__t.drawnA = {}; true'); await frames(3); return T('drawnA'); };
const live = () => evaluate('Object.fromEntries(skeleton.slots.map((s) => [s.data.name, s.color.a]))');

async function openW() {
	await evaluate('location.reload(); true').catch(() => {});
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
const same = (a, b) => q(a) === q(b);
// Select `names` as the Shift / Ctrl selection, the first one open.
const selectRows = (names) => evaluate(`(() => { slotMulti = new Set(${q(names)}); slotAnchor = ${q(names[0])}; selectSlot(${q(names[0])}); return true; })()`);
const addGroup = (name) => evaluate(`(() => { window.prompt = () => ${q(name)}; document.getElementById("slotGroupAdd").click(); window.prompt = () => null; return true; })()`);

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
	// Groups over slots drawn at full alpha and slots the clip colours with split rgb / alpha keys,
	// one full slot in both (names[0] stays out: step 5 deletes it).
	const split = await evaluate('Object.entries(rawDoc.animations.wild_dynamite.slots || {}).filter(([, c]) => c.alpha || c.rgb).map(([n]) => n)');
	const full = await evaluate('rawDoc.slots.filter((s) => !s.color || s.color.slice(6) === "ff").map((s) => s.name)');
	const F = full.filter((n) => n !== names[0] && !split.includes(n)), S = split.filter((n) => n !== names[0]);
	const inOrder = (xs) => names.filter((n) => xs.includes(n)); // a group lists its slots in draw order
	const A = inOrder([F[0], F[1], S[0], S[1]]), B = inOrder([F[1], F[2], F[3]]);

	await step('1. ＋ saves the selection as a group, kept in controls.json, one undo step', async () => {
		ok('no group to begin with', (await T('rows()')).length === 0, q(await T('rows()')));
		await selectRows(A);
		const s0 = await T('steps()');
		await addGroup('arm');
		ok('the group holds the selection', same(await T('groups()'), { arm: A }), q(await T('groups()')));
		ok('its row shows, marked as the author’s', same(await T('rows()'), ['👁 arm']) && (await evaluate('__t.row("arm").querySelector(".slotGroupEye").classList.contains("mine")')));
		ok('one undo step, the rig dirty', (await T('steps()')) === s0 + 1 && (await evaluate('dirty')));
		await evaluate('rigUndo(); true'); await frames(2);
		ok('undo takes it away', (await T('groups()')) === null && (await T('rows()')).length === 0, q(await T('groups()')));
		await evaluate('rigRedo(); true'); await frames(2);
		ok('redo brings it back', same(await T('groups()'), { arm: A }) && (await T('rows()')).length === 1);
		await selectRows(B);
		await addGroup('hand');
		ok('a second group overlapping the first', same(await T('groups()'), { arm: A, hand: B }));
	});

	await step('2. its eye hides and solos like a template group’s', async () => {
		await evaluate('__t.row("arm").querySelector(".slotGroupEye").click(); true');
		ok('click hides its slots', same(await evaluate('[...slotEyeHidden()].sort()'), A.slice().sort()));
		await evaluate('__t.row("arm").querySelector(".slotGroupEye").click(); true');
		ok('click again shows them', (await evaluate('slotEyeHidden().size')) === 0);
		await evaluate('__t.row("arm").querySelector(".slotGroupEye").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); true');
		ok('right-click shows only them', same(await evaluate('[...slotEyeHidden()].sort()'), names.filter((n) => !A.includes(n)).sort()));
		await evaluate('setSlotEye([]); true');
	});

	await step('3. the slider dims its slots on the stage alone, the product for a slot in two', async () => {
		const setupA = await live();
		const out0 = await T('exportText()');
		const s0 = await T('steps()');
		await evaluate('dirty = false; true');
		await T('slide("arm", 40)');
		await T('slide("hand", 50)');
		const d = await drawn();
		const only = A.filter((n) => !B.includes(n)), both = A.filter((n) => B.includes(n)), handOnly = B.filter((n) => !A.includes(n));
		ok('a slot in one group draws at setup × its opacity', only.every((n) => near(d[n], setupA[n] * 0.4)) && handOnly.every((n) => near(d[n], setupA[n] * 0.5)), q(only.map((n) => [d[n], setupA[n]])));
		ok('a slot in both draws at setup × the product', both.every((n) => near(d[n], setupA[n] * 0.2)), q(both.map((n) => [d[n], setupA[n]])));
		ok('a slot in neither draws as it is', names.filter((n) => !A.includes(n) && !B.includes(n)).every((n) => d[n] === setupA[n]));
		ok('the alpha is put back after the draw', same(await live(), setupA));
		ok('the row says 40%', await evaluate('__t.row("arm").querySelector(".slotGroupPct").textContent') === '40%');
		ok('no edit: not dirty, no undo step', !(await evaluate('dirty')) && (await T('steps()')) === s0);
		ok('the exported .irig is byte-identical', (await T('exportText()')) === out0);
		for (const m of ['animate', 'preview']) {
			await setMode(m);
			const dm = await drawn();
			ok(`${m}: it dims there too`, both.every((n) => dm[n] < 0.99 * (setupA[n] || 1) || setupA[n] === 0), q(both.map((n) => dm[n])));
		}
		await setMode('setup');
	});

	await step('4. the groups ride the save, the opacity this browser', async () => {
		await evaluate('saveToR2(); true');
		await waitFor('rigEtag === "\\"e1\\""', 10000);
		const sent = JSON.parse(saves[saves.length - 1]);
		ok('the save sends the groups in controls.json', same(sent.controls && sent.controls.slotGroups, { arm: A, hand: B }), q(sent.controls));
		ok('and no opacity anywhere in it', !saves[saves.length - 1].includes('slotGroupAlpha') && !JSON.stringify(sent.skeleton).includes('slotGroup'));
		await openW();
		ok('a reopen has the groups', same(await T('groups()'), { arm: A, hand: B }), q(await T('groups()')));
		ok('and the opacity it was left at', await evaluate('__t.row("arm").querySelector("input").value') === '40');
	});

	await step('5. membership follows the rig: a slot renamed, a slot deleted, a group emptied', async () => {
		await setMode('setup');
		await evaluate(`renameSlot(${q(A[0])}, "renamed_slot"); true`);
		ok('a renamed slot is renamed in its group', same((await T('groups()')).arm, ['renamed_slot', ...A.slice(1)]), q(await T('groups()')));
		await evaluate('rigUndo(); true'); await frames(2);
		ok('undo puts the name back in the group too', same((await T('groups()')).arm, A), q(await T('groups()')));
		await selectRows([names[0]]);
		await addGroup('solo');
		await evaluate(`deleteSlot(${q(names[0])}); true`); await frames(2);
		ok('deleting a group’s only slot drops the group', !('solo' in ((await T('groups()')) || {})), q(await T('groups()')));
		await evaluate(`deleteSlot(${q(A[1])}); true`); await frames(2);
		ok('a deleted slot leaves its groups', same((await T('groups()')).arm, [A[0], ...A.slice(2)]) && !(await T('groups()')).hand.includes(A[1]), q(await T('groups()')));
		await evaluate('rigUndo(); rigUndo(); rigUndo(); true'); await frames(2);
		ok('undo brings slot and memberships back', same(await T('groups()'), { arm: A, hand: B }), q(await T('groups()')));
	});

	await step('6. ✎ renames a group, its opacity with it; 🗑 deletes one', async () => {
		await evaluate('window.prompt = () => "limb"; __t.row("arm").querySelector("button[title=\'Rename the group\']").click(); window.prompt = () => null; true');
		ok('renamed in place', same(Object.keys(await T('groups()')), ['limb', 'hand']), q(await T('groups()')));
		ok('its opacity went with it', await evaluate('__t.row("limb").querySelector("input").value') === '40');
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate('setSlotGroupAlpha("u:arm", 0.4); renderSlotGroups(); true');
		ok('undo gives the old name back', same(Object.keys(await T('groups()')), ['arm', 'hand']));
		await evaluate('__t.row("hand").querySelector("button[title^=\'Delete the group\']").click(); true');
		ok('🗑 deletes it', same(await T('groups()'), { arm: A }) && same(await T('rows()'), ['👁 arm']));
		await evaluate('rigUndo(); true'); await frames(2);
		await evaluate('setSlotGroupAlpha("u:hand", 0.5); renderSlotGroups(); true');
	});

	await step('7. ⤓ in Setup multiplies the setup alpha, resets the slider, the stage the same', async () => {
		await setMode('setup');
		// A member with a setup alpha between 0 and 100%, so multiply and set differ.
		await evaluate(`historyStep(() => { rawDoc.slots.find((s) => s.name === ${q(A[0])}).color = "ffffff80"; rebuildFromRawDoc(null); markDirty(); }); true`);
		await frames(2);
		const colors0 = await evaluate(`${q(A)}.map((n) => rawDoc.slots.find((s) => s.name === n).color || "ffffffff")`);
		const before = await drawn();
		const s0 = await T('steps()');
		await evaluate('__t.row("arm").querySelector(".slotGroupApply").click(); true');
		await frames(2);
		const colors = await evaluate(`${q(A)}.map((n) => rawDoc.slots.find((s) => s.name === n).color || "ffffffff")`);
		const exp = colors0.map((c) => c.slice(0, 6) + Math.round((parseInt(c.slice(6, 8), 16) / 255) * 0.4 * 255).toString(16).padStart(2, '0'));
		ok('each member’s setup alpha × 40% (80 → 33)', same(colors, exp) && colors[0] === 'ffffff33', q({ colors0, colors }));
		ok('the slider is back at 100%', await evaluate('__t.row("arm").querySelector("input").value') === '100' && (await evaluate('slotGroupAlpha("u:arm")')) === 1);
		const after = await drawn();
		ok('the stage draws every slot as before', names.filter((n) => n in before).every((n) => near(after[n], before[n])), q(A.map((n) => [before[n], after[n]])));
		ok('one undo step', (await T('steps()')) === s0 + 1);
		ok('⤓ is off at 100%', await evaluate('__t.row("arm").querySelector(".slotGroupApply").disabled'));
		await evaluate('rigUndo(); true'); await frames(2);
		ok('undo gives the setup colours back', same(await evaluate(`${q(A)}.map((n) => rawDoc.slots.find((s) => s.name === n).color || "ffffffff")`), colors0));
		await evaluate('setSlotGroupAlpha("u:arm", 0.4); renderSlotGroups(); true');
	});

	await step('8. ⤓ in Animate keys the opacity at the playhead (engine-rig plays it), keeping curves and draw-order keys', async () => {
		await setMode('animate');
		const T0 = 1.0;
		await evaluate(`(() => { playing = false; setCurAnim("wild_dynamite"); animTime = ${T0}; syncPlayhead(); return true; })()`);
		// One member with a plain rgba key (eased) at the playhead; the others as W has them (some with
		// split rgb / alpha timelines).
		await evaluate(`(() => { const a = rawDoc.animations.wild_dynamite; const cs = ((a.slots = a.slots || {})[${q(A[0])}] = a.slots[${q(A[0])}] || {}); delete cs.alpha; delete cs.rgb; cs.rgba = [{ time: ${T0}, color: "ff0000cc", curve: [1.1, 0.8, 1.2, 0.8, 1.1, 0, 1.2, 0, 1.1, 0.8, 1.2, 0.8, 1.1, 0.8, 1.2, 0.8] }, { time: 1.5, color: "ffffffff" }]; rebuildFromRawDoc(null); return true; })()`);
		await evaluate('playing = false; animTime = ' + T0 + '; true');
		// What engine-rig plays for every slot at the playhead, from the rig as it is in rawDoc now.
		const played = () => evaluate(`(() => { rebuildFromRawDoc(null); const sk = new RIG.Skeleton(skeletonData); sk.setToSetupPose(); skeletonData.findAnimation("wild_dynamite").apply(sk, 0, ${T0}, false, null, 1, RIG.MixBlend.setup, RIG.MixDirection.mixIn); return Object.fromEntries(sk.slots.map((s) => [s.data.name, [s.color.r, s.color.g, s.color.b, s.color.a]])); })()`);
		const split0 = await evaluate(`${q(A)}.filter((n) => slotSplitColour(n))`);
		const p0 = await played();
		const order0 = await T('order("wild_dynamite")');
		const s0 = await T('steps()');
		await evaluate('playing = false; animTime = ' + T0 + '; __t.row("arm").querySelector(".slotGroupApply").click(); true');
		const p1 = await played();
		ok('the clip has split-colour members too (the case an rgba key would break)', split0.length > 0, q(split0));
		ok('engine-rig plays each member at its alpha there × 40%', A.every((n) => near(p1[n][3], p0[n][3] * 0.4)), q(A.map((n) => [p0[n][3], p1[n][3]])));
		ok('and its colour unchanged', A.every((n) => [0, 1, 2].every((c) => near(p1[n][c], p0[n][c]))), q(A.map((n) => [p0[n], p1[n]])));
		ok('every other slot plays as before', names.filter((n) => !A.includes(n) && n in p0).every((n) => same(p1[n], p0[n])));
		ok('the split-colour members got no rgba key', await evaluate(`${q(split0)}.every((n) => !rawDoc.animations.wild_dynamite.slots[n].rgba)`));
		ok('the eased rgba key kept its curve', Array.isArray(await evaluate(`rawDoc.animations.wild_dynamite.slots[${q(A[0])}].rgba[0].curve`)));
		ok('the draw-order keys draw what they drew', same(await T('order("wild_dynamite")'), order0));
		ok('one undo step, slider back at 100%', (await T('steps()')) === s0 + 1 && (await evaluate('slotGroupAlpha("u:arm")')) === 1, q({ s0, s: await T('steps()') }));
	});
	return { pass, fail };
}

let code;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		console.log('slot-groups-browser mutants (each must fail a check):');
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
		console.log('slot-groups-browser — the Slots list’s own groups and their view opacity in the real Rigger (W)');
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
