/**
 * Offline fixture for the build-time stock-asset prune: the plan (`stockAssetBuild.ts`) a standalone
 * build takes from its baked bundle, and the file prune `config-vite` runs with it
 * (`packages/config-vite/stockAssetPrune.js`).
 *
 *   pnpm check:all --only stock-asset-prune
 *
 * Pins:
 *  1. DOUBT KEEPS ALL: no bundle, no doc, an empty doc.
 *  2. THE BUILD KEEPS WHAT ANY BOOT KEEPS: on the reference game, for every symbol set a Play4Fun
 *     server may declare, the boot's walk keeps nothing the build left out — so a coded symbol the
 *     config only lists (`W`, `H5`) is kept by the build although a boot on the config alone drops it.
 *  3. THE REGISTRY IS SEEDED AS AT BOOT: a project def shadows the built-in of its id, and a pinned
 *     version resolves to that version.
 *  4. THE PRUNE removes a skipped key's files and their pages with their twins, keeps every file a
 *     kept key also loads (a shared atlas), and removes nothing on doubt: a plan that kept all, a
 *     kept key whose file cannot be read.
 *  5. ONLY A STANDALONE GAME BUILD is pruned: never one run inside the engine (its apps, the shared
 *     runtime online games boot), and not with `IE_STOCK_PRUNE=0`.
 *  6. `?anticipation=` ON A PRUNED BUILD: the build tells the boot (`__IE_STOCK_PRUNED__`, never in
 *     dev), and the boot refuses the param only when it needs a stock rig the URL-less walk left out.
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGameConfig } from '../packages/engine-game/src/game/gameConfig.ts';
import {
	BUILTIN_COMPONENTS,
	type ComponentDef,
	type LayoutDoc,
} from '../packages/engine-layout/src/lib/index.ts';
import type { GameConfigDoc } from '../packages/game-config/index.ts';

import {
	prunesThisBuild,
	pruneStockFiles,
	stockPrunedDefine,
} from '../packages/config-vite/stockAssetPrune.js';
import compiledConfig from '../apps/lines/src/game/config.ts';
import { fallbackEditorScenes } from '../apps/lines/src/game/fallbackLayout.ts';
import { stockAssetBuildPlan, stockAssetFiles } from '../apps/lines/src/game/stockAssetBuild.ts';
import {
	analyseStockAssets,
	anticipationRigLeftOut,
	type StockAssetData,
} from '../apps/lines/src/game/stockAssets.ts';
import { anticipationParam } from '../apps/lines/src/game/anticipationParam.ts';
import { stockAssetDataOf } from '../apps/lines/src/game/stockAssetData.ts';
import { PART_NEEDS, STOCK_KEYS } from '../apps/lines/src/game/stockAssetRules.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const sorted = (keys: Iterable<string>): string[] => [...keys].sort();

console.log('1. doubt keeps all');
for (const [label, bundle] of [
	['no bundle', undefined],
	['a bundle with no doc', { doc: null, componentDefs: {} }],
	['a doc with no scenes', { doc: { version: 1, scenes: [] } }],
] as const) {
	const plan = stockAssetBuildPlan(bundle);
	check(label, { skipped: plan.skipped, kept: !!plan.keptAllBecause }, { skipped: [], kept: true });
}

console.log('\n2. the build keeps what any boot keeps');
const reference = { doc: fallbackEditorScenes };
const referencePlan = stockAssetBuildPlan(reference);
check(
	'the reference game leaves out what nothing it can show consumes',
	sorted(referencePlan.skipped),
	sorted([
		'loader',
		'payFrame',
		'goldBlur',
		'silverFont',
		'purpleFont',
		'globalMultiplier',
		'tumble_multiplier',
		'tumble_win',
		'clusterWin',
	]),
);
const template = createGameConfig({ bakedConfig: () => undefined, compiledConfig });
const bootKeeps = (symbolsInPlay: string[]): string[] =>
	sorted(
		analyseStockAssets({
			data: stockAssetDataOf(reference),
			fallbackDoc: fallbackEditorScenes,
			resolveDef: (id) => BUILTIN_COMPONENTS.find((def) => def.id === id),
			componentDefaults: () => undefined,
			isBoundPart: (name) => name in PART_NEEDS,
			config: template.getActiveGameConfig() as GameConfigDoc,
			symbolsInPlay,
		}).needed,
	);
for (const declared of [
	template.getSymbolsInPlay(),
	[...template.getSymbolsInPlay(), 'W'],
	['H5', 'M', 'W', 'S', 'explosion'],
	['H1'],
]) {
	check(
		`a boot whose server declares ${declared.join(',')} loads nothing the build left out`,
		bootKeeps(declared).filter((key) => referencePlan.skipped.includes(key)),
		[],
	);
}

console.log('\n3. the registry is seeded as at boot');
const panel = (version: number, assetKey: string): ComponentDef =>
	({
		id: 'panel',
		name: 'Panel',
		version,
		root: {
			id: 'root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [{ id: 'art', kind: 'sprite', x: 0, y: 0, assetKey }],
		},
		params: [],
	}) as unknown as ComponentDef;
const withPanel = (pin?: number) => {
	const doc = JSON.parse(JSON.stringify(fallbackEditorScenes)) as LayoutDoc;
	doc.scenes
		.find((scene) => scene.id === 'basegame')!
		.nodes.push({
			id: 'p',
			kind: 'componentInstance',
			componentId: 'panel',
			x: 0,
			y: 0,
			...(pin ? { componentVersion: pin } : {}),
		} as never);
	return {
		doc,
		componentDefs: { panel: panel(2, 'payFrame') },
		componentVersions: [panel(1, 'globalMultiplier')],
	};
};
const keeps = (bundle: unknown, key: string): boolean =>
	!stockAssetBuildPlan(bundle).skipped.includes(key);
check('a project def is expanded', keeps(withPanel(), 'payFrame'), true);
check(
	'a pinned version resolves to that version',
	[keeps(withPanel(1), 'globalMultiplier'), keeps(withPanel(1), 'payFrame')],
	[true, false],
);

console.log('\n4. the prune');
const STATIC_ASSETS = fileURLToPath(new URL('../apps/lines/static/assets/', import.meta.url));
const files = stockAssetFiles();
const SAMPLE_DIRS = ['spines/symbols', 'spines/bigwin', 'sprites/reelsFrame'];
const listed = (dir: string): string[] => {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const abs = join(d, entry.name);
			if (entry.isDirectory()) walk(abs);
			else out.push(relative(dir, abs).split('\\').join('/'));
		}
	};
	walk(dir);
	return out.sort();
};
const prune = (
	skipped: string[],
	options: { keptAllBecause?: string; corrupt?: string } = {},
): { removed: string[]; keptAll: boolean; left: string[] } => {
	const dir = mkdtempSync(join(tmpdir(), 'stock-prune-'));
	try {
		for (const sub of SAMPLE_DIRS)
			cpSync(join(STATIC_ASSETS, sub), join(dir, sub), { recursive: true });
		if (options.corrupt) writeFileSync(join(dir, options.corrupt), '{ not json');
		const result = pruneStockFiles(dir, {
			skipped,
			files,
			...(options.keptAllBecause ? { keptAllBecause: options.keptAllBecause } : {}),
		});
		return {
			removed: result.removed.map((file: { rel: string }) => file.rel).sort(),
			keptAll: !!result.keptAllBecause,
			left: listed(dir),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
const SYMBOL_RIGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4'];
check('a key sharing its atlas with a kept one leaves only its skeleton', prune(['H1']).removed, [
	'spines/symbols/h1.json',
]);
const allSymbols = prune(SYMBOL_RIGS);
check(
	'the last sharer takes the atlas, its page, the page twin and the folder index',
	allSymbols.left.filter((rel) => rel.startsWith('spines/symbols/')),
	[],
);
check('a lone rig goes whole', prune(['bigwin']).removed, [
	'spines/bigwin/big_wins.atlas',
	'spines/bigwin/big_wins.png',
	'spines/bigwin/big_wins.webp',
	'spines/bigwin/index.ts',
	'spines/bigwin/mm_bigwin.json',
]);
check(
	'a sheet takes its image',
	prune(['reelsFrame']).removed.filter((rel) => rel.startsWith('sprites/reelsFrame/')).length > 1,
	true,
);
check('a plan that kept all removes nothing', prune(['bigwin'], { keptAllBecause: 'doubt' }), {
	removed: [],
	keptAll: true,
	left: prune([]).left,
});
check(
	'a kept key whose file cannot be read removes nothing',
	(({ removed, keptAll }) => ({ removed, keptAll }))(
		prune(['bigwin'], { corrupt: files.reelsFrame[0] }),
	),
	{ removed: [], keptAll: true },
);
check(
	'every stock key names files that exist in the seeded static folder',
	Object.values(files)
		.flat()
		.filter((rel) => !existsSync(join(STATIC_ASSETS, rel))),
	[],
);
check(
	'every stock key has files',
	STOCK_KEYS.filter((key) => !files[key]?.length),
	[],
);

console.log('\n5. only a standalone game build is pruned');
const ENGINE_ROOT = fileURLToPath(new URL('../', import.meta.url));
check(
	'the engine, its apps, a game repo, a game repo with IE_STOCK_PRUNE=0',
	[
		prunesThisBuild(ENGINE_ROOT, {}),
		prunesThisBuild(join(ENGINE_ROOT, 'apps/lines'), {}),
		prunesThisBuild(join(ENGINE_ROOT, '..', 'some-game'), {}),
		prunesThisBuild(join(ENGINE_ROOT, '..', 'some-game'), { IE_STOCK_PRUNE: '0' }),
	],
	[false, false, true, false],
);

console.log('\n6. ?anticipation= on a pruned build');
const game = join(ENGINE_ROOT, '..', 'some-game');
check(
	'__IE_STOCK_PRUNED__: a game repo build, its dev server, the engine, IE_STOCK_PRUNE=0',
	[
		stockPrunedDefine({ cwd: game, env: {} }).__IE_STOCK_PRUNED__,
		stockPrunedDefine({ dev: true, cwd: game, env: {} }).__IE_STOCK_PRUNED__,
		stockPrunedDefine({ cwd: ENGINE_ROOT, env: {} }).__IE_STOCK_PRUNED__,
		stockPrunedDefine({ cwd: game, env: { IE_STOCK_PRUNE: '0' } }).__IE_STOCK_PRUNED__,
	],
	['true', 'false', 'false', 'false'],
);
check(
	'only possible / guaranteed arm',
	['?anticipation=possible', '?anticipation=guaranteed', '?anticipation=1', ''].map(
		anticipationParam,
	),
	['possible', 'guaranteed', null, null],
);
const withSymbols = (symbols: StockAssetData['symbols']): StockAssetData => ({
	...stockAssetDataOf(reference)!,
	symbols,
});
const keptByWinFrame = new Set(
	referencePlan.skipped.includes('anticipation') ? [] : ['anticipation'],
);
check(
	'refused: the stock rig left out; a swapped stock rig left out',
	[
		anticipationRigLeftOut(withSymbols(undefined), new Set()),
		anticipationRigLeftOut(withSymbols({ anticipation: { spineKey: 'reelhouse' } }), new Set()),
	],
	[true, true],
);
check(
	'not refused: the default win frame keeps the rig; an R2 rig is never stock',
	[
		anticipationRigLeftOut(withSymbols(undefined), keptByWinFrame),
		anticipationRigLeftOut(
			withSymbols({ anticipation: { spineKey: 'c/p/rigs/tease' } }),
			new Set(),
		),
	],
	[false, false],
);

if (failures) {
	console.log(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
