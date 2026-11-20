import { error, json } from '@sveltejs/kit';
import { readCharacterRig } from '$lib/server/charactersRig';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * One of the project's rigs, for a character sheet's rig source
 * (`docs/design/character-pipeline.md` step C6b): its animations with their lengths, its skins
 * and bones, what it costs to draw, and where the preview loads it from. A read only. The rig is
 * named by its bundle name, the one a sheet stores, and is looked up in the project's own list:
 * a name that is not in it is a 404, whatever it spells. `?projectKey=` only refuses a tab left
 * on another project.
 *
 * `GET /api/characters/rig?name=<bundle>[&projectKey=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'characters',
		forbiddenMessage: 'Your role does not have access to Invisible Characters.',
		includeSharedRigs: true,
	});
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;

	const name = url.searchParams.get('name')?.trim();
	if (!name) throw error(400, 'Name the rig (?name=).');

	const rig = await readCharacterRig(clientKey, projectKey, name);
	return json({ ok: rig.found, ...rig }, { status: rig.found ? 200 : 404 });
};
