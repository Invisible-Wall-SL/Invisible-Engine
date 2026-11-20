// Mesh-shape (deform) keys spike — prove the Rigger keys a mesh's shape where engine-rig reads it,
// and poses it in Animate exactly as engine-rig plays it.
//   node tools/rigger-spike/deform-keys.mjs
//   node tools/rigger-spike/deform-keys.mjs --mutants   # every planted bug must fail a check
//
// Runs the SHIPPED code out of view.html — `poseAtTime` (bones, slot keys, then shapes), the shape
// block (`poseDeforms`, `dragDeformVertex`, `keyDeform`, `deformTarget`, …) and the dopesheet's
// deform writers — against engine-rig playing the same document, on the repo's W (the unweighted
// `wild_exp_w`, the weighted `wild_dynamite`: one offset per INFLUENCE) and S (linked meshes).
//
// The regression it guards (owner report 2026-11-20 — "no way to keyframe the shapes … strange
// results"): Animate previewed a shape by writing it INTO the attachment's setup `vertices`, and
// only for the selected mesh. A mesh you were not on froze at whatever shape it last showed, Setup
// mode inherited the animated shape as its setup (handles and edits off by the deform), before its
// first key a mesh showed that key's shape where the game shows setup, a linked mesh's keys went
// under its own name (the game plays its source's) and keying on a skin forked the mesh into it.
//
//   1. DRAG     a vertex drag under a posed bone moves exactly that vertex by the world delta, keys
//               the shape at the playhead (per vertex / per influence, only the dragged vertex's
//               entries) and never touches the setup `vertices`.
//   2. PLAY     two keys per mesh, both meshes keyed: poseAtTime matches engine-rig on every vertex
//               at every sampled time, whichever mesh is selected (the selection is not read).
//   3. FIRST    before a mesh's first key both show its setup shape.
//   4. CURVES   stepped and eased keys play as engine-rig plays them; re-keying an eased key keeps
//               its easing.
//   5. EDITS    ◆ (the shape on stage), delete, Alt-duplicate and retime — and the doc still plays
//               as engine-rig plays it.
//   6. SAVE     the document as saved (JSON) reloads into engine-rig and into the Rigger the same.
//   7. LINKED   a linked mesh that inherits deform is keyed on its source; one that does not
//               (`timelines: false`) on itself — engine-rig plays both.
//   8. SKIN     with another skin active, a mesh only the default skin has is keyed under default.
//   9. SETUP    `setToSetupPose` (Setup mode) shows the setup shape again.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const RIGMOD = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = RIGMOD;

const ROOT = new URL('../../', import.meta.url);
const html = readFileSync(new URL('apps/launcher-api/static/rigger/view.html', ROOT), 'utf8');
const rigFile = (dir, name) => new URL(`apps/lines/static/assets/spines/${dir}/${name}`, ROOT);
const RIGS = {
	W: { json: readFileSync(rigFile('symbols3', 'W.json'), 'utf8'), atlas: readFileSync(rigFile('symbols3', 'symbols3.atlas'), 'utf8') },
	S: { json: readFileSync(rigFile('symbols2', 'S.json'), 'utf8'), atlas: readFileSync(rigFile('symbols2', 'symbols2.atlas'), 'utf8') },
};

// ---- the SHIPPED code, out of view.html ---------------------------------------------------
const balanced = (s) => {
	let n = 0;
	for (const c of s) {
		if (c === '{') n++;
		else if (c === '}') n--;
	}
	return n === 0;
};
// A top-level declaration is either wholly on one line or closed by `}` / `};` at column 0.
function pull(src, head, close) {
	const i = src.indexOf('\n' + head);
	if (i < 0) throw new Error(`"${head}" not found in view.html — the markers moved`);
	const first = src.slice(i, src.indexOf('\n', i + 1));
	if (balanced(first) && first.includes(head.endsWith('(') ? '{' : '=')) return first;
	return src.slice(i, src.indexOf(close, i) + close.length);
}
const CONSTS = ['animOf', 'roundN', 'activeSkinName', 'isVertexAtt', 'isWeightedAtt', 'hexToRGBA', 'TC_MIXES', 'PC_MIXES', 'PC_SIM', 'PC_VAL_CHANS', 'BONE_AXIS_TIMELINES'];
const FNS = [
	'isMeshAtt', 'invWorldVec', 'bezierValue', 'sampleChannel', 'sampleColor', 'sampleColor2', 'hexToRGB',
	'drawOrderOfOffsets', 'reconstructDrawOrder', 'poseAtTime', 'upsertKey', 'slotChannel', 'slotAttachmentAt',
	'deformLength', 'deformOffsetsOf', 'setDeformOffsets', 'deformTarget', 'deformKeysAt', 'keyDeform',
	'slotDeformKeys', 'deleteDeformKeyOfSlot', 'dragDeformVertex', 'poseDeforms', 'sampleDeform',
	'deformArrForTrack', 'setDeformKeyCurve', 'deleteDeformKeyAt', 'retimeDeformKey', 'dupKeyInArr',
];
const shippedOf = (src) =>
	[
		...CONSTS.map((n) => pull(src, `const ${n} = `, '\n};')),
		...FNS.map((n) => pull(src, `function ${n}(`, '\n}')),
		`Object.assign(globalThis, { ${CONSTS.join(', ')} });`,
	].join('\n');

