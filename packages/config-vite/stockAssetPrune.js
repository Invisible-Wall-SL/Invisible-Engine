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
 * Two more things leave with them:
 * - what else sits in a stock folder that no kept key loads: the sample's `index.ts` manifests and a
 *   font's `.json` twin, which nothing reads (the table loads a font by its `.xml`);
 * - the project's exported art the boot takes off the asset table too (`editorArtUnused`: art only
 *   a component default every placement overrides names), with its pages, unless another kept file
 *   names a page. On `overlay-buffaloduel` that was test6's 4096² UI page and an unplaced rig's page.
 *
 * Only a standalone game build (the cwd is outside the engine) is pruned: the engine's own apps,
 * the shared runtime online games boot included, ship exactly as before. `IE_STOCK_PRUNE=0` turns
 * it off. Every doubt keeps every file: the plan keeping all, a plan that cannot run, a kept file
 * that cannot be read, a stock-folder file the bundle or the built code names, and every file of a
 * stock folder holding a kept atlas, sheet or font whose pages this parser cannot read (all of them
 * when that descriptor is outside the stock folders).
 *
 * The plan is loaded through a throwaway Vite server (`ssrLoadModule`), because it imports the
 * game's TypeScript sources the way the game build resolves them.
 *
 * The stock SOUND banks go the same way (`apps/lines/src/game/stockSoundBuild.ts`, the boot's own
 * decision in `stockSounds.ts`): a bank the game can never play leaves the build's
 * `audio/sounds.json` and its files leave the build.
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

import { withStockTwinFiles } from './stockTwins.js';

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

/**
 * `__IE_STOCK_PRUNED__`: whether this build's stock files may be gone, so the boot refuses a test
 * param that would load one its project's docs never draw (`?anticipation=`). Never in dev, which
 * serves `static/` whole.
 */
export const stockPrunedDefine = ({
	dev = false,
	cwd = process.cwd(),
	env = process.env,
} = {}) => ({
	__IE_STOCK_PRUNED__: JSON.stringify(!dev && prunesThisBuild(cwd, env)),
});

/** `rel` (posix, relative to the assets root) resolved against `from`'s folder; null outside it. */
const sibling = (from, name) => {
	const joined = posix.normalize(posix.join(posix.dirname(from), name.replace(/\\/g, '/')));
	return joined.startsWith('../') || posix.isAbsolute(joined) ? null : joined;
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The files `rel` names in turn (an atlas's pages, a sheet's images and related packs, a font's
 * pages), and whether it is a page descriptor: an atlas, a font, or a sheet JSON. A page descriptor
 * that names no page is in a form this parser does not read.
 */
function namedFiles(assetsDir, rel) {
	const text = readFileSync(join(assetsDir, rel), 'utf8');
	if (/\.atlas$/i.test(rel)) {
		const names = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.includes(':') && PAGE_EXT.test(line));
		return { names, pageDescriptor: true };
	}
	if (/\.(xml|fnt)$/i.test(rel)) {
		// `<page id="0" file="…"/>` in an XML font, `page id=0 file="…"` in a text `.fnt`, either quote.
		const names = [...text.matchAll(/\bpage\b[^>\n]*\bfile=(?:"([^"]+)"|'([^']+)')/g)].map(
			(m) => m[1] ?? m[2],
		);
		return { names, pageDescriptor: /<font\b|^\s*(info|common)\s/m.test(text) };
	}
	if (/\.json$/i.test(rel)) {
		const doc = JSON.parse(text);
		if (!isRecord(doc)) return { names: [], pageDescriptor: false };
		const meta = isRecord(doc.meta) ? doc.meta : {};
		// Pixi's multi-texture form: `textures: [{ image, frames }]`.
		const textures = Array.isArray(doc.textures) ? doc.textures.filter(isRecord) : [];
		const names = [
			...(typeof meta.image === 'string' ? [meta.image] : []),
			...textures.map((texture) => texture.image).filter((image) => typeof image === 'string'),
			...(Array.isArray(meta.related_multi_packs)
				? meta.related_multi_packs.filter((pack) => typeof pack === 'string')
				: []),
		];
		return {
			names,
			pageDescriptor: 'frames' in doc || 'textures' in doc || 'image' in meta,
		};
	}
	return { names: [], pageDescriptor: false };
}

