// IK in 3D for 2.5D rigs (rig-controls K4, docs/design/rig-controls.md §6.2), on the SHIPPED code: the
// one limb solver (`rig3dLimb.ts`), the rig3d `ik` entries solved in the bake (`rig2p5d.ts`
// `solveIk3d`, through `rig3d.ts` and the page's re-bake `rig3dImport.ts`), the switches
// (`rig3dIk.ts`), the stage's held pose (`rig3dView.ts`) and controls.json's 3D limb
// (`rigControls.ts`). A synthetic arm — chest, upper arm, forearm, hand — reaches a control placed in
// 3D, bent toward a pole set behind the elbow, with a prop space; every clip is baked into the irig as
// the page and the save bake it, and played by the REAL engine-rig (SkeletonJson → Skeleton →
// AnimationState), as a game plays it. Asserted:
//  - reach: the hand lands on the control in 3D (10⁻⁶) and, as engine-rig plays the bake, in the
//    picture within the rig's tolerance, while the control moves in x, y and depth and the chest turns
//    in 3D; the elbow is the solve's, on the pole's side;
//  - out of reach the arm points straight at the control at full length; with stretch the hand lands
//    on it; softness follows 4.2's curve; the pole carried across the arm flips the elbow; mix 0.5 is
//    half way (slerp) between the FK and IK turns; mix 0 everywhere bakes byte for byte as no IK;
//  - a stepped jump of the control bakes as a step (the solve's left limit is keyed);
//  - the controls' own 2D keys (an unowned control) are the solve's input;
//  - ⇄ To IK and ⇄ To FK in 3D: no jump at the switch, in 3D and in the game; an earlier run plays as
//    it did; matched over a range, the IK pose is the FK pose at every matched key; ⇄ Space to a moving
//    prop keeps the control where it was, then the hand rides the prop;
//  - the stage: the held turned view solves the limb at its held mix;
//  - the data: the sidecar keeps a clip's IK keys through the page's re-bake; a bone rename and a
//    delete keep the 3D IK in step; the validators refuse a broken entry; controls.json keeps a 3D
//    limb through the lenient read; the motion import's two-bone reach is #1853's to 10⁻⁹;
//  - planted mutants, each must be caught (a mutant whose text is gone fails the run).
//   node tools/rigger-spike/rig-ik3d.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const APP = fileURLToPath(new URL('../../apps/launcher-api/', import.meta.url));
const LIB = join(APP, 'src/lib');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics } = RIG;

const dir = mkdtempSync(join(tmpdir(), 'rig-ik3d-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let built = 0;

/** The modules as one bundle; `mutant` plants one change in one source file (found exactly once). */
async function modules(mutant) {
	const entry = join(dir, `entry${built}.ts`);
	const out = join(dir, `bundle${built++}.mjs`);
	const at = (f) => JSON.stringify(join(LIB, f).replace(/\\/g, '/'));
	writeFileSync(
		entry,
		[
			`export * as B from ${at('rig2p5d.ts')};`,
			`export * as S from ${at('rig3d.ts')};`,
			`export * as I from ${at('rig3dImport.ts')};`,
			`export * as K from ${at('rig3dIk.ts')};`,
			`export * as L from ${at('rig3dLimb.ts')};`,
			`export * as V from ${at('rig3dView.ts')};`,
			`export * as W from ${at('rig3dViews.ts')};`,
			`export * as C from ${at('rigControls.ts')};`,
		].join('\n'),
	);
	const plugins = mutant
		? [
				{
					name: 'mutant',
					setup(build) {
						const file = join(LIB, mutant.file).replace(/\\/g, '/').toLowerCase();
						build.onLoad({ filter: /\.ts$/ }, (args) => {
							if (args.path.replace(/\\/g, '/').toLowerCase() !== file) return undefined;
							const src = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
							const n = src.split(mutant.find).length - 1;
							if (n !== 1) throw new Error(`mutant ${mutant.name}: found ${n}× in ${mutant.file}`);
							return { contents: src.replace(mutant.find, mutant.replace), loader: 'ts' };
						});
					},
				},
			]
		: [];
	await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'error',
		plugins,
	});
	return import(pathToFileURL(out).href);
}

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
let INFO = true;
const info = (line) => INFO && console.log(`  ${line}`);
const clone = (v) => structuredClone(v);
const R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => len(sub(a, b));
/** A turn about the vertical (the card's up) by `deg`. */
const qy = (deg) => [Math.cos((deg * R) / 2), 0, Math.sin((deg * R) / 2), 0];
const qz = (deg) => [Math.cos((deg * R) / 2), 0, 0, Math.sin((deg * R) / 2)];

// ── The rig ─────────────────────────────────────────────────────────────────────────────────────

/** Shoulder (40, 100) → elbow (+100) → wrist (+90), along x; the control on the wrist at setup. */
const L1 = 100;
const L2 = 90;
const SHOULDER = [40, 100];
const WRIST = [SHOULDER[0] + L1 + L2, 100];
const region = (w, h) => ({ x: w / 2, y: 0, width: w, height: h });
const IRIG = {
	irig: 1,
	skeleton: { hash: 'rig-ik3d', importedFrom: '4.2', x: -400, y: -400, width: 800, height: 800 },
	bones: [
		{ name: 'root' },
		{ name: 'chest', parent: 'root', y: 100, length: 40 },
		{ name: 'upper', parent: 'chest', x: 40, length: L1 },
		{ name: 'lower', parent: 'upper', x: L1, length: L2 },
		{ name: 'hand', parent: 'lower', x: L2, length: 24 },
		// As the templates carry them: on the chest, at the wrist and the elbow.
		{ name: 'hand_ik', parent: 'chest', x: WRIST[0], y: 0 },
		{ name: 'elbow_pole', parent: 'chest', x: SHOULDER[0] + L1, y: 0 },
		{ name: 'prop', parent: 'root', x: 0, y: -100, length: 30 },
		{ name: 'hand_ik_prop', parent: 'prop', x: WRIST[0], y: WRIST[1] + 100 },
	],
	slots: [
		{ name: 'torso', bone: 'chest', attachment: 'torso' },
		{ name: 'upper', bone: 'upper', attachment: 'upper' },
		{ name: 'lower', bone: 'lower', attachment: 'lower' },
		{ name: 'hand', bone: 'hand', attachment: 'hand' },
		{ name: 'prop', bone: 'prop', attachment: 'prop' },
	],
	transform: [
		{
			name: 'hand_ik_in_prop',
			order: 0,
			bones: ['hand_ik'],
			target: 'hand_ik_prop',
			mixRotate: 0,
			mixX: 0,
			mixY: 0,
			mixScaleX: 0,
			mixScaleY: 0,
			mixShearY: 0,
		},
	],
	skins: [
		{
			name: 'default',
			attachments: {
				torso: { torso: region(40, 60) },
				upper: { upper: region(L1, 22) },
				lower: { lower: region(L2, 18) },
				hand: { hand: region(24, 16) },
				prop: { prop: region(30, 30) },
			},
		},
	],
	animations: {},
};
const ATLAS = [
	'page.png',
	'size:512,64',
	'filter:Linear,Linear',
	...['torso', 'upper', 'lower', 'hand', 'prop'].flatMap((n, i) => [n, `bounds:${i * 64},0,64,64`]),
	'',
].join('\n');
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
const IK = {
	name: 'arm_ik',
	bones: ['upper', 'lower'],
	end: 'hand',
	target: 'hand_ik',
	pole: 'elbow_pole',
};
const docWith = (clips, ik = [IK]) => ({
	rig3d: 1,
	rig: 'arm',
	bones: { elbow_pole: { depth: -80 } },
	...(ik.length ? { ik: clone(ik) } : {}),
	clips: clone(clips),
});
const irigWith = (anims = {}) => ({ ...clone(IRIG), animations: clone(anims) });

