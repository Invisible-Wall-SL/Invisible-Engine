// Fail the build on an identifier that does not exist — the one type error a `vite build` can
// never catch, and the one that takes a shipped game down.
//
//   node scripts/check-undefined-names.mjs
//
// WHY THIS EXISTS: #373 renamed a local in `apps/lines/src/game/anticipation.ts` and left two
// shorthand properties (`linePay,` / `numLines,`) pointing at names that no longer existed. Every
// gate was green — an app's `build` is a bare `vite build`, and esbuild TRANSPILES per file without
// type-checking, while typescript-eslint leaves `no-undef` off because it defers to the compiler.
// The regression auto-released to every online game and killed the first free spin of every
// Book-of round with `ReferenceError: linePay is not defined`. `tsc` reports it instantly.
//
// `.svelte` FILES TOO. The same bug blanked the shared runtime's reels twice more, both times in a
// component: #549 (`rigBeatKey()` called in an `{#each}` KEY in the markup, never imported) and
// #567 (`getContextSpineLoadScale()` called in a `<script>`, never imported). The Svelte compiler
// reads a bare unknown identifier as a global, so the build stays green and the throw happens at
// mount. Each component is converted with `svelte2tsx` — the transform `svelte-check` itself uses —
// which turns the script AND every template expression into plain TypeScript, so a name used only
// in the markup is checked as well. Hits are mapped back to the `.svelte` line through the
// transform's source map.
//
// SCOPE, deliberately narrow. This is NOT a full type-check: it runs `tsc --noResolve` and reports
// only the "this name does not exist" family —
//
//   TS2304   Cannot find name 'x'
//   TS2552   Cannot find name 'x'. Did you mean 'y'?
//   TS18004  No value exists in scope for the shorthand property 'x'
//
// `--noResolve` is what makes it both cheap and trustworthy: nothing is loaded across module
// boundaries, so the check cannot be derailed by the two things that make a full `tsc` unusable in
// this repo today — the ambient `*.svelte` module shim (plain `tsc` sees only a default export, so
// every `import type { Props } from './X.svelte'` reports a phantom error) and unresolved JSON
// imports. An import STATEMENT still declares its names, so a genuine dangling identifier is still
// caught, and there is nothing to baseline: the repo is clean under this rule today.
//
// A full type-check is still worth having and is NOT this; `docs/status/engine.md` records the
// measured debt that would have to be fixed or baselined first.
//
// AMBIENT NAMES: `--noResolve` also means nothing pulls in the declarations for globals, so the
// program is seeded with the repo's own `.d.ts` files (they declare `__IE_DEBUG__`), Svelte's real
// rune declarations, and svelte2tsx's shims (the `__sveltets_*` helpers and `svelteHTML` its output
// calls). Using Svelte's own file rather than a hand-written shim is the point — a typo'd rune
// (`$stat`) is exactly what this should catch, and a shim would declare it away.

import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { svelte2tsx } from 'svelte2tsx';

// fileURLToPath, not `new URL(...).pathname` — this repo's path contains spaces, which stay
// percent-encoded in `pathname`, so the walk silently finds nothing and the check passes vacuously.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps', 'packages', 'services'];

const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'dist',
	'build',
	'storybook-static',
	'.turbo',
	'coverage',
	'static',
]);

/** The error codes this check owns. Anything else `tsc` reports is out of scope by design. */
const CODES = new Set(['TS2304', 'TS2552', 'TS18004']);

/** tsc emits native separators; tsconfig and the rest of this repo talk in POSIX paths. */
const posix = (value) => value.split(sep).join('/');

function collect(dir, ts, svelte) {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) collect(full, ts, svelte);
		else if (entry.endsWith('.ts')) ts.push(full);
		else if (entry.endsWith('.svelte')) svelte.push(full);
	}
}

const tsFiles = [];
const svelteFiles = [];
for (const root of ROOTS) {
	const dir = join(ROOT, root);
	if (existsSync(dir)) collect(dir, tsFiles, svelteFiles);
}
if (tsFiles.length === 0 || svelteFiles.length === 0) {
	console.error('check-undefined-names: found no TypeScript or Svelte files — the walk is broken.');
	process.exit(1);
}

const rootRequire = createRequire(join(ROOT, 'package.json'));
const tsc = rootRequire.resolve('typescript/lib/tsc.js');

