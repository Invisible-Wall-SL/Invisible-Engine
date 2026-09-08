import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { exportEditorSymbols } from '$lib/server/symbolExport';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the assets a project's Invisible Symbols State
 * Machine doc binds into `deploy/editor-symbols/` so the game's asset pull picks
 * them up (see `$lib/server/symbolExport.ts`). Called by `bake-editor-doc.mjs`
 * right before the deploy mirror runs, gated by the same shared read token as
 * `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`) — a build runner has the token,
 * no launcher session. Idempotent; safe to re-run per build.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor symbols export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		// Forward the WHOLE export result's config fields. `winCycle` + `names` were previously
		// dropped by this destructure, so the win-symbol replay settings (on/off, gap, replay
		// line/text) and the symbol display names never reached the BAKE path (`bake-editor-doc.mjs`
		// reads them off this response) — only the live runtime path, which uses the full
		// `SymbolExportResult`, carried them. Both bundle paths must agree (the "reach both" rule).
		// `bookVfx` (the book-symbol VFX layers) is on this list for the SAME reason — omit it and the
		// bake path would ship no book VFX while the runtime path did. `stacked` (the stacked-picture
		// config) and `transition` (the explosion → intro transition) are here for the SAME reason — the
		// bake reads them off this response. `tumblePattern` (the cascade explosion order) likewise.
		const {
			map,
			index,
			names,
			highlight,
			boardGlow,
			winLine,
			winCycle,
			bookVfx,
			transition,
			tumblePattern,
			anticipation,
			stacked,
		} = await exportEditorSymbols(clientKey, projectKey);
		return json({
			clientKey,
			projectKey,
			map,
			index,
			names,
			highlight,
			boardGlow,
			winLine,
			winCycle,
			bookVfx,
			transition,
			tumblePattern,
			anticipation,
			stacked,
		});
	} catch (e) {
		console.error('export-symbols failed:', e);
		throw error(502, 'Failed to export the symbol-bound assets.');
	}
};
