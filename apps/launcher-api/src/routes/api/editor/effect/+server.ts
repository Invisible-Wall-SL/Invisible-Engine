import { error, json } from '@sveltejs/kit';
import { loadEffect } from '$lib/server/fxStorage';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Fetch ONE authored Invisible FX effect's `EffectDoc` (by id) so the Scene Editor's live particle
 * overlay can play it. Sibling of `/api/editor/effects` (which only LISTS id+name); gated the same
 * (`editor` OR the `fx`/`rigger`/`symbols` alt-tools — the Rigger's live FX preview and the Symbols
 * tool's Book-VFX fx-layer preview read it too), scope bound
 * to the session's active project. Reuses `fxStorage.loadEffect` (the same read the `/fx` tool uses).
 *
 * The Scene Editor sends the project its tab was loaded for (`projectKey`): another tab having moved
 * the session to a different project is refused (409 `scope-mismatch`) rather than answered with
 * that project's effect, whose parameters the editor would then list. The key is only compared.
 * The Rigger's static page and the Symbols tool send none and read the session's project.
 */
export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['fx', 'rigger', 'symbols'],
		forbiddenMessage: 'Your role does not have access to the project effects.',
	});

	const mismatch = scopeMismatch(url.searchParams.get('projectKey'), projectKey);
	if (mismatch) return mismatch;

	const id = url.searchParams.get('id')?.trim();
	if (!id) throw error(400, 'missing id');

	const { doc } = await loadEffect(clientKey, projectKey, id);
	return json({ doc });
};
