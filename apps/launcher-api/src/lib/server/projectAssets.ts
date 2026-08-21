/**
 * Read-only listing of editor-relevant assets a project has produced. The
 * canvas (later step) reads this manifest to populate its asset palette. We
 * only return keys + names — never object contents.
 */
import { manifestKeyByFolder } from '../pickSheets';
import { SUB, sharedSheetsPrefix } from './projectPaths';
import { listAllKeys, listObjects } from './r2';

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
	/** `true` when the bundle comes from the cross-project `_shared/spines/` root. */
	shared: boolean;
}

export interface SheetAsset {
	name: string;
	/** The sheet's R2 output PREFIX — what the FTP browser and the sheet tool address it by. */
	key: string;
	kind: 'sheet';
	/**
	 * The sheet's MANIFEST key, resolved from its folder. This — not {@link SheetAsset.key} — is
	 * the key an atlas-scoped frame ref must name (`<manifestKey>::<region>`), because the
	 * editor-art export registers a sheet's textures under its manifest. Absent when the folder
	 * holds no JSON (a sheet that never finished exporting).
	 */
	manifestKey?: string;
	/** `true` when the sheet comes from the cross-project `_shared/sheets/` library. */
	shared: boolean;
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
	const manifestsPrefix = `${SUB.manifests(client, project)}/`;
	const pagesPrefix = `${SUB.atlas(client, project)}/`;

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
	const projectRoot = `${SUB.spines(client, project)}/`;
	const sharedRoot = '_shared/spines/';

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

/**
 * Sheet folders + the MANIFEST key each one is scoped by (see {@link SheetAsset.manifestKey}).
 * `manifestKeyByFolder` derives every manifest from ONE recursive listing and states why it does
 * so, and shares its selection rule with `resolveManifestKey`.
 */
async function listSheets(client: string, project: string): Promise<SheetAsset[]> {
	const projectRoot = `${SUB.sheets(client, project)}/`;
	const sharedRoot = `${sharedSheetsPrefix('')}`;

	const [own, shared] = await Promise.all([
		listObjects(projectRoot, MAX_PER_KIND),
		listObjects(sharedRoot, MAX_PER_KIND),
	]);

	// A project sheet SHADOWS a shared one of the same name — same precedence as spines, and the
	// same reason: the library is a fallback, never something that can override work a project owns.
	const folders: SheetAsset[] = [];
	const seen = new Set<string>();
	for (const p of own.prefixes) {
		const name = bundleName(p, projectRoot);
		if (!name) continue;
		seen.add(name);
		folders.push({ name, key: p, kind: 'sheet', shared: false });
	}
	for (const p of shared.prefixes) {
		const name = bundleName(p, sharedRoot);
		if (!name || seen.has(name)) continue;
		folders.push({ name, key: p, kind: 'sheet', shared: true });
	}
	if (folders.length === 0) return folders;

	// Manifests are derived per ROOT, because `manifestKeyByFolder` strips the root it is given.
	const [ownManifests, sharedManifests] = await Promise.all([
		seen.size ? listAllKeys(projectRoot).then((k) => manifestKeyByFolder(projectRoot, k)) : null,
		folders.some((f) => f.shared)
			? listAllKeys(sharedRoot).then((k) => manifestKeyByFolder(sharedRoot, k))
			: null,
	]);
	return folders.map((s) => {
		const manifestKey = (s.shared ? sharedManifests : ownManifests)?.get(s.key);
		return manifestKey ? { ...s, manifestKey } : s;
	});
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
