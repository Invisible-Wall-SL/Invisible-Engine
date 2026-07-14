import { randomBytes } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import {
	ADMIN_PANEL_CAPABILITY,
	CAPABILITIES,
	ROLES,
	TOOLS,
	ROLE_TOOLS,
	roleHasCapability,
} from '$lib/roles';
import { hashPassword } from '$lib/server/auth';
import { BUILD_ID } from '$lib/server/buildId';
import { purgeEverything } from '$lib/server/cfPurge';
import { getDb } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import {
	isValidEmail,
	isValidRole,
	listUsers,
	normalizeEmail,
	sessionsForUser,
	wouldRemoveLastAdmin,
} from '$lib/server/admin';
import {
	clearRoleOverride,
	getAllRoleOverrides,
	getRoleOverrides,
	setRoleOverride,
} from '$lib/server/roleToolAccess';
import {
	clearToolOverride,
	getToolOverridesFor,
	setToolOverride,
} from '$lib/server/userToolAccess';
import {
	DEFAULT_PROJECT_KEY,
	createProject,
	deleteProject,
	grantProjectAccess,
	isValidProjectKey,
	listProjects,
	projectAccessFor,
	projectClientKey,
	projectExists,
	renameProject,
	revokeProjectAccess,
	setProjectGameType,
} from '$lib/server/projects';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { selectableGameKinds } from '$lib/server/gameKinds';
import { scaffoldProject } from '$lib/server/projectScaffold';
import {
	assignProjectToClient,
	clientAccessFor,
	clientExists,
	createClient,
	deleteClient,
	grantClientAccess,
	isValidClientKey,
	listClients,
	renameClient,
	revokeClientAccess,
} from '$lib/server/clients';
import {
	createGame,
	defaultGameUrl,
	deleteGame,
	gameExists,
	isValidGameKey,
	listGames,
	renameGame,
	setGameProject,
	setGameUrl,
} from '$lib/server/games';
import { ENV } from '$lib/server/env';
import { DEPLOY_TOKEN_KEY, getDeployToken, setAppSetting } from '$lib/server/appSettings';
import type { Actions, PageServerLoad } from './$types';

/**
 * Admin gate reused by the load and every action. Allows access when the user's
 * role is the built-in `admin` OR the role matrix grants the `adminPanel`
 * capability to their role. Throws 403 otherwise.
 */
async function requireAdmin(locals: App.Locals) {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	if (!roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides)) {
		throw error(403, 'Admins only.');
	}
	return locals.user;
}

const MIN_PASSWORD = 8;

function parseExpiry(raw: string): Date | null | undefined {
	const value = raw.trim();
	if (!value) return null; // cleared
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return undefined; // invalid
	return d;
}

