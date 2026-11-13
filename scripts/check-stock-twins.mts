/**
 * Offline fixture for the stock KTX2 twins on the compressed tier: what the runtime registers
 * (`stockTwins.ts`) and what a build ships (`config-vite` `stockTwins.js`).
 *
 *   pnpm check:all --only check-stock-twins
 *
 * Pins, each checked against the real code and then against a planted mutation it must catch:
 *   1. the uncompressed tier registers the stock table itself, so a desktop loads what it did;
 *   2. the compressed tier points each shipped twin's entry at the twin, the original as fallback;
 *   3. an entry with no shipped twin stays the table's own, and a twin the build does not ship is
 *      never registered;
 *   4. the boot's stock skip still skips on the compressed tier (it compares the tiered table);
 *   5. a build ships a twin only beside the engine's own bytes, copying a twin it lacks.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyStockTwins, stockTwinPlan } from '../packages/config-vite/stockTwins.js';
import stockTable, { gameAssetsBase } from '../apps/lines/src/game/assets.ts';
import { withoutStockAssets } from '../apps/lines/src/game/stockAssets.ts';
import { stockAssetsOnTier } from '../apps/lines/src/game/stockTwins.ts';

type Table = Record<string, { type: string; src: unknown; fallback?: unknown }>;
type Tier = (
	table: Table,
	twins: Readonly<Record<string, string>>,
	base: string,
	compressed: boolean,
) => Table;
type Manifest = {
	descriptors: Record<
		string,
		{
			type: string;
			sha256: string;
			twin: string;
			pages: { file: string; sha256: string; twin: string; twinSha256: string }[];
		}
	>;
};

const ASSETS = fileURLToPath(new URL('../apps/lines/static/assets/', import.meta.url));
const manifest: Manifest = JSON.parse(
	readFileSync(new URL('../apps/lines/src/game/stockTwins.json', import.meta.url), 'utf8'),
);
const table = stockTable as unknown as Table;
const base = gameAssetsBase();
const allTwins = Object.fromEntries(
	Object.entries(manifest.descriptors).map(([rel, d]) => [rel, d.twin]),
);
const descriptorOf = (src: unknown): string =>
	decodeURIComponent(
		String(typeof src === 'string' ? src : (src as { atlas: string }).atlas).slice(base.length),
	);

let failures = 0;
const check = (label: string, problems: string[]) => {
	if (problems.length === 0) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}\n        ${problems.slice(0, 4).join('\n        ')}`);
	}
};
/** A rule must hold for the real code and catch the planted mutation. */
const rule = <T,>(label: string, run: (impl: T) => string[], real: T, mutant: T) => {
	check(label, run(real));
	check(`  …and catches a planted mutation`, run(mutant).length ? [] : ['the mutant passed']);
};

console.log('1. the uncompressed tier is the stock table itself');
const desktop: (tier: Tier) => string[] = (tier) => {
	const out = tier(table, allTwins, base, false);
	return out === table ? [] : ['the table was copied or changed on the uncompressed tier'];
};
rule('uncompressed tier', desktop, stockAssetsOnTier as Tier, (t, twins, b) =>
	stockAssetsOnTier(t, twins, b, true),
);

console.log('2. the compressed tier loads each shipped twin, the original as its fallback');
const phone: (tier: Tier) => string[] = (tier) => {
	const out = tier(table, allTwins, base, true);
	const problems: string[] = [];
	let twinned = 0;
	for (const [key, entry] of Object.entries(table)) {
		const twin = allTwins[descriptorOf(entry.src)];
		if (entry.type === 'audio' || !twin) continue;
		twinned += 1;
		const got = out[key];
		const want =
			typeof entry.src === 'string'
				? `${base}${twin}`
				: { ...(entry.src as object), atlas: `${base}${twin}` };
		if (JSON.stringify(got.src) !== JSON.stringify(want)) problems.push(`${key}: src not the twin`);
		if (JSON.stringify(got.fallback) !== JSON.stringify(entry.src))
			problems.push(`${key}: fallback not the original`);
		if (got.type !== entry.type) problems.push(`${key}: type changed`);
	}
	if (twinned < 20) problems.push(`only ${twinned} stock keys have a twin`);
	return problems;
};
rule('compressed tier', phone, stockAssetsOnTier as Tier, (t, twins, b, c) => {
	const out = stockAssetsOnTier(t, twins, b, c);
	return Object.fromEntries(
		Object.entries(out).map(([k, e]) => [k, { type: e.type, src: e.src }]),
	) as Table;
});

