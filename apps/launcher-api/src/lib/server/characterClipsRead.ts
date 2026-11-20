import type { FlipbookClip } from 'engine-flipbook';
import type { ComponentDef } from 'engine-layout';
import { underCharacterPrefix } from '$lib/flipbook/characterSet';
import { projectCharacters, type ProjectCharacter } from '$lib/flipbook/projectCharacters';
import { listComponents } from './componentStorage';
import { mapWithConcurrency } from './concurrency';
import { CLIP_IO_CONCURRENCY, listClipIds, loadClip } from './flipbookStorage';
import { loadGameConfigDocWithEtag } from './gameConfigStorage';

/**
 * A project's characters that play clips and their clips, as Flipbook's Characters mode
 * (`/api/flipbook/characters`) and Invisible Characters' Whole view (`/api/characters/whole`) both
 * read them, so the two tools show the same clips: the characters `projectCharacters` lists from the
 * stored config and the components, every clip id (sorted), and each clip under a character's
 * prefix in full. Its sources are the ones the ship path reads (`clipReachability`).
 */
export async function readCharacterClips(
	clientKey: string,
	projectKey: string,
): Promise<{
	components: ComponentDef[];
	characters: ProjectCharacter[];
	clipIds: string[];
	clips: FlipbookClip[];
}> {
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
	return {
		components,
		characters,
		clipIds: clipIds.sort(),
		clips: loaded.flatMap(({ clip }): FlipbookClip[] => (clip ? [clip] : [])),
	};
}
