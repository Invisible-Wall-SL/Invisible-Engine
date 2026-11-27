// Browser gate for the dopesheet tree, its selection shortcuts and the two snaps (owner list
// 2026-11-26: hierarchy in the timeline, key children, select by column / parents / children, snap to
// bone, snap to keyframe, |◀ ▶| on slot keys, key properties that refresh).
//
//   node tools/rigger-spike/timeline-tree-browser.mjs
//   node tools/rigger-spike/timeline-tree-browser.mjs --mutants   # every planted bug must fail a check
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's W, with real mouse input (CDP) wherever a drag or a click is the thing
// under test. Each section seeds a fresh clip on W's wick chain (wi_wick_bone_13 → 5 → 6 → 7 → 8 → 9)
// plus `wild_clock` and the slot `string_mask` (on wi_wick_bone_13):
//   - the tree: rows nest by the bone hierarchy, keyless parents get a row, a slot sits under its bone;
//     ▾ folds a row, its dots stand for the keys folded into it, and dragging one retimes them all;
//     Alt-click folds a whole branch; picking a bone opens the rows above it;
//   - Shift-click on the ruler selects the column; T the selection's columns; P / C add the keys of
//     the bone's parents / children (and their slots) at the same times;
//   - ◆ Key children keys the selected bone and every bone under it;
//   - |◀ ▶| steps through a selected slot's keys (with a bone selected too), and through slot keys
//     with nothing selected;
//   - a click on a key puts the playhead on it and selects its bone, and a double-click still
//     deletes; Properties follow a pause and a moved sequence key;
//   - snap: a dragged key lands on another row's key time, the scrubbed playhead on a key (Alt: not);
//     a bone dragged on the stage lands on another bone's tip, in Setup and in Animate (Alt, or 🧲 off:
//     not).
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
	['a keyless parent gets no row', 'for (let b = skeletonData.findBone(bn); b; b = b.parent) if (!boneRows.has(b.name))', 'for (let b = null; b; b = b.parent) if (!boneRows.has(b.name))'],
	['a folded row hides nothing', 't.hidden = !!t.parent && shownIn.has(t.parent);', 't.hidden = false;'],
	['a folded row draws only its own keys', 'if (grp && grp.some((s) => s.tid !== tid)){ track.appendChild(foldedKeyDot(tr, tid, kt, grp, dur)); return; }', 'if (false){ return; }'],
	['Alt-click folds one row only', 'for (const r of e.altKey ? keysUnder(k) : [k])', 'for (const r of [k])'],
	['picking a bone leaves its rows folded', '  if (bd) open(bd.parent);\n', ''],
	['|◀ ▶| skip a selected slot’s keys', '    lists.push(slotKeyTimes(sn));\n', ''],
	['|◀ ▶| with nothing selected skip slot keys', '...Object.keys(a.slots || {}).map((name) => ({ kind: "slot", name })),', ''],
	['a dragged key does not snap to keys', '  for (const c of keys || []) tryC(c);\n', ''],
	['the playhead does not snap to keys', 'if (tlScrubSnap && !free){', 'if (false){'],
	['Shift-click on the ruler scrubs', 'if (tlView === "dope" && (e.shiftKey || e.ctrlKey || e.metaKey)){ e.preventDefault(); selectColumnAtX(ruler, e.clientX); return; }', ''],
	['T takes the playhead’s column, not the selection’s', 'const times = dopeSel.length ? [...new Set(dopeSel.map((s) => roundN(s.time, 4)))] : [animTime];', 'const times = [animTime];'],
	['C leaves the slots out', 'desc.has(owner) || (!isBoneRow && owner === bone)', 'desc.has(owner)'],
	['P takes the slots of the parents too', 'up ? isBoneRow && up.has(owner)', 'up ? up.has(owner)'],
	['◆ Key children keys the selection only', '  for (const n of roots) for (const d of boneDescendantsOf(rawDoc, n)) names.add(d);\n', ''],
	['a click on a key leaves the playhead', '  animTime = roundN(t, 4); playing = false; $("#play").textContent = "▶ Play";\n  syncPlayhead(); markPlayheadKeys();', '  syncPlayhead(); markPlayheadKeys();'],
	['a click on a key leaves its bone unselected', '    selectTrackOwner(tr);\n', ''],
	['Properties do not follow a pause', '      syncKeyPanels();\n', ''],
	['the sequence key’s inspector loses its key when it moves', '        if (!d.duplicate) followMovedSeqKey(d.items);\n', ''],
	['a bone never snaps', 'if (boneSnap === boneSnapAlt || gizmoAxis', 'if (true || gizmoAxis'],
	['a bone snaps to origins only', '    if (b.data.length > 0.001) joints.push({ x: b.worldX + b.data.length * b.a, y: b.worldY + b.data.length * b.c, what: "tip" });\n', ''],
	['the snap solves with the parent’s matrix, not where the bone lands', 'const a = wx.x - w.x, c = wx.y - w.y, b = wy.x - w.x, d = wy.y - w.y, det = a * d - b * c;', 'const pb = bone.parent, a = pb.a, c = pb.c, b = pb.b, d = pb.d, det = a * d - b * c;'],
	['Alt does not let a Setup drag go', '      boneSnapAlt = e.altKey;\n      moveSelectedBoneByScreen', '      boneSnapAlt = false;\n      moveSelectedBoneByScreen'],
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
const browser = await launchChrome({ name: 'timeline-tree', url: URL0, args: ['--window-size=1600,1000', '--mute-audio'] });
const { evaluate, waitFor, send, pageLog } = browser;

