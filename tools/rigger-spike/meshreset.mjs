// Verify the mesh panel's ⟲ Back to the saved shape and ▭ Back to the image headlessly, on the
// SHIPPED code: every function the resets — and the edits they undo — reach is pulled out of
// view.html (transitively), the rebuild is the engine-rig loader, and each case edits a mesh with the
// tools an author uses (drag a vertex, ⛶ isolated drag, ＋ add, － remove, ⟁ re-triangulate, ✎ edge,
// ▸ Convert to mesh), then resets it and checks that
//  - ⟲ puts the saved geometry and weights back EXACTLY (weighted vertices remapped by bone NAME when
//    bones were deleted since), so the whole rig is the saved one again;
//  - deform keys made for the edited vertices stay when they are the same vertices, and go back to
//    the saved ones (or go) when they are not — for the mesh AND each linked mesh keyed on its own;
//    every deform key fits its attachment, and posed under the keys the mesh is where the saved rig
//    put it;
//  - ▭ gives the quad ▸ Convert to mesh made (trimmed image packed turned, scaled and rotated; a
//    sequence) whichever corner the author dragged, unweighted, with its and its linked meshes'
//    deform keys gone; the sequence and its keys stay;
//  - what is thrown away (weights, deform keys) is asked first, and nothing else is;
//  - each reset is ONE undo step whose "before" is the edited rig, and a reset whose result would
//    not load changes nothing.
// A synthetic rig always runs; the rig on the command line then has each of its meshes edited and
// put back both ways.
//   node tools/rigger-spike/meshreset.mjs <skeleton.json> <skeleton.atlas>
//   node tools/rigger-spike/meshreset.mjs --mutants   # every planted mutant must fail the gate
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = RIG;

// ---- planted mutants: each breaks ONE guarantee, and the gate must fail on every one -------------
const MUTANTS = {
	'saved weights keep the saved bone indices': [
		'if (now.has(name)) shape.vertices[ri + 1 + j * 4] = now.get(name); else gone.add(name || "#" + bi);',
		'if (!now.has(name)) gone.add(name || "#" + bi);',
	],
	'deform keys always kept': ['if (!sameMeshVertices(cur, shape)){', 'if (false){'],
	'deform keys never kept': ['if (!sameMeshVertices(cur, shape)){', 'if (true){'],
	'linked meshes forgotten': ['source it is.\nfunction meshKeyHolders(doc, at){\n  const out = [{ skin: at.skin, name: at.name }];\n  for', 'source it is.\nfunction meshKeyHolders(doc, at){\n  const out = [{ skin: at.skin, name: at.name }];\n  if (false) for'],
	'image placed by every vertex, dragged ones too': ['      if (!fits(mx, my, p)) continue;\n', ''],
	'no tie-break towards an image': [' || skew < best.skew - 1e-9 || (Math.abs(skew - best.skew) <= 1e-9 && aspect < best.aspect - 1e-9)) best =', ') best ='],
	'the image it was made from overrides the vertices': [
		'  return imagePlacement(uvs, pos, at.def.width, at.def.height, seed ? [seed] : []);',
		'  if (seed) return { ...seed, votes: 99, n: 1 };\n  return imagePlacement(uvs, pos, at.def.width, at.def.height, seed ? [seed] : []);',
	],
	'right angles judged loosely': ['const skew = cos < 1e-5 ? 0 : 1 + cos;', 'const skew = cos < 1e-3 ? 0 : 1 + cos;'],
	'no quorum: any three points place the image': ['  if (!map.seeded && map.votes < imageQuorum(map.n))\n', '  if (false)\n'],
	'the image it was made from is trusted without a quorum of its own': ['if (fit) return { ...fit, seeded: true };', 'if (fit && fit.votes >= imageQuorum(n)) return { ...fit, seeded: true };'],
	'a slot moved to another bone is not seen': ['    if (boneOf(saved) !== boneOf(doc))\n', '    if (false)\n'],
	'emptied timeline maps left behind': ['  delete bySkin[slot];\n  if (!Object.keys(bySkin).length) delete an.attachments[skin];\n  if (!Object.keys(an.attachments).length) delete an.attachments;\n', ''],
	'like scales before right angles': [
		'skew < best.skew - 1e-9 || (Math.abs(skew - best.skew) <= 1e-9 && aspect < best.aspect - 1e-9)',
		'aspect < best.aspect - 1e-9 || (Math.abs(aspect - best.aspect) <= 1e-9 && skew < best.skew - 1e-9)',
	],
	'the image it was made from is not asked': ['  const seed = was && (!was.type || was.type === "region") ? regionImageMap(was) : null;', '  const seed = null;'],
	'the saved vertices do not vote': ['  if (shape){ uvs.push(...shape.uvs); pos.push(...meshSetupLocal(at.slot, shape)); }\n', ''],
	'stale shape keys survive': [
		'def[k] = JSON.parse(JSON.stringify(plan.shape[k])); else delete def[k];',
		'def[k] = JSON.parse(JSON.stringify(plan.shape[k]));',
	],
	'not one undo step': ['  historyStep(() => {\n    applyMeshReset(rawDoc, r.at, plan);', '  ((fn) => fn())(() => {\n    applyMeshReset(rawDoc, r.at, plan);'],
	'a reset that would not load goes through': [
		'  if (problem){ showErr(what + " would leave a rig that doesn\'t load (" + problem + ") — nothing changed."); return; }\n',
		'',
	],
	'work thrown away without asking': ['if ((plan.lose || frames) && !confirm(', 'if (frames && !confirm('],
	'image reset drops the sequence': ['const MESH_SHAPE_KEYS = ["uvs", "triangles", "vertices", "hull", "edges"];', 'const MESH_SHAPE_KEYS = ["uvs", "triangles", "vertices", "hull", "edges", "sequence"];'],
};

