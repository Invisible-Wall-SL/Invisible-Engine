// Verify that every CROSS-PACKAGE relative import still resolves to a file that exists.
//
// Why this exists: three separate regressions in one refactor. `tools/game-config-spike` and
// `tools/flow-spike/fs7Win` import modules from `apps/lines/src/game/` by relative path, and Phase A
// of `docs/design/game-type-templates.md` moved those modules into `packages/engine-game`. Nothing
// in `pnpm build` reads those files, so every gate stayed green while the harnesses were dead — and
// `tools/` is where this pipeline verifies its data contracts offline, so they are precisely the
// thing a refactor must not break silently.
//
// The rule is deliberately NOT "don't import across packages". The spikes are supposed to run
// against the real modules rather than stubs — that is what makes them worth having. The rule is
// only that such an import must still point at something.
//
//   node scripts/check-path-imports.mjs
//
// Scope: relative imports that climb at least two levels (`../../…`), i.e. the ones that leave
// their own package. A same-package import is already covered by the build.
//
// Known gap, stated rather than hidden: this catches STATIC imports only. The same refactor also
// broke a DYNAMIC sibling lookup in `apps/launcher-api/scripts/generate-game-config-defaults.ts`
// (`resolve(dirname(configPath), 'winLevelMap.ts')`), which no static scan can see. That one is
// guarded by a loud warning at its own call site instead.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `new URL(...).pathname` — this repo's path contains spaces, which stay
// percent-encoded in `pathname`, so the walk silently finds nothing and the check passes vacuously.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.claude',
	'.svelte-kit',
	'dist',
	'build',
	'.turbo',
	'coverage',
	'static',
	// ComfyUI custom nodes import `../../scripts/app.js` — ComfyUI's OWN web runtime, served by its
	// server at /scripts/app.js. Those specifiers are resolved by ComfyUI, not by anything in this
	// repo, so checking them against the filesystem is meaningless.
	'custom_nodes',
]);
const EXTS = ['.ts', '.mts', '.mjs', '.js', '.svelte', '.json'];

function walk(dir) {
	let out = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) out = out.concat(walk(full));
		else if (/\.(ts|mts|mjs|js|svelte)$/.test(entry)) out.push(full);
	}
	return out;
}

/** Does `spec` resolve to a real file from `fromDir`? Mirrors what bundlers try. */
function resolves(fromDir, spec) {
	const base = resolve(fromDir, spec);
	if (existsSync(base) && statSync(base).isFile()) return true;
	for (const ext of EXTS) if (existsSync(base + ext)) return true;
	for (const ext of EXTS) if (existsSync(join(base, `index${ext}`))) return true;
	return false;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;

let checked = 0;
const broken = [];

for (const file of walk(ROOT)) {
	let src;
	try {
		src = readFileSync(file, 'utf8');
	} catch {
		continue;
	}
	for (const m of src.matchAll(IMPORT_RE)) {
		const spec = m[1];
		// Only cross-package climbs. `./x` and `../x` stay inside their own package.
		if (!spec.startsWith('../../')) continue;
		checked += 1;
		if (resolves(dirname(file), spec)) continue;
		const line = src.slice(0, m.index).split('\n').length;
		broken.push({ file: relative(ROOT, file).replace(/\\/g, '/'), line, spec });
	}
}

if (broken.length) {
	console.error(
		`\n✗ ${broken.length} cross-package import(s) point at a file that does not exist:\n`,
	);
	for (const b of broken) console.error(`  ${b.file}:${b.line}\n    ${b.spec}`);
	console.error(
		'\nA module was probably moved. Update the importer, or move the module back.\n' +
			'These are not covered by `pnpm build` — that is the whole reason this check exists.\n',
	);
	process.exit(1);
}

console.log(`✓ all ${checked} cross-package relative imports resolve`);
