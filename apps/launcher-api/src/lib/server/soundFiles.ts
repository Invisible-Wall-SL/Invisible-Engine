import { randomUUID } from 'node:crypto';
import { SOUND_FILE_EXTENSIONS, isValidSoundFile } from 'engine-layout';
import { soundFileKey } from './projectPaths';
import { getObjectBytes, putObjectBytes } from './r2';

/**
 * The audio FILES behind a project's sound library — the bytes `sounds.json` entries point at.
 *
 * Split from `soundsStorage.ts` on purpose: the doc is a conditional, ETag-guarded read-modify-write
 * shared by every author, while a file is write-once immutable content. Mixing them would invite an
 * upload to "just also update the doc", which would bypass the precondition that stops two authors
 * clobbering each other's library.
 *
 * See `docs/design/invisible-sound.md` §4, §5.
 */

/** Per-upload cap. Generous for a BGM track, small enough that the whole body can be held in RAM —
 *  which it must be, since R2 writes go through `putObjectBytes`. */
export const MAX_SOUND_BYTES = 25 * 1024 * 1024;

/**
 * Extension → the type we SERVE it as. Derived from the stored filename, never from the browser's
 * `File.type`: a client-declared content type is untrusted input, and the extension is already
 * whitelisted by {@link isValidSoundFile}.
 */
const SOUND_CONTENT_TYPES: Record<string, string> = {
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	m4a: 'audio/mp4',
	wav: 'audio/wav',
	webm: 'audio/webm',
};

export function soundContentType(file: string): string {
	const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
	return SOUND_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** The extension of an uploaded filename, lowercased, or `undefined` when it is not one we accept. */
export function soundExtension(uploadName: string): string | undefined {
	const base = uploadName.slice(uploadName.lastIndexOf('/') + 1);
	const ext = base.slice(base.lastIndexOf('.') + 1).toLowerCase();
	return (SOUND_FILE_EXTENSIONS as readonly string[]).includes(ext) ? ext : undefined;
}

/**
 * Mint the id a new sound is stored under. SERVER-side, and never derived from the upload's own
 * name: two authors uploading `pop.mp3` on the same day must not collide, and a client-chosen id
 * could address — and overwrite — another entry's audio.
 *
 * The consequence is that an upload is never idempotent: a retried one writes a SECOND object, and
 * an entry whose file is replaced leaves its old one behind. Both are orphans — bytes in
 * `sounds/files/` that no doc entry names. That is deliberate: this path never destroys audio, and
 * an orphan is listable (S7's usage index) and cheap, while an overwrite is neither.
 */
export function mintSoundId(): string {
	return `snd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** The stored filename for a freshly minted id — `<id>.<ext>`, which {@link isValidSoundFile} accepts. */
export function soundFileName(id: string, ext: string): string {
	return `${id}.${ext}`;
}

/**
 * Write one uploaded sound. Returns the stored filename for the doc entry's `file`.
 *
 * Does NOT touch `sounds.json` — the caller records the entry through the doc's own conditional
 * save, so an upload can never be the thing that clobbers a co-author's library.
 */
export async function putSoundFile(
	clientKey: string,
	projectKey: string,
	file: string,
	bytes: Uint8Array,
): Promise<string> {
	if (!isValidSoundFile(file)) throw new Error(`Invalid sound filename: ${file}`);
	await putObjectBytes(
		soundFileKey(clientKey, projectKey, file),
		bytes,
		soundContentType(file),
		// No precondition, and that is safe HERE though it would not be on the doc: the key contains a
		// freshly minted id, so there is nothing at it to lose.
	);
	return file;
}

/** Read one sound's bytes back, or `null` when the project has no such file. */
export async function getSoundFile(
	clientKey: string,
	projectKey: string,
	file: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
	if (!isValidSoundFile(file)) return null;
	const obj = await getObjectBytes(soundFileKey(clientKey, projectKey, file));
	if (!obj) return null;
	return { body: obj.body, contentType: soundContentType(file) };
}

/**
 * A single HTTP Range header's byte span against a known length, or `null` when it is absent,
 * unsupported (multi-range) or unsatisfiable.
 *
 * Audition needs this rather than always returning the whole body: an `<audio>` element seeking in a
 * BGM track issues a Range request, and a server that answers 200-with-everything makes the player
 * re-download the file on every scrub. Only the single `bytes=a-b` form is handled — multi-range is
 * legal HTTP that no media element sends.
 */
export function parseRange(
	header: string | null,
	size: number,
): { start: number; end: number } | null {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const [, rawStart, rawEnd] = m;
	if (!rawStart && !rawEnd) return null;

	// `bytes=-500` is the LAST 500 bytes, not "from 0 to 500" — the one form of this header that is
	// easy to read backwards.
	let start = rawStart ? Number(rawStart) : size - Number(rawEnd);
	let end = rawStart ? (rawEnd ? Number(rawEnd) : size - 1) : size - 1;
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	start = Math.max(0, start);
	end = Math.min(size - 1, end);
	if (start > end || start >= size) return null;
	return { start, end };
}
