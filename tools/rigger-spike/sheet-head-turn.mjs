// 🗺 From my sheet: the head turn (docs/design/frame-to-rig.md §13.1g; the owner, 2026-11-26: "I
// guess I need some extra bones on the head to give the impression that is rotating"), headless on
// the SHIPPED code: the owner's sheet (`owner-sheet.mjs`: the committed fixture under their region
// names, the face drawn apart, glasses and an earring on the head), made into a rig as 🦴 Create rig
// makes it, a synthetic performer's 3D capture keyed and baked as the page does, played by engine-rig
// as a game does. Asserted:
//  - yaw, found: a 25° turn slides the head's middle with the face (the skin under the face's middle moves
//    with it), the head's round part-way, and leaves the skull's outline; the side it turns toward
//    squashes, the far side stretches; the face slides further than with the head turn off; each ring
//    bone carries its own side; the glasses slide with the eyes or more, the nose and the lips more
//    than the eyes, the earring less, a prop drawn behind the head the other way — the face drawn
//    apart, and found on the head;
//  - nod: a 20° nod slides the head's middle up the head with the face, the chin with it, and leaves
//    the skull's top where it is;
//  - fold: a 40° turn either way and a 25° nod, at the strongest head turn (2×), fold no triangle of
//    the head's mesh;
//  - controls: the Head turn and Head up / down controls slide the ring and the glasses by their
//    depths as they slide the face, the head's middle with the face, the outline staying, nothing
//    folding;
//  - strength: off makes no head turn (no ring, the face's slide and the glasses as before); ½× turns
//    the face less than 1×; the strength is kept in the mapping (`turn`), a bad one refused;
//  - update: 🔄 Update rig gives a rig made before the head turn its ring (appended: no index a mesh
//    names moves), the head weighted to it, the glasses re-hung on the head, the depths for its 3D
//    data, nothing read as edited by hand; an update of a rig that has it changes none of that;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-head-turn.mjs [--only <guard>] [--no-mutants]
import * as P from './performer3d.mjs';
import {
	ATLAS,
	END,
	RIG,
	SIZED,
	drawn,
	faceTrack,
	imported,
	middle,
	ownerMapping,
	ownerRig,
	player,
	runGate,
} from './owner-sheet.mjs';

const r1 = (v) => Math.round(v * 10) / 10;
const RING = ['head_turn_l', 'head_turn_r', 'head_turn_d', 'head_turn_u'];
const YAW = 25;
const NOD = 20;
const sin = (d) => Math.sin((d * Math.PI) / 180);

/** A drawing's vertices as points. */
const pts = (v) => Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i], v[2 * i + 1]]);
/** The head drawing's vertex nearest `p` at rest, by index. */
const nearest = (v, p) => {
	let best = 0;
	pts(v).forEach((q, i) => {
		if (
			Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(v[2 * best] - p[0], v[2 * best + 1] - p[1])
		)
			best = i;
	});
	return best;
};
const at = (v, i) => [v[2 * i], v[2 * i + 1]];
const boneAt = (skel, n) => [skel.findBone(n).worldX, skel.findBone(n).worldY];

