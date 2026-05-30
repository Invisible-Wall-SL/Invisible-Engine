/**
 * Read-only listing of editor-relevant assets a project has produced. The
 * canvas (later step) reads this manifest to populate its asset palette. We
 * only return keys + names — never object contents.
 */
import { projectPrefix } from './projectPaths';
import { listObjects } from './r2';

export type AtlasKind = 'atlas-manifest' | 'atlas-page';

export interface AtlasAsset {
	name: string;
	key: string;
	kind: AtlasKind;
}

export interface SpineAsset {
	name: string;
	key: string;
	kind: 'spine';
	/** `true` when the bundle comes from the cross-project `spines/_shared/` root. */
	shared: boolean;
}

export interface SheetAsset {
	name: string;
	key: string;
	kind: 'sheet';
}

export interface ProjectAssets {
	atlases: AtlasAsset[];
	spines: SpineAsset[];
	sheets: SheetAsset[];
}

const MAX_PER_KIND = 500;

function basename(key: string): string {
	const i = key.lastIndexOf('/');
	return i === -1 ? key : key.slice(i + 1);
}

function bundleName(prefix: string, root: string): string {
	const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
	return trimmed.startsWith(root) ? trimmed.slice(root.length) : trimmed;
}

function isPlaceholder(name: string): boolean {
	return name === '.keep' || name === '';
}

async function listAtlases(client: string, project: string): Promise<AtlasAsset[]> {
	const root = projectPrefix('atlas_maker', client, project);
	const manifestsPrefix = `${root}/manifests/`;
	const pagesPrefix = `${root}/output/${project}/atlas/`;

	const [manifests, pages] = await Promise.all([
		listObjects(manifestsPrefix, MAX_PER_KIND),
		listObjects(pagesPrefix, MAX_PER_KIND),
	]);

	const out: AtlasAsset[] = [];
	for (const key of manifests.keys) {
		const name = basename(key);
		if (isPlaceholder(name)) continue;
		out.push({ name, key, kind: 'atlas-manifest' });
	}
	for (const key of pages.keys) {
		const name = basename(key);
		if (isPlaceholder(name)) continue;
		out.push({ name, key, kind: 'atlas-page' });
	}
	return out;
}

async function listSpines(client: string, project: string): Promise<SpineAsset[]> {
	const projectRoot = `${projectPrefix('spines', client, project)}/`;
	const sharedRoot = 'spines/_shared/';

	const [project_, shared_] = await Promise.all([
		listObjects(projectRoot, MAX_PER_KIND),
		listObjects(sharedRoot, MAX_PER_KIND),
	]);

	const out: SpineAsset[] = [];
	const seen = new Set<string>();
	for (const p of project_.prefixes) {
		const name = bundleName(p, projectRoot);
		if (!name) continue;
		seen.add(name);
		out.push({ name, key: p, kind: 'spine', shared: false });
	}
	for (const p of shared_.prefixes) {
		const name = bundleName(p, sharedRoot);
		if (!name || seen.has(name)) continue;
		out.push({ name, key: p, kind: 'spine', shared: true });
	}
	return out;
}

async function listSheets(client: string, project: string): Promise<SheetAsset[]> {
	const root = `${projectPrefix('sheet_maker', client, project)}/output/`;
	const res = await listObjects(root, MAX_PER_KIND);
	return res.prefixes
		.map((p) => ({ name: bundleName(p, root), key: p, kind: 'sheet' as const }))
		.filter((s) => s.name);
}

/** Build a read-only `ProjectAssets` snapshot for `(client, project)`. */
export async function listProjectAssets(
	clientKey: string,
	projectKey: string,
): Promise<ProjectAssets> {
	const [atlases, spines, sheets] = await Promise.all([
		listAtlases(clientKey, projectKey),
		listSpines(clientKey, projectKey),
		listSheets(clientKey, projectKey),
	]);
	return { atlases, spines, sheets };
}
