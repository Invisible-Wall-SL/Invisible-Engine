import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { roleToolAccess } from './db/schema';
import type { Role, ToolOverrides } from '$lib/roles';

/** Role-level tool/capability overrides as `toolKey -> granted` for one role. */
export async function getRoleOverrides(role: Role): Promise<ToolOverrides> {
	const rows = await getDb()
		.select({ toolKey: roleToolAccess.toolKey, granted: roleToolAccess.granted })
		.from(roleToolAccess)
		.where(eq(roleToolAccess.role, role));

	return Object.fromEntries(rows.map((r) => [r.toolKey, r.granted]));
}

/** All role-level overrides, keyed by role. */
export async function getAllRoleOverrides(): Promise<Record<Role, ToolOverrides>> {
	const rows = await getDb()
		.select({
			role: roleToolAccess.role,
			toolKey: roleToolAccess.toolKey,
			granted: roleToolAccess.granted,
		})
		.from(roleToolAccess);

	const out = {} as Record<Role, ToolOverrides>;
	for (const r of rows) {
		(out[r.role] ??= {})[r.toolKey] = r.granted;
	}
	return out;
}

/** Set an explicit role-level override (grant/revoke) for one role + tool. */
export async function setRoleOverride(
	role: Role,
	toolKey: string,
	granted: boolean,
): Promise<void> {
	await getDb()
		.insert(roleToolAccess)
		.values({ role, toolKey, granted })
		.onConflictDoUpdate({
			target: [roleToolAccess.role, roleToolAccess.toolKey],
			set: { granted, updatedAt: new Date() },
		});
}

/** Remove a role-level override so the tool reverts to the `ROLE_TOOLS` default. */
export async function clearRoleOverride(role: Role, toolKey: string): Promise<void> {
	await getDb()
		.delete(roleToolAccess)
		.where(and(eq(roleToolAccess.role, role), eq(roleToolAccess.toolKey, toolKey)));
}
