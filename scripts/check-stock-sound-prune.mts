/**
 * Offline fixture for the build-time stock SOUND prune: the plan (`stockSoundBuild.ts`) a standalone
 * build takes from its baked bundle and its own `audio/sounds.json`, and the bank prune `config-vite`
 * runs with it (`pruneStockSoundBanks`, `packages/config-vite/stockAssetPrune.js`).
 *
 *   pnpm check:all --only stock-sound-prune
 *
 * Pins:
 *  1. DOUBT KEEPS EVERY BANK: a single sprite, no bundle, a bundle with no layout (the boot reads no
 *     catalog then), no stock list, a list of another version.
 *  2. THE BUILD SHIPS EXACTLY WHAT THE BOOT LOADS: for each catalog, the banks the build keeps are
 *     the banks `stockSoundBanks` loads in any browser — never fewer (a silent sound), never more.
 *  3. THE PRUNE takes a skipped bank's every container off the manifest and out of the folder, and
 *     leaves the kept banks and their files; it removes nothing on doubt: a plan that kept all, a
 *     file named outside the assets folder, a manifest it cannot rewrite.
 *  4. Each claim set fails on a planted mutant of the real plan and of the real prune.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	STOCK_SOUND_REACH_VERSION,
	type SoundCatalog,
} from '../packages/engine-layout/src/lib/index.ts';
import { pruneStockSoundBanks } from '../packages/config-vite/stockAssetPrune.js';
import * as realPlan from '../apps/lines/src/game/stockSoundBuild.ts';
import type { StockSoundBuildPlan } from '../apps/lines/src/game/stockSoundBuild.ts';
import { stockSoundBanks, type StockAudio } from '../apps/lines/src/game/stockSounds.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const AUDIO = join(ROOT, 'apps/lines/static/assets/audio');
const MANIFEST_TEXT = readFileSync(join(AUDIO, 'sounds.json'), 'utf8');
const manifest = JSON.parse(MANIFEST_TEXT) as StockAudio;
const banks = manifest.banks ?? [];
const ALL = banks.map((bank) => bank.id).sort();

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

type PlanModule = {
	stockSoundBuildPlan: (bundle: unknown, manifest: unknown) => StockSoundBuildPlan;
};

const DOC = { version: 1, scenes: [{ id: 'basegame', nodes: [] }] };
const list = (names: string[], version = STOCK_SOUND_REACH_VERSION) => ({ version, names });
const catalog = (over: Partial<SoundCatalog> = {}): SoundCatalog => ({
	prefix: 'sounds',
	sounds: [],
	stock: list([]),
	...over,
});
const bundleOf = (sounds: SoundCatalog | undefined, doc: unknown = DOC) => ({
	doc,
	...(sounds ? { sounds: { catalog: sounds } } : {}),
});
const CATALOGS: Record<string, SoundCatalog> = {
	'an empty list': catalog(),
	'a data-named sound': catalog({ stock: list(['sfx_fs_respins', 'jng_intro_fs']) }),
	'a slot on its own track': catalog({
		sounds: [{ name: 'background_music', file: 'a.mp3', durationMs: 1000, loop: true }],
		bindings: { slots: { baseMusic: { names: ['background_music'] } } },
	}),
	'a silenced slot': catalog({ bindings: { slots: { reelStop: { enabled: false } } } }),
	'a replaced stock sound': catalog({
		sounds: [{ name: 'bgm_freespin', file: 'b.mp3', durationMs: 1000, loop: true }],
	}),
	'the remake': catalog({
		sounds: [{ name: 'wild_west', file: 'c.mp3', durationMs: 1000, loop: true }],
		bindings: { winTiers: { big: { bgm: 'bgm_winlevel_big' } } },
		stock: list(['bgm_freespin', 'bgm_winlevel_big']),
	}),
};
/** The bank ids a boot loads in a browser that plays `canPlay`, read off each bank's file name. */
const bootLoads = (sounds: SoundCatalog, canPlay: (ext: string) => boolean): string[] =>
	stockSoundBanks({
		stock: manifest,
		manifestUrl: 'https://cdn.example/game/assets/audio/sounds.json',
		catalog: sounds,
		flowOverridden: false,
		canPlay,
	})
		.banks.map((bank) =>
			String(bank.src)
				.split('/')
				.pop()!
				.replace(/\.[a-z0-9]+$/, ''),
		)
		.sort();
const BROWSERS: Record<string, (ext: string) => boolean> = {
	'ogg first': () => true,
	'no ogg': (ext) => ext !== 'ogg',
	'mp3 only': (ext) => ext === 'mp3',
};

