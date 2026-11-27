// 🗺 From my sheet — the skeleton from the mapping (docs/design/frame-to-rig.md §13.1i): the owner,
// after one slot per region (#1988), "can we also create the bones and the rig from the regions so
// only the needed bones exist and the extra one that we need for facial and gadgets?". Headless on
// the SHIPPED code: the rig 🦴 Create rig makes of the committed sheet fixture under the owner's own
// region names (`owner-sheet.mjs`: S_NellyAnimTest's Photoshop Export Layers names, Half body, its face
// drawn apart, a jointed mouth, glasses, an earring, a chain, a watch and a hood worn), keyed by the
// page's own control code (`view.html`) and engine-rig playing it. Asserted:
//  - skeleton: no bone nothing is drawn on (cheeks, brows, hair, the fingers of a hand drawn as one
//    picture; on Full body with no legs drawn, no leg), every region's bone and the bones above it,
//    the face's control bones for what is drawn (jaw, lips, teeth, corners, lids and their follow bones,
//    pupils), the arms' IK controls, poles and spaces, every prop on a bone of its own; the fitted
//    template (Controls, picker, motion map, 3D setup) naming only bones the rig has; the rig a valid
//    4.2 skeleton engine-rig loads;
//  - drive: every control keyed at once, lip-sync, and a 3D capture imported and baked as 🎥 Motion does
//    it, each played by engine-rig, keying no bone or slot the rig lacks;
//  - keep: a bone the author keeps with no region (a brow, a finger) is made with the bones above it,
//    its controls and its capture's turn; one the template lacks refused;
//  - update: 🔄 Update rig moves a rig made with every template bone onto the mapping's skeleton — the
//    bones it leaves out taken out with their keys, every drawing posed exactly as before (weighted
//    vertices renumbered), every key on a kept bone kept, the author's own bones kept and the template
//    bone one of them hangs from kept (and kept by the mapping from then on); a second update a no-op;
//  - page: the 🗺 dialog's 🦴 Bones list (`s2rBoneRows`) as the launcher says, a toggle keeping a bone;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-bones.mjs [--only <guard>] [--no-mutants]
import * as P from './performer3d.mjs';
import {
	END,
	RIG,
	SIZED,
	faceTrack,
	imported,
	ownerMapping,
	ownerRig,
	player,
	runGate,
	slotOf,
} from './owner-sheet.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const FINGER = /^(thumb|index|middle|ring|pinky)_[123]_[lr]$/;
/** Template bones nothing of the owner's sheet is drawn on, under or by. */
const NOT_DRAWN = [
	'cheek_l',
	'cheek_r',
	'brow_l',
	'brow_in_l',
	'brow_out_l',
	'brow_r',
	'brow_in_r',
	'brow_out_r',
	'hair_back',
	'hair_front',
];
/** The face's bones a drawn face apart needs: its features', what moves them, the head turn's ring. */
const FACE = [
	'face',
	'eye_l',
	'eye_r',
	'pupil_l',
	'pupil_r',
	'lid_follow_l',
	'lid_follow_r',
	'lid_upper_l',
	'lid_upper_r',
	'lid_lower_l',
	'lid_lower_r',
	'nose',
	'jaw',
	'lip_upper',
	'lip_lower',
	'teeth_upper',
	'mouth_corner_l',
	'mouth_corner_r',
	'head_turn_l',
	'head_turn_r',
	'head_turn_d',
	'head_turn_u',
	'neck_upper',
];
/** The arms' IK: each hand's control and its spaces, each elbow's pole. */
const IK = ['l', 'r'].flatMap((s) => [
	`hand_ik_${s}`,
	`hand_ik_${s}_chest`,
	`hand_ik_${s}_world`,
	`elbow_pole_${s}`,
]);
const LEG = /^(thigh|shin|foot|knee_pole|foot_ik)_/;

