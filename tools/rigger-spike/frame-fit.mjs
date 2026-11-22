// Frame to rig, phases F2a + F4 (docs/design/frame-to-rig.md §4.6, §4.7, §8.3): `templateRig` with a
// fit, headless, on the SHIPPED code — the templates, `templateRig` and `fitTemplate` from
// apps/launcher-api/src/lib/server, the pose check the template store runs (rigTemplateCheck.ts), the
// control keys and starter clips written by the Controls section's helpers pulled out of view.html,
// and every pose played by engine-rig's loader and AnimationState, as a game plays it. Asserted:
//  - joints: a synthetic performer (the template's lengths × 0.33–1.3, every chain joint turned) →
//    its joints → a fit (lengths along the template's directions, the frame's turns) → engine-rig
//    poses the `frame` clip with every joint within 0.5 rig units, on Half body, Full body and Bust;
//  - finite: every control at min / rest / max (the store's pose check, with every part and with only
//    the needed ones, and keyed by the Controls section on the made rig) and every starter clip at its
//    start, middle, end and keys pose finite on the three fitted templates, props and bends included;
//  - lengths: a limb's shortening brings the next joint to 0.3 of its FITTED length; every control bone
//    sits on what it marks (the hand controls and their spaces at the wrist, the poles at the elbow and
//    knee), the poles behind by the fitted arm; image bones stay on their joints; a template's own
//    timeline clip slides a fitted bone by its fitted length (keys and bezier); `template.json` keeps
//    the fit, and the Controls read the fitted template back from it; no fit makes the rig as before;
//  - T12a's control layer (rings, IK squares and poles, sets, picker) binds to every fitted rig as the
//    template made it; K4's 3D IK on the fitted arm (its shipped solve and bake) keeps the hand on the
//    fitted wrist with the IK on, reaches a moved control with the fitted arm's lengths, the pole at its
//    fitted depth, and the game plays the bake within 0.5;
//  - props: NellyAnimTest's six on slots of their own, drawn where asked, each image centred on its
//    bone; a depth control moves the watch and the ring with the arm, the 3D layers take them with the
//    hand and the head; a prop without art is listed missing, never needed;
//  - refused: an unknown bone, slot, part or field, a non-finite value, a turned bone, a bone with no
//    length, a control, a scale of 0, a bend that does not ramp — each with its reason;
//  - bends (F4): the torso on hip, spine and chest, the left arm as one piece, weights ramping along the
//    limb across each joint by the limb's width there. A lean + twist and the elbow bent 35° (the
//    proof's bent pose) pose with no crack (the proof's 9 px closing, inside the bent limb) and no
//    folded triangle, the limb riding its bones away from the joints, against the Rigger's proximity
//    skinner on the same mesh and rigid parts cut at the joint; no fold to 75° and less of the bent arm
//    lost than the rigid parts to 90° (the sweep to 120° is printed); the one-piece arm stands in for
//    the forearm (not reported needed);
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/frame-fit.mjs [--only <guard>] [--png <dir>]
//   (--only: one guard, no mutants; --png: each bend pose's coverage, its gaps and cracks red)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const APP = fileURLToPath(new URL('../../apps/launcher-api/', import.meta.url));
const SERVER = join(APP, 'src/lib/server');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const {
	TextureAtlas,
	AtlasAttachmentLoader,
	SkeletonJson,
	Skeleton,
	AnimationState,
	AnimationStateData,
	Physics,
	Vector2,
} = RIG;

const dir = mkdtempSync(join(tmpdir(), 'frame-fit-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let bundles = 0;
/** The shipped server modules, with `mutate` ([file, from, to]) swapped into their source first. */
async function load(mutate = []) {
	const out = join(dir, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './rigTemplates.ts';",
				"export * from './rigTemplateFit.ts';",
				"export { rigTemplateSaveProblem } from './rigTemplateCheck.ts';",
			].join('\n'),
			resolveDir: SERVER,
			loader: 'ts',
			sourcefile: 'frame-fit-entry.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'silent',
		plugins: [
			{
				name: 'mutate',
				setup(build) {
					// The pose check's save validator reaches the server's env; nothing here reads it.
					build.onResolve({ filter: /^\$env\/dynamic\/private$/ }, () => ({
						path: 'env',
						namespace: 'stub',
					}));
					build.onLoad({ filter: /^env$/, namespace: 'stub' }, () => ({
						contents: 'export const env = {};',
						loader: 'js',
					}));
					build.onLoad({ filter: /rigTemplate(s|Fit)\.ts$/ }, (args) => {
						let text = readFileSync(args.path, 'utf8');
						for (const [file, from, to] of mutate) {
							if (!args.path.replaceAll('\\', '/').endsWith(`/${file}`)) continue;
							if (!text.includes(from)) throw new Error(`mutant: "${from}" is not in ${file}`);
							text = text.replace(from, to);
						}
						return { contents: text, loader: 'ts' };
					});
				},
			},
		],
	});
	return import(pathToFileURL(out).href);
}

/** K4's 3D modules and T12a's controls.json schema, as the page and the bake run them. */
async function loadLib() {
	const out = join(dir, 'lib.mjs');
	const lib = (f) => JSON.stringify(join(APP, 'src/lib', f).replaceAll('\\', '/'));
	await esbuild.build({
		stdin: {
			contents: [
				`export * as B from ${lib('rig2p5d.ts')};`,
				`export * as S from ${lib('rig3d.ts')};`,
				`export * as I from ${lib('rig3dImport.ts')};`,
				`export * as K from ${lib('rig3dIk.ts')};`,
				`export * as C from ${lib('rigControls.ts')};`,
			].join('\n'),
			resolveDir: SERVER,
			loader: 'ts',
			sourcefile: 'frame-fit-lib.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'silent',
	});
	return import(pathToFileURL(out).href);
}
const LIB = await loadLib();

// The Controls section's helpers, pulled out of the shipped page.
const html = readFileSync(join(APP, 'static/rigger/view.html'), 'utf8');
const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
	.map((m) => m[1])
	.join('\n');
function grabFn(name) {
	const at = src.indexOf(`\nfunction ${name}(`);
	if (at === -1) throw new Error(`view.html has no function ${name}`);
	let depth = 0;
	let j = src.indexOf('{', at);
	for (; j < src.length; j++) {
		if (src[j] === '{') depth++;
		else if (src[j] === '}' && --depth === 0) break;
	}
	return src.slice(at, j + 1);
}
function grabConst(name) {
	const m = src.match(new RegExp(`\\nconst ${name} = [^\\n]*`));
	if (!m) throw new Error(`view.html has no const ${name}`);
	return m[0];
}
const PAGE = new Function(
	[
		...['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'].map(grabConst),
		...[
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
			'faceChannelValue',
			'faceKeyChannel',
			'faceShapePart',
			'faceShapeControls',
			'faceKeyShape',
			'faceTimelineClip',
			'faceAddStarterClips',
			'distToSegment',
		].map(grabFn),
		'return { faceKeyChannel, faceAddStarterClips, distToSegment };',
	].join('\n'),
)();

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return true;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	return false;
};

