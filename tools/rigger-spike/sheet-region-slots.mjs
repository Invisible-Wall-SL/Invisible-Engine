// 🗺 From my sheet — one slot per region (docs/design/frame-to-rig.md §13.1h): the owner, on their
// Nelly rig's Slots panel, "the slots are still created based on the old template … it would make
// more sense we had a slot for each region, so they could be driven by the correct bone". Headless on
// the SHIPPED code: the rig 🦴 Create rig makes of the committed sheet fixture under the owner's own
// region names (`owner-sheet.mjs`: S_NellyAnimTest's Photoshop Export Layers names, its face drawn
// apart), keyed by the page's own control code (`view.html`) and engine-rig playing it. Asserted:
//  - slots: one slot per region, each named as its region (past the Photoshop file and index), on the
//    bone its part rides (a prop on its own), no template slot without a region; two regions on one
//    bone each their own slot, the drawings one control swaps between one slot; the Controls name the
//    rig's slots only;
//  - drive: Blink and Look move the drawn lids and pupils, lip-sync opens the jointed mouth and keys
//    no slot the rig lacks, Head turn and a 3D capture's turn slide the face's slots;
//  - update: 🔄 Update rig moves a rig made before onto one slot per region — template slots renamed
//    with their keys (attachment, colour, draw order), props past their Photoshop name with their
//    bones, the empty template slots taken out, the author's Layers order and own slot kept, a second
//    update a no-op, a region mapped anew given its own slot;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-region-slots.mjs [--only <guard>] [--no-mutants]
import * as P from './performer3d.mjs';
import {
	END,
	REGIONS,
	RIG,
	SIZED,
	faceTrack,
	imported,
	middle,
	ownerMapping,
	ownerRig,
	runGate,
	slotOf,
} from './owner-sheet.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const r1 = (v) => Math.round(v * 10) / 10;
const FILE = 'NellyAssetBreakdown1_';
/** What a Photoshop Export Layers name carries before the layer's own: the file, the indices. */
const PREFIX = /\d{4}|nelly|asset|breakdown/;
/** Template slots the owner's sheet draws nothing in: a rig makes none of them. */
const GHOSTS = ['ear_r', 'cheek_l', 'eyelid_l', 'shoulder_l', 'brow_l', 'mouth', 'hair_front'];
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

const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
/** The regions on one 2048² page, as the atlas the rig's bundle has. */
function atlasOf(regions) {
	let [x, y, row] = [0, 0, 0];
	const lines = ['page.png', 'size:2048,2048', 'filter:Linear,Linear'];
	for (const r of regions) {
		if (x + r.w > 2048) [x, y, row] = [0, y + row, 0];
		lines.push(r.name, `bounds:${x},${y},${r.w},${r.h}`);
		[x, row] = [x + r.w, Math.max(row, r.h)];
	}
	return lines.join('\n') + '\n';
}
/** `irig` loaded by engine-rig over `regions`: its pose at `time` of `clip` (null: the setup). */
function player(irig, regions = SIZED, clip = null) {
	const atlas = new RIG.TextureAtlas(atlasOf(regions));
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		clone(irig),
	);
	return (time) => {
		const skel = new RIG.Skeleton(data);
		skel.setToSetupPose();
		if (clip !== null) {
			const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
			state.setAnimation(0, clip, false);
			state.update(time);
			state.apply(skel);
		}
		skel.updateWorldTransform(RIG.Physics.update);
		return skel;
	};
}
/** A slot's drawing's middle in the world (null: nothing shown). */
function at(skel, slotName) {
	const slot = skel.findSlot(slotName);
	const att = slot?.getAttachment();
	if (!att) return null;
	const v = new Float32Array(att instanceof RIG.MeshAttachment ? att.worldVerticesLength : 8);
	if (att instanceof RIG.MeshAttachment) att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
	else att.computeWorldVertices(slot, v, 0, 2);
	return middle(v);
}
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity);