/** Mask a secret to a non-reversible preview (`abcd…wxyz`). Never reveals the body. */
function maskToken(token: string): string {
	if (token.length <= 8) return '••••';
	return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** Generate a strong URL-safe random deploy token (32 bytes ≈ 43 chars). */
function generateDeployToken(): string {
	return randomBytes(32).toString('base64url');
}

const MIN_DEPLOY_TOKEN = 16;

export const load: PageServerLoad = async ({ locals }) => {
	await requireAdmin(locals);

	const userList = await listUsers();
	const overrides = await getToolOverridesFor(userList.map((u) => u.id));
	const roleOverrides = await getAllRoleOverrides();
	const projects = await listProjects();
	const projectAccess = await projectAccessFor(userList.map((u) => u.id));
	const clients = await listClients();
	const clientAccess = await clientAccessFor(userList.map((u) => u.id));
	const games = await listGames();
	const gameKinds = await selectableGameKinds();

	// Deploy-token status only — the raw secret is NEVER sent on load; it is masked
	// by default and revealed only on demand via the reveal/set/rotate actions.
	const deployToken = await getDeployToken();

	return {
		currentUserId: locals.user!.id,
		users: userList,
		roles: ROLES,
		overrides,
		roleOverrides,
		tools: Object.values(TOOLS).map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
		capabilities: CAPABILITIES,
		adminPanelCapability: ADMIN_PANEL_CAPABILITY,
		// Baseline (no-override) state for each managed capability per role, using
		// the canonical resolver so the matrix UI doesn't re-encode the defaults.
		capabilityDefaults: Object.fromEntries(
			ROLES.map((role) => [
				role,
				Object.fromEntries(CAPABILITIES.map((c) => [c.key, roleHasCapability(role, c.key)])),
			]),
		) as Record<string, Record<string, boolean>>,
		roleTools: ROLE_TOOLS,
		projects,
		projectAccess,
		clients,
		clientAccess,
		games,
		gameKinds,
		defaultProjectKey: DEFAULT_PROJECT_KEY,
		gamesBaseUrl: ENV.GAMES_BASE_URL,
		// The running deploy id (git SHA / timestamp) so an admin can confirm WHICH build is live —
		// the reference point for "am I on the latest?" when a change doesn't seem to show.
		buildId: BUILD_ID,
		// Whether the Cloudflare purge lever is usable (token + zone configured on this service).
		cfConfigured: !!(ENV.CF_API_TOKEN && ENV.CF_ZONE_ID),
		deployToken: {
			configured: !!deployToken,
			// A short masked preview so an admin can sanity-check WHICH token is live
			// without revealing it. Never the full value.
			masked: deployToken ? maskToken(deployToken) : null,
		},
	};
};

export const actions: Actions = {
	createUser: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const email = normalizeEmail(String(data.get('email') ?? ''));
		const name = String(data.get('name') ?? '').trim() || null;
		const role = String(data.get('role') ?? '');
		const password = String(data.get('password') ?? '');

		if (!isValidEmail(email)) return fail(400, { action: 'createUser', error: 'Invalid email.' });
		if (!isValidRole(role)) return fail(400, { action: 'createUser', error: 'Invalid role.' });
		if (password.length < MIN_PASSWORD) {
			return fail(400, {
				action: 'createUser',
				error: `Password must be at least ${MIN_PASSWORD} characters.`,
			});
		}

		const db = getDb();
		const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
		if (existing) return fail(400, { action: 'createUser', error: 'Email already in use.' });

		await db
			.insert(users)
			.values({ email, name, role, passwordHash: await hashPassword(password) });
		return { action: 'createUser', ok: `Created ${email}.` };
	},

	setRole: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const role = String(data.get('role') ?? '');

		if (!isValidRole(role)) return fail(400, { action: 'setRole', error: 'Invalid role.' });
		if (userId === admin.id && role !== 'admin') {
			return fail(400, { action: 'setRole', error: 'You cannot demote your own account.' });
		}
		if (role !== 'admin' && (await wouldRemoveLastAdmin(userId))) {
			return fail(400, { action: 'setRole', error: 'Cannot demote the last admin.' });
		}

		await getDb().update(users).set({ role }).where(eq(users.id, userId));
		return { action: 'setRole', ok: 'Role updated.' };
	},

	setActive: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const active = data.get('active') === 'true';

		if (userId === admin.id && !active) {
			return fail(400, { action: 'setActive', error: 'You cannot disable your own account.' });
		}
		if (!active && (await wouldRemoveLastAdmin(userId))) {
			return fail(400, { action: 'setActive', error: 'Cannot disable the last admin.' });
		}

		await getDb().update(users).set({ active }).where(eq(users.id, userId));
		// Disabling kills the user's sessions immediately.
		if (!active) await getDb().delete(sessions).where(eq(sessions.userId, userId));
		return { action: 'setActive', ok: active ? 'User enabled.' : 'User disabled.' };
	},

	setExpiry: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const expiresAt = parseExpiry(String(data.get('expiresAt') ?? ''));

		if (expiresAt === undefined) {
			return fail(400, { action: 'setExpiry', error: 'Invalid date.' });
		}
		const expiringInPast = expiresAt !== null && expiresAt.getTime() < Date.now();
		if (userId === admin.id && expiringInPast) {
			return fail(400, { action: 'setExpiry', error: 'You cannot expire your own account.' });
		}
		if (expiringInPast && (await wouldRemoveLastAdmin(userId))) {
			return fail(400, { action: 'setExpiry', error: 'Cannot expire the last admin.' });
		}

		await getDb().update(users).set({ expiresAt }).where(eq(users.id, userId));
		return { action: 'setExpiry', ok: expiresAt ? 'Expiry set.' : 'Expiry cleared.' };
	},

	resetPassword: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const password = String(data.get('password') ?? '');

		if (password.length < MIN_PASSWORD) {
			return fail(400, {
				action: 'resetPassword',
				error: `Password must be at least ${MIN_PASSWORD} characters.`,
			});
		}

		await getDb()
			.update(users)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(users.id, userId));
		return { action: 'resetPassword', ok: 'Password reset.' };
	},

	setToolAccess: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const toolKey = String(data.get('toolKey') ?? '');
		// 'grant' | 'revoke' | 'default'
		const mode = String(data.get('mode') ?? '');

		if (!TOOLS[toolKey]) return fail(400, { action: 'setToolAccess', error: 'Unknown tool.' });

		if (mode === 'default') await clearToolOverride(userId, toolKey);
		else if (mode === 'grant') await setToolOverride(userId, toolKey, true);
		else if (mode === 'revoke') await setToolOverride(userId, toolKey, false);
		else return fail(400, { action: 'setToolAccess', error: 'Invalid mode.' });

		return { action: 'setToolAccess', ok: 'Tool access updated.' };
	},

	setRoleToolAccess: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const role = String(data.get('role') ?? '');
		const toolKey = String(data.get('toolKey') ?? '');
		// 'grant' | 'revoke' | 'default'
		const mode = String(data.get('mode') ?? '');

		if (!isValidRole(role))
			return fail(400, { action: 'setRoleToolAccess', error: 'Invalid role.' });

		const isCapability = CAPABILITIES.some((c) => c.key === toolKey);
		if (!isCapability && !TOOLS[toolKey]) {
			return fail(400, { action: 'setRoleToolAccess', error: 'Unknown tool.' });
		}

		// Lockout safety: the built-in admin role always keeps the admin panel.
		if (toolKey === ADMIN_PANEL_CAPABILITY && role === 'admin' && mode === 'revoke') {
			return fail(400, {
				action: 'setRoleToolAccess',
				error: 'The admin role always has admin-panel access.',
			});
		}

		if (mode === 'default') await clearRoleOverride(role, toolKey);
		else if (mode === 'grant') await setRoleOverride(role, toolKey, true);
		else if (mode === 'revoke') await setRoleOverride(role, toolKey, false);
		else return fail(400, { action: 'setRoleToolAccess', error: 'Invalid mode.' });

		return { action: 'setRoleToolAccess', ok: 'Role access updated.' };
	},

	createProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '')
			.toLowerCase()
			.trim();
		const name = String(data.get('name') ?? '').trim();
		const rawClient = String(data.get('clientKey') ?? '').trim();
		const clientKey = rawClient === '' ? null : rawClient;
		const rawGameType = String(data.get('gameType') ?? '').trim();

		if (!isValidProjectKey(key)) {
			return fail(400, {
				action: 'createProject',
				error: 'Key must match a-z, 0-9, _ or - (max 64).',
			});
		}
		if (!name) return fail(400, { action: 'createProject', error: 'Name is required.' });
		// §21.6: validate against the SAME union the picker offers — built-ins + the
		// current custom kind ids (resolved server-side, never a client-only const).
		const known = new Set((await selectableGameKinds()).map((k) => k.id));
		if (rawGameType !== '' && !known.has(rawGameType)) {
			return fail(400, { action: 'createProject', error: 'Unknown game kind.' });
		}
		if (await projectExists(key)) {
			return fail(400, { action: 'createProject', error: 'A project with that key exists.' });
		}
		if (clientKey !== null && !(await clientExists(clientKey))) {
			return fail(400, { action: 'createProject', error: 'Unknown client.' });
		}

		await createProject(key, name, clientKey, rawGameType !== '' ? rawGameType : undefined);
		await scaffoldProject(clientKey ?? UNASSIGNED_CLIENT, key);
		return { action: 'createProject', ok: `Created project ${key}.` };
	},

	rescaffoldProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');

		if (!(await projectExists(key))) {
			return fail(400, { action: 'rescaffoldProject', error: 'Unknown project.' });
		}
		const clientKey = (await projectClientKey(key)) ?? UNASSIGNED_CLIENT;
		await scaffoldProject(clientKey, key);
		return { action: 'rescaffoldProject', ok: `Rescaffolded ${key}.` };
	},

	renameProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const name = String(data.get('name') ?? '').trim();

		if (!name) return fail(400, { action: 'renameProject', error: 'Name is required.' });
		if (!(await projectExists(key))) {
			return fail(400, { action: 'renameProject', error: 'Unknown project.' });
		}

		await renameProject(key, name);
		return { action: 'renameProject', ok: 'Project renamed.' };
	},

	setProjectGameType: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const gameType = String(data.get('gameType') ?? '').trim();

		if (!(await projectExists(key))) {
			return fail(400, { action: 'setProjectGameType', error: 'Unknown project.' });
		}
		// §21.6: accept any kind the picker offers — built-in or custom.
		const known = new Set((await selectableGameKinds()).map((k) => k.id));
		if (!known.has(gameType)) {
			return fail(400, { action: 'setProjectGameType', error: 'Unknown game kind.' });
		}

		await setProjectGameType(key, gameType);
		return { action: 'setProjectGameType', ok: `Set ${key} to ${gameType}.` };
	},

	deleteProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');

		if (key === DEFAULT_PROJECT_KEY) {
			return fail(400, {
				action: 'deleteProject',
				error: 'The default project cannot be deleted.',
			});
		}
		if (!(await projectExists(key))) {
			return fail(400, { action: 'deleteProject', error: 'Unknown project.' });
		}

		// Grants cascade; sessions pointing here reset to the default via ON DELETE SET NULL.
		await deleteProject(key);
		return { action: 'deleteProject', ok: 'Project deleted.' };
	},

	setProjectAccess: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const projectKey = String(data.get('projectKey') ?? '');
		const grant = data.get('grant') === 'true';

		if (!userId) return fail(400, { action: 'setProjectAccess', error: 'Missing user.' });
		if (!(await projectExists(projectKey))) {
			return fail(400, { action: 'setProjectAccess', error: 'Unknown project.' });
		}

		if (grant) await grantProjectAccess(userId, projectKey);
		else await revokeProjectAccess(userId, projectKey);
		return { action: 'setProjectAccess', ok: 'Project access updated.' };
	},

	createClient: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '')
			.toLowerCase()
			.trim();
		const name = String(data.get('name') ?? '').trim();

		if (!isValidClientKey(key)) {
			return fail(400, {
				action: 'createClient',
				error: 'Key must match a-z, 0-9, _ or - (max 64).',
			});
		}
		if (!name) return fail(400, { action: 'createClient', error: 'Name is required.' });
		if (await clientExists(key)) {
			return fail(400, { action: 'createClient', error: 'A client with that key exists.' });
		}

		await createClient(key, name);
		return { action: 'createClient', ok: `Created client ${key}.` };
	},

	renameClient: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const name = String(data.get('name') ?? '').trim();

		if (!name) return fail(400, { action: 'renameClient', error: 'Name is required.' });
		if (!(await clientExists(key))) {
			return fail(400, { action: 'renameClient', error: 'Unknown client.' });
		}

		await renameClient(key, name);
		return { action: 'renameClient', ok: 'Client renamed.' };
	},

	deleteClient: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');

		if (!(await clientExists(key))) {
			return fail(400, { action: 'deleteClient', error: 'Unknown client.' });
		}

		// Grants cascade; owned projects unassign via ON DELETE SET NULL.
		await deleteClient(key);
		return { action: 'deleteClient', ok: 'Client deleted.' };
	},

	assignProjectClient: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const projectKey = String(data.get('projectKey') ?? '');
		const raw = String(data.get('clientKey') ?? '');
		const clientKey = raw === '' ? null : raw;

		if (!(await projectExists(projectKey))) {
			return fail(400, { action: 'assignProjectClient', error: 'Unknown project.' });
		}
		if (clientKey !== null && !(await clientExists(clientKey))) {
			return fail(400, { action: 'assignProjectClient', error: 'Unknown client.' });
		}

		await assignProjectToClient(projectKey, clientKey);
		return { action: 'assignProjectClient', ok: 'Project client updated.' };
	},

	setClientAccess: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		const clientKey = String(data.get('clientKey') ?? '');
		const grant = data.get('grant') === 'true';

		if (!userId) return fail(400, { action: 'setClientAccess', error: 'Missing user.' });
		if (!(await clientExists(clientKey))) {
			return fail(400, { action: 'setClientAccess', error: 'Unknown client.' });
		}

		if (grant) await grantClientAccess(userId, clientKey);
		else await revokeClientAccess(userId, clientKey);
		return { action: 'setClientAccess', ok: 'Client access updated.' };
	},

	createGame: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '')
			.toLowerCase()
			.trim();
		const name = String(data.get('name') ?? '').trim();
		const url = String(data.get('url') ?? '').trim();
		const project = String(data.get('project') ?? '').trim();

		if (!isValidGameKey(key)) {
			return fail(400, {
				action: 'createGame',
				error: 'Key must match a-z, 0-9, _ or - (max 64).',
			});
		}
		if (!name) return fail(400, { action: 'createGame', error: 'Name is required.' });
		if (await gameExists(key)) {
			return fail(400, { action: 'createGame', error: 'A game with that key exists.' });
		}
		if (project && !(await projectExists(project))) {
			return fail(400, { action: 'createGame', error: 'Unknown project.' });
		}

		// Blank URL → auto-fill the conventional test-server launch URL for this key.
		const finalUrl = url || defaultGameUrl(key, ENV.GAMES_BASE_URL);
		await createGame(key, name, finalUrl, project || null);
		return {
			action: 'createGame',
			ok: url ? `Created game ${key}.` : `Created game ${key} with the default test-server URL.`,
		};
	},

	setGameProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const project = String(data.get('project') ?? '').trim();

		if (!(await gameExists(key))) {
			return fail(400, { action: 'setGameProject', error: 'Unknown game.' });
		}
		if (project && !(await projectExists(project))) {
			return fail(400, { action: 'setGameProject', error: 'Unknown project.' });
		}

		await setGameProject(key, project || null);
		return { action: 'setGameProject', ok: 'Game scope updated.' };
	},

	renameGame: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const name = String(data.get('name') ?? '').trim();

		if (!name) return fail(400, { action: 'renameGame', error: 'Name is required.' });
		if (!(await gameExists(key))) {
			return fail(400, { action: 'renameGame', error: 'Unknown game.' });
		}

		await renameGame(key, name);
		return { action: 'renameGame', ok: 'Game renamed.' };
	},

	setGameUrl: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		const url = String(data.get('url') ?? '').trim();

		if (!(await gameExists(key))) {
			return fail(400, { action: 'setGameUrl', error: 'Unknown game.' });
		}

		await setGameUrl(key, url);
		return { action: 'setGameUrl', ok: 'Game URL updated.' };
	},

	deleteGame: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');

		if (!(await gameExists(key))) {
			return fail(400, { action: 'deleteGame', error: 'Unknown game.' });
		}

		await deleteGame(key);
		return { action: 'deleteGame', ok: 'Game deleted.' };
	},

	revokeSession: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const sessionId = String(data.get('sessionId') ?? '');
		if (!sessionId) return fail(400, { action: 'revokeSession', error: 'Missing session.' });

		await getDb().delete(sessions).where(eq(sessions.id, sessionId));
		return { action: 'revokeSession', ok: 'Session revoked.' };
	},

	revokeAllSessions: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		if (!userId) return fail(400, { action: 'revokeAllSessions', error: 'Missing user.' });

		await getDb().delete(sessions).where(eq(sessions.userId, userId));
		return { action: 'revokeAllSessions', ok: 'All sessions revoked.' };
	},

	deleteUser: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');

		if (userId === admin.id) {
			return fail(400, { action: 'deleteUser', error: 'You cannot delete your own account.' });
		}
		if (await wouldRemoveLastAdmin(userId)) {
			return fail(400, { action: 'deleteUser', error: 'Cannot delete the last admin.' });
		}

		// sessions + tool_installs + user_tool_access cascade via FK ON DELETE CASCADE.
		await getDb().delete(users).where(eq(users.id, userId));
		return { action: 'deleteUser', ok: 'User deleted.' };
	},

	loadSessions: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const userId = String(data.get('userId') ?? '');
		if (!userId) return fail(400, { action: 'loadSessions', error: 'Missing user.' });

		const rows = await sessionsForUser(userId);
		return { action: 'loadSessions', userId, sessions: rows };
	},

	// --- Deploy token (shared build/publish token) ---
	// All three actions are admin-only (requireAdmin re-checks the adminPanel
	// capability). The secret is returned to the page ONLY by an explicit reveal/
	// set/rotate; it is never logged and the page serves it no differently than any
	// other form result (no-store handled by the admin route being uncacheable).

	/** Reveal the current effective deploy token once (admin-only). */
	revealDeployToken: async ({ locals }) => {
		await requireAdmin(locals);
		const token = await getDeployToken();
		if (!token) {
			return fail(404, { action: 'revealDeployToken', error: 'No deploy token is configured.' });
		}
		return { action: 'revealDeployToken', deployToken: token };
	},

	/** Set the deploy token to an admin-typed value (admin-only). */
	setDeployToken: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const token = String(data.get('token') ?? '').trim();

		if (token.length < MIN_DEPLOY_TOKEN) {
			return fail(400, {
				action: 'setDeployToken',
				error: `Token must be at least ${MIN_DEPLOY_TOKEN} characters.`,
			});
		}

		await setAppSetting(DEPLOY_TOKEN_KEY, token, admin.id);
		// Reveal the just-set value once so the admin can copy it; never logged.
		return { action: 'setDeployToken', ok: 'Deploy token saved.', deployToken: token };
	},

	/** Generate a strong random deploy token, save it, and reveal it once (admin-only). */
	rotateDeployToken: async ({ locals }) => {
		const admin = await requireAdmin(locals);
		const token = generateDeployToken();
		await setAppSetting(DEPLOY_TOKEN_KEY, token, admin.id);
		return { action: 'rotateDeployToken', ok: 'Deploy token rotated.', deployToken: token };
	},

	/**
	 * Purge the ENTIRE Cloudflare edge cache for the zone (admin-only) — a manual lever for a
	 * CF-proxied host (`games.invisiblewall.org`) suspected of serving stale files. Safe: game assets
	 * are `no-store` or content-hashed, so a purge only forces a re-fetch. NOTE: `app.invisiblewall.org`
	 * is DNS-only (not CF-cached), so this does NOT affect the launcher/tool pages — those refresh via
	 * their own content-hashing / the `?v=` build bust.
	 */
	purgeCache: async ({ locals }) => {
		await requireAdmin(locals);
		const result = await purgeEverything();
		if (result.skipped) {
			return fail(400, {
				action: 'purgeCache',
				error: `Cloudflare purge not configured on this service (${result.skipped}).`,
			});
		}
		if (!result.ok) {
			return fail(502, { action: 'purgeCache', error: result.error ?? 'Purge failed.' });
		}
		return { action: 'purgeCache', ok: 'Cloudflare edge cache purged for the whole zone.' };
	},
};
