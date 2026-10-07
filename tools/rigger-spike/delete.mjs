// Verify the delete cascade headlessly, on the SHIPPED code: every function the delete actions
// reach is pulled out of view.html (transitively), the rebuild is stubbed with the official
// engine-rig loader, and each delete is asserted to leave a doc that
//  - loads (SkeletonJson resolves every reference by NAME and throws on a missing one — a path
//    constraint still naming a deleted slot, a timeline or skin list naming a removed constraint),
//  - removed exactly the constraints that needed the deleted thing, TOLD the author which, and
//    let go of a removed constraint that was selected,
//  - keeps constraint `order` contiguous and every draw-order key's order (minus a deleted slot),
//  - keeps a linked mesh whose parent went showing the same art, moving the same way,
//  - keeps every WEIGHTED attachment (mesh, path, bounding box, clipping — all name bones by
//    positional INDEX) in range, non-empty and summing to 1, with deform keys one (x, y) pair per
//    influence, and leaves every vertex the deleted leaf bone did not influence exactly where it
//    was, at setup AND under a deform key.
// A synthetic rig carries one constraint of each kind (plus a skin constraint list, a weighted
// path, clipping and bounding box, linked meshes, a draw-order key, and a bone named like the
// path's target slot) and always runs; the rig on the command line then gets every bone, slot,
// path attachment and linked-mesh parent deleted in turn.
//   node tools/rigger-spike/delete.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, VertexAttachment, RegionAttachment, PointAttachment } = RIG;

const clone = (o) => JSON.parse(JSON.stringify(o));
function atlasOf(atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return atlas;
}
const loadData = (obj, atlasText) => new SkeletonJson(new AtlasAttachmentLoader(atlasOf(atlasText))).readSkeletonData(clone(obj));

// ---- pull the SHIPPED delete actions (and everything they call) out of view.html ------------
const html = readFileSync(new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url), 'utf8');
const TOP = new Map();
for (const m of html.matchAll(/\n(function|const) ([A-Za-z_$][\w$]*)[ (]/g)) if (!TOP.has(m[2])) TOP.set(m[2], { kind: m[1], at: m.index });
function pull(name) {
	const { kind, at } = TOP.get(name);
	const eol = html.indexOf('\n', at + 1), first = html.slice(at, eol);
	let n = 0; for (const c of first) { if (c === '{' || c === '[') n++; else if (c === '}' || c === ']') n--; }
	if (n === 0 && (kind === 'const' || first.includes('{'))) return first;
	const end = html.indexOf(kind === 'const' ? '\n};' : '\n}', at);
	return html.slice(at, end + (kind === 'const' ? 3 : 2));
}
// The UI around a delete: the rebuild is where the real tool would throw, so it LOADS the doc. The
// bone delete's pose (`posedSetupWorlds`) is the shipped one, on engine-rig and the rig's atlas.
const STUBS = new Set(['rebuildFromRawDoc', 'markDirty', 'selectSlot', 'showNotice', 'renderSlotDetail']);
// (`posedSetupWorlds` is handed to the bone delete, not called by name, so it is listed here.)
const ENTRY = ['deleteBone', 'deleteSlot', 'deleteAttachment', 'deleteSkin', 'deleteIkConstraint', 'deleteTransformConstraint', 'deletePathConstraint', 'deletePhysicsConstraint', 'posedSetupWorlds'];
const pulled = [], seen = new Set();
for (const q = [...ENTRY]; q.length; ) {
	const name = q.shift();
	if (seen.has(name) || STUBS.has(name)) continue;
	if (!TOP.has(name)) { console.error(`✗ ${name} not found in view.html`); process.exit(2); }
	seen.add(name);
	const src = pull(name);
	pulled.push(src);
	// a function is followed only where it is CALLED — a local named like one (`frame`) is not it
	for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
		const t = TOP.get(m[1]);
		if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
	}
}
const sandbox = {
	rawDoc: null, skeletonData: null, meshCtx: null, collapsedBones: new Set(),
	RIG, skeleton: null, missingArt: [], selected: { atlas_file: 'atlas' }, assetMgr: { require: () => atlasOf(sandbox.__atlas) },
	selBone: null, selSlot: null, selIk: null, selTc: null, selPath: null, selPc: null, animsDirty: false,
	markDirty() {}, selectSlot() {}, renderSlotDetail() {},
	showNotice(msg) { sandbox.__notices.push(String(msg)); },
	rebuildFromRawDoc() { try { loadData(sandbox.rawDoc, sandbox.__atlas); } catch (e) { sandbox.__loadError = e.message; } },
	__atlas: '', __notices: [], __loadError: null,
};
vm.createContext(sandbox);
vm.runInContext(pulled.join('\n'), sandbox, { filename: 'view.html#delete' });
// ---- one delete through the shipped UI action ----------------------------------------------
const SEL_KIND = { selIk: 'ik', selTc: 'transform', selPath: 'path', selPc: 'physics' };
function run(doc, atlasText, action, sel = {}) {
	Object.assign(sandbox, { rawDoc: clone(doc), __atlas: atlasText, __notices: [], __loadError: null, selBone: null, selSlot: null, selIk: null, selTc: null, selPath: null, selPc: null }, sel);
	action(sandbox);
	const selAfter = Object.fromEntries(Object.keys(SEL_KIND).map((k) => [k, sandbox[k]]));
	return { doc: sandbox.rawDoc, loadError: sandbox.__loadError, notices: sandbox.__notices, sel: selAfter };
}
const KINDS = ['ik', 'transform', 'path', 'physics'];
const constraintsOf = (doc) => new Set(KINDS.flatMap((k) => (doc[k] || []).map((c) => k + ' ' + c.name)));
function dropSame(doc, atlasText, removedLabels) {
	const fn = { ik: 'deleteIkConstraint', transform: 'deleteTransformConstraint', path: 'deletePathConstraint', physics: 'deletePhysicsConstraint' };
	let d = doc;
	for (const label of removedLabels) { const [k, ...n] = label.split(' '); d = run(d, atlasText, (s) => s[fn[k]](n.join(' '))).doc; }
	return d;
}