console.log('3. no twin, or a twin the build does not ship, keeps the table entry');
const shippedOnly: (tier: Tier) => string[] = (tier) => {
	const shipped = { 'spines/symbols2/symbols2.atlas': allTwins['spines/symbols2/symbols2.atlas'] };
	const out = tier(table, shipped, base, true);
	return Object.entries(table)
		.filter(([key]) => key !== 'M' && key !== 'S')
		.filter(([key, entry]) => out[key] !== entry)
		.map(([key]) => `${key}: changed with no shipped twin`);
};
rule('only shipped twins', shippedOnly, stockAssetsOnTier as Tier, (t, _twins, b, c) =>
	stockAssetsOnTier(t, allTwins, b, c),
);

console.log('4. the boot skips unused stock keys on the compressed tier too');
type Skip = (registered: Table, needed: Set<string>) => string[];
const skipRule: (skip: Skip) => string[] = (skip) => {
	const tiered = stockAssetsOnTier(table, allTwins, base, true);
	const needed = new Set(['H1', 'loader']);
	const expected = Object.keys(table)
		.filter((k) => !needed.has(k))
		.sort();
	const got = skip(tiered, needed).sort();
	return JSON.stringify(got) === JSON.stringify(expected)
		? []
		: [`skipped ${got.length} of ${expected.length}: ${expected.filter((k) => !got.includes(k))}`];
};
rule(
	'skip against the tiered table',
	skipRule,
	(registered, needed) =>
		withoutStockAssets(registered, stockAssetsOnTier(table, allTwins, base, true), needed).skipped,
	(registered, needed) => withoutStockAssets(registered, table, needed).skipped,
);

console.log('5. a build ships a twin only beside the engine’s own bytes');
type Plan = typeof stockTwinPlan;
const buildRule: (plan: Plan) => string[] = (plan) => {
	const problems: string[] = [];
	const dir = mkdtempSync(join(tmpdir(), 'stock-twins-'));
	try {
		const engine = plan(ASSETS, { manifest });
		if (Object.keys(engine.twins).length !== Object.keys(manifest.descriptors).length)
			problems.push('the engine static does not ship every twin');
		// A game repo seeded before the twins existed, whose `symbols3` page is its own art.
		const game = join(dir, 'assets');
		cpSync(ASSETS, game, {
			recursive: true,
			filter: (src) => !/\.pm\.ktx2$|\.ktx2\.(atlas|json|xml)$/.test(src),
		});
		writeFileSync(join(game, 'spines/symbols3/symbols3.webp'), 'the game’s own art');
		const seeded = plan(game, { manifest });
		if (seeded.twins['spines/symbols3/symbols3.atlas'])
			problems.push('shipped the engine twin over a page the game replaced');
		if (!seeded.twins['spines/symbols2/symbols2.atlas'])
			problems.push('did not ship the twin of an unchanged stock page');
		const out = join(dir, 'out');
		const copied = copyStockTwins(out, seeded);
		if (!copied.includes('spines/symbols2/symbols2.pm.ktx2'))
			problems.push('did not copy a missing twin page');
		if (copied.some((rel) => rel.startsWith('spines/symbols3/')))
			problems.push('copied a twin of a replaced page');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return problems;
};
rule('build plan', buildRule, stockTwinPlan, (assetsDir, options) => {
	const all = stockTwinPlan(ASSETS, options);
	return assetsDir === ASSETS ? all : { ...all, twins: { ...all.twins } };
});

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
