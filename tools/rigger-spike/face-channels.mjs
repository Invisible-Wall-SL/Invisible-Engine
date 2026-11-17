// Verify the Face panel's keying headlessly, on the SHIPPED code: the `face*` helpers (and the key
// helpers they use) are pulled out of view.html, the rig is the real `bust-face` template built by
// the server's `templateRig`, and every result is played through the official engine-rig loader and
// AnimationState — so what the Rigger writes is checked as the GAME poses it, not as the Rigger reads
// it back. Asserted:
//  - every channel reads back the value it keyed, at that time (drives and swaps);
//  - two channels on one bone (gaze x, gaze y) keep each other's axis;
//  - the runtime poses each drive as `value × per` from setup (scaleY as `1 + value × per`), and
//    shows each swap's image;
//  - a swap step whose image the rig lacks is skipped, never keyed;
//  - Blink, Idle blinks (loops: ends open at the clip's length) and Talk (the template's order,
//    only shapes the rig has, jaw opened per shape, ending on rest) key what they say.
//   node tools/rigger-spike/face-channels.mjs
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

const out = join(mkdtempSync(join(tmpdir(), 'face-channels-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { BUST_FACE, templateRig } = await import(pathToFileURL(out).href);

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
		...[
			'roundN',
			'FACE_TIMELINE',
			'FACE_BLINK',
			'FACE_IDLE_GAPS',
			'FACE_TALK_STEP',
			'faceClamp',
		].map(grabConst),
		...[
			'bezierValue',
			'sampleChannel',
			'upsertKey',
			'faceSwapPart',
			'faceAttachmentAt',
			'faceKeyAttachment',
			'faceChannelValue',
			'faceKeyChannel',
			'faceKeyShape',
			'faceKeyBlink',
			'faceKeyIdleBlinks',
			'faceKeyTalk',
			'faceAddStarterClips',
		].map(grabFn),
		'return { faceChannelValue, faceKeyChannel, faceKeyShape, faceKeyBlink, faceKeyIdleBlinks, faceKeyTalk, faceAddStarterClips };',
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
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
// The runtime switches an attachment AT its key time by a float compare, so a key is sampled just after.
const EDGE = 0.005;

const channels = BUST_FACE.channels;
const chan = (id) => channels.find((c) => c.id === id);
const regionsFor = (skip = []) =>
	BUST_FACE.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));

function rigWith(skip = []) {
	const regions = regionsFor(skip);
	const { skeleton } = templateRig(BUST_FACE, regions);
	const names = new Set(regions.map((r) => r.name));
	const has = (slot, part) => names.has(part) && !!skeleton.skins[0].attachments[slot]?.[part];
	const setupOf = (slot) => skeleton.slots.find((s) => s.name === slot)?.attachment ?? null;
	const lines = ['page.png', 'size:4096,256', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return { skeleton, has, setupOf, atlas: lines.join('\n') + '\n' };
}

// Pose `anim` at t through the runtime; returns the posed skeleton and its setup data.
function play(rig, anim, t) {
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const doc = { ...rig.skeleton, animations: { face: anim } };
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(doc)),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, 'face', false);
	state.update(t);
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	return { skel, data };
}
const boneOff = (p, bone, prop) => {
	const b = p.skel.findBone(bone);
	const d = b.data;
	return prop === 'rotate'
		? b.rotation - d.rotation
		: prop === 'scaleY'
			? b.scaleY / d.scaleY
			: b[prop] - d[prop];
};
const shown = (p, slot) => p.skel.findSlot(slot).getAttachment()?.name ?? null;

