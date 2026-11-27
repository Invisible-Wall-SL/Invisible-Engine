// 🗺 From my sheet — a jointed mouth and ＋ Custom part (docs/design/frame-to-rig.md §13.1f), headless
// on the SHIPPED code: the page's matcher (`rigSheetMap.ts`, which `vendor/rigger-motion.js` bundles),
// the launcher's fit (`rigSheetFit.ts`) and `templateRig` over the committed sheet fixture
// (`fixtures/sheet-rig/`, Half body, its head's face found), with five more regions drawing the mouth
// as its parts (lips, teeth, tongue), the page's keying of a face capture, and engine-rig posing the
// rig as a game does. Asserted:
//  - mouth: the names map to the template's optional mouth parts (Teeth alone the upper row, Spanish
//    too); a rig drawing none has none of their slots nor the upper teeth's bone; each part is drawn
//    from its own region in its own slot, the upper teeth on their bone, placed with the drawn face;
//    the lips are meshes; Jaw open drops the lower lip's middle, the lower teeth and the tongue with
//    the jaw and the upper ones not at all; Smile left lifts both lips at that corner only; a face
//    capture's jawOpen opens it as 🎥 Motion keys it; mouth shapes and parts both mapped: the shapes
//    win, the parts made with their slots empty; the Layers list draws lips over teeth over tongue;
//  - custom: a ＋ Custom part reads back from sheet.json marked custom, gets a bone of its own under
//    the bone picked and a slot drawing its region, is listed in Layers, is named from its region
//    past a Photoshop layer, and a bad name is refused;
//  - names: the owner's own region names on S_NellyAnimTest (Photoshop Export Layers names: arms,
//    hands, pupils, upper lids, under-lids, nose, lips, teeth, neck, torso, head, glasses, earring,
//    chain, watch, hood) each land where a rigger would put them in the 🗺 dialog's first guess
//    (`suggestSheet`): a template part, a jointed mouth part or a prop on the right part, named
//    without the file's prefix; none is left over; a decoy is (offered as a ＋ Custom part);
//  - eyes: the owner's lids and pupils drawn as parts move as the face controls move them: Blink
//    lowers the upper lid over the eye and leaves the pupil and the white; Look left / right moves the
//    pupils within the eye and leaves the lids and the whites;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-mouth.mjs [--only <guard>] [--no-mutants]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import * as P3 from './performer3d.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const SERVER = join(LIB, 'server');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const PAGE_SRC = readFileSync(join(APP, 'static/rigger/view.html'), 'utf8');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const tmp = mkdtempSync(join(tmpdir(), 'sheet-mouth-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const SHIPPED =
	/[\\/](rigSheetMap|rigSlotOrder|rigSheetFit|rigFrameFace|rigTemplates|rigTemplateFace|rigTemplateFit)\.ts$/;
