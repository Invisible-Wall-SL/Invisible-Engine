// Verify the motion import's depth (rig templates §5.4) headlessly, on the SHIPPED code: the solver
// is `src/lib/rigMotion.ts`, the templates are the real `half-body`, `full-body` and
// `bust-face`, the keys are written by the Controls section's
// helpers pulled out of view.html, and every result is posed by engine-rig's loader and
// AnimationState — so what is asserted is what the GAME shows. No MediaPipe and no network: each
// track is built here from a performer in metres, with known depth. Asserted:
//  - foreshortening: a forearm turned 45°, 60° and 80° toward the camera keys its shortening at
//    1 − cos (held at the template's floor past it, and reported as such), its image shortens and the
//    wrist comes in under engine-rig while the hand keeps its own shape (its image is on a bone of
//    its own); the hand on the same line shortens with it; the import's strength halves it, and off
//    keys nothing;
//  - front / behind: a hand passing behind the back goes behind the torso in the draw order and comes
//    back in front, once each way although its depth wobbles across the margin (hysteresis); a
//    two-frame blip is not keyed; a hand behind the head goes behind the head only (it is above the
//    shoulders); a hidden hand (visibility 0.2) is still read; the other arm stays in front; both
//    arms behind keep their own order; keyed by hand, a depth control holds to its next change
//    across the other arm's keys;
//  - the head: a yaw and pitch sweep in the face's 3D pose turns and nods the face, the nose further,
//    the back hair the other way, held at ±1 past 25° / 15° and reported;
//  - the torso: a body turned 20°, 40°, 70° and −40° shows the front, ¾ and side torso images
//    (front again on art without them), its shoulders come in by 1 − cos and the torso narrows;
//  - the distance: a performer 10% nearer scales the whole character 10%;
//   node tools/rigger-spike/motion-depth.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
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
} = RIG;

const dir = mkdtempSync(join(tmpdir(), 'motion-depth-'));
const bundle = async (entry, name) => {
	const out = join(dir, name);
	await esbuild.build({
		entryPoints: [join(APP, entry)],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'error',
	});
	return import(pathToFileURL(out).href);
};
const { HALF_BODY, FULL_BODY, BUST_FACE, templateRig } = await bundle(
	'src/lib/server/rigTemplates.ts',
	'templates.mjs',
);
const { solveMotion, DEPTH_HOLD } = await bundle('src/lib/rigMotion.ts', 'motion.mjs');

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
		].map(grabFn),
		'return { faceChannelValue, faceKeyChannel, faceKeyMotion };',
	].join('\n'),
)();

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const EDGE = 0.005;
const FPS = 24;

