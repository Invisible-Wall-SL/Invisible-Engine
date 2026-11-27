// Rig template presets (docs/design/rig-modules.md §5 item 4): Bust with face, Half body and Full
// body written as a base and shared module builders must make TODAY's templates exactly, so no rig
// sees a difference. Headless on the SHIPPED code: every built-in, and every module option of it
// (`templateWithModules`), serialised and hashed section by section against the committed
// `rig-template-presets.snapshot.json`. Asserted:
//  - snapshot: each built-in and each option has the same keys in the same order and the same bytes
//    in every section (bones, slots, parts, channels, clips, motion, rig3d, controls, …): the order
//    of bones (weighted vertices name bones by place) and of slots (the draw order) included;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
// A deliberate template change (a version bump, a new part) is written with `--write`, and says why.
// A section that differs is written as JSON to the temp folder, named in the failure, for a diff.
//   node tools/rigger-spike/rig-template-presets.mjs [--write] [--no-mutants]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, runGate } from './owner-sheet.mjs';

const SNAPSHOT = fileURLToPath(new URL('./rig-template-presets.snapshot.json', import.meta.url));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/** Each built-in and each of its module options, by name. */
function templates(M) {
	const out = {};
	for (const t of M.RIG_TEMPLATES) {
		out[`${t.id}@${t.version}`] = t;
		for (const m of t.modules ?? [])
			for (const o of m.options)
				if (o.id !== m.default)
					out[`${t.id}@${t.version} ${m.id}=${o.id}`] = M.templateWithModules(t, { [m.id]: o.id });
	}
	return out;
}

/** A template as hashed sections: its keys in order, the whole, and each section. */
const shot = (t) => ({
	keys: Object.keys(t).join(','),
	whole: hash(t),
	...Object.fromEntries(
		Object.entries(t).map(([k, v]) => [k, Array.isArray(v) ? `${v.length}:${hash(v)}` : hash(v)]),
	),
});

if (process.argv.includes('--write')) {
	const all = Object.fromEntries(
		Object.entries(templates(await load())).map(([n, t]) => [n, shot(t)]),
	);
	writeFileSync(SNAPSHOT, `${JSON.stringify(all, null, '\t')}\n`);
	console.log(`wrote ${SNAPSHOT}`);
	process.exit(0);
}
const WANT = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const DIFFS = join(tmpdir(), 'rig-template-presets');

const GUARDS = {
	/** Every built-in and every module option as the snapshot has it, section by section. */
	snapshot(M, ok, log) {
		const got = templates(M);
		let good = ok(
			'snapshot: the same built-ins and module options',
			JSON.stringify(Object.keys(got)) === JSON.stringify(Object.keys(WANT)),
			`${Object.keys(got).join(' | ')} vs ${Object.keys(WANT).join(' | ')}`,
		);
		for (const [name, want] of Object.entries(WANT)) {
			const t = got[name];
			const have = t ? shot(t) : {};
			const off = Object.keys({ ...want, ...have }).filter((k) => want[k] !== have[k]);
			let where = '';
			if (off.length && t) {
				mkdirSync(DIFFS, { recursive: true });
				where = join(DIFFS, `${name.replace(/[^\w.@=-]+/g, '_')}.json`);
				writeFileSync(where, JSON.stringify(t, null, 1));
			}
			good =
				ok(
					`snapshot (${name}): every section the same`,
					!off.length,
					`${off.join(', ')}${where ? ` (now: ${where})` : ''}`,
				) && good;
		}
		log(`${Object.keys(got).length} templates and options`);
		return good;
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'snapshot',
		'the Half body neck a unit longer',
		[['rigTemplates.ts', 'neck(130, 40, [90, 90])', 'neck(130, 41, [90, 90])']],
	],
	[
		'snapshot',
		"the Full body's leg bones in another order",
		[
			[
				'rigTemplates.ts',
				`			{ name: \`thigh_\${s}\`, parent: 'hip', x: 35 * k, y: -10 },
			{ name: \`shin_\${s}\`, parent: \`thigh_\${s}\`, x: 0, y: -130 },`,
				`			{ name: \`shin_\${s}\`, parent: \`thigh_\${s}\`, x: 0, y: -130 },
			{ name: \`thigh_\${s}\`, parent: 'hip', x: 35 * k, y: -10 },`,
			],
		],
	],
	[
		'snapshot',
		'a bare wrist keeps its turns (the no-hands option)',
		[
			[
				'rigTemplateModules.ts',
				'(d) => !gone.has(d.bone) && !(stripped.has(d.bone) && !MOVES.has(d.prop)),',
				'(d) => !gone.has(d.bone),',
			],
		],
	],
];

await runGate('rig-template-presets', GUARDS, MUTANTS);
