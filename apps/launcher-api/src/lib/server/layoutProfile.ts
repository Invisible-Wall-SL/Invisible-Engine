import {
	DEFAULT_LAYOUT_PROFILE,
	normalizeLayoutProfile,
	type LayoutProfile,
} from 'engine-layout';
import { getAppSetting, setAppSetting } from './appSettings';
import { loadDocWithEtag } from './editorStorage';

/**
 * The pipeline-wide DEFAULT layout profile — the bucket set + selection rules seeded
 * into every project that hasn't authored its own. Stored in the `app_settings` table
 * under this key as JSON. NON-SECRET (unlike the deploy token): it is safe to surface
 * to project-scoped `/editor` and `/config` loads, so read it through the dedicated
 * getters here, never through the secret-oriented deploy-token plumbing.
 */
export const LAYOUT_PROFILE_DEFAULT_KEY = 'layoutProfileDefault';

/**
 * The admin-authored global default, or `undefined` when none is set (⇒ the coded
 * {@link DEFAULT_LAYOUT_PROFILE}). Fails SAFE: a DB/parse error (e.g. the app_settings
 * table not yet migrated) returns `undefined` rather than throwing, so editor/config
 * loads keep working through the deploy→migrate window.
 */
export async function getGlobalLayoutProfile(): Promise<LayoutProfile | undefined> {
	try {
		const raw = await getAppSetting(LAYOUT_PROFILE_DEFAULT_KEY);
		if (!raw) return undefined;
		const parsed = normalizeLayoutProfile(JSON.parse(raw));
		return parsed ?? undefined;
	} catch (err) {
		console.warn(
			'[layoutProfile] global default read failed — using coded DEFAULT_LAYOUT_PROFILE ' +
				'(is the app_settings migration applied?):',
			err instanceof Error ? err.message : err,
		);
		return undefined;
	}
}

/** Persist the admin-authored global default (validated), recording the admin. */
export async function setGlobalLayoutProfile(input: unknown, userId: string): Promise<LayoutProfile> {
	const profile = normalizeLayoutProfile(input);
	if (!profile) throw new Error('Invalid layout profile: no usable bucket');
	await setAppSetting(LAYOUT_PROFILE_DEFAULT_KEY, JSON.stringify(profile), userId);
	return profile;
}

export type LayoutProfileSource = 'project' | 'global' | 'default';

/**
 * The effective layout profile for a project, layered project override → admin global
 * default → coded {@link DEFAULT_LAYOUT_PROFILE}, with a `source` tag mirroring
 * `resolveGameConfig`. When `clientKey`/`projectKey` are omitted only the global/default
 * layers are consulted (used by the admin editor, which authors the global default).
 */
export async function resolveLayoutProfile(
	clientKey?: string,
	projectKey?: string,
): Promise<{ profile: LayoutProfile; source: LayoutProfileSource }> {
	if (clientKey && projectKey) {
		try {
			const { doc } = await loadDocWithEtag(clientKey, projectKey);
			const project = normalizeLayoutProfile(doc?.layoutProfile);
			if (project) return { profile: project, source: 'project' };
		} catch {
			// fall through to global/default — a missing/unreadable doc is not an error here
		}
	}
	const global = await getGlobalLayoutProfile();
	if (global) return { profile: global, source: 'global' };
	return { profile: DEFAULT_LAYOUT_PROFILE, source: 'default' };
}
