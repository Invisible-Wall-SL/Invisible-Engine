import { json } from '@sveltejs/kit';
import { bucketBoxMap } from 'engine-layout';
import { loadDoc } from '$lib/server/editorStorage';
import { resolveLayoutProfile } from '$lib/server/layoutProfile';
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
	// The canvas boxes a tool DRAWS the game frame against.
	//
	// Resolved through `resolveLayoutProfile`, NOT read off the editor doc: the profile layers
	// project override → ADMIN GLOBAL → coded default, and reading `doc.mainSizesMap` directly
	// skipped the admin layer entirely — so the Rigger drew the coded defaults while the Scene
	// Editor drew the sizes the admin had actually configured. Two tools, two answers, from one
	// question. `source` is returned so a tool can say WHICH layer it is showing.
	const { profile, source } = await resolveLayoutProfile(clientKey, projectKey);
	return json({
		ok: true,
		projectKey,
		scenes,
		mainSizesMap: bucketBoxMap(profile),
		layoutProfileSource: source,
	});
};
