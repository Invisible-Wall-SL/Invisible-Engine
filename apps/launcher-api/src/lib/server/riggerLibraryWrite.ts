import { json } from '@sveltejs/kit';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

export type LibraryWriteResult =
	| { ok: true; etag: string | null }
	| { ok: false; response: Response };

/**
 * Write one entry of a STUDIO-WIDE Rigger library (`_shared/rigs/`, `_shared/animations/`) under
 * the caller's precondition. A name collision there overwrites another project's entry, so the
 * client's first attempt sends `baseEtag: null` (create only) and a taken id answers **409
 * `exists`** carrying the entry's `etag`, the project that saved it and when. The client confirms,
 * then retries with that etag (`If-Match`), so a second concurrent overwrite of the same entry is
 * a 409 `conflict`, never a silent last-writer-wins. Nothing is written on either 409.
 */
export async function putLibraryEntry(
	key: string,
	id: string,
	noun: 'rig' | 'animation',
	text: string,
	baseEtag: string | null | undefined,
): Promise<LibraryWriteResult> {
	try {
		return {
			ok: true,
			etag: await putObjectText(key, text, 'application/json', precondition(baseEtag)),
		};
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		return {
			ok: false,
			response: await libraryConflict(key, id, noun, baseEtag === null ? 'exists' : 'conflict'),
		};
	}
}

/** The 409 for a library id that is taken (`exists`) or changed under us (`conflict`). */
async function libraryConflict(
	key: string,
	id: string,
	noun: 'rig' | 'animation',
	kind: 'exists' | 'conflict',
): Promise<Response> {
	const current = await getObjectTextWithEtag(key);
	let existing: { name?: unknown; savedAt?: unknown; source?: { project?: unknown } } = {};
	try {
		existing = current ? JSON.parse(current.text) : {};
	} catch {
		/* a corrupt entry is still one worth confirming before overwriting */
	}
	const project = typeof existing.source?.project === 'string' ? existing.source.project : null;
	const savedAt = typeof existing.savedAt === 'string' ? existing.savedAt : null;
	const name = typeof existing.name === 'string' ? existing.name : id;
	const who = project ? ` from project "${project}"` : '';
	const when = savedAt ? ` (saved ${savedAt.slice(0, 16).replace('T', ' ')} UTC)` : '';
	const article = noun === 'animation' ? 'an' : 'a';
	return json(
		{
			ok: false,
			error: kind,
			id,
			etag: current?.etag ?? null,
			project,
			savedAt,
			message:
				kind === 'exists'
					? `The shared library already has ${article} ${noun} "${name}"${who}${when}. ` +
						'Saving replaces it for every project.'
					: `Someone else just saved the library ${noun} "${id}"${who}${when}. ` +
						'Nothing was overwritten.',
		},
		{ status: 409 },
	);
}