/** Bake clip `name` as the page does (`rebakeClip3d`, the save's clipOf → bake2p5d → withBake). */
function bake(M, irig, doc, name) {
	const anims = irig.animations ?? {};
	const base = { ...irig, animations: { ...anims, [name]: anims[name] ?? {} } };
	return M.I.rebakeClip3d({ irig: base, doc, clip: name });
}
/** engine-rig playing clip `name` of `irig`, posed at each time asked. */
function player(irig, name) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(irig));
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, name, false);
	let now = 0;
	return (t) => {
		state.update(t - now);
		now = t;
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
const at2 = (skel, n) => {
	const b = skel.findBone(n);
	return [b.worldX, b.worldY];
};
/** The clip's 3D pose at `t` as the bake bakes it (its 3D IKs solved). */
function pose3dOf(M, irig, doc, name) {
	const rig = M.S.rigOf(irig, doc);
	const plan = M.S.clipOf(rig, irig, doc, name);
	return (t) => M.B.pose3d(rig, plan.clip, t);
}
const grid = (D, step = 0.01) =>
	Array.from({ length: Math.round(D / step) + 1 }, (_, i) => i * step);
const TOL = 0.5; // rig units: the rig's tolerance (0.45) and the float32 the game reads

// The control moves in x, y and depth (in reach), the chest turns about the vertical in 3D.
const REACH = {
	reach: {
		bones: {
			chest: {
				orient: [
					{ time: 0, value: [1, 0, 0, 0] },
					{ time: 1, value: qy(35) },
					{ time: 2, value: qy(-20) },
				],
			},
			hand_ik: {
				translate: [
					{ time: 0, x: -40, y: 0 },
					{ time: 1, x: -80, y: 60 },
					{ time: 2, x: -60, y: -50 },
				],
				depth: [
					{ time: 0, value: 0 },
					{ time: 1, value: 50 },
					{ time: 2, value: -40 },
				],
			},
		},
		ik: { arm_ik: [{ time: 0, mix: 1 }] },
	},
};

// ── The checks: each answers the failures it finds (the planted mutants must make one fail) ─────

const CHECKS = {
	reach(M) {
		const out = [];
		const doc = docWith(REACH);
		const baked = bake(M, irigWith(), doc, 'reach');
		const at = pose3dOf(M, baked.irig, baked.doc, 'reach');
		const play = player(baked.irig, 'reach');
		let worst3 = 0;
		let worst2 = 0;
		let wrongSide = 0;
		let shortUpper = 0;
		const samples = new Set(grid(2, 1 / 120).map((t) => t.toFixed(9)));
		for (const t of [...grid(2), ...grid(2, 1 / 120)]) {
			const w = at(t);
			const hand = w.get('hand').o;
			const ctl = w.get('hand_ik').o;
			const root = w.get('upper').o;
			const mid = w.get('lower').o;
			if (samples.has(t.toFixed(9)) && dist(ctl, root) < L1 + L2 - 1e-3)
				worst3 = Math.max(worst3, dist(hand, ctl));
			shortUpper = Math.max(shortUpper, Math.abs(dist(mid, root) - L1));
			const u = sub(ctl, root).map((v) => v / dist(ctl, root));
			const off = (p) => {
				const d = sub(p, root);
				return sub(
					d,
					u.map((v) => v * dot(d, u)),
				);
			};
			if (dot(off(mid), off(w.get('elbow_pole').o)) <= 0) wrongSide++;
			const s = play(t);
			const [hx, hy] = at2(s, 'hand');
			worst2 = Math.max(worst2, Math.hypot(hx - ctl[0], hy - ctl[1]));
		}
		info(
			`reach: hand on the control ${worst3.toExponential(1)} (3D), ${worst2.toFixed(3)} (game); unmet ${baked.bake.report.unmet.length}`,
		);
		if (!(worst3 < 1e-6)) out.push(`the hand misses the control in 3D by ${worst3}`);
		if (!(worst2 < TOL))
			out.push(`as the game plays it the hand misses the control by ${worst2.toFixed(3)}`);
		if (!(shortUpper < 1e-6)) out.push(`the upper arm changed length by ${shortUpper}`);
		if (wrongSide) out.push(`the elbow is off the pole's side at ${wrongSide} times`);
		if (baked.bake.report.unmet.length)
			out.push(`${baked.bake.report.unmet.length} runs past the tolerance`);
		if (!baked.plan.owned.includes('upper') || !baked.plan.owned.includes('lower'))
			out.push(`the bake does not own the chain: ${baked.plan.owned.join(', ')}`);
		const anim = baked.irig.animations.reach;
		if (Object.keys(anim).some((k) => !['bones', 'drawOrder', 'slots'].includes(k)))
			out.push(`the bake wrote non-bone timelines: ${Object.keys(anim)}`);
		for (const [b, t] of Object.entries(anim.bones ?? {}))
			for (const k of Object.keys(t))
				if (!['rotate', 'translate', 'scale', 'sheary'].includes(k))
					out.push(`bone ${b} keys ${k}`);
		return out;
	},

	outOfReach(M) {
		const out = [];
		const clip = {
			far: {
				bones: {
					hand_ik: { translate: [{ time: 0, x: 120, y: 60 }], depth: [{ time: 0, value: 40 }] },
				},
				ik: { arm_ik: [{ time: 0, mix: 1 }] },
				duration: 0.5,
			},
		};
		const baked = bake(M, irigWith(), docWith(clip), 'far');
		const w = pose3dOf(M, baked.irig, baked.doc, 'far')(0.25);
		const root = w.get('upper').o;
		const hand = w.get('hand').o;
		const ctl = w.get('hand_ik').o;
		const along =
			dot(sub(hand, root), sub(ctl, root)) / (len(sub(hand, root)) * len(sub(ctl, root)));
		info(
			`out of reach: straight ${(1 - along).toExponential(1)}, length ${len(sub(hand, root)).toFixed(6)} of ${L1 + L2}`,
		);
		if (!(1 - along < 1e-9)) out.push(`the arm does not point at the control (cos ${along})`);
		if (!(Math.abs(len(sub(hand, root)) - (L1 + L2)) < 1e-6))
			out.push(`the arm is ${len(sub(hand, root))} long, not ${L1 + L2}`);
		const s = player(baked.irig, 'far')(0.25);
		const [hx, hy] = at2(s, 'hand');
		if (!(Math.hypot(hx - hand[0], hy - hand[1]) < TOL))
			out.push(`the game draws the hand ${Math.hypot(hx - hand[0], hy - hand[1])} off`);
		return out;
	},

	stretch(M) {
		const out = [];
		const clip = {
			far: {
				bones: {
					hand_ik: { translate: [{ time: 0, x: 80, y: 40 }], depth: [{ time: 0, value: 30 }] },
				},
				ik: { arm_ik: [{ time: 0, mix: 1 }] },
				duration: 0.5,
			},
		};
		const baked = bake(M, irigWith(), docWith(clip, [{ ...IK, stretch: true }]), 'far');
		const w = pose3dOf(M, baked.irig, baked.doc, 'far')(0.25);
		const e3 = dist(w.get('hand').o, w.get('hand_ik').o);
		const s = player(baked.irig, 'far')(0.25);
		const [hx, hy] = at2(s, 'hand');
		const c = w.get('hand_ik').o;
		const e2 = Math.hypot(hx - c[0], hy - c[1]);
		info(`stretch: hand on the control ${e3.toExponential(1)} (3D), ${e2.toFixed(3)} (game)`);
		if (!(e3 < 1e-6)) out.push(`stretched, the hand misses the control by ${e3}`);
		if (!(e2 < TOL)) out.push(`stretched, the game draws the hand ${e2} off the control`);
		return out;
	},

	softness(M) {
		const out = [];
		const soft = 20;
		// The control 5 units short of full reach, straight along the arm.
		const clip = {
			near: {
				bones: { hand_ik: { translate: [{ time: 0, x: -5, y: 0 }] } },
				ik: { arm_ik: [{ time: 0, mix: 1 }] },
				duration: 0.5,
			},
		};
		const baked = bake(M, irigWith(), docWith(clip, [{ ...IK, softness: soft }]), 'near');
		const w = pose3dOf(M, baked.irig, baked.doc, 'near')(0.25);
		const d = dist(w.get('hand_ik').o, w.get('upper').o);
		const over = d - (L1 + L2) + soft;
		const p = Math.min(1, over / (soft * 2)) - 1;
		const want = d - (over - soft * (1 - p * p));
		const got = dist(w.get('hand').o, w.get('upper').o);
		info(`softness: reach ${got.toFixed(6)}, 4.2's curve ${want.toFixed(6)}, the control at ${d}`);
		if (!(Math.abs(got - want) < 1e-6)) out.push(`softness reaches ${got}, not 4.2's ${want}`);
		return out;
	},

	poleFlip(M) {
		const out = [];
		const clip = {
			flip: {
				bones: {
					hand_ik: { translate: [{ time: 0, x: -50, y: 0 }] },
					elbow_pole: {
						depth: [
							{ time: 0, value: 0 },
							{ time: 1, value: 160 },
						],
					},
				},
				ik: { arm_ik: [{ time: 0, mix: 1 }] },
			},
		};
		const baked = bake(M, irigWith(), docWith(clip), 'flip');
		const at = pose3dOf(M, baked.irig, baked.doc, 'flip');
		const zAt = (t) => at(t).get('lower').o[2] - at(t).get('upper').o[2];
		info(
			`pole: elbow depth ${zAt(0).toFixed(2)} (pole behind) → ${zAt(1).toFixed(2)} (pole in front)`,
		);
		if (!(zAt(0) < -10 && zAt(1) > 10))
			out.push(`the elbow does not follow the pole across: ${zAt(0)} → ${zAt(1)}`);
		const play = player(baked.irig, 'flip');
		for (const t of [0, 0.5, 1]) {
			const s = play(t);
			const mid = at(t).get('lower').o;
			const [x, y] = at2(s, 'lower');
			if (!(Math.hypot(x - mid[0], y - mid[1]) < TOL))
				out.push(`at ${t} the game draws the elbow ${Math.hypot(x - mid[0], y - mid[1])} off`);
		}
		return out;
	},

	blend(M) {
		const out = [];
		const fk = {
			upper: { orient: [{ time: 0, value: qz(-40) }] },
			lower: { orient: [{ time: 0, value: qz(30) }] },
			hand_ik: { translate: [{ time: 0, x: -60, y: 50 }], depth: [{ time: 0, value: 30 }] },
		};
		const clip = (mix) => ({ c: { bones: fk, ik: { arm_ik: [{ time: 0, mix }] }, duration: 0.5 } });
		const turn = (mix) => {
			const doc = docWith(clip(mix));
			const rig = M.S.rigOf(irigWith(), doc);
			const plan = M.S.clipOf(rig, irigWith(), doc, 'c');
			return M.B.boneKeysAt(M.B.solveIk3d(rig, plan.clip).bones.upper, 0.25).orient;
		};
		const ang = (a, b) =>
			2 * Math.acos(Math.min(1, Math.abs(dot(a.slice(1), b.slice(1)) + a[0] * b[0])));
		const [q0, qh, q1] = [qz(-40), turn(0.5), turn(1)];
		info(
			`blend: FK→half ${(ang(q0, qh) / R).toFixed(4)}°, half→IK ${(ang(qh, q1) / R).toFixed(4)}°`,
		);
		if (!(ang(q0, q1) > 5 * R)) out.push('the IK turn is no different from the FK turn (vacuous)');
		if (!(Math.abs(ang(q0, qh) - ang(qh, q1)) < 1e-3 * R))
			out.push(`mix 0.5 is not half way: ${ang(q0, qh) / R}° and ${ang(qh, q1) / R}°`);
		return out;
	},

	mixZero(M) {
		const out = [];
		const bones = {
			upper: {
				orient: [
					{ time: 0, value: qz(-40) },
					{ time: 1, value: qy(30) },
				],
			},
			lower: {
				rotate: [
					{ time: 0, value: 20 },
					{ time: 1, value: 60 },
				],
			},
		};
		const off = bake(
			M,
			irigWith(),
			docWith({
				c: {
					bones,
					ik: {
						arm_ik: [
							{ time: 0, mix: 0 },
							{ time: 1, mix: 0 },
						],
					},
				},
			}),
			'c',
		);
		const none = bake(M, irigWith(), docWith({ c: { bones } }, []), 'c');
		const same = JSON.stringify(off.irig.animations.c) === JSON.stringify(none.irig.animations.c);
		info(`mix 0: the bake ${same ? 'is' : 'is NOT'} byte for byte the one with no IK`);
		if (!same) out.push('an IK at mix 0 changed the bake');
		return out;
	},

	steps(M) {
		const out = [];
		const clip = {
			s: {
				bones: {
					hand_ik: {
						translate: [
							{ time: 0, x: -40, y: 40, curve: 'stepped' },
							{ time: 1, x: -90, y: -40 },
						],
						depth: [
							{ time: 0, value: 30, curve: 'stepped' },
							{ time: 1, value: -30 },
						],
					},
				},
				ik: { arm_ik: [{ time: 0, mix: 1 }] },
				duration: 2,
			},
		};
		const baked = bake(M, irigWith(), docWith(clip), 's');
		const at = pose3dOf(M, baked.irig, baked.doc, 's');
		const play = player(baked.irig, 's');
		let worst = 0;
		for (const t of [0.9, 0.99, 0.995, 0.999, 1.001, 1.01]) {
			const ctl = at(t).get('hand_ik').o;
			const [x, y] = at2(play(t), 'hand');
			worst = Math.max(worst, Math.hypot(x - ctl[0], y - ctl[1]));
		}
		info(
			`steps: the hand on a control that jumps, ${worst.toFixed(3)} off at worst around the jump`,
		);
		if (!(worst < TOL))
			out.push(`around the control's jump the game draws the hand ${worst} off it`);
		return out;
	},

	carried(M) {
		const out = [];
		// The control keyed in 2D in the irig (it is not the bake's), the IK on.
		const irig = irigWith({
			c: {
				bones: {
					hand_ik: {
						translate: [
							{ time: 0, x: -50, y: 40 },
							{ time: 1, x: -90, y: -30 },
						],
					},
				},
			},
		});
		// The chest keys nothing in 3D, so only the IK makes the control the bake's input.
		const baked = bake(
			M,
			irig,
			docWith({ c: { duration: 1, bones: {}, ik: { arm_ik: [{ time: 0, mix: 1 }] } } }),
			'c',
		);
		const play = player(baked.irig, 'c');
		let worst = 0;
		for (const t of grid(1, 0.05)) {
			const want = [WRIST[0] - 50 + -40 * t, WRIST[1] + 40 - 70 * t];
			const [x, y] = at2(play(t), 'hand');
			worst = Math.max(worst, Math.hypot(x - want[0], y - want[1]));
		}
		info(`carried: the hand on a control keyed in 2D, ${worst.toFixed(3)} off`);
		if (!(worst < TOL)) out.push(`the hand misses a control keyed in 2D by ${worst}`);
		return out;
	},

	match(M) {
		const out = [];
		const fkBones = {
			chest: {
				orient: [
					{ time: 0, value: [1, 0, 0, 0] },
					{ time: 2, value: qy(25) },
				],
			},
			upper: {
				orient: [
					{ time: 0, value: qz(-30) },
					{ time: 2, value: M.B.orientOf(-70, 25, 10) },
				],
			},
			lower: {
				orient: [
					{ time: 0, value: qz(40) },
					{ time: 2, value: M.B.orientOf(70, -10, 0) },
				],
			},
		};
		const limb = {
			ik: 'arm_ik',
			ik3d: true,
			fk: ['upper', 'lower'],
			control: 'hand_ik',
			pole: 'elbow_pole',
			spaces: { prop: { bone: 'hand_ik_prop', constraint: 'hand_ik_in_prop' } },
		};
		const irig = irigWith();
		const start = bake(M, irig, docWith({ m: { bones: fkBones } }), 'm');
		const before = pose3dOf(M, start.irig, start.doc, 'm');
		// ⇄ To IK at 0.7.
		const toIk = M.K.switchLimb3d({
			irig: start.irig,
			doc: start.doc,
			clip: 'm',
			limb,
			to: 'ik',
			t0: 0.7,
		});
		if (toIk.error) return [`To IK: ${toIk.error}`];
		const ik = bake(M, start.irig, toIk.doc, 'm');
		const after = pose3dOf(M, ik.irig, ik.doc, 'm');
		// How far apart two poses are: each bone's origin and two points 50 units out on its card, so a
		// changed roll shows as well as a moved joint.
		const jump3 = (a, b, t) => {
			const [wa, wb] = [a(t), b(t)];
			let d = 0;
			for (const n of ['upper', 'lower', 'hand'])
				for (const p of [
					[0, 0, 0],
					[50, 0, 0],
					[0, 50, 0],
				]) {
					const ph = (f) =>
						[0, 1, 2].map(
							(r) => f.m[r * 3] * p[0] + f.m[r * 3 + 1] * p[1] + f.m[r * 3 + 2] * p[2] + f.o[r],
						);
					d = Math.max(d, dist(ph(wa.get(n)), ph(wb.get(n))));
				}
			return d;
		};
		const j1 = Math.max(
			...['hand', 'lower'].map((n) => dist(after(0.7 - 1e-4).get(n).o, after(0.7 + 1e-4).get(n).o)),
		);
		const earlier = jump3(before, after, 0.4);
		const gIk = player(ik.irig, 'm');
		const g0 = at2(gIk(0.7 - 1e-4), 'hand');
		const g1 = at2(gIk(0.7 + 1e-4), 'hand');
		const gj = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]);
		info(
			`To IK: ${j1.toExponential(1)} across the switch (3D), ${gj.toFixed(4)} (game); the earlier run moved ${earlier.toExponential(1)}`,
		);
		if (!(j1 < 1e-2)) out.push(`To IK jumps ${j1} in 3D`);
		if (!(gj < 0.05)) out.push(`To IK jumps ${gj} in the game`);
		if (!(earlier < 1e-6)) out.push(`To IK moved the run before it by ${earlier}`);
		if (!(
			M.K.ik3dMixAt(toIk.doc, 'm', 'arm_ik', 0.69) === 0 &&
			M.K.ik3dMixAt(toIk.doc, 'm', 'arm_ik', 0.71) === 1
		))
			out.push('To IK does not step the mix 0 → 1 at the switch');
		// ⇄ To FK at 1.3, after the arm followed the control on IK.
		const moved = clone(toIk.doc);
		moved.clips.m.bones.hand_ik.translate.push({ time: 1.5, x: -110, y: 50 });
		const ik2 = bake(M, start.irig, moved, 'm');
		const onIk = pose3dOf(M, ik2.irig, ik2.doc, 'm');
		const toFk = M.K.switchLimb3d({
			irig: ik2.irig,
			doc: ik2.doc,
			clip: 'm',
			limb,
			to: 'fk',
			t0: 1.3,
		});
		if (toFk.error) return [...out, `To FK: ${toFk.error}`];
		const fk = bake(M, ik2.irig, toFk.doc, 'm');
		const onFk = pose3dOf(M, fk.irig, fk.doc, 'm');
		const j2 = Math.max(
			...['hand', 'lower'].map((n) => dist(onFk(1.3 - 1e-4).get(n).o, onFk(1.3 + 1e-4).get(n).o)),
		);
		const kept = jump3(onIk, onFk, 1.0);
		const gFk = player(fk.irig, 'm');
		const h0 = at2(gFk(1.3 - 1e-4), 'hand');
		const h1 = at2(gFk(1.3 + 1e-4), 'hand');
		const gj2 = Math.hypot(h1[0] - h0[0], h1[1] - h0[1]);
		info(
			`To FK: ${j2.toExponential(1)} across the switch (3D), ${gj2.toFixed(4)} (game); the IK run before it moved ${kept.toExponential(1)}`,
		);
		if (!(j2 < 1e-2)) out.push(`To FK jumps ${j2} in 3D`);
		if (!(gj2 < 0.05)) out.push(`To FK jumps ${gj2} in the game`);
		if (!(kept < 1e-6)) out.push(`To FK moved the run before it by ${kept}`);
		// Matched over a range: at every matched key the IK pose is the FK pose.
		const range = M.K.switchLimb3d({
			irig: start.irig,
			doc: start.doc,
			clip: 'm',
			limb,
			to: 'ik',
			t0: 0.5,
			t1: 2,
		});
		if (range.error) return [...out, `To IK over a range: ${range.error}`];
		const rb = bake(M, start.irig, range.doc, 'm');
		const ranged = pose3dOf(M, rb.irig, rb.doc, 'm');
		let worst = 0;
		for (const t of range.times) worst = Math.max(worst, jump3(before, ranged, t));
		info(
			`To IK matched at ${range.times.length} keys (${range.times.join(', ')}): ${worst.toExponential(1)} off the FK pose`,
		);
		if (range.times.length < 2) out.push('a range matched at one key only (vacuous)');
		if (!(worst < 1e-2))
			out.push(`over a range the IK pose is ${worst} off the FK pose at a matched key`);
		// ⇄ Space: to a prop that then moves.
		const propDoc = clone(toIk.doc);
		const sp = M.K.switchLimb3dSpace({
			irig: ik.irig,
			doc: propDoc,
			clip: 'm',
			limb,
			to: 'prop',
			t: 1.0,
		});
		if (sp.error) return [...out, `Space: ${sp.error}`];
		sp.irig.animations.m.bones = {
			...(sp.irig.animations.m.bones ?? {}),
			prop: {
				translate: [
					{ time: 0, x: 0, y: 0 },
					{ time: 1, x: 0, y: 0 },
					{ time: 2, x: -50, y: 30 },
				],
			},
		};
		let spb;
		try {
			spb = bake(M, sp.irig, sp.doc, 'm');
		} catch (e) {
			return [
				...out,
				`a space on the control cannot be baked: ${String(e.message).split('\n')[0]}`,
			];
		}
		const sp3 = pose3dOf(M, spb.irig, spb.doc, 'm');
		const js = dist(sp3(1 - 1e-4).get('hand').o, sp3(1 + 1e-4).get('hand').o);
		const ride = dist(sp3(2).get('hand').o, sp3(2).get('hand_ik_prop').o);
		const g = player(spb.irig, 'm')(2);
		const [px, py] = at2(g, 'hand_ik_prop');
		const [hx, hy] = at2(g, 'hand');
		info(
			`Space: ${js.toExponential(1)} across the switch, the hand ${ride.toExponential(1)} off the prop's space bone (3D), ${Math.hypot(hx - px, hy - py).toFixed(3)} (game)`,
		);
		if (!(js < 1e-2)) out.push(`Space jumps ${js}`);
		if (!(ride < 1e-6)) out.push(`on the prop's space the hand is ${ride} off it`);
		if (!(Math.hypot(hx - px, hy - py) < TOL))
			out.push(`the game draws the hand ${Math.hypot(hx - px, hy - py)} off the prop's space bone`);
		return out;
	},

	stage(M) {
		const out = [];
		const rig = M.S.rigOf(irigWith(), docWith({}));
		const held = {
			hand_ik: { depth: 40, x: -60, y: 30, scaleX: 1, scaleY: 1, rotate: 0 },
			upper: { rotate: -20, depth: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
		};
		const f = M.V.heldFrames(rig, held, 30, { ik: { arm_ik: 1 } });
		const e = dist(f.get('hand').o, f.get('hand_ik').o);
		const off = M.V.heldFrames(rig, held, 30, { ik: { arm_ik: 0 } });
		const pose = M.V.viewPose(rig, held, 30, { ik: { arm_ik: 1 } });
		info(`stage: the held turned view puts the hand ${e.toExponential(1)} off the control`);
		if (!(e < 1e-6)) out.push(`the held view's hand is ${e} off the control`);
		if (!(dist(off.get('hand').o, off.get('hand_ik').o) > 1))
			out.push('at mix 0 the held view still reaches (vacuous)');
		if (pose.problems) out.push(`the turned view refuses the rig: ${pose.problems.join('; ')}`);
		else if (!pose.pose.baked.includes('lower'))
			out.push('the turned view does not bake the solved forearm');
		return out;
	},

	data(M) {
		const out = [];
		// The page's re-bake keeps a clip's IK keys.
		const baked = bake(M, irigWith(), docWith(REACH), 'reach');
		if (!baked.doc.clips.reach.ik?.arm_ik?.length)
			out.push("the re-bake dropped the clip's IK keys");
		const again = M.I.rebakeClip3d({
			irig: baked.irig,
			doc: baked.doc,
			clip: 'reach',
			owned: baked.plan.owned,
		});
		if (JSON.stringify(again.irig.animations.reach) !== JSON.stringify(baked.irig.animations.reach))
			out.push('a second re-bake changed the bake');
		// The schema and the fit.
		const doc = docWith(REACH);
		const p0 = M.S.rig3dDocProblems(doc);
		if (p0.length) out.push(`a 3D IK sidecar is refused: ${p0.join('; ')}`);
		if (M.S.rig3dIrigProblems(doc, irigWith()).length)
			out.push(`it does not fit its rig: ${M.S.rig3dIrigProblems(doc, irigWith())}`);
		const bad = [
			[{ ...IK, bones: ['lower', 'upper'] }, 'must be a child'],
			[{ ...IK, target: 'hand' }, 'moves with the chain'],
			[{ ...IK, end: undefined, bones: ['chest', 'upper'] }, 'moves with the chain'],
			[{ ...IK, end: undefined, bones: ['chest', 'upper'], target: 'prop', pole: undefined }, null],
			[{ ...IK, mix: 2 }, 'from 0 to 1'],
		];
		for (const [e, why] of bad) {
			const rig = M.S.rigOf(irigWith(), docWith({}, [e]));
			const got = M.B.ik3dProblems(rig, e);
			if (why === null ? got.length : !got.some((x) => x.includes(why)))
				out.push(`3D IK ${JSON.stringify(e)}: ${got.join('; ') || 'accepted'}`);
		}
		const noLen = clone(IRIG);
		noLen.bones.find((b) => b.name === 'lower').length = 0;
		const r2 = M.S.rigOf(noLen, docWith({}, [{ ...IK, end: undefined }]));
		if (!M.B.ik3dProblems(r2, { ...IK, end: undefined }).some((x) => x.includes('no length')))
			out.push('a lower bone with no length and no end is accepted');
		const unknown = M.B.rig2p5dProblems(M.S.rigOf(irigWith(), docWith({})), {
			name: 'c',
			duration: 1,
			bones: {},
			ik: { nope: [{ time: 0, mix: 1 }] },
		});
		if (!unknown.some((x) => x.includes('not in the rig')))
			out.push('a clip keying an unknown 3D IK is accepted');
		if (!M.S.rig3dDocProblems({ ...doc, ik: [{ ...IK, wobble: 1 }] }).length)
			out.push('an unknown 3D IK field is accepted');
		// Renames and deletes.
		const ren = clone(doc);
		M.W.rename3d(ren, 'bone', 'hand_ik', 'wrist_ctl');
		if (ren.ik[0].target !== 'wrist_ctl') out.push('a renamed control is not renamed in its 3D IK');
		const del = clone(doc);
		const irig = irigWith();
		irig.bones = irig.bones.filter((b) => b.name !== 'elbow_pole');
		M.W.fit3dToRig(del, irig);
		if (!del.ik || del.ik[0].pole !== undefined)
			out.push('a deleted pole leaves its 3D IK broken or gone');
		irig.bones = irig.bones.filter((b) => b.name !== 'hand' && b.name !== 'hand_ik');
		M.W.fit3dToRig(del, irig);
		if (del.ik || del.clips.reach.ik) out.push('a 3D IK whose control is deleted is kept');
		// controls.json keeps a 3D limb through the lenient read.
		const cdoc = {
			controls: 1,
			rig: 'arm',
			limbs: { arm_ik: { ik: 'arm_ik', ik3d: true, fk: ['upper', 'lower'], control: 'hand_ik' } },
		};
		const cp = M.C.controlsDocProblems(cdoc);
		if (cp.length) out.push(`controls.json refuses a 3D limb: ${cp.join('; ')}`);
		if (!M.C.fitControls(cdoc, irigWith()).doc.limbs?.arm_ik)
			out.push('the lenient read drops a 3D limb');
		if (M.C.controlsIrigProblems(cdoc, irigWith()).length)
			out.push(`the save refuses a 3D limb: ${M.C.controlsIrigProblems(cdoc, irigWith())}`);
		return out;
	},

	scaled(M) {
		const out = [];
		// Scale above the chain and on it: a 2D scale stretches x and y and never depth, so the frames
		// are not rotations — the solve works in the upper bone's parent's frame.
		const variants = [
			[
				'the root at half scale',
				(r) =>
					Object.assign(
						r.bones.find((b) => b.name === 'root'),
						{ scaleX: 0.5, scaleY: 0.5 },
					),
				{},
			],
			[
				'the chest mirrored',
				(r) =>
					Object.assign(
						r.bones.find((b) => b.name === 'chest'),
						{ scaleX: -1 },
					),
				{},
			],
			[
				'the upper arm mirrored',
				(r) =>
					Object.assign(
						r.bones.find((b) => b.name === 'upper'),
						{ scaleY: -1 },
					),
				{},
			],
			[
				'the upper arm at 1.2',
				(r) =>
					Object.assign(
						r.bones.find((b) => b.name === 'upper'),
						{ scaleX: 1.2, scaleY: 1.2 },
					),
				{},
			],
			[
				'the chest breathing',
				() => {},
				{
					scale: [
						{ time: 0, x: 1, y: 1 },
						{ time: 1, x: 1.05, y: 1.05 },
						{ time: 2, x: 1, y: 1 },
					],
				},
			],
			[
				'the upper arm and the forearm set turned',
				(r) => {
					Object.assign(
						r.bones.find((b) => b.name === 'upper'),
						{ rotation: 30 },
					);
					Object.assign(
						r.bones.find((b) => b.name === 'lower'),
						{ rotation: -50 },
					);
				},
				{},
			],
		];
		for (const [name, mutate, chestKeys] of variants) {
			const irig = irigWith();
			mutate(irig);
			const clips = clone(REACH);
			Object.assign(clips.reach.bones.chest, chestKeys);
			const baked = bake(M, irig, docWith(clips), 'reach');
			const at = pose3dOf(M, baked.irig, baked.doc, 'reach');
			const play = player(baked.irig, 'reach');
			let worst3 = 0;
			let worst2 = 0;
			for (const t of grid(2, 1 / 120)) {
				const w = at(t);
				const ctl = w.get('hand_ik').o;
				const root = w.get('upper').o;
				const reach = dist(root, w.get('lower').o) + dist(w.get('lower').o, w.get('hand').o);
				if (dist(ctl, root) < reach - 1e-3) worst3 = Math.max(worst3, dist(w.get('hand').o, ctl));
				const [hx, hy] = at2(play(t), 'hand');
				worst2 = Math.max(worst2, Math.hypot(hx - ctl[0], hy - ctl[1]));
			}
			info(
				`scaled, ${name}: the hand on the control ${worst3.toExponential(1)} (3D), ${worst2.toFixed(3)} (game)`,
			);
			if (!(worst3 < 1e-6)) out.push(`${name}: the hand misses the control by ${worst3} in 3D`);
			if (!(worst2 < TOL)) out.push(`${name}: the game draws the hand ${worst2} off the control`);
		}
		return out;
	},

	toIk2d(M) {
		const out = [];
		// An arm keyed only in 2D, on a clip made 3D with nothing 3D in it: ⇄ To IK measures it as it plays.
		const irig = irigWith({
			m: {
				bones: {
					upper: {
						rotate: [
							{ time: 0, value: 30 },
							{ time: 1, value: -25 },
						],
					},
					lower: {
						rotate: [
							{ time: 0, value: 50 },
							{ time: 1, value: 20 },
						],
					},
				},
			},
		});
		const doc = docWith({ m: { duration: 1, bones: {} } });
		const limb = {
			ik: 'arm_ik',
			ik3d: true,
			fk: ['upper', 'lower'],
			control: 'hand_ik',
			pole: 'elbow_pole',
		};
		const start = bake(M, irig, doc, 'm');
		const s = M.K.switchLimb3d({
			irig: start.irig,
			doc: start.doc,
			clip: 'm',
			limb,
			to: 'ik',
			t0: 0.5,
		});
		if (s.error) return [`To IK: ${s.error}`];
		const after = bake(M, start.irig, s.doc, 'm');
		const g0 = player(start.irig, 'm');
		const g1 = player(after.irig, 'm');
		const before = at2(g0(0.3), 'hand');
		const kept = at2(g1(0.3), 'hand');
		const a = at2(g1(0.5 - 1e-4), 'hand');
		const b = at2(g1(0.5 + 1e-4), 'hand');
		const jump = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const moved = Math.hypot(kept[0] - before[0], kept[1] - before[1]);
		info(
			`To IK on a 2D arm: ${jump.toFixed(4)} across the switch, the run before it moved ${moved.toFixed(4)} (game)`,
		);
		if (!(jump < 0.05)) out.push(`To IK on an arm keyed in 2D jumps ${jump}`);
		if (!(moved < TOL)) out.push(`To IK moved the 2D run before it by ${moved}`);
		return out;
	},

	refusals(M) {
		const out = [];
		// A follower's art is drawn on its 2D parent: a constraint on that parent, art-less itself, moves it.
		const rig = {
			bones: [
				{ name: 'root' },
				{ name: 'arm', parent: 'root', length: 50, card: { x0: 0, x1: 50, h: 5 } },
				{ name: 'holder', parent: 'root' },
				{ name: 'img', parent: 'holder', follow: 'arm' },
			],
			slots: [{ name: 'img', bone: 'img', attachment: 'img' }],
			constraints: [{ name: 'transform hold', bones: ['holder'], mix: 1 }],
		};
		const clip = {
			name: 'c',
			duration: 1,
			bones: { arm: { orient: [{ time: 0, value: qy(30) }] } },
		};
		if (!M.B.rig2p5dProblems(rig, clip).some((x) => x.includes('transform hold')))
			out.push("a live constraint on a follower's 2D parent is accepted");
		// A constraint that is not a space, on a 3D IK's control: the solve would not see it.
		const irig = irigWith();
		irig.transform.push({
			name: 'pin',
			order: 1,
			bones: ['hand_ik'],
			target: 'prop',
			x: 10,
			mixRotate: 0,
			mixX: 1,
			mixY: 1,
			mixScaleX: 0,
			mixScaleY: 0,
			mixShearY: 0,
		});
		const doc = docWith(REACH);
		const r = M.S.rigOf(irig, doc);
		const got = M.B.rig2p5dProblems(r, M.S.clipOf(r, irig, doc, 'reach').clip);
		if (!got.some((x) => x.includes('pin') && x.includes('reads its control')))
			out.push(`a constraint moving a 3D IK's control is accepted: ${got.join('; ')}`);
		const spaceOnly = M.B.rig2p5dProblems(
			M.S.rigOf(irigWith(), doc),
			M.S.clipOf(M.S.rigOf(irigWith(), doc), irigWith(), doc, 'reach').clip,
		);
		if (spaceOnly.length) out.push(`the control's space is refused: ${spaceOnly.join('; ')}`);
		return out;
	},

	stretchDepth(M) {
		const out = [];
		const clip = {
			far: {
				bones: {
					hand_ik: { translate: [{ time: 0, x: 80, y: 40 }], depth: [{ time: 0, value: 30 }] },
				},
				ik: { arm_ik: [{ time: 0, mix: 1 }] },
				duration: 0.5,
			},
		};
		const doc = docWith(clip, [{ ...IK, stretch: true }]);
		doc.bones.lower = { depth: 20 };
		const baked = bake(M, irigWith(), doc, 'far');
		const w = pose3dOf(M, baked.irig, baked.doc, 'far')(0.25);
		const e3 = dist(w.get('hand').o, w.get('hand_ik').o);
		info(`stretch, the elbow 20 in depth: the hand on the control ${e3.toExponential(1)}`);
		if (!(e3 < 1e-6)) out.push(`stretched with the elbow at a depth, the hand misses by ${e3}`);
		return out;
	},

	spaceMix(M) {
		const out = [];
		// A space key whose rotate mix is full but translate mix is 0 leaves the control in place.
		const key = (x) => ({
			time: 0,
			mixRotate: 1,
			mixX: x,
			mixY: x,
			mixScaleX: 0,
			mixScaleY: 0,
			mixShearY: 0,
		});
		const handAt = (x) => {
			// The prop brought within the arm's reach (at setup its space bone is at full reach).
			const irig = irigWith({
				reach: {
					bones: { prop: { translate: [{ time: 0, x: -40, y: 30 }] } },
					transform: { hand_ik_in_prop: [key(x)] },
				},
			});
			const baked = bake(M, irig, docWith(REACH), 'reach');
			const w = pose3dOf(M, baked.irig, baked.doc, 'reach')(0.5);
			return { hand: w.get('hand').o, own: w.get('hand_ik').o, space: w.get('hand_ik_prop').o };
		};
		const off = handAt(0);
		const on = handAt(1);
		info(
			`space mix: translate 0 → the hand ${dist(off.hand, off.own).toExponential(1)} off its own place; 1 → ${dist(on.hand, on.space).toExponential(1)} off the space bone`,
		);
		if (!(dist(off.hand, off.own) < 1e-6))
			out.push(`a space at translate mix 0 moved the control (${dist(off.hand, off.own)})`);
		if (!(dist(on.hand, on.space) < 1e-6))
			out.push(`a space at translate mix 1 did not carry the control (${dist(on.hand, on.space)})`);
		return out;
	},

	twoBoneIk(M) {
		const out = [];
		// #1853's reach as it was on main, verbatim, against the shared solver.
		const old = (root, end, l1, l2, poles) => {
			const reach = (l1 + l2) * 0.999;
			const d = sub(end, root);
			const flat = Math.hypot(d[0], d[1]);
			if (!(flat <= reach)) return null;
			let to = [end[0], end[1], end[2]];
			if (Math.hypot(d[0], d[1], d[2]) > reach)
				to = [
					end[0],
					end[1],
					root[2] + Math.sign(d[2]) * Math.sqrt(Math.max(0, reach ** 2 - flat ** 2)),
				];
			const span = sub(to, root);
			const l = Math.hypot(...span);
			if (l < Math.abs(l1 - l2) + 1e-6 || l < 1e-9) return null;
			const u = span.map((v) => v / l);
			let n = null;
			for (const p of poles) {
				if (!p) continue;
				const off = sub(
					p,
					u.map((v) => v * dot(p, u)),
				);
				if (len(off) > 0.1 * len(p)) {
					n = off.map((v) => v / len(off));
					break;
				}
			}
			if (!n) return null;
			const c = Math.max(-1, Math.min(1, (l1 * l1 + l * l - l2 * l2) / (2 * l1 * l)));
			const s = Math.sqrt(1 - c * c);
			return { mid: root.map((v, i) => v + l1 * (c * u[i] + s * n[i])), end: to };
		};
		let seed = 7;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
		const v = (k) => [rnd() * k, rnd() * k, rnd() * k];
		let worst = 0;
		let same = 0;
		let reached = 0;
		for (let i = 0; i < 4000; i++) {
			const root = v(50);
			const l1 = 40 + 60 * Math.abs(rnd());
			const l2 = 40 + 60 * Math.abs(rnd());
			const end = root.map((x, k) => x + v(l1 + l2)[k] * 1.1);
			const poles = [rnd() > -0.6 ? v(80) : null, v(80)];
			const a = old(root, end, l1, l2, poles);
			const b = M.L.twoBoneIk(root, end, l1, l2, poles);
			if (!a !== !b) continue;
			same++;
			if (!a) continue;
			reached++;
			worst = Math.max(worst, dist(a.mid, b.mid), dist(a.end, b.end));
		}
		info(
			`motion's reach: ${same}/4000 agree on reaching (${reached} reached), ${worst.toExponential(1)} apart`,
		);
		if (same !== 4000) out.push(`${4000 - same} cases disagree on whether the end is reached`);
		if (!(worst < 1e-9)) out.push(`the shared solver is ${worst} off #1853's`);
		if (reached < 1000) out.push('too few reached cases (vacuous)');
		return out;
	},
};

