// check:family-runtimes — each runtime carries only its families (`docs/design/phase-11.md` §3.1),
// and what a first visit to it downloads stays within its budget.
//
//   node scripts/check-family-runtime.mjs --id <lines|match3|arcade|card> --families <value> <buildDir>
//       checks ONE build, as the release workflow does per id: its `__IE_FAMILIES__` is the set
//       `<value>` (a `PUBLIC_IE_FAMILIES` value) compiles, every left-out family's markers are absent
//       from every file of the build (the shell and every chunk, lazy ones included) and every
//       included family's present. Its first-visit size over `scripts/family-runtime-budget.json`
//       is a warning here, never a failure: no PR check runs this, so a hard size gate would first
//       fail after merge and keep every game on the old engine. The local run below is where the
//       budget is enforced.
//   pnpm check:family-runtimes
//       builds `apps/lines` once per runtime with the release env and checks each (minutes; not in
//       `check:all`, which skips this file).
//   pnpm check:family-runtimes --measure
//       the same, printing each size and the budget it would set (measured + 2 %) without failing.
//
// SIZES (gzip -6, each file as it is served; `lib/build-chunks.mjs`). A build is an `index.html`
// shell plus `_app/immutable/` files, so there are three numbers:
//   first visit        the shell + what it loads eagerly: the bundle (Pixi's WebGL renderer and
//                      browser environment included, `config-vite` `eagerPixiBoot`), its CSS.
//   online boot        a family with an online mode (arcade): the first visit + its online chunk
//                      (`ONLINE_MARKERS`), which every online game of the family imports. This is
//                      the figure that family's budget holds.
//   repeat-visit code  the shell alone: the code under `_app/immutable/` is served immutable and
//                      comes from the browser cache (`check:runtime-shell` proves it in Chromium).
//                      Budgeted too (`shell`), because a shell that grows is re-downloaded on every
//                      visit. CODE only: the build's own `assets/` (art, audio) keep stable names and
//                      are served `no-store`, so a repeat visit fetches them again.
// Lazy chunks only some boots load (the Sentry SDK, Pixi's canvas fallback) are reported, not
// budgeted. A family with an online mode whose online code is in NO lazy chunk is a problem, not a
// warning (the release job fails): the online-boot budget would otherwise silently mean nothing.
// This is a build measure next to the current-games harness, not part of it: the harness boots the
// same builds and compares screens; this reads bytes.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OPTIONAL_FAMILIES, compiledFamilies } from '../packages/config-vite/families.js';
import { allCode, firstVisit } from './lib/build-chunks.mjs';
import { PROBE_DSN } from './lib/game-build-variants.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'scripts/family-runtime-budget.json');
/** The release's build env. Its DSN is a stand-in: the release sets a real one, so the measured
 *  build carries the same SDK chunk (lazy, not counted) and boot code a player's does. */
const RELEASE_ENV = {
	PUBLIC_RGS_TRANSPORT: 'play4fun',
	PUBLIC_DELIVERY_PROFILES: '*',
	PUBLIC_SENTRY_DSN: PROBE_DSN,
};

/**
 * Strings only a family's code carries: its error messages, its online SDK, its Flow vocabulary.
 * Each must be in a runtime with the family and nowhere else, so a seam that leaks shows here.
 */
const FAMILY_MARKERS = {
	match3: ['[match3] board work failed', 'How many cascade steps the move made.'],
	arcade: ['@colyseus/schema', 'joinOrCreate', 'arseed', 'A body moved out of a zone it was in.'],
	card: ['cards: the game has no config', 'A card was drawn.'],
};

/**
 * A family's online code, by a string only it carries: a lazy chunk an OFFLINE game of the family
 * never fetches and every online one does (`apps/lines/src/game/online.ts` imports `engine-rooms`
 * when it joins a room). Counted into that family's budget, so moving it out of the bundle cannot
 * read as the runtime shrinking.
 */
const ONLINE_MARKERS = { arcade: ['joinOrCreate'] };

/** The runtimes the release builds (`id`, its `PUBLIC_IE_FAMILIES`). */
const RUNTIMES = [
	{ id: 'lines', families: 'slot' },
	{ id: 'match3', families: 'match3' },
	{ id: 'arcade', families: 'arcade' },
	{ id: 'card', families: 'card' },
];

const keyOf = (list) => list.join(',');

/**
 * The shell's budget never drops below this. It is ~4 KB (the boot splash in `app.html`), where 2 %
 * is a sentence of markup; what the budget is for is the bundle, or anything big, creeping back into
 * the one file no visit can cache.
 */
const SHELL_BUDGET_FLOOR = 5000;

