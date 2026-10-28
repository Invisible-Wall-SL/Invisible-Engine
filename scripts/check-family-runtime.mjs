// check:family-runtimes — each runtime carries only its families (`docs/design/phase-11.md` §3.1).
//
//   node scripts/check-family-runtime.mjs --id <lines|match3|arcade|card> --families <value> <buildDir>
//       checks ONE built bundle (`<buildDir>/index.html`), as the release workflow does per id:
//       its `__IE_FAMILIES__` is the set `<value>` (a `PUBLIC_IE_FAMILIES` value) compiles, every
//       left-out family's markers are absent and every included family's present, and its gzip -6
//       size is within `scripts/family-runtime-budget.json`.
//   pnpm check:family-runtimes
//       builds `apps/lines` once per runtime with the release env and checks each (minutes; not in
//       `check:all`, which skips this file).
//   pnpm check:family-runtimes --measure
//       the same, printing each size and the budget it would set (measured + 2 %) without failing.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { OPTIONAL_FAMILIES, compiledFamilies } from '../packages/config-vite/families.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'scripts/family-runtime-budget.json');
const RELEASE_ENV = { PUBLIC_RGS_TRANSPORT: 'play4fun', PUBLIC_DELIVERY_PROFILES: '*' };

/**
 * Strings only a family's code carries: its error messages, its online SDK, its Flow vocabulary.
 * Each must be in a runtime with the family and nowhere else, so a seam that leaks shows here.
 */
const FAMILY_MARKERS = {
	match3: ['[match3] board work failed', 'How many cascade steps the move made.'],
	arcade: ['@colyseus/schema', 'joinOrCreate', 'arseed', 'A body moved out of a zone it was in.'],
	card: ['cards: the game has no config', 'A card was drawn.'],
};

/** The runtimes the release builds (`id`, its `PUBLIC_IE_FAMILIES`), and slot-only for P11.1c. */
const RUNTIMES = [
	{ id: 'lines', families: 'all' },
	{ id: 'lines', families: 'slot' },
	{ id: 'match3', families: 'match3' },
	{ id: 'arcade', families: 'arcade' },
	{ id: 'card', families: 'card' },
];

const keyOf = (list) => list.join(',');

/** The family set an id may carry: `lines` is every slot kind (all until P11.1c strips it). */
const idProblem = (id, list) => {
	if (id === 'lines')
		return list.length === 1 || list.length === OPTIONAL_FAMILIES.length + 1
			? null
			: `'lines' is built slot-only or with every family, not ${keyOf(list)}`;
	if (!OPTIONAL_FAMILIES.includes(id)) return `unknown runtime id '${id}'`;
	return keyOf(list) === keyOf(['slot', id])
		? null
		: `'${id}' is built slot + ${id}, not ${keyOf(list)}`;
};

const FAMILY_LIST = /\["slot"(?:,"(?:match3|arcade|card)")*\]/g;

/**
 * The bundle's `__IE_FAMILIES__`: the family-list literals it holds, less `CONFIG_FAMILIES` (every
 * family, which `game-config` carries into each runtime), which an `all` build's define equals.
 */
const definedSets = (html) => {
	const every = keyOf(['slot', ...OPTIONAL_FAMILIES]);
	const found = new Set([...html.matchAll(FAMILY_LIST)].map((m) => keyOf(JSON.parse(m[0]))));
	const others = [...found].filter((k) => k !== every);
	return others.length ? others : found.has(every) ? [every] : [];
};

