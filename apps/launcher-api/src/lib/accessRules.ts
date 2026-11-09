import { isOwnerRole, OWNER_ROLE } from './launcherGates';
import { TOOLS, USER_CAPABILITIES, roleHasTool, type Role, type ToolOverrides } from './roles';

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

/** Invisible Shader Graph: the one tool that writes shader graphs. */
export const SHADER_TOOL = 'shaders';

/**
 * The tools that READ a project's shader graphs (docs, list, history) and their compiled effects
 * (`shaderReadScope`): `/shaders`, and the tools whose pickers list custom Element FX (the Scene
 * and Component Editors, Symbols, the Flow). Only `/shaders` writes them.
 */
export const SHADER_READ_TOOLS = [
	SHADER_TOOL,
	'editor',
	'componentEditor',
	'symbols',
	'flow',
] as const;

/**
 * The tools that read ONLY the compiled effects (`shaderEffectsReadScope`, `GET
 * /api/shaders/effects`): the readers above, and the tools that draw a particle material (`/fx`,
 * the Rigger). They never see a graph's doc, its Custom GLSL source, the list or its history.
 */
export const SHADER_EFFECTS_READ_TOOLS = [...SHADER_READ_TOOLS, 'fx', 'rigger'] as const;

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
	if (isOwnerRole(actorRole)) return null;
	if (change.newRole === OWNER_ROLE) return 'Only an admin can grant the admin role.';
	if (change.targetRole === OWNER_ROLE) return 'Only an admin can change an admin account.';
	return null;
}

/**
 * The admin-panel actions only the owner's role may take, whatever the `adminPanel` capability
 * says. Each is a way for a delegated admin to reach past the panel: the deploy token is the
 * machine secret every build checks; another user's password is that user's account; a role's
 * grants include the delegate's own role, so editing them hands out every capability; a purge
 * erases a project's files for good. Everything else in the panel stays delegable.
 */
export const OWNER_ONLY_ADMIN_ACTIONS = [
	'revealDeployToken',
	'setDeployToken',
	'rotateDeployToken',
	'resetPassword',
	'setRoleToolAccess',
	'setToolAccess',
	'purgeProject',
] as const;

export type OwnerOnlyAdminAction = (typeof OWNER_ONLY_ADMIN_ACTIONS)[number];

/** What an owner-only decision needs from the submitted form. */
export interface OwnerActionTarget {
	actorId: string;
	/** `userId` of a per-user action. */
	userId?: string | null;
	/** `toolKey` of a per-user grant. */
	toolKey?: string | null;
}

/**
 * Why `action` is refused to a caller of `actorRole`, or `null`. Two of the actions are owner-only
 * in part: a delegate may still reset their OWN password, and may still set a user's TOOLS — only
 * the per-user capabilities (`USER_CAPABILITIES`: bug triage, starting fix runs, which spend money)
 * are the owner's to grant.
 */
export function ownerActionDenial(
	actorRole: Role,
	action: OwnerOnlyAdminAction,
	target: OwnerActionTarget,
): string | null {
	if (isOwnerRole(actorRole)) return null;
	switch (action) {
		case 'revealDeployToken':
		case 'setDeployToken':
		case 'rotateDeployToken':
			return 'Only an admin can see or change the deploy token.';
		case 'resetPassword':
			return target.userId === target.actorId
				? null
				: "Only an admin can reset another user's password.";
		case 'setRoleToolAccess':
			return "Only an admin can change a role's tools and capabilities.";
		case 'setToolAccess':
			return target.toolKey && USER_CAPABILITIES.includes(target.toolKey)
				? 'Only an admin can grant a capability.'
				: null;
		case 'purgeProject':
			return 'Only an admin can purge a project.';
	}
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
