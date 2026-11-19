// Verify the Half body rig template (`half-body`) headlessly, on the SHIPPED code: the template and
// its motion map are the real `HALF_BODY`, the rigs are built by the server's `templateRig`, the keys
// are written by the Controls section's helpers pulled out of view.html, the solve is
// `src/lib/rigMotion.ts` + `rigMotionHand.ts`, and every result is posed by engine-rig's loader and
// AnimationState — so what the Rigger writes is checked as the GAME plays it. Asserted:
//  - every control keys, reads back and poses as the template says (a hand curl through the fingers
//    and thumb it sets), on full art; a hand pose hides that hand's fifteen finger images and the
//    finger rig shows them again, and a pose the art lacks falls back to the finger rig;
//  - a curl folds the finger toward its knuckle, a spread fans index and pinky apart, the thumb folds
//    across the palm or sticks out;
//  - every starter clip plays on full art, needed-only art and finger-segments-without-poses art,
//    lasts its length, and starts and ends at rest (finger images shown); wave raises the hand by the
//    head, point keeps the index straight with the others curled, thumbs up puts the thumb above the
//    wrist, a fist pump closes the hand above the shoulder;
//  - hands from fixed Hand Landmarker fixtures: a finger's curl follows its joints' flexion (in 3D:
//    a curl toward the camera reads in full), the thumb sticks out, the fingers spread; hands go to
//    the side of the nearer body wrist whatever their handedness says, by picture order without a
//    body, by handedness alone for one hand; a hand out of sight holds its pose; the wrist bend
//    comes from the body's knuckle points; nothing hand-tracked is keyed when hands are off;
//  - the face is Bust with face's face block: every face control poses on Half body as on the bust,
//    the face sits on the head where it sits on the bust, the mouth buttons, lip-sync, talk and
//    blink key the half-body mouth and lids, a hand pose leaves every face image alone, and one
//    solve keys the face (jaw, head tilt from the eyes), the body and the hands from one performance.
//   node tools/rigger-spike/half-body.mjs
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

const dir = mkdtempSync(join(tmpdir(), 'half-body-'));
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
const { HALF_BODY, BUST_FACE, templateRig, rigTemplateList } = await bundle(
	'src/lib/server/rigTemplates.ts',
	'templates.mjs',
);
const { solveMotion } = await bundle('src/lib/rigMotion.ts', 'motion.mjs');

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
			'FACE_FIELD',
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
			'faceOrderStep',
			'faceOrderAt',
			'faceOrderOffsets',
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
			'faceKeyBlink',
			'faceKeyIdleBlinks',
			'faceKeyTalk',
			'faceKeyLipSync',
			'faceKeyMotion',
			'faceTimelineClip',
			'faceAddStarterClips',
			'tplCleanChannel',
		].map(grabFn),
		'return { faceChannelValue, faceKeyChannel, faceKeyShape, faceKeyBlink, faceKeyTalk, faceKeyLipSync, faceKeyMotion, faceAddStarterClips, tplCleanChannel };',
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

const T = HALF_BODY;
const channels = T.channels;
const chan = (id) => channels.find((c) => c.id === id);
const SIDES = ['l', 'r'];
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const segments = (s) => DIGITS.flatMap((d) => [1, 2, 3].map((n) => `${d}_${n}_${s}`));
const POSES = SIDES.flatMap((s) =>
	['open', 'fist', 'point', 'thumbs_up'].map((p) => `hand_${s}_${p}`),
);

function rigWith(skip = [], tpl = T) {
	const regions = tpl.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = templateRig(tpl, regions);
	const names = new Set(regions.map((r) => r.name));
	const has = (slot, part) => names.has(part) && !!skeleton.skins[0].attachments[slot]?.[part];
	const setupOf = (slot) => skeleton.slots.find((s) => s.name === slot)?.attachment ?? null;
	const lines = ['page.png', 'size:8192,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return { skeleton, has, setupOf, atlas: lines.join('\n') + '\n' };
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
	const doc = { ...rig.skeleton, animations: { a: anim } };
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(doc)),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, 'a', false);
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
		: prop === 'scaleY' || prop === 'scaleX'
			? b[prop] / d[prop]
			: b[prop] - d[prop];
};
/** The posed draw order (slot names, back to front) after a depth control: its slots sit, in their
 * own order, just behind its step's slot, or where the setup puts them. */
function orderPosed(p, ch, v) {
	const order = p.skel.drawOrder.map((s) => s.data.name);
	let behind = null;
	for (const st of ch.order.steps) if (v >= st.at - 1e-9) behind = st.behind;
	const at = ch.order.slots.map((n) => order.indexOf(n));
	const together = at.every((x, i) => i === 0 || x === at[i - 1] + 1);
	if (behind === null) return together && at[0] > order.indexOf(ch.order.steps[0].behind);
	return together && at[at.length - 1] + 1 === order.indexOf(behind);
}