// ---- geometry --------------------------------------------------------------------------------
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const rot = (d, [x, y]) => [
	x * Math.cos(rad(d)) - y * Math.sin(rad(d)),
	x * Math.sin(rad(d)) + y * Math.cos(rad(d)),
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = ([x, y]) => Math.hypot(x, y);
const wrap = (d) => d - 360 * Math.round(d / 360);
const SIDES = ['l', 'r'];
const both = (f) => Object.fromEntries(SIDES.flatMap((s) => Object.entries(f(s))));

/**
 * A performer per template: its own lengths (each bone's offset × the ratio, along the template's
 * direction), the joints it turns (degrees, each against its parent, as a key turns a bone), and
 * the joints a tracker would give (each turned bone aims at the child named here; the root is the
 * fit's origin, as the hips' or the shoulders' middle is the proof's).
 */
const PERFORMERS = {
	'half-body': {
		// NellyAnimTest's fit (§8.3): chest 185 / 150, neck → head 52 / 40, arms 1.17–1.24 × the
		// template's, the right forearm foreshortened to 56 / 170.
		lengths: {
			chest: 1.233,
			head: 1.3,
			lower_arm_l: 1.242,
			lower_arm_r: 1.168,
			hand_l: 1.194,
			hand_r: 0.329,
		},
		turns: {
			spine: 4,
			chest: -7,
			neck: 9,
			head: -6,
			upper_arm_l: 38,
			lower_arm_l: 52,
			hand_l: -21,
			upper_arm_r: -64,
			lower_arm_r: -97,
			hand_r: 17,
		},
		aims: {
			spine: 'chest',
			chest: 'neck',
			neck: 'head',
			head: 'face',
			...both((s) => ({
				[`upper_arm_${s}`]: `lower_arm_${s}`,
				[`lower_arm_${s}`]: `hand_${s}`,
				[`hand_${s}`]: `middle_1_${s}`,
			})),
		},
		joints: ['root', 'upper_arm_l', 'upper_arm_r'],
	},
	'full-body': {
		lengths: {
			spine: 1.2,
			chest: 1.15,
			head: 1.3,
			lower_arm_l: 1.1,
			lower_arm_r: 0.9,
			hand_l: 1.2,
			hand_r: 0.45,
			shin_l: 1.1,
			shin_r: 1.05,
			foot_l: 0.95,
			foot_r: 1.2,
		},
		turns: {
			hip: 3,
			spine: -5,
			chest: 6,
			neck: -8,
			upper_arm_l: 30,
			lower_arm_l: 45,
			upper_arm_r: -50,
			lower_arm_r: -30,
			thigh_l: 12,
			shin_l: -25,
			thigh_r: -8,
			shin_r: 15,
		},
		aims: {
			hip: 'spine',
			spine: 'chest',
			chest: 'neck',
			neck: 'head',
			...both((s) => ({
				[`upper_arm_${s}`]: `lower_arm_${s}`,
				[`lower_arm_${s}`]: `hand_${s}`,
				[`thigh_${s}`]: `shin_${s}`,
				[`shin_${s}`]: `foot_${s}`,
			})),
		},
		joints: ['root'],
	},
	'bust-face': {
		lengths: { chest: 1.1, shoulder_l: 1.15, shoulder_r: 1.15, neck: 0.8, head: 1.25 },
		turns: { chest: 5, neck: -9, head: 7 },
		aims: { chest: 'neck', neck: 'head', head: 'face' },
		joints: ['root', 'shoulder_l', 'shoulder_r'],
	},
};

/** The performer's world joints (rig units, y up), by its own forward kinematics. */
function perform(t, p) {
	const P = new Map();
	const W = new Map();
	for (const b of t.bones) {
		const k = p.lengths[b.name] ?? 1;
		const pp = b.parent ? P.get(b.parent) : [0, 0];
		const pw = b.parent ? W.get(b.parent) : 0;
		const o = rot(pw, [b.x * k, b.y * k]);
		P.set(b.name, [pp[0] + o[0], pp[1] + o[1]]);
		W.set(b.name, pw + (p.turns[b.name] ?? 0));
	}
	const seen = new Set([...Object.keys(p.aims), ...Object.values(p.aims), ...p.joints]);
	return Object.fromEntries([...seen].map((n) => [n, P.get(n)]));
}

/**
 * A fit from tracked joints (what F2b's cut computes, §4.6): each joint's length from its parent's
 * joint, along the template's direction; each aiming bone turned so its child lands on its joint.
 */
function fitFromJoints(t, J, aims) {
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const W = new Map();
	const fit = { bones: {}, frame: {} };
	for (const b of t.bones) {
		const pw = b.parent ? (W.get(b.parent) ?? 0) : 0;
		if (J[b.name] && b.parent && J[b.parent]) {
			const l = len(sub(J[b.name], J[b.parent]));
			const tl = Math.hypot(b.x, b.y);
			if (Math.abs(l - tl) > 1e-6) fit.bones[b.name] = { x: (b.x / tl) * l, y: (b.y / tl) * l };
		}
		let r = 0;
		const aim = aims[b.name];
		if (aim) {
			const c = byName.get(aim);
			const d = sub(J[aim], J[b.name]);
			r = wrap(deg(Math.atan2(d[1], d[0])) - deg(Math.atan2(c.y, c.x)) - pw);
			fit.frame[b.name] = { rotate: r };
		}
		W.set(b.name, pw + r);
	}
	return fit;
}

// ---- rigs through engine-rig -------------------------------------------------------------------
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function loadRig(skeleton, regions, animations = skeleton.animations) {
	const lines = ['page.png', 'size:8192,8192', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	const atlas = new TextureAtlas(`${lines.join('\n')}\n`);
	for (const p of atlas.pages) p.setTexture(stub);
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify({ ...skeleton, animations })),
	);
}
function play(data, anim, time = 0) {
	const skel = new Skeleton(data);
	skel.setToSetupPose();
	if (anim) {
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, anim, false);
		state.update(time);
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	return skel;
}
const at = (skel, bone) => {
	const b = skel.findBone(bone);
	return [b.worldX, b.worldY];
};
function finite(skel) {
	for (const b of skel.bones)
		if (![b.worldX, b.worldY, b.a, b.b, b.c, b.d].every(Number.isFinite)) return false;
	const off = new Vector2();
	const size = new Vector2();
	skel.getBounds(off, size, []);
	return [off.x, off.y, size.x, size.y].every(Number.isFinite);
}
const regionsOf = (t, skip = []) =>
	t.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
const hasOf = (skeleton) => (slot, part) => !!skeleton.skins[0].attachments[slot]?.[part];
const setupOf = (skeleton) => (slot) =>
	skeleton.slots.find((s) => s.name === slot)?.attachment ?? null;

// ---- the fits the guards use --------------------------------------------------------------------
/** NellyAnimTest's props (§8.1a), in the order its cut found them. */
const PROPS = [
	{ name: 'prop_chain', bone: 'chest', before: 'neck' },
	{ name: 'prop_glasses', bone: 'face', before: 'hair_front' },
	{ name: 'prop_wrist_l', bone: 'lower_arm_l', after: 'pinky_3_l' },
	{ name: 'prop_wrist_r', bone: 'lower_arm_r', after: 'pinky_3_r' },
	{ name: 'prop_ring_l', bone: 'hand_l', after: 'pinky_3_l' },
	{ name: 'prop_earring_l', bone: 'head', before: 'hair_front' },
];
const PROP_SIZE = {
	prop_chain: [150, 120],
	prop_glasses: [180, 60],
	prop_wrist_l: [70, 40],
	prop_wrist_r: [70, 40],
	prop_ring_l: [20, 20],
	prop_earring_l: [24, 40],
};
const ARM_R = 35;
const TORSO_HALF = 150;

/** The performer's fit, and for Half body its props and its bending torso and one-piece left arm. */
function fitsFor(M) {
	const out = {};
	for (const t of [M.HALF_BODY, M.FULL_BODY, M.BUST_FACE]) {
		const p = PERFORMERS[t.id];
		const J = perform(t, p);
		out[t.id] = { t, J, fit: fitFromJoints(t, J, p.aims) };
	}
	const h = out['half-body'];
	const plainWorld = M.boneWorld(M.fitTemplate(h.t, { bones: h.fit.bones }).bones);
	const w = (b) => plainWorld.get(b);
	// The torso image centred on the chest's image bone, from the hips to above the shoulders.
	const chest = w('torso_image');
	const torsoH =
		2 * Math.ceil(Math.max(chest[1] - w('hip')[1], w('upper_arm_l')[1] - chest[1]) + 40);
	const torsoW = 2 * TORSO_HALF + 40;
	const uv = (c, W, H, b) => [0.5 + (w(b)[0] - c[0]) / W, 0.5 - (w(b)[1] - c[1]) / H];
	// The left arm as one piece, centred on the shoulder, down past the wrist.
	const sh = w('upper_arm_l_image');
	const lu = len(sub(w('lower_arm_l'), sh));
	const ll = len(sub(w('hand_l'), w('lower_arm_l')));
	const armH = 2 * Math.ceil(lu + ll + ARM_R + 4);
	const armW = 2 * ARM_R + 8;
	const bends = {
		torso: {
			bones: ['hip', 'spine', 'torso_image'].map((b) => ({
				bone: b,
				at: uv(chest, torsoW, torsoH, b),
			})),
			ramp: [2 * TORSO_HALF, 2 * TORSO_HALF],
		},
		upper_arm_l: {
			bones: ['upper_arm_l_image', 'lower_arm_l_image'].map((b) => ({
				bone: b,
				at: uv(sh, armW, armH, b),
			})),
			ramp: [2 * ARM_R],
			covers: ['lower_arm_l'],
		},
	};
	h.full = { ...h.fit, props: PROPS, bends };
	h.sizes = { torso: [torsoW, torsoH], upper_arm_l: [armW, armH], ...PROP_SIZE };
	h.arm = { lu, ll, armW };
	return out;
}
const regionsWith = (t, sizes, skip = []) => [
	...regionsOf(t, skip).map((r) =>
		sizes[r.name] ? { ...r, w: sizes[r.name][0], h: sizes[r.name][1] } : r,
	),
	...Object.entries(sizes)
		.filter(([n]) => !t.parts.some((p) => p.name === n) && !skip.includes(n))
		.map(([name, [w, h]]) => ({ name, w, h })),
];