/**
 * Every file `roots` load, followed through what each names; throws when one cannot be read. A page
 * descriptor that names no page is pushed onto `unread`: what it draws from is unknown.
 */
function closure(assetsDir, roots, unread = []) {
	const seen = new Set();
	const queue = [...roots];
	while (queue.length) {
		const rel = queue.pop();
		if (seen.has(rel)) continue;
		seen.add(rel);
		const { names, pageDescriptor } = namedFiles(assetsDir, rel);
		if (pageDescriptor && !names.some((name) => PAGE_EXT.test(name))) unread.push(rel);
		for (const name of names) {
			const next = sibling(rel, name);
			if (next === null) throw new Error(`${rel} names ${name}, outside the assets folder`);
			if (PAGE_EXT.test(next)) seen.add(next);
			else queue.push(next);
		}
	}
	return seen;
}

/** `rels` with each page's other encodings beside it (the 🗜 Optimize WebP twin, a KTX2 copy, the
 *  engine's premultiplied KTX2 twin of a stock page), whether or not they exist. */
const withTwins = (rels) => {
	const out = new Set(rels);
	for (const rel of rels) {
		if (!PAGE_EXT.test(rel)) continue;
		const stem = rel.replace(PAGE_EXT, '');
		for (const ext of ['.png', '.webp', '.jpg', '.jpeg', '.avif', '.ktx2', '.pm.ktx2', '.basis']) {
			out.add(stem + ext);
		}
	}
	return out;
};

/** Every file under `dir`, relative to it, posix. */
function filesUnder(dir, prefix = '') {
	const out = [];
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), rel));
		else out.push(rel);
	}
	return out;
}

const DESCRIPTOR_EXT = /\.(atlas|json|xml|fnt)$/i;

/**
 * Delete from `assetsDir` (the build's `assets/` folder) the files of `plan.skipped` (stock keys)
 * and `plan.art.skipped` (exported art), plus every file in a stock folder (`plan.folders`) no kept
 * key loads, keeping every file a kept key, kept art or any descriptor outside the stock folders
 * also names.
 * `isNamed(rel)` protects a stock-folder file nothing in the table loads but the bundle or the code
 * names. Returns what was removed (`rel` relative to `assetsDir`; `art` the exported art's share)
 * or, when a doubt stopped it, `keptAllBecause` with nothing removed; `artKeptAllBecause` and
 * `sweepKeptBecause` when a doubt stopped only the art prune or (some of) the folder sweep.
 *
 * @param {string} assetsDir
 * @param {{ skipped: string[], files: Record<string, string[]>, keptAllBecause?: string,
 *   folders?: string[], art?: { skipped: string[], files: Record<string, string[]> } }} plan
 * @param {{ isNamed?: (rel: string) => boolean }} [options]
 */
