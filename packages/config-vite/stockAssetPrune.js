/**
 * A standalone game build leaves out the stock sample art its project never draws.
 *
 * A game repo carries the upstream sample game's files in `static/assets/` (seeded from
 * `apps/lines/static` by `scripts/new-game.mjs`), and SvelteKit copies `static/` into every build:
 * 11.4 MB of `overlay-buffaloduel`'s v9 build were these files, most of them never fetched, because
 * the boot already takes the keys it can never draw off the asset table
 * (`apps/lines/src/game/stockAssetBoot.ts`). A standalone build bakes the data that decision reads,
 * so `apps/lines/src/game/stockAssetBuild.ts` takes it at build time, and this plugin deletes the
 * skipped keys' files from SvelteKit's client output before the adapter copies it to `build/`.
 * `static/` itself is never touched, so the repo stays clean and every build decides afresh.
 *
 * The stock SOUND banks go the same way (`apps/lines/src/game/stockSoundBuild.ts`, the boot's own
 * decision in `stockSounds.ts`): a bank the game can never play leaves the build's
 * `audio/sounds.json` and its files leave the build.
 *
 * Only a standalone game build (the cwd is outside the engine) is pruned: the engine's own apps,
 * the shared runtime online games boot included, ship exactly as before. `IE_STOCK_PRUNE=0` turns
 * it off. Every doubt keeps every file: the plan keeping all, a plan that cannot run, a kept key
 * whose files cannot be read.
 *
 * The plan is loaded through a throwaway Vite server (`ssrLoadModule`), because it imports the
 * game's TypeScript sources the way the game build resolves them.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLE = join(ENGINE_ROOT, 'apps/lines/src/baked-editor-bundle.json');
const PLAN_MODULE = join(ENGINE_ROOT, 'apps/lines/src/game/stockAssetBuild.ts');
const SOUND_PLAN_MODULE = join(ENGINE_ROOT, 'apps/lines/src/game/stockSoundBuild.ts');
/** The stock audio's manifest, relative to the assets root: its banks' files sit beside it. */
const SOUND_MANIFEST = 'audio/sounds.json';

const PAGE_EXT = /\.(png|webp|jpe?g|avif|ktx2|basis)$/i;

/** Whether a build run from `cwd` is pruned: a standalone game repo (its cwd outside the engine),
 *  unless `IE_STOCK_PRUNE=0`. */
export const prunesThisBuild = (cwd = process.cwd(), env = process.env) => {
	const rel = relative(ENGINE_ROOT, cwd);
	const insideEngine = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
	return !insideEngine && env.IE_STOCK_PRUNE !== '0';
};

/** `rel` (posix, relative to the assets root) resolved against `from`'s folder; null outside it. */
const sibling = (from, name) => {
	const joined = posix.normalize(posix.join(posix.dirname(from), name.replace(/\\/g, '/')));
	return joined.startsWith('../') || posix.isAbsolute(joined) ? null : joined;
};

/** The files `rel` names in turn: an atlas's pages, a sheet's image and related packs, a font's pages. */
function namedFiles(assetsDir, rel) {
	const text = readFileSync(join(assetsDir, rel), 'utf8');
	if (rel.endsWith('.atlas')) {
		return text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.includes(':') && PAGE_EXT.test(line));
	}
	if (rel.endsWith('.xml') || rel.endsWith('.fnt')) {
		return [...text.matchAll(/<page\b[^>]*\bfile="([^"]+)"/g)].map((m) => m[1]);
	}
	if (rel.endsWith('.json')) {
		const meta = JSON.parse(text)?.meta;
		return [
			...(typeof meta?.image === 'string' ? [meta.image] : []),
			...(Array.isArray(meta?.related_multi_packs) ? meta.related_multi_packs : []),
		];
	}
	return [];
}

/** Every file `roots` load, followed through what each names; throws when one cannot be read. */
function closure(assetsDir, roots) {
	const seen = new Set();
	const queue = [...roots];
	while (queue.length) {
		const rel = queue.pop();
		if (seen.has(rel)) continue;
		seen.add(rel);
		for (const name of namedFiles(assetsDir, rel)) {
			const next = sibling(rel, name);
			if (next === null) throw new Error(`${rel} names ${name}, outside the assets folder`);
			if (PAGE_EXT.test(next)) seen.add(next);
			else queue.push(next);
		}
	}
	return seen;
}

/** A page's other encodings beside it (the 🗜 Optimize WebP twin, a KTX2 copy). */
const withTwins = (assetsDir, rels) => {
	const out = new Set(rels);
	for (const rel of rels) {
		if (!PAGE_EXT.test(rel)) continue;
		const stem = rel.replace(PAGE_EXT, '');
		for (const ext of ['.png', '.webp', '.jpg', '.jpeg', '.avif', '.ktx2', '.basis']) {
			if (existsSync(join(assetsDir, stem + ext))) out.add(stem + ext);
		}
	}
	return out;
};

