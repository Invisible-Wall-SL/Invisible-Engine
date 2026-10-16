// Every place the runtime sources write a STOCK asset name must be accounted for in the stock-asset
// filter's table (`apps/lines/src/game/stockAssetRules.ts` `STOCK_CONSUMERS`).
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-stock-asset-coverage.mjs
//
// Why: the shared runtime stops downloading the stock assets (`apps/lines/src/game/assets.ts`) a
// project can never draw, and "never draws" is decided by rules that know every coded consumer
// (`stockAssets.ts`). A consumer added later that the rules do not know would have its asset taken
// away from games that need it. So every string literal in `apps/lines/src` and `packages/*/src`
// that names a stock key, a stock sheet frame or a stock font face must sit in the table under a
// rule — and every table entry must still be found, so the table cannot rot into a list of guesses.
//
// Scope: string literals only, comments stripped. A template's `${…}` and a Svelte attribute's
// `{…}` read as `*`, which is how the table writes a per-language frame (`freespins_*.png`).
//
// It also holds the table to the two things it describes: the asset FILES (every frame a stock sheet
// packs and every font's face is named, and every name is still packed) and the bound parts
// `Game.svelte` registers (each has a rule in `PART_NEEDS`, or the walk keeps every stock key).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import stockAssets from '../apps/lines/src/game/assets.ts';
import {
	PART_NEEDS,
	STOCK_CONSUMERS,
	STOCK_NAMES,
	nameMatches,
} from '../apps/lines/src/game/stockAssetRules.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The filter's own files and the table it checks, the stock table itself, and tests. */
const EXCLUDED = new Set([
	'apps/lines/src/game/assets.ts',
	'apps/lines/src/game/stockAssets.ts',
	'apps/lines/src/game/stockAssetRules.ts',
]);
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', 'dist', 'build', 'stories']);
const isTest = (file) => /\.(stories|fixture|test|spec)\.[^/]+$/.test(file);

function walk(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(ts|mts|js|mjs|svelte)$/.test(entry)) out.push(full);
	}
	return out;
}

const files = walk(join(ROOT, 'apps/lines/src'), []);
for (const pkg of readdirSync(join(ROOT, 'packages')))
	walk(join(ROOT, 'packages', pkg, 'src'), files);

const NAMES = [...new Set(Object.values(STOCK_NAMES).flat())];

const stripComments = (source) =>
	source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** `file` → the stock names its string literals write. */
const found = new Map();
for (const full of files) {
	const file = relative(ROOT, full).split('\\').join('/');
	if (EXCLUDED.has(file) || isTest(file)) continue;
	const source = stripComments(readFileSync(full, 'utf8'));
	for (const match of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
		const literal = (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]*\}|\{[^}]*\}/g, '*');
		for (const name of NAMES) {
			if (!nameMatches(name, literal)) continue;
			if (!found.has(file)) found.set(file, new Set());
			found.get(file).add(name);
		}
	}
}

const listed = new Map();
const problems = [];
for (const { file, names, rule } of STOCK_CONSUMERS) {
	if (!listed.has(file)) listed.set(file, new Set());
	for (const name of names) {
		if (!NAMES.includes(name)) problems.push(`${file}: '${name}' (${rule}) is not a stock name`);
		listed.get(file).add(name);
	}
}

for (const [file, names] of found) {
	for (const name of names) {
		if (!listed.get(file)?.has(name)) {
			problems.push(
				`${file} writes the stock name '${name}', which the stock-asset table does not list — ` +
					'add a rule for it in stockAssets.ts if it reaches a stock asset, then list it in ' +
					'STOCK_CONSUMERS (stockAssetRules.ts) under that rule',
			);
		}
	}
}
for (const [file, names] of listed) {
	for (const name of names) {
		if (!found.get(file)?.has(name)) {
			problems.push(`${file}: '${name}' is listed in STOCK_CONSUMERS but no longer written there`);
		}
	}
}

// The asset files: a sheet is reached by its frames, a font by its face, everything else by its key.
const onDisk = (src) => join(ROOT, 'apps/lines/static', src.slice(src.indexOf('/assets/')));
const stockKeys = Object.keys(stockAssets);
for (const key of Object.keys(STOCK_NAMES)) {
	if (!stockKeys.includes(key)) problems.push(`STOCK_NAMES has '${key}', which assets.ts does not`);
}
for (const [key, { type, src }] of Object.entries(stockAssets)) {
	const names = STOCK_NAMES[key];
	if (!names) {
		problems.push(`assets.ts registers '${key}', which STOCK_NAMES does not name`);
		continue;
	}
	let packed = [key];
	if (type === 'sprites')
		packed = Object.keys(JSON.parse(readFileSync(onDisk(src), 'utf8')).frames);
	if (type === 'font')
		packed = [/<info face="([^"]+)"/.exec(readFileSync(onDisk(src), 'utf8'))?.[1]];
	for (const frame of packed) {
		if (!names.some((name) => nameMatches(name, frame))) {
			problems.push(`'${key}' packs '${frame}', which STOCK_NAMES.${key} does not name`);
		}
	}
	for (const name of names) {
		if (!packed.some((frame) => nameMatches(name, frame))) {
			problems.push(`STOCK_NAMES.${key} names '${name}', which '${key}' does not pack`);
		}
	}
}

// The bound parts the game registers, read off `Game.svelte`'s `registerBoundComponents({ … })`.
const game = readFileSync(join(ROOT, 'apps/lines/src/components/Game.svelte'), 'utf8');
const registration = game.slice(game.indexOf('registerBoundComponents({'));
const parts = [
	...registration.slice(0, registration.indexOf('});')).matchAll(/^\t\t(\w+)(?::|,)/gm),
].map((match) => match[1]);
if (parts.length < 20) problems.push(`read only ${parts.length} bound part(s) off Game.svelte`);
for (const part of parts) {
	if (!(part in PART_NEEDS)) {
		problems.push(
			`Game.svelte registers the bound part '${part}', which PART_NEEDS (stockAssetRules.ts) has ` +
				'no rule for — every game would keep every stock asset',
		);
	}
}

if (problems.length) {
	console.error(`check-stock-asset-coverage: ${problems.length} problem(s):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
const pairs = [...found.values()].reduce((sum, names) => sum + names.size, 0);
console.log(
	`check-stock-asset-coverage: ${pairs} stock name(s) in ${found.size} file(s), every one listed; ` +
		`${stockKeys.length} stock keys match their files; ${parts.length} bound parts have rules.`,
);
