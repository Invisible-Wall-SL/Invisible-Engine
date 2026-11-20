// How much of a real performance survives the motion import, stage by stage (rig templates T5,
// docs/design/rig-templates.md §5.3), on the SHIPPED code: `solveMotion` (with its trace) over real
// MediaPipe output of two filmed faces (`motion-amplitude.fixture.json`: a talking head, public
// domain, and an expressive shot of Tears of Steel, CC BY), keyed by the page's `faceKeyMotion`
// pulled out of view.html and posed by engine-rig — so each amount is the one the GAME shows. No
// MediaPipe and no network. Printed: every control's swing (5th to 95th percentile) at each stage —
// the tracked reading, scaled by its gains, clamped to its range, smoothed, keyed, and posed in rig
// units. Asserted, on bust-face unless named:
//  - smoothing keeps at least 85% of every control's swing (what it takes off is the tracker's
//    jitter), and the keys 95% of the smoothed one;
//  - every turning point of the smoothed curve is a key (a peak is never cut off by the reduction);
//  - every blink the performer makes closes the eyelid, and the eyes rest open between blinks
//    (they are read against the performer's neutral, not against zero);
//  - at game size the talk reads: the jaw, brows, gaze, mouth corners, lips and lids travel at least
//    the amounts below, and the mouth image leaves rest on a good share of the talking frames — each
//    floor sits between what the solve before this one gave on the same frames (in brackets, on
//    the bust's first version, since removed) and what it gives now;
//  - the expressive shot, whose actor's open eyes and resting head already score high: the eyes rest
//    open (they never did before: half-closed or closed on every frame), the tilt is not pinned at
//    its edge (it was on 99% of the frames), the inner brows lift and a brow image at its end shows.
//   node tools/rigger-spike/motion-amplitude.mjs
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
const dir = mkdtempSync(join(tmpdir(), 'motion-amplitude-'));
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
const { BUST_FACE, templateRig } = await bundle('src/lib/server/rigTemplates.ts', 'templates.mjs');
const { solveMotion, turningPoints, FACE_BLENDSHAPES } = await bundle(
	'src/lib/rigMotion.ts',
	'motion.mjs',
);

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
			'faceKeyAttachment',
			'faceKeyChannel',
			'faceShapePart',
			'faceShapeControls',
			'faceKeyShape',
			'faceKeyMotion',
		].map(grabFn),
		'return { faceKeyMotion };',
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

// ---------------------------------------------------------------- the fixture, as MediaPipe answered
const fixture = JSON.parse(
	readFileSync(fileURLToPath(new URL('motion-amplitude.fixture.json', import.meta.url)), 'utf8'),
);
ok(
	'the fixture names the blendshapes the solve reads, in order',
	JSON.stringify(fixture.blendshapes) === JSON.stringify(FACE_BLENDSHAPES),
);
function trackOf(clip) {
	return {
		width: clip.width,
		height: clip.height,
		frames: clip.frames.map(([t, scores, pts, matrix]) => {
			if (!scores) return { t, face: null };
			const landmarks = Array(478).fill(null);
			fixture.points.forEach((i, k) => (landmarks[i] = pts[k]));
			return {
				t,
				face: {
					landmarks,
					blend: Object.fromEntries(fixture.blendshapes.map((n, k) => [n, scores[k]])),
					...(matrix ? { matrix } : {}),
				},
			};
		}),
	};
}

// ---------------------------------------------------------------- solve, key and pose
function rigFor(tpl) {
	const regions = tpl.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = templateRig(tpl, regions);
	const lines = ['page.png', 'size:4096,256', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	const atlas = new RIG.TextureAtlas(lines.join('\n') + '\n');
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const has = (slot, part) => !!skeleton.skins[0].attachments[slot]?.[part];
	return { skeleton, atlas, has };
}
function run(tpl, clip, opts = {}) {
	const track = trackOf(clip);
	const solved = solveMotion(tpl, track, {
		face: true,
		body: false,
		trace: true,
		neutral: clip.neutral,
		...opts,
	});
	const rig = rigFor(tpl);
	const anim = {};
	F.faceKeyMotion(anim, solved.keys, 0, tpl.channels, rig.has);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(rig.atlas)).readSkeletonData(
		JSON.parse(JSON.stringify({ ...rig.skeleton, animations: { take: anim } })),
	);
	const skel = new RIG.Skeleton(data);
	const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
	state.setAnimation(0, 'take', false);
	const t0 = track.frames[0].t;
	let last = 0;
	const poses = track.frames.map((f) => {
		const t = f.t - t0 + 0.005;
		state.update(t - last);
		last = t;
		skel.setToSetupPose();
		state.apply(skel);
		skel.updateWorldTransform(RIG.Physics.update);
		const bones = {};
		for (const b of skel.bones)
			bones[b.data.name] = {
				x: b.x - b.data.x,
				y: b.y - b.data.y,
				rotate: b.rotation - b.data.rotation,
			};
		const slots = {};
		for (const s of skel.slots) slots[s.data.name] = s.getAttachment()?.name ?? null;
		return { bones, slots };
	});
	const seen = track.frames.map((f) => !!f.face);
	return { tpl, track, solved, poses, seen };
}

