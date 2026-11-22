// ⤢ Fit rig to the capture (docs/design/frame-to-rig.md §4.6a), headless, on the SHIPPED code: the
// measure and the refit (`rigCaptureFit.ts`), the fitted template (`rigTemplateFit.ts`), the real
// `half-body` and `full-body` templates, the motion solve with 📍 Follow positions (`rigMotion.ts`,
// `rigMotion3d.ts`), the page's keying and reference line-up pulled out of view.html, the 3D import
// and its bake (`rig3dImport.ts`), every pose read by engine-rig as a game plays it. The track is the
// synthetic performer of `performer3d.mjs` with arms of KNOWN lengths (0.30 + 0.24 m on shoulders
// 0.36 m apart: 233.3 + 186.7 rig units against the template's 190 + 170), leaning, its picture
// moving, its left forearm held toward the camera for most of the clip. Asserted:
//  - measure: each limb's length within 0.5 of the performer's, read as following positions reaches
//    it — the picture on the overlay's line-up with the tracker's depth (the picture alone draws the
//    turned forearm at about 0.7 of it); a joint below visibility 0.5 is not counted;
//  - pooled: each side takes its twin's frames too (one length for both arms); a side read further
//    off than 20% is said;
//  - spread / unseen: a glitching wrist widens the spread and is said; Full body's legs, never seen
//    in a waist-up shot, are left as they are and said;
//  - refit: each limb bone takes its length along its own direction; every control bone (the hand
//    controls and their spaces, the elbow poles) stays on what it marks; the art stretches with the
//    limb — every point of the upper arm's and the forearm's images keeps its place along and across
//    the limb, at setup and in a clip (no gap opens at a joint); a clip's translate keys on a limb bone
//    scale (bezier too), except in an animation that leaves them to its bake;
//  - flat: art drawn in the limb bone's own frame (no image bone) stretches there — a region, a
//    mesh weighted to the chain, a deform key on it;
//  - rig3d: the poles' depths and a 3D clip's authored translate and depth keys follow the lengths;
//  - follow (the point of it): imported with 📍 Follow positions, the template rig's elbows miss the
//    tracked ones by tens of units; refitted to the capture (the rig and the template the solve
//    reads), they land on them, and so do the wrists;
//  - 3D: a rig already imported in 3D, refitted and baked again, keeps its art on its joints on
//    every frame of the baked clip;
//  - template: the template on the rig's lengths drives them (a forearm's shortening by its new
//    length), is the template itself when they agree, and its kept fit merges and drops back;
//  - overlay: the lengths are the overlay's: an overlay scaled 1.2× by hand fits limbs 1.2× (they
//    reach the picture where it is drawn); none given, the template's own scale (the default line-up);
//  - lines: the report says each length old → new, with its frames and spread, and nothing more on
//    a calm capture;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/capture-fit.mjs [--only <guard>]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';
import { RIG_CORE } from './rig.mjs';

const APP = fileURLToPath(new URL('../../apps/launcher-api/', import.meta.url));
const LIB = join(APP, 'src/lib');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, Vector2 } = RIG;

