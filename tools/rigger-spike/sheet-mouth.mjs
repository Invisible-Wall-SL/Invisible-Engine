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
	return { M, sr: sr.value, rigged, data, regions };
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
		good =
			ok(
				'mouth: a rig drawing no jointed mouth has none of its slots nor the upper teeth’s bone',
				!JOINTED.some((n) => plainSlots.includes(n)) &&
					!plain.rigged.skeleton.bones.some((b) => b.name === 'teeth_upper') &&
					t.slots.filter((s) => s.optional).length === JOINTED.length,
				plainSlots.filter((n) => JOINTED.includes(n)).join(),
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
						skin[n]?.[n]?.path === mapping.parts[n].region &&
						slots.find((s) => s.name === n)?.attachment === n,
				) && slots.find((s) => s.name === 'teeth_upper')?.bone === 'teeth_upper',
				JSON.stringify(slots.filter((s) => JOINTED.includes(s.name))),
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
				skin.lip_upper.lip_upper.type === 'mesh' && skin.lip_lower.lip_lower.type === 'mesh',
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
			return Object.fromEntries(JOINTED.map((n) => [n, drawing(skel, n, n)]));
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
				low: middle(drawing(skel, 'lip_lower', 'lip_lower')),
				up: middle(drawing(skel, 'lip_upper', 'lip_upper')),
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
				JOINTED.every(
					(n) => bs.find((s) => s.name === n) && !bs.find((s) => s.name === n).attachment,
				) &&
					JOINTED.every((n) => bothRig.rigged.skeleton.skins[0].attachments[n]?.[n]) &&
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
		[MAP, 'const base = nameWords(layer ? layer[1] : region)', 'const base = nameWords(region)'],
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
