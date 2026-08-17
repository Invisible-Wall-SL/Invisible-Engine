import { json } from '@sveltejs/kit';
import { loadDoc } from '$lib/server/editorStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the project's authored Scenes (id + name + node count) so a tool can BIND to one without
 * pulling the whole editor doc. Today's caller is the Rigger's Cinematic mode, whose "set picker"
 * chooses the Scene a cinematic stages over (`docs/design/invisible-cinematic.md` §12.3).
 *
 * Gated exactly like `/api/editor/effects` — `editor` with `rigger`/`fx` as alt-tools — so the
 * Rigger reads it under its own entitlement rather than needing the Scene Editor's. Scope bound to
 * the SESSION's active project.
 *
 * Deliberately a SUMMARY, not the scenes themselves: a picker needs names, and a doc with many
 * scenes carries a lot of node tree the picker would throw away.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['rigger', 'fx'],
		forbiddenMessage: 'Your role does not have access to the project scenes.',
	});

	const doc = await loadDoc(clientKey, projectKey);
	const scenes = (doc?.scenes ?? []).map((scene) => ({
		id: scene.id,
		name: scene.name,
		role: scene.role ?? null,
		nodes: Array.isArray(scene.nodes) ? scene.nodes.length : 0,
	}));
	return json({ ok: true, projectKey, scenes });
};