/** The page's control code (`view.html`), as the Controls section and lip-sync key a clip. */
const KEYING = [
	'bezierValue',
	'sampleChannel',
	'upsertKey',
	'upsertBoneKey',
	'faceSwapPart',
	'faceOrderStep',
	'faceOrderAt',
	'faceOrderOffsets',
	'drawOrderOfOffsets',
	'faceOrderOfKey',
	'faceOrderValue',
	'faceOrderKeyAt',
	'faceOrderValues',
	'faceKeyOrder',
	'faceAttachmentAt',
	'faceKeyAttachment',
	'faceKeyMix',
	'faceIkSetup',
	'faceKeyChannel',
	'faceShapePart',
	'faceDrawnMouth',
	'faceShapeControls',
	'faceKeyShape',
	'faceKeyLipSync',
];
const KEYING_CONSTS = ['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'];

/** Every bone name a fitted template's channels, motion map, controls, constraints and 3D setup use. */
function namedBones(tpl) {
	const out = new Set();
	const add = (b) => typeof b === 'string' && out.add(b);
	for (const c of tpl.channels) for (const d of c.drives ?? []) add(d.bone);
	for (const k of ['face', 'body', 'hand'])
		for (const e of tpl.motion?.[k]?.entries ?? []) add(e.bone);
	const b3 = tpl.motion?.bones3d;
	for (const e of b3?.entries ?? []) add(e.bone);
	for (const f of b3?.fingers ?? []) add(f.bone);
	const p = b3?.positions;
	if (p) {
		add(p.root.bone);
		for (const a of p.root.anchors) add(a.bone);
		for (const l of p.limbs) [l.upper, l.lower, l.end, l.pole].forEach(add);
		for (const b of p.neck?.bones ?? []) add(b);
		for (const m of p.neck?.marks ?? []) add(m.bone);
	}
	const c = tpl.controls;
	for (const b of Object.keys(c?.bones ?? {})) add(b);
	for (const bs of Object.values(c?.sets ?? {})) bs.forEach(add);
	for (const l of Object.values(c?.limbs ?? {}))
		[
			...(l.fk ?? []),
			l.control,
			l.pole,
			...Object.values(l.spaces ?? {}).map((s) => s.bone),
		].forEach(add);
	for (const i of c?.picker?.items ?? []) add(i.bone);
	for (const list of Object.values(tpl.constraints ?? {}))
		for (const k of list ?? []) [k.target, k.bone, ...(k.bones ?? [])].forEach(add);
	for (const b of Object.keys(tpl.rig3d?.depths ?? {})) add(b);
	for (const k of tpl.rig3d?.ik ?? []) [...k.bones, k.end, k.target, k.pole].forEach(add);
	for (const s of tpl.slots) add(s.bone);
	for (const p of tpl.parts) for (const b of p.bend?.bones ?? []) add(b.bone);
	return out;
}

/** Each slot's drawing in the world, as engine-rig draws `skel` (null: nothing shown). */
function drawings(skel) {
	const out = new Map();
	for (const slot of skel.slots) {
		const att = slot.getAttachment();
		let v = null;
		if (att instanceof RIG.MeshAttachment) {
			v = new Float32Array(att.worldVerticesLength);
			att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		} else if (att instanceof RIG.RegionAttachment) {
			v = new Float32Array(8);
			att.computeWorldVertices(slot, v, 0, 2);
		}
		out.set(slot.data.name, v);
	}
	return out;
}
/** The farthest any vertex of any drawing of `a` lies from the same one in `b`, and where. */
function farthest(a, b) {
	let worst = { d: 0, slot: '' };
	for (const [slot, va] of a) {
		const vb = b.get(slot);
		if (!va && !vb) continue;
		if (!va || !vb || va.length !== vb.length) return { d: Infinity, slot };
		for (let i = 0; i < va.length; i += 2) {
			const d = Math.hypot(va[i] - vb[i], va[i + 1] - vb[i + 1]);
			if (!(d <= worst.d)) worst = { d, slot };
		}
	}
	return worst;
}
/** Each weighted mesh's influences as bone names, by slot and attachment. */
function weightNames(irig) {
	const out = {};
	for (const [slot, by] of Object.entries(irig.skins[0].attachments))
		for (const [name, att] of Object.entries(by)) {
			if (att.type !== 'mesh' || att.vertices.length <= att.uvs.length) continue;
			const names = [];
			for (let i = 0; i < att.vertices.length;) {
				const n = att.vertices[i++];
				for (let k = 0; k < n; k++, i += 4) names.push(irig.bones[att.vertices[i]]?.name ?? '?');
			}
			out[`${slot}/${name}`] = names.join();
		}
	return out;
}
/** Whether engine-rig loads `irig` and draws every slot finite at setup (and at `time` of `clip`). */
function plays(irig, clip, time) {
	try {
		const skel = player(irig, clip ?? 'imp')(clip ? time : null);
		return [...drawings(skel).values()].every((v) => !v || v.every(Number.isFinite));
	} catch {
		return false;
	}
}

