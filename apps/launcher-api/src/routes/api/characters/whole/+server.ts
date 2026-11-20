import { json } from '@sveltejs/kit';
import type { SceneProjection } from 'engine-layout';
import { readCharacterClips } from '$lib/server/characterClipsRead';
import { loadDocWithEtag } from '$lib/server/editorStorage';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * What Invisible Characters' Whole view reads beside the config the page already holds
 * (`$lib/characters/characterWhole.ts`, `docs/design/character-pipeline.md` step C1): the
 * components a character can be drawn as, with their clip blocks; every clip id; each clip under a
 * character's prefix in full, for the clips grid and the Directions preview; and the projections
 * of the project's screens, which the view a character implies depends on.
 *
 * A read only, through the loader Flipbook's Characters mode reads with (`readCharacterClips`),
 * so the two tools show the same clips. The clips are chosen by the STORED config; the page joins its
 * own (perhaps unsaved) copy. `?projectKey=` only refuses a tab left on another project.
 *
 * `GET /api/characters/whole[?projectKey=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'characters',
		forbiddenMessage: 'Your role does not have access to Invisible Characters.',
	});
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;

	const [{ components, clipIds, clips }, layout] = await Promise.all([
		readCharacterClips(clientKey, projectKey),
		loadDocWithEtag(clientKey, projectKey),
	]);
	const projections = [
		...new Set(
			layout.doc.scenes.flatMap((s): SceneProjection[] => (s.projection ? [s.projection] : [])),
		),
	];
	return json({
		ok: true,
		components: components.map(({ id, name, scope, characterClips }) => ({
			id,
			name,
			scope,
			...(characterClips ? { characterClips } : {}),
		})),
		clipIds,
		clips,
		projections,
	});
};
