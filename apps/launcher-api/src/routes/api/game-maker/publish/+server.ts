import { json } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability } from '$lib/roles';
import { SESSION_COOKIE, setActiveProjectKey } from '$lib/server/auth';
import { DEFAULT_PROJECT_KEY, projectExists } from '$lib/server/projects';
import { PublishBlockedError, publishGame } from '$lib/server/publishGame';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Server-side Publish for the Invisible Game Maker page (Phase 1). Cookie-authed
 * (the page is in the authed `(app)` area); gated like `/admin` via the
 * `adminPanel` capability — Phase 1 keeps publish an admin operation. Body:
 * `{ project: string }`. On success returns the playable game URL.
 *
 *   POST /api/game-maker/publish   { "project": "<key>", "allowUnapproved"?: true }
 *   → 200 { ok, key, url, playUrl, sounds }
 *   → 409 { error, reason, details }   — blocked; `unapproved-sounds` is overridable
 */
export const POST: RequestHandler = async ({ request, locals, url, cookies }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides, overrides)) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let body: { project?: unknown; allowUnapproved?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const project = typeof body.project === 'string' ? body.project.trim() : '';
	if (!project) return json({ error: 'Missing project' }, { status: 400, headers: NO_STORE });
	if (!(await projectExists(project))) {
		return json({ error: 'Unknown project' }, { status: 400, headers: NO_STORE });
	}

	// The explicit "ship it anyway" for a sound the game plays that nobody has approved. Only ever
	// set by an author answering the refusal below — never a default, or the gate would be decorative.
	const allowUnapproved = body.allowUnapproved === true;

	try {
		// The runtime fetches its authoring data back from THIS launcher's origin.
		const result = await publishGame(project, url.origin, { allowUnapproved });
		// Pin the session's active project to the one just published — publishing is an
		// EXPLICIT action on a specific project, so the whole UI (top bar + home selector)
		// should now agree on it. Without this the active scope keeps whatever it drifted
		// to while browsing Game Maker's cross-client project list, so rebuilding project Y
		// left the selection sitting on a DIFFERENT client. Mirror the selector's storage
		// rule: the default project is stored as null so an unset session resolves to it.
		await setActiveProjectKey(
			cookies.get(SESSION_COOKIE),
			project === DEFAULT_PROJECT_KEY ? null : project,
		);
		return json({ ok: true, ...result }, { headers: NO_STORE });
	} catch (e) {
		// A blocked publish (e.g. a game with its own desktop build) is a 409 with the
		// explanation, so the UI tells the user WHY instead of a generic failure.
		if (e instanceof PublishBlockedError) {
			// `reason` + `details` so the UI can tell an overridable refusal (unapproved sounds) from a
			// final one (a game with its own desktop build, which overwriting would destroy) — and can
			// list the sounds instead of saying "something".
			return json(
				{ error: e.message, reason: e.reason, details: e.details },
				{ status: 409, headers: NO_STORE },
			);
		}
		console.error('publishGame failed:', e);
		// Surface the underlying reason to the UI. The route body is `{ error }` (the
		// Game Maker page reads `out.error`), whereas SvelteKit's `error()` helper emits
		// `{ message }` — so throwing it would leave the UI showing only "Publish failed
		// (502)" with the real cause stranded in the server logs. Publishing is admin-only,
		// so exposing the detail here is safe.
		const detail = e instanceof Error ? e.message : String(e);
		return json({ error: `Publish failed: ${detail}` }, { status: 502, headers: NO_STORE });
	}
};