const SELF = fileURLToPath(import.meta.url);
if (process.argv.includes('--mutants')) {
	const args = process.argv.slice(2).filter((a) => a !== '--mutants');
	const missed = [];
	for (const name of Object.keys(MUTANTS)) {
		const r = spawnSync(process.execPath, [SELF, ...args], { env: { ...process.env, MESHRESET_MUTANT: name }, encoding: 'utf8' });
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

let html = readFileSync(new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mutant = process.env.MESHRESET_MUTANT;
if (mutant) {
	const [from, to] = MUTANTS[mutant] ?? [];
	if (!from || !html.includes(from)) { console.log(`mutant "${mutant}" no longer applies — update it to the code`); process.exit(2); }
	html = html.replace(from, to);
}

// ---- pull the SHIPPED resets and edits (and everything they call) out of view.html ---------------
const TOP = new Map();
for (const m of html.matchAll(/\n(function|const) ([A-Za-z_$][\w$]*)[ (]/g)) if (!TOP.has(m[2])) TOP.set(m[2], { kind: m[1], at: m.index });
function pull(name) {
	const { kind, at } = TOP.get(name);
	const eol = html.indexOf('\n', at + 1), first = html.slice(at, eol);
	let n = 0; for (const c of first) { if (c === '{' || c === '[') n++; else if (c === '}' || c === ']') n--; }
	if (n === 0 && (kind === 'const' || first.includes('{'))) return first;
	// a multi-line const closes on its own column-0 bracket: `};` or `];`
	const close = kind === 'const' ? (first.trimEnd().endsWith('[') ? '\n];' : '\n};') : '\n}';
	return html.slice(at, html.indexOf(close, at) + close.length);
}
// The UI around an edit: the rebuild LOADS the doc with the Rigger's own attachment loader.
const STUBS = new Set(['rebuildFromRawDoc', 'selectSlot', 'renderSlotDetail', 'showNotice', 'showErr', 'refreshUndoButtons', 'redrawUVPanel', 'syncTextLocaleMeshes', 'fitMesh']);
const ENTRY = ['resetMesh', 'meshResetPlans', 'deleteBone', 'posedSetupWorlds', 'applyMeshVertexDelta', 'applyIsolatedVertexUV', 'buildMeshUVFrame', 'addMeshVertex', 'removeMeshVertex', 'retriangulateMesh', 'toggleConstraintEdge', 'convertRegionToMeshNow', 'historyReset', 'makeAttachmentLoader', 'meshWorldVerts'];
const pulled = [], seen = new Set();
for (const q = [...ENTRY]; q.length; ) {
	const name = q.shift();
	if (seen.has(name) || STUBS.has(name)) continue;
	if (!TOP.has(name)) { console.error(`✗ ${name} not found in view.html`); process.exit(2); }
	seen.add(name);
	const src = pull(name);
	pulled.push({ at: TOP.get(name).at, src });
	for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
		const t = TOP.get(m[1]);
		if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
	}
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const PAGE = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
function atlasOf(text) {
	const atlas = new TextureAtlas(text);
	for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(PAGE); } catch { p.texture = PAGE; } }
	return atlas;
}
const S = {
	RIG, console, setTimeout, clearTimeout,
	rawDoc: null, rawDocSaved: null, skeletonData: null, skeleton: null, meshCtx: null, dirty: false, animMode: false, editMode: true,
	selSlot: null, selBone: null, selIk: null, selTc: null, selPath: null, selPc: null, selMeshVert: null, edgePickFirst: null,
	meshIsolate: false, meshUVFrame: null, meshAddMode: false, meshRemoveMode: false, meshEdgeMode: false, meshHullMode: false,
	curAnim: null, animTime: 0, missingArt: [], cdtUnforced: [], rig3d: { doc: null }, controlsDoc: null, rigText: { elements: [] },
	collapsedBones: new Set(), selected: { atlas_file: 'atlas' }, assetMgr: { require: () => atlasOf(S.__atlas) },
	confirm(m) { S.__asked.push(String(m)); return true; },
	showNotice(m) { S.__notices.push(String(m)); }, showErr(m) { S.__errors.push(String(m)); },
	renderSlotDetail() {}, refreshUndoButtons() {}, redrawUVPanel() {}, syncTextLocaleMeshes() {}, fitMesh() {},
	rebuildFromRawDoc() { rebuild(); },
	selectSlot() { refreshMeshCtx(); },
	__atlas: '', __att: null, __skin: 'default', __asked: [], __notices: [], __errors: [],
};
vm.createContext(S);
// in the page's own order, so a const is declared before the next one reads it
vm.runInContext(pulled.sort((a, b) => a.at - b.at).map((p) => p.src).join('\n'), S, { filename: 'view.html#meshreset' });
const rigHist = () => vm.runInContext('rigHist', S);
const imageQuorum = (n) => vm.runInContext('imageQuorum', S)(n);

const loadData = (doc, atlasText) => new SkeletonJson(S.makeAttachmentLoader(atlasOf(atlasText))).readSkeletonData(clone(doc));
function rebuild() {
	S.missingArt = [];
	const data = loadData(S.rawDoc, S.__atlas);
	const sk = new Skeleton(data);
	sk.setSkin(data.findSkin(S.__skin) || data.findSkin('default'));
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

// ---- the author ------------------------------------------------------------------------------------
function open(doc, atlasText, slot = null, att = null, skin = 'default') {
	Object.assign(S, { rawDoc: clone(doc), rawDocSaved: clone(doc), __atlas: atlasText, selSlot: slot, __att: att, __skin: skin, selMeshVert: null, edgePickFirst: null, meshIsolate: false });
	rebuild();
	S.historyReset();
}
const select = (slot, att, skin = 'default') => { Object.assign(S, { selSlot: slot, __att: att, __skin: skin }); rebuild(); };
const act = (fn) => S.historyStep(fn); // one author action: one undo step
const planOf = (kind) => S.meshResetPlans()?.[kind];
const def = (skin = S.__skin, slot = S.selSlot, name = S.__att) => S.rawDoc.skins.find((s) => s.name === skin).attachments[slot][name];
const drag = (k, dx, dy) => act(() => S.applyMeshVertexDelta(k, dx, dy));
function isoDrag(k, dx, dy) {
	S.meshIsolate = true;
	S.meshUVFrame = S.buildMeshUVFrame();
	act(() => { const w = S.meshWorldVerts(); S.applyMeshVertexDelta(k, dx, dy); S.applyIsolatedVertexUV(k, w[k * 2] + dx, w[k * 2 + 1] + dy); });
	S.meshIsolate = false; S.meshUVFrame = null;
}
function addAtTriangle(t = 0) {
	const w = S.meshWorldVerts(), tr = def().triangles;
	const [a, b, c] = [tr[t * 3], tr[t * 3 + 1], tr[t * 3 + 2]];
	return act(() => S.addMeshVertex((w[a * 2] + w[b * 2] + w[c * 2]) / 3, (w[a * 2 + 1] + w[b * 2 + 1] + w[c * 2 + 1]) / 3));
}
/** Click ⟲ / ▭; returns what the author saw and what the undo history did. */
function reset(kind) {
	const before = JSON.stringify(S.rawDoc), past = rigHist().past.length;
	S.__asked = []; S.__notices = []; S.__errors = [];
	const plan = planOf(kind);
	S.resetMesh(kind);
	const h = rigHist();
	return {
		plan, asked: [...S.__asked], errors: [...S.__errors], changed: JSON.stringify(S.rawDoc) !== before,
		oneStep: h.past.length === past + 1 && h.past[h.past.length - 1].doc === before && !h.pending,
	};
}

// ---- reading a rig through engine-rig ---------------------------------------------------------------
function posed(doc, atlasText, skin, slot, name, anim, t) {
	const data = loadData(doc, atlasText);
	const sk = new Skeleton(data);
	sk.setSkin(data.findSkin(skin)); sk.setSlotsToSetupPose();
	const si = data.findSlot(slot).index, a = sk.getAttachment(si, name);
	sk.slots[si].setAttachment(a);
	if (anim) data.findAnimation(anim).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	sk.updateWorldTransform(Physics.none);
	const out = new Array(a.worldVerticesLength).fill(0);
	a.computeWorldVertices(sk.slots[si], 0, a.worldVerticesLength, out, 0, 2);
	return out;
}
const maxDiff = (a, b) => (a.length !== b.length ? Infinity : a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0));
// Every deform key's span within its attachment's deform length (weighted: 2 per influence).
function deformMisfits(doc, atlasText) {
	const data = loadData(doc, atlasText), out = [];
	for (const [anim, an] of Object.entries(doc.animations || {}))
		for (const [skin, bySlot] of Object.entries(an.attachments || {}))
			for (const [slot, byAtt] of Object.entries(bySlot))
				for (const [name, tl] of Object.entries(byAtt)) {
					if (!tl.deform) continue;
					const a = data.findSkin(skin).getAttachment(data.findSlot(slot).index, name);
					const len = a.bones ? (a.vertices.length / 3) * 2 : a.vertices.length;
					for (const k of tl.deform) if ((k.offset || 0) + (k.vertices || []).length > len) out.push(`${anim}/${slot}/${name}@${k.time || 0}`);
				}
	return out;
}
const loads = (doc, atlasText) => { try { loadData(doc, atlasText); return null; } catch (e) { return e.message; } };
const deformOn = (doc, slot, names) => Object.entries(doc.animations || {}).flatMap(([anim, an]) =>
	Object.entries(an.attachments || {}).flatMap(([, bySlot]) => names.filter((n) => bySlot[slot]?.[n]?.deform).map((n) => `${anim}/${n}`)));

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; return ok; };

// ---- the synthetic rig --------------------------------------------------------------------------------
// `img` is a whole 64² image; `trim` a 64² image trimmed to a 40×30 ink and packed turned; `fr1`/`fr2`
// the frames of a sequence. A weighted mesh `wm` (two bones, flat: its points are one affine map of
// its UVs) has deform keys, and a linked mesh `wm_link` keyed on its own.
const ATLAS = `synth.png
size: 256,256
format: RGBA8888
filter: Linear,Linear
repeat: none
img
  rotate: false
  xy: 0, 0
  size: 64, 64
  orig: 64, 64
  offset: 0, 0
  index: -1
trim
  rotate: true
  xy: 64, 0
  size: 40, 30
  orig: 64, 64
  offset: 10, 14
  index: -1
fr1
  rotate: false
  xy: 0, 64
  size: 48, 40
  orig: 64, 64
  offset: 8, 12
  index: -1
fr2
  rotate: false
  xy: 64, 64
  size: 48, 40
  orig: 64, 64
  offset: 8, 12
  index: -1
`;
const WM_UV = [0, 1, 0, 0, 1, 0, 1, 1, 0.5, 0.5];
// 3×3 points, each pushed off the image's flat map by its own amount
const ART_UV = [0, 1, 0, 0, 1, 0, 1, 1, 0, 0.5, 0.5, 0, 1, 0.5, 0.5, 1, 0.5, 0.5];
const ART = {
	type: 'mesh', path: 'img', uvs: ART_UV, hull: 8, width: 64, height: 64,
	triangles: [0, 4, 8, 4, 1, 8, 1, 5, 8, 5, 2, 8, 2, 6, 8, 6, 3, 8, 3, 7, 8, 7, 0, 8],
	vertices: ART_UV.flatMap((_, i) => (i % 2 ? [] : [(ART_UV[i] - 0.5) * 64 + 5 * Math.sin(7 * ART_UV[i] + 3 * ART_UV[i + 1] + i), (0.5 - ART_UV[i + 1]) * 64 + 5 * Math.cos(5 * ART_UV[i] - 4 * ART_UV[i + 1] + i)])),
};
const WM_MAP = (u, v) => { const lx = (u - 0.5) * 64 * 1.2, ly = (0.5 - v) * 64 * 0.9, r = (10 * Math.PI) / 180; return [lx * Math.cos(r) - ly * Math.sin(r) + 30, lx * Math.sin(r) + ly * Math.cos(r) + 20]; };
function synthDoc({ spare = false } = {}) {
	const bones = [{ name: 'root' }];
	if (spare) bones.push({ name: 'spare', parent: 'root', x: 3 });
	bones.push({ name: 'b1', parent: 'root', x: 20, y: 10, rotation: 30, length: 40 }, { name: 'b2', parent: 'b1', x: 40, rotation: -20, length: 40 });
	const idx = (n) => bones.findIndex((b) => b.name === n);
	const boneOnly = { skeleton: { spine: '4.2.00' }, bones: bones.map((b) => ({ ...b })), slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} };
	const sk = new Skeleton(new SkeletonJson(S.makeAttachmentLoader(atlasOf(ATLAS))).readSkeletonData(boneOnly));
	sk.setToSetupPose(); sk.updateWorldTransform(Physics.none);
	const vertices = [], W = [[0.7, 0.3], [0.4, 0.6], [0.2, 0.8], [0.5, 0.5], [0.6, 0.4]];
	for (let v = 0; v < 5; v++) {
		const [x, y] = WM_MAP(WM_UV[v * 2], WM_UV[v * 2 + 1]);
		vertices.push(2);
		for (const [j, n] of ['b1', 'b2'].entries()) { const l = sk.findBone(n).worldToLocal(new RIG.Vector2(x, y)); vertices.push(idx(n), l.x, l.y, W[v][j]); }
	}
	const wave = (n) => n.map((o, i) => (i % 3 === 0 ? o : -o));
	return {
		skeleton: { spine: '4.2.00', hash: 'synth' },
		bones,
		slots: [
			{ name: 's_quad', bone: 'b1', attachment: 'img' },
			{ name: 's_trim', bone: 'b2', attachment: 'trim' },
			{ name: 's_uni', bone: 'b1', attachment: 'img' },
			{ name: 's_seq', bone: 'root', attachment: 'fr' },
			{ name: 's_w', bone: 'root', attachment: 'wm' },
			{ name: 's_art', bone: 'root', attachment: 'art' },
		],
		skins: [{
			name: 'default',
			attachments: {
				s_quad: { img: { x: 5, y: -3, rotation: 25, scaleX: 1.5, scaleY: 0.8, width: 64, height: 64 } },
				s_trim: { trim: { x: -4, y: 6, rotation: -40, scaleX: 0.7, scaleY: 1.3, width: 64, height: 64 } },
				s_uni: { img: { x: 2, y: 1, rotation: 15, scaleX: 1.2, scaleY: 1.2, width: 64, height: 64 } },
				s_seq: { fr: { width: 64, height: 64, sequence: { count: 2, start: 1 } } },
				s_w: {
					wm: { type: 'mesh', path: 'img', uvs: WM_UV, triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4], vertices, hull: 4, edges: [0, 2, 2, 4, 4, 6, 6, 0], width: 64, height: 64 },
					wm_link: { type: 'linkedmesh', parent: 'wm', path: 'img', timelines: false, width: 64, height: 64 },
				},
				s_art: { art: ART },
			},
		}],
		animations: {
			wave: { attachments: { default: { s_w: {
				wm: { deform: [{ time: 0, vertices: wave([3, 1, 2, 4, 1, 3, 2, 2, 5, 1, 1, 2, 3, 2, 1, 4, 2, 2, 3, 1]) }, { time: 0.5, offset: 4, vertices: [6, -2, 3, 3, -4, 1] }] },
				wm_link: { deform: [{ time: 0.25, vertices: [0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 7] }] },
			} } } },
			flip: { attachments: { default: { s_seq: { fr: { sequence: [{ time: 0, mode: 'loop', delay: 0.1 }] } } } } },
		},
	};
}
const sameShape = (a, b, eps) => ['uvs', 'vertices'].every((k) => maxDiff(a[k], b[k]) <= (k === 'uvs' ? 1e-9 : eps))
	&& JSON.stringify(a.triangles) === JSON.stringify(b.triangles) && a.hull === b.hull && a.edges === undefined && b.edges === undefined;