// 1. Every channel round-trips and poses as the template says, at two times.
{
	const rig = rigWith();
	for (const ch of channels.filter((c) => !c.shapes)) {
		const anim = {};
		const vals = ch.swaps ? ch.swaps.map((w) => w.at) : [ch.min, (ch.min + ch.max) * 0.37, ch.max];
		vals.forEach((v, i) => F.faceKeyChannel(anim, ch, v, i * 0.5, rig.has));
		vals.forEach((v, i) => {
			const t = i * 0.5;
			ok(
				`${ch.id} reads back ${v} at ${t}s`,
				near(F.faceChannelValue(anim, ch, t, rig.setupOf), v, 0.01),
				String(F.faceChannelValue(anim, ch, t, rig.setupOf)),
			);
			const p = play(rig, anim, t);
			for (const d of ch.drives ?? []) {
				const want = d.prop === 'scaleY' ? 1 + v * d.per : v * d.per;
				ok(
					`${ch.id} poses ${d.bone}.${d.prop} = ${want.toFixed(3)} at ${t}s (runtime)`,
					near(boneOff(p, d.bone, d.prop), want, 0.02),
					String(boneOff(p, d.bone, d.prop)),
				);
			}
			if (ch.swaps) {
				const want = [...ch.swaps].reverse().find((w) => w.at <= v + 1e-9).part;
				ok(
					`${ch.id} shows ${want} at ${t}s (runtime)`,
					shown(p, ch.slot) === want,
					String(shown(p, ch.slot)),
				);
			}
		});
	}
}

// 2. Gaze x and y share the pupils' translate timeline; neither erases the other.
{
	const rig = rigWith();
	const anim = {};
	F.faceKeyChannel(anim, chan('gaze_x'), 0.5, 1, rig.has);
	F.faceKeyChannel(anim, chan('gaze_y'), -1, 1, rig.has);
	const p = play(rig, anim, 1);
	ok(
		'gaze x and y both land on pupil_l',
		near(boneOff(p, 'pupil_l', 'x'), 5) && near(boneOff(p, 'pupil_l', 'y'), -6),
		`${boneOff(p, 'pupil_l', 'x')}, ${boneOff(p, 'pupil_l', 'y')}`,
	);
	ok(
		'gaze x and y both land on pupil_r',
		near(boneOff(p, 'pupil_r', 'x'), 5) && near(boneOff(p, 'pupil_r', 'y'), -6),
	);
}

// 3. A missing half eyelid is skipped: half-closed stays open, never names the missing image.
{
	const rig = rigWith(['eyelid_l_half']);
	const anim = {};
	F.faceKeyChannel(anim, chan('blink_l'), 0.5, 0, rig.has);
	F.faceKeyChannel(anim, chan('blink_l'), 1, 1, rig.has);
	ok('a missing step is never keyed', !JSON.stringify(anim).includes('eyelid_l_half'));
	ok(
		'half-closed without the image stays open (runtime)',
		shown(play(rig, anim, 0), 'eyelid_l') === null,
	);
	ok('closed still closes (runtime)', shown(play(rig, anim, 1), 'eyelid_l') === 'eyelid_l_closed');
}

// 4. Blink: open → half → closed → half → open, both eyes, from the playhead.
{
	const rig = rigWith();
	const anim = {};
	F.faceKeyBlink(anim, 1, channels, rig.has);
	const seq = [
		[1, null],
		[1.04, 'half'],
		[1.08, 'closed'],
		[1.14, 'half'],
		[1.2, null],
	];
	for (const [t, s] of seq)
		for (const side of ['l', 'r']) {
			const want = s && `eyelid_${side}_${s}`;
			ok(
				`blink: eyelid_${side} at ${t}s is ${want} (runtime)`,
				shown(play(rig, anim, t + EDGE), `eyelid_${side}`) === want,
			);
		}
}

