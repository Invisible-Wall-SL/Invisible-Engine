/**
 * Offline fixture for the bitmap-font registration on the two texture tiers (`bakedFontAssets`):
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *     packages/engine-layout/bakedFonts.fixture.ts
 *
 * Pins, each checked against the real code and then against a planted mutation it must catch:
 *   1. the uncompressed tier registers exactly what it did before KTX2 font twins existed;
 *   2. the compressed tier loads a font's twin descriptor, the plain one as its fallback;
 *   3. a font with no twin loads its plain descriptor on the compressed tier too.
 */

import { bakedFontAssets } from './src/lib/bakedFonts.ts';
import type { FontCatalog } from './src/lib/fontCatalog.ts';

type Register = typeof bakedFontAssets;

const BASE = 'https://cdn.example/game/assets/';
const catalog: FontCatalog = {
	prefix: 'editor-fonts',
	fonts: [
		{
			id: 'Golden',
			name: 'Golden',
			kind: 'bitmap',
			folder: 'Golden',
			descriptorFile: 'Golden.xml',
			descriptorFormat: 'xml',
			pageFiles: ['Golden.png'],
			ktx2DescriptorFile: 'Golden.ktx2.xml',
		},
		{
			id: 'Small',
			name: 'Small',
			kind: 'bitmap',
			folder: 'Small',
			descriptorFile: 'Small.fnt',
			descriptorFormat: 'fnt',
			pageFiles: ['Small.png'],
		},
		{ id: 'Web', name: 'Web', kind: 'web', folder: 'Web', files: [] },
	],
};

/** What every caller registered before the compressed tier knew about fonts. */
const before = {
	'bakedFont/Golden': {
		type: 'font',
		src: `${BASE}editor-fonts/Golden/Golden.xml`,
		preload: true,
		family: 'Golden',
	},
	'bakedFont/Small': {
		type: 'font',
		src: `${BASE}editor-fonts/Small/Small.fnt`,
		preload: true,
		family: 'Small',
	},
};

let failures = 0;
const check = (label: string, problems: string[]) => {
	if (problems.length === 0) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}\n        ${problems.join('\n        ')}`);
	}
};
const same = (a: unknown, b: unknown, what: string) =>
	JSON.stringify(a) === JSON.stringify(b) ? [] : [`${what}: ${JSON.stringify(a)}`];
const rule = (label: string, run: (impl: Register) => string[], mutant: Register) => {
	check(label, run(bakedFontAssets));
	check('  …and catches a planted mutation', run(mutant).length ? [] : ['the mutant passed']);
};

console.log('1. the uncompressed tier is unchanged');
rule(
	'uncompressed tier',
	(impl) => same(impl(catalog, BASE, false), before, 'registered'),
	(c, base) => bakedFontAssets(c, base, true),
);

console.log('2. the compressed tier loads the twin descriptor, the plain one as fallback');
rule(
	'compressed tier',
	(impl) =>
		same(
			impl(catalog, BASE, true)['bakedFont/Golden'],
			{
				type: 'font',
				src: `${BASE}editor-fonts/Golden/Golden.ktx2.xml`,
				fallback: `${BASE}editor-fonts/Golden/Golden.xml`,
				preload: true,
				family: 'Golden',
			},
			'Golden',
		),
	(c, base, compressed) => {
		const out = bakedFontAssets(c, base, compressed);
		for (const entry of Object.values(out)) delete entry.fallback;
		return out;
	},
);

console.log('3. a font with no twin keeps its descriptor on the compressed tier');
rule(
	'no twin',
	(impl) => same(impl(catalog, BASE, true)['bakedFont/Small'], before['bakedFont/Small'], 'Small'),
	(c, base, compressed) => {
		const out = bakedFontAssets(c, base, compressed);
		out['bakedFont/Small'] = {
			...out['bakedFont/Small'],
			src: `${BASE}editor-fonts/Small/Small.ktx2.fnt`,
		};
		return out;
	},
);

// A throw exits non-zero without Node's types, which this package does not carry.
if (failures) throw new Error(`${failures} baked font check(s) failed`);
console.log('\nall checks passed');
