// The Slots list's ↑ ↓ / Ctrl+] [ with folders (`slotFolderStep` in static/rigger/view.html), offline:
//
//   node tools/rigger-spike/slot-folder-step.mjs
//
// Over every selection of a few rigs with folders, every direction, as a seeded sweep: the step keeps
// each folder's slots together in the draw order, never takes an unselected slot out of its folder,
// and moves a folder whose every slot is selected whole.
// Plus the cases that broke: a selection of a free slot and a folder's middle slot (an unselected
// slot used to leave its folder), and a folder's every slot selected by hand (the folder used to go).
// Each planted bug must fail a check.
import { viewSandbox } from './view-sandbox.mjs';

const MUTANTS = [
	[
		'a free slot passes a folder one slot at a time',
		'const f = slotFolderOf(next, n), id = f != null ? "\\u0000" + f : n;',
		'const id = n;',
	],
	[
		'a folder selected by hand is not moved whole',
		'    if (mine.length === ns.length){ whole.add(f); continue; }\n',
		'',
	],
	[
		'a member at the edge moves on instead of leaving',
		'      let i = 0; while (i < edge.length && set.has(edge[i])) i++;\n',
		'      const i = 0;\n',
	],
	['a member moves out past the folder', '    next[f] = inner;\n', ''],
];

const q = JSON.stringify;
function run(mutate = []) {
	const ui = viewSandbox({ entry: ['slotFolderStep'], mutate, label: 'slot-folder-step' });
	let pass = 0;
	const fails = [];
	const ok = (name, cond, detail) =>
		cond ? pass++ : fails.push(`${name}${detail ? ` — ${detail}` : ''}`);

	// The reviewer's case: w,x,a,b,c,d with F = a,b,c; Ctrl+] on { x, b }.
	{
		const r = ui.slotFolderStep(
			['w', 'x', 'a', 'b', 'c', 'd'],
			{ F: ['a', 'b', 'c'] },
			['x', 'b'],
			1,
			null,
		);
		ok(
			'a free slot and a middle member: x passes the folder, b moves inside it, a stays in',
			q(r) === q({ order: ['w', 'a', 'c', 'b', 'x', 'd'], folders: { F: ['a', 'c', 'b'] } }),
			q(r),
		);
	}
	{
		const r = ui.slotFolderStep(
			['w', 'x', 'a', 'b', 'c', 'd'],
			{ F: ['a', 'b', 'c'] },
			['a', 'b', 'c'],
			1,
			null,
		);
		ok(
			'every slot of a folder selected by hand moves the folder whole',
			q(r) === q({ order: ['w', 'x', 'd', 'a', 'b', 'c'], folders: { F: ['a', 'b', 'c'] } }),
			q(r),
		);
	}
	{
		const r = ui.slotFolderStep(['w', 'a', 'b', 'c', 'd'], { F: ['a', 'b', 'c'] }, ['c'], 1, null);
		ok(
			'the frontmost member leaves where it is',
			q(r) === q({ order: ['w', 'a', 'b', 'c', 'd'], folders: { F: ['a', 'b'] } }),
			q(r),
		);
	}
	{
		const r = ui.slotFolderStep(['w', 'a', 'b', 'c', 'd'], { F: ['a', 'b', 'c'] }, ['w'], 1, null);
		ok('a free slot passes the whole folder', q(r.order) === q(['a', 'b', 'c', 'w', 'd']), q(r));
	}

	// The sweep: rigs of 7 slots with one or two folders, every selection, every direction.
	const names = ['s0', 's1', 's2', 's3', 's4', 's5', 's6'];
	const rigs = [
		{ F: ['s2', 's3', 's4'] },
		{ F: ['s0', 's1'], G: ['s3', 's4', 's5'] },
		{ F: ['s1', 's2'], G: ['s3'], H: ['s5', 's6'] },
	];
	let cases = 0;
	for (const folders of rigs)
		for (let m = 1; m < 1 << names.length; m++)
			for (const dir of [1, -1, Infinity, -Infinity]) {
				const moving = names.filter((_, i) => m & (1 << i));
				const r = ui.slotFolderStep(names, folders, moving, dir, null);
				const at = new Map(r.order.map((n, i) => [n, i]));
				const tag = `${q(folders)} ${q(moving)} ${dir}`;
				cases++;
				if (q([...r.order].sort()) !== q(names)) ok('the order holds every slot once', false, tag);
				for (const ns of Object.values(r.folders)) {
					const ps = ns.map((n) => at.get(n)).sort((a, b) => a - b);
					if (ps.length && ps[ps.length - 1] - ps[0] !== ps.length - 1)
						ok('a folder’s slots stay together', false, `${tag} → ${q(r)}`);
				}
				for (const [f, ns] of Object.entries(folders)) {
					const kept = r.folders[f] || [];
					if (ns.some((n) => !moving.includes(n) && !kept.includes(n)))
						ok('no unselected slot leaves its folder', false, `${tag} → ${q(r)}`);
					if (
						ns.every((n) => moving.includes(n)) &&
						q(kept.slice().sort()) !== q(ns.slice().sort())
					)
						ok('a fully selected folder keeps every slot', false, `${tag} → ${q(r)}`);
				}
			}
	ok(`the sweep ran (${cases} cases)`, cases === rigs.length * 127 * 4);
	return { pass, fails };
}

{
	const base = run();
	for (const f of base.fails) console.log(`  ✗ ${f}`);
	console.log(
		base.fails.length
			? `✗ FAIL — ${base.fails.length} failed, ${base.pass} passed`
			: `✅ ${base.pass} checks pass`,
	);
	let caught = 0;
	for (const [name, find, replace] of MUTANTS) {
		const r = run([[find, replace]]);
		if (r.fails.length) caught++;
		console.log(
			`  ${r.fails.length ? '✓' : '✗'} mutant: ${name}${r.fails.length ? '' : ' — NOT caught'}`,
		);
	}
	console.log(`${caught}/${MUTANTS.length} mutants caught`);
	process.exit(base.fails.length || caught !== MUTANTS.length ? 1 : 0);
}
