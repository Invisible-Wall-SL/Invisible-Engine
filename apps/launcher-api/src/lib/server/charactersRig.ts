import { readRigBinary, readRigJson, rigFactsOfData } from '$lib/characters/rigCost';
import type { RigFacts } from '$lib/characters/rigFacts';
import { listRigs } from './projectAssets';
import { getObjectBytes, getObjectText } from './r2';
import { resolveEditorRig } from './rig';

/** A project rig's name and whether it is the shared library's, as a sheet's picker lists it. */
export interface CharacterRigName {
	name: string;
	shared: boolean;
}

/** What the browser needs to draw a rig: the PNG-preferred atlas text and where its skeleton and
 *  pages are streamed from (`/api/editor/asset`, which the Game Config grant reads; Characters
 *  cannot open without it). */
export interface CharacterRigDescriptor {
	folder: string;
	format: 'skel' | 'json';
	runtime: string;
	pma: boolean;
	atlasText: string;
	skeletonUrl: string;
	pageNames: string[];
	pageUrls: string[];
}

export type CharacterRigRead =
	| { found: false; reason: string }
	| {
			found: true;
			name: string;
			shared: boolean;
			descriptor: CharacterRigDescriptor;
			/** Absent when the skeleton could not be read; `reason` says why. */
			facts?: RigFacts;
			reason?: string;
	  };

/** The project's rigs by bundle name: its own, then the shared library's it does not shadow. */
export async function listCharacterRigs(
	clientKey: string,
	projectKey: string,
): Promise<CharacterRigName[]> {
	return (await listRigs(clientKey, projectKey)).map(({ name, shared }) => ({ name, shared }));
}

const assetUrl = (key: string): string => `/api/editor/asset?key=${encodeURIComponent(key)}`;

/**
 * One of the project's rigs by its bundle name, for Invisible Characters
 * (`docs/design/character-pipeline.md` step C6b): where its files are and what its skeleton says.
 * The name is looked up in the project's own list, so nothing outside it is read; the skeleton is
 * read by the runtime's parser, so its names are the ones the game finds.
 */
export async function readCharacterRig(
	clientKey: string,
	projectKey: string,
	name: string,
): Promise<CharacterRigRead> {
	const rig = (await listRigs(clientKey, projectKey)).find((r) => r.name === name);
	if (!rig) return { found: false, reason: `This project has no rig named "${name}".` };
	const resolved = await resolveEditorRig(clientKey, projectKey, rig.key, true);
	if (!resolved)
		return {
			found: false,
			reason: `The rig "${name}" has no skeleton listed: open it in the Rigger and save it.`,
		};
	const base = {
		found: true as const,
		name,
		shared: rig.shared,
		descriptor: {
			folder: resolved.folder,
			format: resolved.format,
			runtime: resolved.runtime,
			pma: resolved.pma,
			atlasText: resolved.atlasText,
			skeletonUrl: assetUrl(resolved.skeletonKey),
			pageNames: resolved.pageNames,
			pageUrls: resolved.pageKeys.map(assetUrl),
		},
	};
	try {
		if (resolved.format === 'skel') {
			const bytes = await getObjectBytes(resolved.skeletonKey);
			if (!bytes) return { ...base, reason: 'Its skeleton file is missing.' };
			return { ...base, facts: rigFactsOfData(name, readRigBinary(bytes.body)) };
		}
		const text = await getObjectText(resolved.skeletonKey);
		if (!text) return { ...base, reason: 'Its skeleton file is missing.' };
		return { ...base, facts: rigFactsOfData(name, readRigJson(text)) };
	} catch (e) {
		return {
			...base,
			reason: `Its skeleton could not be read: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}