const shown = (p, slot) => p.skel.findSlot(slot).getAttachment()?.name ?? null;
const world = (p, bone) => {
	const b = p.skel.findBone(bone);
	return [b.worldX, b.worldY];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dirDeg = (p, a, b) => {
	const [x0, y0] = world(p, a);
	const [x1, y1] = world(p, b);
	return (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
};
const angGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const full = rigWith();
const noPoses = rigWith(POSES);
const needed = rigWith(T.parts.filter((p) => !p.required).map((p) => p.name));

// 1. Every control keys, reads back and poses (runtime), on full art. The mouth is a shape, not a
// number: §6 keys it.
const setupOrder = full.skeleton.slots.map((s) => s.name);
for (const ch of channels.filter((c) => !c.shapes)) {
	const anim = {};
	const vals = ch.swaps
		? ch.swaps.map((w) => w.at)
		: ch.order
			? [ch.min, ...ch.order.steps.map((s) => s.at)]
			: [ch.min, (ch.min + ch.max) * 0.37, ch.max];
	vals.forEach((v, i) => F.faceKeyChannel(anim, ch, v, i * 0.5, full.has, channels, setupOrder));
	vals.forEach((v, i) => {
		const t = i * 0.5;
		const back = F.faceChannelValue(anim, ch, t, full.setupOf, channels, setupOrder);
		ok(`${ch.id} reads back ${v} at ${t}s`, near(back, v, 0.01), String(back));
		const p = play(full, anim, t);
		const img = play(full, anim, t + EDGE);
		if (ch.order)
			ok(
				`${ch.id} = ${v} draws the arm ${v > ch.rest ? 'behind' : 'in front'} (runtime)`,
				orderPosed(p, ch, v),
				p.skel.drawOrder.map((s) => s.data.name).join(),
			);
		const drives = ch.sets
			? ch.sets.flatMap((s) => {
					const target = chan(s.channel);
					const tv = Math.min(target.max, Math.max(target.min, v * s.per));
					return target.drives.map((d) => [d, tv]);
				})
			: (ch.drives ?? []).map((d) => [d, v]);
		for (const [d, dv] of drives) {
			const want = d.prop.startsWith('scale') ? 1 + dv * d.per : dv * d.per;
			ok(
				`${ch.id} = ${v} poses ${d.bone}.${d.prop} = ${want.toFixed(3)} (runtime)`,
				near(boneOff(p, d.bone, d.prop), want, 0.02),
				String(boneOff(p, d.bone, d.prop)),
			);
		}
		if (ch.swaps) {
			const want = [...ch.swaps].reverse().find((w) => w.at <= v + 1e-9).part;
			ok(
				`${ch.id} = ${v} shows ${want} (runtime)`,
				shown(img, ch.slot) === want,
				shown(img, ch.slot),
			);
			const showing = want === ch.swaps[0].part;
			const wrong = (ch.hides ?? []).filter(
				(h) => shown(img, h.slot) !== (showing ? h.part : null),
			);
			ok(
				`${ch.id} = ${v} ${showing ? 'shows' : 'hides'} the finger images (runtime)`,
				!wrong.length,
				wrong.map((h) => `${h.slot}=${shown(img, h.slot)}`).join(' '),
			);
		}
	});
}
ok(
	'every control was posed',
	channels.every((c) => c.drives?.length || c.swaps || c.sets || c.shapes || c.order),
	channels
		.filter((c) => !(c.drives?.length || c.swaps || c.sets || c.shapes || c.order))
		.map((c) => c.id)
		.join(),
);

// 2. A pose the art lacks falls back to the finger rig: the hand image stays and so do the fingers.
for (const s of SIDES) {
	const anim = {};
	F.faceKeyChannel(anim, chan(`hand_${s}`), 2, 0, noPoses.has, channels);
	const p = play(noPoses, anim, EDGE);
	ok(
		`hand_${s} fist without its image keeps the hand and its fingers (runtime)`,
		shown(p, `hand_${s}`) === `hand_${s}` && segments(s).every((n) => shown(p, n) === n),
	);
	ok(`hand_${s} keys no image the art lacks`, !JSON.stringify(anim).includes(`hand_${s}_fist`));
}

// 2b. Motion keys over a pose control replace the finger images' keys under the import too, and
// 📐 Save as template's editor carries the curl's sets and the pose's hidden slots as they are.
{
	const pose = chan('hand_l');
	const anim = {};
	F.faceKeyChannel(anim, pose, 2, 0.2, full.has, channels);
	F.faceKeyChannel(anim, pose, 2, 0.75, full.has, channels);
	F.faceKeyMotion(
		anim,
		[
			[0, 'hand_l', 0],
			[0.5, 'hand_l', 0],
		],
		0.5,
		channels,
		full.has,
	);
	const p = play(full, anim, 0.8 + EDGE);
	ok(
		'a pose imported over a hidden stretch shows the fingers again under the import (runtime)',
		shown(p, 'hand_l') === 'hand_l' && segments('l').every((n) => shown(p, n) === n),
		segments('l')
			.map((n) => shown(p, n))
			.join(),
	);
	ok(
		'…and the hide keyed before the import is kept',
		shown(play(full, anim, 0.2 + EDGE), 'index_1_l') === null,
	);
	const clean = (id) => JSON.stringify(F.tplCleanChannel(JSON.parse(JSON.stringify(chan(id)))));
	ok(
		'the 📐 editor keeps a hand curl’s sets and a hand pose’s hidden slots',
		['curl_l', 'hand_r', 'thumb_l'].every((id) => clean(id) === JSON.stringify(chan(id))),
		['curl_l', 'hand_r'].map(clean).join(' | '),
	);
}

// 3. What the finger controls look like.
{
	const curl = {};
	F.faceKeyChannel(curl, chan('curl_index_l'), 1, 0, full.has, channels);
	const straight = play(full, {}, 0);
	const bent = play(full, curl, 0);
	const len = (p) => dist(world(p, 'index_1_l'), world(p, 'index_3_l'));
	ok(
		'a full index curl folds the finger toward its knuckle (under a third of its length)',
		len(bent) < len(straight) / 3,
		`${len(straight).toFixed(1)} → ${len(bent).toFixed(1)}`,
	);
	ok(
		'…and leaves the middle finger straight',
		near(
			dist(world(bent, 'middle_1_l'), world(bent, 'middle_3_l')),
			dist(world(straight, 'middle_1_l'), world(straight, 'middle_3_l')),
			0.01,
		),
	);
	const spread = {};
	F.faceKeyChannel(spread, chan('spread_r'), 1, 0, full.has, channels);
	const fan = (p) =>
		angGap(dirDeg(p, 'index_1_r', 'index_2_r'), dirDeg(p, 'pinky_1_r', 'pinky_2_r'));
	ok(
		'spreading fans the index and pinky apart by 24°',
		near(fan(play(full, spread, 0)) - fan(straight), 24, 0.5),
		`${fan(straight).toFixed(1)} → ${fan(play(full, spread, 0)).toFixed(1)}`,
	);
	for (const s of SIDES) {
		const inner = s === 'l' ? 1 : -1;
		const fold = {};
		F.faceKeyChannel(fold, chan(`thumb_${s}`), 1, 0, full.has, channels);
		F.faceKeyChannel(fold, chan(`thumb_${s}`), -0.5, 1, full.has, channels);
		const tip = (t) => world(play(full, fold, t), `thumb_3_${s}`)[0] * inner;
		const rest = world(straight, `thumb_3_${s}`)[0] * inner;
		ok(
			`thumb ${s}: folding swings it across the palm, out swings it away`,
			tip(0) < rest - 3 && tip(1) > rest + 3,
			`${tip(0).toFixed(1)} < ${rest.toFixed(1)} < ${tip(1).toFixed(1)}`,
		);
	}
}

// 4. Starter clips on three kinds of art: start and end at rest, last their length.
const atRest = (rig, p) => {
	const off = [];
	for (const ch of channels) {
		for (const d of ch.drives ?? []) {
			const v = boneOff(p, d.bone, d.prop);
			if (!near(v, d.prop.startsWith('scale') ? 1 : 0, d.prop.startsWith('scale') ? 1e-3 : 0.01))
				off.push(`${d.bone}.${d.prop}=${v.toFixed(3)}`);
		}
		if (!ch.swaps) continue;
		const want = [...ch.swaps]
			.reverse()
			.find((w) => w.at <= ch.rest + 1e-9 && (w.part === null || rig.has(ch.slot, w.part))).part;
		if (shown(p, ch.slot) !== want) off.push(`${ch.slot} shows ${shown(p, ch.slot)}`);
		for (const h of ch.hides ?? [])
			if (rig.has(h.slot, h.part) && shown(p, h.slot) !== h.part)
				off.push(`${h.slot} shows ${shown(p, h.slot)}`);
	}
	return off;
};
const ARTS = [
	['full art', full, []],
	['finger segments, no pose images', noPoses, POSES],
	['needed parts only', needed, T.parts.filter((p) => !p.required).map((p) => p.name)],
];
for (const [label, rig, skip] of ARTS) {
	const animations = {};
	const r = F.faceAddStarterClips(animations, T, rig.has);
	ok(
		`${label}: every starter clip is added`,
		r.added.join() === T.clips.map((c) => c.name).join(),
		r.added.join(),
	);
	const named = new Set(
		Object.values(animations).flatMap((a) =>
			Object.values(a.slots ?? {}).flatMap((s) => (s.attachment ?? []).map((k) => k.name)),
		),
	);
	ok(
		`${label}: clips key only images the art has`,
		[...named].every((n) => !n || !skip.includes(n)),
		[...named].filter((n) => skip.includes(n)).join(),
	);
	for (const c of T.clips) {
		const start = play(rig, animations[c.name], 0);
		ok(
			`${label} ${c.name}: lasts ${c.length} s (runtime)`,
			near(start.data.findAnimation('a').duration, c.length),
			String(start.data.findAnimation('a').duration),
		);
		for (const [when, p] of [
			['start', start],
			['end', play(rig, animations[c.name], c.length + EDGE)],
		]) {
			const off = atRest(rig, p);
			ok(`${label} ${c.name}: at rest at the ${when} (runtime)`, !off.length, off.join(' '));
		}
	}
	const at = (clip, t) => play(rig, animations[clip], t + EDGE);
	const wave = at('wave', 1);
	ok(
		`${label}: wave lifts the right hand beside the head (runtime)`,
		world(wave, 'hand_r')[1] > world(wave, 'head')[1] - 40 &&
			world(wave, 'hand_r')[0] > world(wave, 'head')[0] + 100,
		`hand ${world(wave, 'hand_r').map(Math.round)} head ${world(wave, 'head').map(Math.round)}`,
	);
	const point = at('point', 0.8);
	ok(
		`${label}: point holds the arm out with the index straight, the others curled (runtime)`,
		angGap(dirDeg(point, 'upper_arm_r', 'lower_arm_r'), 0) < 15 &&
			near(boneOff(point, 'index_1_r', 'scaleY'), 1, 1e-3) &&
			near(boneOff(point, 'middle_1_r', 'scaleY'), 0.3, 1e-3),
		`${dirDeg(point, 'upper_arm_r', 'lower_arm_r')}`,
	);
	const thumb = at('thumbs_up', 0.8);
	ok(
		`${label}: thumbs up puts the thumb above the wrist (runtime)`,
		world(thumb, 'thumb_3_r')[1] > world(thumb, 'hand_r')[1] + 40,
		`${world(thumb, 'thumb_3_r')[1]} vs ${world(thumb, 'hand_r')[1]}`,
	);
	const pump = at('fist_pump', 0.55);
	ok(
		`${label}: the fist pump closes the hand above the shoulder (runtime)`,
		world(pump, 'hand_r')[1] > world(pump, 'upper_arm_r')[1] + 100 &&
			['index', 'middle', 'ring', 'pinky'].every((f) =>
				near(boneOff(pump, `${f}_1_r`, 'scaleY'), 0.3, 1e-3),
			),
	);
	const posed = label === 'full art';
	ok(
		`${label}: a drawn pose ${posed ? 'shows and hides the fingers' : 'falls back to the finger rig'} (runtime)`,
		[
			[wave, 'hand_r_open'],
			[point, 'hand_r_point'],
			[thumb, 'hand_r_thumbs_up'],
			[pump, 'hand_r_fist'],
		].every(([p, img]) =>
			posed
				? shown(p, 'hand_r') === img && segments('r').every((n) => shown(p, n) === null)
				: shown(p, 'hand_r') === 'hand_r' &&
					segments('r').every((n) => shown(p, n) === (rig.has(n, n) ? n : null)),
		),
	);
}

// 5. Hands from fixed Hand Landmarker fixtures, through the solve, keyed and posed.
const summary = rigTemplateList().find((t) => t.id === 'half-body');
ok('the template list carries the hand map', !!summary?.motion?.hand);
const FPS = 24;
const ft = (i) => i / FPS;
const D2R = Math.PI / 180;
// A hand in its own 3D space (metres): palm in the x-y plane, fingers along −y, flexing toward +z.
const FINGER_AT = {
	index: [0.025, -0.09],
	middle: [0.005, -0.095],
	ring: [-0.015, -0.09],
	pinky: [-0.032, -0.08],
};
const SEG = [0.045, 0.027, 0.02];
function hand({ curl = {}, spread = 0, thumb = [25, 25] } = {}) {
	const w = Array(21).fill(null);
	w[0] = [0, 0, 0];
	const chain = (base, start, dir, flex, segs) => {
		let p = start;
		let a = 0;
		w[base] = p;
		segs.forEach((len, j) => {
			a += flex[j] * D2R;
			const d = [dir[0] * Math.cos(a), dir[1] * Math.cos(a), Math.sin(a)];
			p = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
			w[base + j + 1] = p;
		});
	};
	['index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
		const at = FINGER_AT[f];
		const fan = (f === 'index' ? spread / 2 : f === 'pinky' ? -spread / 2 : 0) * D2R;
		const dir = [Math.sin(fan), -Math.cos(fan)];
		const len = Math.hypot(...at);
		// The knuckle sits on the line from the wrist along the finger, so MCP flexion is the curl's.
		chain(5 + 4 * i, [dir[0] * len, dir[1] * len, 0], dir, curl[f] ?? [0, 0, 0], SEG);
	});
	// Thumb: CMC (1) out from the wrist, then MCP (2), IP (3), tip (4) flexing by `thumb`.
	const tdir = [Math.sin(60 * D2R), -Math.cos(60 * D2R)];
	w[1] = [tdir[0] * 0.03, tdir[1] * 0.03, 0];
	let p = w[1];
	let a = 0;
	[0.035, 0.03, 0.025].forEach((len, j) => {
		if (j > 0) a += thumb[j - 1] * D2R;
		p = [
			p[0] + tdir[0] * Math.cos(a) * len,
			p[1] + tdir[1] * Math.cos(a) * len,
			p[2] + Math.sin(a) * len,
		];
		w[2 + j] = p;
	});
	return w;
}
const FIST = { index: [80, 90, 70], middle: [80, 90, 70], ring: [80, 90, 70], pinky: [80, 90, 70] };
// A waist-up performer, unmirrored: their right side (12, 14, 16, 18, 20) on the picture's left.
const STAND = {
	7: [0.53, 0.25],
	8: [0.47, 0.25],
	11: [0.6, 0.4],
	12: [0.4, 0.4],
	13: [0.6, 0.55],
	14: [0.4, 0.55],
	15: [0.6, 0.7],
	16: [0.4, 0.7],
	17: [0.6, 0.75],
	18: [0.4, 0.75],
	19: [0.6, 0.75],
	20: [0.4, 0.75],
	23: [0.56, 0.8],
	24: [0.44, 0.8],
};
function frame(i, { hands = [], pose = true, change = {} } = {}) {
	const lm = Array(33).fill(null);
	for (const [k, q] of Object.entries({ ...STAND, ...change })) lm[k] = [q[0], q[1], 0.99];
	return {
		t: ft(i),
		pose: pose ? { landmarks: lm } : null,
		hands: hands.map(({ at, label, ...shape }) => ({
			label,
			landmarks: Array.from({ length: 21 }, () => [...at]),
			world: hand(shape),
		})),
	};
}
const L_AT = [0.4, 0.7];
const R_AT = [0.6, 0.7];
const solved = (frames, opts) => solveMotion(summary, { width: 640, height: 640, frames }, opts);
const keyed = (r) => {
	const anim = {};
	F.faceKeyMotion(anim, r.keys, 0, channels, full.has);
	return (i) => play(full, anim, ft(i) + EDGE);
};
{
	// The picture-left hand (labelled "Right", wrongly) curls its index; the right hand stays open
	// and then sticks its thumb out; both hands vanish for four frames.
	const frames = Array.from({ length: 48 }, (_, i) => {
		if (i >= 40 && i <= 43) return frame(i);
		const lc = i >= 10 && i <= 19 ? [80, 90, 70] : i >= 20 && i <= 43 ? [40, 45, 35] : [0, 0, 0];
		return frame(i, {
			hands: [
				{ at: L_AT, label: 'Right', curl: { index: lc } },
				{ at: R_AT, label: 'Left', thumb: i >= 24 && i <= 34 ? [0, 0] : [25, 25] },
			],
		});
	});
	const r = solved(frames);
	const pose = keyed(r);
	ok(
		'curl: a full index flexion (240°) curls it fully, on the picture-left hand',
		near(boneOff(pose(15), 'index_1_l', 'scaleY'), 0.3, 0.02),
		String(boneOff(pose(15), 'index_1_l', 'scaleY')),
	);
	ok(
		'curl: half the flexion curls it half',
		near(boneOff(pose(30), 'index_1_l', 'scaleY'), 1 - 0.7 * 0.5, 0.02),
		String(boneOff(pose(30), 'index_1_l', 'scaleY')),
	);
	ok(
		'curl: the other fingers and the other hand stay straight',
		['middle_1_l', 'ring_1_l', 'index_1_r'].every((b) =>
			near(boneOff(pose(15), b, 'scaleY'), 1, 0.01),
		),
	);
	ok(
		'hands out of sight hold their pose',
		near(boneOff(pose(42), 'index_1_l', 'scaleY'), 1 - 0.7 * 0.5, 0.02),
		String(boneOff(pose(42), 'index_1_l', 'scaleY')),
	);
	// Straight thumb: (0 − 30) / 90 = −⅓ of the thumb control; the right thumb's first joint turns 40 × −⅓.
	ok(
		'thumb: straightened sticks it out (right hand)',
		near(boneOff(pose(30), 'thumb_1_r', 'rotate'), -40 / 3, 0.5),
		String(boneOff(pose(30), 'thumb_1_r', 'rotate')),
	);
	// Relaxed thumb: (50 − 30) / 90 = 0.22 folded.
	ok(
		'thumb: relaxed reads a little folded',
		near(boneOff(pose(5), 'thumb_1_r', 'rotate'), 40 * (20 / 90), 0.5),
		String(boneOff(pose(5), 'thumb_1_r', 'rotate')),
	);
	ok(
		'frames where only the body was seen are not untracked',
		r.untracked === 0,
		String(r.untracked),
	);
	ok(
		'curl keys are reduced to under a third of the frames',
		r.keys.filter((k) => k[1] === 'curl_index_l').length < frames.length / 3,
		String(r.keys.filter((k) => k[1] === 'curl_index_l').length),
	);
	ok(
		'no hand curl key is written (the fingers are)',
		!r.keys.some((k) => k[1] === 'curl_l' || k[1] === 'curl_r'),
	);
}
{
	// Fingers fanned 40° apart (index to pinky): (40 − 15) / 40 = 0.625 of the spread; together
	// (0°) is past the control's −0.3, held there and reported.
	const frames = Array.from({ length: 24 }, (_, i) =>
		frame(i, { hands: [{ at: L_AT, label: 'Left', spread: i >= 8 ? 40 : 0 }] }),
	);
	const r = solved(frames);
	const pose = keyed(r);
	const rot = (i) => boneOff(pose(i), 'index_1_l', 'rotate');
	ok(
		'spread: fingers fanned 40° apart spread the rig’s index 12° × 0.625',
		near(rot(20), 7.5, 0.3) && near(boneOff(pose(20), 'pinky_1_l', 'rotate'), -7.5, 0.3),
		`${rot(20)} ${boneOff(pose(20), 'pinky_1_l', 'rotate')}`,
	);
	ok(
		'spread: fingers held together read past the range, held at its edge and reported',
		near(rot(2), -3.6, 0.3) && r.clipped.some((c) => c.channel === 'spread_l'),
		`${rot(2)} ${JSON.stringify(r.clipped)}`,
	);
	const outside = r.keys.filter(([, id, v]) => !(v >= chan(id).min && v <= chan(id).max));
	ok('every solved key is inside its control’s range', !outside.length, JSON.stringify(outside));
}
{
	// No body in the picture: two hands go by picture order, whatever they are labelled.
	const frames = Array.from({ length: 12 }, (_, i) =>
		frame(i, {
			pose: false,
			hands: [
				{ at: R_AT, label: 'Left', curl: FIST },
				{ at: L_AT, label: 'Right' },
			],
		}),
	);
	const pose = keyed(solved(frames));
	ok(
		'no body: the picture-right hand is the right hand',
		near(boneOff(pose(6), 'index_1_r', 'scaleY'), 0.3, 0.02) &&
			near(boneOff(pose(6), 'index_1_l', 'scaleY'), 1, 0.02),
		`${boneOff(pose(6), 'index_1_r', 'scaleY')} ${boneOff(pose(6), 'index_1_l', 'scaleY')}`,
	);
	ok('frames with hands and no body are not untracked', solved(frames).untracked === 0);
	const one = Array.from({ length: 12 }, (_, i) =>
		frame(i, { pose: false, hands: [{ at: R_AT, label: 'Left', curl: FIST }] }),
	);
	const p1 = keyed(solved(one));
	ok(
		'one hand, no body: MediaPipe’s "Left" (unmirrored: the performer’s right) is the picture-left hand',
		near(boneOff(p1(6), 'index_1_l', 'scaleY'), 0.3, 0.02),
		String(boneOff(p1(6), 'index_1_l', 'scaleY')),
	);
	const r = solved(one);
	ok(
		'one hand: the other hand’s controls are never seen, so not keyed',
		r.unseen.includes('curl_index_r') && !r.keys.some((k) => k[1] === 'curl_index_r'),
		r.unseen.join(),
	);
}
{
	// The body's knuckle points 30° counter-clockwise off the forearm bend the left wrist 30°; the
	// right arm raised straight out to the side; hands switched off key no finger.
	const k30 = [0.4 + 0.05 * Math.sin(30 * D2R), 0.7 + 0.05 * Math.cos(30 * D2R)];
	const frames = Array.from({ length: 24 }, (_, i) =>
		frame(i, {
			hands: [{ at: L_AT, label: 'Left', curl: FIST }],
			change:
				i >= 8
					? { 18: k30, 20: k30, 13: [0.75, 0.4], 15: [0.9, 0.4], 17: [0.95, 0.4], 19: [0.95, 0.4] }
					: {},
		}),
	);
	const r = solved(frames, { hand: false });
	const pose = keyed(r);
	ok(
		'wrist: the knuckles bend the hand 30° off the forearm',
		near(boneOff(pose(20), 'hand_l', 'rotate'), 30, 1),
		String(boneOff(pose(20), 'hand_l', 'rotate')),
	);
	ok(
		'arm: raised out to the side, the upper arm points right and the hand follows straight',
		angGap(dirDeg(pose(20), 'upper_arm_r', 'lower_arm_r'), 0) < 2 &&
			angGap(dirDeg(pose(20), 'lower_arm_r', 'hand_r'), 0) < 2,
		`${dirDeg(pose(20), 'upper_arm_r', 'lower_arm_r')} ${dirDeg(pose(20), 'lower_arm_r', 'hand_r')}`,
	);
	ok('level shoulders key no shrug', near(boneOff(pose(20), 'clavicle_l', 'rotate'), 0, 0.5));
	ok(
		'hands off: no finger is keyed',
		!r.keys.some((k) => /^(curl_|thumb_|spread_)/.test(k[1])),
		r.channels.join(),
	);
	ok(
		'hands on: the same track keys the fist',
		near(boneOff(keyed(solved(frames))(20), 'index_1_l', 'scaleY'), 0.3, 0.02),
	);
}
{
	// A joint the tracker did not place (its middle knuckle) is a gap for that finger only.
	const frames = Array.from({ length: 24 }, (_, i) => {
		const f = frame(i, { hands: [{ at: L_AT, curl: i >= 8 ? FIST : {} }] });
		if (i >= 12) f.hands[0].world[10] = null;
		return f;
	});
	const zero = frames.map((f, i) => {
		const g = structuredClone(f);
		if (i >= 12) g.hands[0].world[8] = [...g.hands[0].world[7]];
		return g;
	});
	const z = solved(zero);
	ok(
		'a finger segment of no length is a gap, never NaN',
		z.keys.every((k) => typeof k[2] === 'string' || Number.isFinite(k[2])) &&
			near(
				boneOff(keyed(z)(20), 'index_1_l', 'scaleY'),
				boneOff(keyed(z)(11), 'index_1_l', 'scaleY'),
				0.02,
			),
		JSON.stringify(z.keys.filter((k) => k[1] === 'curl_index_l').slice(-3)),
	);
	const right = Array.from({ length: 12 }, (_, i) =>
		frame(i, { hands: [{ at: R_AT, label: 'Left', curl: FIST }] }),
	);
	ok(
		'one hand by the body’s right-side wrist is the right hand, whatever its handedness says',
		near(boneOff(keyed(solved(right))(6), 'index_1_r', 'scaleY'), 0.3, 0.02),
	);
	const pose = keyed(solved(frames));
	ok(
		'a missing middle-finger joint holds the middle finger, the others follow',
		near(
			boneOff(pose(20), 'middle_1_l', 'scaleY'),
			boneOff(pose(11), 'middle_1_l', 'scaleY'),
			0.02,
		) && near(boneOff(pose(20), 'index_1_l', 'scaleY'), 0.3, 0.02),
		`${boneOff(pose(11), 'middle_1_l', 'scaleY')} → ${boneOff(pose(20), 'middle_1_l', 'scaleY')}`,
	);
}
{
	const r = solved(Array.from({ length: 6 }, (_, i) => ({ t: ft(i), pose: null, hands: [] })));
	ok('nothing in sight: nothing keyed, every frame untracked', !r.keys.length && r.untracked === 6);
}

// 6. The face: Bust with face's shared face block on the head, posed exactly as on the bust.
{
	const bust = rigWith([], BUST_FACE);
	const mouth = chan('mouth');
	const missing = BUST_FACE.channels.filter((b) => !chan(b.id)).map((b) => b.id);
	ok('half-body has every Bust with face control', !missing.length, missing.join());
	for (const ch of channels.filter(
		(c) => !c.shapes && BUST_FACE.channels.some((b) => b.id === c.id),
	)) {
		const vals = ch.swaps ? ch.swaps.map((w) => w.at) : [ch.min, ch.max];
		const mine = {};
		const theirs = {};
		vals.forEach((v, i) => {
			F.faceKeyChannel(mine, ch, v, i * 0.5, full.has, channels);
			F.faceKeyChannel(theirs, ch, v, i * 0.5, bust.has, BUST_FACE.channels);
		});
		vals.forEach((v, i) => {
			const [a, b] = [play(full, mine, i * 0.5 + EDGE), play(bust, theirs, i * 0.5 + EDGE)];
			const off = [
				...(ch.drives ?? [])
					.filter((d) => !near(boneOff(a, d.bone, d.prop), boneOff(b, d.bone, d.prop), 0.02))
					.map(
						(d) =>
							`${d.bone}.${d.prop} ${boneOff(a, d.bone, d.prop)} ≠ ${boneOff(b, d.bone, d.prop)}`,
					),
				...(ch.slot && shown(a, ch.slot) !== shown(b, ch.slot) ? [`${ch.slot} image`] : []),
			];
			ok(`face ${ch.id} = ${v} poses as on Bust with face (runtime)`, !off.length, off.join('; '));
		});
	}
	const head = (p) => p.skel.findBone('head');
	const faceAt = (p) => {
		const [h, f] = [head(p), p.skel.findBone('face')];
		return h.worldToLocal({ x: f.worldX, y: f.worldY });
	};
	ok(
		'the face sits on the head where it sits on the bust (runtime)',
		near(faceAt(play(full, {}, 0)).x, faceAt(play(bust, {}, 0)).x) &&
			near(faceAt(play(full, {}, 0)).y, faceAt(play(bust, {}, 0)).y),
		JSON.stringify(faceAt(play(full, {}, 0))),
	);

	// Mouth shapes, the jaw and the corners they pose, as the shape buttons key them.
	const shapes = [mouth.shapes.rest, ...Object.keys(mouth.shapes.open)];
	const shaped = {};
	shapes.forEach((m, i) => F.faceKeyShape(shaped, mouth, m, i * 0.3, channels, full.has));
	const jawPer = chan('jaw').drives[0].per;
	for (const [i, m] of shapes.entries()) {
		const p = play(full, shaped, i * 0.3);
		const img = play(full, shaped, i * 0.3 + EDGE);
		ok(
			`the ${m} button shows it and opens the jaw ${mouth.shapes.open[m] ?? 0} (runtime)`,
			shown(img, 'mouth') === m &&
				near(boneOff(p, 'jaw', 'y'), (mouth.shapes.open[m] ?? 0) * jawPer),
			`${shown(img, 'mouth')} jaw ${boneOff(p, 'jaw', 'y')}`,
		);
	}
	const smile = play(full, shaped, shapes.indexOf('mouth_smile') * 0.3);
	const smilePer = chan('smile_l').drives.find((d) => d.bone === 'mouth_corner_l');
	ok(
		'a smile lifts the corners its pose names (runtime)',
		near(
			boneOff(smile, 'mouth_corner_l', smilePer.prop),
			mouth.shapes.pose.mouth_smile.smile_l * smilePer.per,
		),
		String(boneOff(smile, 'mouth_corner_l', smilePer.prop)),
	);

	// Lip-sync: Rhubarb's letters through the template's map, ending on rest.
	const CUES = [
		{ start: 0, end: 0.2, value: 'X' },
		{ start: 0.2, end: 0.5, value: 'D' },
		{ start: 0.5, end: 0.7, value: 'A' },
		{ start: 0.7, end: 0.9, value: 'X' },
	];
	const lip = {};
	const n = F.faceKeyLipSync(lip, mouth, CUES, 1, channels, full.has);
	const lipAt = (t) => shown(play(full, lip, 1 + t + EDGE), 'mouth');
	ok(
		'lip-sync keys the voice line on the half-body mouth, ending on rest (runtime)',
		n > 0 &&
			lipAt(0.3) === mouth.shapes.lipsync.D &&
			lipAt(0.6) === mouth.shapes.lipsync.A &&
			lipAt(0.95) === mouth.shapes.rest &&
			near(boneOff(play(full, lip, 1.95), 'jaw', 'y'), 0),
		`${n}: ${lipAt(0.3)} ${lipAt(0.6)} ${lipAt(0.95)}`,
	);
	const talk = {};
	ok(
		'talk keys mouth shapes and ends on rest (runtime)',
		F.faceKeyTalk(talk, mouth, 0, 1, channels, full.has) > 3 &&
			shown(play(full, talk, 1 + EDGE), 'mouth') === mouth.shapes.rest,
	);
	const blink = {};
	F.faceKeyBlink(blink, 0, channels, full.has);
	ok(
		'a blink closes both eyes on the half-body face (runtime)',
		['l', 'r'].every(
			(s) => shown(play(full, blink, 0.08 + EDGE), `eyelid_${s}`) === `eyelid_${s}_closed`,
		) && ['l', 'r'].every((s) => shown(play(full, blink, 0.2 + EDGE), `eyelid_${s}`) === null),
	);

	// A drawn hand pose hides finger images only, never a part of the face.
	const posed = {};
	F.faceKeyChannel(posed, chan('hand_l'), 2, 0, full.has, channels);
	F.faceKeyChannel(posed, chan('hand_r'), 3, 0, full.has, channels);
	const p = play(full, posed, EDGE);
	const faceSlots = full.skeleton.slots.filter((x) =>
		bust.skeleton.slots.some((b) => b.name === x.name),
	);
	const hidden = faceSlots.filter((x) => shown(p, x.name) !== (x.attachment ?? null));
	ok(
		'a hand pose leaves every face image as it was (runtime)',
		!hidden.length,
		hidden.map((x) => `${x.name}=${shown(p, x.name)}`).join(' '),
	);

	// Face, body and hands from one performance, through one solve.
	const lm478 = (tilt) => {
		const lm = Array(478).fill(null);
		const a = (-tilt * Math.PI) / 180;
		const rot = ([x, y]) => [
			0.5 + (x - 0.5) * Math.cos(a) - (y - 0.3) * Math.sin(a),
			0.3 + (x - 0.5) * Math.sin(a) + (y - 0.3) * Math.cos(a),
		];
		lm[33] = rot([0.45, 0.3]);
		lm[263] = rot([0.55, 0.3]);
		lm[1] = rot([0.5, 0.34]);
		return lm;
	};
	// A resting second (the neutral), then the jaw drops and the picture-left hand closes its index
	// together, then the head tilts.
	const take = Array.from({ length: 72 }, (_, i) => {
		const open = i >= 30 && i <= 42;
		const f = frame(i, {
			hands: [{ at: L_AT, label: 'Right', curl: { index: open ? [80, 90, 70] : [0, 0, 0] } }],
		});
		f.face = { landmarks: lm478(i >= 52 && i <= 64 ? 10 : 0), blend: open ? { jawOpen: 0.5 } : {} };
		return f;
	});
	const r = solved(take);
	const pose = keyed(r);
	ok(
		'one solve keys the face, the body and the hands together',
		['jaw', 'head_tilt', 'curl_index_l', 'arm_l'].every((id) => r.channels.includes(id)) &&
			!r.untracked,
		r.channels.join(),
	);
	ok(
		'the jaw drops with the performer’s while the index closes (runtime)',
		boneOff(pose(36), 'jaw', 'y') < 0.25 * jawPer &&
			near(boneOff(pose(12), 'jaw', 'y'), 0, 0.5) &&
			near(boneOff(pose(36), 'index_1_l', 'scaleY'), 0.3, 0.02),
		`jaw ${boneOff(pose(12), 'jaw', 'y')} → ${boneOff(pose(36), 'jaw', 'y')}, index ${boneOff(pose(36), 'index_1_l', 'scaleY')}`,
	);
	ok(
		'the head tilts with the face, read from the eyes (runtime)',
		boneOff(pose(60), 'head', 'rotate') > 5 && near(boneOff(pose(12), 'head', 'rotate'), 0, 1),
		`${boneOff(pose(12), 'head', 'rotate')} → ${boneOff(pose(60), 'head', 'rotate')}`,
	);
	const bodyOnly = solved(take, { face: false });
	ok(
		'with the face off, nothing of the face is keyed (head tilt included)',
		!bodyOnly.channels.some((id) => BUST_FACE.channels.some((b) => b.id === id && id !== 'breath')),
		bodyOnly.channels.join(),
	);
}

console.log(`half body: ${checks - fails}/${checks} checks pass`);
if (fails) process.exit(1);
