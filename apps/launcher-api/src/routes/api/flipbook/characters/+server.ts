import { json } from '@sveltejs/kit';
import { underCharacterPrefix } from '$lib/flipbook/characterSet';
import { projectCharacters } from '$lib/flipbook/projectCharacters';
import { listComponents } from '$lib/server/componentStorage';
import { mapWithConcurrency } from '$lib/server/concurrency';
import { CLIP_IO_CONCURRENCY, listClipIds, loadClip } from '$lib/server/flipbookStorage';
import { loadGameConfigDocWithEtag } from '$lib/server/gameConfigStorage';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { FlipbookClip } from 'engine-flipbook';
import type { RequestHandler } from './$types';

/**
 * What Invisible Flipbook's Characters mode reads of the active project: the characters that
 * play clips (`projectCharacters`: the components that carry `characterClips`, and the game's
 * own for a config drawn in Salmons' art), every clip id, and each clip under a character's
 * prefix in full, since the mode reads their Bounds, loop and Mirror X and plays them.
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

	const [components, config, clipIds] = await Promise.all([
		listComponents({ projectKey }),
		loadGameConfigDocWithEtag(clientKey, projectKey),
		listClipIds(clientKey, projectKey),
	]);
	const characters = projectCharacters(components, config.doc);
	const theirs = clipIds.filter((id) => characters.some((c) => underCharacterPrefix(c.look, id)));
	const loaded = await mapWithConcurrency(theirs, CLIP_IO_CONCURRENCY, (id) =>
		loadClip(clientKey, projectKey, id),
	);
	const clips = loaded.flatMap(({ clip }): FlipbookClip[] => (clip ? [clip] : []));
	return json({ ok: true, characters, clipIds: clipIds.sort(), clips });
};
