// The owner's 🗺 From my sheet rig for the head gates (`sheet-head.mjs`, `sheet-head-turn.mjs`): the
// committed sheet fixture (`fixtures/sheet-rig/`, Half body) under the owner's own region names on
// S_NellyAnimTest (Photoshop Export Layers names, as `sheet-mouth.mjs` OWNER_NAMES reads them), its
// face drawn apart as the owner's is (pupils, lids, nose, lips, teeth), glasses and an earring worn
// on the head; the shipped modules bundled with planted mutants; a synthetic performer's 3D capture
// keyed and baked as the page does (`faceKeyMotion` → `importClip3d` → `bake2p5d`); engine-rig
// playing the result. A library for the spikes, not a check.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const esbuild = await import(ESBUILD);
export const RIG = await import(RIG_CORE);
const tmp = mkdtempSync(join(tmpdir(), 'owner-sheet-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

/** The modules a mutant may be planted in. */
const SHIPPED =
	/[\\/](rigMotion|rigMotion3d|rigFrameFit|rigFrameFace|rigSheetFit|rigSheetMap|rigSheetUpdate|rigFrameUpdate|rigHeadTurn|rigTemplateFit|rigTemplates|rigTemplateModules|rigTemplateStore|riggerNewRig|rig2p5d|rig3d|rig3dImport)\.ts$/;
let bundles = 0;
/**
 * The shipped modules, with `mutate` ([file, from, to]) swapped into their source (LF) first; `page`
 * builds functions of the page's script (`view.html`, a mutant there swapped in too).
 */
export async function load(mutate = []) {
	const out = join(tmp, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigSheetFit.ts';",
				"export * from './server/rigSheetUpdate.ts';",
				"export { changeModules, frameSourceOf, madeAttachments, madeParts, planModules, updateFrameRig } from './server/rigFrameUpdate.ts';",
				"export { framePartsRequest, propPivots } from './server/rigFrameFit.ts';",
				"export * from './rigSheetMap.ts';",
				"export * from './server/rigTemplates.ts';",
				"export * from './server/rigTemplateModules.ts';",
				"export * from './server/rigTemplateFit.ts';",
				"export { rigTemplateForSidecar } from './server/rigTemplateStore.ts';",
				"export { resolveNewRigBody } from './server/riggerNewRig.ts';",
				"export { solveMotion } from './rigMotion.ts';",
				"export * as I from './rig3dImport.ts';",
				"export * as R3 from './rig3d.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'owner-sheet-entry.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		// What a bundled package requires of Node itself (the server modules' SDKs) at load.
		banner: {
			js: "import { createRequire as __nodeRequire } from 'node:module'; const require = __nodeRequire(import.meta.url);",
		},
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
					// A native image library the server's art paths load: nothing here draws with it.
					build.onResolve({ filter: /^sharp$/ }, () => ({ path: 'sharp', namespace: 'stub' }));
					build.onLoad({ filter: /^sharp$/, namespace: 'stub' }, () => ({
						contents: "export default () => { throw new Error('no sharp in the gate'); };",
						loader: 'js',
					}));
					build.onLoad({ filter: /^env$/, namespace: 'stub' }, () => ({
						contents: 'export const env = {};',
						loader: 'js',
					}));
					// R2 is not here: every export of `server/r2.ts` throws if called (a built-in never reads it).
					build.onLoad({ filter: /[\\/]server[\\/]r2\.ts$/ }, (args) => ({
						contents: [
							...readFileSync(args.path, 'utf8').matchAll(
								/^export (?:async )?(?:function|const|class) (\w+)/gm,
							),
						]
							.map((m) => `export const ${m[1]} = () => { throw new Error('no R2 in the gate'); };`)
							.join('\n'),
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
	let page = src;
	for (const [file, from, to] of mutate) {
		if (file !== 'view.html') continue;
		if (!page.includes(from)) throw new Error(`mutant: "${from}" is not in ${file}`);
		page = page.replace(from, to);
	}
	const mod = await import(pathToFileURL(out).href);
	return {
		...mod,
		/** A function of the page's script as written there (a mutant swapped in), by name. */
		pageSource: (name) => pageFn(name, page),
		/** The page's functions `names` (and its consts `consts`), by name. */
		page: (names, consts = []) =>
			new Function(
				[
					...consts.map((n) => grabConst(n, page)),
					...names.map((n) => pageFn(n, page)),
					`return { ${names.join(', ')} };`,
				].join('\n'),
			)(),
	};
}

// The page's keying of a solved capture (`faceKeyMotion` and what it calls), as the Rigger runs it.
const html = readFileSync(join(APP, 'static/rigger/view.html'), 'utf8');
const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
	.map((m) => m[1])
	.join('\n');
/** A function of the page's script (`from`: the script, mutated), by name, as written there. */
export const pageFn = (name, text = src) => {
	const plain = text.indexOf(`\nfunction ${name}(`);
	const at = plain === -1 ? text.indexOf(`\nasync function ${name}(`) : plain;
	if (at === -1) throw new Error(`view.html has no function ${name}`);
	let depth = 0;
	let j = text.indexOf('{', at);
	for (; j < text.length; j++) {
		if (text[j] === '{') depth++;
		else if (text[j] === '}' && --depth === 0) break;
	}
	return text.slice(at, j + 1);
};
const grabConst = (name, text = src) => text.match(new RegExp(`\\nconst ${name} = [^\\n]*`))[0];
export const PAGE = new Function(
	[
		...['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'].map((n) => grabConst(n)),
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
		].map((n) => pageFn(n)),
		'return { faceKeyMotion, face3dReplaced };',
	].join('\n'),
)();

// ---- the owner's sheet ----------------------------------------------------------------------------
const read = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
const SHEET = read('sheet.json');
export const TRUTH = read('truth.json');
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
export const REGIONS = [
	...SHEET.regions.map((r) => ({ ...r, name: owned(r.name) })),
	...FEATURES.map(([layer, w, h], i) => ({
		name: FILE + layer,
		x: (i % 5) * 160,
		y: SHEET.height + 10 + Math.floor(i / 5) * 90,
		w,
		h,
	})),
];
export const ATLAS =
	[
		'page.png',
		'size:2048,2048',
		'filter:Linear,Linear',
		...REGIONS.flatMap((r) => [r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`]),
	].join('\n') + '\n';

/**
 * The owner's mapping: the dialog's first guess (`suggestSheet`) for every region, each body part on
 * its true joints (with its face found on the head when `face`), each feature by its middle, each
 * prop where the fixture wears it (a hood at the collar); `more` merged over it (a head turn).
 */
export function ownerMapping(M, { face = false, more = {}, modules } = {}) {
	const t = M.templateWithModules(M.HALF_BODY, modules);
	const slotOf = (part) => t.parts.find((p) => p.name === part)?.slot ?? part;
	const boneOfSlot = (slot) => t.slots.find((s) => s.name === slot).bone;
	const sug = M.suggestSheet(
		t.parts.map((p) => p.name),
		REGIONS.map((r) => r.name),
	);
	// A module left out (no hands) leaves its drawings unmapped, as the dialog would.
	if (sug.left.length && !modules)
		throw new Error(`the owner's sheet leaves ${sug.left.join(', ')}`);
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
		template: { id: t.id, version: t.version, ...(modules ? { modules } : {}) },
		parts,
		props,
		...more,
	};
}

/** The sheet's regions as the launcher reads them (names and sizes). */
export const SIZED = REGIONS.map(({ name, w, h }) => ({ name, w, h }));

/** What 🦴 Create rig makes of `mapping` (the owner's by default), and its fitted template. */
export function ownerRig(M, opts = {}) {
	const mapping = opts.mapping ?? ownerMapping(M, opts);
	const parsed = M.parseSheetMapping(JSON.parse(JSON.stringify(mapping)));
	if ('problem' in parsed) throw new Error(parsed.problem);
	const t = M.asMapped(M.HALF_BODY, parsed.mapping);
	const sr = M.sheetRig(t, SIZED, parsed.mapping);
	if (!sr.ok) throw new Error(sr.problem);
	const tpl = M.fitTemplate(t, sr.value.fit);
	const irig = M.templateRig(t, SIZED, sr.value.fit, sr.value.art).skeleton;
	return {
		M,
		mapping: parsed.mapping,
		sr: sr.value,
		tpl,
		irig,
		setup: irig.slots.map((s) => s.name),
	};
}

// ---- a capture, imported in 3D as the page does, and played -------------------------------------
export const FPS = 24;
/** Frames still (the import's neutral is the first second), then the face turning, then held. */
const STILL = 24;
const RAMP = 8;
export const N = 34;
/** The last frame's time: the turn held. */
export const END = (N - 1) / FPS;
/** A performer standing still, the face turned by `turn(k)` (k: 0 → 1 over the ramp, then held). */
export const faceTrack = (turn) =>
	P.track(N, FPS, (i) => ({
		pose: {},
		opts: { hands: true, face: turn(Math.min(1, Math.max(0, (i - STILL) / RAMP))) },
	}));

/**
 * `track` imported as a 3D clip `imp` of `rig` and baked (🎥 Key at playhead with 🧊 3D), as the page
 * does: its first 3D data made as 🧊 Make 3D makes it unless `doc` is given; `opts` the import's.
 */
export function imported(rig, track, opts = {}, doc = null) {
	const M = rig.M;
	const solved = M.solveMotion(
		{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
		track,
		{ three: true, face: true, body: true, hand: true, ...opts },
	);
	const { animation, orient } = M.I.authoringOf(rig.irig, doc, 'imp');
	const skin = rig.irig.skins[0].attachments;
	const has = (slot, part) => !!skin[slot]?.[part];
	PAGE.faceKeyMotion(animation, solved.keys, 0, rig.tpl.channels, has, rig.setup);
	return M.I.importClip3d({
		irig: rig.irig,
		doc,
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
	});
}

const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
/** `irig` played by engine-rig: its pose at `time` of clip `clip` (null: the setup). */
export function player(irig, clip = 'imp') {
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
			state.setAnimation(0, clip, false);
			state.update(time);
			state.apply(skel);
		}
		skel.updateWorldTransform(RIG.Physics.update);
		return skel;
	};
}
/** A slot's drawing in the world, as the runtime draws it (null: nothing shown). */
export function drawn(skel, slotName) {
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
export function turnOf(a, b) {
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
export const middle = (v) => {
	let [x, y] = [0, 0];
	for (let i = 0; i < v.length; i += 2) [x, y] = [x + v[i], y + v[i + 1]];
	return [(2 * x) / v.length, (2 * y) / v.length];
};
/** `p` turned `deg` (counter-clockwise, y up) about `o`. */
export const turned = (p, o, deg) => {
	const r = (deg * Math.PI) / 180;
	const [dx, dy] = [p[0] - o[0], p[1] - o[1]];
	return [o[0] + Math.cos(r) * dx - Math.sin(r) * dy, o[1] + Math.sin(r) * dx + Math.cos(r) * dy];
};

/** A gate's run: its guards, then each planted mutant against its guard; exits red on any miss. */
export async function runGate(name, guards, mutants) {
	const args = process.argv.slice(2);
	const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
	const noMutants = args.includes('--no-mutants');
	const started = Date.now();
	let checks = 0;
	let fails = 0;
	let quiet = false;
	const ok = (label, cond, detail = '') => {
		checks++;
		if (cond) return true;
		fails++;
		if (!quiet) console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
		return false;
	};
	const M = await load();
	for (const [g, guard] of Object.entries(guards)) {
		if (only && g !== only) continue;
		const before = fails;
		await guard(M, ok, (line) => console.log(`  ${g}: ${line}`));
		console.log(`${fails === before ? 'ok  ' : 'FAIL'}  ${g}`);
	}
	let caught = 0;
	let planted = 0;
	if (!noMutants)
		for (const [g, what, mutate] of mutants) {
			if (only && g !== only) continue;
			planted++;
			const Mm = await load(mutate);
			const [c0, f0] = [checks, fails];
			quiet = true;
			let red;
			try {
				red = !(await guards[g](Mm, ok, () => {}));
			} catch {
				red = true;
			}
			quiet = false;
			[checks, fails] = [c0, f0];
			if (red) caught++;
			else {
				fails++;
				console.error(`FAIL  mutant not caught by ${g}: ${what}`);
			}
			console.log(`${red ? 'ok  ' : 'FAIL'}  mutant (${g}): ${what}`);
		}
	console.log(
		`\n${name}: ${checks - fails}/${checks} checks${planted ? `, ${caught}/${planted} mutants caught` : ''} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
	process.exit(fails ? 1 : 0);
}
