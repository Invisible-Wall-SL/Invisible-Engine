/**
 * Canonical R2 layout for per-project storage. One source of truth for every
 * tool/area key, so the launcher, the tools, and the migration agree.
 *
 * Layout: one unified project repo `<client>/<project>/…` organized by asset
 * type (NOT by tool) — see `docs/design/unified-project-repo.md`. The reserved
 * client key `unassigned` covers projects with `client_key IS NULL`.
 *
 * The R2 prefix is built from `r2Slug(client)`/`r2Slug(project)`, the exact same
 * normalization the Python tools apply (`[^a-z0-9] → _`, lowercased, 60 chars).
 * The DB project/client KEYS stay as-is; only the R2 prefix is normalized. This
 * keeps the launcher and the Python tools byte-identical and fixes the historic
 * hyphen/underscore mismatch (`book-of-borut` → `book_of_borut`).
 */

export const UNASSIGNED_CLIENT = 'unassigned';

/**
 * Normalize a client/project name into the R2 path segment both the launcher
 * and the Python tools use. MUST stay byte-identical to the Python side.
 */
export function r2Slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '_')
			.slice(0, 60) || 'default'
	);
}

/** Root of one project's R2 repository: `<client>/<project>` (no trailing slash). */
export function projectPrefix(client: string, project: string): string {
	return `${r2Slug(client)}/${r2Slug(project)}`;
}

/**
 * Asset-type subfolders — the one place each path lives. Producers write and
 * consumers read these; `manifests/` is shared by Atlas + Sheet.
 */
export const SUB = {
	manifests: (c: string, p: string) => `${projectPrefix(c, p)}/manifests`,
	// Atlas Maker inputs: reference images + `input/refs/atlas/<name>` geometry.
	input: (c: string, p: string) => `${projectPrefix(c, p)}/input`,
	atlas: (c: string, p: string) => `${projectPrefix(c, p)}/atlas`,
	sheets: (c: string, p: string) => `${projectPrefix(c, p)}/sheets`,
	deploy: (c: string, p: string) => `${projectPrefix(c, p)}/deploy`,
	spines: (c: string, p: string) => `${projectPrefix(c, p)}/spines`,
	localization: (c: string, p: string) => `${projectPrefix(c, p)}/localization`,
	editor: (c: string, p: string) => `${projectPrefix(c, p)}/editor`,
	fonts: (c: string, p: string) => `${projectPrefix(c, p)}/fonts`,
} as const;

/** Cross-project shared spines, outside any single project: `_shared/spines/<bundle>`. */
export const sharedSpinesPrefix = (bundle: string) => `_shared/spines/${bundle}`;

/** Cross-project shared fonts, outside any single project: `_shared/fonts/<folder>`. */
export const sharedFontsPrefix = (folder: string) => `_shared/fonts/${folder}`;

/** Per-project font catalog manifest: `<client>/<project>/fonts/fonts.json`. */
export function fontCatalogKey(client: string, project: string): string {
	return `${SUB.fonts(client, project)}/fonts.json`;
}

/** Per-project font bundle prefix, e.g. `borut/book_of_borut/fonts/goldFont`. */
export function fontBundlePath(client: string, project: string, folder: string): string {
	assertBundle(folder);
	return `${SUB.fonts(client, project)}/${folder}`;
}

/** Cross-project fallback for shared font folders: `_shared/fonts/<folder>`. */
export function fontBundleSharedPath(folder: string): string {
	assertBundle(folder);
	return sharedFontsPrefix(folder);
}

/**
 * Editor game-type templates are GLOBAL (per game type, not per project), so they
 * live under the shared `_shared/editor-templates/<gameType>.json` prefix (§7.5).
 * This is the R2 override that takes precedence over the built-in code fallback.
 */
export function editorTemplateKey(gameType: string): string {
	return `_shared/editor-templates/${r2Slug(gameType)}.json`;
}

export function localizationDocKey(client: string, project: string): string {
	return `${SUB.localization(client, project)}/strings.json`;
}

export function editorDocKey(client: string, project: string): string {
	return `${SUB.editor(client, project)}/scenes.json`;
}

export function atlasConfigKey(client: string, project: string): string {
	return `${projectPrefix(client, project)}/atlas_config.json`;
}

export function atlasManifestsPrefix(client: string, project: string): string {
	return SUB.manifests(client, project);
}

export function sheetConfigKey(client: string, project: string): string {
	return `${projectPrefix(client, project)}/sheet_config.json`;
}

/** Bundles can be nested folders (e.g. `loader/sub`); reject parent escapes only.
 * Spine folder names are legitimately camelCase (`foregroundAnimation`, `fsIntro`),
 * so allow upper + lower case — the safety is the no-`..`/no-`/` checks, not case. */
const BUNDLE_SEG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function assertBundle(value: string): void {
	if (!value || value.includes('..') || value.startsWith('/') || value.endsWith('/')) {
		throw new Error(`Invalid spine bundle: ${JSON.stringify(value)}`);
	}
	for (const seg of value.split('/')) {
		if (!BUNDLE_SEG_RE.test(seg)) {
			throw new Error(`Invalid spine bundle segment: ${JSON.stringify(seg)}`);
		}
	}
}

/** Per-project spine bundle prefix, e.g. `borut/book_of_borut/spines/loader`. */
export function spineBundlePath(client: string, project: string, bundle: string): string {
	assertBundle(bundle);
	return `${SUB.spines(client, project)}/${bundle}`;
}

/** Cross-project fallback for shared bundles: `_shared/spines/<bundle>`. */
export function spineBundleSharedPath(bundle: string): string {
	assertBundle(bundle);
	return sharedSpinesPrefix(bundle);
}
