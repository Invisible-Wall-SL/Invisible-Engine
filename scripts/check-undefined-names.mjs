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
// program is seeded with the repo's own `.d.ts` files (they declare `__IE_DEBUG__`) plus Svelte's
// real rune declarations. Using Svelte's own file rather than a hand-written shim is the point — a
// typo'd rune (`$stat`) is exactly what this should catch, and a shim would declare it away.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function collect(dir, out) {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) collect(full, out);
		else if (entry.endsWith('.ts')) out.push(full);
	}
}

const files = [];
for (const root of ROOTS) {
	const dir = join(ROOT, root);
	if (existsSync(dir)) collect(dir, files);
}
if (files.length === 0) {
	console.error('check-undefined-names: found no TypeScript files — the walk is broken.');
	process.exit(1);
}

const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/lib/tsc.js');

// Svelte's own rune declarations. Resolved from a workspace that depends on Svelte rather than from
// the root, because pnpm does not hoist a workspace dependency into the root `node_modules`.
const sveltePkg = createRequire(join(ROOT, 'apps/lines/package.json')).resolve(
	'svelte/package.json',
);
const svelteRunes = join(dirname(sveltePkg), 'types', 'index.d.ts');
if (!existsSync(svelteRunes)) {
	console.error(`check-undefined-names: no Svelte rune declarations at ${svelteRunes}.`);
	console.error('Without them every `$state`/`$derived`/`$effect` would report as undefined.');
	process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'undef-names-'));
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
		files: [svelteRunes, ...files].map(posix),
	}),
);

// `--max-old-space-size`: checking ~850 files in one program needs more than Node's default heap,
// and a compiler that dies mid-run prints nothing this parser recognises. The first version of this
// script had exactly that failure — tsc OOM'd, the filter found no diagnostics, and it reported a
// clean pass while missing the very regression it was written for. Hence the heap, and the
// exit-status check below: an unfinished check must never look like a passing one.
const run = spawnSync(process.execPath, ['--max-old-space-size=8192', tsc, '-p', configPath], {
	cwd: ROOT,
	encoding: 'utf8',
	maxBuffer: 64 * 1024 * 1024,
});
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

// Only OUR files: `--noResolve` still parses the Svelte declaration file, whose own unresolved
// imports are noise this check does not own.
const hits = output.split(/\r?\n/).filter((line) => {
	const match = /error (TS\d+):/.exec(line);
	return match && CODES.has(match[1]) && !line.includes('node_modules');
});

if (hits.length === 0) {
	console.log(`✓ no undefined identifiers in ${files.length} TypeScript files`);
	process.exit(0);
}

console.error(`✗ ${hits.length} undefined identifier(s) — these throw at RUNTIME, not at build:`);
console.error('');
for (const hit of hits) console.error(`  ${posix(hit)}`);
console.error('');
console.error('A name is used but never declared or imported. Fix the import, or the rename that');
console.error('left it behind. See the header of scripts/check-undefined-names.mjs.');
process.exit(1);