// ---- guards: each returns true when it holds, and prints why when it does not ------------------
const MAX_JOINT = 0.5;
const GUARDS = {
	/** A synthetic performer's joints → fit → engine-rig's `frame` pose within 0.5 rig units. */
	joints(M, report) {
		let good = true;
		for (const { t, J, fit } of Object.values(fitsFor(M))) {
			const made = M.templateRig(t, regionsOf(t), fit);
			const skel = play(loadRig(made.skeleton, regionsOf(t)), 'frame', 0);
			const errs = Object.entries(J).map(([n, j]) => [n, len(sub(at(skel, n), j))]);
			const worst = errs.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
			report?.(
				`${t.id}: ${errs.length} joints, worst ${worst[0]} ${worst[1].toFixed(4)} rig units`,
			);
			good =
				ok(
					`${t.id}: every joint within ${MAX_JOINT} rig units of the performer's (engine-rig)`,
					worst[1] <= MAX_JOINT,
					`${worst[0]} off by ${worst[1]}`,
				) && good;
			const setup = play(loadRig(made.skeleton, regionsOf(t)));
			const apart = Math.max(...Object.entries(J).map(([n, j]) => len(sub(at(setup, n), j))));
			good =
				ok(
					`${t.id}: the frame is the clip \`frame\`, not the setup`,
					apart > 10,
					`the setup is ${apart} from the frame`,
				) && good;
			const lens = Object.entries(fit.bones).every(([n, f]) => {
				const b = made.skeleton.bones.find((x) => x.name === n);
				return Math.abs((b.x ?? 0) - f.x) < 1e-9 && Math.abs((b.y ?? 0) - f.y) < 1e-9;
			});
			good = ok(`${t.id}: the fitted lengths are the rig's setup`, lens) && good;
		}
		return good;
	},

	/** Every control at min / rest / max and every starter clip pose finite on the fitted rigs. */
	finite(M, report) {
		let good = true;
		const fits = fitsFor(M);
		for (const [id, f] of Object.entries(fits)) {
			const fit = f.full ?? f.fit;
			const ft = M.fitTemplate(f.t, fit);
			const store = M.rigTemplateSaveProblem(ft);
			good =
				ok(
					`${id}: the store's pose check passes on the fitted template (every control at min, rest, max)`,
					store === null,
					store,
				) && good;
			const regions = f.sizes ? regionsWith(f.t, f.sizes) : regionsOf(f.t);
			const made = M.templateRig(f.t, regions, fit);
			const summary = M.rigTemplateFromSidecar(M.templateSidecar(made));
			const has = hasOf(made.skeleton);
			const order = made.skeleton.slots.map((s) => s.name);
			const anims = {};
			for (const ch of summary.channels.filter((c) => !c.shapes)) {
				const a = {};
				[ch.min, ch.rest, ch.max].forEach((v, i) =>
					PAGE.faceKeyChannel(a, ch, v, i * 0.5, has, summary.channels, order),
				);
				anims[`control ${ch.id}`] = a;
			}
			const added = PAGE.faceAddStarterClips(anims, summary, has, setupOf(made.skeleton));
			const data = loadRig(made.skeleton, regions, anims);
			const bad = [];
			let poses = 0;
			for (const name of Object.keys(anims)) {
				const clip = summary.clips.find((c) => c.name === name);
				const times = clip
					? [0, clip.length / 2, clip.length, ...clip.keys.map((k) => k[0])]
					: [0, 0.5, 1];
				for (const time of times) {
					poses++;
					if (!finite(play(data, name, time))) bad.push(`${name} @ ${time}`);
				}
			}
			report?.(
				`${id}: ${summary.channels.length} controls and ${added.added.length} starter clips, ${poses} poses, ${bad.length} not finite`,
			);
			good =
				ok(
					`${id}: every control and starter clip poses finite on the fitted rig (engine-rig)`,
					!bad.length && added.added.length === f.t.clips.length,
					bad.slice(0, 4).join('; '),
				) && good;
		}
		return good;
	},

	/** A limb's shortening brings the next joint to 0.3 of its fitted length. */
	shorten(M, report) {
		let good = true;
		for (const { t, fit } of [fitsFor(M)['half-body'], fitsFor(M)['full-body']]) {
			const made = M.templateRig(t, regionsOf(t), fit);
			const summary = M.rigTemplateFromSidecar(M.templateSidecar(made));
			const has = hasOf(made.skeleton);
			const order = made.skeleton.slots.map((s) => s.name);
			const data0 = loadRig(made.skeleton, regionsOf(t));
			let worst = 0;
			let n = 0;
			for (const ch of summary.channels.filter((c) => c.id.startsWith('fore_'))) {
				const next = ch.drives.find((d) => d.prop === 'x' || d.prop === 'y')?.bone;
				if (!next) continue;
				const a = {};
				PAGE.faceKeyChannel(a, ch, ch.max, 0, has, summary.channels, order);
				const skel = play(loadRig(made.skeleton, regionsOf(t), { a }), 'a', 0);
				const parent = t.bones.find((b) => b.name === next).parent;
				const fitted = len(sub(at(play(data0), next), at(play(data0), parent)));
				const posed = len(sub(at(skel, next), at(skel, parent)));
				const want = (1 - ch.max) * fitted;
				worst = Math.max(worst, Math.abs(posed - want));
				n++;
			}
			report?.(
				`${t.id}: ${n} shortenings, the next joint at most ${worst.toFixed(4)} off 0.3 of its fitted length`,
			);
			good =
				ok(
					`${t.id}: a shortened limb brings its next joint to 0.3 of its fitted length (engine-rig)`,
					n > 0 && worst < 0.01,
					`off by ${worst}`,
				) && good;
		}
		return good;
	},

	/** Every control bone on what it marks; image bones on their joints; the poles behind by the arm. */
	controls(M, report) {
		let good = true;
		for (const { t, fit } of [fitsFor(M)['half-body'], fitsFor(M)['full-body']]) {
			const made = M.templateRig(t, regionsOf(t), fit);
			const data = loadRig(made.skeleton, regionsOf(t));
			const setup = play(data);
			const frame = play(data, 'frame', 0);
			const marks = t.bones.filter((b) => M.controlTarget(b.name));
			const off = marks.map((b) => [
				b.name,
				len(sub(at(setup, b.name), at(setup, M.controlTarget(b.name)))),
			]);
			const worst = off.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
			report?.(
				`${t.id}: ${marks.length} control bones, worst ${worst[0]} ${worst[1].toFixed(4)} from what it marks`,
			);
			good =
				ok(
					`${t.id}: every control bone sits on what it marks (setup, engine-rig)`,
					marks.length >= 8 && worst[1] < 1e-3,
					`${worst[0]} ${worst[1]}`,
				) && good;
			const images = t.bones.filter((b) => b.name.endsWith('_image'));
			const drift = Math.max(
				...images.flatMap((b) =>
					[setup, frame].map((s) => len(sub(at(s, b.name), at(s, b.parent)))),
				),
			);
			good =
				ok(
					`${t.id}: image bones stay on their joints`,
					images.length > 0 && drift < 1e-6,
					String(drift),
				) && good;
			const summary = M.rigTemplateFromSidecar(M.templateSidecar(made));
			const poles = Object.keys(t.rig3d.depths).filter((b) => b.includes('_pole_'));
			const depthOk = poles.every((b) => {
				const ratio =
					(fit.bones[M.controlTarget(b)]?.y ?? 0) /
						(t.bones.find((x) => x.name === M.controlTarget(b)).y || 1) || 1;
				return Math.abs(summary.rig3d.depths[b] - t.rig3d.depths[b] * ratio) < 1e-9;
			});
			const moved = poles.some((b) => summary.rig3d.depths[b] !== t.rig3d.depths[b]);
			report?.(
				`${t.id}: poles ${poles.map((b) => `${b} ${summary.rig3d.depths[b].toFixed(1)}`).join(', ')} (template ${t.rig3d.depths[poles[0]]})`,
			);
			good =
				ok(
					`${t.id}: the poles sit behind by the fitted arm (and leg)`,
					poles.length > 0 && depthOk && moved,
				) && good;
			const bonesBack = summary.bones.every((b) => {
				const r = made.skeleton.bones.find((x) => x.name === b.name);
				return Math.abs((r.x ?? 0) - b.x) < 1e-9 && Math.abs((r.y ?? 0) - b.y) < 1e-9;
			});
			const fore = summary.channels
				.find((c) => c.id === 'fore_upper_arm_l')
				.drives.find((d) => d.prop === 'y');
			good =
				ok(
					`${t.id}: template.json keeps the fit, and the Controls read the fitted bones and drives back`,
					bonesBack && Math.abs(fore.per + fit.bones.lower_arm_l.y) < 1e-9,
					`per ${fore.per}`,
				) && good;
		}
		return good;
	},

	/** A template's own timeline clip (one saved from a rig) slides a fitted bone by its fitted length. */
	timelines(M, report) {
		const base = M.HALF_BODY;
		const half = base.bones.find((b) => b.name === 'lower_arm_l').y / 2;
		const t = {
			...base,
			clips: [
				...base.clips,
				{
					name: 'slide',
					length: 1,
					keys: [],
					animation: {
						bones: {
							lower_arm_l: {
								translate: [
									{
										time: 0,
										x: 0,
										y: 0,
										curve: [0.33, 0, 0.67, 0, 0.2, 0.1 * half, 0.4, 0.9 * half],
									},
									{ time: 1, x: 0, y: half },
								],
							},
						},
					},
				},
			],
		};
		const fit = fitsFor(M)['half-body'].fit;
		const slide = (f) => {
			const made = M.templateRig(t, regionsOf(t), f);
			const summary = f ? M.rigTemplateSummary(M.fitTemplate(t, f)) : M.rigTemplateSummary(t);
			const anims = {};
			PAGE.faceAddStarterClips(anims, summary, hasOf(made.skeleton), setupOf(made.skeleton));
			const data = loadRig(made.skeleton, regionsOf(t), anims);
			const setupY = made.skeleton.bones.find((b) => b.name === 'lower_arm_l').y;
			return [0.5, 1].map((time) => play(data, 'slide', time).findBone('lower_arm_l').y / setupY);
		};
		const plain = slide(undefined);
		const fitted = slide(fit);
		report?.(
			`half-body: the slide ends at ${fitted[1].toFixed(4)} × the fitted length (template ${plain[1].toFixed(4)}), its middle at ${fitted[0].toFixed(4)} (${plain[0].toFixed(4)})`,
		);
		return ok(
			"half-body: a template clip's translate keys and their curve follow the fit (engine-rig)",
			plain.every((v, i) => Math.abs(v - fitted[i]) < 1e-4) && Math.abs(fitted[1] - 1.5) < 1e-4,
			`${fitted} against ${plain}`,
		);
	},

	/** T12a's control layer binds to the fitted rigs as the template made it (props and all). */
	controlLayer(M, report) {
		let good = true;
		for (const [id, f] of Object.entries(fitsFor(M))) {
			const fit = f.full ?? f.fit;
			const made = M.templateRig(f.t, f.sizes ? regionsWith(f.t, f.sizes) : regionsOf(f.t), fit);
			const doc = { ...made.controls, controls: LIB.C.CONTROLS_VERSION, rig: id };
			const bad = [
				...LIB.C.controlsDocProblems(doc),
				...LIB.C.controlsIrigProblems(doc, made.skeleton),
			];
			const n = Object.keys(made.controls?.bones ?? {}).length;
			report?.(
				`${id}: ${n} controls, ${made.controls?.picker?.items?.length ?? 0} picker buttons, ${bad.length} problems on the fitted rig`,
			);
			good =
				ok(
					`${id}: T12a's controls.json binds to the fitted rig, every control, set and picker button on a bone it has`,
					n > 0 && !bad.length,
					bad.slice(0, 3).join('; '),
				) && good;
			// Rings are sized to the joint (a fit lengthens limbs, never thickens them) and picker places
			// are fractions of the board: the layer is the template's own.
			good =
				ok(
					`${id}: the fitted rig's control layer is the template's (rings, IK squares, poles, sets, picker)`,
					JSON.stringify(made.controls) === JSON.stringify(f.t.controls),
				) && good;
		}
		return good;
	},

	/** K4's 3D IK on a fitted arm: the pole at its fitted depth, the hand on the fitted wrist, reach. */
	ik3d(M, report) {
		let good = true;
		const h = fitsFor(M)['half-body'];
		const regions = regionsOf(h.t);
		const made = M.templateRig(h.t, regions, h.fit);
		const summary = M.rigTemplateFromSidecar(M.templateSidecar(made));
		const irig = structuredClone(made.skeleton);
		const doc = LIB.I.rig3dFromTemplate(h.t.id, irig, summary.rig3d);
		const depth = doc.bones?.elbow_pole_l?.depth;
		good =
			ok(
				"K4: the rig's first rig3d.json puts the elbow pole at the fitted depth",
				depth === summary.rig3d.depths.elbow_pole_l && depth !== h.t.rig3d.depths.elbow_pole_l,
				`${depth} (fitted ${summary.rig3d.depths.elbow_pole_l}, template ${h.t.rig3d.depths.elbow_pole_l})`,
			) && good;
		const made3d = LIB.K.ik3dFor(irig, doc, 'lower_arm_l', 'hand_ik_l', 'arm_l_ik3d');
		if (!ok('K4: a 3D IK can be made on the fitted arm', !('error' in made3d), made3d.error))
			return false;
		doc.ik = [{ ...made3d.ik, pole: 'elbow_pole_l' }];
		const MOVE = [-60, 80];
		const on = { arm_l_ik3d: [{ time: 0, mix: 1 }] };
		doc.clips = {
			rest: { bones: {}, ik: on, duration: 0.5 },
			// The hand control follows its chest space (T12b), so its space bone carries it: the bone the
			// page's gizmo and every switch key.
			reach: {
				bones: { hand_ik_l_chest: { translate: [{ time: 0, x: MOVE[0], y: MOVE[1] }] } },
				ik: on,
				duration: 0.5,
			},
		};
		const fk = play(loadRig(made.skeleton, regions));
		const lu = len(sub(at(fk, 'lower_arm_l'), at(fk, 'upper_arm_l')));
		const rows = {};
		for (const name of ['rest', 'reach']) {
			const base = { ...irig, animations: { ...irig.animations, [name]: {} } };
			const baked = LIB.I.rebakeClip3d({ irig: base, doc, clip: name });
			const rig = LIB.S.rigOf(baked.irig, baked.doc);
			const w = LIB.B.pose3d(rig, LIB.S.clipOf(rig, baked.irig, baked.doc, name).clip, 0);
			const o = (b) => w.get(b).o;
			const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
			const game = play(loadRig(baked.irig, regions), name, 0);
			rows[name] = {
				// Where its chest space puts the control: on the space bone (pose3d leaves the control's own
				// 3D place where its keys put it; the solve reads the space).
				onTarget: d3(o('hand_l'), o('hand_ik_l_chest')),
				fromWrist: len(sub(o('hand_l'), at(fk, 'hand_l'))),
				upper: Math.abs(d3(o('lower_arm_l'), o('upper_arm_l')) - lu),
				game: len(sub(at(game, 'hand_l'), at(game, 'hand_ik_l'))),
			};
		}
		const f = (v) => v.toExponential(1);
		report?.(
			`rest: hand ${f(rows.rest.fromWrist)} from the fitted wrist; reach: hand on the control ${f(rows.reach.onTarget)} (3D), ${rows.reach.game.toFixed(3)} (game), upper arm off its fitted ${lu.toFixed(1)} by ${f(rows.reach.upper)}`,
		);
		good =
			ok(
				'K4: with the IK on and the control at rest, the hand stays on the fitted wrist',
				rows.rest.fromWrist < 1e-3 && rows.rest.onTarget < 1e-3,
				JSON.stringify(rows.rest),
			) && good;
		good =
			ok(
				"K4: a moved control is reached with the fitted arm's lengths, and the game plays it",
				rows.reach.onTarget < 1e-6 && rows.reach.upper < 1e-6 && rows.reach.game < 0.5,
				JSON.stringify(rows.reach),
			) && good;
		return good;
	},

	/** No fit, or a fit of nothing, makes the rig exactly as before. */
	unfitted(M) {
		let good = true;
		for (const t of [M.HALF_BODY, M.FULL_BODY, M.BUST_FACE]) {
			const plain = M.templateRig(t, regionsOf(t));
			const empty = M.templateRig(t, regionsOf(t), { bones: {} });
			good =
				ok(
					`${t.id}: no fit writes no animation and keeps no fit`,
					!Object.keys(plain.skeleton.animations).length &&
						plain.fit === null &&
						M.templateSidecar(plain) === JSON.stringify({ id: t.id, version: t.version }),
				) && good;
			good =
				ok(
					`${t.id}: a fit of nothing makes the same rig`,
					JSON.stringify(empty.skeleton) === JSON.stringify(plain.skeleton) &&
						JSON.stringify(M.fitTemplate(t, { bones: {} })) === JSON.stringify(t),
				) && good;
			good =
				ok(
					`${t.id}: a rig with no fit reads back the template itself`,
					JSON.stringify(M.rigTemplateFromSidecar(M.templateSidecar(plain))) ===
						JSON.stringify(M.rigTemplateSummary(t)),
				) && good;
		}
		return good;
	},

	/** NellyAnimTest's six props on slots of their own, where asked, centred, moving in depth with their limb. */
	props(M, report) {
		let good = true;
		const h = fitsFor(M)['half-body'];
		const regions = regionsWith(h.t, h.sizes);
		const made = M.templateRig(h.t, regions, { ...h.fit, props: PROPS });
		const data = loadRig(made.skeleton, regions);
		const skel = play(data, 'frame', 0);
		const order = skel.drawOrder.map((s) => s.data.name);
		const i = (n) => order.indexOf(n);
		const placed =
			i('prop_chain') === i('neck') - 1 &&
			i('prop_chain') > i('torso') &&
			i('prop_earring_l') === i('hair_front') - 1 &&
			i('prop_glasses') === i('hair_front') - 2 &&
			i('prop_ring_l') === i('pinky_3_l') + 1 &&
			i('prop_wrist_l') === i('pinky_3_l') + 2 &&
			i('prop_wrist_r') === i('pinky_3_r') + 1;
		report?.(
			`half-body: ${made.skeleton.slots.length} slots (${h.t.slots.length} + ${PROPS.length} props)`,
		);
		good =
			ok(
				'half-body: each prop is drawn where it asked: the chain before the neck, the glasses and earring before the front hair, the watches and the ring after their arm (engine-rig)',
				placed && made.skeleton.slots.length === h.t.slots.length + PROPS.length,
				order
					.filter(
						(n) =>
							n.startsWith('prop_') || ['neck', 'hair_front', 'pinky_3_l', 'pinky_3_r'].includes(n),
					)
					.join(' '),
			) && good;
		const centred = PROPS.every((p) => {
			const slot = skel.findSlot(p.name);
			const v = new Float32Array(8);
			slot.getAttachment().computeWorldVertices(slot, v, 0, 2);
			const c = [(v[0] + v[4]) / 2, (v[1] + v[5]) / 2];
			return slot.bone.data.name === p.bone && len(sub(c, at(skel, p.bone))) < 1e-3;
		});
		good =
			ok('half-body: each prop rides its bone, its image centred on it (engine-rig)', centred) &&
			good;
		const summary = M.rigTemplateFromSidecar(M.templateSidecar(made));
		const depth = summary.channels.find((c) => c.id === 'depth_l');
		const a = {};
		PAGE.faceKeyChannel(
			a,
			depth,
			2,
			0,
			hasOf(made.skeleton),
			summary.channels,
			made.skeleton.slots.map((s) => s.name),
		);
		const behind = play(loadRig(made.skeleton, regions, { a }), 'a', 0.01).drawOrder.map(
			(s) => s.data.name,
		);
		const j = (n) => behind.indexOf(n);
		good =
			ok(
				'half-body: the left arm behind the body takes its watch and ring with it (engine-rig)',
				j('prop_wrist_l') < j('torso') &&
					j('prop_ring_l') < j('torso') &&
					j('prop_wrist_r') > j('torso'),
				behind.filter((n) => /prop_|torso|lower_arm_l/.test(n)).join(' '),
			) && good;
		const layers = summary.rig3d.layers;
		good =
			ok(
				'half-body: the 3D layers move the ring and the watch with the hand, the glasses and earring with the head',
				['prop_ring_l', 'prop_wrist_l'].every((n) => layers.hand_l.includes(n)) &&
					['prop_glasses', 'prop_earring_l'].every((n) => layers.head.includes(n)) &&
					!Object.values(layers).flat().includes('prop_chain'),
			) && good;
		const bare = M.templateRig(h.t, regionsWith(h.t, h.sizes, ['prop_ring_l']), {
			...h.fit,
			props: PROPS,
		});
		good =
			ok(
				'half-body: a prop without art is listed missing, never needed, and its slot starts empty',
				bare.missing.includes('prop_ring_l') &&
					!bare.missingRequired.includes('prop_ring_l') &&
					!bare.skeleton.slots.find((s) => s.name === 'prop_ring_l').attachment,
			) && good;
		return good;
	},

	/** Every bad fit is refused, with its reason. */
	refused(M, report) {
		const t = M.HALF_BODY;
		const base = fitsFor(M)['half-body'].fit;
		const BAD = [
			['an unknown bone', { bones: { tail: { x: 0, y: 10 } } }, /tail/],
			['a turned bone', { bones: { lower_arm_l: { x: 30, y: -190 } } }, /direction/],
			['a reversed bone', { bones: { lower_arm_l: { x: 0, y: 190 } } }, /direction/],
			['a bone with no length', { bones: { upper_arm_l_image: { x: 0, y: 5 } } }, /no length/],
			['a length of 0', { bones: { lower_arm_l: { x: 0, y: 0 } } }, /no length/],
			['a control bone', { bones: { elbow_pole_l: { x: 0, y: -10 } } }, /control/],
			['a non-finite length', { bones: { lower_arm_l: { x: 0, y: Number.NaN } } }, /number/],
			[
				'a length that overflows',
				{ bones: { lower_arm_l: { x: 1.5e308, y: -1.6e308 } } },
				/longer/,
			],
			['a length past the most', { bones: { lower_arm_l: { x: 0, y: -200_000 } } }, /longer/],
			['an infinite turn', { bones: {}, frame: { spine: { rotate: Infinity } } }, /number/],
			[
				'a frame move past the most',
				{ bones: {}, frame: { spine: { rotate: 0, x: 1e300 } } },
				/past/,
			],
			['a frame on an unknown bone', { bones: {}, frame: { tail: { rotate: 3 } } }, /tail/],
			[
				'a scale of 0',
				{ bones: {}, frame: { upper_arm_l_image: { rotate: 0, scaleY: 0 } } },
				/above 0/,
			],
			[
				'a prop on an unknown bone',
				{ bones: {}, props: [{ name: 'prop_hat', bone: 'hat', after: 'head' }] },
				/hat/,
			],
			[
				'a prop next to an unknown slot',
				{ bones: {}, props: [{ name: 'prop_hat', bone: 'head', after: 'hat' }] },
				/hat/,
			],
			[
				'a prop named like a slot',
				{ bones: {}, props: [{ name: 'neck', bone: 'chest', after: 'torso' }] },
				/already/,
			],
			[
				'a prop drawn both before and after',
				{ bones: {}, props: [{ name: 'prop_x', bone: 'head', before: 'head', after: 'head' }] },
				/either/,
			],
			['an unknown field', { bones: {}, pose: {} }, /pose/],
			[
				'a bend of an unknown part',
				{
					bones: {},
					bends: {
						tail: {
							bones: [
								{ bone: 'spine', at: [0.5, 0.9] },
								{ bone: 'chest', at: [0.5, 0.5] },
							],
							ramp: [10],
						},
					},
				},
				/tail/,
			],
			[
				'a bend whose ramp misses a joint',
				{
					bones: {},
					bends: {
						torso: {
							bones: [
								{ bone: 'spine', at: [0.5, 0.9] },
								{ bone: 'chest', at: [0.5, 0.5] },
							],
							ramp: [],
						},
					},
				},
				/ramp/,
			],
			[
				'a bend off its image',
				{
					bones: {},
					bends: {
						torso: {
							bones: [
								{ bone: 'spine', at: [0.5, 1.5] },
								{ bone: 'chest', at: [0.5, 0.5] },
							],
							ramp: [10],
						},
					},
				},
				/off the image/,
			],
			[
				'a bend covering an unknown part',
				{
					bones: {},
					bends: {
						torso: {
							bones: [
								{ bone: 'spine', at: [0.5, 0.9] },
								{ bone: 'chest', at: [0.5, 0.5] },
							],
							ramp: [10],
							covers: ['tail'],
						},
					},
				},
				/tail/,
			],
		];
		let good = true;
		for (const [what, raw, why] of BAD) {
			const parsed = M.parseRigFit(raw);
			const reason = 'problem' in parsed ? parsed.problem : M.templateFitProblem(t, parsed.fit);
			let threw = '';
			if (!('problem' in parsed))
				try {
					M.templateRig(t, regionsOf(t), parsed.fit);
				} catch (e) {
					threw = String(e.message);
				}
			const refusedEverywhere = 'problem' in parsed || threw.length > 0;
			good =
				ok(
					`refused: ${what} — "${reason}"`,
					typeof reason === 'string' && why.test(reason) && refusedEverywhere,
					`reason ${reason}, templateRig ${threw || 'made a rig'}`,
				) && good;
		}
		const fine = M.parseRigFit(JSON.parse(JSON.stringify(base)));
		good =
			ok(
				"the performer's fit reads and fits",
				'fit' in fine && M.templateFitProblem(t, fine.fit) === null,
			) && good;
		report?.(`${BAD.length} bad fits refused with their reason`);
		return good;
	},
};

