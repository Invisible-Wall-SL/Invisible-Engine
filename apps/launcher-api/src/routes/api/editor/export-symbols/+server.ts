import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { PageStore } from '$lib/server/pageStore';
import { SUB, UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
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
		// bake reads them off this response. `tumblePattern` (the cascade explosion order) likewise, and so is
		// `winExplode` (the win-explosion pop) and `winBeat` (the ceiling on one win/explosion beat) —
		// omit that last one and a project's baked game would keep the pacing its art sets while the
		// live one cut it short. `arrivalRelease` (the round is released when the symbols arrive) joins
		// them for the same reason again — omit it and the baked game would still sit out the emerge
		// intro the live one no longer waits on. `symbolSounds` (the per-symbol cues) is here as the
		// FALLBACK carrier `bakedSymbolSounds` reads when the sound catalog ships no `bindings` block —
		// the runtime path has always passed it verbatim, so without it the two paths disagreed.
		const {
			map,
			index,
			names,
			symbolSounds,
			highlight,
			boardGlow,
			winLine,
			winCycle,
			winExplode,
			winBeat,
			arrivalRelease,
			bookVfx,
			transition,
			tumblePattern,
			anticipation,
			stacked,
		} = await exportEditorSymbols(clientKey, projectKey, {
			// The page store the BAKE path was missing. Without it this export took the per-bundle
			// copy branch, so a baked/delivery build (every standalone game repo — `new-game.mjs`
			// scaffolds `bake:doc`) shipped its symbol sheet pages uncompressed and undeduped while
			// the publish/runtime path, which owns a shared store, shipped them compressed. Symbol
			// pages are the LARGEST textures a board holds, so that gap was the whole bug on the
			// tier this exists for. No prune here: `_pages/` is pruned only by an owner that has
			// seen EVERY exporter that could claim a page (`runtimeBundle.ts`'s `prune:pages`).
			pageStore: new PageStore(`${SUB.deploy(clientKey, projectKey)}/`),
		});
		return json({
			clientKey,
			projectKey,
			map,
			index,
			names,
			symbolSounds,
			highlight,
			boardGlow,
			winLine,
			winCycle,
			winExplode,
			winBeat,
			arrivalRelease,
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