/** Claims 1–2 over a plan module; returns the labels that failed. */
function claims(mod: PlanModule): string[] {
	const failed: string[] = [];
	const expect = (label: string, ok: boolean) => {
		if (!ok) failed.push(label);
	};
	const keepsAll = (bundle: unknown, of: unknown = manifest) => {
		const plan = mod.stockSoundBuildPlan(bundle, of);
		return !!plan.keptAllBecause && plan.skipped.length === 0;
	};
	expect('1. a single sprite', keepsAll(bundleOf(catalog()), { src: ['sounds.ogg'], sprite: {} }));
	expect('1. no bundle', keepsAll(undefined));
	expect('1. a bundle with no layout', keepsAll(bundleOf(catalog(), { version: 1, scenes: [] })));
	expect('1. a bundle with no doc', keepsAll(bundleOf(catalog(), null)));
	expect('1. no catalog', keepsAll(bundleOf(undefined)));
	expect('1. no stock list', keepsAll(bundleOf({ prefix: 'sounds', sounds: [] })));
	expect('1. a list of another version', keepsAll(bundleOf(catalog({ stock: list([], 0) }))));
	for (const [name, sounds] of Object.entries(CATALOGS)) {
		const plan = mod.stockSoundBuildPlan(bundleOf(sounds), manifest);
		const kept = ALL.filter((id) => !plan.skipped.includes(id));
		for (const [browser, canPlay] of Object.entries(BROWSERS)) {
			expect(
				`2. ${name}, ${browser}: the build keeps what the boot loads`,
				!plan.keptAllBecause && JSON.stringify(kept) === JSON.stringify(bootLoads(sounds, canPlay)),
			);
		}
		expect(
			`2. ${name}: every bank's files are listed`,
			banks.every((bank) => plan.files[bank.id]?.length === Object.keys(bank.files).length),
		);
	}
	return failed;
}

console.log('1–2. the plan');
check('the real plan holds every claim', claims(realPlan), []);
check(
	'an empty list leaves banks out at all',
	realPlan.stockSoundBuildPlan(bundleOf(catalog()), manifest).skipped.length > 0,
	true,
);