// ---- F4: bending parts ---------------------------------------------------------------------------
/** The posed world triangles of an attachment, with the image point each corner shows (image units, centred). */
function trianglesOf(slot, W, H) {
	const att = slot.getAttachment();
	if (att.regionUVs) {
		const n = att.worldVerticesLength;
		const v = new Float32Array(n);
		att.computeWorldVertices(slot, 0, n, v, 0, 2);
		const uv = att.regionUVs;
		const img = (k) => [uv[2 * k] * W - W / 2, H / 2 - uv[2 * k + 1] * H];
		const out = [];
		for (let i = 0; i < att.triangles.length; i += 3) {
			const ks = [att.triangles[i], att.triangles[i + 1], att.triangles[i + 2]];
			out.push({ p: ks.map((k) => [v[2 * k], v[2 * k + 1]]), q: ks.map(img) });
		}
		return out;
	}
	const v = new Float32Array(8);
	att.computeWorldVertices(slot, v, 0, 2);
	const c = [
		[-W / 2, -H / 2],
		[-W / 2, H / 2],
		[W / 2, H / 2],
		[W / 2, -H / 2],
	];
	const p = [0, 1, 2, 3].map((k) => [v[2 * k], v[2 * k + 1]]);
	return [
		{ p: [p[0], p[1], p[2]], q: [c[0], c[1], c[2]] },
		{ p: [p[0], p[2], p[3]], q: [c[0], c[2], c[3]] },
	];
}
const segDist = (p, a, b) => {
	const d = sub(b, a);
	const L2 = d[0] ** 2 + d[1] ** 2;
	const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2));
	return len(sub(p, [a[0] + s * d[0], a[1] + s * d[1]]));
};
/** Coverage of the triangles on a 1-unit grid, each pixel shown when its image point is inside `ink`. */
function raster(parts, box) {
	const [x0, y0, x1, y1] = box;
	const w = Math.ceil(x1 - x0);
	const h = Math.ceil(y1 - y0);
	const cov = new Uint8Array(w * h);
	for (const { tris, ink } of parts)
		for (const { p, q } of tris) {
			const [a, b, c] = p;
			const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
			if (Math.abs(den) < 1e-12) continue;
			const xs = p.map((v) => v[0] - x0);
			const ys = p.map((v) => v[1] - y0);
			for (
				let j = Math.max(0, Math.floor(Math.min(...ys)));
				j <= Math.min(h - 1, Math.ceil(Math.max(...ys)));
				j++
			)
				for (
					let i = Math.max(0, Math.floor(Math.min(...xs)));
					i <= Math.min(w - 1, Math.ceil(Math.max(...xs)));
					i++
				) {
					const X = x0 + i + 0.5;
					const Y = y0 + j + 0.5;
					const l0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den;
					const l1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den;
					const l2 = 1 - l0 - l1;
					if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
					const u = l0 * q[0][0] + l1 * q[1][0] + l2 * q[2][0];
					const v = l0 * q[0][1] + l1 * q[1][1] + l2 * q[2][1];
					if (ink(u, v)) cov[j * w + i] = 1;
				}
		}
	return { cov, w, h };
}
const PNG_DIR = process.argv.includes('--png')
	? process.argv[process.argv.indexOf('--png') + 1]
	: null;
