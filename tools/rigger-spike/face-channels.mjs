// Verify the Channels panel's keying headlessly, on the SHIPPED code: the `face*` helpers (and the key
// helpers they use) are pulled out of view.html, the rigs are the real templates (`bust-face`,
// `full-body`) built by
// the server's `templateRig`, and every result is played through the official engine-rig loader and
// AnimationState — so what the Rigger writes is checked as the GAME poses it, not as the Rigger reads
// it back. Asserted:
//  - every channel reads back the value it keyed, at that time (drives and swaps);
//  - two channels on one bone (gaze x, gaze y) keep each other's axis;
//  - the runtime poses each drive as `value × per` from setup (scaleY as `1 + value × per`), and
//    shows each swap's image — on every template;
//  - a swap step whose image the rig lacks is skipped, never keyed;
//  - Blink, Idle blinks (loops: ends open at the clip's length) and Talk (the template's order,
//    only shapes the rig has, jaw opened per shape, ending on rest) key what they say;
//  - every template's starter clips play under the runtime and start and end at rest (every driven
//    bone at setup, every swap and shape slot on its rest image), on full and needed-only art;
//  - lip-sync (T4): a fixed Rhubarb answer keyed at the playhead shows the template's image for each
//    cue letter with its jaw, replaces only the mouth and jaw keys under the line, and ends on rest.
//  - a template saved from a rig (📐, T8): its controls key and pose, its own clip (timelines) plays
//    as authored, and on needed-only art an image key for a missing part shows nothing;
//  - bust-face v2: a mouth shape also sets the corners and lips its `pose` names, and puts back to
//    rest the ones it does not; a lip-sync line replaces those under it too; a bending image (a
//    brow, every mouth) is a weighted mesh whose vertices follow its bones under the runtime, and
//    every built-in version (v1 included) keys and poses as its own channels say.
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
const { BUST_FACE, BUST_FACE_V1, BUST_FACE_V2, FULL_BODY, FULL_BODY_V1, templateRig } =
	await import(pathToFileURL(out).href);
const outDerive = join(mkdtempSync(join(tmpdir(), 'face-derive-')), 'derive.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplateFromRig.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: outDerive,
	logLevel: 'error',
});
const { rigTemplateFromRig } = await import(pathToFileURL(outDerive).href);

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
			'drawOrderOfOffsets',
			'faceOrderOfKey',
			'faceOrderValue',
			'faceOrderKeyAt',
			'faceOrderValues',
			'faceKeyOrder',
			'faceAttachmentAt',
			'faceShapePart',
			'faceKeyAttachment',
			'faceChannelValue',
			'faceKeyChannel',
			'faceShapeControls',
			'faceKeyShape',
			'faceKeyBlink',
			'faceKeyIdleBlinks',
			'faceKeyTalk',
			'faceKeyLipSync',
			'faceTimelineClip',
			'faceAddStarterClips',
		].map(grabFn),
		'return { faceChannelValue, faceKeyChannel, faceKeyShape, faceKeyBlink, faceKeyIdleBlinks, faceKeyTalk, faceKeyLipSync, faceAddStarterClips };',
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
/** How far a control moves a bone per unit, from the template (never a copied number). */
const perOf = (id, bone, prop, list = channels) =>
	list.find((c) => c.id === id).drives.find((d) => d.bone === bone && d.prop === prop).per;
const JAW = perOf('jaw', 'jaw', 'y');
const regionsFor = (skip = [], tpl = BUST_FACE) =>
	tpl.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));

function rigWith(skip = [], tpl = BUST_FACE) {
	const regions = regionsFor(skip, tpl);
	const { skeleton } = templateRig(tpl, regions);
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
		: prop === 'scaleY' || prop === 'scaleX'
			? b[prop] / d[prop]
			: b[prop] - d[prop];
};
const shown = (p, slot) => p.skel.findSlot(slot).getAttachment()?.name ?? null;

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

