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
 */
export async function getDeployToken(): Promise<string | undefined> {
	const fromDb = await getAppSetting(DEPLOY_TOKEN_KEY);
	if (fromDb) return fromDb;
	return ENV.EDITOR_DOC_SECRET || undefined;
}
