import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SUB, sharedSpinesPrefix, spineBundlePath, spineBundleSharedPath } from './projectPaths';
import { getObjectBytes, getObjectText, listAllObjects, objectExists } from './r2';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

export async function requireSpineAccess(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'spineViewer', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Spine Viewer.');
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
async function resolveBundlePrefix(
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
interface SkeletonIndexEntry {
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

/** Page-image filenames referenced by an atlas (lines with an image extension). */
const ATLAS_PAGE_LINE = /^(\S.*\.(?:png|webp|jpg|jpeg))\s*$/i;
function atlasPageNames(atlasText: string): string[] {
	const out: string[] = [];
	for (const line of atlasText.split(/\r?\n/)) {
		const m = line.match(ATLAS_PAGE_LINE);
		if (m && !line.includes(':')) out.push(m[1].trim());
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
 * preferring `.webp` then the largest match — so a spine reflects the latest
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
	let deployObjs: { key: string; size: number }[] = [];
	try {
		deployObjs = await listAllObjects(`${SUB.deploy(client, project)}/`);
	} catch {
		deployObjs = [];
	}
	const baseOf = (k: string): string => k.split('/').pop() ?? k;
	const split = (b: string): [string, string] => {
		const d = b.lastIndexOf('.');
		return d === -1 ? [b, ''] : [b.slice(0, d), b.slice(d + 1)];
	};
	return pageNames.map((n) => {
		const [stem] = split(baseOf(n));
		const want = stem.toLowerCase();
		const matches = deployObjs.filter((o) => {
			const [s, e] = split(baseOf(o.key));
			const ext = e.toLowerCase();
			return (ext === 'png' || ext === 'webp') && s.toLowerCase() === want;
		});
		if (matches.length === 0) return `${bundlePrefix}/${n}`;
		matches.sort((a, b) => {
			const aw = a.key.toLowerCase().endsWith('.webp') ? 0 : 1;
			const bw = b.key.toLowerCase().endsWith('.webp') ? 0 : 1;
			return aw !== bw ? aw - bw : b.size - a.size;
		});
		return matches[0].key;
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
	const bundle = bundleFromAssetKey(clientKey, projectKey, assetKey);
	if (bundle === null) return null;

	const root = await resolveSkeletonsRoot(clientKey, projectKey);
	if (!root) return null;
	const indexText = await getObjectText(root.key);
	if (!indexText) return null;

	let entries: SkeletonIndexEntry[];
	try {
		entries = (JSON.parse(indexText).skeletons ?? []) as SkeletonIndexEntry[];
	} catch {
		return null;
	}
	const entry = entries.find((e) => e.folder === bundle);
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
