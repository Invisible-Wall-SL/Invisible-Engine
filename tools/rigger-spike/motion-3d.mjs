// Verify the motion import in 3D (2.5D P4, docs/design/rig-2p5d.md §8) headlessly, on the SHIPPED
// code: the solver is `src/lib/rigMotion.ts` + `rigMotion3d.ts` + `rig3dMath.ts`, the templates are
// the real `half-body`, `full-body` and `bust-face`, the 2D controls are keyed by the page's
// `faceKeyMotion` pulled out of view.html, the import into the sidecar and its bake are
// `src/lib/rig3dImport.ts` (the save's own `rig3d.ts` / `rig2p5d.ts`), and every result is read by
// the strict irig reader and posed by engine-rig — what the GAME shows. The tracks come from a
// synthetic performer (`performer3d.mjs`) whose true 3D pose is known. Asserted:
//  - the templates: 2.5D versions (Bust with face 4, Full body 3, Half body 3) with their 3D setup,
//    the control bones with no slot or constraint, the head's image on an image bone; the validator
//    refuses a malformed 3D map (two readings, a child before its parent, a roll with a line across
//    it, a kept control turning a 3D bone, an unreplaced draw-order control, a split layer, a drawing
//    that is not a part);
//  - the solve: each bone's world turn as solved carries its rest direction onto the performer's
//    within 0.5°; both limbs of an arm are `orient` keys, rolled to face the viewer; the controls it
//    replaces are not keyed, the face and the fingers still are;
//  - posed by engine-rig after the bake: every limb points where the performer's does in the picture
//    and is as SHORT as it is (the third axis: an arm tilted 0–75° toward the camera), within 1.5° and
//    0.03 of its length; a limb's image keeps its full width (rolled to face the viewer) while it
//    shortens; a hand reaching in front of the face is drawn over the head, one behind the back under
//    the torso; a head turned 25° and nodded slides its face, nose and hair by their depths while its
//    outline stays square; the body turned 50° and 80° shows the ¾ and side torso, square to the
//    viewer, and the front again at 10° (and the front, narrowing, on art without them); a hand,
//    like a limb, rolls to face the viewer whichever way its palm turns; an arm straightening and
//    bending again turns smoothly (no spin about its length);
//  - the bake the page runs is the save's: re-baking the sidecar the import wrote, as the save does,
//    gives the same irig; it owns the bones turned in 3D or at a depth and not those lying flat in
//    their parent's card (fingers, eyes, the limbs' images), whose 2D keys stay as written; the
//    sidecar passes its schema and fits its irig; no run is unmet;
//  - a second import later in the clip keeps the first's keys before it; a 2D clip's turns become
//    `orient` keys around an import; Full body turns its legs and its feet face the viewer;
//    Bust with face turns only its head.
//   node tools/rigger-spike/motion-3d.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, readIrig } = RIG;