export function pruneStockFiles(assetsDir, plan, { isNamed = () => false } = {}) {
	if (plan.keptAllBecause) return { removed: [], art: [], keptAllBecause: plan.keptAllBecause };
	const art = plan.art ?? { skipped: [], files: {} };
	const folders = plan.folders ?? [];
	if (!plan.skipped.length && !art.skipped.length && !folders.length)
		return { removed: [], art: [] };
	const skipped = new Set(plan.skipped);
	const artSkipped = new Set(art.skipped);
	const keptRoots = [];
	const keptArt = [];
	const stockLeaving = [];
	const artLeaving = [];
	for (const [key, files] of Object.entries(withStockTwinFiles(plan.files))) {
		(skipped.has(key) ? stockLeaving : keptRoots).push(...files);
	}
	for (const [key, files] of Object.entries(art.files)) {
		(artSkipped.has(key) ? artLeaving : keptArt).push(...files);
	}
	// A kept key whose own file is absent loads nothing from this folder, so it protects nothing.
	const exists = (rel) => existsSync(join(assetsDir, rel));
	const folderOf = (rel) => folders.find((folder) => rel.startsWith(`${folder}/`));
	const inStockFolder = (rel) => folderOf(rel) !== undefined;
	const leavingRoots = new Set([...stockLeaving, ...artLeaving]);
	const all = filesUnder(assetsDir);
	// Every other descriptor outside the stock folders may name a page a left-out one also names
	// (pages are shared under `_pages/`), so each is a root of what stays.
	const otherRoots = all.filter(
		(rel) => DESCRIPTOR_EXT.test(rel) && !leavingRoots.has(rel) && !inStockFolder(rel),
	);
	const unread = [];
	let reached;
	try {
		reached = closure(assetsDir, keptRoots.filter(exists), unread);
	} catch (error) {
		return {
			removed: [],
			art: [],
			keptAllBecause: `a kept stock file could not be read: ${error.message}`,
		};
	}
	// Kept art and every other descriptor protect what they name, one at a time: one that cannot be
	// read leaves the art where it is (its pages may be the left-out art's), not the stock prune.
	let artKeptAllBecause;
	for (const root of [...keptArt.filter(exists), ...otherRoots]) {
		try {
			for (const rel of closure(assetsDir, [root], unread)) reached.add(rel);
		} catch (error) {
			artKeptAllBecause ??= `a kept file could not be read: ${error.message}`;
		}
	}
	// Pages are matched without case (a Windows build loads `Page.png` from `page.png`).
	const kept = new Set([...withTwins(reached)].map((rel) => rel.toLowerCase()));
	const isKept = (rel) => kept.has(rel.toLowerCase());
	// The sweep deletes what no kept file names, so it runs only where every kept file was read: a
	// descriptor whose pages are unknown keeps its folder whole, or every folder when it sits outside
	// them (its pages may be anywhere), and so does a kept file that could not be read.
	const unswept = new Set(unread.map(folderOf));
	const sweepsNone = !!artKeptAllBecause || unswept.has(undefined);
	const sweepKeptBecause =
		artKeptAllBecause ??
		(unread.length ? `no page read from ${[...new Set(unread)].sort().join(', ')}` : undefined);
	const sweeps = (rel) => !sweepsNone && inStockFolder(rel) && !unswept.has(folderOf(rel));
	const leaving = (roots) => {
		const present = roots.filter(exists);
		try {
			return withTwins(closure(assetsDir, present));
		} catch {
			// What an unreadable left-out file names stays; the file itself still goes.
			return withTwins(new Set(present));
		}
	};
	const stockGoing = leaving(stockLeaving);
	for (const rel of all) {
		if (sweeps(rel) && !isKept(rel) && !isNamed(rel)) stockGoing.add(rel);
	}
	const artGoing = artKeptAllBecause ? new Set() : leaving(artLeaving);
	const remove = (going) => {
		const removed = [];
		for (const rel of [...going].sort()) {
			const abs = join(assetsDir, rel);
			if (isKept(rel) || !existsSync(abs)) continue;
			const bytes = statSync(abs).size;
			rmSync(abs);
			removed.push({ rel, bytes });
		}
		return removed;
	};
	const removed = remove(stockGoing);
	const artRemoved = remove(artGoing);
	for (const dir of new Set([...removed, ...artRemoved].map((file) => posix.dirname(file.rel)))) {
		const abs = join(assetsDir, dir);
		if (existsSync(abs) && readdirSync(abs).length === 0) rmSync(abs, { recursive: true });
	}
	return {
		removed,
		art: artRemoved,
		...(artKeptAllBecause ? { artKeptAllBecause } : {}),
		...(sweepKeptBecause ? { sweepKeptBecause } : {}),
	};
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

/** `text` with URL escapes decoded, backslashes (escaped or not) as `/`, and no case. */
export const normalisedPathText = (text) =>
	text
		.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
			try {
				return decodeURIComponent(run);
			} catch {
				return run;
			}
		})
		.replace(/\\+/g, '/')
		.toLowerCase();

