import { GAME_PUBLISH_CAPABILITY, roleHasCapability, type Role, type ToolOverrides } from './roles';

/**
 * The authorization DECISION behind the desktop-facing launcher endpoints, kept
 * dependency-free (its only import is `roles.ts`, which is itself pure) so it can be
 * asserted offline by `launcherGates.fixture.ts`. The IO half — parse the bearer token,
 * validate the session, read the override rows — lives in `$lib/server/launcherAuth.ts`.
 *
 * This app's `build` is a bare `vite build` that strips types without checking them, so a
 * green build proves nothing about a gate (see `apps/launcher-api/CLAUDE.md` §Validate).
 * A gate that silently stops refusing is the one bug here nobody would notice, hence the
 * split: the decision is a pure function with a fixture, not a line inside a handler.
 */

/**
 * Which rule an endpoint is gated by. The two are NOT interchangeable:
 *
 * - `publish` — the `gamePublish` capability ("Build & publish games"). Delegable: an admin
 *   grants it per role or per user in /admin, and the grant must actually reach the endpoint.
 *   Every step of a game publish is gated this way, so granting the capability is enough to
 *   make a publisher work end to end.
 * - `owner` — the literal `admin` role, deliberately NOT delegable through the capability
 *   matrix. Reserved for endpoints that hand out machine-level secrets or drive the owner's
 *   own GPU box (tunnel credentials, ComfyUI model/node downloads); there is no capability
 *   to grant because there is nobody else to grant it to.
 */
export type LauncherGate = 'owner' | 'publish';

/** The role that `owner`-gated endpoints require, by role and not by capability. */
export const OWNER_ROLE: Role = 'admin';

/** A refusal: the HTTP status plus the body the launcher endpoints answer with. */
export interface GateDenial {
	status: 401 | 403;
	error: string;
}

/** `Authorization: Bearer <token>` → the token, or undefined when the header is absent/malformed. */
export function bearerToken(header: string | null): string | undefined {
	if (!header) return undefined;
	return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
}

/**
 * A request with no valid session. Shared rather than re-spelled at each endpoint so "no
 * session is a 401, never a 403" is one fact: a 403 would tell an anonymous caller that the
 * endpoint exists and that some role reaches it.
 */
export const NO_SESSION_DENIAL: GateDenial = { status: 401, error: 'Unauthorized' };

/**
 * Why the request must be refused, or `null` when it may proceed. A `null` role (no valid
 * session) is the 401 above; a role that fails the gate is a 403.
 */
export function launcherGateDenial(
	role: Role | null,
	gate: LauncherGate,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): GateDenial | null {
	if (!role) return NO_SESSION_DENIAL;
	const allowed =
		gate === 'owner'
			? role === OWNER_ROLE
			: roleHasCapability(role, GAME_PUBLISH_CAPABILITY, roleOverrides, userOverrides);
	return allowed ? null : { status: 403, error: 'Forbidden' };
}
