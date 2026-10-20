import { error, isHttpError, type Cookies } from '@sveltejs/kit';
import type { CinematicHost } from 'engine-layout';
import { COMPONENT_PUBLISH_CAPABILITY, roleHasCapability } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { gate } from './toolScope';
import { getToolOverrides } from './userToolAccess';

/**
 * Who may touch which cinematic (`/api/cinematics/*`). Plan: `docs/design/rive-style-editor.md`
 * Phases 3 and 4.
 *
 * - **`rigger`** → every cinematic in the project (`full`) — the Rigger's 🎬 Cinematic mode, as
 *   before.
 * - **`editor`** without `rigger` → only the timelines whose `host` is a **screen** or a
 *   **component** (`hosted`) — the Scene Editor's Animate mode, on either side. It can list, open,
 *   save and delete those, and nothing else: a rig cinematic is never listed to it, never
 *   returned, never overwritten and never deleted.
 *
 * The rule is enforced HERE, server-side, never by the client filtering a list.
 */
export type CinematicAccess = 'full' | 'hosted';

export interface CinematicScope {
	clientKey: string;
	projectKey: string;
	access: CinematicAccess;
}

const FORBIDDEN = 'Your role does not have access to the Invisible Rigger or the Scene Editor.';

/** The session's project plus how much of its cinematics the caller may reach. */
export async function cinematicGate(locals: App.Locals, cookies: Cookies): Promise<CinematicScope> {
	try {
		const scope = await gate(locals, cookies, { tool: 'rigger', forbiddenMessage: FORBIDDEN });
		return { clientKey: scope.clientKey, projectKey: scope.projectKey, access: 'full' };
	} catch (e) {
		if (!isHttpError(e) || e.status !== 403) throw e;
	}
	const scope = await gate(locals, cookies, { tool: 'editor', forbiddenMessage: FORBIDDEN });
	return { clientKey: scope.clientKey, projectKey: scope.projectKey, access: 'hosted' };
}

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

/**
 * A timeline the Scene Editor authors: one that animates a screen (`host: {kind:'screen',
 * sceneId}`) or a component (`host: {kind:'component', componentId}`).
 */
export function isEditorHosted(doc: { host?: CinematicHost } | null | undefined): boolean {
	const host = doc?.host;
	if (host?.kind === 'screen') return nonEmpty(host.sceneId);
	if (host?.kind === 'component') return nonEmpty(host.componentId);
	return false;
}

/** May `access` reach `doc`? A missing or malformed doc (`null`) is reachable only with `full`. */
export function canReach(
	access: CinematicAccess,
	doc: { host?: CinematicHost } | null | undefined,
): boolean {
	return access === 'full' || isEditorHosted(doc);
}

/** 403 unless `access` may reach `doc`. */
export function assertReach(
	access: CinematicAccess,
	doc: { host?: CinematicHost } | null | undefined,
): void {
	if (!canReach(access, doc)) {
		throw error(
			403,
			'Only screen and component timelines can be opened from the Scene Editor — this one belongs to the Invisible Rigger.',
		);
	}
}

/** May this caller promote a timeline to the shared library (`_shared/cinematics/`)? The `componentPublish` capability. */
export async function canPublishSharedTimeline(locals: App.Locals): Promise<boolean> {
	const user = locals.user;
	if (!user) return false;
	const [roleOverrides, overrides] = await Promise.all([
		getRoleOverrides(user.role),
		getToolOverrides(user.id),
	]);
	return roleHasCapability(user.role, COMPONENT_PUBLISH_CAPABILITY, roleOverrides, overrides);
}
