import {
	normalizeBootSplashRef,
	type BootSplashRef,
	type BootSplashTier,
} from 'constants-shared/bootSplash';
import { getAppSetting, setAppSetting } from './appSettings';
import { loadDocWithEtag } from './editorStorage';

/**
 * The GLOBAL engine boot mark — which `_shared/spines/<bundle>` plays as the first
 * pre-canvas splash of every game (what Stake's gif used to occupy). Stored in
 * `app_settings` as JSON, exactly like {@link LAYOUT_PROFILE_DEFAULT_KEY}.
 *
 * NON-SECRET, but admin-WRITE-only: this is the engine's own mark, so a client editing
 * their project must not be able to change it. The read is safe to surface to any
 * project-scoped load (the export needs it); the write lives behind the `/admin` gate.
 */
export const BOOT_SPLASH_ENGINE_KEY = 'bootSplashEngine';

/**
 * The admin-set engine mark, or `undefined` when none is configured (⇒ the tier is
 * skipped and boot starts at the game's own splash).
 *
 * Fails SAFE, matching `getGlobalLayoutProfile`: a DB or parse error (most importantly
 * the `app_settings` table not yet migrated) returns `undefined` rather than throwing,
 * so an export/publish still succeeds through a deploy→migrate window — it just ships
 * without the engine mark instead of failing the whole game.
 */
export async function getEngineBootSplash(): Promise<BootSplashRef | undefined> {
	try {
		const raw = await getAppSetting(BOOT_SPLASH_ENGINE_KEY);
		if (!raw) return undefined;
		return normalizeBootSplashRef(JSON.parse(raw));
	} catch (err) {
		console.warn(
			'[bootSplash] engine mark read failed — shipping without it ' +
				'(is the app_settings migration applied?):',
			err instanceof Error ? err.message : err,
		);
		return undefined;
	}
}

/**
 * Persist the engine mark (validated), recording the admin. Pass anything that fails
 * {@link normalizeBootSplashRef} — including `null` or a blank bundle — to CLEAR it;
 * the stored empty string reads back as `undefined`, so "unset" and "never set" are the
 * same state and there is no half-configured tier to reason about.
 */
export async function setEngineBootSplash(
	input: unknown,
	userId: string,
): Promise<BootSplashRef | undefined> {
	const ref = normalizeBootSplashRef(input);
	await setAppSetting(BOOT_SPLASH_ENGINE_KEY, ref ? JSON.stringify(ref) : '', userId);
	return ref;
}

/**
 * The project's own boot mark, read off the editor doc's `settings.bootLoader`. Absent
 * doc, absent settings, and an unusable ref all collapse to `undefined` — a project that
 * has never opened the editor is not an error, it just has no second splash.
 */
export async function getProjectBootSplash(
	clientKey: string,
	projectKey: string,
): Promise<BootSplashRef | undefined> {
	try {
		const { doc } = await loadDocWithEtag(clientKey, projectKey);
		return normalizeBootSplashRef(doc?.settings?.bootLoader);
	} catch (err) {
		console.warn(
			'[bootSplash] project mark read failed — shipping without it:',
			err instanceof Error ? err.message : err,
		);
		return undefined;
	}
}

/** Both tiers in one read, in splash order. Either may be `undefined`. */
export async function resolveBootSplashRefs(
	clientKey: string,
	projectKey: string,
): Promise<Record<BootSplashTier, BootSplashRef | undefined>> {
	const [engine, game] = await Promise.all([
		getEngineBootSplash(),
		getProjectBootSplash(clientKey, projectKey),
	]);
	return { engine, game };
}