/** The owner's sheet with more regions mapped to `parts` (each placed by a pivot at its middle). */
function withRegions(M, parts) {
	const mapping = ownerMapping(M);
	const added = Object.entries(parts).map(([part, [layer, w, h]], i) => ({
		part,
		name: FILE + layer,
		x: 1200 + i * 120,
		y: 1500,
		w,
		h,
	}));
	for (const a of added)
		mapping.parts[a.part] = { region: a.name, joints: { pivot: [a.w / 2, a.h / 2] } };
	const regions = [...SIZED, ...added.map(({ name, w, h }) => ({ name, w, h }))];
	return { mapping, regions };
}
/** What 🦴 Create rig makes of `mapping` over `regions`: the `.irig`, the fit and its template. */
function create(M, mapping, regions = SIZED, roles = false) {
	const parsed = M.parseSheetMapping(clone(mapping));
	if ('problem' in parsed) throw new Error(parsed.problem);
	const t = M.asMapped(M.HALF_BODY, parsed.mapping);
	const sr = M.sheetRig(t, regions, parsed.mapping);
	if (!sr.ok) throw new Error(sr.problem);
	// `roles`: as made before one slot per region, every slot by the template's name (and before the
	// skeleton followed the mapping, every bone of the template).
	const { slots: names, ...fit } = sr.value.fit;
	delete fit.leftOut;
	const irig = M.templateRig(t, regions, roles ? fit : sr.value.fit, sr.value.art).skeleton;
	return {
		irig,
		fit: sr.value.fit,
		names,
		mapping: parsed.mapping,
		tpl: M.fitTemplate(t, sr.value.fit),
	};
}
/** The region each slot of `irig` draws (its attachments' paths), by slot. */
const drawnIn = (irig) =>
	new Map(
		Object.entries(irig.skins[0].attachments).map(([slot, by]) => [
			slot,
			Object.entries(by).map(([name, att]) => att.path ?? name),
		]),
	);

