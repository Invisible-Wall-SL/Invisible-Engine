import { error } from '@sveltejs/kit';
import type { output, ZodTypeAny } from 'zod';
import { roleHasCapability, roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * What the session-authed API routes share: the tool gate and reading a JSON body (the 409 for a
 * lost conditional write is `conflict.ts`). Desktop (bearer) routes gate through `launcherAuth.ts`;
 * routes scoped to the session's project gate through `toolScope.ts`'s `gate()`.
 */

type User = NonNullable<App.Locals['user']>;

/** A user's tool and capability grants, role and per-user overrides applied, read once. */
export interface Grants {
	hasTool(tool: string): boolean;
	hasCapability(key: string): boolean;
}

export async function userGrants(user: Pick<User, 'id' | 'role'>): Promise<Grants> {
	const [roleOverrides, userOverrides] = await Promise.all([
		getRoleOverrides(user.role),
		getToolOverrides(user.id),
	]);
	return {
		hasTool: (tool) => roleHasTool(user.role, tool, roleOverrides, userOverrides),
		hasCapability: (key) => roleHasCapability(user.role, key, roleOverrides, userOverrides),
	};
}

/**
 * {@link requireTool}, also handing back the grants it read, for a route that checks a capability
 * or a second tool after the gate.
 */
export async function requireToolGrants(
	locals: App.Locals,
	tools: string | readonly string[],
	label: string,
): Promise<{ user: User; grants: Grants }> {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');
	const grants = await userGrants(user);
	const any = typeof tools === 'string' ? [tools] : tools;
	if (!any.some((tool) => grants.hasTool(tool))) {
		throw error(403, `Your role does not have access to ${label}.`);
	}
	return { user, grants };
}

/**
 * The entitlement gate of a session-authed tool endpoint: 401 without a session, 403 (`Your role
 * does not have access to <label>.`) unless the user holds `tools` — any one of them, when it is a
 * list. Returns the signed-in user. The tool grant is not a project grant: a route that takes its
 * project from the request still checks it (`requireProjectScope`).
 */
export async function requireTool(
	locals: App.Locals,
	tools: string | readonly string[],
	label: string,
): Promise<User> {
	return (await requireToolGrants(locals, tools, label)).user;
}

/** The parsed JSON body; a 400 with `message` when the body is not JSON. */
export async function readJson(
	request: Request,
	message = 'Expected a JSON body.',
): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw error(400, message);
	}
}

/** `v` when it is a plain object (not `null`, not an array), else `null`. */
export function objectOrNull(v: unknown): Record<string, unknown> | null {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

/** A JSON object body; a 400 when the body is not JSON or not an object. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
	const body = objectOrNull(await readJson(request));
	if (!body) throw error(400, 'Expected a JSON object.');
	return body;
}

/**
 * A JSON object body, or `null` when the body is not JSON or not an object — for a route that
 * answers a missing body with its own refusal.
 */
export async function jsonObjectOrNull(request: Request): Promise<Record<string, unknown> | null> {
	return objectOrNull(await request.json().catch(() => null));
}

/**
 * The body parsed by `schema`: a 400 when it is not JSON, or with the first issue's message when
 * the schema refuses it — so give each field the message its refusal should read.
 */
export async function parseBody<S extends ZodTypeAny>(
	request: Request,
	schema: S,
): Promise<output<S>> {
	const parsed = schema.safeParse(await readJson(request));
	if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? 'Invalid request body.');
	return parsed.data;
}