const dir = mkdtempSync(join(tmpdir(), 'motion-3d-'));
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
const T = await bundle('src/lib/server/rigTemplates.ts', 'templates.mjs');
const { solveMotion } = await bundle('src/lib/rigMotion.ts', 'motion.mjs');
const I = await bundle('src/lib/rig3dImport.ts', 'import.mjs');
const S3 = await bundle('src/lib/rig3d.ts', 'rig3d.mjs');
const B = await bundle('src/lib/rig2p5d.ts', 'bake.mjs');

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
			'faceAttachmentAt',
			'faceKeyAttachment',
			'faceChannelValue',
			'faceKeyChannel',
			'faceShapePart',
			'faceShapeControls',
			'faceKeyShape',
			'faceKeyMotion',
			'face3dReplaced',
		].map(grabFn),
		'return { faceKeyMotion, face3dReplaced };',
	].join('\n'),
)();
/** The Rigger's Animate-mode pose (view.html `poseAtTime`) of one clip on an engine-rig skeleton. */
const pagePose = new Function(
	[
		grabConst('BONE_AXIS_TIMELINES'),
		...[
			'bezierValue',
			'sampleChannel',
			'drawOrderOfOffsets',
			'reconstructDrawOrder',
			'poseAtTime',
		].map(grabFn),
		'let skeleton = null;',
		'let skeletonData = null;',
		'let clip = null;',
		'const meshCtx = null;',
		'const animOf = () => clip;',
		'return (skel, anim, t) => { skeleton = skel; skeletonData = skel.data; clip = anim; poseAtTime("imp", t); };',
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
const DEG = 180 / Math.PI;
const FPS = 24;
const fold = (d) => d - 360 * Math.round(d / 360);

function rigWith(tpl, skip = []) {
	const regions = tpl.parts
		.filter((p) => !skip.includes(p.name))
		.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = T.templateRig(tpl, regions);
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
		atlas: `${lines.join('\n')}\n`,
	};
}

/**
 * Import a track into clip `clip` at `at` as the page does: the 3D solve, the 2D controls keyed into
 * the clip as its author sees it, then the import into the sidecar and the bake.
 */
function import3d(rig, track, { at = 0, clip = 'imp', irig = rig.skeleton, doc = null } = {}) {
	const tpl = rig.tpl;
	const solved = solveMotion(
		{ bones: tpl.bones, channels: tpl.channels, motion: tpl.motion },
		track,
		{
			three: true,
			trace: true,
		},
	);
	const { animation, orient } = I.authoringOf(irig, doc, clip);
	F.faceKeyMotion(animation, solved.keys, at, tpl.channels, rig.has, rig.setup);
	const out = I.importClip3d({
		irig,
		doc,
		stem: 'hero',
		template: tpl.rig3d,
		clip,
		animation,
		orient,
		keys: solved.bones3d,
		at,
		length: solved.length,
		replaced: F.face3dReplaced(tpl),
	});
	return { solved, ...out };
}

function poser(rig, irig, clip = 'imp') {
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(irig)),
	);
	return (t) => {
		const skel = new Skeleton(data);
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, clip, false);
		state.update(t);
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
const bw = (skel, n) => skel.findBone(n);
const wpos = (skel, n) => [bw(skel, n).worldX, bw(skel, n).worldY];
/** A bone's limb in the picture: from it to its child, as an angle (0 = down) and a length. */
function limb(skel, from, to) {
	const a = wpos(skel, from);
	const b = wpos(skel, to);
	return {
		angle: Math.atan2(b[0] - a[0], -(b[1] - a[1])) * DEG,
		len: Math.hypot(b[0] - a[0], b[1] - a[1]),
	};
}
/** The performer's limb in the picture: angle (0 = down) and its share of its 3D length. */
function truth(v) {
	return { angle: Math.atan2(v[0], -v[1]) * DEG, ratio: Math.hypot(v[0], v[1]) / Math.hypot(...v) };
}
/** How wide a bone draws its art across its own x (1 = as drawn), and along its y. */
const widths = (skel, n) => {
	const b = bw(skel, n);
	return [Math.hypot(b.a, b.c), Math.hypot(b.b, b.d)];
};
const drawn = (skel) => skel.drawOrder.map((s) => s.data.name);
const shown = (skel, slot) => skel.findSlot(slot).getAttachment()?.name ?? null;
const hold = (n, pose, opts = {}) => P.track(n, FPS, () => ({ pose, opts }));

// ── the templates ───────────────────────────────────────────────────────────────────────────────
const byId = Object.fromEntries(T.RIG_TEMPLATES.map((t) => [t.id, t]));
ok(
	'templates: Bust with face 4, Full body 3, Half body 3',
	byId['bust-face'].version === 4 &&
		byId['full-body'].version === 3 &&
		byId['half-body'].version === 3,
);
for (const t of T.RIG_TEMPLATES) {
	ok(`${t.id}: valid`, T.rigTemplateProblem(t) === null, String(T.rigTemplateProblem(t)));
	ok(
		`${t.id}: a 3D setup with a side turnaround and a 3D map`,
		t.rig3d?.turnaround === 'side' && !!t.motion?.bones3d?.entries.length,
	);
	ok(
		`${t.id}: the head drawn on its own image bone`,
		t.slots.find((s) => s.name === 'head')?.bone === 'head_image',
	);
}
for (const [id, controls] of [
	[
		'half-body',
		[
			'hand_ik_l',
			'hand_ik_r',
			'hand_ik_l_chest',
			'hand_ik_l_world',
			'elbow_pole_l',
			'elbow_pole_r',
		],
	],
	[
		'full-body',
		['hand_ik_l', 'elbow_pole_r', 'foot_ik_l', 'foot_ik_r_world', 'knee_pole_l', 'knee_pole_r'],
	],
]) {
	const t = byId[id];
	const rig = T.templateRig(
		t,
		t.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] })),
	).skeleton;
	for (const c of controls) {
		ok(
			`${id}: control bone ${c}`,
			rig.bones.some((b) => b.name === c),
		);
		ok(`${id}: ${c} has no slot`, !rig.slots.some((s) => s.bone === c));
	}
	ok(`${id}: no constraint`, !rig.ik && !rig.transform && !rig.path && !rig.physics);
}
{
	const hb = byId['half-body'];
	const hand = (t) => ({
		...hb,
		motion: { ...hb.motion, bones3d: { ...hb.motion.bones3d, ...t } },
	});
	const entries = hb.motion.bones3d.entries;
	const bad = [
		[
			'two readings',
			hand({ entries: entries.map((e) => (e.bone === 'head' ? { ...e, viewer: 'square' } : e)) }),
		],
		[
			'a child before its parent',
			hand({
				entries: [
					...entries.filter((e) => e.bone !== 'upper_arm_l'),
					entries.find((e) => e.bone === 'upper_arm_l'),
				],
			}),
		],
		[
			'a roll with a line across',
			hand({
				entries: entries.map((e) => (e.bone === 'torso_image' ? { ...e, roll: 'viewer' } : e)),
			}),
		],
		[
			'a reach past 180°',
			hand({ entries: entries.map((e) => (e.bone === 'spine' ? { ...e, reach: 200 } : e)) }),
		],
		[
			'a kept control turning a 3D bone',
			hand({ replaces: hb.motion.bones3d.replaces.filter((c) => c !== 'elbow_l') }),
		],
		[
			'an unreplaced draw-order control',
			hand({ replaces: hb.motion.bones3d.replaces.filter((c) => c !== 'depth_r') }),
		],
		['a split layer', { ...hb, rig3d: { ...hb.rig3d, layers: { x: ['torso', 'head'] } } }],
		[
			'a drawing that is not a part',
			{ ...hb, rig3d: { ...hb.rig3d, views: { torso: [{ attachment: 'head', turn: 0 }] } } },
		],
	];
	for (const [what, t] of bad) ok(`validator refuses ${what}`, T.rigTemplateProblem(t) !== null);
}

