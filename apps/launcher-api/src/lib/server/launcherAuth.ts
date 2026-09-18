import { json } from '@sveltejs/kit';
import {
	bearerToken,
	launcherGateDenial,
	NO_SESSION_DENIAL,
	type GateDenial,
	type LauncherGate,
} from '$lib/launcherGates';
import { roleHasCapability, type ToolOverrides } from '$lib/roles';
import { validateSession, type SessionUser } from './auth';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The one gate for the desktop-facing launcher endpoints. Six of them carried their own
 * copy of "parse `Authorization: Bearer`, validate the session, compare a hard-coded role
 * string" (`comfyui-nodes`, `models-manifest`, `projects`, `register-game`, `tunnel-bundle`,
 * `game-upload`) — the helper `docs/status/launcher.md` §Open items 3 records as owed.
 *
 * The copies were not merely repetitive, they were WRONG for the publish chain: comparing
 * `user.role !== 'admin'` means no grant in /admin can ever reach the endpoint, so
 * `gamePublish` ("Build & publish games") opened the deploy token and then the very next
 * call in the publish refused the publisher. Going through here makes the capability the
 * gate, once.
 */

const NO_STORE = { 'cache-control': 'no-store' };

/** The authenticated caller, or the response to return unchanged. */
export type LauncherAuth = { ok: true; user: SessionUser } | { ok: false; response: Response };

function refuse(denial: GateDenial): LauncherAuth {
	return {
		ok: false,
		response: json({ error: denial.error }, { status: denial.status, headers: NO_STORE }),
	};
}

async function requireLauncherGate(request: Request, gate: LauncherGate): Promise<LauncherAuth> {
	const user = await validateSession(bearerToken(request.headers.get('authorization')));
	// Returned early rather than via `launcherGateDenial(null, …)` so `user` narrows below;
	// it is the same constant that function answers a session-less request with.
	if (!user) return refuse(NO_SESSION_DENIAL);

	// Only a capability gate consults the override matrix; an `owner` gate is the role
	// itself, so it would be two DB round-trips for an answer it cannot use.
	let roleOverrides: ToolOverrides = {};
	let userOverrides: ToolOverrides = {};
	if (gate !== 'owner') {
		[roleOverrides, userOverrides] = await Promise.all([
			getRoleOverrides(user.role),
			getToolOverrides(user.id),
		]);
	}

	const denial = launcherGateDenial(user.role, gate, roleOverrides, userOverrides);
	return denial ? refuse(denial) : { ok: true, user };
}

/**
 * Bearer-auth + the literal `admin` role. For endpoints that are owner-only by nature
 * (machine secrets, the owner's local GPU box) rather than by phase — see `LauncherGate`.
 */
export function requireLauncherAdmin(request: Request): Promise<LauncherAuth> {
	return requireLauncherGate(request, 'owner');
}

/**
 * Bearer-auth + the `gamePublish` capability. Every step of a game publish uses this, so
 * granting the capability in /admin → Roles is all it takes to make a publisher work.
 */
export function requireLauncherPublisher(request: Request): Promise<LauncherAuth> {
	return requireLauncherGate(request, 'publish');
}

/**
 * The same capability resolution for a COOKIE-authed page route, where the session is
 * already on `locals` and only the override fan-out is left to do.
 */
export async function userHasCapability(user: SessionUser, key: string): Promise<boolean> {
	const [roleOverrides, userOverrides] = await Promise.all([
		getRoleOverrides(user.role),
		getToolOverrides(user.id),
	]);
	return roleHasCapability(user.role, key, roleOverrides, userOverrides);
}
