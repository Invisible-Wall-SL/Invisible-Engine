// 🗺 From my sheet — the 🗺 Edit mapping Layers preview against 🔄 Update rig (docs/design/frame-to-rig.md
// §13.1e), headless on the SHIPPED code (`rigSheetUpdate.ts` `sheetEditPreview`, as
// `/api/rigger/from-sheet/preview` runs it with the open rig, and `updateSheetRig`, as
// `/api/rigger/from-sheet/update` runs it) over the committed sheet fixture (`fixtures/sheet-rig/`).
// Its own gate, so `sheet-rig-update.mjs` stays inside `check:all`'s five minutes. Asserted, for each
// edit: the slots the preview judges are the ones the update's merge (`frameRigUpdate`) leaves; the
// preview warns exactly when the update refuses, in its words — Setup's arm behind the head and a
// forearm prop worn anew left where the list puts it: neither; a list moving a slot there, a prop worn
// anew on an arm drawn behind the head, a finger Setup drew behind the head: both. Without a rig the
// preview refuses exactly what 🦴 Create rig refuses. Every guard is mutation-checked: a planted mutant
// of the shipped code turns its check red (each run on the cases it targets).
//   node tools/rigger-spike/sheet-layers-preview.mjs [--only <guard>] [--no-mutants]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const SERVER = join(LIB, 'server');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const esbuild = await import(ESBUILD);