// ── Half body: a known pose, solved and posed ───────────────────────────────────────────────────
const HB = rigWith(byId['half-body']);
const REACH = {
	body: { yaw: 0 },
	arms: {
		l: {
			upper: P.dir(25, 35),
			lower: P.dir(70, 55),
			palm: { along: P.dir(70, 55), across: [1, 0.2, 0.3] },
		},
		r: { upper: P.dir(-15, -20), lower: P.dir(-40, 30) },
	},
};
{
	const tr = hold(24, REACH, { hands: true, face: P.ry(0) });
	const { solved, irig, doc, bake, plan } = import3d(HB, tr);
	const keys = solved.bones3d;
	ok(
		'solve: both limbs of an arm keyed as orient',
		keys.upper_arm_l?.orient?.length > 0 && keys.lower_arm_l?.orient?.length > 0,
	);
	ok(
		'solve: the limbs’ images not keyed (they lie flat on the limbs)',
		!keys.upper_arm_l_image && !keys.lower_arm_r_image,
	);
	ok(
		'solve: replaced controls not keyed',
		!solved.keys.some((k) => HB.tpl.motion.bones3d.replaces.includes(k[1])),
		solved.keys
			.filter((k) => HB.tpl.motion.bones3d.replaces.includes(k[1]))
			.map((k) => k[1])
			.join(),
	);
	ok(
		'solve: fingers still keyed in 2D',
		solved.keys.some((k) => /^curl_index_/.test(k[1])),
	);
	// The solved world turn carries each bone's rest direction onto the performer's.
	const W = solved.solved3d.worlds;
	const pts = P.points(REACH);
	for (const [bone, rest, a, b] of [
		['upper_arm_l', [0, -1, 0], 12, 14],
		['lower_arm_l', [0, -1, 0], 14, 16],
		['upper_arm_r', [0, -1, 0], 11, 13],
		['lower_arm_r', [0, -1, 0], 13, 15],
	]) {
		const m = W[bone][10];
		const got = [0, 1, 2].map(
			(r) => m[r * 3] * rest[0] + m[r * 3 + 1] * rest[1] + m[r * 3 + 2] * rest[2],
		);
		const want = P.norm(P.sub(pts[b], pts[a]));
		const err = Math.acos(Math.min(1, P.dot(got, want))) * DEG;
		ok(`solve: ${bone} turned onto the performer's limb in 3D`, err < 0.5, `${err.toFixed(2)}°`);
	}
	ok(
		'bake: every run within the tolerance',
		bake.report.unmet.length === 0,
		JSON.stringify(bake.report.unmet.slice(0, 3)),
	);
	ok(
		'irig: read by the strict reader',
		(() => {
			try {
				readIrig(JSON.stringify(irig));
				return true;
			} catch (e) {
				console.error(e);
				return false;
			}
		})(),
	);
	ok(
		'sidecar: passes its schema',
		S3.rig3dDocProblems(doc).length === 0,
		S3.rig3dDocProblems(doc).join('; '),
	);
	ok(
		'sidecar: fits its irig',
		S3.rig3dIrigProblems(doc, irig).length === 0,
		S3.rig3dIrigProblems(doc, irig).join('; '),
	);
	ok(
		'sidecar: the template turnaround and depths',
		doc.turnaround === 'side' &&
			doc.bones?.face?.depth === 95 &&
			doc.bones?.hair_back?.depth === -100,
	);
	// The save's bake of this sidecar on this irig writes the same clip the import did.
	const rig = S3.rigOf(irig, doc);
	const again = S3.clipOf(rig, irig, doc, 'imp');
	const rebaked = S3.withBake(irig, 'imp', again, B.bake2p5d(rig, again.clip), S3.followersOf(doc));
	const parts = (x) =>
		S3.canonicalJson(S3.bakedParts(x, 'imp', { bones: plan.owned, slots: plan.slots }, []));
	ok('the page bakes what the save bakes', parts(rebaked) === parts(irig));
	ok(
		'the save owns the bones turned in 3D or set at a depth',
		['upper_arm_l', 'lower_arm_l', 'hand_l', 'face', 'nose', 'hair_back'].every((b) =>
			again.owned.includes(b),
		),
		again.owned.join(),
	);
	ok(
		'…and not the bones flat in their parent’s card (fingers, eyes, neck, the limbs’ images)',
		![
			'index_1_l',
			'thumb_2_r',
			'eye_l',
			'pupil_l',
			'neck',
			'upper_arm_l_image',
			'lower_arm_r_image',
		].some((b) => again.owned.includes(b)),
	);
	const curl = irig.animations.imp.bones?.index_1_l?.scale;
	ok(
		'a flat finger keeps the 2D curl keys the import wrote',
		Array.isArray(curl) && curl.length > 0 && !irig.animations.imp.bones.index_1_l.sheary,
	);

	const pose = poser(HB, irig)(0.5);
	for (const [bone, child, a, b] of [
		['upper_arm_l', 'lower_arm_l', 12, 14],
		['lower_arm_l', 'hand_l', 14, 16],
		['upper_arm_r', 'lower_arm_r', 11, 13],
		['lower_arm_r', 'hand_r', 13, 15],
	]) {
		const got = limb(pose, bone, child);
		const want = truth(P.sub(pts[b], pts[a]));
		const c = HB.tpl.bones.find((x) => x.name === child);
		const full = Math.hypot(c.x, c.y);
		ok(
			`posed: ${bone} points where the performer's does`,
			Math.abs(fold(got.angle - want.angle)) < 1.5,
			`${got.angle.toFixed(1)} vs ${want.angle.toFixed(1)}`,
		);
		ok(
			`posed: ${bone} as short as the performer's (third axis)`,
			Math.abs(got.len / full - want.ratio) < 0.03,
			`${(got.len / full).toFixed(3)} vs ${want.ratio.toFixed(3)}`,
		);
	}
	const [across, along] = widths(pose, 'lower_arm_l_image');
	ok(
		'posed: a forearm turned toward the camera keeps its full width',
		across > 0.98 && across < 1.02,
		across.toFixed(3),
	);
	ok(
		'posed: …and shortens along its length',
		Math.abs(along - truth(P.sub(pts[16], pts[14])).ratio) < 0.03,
		`${along.toFixed(3)}`,
	);
}