const GUARDS = {
	/**
	 * One slot per region, named as the region is, on its part's bone; no template slot without a
	 * region; two regions on one bone each their own slot, a control's swaps one slot; the Controls
	 * name the rig's own slots.
	 */
	slots(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const { irig, sr, mapping } = rig;
		const names = irig.slots.map((s) => s.name);
		const regions = drawnIn(irig);
		const drawn = [...regions.values()].flat();
		good =
			ok(
				`slots: one slot per region (${REGIONS.length}), each region drawn in exactly one`,
				names.length === REGIONS.length &&
					REGIONS.every((r) => drawn.filter((x) => x === r.name).length === 1) &&
					names.every((n) => regions.get(n)?.length === 1),
				`${names.length} slots: ${names.join(' ')}`,
			) && good;
		const props = new Set(mapping.props.map((p) => p.name));
		const named = (n) =>
			n === (props.has(n) ? M.propName(regions.get(n)[0]) : M.customName(regions.get(n)[0]));
		good =
			ok(
				'slots: each named as its region past the Photoshop file and index (UpperEyelidL → upper_eyelid_l), each once',
				names.every((n) => /^[a-z][a-z0-9_]*$/.test(n) && !PREFIX.test(n) && named(n)) &&
					new Set(names).size === names.length &&
					['upper_eyelid_l', 'under_eyelid_r', 'fore_arm_l', 'hand_r_pissoff', 'prop_chain'].every(
						(n) => names.includes(n),
					),
				names.join(' '),
			) && good;
		const roleOf = new Map(Object.entries(sr.fit.slots).map(([r, n]) => [n, r]));
		const t = M.HALF_BODY;
		const want = (n) =>
			props.has(n) ? n : (t.slots.find((s) => s.name === roleOf.get(n))?.bone ?? '?');
		const off = irig.slots.filter((s) => s.bone !== want(s.name));
		good =
			ok(
				"slots: each on the bone its part rides (the template slot's), a prop on its own",
				!off.length && irig.slots.every((s) => irig.bones.some((b) => b.name === s.bone)),
				off.map((s) => `${s.name} on ${s.bone}, not ${want(s.name)}`).join('; '),
			) && good;
		good =
			ok(
				'slots: no template slot without a region (no ear, cheek, eyelid, shoulder, brow, mouth or hair)',
				names.every((n) => props.has(n) || roleOf.has(n)) &&
					GHOSTS.every((g) => !names.includes(g) && !(g in sr.fit.slots)),
				names.filter((n) => !props.has(n) && !roleOf.has(n)).join(' '),
			) && good;
		// What the Rigger's Controls and a 3D bake read: the fitted template, by the rig's names.
		const ft = rig.tpl;
		const have = new Set(names);
		const stray = ft.channels.flatMap((c) => [
			...(c.slot !== undefined ? [c.slot] : []),
			...(c.hides ?? []).map((h) => h.slot),
			...(c.order?.slots ?? []),
			...(c.order?.steps ?? []).map((s) => s.behind),
			...(c.shapes && !c.shapes.drawn ? [c.shapes.slot] : []),
		]);
		const three = [
			...Object.values(ft.rig3d?.layers ?? {}).flat(),
			...Object.keys(ft.rig3d?.views ?? {}),
		];
		const mouth = ft.channels.find((c) => c.id === 'mouth');
		good =
			ok(
				"slots: the Controls and the 3D layers name the rig's slots only (the mouth's shapes kept for its jointed mouth)",
				ft.slots.map((s) => s.name).join() === names.join() &&
					[...stray, ...three].every((n) => have.has(n)) &&
					stray.length > 4 &&
					mouth?.shapes?.drawn === true,
				[...stray, ...three].filter((n) => !have.has(n)).join(' '),
			) && good;
		// Two regions on the left eye's bone: its white, and its lid drawn half and closed — the two
		// drawings Blink swaps between, so one slot.
		const eyes = withRegions(M, {
			eye_white_l: ['0002s_0002s_0004_EyeWhiteL', 90, 50],
			eyelid_l_half: ['0002s_0002s_0005_EyelidLHalf', 99, 50],
			eyelid_l_closed: ['0002s_0002s_0006_EyelidLClosed', 99, 50],
		});
		const two = create(M, eyes.mapping, eyes.regions);
		const lid = two.names.eyelid_l;
		const lidSlot = two.irig.slots.find((s) => s.name === lid);
		const whiteSlot = two.irig.slots.find((s) => s.name === two.names.eye_white_l);
		const blink = two.tpl.channels.find((c) => c.id === 'blink_l');
		const K = M.page(KEYING, KEYING_CONSTS);
		const skin = two.irig.skins[0].attachments;
		const has = (slot, part) => !!skin[slot]?.[part];
		const anim = {};
		for (const [time, v] of [
			[0, 0],
			[0.5, 0.5],
			[1, 1],
		])
			K.faceKeyChannel(anim, blink, v, time, has);
		const play = player({ ...two.irig, animations: { blink: anim } }, eyes.regions, 'blink');
		const shown = [0, 0.5, 1].map(
			(time) => play(time).findSlot(lid)?.getAttachment()?.name ?? null,
		);
		good =
			ok(
				'slots: two regions on one bone each their own slot; the drawings a control swaps between, one',
				two.irig.slots.length === eyes.regions.length - 1 &&
					whiteSlot?.bone === 'eye_l' &&
					lidSlot?.bone === 'eye_l' &&
					whiteSlot.name === 'eye_white_l' &&
					lid === 'eyelid_l_half' &&
					Object.keys(skin[lid] ?? {}).join() === 'eyelid_l_half,eyelid_l_closed' &&
					shown.join() === ',eyelid_l_half,eyelid_l_closed',
				JSON.stringify({ lid, white: whiteSlot?.name, shown, n: two.irig.slots.length }),
			) && good;
		log(
			`${names.length} slots for ${REGIONS.length} regions, e.g. ${slotOf(rig, 'lid_upper_l')} on ${irig.slots.find((s) => s.name === slotOf(rig, 'lid_upper_l')).bone}; Blink swaps ${shown.slice(1).join(' → ')} in ${lid}`,
		);
		return good;
	},

	/** Blink, Look, lip-sync, Head turn and a 3D capture drive the right slots by their new names. */
	drive(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const K = M.page(KEYING, KEYING_CONSTS);
		const channels = rig.tpl.channels;
		const ch = (id) => channels.find((c) => c.id === id);
		const skin = rig.irig.skins[0].attachments;
		const has = (slot, part) => !!skin[slot]?.[part];
		const s = (role) => slotOf(rig, role);
		/** The rig posed by one control at `value` (keyed at 0.5 s, from rest at 0), played at 0.5 s. */
		const keyed = (id, value) => {
			const anim = {};
			K.faceKeyChannel(anim, ch(id), ch(id).rest, 0, has, channels, rig.setup);
			K.faceKeyChannel(anim, ch(id), value, 0.5, has, channels, rig.setup);
			return player({ ...rig.irig, animations: { a: anim } }, SIZED, 'a')(0.5);
		};
		const rest = player(rig.irig)(null);
		const moved = (skel, role) => dist(at(rest, s(role)), at(skel, s(role)));
		const blink = keyed('blink_l', 1);
		const lidPer = Math.abs(ch('blink_l').drives[0].per);
		const gaze = keyed('gaze_x', 1);
		good =
			ok(
				'drive: Blink lowers the upper lid drawn in its region-named slot; Look moves both pupils, the lids stay',
				at(rest, s('lid_upper_l'))[1] - at(blink, s('lid_upper_l'))[1] > 0.75 * lidPer &&
					moved(blink, 'pupil_l') < 1e-6 &&
					moved(gaze, 'pupil_l') > 2 &&
					moved(gaze, 'pupil_r') > 2 &&
					moved(gaze, 'lid_upper_l') < 1e-6,
				`lid ${r1(at(rest, s('lid_upper_l'))[1] - at(blink, s('lid_upper_l'))[1])} of ${r1(lidPer)}, pupils ${r1(moved(gaze, 'pupil_l'))}`,
			) && good;
		// Lip-sync on the jointed mouth: the widest shape the letters map, then the rest.
		const mouth = ch('mouth');
		const open = mouth.shapes.open;
		const [wide] = Object.entries(mouth.shapes.lipsync).sort(
			(a, b) => (open[b[1]] ?? 0) - (open[a[1]] ?? 0),
		)[0];
		const anim = {};
		K.faceKeyLipSync(
			anim,
			mouth,
			[
				{ start: 0, end: 0.2, value: 'X' },
				{ start: 0.2, end: 0.8, value: wide },
				{ start: 0.8, end: 1, value: 'X' },
			],
			0,
			channels,
			has,
		);
		let talk;
		try {
			talk = player({ ...rig.irig, animations: { talk: anim } }, SIZED, 'talk');
		} catch (e) {
			talk = e;
		}
		// The jaw's move at the wide shape's key (0.2 s): the Jaw control's per, by how far it opens.
		// The lip is bent on corners that stay, so its drawing's middle drops part of it.
		const jawMove = Math.abs(ch('jaw').drives[0].per) * (open[mouth.shapes.lipsync[wide]] ?? 0);
		const lipOpen =
			talk instanceof Function
				? at(talk(0), s('lip_lower'))[1] - at(talk(0.2), s('lip_lower'))[1]
				: 0;
		const upperStill =
			talk instanceof Function
				? dist(at(talk(0), s('lip_upper')), at(talk(0.2), s('lip_upper')))
				: Infinity;
		good =
			ok(
				'drive: lip-sync opens the jointed mouth (the lower lip drops with the jaw, the upper stays) and keys no slot the rig lacks',
				talk instanceof Function &&
					Object.keys(anim.slots ?? {}).every((n) => rig.setup.includes(n)) &&
					jawMove > 5 &&
					lipOpen > 0.3 * jawMove &&
					upperStill < 0.05 * jawMove,
				talk instanceof Function
					? `lower lip ${r1(lipOpen)} of the jaw's ${r1(jawMove)}, upper ${r1(upperStill)}, slots keyed ${Object.keys(anim.slots ?? {}).join(' ')}`
					: String(talk),
			) && good;
		const turn = keyed('head_turn', ch('head_turn').max);
		const slid = (role) => Math.abs(at(turn, s(role))[0] - at(rest, s(role))[0]);
		good =
			ok(
				'drive: Head turn slides the face across the head, its nose and pupils and the glasses worn on it, not the body',
				slid('nose') > 2 && slid('pupil_l') > 2 && slid('prop_glasses') > 2 && slid('torso') < 1e-6,
				`nose ${r1(slid('nose'))}, pupil ${r1(slid('pupil_l'))}, glasses ${r1(slid('prop_glasses'))}`,
			) && good;
		// A 3D capture turning the performer's face 25°, keyed and baked as 🎥 Motion does.
		let captured;
		try {
			captured = player(
				imported(
					rig,
					faceTrack((k) => P.ry(25 * k)),
				).irig,
				SIZED,
				'imp',
			);
		} catch (e) {
			captured = e;
		}
		const yaw =
			captured instanceof Function
				? Math.abs(at(captured(END), s('nose'))[0] - at(captured(0), s('nose'))[0])
				: 0;
		good =
			ok(
				"drive: a 3D capture's 25° turn, imported and baked, slides the nose's slot across the head",
				yaw > 5,
				captured instanceof Function ? `${r1(yaw)}` : String(captured),
			) && good;
		log(
			`blink ${r1(lidPer)}, lip-sync "${wide}" drops the lower lip ${r1(lipOpen)}, Head turn slides the nose ${r1(slid('nose'))}, a capture ${r1(yaw)}`,
		);
		return good;
	},

	/**
	 * 🔄 Update rig on a rig made before one slot per region: every slot renamed with its keys, the
	 * empty template slots out, the Layers and the author's slot kept, then a no-op; a region mapped
	 * anew gets its own slot.
	 */
	update(M, ok, log) {
		let good = true;
		const t = M.HALF_BODY;
		// The owner's mapping as kept before: props named with the Photoshop file's name, the author's
		// Layers (the chain behind the torso).
		const kept = ownerMapping(M);
		kept.props = kept.props.map((p) => ({ ...p, name: M.rawPropName(p.region) }));
		const chain = kept.props.find((p) => /chain/.test(p.name)).name;
		const slotOfPart = (part) => t.parts.find((p) => p.name === part)?.slot ?? part;
		const list = M.sheetLayerList(
			t.slots.map((s) => s.name),
			slotOfPart,
			kept,
		);
		list.splice(list.indexOf(chain), 1);
		list.splice(list.indexOf('torso') + 1, 0, chain);
		kept.layers = list;
		const old = create(M, kept, SIZED, true);
		const before = old.irig;
		before.slots.push({ name: 'user_glow', bone: 'chest' });
		const hand = before.slots.findIndex((s) => s.name === 'hand_l');
		before.animations.wave = {
			slots: {
				lid_upper_l: {
					rgba: [
						{ time: 0, color: 'ffffffff' },
						{ time: 0.5, color: 'ff8080ff' },
					],
				},
				hand_l: {
					attachment: [{ time: 0, name: 'hand_l' }, { time: 0.4 }, { time: 0.8, name: 'hand_l' }],
				},
				[chain]: { rgba: [{ time: 0.2, color: 'ffffff80' }] },
				eyelid_l: { attachment: [{ time: 0.3 }] },
			},
			bones: {
				[chain]: {
					rotate: [
						{ time: 0, value: 0 },
						{ time: 0.6, value: 20 },
					],
				},
			},
			drawOrder: [
				{ time: 0.5, offsets: [{ slot: 'hand_l', offset: before.slots.length - 1 - hand }] },
			],
		};
		const update = (was, mapping, current, regions = SIZED) => {
			const r = M.updateSheetRig({ template: t, regions, was, mapping, current });
			if (!r.ok) throw new Error(r.problem);
			return r.value;
		};
		const res = update(old.mapping, old.mapping, before);
		const doc = res.doc;
		const fresh = create(M, res.mapping);
		const names = doc.slots.map((s) => s.name);
		const ren = res.report.renamed;
		good =
			ok(
				"update: one slot per region, as a new rig of the mapping has them, and the author's own",
				names.length === REGIONS.length + 1 &&
					[...fresh.irig.slots.map((s) => s.name), 'user_glow'].sort().join() ===
						[...names].sort().join(),
				names.join(' '),
			) && good;
		good =
			ok(
				'update: each template slot renamed after its region, the props past their Photoshop name with their bones',
				ren.slots.lid_upper_l === 'upper_eyelid_l' &&
					ren.slots.hand_l === 'hand_l_pointing' &&
					ren.slots[chain] === 'prop_chain' &&
					ren.bones[chain] === 'prop_chain' &&
					doc.bones.some((b) => b.name === 'prop_chain') &&
					!doc.bones.some((b) => b.name === chain) &&
					names.every((n) => !PREFIX.test(n)),
				JSON.stringify(ren.slots),
			) && good;
		good =
			ok(
				'update: the empty template slots taken out (ear, cheek, eyelid, shoulder, brow, mouth, hair)',
				GHOSTS.every((g) => ren.dropped.includes(g) && !names.includes(g)),
				ren.dropped.join(' '),
			) && good;
		const [w0, w1] = [before.animations.wave, doc.animations.wave];
		const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
		good =
			ok(
				'update: the keys on each renamed slot and bone carried over (colour, attachment, the prop bone), the empty slot’s gone',
				same(w1.slots?.upper_eyelid_l?.rgba, w0.slots.lid_upper_l.rgba) &&
					same(w1.slots?.hand_l_pointing?.attachment, w0.slots.hand_l.attachment) &&
					same(w1.slots?.prop_chain?.rgba, w0.slots[chain].rgba) &&
					same(w1.bones?.prop_chain?.rotate, w0.bones[chain].rotate) &&
					!w1.slots?.eyelid_l &&
					!w1.slots?.[chain] &&
					!w1.bones?.[chain],
				JSON.stringify(w1),
			) && good;
		// Through engine-rig: the draw-order key still draws what it drew, by the new names.
		const renamed = (n) => ren.slots[n] ?? n;
		const order = (irig, time) =>
			player(irig, SIZED, 'wave')(time).drawOrder.map((s) => s.data.name);
		const wasKeyed = order(before, 0.6)
			.filter((n) => !ren.dropped.includes(n))
			.map(renamed);
		const wasSetup = before.slots
			.map((s) => s.name)
			.filter((n) => !ren.dropped.includes(n))
			.map(renamed);
		good =
			ok(
				"update: the draw-order key still draws what it drew, and the setup keeps the author's Layers (the chain behind the torso)",
				order(doc, 0.6).join() === wasKeyed.join() &&
					names.join() === wasSetup.join() &&
					names.indexOf('prop_chain') + 1 === names.indexOf('torso') &&
					res.report.layered.length === 0,
				`${order(doc, 0.6).join(' ')}\n        ${wasKeyed.join(' ')}`,
			) && good;
		good =
			ok(
				'update: the mapping kept with the props named past the Photoshop file, its Layers following',
				res.mapping.props.every((p) => p.name === M.propName(p.region)) &&
					res.mapping.layers.includes('prop_chain') &&
					!res.mapping.layers.includes(chain),
				JSON.stringify(res.mapping.layers),
			) && good;
		const again = update(res.mapping, res.mapping, doc);
		good =
			ok(
				'update: a second update renames and takes out nothing',
				!Object.keys(again.report.renamed.slots).length &&
					!again.report.renamed.dropped.length &&
					again.doc.slots.map((s) => s.name).join() === names.join(),
				JSON.stringify(again.report.renamed),
			) && good;
		// A region mapped anew (the left ear) gets a slot of its own, on its part's bone.
		const ear = withRegions(M, { ear_l: ['0003s_0000_EarL', 40, 60] });
		const earMapping = {
			...clone(res.mapping),
			parts: { ...res.mapping.parts, ear_l: ear.mapping.parts.ear_l },
		};
		const eared = update(res.mapping, earMapping, doc, ear.regions);
		const earSlot = eared.doc.slots.find((s) => s.name === 'ear_l');
		good =
			ok(
				'update: a region mapped anew gets its own slot, on its part’s bone, drawing it',
				earSlot?.bone === t.slots.find((s) => s.name === 'ear_l').bone &&
					earSlot.attachment === 'ear_l' &&
					eared.doc.skins[0].attachments.ear_l?.ear_l?.path === FILE + '0003s_0000_EarL' &&
					eared.doc.slots.length === names.length + 1,
				JSON.stringify(earSlot),
			) && good;
		// On the rig made before, a region named like an empty template slot (the ear drawn in a layer
		// called CheekL): that slot goes first, so the ear's takes its name on the ear's bone.
		const cheek = withRegions(M, { ear_l: ['0003s_0001_CheekL', 40, 60] });
		const cheekEar = update(
			old.mapping,
			{ ...clone(old.mapping), parts: { ...old.mapping.parts, ear_l: cheek.mapping.parts.ear_l } },
			before,
			cheek.regions,
		);
		const taken = cheekEar.doc.slots.find((s) => s.name === 'cheek_l');
		good =
			ok(
				'update: a region named like an empty template slot takes its name, on its own part’s bone',
				taken?.bone === t.slots.find((s) => s.name === 'ear_l').bone &&
					taken.attachment === 'ear_l' &&
					Object.keys(cheekEar.doc.skins[0].attachments.cheek_l ?? {}).join() === 'ear_l' &&
					cheekEar.report.renamed.dropped.includes('cheek_l'),
				JSON.stringify(taken),
			) && good;
		let plays = true;
		try {
			player(doc, SIZED, 'wave')(0.5);
		} catch {
			plays = false;
		}
		good = ok('update: the updated rig loads and plays in engine-rig', plays) && good;
		log(
			`${before.slots.length} slots → ${names.length}: ${Object.keys(ren.slots).length} renamed, ${ren.dropped.length} taken out`,
		);
		return good;
	},
};