let bundles = 0;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source (LF) first. */
async function load(mutate = []) {
	const out = join(tmp, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigSheetFit.ts';",
				"export * from './rigSheetMap.ts';",
				"export * from './server/rigTemplates.ts';",
				"export * from './server/rigTemplateFit.ts';",
				"export { regionsToRigAtlas } from './server/rig.ts';",
				"export { solveMotion } from './rigMotion.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'sheet-mouth-entry.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'silent',
		plugins: [
			{
				name: 'stubs-and-mutants',
				setup(build) {
					build.onResolve({ filter: /^\$env\/dynamic\/private$/ }, () => ({
						path: 'env',
						namespace: 'stub',
					}));
					build.onLoad({ filter: /^env$/, namespace: 'stub' }, () => ({
						contents: 'export const env = {};',
						loader: 'js',
					}));
					// `rig.ts` reaches R2, sharp and the page store; what is read here uses none.
					build.onResolve({ filter: /.*/ }, (args) =>
						/[\\/]rig\.ts$/.test(args.importer) &&
						!args.path.startsWith('engine-') &&
						!/rigTemplates|rigSidecars|rigSheetMap|rig3d|rigControls/.test(args.path)
							? { path: args.path, namespace: 'rig-deps' }
							: undefined,
					);
					build.onLoad({ filter: /.*/, namespace: 'rig-deps' }, () => ({
						contents: 'module.exports = {};',
						loader: 'js',
					}));
					build.onLoad({ filter: SHIPPED }, (args) => {
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

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return true;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	return false;
};
const read = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v) => Math.round(v * 10) / 10;

// ---- the sheet, its mapping, and the mouth drawn as its parts ---------------------------------------
const SHEET = read('sheet.json');
const TRUTH = read('truth.json');
const slotOf = (M, part) => M.HALF_BODY.parts.find((p) => p.name === part)?.slot ?? part;
const boneOfSlot = (M, slot) => M.HALF_BODY.slots.find((s) => s.name === slot).bone;
/** The mapping the page sends for the sheet: every part on its true joints (the head's face found), the props. */
function baseMapping(M) {
	const parts = {};
	for (const [part, t] of Object.entries(TRUTH.parts))
		parts[part] = { region: t.region, joints: t.joints, ...(t.face ? { face: t.face } : {}) };
	return {
		sheet: 1,
		manifestKey: 'fixture/manifests/atlas_manifest_Sheet.json',
		template: { id: M.HALF_BODY.id, version: M.HALF_BODY.version },
		parts,
		props: TRUTH.props.map((p) => ({
			name: p.part,
			region: p.region,
			host: p.host,
			bone: boneOfSlot(M, slotOf(M, p.host)),
			at: p.on,
		})),
	};
}
/** A jointed mouth's parts, the template's optional mouth slots (each part named as its slot). */
const JOINTED = ['tongue', 'teeth_lower', 'teeth_upper', 'lip_lower', 'lip_upper'];
/** The mouth drawn as its parts, Photoshop-named, each placed by a pivot at its middle. */
const MOUTH_DRAWN = [
	['lip_upper', '0002s_0004s_0000_UpperLip', 150, 40],
	['lip_lower', '0002s_0004s_0001_LowerLip', 140, 44],
	['teeth_upper', '0002s_0004s_0002_TeethTop', 110, 26],
	['teeth_lower', '0002s_0004s_0003_TeethBottom', 100, 22],
	['tongue', '0002s_0004s_0004_Tongue', 70, 40],
];
/** The sheet with its mouth drawn jointed (with `shapes`, a smile shape mapped as well). */
/**
 * The owner's region names on S_NellyAnimTest and where a rigger puts each: [name, 'part', part] or
 * [name, 'prop', the part it is worn on]. Those marked `seen` are read off the owner's screenshots and
 * notes as they are; the others are named after them (Photoshop Export Layers names), as the sheet
 * itself is not readable here (production R2).
 */
const OWNER_NAMES = [
	['NellyAssetBreakdown1_0000_UpperArmL', 'part', 'upper_arm_l', 'seen'],
	['NellyAssetBreakdown1_0000s_0000_ForeArmL', 'part', 'lower_arm_l', 'seen'],
	['NellyAssetBreakdown1_0000s_0005_HandLPointing', 'part', 'hand_l', 'seen'],
	['NellyAssetBreakdown1_0001_UpperArmR', 'part', 'upper_arm_r', 'seen'],
	['NellyAssetBreakdown1_0001s_0000_ForeArmR', 'part', 'lower_arm_r', 'seen'],
	['NellyAssetBreakdown1_0001s_0002_HandRPissoff', 'part', 'hand_r', 'seen'],
	['NellyAssetBreakdown1_0002s_0002s_0003_PupilL', 'part', 'pupil_l', 'seen'],
	['NellyAssetBreakdown1_0002s_0003s_0003_PupilR', 'part', 'pupil_r', 'seen'],
	['NellyAssetBreakdown1_0002s_0002s_0001_UpperEyelidL', 'part', 'lid_upper_l', 'seen'],
	['NellyAssetBreakdown1_0002s_0003s_0002_UpperEyelidR', 'part', 'lid_upper_r', 'seen'],
	['NellyAssetBreakdown1_0002s_0002s_0002_UnderEyelidL', 'part', 'lid_lower_l', 'seen'],
	['NellyAssetBreakdown1_0002s_0003s_0001_UnderEyelidR', 'part', 'lid_lower_r', 'seen'],
	['NellyAssetBreakdown1_0002s_0001s_0000_Nose', 'part', 'nose', 'seen'],
	['NellyAssetBreakdown1_0004_HoodFront', 'prop', 'torso', 'seen'],
	['NellyAssetBreakdown1_0001s_0001_WatchR', 'prop', 'lower_arm_r'],
	['NellyAssetBreakdown1_0002s_0000_Glasses', 'prop', 'head'],
	['NellyAssetBreakdown1_0003_EarringL', 'prop', 'head'],
	['NellyAssetBreakdown1_0005_Chain', 'prop', 'torso'],
	['NellyAssetBreakdown1_0006_Neck', 'part', 'neck'],
	['NellyAssetBreakdown1_0007_Torso', 'part', 'torso'],
	['NellyAssetBreakdown1_0008_HoodBack', 'prop', 'torso'],
	['NellyAssetBreakdown1_0009_Head', 'part', 'head'],
	['NellyAssetBreakdown1_0002s_0004s_0000_UpperLip', 'part', 'lip_upper'],
	['NellyAssetBreakdown1_0002s_0004s_0001_LowerLip', 'part', 'lip_lower'],
	['NellyAssetBreakdown1_0002s_0004s_0002_Teeth', 'part', 'teeth_upper'],
];
/** The owner's eyes drawn as parts, each placed by a pivot at its middle. */
const EYES_DRAWN = [
	['pupil_l', '0002s_0002s_0003_PupilL', 38, 38],
	['pupil_r', '0002s_0003s_0003_PupilR', 38, 38],
	['lid_upper_l', '0002s_0002s_0001_UpperEyelidL', 102, 48],
	['lid_upper_r', '0002s_0003s_0002_UpperEyelidR', 102, 48],
	['lid_lower_l', '0002s_0002s_0002_UnderEyelidL', 99, 40],
	['lid_lower_r', '0002s_0003s_0001_UnderEyelidR', 99, 40],
	['eye_white_l', '0002s_0002s_0004_EyeL', 90, 50],
	['eye_white_r', '0002s_0003s_0004_EyeR', 90, 50],
];
/** The sheet with the owner's eyes drawn as parts. */
function eyesSheet(M) {
	const mapping = baseMapping(M);
	const drawn = EYES_DRAWN.map(([part, layer, w, h], i) => ({
		part,
		name: `NellyAssetBreakdown1_${layer}`,
		x: (i % 4) * 120,
		y: 420 + Math.floor(i / 4) * 60,
		w,
		h,
	}));
	for (const d of drawn)
		mapping.parts[d.part] = { region: d.name, joints: { pivot: [d.w / 2, d.h / 2] } };
	return {
		regions: [...SHEET.regions, ...drawn.map(({ name, x, y, w, h }) => ({ name, x, y, w, h }))],
		mapping,
	};
}

function jointedSheet(M, { shapes = false } = {}) {
	const mapping = baseMapping(M);
	const drawn = MOUTH_DRAWN.map(([part, layer, w, h], i) => ({
		part,
		name: `NellyAssetBreakdown1_${layer}`,
		x: i * 160,
		y: 420,
		w,
		h,
	}));
	for (const d of drawn)
		mapping.parts[d.part] = { region: d.name, joints: { pivot: [d.w / 2, d.h / 2] } };
	if (shapes) {
		const glow = SHEET.regions.find((r) => r.name === 'bg_glow');
		mapping.parts.mouth_smile = { region: 'bg_glow', joints: { pivot: [glow.w / 2, glow.h / 2] } };
	}
	return {
		regions: [...SHEET.regions, ...drawn.map(({ name, x, y, w, h }) => ({ name, x, y, w, h }))],
		mapping,
	};
}

const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
/** What 🦴 Create rig makes of `mapping` over `regions`, loaded by engine-rig. */
function created(M, mapping, regions = SHEET.regions) {
	const parsed = M.parseSheetMapping(JSON.parse(JSON.stringify(mapping)));
	if ('problem' in parsed) throw new Error(parsed.problem);
	const sized = regions.map(({ name, w, h }) => ({ name, w, h }));
	const sr = M.sheetRig(M.HALF_BODY, sized, parsed.mapping);
	if (!sr.ok) throw new Error(sr.problem);
	const rigged = M.templateRig(M.HALF_BODY, sized, sr.value.fit, sr.value.art);
	const atlas = new RIG.TextureAtlas(M.regionsToRigAtlas('sheet.png', 4096, 4096, regions));
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(rigged.skeleton)),
	);
	// Each template slot by the rig's name for it: its region's (one slot per region, §13.1h).
	const rn = (n) => sr.value.fit.slots?.[n] ?? n;
	return { M, sr: sr.value, rigged, data, regions, rn };
}
/** A slot's drawing in the world: its vertices and its own UVs (0…1 of the image). */
function drawing(skel, slotName, attName) {
	const slot = skel.findSlot(slotName);
	const att = skel.getAttachmentByName(slotName, attName);
	if (att instanceof RIG.MeshAttachment) {
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return { v, own: att.regionUVs };
	}
	if (att instanceof RIG.RegionAttachment) {
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		return { v, own: [0, 1, 0, 0, 1, 0, 1, 1] };
	}
	return null;
}
/** A drawing's middle: its three vertices nearest the middle of its image (a lip bends on corners that stay). */
function middle(dr) {
	const pts = [];
	for (let i = 0; i < dr.v.length; i += 2) pts.push([dr.v[i], dr.v[i + 1], i / 2]);
	const near = pts
		.map(([x, y, k]) => [x, y, Math.hypot(dr.own[k * 2] - 0.5, dr.own[k * 2 + 1] - 0.5)])
		.sort((a, b) => a[2] - b[2])
		.slice(0, 3);
	return [near.reduce((a, p) => a + p[0], 0) / 3, near.reduce((a, p) => a + p[1], 0) / 3];
}
/** The rig posed at `time` of `anim` (an irig animation), or at rest. */
function posed(rig, anim = null, time = 0) {
	let data = rig.data;
	if (anim) {
		const atlas = new RIG.TextureAtlas(
			rig.M.regionsToRigAtlas('sheet.png', 4096, 4096, rig.regions),
		);
		for (const p of atlas.pages) p.setTexture(stub);
		data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
			JSON.parse(JSON.stringify({ ...rig.rigged.skeleton, animations: { a: anim } })),
		);
	}
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	if (anim) {
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, 'a', false);
		state.update(time);
		state.apply(skel);
	}
	skel.updateWorldTransform(RIG.Physics.update);
	return skel;
}

/** The page's keying of a solved capture (`faceKeyMotion` and what it calls). */
function pageKeys() {
	const fn = (name) => {
		const at = PAGE_SRC.indexOf(`\nfunction ${name}(`);
		if (at === -1) throw new Error(`view.html has no function ${name}`);
		let depth = 0;
		let j = PAGE_SRC.indexOf('{', at);
		for (; j < PAGE_SRC.length; j++) {
			if (PAGE_SRC[j] === '{') depth++;
			else if (PAGE_SRC[j] === '}' && --depth === 0) break;
		}
		return PAGE_SRC.slice(at, j + 1);
	};
	const cst = (name) => PAGE_SRC.match(new RegExp(`\\nconst ${name} = [^\\n]*`))[0];
	return new Function(
		[
			'const rawDoc = null;',
			...['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'].map(cst),
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
				'faceKeyMix',
				'faceIkSetup',
				'faceAttachmentAt',
				'faceShapePart',
				'faceDrawnMouth',
				'faceKeyAttachment',
				'faceKeyChannel',
				'faceShapeControls',
				'faceKeyShape',
				'faceKeyMotion',
			].map(fn),
			'return { faceKeyMotion };',
		].join('\n'),
	)();
}
/** A performer still but for the mouth: closed, then opening (jawOpen), keyed as 🎥 Motion keys it. */
function mouthCaptured(rig) {
	const M = rig.M;
	const t = M.fitTemplate(M.HALF_BODY, rig.sr.fit);
	const track = P3.track(31, 15, () => ({ pose: {}, opts: { face: P3.ry(0) } }));
	track.frames.forEach((f, i) => {
		f.face.blend = { jawOpen: i < 8 ? 0 : 0.6 };
	});
	const solved = M.solveMotion({ bones: t.bones, channels: t.channels, motion: t.motion }, track, {
		face: true,
		body: false,
		hand: false,
	});
	const skin = rig.rigged.skeleton.skins[0].attachments;
	const anim = {};
	pageKeys().faceKeyMotion(
		anim,
		solved.keys,
		0,
		t.channels,
		(slot, part) => !!skin[slot]?.[part],
		rig.rigged.skeleton.slots.map((s) => s.name),
	);
	return { anim, length: solved.length };
}