// ---- 1. ▸ converted quads: ▭ finds the quad again, ⟲ puts the converted one back --------------------
// Where the image sits is read off what the author left of it: the image it was made from, while the
// rig is not saved since ▸ Convert; the quad as saved; or only the edited mesh, when it was saved
// after the drag too — then a dragged corner of a plain quad fits two maps as well as each other, and
// only an image scaled alike (`s_uni`) is told apart.
const SAVED_AS = {
	'not saved since ▸ Convert': () => synthDoc(),
	'saved after ▸ Convert': (converted) => clone(converted),
	'saved after the drag too': () => clone(S.rawDoc),
};
for (const slot of ['s_quad', 's_trim', 's_uni']) {
	console.log(`\n=== ${slot}: ▸ Convert to mesh, edit, reset ===`);
	open(synthDoc(), ATLAS, slot, null);
	act(() => S.convertRegionToMeshNow());
	const attName = slot === 's_trim' ? 'trim' : 'img';
	const converted = clone(S.rawDoc);
	select(slot, attName);
	const Q0 = clone(def());
	log(planOf('image').problem?.includes('already'), '▭ is off on the quad ▸ Convert just made (“already its image\'s quad”)');
	// one corner dragged, along either edge, outside ⛶
	for (const [when, savedAs] of Object.entries(SAVED_AS)) {
		if (when === 'saved after the drag too' && slot !== 's_uni') continue;
		let worst = 0, allOne = true;
		const missed = [];
		for (let k = 0; k < 4; k++) for (const along of [1, 3]) {
			open(converted, ATLAS, slot, attName);
			const w = S.meshWorldVerts(), n = (k + along) % 4;
			const dx = w[n * 2] - w[k * 2], dy = w[n * 2 + 1] - w[k * 2 + 1], L = Math.hypot(dx, dy);
			drag(k, (dx / L) * 9, (dy / L) * 9);
			S.rawDocSaved = savedAs(converted);
			const r = reset('image');
			const d = maxDiff(def().vertices, Q0.vertices);
			worst = Math.max(worst, d);
			if (!r.oneStep) allOne = false;
			if (!sameShape(def(), Q0, 1e-3)) missed.push(`corner ${k} toward ${n} (off ${d.toFixed(2)})`);
		}
		log(!missed.length && allOne, `${when}: ▭ after dragging any corner along either edge = the converted quad, one undo step (worst ${worst.toExponential(2)})${missed.length ? ' — missed ' + missed.join(', ') : ''}`);
	}
	// a corner dragged, THEN a point ＋ added into its triangle: the new point follows the drag, so the
	// dragged placement has four points to the image's three — the image it was made from, or the quad
	// as saved, must still win
	for (const when of ['not saved since ▸ Convert', 'saved after ▸ Convert']) {
		const missed = [];
		for (let k = 0; k < 3; k++) {
			open(converted, ATLAS, slot, attName);
			const w = S.meshWorldVerts(), o = (k + 2) % 4;
			drag(k, (w[o * 2] - w[k * 2]) * 0.15, (w[o * 2 + 1] - w[k * 2 + 1]) * 0.15);
			addAtTriangle(0); // triangle 0 is (0, 1, 2): it holds the dragged corner
			S.rawDocSaved = SAVED_AS[when](converted);
			reset('image');
			if (!sameShape(def(), Q0, 1e-3)) missed.push(`corner ${k} (off ${maxDiff(def().vertices, Q0.vertices).toFixed(2)})`);
		}
		log(!missed.length, `${when}: ▭ after a corner dragged and a point ＋ added into its triangle = the converted quad${missed.length ? ' — missed ' + missed.join(', ') : ''}`);
	}
	// a heavier edit: ＋ two points, ⛶ drag a hull corner (its UV re-pinned), drag an interior point,
	// ✎ an edge to a new point, ⟁ re-triangulate
	open(converted, ATLAS, slot, attName);
	addAtTriangle(0); addAtTriangle(1);
	isoDrag(2, 6, -5);
	drag(4, 4, 3);
	act(() => { S.toggleConstraintEdge(0); S.toggleConstraintEdge(5); });
	act(() => S.retriangulateMesh());
	const edited = clone(S.rawDoc);
	log(def().uvs.length === 12 && Array.isArray(def().edges), `edited: ${def().uvs.length / 2} vertices, a ✎ edge`);
	for (const when of ['not saved since ▸ Convert', 'saved after ▸ Convert']) {
		S.rawDoc = clone(edited); rebuild(); S.historyReset();
		S.rawDocSaved = SAVED_AS[when](converted);
		const ri = reset('image');
		log(sameShape(def(), Q0, 1e-3) && !ri.asked.length && ri.oneStep, `${when}: ▭ = the converted quad (off ${maxDiff(def().vertices, Q0.vertices).toExponential(2)}), no stale edges; asks nothing (no weights, no deform keys); one undo step`);
	}
	S.rawDoc = clone(edited); rebuild(); S.historyReset();
	S.rawDocSaved = clone(converted); // 💾 after converting
	const rs = reset('saved');
	log(JSON.stringify(S.rawDoc) === JSON.stringify(converted), '⟲ = the rig as saved, EXACTLY');
	log(!rs.asked.length && rs.oneStep, '⟲ asks nothing and is one undo step');
	log(planOf('saved').problem?.includes('already'), '⟲ is off once it has the saved shape');
	S.rawDocSaved = synthDoc(); // the rig as opened, before ▸ Convert
	log(/an image when last saved/.test(planOf('saved').problem || ''), '⟲ is off for a mesh that was an image when saved (says so)');
}

