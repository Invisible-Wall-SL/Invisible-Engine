import { TOOLS, roleHasTool, type Role, type ToolOverrides } from './roles';

/**
 * Pure access decisions shared by the routes that apply them and `check-launcher-gates.ts`, which
 * pins them. No DB here: each caller loads the grants and hands them in.
 */

/**
 * The tool a lease's `toolId` is entitled by — the one its page gates on. The Component Editor
 * page and its APIs gate on `editor` (its own entry only surfaces the card), so its lease does too.
 * `null` for an id that names no tool: no page leases under it.
 */
export function leaseEntitlingTool(toolId: string): string | null {
	if (toolId === 'componentEditor') return 'editor';
	return Object.hasOwn(TOOLS, toolId) ? toolId : null;
}

/**
 * Whether any of `tools` entitles `role` under its grants: a tool gate (`toolScope.ts` `gate`)
 * admits a caller holding its tool or any of its alternatives.
 */
export function entitledByAny(
	role: Role,
	tools: readonly string[],
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): boolean {
	return tools.some((tool) => roleHasTool(role, tool, roleOverrides, userOverrides));
}

/**
 * The tools that READ a project's shader graphs and their compiled effects (`shaderReadScope`):
 * `/shaders`, the tools whose pickers list custom Element FX (the Scene and Component Editors,
 * Symbols, the Flow), and the tools that draw a particle material (`/fx`, the Rigger). Only
 * `/shaders` writes them.
 */
export const SHADER_READ_TOOLS = [
	'shaders',
	'editor',
	'componentEditor',
	'symbols',
	'flow',
	'fx',
	'rigger',
] as const;

/**
 * Whether a user may create a project under `clientKey` (null = unassigned). Admins may use any
 * client; everyone else only one they hold a client grant for. Unassigned stays open: it is the
 * form's default, and a project there is visible to no one but admins and explicit grants.
 */
export function mayTargetClient(
	role: Role,
	clientKey: string | null,
	grantedClients: readonly string[],
): boolean {
	if (role === 'admin' || clientKey === null) return true;
	return grantedClients.includes(clientKey);
}

/**
 * Why an admin-panel action on a user account is refused, or `null`. The `adminPanel` capability
 * can be granted to other roles, but only an actual admin may confer the admin role or act on an
 * admin's account (role, password, sessions, activation, expiry, deletion) — otherwise the
 * capability would be a path to the role it deliberately stops short of.
 */
export function adminAccountDenial(
	actorRole: Role,
	change: { targetRole?: Role | null; newRole?: Role | null },
): string | null {
	if (actorRole === 'admin') return null;
	if (change.newRole === 'admin') return 'Only an admin can grant the admin role.';
	if (change.targetRole === 'admin') return 'Only an admin can change an admin account.';
	return null;
}

/**
 * The `app_settings` rows whose value the DB browser may show. Allow-listed rather than matched,
 * so a new secret-bearing setting is hidden until someone decides otherwise.
 */
const VISIBLE_SETTINGS: ReadonlySet<string> = new Set([
	'runpodIdleEnabled',
	'runpodIdleMinutes',
	'runpodPods',
	'bootSplashEngine',
	'layoutProfileDefault',
	'riggerLibraryBackfilled',
]);

export function settingValueVisible(key: unknown): boolean {
	return typeof key === 'string' && VISIBLE_SETTINGS.has(key);
}