const GUARDS = {
	/**
	 * A jointed mouth: its names, its optional slots and bone only when drawn, each part on its own
	 * region and bone, moved by the mouth's controls and a face capture; shapes win over parts.
	 */
	mouth(M, log) {
		let good = true;
		const t = M.HALF_BODY;
		const parts = t.parts.map((p) => p.name);
		const names = [
			['UpperLip', 'lip_upper'],
			['LowerLip', 'lip_lower'],
			['Teeth', 'teeth_upper'],
			['TeethBottom', 'teeth_lower'],
			['Tongue', 'tongue'],
		];
		const got = M.suggestSheetMap(
			parts,
			names.map(([r]) => r),
		);
		for (const [region, part] of names)
			good = ok(`mouth: ${region} is ${part}`, got[part] === region, JSON.stringify(got)) && good;
		const spanish = M.suggestSheetMap(parts, ['LabioSuperior', 'DientesAbajo', 'TeethTop']);
		good =
			ok(
				'mouth: LabioSuperior, DientesAbajo and TeethTop read as the lip and teeth they are',
				spanish.lip_upper === 'LabioSuperior' &&
					spanish.teeth_lower === 'DientesAbajo' &&
					spanish.teeth_upper === 'TeethTop',
				JSON.stringify(spanish),
			) && good;
		const plain = created(M, baseMapping(M));
		const plainSlots = plain.rigged.skeleton.slots.map((s) => s.name);
		// ＋ New rig from the template alone (no sheet: its slots by the template's names).
		const sized = SHEET.regions.map(({ name, w, h }) => ({ name, w, h }));
		const bareRig = M.templateRig(t, sized).skeleton;
		const bare = bareRig.slots.map((s) => s.name);
		good =
			ok(
				'mouth: a rig drawing no jointed mouth has none of its slots nor the upper teeth’s bone',
				!JOINTED.some((n) => plainSlots.includes(plain.rn(n)) || bare.includes(n)) &&
					![plain.rigged.skeleton, bareRig].some((s) =>
						s.bones.some((b) => b.name === 'teeth_upper'),
					) &&
					t.slots.filter((s) => s.optional).length === JOINTED.length,
				[...plainSlots, ...bare].filter((n) => JOINTED.includes(n)).join(),
			) && good;
		const { regions, mapping } = jointedSheet(M);
		const rig = created(M, mapping, regions);
		const skin = rig.rigged.skeleton.skins[0].attachments;
		const slots = rig.rigged.skeleton.slots;
		good =
			ok(
				'mouth: each jointed part drawn from its own region in its own slot, the upper teeth on their bone',
				JOINTED.every(
					(n) =>
						skin[rig.rn(n)]?.[n]?.path === mapping.parts[n].region &&
						slots.find((s) => s.name === rig.rn(n))?.attachment === n,
				) && slots.find((s) => s.name === rig.rn('teeth_upper'))?.bone === 'teeth_upper',
				JSON.stringify(slots.filter((s) => JOINTED.map(rig.rn).includes(s.name))),
			) && good;
		good =
			ok(
				'mouth: the upper teeth’s bone placed with the drawn face only on a rig that draws them',
				rig.sr.fit.features?.at?.teeth_upper !== undefined &&
					plain.sr.fit.features !== undefined &&
					plain.sr.fit.features.at.teeth_upper === undefined,
				JSON.stringify({
					jointed: rig.sr.fit.features?.at?.teeth_upper,
					plain: plain.sr.fit.features?.at?.teeth_upper,
				}),
			) && good;
		good =
			ok(
				'mouth: the lips bend (meshes on the corners and their own bone)',
				skin[rig.rn('lip_upper')].lip_upper.type === 'mesh' &&
					skin[rig.rn('lip_lower')].lip_lower.type === 'mesh',
			) && good;
		// A control driven as the Controls section keys it: each drive's bone moved by value × per.
		const ft = M.fitTemplate(t, rig.sr.fit);
		const drawnBy = (values) => {
			const skel = new RIG.Skeleton(rig.data);
			skel.setToSetupPose();
			for (const [id, v] of Object.entries(values))
				for (const d of ft.channels.find((c) => c.id === id).drives ?? []) {
					const b = skel.findBone(d.bone);
					if (d.prop === 'x' || d.prop === 'y') b[d.prop] += d.per * v;
				}
			skel.updateWorldTransform(RIG.Physics.update);
			return Object.fromEntries(JOINTED.map((n) => [n, drawing(skel, rig.rn(n), n)]));
		};
		const rest = drawnBy({});
		const open = drawnBy({ jaw: 1 });
		const moved = (a, b) => d2(middle(a), middle(b));
		const jawPer = Math.abs(ft.channels.find((c) => c.id === 'jaw').drives[0].per);
		const lower = ['lip_lower', 'teeth_lower', 'tongue'].map((n) => moved(rest[n], open[n]));
		const upper = ['lip_upper', 'teeth_upper'].map((n) => moved(rest[n], open[n]));
		good =
			ok(
				'mouth: Jaw open drops the lower lip, the lower teeth and the tongue with the jaw, not the upper ones',
				lower.every((v) => Math.abs(v - jawPer) < 0.25 * jawPer) && upper.every((v) => v < 1e-6),
				`lower ${lower.map(r1)} upper ${upper.map(r1)} jaw ${r1(jawPer)}`,
			) && good;
		const smile = drawnBy({ smile_l: 1 });
		const ends = (dr, k) => {
			const xs = [];
			for (let i = 0; i < dr.v.length; i += 2) xs.push([dr.v[i], dr.v[i + 1]]);
			xs.sort((a, b) => a[0] - b[0]);
			return k < 0 ? xs.slice(0, 3) : xs.slice(-3);
		};
		const lift = (n, k) =>
			ends(smile[n], k).reduce((s, p) => s + p[1], 0) / 3 -
			ends(rest[n], k).reduce((s, p) => s + p[1], 0) / 3;
		good =
			ok(
				'mouth: Smile left lifts both lips at the picture’s left corner, not at the right',
				lift('lip_upper', -1) > 2 &&
					lift('lip_lower', -1) > 2 &&
					Math.abs(lift('lip_upper', 1)) < 0.5,
				`upper ${r1(lift('lip_upper', -1))} / ${r1(lift('lip_upper', 1))}, lower ${r1(lift('lip_lower', -1))}`,
			) && good;
		const keyed = mouthCaptured(rig);
		const at = (time) => {
			const skel = posed(rig, keyed.anim, time);
			return {
				low: middle(drawing(skel, rig.rn('lip_lower'), 'lip_lower')),
				up: middle(drawing(skel, rig.rn('lip_upper'), 'lip_upper')),
			};
		};
		const [still, talking] = [at(0), at(keyed.length * 0.75)];
		good =
			ok(
				'mouth: a face capture opening the mouth (jawOpen) drops the jointed lower lip, as 🎥 Motion keys it',
				talking.low[1] < still.low[1] - 0.25 * jawPer &&
					Math.abs(talking.up[1] - still.up[1]) < 0.1 * jawPer &&
					!!keyed.anim.bones?.jaw,
				JSON.stringify({ still, talking, bones: Object.keys(keyed.anim.bones ?? {}) }),
			) && good;
		const both = jointedSheet(M, { shapes: true });
		const bothRig = created(M, both.mapping, both.regions);
		const bs = bothRig.rigged.skeleton.slots;
		good =
			ok(
				'mouth: shapes and parts both mapped — the shapes win: the parts made, their slots empty',
				JOINTED.every((n) => {
					const s = bs.find((x) => x.name === bothRig.rn(n));
					return s && !s.attachment;
				}) &&
					JOINTED.every((n) => bothRig.rigged.skeleton.skins[0].attachments[bothRig.rn(n)]?.[n]) &&
					bothRig.sr.hidden.length === JOINTED.length &&
					rig.sr.hidden.length === 0,
				JSON.stringify(bothRig.sr.hidden),
			) && good;
		const list = M.sheetLayerList(
			t.slots.map((s) => s.name),
			(p) => slotOf(M, p),
			mapping,
		);
		good =
			ok(
				'mouth: the Layers list draws the lips over the teeth over the tongue',
				list.indexOf('lip_upper') < list.indexOf('teeth_upper') &&
					list.indexOf('teeth_lower') < list.indexOf('tongue') &&
					list.indexOf('tongue') < list.indexOf('head'),
				list.join(' '),
			) && good;
		log(
			`jaw ${r1(jawPer)}: lower parts ${lower.map(r1).join('/')}, upper ${upper.map(r1).join('/')}`,
		);
		return good;
	},

	/** The owner's region names: each lands where a rigger would put it; none is left over. */
	names(M, log) {
		let good = true;
		const parts = M.HALF_BODY.parts.map((p) => p.name);
		const sug = M.suggestSheet(parts, [...OWNER_NAMES.map(([n]) => n), 'shadow_blob']);
		const byRegion = new Map(Object.entries(sug.parts).map(([part, region]) => [region, part]));
		const propOf = new Map(sug.props.map((p) => [p.region, p]));
		const wrong = [];
		for (const [name, kind, where] of OWNER_NAMES) {
			const got = kind === 'part' ? byRegion.get(name) : propOf.get(name)?.host;
			if (got !== where)
				wrong.push(
					`${name.replace('NellyAssetBreakdown1_', '')} → ${got ?? 'nothing'} (want ${kind} ${where})`,
				);
		}
		good =
			ok(
				"names: every one of the owner's regions lands where a rigger would put it",
				wrong.length === 0,
				wrong.join('\n        '),
			) && good;
		good =
			ok(
				'names: none of them is left over; a decoy is, offered as a ＋ Custom part',
				sug.left.length === 1 && sug.left[0] === 'shadow_blob',
				JSON.stringify(sug.left),
			) && good;
		const named = sug.props.map((p) => p.name).sort();
		good =
			ok(
				"names: props named without the Photoshop file's prefix",
				JSON.stringify(named) ===
					JSON.stringify([
						'prop_chain',
						'prop_earring_l',
						'prop_glasses',
						'prop_hood_back',
						'prop_hood_front',
						'prop_watch_r',
					]),
				named.join(' '),
			) && good;
		const eyes = M.suggestSheetMap(parts, ['EyeL', 'EyeR', 'UnderEyelidL']);
		good =
			ok(
				'names: an eye named alone is its white; an under-eyelid the lower lid, not the half-closed lid image',
				eyes.eye_white_l === 'EyeL' &&
					eyes.eye_white_r === 'EyeR' &&
					eyes.lid_lower_l === 'UnderEyelidL' &&
					!eyes.eyelid_l_half,
				JSON.stringify(eyes),
			) && good;
		log(
			`${OWNER_NAMES.length} names: ${Object.keys(sug.parts).length} parts, ${sug.props.length} props, ${sug.left.length} left`,
		);
		return good;
	},

	/** Blink and gaze with the owner's lids and pupils drawn as parts. */
	eyes(M, log) {
		let good = true;
		const t = M.HALF_BODY;
		const { regions, mapping } = eyesSheet(M);
		const rig = created(M, mapping, regions);
		const ft = M.fitTemplate(t, rig.sr.fit);
		const parts = EYES_DRAWN.map(([p]) => p);
		const drawnBy = (values) => {
			const skel = new RIG.Skeleton(rig.data);
			skel.setToSetupPose();
			for (const [id, v] of Object.entries(values))
				for (const d of ft.channels.find((c) => c.id === id).drives ?? []) {
					const b = skel.findBone(d.bone);
					if (d.prop === 'x' || d.prop === 'y') b[d.prop] += d.per * v;
				}
			skel.updateWorldTransform(RIG.Physics.update);
			return Object.fromEntries(parts.map((n) => [n, middle(drawing(skel, rig.rn(n), n))]));
		};
		const rest = drawnBy({});
		const blink = drawnBy({ blink_l: 1 });
		const gaze = drawnBy({ gaze_x: 1 });
		const dy = (a, b) => a[1] - b[1];
		const dx = (a, b) => a[0] - b[0];
		const lidPer = Math.abs(ft.channels.find((c) => c.id === 'blink_l').drives[0].per);
		const pupilPer = Math.abs(ft.channels.find((c) => c.id === 'gaze_x').drives[0].per);
		good =
			ok(
				'eyes: Blink lowers the drawn upper lid over the eye; the pupil, the white and the lower lid stay',
				dy(blink.lid_upper_l, rest.lid_upper_l) < -0.75 * lidPer &&
					['pupil_l', 'eye_white_l', 'lid_lower_l', 'lid_upper_r'].every(
						(n) => d2(blink[n], rest[n]) < 1e-6,
					),
				`lid ${r1(dy(blink.lid_upper_l, rest.lid_upper_l))} of ${r1(lidPer)}`,
			) && good;
		good =
			ok(
				'eyes: Look left / right moves both drawn pupils across the eye; the lids and the whites stay',
				['pupil_l', 'pupil_r'].every(
					(n) => Math.abs(dx(gaze[n], rest[n]) - pupilPer) < 0.25 * pupilPer,
				) &&
					['lid_upper_l', 'lid_lower_l', 'eye_white_l', 'eye_white_r'].every(
						(n) => d2(gaze[n], rest[n]) < 1e-6,
					),
				`pupils ${r1(dx(gaze.pupil_l, rest.pupil_l))} / ${r1(dx(gaze.pupil_r, rest.pupil_r))} of ${r1(pupilPer)}`,
			) && good;
		log(
			`blink ${r1(dy(blink.lid_upper_l, rest.lid_upper_l))}, gaze ${r1(dx(gaze.pupil_l, rest.pupil_l))}`,
		);
		return good;
	},

	/** ＋ Custom part: read back, its own bone under the bone picked, in Layers, named, bad names refused. */
	custom(M, log) {
		let good = true;
		const t = M.HALF_BODY;
		const base = baseMapping(M);
		const glow = SHEET.regions.find((r) => r.name === 'bg_glow');
		const own = {
			...base,
			props: [
				...base.props,
				{
					name: 'hood_back',
					region: 'bg_glow',
					host: 'torso',
					bone: 'neck',
					at: [glow.w / 2, glow.h / 2],
					custom: true,
				},
			],
		};
		const back = M.parseSheetMapping(JSON.parse(JSON.stringify(own)));
		good =
			ok(
				'custom: read back from sheet.json, marked custom',
				!('problem' in back) &&
					back.mapping.props.find((p) => p.name === 'hood_back')?.custom === true,
				JSON.stringify(back.problem ?? ''),
			) && good;
		const rig = created(M, own);
		const bone = rig.rigged.skeleton.bones.find((b) => b.name === 'hood_back');
		const slot = rig.rigged.skeleton.slots.find((s) => s.name === 'hood_back');
		good =
			ok(
				'custom: a bone of its own under the bone picked, its slot drawing its region',
				bone?.parent === 'neck' &&
					slot?.bone === 'hood_back' &&
					rig.rigged.skeleton.skins[0].attachments.hood_back?.hood_back?.path === 'bg_glow',
				JSON.stringify({ bone, slot }),
			) && good;
		const list = M.sheetLayerList(
			t.slots.map((s) => s.name),
			(p) => slotOf(M, p),
			own,
		);
		good = ok('custom: listed in Layers', list.includes('hood_back'), list.join(' ')) && good;
		good =
			ok(
				'custom: its name read from its region past the Photoshop layer',
				M.customName('NellyAssetBreakdown1_0008_HoodBack') === 'hood_back' &&
					M.customName('2nd_Tail') === 'part_2_nd_tail',
				`${M.customName('NellyAssetBreakdown1_0008_HoodBack')} ${M.customName('2nd_Tail')}`,
			) && good;
		for (const [what, name] of [
			['named like a template part', 'torso'],
			['named like a bone', 'chest'],
			['named with a capital', 'HoodBack'],
		]) {
			const bad = M.sheetRig(
				t,
				SHEET.regions.map(({ name: n, w, h }) => ({ name: n, w, h })),
				{ ...own, props: own.props.map((p) => (p.custom ? { ...p, name } : p)) },
			);
			good = ok(`custom: ${what} refused`, !bad.ok, bad.ok ? 'made' : '') && good;
		}
		log(`hood_back under ${bone?.parent}, ${list.length} layers`);
		return good;
	},
};