// 5. Idle blinks over 6 s: the fixed rhythm, and the clip is exactly 6 s long so it loops.
{
	const rig = rigWith();
	const anim = {};
	const starts = F.faceKeyIdleBlinks(anim, 6, channels, rig.has);
	ok(
		'idle blinks start at 0.7 s and 3.3 s',
		JSON.stringify(starts) === '[0.7,3.3]',
		JSON.stringify(starts),
	);
	const { data } = play(rig, anim, 0);
	ok(
		'the idle clip is 6 s long (runtime duration)',
		near(data.findAnimation('face').duration, 6),
		String(data.findAnimation('face').duration),
	);
	ok('eyes are open at the loop point (runtime)', shown(play(rig, anim, 6), 'eyelid_l') === null);
	ok(
		'eyes are closed mid-blink (runtime)',
		shown(play(rig, anim, 3.38 + EDGE), 'eyelid_r') === 'eyelid_r_closed',
	);
}

// 6. Talk: the template's order, shapes the rig has, jaw per shape, rest at the end.
{
	const rig = rigWith(['mouth_E']);
	const mouth = chan('mouth');
	const anim = {};
	const n = F.faceKeyTalk(anim, mouth, 0, 2, channels, rig.has);
	// Each shape is held a full step and the last one must end by 2 s: frames at 0 … 1.80 s.
	ok('talk keys 16 shapes over 2 s', n === 16, String(n));
	const keyed = anim.slots.mouth.attachment.map((k) => k.name);
	const order = mouth.shapes.talk.filter((p) => p !== 'mouth_E');
	ok(
		'talk follows the template order, skipping a shape the rig lacks',
		keyed.slice(0, order.length).join() === order.join() && !keyed.includes('mouth_E'),
		keyed.join(),
	);
	ok('talk ends on the rest shape', keyed[keyed.length - 1] === 'mouth_rest');
	for (const [t, part] of [
		[0, 'mouth_A'],
		[0.12, 'mouth_O'],
		[0.24, 'mouth_MBP'],
		[2, 'mouth_rest'],
	]) {
		const p = play(rig, anim, t + EDGE);
		ok(
			`talk at ${t}s shows ${part} (runtime)`,
			shown(p, 'mouth') === part,
			String(shown(p, 'mouth')),
		);
		ok(
			`talk at ${t}s opens the jaw for ${part} (runtime)`,
			near(boneOff(play(rig, anim, t), 'jaw', 'y'), -14 * mouth.shapes.open[part]),
			String(boneOff(play(rig, anim, t), 'jaw', 'y')),
		);
	}
	const none = {};
	ok(
		'talk on a rig with no talk shapes keys nothing',
		F.faceKeyTalk(none, mouth, 0, 2, channels, () => false) === 0 && !none.slots,
	);
}

// 7. A mouth shape button keys the shape and the jaw at one time.
{
	const rig = rigWith();
	const anim = {};
	F.faceKeyShape(anim, chan('mouth'), 'mouth_wide', 0.5, channels, rig.has);
	const p = play(rig, anim, 0.5);
	ok(
		'a shape shows its image and opens its jaw (runtime)',
		shown(p, 'mouth') === 'mouth_wide' && near(boneOff(p, 'jaw', 'y'), -14 * 0.6),
	);
}

