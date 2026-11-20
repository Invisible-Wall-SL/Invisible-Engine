import type { FlipbookClip } from 'engine-flipbook';
import type { ComponentDef } from 'engine-layout';
import { lookedForClipIds, underCharacterPrefix } from '$lib/flipbook/characterSet';
import {
	characterArt,
	projectCharacters,
	type ProjectCharacter,
} from '$lib/flipbook/projectCharacters';
import { listComponents } from './componentStorage';
import { mapWithConcurrency } from './concurrency';
import { CLIP_IO_CONCURRENCY, listClipIds, loadClip } from './flipbookStorage';
import { loadGameConfigDocWithEtag } from './gameConfigStorage';

/**
 * A project's characters that play clips and their clips, as Flipbook's Characters mode
 * (`/api/flipbook/characters`) and Invisible Characters' Whole view (`/api/characters/whole`) both
 * read them, so the two tools show the same clips: the characters `projectCharacters` lists from the
 * stored config (its character sheets on, as `loadGameConfigDocWithEtag` loads it) and the
 * components, every clip id (sorted), and in full each clip under a character's prefix and each
 * clip a sheet names in a cell. Its sources are the ones the ship path reads (`clipReachability`).
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
	const arts = characters.map(characterArt);
	const named = new Set(arts.flatMap((art) => [...lookedForClipIds(art)]));
	const theirs = clipIds.filter(
		(id) => named.has(id) || arts.some((art) => underCharacterPrefix(art, id)),
	);
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
