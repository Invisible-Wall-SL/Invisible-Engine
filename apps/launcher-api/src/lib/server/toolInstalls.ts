import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { toolInstalls } from './db/schema';

/** Map of toolKey -> saved install path for a user. */
export type InstallPaths = Record<string, string>;

export async function getInstallPaths(userId: string): Promise<InstallPaths> {
	const rows = await getDb()
		.select({ toolKey: toolInstalls.toolKey, installPath: toolInstalls.installPath })
		.from(toolInstalls)
		.where(eq(toolInstalls.userId, userId));

	return Object.fromEntries(rows.map((r) => [r.toolKey, r.installPath]));
}

/** Upsert (or clear, when path is empty) a single tool's install path. */
export async function setInstallPath(
	userId: string,
	toolKey: string,
	installPath: string,
): Promise<void> {
	const db = getDb();
	const trimmed = installPath.trim();

	if (!trimmed) {
		await db
			.delete(toolInstalls)
			.where(and(eq(toolInstalls.userId, userId), eq(toolInstalls.toolKey, toolKey)));
		return;
	}

	await db
		.insert(toolInstalls)
		.values({ userId, toolKey, installPath: trimmed })
		.onConflictDoUpdate({
			target: [toolInstalls.userId, toolInstalls.toolKey],
			set: { installPath: trimmed, updatedAt: new Date() },
		});
}