// ---- engine-rig ----------------------------------------------------------------------------
function loadData(rig, doc) {
	const atlas = new TextureAtlas(RIGS[rig].atlas);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) {
		p.width = 2048;
		p.height = 2048;
		try { p.setTexture(stub); } catch { p.texture = stub; }
	}
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(JSON.stringify(doc)));
}
const worldOf = (sk, slotName) => {
	const slot = sk.findSlot(slotName), att = slot.attachment;
	const out = new Array(att.worldVerticesLength).fill(0);
	att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
	return out;
};
/** engine-rig: the saved document, clip `anim` at time t, as the game poses it. */
function engineAt(rig, doc, anim, t, skinName) {
	const sk = new Skeleton(loadData(rig, doc));
	if (skinName) sk.setSkinByName(skinName);
	sk.setToSetupPose();
	sk.data.findAnimation(anim).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	sk.updateWorldTransform(Physics.none);
	return sk;
}
const maxDiff = (a, b) => (a.length !== b.length ? Infinity : a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0));

// ---- one run of every check over (possibly mutated) shipped code -----------------------------
function run(src, quiet) {
	let pass = 0, fail = 0;
	const ok = (name, cond, detail) => {
		if (cond) pass++;
		else fail++;
		if (!quiet) console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`);
	};
	const head = (t) => { if (!quiet) console.log(`\n${t}`); };

	const sb = {
		RIG: RIGMOD, rawDoc: null, skeleton: null, skeletonData: null, meshCtx: null, selSlot: null,
		animMode: true, curAnim: null, animTime: 0, animsDirty: false,
		ensureCurAnim: () => sb.curAnim, markDirty() {}, refreshAnimCounts() {},
		$: () => ({ textContent: '' }),
	};
	vm.createContext(sb);
	vm.runInContext(shippedOf(src), sb, { filename: 'view.html#deform-keys' });

	/** Open `rig` in the sandbox the way the page holds it: the doc, its skeleton, a clip. */
	function open(rig, edit) {
		const doc = JSON.parse(RIGS[rig].json);
		if (edit) edit(doc);
		doc.animations = { ...(doc.animations || {}), shape: {} };
		sb.rawDoc = doc;
		sb.skeletonData = loadData(rig, doc);
		sb.skeleton = new Skeleton(sb.skeletonData);
		sb.skeleton.setToSetupPose();
		sb.skeleton.updateWorldTransform(Physics.none);
		sb.curAnim = 'shape';
		sb.animTime = 0;
		return doc;
	}
	/** The page's frame at time t: setup pose, the clip posed over it, world transforms. */
	function frame(t) {
		sb.animTime = t;
		sb.skeleton.setToSetupPose();
		sb.poseAtTime(sb.curAnim, t);
		sb.skeleton.updateWorldTransform(Physics.none);
	}
	function select(slotName) {
		const si = sb.skeletonData.slots.findIndex((s) => s.name === slotName);
		const attName = sb.skeletonData.slots[si].attachmentName;
		sb.selSlot = slotName;
		sb.meshCtx = { slotIndex: si, attName, attachment: sb.skeleton.getAttachment(si, attName) };
	}
	/** Drag vertex k of the selected mesh by a world (dx, dy) at time t, as a mousemove does. */
	function drag(t, k, dx, dy) {
		frame(t);
		sb.dragDeformVertex(k, dx, dy);
		sb.skeleton.updateWorldTransform(Physics.none);
	}
	const keysOf = (skin, slot, att) => sb.rawDoc.animations.shape.attachments?.[skin]?.[slot]?.[att]?.deform || null;
	const samePlay = (rig, slots, times, skinName) => {
		let worst = 0, where = '';
		for (const t of times) {
			frame(t);
			let ref;
			try { ref = engineAt(rig, sb.rawDoc, 'shape', t, skinName); } catch (e) { return { worst: Infinity, where: 'engine-rig refuses the doc: ' + e.message }; }
			for (const s of slots) {
				const d = maxDiff(worldOf(sb.skeleton, s), worldOf(ref, s));
				if (d > worst) { worst = d; where = `${s} @ ${t}s`; }
			}
		}
		return { worst, where };
	};
	const T = [0, 0.1, 0.25, 0.4, 0.5, 0.7, 1];

	// ===== W: an unweighted and a weighted mesh, their bones posed by the clip ===================
	head('1. DRAG — a vertex drag keys the shape at the playhead, under posed bones');
	const W = open('W');
	// pose the meshes' bones so a drag has to undo a turn and a scale: the unweighted mesh's slot
	// bone, and every bone the dragged vertex (3) of the weighted mesh hangs on
	const dyn = sb.skeletonData.slots.find((s) => s.name === 'wild_dynamite');
	const dynAtt = sb.skeleton.getAttachment(dyn.index, 'wild_dynamite');
	let at3 = 0;
	for (let v = 0; v < 3; v++) at3 += 1 + dynAtt.bones[at3];
	const v0Bones = dynAtt.bones.slice(at3 + 1, at3 + 1 + dynAtt.bones[at3]).map((i) => sb.skeletonData.bones[i].name);
	W.animations.shape.bones = { wild_exp_w: { rotate: [{ time: 0, value: 30 }], scale: [{ time: 0, x: 1.4, y: 0.8 }] } };
	for (const [i, b] of v0Bones.entries()) W.animations.shape.bones[b] = { rotate: [{ time: 0, value: -20 - 10 * i }] };
	const setupUnw = Array.from(sb.skeleton.getAttachment(sb.skeletonData.slots.find((s) => s.name === 'wild_exp_w').index, 'wild_exp_w').vertices);
	const setupW = Array.from(dynAtt.vertices);
	ok(`W's dynamite is weighted, its vertex 3 on ${v0Bones.length} bones, one not its slot's`, dynAtt.bones.length > 0 && v0Bones.length >= 2 && v0Bones.some((b) => b !== dyn.boneData.name), v0Bones.join(','));
	for (const [slot, weighted] of [['wild_exp_w', false], ['wild_dynamite', true]]) {
		select(slot);
		const k = 3;
		frame(0);
		const before = worldOf(sb.skeleton, slot);
		drag(0, k, 12, -7);
		const after = worldOf(sb.skeleton, slot);
		ok(`${slot}: the dragged vertex moved by the world delta`, Math.abs(after[k * 2] - before[k * 2] - 12) < 1e-3 && Math.abs(after[k * 2 + 1] - before[k * 2 + 1] + 7) < 1e-3, `${(after[k * 2] - before[k * 2]).toFixed(4)}, ${(after[k * 2 + 1] - before[k * 2 + 1]).toFixed(4)}`);
		ok(`${slot}: no other vertex moved`, after.every((v, i) => (i >> 1) === k || Math.abs(v - before[i]) < 1e-6));
		const keys = keysOf('default', slot, slot);
		const att = sb.meshCtx.attachment;
		const len = weighted ? (att.vertices.length / 3) * 2 : att.vertices.length;
		ok(`${slot}: one key at 0s under default/${slot}/${slot}`, keys && keys.length === 1 && keys[0].time === 0, JSON.stringify(keys && keys.map((x) => x.time)));
		ok(`${slot}: its length is one (x, y) per ${weighted ? 'influence' : 'vertex'} (${len})`, keys && keys[0].vertices.length === len, keys && keys[0].vertices.length);
		if (weighted) {
			let b = 0, f = 0;
			for (let v = 0; v < k; v++) { const n = att.bones[b]; b += 1 + n; f += n; }
			const mine = new Set();
			for (let j = 0; j < att.bones[b]; j++) mine.add(f + j);
			ok(`${slot}: only vertex ${k}'s ${mine.size} influence(s) carry an offset`, keys[0].vertices.every((v, i) => mine.has(i >> 1) || v === 0) && [...mine].every((f2) => keys[0].vertices[f2 * 2] || keys[0].vertices[f2 * 2 + 1]));
		}
		drag(0.5, k, -5, 16);
		frame(0.5);
		const at5 = worldOf(sb.skeleton, slot);
		frame(0);
		const at0 = worldOf(sb.skeleton, slot);
		ok(`${slot}: a second drag at 0.5s keys a second shape`, keysOf('default', slot, slot).length === 2 && Math.abs(at5[k * 2] - at0[k * 2] + 5) < 1e-2, `${(at5[k * 2] - at0[k * 2]).toFixed(3)}`);
	}
	ok('the setup vertices were never written (unweighted)', maxDiff(setupUnw, Array.from(sb.skeleton.getAttachment(sb.skeletonData.slots.find((s) => s.name === 'wild_exp_w').index, 'wild_exp_w').vertices)) === 0);
	ok('the setup vertices were never written (weighted)', maxDiff(setupW, Array.from(dynAtt.vertices)) === 0);

	head('2. PLAY — the Rigger poses every keyed mesh as engine-rig plays it');
	select('wild_exp_w'); // the weighted one is not selected: it still has to play
	let r = samePlay('W', ['wild_exp_w', 'wild_dynamite'], T);
	ok(`both meshes match engine-rig on every vertex at ${T.length} times (worst ${r.worst.toExponential(2)})`, r.worst < 1e-3, r.where);
	sb.selSlot = null;
	sb.meshCtx = null;
	r = samePlay('W', ['wild_exp_w', 'wild_dynamite'], T);
	ok(`…and with no mesh selected at all (worst ${r.worst.toExponential(2)})`, r.worst < 1e-3, r.where);

	head('3. FIRST — before a mesh’s first key, its setup shape');
	const dk = keysOf('default', 'wild_dynamite', 'wild_dynamite');
	dk.shift(); // its first key now sits at 0.5s
	frame(0.25);
	const ref25 = engineAt('W', sb.rawDoc, 'shape', 0.25);
	const setupPosed = (() => { const sk = engineAt('W', { ...sb.rawDoc, animations: { shape: { bones: sb.rawDoc.animations.shape.bones } } }, 'shape', 0.25); return worldOf(sk, 'wild_dynamite'); })();
	ok('engine-rig shows the setup shape at 0.25s', maxDiff(worldOf(ref25, 'wild_dynamite'), setupPosed) < 1e-6);
	ok('so does the Rigger', maxDiff(worldOf(sb.skeleton, 'wild_dynamite'), setupPosed) < 1e-6, maxDiff(worldOf(sb.skeleton, 'wild_dynamite'), setupPosed));

	head('4. CURVES — stepped and eased keys play as engine-rig plays them');
	select('wild_exp_w');
	const uk = keysOf('default', 'wild_exp_w', 'wild_exp_w');
	sb.setDeformKeyCurve({ kind: 'deform', name: 'wild_exp_w', att: 'wild_exp_w' }, 0, 'stepped');
	ok('stepped: the key carries "stepped"', uk[0].curve === 'stepped');
	r = samePlay('W', ['wild_exp_w'], T);
	ok(`stepped plays as engine-rig plays it (worst ${r.worst.toExponential(2)})`, r.worst < 1e-3, r.where);
	sb.setDeformKeyCurve({ kind: 'deform', name: 'wild_exp_w', att: 'wild_exp_w' }, 0, 'easein');
	ok('eased: the key carries a bezier', Array.isArray(uk[0].curve) && uk[0].curve.length === 4, JSON.stringify(uk[0].curve));
	r = samePlay('W', ['wild_exp_w'], T);
	const span = maxDiff(uk[0].vertices, uk[1].vertices);
	// engine-rig samples a bezier as 10 straight segments; the Rigger solves it exactly
	ok(`eased plays as engine-rig plays it (worst ${r.worst.toExponential(2)} of a ${span.toFixed(1)} move)`, r.worst < span * 0.01, r.where);
	const curve = JSON.stringify(uk[0].curve);
	drag(0, 3, 4, 4);
	ok('re-keying the eased key (a drag on it) keeps its easing', JSON.stringify(keysOf('default', 'wild_exp_w', 'wild_exp_w')[0].curve) === curve, JSON.stringify(keysOf('default', 'wild_exp_w', 'wild_exp_w')[0].curve));

	head('5. EDITS — ◆, delete, duplicate and retime');
	frame(0.25);
	const shown = worldOf(sb.skeleton, 'wild_exp_w');
	sb.animTime = 0.25;
	ok('◆ keys the shape on stage', sb.keyDeform('wild_exp_w') === true && keysOf('default', 'wild_exp_w', 'wild_exp_w').length === 3);
	frame(0.25);
	ok('…and the mesh still shows the same shape there', maxDiff(worldOf(sb.skeleton, 'wild_exp_w'), shown) < 1e-2, maxDiff(worldOf(sb.skeleton, 'wild_exp_w'), shown));
	ok('✕ deletes the shape key at the playhead', sb.deleteDeformKeyOfSlot('wild_exp_w', 0.25) === true && keysOf('default', 'wild_exp_w', 'wild_exp_w').length === 2);
	ok('…and reports nothing to delete where there is no key', sb.deleteDeformKeyOfSlot('wild_exp_w', 0.3) === false);
	sb.dupKeyInArr(keysOf('default', 'wild_exp_w', 'wild_exp_w'), 0.5, 0.9);
	sb.retimeDeformKey({ kind: 'deform', name: 'wild_exp_w', att: 'wild_exp_w' }, 0.5, 0.6);
	ok('Alt-duplicate and retime leave three sorted keys', JSON.stringify(keysOf('default', 'wild_exp_w', 'wild_exp_w').map((k) => k.time)) === '[0,0.6,0.9]');
	r = samePlay('W', ['wild_exp_w', 'wild_dynamite'], T);
	ok(`the edited clip plays as engine-rig plays it (worst ${r.worst.toExponential(2)})`, r.worst < span * 0.01, r.where);

	head('6. SAVE — the document as saved reloads the same, into both');
	const saved = JSON.parse(JSON.stringify(sb.rawDoc));
	const before = T.map((t) => { frame(t); return worldOf(sb.skeleton, 'wild_dynamite').concat(worldOf(sb.skeleton, 'wild_exp_w')); });
	sb.rawDoc = saved;
	sb.skeletonData = loadData('W', saved);
	sb.skeleton = new Skeleton(sb.skeletonData);
	const after = T.map((t) => { frame(t); return worldOf(sb.skeleton, 'wild_dynamite').concat(worldOf(sb.skeleton, 'wild_exp_w')); });
	ok('reopened, the Rigger poses the same shapes', before.every((b, i) => maxDiff(b, after[i]) < 1e-9));
	r = samePlay('W', ['wild_exp_w', 'wild_dynamite'], T);
	ok(`and engine-rig plays the reloaded doc the same (worst ${r.worst.toExponential(2)})`, r.worst < span * 0.01, r.where);

	head('9. SETUP — leaving Animate shows the setup shape');
	frame(0.6);
	sb.skeleton.setToSetupPose();
	sb.skeleton.updateWorldTransform(Physics.none);
	const plain = new Skeleton(loadData('W', saved));
	plain.setToSetupPose();
	plain.updateWorldTransform(Physics.none);
	ok('setToSetupPose clears every shape', ['wild_exp_w', 'wild_dynamite'].every((s) => maxDiff(worldOf(sb.skeleton, s), worldOf(plain, s)) < 1e-9));

	// ===== S: linked meshes ===================================================================
	head('7. LINKED — a linked mesh is keyed where engine-rig reads its timelines');
	for (const [own, label] of [[false, 'inherits deform'], [true, 'has its own (timelines: false)']]) {
		open('S', (doc) => {
			const slot = doc.slots.find((s) => s.name === 'facet_shine_1');
			slot.attachment = 'facet_shine_2';
			if (own) doc.skins[0].attachments.facet_shine_1.facet_shine_2.timelines = false;
		});
		select('facet_shine_1');
		ok(`the slot shows the linked mesh facet_shine_2, which ${label}`, sb.meshCtx.attName === 'facet_shine_2');
		drag(0, 2, 9, 3);
		drag(0.5, 2, -3, 8);
		const where = own ? 'facet_shine_2' : 'facet_shine_1';
		if (own) {
			// its source has keys of its own too, which this linked mesh must NOT follow
			const len = sb.meshCtx.attachment.vertices.length;
			sb.rawDoc.animations.shape.attachments.default.facet_shine_1.facet_shine_1 = { deform: [{ time: 0, offset: 0, vertices: new Array(len).fill(40) }] };
		}
		ok(`its keys are under default/facet_shine_1/${where}`, (keysOf('default', 'facet_shine_1', where) || []).length === 2 && (own || !keysOf('default', 'facet_shine_1', 'facet_shine_2')), JSON.stringify(Object.keys(sb.rawDoc.animations.shape.attachments.default.facet_shine_1)));
		r = samePlay('S', ['facet_shine_1'], T);
		ok(`engine-rig plays them on the linked mesh as the Rigger does (worst ${r.worst.toExponential(2)})`, r.worst < 1e-3, r.where);
		frame(0.5);
		ok('…and they move it', maxDiff(worldOf(sb.skeleton, 'facet_shine_1'), worldOf(engineAt('S', { ...sb.rawDoc, animations: { shape: {} } }, 'shape', 0.5), 'facet_shine_1')) > 1);
	}

	head('8. SKIN — another skin active: the default skin’s mesh is keyed under default');
	open('W', (doc) => { doc.skins.push({ name: 'alt', attachments: {} }); });
	sb.skeleton.setSkinByName('alt');
	sb.skeleton.setToSetupPose();
	select('wild_dynamite');
	drag(0, 5, 6, 6);
	drag(0.5, 5, -6, 2);
	ok('keys under default, none under alt', (keysOf('default', 'wild_dynamite', 'wild_dynamite') || []).length === 2 && !sb.rawDoc.animations.shape.attachments.alt);
	ok('the skin was not forked (alt still has no attachments)', Object.keys(sb.rawDoc.skins.find((s) => s.name === 'alt').attachments).length === 0);
	r = samePlay('W', ['wild_dynamite'], T, 'alt');
	ok(`engine-rig with alt active plays them as the Rigger does (worst ${r.worst.toExponential(2)})`, r.worst < 1e-3, r.where);

	return { pass, fail };
}

