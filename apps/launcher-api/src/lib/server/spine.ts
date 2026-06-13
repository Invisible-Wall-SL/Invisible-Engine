import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SUB, sharedSpinesPrefix, spineBundlePath, spineBundleSharedPath } from './projectPaths';
import { pickDeployedPage } from './deployedPage';
import {
	getObjectBytes,
	getObjectText,
	listAllObjects,
	objectExists,
	type ListedObject,
} from './r2';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

export async function requireSpineAccess(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	// The Spine Viewer AND the Rigger both read project skeletons through this gate
	// (same R2 spines + skeletons.json), so either grant suffices.
	const hasViewer = roleHasTool(locals.user.role, 'spineViewer', roleOverrides, overrides);
	const hasRigger = roleHasTool(locals.user.role, 'rigger', roleOverrides, overrides);
	if (!hasViewer && !hasRigger) {
		throw error(403, 'Your role does not have access to the Spine Viewer or Rigger.');
	}
}

/** Per-project skeletons.json key with a `_shared/` fallback root. */
export async function resolveSkeletonsRoot(
	clientKey: string,
	projectKey: string,
): Promise<{ root: string; key: string } | null> {
	const projectRoot = SUB.spines(clientKey, projectKey);
	if (await objectExists(`${projectRoot}/skeletons.json`)) {
		return { root: projectRoot, key: `${projectRoot}/skeletons.json` };
	}
	const sharedRoot = '_shared/spines';
	if (await objectExists(`${sharedRoot}/skeletons.json`)) {
		return { root: sharedRoot, key: `${sharedRoot}/skeletons.json` };
	}
	return null;
}

/** Pick the first existing bundle prefix: per-project, then shared `_shared/`. */
export async function resolveBundlePrefix(
	clientKey: string,
	projectKey: string,
	bundle: string,
	name: string,
): Promise<string | null> {
	const project = spineBundlePath(clientKey, projectKey, bundle);
	if (await objectExists(`${project}/${name}`)) return project;
	const shared = spineBundleSharedPath(bundle);
	if (await objectExists(`${shared}/${name}`)) return shared;
	return null;
}

const PAGE_LINE = /^(.+)\.(webp|jpg|jpeg)\s*$/i;

/** Rewrite atlas page refs (`foo.webp`) to a `.png` sibling when it exists in R2
 * (avoids lossy-WebP alpha — mirrors the local tool's _atlas_prefer_png). */
async function atlasPreferPng(text: string, bundlePrefix: string): Promise<string> {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(PAGE_LINE);
		if (m && (await objectExists(`${bundlePrefix}/${m[1]}.png`))) {
			out.push(`${m[1]}.png`);
		} else {
			out.push(line);
		}
	}
	return out.join('\n');
}

export interface SpineFile {
	body: Uint8Array | string;
	contentType: string;
}

/**
 * Fetch a single file inside a spine bundle, resolving the per-project location
 * first and falling back to the shared `_shared/<bundle>/` set. `.atlas` files
 * get the WebP→PNG sibling rewrite when `preferPng` is true.
 */
export async function fetchSpineBundleFile(
	clientKey: string,
	projectKey: string,
	bundle: string,
	name: string,
	preferPng: boolean,
): Promise<SpineFile | null> {
	const prefix = await resolveBundlePrefix(clientKey, projectKey, bundle, name);
	if (!prefix) return null;
	const key = `${prefix}/${name}`;

	if (name.toLowerCase().endsWith('.atlas')) {
		let text = await getObjectText(key);
		if (text === null) return null;
		if (preferPng) text = await atlasPreferPng(text, prefix);
		return { body: text, contentType: 'text/plain; charset=utf-8' };
	}

	const obj = await getObjectBytes(key);
	if (!obj) return null;
	return { body: obj.body, contentType: obj.contentType };
}