const tmp = mkdtempSync(join(tmpdir(), 'sheet-layers-preview-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let bundles = 0;
const SHIPPED = /[\\/](rigSheetUpdate|rigFrameUpdate|rigSheetFit|rigTemplates)\.ts$/;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source (LF) first. */
async function load(mutate = []) {
	const out = join(tmp, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigSheetUpdate.ts';",
				"export * from './server/rigSheetFit.ts';",
				"export { sheetLayerList } from './rigSheetMap.ts';",
				"export * from './server/rigTemplates.ts';",
				"export { frameRigUpdate, mergedSlots } from './server/rigFrameUpdate.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'sheet-layers-preview-entry.ts',
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
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- the sheet and its mapping -------------------------------------------------------------------
const SHEET = read(join(FIX, 'sheet.json'));
const TRUTH = read(join(FIX, 'truth.json'));
const REGIONS = SHEET.regions.map(({ name, w, h }) => ({ name, w, h }));
const slotOf = (M, part) => M.HALF_BODY.parts.find((p) => p.name === part)?.slot ?? part;
const boneOfSlot = (M, slot) => M.HALF_BODY.slots.find((s) => s.name === slot).bone;

/** The mapping the page sends for the sheet, arranged as its preview draws it at rest. */
function baseMapping(M) {
	const parts = {};
	for (const [part, t] of Object.entries(TRUTH.parts))
		parts[part] = { region: t.region, joints: t.joints, ...(t.face ? { face: t.face } : {}) };
	const m = {
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
	const sp = M.sheetPreview(M.HALF_BODY, REGIONS, m);
	if (!sp.ok) throw new Error(sp.problem);
	const arrange = {};
	for (const a of sp.value.art) {
		if (!TRUTH.parts[a.name]) continue;
		const x = a.matrix;
		arrange[a.name] = {
			at: [
				Math.round((sp.value.origin[0] + x[4] / sp.value.scale) * 1e3) / 1e3,
				Math.round((sp.value.origin[1] - x[5] / sp.value.scale) * 1e3) / 1e3,
			],
			turn: Math.round(((-Math.atan2(x[2], x[0]) * 180) / Math.PI) * 1e4) / 1e4,
		};
	}
	return { ...m, arrange };
}

/** What 🦴 Create rig makes of `mapping`: the `.irig` and the fit. */
function create(M, mapping) {
	const sr = M.sheetRig(M.HALF_BODY, REGIONS, mapping);
	if (!sr.ok) throw new Error(sr.problem);
	return M.templateRig(M.HALF_BODY, REGIONS, sr.value.fit, sr.value.art).skeleton;
}

const GUARDS = {
	/**
	 * 🗺 Edit mapping's preview warns of the Layers exactly when 🔄 Update rig refuses them, with the
	 * same words (`sheetEditPreview`, as `/api/rigger/from-sheet/preview` runs it with the open rig):
	 * a rig whose Setup drew the arm behind the head, a forearm prop worn anew left where the list
	 * places it, is accepted by both; a list that moves a slot there, a prop worn anew on an arm drawn
	 * behind the head, a finger Setup drew behind the head, are refused by both. Without the rig the
	 * preview refuses exactly what 🦴 Create rig refuses.
	 */
	preview(M, log, only = null) {
		let good = true;
		const on = (id) => !only || only.has(id);
		const t = M.HALF_BODY;
		const base = baseMapping(M);
		const made = create(M, base);
		const list = (m) =>
			M.sheetLayerList(
				t.slots.map((s) => s.name),
				(p) => slotOf(M, p),
				m,
			);
		const drawn = new Set(list(base));
		const setup = (doc) => doc.slots.map((s) => s.name);
		const toBehind = (doc, slot, behind) => {
			const d = clone(doc);
			const [s] = d.slots.splice(
				d.slots.findIndex((x) => x.name === slot),
				1,
			);
			d.slots.splice(
				d.slots.findIndex((x) => x.name === behind),
				0,
				s,
			);
			return d;
		};
		const opened = (doc) =>
			setup(doc)
				.filter((n) => drawn.has(n))
				.reverse();
		const moved = (l, slot, after) => {
			const out = l.filter((n) => n !== slot);
			out.splice(out.indexOf(after) + 1, 0, slot);
			return out;
		};
		/** The open rig as the page sends it with the preview: its slots, its skin's attachment names. */
		const outline = (doc) => ({
			slots: setup(doc),
			skins: [doc.skins.find((k) => k.name === 'default') ?? doc.skins[0]].map((k) => ({
				name: k.name,
				attachments: Object.fromEntries(
					Object.entries(k.attachments).map(([slot, by]) => [slot, Object.keys(by)]),
				),
			})),
		});
		const band = (m) => {
			const out = clone(m);
			const fore = out.parts.lower_arm_l;
			out.props.push({
				name: 'prop_band',
				region: 'shadow_blob',
				host: 'lower_arm_l',
				bone: boneOfSlot(M, 'lower_arm_l'),
				at: fore.joints[Object.keys(fore.joints)[0]],
			});
			return out;
		};
		const armBack = toBehind(made, 'upper_arm_l', 'head');
		const armList = opened(armBack);
		const onArm = band(base);
		const placed = { ...onArm, layers: list({ ...onArm, layers: armList }) };
		const cases = [
			[
				'opened',
				'the arm Setup drew behind the head, the list opened from it',
				armBack,
				{ ...base, layers: armList },
				true,
			],
			[
				'placed',
				'… and a forearm prop worn anew, left where the list places it',
				armBack,
				placed,
				true,
			],
			[
				'glassesOff',
				'… and the glasses taken off',
				armBack,
				{
					...placed,
					props: placed.props.filter((p) => p.name !== 'prop_glasses'),
					layers: placed.layers.filter((n) => n !== 'prop_glasses'),
				},
				true,
			],
			[
				'chainMoved',
				'… and a list that moves the chain behind the torso',
				armBack,
				{ ...base, layers: moved(armList, 'prop_chain', 'torso') },
				false,
			],
			[
				'bandBehind',
				'a forearm prop worn anew, drawn behind the head',
				made,
				{ ...onArm, layers: moved(list({ ...onArm, layers: opened(made) }), 'prop_band', 'head') },
				false,
			],
			[
				'finger',
				'a finger Setup drew behind the head, the list changed',
				toBehind(made, 'pinky_1_l', 'head'),
				{ ...base, layers: moved(opened(made), 'prop_chain', 'torso') },
				false,
			],
			[
				'bandOff',
				'a forearm prop Setup drew behind the head, taken off, the list changed',
				() => toBehind(create(M, onArm), 'prop_band', 'head'),
				{ ...base, layers: moved(opened(made), 'prop_chain', 'torso') },
				true,
				onArm,
			],
		];
		for (const [id, what, rig, mapping, accepted, was = base] of cases) {
			if (!on(id)) continue;
			const current = typeof rig === 'function' ? rig() : rig;
			// The slots the preview judges are the ones the update's merge leaves, before any layers.
			const o = { template: t, regions: REGIONS, was, mapping };
			const full = M.merging({ ...o, current });
			const lean = M.merging({ ...o, current: M.outlineDoc(outline(current)) });
			const merged = full.ok && setup(M.frameRigUpdate(full.value.input).doc);
			const judged = lean.ok && M.mergedSlots(lean.value.input);
			good =
				ok(
					`preview: ${what}: the slots it judges are the ones 🔄 Update rig's merge leaves`,
					merged && JSON.stringify(judged) === JSON.stringify(merged),
					`merge   ${merged && merged.join(' ')}\n        preview ${judged && judged.join(' ')}`,
				) && good;
			const upd = M.updateSheetRig({ template: t, regions: REGIONS, was, mapping, current });
			const pv = M.sheetEditPreview({
				template: t,
				regions: REGIONS,
				was,
				mapping,
				rig: outline(current),
			});
			good =
				ok(
					`preview: ${what}: ${accepted ? 'no warning, and 🔄 Update rig accepts' : 'the preview warns as 🔄 Update rig refuses, in its words'}`,
					upd.ok === accepted &&
						pv.ok === accepted &&
						(accepted ||
							(pv.layers === true && pv.problem === upd.problem && /depth/.test(pv.problem))),
					`update ${upd.ok ? 'accepts' : upd.problem}\n        preview ${pv.ok ? 'no warning' : pv.problem}`,
				) && good;
		}
		const creates = [
			[
				'createArm',
				'the arm drawn behind the head',
				{ ...base, layers: moved(list(base), 'upper_arm_l', 'head') },
			],
			[
				'createBand',
				'a forearm prop drawn behind the head',
				{ ...onArm, layers: moved(list(onArm), 'prop_band', 'head') },
			],
			[
				'createChain',
				'the chain behind the torso',
				{ ...base, layers: moved(list(base), 'prop_chain', 'torso') },
			],
		];
		for (const [id, what, mapping] of creates) {
			if (!on(id)) continue;
			const cr = M.sheetRig(t, REGIONS, mapping);
			const pv = M.sheetPreview(t, REGIONS, mapping);
			good =
				ok(
					`preview: no rig, ${what}: warns exactly when 🦴 Create rig refuses, in its words`,
					cr.ok === pv.ok && (cr.ok || (pv.layers === true && pv.problem === cr.problem)),
					`create ${cr.ok ? 'makes it' : cr.problem}\n        preview ${pv.ok ? 'no warning' : pv.problem}`,
				) && good;
		}
		log(`${cases.length} edits and ${creates.length} creates: the preview and the launcher agree`);
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
const UPD = 'rigSheetUpdate.ts';
const FIT = 'rigSheetFit.ts';
/** [guard, what, mutation [file, from, to], the guard's cases it targets]. */
const MUTANTS = [
	[
		'preview',
		"the preview judging every changed list, not only one that moves the merged rig's slots",
		[FIT, '\tif (now.every((n, i) => n === merged[i])) return { ok: true, value: null };\n', ''],
		['placed'],
	],
	[
		'preview',
		"the merge keeping a taken-off prop's slot (the preview's slots then not the merge's)",
		[
			'rigFrameUpdate.ts',
			'\tdoc.slots = (doc.slots ?? []).filter((s) => s.name !== r.slot);\n',
			'',
		],
		['glassesOff'],
	],
	[
		'preview',
		"the merge drawing a new prop's slot one place on (the preview's slots then not the merge's)",
		[
			'rigFrameUpdate.ts',
			'\t\tdoc.slots.splice(at, 0, { ...slot,',
			'\t\tdoc.slots.splice(at + 1, 0, { ...slot,',
		],
		['placed'],
	],
	[
		'preview',
		"the preview judged on the open rig's slots, not the ones the update's merge leaves",
		[UPD, '\t\tmergedSlots(merge.value.input),', '\t\to.rig.slots,'],
		['bandBehind'],
	],
	[
		'preview',
		"the preview judging 🦴 Create rig's way, on the template's order, with a rig open",
		[
			UPD,
			'sheetPreview(asMapped(o.template, o.mapping), o.regions, o.mapping, { edit: true })',
			'sheetPreview(asMapped(o.template, o.mapping), o.regions, o.mapping)',
		],
		['placed'],
	],
	[
		'preview',
		'the preview never warning with a rig open',
		[UPD, 'return layers.ok ? shown : layers;', 'return shown;'],
		['chainMoved'],
	],
	[
		'preview',
		'a Layers refusal not told apart from a misfit',
		[FIT, 'problem, layers: true as const });', 'problem });'],
		['chainMoved'],
	],
];
const SOURCES = {
	[UPD]: join(SERVER, UPD),
	[FIT]: join(SERVER, FIT),
	'rigFrameUpdate.ts': join(SERVER, 'rigFrameUpdate.ts'),
};
for (const [guard, what, mutation, cases] of MUTANTS) {
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
		red = !GUARDS[guard](await load([mutation]), () => {}, new Set(cases)) || fails > before;
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