console.log('\n3. the prune');
const listedFiles = (dir: string): string[] => {
	const out: string[] = [];
	const walk = (d: string, prefix: string) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(d, entry.name), rel);
			else out.push(rel);
		}
	};
	walk(dir, '');
	return out.sort();
};
type PruneFn = typeof pruneStockSoundBanks;
/** Prune a laid-out assets folder (the real manifest, a stub per bank file) with `plan`. */
const prune = (
	fn: PruneFn,
	plan: StockSoundBuildPlan,
	options: { noManifest?: boolean } = {},
): { removed: string[]; keptAll: boolean; left: string[]; manifestBanks: string[] } => {
	const dir = mkdtempSync(join(tmpdir(), 'stock-sound-prune-'));
	try {
		mkdirSync(join(dir, 'audio/stock'), { recursive: true });
		if (!options.noManifest) writeFileSync(join(dir, 'audio/sounds.json'), MANIFEST_TEXT);
		for (const bank of banks)
			for (const file of Object.values(bank.files))
				if (file) writeFileSync(join(dir, 'audio', file.src), bank.id);
		const result = fn(dir, plan);
		const after = join(dir, 'audio/sounds.json');
		return {
			removed: result.removed.map((file: { rel: string }) => file.rel).sort(),
			keptAll: !!result.keptAllBecause,
			left: listedFiles(dir),
			manifestBanks: existsSync(after)
				? ((JSON.parse(readFileSync(after, 'utf8')) as StockAudio).banks ?? [])
						.map((b) => b.id)
						.sort()
				: [],
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
const plan = realPlan.stockSoundBuildPlan(bundleOf(catalog()), manifest);
const filesOf = (ids: string[]) =>
	ids.flatMap((id) => plan.files[id].map((src) => `audio/${src}`)).sort();

/** Claim 3 over a prune function; returns the labels that failed. */
function pruneClaims(fn: PruneFn): string[] {
	const failed: string[] = [];
	const expect = (label: string, actual: unknown, expected: unknown) => {
		if (JSON.stringify(actual) !== JSON.stringify(expected)) failed.push(label);
	};
	const untouched = prune(fn, { skipped: [], files: plan.files });
	const pruned = prune(fn, plan);
	expect('3. a skipped bank leaves with every container', pruned.removed, filesOf(plan.skipped));
	expect(
		'3. the manifest lists exactly the kept banks',
		pruned.manifestBanks,
		ALL.filter((id) => !plan.skipped.includes(id)),
	);
	expect(
		'3. every kept bank keeps its files',
		filesOf(pruned.manifestBanks).filter((rel) => !pruned.left.includes(rel)),
		[],
	);
	expect(
		'3. a plan that kept all removes nothing',
		prune(fn, { ...plan, keptAllBecause: 'doubt' }),
		{
			...untouched,
			keptAll: true,
		},
	);
	const outside = { ...plan, files: { ...plan.files, [plan.skipped[0]]: ['../../escape.ogg'] } };
	expect(
		'3. a file named outside the assets folder removes nothing',
		(({ removed, keptAll, manifestBanks }) => ({ removed, keptAll, manifestBanks }))(
			prune(fn, outside),
		),
		{ removed: [], keptAll: true, manifestBanks: ALL },
	);
	expect(
		'3. a manifest it cannot rewrite removes nothing',
		(({ removed, keptAll }) => ({ removed, keptAll }))(prune(fn, plan, { noManifest: true })),
		{ removed: [], keptAll: true },
	);
	return failed;
}
check('the real prune holds every claim', pruneClaims(pruneStockSoundBanks), []);

console.log('\n4. planted mutants');
const SOURCE = readFileSync(join(ROOT, 'apps/lines/src/game/stockSoundBuild.ts'), 'utf8');
const MUTANTS: Record<string, [string, string]> = {
	'the layout check is skipped': ['doc.scenes.length === 0) return undefined', 'doc.scenes.length < 0) return undefined'], // prettier-ignore
	'a dev flow is assumed': ['flowOverridden: false', 'flowOverridden: true'],
	'the kept banks are the ones skipped': ['.filter((bank) => !keep.has(bank.id))', '.filter((bank) => keep.has(bank.id))'], // prettier-ignore
	'a doubt still prunes': ['if (loadedAllBecause) return keepAll(', 'if (false) return keepAll('],
};
/** The claims `run` fails on the module at `file`. A copy that does not load proves nothing, so it
 *  fails this check rather than counting as caught; a throw inside the claims is caught. */
async function caught<M>(file: string, run: (mod: M) => string[]): Promise<string[]> {
	let mod: M;
	try {
		mod = (await import(file)) as M;
	} catch (error) {
		check(`the mutant at ${file} loads`, String(error), 'it loads');
		return [];
	}
	try {
		return run(mod);
	} catch (error) {
		return [`it throws: ${error}`];
	}
}
const mutantDir = mkdtempSync(join(tmpdir(), 'stock-sound-plan-mutant-'));
try {
	for (const [name, [from, to]] of Object.entries(MUTANTS)) {
		if (!SOURCE.includes(from)) {
			check(`mutant "${name}" still applies to the source`, false, true);
			continue;
		}
		const file = join(mutantDir, `${name.replace(/\W+/g, '_')}.ts`);
		const stockSounds = join(ROOT, 'apps/lines/src/game/stockSounds.ts');
		writeFileSync(
			file,
			SOURCE.replace(from, to).replace(`from './stockSounds'`, `from '${stockSounds}'`),
		);
		const failed = await caught(file, (mod: PlanModule) => claims(mod));
		check(`mutant "${name}" is caught`, failed.length > 0, true);
		if (failed.length) console.log(`        caught by: ${failed[0]}`);
	}
	// The prune's own mutants: Vite (which the prune never calls) stubbed and its sibling imports
	// made absolute, so the copy loads from the temp folder.
	const CONFIG_VITE = join(ROOT, 'packages/config-vite');
	const PRUNE_SOURCE = readFileSync(join(CONFIG_VITE, 'stockAssetPrune.js'), 'utf8')
		.replace(
			"import { createServer } from 'vite';",
			"const createServer = () => { throw new Error('no server in a mutant'); };",
		)
		.replaceAll("from './", `from '${CONFIG_VITE}/`);
	const PRUNE_MUTANTS: Record<string, [string, string]> = {
		'the manifest keeps the skipped banks': ['manifest.banks = manifest.banks.filter((bank) => !skipped.has(bank.id));', ''], // prettier-ignore
		'a doubt still prunes': ['export function pruneStockSoundBanks(assetsDir, plan) {\n\tif (plan.keptAllBecause)', 'export function pruneStockSoundBanks(assetsDir, plan) {\n\tif (false)'], // prettier-ignore
		'a file outside the folder is skipped, not a doubt': ['if (rel === null) {', 'if (rel === null) continue; if (false) {'], // prettier-ignore
	};
	for (const [name, [from, to]] of Object.entries(PRUNE_MUTANTS)) {
		if (!PRUNE_SOURCE.includes(from)) {
			check(`prune mutant "${name}" still applies to the source`, false, true);
			continue;
		}
		const file = join(mutantDir, `prune_${name.replace(/\W+/g, '_')}.js`);
		writeFileSync(file, PRUNE_SOURCE.replace(from, to));
		const failed = await caught(file, (mod: { pruneStockSoundBanks: PruneFn }) =>
			pruneClaims(mod.pruneStockSoundBanks),
		);
		check(`prune mutant "${name}" is caught`, failed.length > 0, true);
		if (failed.length) console.log(`        caught by: ${failed[0]}`);
	}
} finally {
	rmSync(mutantDir, { recursive: true, force: true });
}

if (failures) {
	console.log(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
