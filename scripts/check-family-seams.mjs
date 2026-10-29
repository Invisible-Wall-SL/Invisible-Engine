/**
 * Shared code reaches a family only through its seam (`docs/design/phase-11.md` §2.2). Walks the
 * runtime's import graph from its entries (`routes/`, `hooks.*`) with one family's seam swapped
 * for its `off/` stub, as `config-vite` does in a build without that family, and fails when the
 * walk still reaches one of the family's own modules: something imports it past the seam, so a
 * runtime without the family would carry it anyway.
 *
 *     node scripts/check-family-seams.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/lines/src');

/** What each seam re-exports: the family's own modules, which only the seam may import. */
const FAMILY_MODULES = {
	match3: ['game/match3.svelte.ts', 'components/Match3Input.svelte'],
	arcade: ['game/arcade.ts', 'game/online.ts', 'components/ArcadeStage.svelte'],
	card: ['game/cards.ts', 'components/CardTable.svelte'],
};

const entries = [
	...readdirSync(join(SRC, 'routes'), { recursive: true })
		.filter((f) => /(^|[\\/])\+[^\\/]+\.(ts|svelte)$/.test(f))
		.map((f) => join(SRC, 'routes', f)),
	...['hooks.client.ts', 'hooks.server.ts'].map((f) => join(SRC, f)).filter((f) => existsSync(f)),
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)'(\.{1,2}\/[^']+)'/g;
const EXTENSIONS = ['', '.ts', '.svelte.ts', '.js', '.svelte', '/index.ts'];

const resolveFrom = (importer, spec) => {
	const base = resolve(dirname(importer), spec);
	for (const ext of EXTENSIONS) {
		const file = base + ext;
		if (existsSync(file) && statSync(file).isFile()) return file;
	}
	return null;
};

/** Every module the walk reaches, with `family`'s seam resolved to its stub. */
const reach = (family) => {
	const seam = join(SRC, 'families', `${family}.ts`);
	const stub = join(SRC, 'families/off', `${family}.ts`);
	const seen = new Map();
	const stack = entries.map((file) => [file, null]);
	while (stack.length) {
		const [file, from] = stack.pop();
		if (seen.has(file)) continue;
		seen.set(file, from);
		for (const [, spec] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
			const target = resolveFrom(file, spec);
			if (target) stack.push([target === seam ? stub : target, file]);
		}
	}
	return seen;
};

let failures = 0;
check('the walk has entries', entries.length > 0);
for (const [family, modules] of Object.entries(FAMILY_MODULES)) {
	const all = reach(null);
	const off = reach(family);
	for (const rel of modules) {
		const file = join(SRC, rel);
		check(`${rel} exists and the full runtime reaches it`, all.has(file));
		const from = off.get(file);
		check(
			`without ${family}, nothing reaches ${rel}`,
			!off.has(file),
			from && `imported by ${relative(SRC, from)}, past families/${family}.ts`,
		);
	}
}

function check(name, ok, detail = '') {
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

if (failures) {
	console.error(`\n${failures} seam check(s) failed`);
	process.exit(1);
}
console.log('\nfamily seams ok');
