import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportEffects } from '$lib/server/effectExport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's Invisible FX effects into
 * `deploy/effects/` so the bake can embed them (see `$lib/server/effectExport.ts`).
 * Called by `bake-editor-doc.mjs` alongside the art/font/symbol/flow exports, gated
 * by the same shared read token as `/api/editor/doc` (`?k=` vs the deploy token) — a
 * build runner has the token, no launcher session.
 *
 * An EffectDoc carries no binary assets of its own (its particle art is an atlas the
 * editor-art export already ships), so this is a JSON copy + normalize per effect.
 * Idempotent; safe to re-run per build. An un-authored project exports no effects
 * (parity, §8). The response also lists every `art.assetKey` the effects reference so
 * the bake can verify each resolves to a shipped atlas (the dangling-key guard, §8).
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor effects export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const index = await exportEffects(clientKey, projectKey);
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-effects failed:', e);
		throw error(502, 'Failed to export the project effects.');
	}
};