/** An RGB picture of a coverage: what is drawn white, its cracks red, on grey. */
function writePng(name, { cov, w, h }, crack) {
	const crc = (buf) => {
		let c = ~0;
		for (const b of buf) {
			c ^= b;
			for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
		}
		return ~c >>> 0;
	};
	const chunk = (type, data) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(data.length, 0);
		head.write(type, 4, 'latin1');
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
		return Buffer.concat([head, data, tail]);
	};
	const raw = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = (h - 1 - y) * w + x;
			const rgb = crack[k] ? [230, 40, 40] : cov[k] ? [240, 240, 240] : [60, 60, 70];
			rgb.forEach((v, c) => (raw[y * (w * 3 + 1) + 1 + x * 3 + c] = v));
		}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	mkdirSync(PNG_DIR, { recursive: true });
	writeFileSync(
		join(PNG_DIR, `${name}.png`),
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk('IHDR', ihdr),
			chunk('IDAT', deflateSync(raw)),
			chunk('IEND', Buffer.alloc(0)),
		]),
	);
}
const DISC = [];
for (let dy = -4; dy <= 4; dy++)
	for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 20) DISC.push([dx, dy]);
/**
 * The proof's crack measure (§8.3), kept to the bent limb: pixels inside it (`ideal`) that a 9 px
 * closing fills and nothing covers — a bent limb's own inner corner is not a crack. `gap`: every
 * pixel of the bent limb nothing covers (a rigid part cut at the joint leaves its outer corner).
 */
