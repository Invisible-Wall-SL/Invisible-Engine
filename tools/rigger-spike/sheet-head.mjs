// 🗺 From my sheet: the head under a 3D capture (the owner, 2026-11-26: "my head is still not
// rotating … the facial bones are working perfectly, but the head is not moving like them"),
// headless on the SHIPPED code: the rig 🗺 From my sheet makes of the committed sheet fixture
// (`fixtures/sheet-rig/`, Half body) under the owner's own region names (S_NellyAnimTest's
// Photoshop Export Layers names, mapped by the dialog's first guess `suggestSheet`), its face drawn
// apart as the owner's is (pupils, lids, nose, lips, teeth), glasses and an earring worn on the head;
// a synthetic performer (`performer3d.mjs`) whose face's 3D pose is known, solved, keyed, imported
// into the sidecar and baked as the page does (`rig3dImport.ts` → `rig2p5d.ts`), and posed by
// engine-rig as a game does. Asserted:
//  - roll: a capture's head roll turns the head's whole drawing about the head by the roll (its
//    outline and its middle alike, nothing left on the neck), and the features and the glasses with
//    it — drawn apart, and with a face found on the head;
//  - gain: the import's Head gain reaches a 3D import's head turn (2× turns it twice as far, 0.5×
//    half as far), as it does a 2D import's head controls;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-head.mjs [--only <guard>] [--no-mutants]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const tmp = mkdtempSync(join(tmpdir(), 'sheet-head-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const SHIPPED = /[\\/](rigMotion|rigMotion3d|rigFrameFit|rigSheetFit|rig2p5d|rig3dImport)\.ts$/;
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
				"export { solveMotion } from './rigMotion.ts';",
				"export * as I from './rig3dImport.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'sheet-head-entry.ts',
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

// The page's keying of a solved capture (`faceKeyMotion` and what it calls), as the Rigger runs it.
const html = readFileSync(join(APP, 'static/rigger/view.html'), 'utf8');
const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
	.map((m) => m[1])
	.join('\n');
const grabFn = (name) => {
	const at = src.indexOf(`\nfunction ${name}(`);
	if (at === -1) throw new Error(`view.html has no function ${name}`);
	let depth = 0;
	let j = src.indexOf('{', at);
	for (; j < src.length; j++) {
		if (src[j] === '{') depth++;
		else if (src[j] === '}' && --depth === 0) break;
	}
	return src.slice(at, j + 1);
};
const grabConst = (name) => src.match(new RegExp(`\\nconst ${name} = [^\\n]*`))[0];
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
			'faceDrawnMouth',
			'faceShapeControls',
			'faceKeyShape',
			'faceKeyMotion',
			'face3dReplaced',
		].map(grabFn),
		'return { faceKeyMotion, face3dReplaced };',
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
const r1 = (v) => Math.round(v * 10) / 10;

