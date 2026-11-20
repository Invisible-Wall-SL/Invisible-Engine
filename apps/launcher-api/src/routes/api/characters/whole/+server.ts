import { json } from '@sveltejs/kit';
import type { SceneProjection } from 'engine-layout';
import type { FlipbookClip } from 'engine-flipbook';
import { underCharacterPrefix } from '$lib/flipbook/characterSet';
import { projectCharacters } from '$lib/flipbook/projectCharacters';
import { listComponents } from '$lib/server/componentStorage';
import { mapWithConcurrency } from '$lib/server/concurrency';
import { loadDocWithEtag } from '$lib/server/editorStorage';
import { CLIP_IO_CONCURRENCY, listClipIds, loadClip } from '$lib/server/flipbookStorage';
import { loadGameConfigDocWithEtag } from '$lib/server/gameConfigStorage';
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
 * A read only, from the sources Flipbook's Characters mode reads (`/api/flipbook/characters`), so
 * the two tools show the same clips. The clips are chosen by the STORED config; the page joins its
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

	const [components, config, clipIds, layout] = await Promise.all([
		listComponents({ projectKey }),
		loadGameConfigDocWithEtag(clientKey, projectKey),
		listClipIds(clientKey, projectKey),
		loadDocWithEtag(clientKey, projectKey),
	]);
	const looks = projectCharacters(components, config.doc).map((c) => c.look);
	const theirs = clipIds.filter((id) => looks.some((look) => underCharacterPrefix(look, id)));
	const loaded = await mapWithConcurrency(theirs, CLIP_IO_CONCURRENCY, (id) =>
		loadClip(clientKey, projectKey, id),
	);
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
		clipIds: clipIds.sort(),
		clips: loaded.flatMap(({ clip }): FlipbookClip[] => (clip ? [clip] : [])),
		projections,
	});
};