const dir = mkdtempSync(join(tmpdir(), 'capture-fit-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let bundles = 0;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source first. */
async function load(mutate = []) {
	const out = join(dir, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigTemplates.ts';",
				"export * from './server/rigTemplateFit.ts';",
				"export * from './rigCaptureFit.ts';",
				"export { solveMotion } from './rigMotion.ts';",
				"export { authoringOf, importClip3d, rebakeClip3d } from './rig3dImport.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'capture-fit-entry.ts',
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
					build.onLoad({ filter: /(rigCaptureFit|rigTemplateFit)\.ts$/ }, (args) => {
						let text = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
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

// The page's keying and reference line-up, pulled out of the shipped view.html.
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
const F = new Function(
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
			'faceKeyMotion',
			'face3dReplaced',
			'motionLineUp',
		].map(grabFn),
		'return { faceKeyMotion, face3dReplaced, motionLineUp };',
	].join('\n'),
)();
const refFit = new Function(
	'ctx',
	[
		grabConst('REF_FACE_POINTS'),
		grabFn('motionRefTrack'),
		grabFn('motionRefFit'),
		'const rigTemplate = ctx.tpl; const skeleton = ctx.skel;',
		'const updateWorld = () => skeleton.updateWorldTransform(ctx.RIG.Physics.update);',
		'return motionRefFit({ width: ctx.track.width, height: ctx.track.height, track: motionRefTrack(ctx.track) });',
	].join('\n'),
);

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return true;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	return false;
};
const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[s.length >> 1] : NaN;
};
const r1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const r3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const clone = (x) => JSON.parse(JSON.stringify(x));
const SIDES = ['l', 'r'];

// ── rigs through engine-rig ─────────────────────────────────────────────────────────────────────
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function rigOf(M, id) {
	const tpl = M.RIG_TEMPLATES.find((t) => t.id === id);
	const regions = tpl.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = M.templateRig(tpl, regions);
	const names = new Set(regions.map((r) => r.name));
	const lines = ['page.png', 'size:8192,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return {
		tpl,
		summary: M.rigTemplateSummary(tpl),
		skeleton,
		has: (slot, part) => names.has(part) && !!skeleton.skins[0].attachments[slot]?.[part],
		atlas: `${lines.join('\n')}\n`,
	};
}
function dataOf(rig, irig) {
	const atlas = new TextureAtlas(rig.atlas);
	for (const p of atlas.pages) p.setTexture(stub);
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(irig));
}
function poser(rig, irig, clip) {
	const data = dataOf(rig, irig);
	return (t) => {
		const skel = new Skeleton(data);
		skel.setToSetupPose();
		if (clip) {
			const state = new AnimationState(new AnimationStateData(data));
			state.setAnimation(0, clip, false);
			state.update(t);
			state.apply(skel);
		}
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
const at = (skel, n) => {
	const b = skel.findBone(n);
	return [b.worldX, b.worldY];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** A region's corners in the world, as drawn. */
function corners(skel, slot) {
	const s = skel.findSlot(slot);
	const a = s.getAttachment();
	const out = new Array(8).fill(0);
	if ('worldVerticesLength' in a) a.computeWorldVertices(s, 0, a.worldVerticesLength, out, 0, 2);
	else a.computeWorldVertices(s, out, 0, 2);
	return [0, 2, 4, 6].map((i) => [out[i], out[i + 1]]);
}
/** A point in a limb's terms: its share of the way from `from` to `to`, and its offset across. */
function inLimb(p, from, to) {
	const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
	const l = Math.hypot(dx, dy);
	const [ux, uy] = [dx / l, dy / l];
	const [px, py] = [p[0] - from[0], p[1] - from[1]];
	return [(px * ux + py * uy) / l, -px * uy + py * ux];
}
/** How far the art of a limb strays from its place on the limb, between two poses (max, rig units). */
function artMoved(skelA, skelB, slot, joints, lengthB) {
	const ca = corners(skelA, slot);
	const cb = corners(skelB, slot);
	let worst = 0;
	for (let i = 0; i < 4; i++) {
		const a = inLimb(ca[i], at(skelA, joints[0]), at(skelA, joints[1]));
		const b = inLimb(cb[i], at(skelB, joints[0]), at(skelB, joints[1]));
		worst = Math.max(worst, Math.abs(a[0] - b[0]) * lengthB, Math.abs(a[1] - b[1]));
	}
	return worst;
}

// ── the performer ───────────────────────────────────────────────────────────────────────────────
const N = 72;
const FPS = 24;
const UPPER = 0.3;
const LOWER = 0.24;
const RIG_PER_M = 280 / 0.36;
const TRUE = { upper: UPPER * RIG_PER_M, lower: LOWER * RIG_PER_M };
/** Frames the left forearm points 50° toward the camera (most of the clip). */
const TOWARD = [10, 56];
const within = (i, [a, b]) => i >= a && i < b;
const shot = (t) => ({
	dx: 0.08 * Math.sin((2 * Math.PI * t) / 3),
	dy: 0.02 * Math.sin(2 * Math.PI * t),
});
const moved = (p, s) => [p[0] + s.dx, p[1] + s.dy];
/**
 * The performer: `left` scales the left arm (a side the tracker reads long),
 * `glitch(i)` throws the right wrist off on a frame, `hide(i)` drops the left elbow's visibility
 * (and throws it off), `legsHidden` hides the hips down.
 */
function performer({
	left = 1,
	glitch = () => false,
	hide = () => false,
	legsHidden = false,
} = {}) {
	const track = P.track(N, FPS, (i, t) => {
		const w = (2 * Math.PI * t) / 2.5;
		const tilt = within(i, TOWARD) ? 50 : 10 * Math.sin(w);
		return {
			pose: {
				lengths: { upper: UPPER, lower: LOWER },
				body: { lean: 8 * Math.sin(w) },
				arms: {
					l: {
						upper: P.dir(-30 - 12 * Math.sin(w), 8),
						lower: P.dir(-110 + 15 * Math.sin(w), tilt),
					},
					r: { upper: P.dir(35 + 10 * Math.sin(w), -6), lower: P.dir(100 - 12 * Math.sin(w), -12) },
				},
				legs: {
					l: { upper: P.dir(-8), lower: P.dir(4) },
					r: { upper: P.dir(8), lower: P.dir(-4) },
				},
			},
			opts: {},
		};
	});
	track.frames.forEach((f, i) => {
		const W = f.pose.world;
		const L = f.pose.landmarks;
		if (left !== 1)
			for (const k of [14, 16]) {
				const [s, p] = [W[12], L[12]];
				W[k] = [
					s[0] + (W[k][0] - s[0]) * left,
					s[1] + (W[k][1] - s[1]) * left,
					s[2] + (W[k][2] - s[2]) * left,
				];
				L[k] = [p[0] + (L[k][0] - p[0]) * left, p[1] + (L[k][1] - p[1]) * left, L[k][2]];
			}
		if (glitch(i)) {
			W[15] = [W[15][0] + 0.2, W[15][1] - 0.15, W[15][2] + 0.1];
			L[15] = [L[15][0] + 0.1, L[15][1] + 0.075, L[15][2]];
		}
		if (hide(i)) {
			L[14] = [L[14][0] + 0.2, L[14][1], 0.2];
			W[14] = [W[14][0] + 0.4, W[14][1], W[14][2] + 0.3];
		}
		if (legsHidden)
			for (let k = 23; k < 33; k++)
				if (k > 24) f.pose.landmarks[k] = [...f.pose.landmarks[k].slice(0, 2), 0.1];
		const s = shot(f.t);
		f.pose.landmarks = f.pose.landmarks.map((p) => [...moved(p, s), p[2]]);
	});
	return track;
}

/** The page's line-up of a track on a rig's setup, as the solve and the overlay read it. */
function lineUpOf(rig, irig, track) {
	const skel = poser(rig, irig)(0);
	const align = refFit({ tpl: rig.summary, RIG, skel, track });
	return F.motionLineUp(align, track);
}
/** Import a track into clip `imp` as the page does, in 3D, following positions. */
function import3d(M, rig, irig, tpl, track) {
	const lineUp = lineUpOf(rig, irig, track);
	const solved = M.solveMotion(
		{ bones: tpl.bones, channels: tpl.channels, motion: tpl.motion },
		track,
		{
			three: true,
			follow: { lineUp, depths: tpl.rig3d.depths },
		},
	);
	const base = clone(irig);
	const { animation, orient } = M.authoringOf(base, null, 'imp');
	F.faceKeyMotion(
		animation,
		solved.keys,
		0,
		tpl.channels,
		rig.has,
		base.slots.map((s) => s.name),
	);
	const out = M.importClip3d({
		irig: base,
		doc: null,
		stem: 'hero',
		template: tpl.rig3d,
		clip: 'imp',
		animation,
		orient,
		keys: solved.bones3d,
		at: 0,
		length: solved.length,
		replaced: F.face3dReplaced(tpl),
		keys2d: solved.keys2d,
	});
	return { ...out, lineUp };
}
/** Per settled frame, each elbow's and wrist's distance from the tracked one on the line-up. */
function residual(rig, run, track) {
	const pose = poser(rig, run.irig, 'imp');
	const toRig = (p) => [
		run.lineUp.x0 + run.lineUp.k * p[0] * track.width,
		run.lineUp.y0 - run.lineUp.k * p[1] * track.height,
	];
	const out = { elbow: [], wrist: [] };
	for (let i = 4; i < N - 2; i++) {
		const f = track.frames[i];
		const skel = pose(f.t + 1e-4);
		for (const [s, el, wr] of [
			['l', 14, 16],
			['r', 13, 15],
		]) {
			out.elbow.push(dist(at(skel, `lower_arm_${s}`), toRig(f.pose.landmarks[el])));
			out.wrist.push(dist(at(skel, `hand_${s}`), toRig(f.pose.landmarks[wr])));
		}
	}
	return { elbow: median(out.elbow), wrist: median(out.wrist), elbowMax: Math.max(...out.elbow) };
}
const fitOf = (M, rig, track, opts) => {
	const measure = M.measureCapture(track, rig.tpl.motion, opts);
	return { measure, fit: measure ? M.captureFit(measure, rig.skeleton.bones) : [] };
};
const lengthsOf = (fit) => Object.fromEntries(fit.map((f) => [f.bone, f.to]));
const boneLen = (doc, n) => {
	const b = doc.bones.find((x) => x.name === n);
	return Math.hypot(b.x ?? 0, b.y ?? 0);
};

// ── the guards ──────────────────────────────────────────────────────────────────────────────────
const GUARDS = {
	measure(M) {
		const rig = rigOf(M, 'half-body');
		const track = performer();
		const { measure, fit } = fitOf(M, rig, track);
		const want = { lower_arm: TRUE.upper, hand: TRUE.lower };
		const off = fit.map((f) => Math.abs(f.to - want[f.bone.replace(/_[lr]$/, '')]));
		const f0 = track.frames[30];
		const pic = Math.hypot(
			(f0.pose.landmarks[16][0] - f0.pose.landmarks[14][0]) * track.width,
			(f0.pose.landmarks[16][1] - f0.pose.landmarks[14][1]) * track.height,
		);
		const pass = [
			ok(
				'measure: precondition — the turned forearm draws short in the picture',
				pic / 500 / LOWER < 0.75,
				r3(pic / 500 / LOWER),
			),
			ok(
				'measure: each limb within 0.5 of the performer’s, from the 3D points',
				fit.length === 4 && Math.max(...off) < 0.5,
				fit.map((f) => `${f.bone} ${r1(f.to)}`).join(', '),
			),
			ok(
				'measure: every frame counted',
				measure.lengths.every((l) => l.samples.length === N),
				measure.lengths.map((l) => l.samples.length).join(' '),
			),
		];
		const hidden = fitOf(M, rig, performer({ hide: (i) => i % 4 === 0 }));
		const upper = hidden.measure.lengths.find((l) => l.bone === 'lower_arm_l');
		pass.push(
			ok(
				'measure: a joint below visibility 0.5 is not counted (its 3D point thrown far off)',
				upper.samples.length === N - N / 4 && Math.abs(upper.median - TRUE.upper) < 0.5,
				`${upper.samples.length} frames, ${r1(upper.median)}`,
			),
		);
		return pass.every(Boolean);
	},

	pooled(M) {
		const rig = rigOf(M, 'half-body');
		const { measure, fit } = fitOf(M, rig, performer({ left: 1.06 }));
		const by = Object.fromEntries(fit.map((f) => [f.bone, f]));
		const lines = M.captureFitLines(measure, fit);
		const far = fitOf(M, rig, performer({ left: 1.3 }));
		const pass = [
			ok(
				'pooled: both sides take one length, from both sides’ frames',
				by.lower_arm_l.to === by.lower_arm_r.to &&
					by.lower_arm_l.frames === 2 * N &&
					by.lower_arm_l.pooled === 'lower_arm_r',
				`${by.lower_arm_l.to} ${by.lower_arm_r.to} ${by.lower_arm_l.frames}`,
			),
			ok(
				'pooled: …between the two sides’ reads',
				by.lower_arm_l.to > TRUE.upper + 1 && by.lower_arm_l.to < TRUE.upper * 1.06 - 1,
				r1(by.lower_arm_l.to),
			),
			ok(
				'pooled: a side 6% off is not said',
				!lines.some((l) => / read .* and /.test(l)),
				lines.join(' | '),
			),
			ok(
				'pooled: a side 30% off is said',
				M.captureFitLines(far.measure, far.fit).some((l) =>
					/Left upper arm read .* and right upper arm/.test(l),
				),
			),
		];
		return pass.every(Boolean);
	},

	spread(M) {
		const rig = rigOf(M, 'half-body');
		const calm = fitOf(M, rig, performer());
		const wild = fitOf(M, rig, performer({ glitch: (i) => i % 3 !== 0 }));
		const say = (r) =>
			M.captureFitLines(r.measure, r.fit).some((l) => /Right lower arm: its length varies/.test(l));
		const spread = wild.fit.find((f) => f.bone === 'hand_r').spread;
		return [
			ok(
				'spread: a glitching wrist widens the forearm’s spread past 40%',
				spread > 0.4,
				r3(spread),
			),
			ok('spread: …and it is said; a calm track says nothing', say(wild) && !say(calm)),
		].every(Boolean);
	},

	unseen(M) {
		const rig = rigOf(M, 'full-body');
		const { measure, fit } = fitOf(M, rig, performer({ legsHidden: true }));
		const lines = M.captureFitLines(measure, fit);
		return [
			ok(
				'unseen: a waist-up shot fits Full body’s arms and leaves its legs',
				fit
					.map((f) => f.bone)
					.sort()
					.join(',') === 'hand_l,hand_r,lower_arm_l,lower_arm_r' &&
					fit.every((f) => Number.isFinite(f.to)),
				fit.map((f) => f.bone).join(','),
			),
			ok(
				'unseen: …and says so per leg',
				['Left thigh', 'Right thigh', 'Left shin', 'Right shin'].every((w) =>
					lines.some((l) => l.startsWith(`${w}: seen on 0 frames`)),
				),
			),
		].every(Boolean);
	},

	refit(M) {
		const rig = rigOf(M, 'half-body');
		const { fit } = fitOf(M, rig, performer());
		const doc = clone(rig.skeleton);
		const r = M.refitIrig(doc, lengthsOf(fit));
		const dirOf = (d, n) => {
			const b = d.bones.find((x) => x.name === n);
			return Math.atan2(b.y ?? 0, b.x ?? 0);
		};
		const pass = [
			ok(
				'refit: each limb bone takes its length along its own direction',
				fit.every(
					(f) =>
						Math.abs(boneLen(doc, f.bone) - f.to) < 1e-3 &&
						Math.abs(dirOf(doc, f.bone) - dirOf(rig.skeleton, f.bone)) < 1e-9,
				),
				fit.map((f) => `${f.bone} ${r1(boneLen(doc, f.bone))}`).join(', '),
			),
			ok(
				'refit: the ratios reported',
				r.ratios.size === 4 && Math.abs(r.ratios.get('hand_l') - fit[1].to / 170) < 1e-9,
			),
		];
		const wild = clone(rig.skeleton);
		const w = M.refitIrig(wild, { lower_arm_l: 1e308 * 10, hand_l: 2e5 });
		pass.push(
			ok(
				'refit: a length past the most (or an overflow) leaves the bone as it was',
				w.ratios.size === 0 && JSON.stringify(wild) === JSON.stringify(rig.skeleton),
			),
		);
		return pass.every(Boolean);
	},

	controls(M) {
		const rig = rigOf(M, 'half-body');
		const doc = clone(rig.skeleton);
		const before = poser(rig, rig.skeleton)(0);
		const r = M.refitIrig(doc, {
			lower_arm_l: TRUE.upper,
			hand_l: TRUE.lower,
			lower_arm_r: TRUE.upper,
			hand_r: TRUE.lower,
		});
		const after = poser(rig, doc)(0);
		const worst = { hand: 0, pole: 0 };
		for (const s of SIDES) {
			for (const c of [`hand_ik_${s}`, `hand_ik_${s}_chest`, `hand_ik_${s}_world`])
				worst.hand = Math.max(worst.hand, dist(at(after, c), at(after, `hand_${s}`)));
			const was = [at(before, `elbow_pole_${s}`), at(before, `lower_arm_${s}`)];
			const now = [at(after, `elbow_pole_${s}`), at(after, `lower_arm_${s}`)];
			worst.pole = Math.max(
				worst.pole,
				dist(
					[was[0][0] - was[1][0], was[0][1] - was[1][1]],
					[now[0][0] - now[1][0], now[0][1] - now[1][1]],
				),
			);
		}
		return [
			ok(
				'controls: every hand control and space bone stays on the wrist',
				worst.hand < 1e-3,
				r3(worst.hand),
			),
			ok(
				'controls: each elbow pole keeps its place by the elbow',
				worst.pole < 1e-3,
				r3(worst.pole),
			),
			ok(
				'controls: the moved controls are reported',
				r.controls.length === 8,
				r.controls.join(','),
			),
		].every(Boolean);
	},

	stretch(M) {
		const rig = rigOf(M, 'half-body');
		const doc = clone(rig.skeleton);
		doc.animations = {
			wave: {
				bones: {
					upper_arm_l: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 70 },
						],
					},
					lower_arm_l: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 45 },
						],
					},
					upper_arm_l_image: {
						scale: [
							{ time: 0, x: 1, y: 1 },
							{ time: 1, x: 1, y: 0.6 },
						],
					},
				},
			},
		};
		const was = clone(doc);
		const r = M.refitIrig(doc, { lower_arm_l: TRUE.upper, hand_l: TRUE.lower });
		const worst = (t) => {
			const a = poser(rig, was, 'wave')(t);
			const b = poser(rig, doc, 'wave')(t);
			return Math.max(
				artMoved(a, b, 'upper_arm_l', ['upper_arm_l', 'lower_arm_l'], TRUE.upper),
				artMoved(a, b, 'lower_arm_l', ['lower_arm_l', 'hand_l'], TRUE.lower),
			);
		};
		const moved = Math.max(worst(0), worst(0.5), worst(1));
		const scaleY = (n) => doc.bones.find((b) => b.name === n).scaleY;
		return [
			ok(
				'stretch: each limb’s image bone takes its ratio along the limb',
				Math.abs(scaleY('upper_arm_l_image') - TRUE.upper / 190) < 1e-4 &&
					Math.abs(scaleY('lower_arm_l_image') - TRUE.lower / 170) < 1e-4,
				`${scaleY('upper_arm_l_image')} ${scaleY('lower_arm_l_image')}`,
			),
			ok(
				'stretch: every point of the arm’s art keeps its place along and across the limb, at setup and in a clip (no gap at a joint)',
				moved < 0.01,
				r3(moved),
			),
			ok(
				'stretch: both images reported stretched',
				r.stretched.filter((s) => s.how === 'scaleY').length === 2 && !r.unstretched.length,
			),
		].every(Boolean);
	},

	keys(M) {
		const rig = rigOf(M, 'half-body');
		const doc = clone(rig.skeleton);
		const key = () => ({
			bones: {
				lower_arm_l: {
					translate: [
						{ time: 0, x: 0, y: 10, curve: [0.25, 10, 0.75, 10, 0.25, 30, 0.75, 40] },
						{ time: 1, x: 0, y: 40 },
					],
				},
			},
		});
		doc.animations = { slide: key(), baked: key() };
		M.refitIrig(doc, { lower_arm_l: TRUE.upper }, { baked: ['lower_arm_l'] });
		const r = TRUE.upper / 190;
		const k = doc.animations.slide.bones.lower_arm_l.translate;
		const pose = poser(rig, doc, 'slide')(1);
		const setup = poser(rig, doc)(0);
		return [
			ok(
				'keys: a limb bone’s translate keys scale with it, bezier values too',
				Math.abs(k[0].y - 10 * r) < 1e-9 &&
					Math.abs(k[1].y - 40 * r) < 1e-9 &&
					Math.abs(k[0].curve[7] - 40 * r) < 1e-9 &&
					k[0].curve[6] === 0.75,
				JSON.stringify(k[0]),
			),
			ok(
				'keys: …so the joint slides by its share of the new length (engine-rig)',
				Math.abs(dist(at(pose, 'lower_arm_l'), at(setup, 'lower_arm_l')) - 40 * r) < 1e-3,
			),
			ok(
				'keys: an animation that leaves the bone to its bake keeps them',
				JSON.stringify(doc.animations.baked) === JSON.stringify(key()),
			),
		].every(Boolean);
	},

	flat(M) {
		const rig = rigOf(M, 'half-body');
		const doc = clone(rig.skeleton);
		// The art drawn on the limb bones themselves: no image bone carries a slot.
		for (const s of doc.slots) if (/^(upper|lower)_arm_[lr]$/.test(s.name)) s.bone = s.name;
		// Drawn down the limb, as real art is placed (the placeholder sits on the joint).
		doc.skins[0].attachments.upper_arm_l.upper_arm_l.y = -95;
		const ix = (n) => doc.bones.findIndex((b) => b.name === n);
		const [U, L] = [ix('upper_arm_r'), ix('lower_arm_r')];
		// A mesh weighted to the chain: its top at the shoulder, its bottom blended at the elbow.
		doc.skins[0].attachments.upper_arm_r.upper_arm_r = {
			type: 'mesh',
			path: 'upper_arm_r',
			uvs: [0, 0, 1, 0, 1, 1, 0, 1],
			triangles: [0, 1, 2, 2, 3, 0],
			hull: 4,
			vertices: [
				1,
				U,
				-35,
				0,
				1,
				1,
				U,
				35,
				0,
				1,
				2,
				U,
				35,
				-190,
				0.5,
				L,
				35,
				0,
				0.5,
				2,
				U,
				-35,
				-190,
				0.5,
				L,
				-35,
				0,
				0.5,
			],
			width: 70,
			height: 190,
		};
		doc.animations = {
			bulge: {
				attachments: {
					default: {
						upper_arm_r: {
							upper_arm_r: { deform: [{ time: 0, offset: 4, vertices: [0, -10, 0, -10] }] },
						},
					},
				},
			},
		};
		const was = clone(doc);
		const r = M.refitIrig(doc, {
			lower_arm_l: TRUE.upper,
			hand_l: TRUE.lower,
			lower_arm_r: TRUE.upper,
			hand_r: TRUE.lower,
		});
		const a = poser(rig, was)(0);
		const b = poser(rig, doc)(0);
		const region = Math.max(
			artMoved(a, b, 'upper_arm_l', ['upper_arm_l', 'lower_arm_l'], TRUE.upper),
			artMoved(a, b, 'lower_arm_l', ['lower_arm_l', 'hand_l'], TRUE.lower),
		);
		const mesh = artMoved(a, b, 'upper_arm_r', ['upper_arm_r', 'lower_arm_r'], TRUE.upper);
		const dv = doc.animations.bulge.attachments.default.upper_arm_r.upper_arm_r.deform[0].vertices;
		const ru = TRUE.upper / 190;
		return [
			ok(
				'flat: a region on the limb bone itself stretches with it (place and size)',
				region < 0.01,
				r3(region),
			),
			ok('flat: a mesh weighted to the chain keeps its place on the limb', mesh < 0.01, r3(mesh)),
			ok(
				'flat: a deform key on it stretches in the same frame',
				Math.abs(dv[1] + 10 * ru) < 1e-3 && Math.abs(dv[3] + (10 * TRUE.lower) / 170) < 1e-3,
				JSON.stringify(dv),
			),
			ok(
				'flat: no image bone took a scale',
				doc.bones.every((x) => !/_image$/.test(x.name) || (x.scaleY ?? 1) === 1) &&
					r.stretched.every((s) => s.how === 'attachments'),
			),
		].every(Boolean);
	},

	rig3d(M) {
		const ratios = new Map([
			['lower_arm_l', 1.25],
			['hand_l', 1.1],
		]);
		const doc = {
			rig3d: 1,
			rig: 'hero',
			bones: { elbow_pole_l: { depth: -80 }, lower_arm_l: { depth: 8 }, face: { depth: 95 } },
			clips: {
				imp: {
					bones: {
						lower_arm_l: {
							translate: [{ time: 0, x: 2, y: -4, curve: [0.2, 2, 0.8, 2, 0.2, -4, 0.8, -8] }],
							depth: [{ time: 0, value: 6 }],
						},
						face: { depth: [{ time: 0, value: 3 }] },
					},
				},
			},
		};
		M.refitRig3d(doc, ratios);
		const k = doc.clips.imp.bones.lower_arm_l;
		return [
			ok(
				'rig3d: a pole’s depth follows the limb above its joint, a fitted bone’s its own, others stay',
				doc.bones.elbow_pole_l.depth === -100 &&
					doc.bones.lower_arm_l.depth === 10 &&
					doc.bones.face.depth === 95,
				JSON.stringify(doc.bones),
			),
			ok(
				'rig3d: a 3D clip’s authored translate (bezier too) and depth keys on a fitted bone scale',
				k.translate[0].y === -5 &&
					k.translate[0].curve[7] === -10 &&
					k.depth[0].value === 7.5 &&
					doc.clips.imp.bones.face.depth[0].value === 3,
				JSON.stringify(k),
			),
		].every(Boolean);
	},

	follow(M) {
		const rig = rigOf(M, 'half-body');
		const track = performer();
		const plain = residual(rig, import3d(M, rig, rig.skeleton, rig.summary, track), track);
		const { fit } = fitOf(M, rig, track);
		const doc = clone(rig.skeleton);
		M.refitIrig(doc, lengthsOf(fit));
		const tpl = M.templateOnRig(rig.summary, doc.bones);
		const fitted = residual(rig, import3d(M, rig, doc, tpl, track), track);
		console.log(
			`  follow positions, template rig → fitted to the capture (median rig units): elbows ${r1(plain.elbow)} → ${r1(fitted.elbow)} (max ${r1(plain.elbowMax)} → ${r1(fitted.elbowMax)}), wrists ${r1(plain.wrist)} → ${r1(fitted.wrist)}`,
		);
		return [
			ok(
				'follow: precondition — the template rig’s elbows miss the tracked ones',
				plain.elbow > 20,
				r1(plain.elbow),
			),
			// The floor is the keying's: a turn key may stray 1° (4 units at the end of a 233-unit arm),
			// and the points are smoothed; the wrists, which reach their target either way, sit on it.
			ok(
				'follow: fitted, the elbows land on the tracked ones (as near as the wrists, within the keys’ 1°)',
				fitted.elbow < plain.wrist + 0.5 && fitted.elbowMax < 5,
				`${r1(fitted.elbow)} max ${r1(fitted.elbowMax)}`,
			),
			ok('follow: …and the wrists stay on theirs', fitted.wrist < 2, r1(fitted.wrist)),
		].every(Boolean);
	},

	bake3d(M) {
		const rig = rigOf(M, 'half-body');
		const track = performer();
		const first = import3d(M, rig, rig.skeleton, rig.summary, track);
		const { fit } = fitOf(M, rig, track);
		const irig = clone(first.irig);
		const doc = clone(first.doc);
		const owned = [...first.plan.owned];
		const r = M.refitIrig(irig, lengthsOf(fit), { imp: owned });
		M.refitRig3d(doc, r.ratios);
		const out = M.rebakeClip3d({ irig, doc, clip: 'imp', owned });
		const before = poser(rig, first.irig, 'imp');
		const after = poser(rig, out.irig, 'imp');
		// The upper arm image's end (190 below its bone at setup) on the elbow, every frame.
		const gap = (pose, t) => {
			const skel = pose(t);
			const p = new Vector2(0, -190);
			skel.findBone('upper_arm_l_image').localToWorld(p);
			return dist([p.x, p.y], at(skel, 'lower_arm_l'));
		};
		let worst = 0;
		let was = 0;
		for (let i = 0; i < N; i++) {
			const t = track.frames[i].t + 1e-4;
			was = Math.max(was, gap(before, t));
			worst = Math.max(worst, gap(after, t));
		}
		return [
			// Within the bake's own tolerance (its keys may stray 0.45 per bone).
			ok(
				'bake3d: precondition — the imported 3D clip draws the upper arm to its elbow',
				was < 1,
				r3(was),
			),
			ok(
				'bake3d: refitted and baked again, the stretched art still ends on the elbow on every frame',
				worst < 1,
				r3(worst),
			),
		].every(Boolean);
	},

	template(M) {
		const rig = rigOf(M, 'half-body');
		const doc = clone(rig.skeleton);
		M.refitIrig(doc, {
			lower_arm_l: TRUE.upper,
			hand_l: TRUE.lower,
			lower_arm_r: TRUE.upper,
			hand_r: TRUE.lower,
		});
		const t = M.templateOnRig(rig.summary, doc.bones);
		const per = (x) =>
			x.channels
				.find((c) => c.id === 'fore_lower_arm_l')
				.drives.find((d) => d.bone === 'hand_l' && d.prop === 'y').per;
		const merged = M.mergeRigLengths(
			rig.tpl,
			{ bones: { chest: { x: 0, y: 185 } }, frame: { spine: { rotate: 4 } } },
			doc.bones,
		);
		const back = M.mergeRigLengths(rig.tpl, merged, rig.skeleton.bones);
		return [
			ok(
				'template: on the rig’s lengths, a forearm’s shortening moves the wrist by its new length',
				Math.abs(per(t) / per(rig.summary) - TRUE.lower / 170) < 1e-4,
				r3(per(t) / per(rig.summary)),
			),
			ok(
				'template: the elbow pole’s depth follows',
				Math.abs(
					t.rig3d.depths.elbow_pole_l / rig.summary.rig3d.depths.elbow_pole_l - TRUE.upper / 190,
				) < 1e-4,
			),
			ok(
				'template: the same template when the rig has its lengths',
				M.templateOnRig(rig.summary, rig.skeleton.bones) === rig.summary,
			),
			ok(
				'template: a kept fit takes the limbs and keeps the rest; back on the template’s lengths, only the rest',
				Math.abs(merged.bones.hand_l.y + TRUE.lower) < 0.01 &&
					merged.bones.chest.y === 185 &&
					merged.frame.spine.rotate === 4 &&
					M.templateFitProblem(rig.tpl, merged) === null &&
					JSON.stringify(Object.keys(back.bones)) === '["chest"]',
				JSON.stringify(back),
			),
			ok(
				'template: nothing kept when the rig is the template',
				M.mergeRigLengths(rig.tpl, null, rig.skeleton.bones) === null,
			),
		].every(Boolean);
	},

	lines(M) {
		const rig = rigOf(M, 'half-body');
		const track = performer();
		const lineUp = lineUpOf(rig, rig.skeleton, track);
		const said = (k) => {
			const { measure, fit } = fitOf(M, rig, track, { k });
			return M.captureFitLines(measure, fit);
		};
		const right = said(lineUp.k);
		return [
			ok(
				'lines: each limb’s length old → new, with its frames and spread',
				right.some((l) =>
					/^Left upper arm: 190\.0 → 233\.\d \(×1\.23; 144 frames, spread 0%\)/.test(l),
				),
				right.join(' | '),
			),
			ok(
				'lines: a calm, even capture says nothing more than the re-import hint',
				right.length === 6 && /Key at playhead again/.test(right[5]),
				right.join(' | '),
			),
		].every(Boolean);
	},

	overlay(M) {
		const rig = rigOf(M, 'half-body');
		const track = performer();
		const k = lineUpOf(rig, rig.skeleton, track).k;
		const lengths = (lu) =>
			Object.fromEntries(fitOf(M, rig, track, lu).fit.map((f) => [f.bone, f.to]));
		const [own, scaled, none] = [lengths({ k }), lengths({ k: k * 1.2 }), lengths(undefined)];
		const bones = Object.keys(own);
		return [
			ok(
				'overlay: an overlay scaled 1.2× by hand fits limbs 1.2× (they reach the picture where it is drawn)',
				bones.length === 4 && bones.every((b) => Math.abs(scaled[b] / own[b] - 1.2) < 1e-3),
				JSON.stringify(scaled),
			),
			ok(
				'overlay: none given, the template’s own scale (the overlay’s default line-up)',
				bones.every((b) => Math.abs(none[b] - own[b]) < 0.05),
				JSON.stringify(none),
			),
		].every(Boolean);
	},
};