/** The owner's body parts mapped onto Full body (no leg drawn), as the dialog would on that template. */
function fullBodyRig(M) {
	const F = M.FULL_BODY;
	const owner = ownerMapping(M);
	const slotOfPart = (part) => F.parts.find((p) => p.name === part)?.slot;
	const boneOfSlot = (slot) => F.slots.find((s) => s.name === slot)?.bone;
	const parts = Object.fromEntries(Object.entries(owner.parts).filter(([p]) => slotOfPart(p)));
	const mapping = M.parseSheetMapping(
		clone({
			...owner,
			template: { id: F.id, version: F.version },
			parts,
			props: owner.props
				.filter((p) => parts[p.host])
				.map((p) => ({ ...p, bone: boneOfSlot(slotOfPart(p.host)) })),
		}),
	).mapping;
	const t = M.asMapped(F, mapping);
	const sr = M.sheetRig(t, SIZED, mapping);
	if (!sr.ok) throw new Error(sr.problem);
	return {
		t,
		sr: sr.value,
		irig: M.templateRig(t, SIZED, sr.value.fit, sr.value.art).skeleton,
		tpl: M.fitTemplate(t, sr.value.fit),
	};
}

const GUARDS = {
	/** Only the bones the mapping needs, each needed one there, the rig whole. */
	skeleton(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const t = M.HALF_BODY;
		const names = rig.irig.bones.map((b) => b.name);
		const has = new Set(names);
		good =
			ok(
				'skeleton: no bone nothing is drawn on — cheeks, brows, hair, the fingers of a hand drawn as one picture — and no ear or cheek slot',
				NOT_DRAWN.every((b) => !has.has(b)) &&
					!names.some((n) => FINGER.test(n)) &&
					!rig.irig.slots.some((s) => /^(ear|cheek)_/.test(s.name)),
				names.filter((n) => NOT_DRAWN.includes(n) || FINGER.test(n)).join(' '),
			) && good;
		const slotOfPart = (part) => t.parts.find((p) => p.name === part).slot;
		const boneOfRole = (role) => t.slots.find((s) => s.name === role).bone;
		const onItsBone = Object.keys(rig.mapping.parts).filter((part) => {
			const role = slotOfPart(part);
			const slot = rig.irig.slots.find((s) => s.name === slotOf(rig, role));
			return !(has.has(boneOfRole(role)) && slot?.bone === boneOfRole(role));
		});
		const above = rig.irig.bones.every((b, i) =>
			b.parent === undefined
				? i === 0
				: names.indexOf(b.parent) > -1 && names.indexOf(b.parent) < i,
		);
		good =
			ok(
				"skeleton: every region drawn on its part's bone, with every bone above it to the root",
				onItsBone.length === 0 && above,
				onItsBone.join(' '),
			) && good;
		const props = rig.mapping.props.filter((p) => {
			const bone = rig.irig.bones.find((b) => b.name === p.name);
			const hangs = rig.sr.fit.props.find((x) => x.name === p.name).bone;
			return !(
				bone?.parent === hangs &&
				has.has(hangs) &&
				rig.irig.slots.find((s) => s.name === p.name)?.bone === p.name
			);
		});
		good =
			ok(
				'skeleton: every prop (glasses, earring, chain, watch, hood) drawn on a bone of its own, hung where its mapping says',
				rig.mapping.props.length === 6 && props.length === 0,
				props.map((p) => p.name).join(' '),
			) && good;
		good =
			ok(
				"skeleton: the drawn face's control bones (lids and their follow bones, pupils, jaw, lips, teeth, the mouth's corners, the head turn's ring) and the arms' IK controls, poles and spaces",
				[...FACE, ...IK].every((b) => has.has(b)) &&
					Object.keys(rig.tpl.controls?.limbs ?? {}).length === 2 &&
					rig.tpl.rig3d?.ik?.length === 2 &&
					rig.tpl.motion?.bones3d?.positions?.limbs.length === 2,
				[...FACE, ...IK].filter((b) => !has.has(b)).join(' '),
			) && good;
		const stray = [...namedBones(rig.tpl)].filter((b) => !has.has(b));
		const leftOut = rig.sr.fit.leftOut ?? [];
		const listed = rig.sr.skeleton.filter((b) => b.why === 'none').map((b) => b.name);
		good =
			ok(
				"skeleton: the fitted template (the page's Controls, picker, motion map, constraints, 3D setup) names only bones the rig has; its bones are the rig's, the left-out ones listed as such",
				stray.length === 0 &&
					rig.tpl.bones.map((b) => b.name).join() === names.join() &&
					leftOut.length > 0 &&
					leftOut.every((b) => !has.has(b)) &&
					t.bones.every((b) => has.has(b.name) !== leftOut.includes(b.name)) &&
					listed.join() === leftOut.join() &&
					rig.sr.skeleton.length === t.bones.length,
				stray.join(' '),
			) && good;
		const problem = M.irigDocProblem(rig.irig);
		const weights = Object.values(rig.irig.skins[0].attachments)
			.flatMap((by) => Object.values(by))
			.filter((a) => a.type === 'mesh' && a.vertices.length > a.uvs.length);
		good =
			ok(
				'skeleton: a valid 4.2 skeleton engine-rig loads, every weighted vertex on a bone it has, every drawing finite',
				problem === null && weights.length > 0 && plays(rig.irig, null),
				problem ?? '',
			) && good;
		// The tracker finding the face on the head: the head's mesh bends on the brows' ends, drawn or not.
		const found = ownerRig(M, { face: true });
		const foundWhy = Object.fromEntries(found.sr.skeleton.map((b) => [b.name, b.why]));
		const brows = ['brow_in_l', 'brow_out_l', 'brow_in_r', 'brow_out_r'];
		good =
			ok(
				"skeleton: a face found on the head keeps the bones its mesh bends on (the brows' ends, no brow drawn), the cheeks still out",
				brows.every((b) => foundWhy[b] === 'mesh' && found.irig.bones.some((x) => x.name === b)) &&
					!found.irig.bones.some((b) => /^cheek_/.test(b.name)) &&
					M.irigDocProblem(found.irig) === null,
				brows.map((b) => `${b}:${foundWhy[b]}`).join(' '),
			) && good;
		// A head drawn with none of its features: the neck still bends to the capture's face marks.
		const bare = ownerMapping(M);
		const body = [
			'torso',
			'neck',
			'head',
			'upper_arm_l',
			'lower_arm_l',
			'upper_arm_r',
			'lower_arm_r',
		];
		bare.parts = Object.fromEntries(Object.entries(bare.parts).filter(([p]) => body.includes(p)));
		bare.props = bare.props.filter((p) => body.includes(p.host));
		const plain = ownerRig(M, { mapping: bare });
		const marks = plain.tpl.motion.bones3d.positions.neck?.marks.map((m) => m.bone) ?? [];
		good =
			ok(
				"skeleton: a head drawn without its features keeps the face marks the neck bends to under a capture, and nothing else of the face's",
				marks.length === 4 &&
					marks.every((b) => plain.irig.bones.some((x) => x.name === b)) &&
					!plain.irig.bones.some((b) => /^(pupil|lid|jaw|lip|teeth|nose)/.test(b.name)),
				marks.join(' '),
			) && good;
		const full = fullBodyRig(M);
		const fullNames = full.irig.bones.map((b) => b.name);
		good =
			ok(
				'skeleton: Full body with no leg drawn makes no leg (thighs, shins, feet, their IK), its arms whole',
				!fullNames.some((n) => LEG.test(n)) &&
					IK.every((b) => fullNames.includes(b)) &&
					full.tpl.motion.bones3d.positions.root.anchors.length > 0 &&
					M.irigDocProblem(full.irig) === null &&
					plays(full.irig, null),
				fullNames.filter((n) => LEG.test(n)).join(' '),
			) && good;
		log(
			`Half body ${t.bones.length} bones → ${names.length} (${leftOut.length} left out); Full body ${M.FULL_BODY.bones.length} → ${fullNames.length}`,
		);
		return good;
	},

	/** Every control, lip-sync and a 3D capture keyed on the rig as the page keys them, and played. */
	drive(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const K = M.page(KEYING, KEYING_CONSTS);
		const channels = rig.tpl.channels;
		const skin = rig.irig.skins[0].attachments;
		const has = (slot, part) => !!skin[slot]?.[part];
		const bones = new Set(rig.irig.bones.map((b) => b.name));
		const slots = new Set(rig.setup);
		const keysOnly = (anim) =>
			Object.keys(anim.bones ?? {}).every((b) => bones.has(b)) &&
			Object.keys(anim.slots ?? {}).every((s) => slots.has(s));
		// Every control at its far end, all in one clip, as the Controls section keys each.
		const all = {};
		for (const c of channels) {
			K.faceKeyChannel(all, c, c.rest, 0, has, channels, rig.setup);
			K.faceKeyChannel(all, c, c.max ?? 1, 0.5, has, channels, rig.setup);
		}
		good =
			ok(
				`drive: every one of the rig's ${channels.length} controls keyed at its far end plays, keying no bone or slot it lacks`,
				keysOnly(all) && plays({ ...rig.irig, animations: { all } }, 'all', 0.5),
				Object.keys(all.bones ?? {})
					.filter((b) => !bones.has(b))
					.join(' '),
			) && good;
		const mouth = channels.find((c) => c.id === 'mouth');
		const talk = {};
		K.faceKeyLipSync(
			talk,
			mouth,
			[
				{ start: 0, end: 0.3, value: 'X' },
				{ start: 0.3, end: 0.7, value: 'D' },
				{ start: 0.7, end: 1, value: 'X' },
			],
			0,
			channels,
			has,
		);
		good =
			ok(
				'drive: lip-sync on the jointed mouth plays, keying no bone or slot the rig lacks',
				Object.keys(talk.bones ?? {}).length > 0 &&
					keysOnly(talk) &&
					plays({ ...rig.irig, animations: { talk } }, 'talk', 0.3),
			) && good;
		let made = null;
		let why = '';
		try {
			made = imported(
				rig,
				faceTrack((k) => P.ry(25 * k)),
			);
		} catch (e) {
			why = e.message;
		}
		const anim = made?.irig.animations?.imp;
		good =
			ok(
				'drive: a 3D capture solved, keyed and baked as 🎥 Motion does plays to its end, keying no bone or slot the rig lacks',
				!!anim && keysOnly(anim) && plays(made.irig, 'imp', END),
				why,
			) && good;
		log(
			`${channels.length} controls, lip-sync keys ${Object.keys(talk.bones ?? {}).length} bones, the capture ${Object.keys(anim?.bones ?? {}).length}`,
		);
		return good;
	},

	/** A bone the author keeps with no region: made, its controls and capture turn with it. */
	keep(M, ok, log) {
		let good = true;
		const rig = ownerRig(M, { mapping: { ...ownerMapping(M), keep: ['brow_l', 'index_1_l'] } });
		const names = rig.irig.bones.map((b) => b.name);
		const why = Object.fromEntries(rig.sr.skeleton.map((b) => [b.name, b.why]));
		const finger = rig.tpl.motion.bones3d.fingers?.find((f) => f.bone === 'index_1_l');
		const browDrive = rig.tpl.channels.some((c) => c.drives?.some((d) => d.bone === 'brow_l'));
		good =
			ok(
				'keep: a brow and a finger kept with no region are made with the bones above them, and nothing under them',
				names.includes('brow_l') &&
					names.includes('index_1_l') &&
					!names.includes('brow_in_l') &&
					!names.includes('index_2_l') &&
					why.brow_l === 'kept' &&
					why.index_1_l === 'kept' &&
					why.face !== 'none',
				names.filter((n) => /^(brow|index)_/.test(n)).join(' '),
			) && good;
		let made;
		try {
			made = imported(
				rig,
				faceTrack((k) => P.ry(15 * k)),
			);
		} catch {
			made = null;
		}
		good =
			ok(
				"keep: the kept brow's control drives it, the kept finger's capture turn keeps its direction (its next segment left out), and a capture still plays",
				browDrive &&
					!!finger?.rest &&
					!!made &&
					plays(made.irig, 'imp', END) &&
					M.irigDocProblem(rig.irig) === null,
			) && good;
		const bad = M.parseSheetMapping(clone({ ...ownerMapping(M), keep: ['not_a_bone'] })).mapping;
		const t = M.asMapped(M.HALF_BODY, bad);
		const refused = M.sheetRig(t, SIZED, bad);
		good =
			ok(
				'keep: a bone the template lacks is refused, naming it',
				!refused.ok && /not_a_bone/.test(refused.problem),
				refused.ok ? 'made' : refused.problem,
			) && good;
		log(`kept brow_l and index_1_l: ${names.length} bones`);
		return good;
	},

	/**
	 * 🔄 Update rig on a rig made with every template bone: the mapping's skeleton, the poses and keys
	 * of what stays exactly as they were, the author's own bones kept.
	 */
	update(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const t = M.asMapped(M.HALF_BODY, rig.mapping);
		// As made before the skeleton followed the mapping: every template bone.
		const whole = { ...rig.sr.fit };
		delete whole.leftOut;
		const old = M.templateRig(t, SIZED, whole, rig.sr.art).skeleton;
		// The author's: a ring hung on the hand, a mole on the cheek (a bone the mapping leaves out) with
		// a slot of its own, and a clip keying bones that stay and bones that go.
		old.bones.push(
			{ name: 'my_ring', parent: 'hand_l', x: 4 },
			{ name: 'my_mole', parent: 'cheek_l' },
		);
		old.slots.push({ name: 'mole', bone: 'my_mole' });
		const rot = (v) => ({ rotate: [{ time: 0, value: 0 }, { time: 0.5, value: v }, { time: 1 }] });
		old.animations.pose = {
			bones: {
				head: rot(12),
				upper_arm_l: rot(-30),
				lower_arm_r: rot(25),
				lid_upper_l: { translate: [{ time: 0 }, { time: 0.5, y: -6 }] },
				jaw: rot(-8),
				prop_glasses: rot(5),
				my_ring: rot(40),
				brow_l: rot(10),
				thumb_1_l: rot(-20),
				hair_front: rot(3),
			},
			slots: {
				pupil_l: {
					rgba: [
						{ time: 0, color: 'ffffffff' },
						{ time: 1, color: '80ff80ff' },
					],
				},
			},
		};
		const update = (was, mapping, current) => {
			const r = M.updateSheetRig({ template: M.HALF_BODY, regions: SIZED, was, mapping, current });
			if (!r.ok) throw new Error(r.problem);
			return r.value;
		};
		const res = update(rig.mapping, rig.mapping, old);
		const doc = res.doc;
		const names = doc.bones.map((b) => b.name);
		const fresh = ownerRig(M, { mapping: res.mapping });
		const want = [...fresh.irig.bones.map((b) => b.name), 'my_ring', 'my_mole'];
		const rep = res.report.bones;
		good =
			ok(
				"update: the rig made with every template bone takes the mapping's skeleton — the bones nothing is drawn on out, the author's own kept with the cheek their mole hangs from (kept by the mapping from now on)",
				[...want].sort().join() === [...names].sort().join() &&
					names.includes('cheek_l') &&
					res.mapping.keep?.includes('cheek_l') &&
					rep?.kept.join() === 'cheek_l' &&
					['brow_l', 'thumb_1_l', 'hair_front', 'cheek_r'].every((b) => rep.bones.includes(b)) &&
					!rep.bones.includes('cheek_l') &&
					old.bones.length - names.length === rep.bones.length,
				`${old.bones.length} → ${names.length}: ${names.filter((n) => !want.includes(n)).join(' ')} | ${want.filter((n) => !names.includes(n)).join(' ')}`,
			) && good;
		const keys = old.animations.pose.bones;
		const after = doc.animations.pose?.bones ?? {};
		const keptKeys = Object.keys(keys).filter((b) => names.includes(b));
		good =
			ok(
				'update: every key on a bone that stays kept as it was, the keys on the bones that went dropped (and counted)',
				keptKeys.length === 7 &&
					keptKeys.every((b) => JSON.stringify(after[b]) === JSON.stringify(keys[b])) &&
					Object.keys(after).every((b) => names.includes(b)) &&
					JSON.stringify(doc.animations.pose.slots) === JSON.stringify(old.animations.pose.slots) &&
					rep.keys >= 3,
				`kept ${keptKeys.join(' ')}; ${rep?.keys} keys dropped`,
			) && good;
		const wasW = weightNames(old);
		const nowW = weightNames(doc);
		const renamed = Object.keys(wasW).filter((k) => wasW[k] !== nowW[k]);
		good =
			ok(
				'update: every weighted vertex renumbered onto the same bone by name',
				Object.keys(wasW).length > 3 && renamed.length === 0,
				renamed.join(' '),
			) && good;
		const off = [null, 0.25, 0.5, 0.75].map((time) => {
			const a = drawings(player(old, 'pose')(time));
			const b = drawings(player(doc, 'pose')(time));
			for (const k of [...a.keys()]) if (!b.has(k)) a.delete(k);
			return { time, ...farthest(a, b), n: a.size };
		});
		const worst = off.reduce((x, y) => (y.d > x.d ? y : x));
		good =
			ok(
				'update: every drawing posed exactly as before, at setup and through the clip (engine-rig)',
				worst.d < 1e-3 && off.every((o) => o.n === doc.slots.length),
				`${worst.d} (${worst.slot} at ${worst.time})`,
			) && good;
		const again = update(res.mapping, res.mapping, doc);
		good =
			ok(
				'update: a valid 4.2 skeleton engine-rig loads, and a second update changes no bone',
				M.irigDocProblem(doc) === null &&
					plays(doc, 'pose', 0.5) &&
					again.doc.bones.map((b) => b.name).join() === names.join() &&
					!again.report.bones?.bones.length &&
					!again.report.bones?.added.bones.length,
			) && good;
		// A brow mapped anew on a rig made without one: its bone comes, placed where a new rig has it.
		const browMapping = clone(res.mapping);
		browMapping.parts.brow_l_neutral = { region: SIZED[0].name, joints: { pivot: [4, 4] } };
		const browed = update(res.mapping, browMapping, doc);
		const brow = browed.doc.bones.find((b) => b.name === 'brow_l');
		const made = ownerRig(M, { mapping: browed.mapping }).irig.bones.find(
			(b) => b.name === 'brow_l',
		);
		good =
			ok(
				'update: a region mapped anew on a bone the rig lacks brings the bone, where a new rig has it',
				!!brow &&
					brow.parent === made?.parent &&
					Math.hypot((brow.x ?? 0) - (made.x ?? 0), (brow.y ?? 0) - (made.y ?? 0)) < 1e-3 &&
					browed.report.bones?.added.bones.includes('brow_l') &&
					browed.doc.slots.some((s) => s.bone === 'brow_l'),
				JSON.stringify({ brow, made }),
			) && good;
		log(
			`${old.bones.length} bones → ${names.length}: ${rep?.bones.length} out with ${rep?.keys} keys, kept ${rep?.kept.join(' ')}; posed within ${worst.d.toExponential(1)}`,
		);
		return good;
	},

	/** The 🗺 dialog's 🦴 Bones list: as the launcher says, and a toggle keeping a left-out bone. */
	page(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const { s2rBoneRows } = M.page(['s2rBoneRows']);
		const list = s2rBoneRows(rig.sr.skeleton, []);
		const out = rig.sr.skeleton.filter((b) => b.why === 'none');
		good =
			ok(
				'page: 🦴 Bones counts the bones made and left out as the launcher does, and lists each left-out bone with a toggle, off',
				list.made ===
					rig.irig.bones.length -
						rig.irig.bones.filter((b) => !rig.sr.skeleton.some((x) => x.name === b.name)).length &&
					list.left === out.length &&
					list.rows
						.filter((r) => r.toggle)
						.map((r) => r.name)
						.join() === out.map((b) => b.name).join() &&
					list.rows.filter((r) => r.toggle).every((r) => !r.kept),
				`${list.made} made, ${list.left} left out`,
			) && good;
		const kept = ownerRig(M, { mapping: { ...ownerMapping(M), keep: ['brow_r'] } });
		const after = s2rBoneRows(kept.sr.skeleton, ['brow_r']);
		const row = after.rows.find((r) => r.name === 'brow_r');
		good =
			ok(
				'page: a kept bone stays in the list, its toggle on, counted as made',
				!!row?.toggle && row.kept && after.made === list.made + 1 && after.left === list.left - 1,
			) && good;
		log(`${list.made} made, ${list.left} left out`);
		return good;
	},
};