// The arm swept toward the camera: its picture length follows cos of the tilt.
{
	const tr = P.track(48, FPS, (i) => ({
		pose: { arms: { l: { upper: P.dir(40, (75 * i) / 47), lower: P.dir(40, (75 * i) / 47) } } },
		opts: { hands: true, face: P.ry(0) },
	}));
	const { irig } = import3d(HB, tr);
	const at = poser(HB, irig);
	let worst = 0;
	let worstW = 0;
	for (const i of [0, 12, 24, 36, 47]) {
		const tilt = (75 * i) / 47;
		const got = limb(at(i / FPS), 'upper_arm_l', 'lower_arm_l');
		worst = Math.max(worst, Math.abs(got.len / 190 - Math.cos(tilt / DEG)));
		worstW = Math.max(worstW, Math.abs(widths(at(i / FPS), 'upper_arm_l_image')[0] - 1));
	}
	ok(
		'sweep: the upper arm shortens as cos of its tilt toward the camera (0–75°)',
		worst < 0.03,
		worst.toFixed(3),
	);
	ok('sweep: its image keeps its full width all the way', worstW < 0.02, worstW.toFixed(3));
}

// The Rigger draws the import as the game plays it. Animate mode poses a clip with the page's own
// `poseAtTime`, not engine-rig's AnimationState, and a hand under a forearm turned toward the camera
// is keyed with a shear (the bake's `sheary`, its parent's foreshortening undone): a pose without
// it drew each hand's fingers up to 685 rig units from the hand on real footage.
{
	// Both hands up in front of the chest, the forearms toward the camera and the hands bent back at
	// the wrist (the owner's gesture), sweeping for a second.
	const tr = P.track(24, FPS, (i) => {
		const u = i / 23;
		const arm = (k, upper, lower, palm) => ({
			upper: P.dir(k * upper, 15),
			lower: P.dir(k * lower[0], lower[1]),
			palm: { along: P.dir(k * palm, 10), across: [0, 0, 1] },
		});
		return {
			pose: {
				arms: {
					l: arm(1, 25, [150 - 50 * u, 40 + 25 * u], 200 - 30 * u),
					r: arm(-1, 20, [160 - 40 * u, 60 - 20 * u], 190 - 40 * u),
				},
			},
			opts: { hands: true, face: P.ry(0) },
		};
	});
	const { irig } = import3d(HB, tr);
	const shear = (b) =>
		Math.max(
			0,
			...(irig.animations.imp.bones?.[b]?.sheary ?? []).map((k) => Math.abs(k.value ?? 0)),
		);
	ok(
		'page pose: the bake skews each hand under its forearm turned toward the camera (≥ 20°)',
		shear('hand_l') >= 20 && shear('hand_r') >= 20,
		`${shear('hand_l').toFixed(1)}°, ${shear('hand_r').toFixed(1)}°`,
	);
	const atlas = new TextureAtlas(HB.atlas);
	for (const p of atlas.pages)
		p.setTexture({
			getImage: () => ({ width: 1, height: 1 }),
			setFilters() {},
			setWraps() {},
			dispose() {},
		});
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(irig)),
	);
	const game = poser(HB, irig);
	let worst = { d: 0 };
	let detached = 0;
	for (let i = 0; i <= 46; i++) {
		const t = i / (2 * FPS) + 1e-4;
		const g = game(t);
		const page = new Skeleton(data);
		page.setToSetupPose();
		pagePose(page, irig.animations.imp, t);
		page.updateWorldTransform(Physics.update);
		for (const b of g.bones) {
			const q = page.findBone(b.data.name);
			const d = Math.hypot(b.worldX - q.worldX, b.worldY - q.worldY);
			if (d > worst.d) worst = { d, bone: b.data.name, t };
		}
		for (const s of ['l', 'r']) {
			const end = { x: 0, y: HB.tpl.bones.find((b) => b.name === `hand_${s}`).y };
			page.findBone(`lower_arm_${s}`).localToWorld(end);
			const hand = page.findBone(`hand_${s}`);
			detached = Math.max(detached, Math.hypot(hand.worldX - end.x, hand.worldY - end.y));
		}
	}
	ok(
		'page pose: every bone (the fingers, the face) where engine-rig puts it, through the clip (within 0.25)',
		worst.d < 0.25,
		`${worst.bone} ${worst.d.toFixed(2)} at ${worst.t?.toFixed(3)} s`,
	);
	ok(
		'page pose: each hand where its forearm ends (within the bake’s tolerance)',
		detached < 1,
		detached.toFixed(3),
	);
}

