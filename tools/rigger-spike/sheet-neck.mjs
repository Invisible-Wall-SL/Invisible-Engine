// 🗺 From my sheet: the neck under a 3D capture (the owner, 2026-11-27: "the neck bone is not doing
// the correct thing, and is sliding way too much left and right"), headless on the SHIPPED code: the
// rig 🗺 From my sheet makes of the committed sheet fixture under the owner's own region names
// (`owner-sheet.mjs`), a synthetic performer whose head moves sideways (the neck bent, the head
// slid, rolled and turned) with Face Landmarker's points on it, imported in 3D with 📍 Follow
// positions (the page's default) and baked as the page does, posed by engine-rig as a game does.
// Following used to translate `neck` in the chest's frame onto the face (a 5 cm slide moved it 38
// units off the torso); the neck is a chain now (`neck`, `neck_upper`) bent toward the face. Asserted:
//  - base: the neck's base stays on the torso on every frame of every capture (no translate);
//  - bounded: a face further to the side than a neck bends holds the bend at its limit (reported),
//    and the head travels no further than the chain's arc;
//  - follows: the head still goes onto the face sideways (the marks' middle across the neck), where
//    Angles only leaves it off;
//  - shared: the bend is shared by the chain's bones, and the neck's drawing bends across both (its
//    bottom stays at the collar, its top turns with the upper bone);
//  - update: 🔄 Update rig puts `neck_upper` into a rig made before it — the head hung from it, an
//    author's weighted mesh renumbered, the setup and an old clip posed as before, the report naming
//    it — and a rig made now stands as one made before (the drawn neck shared by the chain);
//  - controls: a rig made before it is given the template with the upper bone folded into `neck`
//    (Head nod turns `neck` alone), and the Controls read an old clip's neck key as the nod it was
//    whether the template shares the nod or not;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-neck.mjs [--only <guard>] [--no-mutants]
import * as P from './performer3d.mjs';
import {
	ATLAS,
	FPS,
	RIG,
	SIZED,
	drawn,
	imported,
	ownerMapping,
	ownerRig,
	player,
	runGate,
} from './owner-sheet.mjs';

const r1 = (v) => Math.round(v * 10) / 10;
const DEG = 180 / Math.PI;

// ---- a performer whose head moves sideways ---------------------------------------------------------
/** The performer's neck: its base (C7) and its top (C1), rig frame, metres from the hips' middle. */
const C7 = [0, 0.5, -0.03];
const C1 = [0, 0.62, -0.02];
/** Face Landmarker's eye corners and mouth corners in the head's frame about C1 (metres). */
const FACE_PTS = [
	[33, [-0.045, 0.07, 0.08]],
	[133, [-0.015, 0.07, 0.085]],
	[362, [0.015, 0.07, 0.085]],
	[263, [0.045, 0.07, 0.08]],
	[61, [-0.025, 0, 0.085]],
	[291, [0.025, 0, 0.085]],
];
const STILL = 24;
const RAMP = 8;
const N = 52;
/** The last frames, the motion held at its full extent and the trackers' smoothing settled. */
const SETTLED = (i) => i >= N - 6;
/**
 * A track: the head moved by `head(k)` (k 0 → 1 over the ramp, then held): `neck` the neck bent
 * sideways about C7 (degrees, counter-clockwise in the picture), `roll` the head turned about C1,
 * `yaw` turned toward the picture's right, `slide` moved sideways (metres); Face Landmarker's points
 * where the head puts them.
 */
function track(head) {
	const at = (i) => head(Math.min(1, Math.max(0, (i - STILL) / RAMP)));
	const t = P.track(N, FPS, (i) => {
		const { neck = 0, roll = 0, yaw = 0 } = at(i);
		return { pose: {}, opts: { hands: true, face: P.mm(P.rz(neck + roll), P.ry(yaw)) } };
	});
	t.frames.forEach((f, i) => {
		const { neck = 0, roll = 0, yaw = 0, slide = 0 } = at(i);
		const top = P.add(P.add(C7, P.ap(P.rz(neck), P.sub(C1, C7))), [slide, 0, 0]);
		const R = P.mm(P.rz(neck + roll), P.ry(yaw));
		const lm = f.face.landmarks.map((p) => p.slice());
		for (const [k, v] of FACE_PTS) {
			const w = P.add(top, P.ap(R, v));
			lm[k] = [0.5 + w[0] * 0.5, 0.45 - w[1] * 0.5];
		}
		f.face.landmarks = lm;
	});
	return t;
}
const CAPTURES = {
	'a 5 cm slide': (k) => ({ slide: 0.05 * k }),
	'the neck bent 20°': (k) => ({ neck: -20 * k }),
	'a 20° roll': (k) => ({ roll: 20 * k }),
	'a 35° turn': (k) => ({ yaw: 35 * k }),
};