/** One skeleton's index entry, as written into `skeletons.json` by the sync. */
export interface SkeletonIndexEntry {
	name: string;
	folder: string;
	skeleton_file: string;
	atlas_file: string;
	format: 'skel' | 'json';
	version?: string;
	runtime: string;
	pma?: boolean;
	dir_b64: string;
}

/** Bundle name (`folder` in the index) implied by a spine node's `assetKey`. The
 * `assetKey` is the R2 prefix the asset list hands out — either per-project
 * `<client>/<project>/spines/<bundle>/` or the shared `_shared/spines/<bundle>/`. */
export function bundleFromAssetKey(
	clientKey: string,
	projectKey: string,
	assetKey: string,
): string | null {
	const trimmed = assetKey.endsWith('/') ? assetKey.slice(0, -1) : assetKey;
	const projectRoot = SUB.spines(clientKey, projectKey);
	const sharedRoot = sharedSpinesPrefix('').replace(/\/$/, '');
	for (const root of [projectRoot, sharedRoot]) {
		if (trimmed === root) return '';
		if (trimmed.startsWith(`${root}/`)) return trimmed.slice(root.length + 1);
	}
	return null;
}

/**
 * Read a project's `skeletons.json` entries (per-project, then `_shared/`). Returns
 * `[]` when the index is missing or unparseable. The shared read primitive for any
 * caller that needs to resolve a folder → `{ atlas_file, skeleton_file, … }`.
 */
export async function loadSkeletonIndex(
	clientKey: string,
	projectKey: string,
): Promise<SkeletonIndexEntry[]> {
	const root = await resolveSkeletonsRoot(clientKey, projectKey);
	if (!root) return [];
	const indexText = await getObjectText(root.key);
	if (!indexText) return [];
	try {
		return (JSON.parse(indexText).skeletons ?? []) as SkeletonIndexEntry[];
	} catch {
		return [];
	}
}

/** Page-image filenames referenced by an atlas (lines with an image extension). */
const ATLAS_PAGE_LINE = /^(\S.*\.(?:png|webp|jpg|jpeg))\s*$/i;
export function atlasPageNames(atlasText: string): string[] {
	const out: string[] = [];
	for (const line of atlasText.split(/\r?\n/)) {
		const m = line.match(ATLAS_PAGE_LINE);
		if (m && !line.includes(':')) out.push(m[1].trim());
	}
	return out;
}

/** Region names declared by an atlas (the Rigger lists these so a new rig can attach
 * packed images). A page block starts at file start / after a blank line with the
 * image filename, then page properties (`size:`…); every other non-indented, no-`:`
 * line is a region name. NOTE region names CAN have image extensions (e.g.
 * `heart_shadow.png`), so pages are identified structurally, not by extension. */
export function atlasRegionNames(atlasText: string): string[] {
	const out: string[] = [];
	let expectPage = true; // first non-empty line is a page image; also after a blank line
	for (const line of atlasText.split(/\r?\n/)) {
		if (line.trim() === '') { expectPage = true; continue; }
		if (/^\s/.test(line) || line.includes(':')) { expectPage = false; continue; } // property line
		if (expectPage) { expectPage = false; continue; } // page image filename
		out.push(line.trim()); // region name
	}
	return out;
}

/** The editor needs the skeleton stream URL, the (PNG-preferred) atlas text, and
 * each page image URL — all routed through the editor-gated `/api/editor/asset`
 * streamer so no extra tool grant is required. */
export interface EditorSpineDescriptor {
	folder: string;
	format: 'skel' | 'json';
	runtime: string;
	pma: boolean;
	atlasText: string;
	skeletonKey: string;
	pageKeys: string[];
	pageNames: string[];
}

/**
 * Map each spine page name to the R2 key the editor should stream. Prefers a
 * DEPLOYED page (`deploy/…`) whose basename matches the spine's page name —
 * via the shared `pickDeployedPage` ranking (editor-art excluded, newest deploy
 * batch, `.webp` then largest within it) — so a spine reflects the latest
 * deploy (same as region sprites). Falls back to the spine bundle's own page when
 * nothing is deployed for it. Safe only because the atlas geometry is unchanged
 * (the page is regenerated with the same layout); a re-pack that changed layout
 * would need a matching `.atlas`.
 */
