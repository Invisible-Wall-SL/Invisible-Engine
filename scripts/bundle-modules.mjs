/**
 * Emit the MODULE SET of a built bundle: every source module rollup included, with a hash of its
 * exact contents, sorted by path.
 *
 * This is the rigorous gate for Phase A of `docs/design/game-type-templates.md`. Comparing the
 * emitted bundle bytes cannot work for a file move — relocating a module reorders rollup's graph
 * and reshuffles minified identifier names — and comparing string literals cannot work either,
 * because minified bundles contain regex literals with embedded quotes (lodash) that desync any
 * scanner, and template literals embed identifiers that renaming changes.
 *
 * The module set has neither problem. If the same sources with the same contents are included, and
 * the only differences are the paths we deliberately moved, the relocation is provably neutral.
 *
 * Requires a sourcemap build: `npx vite build --sourcemap`.
 *
 * Usage: node scripts/bundle-modules.mjs [buildDir] > modules.txt
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'build/_app/immutable';
const mapFile = readdirSync(dir).find((f) => f.endsWith('.js.map'));
if (!mapFile) {
	console.error(`no .js.map in ${dir} — build with: npx vite build --sourcemap`);
	process.exit(2);
}

const map = JSON.parse(readFileSync(join(dir, mapFile), 'utf8'));
const sources = map.sources ?? [];
const contents = map.sourcesContent ?? [];

const rows = sources.map((src, i) => {
	const body = contents[i] ?? '';
	// Normalize path separators and strip the leading ../ walk so two builds are comparable.
	const path = String(src)
		.replace(/\\/g, '/')
		.replace(/^(\.\.\/)+/, '');
	const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
	return `${hash}  ${path}`;
});

rows.sort();
console.log(rows.join('\n'));
console.error(`${rows.length} modules`);
