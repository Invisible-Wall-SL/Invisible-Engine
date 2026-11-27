// A rig's modules changed in place (docs/design/rig-modules.md §4), headless on the SHIPPED code: a
// Half body rig made with fingers over placeholder art, keyed and with an author's weighted mesh on
// its fingers (and, past them in the bone list, the right arm), taken to no hands and back (`changeModules`), and the owner's 🗺 From my sheet rig
// updated with its mapping's Hands changed (`updateSheetRig`), posed by engine-rig as a game does.
// Asserted:
//  - remove: no hands takes out the fingers and the hand's slot with their keys, keeps every other
//    key and the arm's IK, hands an author's mesh weighted to a finger up to the hand where it
//    stands (it draws where it did), and keeps every draw-order key drawing what it drew;
//  - refuse: a bone or a slot of the author's on a finger is not taken out with it: the change is
//    refused, saying which;
//  - add: back to fingers, the fingers and the hand's drawing come back where a new rig has them,
//    bound to the rig's bones, and the clip still plays;
//  - sheet: 🗺 Edit mapping with Hands → None, then 🔄 Update rig, takes the hands out of the owner's
//    rig (said in the report, the new set's controls sent back) and Hands → With fingers with the
//    hands mapped puts them back;
//  - page: the page drops what went from the rig's control layer and 3D data, and takes the new
//    set's controls for what came (`modulesOnSidecars`);
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/rig-modules-change.mjs [--only <guard>] [--no-mutants]
import {
	RIG,
	SIZED,
	drawn,
	ownerMapping,
	ownerRig,
	player,
	runGate,
	slotOf,
} from './owner-sheet.mjs';

const FINGER = /^(thumb|index|middle|ring|pinky)_/;
const NONE = { hands: 'none' };

/** Template `t` over placeholder art (a region per part): the rig and its atlas text. */
function madeOver(M, t, art = t.parts) {
	const regions = art.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const lines = ['page.png', 'size:8192,8192', 'filter:Linear,Linear'];
	regions.forEach((r, i) =>
		lines.push(r.name, `bounds:${(i % 40) * 200},${Math.floor(i / 40) * 400},${r.w},${r.h}`),
	);
	return { irig: M.templateRig(t, regions).skeleton, atlas: lines.join('\n') + '\n' };
}
/** Rig `irig` (over `atlasText`) posed by engine-rig at `time` of `clip` (null: setup). */
function pose(irig, atlasText, clip = null, time = 0) {
	const atlas = new RIG.TextureAtlas(atlasText);
	for (const p of atlas.pages)
		p.setTexture({
			getImage: () => ({ width: 1, height: 1 }),
			setFilters() {},
			setWraps() {},
			dispose() {},
		});
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(irig)),
	);
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	if (clip) {
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, clip, false);
		state.update(time);
		state.apply(skel);
	}
	skel.updateWorldTransform(RIG.Physics.update);
	return skel;
}
const far = (a, b) => {
	let most = 0;
	for (let k = 0; k < a.length; k++) most = Math.max(most, Math.abs(a[k] - b[k]));
	return most;
};

/** The fingers rig as an author has it: a clip on the fingers, hand and elbow; a mesh on a finger. */
function authored(M) {
	const whole = M.HALF_BODY;
	const { irig, atlas } = madeOver(M, whole);
	const idx = (n) => irig.bones.findIndex((b) => b.name === n);
	irig.slots.push({ name: 'author_ring', bone: 'lower_arm_l', attachment: 'ring' });
	irig.skins[0].attachments.author_ring = {
		ring: {
			type: 'mesh',
			path: whole.parts[0].name,
			uvs: [0, 0, 1, 0, 0, 1],
			triangles: [0, 1, 2],
			hull: 3,
			width: 10,
			height: 10,
			vertices: [
				1,
				idx('index_2_l'),
				0,
				5,
				1,
				2,
				idx('index_1_l'),
				4,
				0,
				0.5,
				idx('lower_arm_l'),
				6,
				-40,
				0.5,
				1,
				idx('lower_arm_r'),
				0,
				-60,
				1,
			],
		},
	};
	irig.animations = {
		wave: {
			bones: {
				lower_arm_l: {
					rotate: [
						{ time: 0, value: 0 },
						{ time: 0.5, value: 40 },
					],
				},
				index_1_l: { rotate: [{ time: 0.5, value: 20 }] },
				hand_l: { rotate: [{ time: 0.5, value: -15 }] },
			},
			slots: { thumb_1_l: { attachment: [{ time: 0.3 }] } },
			drawOrder: [{ time: 0.2, offsets: [{ slot: 'author_ring', offset: -3 }] }],
		},
	};
	return { whole, irig, atlas };
}