/** Whether the baked bundle or the built client code names `rel`: what keeps a stock-folder file
 *  the stock table does not load. Code that cannot be read names everything. */
function namedBy(codeDir) {
	let text = existsSync(BUNDLE) ? readFileSync(BUNDLE, 'utf8') : '';
	try {
		for (const rel of filesUnder(codeDir)) {
			if (/\.(m?js|css|html)$/i.test(rel)) text += readFileSync(join(codeDir, rel), 'utf8');
		}
	} catch {
		return () => true;
	}
	const named = normalisedPathText(text);
	return (rel) => named.includes(rel.toLowerCase());
}

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
				const soundPlan = await stockSoundPlan(assetsDir);
				const sounds = pruneStockSoundBanks(assetsDir, soundPlan);
				const soundBytes = sounds.removed.reduce((sum, file) => sum + file.bytes, 0);
				console.info(
					sounds.keptAllBecause
						? `[config-vite] stock sounds: kept every bank (${sounds.keptAllBecause})`
						: `[config-vite] stock sounds: left out ${soundPlan.skipped.length} bank(s) this project ` +
								`never plays — ${sounds.removed.length} file(s), ${fmt(soundBytes)}`,
				);

				const plan = await stockAssetPlan();
				const {
					removed,
					art = [],
					keptAllBecause,
					artKeptAllBecause,
					sweepKeptBecause,
				} = pruneStockFiles(assetsDir, plan, {
					isNamed: namedBy(resolve(config.root, '.svelte-kit/output/client/_app')),
				});
				const sum = (files) => fmt(files.reduce((total, file) => total + file.bytes, 0));
				const artSkipped = keptAllBecause || artKeptAllBecause ? [] : (plan.art?.skipped ?? []);
				console.info(
					keptAllBecause
						? `[config-vite] stock assets: kept every file (${keptAllBecause})`
						: `[config-vite] stock assets: left out ${plan.skipped.length} key(s) this project never ` +
								`draws — ${removed.length} file(s), ${sum(removed)}: ${plan.skipped.join(', ')}`,
				);
				if (sweepKeptBecause) {
					console.info(
						`[config-vite] stock assets: kept stock-folder files no kept key loads (${sweepKeptBecause})`,
					);
				}
				if (artKeptAllBecause) {
					console.info(`[config-vite] exported art: kept every file (${artKeptAllBecause})`);
				} else if (artSkipped.length) {
					console.info(
						`[config-vite] exported art: left out ${artSkipped.length} asset(s) only a component ` +
							`default every placement overrides names — ${art.length} file(s), ${sum(art)}: ` +
							artSkipped.join(', '),
					);
				}
				const asBuilt = (files) =>
					files.map((file) => ({ rel: `assets/${file.rel}`, bytes: file.bytes }));
				writeReport({
					sounds: {
						skipped: sounds.keptAllBecause ? [] : soundPlan.skipped,
						keptAllBecause: sounds.keptAllBecause ?? null,
						removed: sounds.removed.map((file) => ({
							rel: `assets/${file.rel}`,
							bytes: file.bytes,
						})),
					},
					skipped: keptAllBecause ? [] : plan.skipped,
					keptAllBecause: keptAllBecause ?? null,
					sweepKeptBecause: sweepKeptBecause ?? null,
					removed: asBuilt(removed),
					art: {
						skipped: artSkipped,
						keptAllBecause: artKeptAllBecause ?? null,
						removed: asBuilt(art),
					},
				});
			},
		},
	};
};
