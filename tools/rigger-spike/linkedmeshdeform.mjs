// Verify that every mesh edit that renumbers vertices keeps the deform keys of the mesh's linked
// meshes on the vertices they were made for. A linked mesh has no vertices of its own: the keys
// under its OWN name (the ones a `timelines: false` linked mesh plays) index its source's vertices,
// so when − Remove vertex (the clean fan and its re-weave fallback), ⟁ Re-triangulate (the merge of a
// duplicate, the drop of a point outside the outline) or ⬡ promote / demote on the outline renumbers
// the source, those keys must move with the source's own. engine-rig pads or truncates a key that
// no longer fits and never throws, so a key left behind loads fine and deforms the wrong vertices.
//
// Runs on the SHIPPED code: the edits, and everything they call, are pulled out of view.html into a
// vm; the rebuild is the engine-rig loader. Each edit starts from a fresh synthetic rig: a mesh,
// unweighted and weighted (one to three influences a vertex, so a weighted key's run per vertex
// differs), with deform keys of its own; a linked mesh keyed on its own in its skin, one in another
// skin, and one that inherits the source's timelines but still carries keys of its own; and two that
// must be left alone — a linked mesh of another source on the slot, and one in another skin whose
// parent is that skin's same-named mesh. After each edit, every surviving vertex of the mesh and of
// each linked mesh, posed through engine-rig under its own keys, is where it was before the edit;
// every key fits its attachment; and the keys of the two others are untouched.
//   node tools/rigger-spike/linkedmeshdeform.mjs
//   node tools/rigger-spike/linkedmeshdeform.mjs --mutants   # every planted mutant must fail the gate
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RIG_CORE } from './rig.mjs';
import { readView, viewSandbox } from './view-sandbox.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = RIG;

// ---- planted mutants: each breaks ONE guarantee, and the gate must fail on every one -------------
const MUTANTS = {
	'linked meshes forgotten (the bug)': [
		'    if (atts) for (const [name, d] of Object.entries(atts))\n      if (isRawLinkedMeshDef(d)',
		'    if (false) for (const [name, d] of Object.entries(atts))\n      if (isRawLinkedMeshDef(d)',
	],
	"the mesh's own keys forgotten": ['const holders = [{ skin: skinName, name: meshCtx.attName }];', 'const holders = [];'],
	'linked meshes of another source moved too': ['isRawLinkedMeshDef(d) && d.parent === meshCtx.attName && ', 'isRawLinkedMeshDef(d) && '],
	"a same-named parent in another skin taken for the mesh": [' && linkedMeshParentSkin(d) === skinName) holders.push', ') holders.push'],
	"linked meshes looked for in the mesh's own skin only": [
		'  for (const sk of rawDoc.skins || []){\n    const atts = sk.attachments && sk.attachments[selSlot];\n    if (atts) for',
		'  for (const sk of (rawDoc.skins || []).filter((s) => s.name === skinName)){\n    const atts = sk.attachments && sk.attachments[selSlot];\n    if (atts) for',
	],
	'only linked meshes that play their own keys': ['isRawLinkedMeshDef(d) && d.parent === meshCtx.attName', 'isRawLinkedMeshDef(d) && d.timelines === false && d.parent === meshCtx.attName'],
	'weighted keys moved two floats a vertex': ['const weighted = !!oldN;', 'const weighted = false;'],
	'clean removal leaves the keys': ["  reorderDeform(rd, keepInv, oldN, oldM, skinName); // Phase 3.6c: align deform to k's removal\n", ''],
	're-weave fallback leaves the keys': ["  reorderDeform(rd, keep, oldN, oldM, skinName); // Phase 3.6c: align deform to k's removal\n", ''],
	'merge leaves the keys': ['  reorderDeform(rd, keep, oldN, m, skinName); // Phase 3.6c: keep deform timelines aligned\n  return { w: w2, removed };', '  return { w: w2, removed };'],
	'outside-drop leaves the keys': ['  reorderDeform(rd, keep, oldN, m, skinName); // Phase 3.6c: keep deform timelines aligned\n  return w2;', '  return w2;'],
	'promote / demote leaves the keys': ['  reorderDeform(rd, inv, oldN, m, skinName);\n', ''],
};

