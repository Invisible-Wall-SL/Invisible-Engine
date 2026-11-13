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
 *     kept key whose file cannot be read. A stock folder keeps only what a kept key loads (its
 *     `index.ts` and a font's `.json` twin go), unless the bundle or the code names the file; the
 *     audio sprite's folder is never swept.
 *  5. ONLY A STANDALONE GAME BUILD is pruned: never one run inside the engine (its apps, the shared
 *     runtime online games boot), and not with `IE_STOCK_PRUNE=0`.
 *  6. `?anticipation=` ON A PRUNED BUILD: the build tells the boot (`__IE_STOCK_PRUNED__`, never in
 *     dev), and the boot refuses the param only when it needs a stock rig the URL-less walk left out.
 *  7. EXPORTED ART THE BOOT NEVER LOADS: the plan names the `editorArt` entries no name the game can
 *     draw reaches (as the boot's `editorArtUnused` does) and nothing on doubt; the prune removes
 *     their descriptors, pages and twins, but keeps a page any other kept file names.
 *  8. THE SWEEP NEVER DELETES ON DOUBT: a kept key's pages stay when its descriptor is a Pixi
 *     multi-texture sheet, a font quoting `file='…'` or an atlas naming its page in another letter
 *     case; a kept sheet in a form the parser cannot read keeps its folder whole (every folder when
 *     it sits outside them), and so does a descriptor outside the stock folders that cannot be read.
 *     So does one reaching out of its folder, and a font naming fewer pages than it declares. The
 *     bundle and the code name a file as written or through URL escapes, backslashes and any case.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
	namesIn,
	prunesThisBuild,
	pruneStockFiles,
	stockPrunedDefine,
} from '../packages/config-vite/stockAssetPrune.js';
import compiledConfig from '../apps/lines/src/game/config.ts';
import { fallbackEditorScenes } from '../apps/lines/src/game/fallbackLayout.ts';
import {
	stockAssetBuildPlan,
	stockAssetFiles,
	stockAssetFolders,
} from '../apps/lines/src/game/stockAssetBuild.ts';
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
const folders = stockAssetFolders(files);
const SAMPLE_DIRS = [
	'spines/symbols',
	'spines/bigwin',
	'sprites/reelsFrame',
	'fonts/goldFont',
	'fonts/goldBlur',
	'audio',
];
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
	options: { keptAllBecause?: string; corrupt?: string; named?: string[] } = {},
): { removed: string[]; keptAll: boolean; left: string[] } => {
	const dir = mkdtempSync(join(tmpdir(), 'stock-prune-'));
	try {
		for (const sub of SAMPLE_DIRS)
			cpSync(join(STATIC_ASSETS, sub), join(dir, sub), { recursive: true });
		if (options.corrupt) writeFileSync(join(dir, options.corrupt), '{ not json');
		const result = pruneStockFiles(
			dir,
			{
				skipped,
				files,
				folders,
				...(options.keptAllBecause ? { keptAllBecause: options.keptAllBecause } : {}),
			},
			{ isNamed: (rel: string) => (options.named ?? []).includes(rel) },
		);
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
check(
	'a key sharing its atlas with a kept one leaves its skeleton (and the unused folder index)',
	prune(['H1']).removed.filter((rel) => rel.startsWith('spines/symbols/')),
	['spines/symbols/h1.json', 'spines/symbols/index.ts'],
);
const allSymbols = prune(SYMBOL_RIGS);
check(
	'the last sharer takes the atlas, its page, the page twin and the folder index',
	allSymbols.left.filter((rel) => rel.startsWith('spines/symbols/')),
	[],
);
check(
	'a lone rig goes whole, with its KTX2 twin atlas and twin page',
	prune(['bigwin']).removed.filter((rel) => rel.startsWith('spines/bigwin/')),
	[
		'spines/bigwin/big_wins.atlas',
		'spines/bigwin/big_wins.ktx2.atlas',
		'spines/bigwin/big_wins.pm.ktx2',
		'spines/bigwin/big_wins.png',
		'spines/bigwin/big_wins.webp',
		'spines/bigwin/index.ts',
		'spines/bigwin/mm_bigwin.json',
	],
);
check(
	'a kept key keeps its KTX2 twin',
	prune(['H1']).left.filter((rel) => /\.ktx2/.test(rel) && rel.startsWith('spines/symbols/')),
	['spines/symbols/symbols.ktx2.atlas', 'spines/symbols/symbols.pm.ktx2'],
);
check(
	'a sheet takes its image',
	prune(['reelsFrame']).removed.filter((rel) => rel.startsWith('sprites/reelsFrame/')).length > 1,
	true,
);
check('a plan that kept all removes nothing', prune(['bigwin'], { keptAllBecause: 'doubt' }), {
	removed: [],
	keptAll: true,
	left: SAMPLE_DIRS.flatMap((sub) =>
		listed(join(STATIC_ASSETS, sub)).map((rel) => `${sub}/${rel}`),
	).sort(),
});
check(
	'a kept key whose file cannot be read removes nothing',
	(({ removed, keptAll }) => ({ removed, keptAll }))(
		prune(['bigwin'], { corrupt: files.reelsFrame[0] }),
	),
	{ removed: [], keptAll: true },
);
const goldKept = prune([]);
check(
	'a kept font keeps its descriptor, page and twin; its unused .json twin and index go',
	[
		goldKept.left.filter((rel) => rel.startsWith('fonts/goldFont/')),
		goldKept.removed.filter((rel) => rel.startsWith('fonts/goldFont/')),
	],
	[
		[
			'fonts/goldFont/mm_gold.ktx2.xml',
			'fonts/goldFont/mm_gold.pm.ktx2',
			'fonts/goldFont/mm_gold.png',
			'fonts/goldFont/mm_gold.webp',
			'fonts/goldFont/mm_gold.xml',
		],
		['fonts/goldFont/index.ts', 'fonts/goldFont/mm_gold.json'],
	],
);
check(
	'a stock-folder file the bundle or the code names stays',
	prune([], { named: ['fonts/goldFont/mm_gold.json'] }).left.includes(
		'fonts/goldFont/mm_gold.json',
	),
	true,
);
check(
	'a skipped font leaves no file behind',
	prune(['goldBlur']).left.filter((rel) => rel.startsWith('fonts/goldBlur/')),
	[],
);
check(
	'the audio sprite is never swept: no stock folder is its folder, and its files all stay',
	[
		folders.filter((folder) => files.sound.some((rel) => rel.startsWith(`${folder}/`))),
		prune([]).left.filter((rel) => rel.startsWith('audio/')),
	],
	[[], listed(join(STATIC_ASSETS, 'audio')).map((rel) => `audio/${rel}`)],
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

console.log('\n7. exported art the boot never loads');
const withArt = {
	...reference,
	editorArt: {
		sheets: [
			{
				key: 'p/manifests/drawn.json',
				json: 'editor-art/Drawn/Drawn.json',
				names: ['frame_bg.png'],
			},
			{
				key: 'p/manifests/unused.json',
				json: 'editor-art/Unused/Unused.json',
				ktx2Json: 'editor-art/Unused/Unused.ktx2.json',
				names: ['nothing_names_this'],
			},
		],
		images: [{ key: 'p/unused.png', file: 'editor-art/img/unused.png' }],
		spines: [
			{
				key: 'R_Unplaced',
				skeleton: 'editor-art/R_Unplaced/R_Unplaced.json',
				atlas: 'editor-art/R_Unplaced/R_Unplaced.atlas',
				ktx2Atlas: 'editor-art/R_Unplaced/R_Unplaced.ktx2.atlas',
			},
		],
	},
};
const artPlan = stockAssetBuildPlan(withArt);
check(
	'the plan leaves out the art no name reaches, by its asset-table key, with its own files',
	[sorted(artPlan.art.skipped), artPlan.art.files['R_Unplaced']],
	[
		['R_Unplaced', 'editorArt/editor-art/Unused/Unused.json', 'p/unused.png'],
		[
			'editor-art/R_Unplaced/R_Unplaced.json',
			'editor-art/R_Unplaced/R_Unplaced.atlas',
			'editor-art/R_Unplaced/R_Unplaced.ktx2.atlas',
		],
	],
);
check(
	'a doubt leaves no art out',
	stockAssetBuildPlan({ doc: null, editorArt: withArt.editorArt }).art.skipped,
	[],
);
const sheetOf = (image: string) => JSON.stringify({ frames: {}, meta: { image } });
const artPrune = (
	skippedArt: string[],
	{ corrupt }: { corrupt?: string } = {},
): { removed: string[]; left: string[]; artDoubt: boolean; stock: string[] } => {
	const dir = mkdtempSync(join(tmpdir(), 'art-prune-'));
	try {
		const put = (rel: string, body: string) => {
			const abs = join(dir, rel);
			mkdirSync(join(abs, '..'), { recursive: true });
			writeFileSync(abs, body);
		};
		put('_pages/own.webp', 'page');
		put('_pages/own.pm.ktx2', 'twin');
		put('_pages/shared.webp', 'page');
		put('_pages/symbols.webp', 'page');
		put('editor-art/Unused/Unused.json', sheetOf('../../_pages/own.webp'));
		put('editor-art/Unused/Unused.ktx2.json', sheetOf('../../_pages/own.pm.ktx2'));
		put('editor-art/R_Unplaced/R_Unplaced.json', '{"skeleton":{}}');
		put(
			'editor-art/R_Unplaced/R_Unplaced.atlas',
			'../../_pages/shared.webp\nsize: 4,4\n\n../../_pages/symbols.webp\nsize: 4,4\n',
		);
		put('editor-art/Drawn/Drawn.json', sheetOf('../../_pages/shared.webp'));
		put('editor-symbols/S/S.atlas', '../../_pages/symbols.webp\nsize: 4,4\n');
		put('editor-symbols/S/S.json', '{"skeleton":{}}');
		cpSync(join(STATIC_ASSETS, 'spines/bigwin'), join(dir, 'spines/bigwin'), { recursive: true });
		if (corrupt) put(corrupt, '{ not json');
		const result = pruneStockFiles(dir, {
			skipped: ['bigwin'],
			files: { bigwin: files.bigwin },
			folders: ['spines/bigwin'],
			art: { skipped: skippedArt, files: artPlan.art.files },
		});
		return {
			removed: result.art.map((file: { rel: string }) => file.rel).sort(),
			left: listed(dir).filter((rel) => !rel.startsWith('spines/')),
			artDoubt: !!result.artKeptAllBecause,
			stock: result.removed.map((file: { rel: string }) => file.rel),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
const unplaced = artPrune(['editorArt/editor-art/Unused/Unused.json', 'R_Unplaced']);
check('left-out art takes its descriptors, its own page and the page twin', unplaced.removed, [
	'_pages/own.pm.ktx2',
	'_pages/own.webp',
	'editor-art/R_Unplaced/R_Unplaced.atlas',
	'editor-art/R_Unplaced/R_Unplaced.json',
	'editor-art/Unused/Unused.json',
	'editor-art/Unused/Unused.ktx2.json',
]);
check(
	'a page a kept sheet also names stays, and so does what a descriptor outside the index names',
	unplaced.left,
	[
		'_pages/shared.webp',
		'_pages/symbols.webp',
		'editor-art/Drawn/Drawn.json',
		'editor-symbols/S/S.atlas',
		'editor-symbols/S/S.json',
	],
);
check('no art left out removes nothing', artPrune([]).removed, []);
const doubt = artPrune(['editorArt/editor-art/Unused/Unused.json', 'R_Unplaced'], {
	corrupt: 'editor-symbols/S/S.json',
});
check(
	'a descriptor that cannot be read keeps every art file, and the stock prune still runs',
	[doubt.removed, doubt.artDoubt, doubt.stock.includes('spines/bigwin/mm_bigwin.json')],
	[[], true, true],
);

console.log('\n8. the sweep never deletes on doubt');
const sweep = (
	extra: Record<string, string> = {},
): { left: string[]; removed: string[]; sweepDoubt: boolean } => {
	const dir = mkdtempSync(join(tmpdir(), 'sweep-prune-'));
	try {
		const put = (rel: string, body: string) => {
			const abs = join(dir, rel);
			mkdirSync(join(abs, '..'), { recursive: true });
			writeFileSync(abs, body);
		};
		put(
			'sprites/multi/multi.json',
			JSON.stringify({ textures: [{ image: 'multi.webp', frames: {} }] }),
		);
		put('sprites/multi/multi.webp', 'page');
		put('sprites/multi/index.ts', 'export {}');
		put(
			'fonts/quoted/quoted.xml',
			"<font><info face='q'/><pages><page id='0' file='quoted.png'/></pages></font>",
		);
		put('fonts/quoted/quoted.png', 'page');
		put('fonts/quoted/index.ts', 'export {}');
		put('spines/cased/cased.atlas', 'Cased.png\nsize: 4,4\n');
		put('spines/cased/cased.json', '{"skeleton":{}}');
		put('spines/cased/cased.png', 'page');
		put('spines/cased/cased.webp', 'twin');
		put('spines/cased/index.ts', 'export {}');
		for (const [rel, body] of Object.entries(extra)) put(rel, body);
		const result = pruneStockFiles(dir, {
			skipped: [],
			files: {
				multi: ['sprites/multi/multi.json'],
				quoted: ['fonts/quoted/quoted.xml'],
				cased: ['spines/cased/cased.atlas', 'spines/cased/cased.json'],
				...(extra['sprites/odd/odd.json'] ? { odd: ['sprites/odd/odd.json'] } : {}),
			},
			folders: [
				'sprites/multi',
				'fonts/quoted',
				'spines/cased',
				...(extra['sprites/odd/odd.json'] ? ['sprites/odd'] : []),
			],
		});
		return {
			left: listed(dir),
			removed: result.removed.map((file: { rel: string }) => file.rel).sort(),
			sweepDoubt: !!result.sweepKeptBecause,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
const read = sweep();
check(
	'a multi-texture sheet, a single-quoted font and a page in another case keep their pages',
	read.left.filter((rel) => !rel.endsWith('index.ts')),
	[
		'fonts/quoted/quoted.png',
		'fonts/quoted/quoted.xml',
		'spines/cased/cased.atlas',
		'spines/cased/cased.json',
		'spines/cased/cased.png',
		'spines/cased/cased.webp',
		'sprites/multi/multi.json',
		'sprites/multi/multi.webp',
	],
);
check(
	'every descriptor read, the sweep still runs',
	[read.removed, read.sweepDoubt],
	[['fonts/quoted/index.ts', 'spines/cased/index.ts', 'sprites/multi/index.ts'], false],
);
const odd = sweep({
	'sprites/odd/odd.json': JSON.stringify({ frames: {}, meta: { images: ['odd.png'] } }),
	'sprites/odd/odd.png': 'page',
	'sprites/odd/index.ts': 'export {}',
});
check(
	'a kept sheet whose pages are not read keeps its folder whole; the other folders are swept',
	[odd.left.filter((rel) => rel.startsWith('sprites/odd/')), odd.removed, odd.sweepDoubt],
	[
		['sprites/odd/index.ts', 'sprites/odd/odd.json', 'sprites/odd/odd.png'],
		['fonts/quoted/index.ts', 'spines/cased/index.ts', 'sprites/multi/index.ts'],
		true,
	],
);
for (const [label, extra] of [
	['an unreadable descriptor outside the stock folders', { 'editor-art/bad.json': '{ not json' }],
	[
		'a sheet outside the stock folders whose pages are not read',
		{ 'editor-art/odd.json': JSON.stringify({ frames: {}, meta: { images: ['x.png'] } }) },
	],
] as const) {
	const outside = sweep(extra);
	check(`${label} sweeps no folder`, [outside.removed, outside.sweepDoubt], [[], true]);
}
const reaching = sweep({
	'sprites/odd/odd.json': JSON.stringify({ frames: {}, meta: { images: ['../shared/x.png'] } }),
	'sprites/shared/x.png': 'page',
});
check(
	'a kept sheet whose pages are not read and which reaches out of its folder sweeps no folder',
	[reaching.removed, reaching.sweepDoubt],
	[[], true],
);
const twoPages = sweep({
	'fonts/quoted/quoted.xml':
		'<font><common pages="2"/><pages><page id="0" file="quoted.png"/>' +
		'<page id="1"\n file="second.png"/></pages></font>',
	'fonts/quoted/second.png': 'page',
});
check(
	'a font page written across lines is read',
	twoPages.left.includes('fonts/quoted/second.png'),
	true,
);
const undercount = sweep({
	'fonts/quoted/quoted.xml':
		'<font><common pages="2"/><pages><page id="0" file="quoted.png"/></pages></font>',
	'fonts/quoted/second.png': 'page',
});
check(
	'a font naming fewer pages than it declares keeps its folder whole',
	[undercount.left.includes('fonts/quoted/second.png'), undercount.sweepDoubt],
	[true, true],
);
check(
	'a BOM before a sheet is no doubt',
	sweep({ 'editor-art/bom.json': '\uFEFF' + JSON.stringify({ skeleton: {} }) }).sweepDoubt,
	false,
);
const named = namesIn(
	'"assets/fonts/my%20font/a.json" "fonts\\\\goldFont\\\\MM_Gold.json" "a%20b.png"',
);
check(
	'the bundle and the code name a file through URL escapes, backslashes, any case, or as written',
	['fonts/my font/a.json', 'fonts/goldFont/mm_gold.json', 'a%20b.png', 'fonts/other.json'].map(
		named,
	),
	[true, true, true, false],
);

if (failures) {
	console.log(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