// ---- the owner's sheet ----------------------------------------------------------------------------
const read = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
const SHEET = read('sheet.json');
const TRUTH = read('truth.json');
const FILE = 'NellyAssetBreakdown1_';
/** The fixture's regions under the owner's names on S_NellyAnimTest (`sheet-mouth.mjs` OWNER_NAMES). */
const OWNER = {
	Body_Main: '0007_Torso',
	Neck01: '0006_Neck',
	head_front: '0009_Head',
	L_arm_upper: '0000_UpperArmL',
	arm_lower_left: '0000s_0000_ForeArmL',
	HandL: '0000s_0005_HandLPointing',
	ArmR1: '0001_UpperArmR',
	ArmR2: '0001s_0000_ForeArmR',
	'hand-right': '0001s_0002_HandRPissoff',
	Sunglasses: '0002s_0000_Glasses',
	earring_L: '0003_EarringL',
	gold_chain: '0005_Chain',
	watch_R: '0001s_0001_WatchR',
	bg_glow: '0004_HoodFront',
	shadow_blob: '0008_HoodBack',
};
/** The owner's face drawn apart: each feature its own drawing, placed by a pivot at its middle. */
const FEATURES = [
	['0002s_0002s_0003_PupilL', 38, 38],
	['0002s_0003s_0003_PupilR', 38, 38],
	['0002s_0002s_0001_UpperEyelidL', 102, 48],
	['0002s_0003s_0002_UpperEyelidR', 102, 48],
	['0002s_0002s_0002_UnderEyelidL', 99, 40],
	['0002s_0003s_0001_UnderEyelidR', 99, 40],
	['0002s_0001s_0000_Nose', 64, 80],
	['0002s_0004s_0000_UpperLip', 150, 40],
	['0002s_0004s_0001_LowerLip', 140, 44],
	['0002s_0004s_0002_Teeth', 110, 26],
];
const owned = (name) => (OWNER[name] ? FILE + OWNER[name] : name);
const REGIONS = [
	...SHEET.regions.map((r) => ({ ...r, name: owned(r.name) })),
	...FEATURES.map(([layer, w, h], i) => ({
		name: FILE + layer,
		x: (i % 5) * 160,
		y: SHEET.height + 10 + Math.floor(i / 5) * 90,
		w,
		h,
	})),
];
const ATLAS =
	[
		'page.png',
		'size:2048,2048',
		'filter:Linear,Linear',
		...REGIONS.flatMap((r) => [r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`]),
	].join('\n') + '\n';

/**
 * The owner's mapping: the dialog's first guess (`suggestSheet`) for every region, each body part on
 * its true joints (with its face found on the head when `face`), each feature by its middle, each
 * prop where the fixture wears it (a hood at the collar).
 */
function ownerMapping(M, { face = false } = {}) {
	const t = M.HALF_BODY;
	const slotOf = (part) => t.parts.find((p) => p.name === part)?.slot ?? part;
	const boneOfSlot = (slot) => t.slots.find((s) => s.name === slot).bone;
	const sug = M.suggestSheet(
		t.parts.map((p) => p.name),
		REGIONS.map((r) => r.name),
	);
	if (sug.left.length) throw new Error(`the owner's sheet leaves ${sug.left.join(', ')}`);
	const truthOf = (region) =>
		Object.values(TRUTH.parts).find((x) => owned(x.region) === region) ??
		TRUTH.props.find((x) => owned(x.region) === region);
	const parts = {};
	for (const [part, region] of Object.entries(sug.parts)) {
		const x = truthOf(region);
		const r = REGIONS.find((y) => y.name === region);
		parts[part] = x?.joints
			? { region, joints: x.joints, ...(face && x.face ? { face: x.face } : {}) }
			: { region, joints: { pivot: [r.w / 2, r.h / 2] } };
	}
	const props = sug.props.map((p) => ({
		name: p.name,
		region: p.region,
		host: p.host,
		bone: boneOfSlot(slotOf(p.host)),
		at: truthOf(p.region)?.on ?? TRUTH.parts.torso.joints.neck,
	}));
	return {
		sheet: 1,
		manifestKey: 'fixture/manifests/atlas_manifest_S_NellyAnimTest.json',
		template: { id: t.id, version: t.version },
		parts,
		props,
	};
}

/** What 🦴 Create rig makes of the owner's sheet, and its fitted template. */
function ownerRig(M, opts = {}) {
	const t = M.HALF_BODY;
	const mapping = ownerMapping(M, opts);
	const parsed = M.parseSheetMapping(JSON.parse(JSON.stringify(mapping)));
	if ('problem' in parsed) throw new Error(parsed.problem);
	const sized = REGIONS.map(({ name, w, h }) => ({ name, w, h }));
	const sr = M.sheetRig(t, sized, parsed.mapping);
	if (!sr.ok) throw new Error(sr.problem);
	const tpl = M.fitTemplate(t, sr.value.fit);
	const irig = M.templateRig(t, sized, sr.value.fit, sr.value.art).skeleton;
	return { M, mapping, sr: sr.value, tpl, irig, setup: irig.slots.map((s) => s.name) };
}

// ---- a capture, imported in 3D as the page does, and played -------------------------------------
const FPS = 24;
/** Frames still (the import's neutral is the first second), then the face turning, then held. */
const STILL = 24;
const RAMP = 12;
const N = 60;
/** A performer standing still, the face turned by `turn(k)` (k: 0 → 1 over the ramp, then held). */
const faceTrack = (turn) =>
	P.track(N, FPS, (i) => ({
		pose: {},
		opts: { hands: true, face: turn(Math.min(1, Math.max(0, (i - STILL) / RAMP))) },
	}));

/** `track` imported as a 3D clip of `rig` and baked (🎥 Key at playhead with 🧊 3D); `opts` the import's. */
function imported(rig, track, opts = {}) {
	const M = rig.M;
	const solved = M.solveMotion(
		{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
		track,
		{ three: true, face: true, body: true, hand: true, ...opts },
	);
	const { animation, orient } = M.I.authoringOf(rig.irig, null, 'imp');
	const skin = rig.irig.skins[0].attachments;
	const has = (slot, part) => !!skin[slot]?.[part];
	PAGE.faceKeyMotion(animation, solved.keys, 0, rig.tpl.channels, has, rig.setup);
	return M.I.importClip3d({
		irig: rig.irig,
		doc: null,
		stem: 'nelly',
		template: rig.tpl.rig3d,
		clip: 'imp',
		animation,
		orient,
		keys: solved.bones3d,
		at: 0,
		length: solved.length,
		replaced: PAGE.face3dReplaced(rig.tpl),
		keys2d: solved.keys2d,
	}).irig;
}

const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
/** `irig` played by engine-rig: its pose at `time` of clip `imp` (null: the setup). */
function player(irig) {
	const atlas = new RIG.TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(irig)),
	);
	return (time) => {
		const skel = new RIG.Skeleton(data);
		skel.setToSetupPose();
		if (time !== null) {
			const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
			state.setAnimation(0, 'imp', false);
			state.update(time);
			state.apply(skel);
		}
		skel.updateWorldTransform(RIG.Physics.update);
		return skel;
	};
}
/** A slot's drawing in the world, as the runtime draws it (null: nothing shown). */
function drawn(skel, slotName) {
	const slot = skel.findSlot(slotName);
	const att = slot?.getAttachment();
	if (att instanceof RIG.MeshAttachment) {
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return v;
	}
	if (att instanceof RIG.RegionAttachment) {
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		return v;
	}
	return null;
}
/**
 * How drawing `b` lies against drawing `a` (the same vertices): the turn (degrees) of the closest
 * turn-and-move, and the farthest any vertex lies off it (0 = turned whole).
 */
function turnOf(a, b) {
	const n = a.length / 2;
	const mean = (v) => {
		let [x, y] = [0, 0];
		for (let i = 0; i < n; i++) [x, y] = [x + v[2 * i], y + v[2 * i + 1]];
		return [x / n, y / n];
	};
	const [ca, cb] = [mean(a), mean(b)];
	let [dot, crs] = [0, 0];
	for (let i = 0; i < n; i++) {
		const [px, py] = [a[2 * i] - ca[0], a[2 * i + 1] - ca[1]];
		const [qx, qy] = [b[2 * i] - cb[0], b[2 * i + 1] - cb[1]];
		dot += px * qx + py * qy;
		crs += px * qy - py * qx;
	}
	const th = Math.atan2(crs, dot);
	const [c, s] = [Math.cos(th), Math.sin(th)];
	let off = 0;
	for (let i = 0; i < n; i++) {
		const [px, py] = [a[2 * i] - ca[0], a[2 * i + 1] - ca[1]];
		const [qx, qy] = [c * px - s * py + cb[0], s * px + c * py + cb[1]];
		off = Math.max(off, Math.hypot(qx - b[2 * i], qy - b[2 * i + 1]));
	}
	return { deg: (th * 180) / Math.PI, off };
}
/** The middle of a drawing's vertices. */
const middle = (v) => {
	let [x, y] = [0, 0];
	for (let i = 0; i < v.length; i += 2) [x, y] = [x + v[i], y + v[i + 1]];
	return [(2 * x) / v.length, (2 * y) / v.length];
};
/** `p` turned `deg` (counter-clockwise, y up) about `o`. */
const turned = (p, o, deg) => {
	const r = (deg * Math.PI) / 180;
	const [dx, dy] = [p[0] - o[0], p[1] - o[1]];
	return [o[0] + Math.cos(r) * dx - Math.sin(r) * dy, o[1] + Math.sin(r) * dx + Math.cos(r) * dy];
};

/** The capture's roll (degrees, counter-clockwise in the picture). */
const ROLL = 20;
/** How far off the capture's roll the head's drawing may turn (degrees); off its turn, rig units. */
const TURN_KEPT = 0.75;
const WHOLE = 0.5;
/** The face's own parts and the glasses a roll carries round the head with it. */
const CARRIED = ['pupil_l', 'pupil_r', 'lid_upper_l', 'lid_lower_r', 'nose', 'lip_upper'];

const GUARDS = {
	/** A capture's head roll turns the head's whole drawing by the roll, its features with it. */
	roll(M, log) {
		let good = true;
		const rows = [];
		for (const face of [false, true]) {
			const what = face ? 'a face found on the head' : 'the face drawn apart';
			const rig = ownerRig(M, { face });
			const at = player(
				imported(
					rig,
					faceTrack((k) => P.rz(ROLL * k)),
				),
			);
			const [rest, end] = [at(0), at((N - 1) / FPS)];
			const head = turnOf(drawn(rest, 'head'), drawn(end, 'head'));
			const pivot = [rest.findBone('head').worldX, rest.findBone('head').worldY];
			const parts = [
				...(face ? [] : CARRIED),
				...rig.irig.slots.filter((s) => /glasses/.test(s.name)).map((s) => s.name),
			];
			const slip = parts.map((s) => {
				const want = turned(middle(drawn(rest, s)), pivot, ROLL);
				const got = middle(drawn(end, s));
				return [s, Math.hypot(got[0] - want[0], got[1] - want[1])];
			});
			const worst = slip.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
			rows.push(`${what}: ${r1(head.deg)}° (off ${head.off.toFixed(2)}), parts ≤ ${r1(worst[1])}`);
			good =
				ok(
					`roll (${what}): the head's drawing turns by the capture's ${ROLL}° roll`,
					Math.abs(head.deg - ROLL) <= TURN_KEPT,
					`${r1(head.deg)}°`,
				) &&
				ok(
					`roll (${what}): the head's drawing turns whole (its outline and its middle alike, none of it left on the neck)`,
					head.off <= WHOLE,
					`${head.off.toFixed(2)} units off`,
				) &&
				ok(
					`roll (${what}): the face's parts and the glasses turn round the head with it`,
					parts.some((s) => /glasses/.test(s)) && worst[1] <= 1,
					`${worst[0]} ${r1(worst[1])} units off`,
				) &&
				good;
		}
		log(`a ${ROLL}° roll: ${rows.join('; ')}`);
		return good;
	},

	/** The import's Head gain scales a 3D import's head turn, as it does a 2D import's controls. */
	gain(M, log) {
		let good = true;
		const rig = ownerRig(M);
		const rows = [];
		for (const g of [2, 0.5]) {
			const at = player(
				imported(
					rig,
					faceTrack((k) => P.rz(ROLL * k)),
					{ gain: { head: g } },
				),
			);
			const { deg } = turnOf(drawn(at(0), 'head'), drawn(at((N - 1) / FPS), 'head'));
			rows.push(`${g}× ${r1(deg)}°`);
			good =
				ok(
					`gain: Head ${g}× turns the head ${g} times the capture's ${ROLL}° roll`,
					Math.abs(deg - g * ROLL) <= TURN_KEPT * Math.max(1, g),
					`${r1(deg)}°`,
				) && good;
		}
		log(`a ${ROLL}° roll at Head ${rows.join(', ')}`);
		return good;
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'roll',
		'the face’s 3D pose not read: the head never turns',
		[
			[
				'rigMotion3d.ts',
				'if (faceTurn[i] && faceSmooth) turn = localTurn(parent, setup, matOf(faceSmooth[i]));',
				'if (faceTurn[i] && faceSmooth) turn = null;',
			],
		],
	],
	[
		'roll',
		'the head’s outline kept upright: square to the viewer, it loses the head’s roll',
		[['rigMotion3d.ts', 'Math.atan2(up[1], up[0]) - Math.PI / 2', '0']],
	],
	[
		'roll',
		'the head drawn on the neck at its joint: its bottom stays as the rest turns',
		[
			[
				'rigFrameFit.ts',
				"torso: ['spine', 'clavicle_l', 'clavicle_r'],",
				"torso: ['spine', 'clavicle_l', 'clavicle_r'],\n\thead: ['neck'],",
			],
		],
	],
	[
		'gain',
		'the Head gain not passed to the 3D solve',
		[['rigMotion.ts', 'headGain: opts.gain?.head ?? 1,', '']],
	],
	[
		'gain',
		'the 3D solve ignores the Head gain',
		[
			[
				'rigMotion3d.ts',
				'turnTimes(quatOf(mul3(m, transpose3(matOf(rest0)))), headGain)',
				'quatOf(mul3(m, transpose3(matOf(rest0))))',
			],
		],
	],
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const noMutants = args.includes('--no-mutants');
const started = Date.now();
const M = await load();
for (const [name, guard] of Object.entries(GUARDS)) {
	if (only && name !== only) continue;
	const before = fails;
	guard(M, (line) => console.log(`  ${name}: ${line}`));
	console.log(`${fails === before ? 'ok  ' : 'FAIL'}  ${name}`);
}
let caught = 0;
let planted = 0;
if (!noMutants) {
	for (const [guard, what, mutate] of MUTANTS) {
		if (only && guard !== only) continue;
		planted++;
		const Mm = await load(mutate);
		const [c0, f0] = [checks, fails];
		const silent = console.error;
		console.error = () => {};
		let red;
		try {
			red = !GUARDS[guard](Mm, () => {});
		} catch {
			red = true;
		}
		console.error = silent;
		[checks, fails] = [c0, f0];
		if (red) caught++;
		else {
			fails++;
			console.error(`FAIL  mutant not caught by ${guard}: ${what}`);
		}
		console.log(`${red ? 'ok  ' : 'FAIL'}  mutant (${guard}): ${what}`);
	}
}
console.log(
	`\nsheet-head: ${checks - fails}/${checks} checks${planted ? `, ${caught}/${planted} mutants caught` : ''} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
);
process.exit(fails ? 1 : 0);