const SELF = fileURLToPath(import.meta.url);
if (process.argv.includes('--mutants')) {
	const missed = [];
	for (const name of Object.keys(MUTANTS)) {
		const r = spawnSync(process.execPath, [SELF], { env: { ...process.env, LINKEDMESHDEFORM_MUTANT: name }, encoding: 'utf8' });
		const why = r.stdout.split('\n').filter((l) => l.startsWith('  ✗')).slice(0, 2);
		if (r.status === 1) console.log(`  ✓ caught: ${name}\n      ${why.join('\n      ')}`);
		else {
			missed.push(name);
			console.log(`  ✗ NOT caught: ${name} (exit ${r.status})\n${r.stdout.slice(-800)}${r.stderr.slice(-600)}`);
		}
	}
	const n = Object.keys(MUTANTS).length;
	console.log(`\n${missed.length ? '✗ FAIL' : '✅ PASS'} — ${n - missed.length}/${n} mutants caught`);
	process.exit(missed.length ? 1 : 0);
}

let html = readView().html;
const mutant = process.env.LINKEDMESHDEFORM_MUTANT;
if (mutant) {
	const [from, to] = MUTANTS[mutant] ?? [];
	if (!from || !html.includes(from)) { console.log(`mutant "${mutant}" no longer applies — update it to the code`); process.exit(2); }
	html = html.replace(from, to);
}
// the page as the sandbox reads it: the shipped one, or a copy with the mutant planted
const page = mutant ? join(mkdtempSync(join(tmpdir(), 'linkedmeshdeform-')), 'view.html') : undefined;
if (page) {
	writeFileSync(page, html);
	process.on('exit', () => rmSync(dirname(page), { recursive: true, force: true }));
}

// ---- the SHIPPED edits (and everything they call), pulled out of view.html ------------------------
const ENTRY = ['removeMeshVertex', 'retriangulateMesh', 'promoteToHull', 'demoteFromHull', 'makeAttachmentLoader', 'meshWorldVerts'];

const clone = (o) => JSON.parse(JSON.stringify(o));
const ATLAS = 'page.png\nsize: 128,128\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimg\n  rotate: false\n  xy: 0, 0\n  size: 100, 100\n  orig: 100, 100\n  offset: 0, 0\n  index: -1\n';
const PAGE = { getImage: () => ({ width: 128, height: 128 }), setFilters() {}, setWraps() {}, dispose() {} };
function atlasOf() {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) { p.width = 128; p.height = 128; try { p.setTexture(PAGE); } catch { p.texture = PAGE; } }
	return atlas;
}
const S = viewSandbox({ entry: ENTRY, html: page, label: 'linkedmeshdeform', globals: {
	RIG, console,
	rawDoc: null, skeletonData: null, skeleton: null, meshCtx: null, dirty: false, editMode: true,
	selSlot: null, selBone: null, selMeshVert: null, edgePickFirst: null,
	meshAddMode: false, meshRemoveMode: false, meshEdgeMode: false, meshHullMode: false, cdtUnforced: [], missingArt: [],
	showNotice() {}, showErr(m) { S.__errors.push(String(m)); }, renderSlotDetail() {}, markDirty() { S.dirty = true; },
	rebuildFromRawDoc() { rebuild(); },
	selectSlot() { refreshMeshCtx(); },
	__att: null, __errors: [],
} });

const loadData = (doc) => new SkeletonJson(S.makeAttachmentLoader(atlasOf())).readSkeletonData(clone(doc));
function rebuild() {
	S.missingArt = [];
	const data = loadData(S.rawDoc);
	const sk = new Skeleton(data);
	sk.setSkin(data.findSkin('default'));
	sk.setSlotsToSetupPose();
	sk.setToSetupPose();
	sk.updateWorldTransform(Physics.none);
	S.skeletonData = data; S.skeleton = sk;
	refreshMeshCtx();
}
function refreshMeshCtx() {
	S.meshCtx = null;
	if (S.selSlot == null || !S.__att) return;
	const si = S.skeletonData.slots.findIndex((s) => s.name === S.selSlot);
	const att = si >= 0 ? S.skeleton.getAttachment(si, S.__att) : null;
	if (att && att.regionUVs) S.meshCtx = { slotIndex: si, attName: S.__att, attachment: att, weighted: !!(att.bones && att.bones.length) };
}
function open(doc, slot, att) {
	Object.assign(S, { rawDoc: clone(doc), selSlot: slot, __att: att, selMeshVert: null, edgePickFirst: null, __errors: [] });
	rebuild();
}

