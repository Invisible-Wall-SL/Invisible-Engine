// The draw order a 3D capture gives a sheet-made rig (docs/design/rig-2p5d.md §4.5, the owner's "a
// lot of clipping we can't control", 2026-11-26), headless on the SHIPPED code: the rig 🗺 From my
// sheet makes from the committed sheet fixture (`fixtures/sheet-rig/`, Half body), a synthetic
// performer (`performer3d.mjs`) whose true 3D pose is known, solved, keyed, imported into the sidecar
// and baked as the page does (`rig3dImport.ts` → `rig2p5d.ts`), and posed by engine-rig as a game
// does. Reproduced before the fix: the bake read every card at its centre and swapped past 6 rig units
// (< 1 cm of the performer), and the torso, head and upper arms are flat cards at depth 0, so a hand
// hanging 2–3 cm behind the body's mid-plane dropped behind the torso and everything in front of it,
// and a 3° lean put one forearm over the whole other arm for the rest of the clip. Asserted:
//  - import: a capture import gives the rig its body's depth (`thick`: the torso, pelvis, neck and head
//    at their shares of the shoulder width) and a hysteresis at its scale; what the author set stays;
//  - beside: an arm hanging at the body's side, its wrist 10 cm behind the mid-plane (inside a torso
//    24 cm deep) and jittering, stays over the torso and the head the whole clip, and keeps its own
//    order against the other arm;
//  - behind: a hand reaching behind the back is drawn under the torso, and over it again once it is
//    back in front;
//  - crossing: a forearm brought well in front of the other arm (≥ 10 cm nearer) is drawn over it;
//    a 3° lean is not;
//  - flicker: a forearm wobbling ±3 cm about the other arm's depth swaps at most once each way;
//  - locks: a lock keeps its front slot over its back one whatever the depths say (a hand behind the
//    back stays over the torso), and the rest of the order still follows depth;
//  - off: with depth order off the bake keys no draw order and the clip keeps the one the author keyed,
//    through the bake (`withBake`) and the save's edit check (`bakedParts` without it);
//  - sidecar: `thick`, `depthOrder` and `locks` read back; bad ones refused;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/capture-draw-order.mjs [--only <guard>] [--no-mutants]
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
const tmp = mkdtempSync(join(tmpdir(), 'capture-draw-order-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const SHIPPED = /[\\/](rig2p5d|rig3d|rig3dImport)\.ts$/;
let bundles = 0;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source (LF) first. */
async function load(mutate = []) {
	const out = join(tmp, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigSheetFit.ts';",
				"export * from './server/rigTemplates.ts';",
				"export * from './server/rigTemplateFit.ts';",
				"export { solveMotion } from './rigMotion.ts';",
				"export * as I from './rig3dImport.ts';",
				"export * as R3 from './rig3d.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'capture-draw-order-entry.ts',
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

// ---- the rig a sheet makes ------------------------------------------------------------------------
const read = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
const SHEET = read('sheet.json');
const TRUTH = read('truth.json');
const REGIONS = SHEET.regions.map(({ name, w, h }) => ({ name, w, h }));
const ATLAS =
	[
		'page.png',
		`size:${SHEET.width},${SHEET.height}`,
		'filter:Linear,Linear',
		...SHEET.regions.flatMap((r) => [r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`]),
	].join('\n') + '\n';

/** The rig 🦴 Create rig makes of the sheet (the fixture's true joints, its props), and its template. */
function sheetRig(M) {
	const t = M.HALF_BODY;
	const slotOf = (part) => t.parts.find((p) => p.name === part)?.slot ?? part;
	const boneOfSlot = (slot) => t.slots.find((s) => s.name === slot).bone;
	const parts = {};
	for (const [part, x] of Object.entries(TRUTH.parts))
		parts[part] = { region: x.region, joints: x.joints, ...(x.face ? { face: x.face } : {}) };
	const mapping = {
		sheet: 1,
		manifestKey: 'fixture',
		template: { id: t.id, version: t.version },
		parts,
		props: TRUTH.props.map((p) => ({
			name: p.part,
			region: p.region,
			host: p.host,
			bone: boneOfSlot(slotOf(p.host)),
			at: p.on,
		})),
	};
	const sr = M.sheetRig(t, REGIONS, mapping);
	if (!sr.ok) throw new Error(sr.problem);
	const tpl = M.fitTemplate(t, sr.value.fit);
	const irig = M.templateRig(t, REGIONS, sr.value.fit, sr.value.art).skeleton;
	return { tpl, irig, setup: irig.slots.map((s) => s.name) };
}

const FPS = 24;
const lerp = (a, b, k) => a + (b - a) * k;
/** A performer posed by `at(i, k)` for `n` frames (k: 0 → 1 → 0 over the clip). */
const track = (n, at) =>
	P.track(n, FPS, (i) => ({
		pose: at(i, Math.sin((Math.PI * i) / (n - 1))),
		opts: { hands: true, face: P.ry(0) },
	}));

/** `track` imported as a 3D clip on `rig` and baked, as the page does; `doc`: its 3D data so far. */
function imported(M, rig, tr, doc = null) {
	const solved = M.solveMotion(
		{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
		tr,
		{ three: true, trace: true },
	);
	const { animation, orient } = M.I.authoringOf(rig.irig, doc, 'imp');
	const skin = rig.irig.skins[0].attachments;
	const has = (slot, part) => !!skin[slot]?.[part];
	PAGE.faceKeyMotion(animation, solved.keys, 0, rig.tpl.channels, has, rig.setup);
	return M.I.importClip3d({
		irig: rig.irig,
		doc,
		stem: 'hero',
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

/** The draw order engine-rig plays at each frame of `irig`'s clip `imp`. */
function orders(irig, n) {
	const atlas = new RIG.TextureAtlas(ATLAS);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(irig)),
	);
	const out = [];
	for (let i = 0; i < n; i++) {
		const skel = new RIG.Skeleton(data);
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, 'imp', false);
		state.update(i / FPS);
		state.apply(skel);
		skel.updateWorldTransform(RIG.Physics.update);
		out.push(skel.drawOrder.map((s) => s.data.name));
	}
	return out;
}
const over = (order, a, b) => order.indexOf(a) > order.indexOf(b);
/** How many times `a` goes from over `b` to under it, or back, across the frames. */
const swaps = (os, a, b) =>
	os.slice(1).filter((o, i) => over(o, a, b) !== over(os[i], a, b)).length;

// The performer's poses (rig frame: x right, y up, z toward the viewer; `dir(picture°, toward°)`).
/**
 * Arms hanging at the sides behind the body's mid-plane (the wrists about 10 cm back: still beside
 * a torso 24 cm deep, never behind it), jittering as a tracker's depth does.
 */
const beside = (i) => {
	const j = Math.sin(i * 2.3) * 2;
	return {
		arms: {
			l: { upper: P.dir(8, -8 + j * 0.5), lower: P.dir(10, -14 + j) },
			r: { upper: P.dir(-8, -8 - j * 0.5), lower: P.dir(-10, -14 - j) },
		},
	};
};
/** The picture-left hand reaching behind the back, and out again. */
const behind = (_, k) => ({
	arms: {
		l: {
			upper: P.dir(lerp(5, 15, k), lerp(0, -55, k)),
			lower: P.dir(lerp(5, 60, k), lerp(0, -45, k)),
		},
	},
});
/** The picture-left forearm brought across the body in front of the other arm (k up to 1). */
const crossing = (_, k) => ({
	arms: {
		l: {
			upper: P.dir(lerp(8, 30, k), lerp(0, 30, k)),
			lower: P.dir(lerp(10, 100, k), lerp(0, 40, k)),
		},
		r: { upper: P.dir(-8, 0), lower: P.dir(-10, 0) },
	},
});
/** A 3° lean toward the camera of the picture-left forearm, nothing more. */
const lean = () => ({ arms: { l: { upper: P.dir(8, 0), lower: P.dir(10, 3) } } });
/** The picture-left forearm across the right one, its wrist wobbling ±3 cm about its depth. */
const wobble = (i) => ({
	arms: {
		l: { upper: P.dir(25, 0), lower: P.dir(95, 7 * Math.sin(i * 0.9)) },
		r: { upper: P.dir(-25, 0), lower: P.dir(-95, 0) },
	},
});

const ARM_L = ['upper_arm_l', 'lower_arm_l', 'hand_l'];
const GUARDS = {
	/** The import sets the body's depth and the hysteresis at the rig's scale; the author's stay. */
	import(M, log) {
		let good = true;
		const rig = sheetRig(M);
		const { doc } = imported(M, rig, track(12, beside));
		const width = M.I.shoulderWidth(rig.irig, doc);
		good =
			ok(
				'import: the torso, pelvis, neck and head get their depth at their shares of the shoulder width',
				['torso', 'neck', 'head'].every(
					(s) => Math.abs(doc.thick?.[s] - M.I.BODY_DEPTH[s] * width) < 1e-3,
				) && !doc.thick?.upper_arm_l,
				JSON.stringify({ thick: doc.thick, width }),
			) && good;
		good =
			ok(
				'import: a hysteresis at the rig’s scale (about 4 cm of the performer)',
				Math.abs(doc.hysteresis - M.I.CAPTURE_HYSTERESIS * width) < 1e-3 && doc.hysteresis > 20,
				String(doc.hysteresis),
			) && good;
		const own = { ...doc, hysteresis: 9, thick: { ...doc.thick, torso: 50 } };
		const again = imported(M, rig, track(12, beside), own).doc;
		good =
			ok(
				'import: what the author set stays',
				again.hysteresis === 9 && again.thick.torso === 50,
				JSON.stringify({ h: again.hysteresis, t: again.thick?.torso }),
			) && good;
		log(`shoulders ${width.toFixed(1)}: hysteresis ${doc.hysteresis}, torso ${doc.thick.torso}`);
		return good;
	},

	/** Arms at the body's side, a little behind its mid-plane and jittering: over the body throughout. */
	beside(M, log) {
		const rig = sheetRig(M);
		const n = 48;
		const os = orders(imported(M, rig, track(n, beside)).irig, n);
		const under = os.findIndex((o) =>
			[...ARM_L, 'upper_arm_r', 'lower_arm_r', 'hand_r'].some((a) =>
				['torso', 'head'].some((b) => !over(o, a, b)),
			),
		);
		const sides = swaps(os, 'lower_arm_l', 'lower_arm_r');
		const good =
			ok(
				'beside: arms hanging at the sides, the wrists 10 cm behind the body’s mid-plane, stay over the torso and the head',
				under === -1,
				under === -1 ? '' : `frame ${under}: ${os[under].join(' ')}`,
			) && ok('beside: and keep their own order against each other', sides === 0, `${sides} swaps`);
		log(`48 frames: no arm under the body, ${sides} arm swaps`);
		return good;
	},

	/** A hand behind the back: under the torso there, over it again once back in front. */
	behind(M, log) {
		const rig = sheetRig(M);
		const n = 48;
		const os = orders(imported(M, rig, track(n, behind)).irig, n);
		const mid = os[n >> 1];
		const good = ok(
			'behind: a hand reaching behind the back is under the torso, and over it at both ends',
			!over(mid, 'hand_l', 'torso') &&
				over(os[0], 'hand_l', 'torso') &&
				over(os.at(-1), 'hand_l', 'torso'),
			mid.join(' '),
		);
		log(`mid-clip: hand_l at ${mid.indexOf('hand_l')}, torso at ${mid.indexOf('torso')}`);
		return good;
	},

	/** A forearm brought well in front of the other arm is over it; a 3° lean is not. */
	crossing(M, log) {
		const rig = sheetRig(M);
		const n = 48;
		const across = orders(imported(M, rig, track(n, crossing)).irig, n);
		const leant = orders(imported(M, rig, track(n, lean)).irig, n);
		const good =
			ok(
				'crossing: the forearm across the body, 10 cm and more in front, is over the other arm',
				over(across[n >> 1], 'lower_arm_l', 'lower_arm_r') &&
					over(across[n >> 1], 'hand_l', 'upper_arm_r'),
				across[n >> 1].join(' '),
			) &&
			ok(
				'crossing: a 3° lean puts nothing over the other arm',
				leant.every((o) => !over(o, 'lower_arm_l', 'upper_arm_r')),
				leant.find((o) => over(o, 'lower_arm_l', 'upper_arm_r'))?.join(' ') ?? '',
			);
		log(`across: lower_arm_l over lower_arm_r at mid-clip; lean: none over`);
		return good;
	},

	/** A forearm wobbling about the other's depth swaps at most once each way. */
	flicker(M, log) {
		const rig = sheetRig(M);
		const n = 72;
		const os = orders(imported(M, rig, track(n, wobble)).irig, n);
		const s = swaps(os, 'hand_l', 'lower_arm_r');
		const good = ok(
			'flicker: a hand wobbling ±3 cm across the other forearm swaps with it at most twice',
			s <= 2,
			`${s} swaps`,
		);
		log(`${s} swaps over ${n} frames`);
		return good;
	},

	/** A lock keeps its front slot over its back one; the rest still follows depth. */
	locks(M, log) {
		const rig = sheetRig(M);
		const n = 48;
		const first = imported(M, rig, track(n, behind));
		const doc = { ...first.doc, locks: [['hand_l', 'torso']] };
		const os = orders(imported(M, rig, track(n, behind), doc).irig, n);
		const mid = os[n >> 1];
		const good = ok(
			'locks: the hand locked over the torso stays over it behind the back, while the forearm goes under',
			os.every((o) => over(o, 'hand_l', 'torso')) && !over(mid, 'lower_arm_l', 'torso'),
			mid.join(' '),
		);
		log(`hand_l over torso in all ${n} frames; lower_arm_l under it mid-clip`);
		return good;
	},

	/** Depth order off: no draw-order keys; the clip keeps the author's, through the bake and the save's check. */
	off(M, log) {
		let good = true;
		const rig = sheetRig(M);
		const n = 24;
		const first = imported(M, rig, track(n, behind));
		const doc = { ...first.doc, depthOrder: false };
		const authored = { time: 0.25, offsets: [{ slot: 'hand_r', offset: -40 }] };
		const irig = structuredClone(first.irig);
		irig.animations.imp.drawOrder = [authored];
		const res = M.I.rebakeClip3d
			? M.I.rebakeClip3d({ irig, doc, clip: 'imp' })
			: imported(M, { ...rig, irig }, track(n, behind), doc);
		const keys = res.irig.animations.imp.drawOrder;
		good =
			ok(
				'off: the bake keys no draw order of its own and the clip keeps the one keyed by hand',
				JSON.stringify(keys) === JSON.stringify([authored]),
				JSON.stringify(keys),
			) && good;
		const scope = { bones: res.plan.owned, slots: res.plan.slots };
		const a = M.R3.bakedParts(res.irig, 'imp', { ...scope, order: false }, []);
		const edited = structuredClone(res.irig);
		edited.animations.imp.drawOrder = [{ time: 0.5, offsets: [{ slot: 'hand_l', offset: 3 }] }];
		const b = M.R3.bakedParts(edited, 'imp', { ...scope, order: false }, []);
		const on = M.R3.bakedParts(edited, 'imp', scope, []);
		good =
			ok(
				'off: a draw order keyed by hand is no edit of the bake (the save takes it); on, it is',
				M.R3.partsDiffer(a, b).length === 0 &&
					M.R3.partsDiffer(M.R3.bakedParts(res.irig, 'imp', scope, []), on).includes('draw order'),
				JSON.stringify(M.R3.partsDiffer(a, b)),
			) && good;
		log(`depth order off: ${keys.length} key, the author's`);
		return good;
	},

	/** `thick`, `depthOrder` and `locks` read back; bad ones refused. */
	sidecar(M, log) {
		let good = true;
		const rig = sheetRig(M);
		const { doc } = imported(M, rig, track(8, beside));
		const full = { ...doc, depthOrder: false, locks: [['prop_wrist_r', 'lower_arm_r']] };
		const problems = M.R3.rig3dDocProblems(JSON.parse(JSON.stringify(full)));
		good =
			ok(
				'sidecar: thick, depthOrder and locks are part of rig3d.json',
				problems.length === 0 && Object.keys(doc.thick ?? {}).length >= 3,
				JSON.stringify(problems),
			) && good;
		const bad = [
			['a lock of one slot', { ...doc, locks: [['hand_l']] }],
			['a negative depth', { ...doc, thick: { torso: -1 } }],
			['depth order not a flag', { ...doc, depthOrder: 'off' }],
		];
		for (const [what, d] of bad) {
			const p = M.R3.rig3dDocProblems(JSON.parse(JSON.stringify(d)));
			good = ok(`sidecar: ${what} refused`, p.length > 0, JSON.stringify(p)) && good;
		}
		log(`${bad.length} bad sidecars refused`);
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
const BAKE = 'rig2p5d.ts';
const SIDE = 'rig3d.ts';
const IMP = 'rig3dImport.ts';
const MUTANTS = [
	[
		'beside',
		'the body read at its middle, not its back face (as before the fix)',
		[
			BAKE,
			'u.reduce((sum, j) => sum + zs[j], 0) / u.length - thick[k]',
			'u.reduce((sum, j) => sum + zs[j], 0) / u.length',
		],
	],
	[
		'beside',
		"a slot's depth not read from rig3d.json",
		[SIDE, '\t\tif (thick !== undefined) slot.thick = thick;\n', ''],
	],
	[
		'import',
		'a capture import leaving the body flat',
		[IMP, 'if (thick.length)\n\t\tout.thick', 'if (false)\n\t\tout.thick'],
	],
	[
		'flicker',
		'a capture import keeping the 6-unit hysteresis (under 1 cm)',
		[IMP, '\tout.hysteresis ??= round4(CAPTURE_HYSTERESIS * width);\n', ''],
	],
	[
		'import',
		"the author's depth taken over",
		[IMP, '(([s]) => slots.has(s) && !out.thick?.[s])', '(([s]) => slots.has(s))'],
	],
	[
		'locks',
		'a lock never applied',
		[BAKE, 'unitOrder = locked(nextUnits);', 'unitOrder = nextUnits;'],
	],
	[
		'locks',
		"rig3d.json's locks not read",
		[SIDE, '\tif (doc.locks?.length) rig.locks', '\tif (false) rig.locks'],
	],
	[
		'off',
		'depth order keyed with the switch off',
		[BAKE, 'const ordered = rig.depthOrder !== false;', 'const ordered = true;'],
	],
	[
		'off',
		'the switch not read',
		[SIDE, '\tif (doc.depthOrder === false) rig.depthOrder = false;\n', ''],
	],
	[
		'off',
		"the author's draw order replaced by the bake's (none)",
		[SIDE, '\tif (bake.ordered) {', '\tif (true) {'],
	],
	[
		'off',
		'a hand-keyed draw order read as an edit of the bake',
		[SIDE, '...(scope.order === false', '...(false'],
	],
	['sidecar', 'depthOrder not part of rig3d.json', [SIDE, '\t\tdepthOrder: bool,\n', '']],
];
const SOURCES = {
	[BAKE]: join(LIB, BAKE),
	[SIDE]: join(LIB, SIDE),
	[IMP]: join(LIB, IMP),
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