// ---- 1b. what the saved image can't say ------------------------------------------------------------
console.log('\n=== s_quad: the image moved, turned or scaled before ▸ Convert ===');
for (const [what, edit] of [['moved and turned', (d) => { d.x += 20; d.rotation += 15; }], ['scaled ×2', (d) => { d.scaleX *= 2; d.scaleY *= 2; }]]) {
	open(synthDoc(), ATLAS, 's_quad', null); // saved: the image where it was before
	act(() => { edit(S.rawDoc.skins[0].attachments.s_quad.img); S.markDirty(); });
	rebuild();
	act(() => S.convertRegionToMeshNow());
	const converted = clone(S.rawDoc);
	select('s_quad', 'img');
	const Q0 = clone(def());
	const missed = [];
	for (let k = 0; k < 4; k++) {
		S.rawDoc = clone(converted); rebuild(); S.historyReset();
		const w = S.meshWorldVerts(), o = (k + 2) % 4; // toward the opposite corner, off both edges
		drag(k, (w[o * 2] - w[k * 2]) * 0.15, (w[o * 2 + 1] - w[k * 2 + 1]) * 0.15);
		reset('image');
		if (!sameShape(def(), Q0, 1e-3)) missed.push(`corner ${k} (off ${maxDiff(def().vertices, Q0.vertices).toFixed(2)})`);
	}
	log(!missed.length, `${what} before ▸ Convert: ▭ follows the mesh, not the image as saved${missed.length ? ' — missed ' + missed.join(', ') : ''}`);
}
console.log("\n=== s_quad: its slot's bone deleted since the save ===");
{
	open(synthDoc(), ATLAS, 's_quad', null);
	act(() => S.convertRegionToMeshNow());
	select('s_quad', 'img');
	S.rawDocSaved = clone(S.rawDoc); // 💾 after converting
	const world0 = posed(S.rawDoc, ATLAS, 'default', 's_quad', 'img', null, 0);
	act(() => S.deleteBone('b1'));
	select('s_quad', 'img');
	const moved = S.rawDoc.slots.find((x) => x.name === 's_quad').bone;
	log(moved === 'root' && maxDiff(posed(S.rawDoc, ATLAS, 'default', 's_quad', 'img', null, 0), world0) < 1e-3, `🗑 b1 moved the slot to “${moved}”, the mesh staying where it was drawn`);
	drag(1, 5, 7);
	const ps = planOf('saved');
	log(/was on bone “b1” when saved and is on “root” now/.test(ps.problem || ''), `⟲ is off, saying the slot moved: ${JSON.stringify(ps.problem)}`);
	reset('image');
	const off = maxDiff(posed(S.rawDoc, ATLAS, 'default', 's_quad', 'img', null, 0), world0);
	log(off < 1e-3, `▭ puts the converted quad back where it was drawn, in the new bone's space (off ${off.toExponential(2)})`);
}
console.log('\n=== s_art: a hand-shaped mesh, its points off any flat image ===');
{
	open(synthDoc(), ATLAS, 's_art', 'art');
	drag(8, 4, 4);
	const pi = planOf('image');
	log(/only \d+ of its \d+ points .*agree where its image sits/.test(pi.problem || ''), `▭ is off, saying so: ${JSON.stringify(pi.problem)}`);
	log(!reset('image').changed, '…and a click changes nothing');
	log(!planOf('saved').problem, '⟲ still takes it back');
}

