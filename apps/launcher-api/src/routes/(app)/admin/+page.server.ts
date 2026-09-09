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
import { getEngineBootSplash, setEngineBootSplash } from '$lib/server/bootSplash';
import { loadSharedSkeletonIndex } from '$lib/server/spine';
import { PromoteError, promoteSpineToShared } from '$lib/server/sharedSpinePromote';
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
	listDeletedProjects,
	listProjects,
	projectAccessFor,
	projectClientKey,
	projectExists,
	projectIsDeleted,
	projectKeyTaken,
	renameProject,
	restoreProject,
	revokeProjectAccess,
	setProjectGameType,
	softDeleteProject,
} from '$lib/server/projects';
import { PurgeUnsafeError, purgeProjectR2 } from '$lib/server/projectPurge';
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
import {
	DEPLOY_TOKEN_KEY,
	RUNPOD_IDLE_ENABLED_KEY,
	RUNPOD_IDLE_MINUTES_DEFAULT,
	RUNPOD_IDLE_MINUTES_KEY,
	RUNPOD_PODS_KEY,
	getDeployToken,
	getRunpodIdleConfig,
	getRunpodPods,
	setAppSetting,
} from '$lib/server/appSettings';
import { getEffectiveFleet, podControlConfigured, podStop, probeFleet } from '$lib/server/runpod';
import {
	LAYOUT_PROFILE_DEFAULT_KEY,
	getGlobalLayoutProfile,
	setGlobalLayoutProfile,
} from '$lib/server/layoutProfile';
import { DEFAULT_LAYOUT_PROFILE } from 'engine-layout';
import { getCosts, invalidateCosts } from '$lib/server/costs';
import { parseCostImport } from '$lib/server/costs/importMonths';
import { importMonths, setMonthEur, setMonthUsd, TOTAL_KEY } from '$lib/server/costs/months';
import type { ProviderId } from '$lib/server/costs/types';
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

/** Providers the cost ledger accepts — mirrors `ProviderId` in `$lib/server/costs/types`. */
const COST_PROVIDERS: ProviderId[] = ['runpod', 'railway', 'r2', 'openai', 'anthropic'];

function isCostProvider(value: string): value is ProviderId {
	return (COST_PROVIDERS as string[]).includes(value);
}

