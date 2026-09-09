// Offline fixture for the SCAFFOLD TEMPLATE — does `new-game.mjs` still describe THIS engine?
//
//   node scripts/verify-scaffold-template.mjs
//
// WHAT IT PROVES. `scripts/new-game.mjs` writes a `package.json` full of `workspace:*` deps
// on engine packages, and a `tsconfig.json` that `extends` a path into the engine. Nothing
// tied those strings to the engine they name, so the template could — and did — rot in
// place: #533 (2026-09-01) deleted `packages/config-ts` and moved the shared compiler
// options to `tsconfig.base.json` at the repo root, `apps/lines` was migrated, and the
// scaffolder was not. Every game scaffolded for the next eight days was born unbuildable:
//
//     ERR_PNPM_WORKSPACE_PKG_NOT_FOUND
//     "config-ts@workspace:*" is in the dependencies but no package named "config-ts"
//     is present in the workspace
//
// It surfaced as a build failure on a user's machine rather than a failing check here,
// because the only thing that ever executed the template was scaffolding a real game.
//
// Three claims, against the REAL repo tree:
//
//   1. every `workspace:*` dependency the template writes names a package that exists;
//   2. the `tsconfig.json` it writes `extends` a path that RESOLVES — vite:esbuild fails a
//      build outright on an unresolvable `extends`, which is exactly how a deleted package
//      became a broken build instead of a warning;
//   3. the template does not mention `config-ts` at all — the specific regression above.
//
// This is a SOURCE assertion, not an execution: `new-game.mjs` is a CLI with top-level side
// effects (it exits without `--name`), so it cannot be imported. Parsing its two array
// literals is the tradeoff that keeps the check cheap enough to always run.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'scripts', 'new-game.mjs'), 'utf8');

let checks = 0;
const fail = (msg) => {
	console.error(`\n✗ ${msg}\n`);
	process.exit(1);
};
const ok = (label, cond, detail = '') => {
	if (!cond) fail(`${label}${detail ? ` — ${detail}` : ''}`);
	checks++;
	console.log(`  ok ${label}`);
};

/** The string entries of a top-level `const <name> = [ ... ];` array literal. */
function arrayLiteral(name) {
	const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(src);
	if (!m) fail(`could not find the ${name} array in new-game.mjs`);
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Every workspace package name the engine actually publishes. */
function realPackageNames() {
	const names = new Set();
	for (const group of ['packages', 'apps']) {
		const dir = join(ROOT, group);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const pkg = join(dir, entry.name, 'package.json');
			if (!existsSync(pkg)) continue;
			try {
				const { name } = JSON.parse(readFileSync(pkg, 'utf8'));
				if (name) names.add(name);
			} catch {
				/* an unparseable package.json is not this fixture's business */
			}
		}
	}
	return names;
}

console.log('1. every workspace:* dep the scaffold writes names a package that exists');
const real = realPackageNames();
ok('the engine exposes a plausible number of workspace packages', real.size > 20, `${real.size}`);

const templated = [...arrayLiteral('ENGINE_PACKAGES'), ...arrayLiteral('ENGINE_CONFIGS')];
ok('the template lists both package groups', templated.length > 10, `${templated.length}`);

const missing = templated.filter((p) => !real.has(p));
ok(
	'no templated dependency is missing from the engine',
	missing.length === 0,
	`a scaffolded game would fail pnpm install on: ${missing.join(', ')}`,
);

console.log('2. the tsconfig it writes extends a path that resolves');
const ext = /extends: '([^']+)'/.exec(src);
ok('the template declares a tsconfig extends target', Boolean(ext), 'none found');
const target = ext[1];
ok(
	`the extends target is a relative path into the engine, not a package name (${target})`,
	target.startsWith('./') || target.startsWith('../'),
	'a bare specifier resolves through node_modules, so deleting the package that owns it ' +
		'breaks the build — which is how config-ts failed',
);
// A scaffolded game sits one level ABOVE the engine, which it vendors at `engine/`. So the
// path it writes, with that prefix stripped, must exist here in the engine repo.
const enginePath = target.replace(/^\.\/engine\//, '');
ok(
	`it resolves to a real file in this engine (${enginePath})`,
	existsSync(join(ROOT, enginePath)),
	'vite:esbuild fails the build outright on an unresolvable extends',
);

console.log('3. the specific regression: the deleted config-ts package is never referenced');
// Matches how a REAL reference is written — a single-quoted specifier, either a bare entry
// in ENGINE_CONFIGS (`'config-ts',`) or an extends target (`'config-ts/base.json'`). A
// blanket `includes('config-ts')` would also forbid the comment explaining why it is gone,
// which is the one mention worth keeping: it stops someone re-adding it from muscle memory.
ok(
	'no single-quoted config-ts specifier survives',
	!src.includes("'config-ts"),
	'a scaffolded game would fail pnpm install, or its build on an unresolvable extends',
);

console.log(`\nPASS — ${checks} checks.`);
