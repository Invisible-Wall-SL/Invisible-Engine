import { json } from '@sveltejs/kit';
import { readCharacterClips } from '$lib/server/characterClipsRead';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * What Invisible Flipbook's Characters mode reads of the active project: the characters that
 * play clips, every clip id and each clip under a character's prefix in full, since the mode reads
 * their Bounds, loop and Mirror X and plays them (`readCharacterClips`, shared with Invisible
 * Characters' Whole view).
 *
 * A read only. Its sources are the ones the ship path reads to decide which clips are played
 * (`clipReachability`), so the mode and a publish agree on whose clips these are. Same gate as
 * the tool's other routes; `?projectKey=` only refuses a tab left on another project.
 *
 * `GET /api/flipbook/characters[?projectKey=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
	});
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;

	const { characters, clipIds, clips } = await readCharacterClips(clientKey, projectKey);
	return json({ ok: true, characters, clipIds, clips });
};
