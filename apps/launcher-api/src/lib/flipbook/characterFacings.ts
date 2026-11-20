/**
 * SETTING HOW MANY FACINGS A CHARACTER HAS, from Invisible Flipbook's Characters mode, so that a
 * character other than the game's eight-facing ones can be given eight without a code change.
 *
 * `facings` lives in the character's component (`characterClips.facings`), so this is a component
 * save, made the way the Component Editor's ✎ Rename makes one (`componentRename.client.ts`): the
 * project's own def read fresh as stored, saved back with that one field changed against the ETag
 * it was read at, through the editor's own endpoint. Here it also takes the component's edit
 * lease for the write, since this tab does not have the component open.
 *
 * It is offered only where that save is the whole story ({@link facingsProblem}): never for a
 * character that plays a sheet, whose facings are its sheet's view and whose block is not read. The save is a
 * content change, so the component gets a new version, as any edit of it does.
 *
 * Pure, with the transport injected: `scripts/check-flipbook-characters.ts` runs it in Node.
 */
import type { ComponentDef } from 'engine-layout';

import type { ClipLease } from './characterWrites';
import type { ProjectCharacter } from './projectCharacters';

export type CharacterFacings = 4 | 8;

/** Why a character's facings cannot be set from Flipbook, or `null` when they can. */
export function facingsProblem(
	character: ProjectCharacter,
	canEditComponents: boolean,
): string | null {
	const { component } = character;
	if (character.source === 'sheet')
		return 'It plays a character sheet, whose View sets its facings in Invisible Characters. Its component’s clip block is not read.';
	if (!component)
		return 'The project has no component for this character: it plays the game’s own clip block.';
	if (!component.hasBlock)
		return (
			`Its component (${component.name}) carries no clip block, so the game’s own is played. ` +
			'There is nothing here to save the facings into.'
		);
	if (component.scope !== 'project')
		return (
			`Its component (${component.name}) is a shared one. Copy it into the project in the ` +
			'Scene Editor first.'
		);
	if (!canEditComponents)
		return 'This saves the character’s component, which needs access to the Scene Editor.';
	return null;
}

export type FacingsRead = { def: ComponentDef; etag: string | null } | { status: number };
export type FacingsSaved =
	{ version: number; etag: string | null } | { status: number; message: string };

export interface FacingsWrites {
	/** The project's own def as stored (`GET /api/editor/component?stored=project`). */
	read: (id: string) => Promise<FacingsRead>;
	/** A conditional save of `def` against `baseEtag` (`POST /api/editor/component`). */
	save: (def: ComponentDef, baseEtag: string) => Promise<FacingsSaved>;
	/** The component's edit lease, taken for the write. */
	lease: (id: string) => Promise<ClipLease>;
}

export type FacingsResult =
	{ facings: CharacterFacings; version: number | null } | { problem: string };

/**
 * Save `facings` into component `id`'s clip block. `version` is the component's version after the
 * save, or `null` when the block already said so and nothing was written.
 */
export async function writeCharacterFacings(
	id: string,
	facings: CharacterFacings,
	writes: FacingsWrites,
): Promise<FacingsResult> {
	const lease = await writes.lease(id);
	if (!lease.held) return { problem: `${lease.by} has the component open.` };
	try {
		const read = await writes.read(id);
		if (!('def' in read)) return { problem: `Could not read the component (${read.status}).` };
		const block = read.def.characterClips;
		if (read.def.scope !== 'project' || read.etag === null || !block)
			return { problem: 'It is no longer a component of this project with a clip block. Refresh.' };
		if (block.facings === facings) return { facings, version: null };
		const saved = await writes.save(
			{ ...read.def, characterClips: { ...block, facings } },
			read.etag,
		);
		if ('message' in saved) return { problem: saved.message };
		return { facings, version: saved.version };
	} finally {
		lease.release();
	}
}