// In front of the face, behind the back.
{
	const front = { arms: { l: { upper: P.dir(150, 50), lower: P.dir(200, 55) } } };
	const back = { arms: { l: { upper: P.dir(15, -50), lower: P.dir(60, -40) } } };
	for (const [what, pose, check] of [
		[
			'a hand reaching in front of the face is drawn over the head',
			front,
			(d) =>
				d.indexOf('hand_l') > d.indexOf('mouth') && d.indexOf('hand_l') > d.indexOf('hair_front'),
		],
		[
			'a hand behind the back is drawn under the torso',
			back,
			(d) => d.indexOf('hand_l') < d.indexOf('torso'),
		],
	]) {
		const { irig } = import3d(HB, hold(24, pose, { hands: true, face: P.ry(0) }));
		const d = drawn(poser(HB, irig)(0.5));
		ok(what, check(d), d.join(' '));
		ok(
			`${what}: its fingers stay with the hand, in their order`,
			d.indexOf('thumb_3_l') - d.indexOf('hand_l') === 15,
		);
	}
}

// The tracker's 3D points turned 8° in the picture from its picture points (as on real footage):
// a limb points where the PICTURE's does, its depth from the 3D points.
{
	const pose = { arms: { l: { upper: P.dir(40, 30), lower: P.dir(80, 20) } } };
	const { irig } = import3d(HB, hold(24, pose, { hands: true, face: P.ry(0), skew: 8 }));
	const at = poser(HB, irig)(0.5);
	const pts = P.points(pose);
	const got = limb(at, 'upper_arm_l', 'lower_arm_l');
	const want = truth(P.sub(pts[14], pts[12]));
	ok(
		'3D points that disagree with the picture: the arm follows the picture',
		Math.abs(fold(got.angle - want.angle)) < 1.5,
		`${got.angle.toFixed(1)} vs ${want.angle.toFixed(1)}`,
	);
	ok(
		'…and still shortens by its depth',
		Math.abs(got.len / 190 - want.ratio) < 0.04,
		`${(got.len / 190).toFixed(3)} vs ${want.ratio.toFixed(3)}`,
	);
}