const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => evaluate(`new Promise((d) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : d(true)); requestAnimationFrame(f); })`);
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const ALT = 1, SHIFT = 8;

// Real mouse input (CDP), in CSS px.
const mouse = (type, pt, extra = {}) => send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, pointerType: 'mouse', ...extra });
async function click(pt, { modifiers = 0, count = 1 } = {}) {
	await mouse('mouseMoved', pt, { modifiers });
	await mouse('mousePressed', pt, { button: 'left', buttons: 1, clickCount: count, modifiers });
	await mouse('mouseReleased', pt, { button: 'left', buttons: 0, clickCount: count, modifiers });
	await frames(2);
}
async function drag(from, to, { modifiers = 0, steps = 8 } = {}) {
	await mouse('mouseMoved', from, {});
	await mouse('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
	for (let i = 1; i <= steps; i++) await mouse('mouseMoved', { x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) }, { button: 'left', buttons: 1, modifiers });
	await frames(1);
	await mouse('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1, modifiers });
	await frames(2);
}

const CHAIN = ['wi_wick_bone_13', 'wi_wick_bone_5', 'wi_wick_bone_6', 'wi_wick_bone_7', 'wi_wick_bone_8', 'wi_wick_bone_9'];
// The keys every section starts from (bone → times), and the slot's.
const SEED = { wi_wick_bone_13: [0.6], wi_wick_bone_5: [0.2, 0.6], wi_wick_bone_7: [0.4, 0.6], wi_wick_bone_9: [0.6], wild_clock: [0.2, 0.53] };
const SLOT = 'string_mask', SLOT_KEYS = [0.6, 0.8];

const HELPERS = `(() => {
	const cv = document.getElementById("cv");
	window.__t = {
		seed(bones, slot, slotKeys) {
			playing = false; newAnimation(); animWorkLen[curAnim] = 1; graphSnap = false; tlSelOnly = false; tlTree = true; tlFolded.clear();
			for (const [n, ts] of Object.entries(bones)) for (const t of ts){ animTime = t; keyBone(n, { rotate: true, translate: true, scale: true, shear: true }, false); }
			for (const t of slotKeys){ animTime = t; keySlotAttachment(slot, slotAttachmentAt(slot, t) || "string_mask"); }
			selectBone(null); selSlot = null; selIk = selTc = selPath = selPc = null; dopeSel = []; dopeAnchorT = null;
			animTime = 0; syncPlayhead(); tlView = "dope"; renderTimeline();
			return curAnim;
		},
		bi(name) { return skeletonData.bones.findIndex((b) => b.name === name); },
		rows() { return timelineTracks().filter((t) => !t.hidden).map((t) => ({ kind: t.kind, name: t.name, depth: t.depth ?? null, kids: !!t.kids, folded: !!t.folded, bare: !!t.bare })); },
		boneKeys(name) { return boneKeyTimes(name); },
		slotKeys(name) { return slotKeyTimes(name); },
		sel() { return dopeSel.map((s) => (dopeTrackById[s.tid] || {}).name + "@" + s.time).sort(); },
		selectKeys(list) { dopeSel = list.map(([kind, name, t]) => ({ tid: trackId({ kind, name }), time: t })); renderTimeline(); return dopeSel.length; },
		// the dot of row (kind, name) at t: its centre on screen, and its classes
		dot(kind, name, t) {
			for (const d of document.querySelectorAll("#timeline .tl-key[data-t]")) {
				const tr = dopeTrackById[d.dataset.tid];
				if (!tr || tr.kind !== kind || tr.name !== name || Math.abs(parseFloat(d.dataset.t) - t) > 1e-4) continue;
				d.scrollIntoView({ block: "nearest", inline: "nearest" });
				const r = d.getBoundingClientRect();
				return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), cls: d.className, group: (d._group || []).length };
			}
			return null;
		},
		dotsOf(kind, name) {
			return [...document.querySelectorAll("#timeline .tl-key[data-t]")].filter((d) => { const tr = dopeTrackById[d.dataset.tid]; return tr && tr.kind === kind && tr.name === name; })
				.map((d) => ({ t: parseFloat(d.dataset.t), sum: d.classList.contains("sum"), own: d.classList.contains("own") }));
		},
		fold(key, alt) { const f = document.querySelector('#timeline .tl-fold[data-row="' + key + '"]'); if (!f) return false; f.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: !!alt })); return true; },
		// a point on the ruler at time t, dx px to its right
		ruler(t, dx) { const r = document.getElementById("tlRuler").getBoundingClientRect(); return { x: Math.round(r.left + (t / tlDur) * r.width + (dx || 0)), y: Math.round(r.top + r.height / 2) }; },
		pps() { return tlPps; },
		screen(wx, wy) {
			const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = new RIG.Vector3(wx, wy, 0);
			renderer.camera.worldToScreen(v, cv.width, cv.height);
			return { x: Math.round(r.left + v.x / dpr), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
		},
		world(name) { const b = skeleton.findBone(name); return { x: b.worldX, y: b.worldY }; },
		// A bone tip to drop \`name\` near: on the stage, away from \`name\`, with no other joint within 30px.
		tipTarget(name) {
			const r = cv.getBoundingClientRect(), own = boneDescendantsOf(rawDoc, name); own.add(name);
			const joints = [];
			for (const b of skeleton.bones){
				joints.push({ bone: b.data.name, x: b.worldX, y: b.worldY, tip: false });
				if (b.data.length > 0.001) joints.push({ bone: b.data.name, x: b.worldX + b.data.length * b.a, y: b.worldY + b.data.length * b.c, tip: true });
			}
			const from = this.screen(skeleton.findBone(name).worldX, skeleton.findBone(name).worldY);
			for (const j of joints){
				if (!j.tip || own.has(j.bone)) continue;
				const s = this.screen(j.x, j.y);
				if (s.x < r.left + 60 || s.x > r.right - 60 || s.y < r.top + 60 || s.y > r.bottom - 60) continue;
				if (Math.hypot(s.x - from.x, s.y - from.y) < 60) continue;
				if (joints.some((o) => o !== j && Math.hypot(this.screen(o.x, o.y).x - s.x, this.screen(o.x, o.y).y - s.y) < 30)) continue;
				return { bone: j.bone, x: j.x, y: j.y, at: s, from };
			}
			return null;
		},
		// Put \`name\` (Setup) where its drawn origin is 3px from another bone's tip, then snap it there.
		constrainedSnap(name) {
			const b = skeleton.findBone(name), own = boneDescendantsOf(rawDoc, name); own.add(name);
			const t = skeleton.bones.find((o) => !own.has(o.data.name) && o.data.length > 50 && !o.data.name.startsWith("wild_clock"));
			if (!t) return null;
			const tip = { x: t.worldX + t.data.length * t.a, y: t.worldY + t.data.length * t.c }, z = renderer.camera.zoom * (window.devicePixelRatio || 1);
			const aim = { x: tip.x + 3 * z, y: tip.y };
			const at = (lx, ly) => { b.x = lx; b.y = ly; skeleton.updateWorldTransform(RIG.Physics ? RIG.Physics.none : undefined); return { x: b.worldX, y: b.worldY }; };
			let lx = b.x, ly = b.y;
			for (let i = 0; i < 4; i++){ const w = at(lx, ly), wx = at(lx + 1, ly), wy = at(lx, ly + 1); const A = wx.x - w.x, C = wx.y - w.y, B = wy.x - w.x, D = wy.y - w.y, det = A * D - B * C; lx += (D * (aim.x - w.x) - B * (aim.y - w.y)) / det; ly += (A * (aim.y - w.y) - C * (aim.x - w.x)) / det; }
			gizmoAxis = null; boneSnap = true; boneSnapAlt = false;
			const s = snapBoneLocal(b, lx, ly), hit = !!boneSnapHit;
			const w = at(s.x, s.y), p = b.parent, pw = { x: p.a * s.x + p.b * s.y + p.worldX, y: p.c * s.x + p.d * s.y + p.worldY };
			skeleton.setToSetupPose(); updateWorld();
			return { target: t.data.name, hit, err: Math.hypot(w.x - tip.x, w.y - tip.y), parentErr: Math.hypot(pw.x - w.x, pw.y - w.y) };
		},
		title(id) { const d = document.querySelector("#" + id + " > div"); return d ? d.textContent : ""; },
		shown(id) { const d = document.getElementById(id); return !!d && d.style.display !== "none"; },
	};
	return true;
})()`;
const T = (expr) => evaluate(`__t.${expr}`);

async function openW() {
	// the last pass left edits: without this the tab's "leave with unsaved edits?" prompt holds the reload
	await evaluate('(typeof dirty !== "undefined" && (dirty = false), location.reload(), true)').catch(() => {});
	await wait(300);
	await waitFor('typeof skeletons !== "undefined" && skeletons.length >= 1', 30000);
	await evaluate('window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; localStorage.clear(); document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
	await evaluate(`(() => { document.getElementById("loadRigBtn").click(); const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === "W"); row.click(); return true; })()`);
	await waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
	await waitFor('!!skeleton && !!rawDoc', 15000);
	await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); fitView(); true');
	await setMode('animate');
	// room for the tree: every row on screen without scrolling the stage away
	await evaluate('(() => { const tl = document.getElementById("timeline"); tl.style.flex = "0 0 520px"; tl.style.height = "520px"; return true; })()');
	await frames(3);
	await evaluate(HELPERS);
}
const setMode = async (m) => { await evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); true`); await frames(2); };
const seed = async () => { await T(`seed(${q(SEED)}, ${q(SLOT)}, ${q(SLOT_KEYS)})`); await frames(2); };

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
	await openW();

	await step('1. the dopesheet is a tree of the bone hierarchy', async () => {
		await seed();
		const rows = await T('rows()');
		const at = (name) => rows.findIndex((r) => r.name === name && r.kind !== 'slotch');
		const r = (name) => rows[at(name)];
		ok('events and draw order stay on top', rows[0].kind === 'events' && rows[1].kind === 'draworder', q(rows.slice(0, 2)));
		ok('a keyless parent of a keyed bone has a row (wi_wick_bone_6, wi_wick_bone_8, root)', !!r('wi_wick_bone_6') && r('wi_wick_bone_6').bare && !!r('wi_wick_bone_8') && !!r('root') && r('root').depth === 0, q(rows.map((x) => x.name)));
		let nested = true;
		for (let i = 1; i < CHAIN.length; i++) {
			const p = r(CHAIN[i - 1]), c = r(CHAIN[i]);
			if (!p || !c || at(CHAIN[i]) <= at(CHAIN[i - 1]) || c.depth !== p.depth + (CHAIN[i - 1] === 'wi_wick_bone_13' ? 1 : 1)) nested = false;
		}
		ok('each bone row sits under its parent’s, one deeper', nested, q(CHAIN.map((n) => r(n) && [at(n), r(n).depth])));
		const slot = rows.find((x) => x.kind === 'slot' && x.name === SLOT);
		ok('the slot’s row sits under its bone’s', !!slot && slot.depth === r('wi_wick_bone_13').depth + 1 && rows.indexOf(slot) > at('wi_wick_bone_13') && rows.indexOf(slot) < at('wi_wick_bone_5'), q(slot));
		ok('wild_clock is on its own branch (under wild), not under the wick', at('wild_clock') >= 0 && r('wild_clock').depth === r('wi_wick_bone_13').depth, q(r('wild_clock')));
	});

	await step('2. ▾ folds a row: its dots stand for the keys folded into it', async () => {
		await seed();
		ok('wi_wick_bone_5 has a fold toggle', await T('fold("bone:wi_wick_bone_5")'));
		await frames(2);
		const names = (await T('rows()')).map((x) => x.name);
		ok('the rows under it are gone', !names.includes('wi_wick_bone_7') && !names.includes('wi_wick_bone_9') && names.includes('wi_wick_bone_5'), q(names));
		const dots = await T('dotsOf("bone", "wi_wick_bone_5")');
		const d = (t) => dots.find((x) => close(x.t, t, 1e-4));
		ok('its own key alone is a plain dot (0.2s)', !!d(0.2) && !d(0.2).sum, q(dots));
		ok('a folded key is a summary dot (0.4s, wi_wick_bone_7’s)', !!d(0.4) && d(0.4).sum && !d(0.4).own, q(dots));
		ok('its own key with folded ones is a summary dot of both (0.6s)', !!d(0.6) && d(0.6).sum && d(0.6).own && (await T('dot("bone", "wi_wick_bone_5", 0.6)')).group === 3, q(dots));
		const pps = await T('pps()');
		const from = await T('dot("bone", "wi_wick_bone_5", 0.4)');
		await drag(from, { x: from.x + Math.round(0.05 * pps), y: from.y });
		const k7 = await T('boneKeys("wi_wick_bone_7")');
		ok('dragging the summary dot retimes the folded key with it', k7.some((t) => close(t, 0.45, 2 / pps)) && !k7.some((t) => close(t, 0.4, 1e-4)), q(k7));
		const six = await T('dot("bone", "wi_wick_bone_5", 0.6)');
		await click(six, { modifiers: SHIFT });
		const sel = await T('sel()');
		ok('Shift-click on a summary dot selects every key it stands for', ['wi_wick_bone_5@0.6', 'wi_wick_bone_7@0.6', 'wi_wick_bone_9@0.6'].every((s) => sel.includes(s)), q(sel));
		await click(await T('dot("bone", "wi_wick_bone_5", 0.6)'));
		await wait(60);
		await click(await T('dot("bone", "wi_wick_bone_5", 0.6)'), { count: 2 });
		await frames(2);
		ok('double-clicking it deletes them all', !(await T('boneKeys("wi_wick_bone_9")')).length && !(await T('boneKeys("wi_wick_bone_5")')).some((t) => close(t, 0.6, 1e-4)), q(await T('boneKeys("wi_wick_bone_5")')));
	});

	await step('3. Alt-click folds a branch; picking a bone opens the rows above it', async () => {
		await seed();
		await T('fold("bone:wi_wick_bone_", true)');
		await frames(2);
		let names = (await T('rows()')).map((x) => x.name);
		ok('Alt-click on wi_wick_bone_ folds it', !names.includes('wi_wick_bone_13'), q(names));
		await T('fold("bone:wi_wick_bone_")');
		await frames(2);
		const r13 = (await T('rows()')).find((x) => x.name === 'wi_wick_bone_13');
		ok('…and every row under it: unfolding it shows wi_wick_bone_13 still folded', !!r13 && r13.folded, q(r13));
		await evaluate(`pickBone(__t.bi("wi_wick_bone_9")); true`);
		await frames(2);
		names = (await T('rows()')).map((x) => x.name);
		ok('picking wi_wick_bone_9 opens every folded row above it', names.includes('wi_wick_bone_9'), q(names));
	});

	await step('4. select by column, by T, by P (parents) and C (children)', async () => {
		await seed();
		await click(await T('ruler(0.6, 2)'), { modifiers: SHIFT });
		let sel = await T('sel()');
		const col = ['wi_wick_bone_13@0.6', 'wi_wick_bone_5@0.6', 'wi_wick_bone_7@0.6', 'wi_wick_bone_9@0.6', SLOT + '@0.6'];
		ok('Shift-click on the ruler selects the column at 0.6s', col.every((s) => sel.includes(s)) && sel.length === col.length, q(sel));
		ok('…and leaves the playhead where it was', (await evaluate('animTime')) === 0, String(await evaluate('animTime')));
		await T('selectKeys([["bone", "wi_wick_bone_5", 0.2]])');
		await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 't', code: 'KeyT', text: 't' });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT' });
		await frames(2);
		sel = await T('sel()');
		ok('T adds the keys at the selected key’s time', sel.length === 2 && sel.includes('wild_clock@0.2'), q(sel));
		const press = async (k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: 'Key' + k.toUpperCase(), text: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: 'Key' + k.toUpperCase() }); await frames(2); };
		await T('selectKeys([["bone", "wi_wick_bone_9", 0.6]])');
		await press('p');
		sel = await T('sel()');
		ok('P adds the parents’ keys at that time, up the chain — bones only', ['wi_wick_bone_9@0.6', 'wi_wick_bone_7@0.6', 'wi_wick_bone_5@0.6', 'wi_wick_bone_13@0.6'].every((s) => sel.includes(s)) && sel.length === 4, q(sel));
		await T('selectKeys([["bone", "wi_wick_bone_13", 0.6]])');
		await press('c');
		sel = await T('sel()');
		ok('C adds every key under the bone at that time, its slot’s too', ['wi_wick_bone_13@0.6', 'wi_wick_bone_5@0.6', 'wi_wick_bone_7@0.6', 'wi_wick_bone_9@0.6', SLOT + '@0.6'].every((s) => sel.includes(s)) && sel.length === 5, q(sel));
	});

	await step('5. ◆ Key children', async () => {
		await seed();
		await evaluate(`pickBone(__t.bi("wi_wick_bone_9")); animTime = 0.9; syncPlayhead(); document.getElementById("keyKidsBtn").click(); true`);
		await frames(2);
		const at = async (n) => (await T(`boneKeys(${q(n)})`)).some((t) => close(t, 0.9, 1e-4));
		const kids = ['wi_wick_bone_9', 'wi_wick_bone_10', 'wi_wick_bone_11', 'wi_wick_bone_12'];
		const got = await Promise.all(kids.map(at));
		ok('keys the bone and every bone under it', got.every(Boolean), q(Object.fromEntries(kids.map((k, i) => [k, got[i]]))));
		ok('…and not its parent', !(await at('wi_wick_bone_8')));
	});

	await step('6. |◀ ▶| step through slot keys', async () => {
		await seed();
		await evaluate(`pickBone(__t.bi("wi_wick_bone_9")); selectSlot(${q(SLOT)}); animTime = 0.6; syncPlayhead(); document.getElementById("nextKey").click(); true`);
		ok('▶| with a bone AND a slot selected reaches the slot’s key (0.8s)', close(await evaluate('animTime'), 0.8, 1e-4), String(await evaluate('animTime')));
		await evaluate('selectBone(null); selSlot = null; animTime = 0.7; syncPlayhead(); document.getElementById("nextKey").click(); true');
		ok('▶| with nothing selected stops on a slot key too', close(await evaluate('animTime'), 0.8, 1e-4), String(await evaluate('animTime')));
		await evaluate('document.getElementById("prevKey").click(); true');
		ok('|◀ steps back to 0.6s', close(await evaluate('animTime'), 0.6, 1e-4), String(await evaluate('animTime')));
	});

	await step('7. a key’s Properties: a click selects it, a double-click still deletes, a pause and a moved key refresh', async () => {
		await seed();
		await evaluate(`pickBone(__t.bi("wild_clock")); true`);
		await frames(2);
		await click(await T('dot("bone", "wi_wick_bone_7", 0.4)'));
		await wait(30); await frames(2);
		ok('a click on a key puts the playhead on it', close(await evaluate('animTime'), 0.4, 1e-4), String(await evaluate('animTime')));
		const title = await T('title("boneDetail")');
		ok('…and Properties show its bone at that key', (await evaluate('selBone')) === (await T('bi("wi_wick_bone_7")')) && title.includes('wi_wick_bone_7') && title.includes('@ 0.40s'), title);
		const nine = await T('dot("bone", "wi_wick_bone_9", 0.6)');
		await click(nine);
		await wait(60);
		await click(await T('dot("bone", "wi_wick_bone_9", 0.6)') || nine, { count: 2 });
		await frames(2);
		ok('a double-click on another bone’s key still deletes it (the first click selected that bone)', !(await T('boneKeys("wi_wick_bone_9")')).length && (await evaluate('selBone')) === (await T('bi("wi_wick_bone_9")')), q(await T('boneKeys("wi_wick_bone_9")')));
		await evaluate(`pickBone(__t.bi("wi_wick_bone_7")); animTime = 0; syncPlayhead(); renderBoneDetail(); playing = true; true`);
		await frames(12);
		await evaluate('document.getElementById("play").click(); true');
		await frames(3);
		const t = await evaluate('animTime.toFixed(2)'), t7 = await T('title("boneDetail")');
		ok('after a pause the bone’s Properties show the paused time', t !== '0.00' && t7.includes('@ ' + t + 's'), q({ t, t7 }));
		// a sequence key: W's own clip keys tntexpl-01's sequence at 1.0333s
		await evaluate('setCurAnim("wild_dynamite"); selectBone(null); selSlot = null; tlFolded.clear(); renderTimeline(); true');
		await frames(2);
		const sq = await T('dot("sequence", "tntexpl-01", 1.0333)');
		if (!ok('W keys tntexpl-01’s sequence at 1.0333s', !!sq)) return;
		await click(sq);
		await wait(30); await frames(2);
		ok('a click on the sequence key opens its inspector', (await T('shown("seqDetail")')) && (await T('title("seqDetail")')).includes('@ 1.033s'), await T('title("seqDetail")'));
		const pps = await T('pps()');
		await drag(await T('dot("sequence", "tntexpl-01", 1.0333)'), { x: sq.x + Math.round(0.1 * pps), y: sq.y });
		await frames(3);
		const moved = await evaluate('selSeqKey ? selSeqKey.time : null');
		ok('dragged, its inspector follows the key to its new time', moved != null && moved > 1.1 && (await T('shown("seqDetail")')) && (await T('title("seqDetail")')).includes('@ ' + (Math.round(moved * 1000) / 1000) + 's'), q({ moved, title: await T('title("seqDetail")') }));
	});

	await step('8. snap to keyframe: a dragged key, the scrubbed playhead', async () => {
		await seed();
		await evaluate('graphSnap = true; renderTimeline(); true');
		const pps = await T('pps()');
		const from = await T('dot("bone", "wi_wick_bone_7", 0.4)');
		await drag(from, { x: from.x + Math.round(0.13 * pps) + 3, y: from.y });
		let k7 = await T('boneKeys("wi_wick_bone_7")');
		ok('a key dropped 3px from wild_clock’s 0.53s key lands on it', k7.some((t) => close(t, 0.53, 1e-4)), q(k7));
		await seed();
		const f2 = await T('dot("bone", "wi_wick_bone_7", 0.4)');
		await drag(f2, { x: f2.x + Math.round(0.13 * pps) + 3, y: f2.y });
		k7 = await T('boneKeys("wi_wick_bone_7")');
		ok('with snap off it stays where it was dropped', !k7.some((t) => close(t, 0.53, 1e-4)) && k7.some((t) => close(t, 0.53 + 3 / pps, 2 / pps)), q(k7));
		await seed(); // no key left where the next click lands
		await evaluate('graphSnap = true; renderTimeline(); true');
		await click(await T('ruler(0.53, 3)'));
		ok('the playhead scrubbed 3px from a key lands on it', close(await evaluate('animTime'), 0.53, 1e-4), String(await evaluate('animTime')));
		await click(await T('ruler(0.53, 3)'), { modifiers: ALT });
		ok('with Alt held it does not', !close(await evaluate('animTime'), 0.53, 1e-4), String(await evaluate('animTime')));
	});

	await step('9. 🧲 snap to bone on the stage', async () => {
		const bone = 'buldge';
		await evaluate('(() => { const tl = document.getElementById("timeline"); tl.style.flex = "0 0 160px"; tl.style.height = "160px"; return true; })()');
		for (const m of ['setup', 'animate']) {
			await setMode(m);
			if (m === 'animate') await seed();
			await evaluate('fitView(); true'); await frames(3);
			await evaluate(`pickBone(__t.bi(${q(bone)})); animTime = 0.3; syncPlayhead(); true`);
			await frames(2);
			const tg = await T(`tipTarget(${q(bone)})`);
			if (!ok(`${m}: W has a bone tip on the stage to drop ${bone} on`, !!tg)) continue;
			const drop = { x: tg.at.x + 3, y: tg.at.y + 2 };
			await drag(tg.from, drop);
			await frames(2);
			let w = await T(`world(${q(bone)})`);
			ok(`${m}: dropped 3px from ${tg.bone}'s tip, its origin lands ON the tip`, close(w.x, tg.x, 0.01) && close(w.y, tg.y, 0.01), q({ w, tg }));
			await evaluate('rigUndo(); true'); await frames(2);
			await evaluate(`pickBone(__t.bi(${q(bone)})); true`); await frames(1);
			const from2 = await T(`screen(__t.world(${q(bone)}).x, __t.world(${q(bone)}).y)`);
			await drag(from2, drop, { modifiers: ALT });
			w = await T(`world(${q(bone)})`);
			ok(`${m}: with Alt held it stays off the tip`, !(close(w.x, tg.x, 0.01) && close(w.y, tg.y, 0.01)), q({ w, tg }));
			await evaluate('rigUndo(); true'); await frames(2);
			await evaluate(`document.getElementById("boneSnapBtn").click(); pickBone(__t.bi(${q(bone)})); true`); await frames(1);
			const from3 = await T(`screen(__t.world(${q(bone)}).x, __t.world(${q(bone)}).y)`);
			await drag(from3, drop);
			w = await T(`world(${q(bone)})`);
			ok(`${m}: with 🧲 Snap off it stays off the tip`, !(close(w.x, tg.x, 0.01) && close(w.y, tg.y, 0.01)), q({ w, tg }));
			await evaluate('rigUndo(); document.getElementById("boneSnapBtn").click(); true'); await frames(2);
		}
		// wild_clock3 is moved by W's transform constraint "wild_clock2" (its origin goes 1.26× as far as its
		// own x / y, plus an offset): brought within reach of a tip, the snap must put the origin ON it, which
		// the parent's matrix alone would miss
		await setMode('setup');
		const c = await T('constrainedSnap("wild_clock3")');
		ok('a bone a constraint moves still lands exactly on the tip it is snapped to', !!c && c.hit && c.err < 0.01 && c.parentErr > 1, q(c));
		await setMode('animate');
	});
	return { pass, fail };
}

let code;
try {
	if (process.argv.includes('--mutants')) {
		let caught = 0;
		console.log('timeline-tree-browser mutants (each must fail a check):');
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
		console.log('timeline-tree-browser — the dopesheet tree, select by column / parents / children, the snaps (W)');
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