/** The head mesh's attachment in the irig, and each vertex's weight on each bone (by name). */
function headWeights(irig) {
	const att = irig.skins[0].attachments.head.head;
	const names = irig.bones.map((b) => b.name);
	const out = [];
	for (let i = 0; i < att.vertices.length;) {
		const k = att.vertices[i++];
		const w = {};
		for (let j = 0; j < k; j++, i += 4) w[names[att.vertices[i]]] = att.vertices[i + 3];
		out.push(w);
	}
	return { att, weights: out };
}
/** The head image's own outline: the mesh vertices on the top, left and right edges of its image. */
function outlineOf(irig) {
	const { att } = headWeights(irig);
	const uv = att.uvs;
	const out = [];
	for (let i = 0; i < uv.length / 2; i++) {
		const [u, v] = [uv[2 * i], uv[2 * i + 1]];
		if (u < 1e-6 || u > 1 - 1e-6 || v < 1e-6) out.push(i);
	}
	return out;
}
/** The rig `opts` makes, a capture of the face turned by `R(k)` imported, its rest and end poses. */
function captured(M, opts, R) {
	const rig = ownerRig(M, opts);
	const play = player(imported(rig, faceTrack(R)).irig);
	return { rig, rest: play(0), end: play(END) };
}
/** The head drawing's triangles that flip or keep under `least` of their area between two poses. */
function folded(irig, a, b, least) {
	const tris = irig.skins[0].attachments.head.head.triangles;
	let worst = Infinity;
	let flips = 0;
	for (let t = 0; t < tris.length; t += 3) {
		const area = (v) => {
			const [p, q, r] = [0, 1, 2].map((k) => at(v, tris[t + k]));
			return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
		};
		const [s0, s1] = [area(a), area(b)];
		if (Math.abs(s0) < 1e-6) continue;
		if (Math.sign(s0) !== Math.sign(s1)) flips++;
		worst = Math.min(worst, s1 / s0);
	}
	return { flips, worst, folds: flips > 0 || worst < least };
}
/** The rig posed by its controls (`values`: channel → value, as the Controls section keys them). */
function controlled(rig, values) {
	const atlas = new RIG.TextureAtlas(ATLAS);
	for (const p of atlas.pages)
		p.setTexture({
			getImage: () => ({ width: 1, height: 1 }),
			setFilters() {},
			setWraps() {},
			dispose() {},
		});
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(rig.irig)),
	);
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	for (const [id, v] of Object.entries(values))
		for (const d of rig.tpl.channels.find((c) => c.id === id).drives ?? []) {
			const b = skel.findBone(d.bone);
			if (b && (d.prop === 'x' || d.prop === 'y')) b[d.prop] += d.per * v;
		}
	skel.updateWorldTransform(RIG.Physics.update);
	return skel;
}

/** The head drawing's vertex the face carries whole, nearest the face's bone at rest. */
function faceMiddle(irig, v, o) {
	const { weights } = headWeights(irig);
	const d = (i) => Math.hypot(v[2 * i] - o[0], v[2 * i + 1] - o[1]);
	let best = -1;
	weights.forEach((w, i) => {
		if ((w.face ?? 0) >= 0.99 && (best < 0 || d(i) < d(best))) best = i;
	});
	return best < 0 ? nearest(v, o) : best;
}

/** The face's slide, the outline's, the round's either side (as shares of the face's) and the order. */
function yawRead(rig, rest, end, sign) {
	const [v0, v1] = [drawn(rest, 'head'), drawn(end, 'head')];
	const slide = (b) => boneAt(end, b)[0] - boneAt(rest, b)[0];
	const face = boneAt(end, 'face')[0] - boneAt(rest, 'face')[0];
	const o = boneAt(rest, 'face');
	const mid = faceMiddle(rig.irig, v0, o);
	const skin = at(v1, mid)[0] - at(v0, mid)[0];
	const outline = Math.max(
		...outlineOf(rig.irig).map((i) =>
			Math.hypot(...[0, 1].map((k) => v1[2 * i + k] - v0[2 * i + k])),
		),
	);
	const ring = (side) => {
		const b = boneAt(rest, side < 0 ? 'head_turn_l' : 'head_turn_r');
		const i = nearest(v0, b);
		return (at(v1, i)[0] - at(v0, i)[0]) / face;
	};
	// The skin between the face's middle and each side of the outline, along the face's row.
	const row = (side) => {
		const ends = outlineOf(rig.irig).filter((i) => Math.sign(at(v0, i)[0] - o[0]) === side);
		const e = ends.reduce((a, i) =>
			Math.abs(at(v0, i)[1] - o[1]) < Math.abs(at(v0, a)[1] - o[1]) ? i : a,
		);
		return Math.abs(at(v1, e)[0] - at(v1, mid)[0]) / Math.abs(at(v0, e)[0] - at(v0, mid)[0]);
	};
	return {
		face: face * sign,
		skin: skin * sign,
		outline,
		ring: [ring(-1), ring(1)],
		toward: row(sign),
		away: row(-sign),
		slide,
	};
}