// ---- the synthetic rig --------------------------------------------------------------------------------
// Points by name: a five-point outline 0–4 with a notch at 3 (so a demoted 3 stays inside), around the
// interior points 7, 5, 6 (in that order); 7's fan is a clean disk. A case's extras sit between the two — an orphan inside
// (its fan is empty: the re-weave fallback), a point outside the outline (dropped), a duplicate of 5
// (merged; it comes first, so 5 is the one that goes) — so whatever an edit drops sits BEFORE
// vertices that survive it, and they are renumbered.
const POS = { 0: [0, 0], 1: [100, 0], 2: [100, 100], 3: [50, 70], 4: [0, 100], 5: [30, 30], 6: [70, 30], 7: [50, 50], orphan: [20, 60], outside: [50, 90], dup5: [30, 30] };
const BASE_TRIS = [0, 1, 6, 0, 6, 5, 1, 2, 6, 6, 2, 7, 7, 2, 3, 7, 3, 4, 5, 7, 4, 0, 5, 4, 5, 6, 7];
const BONES = [
	{ name: 'root' },
	{ name: 'b1', parent: 'root', x: 20, y: 10, rotation: 30, length: 40 },
	{ name: 'b2', parent: 'b1', x: 40, rotation: -20, length: 40 },
	{ name: 'b3', parent: 'root', x: -30, y: 40, rotation: 70, length: 30 },
];
const SIDE = { pts: [[0, 0], [40, 0], [0, 40]], tris: [0, 1, 2] }; // the other sources: a triangle
const uvOf = ([x, y]) => [x / 100, 1 - y / 100];
const UV = (id) => (id === 'dup5' ? [0.32, 0.69] : uvOf(POS[id]));
const SEED = { orphan: 8, outside: 9, dup5: 5 }; // a duplicate carries its twin's weights
const seedOf = (id) => SEED[id] ?? id;
const val = (i, seed) => Math.round(900 * Math.sin(i * 1.7 + seed * 3.1)) / 100;
const vals = (n, seed) => Array.from({ length: n }, (_, i) => val(i, seed));
const keysFor = (len, seed) => [
	{ time: 0, vertices: vals(len, seed) },
	{ time: 0.5, offset: 4, vertices: vals(len - 8, seed + 1) },
	{ time: 1, vertices: vals(len, seed + 2) },
];

let boneSk = null;
/** A point's weights: one to three influences (by its seed), each placing it where it is. */
function weightBlock(id) {
	if (!boneSk) {
		boneSk = new Skeleton(loadData({ skeleton: { spine: '4.2.00' }, bones: BONES, slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} }));
		boneSk.setToSetupPose(); boneSk.updateWorldTransform(Physics.none);
	}
	const names = ['b1', 'b2', 'b3'], s = seedOf(id), [x, y] = POS[id];
	const n = 1 + (s % 3), use = names.slice(s % 3).concat(names).slice(0, n);
	const raw = use.map((_, j) => 1 + ((s + j) % 4)), sum = raw.reduce((a, b) => a + b, 0);
	const block = [n];
	use.forEach((b, j) => { const l = boneSk.findBone(b).worldToLocal(new RIG.Vector2(x - 40, y - 20)); block.push(BONES.findIndex((o) => o.name === b), l.x, l.y, raw[j] / sum); });
	return block;
}
/** The rig for a case, and `at(id)`: the index of point `id` in it. */
function synthDoc(extra) {
	const ids = [0, 1, 2, 3, 4, ...extra, 7, 5, 6], at = (id) => ids.indexOf(id);
	const uvs = ids.flatMap(UV), pts = ids.map((id) => POS[id]), blocks = ids.map(weightBlock);
	const lenU = pts.length * 2, lenW = blocks.reduce((a, b) => a + 2 * b[0], 0), lenSide = SIDE.pts.length * 2;
	const mesh = (weighted) => ({ type: 'mesh', path: 'img', uvs: [...uvs], triangles: BASE_TRIS.map(at), hull: 5, width: 100, height: 100, vertices: weighted ? blocks.flat() : pts.flat() });
	const side = () => ({ type: 'mesh', path: 'img', uvs: SIDE.pts.flatMap(uvOf), triangles: [...SIDE.tris], hull: 3, width: 100, height: 100, vertices: SIDE.pts.flat() });
	const link = (parent, more) => ({ type: 'linkedmesh', parent, path: 'img', width: 100, height: 100, ...more });
	const doc = { skeleton: { spine: '4.2.00', hash: 'linkedmeshdeform' }, bones: BONES, slots: [], skins: [{ name: 'default', attachments: {} }, { name: 'alt', attachments: {} }], animations: { wave: { attachments: { default: {}, alt: {} } } } };
	const [def, alt] = doc.skins, wave = doc.animations.wave.attachments;
	for (const [slot, p, weighted, bone] of [['s_u', 'um', false, 'b1'], ['s_w', 'wm', true, 'root']]) {
		const len = weighted ? lenW : lenU;
		doc.slots.push({ name: slot, bone, attachment: p });
		def.attachments[slot] = {
			[p]: mesh(weighted),
			[p + '2']: side(),
			[p + '_link']: link(p, { timelines: false }),
			[p + '_inherit']: link(p),
			[p + '_other']: link(p + '2', { timelines: false }),
		};
		alt.attachments[slot] = {
			[p]: side(),
			[p + '_link_alt']: link(p, { timelines: false }),
			[p + '_alt']: link(p, { skin: 'alt', timelines: false }),
		};
		wave.default[slot] = {
			[p]: { deform: keysFor(len, 1) },
			[p + '_link']: { deform: keysFor(len, 2) },
			[p + '_inherit']: { deform: keysFor(len, 3) },
			[p + '_other']: { deform: keysFor(lenSide, 4) },
		};
		wave.alt[slot] = { [p + '_link_alt']: { deform: keysFor(len, 5) }, [p + '_alt']: { deform: keysFor(lenSide, 6) } };
	}
	return { doc, ids, at };
}
/** Whose keys index the edited mesh's vertices (`flip`: pose it with `timelines: false`), and whose do not. */
const holdersOf = (p) => [
	{ skin: 'default', name: p },
	{ skin: 'default', name: p + '_link' },
	{ skin: 'alt', name: p + '_link_alt' },
	{ skin: 'default', name: p + '_inherit', flip: true },
];
const othersOf = (p) => [{ skin: 'default', name: p + '_other' }, { skin: 'alt', name: p + '_alt' }];