// weighted vertex attachments: [skin, slot, name, att, vertexCount]
function weightedAtts(doc) {
	const out = [];
	for (const sk of doc.skins || []) for (const [slot, m] of Object.entries(sk.attachments || {})) for (const [name, att] of Object.entries(m)) {
		if (!att || !Array.isArray(att.vertices)) continue;
		const vc = att.type === 'mesh' ? (att.uvs || []).length / 2 : ['path', 'boundingbox', 'clipping'].includes(att.type) ? att.vertexCount : 0;
		if (vc && att.vertices.length !== vc * 2) out.push([sk.name, slot, name, att, vc]);
	}
	return out;
}
function readVerts(att, vc) {
	const out = []; let ri = 0;
	for (let v = 0; v < vc; v++) { const n = att.vertices[ri++], infl = []; for (let j = 0; j < n; j++) infl.push({ bone: att.vertices[ri++], x: att.vertices[ri++], y: att.vertices[ri++], w: att.vertices[ri++] }); out.push(infl); }
	return out;
}
// World vertices of every vertex attachment, keyed skin/slot/name; `anim`@`time` applies deform.
function worldOf(doc, atlasText, anim, time) {
	const sd = loadData(doc, atlasText), sk = new Skeleton(sd), out = new Map();
	for (const skin of sd.skins) {
		sk.setSkin(skin); sk.setToSetupPose();
		if (anim) sd.findAnimation(anim).apply(sk, 0, time, false, null, 1, 0, 0);
		sk.updateWorldTransform(Physics.none);
		for (const e of skin.getAttachments()) {
			const att = e.attachment;
			if (!(att instanceof VertexAttachment)) continue;
			const slot = sk.slots[e.slotIndex];
			slot.setAttachment(att);
			if (anim) sd.findAnimation(anim).apply(sk, 0, time, false, null, 1, 0, 0);
			const w = new Array(att.worldVerticesLength).fill(0);
			att.computeWorldVertices(slot, 0, att.worldVerticesLength, w, 0, 2);
			out.set(skin.name + '/' + sd.slots[e.slotIndex].name + '/' + e.name, w);
		}
	}
	return out;
}

// Linked meshes (any mesh with a `parent`): [skin, slot, name, att, parent key].
function linkedAtts(doc) {
	const out = [];
	for (const sk of doc.skins || []) for (const [slot, m] of Object.entries(sk.attachments || {})) for (const [name, att] of Object.entries(m))
		if (att && att.parent) out.push([sk.name, slot, name, att, (att.skin || 'default') + '/' + slot + '/' + att.parent]);
	return out;
}
function drawOrderAt(doc, atlasText, anim, time) {
	const sd = loadData(doc, atlasText), sk = new Skeleton(sd);
	sk.setToSetupPose();
	sd.findAnimation(anim).apply(sk, 0, time, false, null, 1, 0, 0);
	return sk.drawOrder.map((sl) => (sl ? sl.data.name : '∅'));
}