async function resolveSpinePageKeys(
	pageNames: string[],
	client: string,
	project: string,
	bundlePrefix: string,
): Promise<string[]> {
	const deployPrefix = `${SUB.deploy(client, project)}/`;
	let deployObjs: ListedObject[] = [];
	try {
		deployObjs = await listAllObjects(deployPrefix);
	} catch {
		deployObjs = [];
	}
	return pageNames.map((n) => {
		const base = n.split('/').pop() ?? n;
		const dot = base.lastIndexOf('.');
		const stem = (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
		const deployed = pickDeployedPage(deployObjs, new Set([stem]), deployPrefix);
		return deployed ?? `${bundlePrefix}/${n}`;
	});
}

/**
 * Resolve a spine node's `assetKey` to everything the editor canvas needs to build
 * the skeleton: the index entry (from the per-project or `_shared` `skeletons.json`),
 * the PNG-preferred atlas text, and the R2 keys for the skeleton + page images.
 * Returns `null` when the project has no skeleton index or no matching bundle.
 */
export async function resolveEditorSpine(
	clientKey: string,
	projectKey: string,
	assetKey: string,
	preferPng: boolean,
): Promise<EditorSpineDescriptor | null> {
	const entries = await loadSkeletonIndex(clientKey, projectKey);
	// Resolve the skeleton, most-specific first:
	//  1. a full R2 bundle PREFIX → the FIRST skeleton in that folder (the editor's
	//     by-folder model — one skeleton per placed spine node);
	//  2. a `<folder>/<stem>` key (the Symbols tool's published `previewKey`, e.g.
	//     `symbols/h1`) → the exact `skeletons.json` entry by `name`;
	//  3. a bare engine key (e.g. `H1`, `explosion` — a coded symbol whose defaults
	//     were published WITHOUT previewKeys) → the entry whose SKELETON FILE stem
	//     matches case-insensitively (`H1` → `h1.json`). This makes a shared-atlas
	//     symbol spine previewable straight from its coded assetKey.
	const stemOf = (file: string): string => file.replace(/\.[^.]+$/, '').toLowerCase();
	const bundle = bundleFromAssetKey(clientKey, projectKey, assetKey);
	const entry =
		bundle !== null
			? entries.find((e) => e.folder === bundle)
			: (entries.find((e) => e.name === assetKey) ??
				entries.find((e) => stemOf(e.skeleton_file) === assetKey.toLowerCase()));
	if (!entry) return null;

	const atlas = await fetchSpineBundleFile(
		clientKey,
		projectKey,
		entry.folder,
		entry.atlas_file,
		preferPng,
	);
	if (!atlas || typeof atlas.body !== 'string') return null;

	const prefix = await resolveBundlePrefix(clientKey, projectKey, entry.folder, entry.atlas_file);
	if (!prefix) return null;

	const pageNames = atlasPageNames(atlas.body);
	return {
		folder: entry.folder,
		format: entry.format,
		runtime: entry.runtime,
		pma: Boolean(entry.pma),
		atlasText: atlas.body,
		skeletonKey: `${prefix}/${entry.skeleton_file}`,
		// Prefer the DEPLOYED page (deploy/ = what the game loads) so a spine-backed
		// screen (e.g. the Background) reflects the latest Atlas Maker deploy too —
		// matching the region-sprite path. The atlas geometry is unchanged, so this is
		// safe for the "regenerate page, don't override the .json" workflow (same
		// layout); falls back to the spine bundle's own page when nothing is deployed.
		pageKeys: await resolveSpinePageKeys(pageNames, clientKey, projectKey, prefix),
		pageNames,
	};
}
