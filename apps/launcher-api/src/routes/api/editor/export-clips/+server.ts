import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportClips } from '$lib/server/flipbookExport';
import { exportRigFlipbooks } from '$lib/server/rigFlipbookExport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's Invisible Flipbook clips into `deploy/clips/`
 * so the bake can embed them (see `$lib/server/flipbookExport.ts`). Called by
 * `bake-editor-doc.mjs` alongside the art/font/symbol/flow/effects exports, gated by the
 * same shared read token as `/api/editor/doc` (`?k=` vs the deploy token) — a build runner
 * has the token, no launcher session.
 *
 * A clip carries no binary assets of its own (its frames are regions of an atlas the
 * editor-art export already ships), so this is a JSON copy + normalize per clip. Idempotent;
 * safe to re-run per build. An un-authored project exports no clips (parity). The response
 * also lists every source-sheet `assetKey` the clips reference so the bake can verify each
 * resolves to a shipped atlas.
 *
 * The response also carries `rigFlipbooks` — the rig-timeline direct CLIP-binding manifest (a rig's
 * own animation events → clips, read from the rig `.irig`/`.json`; see `rigFlipbookExport.ts`). It
 * ships no new assets — the clips it references are already in `clips` — so it rides this same
 * flipbook trigger, mirroring how `rigFx` rides the effects one.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor clips export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const [index, rigFlipbooks] = await Promise.all([
			exportClips(clientKey, projectKey),
			exportRigFlipbooks(clientKey, projectKey),
		]);
		return json({ clientKey, projectKey, ...index, rigFlipbooks });
	} catch (e) {
		console.error('export-clips failed:', e);
		throw error(502, 'Failed to export the project clips.');
	}
};