// The head: turned 25° and nodded 12° by the face's 3D pose, from a performer whose head rests turned
// 10° (read against that neutral).
{
	const still = poser(HB, import3d(HB, hold(30, {}, { face: P.ry(10) })).irig)(0.5);
	const turn = P.mm(P.ry(25), P.rx(-12));
	const tr = P.track(60, FPS, (i) => ({
		pose: {},
		opts: { face: i < 30 ? P.ry(10) : P.mm(turn, P.ry(10)) },
	}));
	const { irig } = import3d(HB, tr);
	const head = poser(HB, irig)(50 / FPS);
	const dx = (n) => wpos(head, n)[0] - wpos(still, n)[0];
	// Each part's place on the head (from the head bone) and its depth, turned as the face is.
	const moved = (p) => P.ap(turn, p)[0];
	ok(
		'head: the face slides by its depth (95 in front)',
		Math.abs(dx('face') - moved([0, 90, 95])) < 1.5,
		`${dx('face').toFixed(1)} vs ${moved([0, 90, 95]).toFixed(1)}`,
	);
	ok(
		'head: the nose further (25 more)',
		Math.abs(dx('nose') - moved([0, 80, 120])) < 1.5,
		`${dx('nose').toFixed(1)} vs ${moved([0, 80, 120]).toFixed(1)}`,
	);
	ok(
		'head: the back hair the other way (100 behind)',
		Math.abs(dx('hair_back') - moved([0, 120, -100])) < 1.5,
		`${dx('hair_back').toFixed(1)} vs ${moved([0, 120, -100]).toFixed(1)}`,
	);
	ok(
		'head: the nod moves the face up or down',
		Math.abs(wpos(head, 'face')[1] - wpos(still, 'face')[1]) > 10,
	);
	const [hx, hy] = widths(head, 'head_image');
	ok(
		'head: its outline stays square to the viewer',
		Math.abs(hx - 1) < 0.01 && Math.abs(hy - 1) < 0.01,
		`${hx.toFixed(3)} ${hy.toFixed(3)}`,
	);
	ok(
		'head: an eye narrows as the face turns',
		Math.abs(widths(head, 'eye_l')[0] - Math.cos(25 / DEG)) < 0.02,
		widths(head, 'eye_l')[0].toFixed(3),
	);
}

// The body turned: the torso's drawings by angle.
for (const [yaw, want, rigOf] of [
	[10, 'torso', HB],
	[50, 'torso_3q_r', HB],
	[80, 'torso_side_r', HB],
	[-50, 'torso_3q_l', HB],
]) {
	const tr = P.track(36, FPS, (i) => ({
		pose: { body: { yaw: i < 6 ? 0 : yaw } },
		opts: { face: P.ry(0) },
	}));
	const at = poser(rigOf, import3d(rigOf, tr).irig)(30 / FPS);
	ok(`body turned ${yaw}°: shows ${want}`, shown(at, 'torso') === want, shown(at, 'torso'));
	if (want !== 'torso')
		ok(
			`body turned ${yaw}°: ${want} square to the viewer`,
			widths(at, 'torso_image')[0] > 0.95,
			widths(at, 'torso_image')[0].toFixed(3),
		);
}
{
	const plain = rigWith(byId['half-body'], [
		'torso_3q_l',
		'torso_3q_r',
		'torso_side_l',
		'torso_side_r',
	]);
	const tr = P.track(36, FPS, (i) => ({
		pose: { body: { yaw: i < 6 ? 0 : 50 } },
		opts: { face: P.ry(0) },
	}));
	const { irig, doc } = import3d(plain, tr);
	const at = poser(plain, irig)(30 / FPS);
	ok('art without ¾ torsos: no drawings by angle', !doc.views);
	ok(
		'art without ¾ torsos: the front narrows as a card (cos 50°)',
		shown(at, 'torso') === 'torso' &&
			Math.abs(widths(at, 'torso_image')[0] - Math.cos(50 / DEG)) < 0.03,
		widths(at, 'torso_image')[0].toFixed(3),
	);
}