function cracks({ cov, w, h }, ideal) {
	const morph = (src, grow) => {
		const out = new Uint8Array(w * h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				let v = grow ? 0 : 1;
				for (const [dx, dy] of DISC) {
					const X = x + dx;
					const Y = y + dy;
					const s = X < 0 || Y < 0 || X >= w || Y >= h ? 0 : src[Y * w + X];
					if (grow ? s : !s) {
						v = grow ? 1 : 0;
						break;
					}
				}
				out[y * w + x] = v;
			}
		return out;
	};
	const closed = morph(morph(cov, true), false);
	const crack = closed.map((c, k) => (c && !cov[k] && ideal[k] ? 1 : 0));
	const gap = ideal.map((c, k) => (c && !cov[k] ? 1 : 0));
	const sum = (a) => a.reduce((s, x) => s + x, 0);
	return { n: sum(crack), gap: sum(gap), crack: gap };
}
/** The bent limb as it should be drawn: two capsules over its posed joints (1 px in from the edge). */
function idealOf(box, w, h, joints, r) {
	const out = new Uint8Array(w * h);
	for (let j = 0; j < h; j++)
		for (let i = 0; i < w; i++) {
			const p = [box[0] + i + 0.5, box[1] + j + 0.5];
			for (let k = 0; k + 1 < joints.length; k++)
				if (segDist(p, joints[k], joints[k + 1]) <= r - 1) out[j * w + i] = 1;
		}
	return out;
}
const area = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);

/** The mesh of `part` reweighted by the Rigger's proximity skinner (`autoWeightMeshToChainNow`). */
function proximityMesh(skeleton, part, chain, world) {
	const out = JSON.parse(JSON.stringify(skeleton));
	const slot = out.slots.find((s) => s.attachment === part).name;
	const mesh = out.skins[0].attachments[slot][part];
	const index = new Map(out.bones.map((b, i) => [b.name, i]));
	const names = out.bones.map((b) => b.name);
	const nv = [];
	for (let i = 0, k = 0; k < mesh.uvs.length / 2; k++) {
		const n = mesh.vertices[i++];
		let p = [0, 0];
		for (let j = 0; j < n; j++) {
			const [b, x, y, wt] = mesh.vertices.slice(i, i + 4);
			i += 4;
			const o = world.get(names[b]);
			p = [p[0] + wt * (o[0] + x), p[1] + wt * (o[1] + y)];
		}
		let cand = chain.map(({ bone, seg }) => {
			const d = PAGE.distToSegment(p[0], p[1], {
				x0: seg[0][0],
				y0: seg[0][1],
				x1: seg[1][0],
				y1: seg[1][1],
			});
			return { bone, wgt: 1 / (d * d + 1e-3) };
		});
		cand.sort((a, b) => b.wgt - a.wgt);
		cand = cand.slice(0, 4);
		const sum = cand.reduce((s, c) => s + c.wgt, 0);
		nv.push(cand.length);
		for (const c of cand) {
			const o = world.get(c.bone);
			nv.push(index.get(c.bone), p[0] - o[0], p[1] - o[1], c.wgt / sum);
		}
	}
	mesh.vertices = nv;
	return out;
}