/** The family set an id may carry: `lines` is every slot kind and nothing else. */
const idProblem = (id, list) => {
	if (id === 'lines')
		return list.length === 1 ? null : `'lines' is built slot-only, not ${keyOf(list)}`;
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
const definedSets = (code) => {
	const every = keyOf(['slot', ...OPTIONAL_FAMILIES]);
	const found = new Set([...code.matchAll(FAMILY_LIST)].map((m) => keyOf(JSON.parse(m[0]))));
	const others = [...found].filter((k) => k !== every);
	return others.length ? others : found.has(every) ? [every] : [];
};

/** Problems with one build; `size` is what its budget holds (a first visit, or an online boot), `shell`
 *  its repeat-visit code (gzip -6 bytes). */
function checkBundle({ id, families, buildDir, budgets }) {
	const problems = [];
	const list = compiledFamilies(families);
	const idIssue = idProblem(id, list);
	if (idIssue) problems.push(idIssue);
	const file = join(buildDir, 'index.html');
	if (!existsSync(file)) return { problems: [...problems, `no build at ${buildDir}`], list };
	const onlineMarkers = list.flatMap((family) => ONLINE_MARKERS[family] ?? []);
	const visit = firstVisit(buildDir, { onlineMarkers });
	if (onlineMarkers.length && !visit.online.length)
		problems.push(`no lazy chunk holds the online code (${onlineMarkers.join(', ')})`);
	if (!visit.eager.length) problems.push(`${file} loads nothing from _app/immutable/`);
	const code = allCode(buildDir);

	const defined = definedSets(code);
	if (defined.length !== 1 || defined[0] !== keyOf(list))
		problems.push(
			`__IE_FAMILIES__ is ${defined.join(' | ') || 'missing'}, expected ${keyOf(list)}`,
		);
	for (const family of OPTIONAL_FAMILIES) {
		const carried = list.includes(family);
		for (const marker of FAMILY_MARKERS[family]) {
			if (code.includes(marker) !== carried)
				problems.push(
					carried
						? `${family} is compiled in but its marker '${marker}' is missing`
						: `${family} is left out but its marker '${marker}' is in the build`,
				);
		}
	}
	const size = onlineMarkers.length ? visit.gz.onlineVisit : visit.gz.firstVisit;
	const shell = visit.gz.shell;
	const budget = budgets[keyOf(list)];
	const shellBudget = budgets.shell;
	if (typeof budget !== 'number') problems.push(`no budget for ${keyOf(list)} in ${BUDGET_FILE}`);
	if (typeof shellBudget !== 'number') problems.push(`no shell budget in ${BUDGET_FILE}`);
	const over = [
		typeof budget === 'number' && size > budget
			? `${onlineMarkers.length ? 'an online boot' : 'a first visit'} (${size} B gzip) is over the ${keyOf(list)} budget of ${budget} B (+${size - budget})`
			: undefined,
		typeof shellBudget === 'number' && shell > shellBudget
			? `the shell (a repeat visit's code) is ${shell} B gzip, over its budget of ${shellBudget} B`
			: undefined,
	].filter(Boolean);
	return { problems, over: over.join('; ') || undefined, list, visit, size, shell, budget };
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

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;

const report = (label, result) => {
	const verdict = result.problems.length ? 'FAIL' : result.over ? 'WARN' : 'ok  ';
	console.log(`${verdict} ${label}`);
	if (result.visit) {
		const { gz, online } = result.visit;
		console.log(
			`       first visit ${gz.firstVisit} B gzip (shell ${gz.shell} + eager ${gz.eager})` +
				(online.length
					? `; online boot ${gz.onlineVisit} B gzip (+ ${online.join(', ')}; budgeted)`
					: '') +
				`; repeat-visit code ${result.shell} B gzip (the shell); lazy, not counted: ` +
				`${kb(gz.lazy - gz.online)}`,
		);
	}
	for (const p of [...result.problems, ...(result.over ? [result.over] : [])])
		console.log(`       ${p}`);
};

function buildAll(measure) {
	const budgets = measure ? {} : readBudgets();
	const out = mkdtempSync(join(tmpdir(), 'ie-family-runtimes-'));
	let failed = 0;
	try {
		run(['--filter', 'lines^...', 'build']);
		const results = [];
		for (const { id, families } of RUNTIMES) {
			rmSync(join(ROOT, 'apps/lines/build'), { recursive: true, force: true });
			run(['--filter', 'lines', 'build'], { ...RELEASE_ENV, PUBLIC_IE_FAMILIES: families });
			const dir = join(out, `${id}-${families}`);
			cpSync(join(ROOT, 'apps/lines/build'), dir, { recursive: true });
			results.push({ id, families, result: checkBundle({ id, families, buildDir: dir, budgets }) });
		}
		console.log('');
		for (const { id, families, result } of results) {
			const problems = measure
				? result.problems.filter((p) => !/^no (shell )?budget/.test(p))
				: result.problems;
			if (problems.length || result.over) failed++;
			report(`${id} (PUBLIC_IE_FAMILIES=${families})`, { ...result, problems });
		}
		if (measure) {
			const next = Object.fromEntries(
				results.map(({ result }) => [keyOf(result.list), Math.ceil(result.size * 1.02)]),
			);
			next.shell = Math.max(
				SHELL_BUDGET_FLOOR,
				Math.ceil(Math.max(...results.map(({ result }) => result.shell)) * 1.02),
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
	if (result.over)
		console.log(`::warning title=${id} runtime over its size budget::${result.over}`);
	if (result.problems.length) {
		console.error(`\ncheck:family-runtimes: the ${id} runtime is not what it should be`);
		process.exit(1);
	}
}

main(process.argv.slice(2));