const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
const M0 = await load();
for (const [id, guard] of Object.entries(GUARDS)) {
	if (ONLY && id !== ONLY) continue;
	console.log(`\n=== ${id}`);
	guard(M0, (line) => console.log(`    ${line}`));
}
if (ONLY || process.argv.includes('--no-mutants')) {
	console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
	process.exit(fails === 0 ? 0 : 1);
}

console.log('\n=== mutants of the shipped code: each must turn its check red');
const MAP = 'rigSheetMap.ts';
const FIT = 'rigSheetFit.ts';
const TPL = 'rigTemplates.ts';
const TFACE = 'rigTemplateFace.ts';
const MUTANTS = [
	['names', 'an under-eyelid not read as the lower lid', [MAP, "\tunder: ['lower'],\n", '']],
	['names', 'an eye named alone not read as its white', [MAP, "\t\tout.add('white');\n", '']],
	[
		'names',
		"a hoodie's hood worn on the head",
		[MAP, "'medal', 'hood'], 'torso']", "'medal'], 'torso'], [['hood'], 'head']"],
	],
	[
		'names',
		"a prop named with the Photoshop file's prefix",
		[MAP, 'return propNamed(layerName(region));', 'return propNamed(region);'],
	],
	['names', 'a region matching nothing not offered', [MAP, '\t\telse left.push(region);\n', '']],
	[
		'eyes',
		'Blink not moving the upper lid',
		[
			TFACE,
			"drives: [{ bone: `lid_upper_${s}`, prop: 'y', per: -30 }],",
			"drives: [{ bone: `lid_upper_${s}`, prop: 'y', per: 0 }],",
		],
	],
	[
		'eyes',
		'Look left / right not moving the pupils',
		[
			TFACE,
			"drives: sides<RigTemplateDrive>((s) => [{ bone: `pupil_${s}`, prop: 'x', per: 14 }]),",
			"drives: sides<RigTemplateDrive>((s) => [{ bone: `eye_${s}`, prop: 'x', per: 14 }]),",
		],
	],
	[
		'mouth',
		'an optional slot made on every rig',
		[
			TPL,
			'const slots = t.slots.filter((s) => !s.optional || drawnIn.has(s.name));',
			'const slots = t.slots;',
		],
	],
	[
		'mouth',
		'an optional bone made on every rig',
		[
			TPL,
			'return { ...t, bones: t.bones.filter((b) => used.has(b.name)), slots };',
			'return { ...t, slots };',
		],
	],
	[
		'mouth',
		'teeth named alone not read as the upper row',
		[MAP, "if (out.has('teeth') && !out.has('upper') && !out.has('lower')) out.add('upper');", ''],
	],
	['mouth', 'a lip not a kind of part', [MAP, "\t'mouth',\n\t'lip',\n", "\t'mouth',\n"]],
	['mouth', "a Spanish lip's name not read", [MAP, "\tlabio: ['lip'],\n", '']],
	[
		'mouth',
		'a lip drawn rigid, not bent on the corners',
		[
			TFACE,
			"part('lip_upper', 'lip_upper', [100, 28], false, lipBend('lip_upper')),",
			"part('lip_upper', 'lip_upper', [100, 28]),",
		],
	],
	[
		'mouth',
		'the tongue on the skull, not the jaw',
		[TFACE, "{ name: 'tongue', bone: 'jaw',", "{ name: 'tongue', bone: 'face',"],
	],
	[
		'mouth',
		'the upper teeth on the jaw',
		[TFACE, "{ name: 'teeth_upper', bone: 'teeth_upper',", "{ name: 'teeth_upper', bone: 'jaw',"],
	],
	[
		'mouth',
		"the upper teeth's bone left at the template's place, not the drawn face's",
		[FIT, 'frameFace(t, lengthened, faceWorld, optional)', 'frameFace(t, lengthened, faceWorld)'],
	],
	[
		'mouth',
		'shapes and parts both shown',
		[FIT, '\tfor (const part of hidden) art[part].hidden = true;\n', ''],
	],
	['mouth', 'a hidden part shown at setup', [TPL, ' && !hidden(s)\n', '\n']],
	[
		'custom',
		"a custom part's name not checked",
		[FIT, 'if (p.custom && !CUSTOM_NAME.test(p.name))', 'if (false && p.custom)'],
	],
	[
		'custom',
		'a custom part not kept as one in sheet.json',
		[FIT, '\t\t\t...(p.custom === true ? { custom: true as const } : {}),\n', ''],
	],
	[
		'custom',
		"a custom part named with its Photoshop layer's file",
		[MAP, 'const base = nameWords(layerName(region)).join', 'const base = nameWords(region).join'],
	],
];
const SOURCES = {
	[MAP]: join(LIB, MAP),
	[FIT]: join(SERVER, FIT),
	[TPL]: join(SERVER, TPL),
	[TFACE]: join(SERVER, TFACE),
};
for (const [guard, what, mutation] of MUTANTS) {
	const [file, from] = mutation;
	if (!readFileSync(SOURCES[file], 'utf8').replace(/\r\n/g, '\n').includes(from)) {
		ok(`mutant planted: ${what}`, false, `"${from}" is not in ${file}`);
		continue;
	}
	const before = fails;
	const quiet = console.error;
	console.error = () => {};
	let red;
	try {
		red = !GUARDS[guard](await load([mutation]), () => {}) || fails > before;
	} catch {
		red = true;
	} finally {
		console.error = quiet;
	}
	fails = before;
	ok(`mutant caught by "${guard}": ${what}`, red);
	console.log(`    ${red ? 'red  ' : 'GREEN'} ${guard}: ${what}`);
}

console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
process.exit(fails === 0 ? 0 : 1);