const svelteDir = dirname(rootRequire.resolve('svelte/package.json'));
const svelteVersion = JSON.parse(readFileSync(join(svelteDir, 'package.json'), 'utf8')).version;
const svelteRunes = join(svelteDir, 'types', 'index.d.ts');
const s2tDir = dirname(rootRequire.resolve('svelte2tsx/package.json'));
const ambient = [
	svelteRunes,
	join(s2tDir, 'svelte-shims-v4.d.ts'),
	join(s2tDir, 'svelte-jsx-v4.d.ts'),
];
for (const file of ambient) {
	if (!existsSync(file)) {
		console.error(`check-undefined-names: missing ambient declarations at ${file}.`);
		console.error('Without them every rune and every svelte2tsx helper would report as undefined.');
		process.exit(1);
	}
}

const tmp = mkdtempSync(join(tmpdir(), 'undef-names-'));

/** Converted component path → { source, map } so a hit is reported at its `.svelte` line. */
const converted = new Map();
const unconvertible = [];
for (const file of svelteFiles) {
	const rel = relative(ROOT, file);
	let result;
	try {
		result = svelte2tsx(readFileSync(file, 'utf8'), {
			filename: file,
			isTsFile: true,
			mode: 'ts',
			version: svelteVersion,
		});
	} catch (error) {
		unconvertible.push(`  ${posix(rel)} — ${error.message.split('\n')[0]}`);
		continue;
	}
	const out = join(tmp, `${rel}.ts`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, result.code);
	converted.set(resolve(out), { source: posix(rel), map: new TraceMap(result.map) });
}
if (unconvertible.length > 0) {
	rmSync(tmp, { recursive: true, force: true });
	console.error(`✗ ${unconvertible.length} component(s) svelte2tsx could not convert:`);
	for (const line of unconvertible) console.error(line);
	process.exit(1);
}

const configPath = join(tmp, 'tsconfig.json');
writeFileSync(
	configPath,
	JSON.stringify({
		compilerOptions: {
			noEmit: true,
			skipLibCheck: true,
			noResolve: true,
			allowJs: false,
			target: 'es2022',
			module: 'esnext',
			moduleResolution: 'bundler',
		},
		files: [...ambient, ...tsFiles, ...converted.keys()].map(posix),
	}),
);

// `--max-old-space-size`: checking ~1550 files in one program needs more than Node's default heap,
// and a compiler that dies mid-run prints nothing this parser recognises. The first version of this
// script had exactly that failure — tsc OOM'd, the filter found no diagnostics, and it reported a
// clean pass while missing the very regression it was written for. Hence the heap, and the
// exit-status check below: an unfinished check must never look like a passing one.
const run = spawnSync(
	process.execPath,
	['--max-old-space-size=8192', tsc, '-p', configPath, '--pretty', 'false'],
	{ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
rmSync(tmp, { recursive: true, force: true });

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (run.error) {
	console.error(`check-undefined-names: could not run tsc — ${run.error.message}`);
	process.exit(1);
}
// tsc exits 0 with no diagnostics and 1/2 with them. Anything else — a crash, a heap OOM, a signal
// — means the check did not COMPLETE, which is a failure, not a pass.
if (![0, 1, 2].includes(run.status)) {
	console.error(`check-undefined-names: tsc exited ${run.status} without completing.`);
	console.error(output.split(/\r?\n/).slice(0, 12).join('\n'));
	process.exit(1);
}

/** A converted component's hit, rewritten to name the `.svelte` file and its original line. */
function toSource(line) {
	const match = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(line);
	if (!match) return line;
	const entry = converted.get(resolve(ROOT, match[1]));
	if (!entry) return line;
	const pos = originalPositionFor(entry.map, {
		line: Number(match[2]),
		column: Number(match[3]) - 1,
	});
	const where = pos.line == null ? '?' : `${pos.line},${pos.column + 1}`;
	return `${entry.source}(${where}): ${match[4]}`;
}

// Only OUR files: `--noResolve` still parses the Svelte and svelte2tsx declaration files, whose own
// unresolved imports are noise this check does not own.
const hits = output
	.split(/\r?\n/)
	.filter((line) => {
		const match = /error (TS\d+):/.exec(line);
		return match && CODES.has(match[1]) && !line.includes('node_modules');
	})
	.map(toSource);

const scanned = `${tsFiles.length} TypeScript + ${converted.size} Svelte files`;
if (hits.length === 0) {
	console.log(`✓ no undefined identifiers in ${scanned}`);
	process.exit(0);
}

console.error(`✗ ${hits.length} undefined identifier(s) in ${scanned} — these throw at RUNTIME:`);
console.error('');
for (const hit of hits) console.error(`  ${posix(hit)}`);
console.error('');
console.error('A name is used but never declared or imported. Fix the import, or the rename that');
console.error('left it behind. See the header of scripts/check-undefined-names.mjs.');
process.exit(1);
