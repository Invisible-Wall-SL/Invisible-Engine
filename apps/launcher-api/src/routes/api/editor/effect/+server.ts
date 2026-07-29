import { error, json } from '@sveltejs/kit';
import { loadEffect } from '$lib/server/fxStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Fetch ONE authored Invisible FX effect's `EffectDoc` (by id) so the Scene Editor's live particle
 * overlay can play it. Sibling of `/api/editor/effects` (which only LISTS id+name); gated the same
 * (`editor` OR the `fx`/`rigger`/`symbols` alt-tools — the Rigger's live FX preview and the Symbols
 * tool's Book-VFX fx-layer preview read it too), scope bound
 * to the session's active project. Reuses `fxStorage.loadEffect` (the same read the `/fx` tool uses).
 */
export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['fx', 'rigger', 'symbols'],
		forbiddenMessage: 'Your role does not have access to the project effects.',
	});

	const id = url.searchParams.get('id')?.trim();
	if (!id) throw error(400, 'missing id');

	const { doc } = await loadEffect(clientKey, projectKey, id);
	return json({ doc });
};
