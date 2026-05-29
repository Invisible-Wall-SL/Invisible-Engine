import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { userToolAccess } from './db/schema';
import type { ToolOverrides } from '$lib/roles';

/** Per-user tool overrides as `toolKey -> granted`. Absent keys defer to the role. */
export async function getToolOverrides(userId: string): Promise<ToolOverrides> {
	const rows = await getDb()
		.select({ toolKey: userToolAccess.toolKey, granted: userToolAccess.granted })
		.from(userToolAccess)
		.where(eq(userToolAccess.userId, userId));

	return Object.fromEntries(rows.map((r) => [r.toolKey, r.granted]));
}

/** Overrides for many users at once, keyed by userId. */
export async function getToolOverridesFor(
	userIds: string[],
): Promise<Record<string, ToolOverrides>> {
	const out: Record<string, ToolOverrides> = {};
	if (userIds.length === 0) return out;

	const rows = await getDb()
		.select({
			userId: userToolAccess.userId,
			toolKey: userToolAccess.toolKey,
			granted: userToolAccess.granted,
		})
		.from(userToolAccess);

	const wanted = new Set(userIds);
	for (const r of rows) {
		if (!wanted.has(r.userId)) continue;
		(out[r.userId] ??= {})[r.toolKey] = r.granted;
	}
	return out;
}

/** Set an explicit override (grant/revoke) for one user + tool. */
export async function setToolOverride(
	userId: string,
	toolKey: string,
	granted: boolean,
): Promise<void> {
	await getDb()
		.insert(userToolAccess)
		.values({ userId, toolKey, granted })
		.onConflictDoUpdate({
			target: [userToolAccess.userId, userToolAccess.toolKey],
			set: { granted, updatedAt: new Date() },
		});
}

/** Remove an override so the tool reverts to the role default. */
export async function clearToolOverride(userId: string, toolKey: string): Promise<void> {
	await getDb()
		.delete(userToolAccess)
		.where(and(eq(userToolAccess.userId, userId), eq(userToolAccess.toolKey, toolKey)));
}