// A palm turned to the camera shows the hand's back (mirrored); a straightening arm keeps its plane.
{
	const palm = {
		arms: {
			l: { upper: P.dir(0), lower: P.dir(0), palm: { along: P.dir(0), across: [-1, 0, 0] } },
		},
	};
	const at = poser(HB, import3d(HB, hold(24, palm, { hands: true, face: P.ry(0) })).irig)(0.5);
	const h = bw(at, 'hand_l');
	ok(
		'a palm turned to the camera: the hand still rolls to face the viewer (its palm turn is drawings by angle’s)',
		h.a * h.d - h.b * h.c > 0 && widths(at, 'hand_l')[0] > 0.98,
	);
	const tr = P.track(72, FPS, (i) => {
		const bend = 60 * Math.abs(Math.cos((i / 71) * Math.PI));
		return {
			pose: {
				arms: {
					l: {
						upper: P.dir(10, 30),
						lower: P.mul(
							P.add(
								P.mul(P.dir(10, 30), Math.cos(bend / DEG)),
								P.mul(P.norm([0.3, 0.5, 0.8]), Math.sin(bend / DEG)),
							),
							1,
						),
					},
				},
			},
			opts: { hands: true, face: P.ry(0) },
		};
	});
	const { solved } = import3d(HB, tr);
	const step = (qs) =>
		Math.max(
			...qs
				.slice(1)
				.map(
					(q, i) =>
						2 *
						Math.acos(Math.min(1, Math.abs(P.dot(q.slice(1), qs[i].slice(1)) + q[0] * qs[i][0]))) *
						DEG,
				),
		);
	ok(
		'an arm straightening and bending again: the forearm turns smoothly',
		step(solved.solved3d.turns.lower_arm_l) < 5,
		step(solved.solved3d.turns.lower_arm_l).toFixed(1),
	);
	ok(
		'…and the upper arm does not spin about its length',
		step(solved.solved3d.turns.upper_arm_l) < 5,
		step(solved.solved3d.turns.upper_arm_l).toFixed(1),
	);
}

// A body found upside down (a camera cut) is past the spine's reach: held, and reported.
{
	const tr = P.track(36, FPS, (i) => ({
		pose: { body: { lean: i >= 12 && i < 18 ? 180 : 0 } },
		opts: { face: P.ry(0) },
	}));
	const { solved, irig } = import3d(HB, tr);
	const at = poser(HB, irig)(15 / FPS);
	ok(
		'a body upside down for a few frames: the spine holds upright',
		wpos(at, 'chest')[1] > wpos(at, 'spine')[1] + 100,
		`${wpos(at, 'chest')[1].toFixed(0)} vs ${wpos(at, 'spine')[1].toFixed(0)}`,
	);
	ok(
		'…and the import reports the frames held',
		Math.abs((solved.beyond3d?.spine ?? 0) - 6 / 36) < 0.03,
		JSON.stringify(solved.beyond3d),
	);
}

// A 2D clip's limb shortening and elbow keys under a 3D import are cleared there (the projection
// shortens the limb now); outside it they stay.
{
	const two = structuredClone(HB.skeleton);
	two.animations = {
		imp: {
			bones: {
				upper_arm_l_image: {
					scale: [
						{ time: 0, x: 1, y: 1 },
						{ time: 0.5, x: 1, y: 0.5 },
						{ time: 3, x: 1, y: 0.6 },
					],
				},
			},
		},
	};
	const { irig } = import3d(HB, hold(24, REACH, { hands: true, face: P.ry(0) }), { irig: two });
	const left = irig.animations.imp.bones?.upper_arm_l_image?.scale ?? [];
	ok(
		'old 2D shortening keys under a 3D import are cleared; after it they stay',
		left.length === 1 && left[0].time === 3,
		JSON.stringify(left),
	);
}
{
	const { rigOf, clipOf } = S3;
	const { irig, doc } = import3d(HB, hold(12, REACH, { hands: true, face: P.ry(0) }));
	const bent = structuredClone(irig);
	bent.bones.find((b) => b.name === 'index_2_l').inherit = 'noRotationOrReflection';
	const rig = rigOf(bent, doc);
	ok(
		'a bone flat under a baked one must inherit normally (the bake refuses it)',
		B.rig2p5dProblems(rig, clipOf(rig, bent, doc, 'imp').clip).some((p) => p.includes('index_2_l')),
	);
}