// 8. Starter clips (T3): each plays under the runtime, lasts its length, and starts and ends with
// every face bone at setup, the mouth at rest and the eyes open — on full art and on the required
// parts only, where no attachment key may name an image the rig lacks.
const REST_BONES = [
	['jaw', 'y'],
	['brow_l', 'y'],
	['brow_r', 'y'],
	['pupil_l', 'x'],
	['pupil_l', 'y'],
	['pupil_r', 'x'],
	['pupil_r', 'y'],
	['head', 'rotate'],
	['neck', 'rotate'],
	['face', 'x'],
];
const required = BUST_FACE.parts.filter((p) => !p.required).map((p) => p.name);
for (const [label, skip] of [
	['full art', []],
	['required parts only', required],
]) {
	const rig = rigWith(skip);
	const animations = {};
	const r = F.faceAddStarterClips(animations, BUST_FACE, rig.has);
	ok(
		`${label}: every starter clip is added`,
		r.added.join() === BUST_FACE.clips.map((c) => c.name).join() && !r.kept.length,
		r.added.join(),
	);
	const named = new Set(
		Object.values(animations).flatMap((a) =>
			Object.values(a.slots ?? {}).flatMap((s) =>
				(s.attachment ?? []).map((k) => k.name).filter(Boolean),
			),
		),
	);
	ok(
		`${label}: clips swap only to images the rig has`,
		[...named].every((n) => !skip.includes(n)),
		[...named].filter((n) => skip.includes(n)).join(),
	);
	for (const c of BUST_FACE.clips) {
		const run = (t) => {
			const atlas = new TextureAtlas(rig.atlas);
			for (const pg of atlas.pages)
				pg.setTexture({
					getImage: () => ({ width: 1, height: 1 }),
					setFilters() {},
					setWraps() {},
					dispose() {},
				});
			const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
				JSON.parse(JSON.stringify({ ...rig.skeleton, animations })),
			);
			const skel = new Skeleton(data);
			const state = new AnimationState(new AnimationStateData(data));
			state.setAnimation(0, c.name, false);
			state.update(t);
			state.apply(skel);
			skel.updateWorldTransform(Physics.update);
			return { skel, data };
		};
		const start = run(0);
		ok(
			`${label} ${c.name}: lasts ${c.length} s (runtime)`,
			near(start.data.findAnimation(c.name).duration, c.length),
			String(start.data.findAnimation(c.name).duration),
		);
		// The runtime stores key times as float32 (0.2 → 0.2000000029) and clamps a finished clip to that
		// end, so the held end pose is read just past the length, as the game reaches it.
		for (const [when, p] of [
			['start', start],
			['end', run(c.length + EDGE)],
		]) {
			const off = REST_BONES.filter(([b, prop]) => !near(boneOff(p, b, prop), 0, 0.01)).map(
				([b, prop]) => `${b}.${prop}=${boneOff(p, b, prop).toFixed(2)}`,
			);
			ok(
				`${label} ${c.name}: every face bone at setup at the ${when} (runtime)`,
				!off.length && near(boneOff(p, 'chest', 'scaleY'), 1, 1e-3),
				off.join(' '),
			);
			ok(
				`${label} ${c.name}: mouth at rest, eyes open at the ${when} (runtime)`,
				shown(p, 'mouth') === 'mouth_rest' &&
					shown(p, 'eyelid_l') === null &&
					shown(p, 'eyelid_r') === null,
				`${shown(p, 'mouth')} ${shown(p, 'eyelid_l')}`,
			);
		}
	}
	if (label === 'full art') {
		const p = play(rig, animations.win_big, 0.3);
		ok(
			'win_big tilts the head 5° at 0.3 s (runtime)',
			near(boneOff(p, 'head', 'rotate'), 5, 0.01),
			String(boneOff(p, 'head', 'rotate')),
		);
	} else {
		ok(
			'a missing smile falls back to the rest shape (nearest jaw opening)',
			shown(play(rig, animations.happy, 0.5), 'mouth') === 'mouth_rest',
		);
		ok(
			'a missing wide mouth falls back to O (nearest jaw opening)',
			shown(play(rig, animations.win_big, 0.1 + EDGE), 'mouth') === 'mouth_O',
		);
	}
}
{
	const rig = rigWith();
	const mine = { idle: { bones: { head: { rotate: [{ time: 0, value: 9 }] } } } };
	const before = JSON.stringify(mine.idle);
	const r = F.faceAddStarterClips(mine, BUST_FACE, rig.has);
	ok(
		'an animation the rig already has is kept, not overwritten',
		r.kept.join() === 'idle' && JSON.stringify(mine.idle) === before && !r.added.includes('idle'),
	);
}

if (fails) {
	console.error(`face channels: ${fails} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`face channels: ${checks}/${checks} checks pass`);