/**
 * Delete the files of `plan.skipped` from `assetsDir` (the build's `assets/` folder), keeping every
 * file a kept key also loads. Returns what was removed (`rel` relative to `assetsDir`) or, when a
 * doubt stopped it, `keptAllBecause` with nothing removed.
 *
 * @param {string} assetsDir
 * @param {{ skipped: string[], files: Record<string, string[]>, keptAllBecause?: string }} plan
 */
export function pruneStockFiles(assetsDir, plan) {
	if (plan.keptAllBecause) return { removed: [], keptAllBecause: plan.keptAllBecause };
	if (!plan.skipped.length) return { removed: [] };
	const skipped = new Set(plan.skipped);
	const keptRoots = [];
	const skippedRoots = [];
	for (const [key, files] of Object.entries(plan.files)) {
		(skipped.has(key) ? skippedRoots : keptRoots).push(...files);
	}
	// A kept key whose own file is absent loads nothing from this folder, so it protects nothing.
	const exists = (rel) => existsSync(join(assetsDir, rel));
	let kept;
	try {
		kept = withTwins(assetsDir, closure(assetsDir, keptRoots.filter(exists)));
	} catch (error) {
		return { removed: [], keptAllBecause: `a kept stock file could not be read: ${error.message}` };
	}
	const present = skippedRoots.filter(exists);
	let leaving;
	try {
		leaving = withTwins(assetsDir, closure(assetsDir, present));
	} catch {
		// What an unreadable skipped file names stays; the file itself still goes.
		leaving = withTwins(assetsDir, new Set(present));
	}
	const removed = [];
	for (const rel of [...leaving].sort()) {
		const abs = join(assetsDir, rel);
		if (kept.has(rel) || !existsSync(abs)) continue;
		const bytes = statSync(abs).size;
		rmSync(abs);
		removed.push({ rel, bytes });
	}
	// The sample folders carry an `index.ts` nothing loads; it goes with the last file beside it.
	for (const dir of new Set(removed.map((file) => posix.dirname(file.rel)))) {
		const abs = join(assetsDir, dir);
		const left = existsSync(abs) ? readdirSync(abs) : [];
		if (left.length === 1 && left[0] === 'index.ts') {
			const rel = posix.join(dir, 'index.ts');
			removed.push({ rel, bytes: statSync(join(assetsDir, rel)).size });
			rmSync(join(assetsDir, rel));
		}
	}
	return { removed };
}

/** Run the build-time plan (`stockAssetBuild.ts`) on the bundle at `bundlePath`; any failure keeps
 *  everything. */
export async function stockAssetPlan(bundlePath = BUNDLE) {
	const keepAll = (keptAllBecause) => ({ keptAllBecause, skipped: [], files: {} });
	if (!existsSync(bundlePath)) return keepAll('no baked editor bundle');
	let bundle;
	try {
		bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
	} catch {
		return keepAll('the baked editor bundle is not readable JSON');
	}
	let server;
	try {
		server = await createServer({
			configFile: false,
			root: ENGINE_ROOT,
			logLevel: 'silent',
			appType: 'custom',
			server: { middlewareMode: true, hmr: false, ws: false },
			optimizeDeps: { noDiscovery: true, include: [] },
		});
		const { stockAssetBuildPlan } = await server.ssrLoadModule(PLAN_MODULE);
		return stockAssetBuildPlan(bundle);
	} catch (error) {
		return keepAll(`the stock-asset plan did not run: ${error?.message ?? error}`);
	} finally {
		await server?.close();
	}
}

/**
 * Leave the stock sound banks `plan.skipped` names out of `assetsDir`: off the manifest first, so
 * the build's `sounds.json` never names a file it does not carry, then their files. Returns what was
 * removed (`rel` relative to `assetsDir`) or, when a doubt stopped it, `keptAllBecause`.
 *
 * @param {string} assetsDir
 * @param {{ skipped: string[], files: Record<string, string[]>, keptAllBecause?: string }} plan
 */