// ---- reading a rig through engine-rig ---------------------------------------------------------------
const TIMES = [0, 0.25, 0.5, 0.75, 1];
function posed(doc, slot, h, t) {
	const d = clone(doc);
	if (h.flip) d.skins.find((s) => s.name === h.skin).attachments[slot][h.name].timelines = false;
	const data = loadData(d);
	const sk = new Skeleton(data);
	sk.setSkin(data.findSkin(h.skin)); sk.setSlotsToSetupPose();
	const si = data.findSlot(slot).index, a = sk.getAttachment(si, h.name);
	sk.slots[si].setAttachment(a);
	data.findAnimation('wave').apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	sk.updateWorldTransform(Physics.none);
	const out = new Array(a.worldVerticesLength).fill(0);
	a.computeWorldVertices(sk.slots[si], 0, a.worldVerticesLength, out, 0, 2);
	return out;
}
// Every deform key's span within its attachment's deform length (weighted: 2 per influence).
function deformMisfits(doc) {
	const data = loadData(doc), out = [];
	for (const [anim, an] of Object.entries(doc.animations || {}))
		for (const [skin, bySlot] of Object.entries(an.attachments || {}))
			for (const [slot, byAtt] of Object.entries(bySlot))
				for (const [name, tl] of Object.entries(byAtt)) {
					if (!tl.deform) continue;
					const a = data.findSkin(skin).getAttachment(data.findSlot(slot).index, name);
					const len = a.bones ? (a.vertices.length / 3) * 2 : a.vertices.length;
					for (const k of tl.deform) if ((k.offset || 0) + (k.vertices || []).length > len) out.push(`${anim}/${skin}/${slot}/${name}@${k.time || 0} (${(k.offset || 0) + (k.vertices || []).length} of ${len})`);
				}
	return out;
}
const keysOf = (doc, slot, h) => doc.animations.wave.attachments[h.skin][slot][h.name].deform;
const meshOf = (doc, slot, name) => doc.skins.find((s) => s.name === 'default').attachments[slot][name];
/** newToOld[i] = the vertex that new vertex i was (by its UV, unique per vertex), or -1. */
function survivors(before, after) {
	const key = (uvs, i) => uvs[i * 2] + ',' + uvs[i * 2 + 1];
	const old = new Map();
	for (let i = 0; i < before.uvs.length / 2; i++) old.set(key(before.uvs, i), i);
	return Array.from({ length: after.uvs.length / 2 }, (_, i) => old.get(key(after.uvs, i)) ?? -1);
}
/** The point ids an edit dropped, as text. */
const lostIds = (ids, map) => ids.filter((_, i) => !map.includes(i)).join(',');

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; return ok; };