/** The torso and the left arm bend: a lean + twist and a bent elbow, ramp against proximity and rigid parts. */
function bends(M, report) {
	let good = true;
	const h = fitsFor(M)['half-body'];
	const { lu, ll, armW } = h.arm;
	const fit = { ...h.fit, bends: h.full.bends };
	const regions = regionsWith(h.t, h.sizes, ['lower_arm_l']);
	const made = M.templateRig(h.t, regions, fit);
	const ft = M.fitTemplate(h.t, fit);
	const world = M.boneWorld(ft.bones);
	good =
		ok(
			'F4: the one-piece arm stands in for the forearm: missing, not needed',
			made.missing.includes('lower_arm_l') && !made.missingRequired.includes('lower_arm_l'),
		) && good;
	const alone = M.templateRig(h.t, regionsWith(h.t, h.sizes, ['lower_arm_l', 'upper_arm_l']), fit);
	good =
		ok(
			'F4: with no one-piece arm the forearm is needed again',
			alone.missingRequired.includes('lower_arm_l'),
		) && good;
	const meshes = ['torso', 'upper_arm_l'].map((p) => made.skeleton.skins[0].attachments[p][p]);
	good =
		ok(
			'F4: the torso and the one-piece arm are weighted meshes, every vertex on at most 3 bones',
			meshes.every((m) => m.type === 'mesh' && m.vertices.length > m.uvs.length),
		) && good;

	const seg = (a, b) => [world.get(a), world.get(b)];
	const prox = proximityMesh(
		proximityMesh(
			made.skeleton,
			'upper_arm_l',
			[
				{ bone: 'upper_arm_l_image', seg: seg('upper_arm_l', 'lower_arm_l') },
				{ bone: 'lower_arm_l_image', seg: seg('lower_arm_l', 'hand_l') },
			],
			world,
		),
		'torso',
		[
			{ bone: 'hip', seg: seg('hip', 'spine') },
			{ bone: 'spine', seg: seg('spine', 'chest') },
			{ bone: 'torso_image', seg: seg('chest', 'neck') },
		],
		world,
	);
	// Rigid parts cut at the joint (a frame's visible cut): the torso image, the upper arm and forearm.
	const rigidRegions = regionsWith(h.t, {
		...h.sizes,
		upper_arm_l: [armW, 2 * Math.ceil(lu + 4)],
		lower_arm_l: [armW, 2 * Math.ceil(ll + ARM_R + 4)],
	});
	const rigid = M.templateRig(h.t, rigidRegions, h.fit);

	const summary = M.rigTemplateFromSidecar(M.templateSidecar(made));
	const key = (sk, values) => {
		const a = {};
		const has = hasOf(sk);
		for (const [id, v] of Object.entries(values))
			PAGE.faceKeyChannel(
				a,
				summary.channels.find((c) => c.id === id),
				v,
				0,
				has,
				summary.channels,
				sk.slots.map((s) => s.name),
			);
		return a;
	};
	const ink = {
		armOne: (u, v) => segDist([u, v], [0, 0], [0, -(lu + ll)]) <= ARM_R,
		upper: (u, v) => v >= -lu && segDist([u, v], [0, 0], [0, -lu]) <= ARM_R,
		lower: (u, v) => v <= 0 && segDist([u, v], [0, 0], [0, -ll]) <= ARM_R,
	};
	/** One pose of the three rigs: the arm's cracks, gap and folds, its ends, the torso's top and hem. */
	function measure(label, values) {
		const rows = {};
		for (const [name, sk, regs] of [
			['ramp', made.skeleton, regions],
			['proximity', prox, regions],
			['rigid', rigid.skeleton, rigidRegions],
		]) {
			const a = key(sk, values);
			const data = loadRig(sk, regs, { a });
			const setup = play(data);
			const posed = play(data, 'a', 0);
			const sizeOf = (r) => regs.find((x) => x.name === r);
			const parts = [];
			let flips = 0;
			let nonFinite = 0;
			const slots =
				name === 'rigid'
					? [
							['upper_arm_l', ink.upper],
							['lower_arm_l', ink.lower],
						]
					: [['upper_arm_l', ink.armOne]];
			for (const [s, inkOf] of slots) {
				const slot = posed.findSlot(s);
				const r = sizeOf(slot.getAttachment().name);
				const tris = trianglesOf(slot, r.w, r.h);
				const rest = trianglesOf(setup.findSlot(s), r.w, r.h);
				tris.forEach((tri, i) => {
					if (!tri.p.flat().every(Number.isFinite)) nonFinite++;
					else if (Math.sign(area(tri.p)) !== Math.sign(area(rest[i].p))) flips++;
				});
				parts.push({ tris, ink: inkOf });
			}
			const pts = parts.flatMap((p) => p.tris.flatMap((t) => t.p));
			const box = [
				Math.min(...pts.map((p) => p[0])) - 12,
				Math.min(...pts.map((p) => p[1])) - 12,
				Math.max(...pts.map((p) => p[0])) + 12,
				Math.max(...pts.map((p) => p[1])) + 12,
			];
			const picture = raster(parts, box);
			const ideal = idealOf(
				box,
				picture.w,
				picture.h,
				['upper_arm_l', 'lower_arm_l', 'hand_l'].map((b) => at(posed, b)),
				ARM_R,
			);
			const { n: arm, gap } = cracks(picture, ideal);
			// The torso: where the arms hang from it (its top, which should ride the chest) and its hem
			// (which should stay on the hips): how far each drifts from that bone, rigidly carried.
			const tSlot = posed.findSlot('torso');
			const tr = sizeOf(tSlot.getAttachment().name);
			const tTris = trianglesOf(tSlot, tr.w, tr.h);
			const tRest = trianglesOf(setup.findSlot('torso'), tr.w, tr.h);
			if (PNG_DIR) {
				// The picture shows the torso too, its ink the body between the hips and the shoulders.
				const c = world.get('chest')[1];
				const body = (u, v) =>
					Math.abs(u) <= TORSO_HALF &&
					v >= world.get('hip')[1] - c - 30 &&
					v <= world.get('upper_arm_l')[1] - c + 30;
				const all = [{ tris: tTris, ink: body }, ...parts];
				const ps = all.flatMap((q) => q.tris.flatMap((t) => t.p));
				const b2 = [
					Math.min(...ps.map((q) => q[0])) - 12,
					Math.min(...ps.map((q) => q[1])) - 12,
					Math.max(...ps.map((q) => q[0])) + 12,
					Math.max(...ps.map((q) => q[1])) + 12,
				];
				const pic = raster(all, b2);
				const joints = ['upper_arm_l', 'lower_arm_l', 'hand_l'].map((bn) => at(posed, bn));
				const shown = cracks(pic, idealOf(b2, pic.w, pic.h, joints, ARM_R));
				writePng(`${label.replace(/\W+/g, '-')}-${name}`, pic, shown.crack);
			}
			const carry = (bone, p) => {
				const b0 = setup.findBone(bone);
				const b1 = posed.findBone(bone);
				const local = b0.worldToLocal(new Vector2(p[0], p[1]));
				const out = b1.localToWorld(local);
				return [out.x, out.y];
			};
			const chestY = world.get('chest')[1];
			let top = 0;
			let hem = 0;
			tTris.forEach((tri, i) =>
				tri.q.forEach((q, k) => {
					const p0 = tRest[i].p[k];
					if (q[1] >= world.get('upper_arm_l')[1] - chestY - 1)
						top = Math.max(top, len(sub(tri.p[k], carry('chest', p0))));
					if (q[1] <= world.get('hip')[1] - chestY)
						hem = Math.max(hem, len(sub(tri.p[k], carry('hip', p0))));
					if (!tri.p[k].every(Number.isFinite)) nonFinite++;
				}),
			);
			tTris.forEach((tri, i) => {
				if (Math.sign(area(tri.p)) !== Math.sign(area(tRest[i].p))) flips++;
			});
			// The arm's ends, away from the elbow, should ride their bone exactly.
			let ends = 0;
			if (name !== 'rigid') {
				const slot = posed.findSlot('upper_arm_l');
				const r = sizeOf('upper_arm_l');
				const tris = trianglesOf(slot, r.w, r.h);
				const rest = trianglesOf(setup.findSlot('upper_arm_l'), r.w, r.h);
				tris.forEach((tri, i) =>
					tri.q.forEach((q, k) => {
						const y = q[1];
						if (y > ARM_R + 4 || y < -(lu + ll + ARM_R + 4)) return;
						const bone =
							y > -lu + ARM_R ? 'upper_arm_l_image' : y < -lu - ARM_R ? 'lower_arm_l_image' : null;
						if (bone) ends = Math.max(ends, len(sub(tri.p[k], carry(bone, rest[i].p[k]))));
					}),
				);
			}
			rows[name] = { cracks: arm, gap, flips, nonFinite, top, hem, ends };
		}
		const fmt = (r) =>
			`cracks ${r.cracks} px, gap ${r.gap} px, folds ${r.flips}, arm ends ${r.ends.toFixed(2)}, torso top ${r.top.toFixed(2)}, hem ${r.hem.toFixed(2)}`;
		report?.(
			`${label}:\n          ramp       ${fmt(rows.ramp)}\n          proximity  ${fmt(rows.proximity)}\n          rigid      ${fmt(rows.rigid)}`,
		);
		return { ...rows, fmt };
	}

	const lean = measure('lean 20° + twist 12° + breath', { lean: 20, twist: 12, breath: 1 });
	good =
		ok(
			'F4 lean: the ramp mesh poses finite, with no crack and no folded triangle (engine-rig)',
			lean.ramp.nonFinite === 0 && lean.ramp.cracks === 0 && lean.ramp.flips === 0,
			lean.fmt(lean.ramp),
		) && good;
	good =
		ok(
			"F4 lean: the torso's top stays where the arms hang and its hem on the hips, closer than the proximity skinner's",
			lean.ramp.top < lean.proximity.top &&
				lean.ramp.hem < lean.proximity.hem &&
				lean.ramp.hem < lean.rigid.hem,
			`ramp ${lean.ramp.top} / ${lean.ramp.hem}, proximity ${lean.proximity.top} / ${lean.proximity.hem}, rigid hem ${lean.rigid.hem}`,
		) && good;
	// The proof's bent pose turns each arm joint 25–35°; then on, the sweep shows where the blend of
	// two turns pinches the inside of the elbow (a fold from past 75°).
	for (const angle of [35, 60, 75, 90, 120]) {
		const e = measure(`elbow bent ${angle}°`, { arm_l: 0.4, elbow_l: angle / 140 });
		const r = e.ramp;
		if (angle === 35) {
			good =
				ok(
					'F4 elbow 35°: the one-piece arm poses finite, with no crack and no folded triangle (engine-rig)',
					r.nonFinite === 0 && r.cracks === 0 && r.flips === 0,
					e.fmt(r),
				) && good;
			good =
				ok(
					'F4 elbow 35°: rigid parts cut at the joint crack there',
					e.rigid.cracks > 0,
					e.fmt(e.rigid),
				) && good;
			good =
				ok(
					'F4 elbow 35°: away from the elbow the arm rides its bones exactly; the proximity skinner drags it',
					r.ends < 0.01 && e.proximity.ends > 1,
					`ramp ${r.ends}, proximity ${e.proximity.ends}`,
				) && good;
		}
		if (angle <= 75)
			good =
				ok(
					`F4 elbow ${angle}°: no folded triangle`,
					r.flips === 0 && r.nonFinite === 0,
					e.fmt(r),
				) && good;
		if (angle <= 90)
			good =
				ok(
					`F4 elbow ${angle}°: the one-piece arm loses less of the bent arm than rigid parts cut at the joint`,
					r.gap < e.rigid.gap,
					`ramp ${r.gap}, rigid ${e.rigid.gap}`,
				) && good;
	}
	return good;
}
GUARDS.bends = bends;