// 1. Every channel round-trips and poses as the template says, at two times.
for (const tpl of [BUST_FACE_V1, BUST_FACE_V2, BUST_FACE, FULL_BODY_V1, FULL_BODY]) {
	const rig = rigWith([], tpl);
	const setup = rig.skeleton.slots.map((s) => s.name);
	for (const ch of tpl.channels.filter((c) => !c.shapes)) {
		const anim = {};
		const vals = ch.swaps
			? ch.swaps.map((w) => w.at)
			: ch.order
				? [ch.min, ...ch.order.steps.map((s) => s.at)]
				: [ch.min, (ch.min + ch.max) * 0.37, ch.max];
		vals.forEach((v, i) => F.faceKeyChannel(anim, ch, v, i * 0.5, rig.has, tpl.channels, setup));
		vals.forEach((v, i) => {
			const t = i * 0.5;
			const back = F.faceChannelValue(anim, ch, t, rig.setupOf, tpl.channels, setup);
			ok(
				`${tpl.id} v${tpl.version} ${ch.id} reads back ${v} at ${t}s`,
				near(back, v, 0.01),
				String(back),
			);
			const p = play(rig, anim, t);
			if (ch.order)
				ok(
					`${tpl.id} ${ch.id} = ${v} draws its slots ${v > ch.rest ? 'behind' : 'where they were'} (runtime)`,
					orderPosed(p, ch, v),
					p.skel.drawOrder.map((s) => s.data.name).join(),
				);
			for (const d of ch.drives ?? []) {
				const want = d.prop.startsWith('scale') ? 1 + v * d.per : v * d.per;
				ok(
					`${tpl.id} ${ch.id} poses ${d.bone}.${d.prop} = ${want.toFixed(3)} at ${t}s (runtime)`,
					near(boneOff(p, d.bone, d.prop), want, 0.02),
					String(boneOff(p, d.bone, d.prop)),
				);
			}
			if (ch.swaps) {
				const want = [...ch.swaps].reverse().find((w) => w.at <= v + 1e-9).part;
				ok(
					`${tpl.id} ${ch.id} shows ${want} at ${t}s (runtime)`,
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
		near(boneOff(p, 'pupil_l', 'x'), 0.5 * perOf('gaze_x', 'pupil_l', 'x')) &&
			near(boneOff(p, 'pupil_l', 'y'), -perOf('gaze_y', 'pupil_l', 'y')),
		`${boneOff(p, 'pupil_l', 'x')}, ${boneOff(p, 'pupil_l', 'y')}`,
	);
	ok(
		'gaze x and y both land on pupil_r',
		near(boneOff(p, 'pupil_r', 'x'), 0.5 * perOf('gaze_x', 'pupil_r', 'x')) &&
			near(boneOff(p, 'pupil_r', 'y'), -perOf('gaze_y', 'pupil_r', 'y')),
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
			near(boneOff(play(rig, anim, t), 'jaw', 'y'), JAW * mouth.shapes.open[part]),
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
		shown(p, 'mouth') === 'mouth_wide' && near(boneOff(p, 'jaw', 'y'), JAW * 0.6),
	);
	const pose = chan('mouth').shapes.pose.mouth_wide;
	ok(
		'…and moves the corners its pose names (runtime)',
		near(
			boneOff(p, 'mouth_corner_l', 'y'),
			pose.smile_l * perOf('smile_l', 'mouth_corner_l', 'y'),
		) &&
			near(
				boneOff(p, 'mouth_corner_r', 'x'),
				pose.stretch_r * perOf('stretch_r', 'mouth_corner_r', 'x'),
			),
		`${boneOff(p, 'mouth_corner_l', 'y')} ${boneOff(p, 'mouth_corner_r', 'x')}`,
	);
	F.faceKeyShape(anim, chan('mouth'), 'mouth_A', 1, channels, rig.has);
	const q = play(rig, anim, 1);
	ok(
		'a shape whose pose leaves a corner out puts it back to rest (runtime)',
		near(boneOff(q, 'mouth_corner_l', 'y'), 0) && near(boneOff(q, 'mouth_corner_r', 'x'), 0),
		`${boneOff(q, 'mouth_corner_l', 'y')} ${boneOff(q, 'mouth_corner_r', 'x')}`,
	);
	const skip = {};
	F.faceKeyShape(
		skip,
		chan('mouth'),
		'mouth_wide',
		0,
		channels,
		rig.has,
		new Set(['smile_l', 'jaw']),
	);
	ok(
		'a shape keys only the controls it is not told to skip (an import keys those itself)',
		!skip.bones.jaw &&
			!!skip.bones.mouth_corner_r &&
			skip.bones.mouth_corner_l.translate.every((k) => k.y === 0),
		JSON.stringify(skip.bones.mouth_corner_l ?? null),
	);
}

// 7b. A bending image is a weighted mesh: its vertices follow the bones it is weighted to.
{
	const rig = rigWith();
	const mesh = rig.skeleton.skins[0].attachments.mouth.mouth_rest;
	ok('a bending mouth is a weighted mesh', mesh.type === 'mesh' && mesh.hull === 20, mesh.type);
	const anim = {};
	F.faceKeyChannel(anim, chan('smile_l'), 1, 0, rig.has);
	const rest = play(rig, {}, 0);
	const up = play(rig, anim, 0);
	const verts = (p) => {
		const slot = p.skel.findSlot('mouth');
		const att = slot.getAttachment();
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return v;
	};
	const a = verts(rest);
	const b = verts(up);
	// The most a vertex on the image's left (right) edge rises: the left corner's bone is there.
	const edgeLift = (side) => {
		let most = -Infinity;
		for (let i = 0; i < a.length; i += 2)
			if (side * a[i] > 44) most = Math.max(most, b[i + 1] - a[i + 1]);
		return most;
	};
	const leftLift = edgeLift(-1);
	const rightLift = edgeLift(1);
	ok(
		'smile left lifts the mouth image’s left corner by the corner’s travel, not its right (runtime)',
		near(leftLift, perOf('smile_l', 'mouth_corner_l', 'y'), 0.05) && rightLift < 1,
		`${leftLift} ${rightLift}`,
	);
	const brow = {};
	F.faceKeyChannel(brow, chan('brow_in_l'), 1, 0, rig.has);
	const bw = (p) => {
		const slot = p.skel.findSlot('brow_l');
		const att = slot.getAttachment();
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return v;
	};
	const b0 = bw(rest);
	const b1 = bw(play(rig, brow, 0));
	const ends = (v0, v1, side) => {
		let best = 0;
		for (let i = 0; i < v0.length; i += 2) if (side * v0[i] > side * v0[best]) best = i;
		return v1[best + 1] - v0[best + 1];
	};
	ok(
		'the inner brow lifts the brow’s inner end (toward the nose), not its outer end (runtime)',
		ends(b0, b1, 1) > 0.95 * perOf('brow_in_l', 'brow_in_l', 'y') && ends(b0, b1, -1) < 1,
		`${ends(b0, b1, 1)} ${ends(b0, b1, -1)}`,
	);
}

// 8. Starter clips (T3, T7): each plays under the runtime, lasts its length, and starts and ends
// with every bone a channel drives at setup and every swap or shape slot on its rest image — on
// full art and on the needed parts only, where no attachment key may name an image the rig lacks.
const atRest = (tpl, rig, p) => {
	const off = [];
	const seen = new Set();
	for (const ch of tpl.channels) {
		for (const d of ch.drives ?? []) {
			if (seen.has(`${d.bone}.${d.prop}`)) continue;
			seen.add(`${d.bone}.${d.prop}`);
			const v = boneOff(p, d.bone, d.prop);
			if (!near(v, d.prop.startsWith('scale') ? 1 : 0, d.prop.startsWith('scale') ? 1e-3 : 0.01))
				off.push(`${d.bone}.${d.prop}=${v.toFixed(3)}`);
		}
		const slot = ch.shapes ? ch.shapes.slot : ch.swaps ? ch.slot : null;
		if (!slot) continue;
		const want = ch.shapes
			? ch.shapes.rest
			: [...ch.swaps]
					.reverse()
					.find((w) => w.at <= ch.rest + 1e-9 && (w.part === null || rig.has(slot, w.part))).part;
		if (shown(p, slot) !== want) off.push(`${slot} shows ${shown(p, slot)}, not ${want}`);
	}
	return off;
};
const extra = {
	'bust-face': (label, rig, animations) =>
		label === 'full art'
			? [
					[
						'win_big tilts the head 5° at 0.3 s (runtime)',
						near(boneOff(play(rig, animations.win_big, 0.3), 'head', 'rotate'), 5, 0.01),
					],
				]
			: [
					[
						'a missing smile falls back to the rest shape (nearest jaw opening)',
						shown(play(rig, animations.happy, 0.5), 'mouth') === 'mouth_rest',
					],
					[
						'a missing wide mouth falls back to O (nearest jaw opening)',
						shown(play(rig, animations.win_big, 0.1 + EDGE), 'mouth') === 'mouth_O',
					],
				],
	'full-body': (label, rig, animations) => {
		const up = play(rig, animations.celebrate, 0.3 + EDGE);
		const walk = play(rig, animations.walk, 0.25);
		return [
			[
				'celebrate raises both arms up and out at 0.3 s (runtime)',
				near(boneOff(up, 'upper_arm_l', 'rotate'), -135, 0.05) &&
					near(boneOff(up, 'upper_arm_r', 'rotate'), 135, 0.05),
			],
			[
				'celebrate hops 80 px at 0.45 s (runtime)',
				near(boneOff(play(rig, animations.celebrate, 0.45), 'root', 'y'), 80, 0.05),
			],
			[
				'walk swings the legs apart at 0.25 s (runtime)',
				near(boneOff(walk, 'thigh_l', 'rotate'), 25, 0.05) &&
					near(boneOff(walk, 'thigh_r', 'rotate'), -25, 0.05),
			],
			label === 'full art'
				? [
						'celebrate makes fists (runtime)',
						shown(up, 'hand_l') === 'hand_l_fist' && shown(up, 'hand_r') === 'hand_r_fist',
					]
				: [
						'a missing fist leaves the hand open (runtime)',
						shown(up, 'hand_l') === 'hand_l_open' && shown(up, 'hand_r') === 'hand_r_open',
					],
		];
	},
};
for (const tpl of [BUST_FACE_V1, BUST_FACE, FULL_BODY])
	for (const [label, skip] of [
		['full art', []],
		['required parts only', tpl.parts.filter((p) => !p.required).map((p) => p.name)],
	]) {
		const rig = rigWith(skip, tpl);
		const animations = {};
		const r = F.faceAddStarterClips(animations, tpl, rig.has);
		ok(
			`${tpl.id} v${tpl.version} ${label}: every starter clip is added`,
			r.added.join() === tpl.clips.map((c) => c.name).join() && !r.kept.length,
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
			`${tpl.id} ${label}: clips swap only to images the rig has`,
			[...named].every((n) => !skip.includes(n)),
			[...named].filter((n) => skip.includes(n)).join(),
		);
		for (const c of tpl.clips) {
			const start = play(rig, animations[c.name], 0);
			ok(
				`${tpl.id} ${label} ${c.name}: lasts ${c.length} s (runtime)`,
				near(start.data.findAnimation('face').duration, c.length),
				String(start.data.findAnimation('face').duration),
			);
			// The runtime stores key times as float32 (0.2 → 0.2000000029) and clamps a finished clip to
			// that end, so the held end pose is read just past the length, as the game reaches it.
			for (const [when, p] of [
				['start', start],
				['end', play(rig, animations[c.name], c.length + EDGE)],
			]) {
				const off = atRest(tpl, rig, p);
				ok(
					`${tpl.id} ${label} ${c.name}: at rest at the ${when} (runtime)`,
					!off.length,
					off.join(' '),
				);
			}
		}
		for (const [what, cond] of extra[tpl.id](label, rig, animations))
			ok(`${tpl.id} ${label}: ${what}`, cond);
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

// 9. Lip-sync (T4): Rhubarb's real answer for a spoken line ("Welcome back, hero. Spin the reels,
// and may fortune favour you."; v1.14.0, English), keyed from the playhead at 0.5 s.
{
	const CUES = [
		[0, 0.22, 'X'],
		[0.22, 0.28, 'F'],
		[0.28, 0.62, 'C'],
		[0.62, 0.75, 'A'],
		[0.75, 1.02, 'C'],
		[1.02, 1.16, 'B'],
		[1.16, 1.37, 'X'],
		[1.37, 1.88, 'B'],
		[1.88, 2.75, 'X'],
		[2.75, 2.82, 'B'],
		[2.82, 2.9, 'A'],
		[2.9, 3.21, 'B'],
		[3.21, 3.28, 'C'],
		[3.28, 3.35, 'F'],
		[3.35, 4.05, 'B'],
		[4.05, 4.12, 'C'],
		[4.12, 4.25, 'B'],
		[4.25, 4.33, 'A'],
		[4.33, 4.47, 'C'],
		[4.47, 4.54, 'B'],
		[4.54, 4.68, 'G'],
		[4.68, 4.75, 'E'],
		[4.75, 5.24, 'F'],
		[5.24, 5.31, 'G'],
		[5.31, 5.45, 'C'],
		[5.45, 5.52, 'B'],
		[5.52, 5.59, 'G'],
		[5.59, 5.66, 'E'],
		[5.66, 5.94, 'F'],
		[5.94, 6.73, 'X'],
	].map(([start, end, value]) => ({ start, end, value }));
	const AT = 0.5;
	const mouth = chan('mouth');
	const map = mouth.shapes.lipsync;
	ok(
		'the template maps every Rhubarb shape',
		[...'ABCDEFGHX'].every((k) => map[k]),
		Object.keys(map ?? {}).join(),
	);
	const rig = rigWith();
	const anim = {};
	// Keys a line must keep (before and after it) and ones it must replace (under it).
	F.faceKeyShape(anim, mouth, 'mouth_wide', 0.2, channels, rig.has);
	F.faceKeyTalk(anim, mouth, 1, 2, channels, rig.has);
	F.faceKeyShape(anim, mouth, 'mouth_smile', 8, channels, rig.has);
	F.faceKeyChannel(anim, chan('head_tilt'), 3, 2, rig.has);
	const n = F.faceKeyLipSync(anim, mouth, CUES, AT, channels, rig.has);
	const keyed = anim.slots.mouth.attachment.filter((k) => k.time >= AT && k.time <= AT + 6.73);
	ok(
		'a run of cues on one image is one key',
		n === keyed.length && keyed.every((k, i) => i === 0 || k.name !== keyed[i - 1].name),
		`${n} / ${keyed.map((k) => k.name).join()}`,
	);
	ok(
		'no talk key survives under the line',
		keyed.every((k) =>
			CUES.some((c) => Math.abs(AT + c.start - k.time) < 1e-3 && map[c.value] === k.name),
		),
		keyed.map((k) => `${k.time}:${k.name}`).join(' '),
	);
	ok('the line ends on the rest shape', keyed[keyed.length - 1].name === 'mouth_rest');
	const jawKeys = anim.bones.jaw.translate.filter((k) => k.time >= AT && k.time <= AT + 6.73);
	const cornerKeys = anim.bones.mouth_corner_l.translate.filter(
		(k) => k.time >= AT && k.time <= AT + 6.73,
	);
	ok(
		'no talk corner key survives under the line: the corners follow the cues',
		cornerKeys.length === keyed.length &&
			cornerKeys.every((k, i) => near(k.time, keyed[i].time, 1e-4)),
		cornerKeys.map((k) => k.time).join(),
	);
	ok(
		'no talk jaw key survives under the line',
		jawKeys.length === keyed.length && jawKeys.every((k, i) => near(k.time, keyed[i].time, 1e-4)),
		jawKeys.map((k) => k.time).join(),
	);
	const cut = {};
	F.faceKeyLipSync(cut, mouth, CUES.slice(0, 5), 0, channels, rig.has);
	ok(
		'a line cut off mid-word still closes on rest at its end (runtime)',
		shown(play(rig, cut, 1.02 + EDGE), 'mouth') === 'mouth_rest' &&
			near(boneOff(play(rig, cut, 1.02 + EDGE), 'jaw', 'y'), 0),
		String(shown(play(rig, cut, 1.02 + EDGE), 'mouth')),
	);
	ok(
		'keys outside the line are kept',
		shown(play(rig, anim, 0.2 + EDGE), 'mouth') === 'mouth_wide' &&
			shown(play(rig, anim, 8 + EDGE), 'mouth') === 'mouth_smile',
	);
	ok(
		'other channels under the line are kept',
		near(boneOff(play(rig, anim, 2), 'head', 'rotate'), 3, 0.01),
		String(boneOff(play(rig, anim, 2), 'head', 'rotate')),
	);
	let prev;
	for (const c of CUES) {
		const part = map[c.value];
		if (part === prev) continue;
		prev = part;
		const t = AT + c.start;
		const p = play(rig, anim, t + EDGE);
		ok(
			`lip-sync ${c.value} at ${t.toFixed(2)}s shows ${part} (runtime)`,
			shown(p, 'mouth') === part,
			String(shown(p, 'mouth')),
		);
		ok(
			`lip-sync ${c.value} at ${t.toFixed(2)}s opens the jaw for ${part} (runtime)`,
			near(boneOff(play(rig, anim, t), 'jaw', 'y'), JAW * mouth.shapes.open[part]),
			String(boneOff(play(rig, anim, t), 'jaw', 'y')),
		);
	}
	// On required parts only (rest, A, O), every letter still lands on an image the rig has, by
	// nearest jaw opening: B/C/H (E, 0.5) → O, F (U, 0.5) → O, G (FV, 0.3) and A (MBP) → rest.
	const lean = rigWith(BUST_FACE.parts.filter((p) => !p.required).map((p) => p.name));
	const sparse = {};
	F.faceKeyLipSync(sparse, mouth, CUES, 0, channels, lean.has);
	const names = new Set(sparse.slots.mouth.attachment.map((k) => k.name));
	ok(
		'on required parts only, lip-sync keys only images the rig has',
		[...names].every((x) => ['mouth_rest', 'mouth_A', 'mouth_O'].includes(x)),
		[...names].join(),
	);
	ok(
		'a missing E (from C) falls back to O (runtime)',
		shown(play(lean, sparse, 0.28 + EDGE), 'mouth') === 'mouth_O',
	);
	ok(
		'a missing MBP (from A) falls back to rest (runtime)',
		shown(play(lean, sparse, 0.62 + EDGE), 'mouth') === 'mouth_rest',
	);
	ok('an empty answer keys nothing', F.faceKeyLipSync({}, mouth, [], 0, channels, rig.has) === 0);
}

// 6. A template saved from a rig (📐 Save as template, T8): rebuilt over art, its controls key and
//    pose through the same page code, and its own clip (kept as timelines) plays as authored; an
//    image key whose part the art lacks shows nothing rather than naming a missing attachment.
{
	const src = templateRig(BUST_FACE, regionsFor([], BUST_FACE)).skeleton;
	const nod = {
		bones: { neck: { rotate: [{ value: 0 }, { time: 0.4, value: 6 }, { time: 0.8, value: 0 }] } },
		slots: {
			mouth: {
				attachment: [
					{ time: 0.1, name: 'mouth_O' },
					{ time: 0.3, name: 'mouth_wide' },
					{ time: 0.6, name: 'mouth_rest' },
				],
			},
		},
	};
	const derived = rigTemplateFromRig(
		{ ...src, animations: { nod } },
		{
			label: 'Mine',
			required: BUST_FACE.parts.filter((p) => p.required).map((p) => p.name),
			channels: BUST_FACE.channels,
			clips: ['nod'],
			motion: null,
		},
		'mine',
		1,
	);
	ok('saved: the bust-face rig derives a template', typeof derived === 'object', String(derived));
	const saved = derived.template;
	const rig = rigWith([], saved);
	let posed = 0;
	for (const ch of saved.channels.filter((c) => !c.shapes)) {
		const anim = {};
		F.faceKeyChannel(anim, ch, ch.min, 0, rig.has);
		F.faceKeyChannel(anim, ch, ch.max, 1, rig.has);
		for (const [t, v] of [
			[0, ch.min],
			[1, ch.max],
		]) {
			const p = play(rig, anim, t);
			for (const d of ch.drives ?? []) {
				const want = d.prop.startsWith('scale') ? 1 + v * d.per : v * d.per;
				posed++;
				ok(
					`saved ${ch.id} poses ${d.bone}.${d.prop} = ${want.toFixed(3)} at ${t}s (runtime)`,
					near(boneOff(p, d.bone, d.prop), want, 0.02),
					String(boneOff(p, d.bone, d.prop)),
				);
			}
			if (ch.swaps) {
				const want = [...ch.swaps].reverse().find((w) => w.at <= v + 1e-9).part;
				ok(`saved ${ch.id} shows ${want} at ${t}s (runtime)`, shown(p, ch.slot) === want);
			}
		}
	}
	ok('saved: every drive of every control was posed', posed > 20, String(posed));
	const mouthCh = saved.channels.find((c) => c.shapes);
	const shapeAnim = {};
	F.faceKeyShape(shapeAnim, mouthCh, 'mouth_A', 0, saved.channels, rig.has);
	const sp = play(rig, shapeAnim, EDGE);
	ok(
		'saved mouth shape shows mouth_A and opens the jaw (runtime)',
		shown(sp, 'mouth') === 'mouth_A' && near(boneOff(sp, 'jaw', 'y'), JAW),
		`${shown(sp, 'mouth')} ${boneOff(sp, 'jaw', 'y')}`,
	);
	const anims = {};
	const added = F.faceAddStarterClips(anims, saved, rig.has);
	ok('saved: 🎬 adds the template’s own clip', added.added.join() === 'nod', added.added.join());
	ok(
		'saved clip turns the neck as authored (runtime)',
		near(boneOff(play(rig, anims.nod, 0.4), 'neck', 'rotate'), 6, 0.01),
		String(boneOff(play(rig, anims.nod, 0.4), 'neck', 'rotate')),
	);
	const mouths = (r, a) => [0.1, 0.3, 0.6].map((t) => shown(play(r, a, t + EDGE), 'mouth')).join();
	ok(
		'saved clip swaps the mouth as authored (runtime)',
		mouths(rig, anims.nod) === 'mouth_O,mouth_wide,mouth_rest',
		mouths(rig, anims.nod),
	);
	const lean = rigWith(
		saved.parts.filter((p) => !p.required).map((p) => p.name),
		saved,
	);
	const leanAnims = {};
	F.faceAddStarterClips(leanAnims, saved, lean.has);
	ok(
		'on needed-only art the clip names no missing image: it shows nothing there',
		mouths(lean, leanAnims.nod) === 'mouth_O,,mouth_rest' &&
			leanAnims.nod.slots.mouth.attachment.every((k) => !k.name || lean.has('mouth', k.name)),
		JSON.stringify(leanAnims.nod.slots.mouth.attachment),
	);
	ok(
		'the template’s own clip is never changed by adding it',
		saved.clips[0].animation.slots.mouth.attachment[1].name === 'mouth_wide',
	);
}

if (fails) {
	console.error(`face channels:${fails} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`face channels: ${checks}/${checks} checks pass`);