const MUTANTS = [
	[
		'skeleton',
		'every template bone made (the fit leaves none out)',
		[['rigSheetFit.ts', 'if (skeleton.leftOut.length) fit.leftOut = skeleton.leftOut;', 'void 0;']],
	],
	[
		'skeleton',
		'the bones above a needed one not kept',
		[['rigSheetBones.ts', 'if (why.has(b.name) && b.parent !== undefined)', 'if (false)']],
	],
	[
		'skeleton',
		"a limb's IK control, pole and spaces not kept",
		[['rigSheetBones.ts', "for (const b of h.needs) mark(b, 'control');", 'void h;']],
	],
	[
		'skeleton',
		"the bones a mesh is weighted to not kept (a found face's head bends on the brows' ends)",
		[['rigSheetBones.ts', "for (const b of bendBones(bend)) mark(b, 'mesh');", 'void bend;']],
	],
	[
		'skeleton',
		"the root's capture anchors kept though others are (Full body's thighs with no leg drawn)",
		[
			[
				'rigSheetBones.ts',
				'if (root && !root.anchors.some((a) => why.has(a.bone))) {',
				'if (root) {',
			],
		],
	],
	[
		'skeleton',
		'the face marks a kept neck bends to not kept (a head drawn without features)',
		[['rigSheetBones.ts', 'needs: positions.neck.marks.map((m) => m.bone)', 'needs: []']],
	],
	[
		'skeleton',
		'the fitted template not made without the left-out bones',
		[
			[
				'rigTemplateFit.ts',
				'fit.leftOut?.length ? withoutBones(whole, fit.leftOut) : whole',
				'whole',
			],
		],
	],
	[
		'keep',
		"the author's kept bones not kept",
		[['rigSheetBones.ts', "for (const b of keep) mark(b, 'kept');", 'void keep;']],
	],
	[
		'keep',
		"a bone's direction not written out when the child giving it goes",
		[
			[
				'rigTemplateModules.ts',
				'gone.has(child.name) ? { ...e, rest: [child.x, child.y] } : e',
				'e',
			],
		],
	],
	[
		'update',
		'the bones the mapping leaves out not taken out of the rig',
		[['rigSheetUpdate.ts', 'const gone = leftOutOf(merged, fit);', 'const gone = [];']],
	],
	[
		'update',
		"the template bone an author's bone hangs from not kept",
		[
			[
				'rigSheetUpdate.ts',
				'if (b.parent !== undefined && off.has(b.parent) && !off.has(b.name))',
				'if (false)',
			],
		],
	],
	[
		'update',
		'the bones a mapping newly needs not put in before the merge',
		[
			[
				'rigSheetUpdate.ts',
				'if (modulesChanged || toBones.some((b) => !from.has(b.name))) {',
				'if (modulesChanged) {',
			],
		],
	],
	[
		'page',
		"the list's toggle not showing a kept bone",
		[['view.html', 'kept: keep.includes(b.name)', 'kept: false']],
	],
];

await runGate('sheet-bones', GUARDS, MUTANTS);