/** Problems with one built bundle; `size` is its gzip -6 bytes. */
function checkBundle({ id, families, buildDir, budgets }) {
	const problems = [];
	const list = compiledFamilies(families);
	const idIssue = idProblem(id, list);
	if (idIssue) problems.push(idIssue);
	const file = join(buildDir, 'index.html');
	if (!existsSync(file)) return { problems: [...problems, `no bundle at ${file}`], list };
	const html = readFileSync(file, 'utf8');
	const raw = Buffer.byteLength(html);
	const size = gzipSync(html, { level: 6 }).length;

	const defined = definedSets(html);
	if (defined.length !== 1 || defined[0] !== keyOf(list))
		problems.push(
			`__IE_FAMILIES__ is ${defined.join(' | ') || 'missing'}, expected ${keyOf(list)}`,
		);
	for (const family of OPTIONAL_FAMILIES) {
		const carried = list.includes(family);
		for (const marker of FAMILY_MARKERS[family]) {
			if (html.includes(marker) !== carried)
				problems.push(
					carried
						? `${family} is compiled in but its marker '${marker}' is missing`
						: `${family} is left out but its marker '${marker}' is in the bundle`,
				);
		}
	}
	const budget = budgets[keyOf(list)];
	if (typeof budget !== 'number') problems.push(`no budget for ${keyOf(list)} in ${BUDGET_FILE}`);
	else if (size > budget)
		problems.push(
			`${size} B gzip is over the ${keyOf(list)} budget of ${budget} B (+${size - budget})`,
		);
	return { problems, list, raw, size, budget };
}

const run = (args, env = {}) => {
	const r = spawnSync('pnpm', args, {
		cwd: ROOT,
		env: { ...process.env, ...env },
		stdio: ['ignore', 'inherit', 'inherit'],
		shell: process.platform === 'win32',
	});
	if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (exit ${r.status})`);
};

const readBudgets = () => JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

const report = (label, result) => {
	const sizes = result.size === undefined ? '' : ` ${result.raw} B raw, ${result.size} B gzip`;
	console.log(`${result.problems.length ? 'FAIL' : 'ok  '} ${label}${sizes}`);
	for (const p of result.problems) console.log(`       ${p}`);
};

function buildAll(measure) {
	const budgets = measure ? {} : readBudgets();
	const out = mkdtempSync(join(tmpdir(), 'ie-family-runtimes-'));
	let failed = 0;
	try {
		run(['--filter', 'lines^...', 'build']);
		const results = [];
		for (const { id, families } of RUNTIMES) {
			run(['--filter', 'lines', 'build'], { ...RELEASE_ENV, PUBLIC_IE_FAMILIES: families });
			const dir = join(out, `${id}-${families}`);
			cpSync(join(ROOT, 'apps/lines/build/index.html'), join(dir, 'index.html'));
			results.push({ id, families, result: checkBundle({ id, families, buildDir: dir, budgets }) });
		}
		console.log('');
		for (const { id, families, result } of results) {
			const problems = measure
				? result.problems.filter((p) => !p.startsWith('no budget'))
				: result.problems;
			if (problems.length) failed++;
			report(`${id} (PUBLIC_IE_FAMILIES=${families})`, { ...result, problems });
		}
		if (measure) {
			const next = Object.fromEntries(
				results.map(({ result }) => [keyOf(result.list), Math.ceil(result.size * 1.02)]),
			);
			console.log(`\nbudget at measured + 2 %:\n${JSON.stringify(next, null, '\t')}`);
		}
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
	return failed;
}

function main(argv) {
	const flag = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	if (argv.includes('--all') || argv.includes('--measure')) {
		const failed = buildAll(argv.includes('--measure'));
		if (failed) {
			console.error(`\n${failed} runtime(s) failed check:family-runtimes`);
			process.exit(1);
		}
		console.log('\nfamily runtimes ok');
		return;
	}
	const id = flag('--id');
	const families = flag('--families');
	const buildDir = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))[0];
	if (!id || families === undefined || !buildDir) {
		console.error(
			'usage: node scripts/check-family-runtime.mjs --id <lines|match3|arcade|card> ' +
				'--families <PUBLIC_IE_FAMILIES value> <buildDir>',
		);
		process.exit(2);
	}
	const result = checkBundle({ id, families, buildDir: resolve(buildDir), budgets: readBudgets() });
	report(`${id} (PUBLIC_IE_FAMILIES=${families}) ${buildDir}`, result);
	if (result.problems.length) {
		console.error(`\ncheck:family-runtimes: the ${id} runtime is not what it should be`);
		process.exit(1);
	}
}

main(process.argv.slice(2));