// ---- run ---------------------------------------------------------------------------------------
const M = await load();
const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
for (const [id, guard] of Object.entries(GUARDS)) {
	if (ONLY && id !== ONLY) continue;
	console.log(`\n=== ${id}`);
	guard(M, (line) => console.log(`    ${line}`));
}

if (ONLY) {
	console.log(
		`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks (${ONLY} only)`,
	);
	process.exit(fails === 0 ? 0 : 1);
}
console.log('\n=== mutants of the shipped code: each must turn its check red');
const FIT = 'rigTemplateFit.ts';
const TPL = 'rigTemplates.ts';
const MUTANTS = [
	[
		'joints',
		'the fitted lengths dropped',
		[FIT, 'return f ? { ...b, x: f.x, y: f.y } : b;', 'return b;'],
	],
	['joints', 'no frame clip', [TPL, '? { frame: frameAnimation(fit.frame) } : {},', '? {} : {},']],
	[
		'joints',
		'the frame keyed off by a degree',
		[
			FIT,
			'{ rotate: [{ time: 0, value: p.rotate }] }',
			'{ rotate: [{ time: 0, value: p.rotate + 1 }] }',
		],
	],
	[
		'shorten',
		'a shortening still moves by the template length',
		[FIT, '? { ...d, per: d.per * ratio.get(d.bone)! }', '? d'],
	],
	[
		'controls',
		'the control bones left at template places',
		[FIT, 'if (target && before.has(target)) {', 'if (false) {'],
	],
	['controls', 'the pole depths not fitted', [FIT, '[b, z * depthRatio(ratio, b)]', '[b, z]']],
	[
		'controls',
		'template.json without its fit',
		[TPL, 'made.fit ? { ...made.ref, fit: made.fit } : made.ref', 'made.ref'],
	],
	[
		'controls',
		'the Controls read the unfitted template',
		[
			TPL,
			'return t ? rigTemplateSummary(sidecarTemplate(t, text)) : null;',
			'return t ? rigTemplateSummary(t) : null;',
		],
	],
	[
		'controlLayer',
		"the fit loses T12a's control layer",
		[FIT, '		...(rig3d ? { rig3d } : {}),', '		...(rig3d ? { rig3d } : {}),\n		controls: undefined,'],
	],
	[
		'ik3d',
		'the control bones left at template places',
		[FIT, 'if (target && before.has(target)) {', 'if (false) {'],
	],
	['ik3d', 'the pole depths not fitted', [FIT, '[b, z * depthRatio(ratio, b)]', '[b, z]']],
	[
		'unfitted',
		'an empty frame clip on every rig',
		[
			TPL,
			'? { frame: frameAnimation(fit.frame) } : {},',
			'? { frame: frameAnimation(fit.frame) } : { frame: { bones: {} } },',
		],
	],
	[
		'timelines',
		'translate keys left at the template length',
		[
			FIT,
			'for (const f of fields) if (finite(out[f])) out[f] = (out[f] as number) * s;',
			'for (const f of fields) if (finite(out[f])) out[f] = out[f] as number;',
		],
	],
	[
		'timelines',
		'the bezier left at the template length',
		[FIT, '(i % 2 === 1 && finite(v) ? v * s : v)', '(i % 2 === 1 && finite(v) ? v : v)'],
	],
	[
		'finite',
		'a fitted move scaled without bound',
		[FIT, '? { ...d, per: d.per * ratio.get(d.bone)! }', '? { ...d, per: d.per * Infinity }'],
	],
	[
		'props',
		'a prop drawn on the wrong side of its neighbour',
		[FIT, 'const isAfter = prop.after !== undefined;', 'const isAfter = prop.after === undefined;'],
	],
	[
		'props',
		'a depth control leaves the props behind',
		[FIT, 'c.order?.slots.includes(at)', 'false'],
	],
	[
		'props',
		'the 3D layers leave the props out',
		[FIT, '[k, insertBeside(v, prop.name, at, isAfter)]', '[k, v]'],
	],
	[
		'refused',
		'a turned bone accepted',
		[FIT, 'if (!(Math.abs(turn) <= TURN_EPS) || !(b.x * f.x + b.y * f.y > 0))', 'if (false)'],
	],
	['refused', 'a control fitted', [FIT, 'if (controlTarget(name))', 'if (false)']],
	[
		'refused',
		'an unknown field accepted',
		[
			FIT,
			'if (extra !== undefined) return no(`a fit has no field',
			'if (false) return no(`a fit has no field',
		],
	],
	[
		'refused',
		'an unknown bone accepted',
		[FIT, 'if (!b) return `it fits a bone', 'if (false) return `it fits a bone'],
	],
	['bends', 'the ramp replaced by nearness', [TPL, ': bend.ramp\n', ': false\n']],
	['bends', 'the ramp centred off the joint', [FIT, 'lead = 0.5,', 'lead = 0,']],
	[
		'bends',
		'no grid lines across the ramp',
		[
			TPL,
			'if (Math.abs(dy) >= Math.abs(dx)) vs.push(0.5 - y / h);',
			'if (Math.abs(dy) >= Math.abs(dx)) void y;',
		],
	],
	[
		'bends',
		'a covered part still reported needed',
		[TPL, 'if (p.required && !covered.has(p.name))', 'if (p.required)'],
	],
];
for (const [id, what, swap] of MUTANTS) {
	let red;
	let threw = '';
	const before = [checks, fails];
	const quiet = console.error;
	console.error = () => {};
	try {
		red = !GUARDS[id](await load([swap]));
	} catch (e) {
		// A mutant whose text is no longer in the shipped code plants nothing: that is a stale check.
		red = !String(e.message).includes('mutant:');
		threw = ` (threw: ${String(e.message).split('\n')[0].slice(0, 80)})`;
	}
	console.error = quiet;
	[checks, fails] = before;
	ok(`${id} turns red under "${what}"${threw}`, red);
	console.log(`    ${red ? '✓' : '✗'} ${id} under "${what}"${threw}`);
}

console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
process.exit(fails === 0 ? 0 : 1);
