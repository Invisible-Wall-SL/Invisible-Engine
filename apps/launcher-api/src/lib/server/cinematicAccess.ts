import { error, isHttpError, type Cookies } from '@sveltejs/kit';
import type { CinematicHost } from 'engine-layout';
import { gate } from './toolScope';

/**
 * Who may touch which cinematic (`/api/cinematics/*`). Plan: `docs/design/rive-style-editor.md`
 * Phase 3.
 *
 * - **`rigger`** → every cinematic in the project (`full`) — the Rigger's 🎬 Cinematic mode, as
 *   before.
 * - **`editor`** without `rigger` → only the timelines whose `host` is a **screen** (`screen`) —
 *   the Scene Editor's Animate mode. It can list, open, save and delete those, and nothing else: a
 *   rig cinematic is never listed to it, never returned, never overwritten and never deleted.
 *
 * The rule is enforced HERE, server-side, never by the client filtering a list.
 */
export type CinematicAccess = 'full' | 'screen';

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
	return { clientKey: scope.clientKey, projectKey: scope.projectKey, access: 'screen' };
}

/** A timeline that animates a Scene Editor screen (`host: {kind:'screen', sceneId}`). */
export function isScreenHosted(doc: { host?: CinematicHost } | null | undefined): boolean {
	const host = doc?.host;
	return host?.kind === 'screen' && typeof host.sceneId === 'string' && host.sceneId.length > 0;
}

/** May `access` reach `doc`? A missing or malformed doc (`null`) is reachable only with `full`. */
export function canReach(
	access: CinematicAccess,
	doc: { host?: CinematicHost } | null | undefined,
): boolean {
	return access === 'full' || isScreenHosted(doc);
}

/** 403 unless `access` may reach `doc`. */
export function assertReach(
	access: CinematicAccess,
	doc: { host?: CinematicHost } | null | undefined,
): void {
	if (!canReach(access, doc)) {
		throw error(
			403,
			'Only screen timelines can be opened from the Scene Editor — this one belongs to the Invisible Rigger.',
		);
	}
}