// A second import later in the clip; a 2D clip's turns around an import.
{
	const first = import3d(HB, hold(24, REACH, { hands: true, face: P.ry(0) }));
	const second = import3d(HB, hold(24, {}, { hands: true, face: P.ry(0) }), {
		at: 2,
		irig: first.irig,
		doc: first.doc,
	});
	const keys = second.doc.clips.imp.bones.upper_arm_l.orient;
	ok(
		'a later import keeps the earlier keys before it',
		keys.some((k) => k.time < 1) && keys.some((k) => k.time >= 2),
	);
	// The second import read the clip as authored (the sidecar's keys on the bones the bake owns), not
	// the bake's output: no baked 2D key is taken back into the sidecar as if an author had made it.
	const authored = (doc) =>
		Object.fromEntries(
			Object.entries(doc.clips.imp.bones).map(([b, k]) => [b, Object.keys(k).sort().join()]),
		);
	ok(
		'a later import takes no baked key back into the 3D data as an authored one',
		JSON.stringify(authored(second.doc)) === JSON.stringify(authored(first.doc)),
		JSON.stringify(authored(second.doc)),
	);
	const two = structuredClone(HB.skeleton);
	two.animations = {
		imp: {
			bones: {
				upper_arm_l: {
					rotate: [
						{ time: 0, value: 0 },
						{ time: 3, value: 200 },
						{ time: 4, value: 200 },
					],
				},
			},
		},
	};
	const mixed = import3d(HB, hold(12, REACH, { hands: true, face: P.ry(0) }), { at: 1, irig: two });
	const q = mixed.doc.clips.imp.bones.upper_arm_l;
	ok(
		'a 2D turn on a bone the import turns becomes orient keys around it',
		!q.rotate && q.orient.some((k) => k.time > 2.5),
	);
	const apart = q.orient
		.slice(1)
		.map(
			(k, i) =>
				2 *
				Math.acos(
					Math.min(
						1,
						Math.abs(
							k.value[0] * q.orient[i].value[0] +
								P.dot(k.value.slice(1), q.orient[i].value.slice(1)),
						),
					),
				) *
				DEG,
		);
	ok(
		'…a 2D turn past 180° split, so every run turns less than 180°',
		Math.max(...apart) < 180 && q.orient.some((k) => k.time > 1.49 && k.time < 3),
		apart.map((a) => a.toFixed(0)).join(),
	);
}

// Full body: knees as hinges, feet facing the viewer; Bust with face: the head only.
{
	const FB = rigWith(byId['full-body']);
	const legs = { legs: { l: { upper: P.dir(-20, 30), lower: P.dir(10, -20) } } };
	const { solved, irig } = import3d(FB, hold(24, legs));
	ok(
		'Full body: the thigh and the shin turned in 3D',
		solved.bones3d.shin_l?.orient?.length > 0 && solved.bones3d.thigh_l?.orient?.length > 0,
	);
	const at = poser(FB, irig)(0.5);
	const pts = P.points(legs);
	for (const [bone, child, a, b] of [
		['thigh_l', 'shin_l', 24, 26],
		['shin_l', 'foot_l', 26, 28],
	]) {
		const got = limb(at, bone, child);
		const want = truth(P.sub(pts[b], pts[a]));
		ok(
			`Full body: ${bone} points and shortens as the performer's`,
			Math.abs(fold(got.angle - want.angle)) < 1.5 && Math.abs(got.len / 130 - want.ratio) < 0.03,
			`${got.angle.toFixed(1)}/${want.angle.toFixed(1)} ${(got.len / 130).toFixed(3)}/${want.ratio.toFixed(3)}`,
		);
	}
	ok(
		'Full body: the foot faces the viewer',
		widths(at, 'foot_l')[0] > 0.98,
		widths(at, 'foot_l')[0].toFixed(3),
	);
	const BF = rigWith(byId['bust-face']);
	const bust = import3d(
		BF,
		P.track(36, FPS, (i) => ({ pose: {}, opts: { face: P.ry(i < 24 ? 0 : 20) } })),
	);
	ok(
		'Bust with face: only the head and its images turn in 3D',
		Object.keys(bust.solved.bones3d).sort().join() === 'hair_back,head,head_image',
	);
	ok(
		'Bust with face: head turn, tilt and nod controls replaced (not keyed)',
		!bust.solved.keys.some((k) => /^head_(tilt|turn|pitch)$/.test(k[1])),
	);
}

console.log(`${fails ? 'FAIL' : 'ok'}  motion-3d: ${checks - fails}/${checks} checks`);
process.exit(fails ? 1 : 0);