// ---- 2. a weighted mesh with deform keys, a linked mesh keyed on its own, a bone deleted since --------
console.log('\n=== s_w: weighted mesh, deform keys, linked mesh, a bone deleted since the save ===');
const W_SAVED = synthDoc({ spare: true }), W_NOW = synthDoc();
const openW = () => { open(W_NOW, ATLAS, 's_w', 'wm'); S.rawDocSaved = clone(W_SAVED); };
const keysOf = (doc, anim, name) => doc.animations[anim]?.attachments?.default?.s_w?.[name]?.deform;
const influences = () => { const v = def().vertices; let ri = 0, sum = 0; while (ri < v.length) { sum += v[ri]; ri += 1 + v[ri] * 4; } return sum; };
const posedW = (doc, name, anim, t) => posed(doc, ATLAS, 'default', 's_w', name, anim, t);
const sameAsNow = (label) => {
	const d = Math.max(
		maxDiff(posedW(S.rawDoc, 'wm', null, 0), posedW(W_NOW, 'wm', null, 0)),
		maxDiff(posedW(S.rawDoc, 'wm', 'wave', 0.25), posedW(W_NOW, 'wm', 'wave', 0.25)),
		maxDiff(posedW(S.rawDoc, 'wm_link', 'wave', 0.25), posedW(W_NOW, 'wm_link', 'wave', 0.25)),
	);
	return log(d < 1e-3, `${label}: posed at setup and under “wave” (mesh + linked mesh) as the saved rig (off ${d.toExponential(2)})`);
};
openW();
log(planOf('saved').problem?.includes('already'), '⟲ off right after opening: the saved weights, remapped past the deleted bone, ARE the current ones');
// 2a. only moved: a deform key made since still fits, and stays
openW();
drag(4, 6, 4); drag(1, -3, 2);
act(() => { S.rawDoc.animations.since = { attachments: { default: { s_w: { wm: { deform: [{ time: 0, vertices: new Array(influences() * 2).fill(1) }] } } } } }; S.markDirty(); });
let r = reset('saved');
log(JSON.stringify(def()) === JSON.stringify(W_NOW.skins[0].attachments.s_w.wm), '⟲ (vertices only moved) = the saved shape and weights, bone indices remapped by name');
log(!!keysOf(S.rawDoc, 'since', 'wm') && JSON.stringify(keysOf(S.rawDoc, 'wave', 'wm')) === JSON.stringify(keysOf(W_NOW, 'wave', 'wm')), '…the deform key made since stays (same vertices), “wave” untouched');
log(!r.asked.length && r.oneStep, '…nothing lost, so nothing asked; one undo step');
sameAsNow('⟲ after moving');
// 2b. a vertex added: keys made for 6 vertices go, for the mesh AND the linked mesh keyed on its own
openW();
addAtTriangle(0);
act(() => {
	const len = influences() * 2;
	S.rawDoc.animations.since2 = { attachments: { default: { s_w: { wm: { deform: [{ time: 0, vertices: new Array(len).fill(2) }] }, wm_link: { deform: [{ time: 0.1, vertices: new Array(len).fill(3) }] } } } } };
	S.markDirty();
});
r = reset('saved');
log(r.asked.length === 1 && /drops 2 deform keys made since \(in “since2”\)/.test(r.asked[0]), `⟲ asks first, naming what goes: ${JSON.stringify(r.asked[0]?.split('\n')[2])}`);
log(!keysOf(S.rawDoc, 'since2', 'wm') && !keysOf(S.rawDoc, 'since2', 'wm_link'), '…the keys made for the added vertex are gone, the linked mesh\'s own too');
log(JSON.stringify(def()) === JSON.stringify(W_NOW.skins[0].attachments.s_w.wm), '…the saved shape and weights');
const misfits = deformMisfits(S.rawDoc, ATLAS);
log(!misfits.length, `…every deform key fits its attachment${misfits.length ? ': ' + misfits.join(', ') : ''}`);
log(r.oneStep, '…one undo step');
sameAsNow('⟲ after adding');
// 2c. a vertex removed: − re-packs the deform keys for 4 vertices; ⟲ puts the saved ones back
openW();
act(() => S.removeMeshVertex(4));
log(JSON.stringify(keysOf(S.rawDoc, 'wave', 'wm')) !== JSON.stringify(keysOf(W_NOW, 'wave', 'wm')), '− re-packed “wave” for 4 vertices');
r = reset('saved');
log(r.asked.length === 1 && /back as saved/.test(r.asked[0]), '⟲ asks first (the re-packed keys are replaced by the saved ones)');
log(JSON.stringify(S.rawDoc) === JSON.stringify(W_NOW), '…the whole rig is the saved one again, EXACTLY');
sameAsNow('⟲ after removing');
// 2d. ▭ on the weighted mesh: unweighted quad where the (flat) mesh puts the image; every key goes
openW();
drag(0, 8, -8);
r = reset('image');
log(r.asked.length === 1 && /drops its weights \(2 bones\)/.test(r.asked[0]) && /drops 3 deform keys \(in “wave”\)/.test(r.asked[0]), `▭ asks first, naming what goes: ${JSON.stringify(r.asked[0]?.split('\n')[2])}`);
const quad = def();
const want = [[0, 1], [0, 0], [1, 0], [1, 1]].flatMap(([u, v]) => WM_MAP(u, v));
log(quad.vertices.length === 8 && quad.uvs.length === 8 && maxDiff(quad.vertices, want) < 1e-2, `…an unweighted 4-corner quad where the image sits (off ${maxDiff(quad.vertices, want).toExponential(2)})`);
log(!deformOn(S.rawDoc, 's_w', ['wm', 'wm_link']).length, '…no deform key left on the mesh or its linked mesh');
const empties = [];
for (const [anim, an] of Object.entries(S.rawDoc.animations)) {
	if (an.attachments && !Object.keys(an.attachments).length) empties.push(anim);
	for (const [skin, bySlot] of Object.entries(an.attachments || {})) {
		if (!Object.keys(bySlot).length) empties.push(`${anim}/${skin}`);
		for (const [slot, byAtt] of Object.entries(bySlot)) if (!Object.keys(byAtt).length) empties.push(`${anim}/${skin}/${slot}`);
	}
}
log(!empties.length, `…no emptied timeline map left behind${empties.length ? ': ' + empties.join(', ') : ''}`);
log(!loads(S.rawDoc, ATLAS) && !deformMisfits(S.rawDoc, ATLAS).length, '…the rig loads, the linked mesh on the quad');
log(r.oneStep, '…one undo step');
openW();
drag(0, 8, -8);
S.rawDocSaved = clone(S.rawDoc); // saved after the drag: only the mesh itself says where the image is
reset('image');
log(maxDiff(def().vertices, want) < 1e-2, `saved after the drag too: ▭ still finds it — right angles before like scales (off ${maxDiff(def().vertices, want).toExponential(2)})`);
// 2e. what can't be put back
openW();
S.rawDocSaved.bones.find((b) => b.name === 'b2').name = 'old_b2';
log(/deleted since: old_b2/.test(planOf('saved').problem || ''), '⟲ off when the saved weights name a bone deleted since (names it)');
openW();
S.rawDocSaved.skins[0].attachments.s_w.wm_old = S.rawDocSaved.skins[0].attachments.s_w.wm;
delete S.rawDocSaved.skins[0].attachments.s_w.wm;
log(/not in the rig as last opened or saved/.test(planOf('saved').problem || ''), '⟲ off for a mesh added or renamed since');
// 2f. a reset whose result would not load changes nothing
openW();
drag(0, 5, 5);
const real = S.rigDocLoadProblem;
S.rigDocLoadProblem = () => 'boom';
r = reset('saved');
S.rigDocLoadProblem = real;
log(!r.changed && rigHist().past.length === 1 && r.errors.some((e) => /doesn't load \(boom\)/.test(e)), 'a reset whose rig would not load changes nothing, and says so');

// ---- 3. a sequence: ▭ keeps the frames and their keys ------------------------------------------------
console.log('\n=== s_seq: a sequence ===');
open(synthDoc(), ATLAS, 's_seq', null);
act(() => S.convertRegionToMeshNow());
const seqConverted = clone(S.rawDoc);
select('s_seq', 'fr');
const SQ = clone(def());
drag(2, 7, 7);
r = reset('image');
log(sameShape(def(), SQ, 1e-3) && r.oneStep, '▭ = the converted quad over the frames\' ink, one undo step');
log(JSON.stringify(def().sequence) === JSON.stringify(SQ.sequence) && !!S.rawDoc.animations.flip.attachments.default.s_seq.fr.sequence, '…the sequence and its keys stay');
log(!loads(S.rawDoc, ATLAS) && JSON.stringify(S.rawDoc) === JSON.stringify(seqConverted), '…the rig loads, and is the converted one again');

// ---- 4. the rig on the command line: every mesh edited, then put back both ways ----------------------
const [, , jsonPath, atlasPath] = process.argv;
if (jsonPath && atlasPath) {
	const doc = JSON.parse(readFileSync(jsonPath, 'utf8')), atlasText = readFileSync(atlasPath, 'utf8');
	console.log(`\n=== ${jsonPath.split(/[\\/]/).pop()}: every mesh edited, ⟲ then ▭ ===`);
	const meshes = [];
	for (const sk of doc.skins) for (const [slot, m] of Object.entries(sk.attachments || {})) for (const [name, a] of Object.entries(m))
		if (a && a.type === 'mesh' && !a.parent && Array.isArray(a.uvs)) meshes.push({ skin: sk.name, slot, name, keyed: deformOn(doc, slot, [name]).length });
	meshes.sort((a, b) => b.keyed - a.keyed); // the keyed ones first: their deform keys must come back too
	let back = 0, image = 0, off = 0, keyed = 0, slowest = 0;
	const fails = [];
	for (const m of meshes.slice(0, 12)) {
		open(doc, atlasText, m.slot, m.name, m.skin);
		if (!S.meshCtx) { fails.push(`${m.slot}/${m.name}: not selectable`); continue; }
		const saved = JSON.stringify(S.rawDoc), hull = def().hull || 0, n0 = def().uvs.length / 2;
		drag(0, 9, -6);
		addAtTriangle(0);
		if (n0 > hull) act(() => S.removeMeshVertex(hull)); // an original interior vertex: re-packs its deform keys
		const t0 = performance.now();
		S.meshResetPlans();
		slowest = Math.max(slowest, performance.now() - t0);
		const rs = reset('saved');
		if (JSON.stringify(S.rawDoc) === saved && rs.oneStep) back++;
		else fails.push(`${m.slot}/${m.name}: ⟲ did not give the saved rig back${rs.errors.length ? ' — ' + rs.errors[0] : ''}`);
		// the mesh as saved, in its slot bone's space: what ▭ must agree with, by a majority
		const orig = S.meshSetupLocal(m.slot, def()), origUV = def().uvs.slice();
		drag(0, 9, -6);
		const holders = S.meshKeyHolders(S.rawDoc, { skin: m.skin, slot: m.slot, name: m.name });
		if (deformOn(S.rawDoc, m.slot, holders.map((h) => h.name)).length) keyed++;
		const p = planOf('image');
		if (p.problem) {
			if (/agree where its image sits/.test(p.problem) && !reset('image').changed) off++;
			else fails.push(`${m.slot}/${m.name}: ▭ off for another reason — ${p.problem}`);
			continue;
		}
		const ri = reset('image');
		const d = def(), err = loads(S.rawDoc, atlasText), mis = deformMisfits(S.rawDoc, atlasText);
		// the quad's own map (through three corners) must put a majority of the saved points where they were
		const [c0, c1, , c3] = [0, 1, 2, 3].map((i) => [d.vertices[i * 2], d.vertices[i * 2 + 1]]);
		const cu = [d.uvs[0], d.uvs[2], d.uvs[6]], cv = [d.uvs[1], d.uvs[3], d.uvs[7]];
		const mx = S.solveAffineRow(cu, cv, [c0[0], c1[0], c3[0]]), my = S.solveAffineRow(cu, cv, [c0[1], c1[1], c3[1]]);
		const diag = Math.hypot(Math.max(...orig.filter((_, i) => !(i % 2))) - Math.min(...orig.filter((_, i) => !(i % 2))), Math.max(...orig.filter((_, i) => i % 2)) - Math.min(...orig.filter((_, i) => i % 2)));
		let agree = 0;
		for (let i = 0; i < origUV.length / 2; i++)
			if (Math.hypot(mx[0] * origUV[i * 2] + mx[1] * origUV[i * 2 + 1] + mx[2] - orig[i * 2], my[0] * origUV[i * 2] + my[1] * origUV[i * 2 + 1] + my[2] - orig[i * 2 + 1]) <= Math.max(0.01, 2e-4 * diag)) agree++;
		const placed = agree >= imageQuorum(origUV.length / 2);
		if (ri.changed && ri.oneStep && !err && !mis.length && placed && d.uvs.length === 8 && d.vertices.length === 8 && !deformOn(S.rawDoc, m.slot, holders.map((h) => h.name)).length) image++;
		else fails.push(`${m.slot}/${m.name}: ▭ ${err || mis.join(', ') || ri.errors[0] || (placed ? 'left more than an unweighted quad' : `put the image where only ${agree} of ${origUV.length / 2} saved points agree`)}`);
	}
	const n = Math.min(meshes.length, 12);
	log(back === n, `⟲ gave the saved rig back EXACTLY for ${back}/${n} meshes (edited: dragged, ＋ added, − removed)`);
	log(image + off === n, `▭ on ${image}/${n}: an unweighted quad where most saved points put the image, the rig loading, no deform keys on it or its linked meshes (${keyed} were keyed); off on ${off}, whose points don't agree where the image sits`);
	for (const f of fails.slice(0, 8)) console.log('     ' + f);
	console.log(`  (both plans for one mesh, as the panel draws them: ≤ ${slowest.toFixed(1)} ms)`);
}

console.log(pass ? '\n✅ PASS — a mesh goes back to its saved shape or its image, every dependant with it.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