// ---- mutants: each is a bug this gate exists for, planted in the shipped source ---------------
const MUTANTS = [
	['shapes pose only for the selected mesh', 'function poseDeforms(a, t, additive){\n  const at = a && a.attachments; if (!at) return;', 'function poseDeforms(a, t, additive){\n  const at = a && a.attachments; if (!at || !meshCtx) return;'],
	['before the first key, the first key', '!keys.length || t < keys[0].time) continue;', '!keys.length) continue;'],
	['weighted offsets stored as absolute positions', 'd[i] = weighted ? o : att.vertices[i] + o;', 'd[i] = att.vertices[i] + o;'],
	['unweighted shape read back as raw positions', 'out[i] = weighted ? d[i] : d[i] - att.vertices[i];', 'out[i] = d[i];'],
	['a weighted drag through the slot bone', 'const lv = invWorldVec(skeleton.bones[att.bones[b + 1 + j]], wdx, wdy);', 'const lv = invWorldVec(slot.bone, wdx, wdy);'],
	['a linked mesh keyed under its own name', 'if (e.type === "linkedmesh" && e.timelines !== false) return', 'if (false) return'],
	['keys always under the active skin', 'const sk = entryIn(activeSkinName()) || entryIn("default"); if (!sk) return null;', 'const sk = entryIn(activeSkinName()) || entryIn("default"); if (!sk) return null; if (activeSkinName() !== sk.name) return { skin: activeSkinName(), slot: slotName, att: attName };'],
	['re-keying drops the easing', 'if (old && old.curve !== undefined) key.curve = old.curve;', ''],
	['a shape posed on an attachment it does not drive', 'if (shown.timelineAttachment !== skin.getAttachment(slot.data.index, attName)) continue;', ''],
	['the drag writes the setup vertices', 'setDeformOffsets(slot, att, d); // shows at once', 'for (let i = 0; i < d.length && !isWeightedAtt(att); i++) att.vertices[i] += d[i]; // shows at once'],
	['the eased sampler reads progress linearly', 'if (Array.isArray(a.curve)) u = bezierValue(', 'if (false) u = bezierValue('],
];

if (process.argv.includes('--mutants')) {
	let caught = 0;
	console.log('deform-keys mutants (each must fail a check):');
	for (const [name, find, replace] of MUTANTS) {
		const n = html.split(find).length - 1;
		if (n !== 1) {
			console.log(`  ✗ ${name}: its line is in view.html ${n} times — the mutant is stale`);
			continue;
		}
		let res;
		try { res = run(html.replace(find, replace), true); } catch (e) { res = { fail: 1, threw: e.message }; }
		const hit = res.fail > 0;
		if (hit) caught++;
		console.log(`  ${hit ? '✓' : '✗'} ${name}${hit ? ` (${res.threw ? 'threw' : res.fail + ' check(s) failed'})` : ' — NOT caught'}`);
	}
	console.log(`\n${caught}/${MUTANTS.length} mutants caught`);
	process.exit(caught === MUTANTS.length ? 0 : 1);
}

console.log('deform-keys — the Rigger’s mesh-shape keys vs engine-rig (W, S)');
const { pass, fail } = run(html, false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