function rigWith(tpl, skip = []) {
	const regions = tpl.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = templateRig(tpl, regions);
	const names = new Set(regions.map((r) => r.name));
	const has = (slot, part) => names.has(part) && !!skeleton.skins[0].attachments[slot]?.[part];
	const lines = ['page.png', 'size:8192,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return {
		tpl,
		skeleton,
		has,
		setup: skeleton.slots.map((s) => s.name),
		atlas: lines.join('\n') + '\n',
	};
}
function play(rig, anim, t) {
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify({ ...rig.skeleton, animations: { a: anim } })),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, 'a', false);
	state.update(t);
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	return skel;
}
const bone = (skel, n) => skel.findBone(n);
const wpos = (skel, n) => [bone(skel, n).worldX, bone(skel, n).worldY];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** A bone's world length along its own x and y axes (its scale as the game draws it). */
const wscale = (skel, n) => {
	const b = bone(skel, n);
	return [Math.hypot(b.a, b.c), Math.hypot(b.b, b.d)];
};
/** The world scale a slot's image is drawn at: its bone's, whichever bone that is. */
const slotScale = (skel, slot) => {
	const b = skel.findSlot(slot).bone;
	return [Math.hypot(b.a, b.c), Math.hypot(b.b, b.d)];
};
const shown = (skel, slot) => skel.findSlot(slot).getAttachment()?.name ?? null;
const drawn = (skel) => skel.drawOrder.map((s) => s.data.name);
/** Solve, key from 0 through the page's keying path, and return a poser. */
function keyed(rig, track, opts = {}) {
	const solved = solveMotion(
		{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
		track,
		opts,
	);
	const anim = {};
	F.faceKeyMotion(anim, solved.keys, 0, rig.tpl.channels, rig.has, rig.setup);
	return { solved, anim, at: (i) => play(rig, anim, i / FPS + EDGE) };
}
/** A channel's solved value at frame i, read back from its keys as the page plays them. */
const valueAt = (solved, id, i) => {
	const own = solved.keys.filter((k) => k[1] === id);
	const t = i / FPS;
	let v = null;
	for (let j = 0; j < own.length; j++) {
		const [ta, , va] = own[j];
		const next = own[j + 1];
		if (ta > t + 1e-9) break;
		v = next && next[0] > t ? va + ((t - ta) / (next[0] - ta)) * (next[2] - va) : va;
	}
	return v;
};

// ---------------------------------------------------------------- the performer, in metres
// Hips' middle at the origin, y down, z away from the camera; the picture-left side is the
// performer's right (pose points 12, 14, 16, 18, 20). Seen straight on at S pixels per metre.
const W = 640;
const H = 640;
const STAND = {
	0: [0, -0.74, -0.09],
	7: [0.07, -0.72, 0],
	8: [-0.07, -0.72, 0],
	11: [0.18, -0.5, 0],
	12: [-0.18, -0.5, 0],
	13: [0.2, -0.22, 0],
	14: [-0.2, -0.22, 0],
	15: [0.2, 0.03, 0],
	16: [-0.2, 0.03, 0],
	17: [0.21, 0.11, 0],
	18: [-0.21, 0.11, 0],
	19: [0.19, 0.11, 0],
	20: [-0.19, 0.11, 0],
	23: [0.1, 0, 0],
	24: [-0.1, 0, 0],
	25: [0.1, 0.42, 0],
	26: [-0.1, 0.42, 0],
	27: [0.1, 0.82, 0],
	28: [-0.1, 0.82, 0],
};
function bodyFrame(i, pts, { S = 300, vis = {} } = {}) {
	const landmarks = Array(33).fill(null);
	const world = Array(33).fill(null);
	for (const [k, p] of Object.entries(pts)) {
		world[k] = p;
		landmarks[k] = [(W / 2 + p[0] * S) / W, (H / 2 + p[1] * S) / H, vis[k] ?? 0.99];
	}
	return { t: i / FPS, pose: { landmarks, world } };
}
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const R = Math.PI / 180;

// ---------------------------------------------------------------- 1. foreshortening
// The picture-left forearm (14 → 16) and hand turned θ toward the camera about the elbow, held 1 s
// at each angle: 0°, 45°, 60°, 80°.
const ANGLES = [0, 45, 60, 80];
const foreTrack = {
	width: W,
	height: H,
	frames: Array.from({ length: ANGLES.length * FPS }, (_, i) => {
		const th = ANGLES[Math.floor(i / FPS)] * R;
		const along = [0, Math.cos(th), -Math.sin(th)];
		const wrist = add(STAND[14], along, 0.25);
		const knuck = add(wrist, along, 0.08);
		return bodyFrame(i, {
			...STAND,
			16: wrist,
			18: add(knuck, [-0.01, 0, 0]),
			20: add(knuck, [0.01, 0, 0]),
		});
	}),
};
const mid = (k) => k * FPS + FPS / 2;
for (const tpl of [HALF_BODY, FULL_BODY]) {
	const rig = rigWith(tpl);
	const { solved, at } = keyed(rig, foreTrack);
	const floor = 1 - tpl.channels.find((c) => c.id === 'fore_lower_arm_l').max;
	ANGLES.forEach((deg, k) => {
		const want = Math.max(floor, Math.cos(deg * R));
		const v = valueAt(solved, 'fore_lower_arm_l', mid(k));
		ok(
			`${tpl.id}: a forearm ${deg}° toward the camera keys its shortening 1 − ${want.toFixed(2)}`,
			near(v, 1 - want, 0.03),
			String(v),
		);
		const skel = at(mid(k));
		ok(
			`${tpl.id}: …its image is ${want.toFixed(2)} of its length (runtime)`,
			near(slotScale(skel, 'lower_arm_l')[1], want, 0.03),
			String(slotScale(skel, 'lower_arm_l')[1]),
		);
		const len = -tpl.bones.find((b) => b.name === 'hand_l').y;
		ok(
			`${tpl.id}: …and the wrist comes in to ${(len * want).toFixed(0)} from the elbow (runtime)`,
			near(dist(wpos(skel, 'lower_arm_l'), wpos(skel, 'hand_l')), len * want, 4),
			String(dist(wpos(skel, 'lower_arm_l'), wpos(skel, 'hand_l'))),
		);
		ok(
			`${tpl.id}: …while the hand keeps its own width: not squashed by the forearm (runtime)`,
			near(wscale(skel, 'hand_l')[0], 1, 0.01),
			String(wscale(skel, 'hand_l')),
		);
		const handFloor = 1 - tpl.channels.find((c) => c.id === 'fore_hand_l').max;
		ok(
			`${tpl.id}: …the hand on the same line shortens with it (runtime)`,
			near(wscale(skel, 'hand_l')[1], Math.max(handFloor, Math.cos(deg * R)), 0.04),
			String(wscale(skel, 'hand_l')[1]),
		);
		ok(
			`${tpl.id}: …the other arm keeps its length`,
			near(valueAt(solved, 'fore_lower_arm_r', mid(k)) ?? 0, 0, 0.02),
			String(valueAt(solved, 'fore_lower_arm_r', mid(k))),
		);
	});
	const clip = solved.clipped.find((c) => c.channel === 'fore_lower_arm_l');
	ok(
		`${tpl.id}: past its floor the forearm is reported as shortening lost`,
		clip?.effect === 'foreshorten' && near(clip.share, 0.25, 0.05),
		JSON.stringify(clip),
	);
	if (tpl === HALF_BODY) {
		const half = solveMotion(
			{ bones: tpl.bones, channels: tpl.channels, motion: tpl.motion },
			foreTrack,
			{ depth: { foreshorten: 0.5 } },
		);
		ok(
			'the Shorten strength ½× halves it',
			near(valueAt(half, 'fore_lower_arm_l', mid(2)), 0.5 * 0.5, 0.03),
			String(valueAt(half, 'fore_lower_arm_l', mid(2))),
		);
		const off = solveMotion(
			{ bones: tpl.bones, channels: tpl.channels, motion: tpl.motion },
			foreTrack,
			{ depth: { foreshorten: 0 } },
		);
		ok(
			'Shorten off keys no shortening (the controls keep their own keys)',
			!off.channels.some((c) => c.startsWith('fore_')) && off.channels.includes('elbow_l'),
			off.channels.filter((c) => c.startsWith('fore_')).join(),
		);
	}
}

// ---------------------------------------------------------------- 2. front / behind
// The picture-left hand (pose point 16) in depth against the shoulders, frame by frame.
const SEG = [
	[24, { z: -0.12 }],
	[12, { ramp: [-0.12, 0.14], vis: 0.2 }],
	[24, { wobble: [0.04, 0.09], vis: 0.2 }],
	[12, { z: -0.2 }],
	[2, { z: 0.2 }],
	[22, { z: -0.2 }],
	[24, { z: 0.15, y: -0.85 }],
	[24, { z: -0.2 }],
];
const depthFrames = [];
for (const [n, s] of SEG)
	for (let j = 0; j < n; j++) {
		const z = s.ramp
			? s.ramp[0] + ((s.ramp[1] - s.ramp[0]) * j) / (n - 1)
			: s.wobble
				? s.wobble[Math.floor(j / 4) % 2]
				: s.z;
		const wrist = [-0.22, s.y ?? 0.03, z];
		depthFrames.push({ wrist, vis: s.vis });
	}
const depthTrack = {
	width: W,
	height: H,
	frames: depthFrames.map(({ wrist, vis }, i) =>
		bodyFrame(
			i,
			{ ...STAND, 16: wrist, 18: add(wrist, [0, 0.08, 0]), 20: add(wrist, [0.02, 0.08, 0]) },
			{ vis: vis ? { 16: vis, 18: vis, 20: vis } : {} },
		),
	),
};
const segStart = (k) => SEG.slice(0, k).reduce((s, [n]) => s + n, 0);
{
	const rig = rigWith(HALF_BODY);
	const { solved, at } = keyed(rig, depthTrack);
	const depthL = solved.keys.filter((k) => k[1] === 'depth_l');
	const steps = depthL.map((k) => k[2]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
	ok(
		'a hand behind the back, back in front, behind the head, in front again: one key per change',
		JSON.stringify(steps) === JSON.stringify([0, 2, 0, 1, 0]) && depthL.length === steps.length + 1,
		JSON.stringify(depthL),
	);
	const torso = rig.setup.indexOf('torso');
	const armSlots = HALF_BODY.channels.find((c) => c.id === 'depth_l').order.slots;
	const just = (skel, behind) => {
		const order = drawn(skel);
		const at = armSlots.map((n) => order.indexOf(n));
		return (
			at.every((x, i) => i === 0 || x === at[i - 1] + 1) &&
			at[at.length - 1] + 1 === order.indexOf(behind)
		);
	};
	const front = (skel) => drawn(skel).indexOf('upper_arm_l') > drawn(skel).indexOf('hair_front');
	ok('in front before it passes (runtime)', front(at(segStart(1) - 1)), drawn(at(10)).join());
	ok(
		'behind the back: the whole arm is drawn just behind the torso (runtime)',
		just(at(segStart(2) + 12), 'torso') && torso >= 0,
		drawn(at(segStart(2) + 12)).join(),
	);
	ok(
		'…though its depth wobbles across the margin, and the hand is hidden (visibility 0.2)',
		solved.keys.filter(
			(k) => k[1] === 'depth_l' && k[0] > segStart(2) / FPS && k[0] < segStart(3) / FPS,
		).length === 0,
	);
	ok('back in front (runtime)', front(at(segStart(3) + 6)), drawn(at(segStart(3) + 6)).join());
	ok(
		`a ${(2 / FPS).toFixed(2)} s blip behind (under ${DEPTH_HOLD} s) is not keyed (runtime)`,
		front(at(segStart(4) + 1)),
		drawn(at(segStart(4) + 1)).join(),
	);
	ok(
		'behind the head (above the shoulders): drawn just behind the head, still in front of the body (runtime)',
		just(at(segStart(6) + 12), 'head') &&
			drawn(at(segStart(6) + 12)).indexOf('upper_arm_l') >
				drawn(at(segStart(6) + 12)).indexOf('torso'),
		drawn(at(segStart(6) + 12)).join(),
	);
	ok('in front again at the end (runtime)', front(at(depthFrames.length - 1)));
	ok(
		'the other arm stays in front throughout (runtime)',
		[segStart(2) + 12, segStart(6) + 12].every(
			(i) => drawn(at(i)).indexOf('upper_arm_r') > drawn(at(i)).indexOf('hair_front'),
		),
	);
	const gapTrack = {
		...depthTrack,
		frames: depthTrack.frames.map((f, i) =>
			i >= segStart(2) + 4 && i < segStart(2) + 8
				? bodyFrame(
						i,
						Object.fromEntries(f.pose.world.map((p, k) => [k, p]).filter(([, p]) => p)),
						{ vis: { 16: 0.05 } },
					)
				: f,
		),
	};
	const gap = solveMotion(
		{ bones: HALF_BODY.bones, channels: HALF_BODY.channels, motion: HALF_BODY.motion },
		gapTrack,
	);
	ok(
		'a hand out of sight (visibility 0.05) is a gap: it holds where it was',
		JSON.stringify(gap.keys.filter((k) => k[1] === 'depth_l').map((k) => k[2])) ===
			JSON.stringify(depthL.map((k) => k[2])),
		JSON.stringify(gap.keys.filter((k) => k[1] === 'depth_l')),
	);
	const off = solveMotion(
		{ bones: HALF_BODY.bones, channels: HALF_BODY.channels, motion: HALF_BODY.motion },
		depthTrack,
		{ depth: { order: 0 } },
	);
	ok(
		'Behind off keys no draw order',
		!off.channels.includes('depth_l') && !off.channels.includes('depth_r'),
	);
}
// A performer leaning the head forward over a hand at the hip: the hand is deeper than the ears, but
// below the shoulders, so it is not behind the head (nor behind the body: level with it).
{
	const rig = rigWith(HALF_BODY);
	const lean = {
		width: W,
		height: H,
		frames: Array.from({ length: 2 * FPS }, (_, i) =>
			bodyFrame(i, {
				...STAND,
				0: [0, -0.74, -0.25],
				7: [0.07, -0.72, -0.16],
				8: [-0.07, -0.72, -0.16],
				16: [-0.22, 0.03, -0.02],
			}),
		),
	};
	const { solved, at } = keyed(rig, lean);
	ok(
		'a hand at the hip under a head leaning forward stays in front (runtime)',
		solved.keys.filter((k) => k[1] === 'depth_l').every((k) => k[2] === 0) &&
			drawn(at(FPS)).indexOf('upper_arm_l') > drawn(at(FPS)).indexOf('hair_front'),
		JSON.stringify(solved.keys.filter((k) => k[1] === 'depth_l')),
	);
}
// Both hands behind the back: each arm just behind the torso, the picture-left one first (its setup order).
{
	const rig = rigWith(HALF_BODY);
	const behind = {
		width: W,
		height: H,
		frames: Array.from({ length: 2 * FPS }, (_, i) => {
			const z = i < FPS ? -0.12 : 0.16;
			return bodyFrame(i, {
				...STAND,
				15: [0.22, 0.03, z],
				16: [-0.22, 0.03, z],
				17: [0.22, 0.11, z],
				18: [-0.22, 0.11, z],
				19: [0.24, 0.11, z],
				20: [-0.24, 0.11, z],
			});
		}),
	};
	const { at } = keyed(rig, behind);
	const order = drawn(at(FPS + 12));
	const left = order.indexOf('upper_arm_l');
	const right = order.indexOf('upper_arm_r');
	const torso = order.indexOf('torso');
	ok(
		'both arms behind the back: both just behind the torso, left then right (runtime)',
		left < right &&
			right < torso &&
			torso - left === 2 * HALF_BODY.channels.find((c) => c.id === 'depth_l').order.slots.length,
		order.join(),
	);
}
// Keyed by hand: a depth control holds to its next change across the other arm's keys.
{
	const rig = rigWith(HALF_BODY);
	const ch = (id) => HALF_BODY.channels.find((c) => c.id === id);
	const anim = {};
	F.faceKeyChannel(anim, ch('depth_r'), 2, 1, rig.has, HALF_BODY.channels, rig.setup);
	F.faceKeyChannel(anim, ch('depth_l'), 2, 0.5, rig.has, HALF_BODY.channels, rig.setup);
	F.faceKeyChannel(anim, ch('depth_r'), 0, 2, rig.has, HALF_BODY.channels, rig.setup);
	const v = (id, t) =>
		F.faceChannelValue(anim, ch(id), t, () => null, HALF_BODY.channels, rig.setup);
	ok(
		'by hand: the left arm keyed behind at 0.5 s stays behind past the right arm’s keys at 1 s and 2 s',
		v('depth_l', 0.7) === 2 &&
			v('depth_l', 1.2) === 2 &&
			v('depth_l', 2.5) === 2 &&
			v('depth_r', 1.2) === 2 &&
			v('depth_r', 2.5) === 0,
		JSON.stringify(anim.drawOrder),
	);
	const skel = play(rig, anim, 1.2);
	ok(
		'…and the runtime draws both behind the torso at 1.2 s',
		drawn(skel).indexOf('upper_arm_r') < drawn(skel).indexOf('torso') &&
			drawn(skel).indexOf('upper_arm_l') < drawn(skel).indexOf('torso'),
		drawn(skel).join(),
	);
}

// ---------------------------------------------------------------- 3. the head
function headMatrix(yaw, pitch, far = 50) {
	const front = [
		Math.sin(yaw * R) * Math.cos(pitch * R),
		Math.sin(pitch * R),
		Math.cos(yaw * R) * Math.cos(pitch * R),
	];
	const right = [Math.cos(yaw * R), 0, -Math.sin(yaw * R)];
	const up = [
		front[1] * right[2] - front[2] * right[1],
		front[2] * right[0] - front[0] * right[2],
		front[0] * right[1] - front[1] * right[0],
	];
	return [...right, 0, ...up, 0, ...front, 0, 0, 0, -far, 1];
}
const SWEEP = [0, 10, 20, 40, -10, -40];
const headTrack = {
	width: W,
	height: H,
	frames: Array.from({ length: SWEEP.length * FPS }, (_, i) => {
		const deg = SWEEP[Math.floor(i / FPS)];
		const lm = Array(478).fill(null);
		lm[33] = [0.45, 0.4];
		lm[263] = [0.55, 0.4];
		lm[1] = [0.5, 0.45];
		return { t: i / FPS, face: { landmarks: lm, blend: {}, matrix: headMatrix(deg, deg / 2) } };
	}),
};
{
	const rig = rigWith(BUST_FACE);
	const { solved, at } = keyed(rig, headTrack);
	const per = (id, b, p) =>
		BUST_FACE.channels.find((c) => c.id === id).drives.find((d) => d.bone === b && d.prop === p)
			.per;
	SWEEP.forEach((deg, k) => {
		const turn = Math.max(-1, Math.min(1, deg / 25));
		const nod = Math.max(-1, Math.min(1, deg / 2 / 15));
		const skel = at(mid(k));
		const fx = bone(skel, 'face').x - bone(skel, 'face').data.x;
		const fy = bone(skel, 'face').y - bone(skel, 'face').data.y;
		const hb = bone(skel, 'hair_back').x - bone(skel, 'hair_back').data.x;
		ok(
			`head turned ${deg}° and nodded ${deg / 2}°: the face slides ${(turn * per('head_turn', 'face', 'x')).toFixed(1)} across and ${(nod * per('head_pitch', 'face', 'y')).toFixed(1)} up (runtime)`,
			near(fx, turn * per('head_turn', 'face', 'x'), 0.4) &&
				near(fy, nod * per('head_pitch', 'face', 'y'), 0.4),
			`${fx} ${fy}`,
		);
		ok(
			`…the back hair the other way (runtime)`,
			deg === 0
				? near(hb, 0, 0.3)
				: Math.sign(hb) === -Math.sign(deg) &&
						near(hb, turn * per('head_turn', 'hair_back', 'x'), 0.4),
			String(hb),
		);
	});
	const still = solveMotion(
		{ bones: BUST_FACE.bones, channels: BUST_FACE.channels, motion: BUST_FACE.motion },
		{
			...headTrack,
			frames: headTrack.frames.map((f, i) => ({
				...f,
				face: { ...f.face, matrix: headMatrix(0, 0, i < FPS ? 50 : 45) },
			})),
		},
		{ depth: { approach: 0 } },
	);
	ok(
		'Nearer off keys no scale on the bust either',
		!still.channels.includes('approach') && still.channels.includes('head_turn'),
		still.channels.join(),
	);
	// A performer whose resting head is already turned 10° reads that as rest, as the face does.
	const turnedRest = solveMotion(
		{ bones: BUST_FACE.bones, channels: BUST_FACE.channels, motion: BUST_FACE.motion },
		{
			...headTrack,
			frames: headTrack.frames
				.slice(0, 2 * FPS)
				.map((f) => ({ ...f, face: { ...f.face, matrix: headMatrix(10, 4) } })),
		},
		{ trace: true },
	);
	ok(
		'a head resting turned 10° and nodded 4° reads as rest (against the neutral)',
		turnedRest.stages.head_turn.keyed.every((v) => Math.abs(v) < 0.01) &&
			turnedRest.stages.head_pitch.keyed.every((v) => Math.abs(v) < 0.01),
		`${Math.max(...turnedRest.stages.head_turn.keyed)} ${Math.max(...turnedRest.stages.head_pitch.keyed)}`,
	);
	const turnClip = solved.clipped.find((c) => c.channel === 'head_turn');
	ok(
		'past 25° the turn is held at ±1 and reported',
		near(turnClip?.share ?? 0, 2 / SWEEP.length, 0.04),
		JSON.stringify(solved.clipped),
	);
}

// ---------------------------------------------------------------- 4. the torso
const TURNS = [0, 20, 40, 70, -40];
const turned = (deg) => {
	const c = Math.cos(deg * R);
	const s = Math.sin(deg * R);
	// Turned about the spine: x goes to x cos, depth to x sin (the picture-right side goes back).
	const spin = (p) => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
	return Object.fromEntries(Object.entries(STAND).map(([k, p]) => [k, spin(p)]));
};
const turnTrack = {
	width: W,
	height: H,
	frames: Array.from({ length: TURNS.length * FPS }, (_, i) =>
		bodyFrame(i, turned(TURNS[Math.floor(i / FPS)])),
	),
};
for (const tpl of [HALF_BODY, FULL_BODY]) {
	const full = rigWith(tpl);
	const plain = rigWith(tpl, ['torso_3q_l', 'torso_3q_r', 'torso_side_l', 'torso_side_r']);
	const a = keyed(full, turnTrack);
	const b = keyed(plain, turnTrack);
	const want = ['torso', 'torso', 'torso_3q_r', 'torso_side_r', 'torso_3q_l'];
	const [la, ra] =
		tpl === HALF_BODY ? ['upper_arm_l', 'upper_arm_r'] : ['upper_arm_l', 'upper_arm_r'];
	const span = Math.abs(
		2 *
			tpl.bones
				.filter(
					(x) =>
						['clavicle_r', 'upper_arm_r'].includes(x.name) ||
						(tpl === FULL_BODY && x.name === 'upper_arm_r'),
				)
				.reduce((s, x) => s + x.x, 0),
	);
	TURNS.forEach((deg, k) => {
		const skel = a.at(mid(k));
		ok(
			`${tpl.id}: a body turned ${deg}° shows ${want[k]} (runtime)`,
			shown(skel, 'torso') === want[k],
			String(shown(skel, 'torso')),
		);
		ok(
			`${tpl.id}: …and the front torso on art without ¾ or side images (runtime)`,
			shown(b.at(mid(k)), 'torso') === 'torso',
			String(shown(b.at(mid(k)), 'torso')),
		);
		const w = Math.min(0.6, 1 - Math.cos(deg * R));
		ok(
			`${tpl.id}: …its shoulders come in to ${(span * (1 - w)).toFixed(0)} apart, the torso narrows (runtime)`,
			near(dist(wpos(skel, la), wpos(skel, ra)), span * (1 - w), 4) &&
				near(slotScale(skel, 'torso')[0], 1 - 0.5 * w, 0.03),
			`${dist(wpos(skel, la), wpos(skel, ra))} ${slotScale(skel, 'torso')[0]}`,
		);
	});
	const clip = a.solved.clipped.find((c) => c.channel === 'turn_width');
	ok(
		`${tpl.id}: turned 70°, past the side-on limit, is reported`,
		clip?.effect === 'turn' && near(clip.share, 1 / TURNS.length, 0.04),
		JSON.stringify(a.solved.clipped),
	);
}

// ---------------------------------------------------------------- 5. the distance
{
	const rig = rigWith(HALF_BODY);
	const track = {
		width: W,
		height: H,
		frames: Array.from({ length: 3 * FPS }, (_, i) =>
			bodyFrame(i, STAND, { S: i < 2 * FPS ? 300 : 330 }),
		),
	};
	const { solved, at } = keyed(rig, track);
	ok(
		'a performer 10% nearer scales the whole character 10% (runtime)',
		near(bone(at(mid(2)), 'root').scaleX, 1.1, 0.01) &&
			near(bone(at(mid(2)), 'root').scaleY, 1.1, 0.01) &&
			near(bone(at(mid(0)), 'root').scaleY, 1, 0.005),
		`${bone(at(mid(2)), 'root').scaleY}`,
	);
	const off = solveMotion(
		{ bones: HALF_BODY.bones, channels: HALF_BODY.channels, motion: HALF_BODY.motion },
		track,
		{ depth: { approach: 0 } },
	);
	ok(
		'Nearer off keys no scale',
		!off.channels.includes('approach') && solved.channels.includes('approach'),
	);
}

console.log(
	`\nmotion depth: ${fails ? `${fails} of ${checks} checks failed` : `${checks}/${checks} checks pass`}`,
);
process.exit(fails ? 1 : 0);