// ── Run them, then the planted mutants ──────────────────────────────────────────────────────────

const ONLY = process.argv
	.find((a) => a.startsWith('--only='))
	?.slice(7)
	.split(',');
const M0 = await modules();
const t0 = Date.now();
for (const [name, check] of Object.entries(CHECKS)) {
	if (ONLY && !ONLY.includes(name)) continue;
	let found;
	const at = Date.now();
	try {
		found = check(M0);
	} catch (e) {
		found = [`threw: ${e.stack ?? e}`];
	}
	ok(
		`[${name}] ${found.length ? found.length + ' failure(s)' : 'passes'}`,
		!found.length,
		found.slice(0, 6).join('\n        '),
	);
	console.log(`  [${name}] ${Date.now() - at} ms`);
}
const checkMs = Date.now() - t0;

const MUTANTS = [
	{
		name: 'the elbow bent away from the pole',
		check: 'reach',
		file: 'rig3dLimb.ts',
		find: 'root[0] + a * (c * u[0] + s * n[0]),',
		replace: 'root[0] + a * (c * u[0] - s * n[0]),',
	},
	{
		name: 'no stretch',
		check: 'stretch',
		file: 'rig3dLimb.ts',
		find: 'const k = options.stretch && reach > full ? reach / full : 1;',
		replace: 'const k = 1;',
	},
	{
		name: 'no softness',
		check: 'softness',
		file: 'rig3dLimb.ts',
		find: 'if (soft > 0) {',
		replace: 'if (false) {',
	},
	{
		name: 'the pole ignored',
		check: 'poleFlip',
		file: 'rig2p5d.ts',
		find: 'e.pole === undefined ? null : minus3(local(placeOf(e.pole)), root),',
		replace: 'null,',
	},
	{
		name: 'the mix ignored',
		check: 'blend',
		file: 'rig2p5d.ts',
		find: 'qu = slerp(qu, qu1, mix);',
		replace: 'qu = qu1;',
	},
	{
		name: 'the forearm not swung',
		check: 'reach',
		file: 'rig2p5d.ts',
		find: 'const ql1 = quatOf(mm(mm(transpose3(zL), mm(R2, zL)), qmat(ql)));',
		replace: 'const ql1 = ql;',
	},
	{
		name: "the upper arm's swing taken in its own frame",
		check: 'scaled',
		file: 'rig2p5d.ts',
		find: 'const qu1 = quatOf(mm(mm(transpose3(zU), mm(R1, zU)), qmat(qu)));',
		replace: 'const qu1 = quatOf(mm(R1, qmat(qu)));',
	},
	{
		name: 'no left limit at a jump',
		check: 'steps',
		file: 'rig2p5d.ts',
		find: 'if (j > LIMIT) raw.push({ t: j - LIMIT, step: true }, { t: j, step: false });',
		replace: 'if (j > LIMIT) raw.push({ t: j, step: false });',
	},
	{
		name: 'spaces not read',
		check: 'match',
		file: 'rig2p5d.ts',
		find: 'if (m) p = p.map((v, i) => v + (at[i] - v) * m);',
		replace: '',
	},
	{
		name: 'an art-less constraint refused',
		check: 'match',
		file: 'rig2p5d.ts',
		find: 'const hit = c.bones.find((n) => carried.has(n) && drawn.has(n));',
		replace: 'const hit = c.bones.find((n) => carried.has(n));',
	},
	{
		name: 'IK at mix 0 still solved',
		check: 'mixZero',
		file: 'rig2p5d.ts',
		find: 'return keys.some((k) => k.mix > 0) || ((keys[0].time ?? 0) > 0 && rest > 0);',
		replace: 'return true;',
	},
	{
		name: "the controls' 2D keys not read",
		check: 'carried',
		file: 'rig3d.ts',
		find: "if (!carried.has(p)) carried.set(p, `places 3D IK ${e.name}'s control`);",
		replace: 'void 0;',
	},
	{
		name: "the re-bake drops the clip's IK keys",
		check: 'data',
		file: 'rig3dImport.ts',
		find: '...(ik ? { ik } : {}),\n\t\t\t...(prev?.baked',
		replace: '...(prev?.baked',
	},
	{
		name: 'To IK keys no pole',
		check: 'match',
		file: 'rig3dIk.ts',
		find: "keyPlace(edit, owned, e.pole, m.w.get(parentOf.get(e.pole) ?? ''), at, m.t, first);",
		replace: '',
	},
	{
		name: 'To FK keys no FK turn',
		check: 'match',
		file: 'rig3dIk.ts',
		find: 'upsert(node.orient, { time: m.t, value: v.orient });',
		replace: '',
	},
	{
		name: 'To FK holds nothing before the switch',
		check: 'match',
		file: 'rig3dIk.ts',
		find: 'if (first) holdBefore(node.orient, m.t, true, [], {});',
		replace: '',
	},
	{
		name: 'To IK keys the control at the elbow',
		check: 'match',
		file: 'rig3dIk.ts',
		find: "keyPlace(edit, owned, carrier, m.w.get(parentOf.get(carrier) ?? ''), m.wrist, m.t, first);",
		replace:
			"keyPlace(edit, owned, carrier, m.w.get(parentOf.get(carrier) ?? ''), m.elbow, m.t, first);",
	},
	{
		name: 'the held view ignores the mixes',
		check: 'stage',
		file: 'rig3dView.ts',
		find: 'if (mixes.ik) clip.ik = held(mixes.ik);',
		replace: '',
	},
	{
		name: 'a rename skips the 3D IK',
		check: 'data',
		file: 'rig3dViews.ts',
		find: "for (const f of ['end', 'target', 'pole'] as const) if (e[f] === from) e[f] = to;",
		replace: '',
	},
	{
		name: 'a delete keeps a broken 3D IK',
		check: 'data',
		file: 'rig3dViews.ts',
		find: '[...e.bones, e.end, e.target].every((n) => n === undefined || bones.has(n)),',
		replace: 'true,',
	},
	{
		name: "controls.json checks a 3D limb's IK in the irig",
		check: 'data',
		file: 'rigControls.ts',
		find: "const ik = limb.ik3d ? limb.ik : ref('ik', limb.ik, `${at}.ik`);",
		replace: "const ik = ref('ik', limb.ik, `${at}.ik`);",
	},
	{
		name: "the solve in the world, not the parent's frame",
		check: 'scaled',
		file: 'rig2p5d.ts',
		find: 'const inv = parent ? inverse3(parent.m) : IDENTITY3;',
		replace: 'const inv = IDENTITY3;',
	},
	{
		name: "the upper arm's scale not undone for the forearm",
		check: 'scaled',
		file: 'rig2p5d.ts',
		find: 'const w = [toEnd[0] / (g * ux), toEnd[1] / (g * uy), toEnd[2]];',
		replace: 'const w = toEnd;',
	},
	{
		name: 'To IK measures a 2D arm at its setup',
		check: 'toIk2d',
		file: 'rig3dIk.ts',
		find: 'nodeOf(edit, before, n);',
		replace: 'void before;',
	},
	{
		name: "a follower's art taken as its followed bone's",
		check: 'refusals',
		file: 'rig2p5d.ts',
		find: "b && !drawn.has(b.name); b = bones.get(b.parent ?? ''))",
		replace: "b && !drawn.has(b.name); b = bones.get(b.follow ?? b.parent ?? ''))",
	},
	{
		name: "a constraint on a 3D IK's control not refused",
		check: 'refusals',
		file: 'rig2p5d.ts',
		find: 'if (reads.includes(c) || !isLive(c)) continue;',
		replace: 'continue;',
	},
	{
		name: 'a stretch grows the upper arm by the factor alone',
		check: 'stretchDepth',
		file: 'rig2p5d.ts',
		find: ': growXY([ux * elbow[0], uy * elbow[1], elbow[2]], len3(upper) * solved.stretch);',
		replace: ': solved.stretch;',
	},
	{
		name: 'a space read by its largest mix',
		check: 'spaceMix',
		file: 'rig2p5d.ts',
		find: '(k) => k.x ?? k.mix, 1,',
		replace: '(k) => k.mix, 0,',
	},
	{
		name: "the motion import's reach changed",
		check: 'twoBoneIk',
		file: 'rig3dLimb.ts',
		find: 'const IK_SLACK = 0.999;',
		replace: 'const IK_SLACK = 0.99;',
	},
];
INFO = false;
for (const m of MUTANTS.filter((x) => !ONLY || ONLY.includes(x.check))) {
	let found;
	try {
		const M = await modules(m);
		found = CHECKS[m.check](M);
	} catch (e) {
		const full = String(e.message ?? e);
		const msg = full.split('\n')[0];
		// A mutant whose text is gone must fail the run, not count as caught.
		if (full.includes(`mutant ${m.name}: found`)) {
			ok(
				`mutant "${m.name}" still applies`,
				false,
				full.split('\n').find((l) => l.includes(': found ')),
			);
			continue;
		}
		found = [`threw: ${msg}`];
	}
	ok(`mutant "${m.name}" is caught by [${m.check}]`, found.length > 0);
	console.log(
		`  mutant ${m.name}: [${m.check}] ${found.length ? found[0].split('\n')[0] : 'NOT CAUGHT'}`,
	);
}

console.log(`${checks - fails}/${checks} checks passed (the checks ran in ${checkMs} ms)`);
if (fails) process.exit(1);
