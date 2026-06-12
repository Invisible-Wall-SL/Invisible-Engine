import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { appSettings } from './db/schema';
import { ENV } from './env';

/** Settings key for the shared build/deploy token (overrides `EDITOR_DOC_SECRET`). */
export const DEPLOY_TOKEN_KEY = 'deployToken';

/**
 * Read a single app setting's value, or `undefined` when unset. The value may be
 * a SECRET — only call from server code behind an admin/capability gate; never
 * surface it through a non-admin route.
 */
export async function getAppSetting(key: string): Promise<string | undefined> {
	const [row] = await getDb()
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, key));
	return row?.value;
}

/** Upsert an app setting, recording the admin who set it. */
export async function setAppSetting(key: string, value: string, userId: string): Promise<void> {
	await getDb()
		.insert(appSettings)
		.values({ key, value, updatedBy: userId })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value, updatedAt: new Date(), updatedBy: userId },
		});
}

/**
 * The effective shared build/deploy token: the DB-managed value if an admin has
 * set one, else the `EDITOR_DOC_SECRET` env var (the bootstrap default/fallback,
 * so today's prod keeps working with no DB row). `undefined`/empty when neither
 * is configured. Never log the result. A per-request DB read is intentional —
 * keep it simple; rotations take effect immediately for new builds.
 *
 * Fails SAFE: a DB read error (most importantly the `app_settings` table not yet
 * existing — there is no auto-migrate on deploy, so the new code can ship before
 * migration 0009 is applied) falls back to the env var instead of throwing, so
 * the token gates keep working through the deploy→migrate window. Logs the error
 * (never the token).
 */
export async function getDeployToken(): Promise<string | undefined> {
	try {
		const fromDb = await getAppSetting(DEPLOY_TOKEN_KEY);
		if (fromDb) return fromDb;
	} catch (err) {
		console.warn(
			'[appSettings] deploy-token DB read failed — falling back to EDITOR_DOC_SECRET ' +
				'(is migration 0009 / app_settings applied?):',
			err instanceof Error ? err.message : err,
		);
	}
	return ENV.EDITOR_DOC_SECRET || undefined;
}