export const load: PageServerLoad = async ({ locals }) => {
	await requireAdmin(locals);

	const userList = await listUsers();
	const overrides = await getToolOverridesFor(userList.map((u) => u.id));
	const roleOverrides = await getAllRoleOverrides();
	const projects = await listProjects();
	// Soft-deleted projects, shown in their own section so a delete is visibly
	// reversible and the permanent purge lives somewhere separate from the row grid.
	const deletedProjects = await listDeletedProjects();
	const projectAccess = await projectAccessFor(userList.map((u) => u.id));
	const clients = await listClients();
	const clientAccess = await clientAccessFor(userList.map((u) => u.id));
	const games = await listGames();
	const gameKinds = await selectableGameKinds();

	// Deploy-token status only — the raw secret is NEVER sent on load; it is masked
	// by default and revealed only on demand via the reveal/set/rotate actions.
	const deployToken = await getDeployToken();

	// The pipeline-wide layout-profile default (bucket set + selection rules) an admin
	// authors here. Non-secret — safe to send in full. `custom` distinguishes an
	// admin-set default from the coded fallback.
	const globalLayoutProfile = await getGlobalLayoutProfile();

	// The ENGINE boot mark (first pre-game splash, every game). Non-secret. The picker offers the
	// shared spine library — `_shared/spines/` only, because this mark is deliberately global and
	// must not be satisfiable by a per-project bundle. An empty list means nothing has been
	// published there yet, which the UI says explicitly rather than rendering an empty dropdown.
	const bootSplashEngine = await getEngineBootSplash();
	// The FULL index entry, not just a label: the live preview loads the skeleton client-side
	// through `/spine/file`, which addresses a bundle by `dir_b64` + the two filenames.
	const sharedSpineBundles = (await loadSharedSkeletonIndex()).map((e) => ({
		folder: e.folder,
		name: e.name || e.folder,
		dir_b64: e.dir_b64,
		skeleton_file: e.skeleton_file,
		atlas_file: e.atlas_file,
		format: e.format,
	}));

	// ComfyUI R&D pod FLEET (RunPod): the admin-editable pod list + idle config + a live
	// per-pod status readout. The fleet is probed only when pod control is configured
	// (key present + non-empty fleet). Best-effort: the RunPod helpers are fail-safe, so
	// a hiccup just shows 'unknown'. `storedPods` is the raw `runpodPods` list the editor
	// binds to (empty when a legacy single-pod env is in use).
	const runpodConfigured = await podControlConfigured();
	const runpodIdle = await getRunpodIdleConfig();
	const runpodStored = await getRunpodPods();
	const runpodPods = runpodConfigured ? await probeFleet() : [];

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
		deletedProjects,
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
		bootSplash: {
			engine: bootSplashEngine ?? null,
			bundles: sharedSpineBundles,
		},
		layoutProfile: {
			// The effective default sent to the editor: the admin-set one, else the coded default.
			profile: globalLayoutProfile ?? DEFAULT_LAYOUT_PROFILE,
			custom: !!globalLayoutProfile,
		},
		// Pipeline running costs. Deliberately NOT awaited — SvelteKit streams the
		// promise, so the admin page renders immediately and the Costs cards fill in
		// when the four provider APIs answer. Awaiting here would put up to a 20s
		// worst-case network wait in front of user management. `getCosts` never
		// rejects (every collector degrades to a card), so the stream can't error out.
		costs: getCosts(),
		costProviders: COST_PROVIDERS,
		runpod: {
			configured: runpodConfigured,
			idleEnabled: runpodIdle.enabled,
			idleMinutes: runpodIdle.minutes,
			idleDefaultMinutes: RUNPOD_IDLE_MINUTES_DEFAULT,
			// The raw admin-managed fleet the editor binds to (may be empty under legacy env).
			storedPods: runpodStored,
			// Live per-pod status readout across the effective fleet.
			pods: runpodPods.map((p) => ({
				id: p.id,
				label: p.label,
				status: p.status,
				ready: p.ready,
			})),
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
		// A tombstoned key is still a primary key, so inserting over it would 500. Name the
		// real reason and the two ways out instead.
		if (await projectKeyTaken(key)) {
			return fail(400, {
				action: 'createProject',
				error: `"${key}" is a deleted project. Restore it, or purge it to free the key.`,
			});
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

		// SOFT delete. The row, its read token and every R2 object survive; the project
		// simply leaves every picker until it is restored or explicitly purged. Its games
		// are unregistered (they cannot work without it) and any session parked on it
		// drops back to the default.
		const unregistered = await softDeleteProject(key, new Date());
		const games = unregistered.length
			? ` Unregistered ${unregistered.length} game${unregistered.length === 1 ? '' : 's'}: ${unregistered.join(', ')}.`
			: '';
		return {
			action: 'deleteProject',
			ok: `Deleted ${key}. Its files are untouched — restore it below, or purge them permanently.${games}`,
		};
	},

	restoreProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');

		// Tombstoned specifically — "restoring" a live project would report success on
		// a no-op and read as though something had been recovered.
		if (!(await projectIsDeleted(key))) {
			return fail(400, { action: 'restoreProject', error: 'That project is not deleted.' });
		}
		await restoreProject(key);
		return {
			action: 'restoreProject',
			ok: `Restored ${key}. Its games were not re-registered — re-publish if you need them.`,
		};
	},

	/**
	 * The ONLY destructive path: erases every R2 object the project owns, then drops
	 * the row for good. Reachable only for an ALREADY soft-deleted project, so it can
	 * never be the button someone hits by accident on a live one.
	 */
	purgeProject: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const key = String(data.get('key') ?? '');
		// The typed guard is enforced server-side too — a client-side-only guard is
		// decoration, and this action is unrecoverable.
		const typed = String(data.get('confirmKey') ?? '');

		if (key === DEFAULT_PROJECT_KEY) {
			return fail(400, { action: 'purgeProject', error: 'The default project cannot be purged.' });
		}
		if (typed !== key) {
			return fail(400, {
				action: 'purgeProject',
				error: `Type the project key exactly ("${key}") to purge it.`,
			});
		}
		if (!(await projectIsDeleted(key))) {
			return fail(400, {
				action: 'purgeProject',
				error: 'Only a deleted project can be purged. Delete it first.',
			});
		}

		let purged: { roots: string[]; deleted: number };
		try {
			// Resolves the owning client itself and re-runs BOTH refusal checks against
			// the roots it is about to delete — the dialog's preflight may be minutes old.
			purged = await purgeProjectR2(key);
		} catch (e) {
			if (e instanceof PurgeUnsafeError) {
				return fail(400, { action: 'purgeProject', error: e.message });
			}
			throw e;
		}
		await deleteProject(key);
		return {
			action: 'purgeProject',
			ok: `Purged ${key}: ${purged.deleted} file${purged.deleted === 1 ? '' : 's'} deleted from ${purged.roots.join(' and ')}. This cannot be undone.`,
		};
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
	 * Copy a PROJECT's spine bundle into the shared library so it can be used as the engine boot
	 * mark (admin-only). Body: `project`, `bundle`.
	 *
	 * This is the only writer of `_shared/spines/`. Without it the engine tier is unfillable:
	 * every producer (the Rigger above all) writes project-scoped bundles, and `_shared/rigs/`
	 * holds skeleton docs with no atlas or pages — not something a game can load.
	 */
	promoteSpine: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const projectKey = String(data.get('project') ?? '').trim();
		const bundle = String(data.get('bundle') ?? '').trim();
		if (!projectKey || !bundle) {
			return fail(400, { action: 'promoteSpine', error: 'Pick a project and a bundle.' });
		}
		const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
		try {
			const { entry, files, replaced } = await promoteSpineToShared(clientKey, projectKey, bundle);
			return {
				action: 'promoteSpine',
				ok:
					`${replaced ? 'Replaced' : 'Added'} "${entry.folder}" in the shared library ` +
					`(${files} files). Pick it above to make it the engine mark.`,
			};
		} catch (err) {
			if (err instanceof PromoteError) {
				return fail(400, { action: 'promoteSpine', error: err.message });
			}
			throw err;
		}
	},

	/**
	 * Set (or CLEAR) the global engine boot mark — the spine that opens every game (admin-only).
	 * Submitting a blank `bundle` clears it, which is why there is no separate reset action: an
	 * unusable ref and an absent one are the same state by contract (`normalizeBootSplashRef`).
	 *
	 * The new mark reaches a game on its next deploy export — a publish, or the next live runtime
	 * assemble — because `deploy/_boot/` is written there. It is NOT retroactive to an already
	 * loaded page.
	 */
	saveBootSplash: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const ref = await setEngineBootSplash(
			{
				bundle: String(data.get('bundle') ?? ''),
				animation: String(data.get('animation') ?? ''),
				background: String(data.get('background') ?? ''),
				size: data.get('size'),
			},
			admin.id,
		);
		return {
			action: 'saveBootSplash',
			ok: ref
				? `Engine boot mark set to "${ref.bundle}". Games pick it up on their next publish.`
				: 'Engine boot mark cleared — games will open on their own splash.',
		};
	},

	/** Save the pipeline-wide default layout profile (admin-only). Body: JSON `profile`. */
	saveLayoutProfile: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		let input: unknown;
		try {
			input = JSON.parse(String(data.get('profile') ?? ''));
		} catch {
			return fail(400, { action: 'saveLayoutProfile', error: 'Malformed profile payload.' });
		}
		try {
			await setGlobalLayoutProfile(input, admin.id);
		} catch (err) {
			return fail(400, {
				action: 'saveLayoutProfile',
				error: err instanceof Error ? err.message : 'Invalid layout profile.',
			});
		}
		return { action: 'saveLayoutProfile', ok: 'Layout default saved for the whole pipeline.' };
	},

	/** Clear the pipeline-wide default, reverting to the coded DEFAULT_LAYOUT_PROFILE. */
	resetLayoutProfile: async ({ locals }) => {
		const admin = await requireAdmin(locals);
		await setAppSetting(LAYOUT_PROFILE_DEFAULT_KEY, '', admin.id);
		return { action: 'resetLayoutProfile', ok: 'Reverted to the built-in layout default.' };
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

	// --- ComfyUI R&D pod (RunPod) ---

	/** Save the idle auto-stop config (enabled toggle + idle minutes). */
	setRunpodIdle: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const enabled = data.get('enabled') === 'true' || data.get('enabled') === 'on';
		const minutes = Number(String(data.get('minutes') ?? ''));

		if (!Number.isFinite(minutes) || minutes < 1) {
			return fail(400, { action: 'setRunpodIdle', error: 'Idle minutes must be a number ≥ 1.' });
		}

		await setAppSetting(RUNPOD_IDLE_ENABLED_KEY, enabled ? '1' : '0', admin.id);
		await setAppSetting(RUNPOD_IDLE_MINUTES_KEY, String(Math.floor(minutes)), admin.id);
		return { action: 'setRunpodIdle', ok: 'Idle auto-stop settings saved.' };
	},

	/**
	 * Save the pod fleet. Body carries parallel `podId[]` + `podLabel[]` arrays (one per
	 * editor row); blank ids are dropped and a blank label defaults to the id. Persisted
	 * as `app_settings.runpodPods` JSON `[{id,label}, …]`.
	 */
	setRunpodPods: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const ids = data.getAll('podId').map((v) => String(v).trim());
		const labels = data.getAll('podLabel').map((v) => String(v).trim());

		const seen = new Set<string>();
		const pods: { id: string; label: string }[] = [];
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if (!id || seen.has(id)) continue;
			seen.add(id);
			pods.push({ id, label: labels[i] || id });
		}

		await setAppSetting(RUNPOD_PODS_KEY, JSON.stringify(pods), admin.id);
		return { action: 'setRunpodPods', ok: `Saved ${pods.length} pod(s).` };
	},

	/** Manually STOP a specific pod (admin lever, independent of the artist-facing card). */
	stopRunpodPod: async ({ request, locals }) => {
		await requireAdmin(locals);
		const data = await request.formData();
		const podId = String(data.get('podId') ?? '').trim();
		if (!podId) return fail(400, { action: 'stopRunpodPod', error: 'Missing pod.' });

		const fleet = await getEffectiveFleet();
		if (!fleet.some((p) => p.id === podId)) {
			return fail(400, { action: 'stopRunpodPod', error: 'Unknown pod.' });
		}

		await podStop(podId);
		return { action: 'stopRunpodPod', ok: 'Pod stop requested.' };
	},

	/** Re-poll every provider now, bypassing the 10-minute snapshot cache. */
	refreshCosts: async ({ locals }) => {
		await requireAdmin(locals);
		invalidateCosts();
		return { action: 'refreshCosts', ok: 'Re-reading provider costs…' };
	},

	/**
	 * Record what the bank ACTUALLY charged for one provider-month, in euros.
	 *
	 * This is the authoritative figure: the USD column is an estimate assembled from
	 * provider APIs, while this is the real debit — card FX spread means it will never
	 * exactly match a converted total, and for Spanish taxation the real debit is the
	 * number that counts. An empty value clears it.
	 */
	setCostMonthEur: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const provider = String(data.get('provider') ?? '').trim();
		const year = Number(String(data.get('year') ?? ''));
		const month = Number(String(data.get('month') ?? ''));
		const raw = String(data.get('eur') ?? '').trim();

		// `total` is the reserved month-level key — the euro figure is what the bank
		// charged for the month as a whole, not per provider.
		if (provider !== TOTAL_KEY && !isCostProvider(provider)) {
			return fail(400, { action: 'setCostMonthEur', error: 'Unknown provider.' });
		}
		if (!Number.isInteger(year) || !Number.isInteger(month)) {
			return fail(400, { action: 'setCostMonthEur', error: 'Bad month.' });
		}
		// Accept both `1.234,56` (Spanish) and `1,234.56` (English) — an admin typing
		// a figure off a Spanish bank statement should not have to reformat it.
		let eur: number | null = null;
		if (raw) {
			const normalized =
				raw.lastIndexOf(',') > raw.lastIndexOf('.')
					? raw.replace(/\./g, '').replace(',', '.')
					: raw.replace(/,/g, '');
			eur = Number(normalized.replace(/[€\s]/g, ''));
			if (!Number.isFinite(eur)) {
				return fail(400, { action: 'setCostMonthEur', error: 'Enter a number, e.g. 128,40' });
			}
		}

		const result = await setMonthEur({
			provider: provider as ProviderId | typeof TOTAL_KEY,
			year,
			month,
			eur,
			userId: admin.id,
		});
		if (!result.ok) return fail(400, { action: 'setCostMonthEur', error: result.error });

		invalidateCosts();
		return { action: 'setCostMonthEur', ok: 'Saved.' };
	},

	/**
	 * Hand-enter a provider's USD for one month — the escape hatch for RunPod and
	 * Railway, which cannot report a period total, and would otherwise leave the
	 * month total silently under-counting the two costs that matter most.
	 */
	setCostMonthUsd: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const provider = String(data.get('provider') ?? '').trim();
		const year = Number(String(data.get('year') ?? ''));
		const month = Number(String(data.get('month') ?? ''));
		const raw = String(data.get('usd') ?? '').trim();

		if (!isCostProvider(provider)) {
			return fail(400, { action: 'setCostMonthUsd', error: 'Unknown provider.' });
		}
		if (!Number.isInteger(year) || !Number.isInteger(month)) {
			return fail(400, { action: 'setCostMonthUsd', error: 'Bad month.' });
		}
		// Empty clears the override and hands the cell back to the estimator.
		let usd: number | null = null;
		if (raw) {
			usd = Number(raw.replace(/[$,\s]/g, ''));
			if (!Number.isFinite(usd)) {
				return fail(400, { action: 'setCostMonthUsd', error: 'Enter a number, e.g. 58.20' });
			}
		}

		const result = await setMonthUsd({ provider, year, month, usd, userId: admin.id });
		if (!result.ok) return fail(400, { action: 'setCostMonthUsd', error: result.error });

		invalidateCosts();
		return { action: 'setCostMonthUsd', ok: 'Saved.' };
	},

	/**
	 * Import historical spend from a pasted block.
	 *
	 * Two-phase on purpose: the first submit PARSES and returns a preview, and only a
	 * second submit with `confirm` writes. A paste is easy to get subtly wrong (a
	 * column in the wrong order, a comma read as a decimal point), and this is the one
	 * path that writes many months at once — so the numbers get looked at before they
	 * land, rather than being discovered wrong later in a year total.
	 */
	importCostMonths: async ({ request, locals }) => {
		const admin = await requireAdmin(locals);
		const data = await request.formData();
		const text = String(data.get('text') ?? '');
		const confirmed = String(data.get('confirm') ?? '') === '1';

		if (!text.trim()) {
			return fail(400, { action: 'importCostMonths', error: 'Paste some rows first.' });
		}

		const { rows, errors } = parseCostImport(text);

		if (!confirmed) {
			return {
				action: 'importCostMonths',
				preview: rows.map((r) => ({
					provider: r.provider,
					year: r.year,
					month: r.month,
					usd: r.usd,
				})),
				parseErrors: errors,
				text,
			};
		}

		if (rows.length === 0) {
			return fail(400, {
				action: 'importCostMonths',
				error: 'Nothing to import — no line could be read.',
				parseErrors: errors,
			});
		}

		const written = await importMonths(rows, admin.id);
		invalidateCosts();
		return {
			action: 'importCostMonths',
			ok: `Imported ${written} month${written === 1 ? '' : 's'}.`,
			parseErrors: errors,
		};
	},
};