// What the runtime draws, per skin: every active bone's world (x, y, a, b, c, d) and every
// attachment's world geometry (an image's four corners, a point's position and direction, a vertex
// attachment's vertices), keyed "skin|bone name" / "skin|slot/attachment". Setup pose, or under
// `anim`@`time` (deform keys).
function snapshot(doc, atlasText, anim, time) {
	const sd = loadData(doc, atlasText), sk = new Skeleton(sd), out = new Map();
	const pose = () => { sk.setToSetupPose(); if (anim) sd.findAnimation(anim).apply(sk, 0, time, false, null, 1, 0, 0); sk.updateWorldTransform(Physics.none); };
	for (const skin of sd.skins) {
		sk.setSkin(skin); pose();
		for (const b of sk.bones) if (b.active) out.set(`${skin.name}|${b.data.name}`, { pts: [b.worldX, b.worldY, b.a, b.b, b.c, b.d] });
		for (const e of skin.getAttachments()) {
			const slot = sk.slots[e.slotIndex], att = e.attachment;
			if (!slot.bone.active) continue;
			slot.setAttachment(att);
			if (anim) pose();
			let pts = null;
			if (att instanceof RegionAttachment) { pts = new Array(8).fill(0); att.computeWorldVertices(slot, pts, 0, 2); }
			else if (att instanceof PointAttachment) {
				const p = att.computeWorldPosition(slot.bone, { x: 0, y: 0 }), r = att.computeWorldRotation(slot.bone) * Math.PI / 180;
				pts = [p.x, p.y, p.x + 10 * Math.cos(r), p.y + 10 * Math.sin(r)];
			} else if (att instanceof VertexAttachment) { pts = new Array(att.worldVerticesLength).fill(0); att.computeWorldVertices(slot, 0, att.worldVerticesLength, pts, 0, 2); }
			if (pts) out.set(`${skin.name}|${sd.slots[e.slotIndex].name}/${e.name}`, { pts, region: att instanceof RegionAttachment, bone: slot.bone.data.name });
		}
	}
	return out;
}
// Is `M` (2×2) a turn and a uniform scale, possibly mirrored? Only then can an image, which has no
// shear of its own, be carried exactly.
const similar = ([a, b, c, d]) => { const s = Math.hypot(a, c) || 1; return (Math.abs(a - d) < 1e-6 * s && Math.abs(b + c) < 1e-6 * s) || (Math.abs(a + d) < 1e-6 * s && Math.abs(b - c) < 1e-6 * s); };
const corners = (p) => ({ cx: (p[0] + p[2] + p[4] + p[6]) / 4, cy: (p[1] + p[3] + p[5] + p[7]) / 4, area: Math.abs((p[4] - p[0]) * (p[7] - p[3]) - (p[6] - p[2]) * (p[5] - p[1])) / 2 });

let pass = true, checks = 0;
const log = (ok, msg) => { checks++; if (!ok) { console.log('  ✗ ' + msg); pass = false; } return ok; };