const MAP = 'rigSheetMap.ts';
const FIT = 'rigSheetFit.ts';
const REGION = 'rigRegionSlots.ts';
const UPD = 'rigSheetUpdate.ts';
await runGate('sheet-region-slots', GUARDS, [
	[
		'slots',
		'a slot named with the Photoshop file and index',
		[
			[
				MAP,
				"const base = nameWords(layerName(region)).join('_').slice(0, 41);",
				"const base = nameWords(region).join('_').slice(0, 41);",
			],
		],
	],
	['slots', 'every template slot made (no role map)', [[FIT, '\tfit.slots = names;\n', '']]],
	[
		'slots',
		"the template's slot names kept",
		[[REGION, 'Object.hasOwn(names, slot) ? names[slot]', 'Object.hasOwn(names, slot) ? slot']],
	],
	[
		'slots',
		"a depth control naming the template's slots",
		[
			[
				REGION,
				'const moved = order ? named(order.slots) : [];',
				'const moved = order ? [...order.slots] : [];',
			],
		],
	],
	[
		'slots',
		'the slot a control swaps in named by its last drawing, not its main one',
		[
			[
				'rigSheetMap.ts',
				'const main = drawn.find((p) => p.name === slot) ?? drawn[0];\n\t\tif (!main) continue;',
				'const main = drawn.at(-1);\n\t\tif (!main) continue;',
			],
		],
	],
	[
		'drive',
		"the mouth's shapes dropped with its slot",
		[[REGION, '{ ...shapes, drawn: true as const }', 'shapes']],
	],
	[
		'drive',
		'lip-sync keying the mouth slot the rig lacks',
		[
			[
				'view.html',
				'if (!ch.shapes.drawn) faceKeyAttachment(anim, ch.shapes.slot, shown, t);',
				'faceKeyAttachment(anim, ch.shapes.slot, shown, t);',
			],
		],
	],
	[
		'update',
		'template slots not renamed',
		[[UPD, 'from !== to && !slots.has(from))', 'from !== to && false)']],
	],
	['update', 'the empty template slots kept', [[UPD, 'stale.has(n) &&', 'false &&']]],
	[
		'update',
		'an empty template slot kept until after the renames, holding a name a region takes',
		[
			[
				UPD,
				'\tdropSlots(doc, dropped);\n\tconst have = slotNames(doc);',
				'\tconst have = slotNames(doc);',
			],
		],
	],
	[
		'update',
		'props kept with their Photoshop names',
		[
			[
				UPD,
				'if (p.custom || out.has(p.name) || p.name !== rawPropName(p.region)) continue;',
				'continue;',
			],
		],
	],
	[
		'update',
		"a renamed slot's keys left under its old name",
		[['rigRename.ts', '\t\t\ta.slots = rekeyed(a.slots, r.slots);\n', '']],
	],
	[
		'update',
		'a region mapped anew given no slot',
		[['rigFrameUpdate.ts', 'isProp(name) || !!input.newSlots?.has(name);', 'isProp(name);']],
	],
]);