// ---- the rig, the import, the pose --------------------------------------------------------------
/** The picture's shoulders on the rig's (as the reference overlay lines them up by default). */
function lineUp(irig) {
	const s = player(irig)(null);
	const [l, r] = ['l', 'r'].map((x) => s.findBone(`upper_arm_${x}`));
	const k = Math.hypot(r.worldX - l.worldX, r.worldY - l.worldY) / 180;
	return { k, x0: (l.worldX + r.worldX) / 2 - k * 500, y0: (l.worldY + r.worldY) / 2 + k * 200 };
}
/** `capture` imported into `rig` in 3D, following positions unless `angles`, and played. */
function run(rig, capture, { angles = false } = {}) {
	const t = track(capture);
	const lu = lineUp(rig.irig);
	const opts = angles ? {} : { follow: { lineUp: lu, depths: { ...rig.tpl.rig3d.depths } } };
	const solved = rig.M.solveMotion(
		{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
		t,
		{ three: true, face: true, body: true, hand: true, ...opts },
	);
	const out = imported(rig, t, opts);
	const at = player(out.irig);
	const toRig = (p) => [lu.x0 + lu.k * p[0] * P.W, lu.y0 - lu.k * p[1] * P.H];
	return { t, solved, irig: out.irig, at: (i) => at(i / FPS + 1e-4), toRig };
}
/** Where world point `p` lies in bone `frame`'s frame. */
function inFrame(skel, frame, p) {
	const v = { x: p[0], y: p[1] };
	skel.findBone(frame).worldToLocal(v);
	return [v.x, v.y];
}
const placeOf = (skel, b) => [skel.findBone(b).worldX, skel.findBone(b).worldY];
const turnOf = (skel, b) => {
	const x = skel.findBone(b);
	return Math.atan2(x.c, x.a) * DEG;
};
const fold = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const MARKS = ['eye_l', 'eye_r', 'mouth_corner_l', 'mouth_corner_r'];
const FACE_MARKS = [[33, 133], [362, 263], [61], [291]];
/** The marks' middle across the neck (the chest's x) less the tracked one's, rig units. */
function across(r, i) {
	const skel = r.at(i);
	const lm = r.t.frames[i].face.landmarks;
	const mean = (ps) => [0, 1].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length);
	const rig = mean(MARKS.map((b) => placeOf(skel, b)));
	const tracked = mean(FACE_MARKS.map((ks) => r.toRig(mean(ks.map((k) => lm[k])))));
	return inFrame(skel, 'chest', rig)[0] - inFrame(skel, 'chest', tracked)[0];
}
/** The rig the owner's sheet made before the neck had its upper bone (its template folded). */
function madeBefore(M) {
	const t = M.templateWithLinks(
		M.HALF_BODY,
		new Set(M.HALF_BODY.bones.map((b) => b.name).filter((n) => n !== 'neck_upper')),
	);
	const mapping = M.parseSheetMapping(JSON.parse(JSON.stringify(ownerMapping(M)))).mapping;
	const sr = M.sheetRig(t, SIZED, mapping);
	if (!sr.ok) throw new Error(sr.problem);
	return { t, mapping, irig: M.templateRig(t, SIZED, sr.value.fit, sr.value.art).skeleton };
}

