// 🗺 From my sheet — Layers (docs/design/frame-to-rig.md §13.1e), headless on the SHIPPED code: the
// page's ordering (`rigSheetMap.ts` `sheetLayerList` / `sheetSlotOrder`, which `vendor/rigger-motion.js`
// bundles), the launcher's fit (`rigSheetFit.ts`, `rigTemplateFit.ts` `inDrawOrder`) and `templateRig`
// over the committed sheet fixture (`fixtures/sheet-rig/`, Half body, its props), with the owner's eyes
// drawn as parts (eye whites, pupils, upper lids, under-lids, named as their Photoshop layers), posed
// by engine-rig as a game does. Its own gate, so `sheet-rig.mjs` stays inside `check:all`'s five
// minutes. Asserted:
//  - layers: the list the page shows is the order the rig is made in; the author's order is the rig's,
//    engine-rig's and the reopened `template.json` fit's; every other slot stays; the 3D layers stay
//    together; an order a depth control cannot stand with is refused, saying why; bad and stray
//    layers are refused;
//  - eyes: by default each eye white is under its pupil, under its lids, all under the glasses (a prop
//    on the head goes over every face part and under the front hair; a hat over the hair), in the
//    rig and in the list the page shows; the list may still put the glasses behind the eyes;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-layers.mjs [--only <guard>] [--no-mutants]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const SERVER = join(LIB, 'server');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const tmp = mkdtempSync(join(tmpdir(), 'sheet-layers-'));
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
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'sheet-layers-entry.ts',
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

// ---- the sheet, its mapping, and the owner's eyes drawn as parts ------------------------------------
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
/** The owner's eyes drawn as parts (their Photoshop layer names), each placed by a pivot at its middle. */
const EYES_DRAWN = [
	['eye_white_l', '0002s_0002s_0004_EyeWhiteL', 90, 50],
	['eye_white_r', '0002s_0003s_0004_EyeWhiteR', 90, 50],
	['pupil_l', '0002s_0002s_0003_PupilL', 38, 38],
	['pupil_r', '0002s_0003s_0003_PupilR', 38, 38],
	['lid_upper_l', '0002s_0002s_0001_UpperEyelidL', 102, 48],
	['lid_upper_r', '0002s_0003s_0002_UpperEyelidR', 102, 48],
	['lid_lower_l', '0002s_0002s_0002_UnderEyelidL', 99, 40],
	['lid_lower_r', '0002s_0003s_0001_UnderEyelidR', 99, 40],
];
/**
 * The sheet with the owner's eyes drawn as parts, a front hair, and a hat worn on the head beside the
 * glasses.
 */
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
	const glow = SHEET.regions.find((r) => r.name === 'bg_glow');
	const hair = 'NellyAssetBreakdown1_0011_HairFront';
	mapping.parts.hair_front = { region: hair, joints: { pivot: [glow.w / 2, glow.h / 2] } };
	mapping.props.push({
		name: 'prop_hat',
		region: 'NellyAssetBreakdown1_0010_Hat',
		host: 'head',
		bone: boneOfSlot(M, 'head'),
		at: [glow.w / 2, glow.h / 2],
	});
	return {
		regions: [
			...SHEET.regions,
			...drawn.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })),
			{ ...glow, name: 'NellyAssetBreakdown1_0010_Hat' },
			{ ...glow, name: hair },
		],
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

