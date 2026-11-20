import { json } from '@sveltejs/kit';
import type { SceneProjection } from 'engine-layout';
import { readCharacterClips } from '$lib/server/characterClipsRead';
import type { PickSheet } from '$lib/pickSheets';
import {
	listCharacterRigs,
	listCharacterSheets,
	type CharacterRigName,
} from '$lib/server/charactersRig';
import { loadDocWithEtag } from '$lib/server/editorStorage';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * What Invisible Characters' Whole view reads beside the config the page already holds
 * (`$lib/characters/characterWhole.ts`, `docs/design/character-pipeline.md` step C1): the
 * components a character can be drawn as, with their clip blocks; every clip id; each clip under a
 * character's prefix in full, for the clips grid and the Directions preview; and the projections
 * of the project's screens, which the view a character implies depends on; and the project's
 * rigs by bundle name, for a sheet whose source is a rig (step C6b). A rig listing that fails
 * leaves `rigs` empty and says why in `rigsError`: the rest is still read. So do the project's
 * atlases and sheets a still image is picked from (`sheets`, `sheetsError`), each by its manifest
 * key.
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

	const failed =
		(what: string) =>
		(e: unknown): { error: string } => {
			console.error(`[characters/whole] "${projectKey}": listing the ${what} failed:`, e);
			return { error: `The project's ${what} could not be listed. Reload the page to try again.` };
		};
	const [{ components, clipIds, clips }, layout, rigs, sheets] = await Promise.all([
		readCharacterClips(clientKey, projectKey),
		loadDocWithEtag(clientKey, projectKey),
		listCharacterRigs(clientKey, projectKey).catch(failed('rigs')),
		listCharacterSheets(clientKey, projectKey).catch(failed('sheets')),
	]);
	const listedSheets: PickSheet[] = Array.isArray(sheets) ? sheets : [];
	const listed: CharacterRigName[] = Array.isArray(rigs) ? rigs : [];
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
		rigs: listed,
		...(Array.isArray(rigs) ? {} : { rigsError: rigs.error }),
		sheets: listedSheets,
		...(Array.isArray(sheets) ? {} : { sheetsError: sheets.error }),
	});
};