const pct = (xs, p) => {
	const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))] : NaN;
};
const swing = (xs) => pct(xs, 0.95) - pct(xs, 0.05);
const onSeen = (r, xs) => xs.filter((_, i) => r.seen[i]);
/** A control's own bone travel in rig units, frame by frame (its first drive). */
const posed = (r, id) => {
	const d = r.tpl.channels.find((c) => c.id === id).drives[0];
	return onSeen(
		r,
		r.poses.map((p) => p.bones[d.bone][d.prop === 'rotate' ? 'rotate' : d.prop]),
	);
};
const travel = (r, id) => swing(posed(r, id));
const peakOf = (r, id) => Math.max(...posed(r, id).map(Math.abs));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');

function table(r, label) {
	console.log(
		`\n${label}: ${r.tpl.id} v${r.tpl.version}, ${r.track.frames.length} frames, ${r.seen.filter(Boolean).length} with a face, neutral ${JSON.stringify(r.solved.neutral)}`,
	);
	console.log('control       raw    scaled clamped smoothed keyed  (keys)  posed');
	for (const ch of r.tpl.channels) {
		const st = r.solved.stages[ch.id];
		if (!st) continue;
		const d = ch.drives?.[0];
		const unit = d ? (d.prop === 'rotate' ? '°' : ' u') : '';
		const row = [st.raw, st.scaled, st.clamped, st.smoothed, st.keyed].map((s) =>
			f2(swing(onSeen(r, s))).padStart(6),
		);
		const keys = r.solved.keys.filter((k) => k[1] === ch.id).length;
		console.log(
			`${ch.id.padEnd(12)} ${row.join(' ')}  (${String(keys).padStart(4)})  ${d ? f2(travel(r, ch.id)) + unit : ''}`,
		);
	}
	const mouth = onSeen(
		r,
		r.poses.map((p) => p.slots.mouth),
	);
	const away = mouth.filter((m) => m !== 'mouth_rest').length / mouth.length;
	console.log(
		`mouth image off rest on ${Math.round(away * 100)}% of the frames; ${r.solved.keys.length} keys`,
	);
	return away;
}

// ---------------------------------------------------------------- the talking head (bust-face)
const talk = run(BUST_FACE, fixture.clips.talk);
const talkAway = table(talk, 'talk');
const tolOf = (ch) => 0.02 * (ch.max - ch.min);
for (const ch of BUST_FACE.channels) {
	const st = talk.solved.stages[ch.id];
	if (!st) continue;
	const clamped = swing(onSeen(talk, st.clamped));
	if (!(clamped > 0.1 * (ch.max - ch.min))) continue;
	const smoothed = swing(onSeen(talk, st.smoothed));
	const keyed = swing(onSeen(talk, st.keyed));
	ok(
		`${ch.id}: the smoothing keeps 85% of the swing`,
		smoothed >= 0.85 * clamped,
		`${f2(clamped)} → ${f2(smoothed)}`,
	);
	ok(
		`${ch.id}: the keys keep 95% of the smoothed swing`,
		keyed >= 0.95 * smoothed,
		`${f2(smoothed)} → ${f2(keyed)}`,
	);
	if (ch.swaps && !ch.drives?.length) continue;
	const missed = turningPoints(st.smoothed, tolOf(ch)).filter(
		(i) => Math.abs(st.keyed[i] - st.smoothed[i]) > 1e-3,
	);
	ok(
		`${ch.id}: every turning point is a key`,
		missed.length === 0,
		`${missed.length} missed, e.g. frame ${missed[0]}`,
	);
}