// Every invariant a delete must keep; `what` names the delete, `expect` the removed set (or null
// to take whatever went). Returns the resulting doc (null when it did not load).
function checkDelete(what, doc, atlasText, action, { expect = null, asked = null, leaf = null, still = null, anim = null, time = 0, sel = {}, keep = [] } = {}) {
	const before = constraintsOf(doc);
	const r = run(doc, atlasText, action, sel);
	if (!log(!r.loadError, `${what}: the rig still loads — ${r.loadError}`)) return null;
	const after = constraintsOf(r.doc);
	const removed = [...before].filter((c) => !after.has(c)).sort();
	if (expect) log(JSON.stringify(removed) === JSON.stringify([...expect].sort()), `${what}: removed [${removed}], expected [${[...expect].sort()}]`);
	const told = r.notices.join('\n');
	const cascaded = removed.filter((c) => c !== asked);
	for (const c of cascaded) log(told.includes(c), `${what}: the author is told "${c}" was removed (notices: ${JSON.stringify(r.notices)})`);
	if (!cascaded.length) log(!r.notices.length, `${what}: no notice when no constraint went (${JSON.stringify(r.notices)})`);
	for (const [k, v] of Object.entries(sel)) {
		const want = after.has(SEL_KIND[k] + ' ' + v) ? v : null;
		log(r.sel[k] === want, `${what}: ${k} is ${r.sel[k]}, expected ${want}`);
	}
	const orders = KINDS.flatMap((k) => (r.doc[k] || []).map((c) => c.order || 0)).sort((a, b) => a - b);
	log(orders.every((o, i) => o === i), `${what}: constraint order stays contiguous (${orders})`);
	const slotsAfter = new Set((r.doc.slots || []).map((sl) => sl.name));
	for (const [an, a] of Object.entries(doc.animations || {})) for (const k of a.drawOrder || []) {
		const want = drawOrderAt(doc, atlasText, an, k.time || 0).filter((n) => slotsAfter.has(n)), got = drawOrderAt(r.doc, atlasText, an, k.time || 0);
		log(JSON.stringify(got) === JSON.stringify(want), `${what}: draw order of ${an}@${k.time || 0} is [${got}], expected [${want}]`);
	}
	const entriesOf = new Map();
	for (const [skin, slot, name, att, vc] of weightedAtts(r.doc)) {
		const verts = readVerts(att, vc);
		const bad = verts.filter((infl) => !infl.length || infl.some((f) => f.bone < 0 || f.bone >= r.doc.bones.length) || Math.abs(infl.reduce((s, f) => s + f.w, 0) - 1) > 1e-4).length;
		log(bad === 0, `${what}: ${skin}/${slot}/${name} — ${bad} weighted vertices empty, out of range or not summing to 1`);
		entriesOf.set(skin + '/' + slot + '/' + name, verts.reduce((s, infl) => s + infl.length, 0));
	}
	// a linked mesh that keeps its OWN deform keys sizes them to its parent's influences
	const deformed = [...entriesOf];
	for (const [skin, slot, name, att, parentKey] of linkedAtts(r.doc)) if (att.timelines === false && entriesOf.has(parentKey)) deformed.push([skin + '/' + slot + '/' + name, entriesOf.get(parentKey)]);
	for (const [key, entries] of deformed) {
		const [skin, slot, name] = key.split('/');
		for (const an of Object.values(r.doc.animations || {})) {
			const tl = an.attachments?.[skin]?.[slot]?.[name];
			for (const fr of tl?.deform || []) log((fr.offset || 0) + (fr.vertices || []).length <= entries * 2, `${what}: ${key} deform key overruns its ${entries} influences`);
		}
	}
	for (const [key, kAnim, kTime] of keep) {
		const a = worldOf(doc, atlasText, kAnim, kTime).get(key), b = worldOf(r.doc, atlasText, kAnim, kTime).get(key);
		if (!log(!!a && !!b, `${what}: ${key} is still there`)) continue;
		const max = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
		log(a.length === b.length && max < 1e-3, `${what}: ${key} shows the same geometry under ${kAnim}@${kTime} (max ${max.toFixed(4)})`);
	}
	// A deleted bone moves NOTHING in the setup pose (or under `anim`, whose keys here are deform
	// only): every remaining bone and every attachment of every skin is where it was, compared with
	// the same rig with only the removed constraints deleted. An image on a bone whose transform
	// would shear it (it has no shear of its own) is held to its centre and area instead.
	if (still) {
		const ref = dropSame(doc, atlasText, removed);
		for (const [a, t] of anim ? [[null, 0], [anim, time]] : [[null, 0]]) {
			const want = snapshot(ref, atlasText, a, t), got = snapshot(r.doc, atlasText, a, t);
			let moved = 0, max = 0, worst = '', approx = 0;
			for (const [key, w] of want) {
				const [skin, item] = key.split('|');
				if (item === still) continue;
				const g = got.get(key);
				if (!g) { moved++; worst = key + ' is gone'; continue; }
				let d = Math.max(...w.pts.map((v, i) => Math.abs(v - g.pts[i])));
				if (w.region && w.bone === still && d > 1e-3) {
					const D = want.get(skin + '|' + still).pts, H = want.get(skin + '|' + g.bone).pts;
					const det = H[2] * H[5] - H[3] * H[4], Hi = [H[5] / det, -H[3] / det, -H[4] / det, H[2] / det];
					if (!similar([Hi[0] * D[2] + Hi[1] * D[4], Hi[0] * D[3] + Hi[1] * D[5], Hi[2] * D[2] + Hi[3] * D[4], Hi[2] * D[3] + Hi[3] * D[5]])) {
						const cw = corners(w.pts), cg = corners(g.pts);
						d = Math.max(Math.abs(cw.cx - cg.cx), Math.abs(cw.cy - cg.cy), Math.abs(cw.area - cg.area) / Math.max(cw.area, 1));
						approx++;
					}
				}
				if (g.pts.length !== w.pts.length) d = Infinity;
				if (d > max) { max = d; worst = key; }
				if (d > 1e-3) moved++;
			}
			log(moved === 0, `${what}: ${moved} bones / attachments moved${a ? ' under ' + a + '@' + t : ''} (of ${want.size}; max ${max.toFixed(4)} at ${worst || '—'}${approx ? '; ' + approx + ' sheared images held to centre + area' : ''})`);
		}
	}
	// A deleted LEAF bone moves nothing it did not influence, under an animation too: compare against
	// the same rig with only the removed constraints deleted. (The bone's own keys go with it, so what
	// it influenced may move there.)
	if (leaf) {
		const ref = dropSame(doc, atlasText, removed);
		const untouched = new Map();
		const idx = ref.bones.findIndex((b) => b.name === leaf);
		for (const [skin, slot, name, att, vc] of weightedAtts(ref)) untouched.set(skin + '/' + slot + '/' + name, readVerts(att, vc).map((infl) => !infl.some((f) => f.bone === idx)));
		for (const [skin, slot, name, , parentKey] of linkedAtts(ref)) if (untouched.has(parentKey)) untouched.set(skin + '/' + slot + '/' + name, untouched.get(parentKey));
		const a = worldOf(ref, atlasText, anim, time), b = worldOf(r.doc, atlasText, anim, time);
		let moved = 0, max = 0;
		for (const [key, keep] of untouched) {
			const wa = a.get(key), wb = b.get(key); if (!wa || !wb) continue;
			keep.forEach((k, v) => { if (!k) return; const d = Math.hypot(wa[v * 2] - wb[v * 2], wa[v * 2 + 1] - wb[v * 2 + 1]); max = Math.max(max, d); if (d > 1e-3) moved++; });
		}
		log(moved === 0, `${what}: ${moved} vertices the bone did not influence moved${anim ? ' under ' + anim + '@' + time : ''} (max ${max.toFixed(4)})`);
	}
	return r.doc;
}

