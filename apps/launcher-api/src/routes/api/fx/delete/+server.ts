import { error, json } from '@sveltejs/kit';
import { conflictResponse } from '$lib/server/conflict';
import { deleteEffect } from '$lib/server/fxStorage';
import { jsonObjectOrNull } from '$lib/server/http';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Delete an Invisible FX effect from R2 — the sibling of `/api/fx/save`. Same auth + scope: the
 * shared `gate` resolves the SESSION-bound `(client, project)` and 403s unless the user is
 * entitled to the `fx` tool. `deleteEffect` removes BOTH the canonical `<id>.fx.json` and its
 * editor-only `<id>.fx.meta.json` sidecar, slugging the id exactly as the save path does, and
 * keeps the deleted version in the effect's History (`GET /api/fx/backups?deleted=1`).
 *
 * Body: `{ id, baseEtag: string, projectKey? }` — the version the tab opened; when someone saved
 * since, this answers **409** `{ ok: false, error: 'conflict', message }` and deletes nothing — or
 * `{ id, force: true, projectKey? }` to delete whatever is stored now. `baseEtag` is required like
 * a save's (an absent one is a 400), but `null` ("it did not exist") is a 400 too: there is no
 * version to delete. `projectKey`, when sent, must be the session's project; `force` does not
 * bypass that.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});

	const body = await jsonObjectOrNull(request);
	const rawId = body && typeof body.id === 'string' ? body.id.trim() : '';
	if (!rawId) throw error(400, 'missing id');

	if (typeof body?.projectKey === 'string' && body.projectKey !== projectKey) {
		return json(
			{
				ok: false,
				error: 'scope-mismatch',
				message:
					`This tab is editing "${body.projectKey}" but your active project is now ` +
					`"${projectKey}". Reload to continue — deleting here would delete from the wrong project.`,
			},
			{ status: 409 },
		);
	}

	const baseEtag = writeBaseEtagJson(body);
	if (baseEtag === null) {
		throw error(400, 'This delete did not name the version it opened — reload and try again.');
	}

	try {
		const { id } = await deleteEffect(clientKey, projectKey, rawId, baseEtag);
		return json({ ok: true, id });
	} catch (e) {
		const conflict = conflictResponse(
			e,
			'Someone saved this effect after you opened it. Reload to see their version, or delete anyway.',
		);
		if (conflict) return conflict;
		throw e;
	}
};