const GUARDS = {
	/**
	 * 🗺 Layers: the list the page shows is the order the rig is made in; the author's order is the
	 * rig's, engine-rig's, and the fit's kept in `template.json`; every other slot stays; the 3D layers
	 * stay together; an order a depth control cannot stand with is refused, saying why.
	 */
	layers(M, log) {
		let good = true;
		const t = M.HALF_BODY;
		const regions = SHEET.regions;
		const mapping = baseMapping(M);
		const tplSlots = t.slots.map((s) => s.name);
		const slotOfPart = (p) => slotOf(M, p);
		const natural = M.sheetLayerList(tplSlots, slotOfPart, mapping);
		const plain = created(M, mapping, regions);
		// The list names the template's slots, the rig its regions' (one slot per region, §13.1h).
		const rn = (n) => plain.sr.fit.slots?.[n] ?? n;
		const drawn = new Set(natural.map(rn));
		const drawnOrder = (slots) =>
			slots
				.map((s) => s.name ?? s)
				.filter((n) => drawn.has(n))
				.reverse();
		good =
			ok(
				'layers: the page lists every slot the mapping draws in, front first, as the rig is made',
				natural.map(rn).join() === drawnOrder(plain.rigged.skeleton.slots).join() &&
					natural.length > 10,
				`page ${natural.map(rn).join(' ')}\n        rig  ${drawnOrder(plain.rigged.skeleton.slots).join(' ')}`,
			) && good;
		// The author's: the chain behind the torso, the watch under its forearm, the left hand in front
		// of everything (out of its fingers' 3D layer).
		const own = [...natural];
		const move = (n, to) => {
			own.splice(own.indexOf(n), 1);
			own.splice(to(), 0, n);
		};
		move('prop_chain', () => own.indexOf('torso') + 1);
		move('prop_wrist_r', () => own.indexOf('lower_arm_r') + 1);
		move('hand_l', () => 0);
		const sent = M.parseSheetMapping(JSON.parse(JSON.stringify({ ...mapping, layers: own })));
		good =
			ok(
				'layers: read back from sheet.json as written',
				!('problem' in sent) && JSON.stringify(sent.mapping.layers) === JSON.stringify(own),
				JSON.stringify(sent),
			) && good;
		const layered = created(M, { ...mapping, layers: own }, regions);
		const slots = layered.rigged.skeleton.slots;
		good =
			ok(
				"layers: the rig draws the mapped slots in the list's order",
				drawnOrder(slots).join() === own.map(rn).join(),
				drawnOrder(slots).join(' '),
			) && good;
		const others = (list) => list.map((s) => s.name).filter((n) => !drawn.has(n));
		good =
			ok(
				'layers: the rig makes no slot the mapping does not draw in (one slot per region)',
				!others(slots).length && !others(plain.rigged.skeleton.slots).length,
				others(slots).join(' '),
			) && good;
		good =
			ok(
				"layers: the page lists the author's order as the rig draws it",
				M.sheetLayerList(tplSlots, slotOfPart, { ...mapping, layers: own })
					.map(rn)
					.join() === drawnOrder(slots).join(),
			) && good;
		const skel = new RIG.Skeleton(layered.data);
		skel.setToSetupPose();
		good =
			ok(
				'layers: engine-rig draws them in that order',
				drawnOrder(skel.drawOrder.map((s) => s.data.name)).join() === own.map(rn).join(),
			) && good;
		const ref = JSON.stringify({ id: t.id, version: t.version, fit: layered.sr.fit });
		const made = new Set(slots.map((s) => s.name));
		const reopened = M.sidecarTemplate(t, ref)
			.slots.map((s) => s.name)
			.filter((n) => made.has(n));
		good =
			ok(
				"layers: the fit kept in template.json reopens in the author's order",
				reopened.join() === slots.map((s) => s.name).join(),
				reopened.join(' '),
			) && good;
		const ft = M.fitTemplate(t, layered.sr.fit);
		const at = new Map(ft.slots.map((s, i) => [s.name, i]));
		const apart = Object.entries(ft.rig3d?.layers ?? {}).filter(([, v]) => {
			const idx = v.map((n) => at.get(n)).sort((a, b) => a - b);
			return idx.some((x, i) => i > 0 && x !== idx[i - 1] + 1);
		});
		good =
			ok(
				'layers: every 3D draw-order layer still together (the hand drawn apart left its own)',
				apart.length === 0 &&
					!Object.values(ft.rig3d?.layers ?? {}).some((v) => v.includes(rn('hand_l'))),
				JSON.stringify(apart) + JSON.stringify(ft.rig3d?.layers),
			) && good;
		// An order the Arm depth control cannot stand with: the arm behind the head.
		const behindHead = [...natural];
		behindHead.splice(behindHead.indexOf('upper_arm_l'), 1);
		behindHead.splice(behindHead.indexOf('head') + 1, 0, 'upper_arm_l');
		const refused = M.sheetRig(t, regions, { ...mapping, layers: behindHead });
		good =
			ok(
				'layers: the arm drawn behind the head refused, naming the depth control',
				!refused.ok &&
					refused.problem.includes(`the Layers draw "${rn('upper_arm_l')}" behind "${rn('head')}"`),
				refused.ok ? 'made' : refused.problem,
			) && good;
		const bad = [
			['not a list', { ...mapping, layers: 'torso' }],
			['a slot twice', { ...mapping, layers: ['torso', 'torso'] }],
		];
		for (const [what, m] of bad)
			good =
				ok(
					`layers: ${what} refused`,
					'problem' in M.parseSheetMapping(JSON.parse(JSON.stringify(m))),
				) && good;
		const reordered = new Set(t.channels.flatMap((c) => c.order?.slots ?? []));
		const empty = tplSlots.find((n) => !drawn.has(n) && !reordered.has(n));
		const stray = M.sheetRig(t, regions, { ...mapping, layers: [...own, empty] });
		good =
			ok(
				`layers: a slot nothing mapped is drawn in (${empty}) refused`,
				!stray.ok && stray.problem.includes(`"${empty}", which no mapped part`),
				stray.ok ? 'made' : stray.problem,
			) && good;
		log(`${own.length} layers; yours: ${own.slice(0, 4).join(' > ')} …`);
		return good;
	},

	/**
	 * The owner's eyes drawn as parts: each eye white under its pupil, under its lids, all under the
	 * glasses, the glasses under the front hair and a hat over it, in the rig and in the page's list;
	 * the list may still put the glasses behind the eyes.
	 */
	eyes(M, log) {
		let good = true;
		const t = M.HALF_BODY;
		const { regions, mapping } = eyesSheet(M);
		const rig = created(M, mapping, regions);
		const order = rig.rigged.skeleton.slots.map((s) => s.name);
		// Each template slot by the rig's name for it: its region's (one slot per region, §13.1h).
		const rn = (n) => rig.sr.fit.slots?.[n] ?? n;
		const below = (a, b) => order.indexOf(rn(a)) < order.indexOf(rn(b));
		const stack = (s) => [
			`eye_white_${s}`,
			`pupil_${s}`,
			`lid_lower_${s}`,
			`lid_upper_${s}`,
			'prop_glasses',
		];
		const stacked = ['l', 'r'].every((s) =>
			stack(s).every((n, i, all) => !i || below(all[i - 1], n)),
		);
		good =
			ok(
				'eyes: each eye white under its pupil, under its lids, all under the glasses',
				stacked,
				order.slice(order.indexOf('head'), order.indexOf(rn('hair_front')) + 2).join(' '),
			) && good;
		const faceParts = Object.keys(rig.sr.fit.slots).filter((n) =>
			/^(eye_white|pupil|lid|eyelid|brow|nose|mouth)/.test(n),
		);
		good =
			ok(
				'eyes: the glasses over every face part, under the front hair; a hat over the hair',
				faceParts.every((n) => below(n, 'prop_glasses')) &&
					below('prop_glasses', 'hair_front') &&
					below('hair_front', 'prop_hat'),
				order.slice(order.indexOf('hair_front') - 3, order.indexOf('hair_front') + 3).join(' '),
			) && good;
		const list = M.sheetLayerList(
			t.slots.map((s) => s.name),
			(p) => slotOf(M, p),
			mapping,
		);
		const drawnOrder = order.filter((n) => list.map(rn).includes(n)).reverse();
		good =
			ok(
				'eyes: the Layers list the page shows has the same order, front first',
				list.map(rn).join() === drawnOrder.join() &&
					list.indexOf('prop_glasses') < list.indexOf('lid_upper_l'),
				list.slice(0, 12).join(' '),
			) && good;
		const own = [...list];
		own.splice(own.indexOf('prop_glasses'), 1);
		own.splice(own.indexOf('pupil_l') + 1, 0, 'prop_glasses');
		const moved = created(M, { ...mapping, layers: own }, regions).rigged.skeleton.slots.map(
			(s) => s.name,
		);
		good =
			ok(
				'eyes: the Layers list may put the glasses behind the pupils',
				moved.indexOf('prop_glasses') < moved.indexOf(rn('pupil_l')),
				moved
					.slice(moved.indexOf(rn('eye_white_l')), moved.indexOf(rn('eye_white_l')) + 6)
					.join(' '),
			) && good;
		const hairAt = order.indexOf(rn('hair_front'));
		log(
			`${faceParts.length} face parts under the glasses; ${order.slice(hairAt - 2, hairAt + 2).join(' < ')}`,
		);
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
const TFIT = 'rigTemplateFit.ts';
const ORDER = 'rigSlotOrder.ts';
const MUTANTS = [
	[
		'layers',
		"the page's list ignoring the author's order",
		[MAP, 'return m.layers ? inDrawOrder(made, [...m.layers].reverse()) : made;', 'return made;'],
	],
	[
		'layers',
		'the page listing every template slot, not the ones the mapping draws in',
		[MAP, '\t\t.filter((n) => drawn.has(n))\n\t\t.reverse();', '\t\t.reverse();'],
	],
	[
		'layers',
		'a prop listed before its part, not after it as the rig draws it',
		[
			ORDER,
			'out.splice(p.after !== undefined ? at + 1 : at, 0, p.name);',
			'out.splice(at, 0, p.name);',
		],
	],
	[
		'layers',
		'the layers sent to the fit back to front, not front to back',
		[
			FIT,
			'...(m.layers && fitLayers ? { order: [...m.layers].reverse() } : {}),',
			'...(m.layers && fitLayers ? { order: [...m.layers] } : {}),',
		],
	],
	['layers', 'the layers not kept in sheet.json', [FIT, '...(layers ? { layers } : {}),', '']],
	[
		'layers',
		'a layer nothing is drawn in let through',
		[
			FIT,
			'if (stray !== undefined)\n\t\t\treturn `the layers list',
			'if (false)\n\t\t\treturn `the layers list',
		],
	],
	[
		'layers',
		"the fit's order never applied",
		[TFIT, '\tif (fit.order) {\n\t\tconst byName', '\tif (false) {\n\t\tconst byName'],
	],
	[
		'layers',
		"template.json's order not read back",
		[TFIT, '\t\tfit.order = [...(raw.order as string[])];', ''],
	],
	[
		'layers',
		'a 3D layer left apart by the author',
		[
			TFIT,
			'layers = layersTogether(',
			'layers = ((l: Record<string, string[]>, _s: string[]) => l)(',
		],
	],
	[
		'layers',
		'an order the depth control cannot stand with refused without saying why',
		[
			FIT,
			'\tconst against = layersAgainstDepth(t, { ...fit, slots: names });\n\tif (against) return layersRefused(against);\n',
			'',
		],
	],
	[
		'eyes',
		'the glasses just over the head, under the eyes and lids (as before)',
		[
			MAP,
			"const onFace = slot === 'head' && slots.includes('hair_front');",
			'const onFace = false;',
		],
	],
	[
		'eyes',
		'a hat under the front hair',
		[
			MAP,
			"const beside = side ? armTail(slots, side) : overHair ? 'hair_front' : slot;",
			'const beside = side ? armTail(slots, side) : slot;',
		],
	],
];
const SOURCES = {
	[MAP]: join(LIB, MAP),
	[FIT]: join(SERVER, FIT),
	[TFIT]: join(SERVER, TFIT),
	[ORDER]: join(LIB, ORDER),
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