// ---- (1) the synthetic rig: one constraint of every kind ------------------------------------
const SYNTH_ATLAS = 'synth.png\nsize:64,64\nfilter:Linear,Linear\nbody\nbounds:0,0,32,32\n';
const B = ['root', 'ctrl', 'hip', 'spine', 'arm', 'hand', 'jiggle', 'tail', 'tip', 'p1', 'p2', 'follow', 'curve', 'leaf'];
const bi = (n) => B.indexOf(n);
const bodyMesh = (path) => ({
	type: 'mesh', path, width: 32, height: 32, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0],
	vertices: [1, bi('spine'), 10, 10, 1, 2, bi('spine'), 20, 0, 0.5, bi('leaf'), 5, 5, 0.5, 2, bi('arm'), 0, 0, 0.7, bi('tail'), 3, 3, 0.3, 1, bi('leaf'), 0, 4, 1],
});
const DEFORM = [{ time: 0 }, { time: 1, vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }];
const SYNTH = {
	skeleton: { spine: '4.2.00' },
	bones: [
		{ name: 'root' }, { name: 'ctrl', parent: 'root', x: 100 }, { name: 'hip', parent: 'root', y: 50 },
		{ name: 'spine', parent: 'hip', y: 40, rotation: 90, length: 60 }, { name: 'arm', parent: 'spine', x: 60, length: 40 },
		{ name: 'hand', parent: 'arm', x: 40, length: 20 }, { name: 'jiggle', parent: 'spine', x: 20 },
		{ name: 'tail', parent: 'hip', x: -30, rotation: 180, length: 40 }, { name: 'tip', parent: 'tail', x: 40 },
		{ name: 'p1', parent: 'root' }, { name: 'p2', parent: 'root' }, { name: 'follow', parent: 'root' },
		{ name: 'curve', parent: 'root', x: 7 }, { name: 'leaf', parent: 'spine', x: 10, rotation: 30 },
	],
	slots: [
		{ name: 'clip', bone: 'root', attachment: 'clip' }, { name: 'body', bone: 'spine', attachment: 'body' },
		{ name: 'curve', bone: 'root', attachment: 'curve' }, { name: 'box', bone: 'root', attachment: 'box' },
	],
	ik: [{ name: 'arm_ik', order: 0, skin: true, bones: ['arm', 'hand'], target: 'ctrl' }],
	transform: [{ name: 'follow_tc', order: 1, bones: ['follow'], target: 'spine', mixRotate: 1, mixX: 1, mixScaleX: 0, mixShearY: 0 }],
	path: [{ name: 'tail_path', order: 2, skin: true, bones: ['p1', 'p2'], target: 'curve' }],
	physics: [{ name: 'jiggle_phys', order: 3, bone: 'jiggle', x: 1, rotate: 1 }],
	skins: [
		{
			name: 'default', attachments: {
				body: {
					body: bodyMesh(),
					body_de: { type: 'linkedmesh', parent: 'body', path: 'body' },
					body_own: { type: 'linkedmesh', parent: 'body', timelines: false, path: 'body' },
					body_alt_link: { type: 'linkedmesh', parent: 'body_alt', skin: 'alt', path: 'body' },
				},
				curve: { curve: { type: 'path', vertexCount: 6, lengths: [100, 200], vertices: [1, bi('hip'), 0, 0, 1, 1, bi('hip'), 10, 0, 1, 1, bi('hip'), 20, 5, 1, 1, bi('tail'), 0, 0, 1, 1, bi('tail'), 10, 10, 1, 1, bi('tail'), 20, 0, 1] } },
				clip: { clip: { type: 'clipping', end: 'body', vertexCount: 3, vertices: [1, bi('hip'), 0, 0, 1, 1, bi('tip'), 5, 0, 1, 1, bi('hip'), 0, 30, 1] } },
				box: { box: { type: 'boundingbox', vertexCount: 3, vertices: [1, bi('ctrl'), 0, 0, 1, 1, bi('follow'), 10, 0, 1, 1, bi('root'), 0, 10, 1] } },
			},
		},
		{ name: 'alt', bones: ['ctrl'], ik: ['arm_ik'], path: ['tail_path'], attachments: { body: { body_alt: bodyMesh('body') } } },
	],
	animations: {
		anim: {
			bones: { arm: { rotate: [{ time: 0 }, { time: 1, value: 30 }] }, leaf: { translate: [{ time: 0.5, x: 3 }] } },
			ik: { arm_ik: [{ time: 0, mix: 1 }, { time: 1, mix: 0.5 }] },
			transform: { follow_tc: [{ time: 0, mixRotate: 1 }] },
			path: { tail_path: { position: [{ time: 0, value: 0.2 }] } },
			physics: { jiggle_phys: { mix: [{ time: 0, value: 1 }] } },
			drawOrder: [{ time: 0.5, offsets: [{ slot: 'box', offset: -3 }] }],
			attachments: {
				default: {
					body: { body: { deform: DEFORM }, body_own: { deform: [{ time: 1, vertices: [2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11] }] } },
					curve: { curve: { deform: [{ time: 0, offset: 2, vertices: [1, 1, 2, 2] }] } },
				},
				alt: { body: { body_alt: { deform: DEFORM } } },
			},
		},
	},
};
console.log('\n=== delete cascade — synthetic rig (ik · transform · path · physics · skin lists · weighted mesh/path/clip/box · linked meshes · draw order) ===');
log(!!loadData(SYNTH, SYNTH_ATLAS), 'the synthetic rig loads before any delete');
const del = (fn, ...a) => (s) => s[fn](...a);
checkDelete('bone ctrl (IK target, in a skin bone list, weights the box)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'ctrl'), { still: 'ctrl', expect: ['ik arm_ik'] });
checkDelete('bone rig (transform target, weights the body)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'spine'), { still: 'spine', expect: ['transform follow_tc'] });
checkDelete('bone jiggle (physics bone)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'jiggle'), { still: 'jiggle', expect: ['physics jiggle_phys'] });
const afterP1 = checkDelete('bone p1 (one of two path bones)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'p1'), { still: 'p1', expect: [] });
if (afterP1) checkDelete('bone p2 (the path\'s last bone)', afterP1, SYNTH_ATLAS, del('deleteBone', 'p2'), { still: 'p2', expect: ['path tail_path'] });
checkDelete('bone curve (named like the path\'s target SLOT)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'curve'), { still: 'curve', expect: [] });
checkDelete('bone tip (weights the clipping polygon)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'tip'), { still: 'tip', expect: [] });
checkDelete('bone leaf (weights the body; one vertex only on it)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'leaf'), { still: 'leaf', expect: [] });
checkDelete('bone leaf, under the body\'s deform key', SYNTH, SYNTH_ATLAS, del('deleteBone', 'leaf'), { expect: [], leaf: 'leaf', anim: 'anim', time: 1 });
checkDelete('bone tail (weights the path and the body)', SYNTH, SYNTH_ATLAS, del('deleteBone', 'tail'), { still: 'tail', expect: [] });
checkDelete('slot curve (the path constraint\'s target)', SYNTH, SYNTH_ATLAS, del('deleteSlot', 'curve'), { expect: ['path tail_path'], sel: { selPath: 'tail_path', selIk: 'arm_ik' } });
checkDelete('slot clip (a draw-order key moves a slot across it)', SYNTH, SYNTH_ATLAS, del('deleteSlot', 'clip'), { expect: [] });
checkDelete('path attachment curve/curve', SYNTH, SYNTH_ATLAS, del('deleteAttachment', 'curve', 'curve'), { expect: ['path tail_path'] });
const noBody = checkDelete('slot body (the clipping end slot)', SYNTH, SYNTH_ATLAS, del('deleteSlot', 'body'), { expect: [] });
if (noBody) log(noBody.skins[0].attachments.clip.clip.end === 'clip', `slot body: the clipping now ends at the slot drawn before it (end "${noBody.skins[0].attachments.clip.clip.end}")`);
checkDelete('IK constraint arm_ik (in a skin list)', SYNTH, SYNTH_ATLAS, del('deleteIkConstraint', 'arm_ik'), { expect: ['ik arm_ik'], asked: 'ik arm_ik' });
checkDelete('transform constraint follow_tc', SYNTH, SYNTH_ATLAS, del('deleteTransformConstraint', 'follow_tc'), { expect: ['transform follow_tc'], asked: 'transform follow_tc' });
checkDelete('path constraint tail_path (in a skin list)', SYNTH, SYNTH_ATLAS, del('deletePathConstraint', 'tail_path'), { expect: ['path tail_path'], asked: 'path tail_path' });
checkDelete('physics constraint jiggle_phys', SYNTH, SYNTH_ATLAS, del('deletePhysicsConstraint', 'jiggle_phys'), { expect: ['physics jiggle_phys'], asked: 'physics jiggle_phys' });
checkDelete('mesh attachment body/body (parent of two linked meshes)', SYNTH, SYNTH_ATLAS, del('deleteAttachment', 'body', 'body'), { expect: [], keep: [['default/body/body_de', 'anim', 1], ['default/body/body_own', 'anim', 1]] });
checkDelete('skin alt (deform keys; parent skin of a linked mesh)', SYNTH, SYNTH_ATLAS, del('deleteSkin', 'alt'), { expect: [], keep: [['default/body/body_alt_link', 'anim', 1]] });

// ---- (1b) a bone delete keeps everything where it was ---------------------------------------
// The deleted bone's transform is composed into its dependants. Each deleted bone below has one
// child in every inherit mode (plus a grandchild), carries a slot of every attachment kind, and is
// posed by a transform constraint that survives the delete, so the pose to keep is the RUNTIME's.
//   dsim — turned, uniformly scaled and mirrored: even its image is carried exactly.
//   dgen — non-uniform scale and shear under `noRotationOrReflection`; weights on it alone, shared
//          with its heir (merged into one influence) and with its own child, all with deform keys.
//   dh   — under a sheared, non-uniformly scaled parent, so the heir's inverse is a general one.
const MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
const kids = (parent, pre) => MODES.flatMap((inherit, i) => [{ name: `${pre}_${i}`, parent, inherit, x: 12 + 5 * i, y: 7 - 3 * i, rotation: 17 * i - 20, scaleX: 1 + 0.15 * i, scaleY: 1.2 - 0.1 * i, shearX: 3 * i, shearY: -4 * i, length: 20 }]);
const CB = [
	{ name: 'root' },
	{ name: 'g', parent: 'root', x: 30, y: -20, rotation: 15, scaleX: 0.9, scaleY: 0.9 },
	{ name: 'tgt', parent: 'root', x: -50, y: 60, rotation: -30 },
	{ name: 'g_ns', parent: 'g', x: 8, y: 3, rotation: 20, scaleX: 1.2, shearX: 5, shearY: -7, inherit: 'noScale' },
	{ name: 'g_z', parent: 'g', x: -6, rotation: 10, scaleX: 0 },
	{ name: 'dz', parent: 'g', x: 9, y: 9, rotation: 50, scaleX: 0, scaleY: 0 }, { name: 'dz_c', parent: 'dz', x: 5, y: 2, rotation: 7 },
	{ name: 'dsim', parent: 'g', x: 40, y: 10, rotation: 40, scaleX: -1.5, scaleY: 1.5, length: 30 },
	...kids('dsim', 's'), { name: 's_gc', parent: 's_3', x: 10, rotation: 5 },
	{ name: 'dgen', parent: 'g', x: -20, y: 30, rotation: 25, scaleX: 1.4, scaleY: 0.7, shearX: 10, shearY: -15, inherit: 'noRotationOrReflection' },
	...kids('dgen', 'e'),
	{ name: 'h', parent: 'root', x: 5, y: 80, rotation: -20, scaleX: 1.3, scaleY: 0.6, shearX: 8 },
	{ name: 'dh', parent: 'h', x: 15, y: -5, rotation: 30, length: 25 },
	...kids('dh', 'f'),
];
const ci = (n) => CB.findIndex((b) => b.name === n);
const square = { type: 'mesh', path: 'body', width: 32, height: 32, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0], vertices: [-10, -10, 10, -10, 10, 10, -10, 10] };
const onBone = (pre) => ({
	[pre + 'img']: { [pre + 'img']: { path: 'body', x: 3, y: 4, rotation: 20, scaleX: -1.2, scaleY: 0.9, width: 32, height: 32 } },
	[pre + 'pt']: { [pre + 'pt']: { type: 'point', x: 5, y: 6, rotation: 30 } },
	[pre + 'mesh']: { [pre + 'mesh']: clone(square), [pre + 'link']: { type: 'linkedmesh', parent: pre + 'mesh', path: 'body', timelines: false } },
	[pre + 'box']: { [pre + 'box']: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 20, 0, 0, 20] } },
	[pre + 'path']: { [pre + 'path']: { type: 'path', vertexCount: 6, lengths: [30, 60], vertices: [0, 0, 5, 5, 10, 10, 20, 10, 25, 5, 30, 0] } },
	[pre + 'clip']: { [pre + 'clip']: { type: 'clipping', end: pre + 'img', vertexCount: 3, vertices: [-5, -5, 30, 0, 0, 30] } },
});
const SLOTS = ['dsim', 'dgen', 'dh'].flatMap((b) => Object.keys(onBone(b + '_')).map((name) => ({ name, bone: b, attachment: name })));
const MESH_KEYS = (pre) => ({ [pre + 'mesh']: { [pre + 'mesh']: { deform: [{ time: 1, vertices: [1, 2, 3, -1, 0, 4, -2, 1] }] }, [pre + 'link']: { deform: [{ time: 1, offset: 2, vertices: [2, 2, -1, 3] }] } } });
const COMP = {
	skeleton: { spine: '4.2.00' },
	bones: CB,
	slots: [...SLOTS, { name: 'wm', bone: 'root', attachment: 'wm' }, { name: 'dz_mesh', bone: 'dz', attachment: 'dz_mesh' }],
	// pose_tc outlives any one delete; solo_tc goes with dsim, so dsim's pose to keep is pose_tc's alone
	transform: [
		{ name: 'pose_tc', order: 0, bones: ['dsim', 'dgen', 'dh'], target: 'tgt', mixRotate: 0.5, mixX: 0.3, mixY: 0.3, mixScaleX: 0, mixScaleY: 0, mixShearY: 0, rotation: 10 },
		{ name: 'solo_tc', order: 1, bones: ['dsim'], target: 'tgt', mixRotate: 0.4, mixX: 0.2, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 },
	],
	skins: [{
		name: 'default', attachments: {
			...onBone('dsim_'), ...onBone('dgen_'), ...onBone('dh_'),
			// vertex 4 has two influences on the heir g and none on dgen: deleting dgen leaves it alone
			wm: { wm: { type: 'mesh', path: 'body', width: 32, height: 32, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5], triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
				vertices: [1, ci('dgen'), 10, 10, 1, 2, ci('dgen'), 20, 0, 0.6, ci('g'), 5, 5, 0.4, 2, ci('e_0'), 3, 3, 0.5, ci('dgen'), -4, 8, 0.5, 2, ci('g'), 0, 4, 0.3, ci('dgen'), 7, -2, 0.7, 2, ci('g'), 1, 1, 0.5, ci('g'), 6, 2, 0.5] } },
			dz_mesh: { dz_mesh: clone(square) },
		},
	}],
	animations: {
		anim: { attachments: { default: {
			...MESH_KEYS('dsim_'), ...MESH_KEYS('dgen_'), ...MESH_KEYS('dh_'),
			wm: { wm: { deform: [{ time: 1, vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, -16, -17, 18] }] } },
		} } },
	},
};
console.log('\n=== bone delete keeps the setup pose — synthetic rig (5 inherit modes · mirror · shear · constraint pose · every attachment kind · merged weights) ===');
log(!!loadData(COMP, SYNTH_ATLAS), 'the compensation rig loads before any delete');
for (const b of ['dsim', 'dgen', 'dh', 'g', 'h', 's_3', 'e_2']) checkDelete(`bone ${b}`, COMP, SYNTH_ATLAS, del('deleteBone', b), { still: b, anim: 'anim', time: 1, expect: b === 'dsim' ? ['transform solo_tc'] : null });
{
	// Under a parent that only turned and scaled, a child just turns and scales: its authored shear,
	// mirror and (for a no-scale child, whose frame turns with it) scale stay as they were.
	const r = run(COMP, SYNTH_ATLAS, del('deleteBone', 'g'));
	const bone = (n) => r.doc.bones.find((b) => b.name === n);
	const near = (b, want) => Object.entries(want).every(([k, v]) => Math.abs((b[k] ?? (k.startsWith('scale') ? 1 : 0)) - v) < 1e-4);
	log(near(bone('dsim'), { rotation: 55, scaleX: -1.35, scaleY: 1.35, shearX: 0, shearY: 0 }), `bone g: its mirrored child dsim turns by 15° and scales by 0.9, still mirrored (${JSON.stringify(bone('dsim'))})`);
	log(near(bone('g_ns'), { rotation: 35, scaleX: 1.2, scaleY: 1, shearX: 5, shearY: -7 }), `bone g: its no-scale child g_ns turns by 15°, shear and scale untouched (${JSON.stringify(bone('g_ns'))})`);
	log(near(bone('g_z'), { rotation: 25, scaleX: 0, scaleY: 0.9, shearY: 0 }), `bone g: a child at scaleX 0 still turns by 15° (the axis it hides is still its axis) (${JSON.stringify(bone('g_z'))})`);
}
{
	const r = run(COMP, SYNTH_ATLAS, del('deleteBone', 'dgen'));
	const wm = readVerts(r.doc.skins[0].attachments.wm.wm, 5);
	const g = r.doc.bones.findIndex((b) => b.name === 'g');
	log(wm[1].length === 1 && wm[1][0].bone === g && Math.abs(wm[1][0].w - 1) < 1e-9 && wm[3].length === 1 && wm[3][0].bone === g,
		`bone dgen: an influence on it joins the heir's own on that vertex rather than sitting beside it (${JSON.stringify(wm[1])})`);
	log(wm[4].length === 2, `bone dgen: a vertex it never influenced keeps both its influences on the heir (${JSON.stringify(wm[4])})`);
}
{
	// A bone scaled to nothing has flattened its dependants in the setup pose; folding that in would
	// zero their own values for good, so they move to the heir as authored instead.
	const r = run(COMP, SYNTH_ATLAS, del('deleteBone', 'dz'));
	const c = r.doc.bones.find((b) => b.name === 'dz_c');
	log(!r.loadError && c.parent === 'g' && c.x === 5 && c.y === 2 && c.rotation === 7 && !('scaleX' in c),
		`bone dz (scale 0): its child keeps its own values (${JSON.stringify(c)})`);
	log(JSON.stringify(r.doc.skins[0].attachments.dz_mesh.dz_mesh.vertices) === JSON.stringify(square.vertices),
		`bone dz (scale 0): its slot's mesh keeps its vertices (${JSON.stringify(r.doc.skins[0].attachments.dz_mesh.dz_mesh.vertices)})`);
}

// ---- (2) the given rig: every bone, slot and path attachment --------------------------------
const [, , jsonPath, atlasPath] = process.argv;
if (jsonPath && atlasPath) {
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8')), atlasText = readFileSync(atlasPath, 'utf8');
	const paths = [];
	for (const sk of raw.skins || []) for (const [slot, m] of Object.entries(sk.attachments || {})) for (const [name, att] of Object.entries(m)) if (att && att.type === 'path') paths.push([slot, name]);
	console.log(`\n=== delete cascade — ${jsonPath}: ${raw.bones.length - 1} bones, ${(raw.slots || []).length} slots, ${paths.length} path attachments, ${linkedAtts(raw).length} linked meshes ===`);
	for (const b of raw.bones.slice(1)) checkDelete(`bone ${b.name}`, raw, atlasText, del('deleteBone', b.name), { still: b.name });
	for (const s of raw.slots || []) checkDelete(`slot ${s.name}`, raw, atlasText, del('deleteSlot', s.name));
	for (const [slot, name] of paths) checkDelete(`path attachment ${slot}/${name}`, raw, atlasText, del('deleteAttachment', slot, name));
	const parentsOf = new Map(); // "slot/parent" → the children that must keep their art
	for (const [skin, slot, name, , parentKey] of linkedAtts(raw)) {
		const k = parentKey.split('/').slice(1).join('/');
		if (!parentsOf.has(k)) parentsOf.set(k, []);
		parentsOf.get(k).push([skin + '/' + slot + '/' + name, null, 0]);
	}
	for (const [k, keep] of parentsOf) { const [slot, name] = k.split('/'); checkDelete(`linked-mesh parent ${k}`, raw, atlasText, del('deleteAttachment', slot, name), { keep }); }
}

console.log(pass ? `\n✅ PASS — ${checks} checks; every delete leaves a loadable rig and says what it removed.` : `\n✗ FAIL (${checks} checks)`);
process.exit(pass ? 0 : 1);
