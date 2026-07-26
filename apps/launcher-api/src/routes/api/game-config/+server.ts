import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import {
	ConflictError,
	InvalidGameConfigError,
	loadGameConfigDocWithEtag,
	saveGameConfigDoc,
} from '$lib/server/gameConfigStorage';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { jsonBaseEtag } from '$lib/server/r2';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Game Config (`/config`) doc.
 *
 * Session-gated (logged-in + entitled to the `gameConfig` tool, role + per-user overrides applied)
 * — the SAME entitlement gate the `/config` page uses, NOT the deploy-token gate (that is the
 * sibling `doc` route, for the build-time bake). REST rather than form actions because the client
 * is a rich `$state` doc, mirroring `/api/win-text`.
 *
 * See `docs/design/invisible-game-config.md`.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Game Config.');
	}
}

async function resolveScope(
	project: string | null,
): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

/** Read a project's AUTHORED config + its ETag. `doc` is null for a never-authored project — the
 *  page then shows the template default it loaded separately. The ETag is the precondition the
 *  client sends back on save. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
	try {
		const { doc, etag } = await loadGameConfigDocWithEtag(clientKey, projectKey);
		return json({ clientKey, projectKey, doc, etag });
	} catch {
		throw error(502, 'Failed to load the game-config document.');
	}
};

/**
 * Validate + persist a project's config doc to R2.
 *
 * Body: `{ doc, baseEtag?, force? }` — mirrors `/api/win-text`. `baseEtag` is the ETag the client
 * loaded; the write is conditional on it, so two authors on one project can't silently clobber each
 * other's whole config. `force: true` drops the precondition ("overwrite with mine"). An absent
 * `baseEtag` writes unconditionally.
 *
 * A config that can't ship (no dictionary/strips, a payline off the grid, a strip dealing a symbol
 * absent from the dictionary) is a 400 carrying the ISSUE LIST — the paste-in-from-the-math-team
 * flow needs the actual problems, not a bare "invalid". `warnings` ride a successful save so the
 * page can surface a config that renders but lies (an unwinnable advertised payout).
 */
export const PUT: RequestHandler = async ({ request, url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
	let body: { doc?: unknown; baseEtag?: unknown; force?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const baseEtag = body.force === true ? undefined : jsonBaseEtag(body.baseEtag);
	try {
		const { doc, etag, warnings } = await saveGameConfigDoc(
			clientKey,
			projectKey,
			body.doc,
			baseEtag,
		);
		return json({ clientKey, projectKey, doc, etag, warnings });
	} catch (e) {
		if (e instanceof ConflictError) {
			// `json({error})`, never `error()` — the latter surfaces as an opaque 502 and hides the
			// cause. This branch MUST precede the catch-all below for that reason.
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this config while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		if (e instanceof InvalidGameConfigError) {
			// The issue list, not a bare string: the page maps each `path` to its panel so the author
			// sees "payline 7 points at row 4 on a 3-row reel" against the offending field.
			return json({ ok: false, error: 'invalid', issues: e.issues }, { status: 400 });
		}
		throw error(502, 'Failed to save the game-config document.');
	}
};