const CF = 'rigCaptureFit.ts';
const MUTANTS = [
	['measure', 'lengths read in the picture alone', [CF, '(b[2] - a[2]) * ppm', '0']],
	[
		'measure',
		'the depth at the wrong scale',
		[CF, '(b[2] - a[2]) * ppm', '(b[2] - a[2]) * ppm * 2'],
	],
	['measure', 'a hidden joint counted', [CF, '!((p[2] ?? 1) >= CAPTURE_MIN_VISIBILITY)', 'false']],
	[
		'pooled',
		'each side alone',
		[CF, 'const other = twin ? measured.get(twin) : undefined;', 'const other = undefined;'],
	],
	['pooled', 'sides apart never said', [CF, '> CAPTURE_SIDES_APART)', '> Infinity)']],
	['spread', 'a wide spread never said', [CF, 'if (f.spread > CAPTURE_WIDE_SPREAD)', 'if (false)']],
	[
		'unseen',
		'a length fitted from no frames',
		[CF, 'if (samples.length < CAPTURE_MIN_FRAMES) {', 'if (samples.length < 0) {'],
	],
	[
		'refit',
		'the lengths left as they were',
		[CF, 'b.y = round4((b.y ?? 0) * r);', 'b.y = round4(b.y ?? 0);'],
	],
	[
		'controls',
		'the controls left at the old joints',
		[CF, 'if (target && before.has(target) && before.has(b.name)) {', 'if (false) {'],
	],
	[
		'stretch',
		'the art not stretched',
		[CF, 'img[how] = round4((img[how] ?? 1) * r);', 'void how;'],
	],
	[
		'keys',
		'the keys left at the old length',
		[CF, 'animations[name] = fitTimelines(', 'animations[name] = ((x) => x)('],
	],
	[
		'keys',
		'a bake’s tracks scaled',
		[
			CF,
			'const scaled = new Map([...ratios].filter(([b]) => !kept.has(b)));',
			'const scaled = new Map(ratios);',
		],
	],
	[
		'flat',
		'a region on the limb not moved',
		[
			CF,
			'\t\t\t\t\tatt.x = round4(x);\n\t\t\t\t\tatt.y = round4(y);',
			'\t\t\t\t\tvoid x;\n\t\t\t\t\tvoid y;',
		],
	],
	[
		'flat',
		'weighted vertices left',
		[CF, 'if (s) [o[i + 1], o[i + 2]] = along(', 'if (false) [o[i + 1], o[i + 2]] = along('],
	],
	[
		'flat',
		'deform keys left',
		[CF, 'if (s) [v[j], v[j + 1]] = along(', 'if (false) [v[j], v[j + 1]] = along('],
	],
	['rig3d', 'the depths left', [CF, 'if (b.depth !== undefined && k !== 1)', 'if (false)']],
	[
		'rig3d',
		'a 3D clip’s keys left',
		[CF, 'clip.bones = fitTimelines(', 'clip.bones = ((x) => x)('],
	],
	[
		'follow',
		'the solve on the template’s lengths',
		[CF, 'return Object.keys(fit).length ? fitLengths(t, fit) : t;', 'return t;'],
	],
	[
		'bake3d',
		'the art not stretched (3D)',
		[CF, 'img[how] = round4((img[how] ?? 1) * r);', 'void how;'],
	],
	[
		'template',
		'the rig’s lengths never read',
		[CF, 'Math.abs(rl - tl) < 1e-3) continue;', 'true) continue;'],
	],
	[
		'template',
		'a stale kept length kept',
		[CF, 'for (const s of captureSegments(t.motion)) delete bones[s.bone];', ''],
	],
	[
		'lines',
		'the old length not said',
		[CF, '${limbLabel(f.along)}: ${round1(f.from)} → ', '${limbLabel(f.along)}: → '],
	],
	['overlay', 'the overlay’s scale ignored', [CF, 'const k = lineUp?.k ?? (', 'const k = (']],
	[
		'overlay',
		'no default scale',
		[CF, 'across.length ? scale.rig / quantile(across, 0.5) : NaN', 'NaN'],
	],
];

const M = await load();
const only = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
for (const [id, guard] of Object.entries(GUARDS)) {
	if (only && id !== only) continue;
	const t0 = Date.now();
	const pass = guard(M);
	console.log(`  ${pass ? '✓' : '✗'} ${id} (${Date.now() - t0} ms)`);
}
if (!only)
	for (const [id, what, swap] of MUTANTS) {
		let red;
		let threw = '';
		const before = [checks, fails];
		const quiet = console.error;
		const log = console.log;
		console.error = () => {};
		console.log = () => {};
		try {
			red = !GUARDS[id](await load([swap]));
		} catch (e) {
			red = !String(e.message).includes('mutant:');
			threw = ` (threw: ${String(e.message).split('\n')[0].slice(0, 80)})`;
		}
		console.error = quiet;
		console.log = log;
		[checks, fails] = before;
		ok(`${id} turns red under "${what}"${threw}`, red);
		console.log(`    ${red ? '✓' : '✗'} ${id} under "${what}"${threw}`);
	}

console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
process.exit(fails === 0 ? 0 : 1);
