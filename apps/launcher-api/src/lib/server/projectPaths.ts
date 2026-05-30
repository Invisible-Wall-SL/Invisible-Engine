/**
 * Canonical R2 layout for per-project storage. One source of truth for every
 * tool/area key, so the launcher, the tools, and the migration agree.
 *
 * Layout: `<toolNs>/<client>/<project>/…` (Option B client isolation). The
 * reserved client key `unassigned` covers projects with `client_key IS NULL`.
 */

export type ToolNs = 'atlas_maker' | 'sheet_maker' | 'localization' | 'editor' | 'spines';

export const UNASSIGNED_CLIENT = 'unassigned';

/** Slug rule shared by `clients.ts` / `projects.ts` (`^[a-z0-9][a-z0-9_-]{0,63}$`). */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function assertSlug(value: string, label: string): void {
	if (!SLUG_RE.test(value)) {
		throw new Error(`Invalid ${label} key: ${JSON.stringify(value)}`);
	}
}

/** Canonical per-project prefix for a tool namespace (no trailing slash). */
export function projectPrefix(tool: ToolNs, client: string, project: string): string {
	assertSlug(client, 'client');
	assertSlug(project, 'project');
	return `${tool}/${client}/${project}`;
}

export function localizationDocKey(client: string, project: string): string {
	return `${projectPrefix('localization', client, project)}/strings.json`;
}

export function editorDocKey(client: string, project: string): string {
	return `${projectPrefix('editor', client, project)}/scenes.json`;
}

export function atlasConfigKey(client: string, project: string): string {
	return `${projectPrefix('atlas_maker', client, project)}/atlas_config.json`;
}

export function atlasManifestsPrefix(client: string, project: string): string {
	return `${projectPrefix('atlas_maker', client, project)}/manifests`;
}

export function sheetConfigKey(client: string, project: string): string {
	return `${projectPrefix('sheet_maker', client, project)}/sheet_config.json`;
}

/** Bundles can be nested folders (e.g. `loader/sub`); reject parent escapes only. */
function assertBundle(value: string): void {
	if (!value || value.includes('..') || value.startsWith('/') || value.endsWith('/')) {
		throw new Error(`Invalid spine bundle: ${JSON.stringify(value)}`);
	}
	for (const seg of value.split('/')) {
		if (!SLUG_RE.test(seg)) throw new Error(`Invalid spine bundle segment: ${JSON.stringify(seg)}`);
	}
}

/** Per-project spine bundle prefix, e.g. `spines/borut/book-of-borut/loader`. */
export function spineBundlePath(client: string, project: string, bundle: string): string {
	assertBundle(bundle);
	return `${projectPrefix('spines', client, project)}/${bundle}`;
}

/** Cross-project fallback for shared bundles: `spines/_shared/<bundle>`. */
export function spineBundleSharedPath(bundle: string): string {
	assertBundle(bundle);
	return `spines/_shared/${bundle}`;
}
