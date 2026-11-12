/**
 * Every game build ships the KTX2 twins of the engine's stock pages its own art still uses, and
 * tells the runtime which ones it shipped.
 *
 * The engine's stock art (`apps/lines/src/game/assets.ts`) has a `.pm.ktx2` twin of each page big
 * enough to earn one and a twin descriptor beside each descriptor (`x.ktx2.atlas`, …), written by
 * `scripts/check-stock-ktx2.mjs --write` and recorded, with the hash of every file a twin was made
 * from, in `apps/lines/src/game/stockTwins.json`. Phones load those twins (`stockTwins.ts`).
 *
 * A build's `static/assets/` is not always the engine's: a game repo's starts as a copy of
 * `apps/lines/static` (`scripts/new-game.mjs`), maybe from before the twins existed, and the game
 * may have put its own art over a stock file. So a twin ships only beside the exact bytes it was
 * encoded from: a descriptor whose file and pages in the build's static are the engine's gets its
 * twin files, copied from the engine where the build lacks them, and is named in
 * `__IE_STOCK_TWINS__` (descriptor → twin, relative to `assets/`); any other keeps loading its own
 * page on every tier. The engine's own apps (the shared runtime online games boot) carry every
 * twin already, so for them this copies nothing.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST = join(ENGINE_ROOT, 'apps/lines/src/game/stockTwins.json');
const ENGINE_ASSETS = join(ENGINE_ROOT, 'apps/lines/static/assets');

const hashes = new Map();
/** A file's SHA-256 as `stockTwins.json` writes it (`sha256-<base64>`), or null when it does not
 *  exist; cached, since config runs several times. */
const sha256Of = (file) => {
	if (!hashes.has(file))
		hashes.set(
			file,
			existsSync(file)
				? `sha256-${createHash('sha256').update(readFileSync(file)).digest('base64')}`
				: null,
		);
	return hashes.get(file);
};

const readManifest = () =>
	existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { descriptors: {} };

/**
 * What a build whose static assets are `assetsDir` ships: `twins` (descriptor → twin) and `files`,
 * the twin files each needs (relative to `assets/`), each read from `engineAssets`.
 *
 * @param {string} assetsDir
 * @param {{ manifest?: { descriptors: Record<string, { type: string, sha256: string, twin: string,
 *   pages: { file: string, sha256: string, twin: string, twinSha256: string }[] }> },
 *   engineAssets?: string }} [options]
 */
export function stockTwinPlan(
	assetsDir,
	{ manifest = readManifest(), engineAssets = ENGINE_ASSETS } = {},
) {
	const twins = {};
	const files = [];
	for (const [rel, entry] of Object.entries(manifest.descriptors)) {
		if (sha256Of(join(assetsDir, rel)) !== entry.sha256) continue;
		if (entry.pages.some((page) => sha256Of(join(assetsDir, page.file)) !== page.sha256)) continue;
		if (entry.pages.some((page) => sha256Of(join(engineAssets, page.twin)) !== page.twinSha256))
			continue;
		const needed = entry.pages.map((page) => page.twin);
		if (entry.type !== 'sprite') {
			if (!existsSync(join(engineAssets, entry.twin))) continue;
			needed.push(entry.twin);
		}
		twins[rel] = entry.twin;
		files.push(...needed);
	}
	return { twins, files };
}

/**
 * `files` (each stock key's own files, `stockAssetBuild.ts` `stockAssetFiles`) with the twin
 * descriptor of each key's descriptor added, so the stock prune takes a left-out key's twins with
 * it and keeps a kept key's.
 *
 * @param {Record<string, string[]>} files
 */
export function withStockTwinFiles(files, manifest = readManifest()) {
	return Object.fromEntries(
		Object.entries(files).map(([key, own]) => {
			const twin = manifest.descriptors[own[0]]?.twin;
			return [key, twin && !own.includes(twin) ? [...own, twin] : own];
		}),
	);
}

/** The `define` naming the twins this build ships, decided from the build's own `static/assets/`. */
export const stockTwinsDefine = (cwd = process.cwd()) => ({
	__IE_STOCK_TWINS__: JSON.stringify(stockTwinPlan(resolve(cwd, 'static/assets')).twins),
});

/**
 * Copy into `outAssets` each twin file `plan` ships that the build's output lacks; returns what it
 * copied (relative to `assets/`).
 */
export function copyStockTwins(outAssets, plan, engineAssets = ENGINE_ASSETS) {
	const copied = [];
	for (const rel of plan.files) {
		const dest = join(outAssets, rel);
		if (existsSync(dest)) continue;
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(join(engineAssets, rel), dest);
		copied.push(rel);
	}
	return copied;
}

/** The Vite plugin: after SvelteKit's server pass wrote the client output, before the stock prune
 *  (`stockAssetPrune.js`, after this in the plugin list) and the adapter. */
export const stockTwinShip = () => {
	let config;
	return {
		name: 'ie-stock-twin-ship',
		apply: 'build',
		configResolved(resolved) {
			config = resolved;
		},
		writeBundle: {
			sequential: true,
			order: 'post',
			handler() {
				if (!config?.build.ssr) return;
				const outAssets = resolve(config.root, '.svelte-kit/output/client/assets');
				if (!existsSync(outAssets)) return;
				const copied = copyStockTwins(
					outAssets,
					stockTwinPlan(resolve(config.root, 'static/assets')),
				);
				if (copied.length)
					console.info(
						`[config-vite] stock KTX2 twins: copied ${copied.length} file(s) from the engine`,
					);
			},
		},
	};
};