// Blinks: every one the performer makes (the picture-left eye is the performer's right) closes the lid.
{
	const NEUTRAL = talk.solved.neutral;
	const score = (f) => f.face?.blend.eyeBlinkRight ?? null;
	const frames = talk.track.frames;
	const rest = pct(
		frames.filter((f) => f.face && f.t >= NEUTRAL[0] - 1e-9 && f.t <= NEUTRAL[1] + 1e-9).map(score),
		0.5,
	);
	const episodes = [];
	let open = null;
	frames.forEach((f, i) => {
		const shut = score(f) !== null && score(f) - rest >= 0.35;
		if (shut && open === null) open = i;
		if (!shut && open !== null) {
			episodes.push([open, i - 1]);
			open = null;
		}
	});
	const closes = episodes.filter(([a, b]) =>
		talk.poses.slice(Math.max(0, a - 1), b + 2).some((p) => p.slots.eyelid_l === 'eyelid_l_closed'),
	);
	ok('the performance has blinks to check', episodes.length >= 5, String(episodes.length));
	ok(
		'every blink closes the eyelid',
		closes.length === episodes.length,
		`${closes.length} of ${episodes.length}`,
	);
	const resting = frames
		.map((f, i) => [f, i])
		.filter(([f]) => score(f) !== null && score(f) - rest < 0.1)
		.map(([, i]) => i);
	const openShare =
		resting.filter((i) => talk.poses[i].slots.eyelid_l === null).length / resting.length;
	ok(
		'between blinks the eyes rest open',
		openShare >= 0.95,
		`${Math.round(openShare * 100)}% open`,
	);
}

// At game size: how far the face travels in rig units (bust-face's head is 260 × 300).
for (const [id, least, before] of [
	['jaw', 6, '3.1'],
	['brow_l', 15, '6.8'],
	['gaze_x', 8, '5.2'],
	['smile_r', 4, 'none'],
	['lip_lower', 5, 'none'],
	['squint_l', 5, 'none'],
	['head_turn', 5.5, '3.6'],
	['blink_l', 25, 'none: an image swap'],
])
	ok(
		`talk: ${id} travels at least ${least} (${before})`,
		travel(talk, id) >= least,
		f2(travel(talk, id)),
	);
ok(
	'talk: the jaw drops at least 14 at its widest (5.5)',
	peakOf(talk, 'jaw') >= 14,
	f2(peakOf(talk, 'jaw')),
);
ok(
	'talk: the mouth image leaves rest on at least 32% of the frames (22%)',
	talkAway >= 0.32,
	f2(talkAway),
);

// The report counts only what went past the far edge: a jaw more closed than the neutral is rest.
{
	const jaw = talk.solved.clipped.find((c) => c.channel === 'jaw');
	ok(
		'talk: a jaw held at rest is not reported as past its range',
		!jaw || jaw.share <= 0.05,
		JSON.stringify(jaw),
	);
}

// ---------------------------------------------------------------- the expressive shot
{
	const r = run(BUST_FACE, fixture.clips.expressive);
	table(r, 'expressive');
	for (const side of ['l', 'r']) {
		const lids = onSeen(
			r,
			r.poses.map((p) => p.slots[`eyelid_${side}`]),
		);
		const open = lids.filter((x) => x === null).length / lids.length;
		ok(`expressive: eyelid_${side} rests open on most frames (0%)`, open >= 0.6, f2(open));
	}
	const tilt = r.tpl.channels.find((c) => c.id === 'head_tilt');
	const pinned = posed(r, 'head_tilt').filter((v) => Math.abs(v) >= tilt.max - 1e-3).length;
	ok('expressive: the tilt is never pinned at its edge (99%)', pinned === 0, String(pinned));
	ok(
		'expressive: the inner brows lift at least 4 at their highest',
		peakOf(r, 'brow_in_l') >= 4,
		f2(peakOf(r, 'brow_in_l')),
	);
	const ends = onSeen(
		r,
		r.poses.map((p) => p.slots.brow_l),
	).filter((s) => s !== 'brow_l_neutral').length;
	ok('expressive: a brow image at its end shows', ends > 0, String(ends));
}

console.log(`\nmotion amplitude: ${checks - fails}/${checks} checks pass`);
if (fails) process.exit(1);