// ---- the edits ----------------------------------------------------------------------------------------
// `lost`: the points the edit drops; `renumbered`: what must hold of the survivors' new places.
const shifted = (map) => map.some((o, i) => o !== i);
const CASES = [
	{ label: '− Remove vertex 7 (a clean fan)', extra: [], run: (at) => S.removeMeshVertex(at(7)), lost: '7', renumbered: shifted },
	{ label: '− Remove an orphan (the re-weave fallback; a point outside dropped too)', extra: ['orphan', 'outside'], run: (at) => S.removeMeshVertex(at('orphan')), lost: 'orphan,outside', renumbered: shifted },
	{
		label: '⟁ Re-triangulate (a duplicate of 5 merged; a point outside dropped)', extra: ['dup5', 'outside'], run: () => S.retriangulateMesh(), lost: 'outside,5',
		renumbered: (map) => shifted(map) && S.__errors.some((e) => /Merged 1 duplicate/.test(e) && /Ignored 1 point/.test(e)),
	},
	{ label: '⬡ Promote 6 onto the outline', extra: [], run: (at) => S.promoteToHull(at(6)), lost: '', renumbered: (map, at, a, b) => a.hull === b.hull + 1 && map.indexOf(at(6)) < a.hull },
	{ label: '⬡ Demote 3 (the notch) off the outline', extra: [], run: (at) => S.demoteFromHull(at(3)), lost: '', renumbered: (map, at, a, b) => a.hull === b.hull - 1 && map.indexOf(at(3)) >= a.hull },
];

for (const [slot, p, kind] of [['s_u', 'um', 'unweighted'], ['s_w', 'wm', 'weighted']]) {
	console.log(`\n=== ${kind} mesh ${p}, its linked meshes keyed on their own ===`);
	for (const c of CASES) {
		const { doc, ids, at } = synthDoc(c.extra);
		const loadErr = (() => { try { loadData(doc); return null; } catch (e) { return e.message; } })();
		const misBefore = loadErr ? [] : deformMisfits(doc);
		if (!log(!loadErr && !misBefore.length, `${c.label}: the rig before loads, every key fits${loadErr ? ' — ' + loadErr : misBefore.length ? ' — ' + misBefore.slice(0, 3).join(', ') : ''}`)) continue;
		open(doc, slot, p);
		if (!log(!!S.meshCtx && S.meshCtx.weighted === (kind === 'weighted'), `${c.label}: ${p} is the ${kind} mesh on stage`)) continue;
		c.run(at);
		const after = clone(S.rawDoc);
		const b = meshOf(doc, slot, p), a = meshOf(after, slot, p), map = survivors(b, a);
		log(lostIds(ids, map) === c.lost && c.renumbered(map, at, a, b) && !map.includes(-1), `${c.label}: renumbered as the edit does (${b.uvs.length / 2} → ${a.uvs.length / 2} vertices, outline ${b.hull} → ${a.hull})`);
		const err = (() => { try { loadData(after); return null; } catch (e) { return e.message; } })();
		const mis = err ? [] : deformMisfits(after);
		log(!err && !mis.length, `${c.label}: the rig loads, every deform key fits its attachment${err ? ' — ' + err : mis.length ? ' — ' + mis.slice(0, 3).join(', ') : ''}`);
		if (err) continue;
		for (const h of holdersOf(p)) {
			let worst = 0;
			for (const t of TIMES) {
				const pb = posed(doc, slot, h, t), pa = posed(after, slot, h, t);
				map.forEach((o, i) => { worst = Math.max(worst, Math.hypot(pa[i * 2] - pb[o * 2], pa[i * 2 + 1] - pb[o * 2 + 1])); });
			}
			const what = h.name === p ? 'the mesh' : h.flip ? `${h.name} (inherits; its own keys)` : `${h.name} (${h.skin})`;
			log(worst <= 1e-3, `${c.label}: ${what} posed under its own keys = before, every surviving vertex (worst ${worst.toExponential(2)})`);
		}
		const moved = othersOf(p).filter((h) => JSON.stringify(keysOf(after, slot, h)) !== JSON.stringify(keysOf(doc, slot, h)));
		log(!moved.length, `${c.label}: keys of another source's linked mesh untouched${moved.length ? ' — moved ' + moved.map((h) => `${h.name} (${h.skin})`).join(', ') : ''}`);
	}
}

console.log(pass ? "\n✅ PASS — a renumbering edit moves the deform keys of the mesh and of its linked meshes together." : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