/**
 * A 25° turn either way on the rig the owner's sheet makes, its face drawn apart or `face` found on
 * the head: the head turns round (its middle with the face, its round part-way, its outline still).
 */
function turnedRound(M, ok, face) {
	let good = true;
	const rows = [];
	{
		{
			const what = face ? 'a face found on the head' : 'the face drawn apart';
			const off = captured(M, { face, more: { turn: 0 } }, (k) => P.ry(YAW * k));
			const offFace = boneAt(off.end, 'face')[0] - boneAt(off.rest, 'face')[0];
			for (const sign of [1, -1]) {
				const { rig, rest, end } = captured(M, { face }, (k) => P.ry(sign * YAW * k));
				const y = yawRead(rig, rest, end, sign);
				const depth = rig.tpl.rig3d.depths.face;
				const way = `${what}, ${sign > 0 ? 'right' : 'left'}`;
				rows.push(
					`${way}: face ${r1(y.face)} (off ${r1(Math.abs(offFace))}), round ${y.ring.map(r1)}, ${r1(y.toward)}/${r1(y.away)}`,
				);
				good =
					ok(
						`yaw (${way}): the face slides its depth's turn, further than with the head turn off`,
						y.face >= 0.9 * depth * sin(YAW) && y.face >= 1.15 * Math.abs(offFace) && y.face > 3,
						`${r1(y.face)} (depth ${r1(depth)}, off ${r1(offFace)})`,
					) && good;
				good =
					ok(
						`yaw (${way}): the skin under the face's middle moves with it`,
						Math.abs(y.skin - y.face) <= 0.05 * y.face,
						`${r1(y.skin)} vs ${r1(y.face)}`,
					) && good;
				// Part-way about its middle: the head's card narrows too, carrying the far side further.
				const round = (y.ring[0] + y.ring[1]) / 2;
				good =
					ok(
						`yaw (${way}): the head's round moves part-way (its two sides' mean)`,
						round >= 0.25 && round <= 0.75,
						y.ring.map(r1).join(' / '),
					) && good;
				good =
					ok(
						`yaw (${way}): the skull's outline stays`,
						y.outline <= 0.5,
						`${r1(y.outline)} units`,
					) && good;
				good =
					ok(
						`yaw (${way}): the side it turns toward squashes, the far side stretches`,
						y.toward < 0.97 && y.away > 1.03,
						`${r1(y.toward)} / ${r1(y.away)}`,
					) && good;
				if (!face) {
					const s = (n) => y.slide(n) * sign;
					const eyes = (s('pupil_l') + s('pupil_r')) / 2;
					good =
						ok(
							`yaw (${way}): the glasses slide with the eyes or more, the nose and the lips more than the eyes, the earring at the head's side less`,
							s('prop_glasses') >= eyes - 0.5 &&
								s('nose') > eyes + 0.5 &&
								s('lip_upper') > eyes + 0.1 &&
								s('prop_earring_l') < eyes - 1,
							['pupil_l', 'pupil_r', 'nose', 'lip_upper', 'prop_glasses', 'prop_earring_l']
								.map((n) => `${n} ${r1(s(n))}`)
								.join(', '),
						) && good;
				}
			}
			// Each ring bone carries its own side of the head.
			const rig = ownerRig(M, { face });
			const { weights } = headWeights(rig.irig);
			const v = drawn(player(rig.irig)(null), 'head');
			const o = boneAt(player(rig.irig)(null), 'face');
			const sideOk = RING.every((b, k) => {
				const mine = weights
					.map((w, i) => ({ w: w[b] ?? 0, p: at(v, i) }))
					.filter((x) => x.w > 0.05);
				const axis = k < 2 ? 0 : 1;
				const sign = k % 2 ? 1 : -1;
				return mine.length > 0 && mine.every((x) => sign * (x.p[axis] - o[axis]) > -1);
			});
			good = ok(`yaw (${what}): each ring bone carries its own side of the head`, sideOk) && good;
		}
	}
	return { good, rows };
}