const GUARDS = {
	/** No hands takes the fingers and the hand's slot out with their keys; the rest stays. */
	remove(M, ok, log) {
		const { whole, irig, atlas } = authored(M);
		const none = M.templateWithModules(whole, NONE);
		const res = M.changeModules(irig, whole, none);
		if (!res.ok) return ok('remove: the change is made', false, res.problem);
		const doc = res.doc;
		const [was, now] = [pose(irig, atlas), pose(doc, atlas)];
		const ring = far(drawn(was, 'author_ring'), drawn(now, 'author_ring'));
		const order = (s) =>
			s.drawOrder.map((x) => x.data.name).filter((n) => doc.slots.some((y) => y.name === n));
		const [wasAt, nowAt] = [pose(irig, atlas, 'wave', 0.3), pose(doc, atlas, 'wave', 0.3)];
		const elbow = Math.abs(
			wasAt.findBone('lower_arm_l').rotation - nowAt.findBone('lower_arm_l').rotation,
		);
		const keys = doc.animations.wave;
		log(
			`${irig.bones.length} → ${doc.bones.length} bones, ${irig.slots.length} → ${doc.slots.length} slots, ${res.report.keys} keys out; the author's ring moved ${ring.toFixed(4)}`,
		);
		return (
			ok(
				'remove: no finger bone, no hand slot, the wrist bone kept',
				!doc.bones.some((b) => FINGER.test(b.name)) &&
					!doc.slots.some((s) => s.name === 'hand_l' || FINGER.test(s.name)) &&
					doc.bones.some((b) => b.name === 'hand_l'),
			) &&
			ok(
				'remove: the keys on what went go, the elbow’s stay',
				!keys.bones.index_1_l && !keys.slots?.thumb_1_l && !!keys.bones.lower_arm_l && elbow < 1e-6,
				JSON.stringify(Object.keys(keys.bones)),
			) &&
			ok(
				'remove: the arm’s IK spaces stay',
				(doc.transform ?? []).some((c) => /hand_ik_l/.test(c.name)),
			) &&
			ok(
				'remove: an author’s mesh on a finger is handed up where it stands (it draws where it did)',
				ring <= 0.01,
				ring.toFixed(4),
			) &&
			ok(
				'remove: every draw-order key draws what it drew',
				JSON.stringify(order(wasAt)) === JSON.stringify(order(nowAt)),
				`${order(wasAt).slice(-6)} vs ${order(nowAt).slice(-6)}`,
			)
		);
	},

	/** An author's bone or slot on a finger stops the change. */
	refuse(M, ok, log) {
		const { whole, irig } = authored(M);
		const none = M.templateWithModules(whole, NONE);
		const bone = structuredClone(irig);
		bone.bones.push({ name: 'my_nail', parent: 'index_3_l', y: 5 });
		const slot = structuredClone(irig);
		slot.slots.push({ name: 'my_glove', bone: 'thumb_1_l' });
		const [b, s] = [M.changeModules(bone, whole, none), M.changeModules(slot, whole, none)];
		log(`${b.problem}; ${s.problem}`);
		return (
			ok(
				'refuse: an author’s bone on a finger stops it, named',
				!b.ok && /my_nail/.test(b.problem),
				b.problem,
			) &&
			ok(
				'refuse: an author’s slot on a finger stops it, named',
				!s.ok && /my_glove/.test(s.problem),
				s.problem,
			)
		);
	},

	/** Back to fingers: the fingers and the hand's drawing come back where a new rig has them. */
	add(M, ok, log) {
		const { whole, irig, atlas } = authored(M);
		const none = M.templateWithModules(whole, NONE);
		const out = M.changeModules(irig, whole, none);
		const fresh = madeOver(M, whole).irig;
		const back = M.changeModules(out.doc, none, whole, fresh);
		if (!back.ok) return ok('add: the change is made', false, back.problem);
		const doc = back.doc;
		const [mine, made] = [pose(doc, atlas), pose(fresh, atlas)];
		let off = 0;
		for (const b of fresh.bones.filter((x) => FINGER.test(x.name) || x.name === 'hand_l'))
			off = Math.max(
				off,
				Math.hypot(
					mine.findBone(b.name).worldX - made.findBone(b.name).worldX,
					mine.findBone(b.name).worldY - made.findBone(b.name).worldY,
				),
			);
		const hand = drawn(mine, 'hand_l');
		const handMade = drawn(made, 'hand_l');
		let plays = true;
		try {
			pose(doc, atlas, 'wave', 0.5);
		} catch {
			plays = false;
		}
		log(
			`put back ${back.report.added.bones.length} bones, ${back.report.added.slots.length} slots; the hand ${off.toFixed(4)} off a new rig's`,
		);
		return (
			ok(
				'add: every finger bone back, where a new rig has it',
				fresh.bones
					.filter((x) => FINGER.test(x.name))
					.every((x) => doc.bones.some((y) => y.name === x.name)) && off <= 0.01,
				off.toFixed(4),
			) &&
			ok(
				'add: the hand’s drawing back, bound to the rig’s bones, drawn as a new rig draws it',
				!!hand && !!handMade && far(hand, handMade) <= 0.01,
			) &&
			ok('add: the clip still plays', plays)
		);
	},

	/** 🧩 Modules on a ＋ New rig rig (the route's `planModules`): out and back over its own art. */
	plan(M, ok, log) {
		const { whole, irig } = authored(M);
		const regions = whole.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
		const out = M.planModules({ whole, now: NONE, regions, current: irig });
		const bad = M.planModules({ whole, now: { hands: 'paws' }, regions, current: irig });
		if (!out.ok) return ok('plan: the change is planned', false, out.problem);
		const back = M.planModules({ whole, was: NONE, now: {}, regions, current: out.doc });
		if (!back.ok) return ok('plan: the change back is planned', false, back.problem);
		log(
			`out: -${out.report.bones.length} bones, bared ${out.report.bared}; back: +${back.report.added.bones.length} bones, +${back.report.added.slots.length} slots`,
		);
		return (
			ok(
				'plan: no hands planned over the rig’s art, the bare wrists named, the new set’s controls sent',
				!out.doc.bones.some((b) => FINGER.test(b.name)) &&
					JSON.stringify(out.report.bared) === '["hand_l","hand_r"]' &&
					!!out.controls &&
					!out.controls.bones.hand_l,
				JSON.stringify(out.report.bared),
			) &&
			ok(
				'plan: a choice the template lacks is refused',
				!bad.ok && /paws/.test(bad.problem),
				bad.problem,
			) &&
			ok(
				'plan: back to fingers makes them over the rig’s art',
				back.report.added.bones.length === 30 &&
					back.doc.slots.some((s) => s.name === 'hand_l') &&
					!!back.doc.skins[0].attachments.hand_l,
			)
		);
	},

	/** 🗺 Edit mapping with Hands changed, then 🔄 Update rig, takes the hands out and back. */
	sheet(M, ok, log) {
		const handed = ownerRig(M);
		const was = handed.mapping;
		const noHands = M.parseSheetMapping(
			JSON.parse(JSON.stringify(ownerMapping(M, { modules: NONE }))),
		).mapping;
		const out = M.updateSheetRig({
			template: M.HALF_BODY,
			regions: SIZED,
			was,
			mapping: noHands,
			current: handed.irig,
		});
		if (!out.ok) return ok('sheet: the update is made', false, out.problem);
		const back = M.updateSheetRig({
			template: M.HALF_BODY,
			regions: SIZED,
			was: noHands,
			mapping: was,
			current: out.value.doc,
		});
		if (!back.ok) return ok('sheet: the update back is made', false, back.problem);
		const [d1, d2] = [out.value.doc, back.value.doc];
		// The hands' slots by the rig's names for them, their regions' (one slot per region).
		const handSlots = ['hand_l', 'hand_r'].map((r) => slotOf(handed, r));
		const hands = (d) => d.slots.filter((s) => handSlots.includes(s.name)).length;
		let plays = true;
		try {
			player(d2)(null);
		} catch {
			plays = false;
		}
		log(
			`no hands: ${d1.bones.length} bones, ${hands(d1)} hand slots (out ${out.value.report.modules?.bones.length} bones, ${out.value.report.modules?.slots.length} slots); back: ${d2.bones.length} bones, ${hands(d2)} hand slots`,
		);
		return (
			ok(
				'sheet: Hands → None takes the hands out of the rig, said in the report',
				!d1.bones.some((b) => FINGER.test(b.name)) &&
					hands(d1) === 0 &&
					!!out.value.report.modules?.bones.length,
				JSON.stringify(out.value.report.modules?.slots),
			) &&
			ok(
				'sheet: the new set’s controls are sent back for the rig’s own',
				!!out.value.controls && !Object.keys(out.value.controls.bones).some((b) => FINGER.test(b)),
			) &&
			ok(
				'sheet: Hands → With fingers with the hands mapped puts them back, drawn',
				d2.bones.filter((b) => FINGER.test(b.name)).length === 30 &&
					hands(d2) === 2 &&
					!!drawn(player(d2)(null), handSlots[0]) &&
					plays,
			)
		);
	},

	/** The page drops what went from the rig's control layer and 3D data and takes what came. */
	page(M, ok, log) {
		const whole = M.HALF_BODY;
		const none = M.templateWithModules(whole, NONE);
		const F = new Function(
			'controlsDoc',
			'rig3d',
			`${M.pageSource('modulesOnSidecars')}\nreturn modulesOnSidecars;`,
		);
		const controlsDoc = structuredClone({ controls: 1, rig: 'r', ...whole.controls });
		const rig3d = {
			doc: {
				rig3d: 1,
				rig: 'r',
				bones: { index_1_l: { depth: 3 } },
				views: { hand_l: { drawings: [] } },
				layers: structuredClone(whole.rig3d.layers),
				ik: structuredClone(whole.rig3d.ik),
				clips: { c: { bones: { index_1_l: {}, chest: {} } } },
			},
		};
		const out = M.changeModules(madeOver(M, whole).irig, whole, none);
		F(controlsDoc, rig3d)(out.report, none.controls);
		const leftC = [
			...Object.keys(controlsDoc.bones),
			...Object.values(controlsDoc.sets).flat(),
			...controlsDoc.picker.items.map((i) => i.bone ?? ''),
		].filter((b) => FINGER.test(b) || b === 'hand_l');
		const d = rig3d.doc;
		const left3 = [
			...Object.keys(d.bones),
			...Object.keys(d.views),
			...Object.values(d.layers).flat(),
			...Object.keys(d.clips.c.bones),
		].filter((b) => FINGER.test(b) || b === 'hand_l');
		// And back: the fingers' controls come with them.
		const back = M.changeModules(out.doc, none, whole, madeOver(M, whole).irig);
		F(controlsDoc, rig3d)(back.report, whole.controls);
		const fingersBack = Object.keys(controlsDoc.bones).filter((b) => FINGER.test(b)).length;
		log(
			`left after no hands: controls ${leftC.length}, 3D ${left3.length}; finger controls back ${fingersBack}`,
		);
		return (
			ok(
				'page: the control layer and the 3D data name nothing that went',
				!leftC.length && !left3.length && !!d.clips.c.bones.chest,
				`${leftC} | ${left3}`,
			) &&
			ok(
				'page: back to fingers, the fingers’ controls and sets come back',
				fingersBack === 30 && !!controlsDoc.sets.fingers_l,
				String(fingersBack),
			)
		);
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'remove',
		'a weighted vertex’s share of a bone that goes left on it',
		[['rigFrameUpdate.ts', '[lx, ly] = apply(invert(W.get(to)!), ...apply(W.get(n)!, x, y));', '']],
	],
	[
		'remove',
		'the bones put in order without renumbering the weighted vertices',
		[
			[
				'rigFrameUpdate.ts',
				'\t\treorderBones(\n\t\t\tdoc,\n\t\t\tdoc.bones.map((b) => b.name).filter((n) => !goneBones.has(n)),\n\t\t);\n\t\treport.bones.push(...goneBones);',
				'\t\tdoc.bones = doc.bones.filter((b) => !goneBones.has(b.name));\n\t\treport.bones.push(...goneBones);',
			],
		],
	],
	[
		'remove',
		'the draw-order keys not read again without the slots',
		[
			[
				'rigFrameUpdate.ts',
				'\tdoc.slots = (doc.slots ?? []).filter((s) => !goneSlots.has(s.name));\n\treorder();',
				'\tdoc.slots = (doc.slots ?? []).filter((s) => !goneSlots.has(s.name));',
			],
		],
	],
	[
		'refuse',
		'an author’s bone on a finger taken out with it',
		[['rigFrameUpdate.ts', '\tif (strayBone)\n', '\tif (strayBone && false)\n']],
	],
	[
		'add',
		'the slots put back without their drawings',
		[
			[
				'rigFrameUpdate.ts',
				'\t\t\tconst atts = madeSkin?.attachments?.[slot.name];',
				'\t\t\tconst atts = undefined;',
			],
		],
	],
	[
		'plan',
		'the new set’s bare wrists not named (their controls would stay)',
		[
			[
				'rigFrameUpdate.ts',
				'\treport.bared.push(...[...emptied].filter((b) => !doc.slots!.some((s) => s.bone === b)));',
				'',
			],
		],
	],
	[
		'sheet',
		'an update with the modules changed merges as if they were not',
		[
			[
				'rigSheetUpdate.ts',
				'\t\tJSON.stringify(was.template.modules ?? {}) !== JSON.stringify(mapping.template.modules ?? {})',
				'\t\tfalse',
			],
		],
	],
	[
		'page',
		'the page keeps the selection sets naming what went',
		[
			[
				'view.html',
				'c.sets[k] = c.sets[k].filter((b) => !off.has(b)); if (!c.sets[k].length) delete c.sets[k];',
				'void k;',
			],
		],
	],
];

await runGate('rig-modules-change', GUARDS, MUTANTS);