const GUARDS = {
	/** The neck's base stays on the torso on every frame of every capture. */
	base(M, ok, log) {
		const rig = ownerRig(M);
		let good = true;
		const rows = [];
		for (const [what, capture] of Object.entries(CAPTURES)) {
			const r = run(rig, capture);
			const rest = inFrame(r.at(0), 'chest', placeOf(r.at(0), 'neck'));
			let off = 0;
			for (let i = 0; i < N; i++) {
				const p = inFrame(r.at(i), 'chest', placeOf(r.at(i), 'neck'));
				off = Math.max(off, Math.hypot(p[0] - rest[0], p[1] - rest[1]));
			}
			rows.push(`${what} ${r1(off)}`);
			good =
				ok(
					`base (${what}): the neck's base stays where it sits on the torso`,
					off <= 0.5,
					`${r1(off)} units off`,
				) && good;
		}
		log(`the neck's base off the torso: ${rows.join(', ')}`);
		return good;
	},

	/** A face further to the side than the neck bends: held at the limit, the head on the arc. */
	bounded(M, ok, log) {
		const rig = ownerRig(M);
		const r = run(rig, (k) => ({ slide: 0.08 * k }));
		const neck = r.solved.follow?.neck;
		const limit = rig.tpl.motion.bones3d.positions.neck.limit;
		const bone = (n) => rig.irig.bones.find((b) => b.name === n);
		const [a, b] = ['neck_upper', 'head'].map((n) => Math.hypot(bone(n).x ?? 0, bone(n).y ?? 0));
		const th = limit / DEG;
		const arc = Math.hypot(
			-a * Math.sin(th / 2) - b * Math.sin(th),
			a * Math.cos(th / 2) + b * Math.cos(th) - a - b,
		);
		const rest = inFrame(r.at(0), 'chest', placeOf(r.at(0), 'head'));
		let travel = 0;
		let held = 0;
		for (let i = 0; i < N; i++) {
			const s = r.at(i);
			const p = inFrame(s, 'chest', placeOf(s, 'head'));
			travel = Math.max(travel, Math.hypot(p[0] - rest[0], p[1] - rest[1]));
			if (SETTLED(i))
				held = Math.max(held, Math.abs(fold(turnOf(s, 'neck_upper') - turnOf(s, 'chest'))));
		}
		log(
			`an 8 cm slide: bent ${r1(held)}° (limit ${limit}°, ${neck?.clamped} frames held), the head ${r1(travel)} off (its arc ${r1(arc)})`,
		);
		return (
			ok(
				'bounded: a face further to the side than the neck bends is reported…',
				!!neck && neck.clamped >= 6 && neck.max === limit,
				JSON.stringify(neck),
			) &&
			ok('…the neck held at its limit there…', Math.abs(held - limit) <= 1.5, `${r1(held)}°`) &&
			ok(
				'…and the head no further than the chain bent that far',
				travel <= arc + 1,
				`${r1(travel)} vs ${r1(arc)}`,
			)
		);
	},

	/** The head still goes onto the face sideways, where Angles only leaves it off. */
	follows(M, ok, log) {
		const rig = ownerRig(M);
		let good = true;
		const rows = [];
		for (const [what, capture] of [
			['the neck bent 20°', CAPTURES['the neck bent 20°']],
			['a 3 cm slide', (k) => ({ slide: 0.03 * k })],
		]) {
			const [f, a] = [run(rig, capture), run(rig, capture, { angles: true })];
			const miss = (r) =>
				Math.max(...[...Array(N).keys()].filter(SETTLED).map((i) => Math.abs(across(r, i))));
			const [mf, ma] = [miss(f), miss(a)];
			rows.push(`${what}: ${r1(ma)} → ${r1(mf)}`);
			good =
				ok(
					`follows (${what}): precondition, Angles only leaves the face off to the side`,
					ma >= 8,
					r1(ma),
				) &&
				ok(
					`follows (${what}): the neck bends the face onto the tracked one, across the neck`,
					mf <= 2,
					r1(mf),
				) &&
				good;
		}
		log(`the marks' middle off the face across the neck, Angles only → Follow: ${rows.join('; ')}`);
		return good;
	},

	/** The bend is shared by the chain's bones; the neck's drawing bends across both. */
	shared(M, ok, log) {
		const rig = ownerRig(M);
		const r = run(rig, CAPTURES['the neck bent 20°']);
		const s = r.at(N - 1);
		const [lo, hi] = [
			fold(turnOf(s, 'neck') - turnOf(s, 'chest')),
			fold(turnOf(s, 'neck_upper') - turnOf(s, 'neck')),
		];
		const skin = rig.irig.skins[0].attachments.neck;
		const att = skin && Object.values(skin)[0];
		const names = new Set();
		const v = att?.vertices ?? [];
		if (att?.uvs && v.length > att.uvs.length)
			for (let k = 0; k < v.length;) {
				const c = v[k++];
				for (let j = 0; j < c; j++, k += 4) names.add(rig.irig.bones[v[k]].name);
			}
		const [rest, bent] = [drawn(r.at(0), 'neck'), drawn(s, 'neck')];
		let bottom = Infinity;
		let top = -Infinity;
		for (let k = 1; k < (rest?.length ?? 0); k += 2)
			[bottom, top] = [Math.min(bottom, rest[k]), Math.max(top, rest[k])];
		const moved = (edge) => {
			let most = 0;
			for (let k = 0; k < rest.length; k += 2) {
				if (Math.abs(rest[k + 1] - edge) > 1e-3) continue;
				const a = inFrame(r.at(0), 'chest', [rest[k], rest[k + 1]]);
				const b = inFrame(s, 'chest', [bent[k], bent[k + 1]]);
				most = Math.max(most, Math.hypot(a[0] - b[0], a[1] - b[1]));
			}
			return most;
		};
		const [mb, mt] = rest ? [moved(bottom), moved(top)] : [NaN, NaN];
		log(
			`the neck bent ${r1(lo)}° + ${r1(hi)}°; its drawing weighted to ${[...names].join(', ')}: bottom moved ${r1(mb)}, top ${r1(mt)}`,
		);
		return (
			ok(
				'shared: each of the neck’s bones takes half the bend',
				Math.abs(lo) >= 3 && Math.abs(lo - hi) <= 0.5,
				`${r1(lo)}° ${r1(hi)}°`,
			) &&
			ok(
				'shared: the neck’s drawing is weighted to both its bones',
				names.has('neck') && names.has('neck_upper'),
				[...names].join(', '),
			) &&
			ok(
				'shared: the drawing’s bottom stays at the collar and its top turns with the bend',
				mb <= 1 && mt >= 3,
				`${r1(mb)} ${r1(mt)}`,
			)
		);
	},

	/** 🔄 Update rig puts `neck_upper` into a rig made before it, every pose kept. */
	update(M, ok, log) {
		const old = madeBefore(M);
		const irig = structuredClone(old.irig);
		const idx = (n) => irig.bones.findIndex((b) => b.name === n);
		// An author's own mesh, weighted to the head and the face (after the neck in the bone list).
		irig.slots.push({ name: 'author_patch', bone: 'face', attachment: 'patch' });
		irig.skins[0].attachments.author_patch = {
			patch: {
				type: 'mesh',
				path: SIZED[0].name,
				uvs: [0, 0, 1, 0, 0, 1],
				triangles: [0, 1, 2],
				hull: 3,
				width: 10,
				height: 10,
				vertices: [
					1,
					idx('head'),
					0,
					10,
					1,
					2,
					idx('head'),
					30,
					10,
					0.5,
					idx('face'),
					30,
					-60,
					0.5,
					1,
					idx('face'),
					0,
					25,
					1,
				],
			},
		};
		irig.animations ??= {};
		irig.animations.nod = {
			bones: {
				neck: {
					rotate: [
						{ time: 0, value: 0 },
						{ time: 0.5, value: 8 },
					],
				},
				head: { rotate: [{ time: 0.5, value: -5 }] },
			},
		};
		const res = M.updateSheetRig({
			template: M.HALF_BODY,
			regions: SIZED,
			was: old.mapping,
			mapping: old.mapping,
			current: irig,
		});
		if (!res.ok) return ok('update: the rig updates', false, res.problem);
		const { doc, report } = res.value;
		const names = doc.bones.map((b) => b.name);
		const nu = doc.bones.find((b) => b.name === 'neck_upper');
		const hd = doc.bones.find((b) => b.name === 'head');
		const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
		const compare = (clip, time) => {
			const [was, now] = [player(irig, clip)(time), player(doc, clip)(time)];
			let bones = 0;
			for (const b of irig.bones)
				bones = Math.max(bones, near(placeOf(was, b.name), placeOf(now, b.name)));
			const turn = Math.abs(fold(turnOf(was, 'head') - turnOf(now, 'head')));
			const [pa, pb] = [drawn(was, 'author_patch'), drawn(now, 'author_patch')];
			let patch = 0;
			for (let k = 0; k < pa.length; k += 2)
				patch = Math.max(patch, near([pa[k], pa[k + 1]], [pb[k], pb[k + 1]]));
			return { bones, turn, patch };
		};
		const [setup, nod] = [compare('nod', null), compare('nod', 0.5)];
		const fresh = player(ownerRig(M).irig)(null);
		const was = player(old.irig)(null);
		const stands = Math.max(
			...old.irig.bones.map((b) => near(placeOf(was, b.name), placeOf(fresh, b.name))),
		);
		log(
			`linked ${JSON.stringify(report.linked)}; setup ${r1(setup.bones)} / patch ${r1(setup.patch)}, the old nod ${r1(nod.bones)} / ${r1(nod.turn)}° / patch ${r1(nod.patch)}; a rig made now ${r1(stands)} off one made before`,
		);
		return (
			ok(
				'update: the report names neck_upper, above the head',
				JSON.stringify(report.linked) === JSON.stringify([{ bone: 'neck_upper', below: 'head' }]),
				JSON.stringify(report.linked),
			) &&
			ok(
				'update: neck_upper hangs from the neck and the head from it, in order',
				nu?.parent === 'neck' &&
					hd?.parent === 'neck_upper' &&
					names.indexOf('neck_upper') === names.indexOf('head') - 1,
				JSON.stringify([nu, hd]),
			) &&
			ok(
				'update: the setup poses as before (every bone, the author’s weighted mesh)',
				setup.bones <= 0.01 && setup.patch <= 0.01,
				JSON.stringify(setup),
			) &&
			ok(
				'update: an old clip poses as before',
				nod.bones <= 0.01 && nod.turn <= 0.01 && nod.patch <= 0.01,
				JSON.stringify(nod),
			) &&
			ok(
				'update: a rig made now stands as one made before (the drawn neck shared by the chain)',
				stands <= 0.01,
				r1(stands),
			)
		);
	},

	/** A rig made before is given the template folded; the Controls read an old nod as it was. */
	controls(M, ok, log) {
		const full = M.HALF_BODY;
		const has = new Set(full.bones.map((b) => b.name).filter((n) => n !== 'neck_upper'));
		const old = M.templateWithLinks(full, has);
		const nod = (t) => t.channels.find((c) => c.id === 'head_nod');
		const hd = old.bones.find((b) => b.name === 'head');
		const F = M.page(
			[
				'bezierValue',
				'sampleChannel',
				'upsertKey',
				'upsertBoneKey',
				'faceChannelValue',
				'faceKeyChannel',
			],
			['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'],
		);
		const read = (anim, t) => F.faceChannelValue(anim, nod(t), 0, () => null, t.channels, null);
		const oldClip = { bones: { neck: { rotate: [{ time: 0, value: 8 }] } } };
		const keyed = {};
		F.faceKeyChannel(keyed, nod(full), 10, 0, () => false, full.channels, null);
		const values = [read(oldClip, full), read(oldClip, old), read(keyed, full)];
		const shares = ['neck', 'neck_upper'].map((b) => keyed.bones?.[b]?.rotate?.[0]?.value);
		// A frame rig's template.json keeps the fit it was made with: the head's length the whole neck.
		const oldFit = { bones: { head: { x: 0, y: 60 } } };
		const read2 = M.sidecarTemplate(
			full,
			JSON.stringify({ id: full.id, version: full.version, fit: oldFit }),
		);
		const split = ['neck_upper', 'head'].map((n) => read2.bones.find((b) => b.name === n).y);
		log(
			`folded Head nod ${JSON.stringify(nod(old).drives)}; an old 8° nod reads ${values[0]} / ${values[1]}, a new 10° one keys ${shares} and reads ${values[2]}`,
		);
		return (
			ok(
				'controls: a rig with every link is given the template itself',
				M.templateWithLinks(full, new Set(full.bones.map((b) => b.name))) === full,
			) &&
			ok(
				'controls: folded, Head nod turns the neck alone, by the whole nod',
				JSON.stringify(nod(old).drives) ===
					JSON.stringify([{ bone: 'neck', prop: 'rotate', per: 1 }]),
				JSON.stringify(nod(old).drives),
			) &&
			ok(
				'controls: folded, the head hangs from the neck where it was',
				!old.bones.some((b) => b.name === 'neck_upper') && hd.parent === 'neck' && hd.y === 40,
				JSON.stringify(hd),
			) &&
			ok(
				'controls: folded, the neck’s ring turns as far as the nod and nothing names the upper bone',
				JSON.stringify(old.controls.bones.neck.limits?.rotate) === '[-10,10]' &&
					!old.controls.bones.neck_upper &&
					!JSON.stringify(old.controls.picker).includes('neck_upper') &&
					!old.controls.sets.torso.includes('neck_upper'),
				JSON.stringify(old.controls.bones.neck),
			) &&
			ok(
				'controls: Head nod shares a nod along the neck',
				JSON.stringify(shares) === '[5,5]',
				JSON.stringify(shares),
			) &&
			ok(
				'controls: an old clip’s neck key reads as the nod it was, shared or not; a new one as keyed',
				values[0] === 8 && values[1] === 8 && values[2] === 10,
				JSON.stringify(values),
			) &&
			ok(
				'controls: a fit kept from before reads with its neck shared by the chain (60 → 30 + 30)',
				JSON.stringify(split) === '[30,30]',
				JSON.stringify(split),
			)
		);
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'base',
		'the neck translated under the import (its hold off its setup place)',
		[
			[
				'rigMotion3d.ts',
				'translate: [\n\t\t\t\t\t\t{ time: 0, x: 0, y: 0 },',
				'translate: [\n\t\t\t\t\t\t{ time: 0, x: 30, y: 0 },',
			],
		],
	],
	[
		'bounded',
		'the bend not held at its limit',
		[['rigMotion3d.ts', 'if (Math.abs(d1) <= nk.limit) return d1;', 'return d1;']],
	],
	[
		'follows',
		'the bend solved but not applied',
		[
			[
				'rigMotion3d.ts',
				'if (bend !== null) turn = quatOf(rotZ(bend / neckChain.length));',
				'if (bend !== null) turn = null;',
			],
		],
	],
	[
		'follows',
		'the face matched by its angle about the neck’s base, not across the neck',
		[
			[
				'rigMotion3d.ts',
				'return (T[0] - M[0]) * across[0] + (T[1] - M[1]) * across[1];',
				'return ((Math.atan2(T[1] - B[1], T[0] - B[0]) - Math.atan2(M[1] - B[1], M[0] - B[0])) * l) / 1;',
			],
		],
	],
	[
		'shared',
		'the whole bend on the neck’s base',
		[
			[
				'rigMotion3d.ts',
				'if (bend !== null) turn = quatOf(rotZ(bend / neckChain.length));',
				'if (bend !== null) turn = quatOf(rotZ(e.bone === neckChain[0] ? bend : 0));',
			],
		],
	],
	[
		'shared',
		'the neck’s drawing rigid on its base',
		[['rigFrameFit.ts', "\tneck: ['neck_upper', 'torso_image', 'head_image'],\n", '']],
	],
	[
		'shared',
		'the neck’s drawing bent along its length but not at the collar',
		[
			[
				'rigFrameFit.ts',
				"\tneck: ['neck_upper', 'torso_image', 'head_image'],",
				"\tneck: ['neck_upper', 'head_image'],",
			],
		],
	],
	[
		'update',
		'the link put in without the head hung from it',
		[['rigFrameUpdate.ts', '\tkid.parent = name;\n', '']],
	],
	[
		'update',
		'the bones put in order without renumbering the weighted vertices',
		[
			[
				'rigFrameUpdate.ts',
				'\torder.splice(order.indexOf(kid.name), 0, name);\n\treorderBones(doc, order);',
				'\torder.splice(order.indexOf(kid.name), 0, name);\n\tdoc.bones = order.map((n) => doc.bones.find((b) => b.name === n)!);',
			],
		],
	],
	[
		'update',
		'the drawn neck’s length all on the head',
		[['rigSheetFit.ts', "\tneck: ['neck_upper', 'head'],", "\tneck: ['head'],"]],
	],
	[
		'controls',
		'the fold drops a link’s drive instead of moving it onto the parent',
		[['rigTemplates.ts', 'if (same) same.per = round4(same.per + d.per);', 'if (same) continue;']],
	],
	[
		'controls',
		'a fit kept from before read as it is (the head the whole neck above the upper bone)',
		[['rigTemplates.ts', 'const fit = fitWithLinks(t, parsed.fit);', 'const fit = parsed.fit;']],
	],
	[
		'controls',
		'the Controls read a channel from its first drive alone',
		[
			[
				'view.html',
				'    for (const d of ch.drives){\n      if (d.prop !== prop) continue;',
				'    for (const d of ch.drives.slice(0, 1)){\n      if (d.prop !== prop) continue;',
			],
		],
	],
];

void ATLAS;
void RIG;
await runGate('sheet-neck', GUARDS, MUTANTS);