const GUARDS = {
	/** A 25° turn turns the head round, the face drawn apart (the owner's), what it wears at its depth. */
	yaw(M, ok, log) {
		const turn = turnedRound(M, ok, false);
		let good = turn.good;
		const rows = turn.rows;
		// A prop drawn behind the head slides the other way.
		const base = ownerMapping(M);
		const layers = M.sheetLayerList(
			M.HALF_BODY.slots.map((s) => s.name),
			(p) => M.HALF_BODY.parts.find((x) => x.name === p)?.slot ?? p,
			base,
		).filter((n) => n !== 'prop_earring_l');
		layers.splice(layers.indexOf('head') + 1, 0, 'prop_earring_l');
		const behind = captured(M, { mapping: { ...base, layers } }, (k) => P.ry(YAW * k));
		const back =
			middle(drawn(behind.end, 'prop_earring_l'))[0] -
			middle(drawn(behind.rest, 'prop_earring_l'))[0];
		good =
			ok('yaw: a prop drawn behind the head slides the other way', back < -0.5, `${r1(back)}`) &&
			good;
		log(rows.join('; ') + `; behind ${r1(back)}`);
		return good;
	},

	/** A 25° turn turns the head round where the face is found on it (its features its own skin). */
	found(M, ok, log) {
		const { good, rows } = turnedRound(M, ok, true);
		log(rows.join('; '));
		return good;
	},

	/** A 20° nod slides the head's middle up the head with the face, the chin too; the skull's top stays. */
	nod(M, ok, log) {
		let good = true;
		const { rig, rest, end } = captured(M, {}, (k) => P.rx(-NOD * k));
		const [v0, v1] = [drawn(rest, 'head'), drawn(end, 'head')];
		const H = [boneAt(rest, 'head'), boneAt(end, 'head')];
		// Moves on the head: less the head's own move (the card's nod narrows it toward its bone).
		const rel = (p0, p1) => p1[1] - H[1][1] - (p0[1] - H[0][1]) * Math.cos((NOD * Math.PI) / 180);
		const o = boneAt(rest, 'face');
		const face = rel(o, boneAt(end, 'face'));
		const mid = faceMiddle(rig.irig, v0, o);
		const skin = rel(at(v0, mid), at(v1, mid));
		const { att } = headWeights(rig.irig);
		const uv = att.uvs;
		const edge = (pick) => {
			let best = -1;
			for (let i = 0; i < uv.length / 2; i++)
				if (
					pick(uv[2 * i], uv[2 * i + 1]) &&
					(best < 0 || Math.abs(uv[2 * i] - 0.5) < Math.abs(uv[2 * best] - 0.5))
				)
					best = i;
			return best;
		};
		const chin = edge((u, v) => v > 1 - 1e-6);
		const top = edge((u, v) => v < 1e-6);
		const chinMove = rel(at(v0, chin), at(v1, chin));
		const topMove = Math.hypot(at(v1, top)[0] - at(v0, top)[0], at(v1, top)[1] - at(v0, top)[1]);
		good =
			ok(
				'nod: the head’s middle slides along the head with the face',
				Math.abs(face) > 3 && Math.abs(skin - face) <= 0.05 * Math.abs(face),
				`face ${r1(face)}, skin ${r1(skin)}`,
			) && good;
		good =
			ok(
				'nod: the chin turns with the face (more than half its slide), the skull’s top stays',
				Math.sign(chinMove) === Math.sign(face) &&
					Math.abs(chinMove) >= 0.4 * Math.abs(face) &&
					topMove <= 0.5,
				`chin ${r1(chinMove)}, top ${r1(topMove)}`,
			) && good;
		log(
			`a ${NOD}° nod: face ${r1(face)}, skin ${r1(skin)}, chin ${r1(chinMove)}, top ${r1(topMove)}`,
		);
		return good;
	},

	/** 1×'s farthest turns and nods (40°, 25°) fold none of the head's mesh, nor 2×'s at half of them. */
	fold(M, ok, log) {
		let good = true;
		const rows = [];
		// The face drawn apart each way at 1× and its steepest at 2×; a found face's turn and nod at 1×.
		const cases = [
			[false, 1, ['right', 'left', 'nod', 'nod down']],
			[false, 2, ['right']],
			[true, 1, ['right', 'nod']],
		];
		for (const [face, strength, ways] of cases) {
			const rig = ownerRig(M, { face, more: { turn: strength } });
			const [turn, nod] = [40 / strength, 25 / strength];
			const poses = {
				right: [`${turn}° right`, (k) => P.ry(turn * k)],
				left: [`${turn}° left`, (k) => P.ry(-turn * k)],
				nod: [`${nod}° nod`, (k) => P.rx(nod * k)],
				'nod down': [`${nod}° nod down`, (k) => P.rx(-nod * k)],
			};
			for (const [what, R] of ways.map((w) => poses[w])) {
				const play = player(imported(rig, faceTrack(R)).irig);
				const f = folded(rig.irig, drawn(play(0), 'head'), drawn(play(END), 'head'), 0.05);
				rows.push(`${strength}× ${what} ${f.worst.toFixed(2)}`);
				good =
					ok(
						`fold (${face ? 'found' : 'apart'}, ${strength}×, ${what}): no triangle of the head flips or keeps under 5% of its area`,
						!f.folds,
						`${f.flips} flipped, least ${f.worst.toFixed(3)}`,
					) && good;
			}
		}
		log(`least area kept: ${rows.join(', ')}`);
		return good;
	},

	/** The Head turn and Head up / down controls slide the ring and the glasses by their depths. */
	controls(M, ok, log) {
		let good = true;
		const rig = ownerRig(M);
		const rest = controlled(rig, {});
		const depths = rig.tpl.rig3d.depths;
		const rows = [];
		for (const [id, axis] of [
			['head_turn', 0],
			['head_pitch', 1],
		]) {
			const ch = rig.tpl.channels.find((c) => c.id === id);
			const per = (b) => ch.drives.find((d) => d.bone === b)?.per ?? 0;
			const ratio = per('face') / depths.face;
			const slid = ['head_turn_l', 'head_turn_u', 'prop_glasses'].every(
				(b) => Math.abs(per(b) - depths[b] * ratio) < 1e-3 && per(b) !== 0,
			);
			good =
				ok(
					`controls (${id}): the ring and the glasses slide by their depths as the face does by its own`,
					slid,
					JSON.stringify(ch.drives),
				) && good;
			for (const v of [1, -1]) {
				const skel = controlled(rig, { [id]: v });
				const [v0, v1] = [drawn(rest, 'head'), drawn(skel, 'head')];
				const face = boneAt(skel, 'face')[axis] - boneAt(rest, 'face')[axis];
				const mid = faceMiddle(rig.irig, v0, boneAt(rest, 'face'));
				const skin = at(v1, mid)[axis] - at(v0, mid)[axis];
				const outline = Math.max(
					...outlineOf(rig.irig)
						.filter((i) => axis === 0 || at(v0, i)[1] > boneAt(rest, 'face')[1])
						.map((i) => Math.hypot(...[0, 1].map((k) => v1[2 * i + k] - v0[2 * i + k]))),
				);
				const f = folded(rig.irig, v0, v1, 0.05);
				rows.push(`${id} ${v}: face ${r1(face)}`);
				good =
					ok(
						`controls (${id} ${v}): the head's middle moves with the face, the skull's outline stays, nothing folds`,
						Math.abs(face) > 1 &&
							Math.abs(skin - face) <= 0.05 * Math.abs(face) &&
							outline <= 0.5 &&
							!f.folds,
						`face ${r1(face)}, skin ${r1(skin)}, outline ${r1(outline)}, least ${f.worst.toFixed(2)}`,
					) && good;
			}
		}
		log(rows.join(', '));
		return good;
	},

	/** Off makes none; ½× turns less than 1×; the strength is kept in the mapping, a bad one refused. */
	strength(M, ok, log) {
		let good = true;
		const on = ownerRig(M);
		const off = ownerRig(M, { more: { turn: 0 } });
		const half = ownerRig(M, { more: { turn: 0.5 } });
		const offBones = off.irig.bones.map((b) => b.name);
		const glasses = (r) => r.irig.bones.find((b) => b.name === 'prop_glasses').parent;
		good =
			ok(
				'strength: off makes no head turn (no ring, no turn in the fit, the glasses on the head’s image)',
				!RING.some((b) => offBones.includes(b)) &&
					!off.sr.fit.turn &&
					glasses(off) === 'head_image' &&
					glasses(on) === 'head' &&
					RING.every((b) => on.irig.bones.some((x) => x.name === b)),
				JSON.stringify({
					off: offBones.filter((b) => b.startsWith('head_turn')),
					glasses: glasses(off),
				}),
			) && good;
		const d = (r) => r.tpl.rig3d.depths.face;
		good =
			ok(
				'strength: ½× turns the face half as far as 1×, off as the face slides alone',
				Math.abs(d(half) - 0.5 * d(on)) < 0.5 && d(off) < d(on),
				`${r1(d(off))} / ${r1(d(half))} / ${r1(d(on))}`,
			) && good;
		const kept = M.parseSheetMapping({ ...ownerMapping(M), turn: 0.5 });
		const bad = M.parseSheetMapping({ ...ownerMapping(M), turn: 3 });
		good =
			ok(
				'strength: kept in the mapping (`turn`); one past 2 refused',
				kept.mapping?.turn === 0.5 && 'problem' in bad,
				JSON.stringify({ kept: kept.mapping?.turn, bad }),
			) && good;
		log(`face depth off ${r1(d(off))}, ½× ${r1(d(half))}, 1× ${r1(d(on))}`);
		return good;
	},

	/** 🔄 Update rig gives a rig made before the head turn its ring; one that has it is left as it is. */
	update(M, ok, log) {
		let good = true;
		const before = ownerMapping(M, { more: { turn: 0 } });
		const old = ownerRig(M, { mapping: before });
		// Its kept mapping as a rig made before the head turn keeps it: no `turn`.
		const kept = { ...before };
		delete kept.turn;
		const up = M.updateSheetRig({
			template: M.HALF_BODY,
			regions: SIZED,
			was: kept,
			mapping: kept,
			current: old.irig,
		});
		if (!ok('update: a rig made before the head turn updates', up.ok, up.problem)) return false;
		const { doc, report, depths } = up.value;
		const names = doc.bones.map((b) => b.name);
		const oldNames = old.irig.bones.map((b) => b.name);
		const glasses = doc.bones.find((b) => b.name === 'prop_glasses');
		const { weights } = headWeights(doc);
		good =
			ok(
				'update: the ring appended after the rig’s bones (no index a mesh names moves), the head weighted to it',
				oldNames.every((n, i) => names[i] === n) &&
					RING.every((b) => names.indexOf(b) >= oldNames.length) &&
					report.turned.length === 4 &&
					RING.every((b) => weights.some((w) => (w[b] ?? 0) > 0.2)),
				JSON.stringify({ turned: report.turned, tail: names.slice(oldNames.length) }),
			) && good;
		good =
			ok(
				'update: the glasses re-hung on the head, nothing read as edited by hand',
				glasses.parent === 'head' &&
					report.rehung.includes('prop_glasses') &&
					report.handEdited.length === 0,
				JSON.stringify({
					parent: glasses.parent,
					rehung: report.rehung,
					handEdited: report.handEdited,
				}),
			) && good;
		good =
			ok(
				'update: the depths for its 3D data — the face’s, the ring’s, the glasses’',
				['face', ...RING, 'prop_glasses'].every((b) => depths[b] > 0) &&
					depths.face > old.tpl.rig3d.depths.face,
				JSON.stringify(depths),
			) && good;
		// A rig that has it, its mapping unchanged: nothing re-hung, added or read as edited.
		const made = ownerRig(M);
		const again = M.updateSheetRig({
			template: M.HALF_BODY,
			regions: SIZED,
			was: made.mapping,
			mapping: made.mapping,
			current: made.irig,
		});
		good =
			ok(
				'update: a rig that has the head turn, updated unchanged, keeps it as it is',
				again.ok &&
					again.value.report.turned.length === 0 &&
					again.value.report.rehung.length === 0 &&
					again.value.report.handEdited.length === 0 &&
					again.value.doc.bones.length === made.irig.bones.length,
				JSON.stringify(again.ok ? again.value.report : again.problem),
			) && good;
		// The updated rig, its 3D data given the depths, turns its head under a capture.
		const doc3d = M.I.rig3dFromTemplate('nelly', old.irig, old.tpl.rig3d);
		for (const [b, z] of Object.entries(depths)) (doc3d.bones ??= {})[b] = { depth: z };
		const rig = {
			...old,
			irig: doc,
			tpl: M.fitTemplate(M.HALF_BODY, made.sr.fit),
			setup: doc.slots.map((s) => s.name),
		};
		const play = player(
			imported(
				rig,
				faceTrack((k) => P.ry(YAW * k)),
				{},
				doc3d,
			).irig,
		);
		const y = yawRead(rig, play(0), play(END), 1);
		good =
			ok(
				'update: the updated rig’s head turns round under a capture (its middle with the face, its round part-way)',
				y.face > 3 &&
					Math.abs(y.skin - y.face) <= 0.05 * y.face &&
					(y.ring[0] + y.ring[1]) / 2 >= 0.25 &&
					(y.ring[0] + y.ring[1]) / 2 <= 0.75,
				JSON.stringify({ face: r1(y.face), skin: r1(y.skin), ring: y.ring.map(r1) }),
			) && good;
		log(
			`made before: ${report.turned.join(', ')} appended, ${report.rehung.join(', ')} re-hung; face ${r1(y.face)} at ${YAW}°`,
		);
		return good;
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	['yaw', 'the ring not split by side', [['rigHeadTurn.ts', 'split: [...HEAD_TURN_BONES],', '']]],
	[
		'yaw',
		'the ring reaching past the outline: the skull slides',
		[['rigHeadTurn.ts', 'extent: [...rim],', 'extent: rim.map((v) => 1.5 * v) as Quad,']],
	],
	[
		'yaw',
		'the ring’s depths not in the 3D setup: it never moves in 3D',
		[['rigTemplateFit.ts', 'if (depths) depths = { ...depths, ...Object.fromEntries(deep) };', '']],
	],
	[
		'yaw',
		'the face keeps the slide it had alone',
		[
			[
				'rigSheetFit.ts',
				'scale: { ...drawn.features.scale, face: turned.face }',
				'scale: drawn.features.scale',
			],
		],
	],
	[
		'yaw',
		'a prop worn on the head left on its image',
		[
			[
				'rigSheetFit.ts',
				'if (turned && p.host === drawnHead?.part',
				'if (!turned && p.host === drawnHead?.part',
			],
		],
	],
	['nod', 'the chin pinned with the outline', [['rigHeadTurn.ts', 'd / CHIN', 'd']]],
	[
		'fold',
		'the face’s depth never cut to the room',
		[['rigHeadTurn.ts', 'if (squeezed(D) > SQUEEZE) {', 'if (false) {']],
	],
	[
		'controls',
		'the controls not sliding the ring and what the head wears',
		[['rigTemplateFit.ts', 'withProps = withProps.map((c) => slidByDepth(t, c, deep));', '']],
	],
	[
		'strength',
		'the mapping’s strength ignored',
		[['rigSheetFit.ts', 'strength: m.turn ?? HEAD_TURN_DEFAULT,', 'strength: HEAD_TURN_DEFAULT,']],
	],
	[
		'update',
		'an update not appending the ring',
		[['rigFrameUpdate.ts', ' || turning.has(b.name))) continue;', ')) continue;']],
	],
	[
		'update',
		'a rig made before the head turn read as made with it',
		[
			[
				'rigSheetUpdate.ts',
				'turnedBefore || o.was.turn !== undefined ? o.was : { ...o.was, turn: 0 }',
				'o.was',
			],
		],
	],
];

await runGate('sheet-head-turn', GUARDS, MUTANTS);