export function pruneStockSoundBanks(assetsDir, plan) {
	if (plan.keptAllBecause) return { removed: [], keptAllBecause: plan.keptAllBecause };
	if (!plan.skipped.length) return { removed: [] };
	const manifestPath = join(assetsDir, SOUND_MANIFEST);
	const skipped = new Set(plan.skipped);
	const kept = new Set(
		Object.entries(plan.files).flatMap(([id, files]) => (skipped.has(id) ? [] : files)),
	);
	const leaving = [];
	for (const id of plan.skipped) {
		for (const name of plan.files[id] ?? []) {
			const rel = sibling(SOUND_MANIFEST, name);
			if (rel === null) {
				return {
					removed: [],
					keptAllBecause: `bank ${id} names ${name}, outside the assets folder`,
				};
			}
			if (!kept.has(name) && existsSync(join(assetsDir, rel))) leaving.push(rel);
		}
	}
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		manifest.banks = manifest.banks.filter((bank) => !skipped.has(bank.id));
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	} catch (error) {
		return {
			removed: [],
			keptAllBecause: `the stock sound manifest was not rewritten: ${error.message}`,
		};
	}
	const removed = [];
	for (const rel of leaving) {
		const abs = join(assetsDir, rel);
		removed.push({ rel, bytes: statSync(abs).size });
		rmSync(abs);
	}
	return { removed };
}

/** Run the build-time sound plan (`stockSoundBuild.ts`) on the bundle and the build's own stock
 *  audio manifest; any failure keeps every bank. */
export async function stockSoundPlan(assetsDir, bundlePath = BUNDLE) {
	const keepAll = (keptAllBecause) => ({ keptAllBecause, skipped: [], files: {} });
	const manifestPath = join(assetsDir, SOUND_MANIFEST);
	if (!existsSync(manifestPath)) return keepAll('no stock audio manifest');
	if (!existsSync(bundlePath)) return keepAll('no baked editor bundle');
	let bundle;
	let manifest;
	try {
		bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		return keepAll(`the bundle or the stock audio manifest is not readable JSON: ${error.message}`);
	}
	let server;
	try {
		server = await createServer({
			configFile: false,
			root: ENGINE_ROOT,
			logLevel: 'silent',
			appType: 'custom',
			server: { middlewareMode: true, hmr: false, ws: false },
			optimizeDeps: { noDiscovery: true, include: [] },
		});
		const { stockSoundBuildPlan } = await server.ssrLoadModule(SOUND_PLAN_MODULE);
		return stockSoundBuildPlan(bundle, manifest);
	} catch (error) {
		return keepAll(`the stock-sound plan did not run: ${error?.message ?? error}`);
	} finally {
		await server?.close();
	}
}

function writeReport(report) {
	const dir = process.env.IE_BUILD_REPORT_DIR;
	if (!dir) return;
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'stock.json'), `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	} catch (error) {
		console.warn(`[config-vite] stock assets: could not write the build report: ${error.message}`);
	}
}

const fmt = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** The Vite plugin: prunes after SvelteKit's server pass wrote the client output, before the adapter. */
export const stockAssetPrune = () => {
	let config;
	return {
		name: 'ie-stock-asset-prune',
		apply: 'build',
		configResolved(resolved) {
			config = resolved;
		},
		writeBundle: {
			sequential: true,
			order: 'post',
			async handler() {
				if (!config?.build.ssr) return;
				if (!prunesThisBuild()) return;
				const assetsDir = resolve(config.root, '.svelte-kit/output/client/assets');
				if (!existsSync(assetsDir)) return;
				const plan = await stockAssetPlan();
				const { removed, keptAllBecause } = pruneStockFiles(assetsDir, plan);
				const bytes = removed.reduce((sum, file) => sum + file.bytes, 0);
				console.info(
					keptAllBecause
						? `[config-vite] stock assets: kept every file (${keptAllBecause})`
						: `[config-vite] stock assets: left out ${plan.skipped.length} key(s) this project never ` +
								`draws — ${removed.length} file(s), ${fmt(bytes)}: ${plan.skipped.join(', ')}`,
				);
				const soundPlan = await stockSoundPlan(assetsDir);
				const sounds = pruneStockSoundBanks(assetsDir, soundPlan);
				const soundBytes = sounds.removed.reduce((sum, file) => sum + file.bytes, 0);
				console.info(
					sounds.keptAllBecause
						? `[config-vite] stock sounds: kept every bank (${sounds.keptAllBecause})`
						: `[config-vite] stock sounds: left out ${soundPlan.skipped.length} bank(s) this project ` +
								`never plays — ${sounds.removed.length} file(s), ${fmt(soundBytes)}`,
				);
				writeReport({
					skipped: keptAllBecause ? [] : plan.skipped,
					keptAllBecause: keptAllBecause ?? null,
					removed: removed.map((file) => ({ rel: `assets/${file.rel}`, bytes: file.bytes })),
					sounds: {
						skipped: sounds.keptAllBecause ? [] : soundPlan.skipped,
						keptAllBecause: sounds.keptAllBecause ?? null,
						removed: sounds.removed.map((file) => ({
							rel: `assets/${file.rel}`,
							bytes: file.bytes,
						})),
					},
				});
			},
		},
	};
};
