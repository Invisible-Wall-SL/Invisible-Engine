import { z } from 'zod';
import {
	SOUND_KINDS,
	SOUND_ORIGINS,
	SOUND_STATUSES,
	isValidSoundFile,
	isValidSoundName,
	type SoundEntry,
	type SoundsDoc,
} from 'engine-layout';
import { soundsDocKey } from './projectPaths';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * Invisible Sound library doc — which sounds a project owns, where their files live, who made them,
 * and whether they are approved to ship. Authored online, exported into `deploy/sounds/` and loaded
 * by the game as an extra audio BANK (S4; `utils-sound/banks.ts`).
 *
 * The TYPES + the validity rules live in `engine-layout/soundLibrary.ts` because the game and this
 * tool must agree; only the Zod validator lives here, so the engine package stays dependency-free.
 * Same split as `winTextStorage.ts` / `engine-layout/winText.ts`.
 *
 * ## The normalize is a WHITELIST rebuild, and it DROPS
 *
 * Unlike every other doc in this repo, an entry here can be *unshippable* rather than merely sparse:
 * a sound with no file, an unplayable name, or a duplicate of another entry's name is not an
 * incomplete record, it is a record that would make the game silent or ambiguous. Those are dropped
 * rather than stored, and each drop is a documented claim in `scripts/check-sounds-doc.ts`.
 *
 * That is deliberately louder than it sounds: `normalizeSoundsDoc` runs on SAVE, so the tool must
 * show what survived rather than assume its payload persisted — the same silent round-trip trap
 * `normalizeSymbolsDoc` carries a warning about, and the reason a doc-contract check exists at all.
 *
 * See `docs/design/invisible-sound.md` §4.
 */

const entrySchema = z
	.object({
		id: z.string(),
		name: z.string(),
		kind: z.enum(SOUND_KINDS),
		section: z.string().optional(),
		file: z.string(),
		durationMs: z.number(),
		volume: z.number().optional(),
		loop: z.boolean().optional(),
		status: z.enum(SOUND_STATUSES).optional(),
		reviewedBy: z.string().optional(),
		reviewedAt: z.string().optional(),
		notes: z.string().optional(),
		origin: z.enum(SOUND_ORIGINS).optional(),
		model: z.string().optional(),
		author: z.string().optional(),
		license: z.string().optional(),
		licenseUrl: z.string().optional(),
	})
	.strip();

export const soundsDocSchema = z
	.object({
		version: z.literal(1).default(1),
		entries: z.array(entrySchema).optional(),
		updatedAt: z.string().optional(),
	})
	.strip();

/** The empty, valid doc a never-authored project degrades to. */
export function emptySoundsDoc(): SoundsDoc {
	return { version: 1, entries: [] };
}

const trimmed = (value: string | undefined): string | undefined => {
	const next = value?.trim();
	return next ? next : undefined;
};

/** A stored volume only survives if it is a real 0..1 fraction — anything else means "no authored
 *  level", not a clamped guess at what the author meant. The same rule `game-config/sounds.ts`
 *  applies to a slot's volume, and for the same reason. */
const readVolume = (raw: unknown): number | undefined =>
	typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : undefined;

/**
 * One entry, rebuilt field by field — or `undefined` when it could not name a playable sound.
 *
 * The three rejections are the three ways an entry would reach the game and produce silence:
 * no usable `id`, a `name` no binding could safely address, or a `file` that is not a bare audio
 * filename in the project's own `sounds/files/` (which is also the traversal guard — see
 * `isValidSoundFile`).
 *
 * `durationMs` must be a positive finite number because it becomes the sprite region's LENGTH; a
 * zero-length region is a sound that plays nothing, which is the exact failure this tool exists to
 * make impossible.
 */
function normalizeEntry(raw: z.infer<typeof entrySchema>): SoundEntry | undefined {
	const id = trimmed(raw.id);
	const name = trimmed(raw.name);
	if (!id || !isValidSoundName(name) || !isValidSoundFile(raw.file)) return undefined;
	if (!Number.isFinite(raw.durationMs) || raw.durationMs <= 0) return undefined;

	const next: SoundEntry = {
		id,
		name,
		kind: raw.kind,
		file: raw.file,
		durationMs: Math.round(raw.durationMs),
		// A never-reviewed sound is a DRAFT, not an approved one. Absent must never read as "someone
		// signed this off" — that is the whole value of the field.
		status: raw.status ?? 'draft',
		// An un-stated provenance is a LIBRARY sound rather than anything more specific. It is the one
		// value that claims nothing about who made it, so it cannot launder an unlicensed upload.
		origin: raw.origin ?? 'library',
	};

	const section = trimmed(raw.section);
	if (section) next.section = section;
	const volume = readVolume(raw.volume);
	if (volume !== undefined) next.volume = volume;
	if (raw.loop) next.loop = true;

	// Review metadata is only meaningful on an APPROVED entry. Carrying a reviewer on a draft would
	// let an approval survive being revoked, which is the one thing a sign-off must not do.
	if (next.status === 'approved') {
		const reviewedBy = trimmed(raw.reviewedBy);
		if (reviewedBy) next.reviewedBy = reviewedBy;
		const reviewedAt = trimmed(raw.reviewedAt);
		if (reviewedAt) next.reviewedAt = reviewedAt;
	}
	const notes = trimmed(raw.notes);
	if (notes) next.notes = notes;

	const model = trimmed(raw.model);
	if (model) next.model = model;
	const author = trimmed(raw.author);
	if (author) next.author = author;
	const license = trimmed(raw.license);
	if (license) next.license = license;
	const licenseUrl = trimmed(raw.licenseUrl);
	if (licenseUrl) next.licenseUrl = licenseUrl;

	return next;
}

/**
 * Validate + normalize arbitrary parsed/posted data into a {@link SoundsDoc}. Throws `ZodError` on
 * invalid input — the PUT endpoint maps that to a 400.
 *
 * DUPLICATES ARE COLLAPSED LAST-WINS, on both `name` and `id`, because that is the rule the player
 * already applies: `buildSoundBankIndex` resolves a name to the LAST bank declaring it, so a doc
 * that kept two entries under one name would describe a library whose second file is unreachable —
 * and the tool would show a sound that can never play. Resolving it here means the doc and the
 * runtime cannot answer the question differently.
 *
 * Order is otherwise preserved (a collapsed duplicate keeps the LATER position), so the tool's list
 * does not reshuffle itself on save.
 */
export function normalizeSoundsDoc(input: unknown): SoundsDoc {
	const doc = soundsDocSchema.parse(input ?? {});

	const normalized: SoundEntry[] = [];
	for (const raw of doc.entries ?? []) {
		const entry = normalizeEntry(raw);
		if (entry) normalized.push(entry);
	}

	// Walk BACKWARDS keeping the first sighting of each name/id — which is the LAST in doc order —
	// then restore the original order among the survivors.
	const seenName = new Set<string>();
	const seenId = new Set<string>();
	const entries: SoundEntry[] = [];
	for (let i = normalized.length - 1; i >= 0; i -= 1) {
		const entry = normalized[i];
		if (seenName.has(entry.name) || seenId.has(entry.id)) continue;
		seenName.add(entry.name);
		seenId.add(entry.id);
		entries.push(entry);
	}
	entries.reverse();

	const next: SoundsDoc = { version: 1, entries };
	// `updatedAt` must survive the READ, not only the write. `saveSoundsDoc` stamps it into the
	// object, so a normalize that dropped it would half-persist a field — written to R2, invisible to
	// every reader — which is the silent round-trip trap this module warns about, committed by the
	// module itself. A client-supplied value cannot survive: the save overwrites it unconditionally.
	const updatedAt = trimmed(doc.updatedAt);
	if (updatedAt) next.updatedAt = updatedAt;
	return next;
}

/**
 * Load a project's sound library WITH its ETag — the read half of the conditional-write contract
 * (`docs/design/multi-user-concurrency.md`).
 *
 * `existed` is reported separately from the doc, and that separation is load-bearing rather than
 * ceremony: a MISSING object and a PRESENT-but-unparseable one both degrade to an empty doc, but
 * they need OPPOSITE preconditions. Collapsing them would give a corrupt `sounds.json` an
 * `ifNoneMatch: '*'` precondition forever ⇒ 412 forever ⇒ the project's library becomes permanently
 * unsaveable with no way out from the UI.
 */
export async function loadSoundsDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: SoundsDoc; etag: string | null; existed: boolean }> {
	const obj = await getObjectTextWithEtag(soundsDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptySoundsDoc(), etag: null, existed: false };
	try {
		return { doc: normalizeSoundsDoc(JSON.parse(obj.text)), etag: obj.etag, existed: true };
	} catch {
		return { doc: emptySoundsDoc(), etag: obj.etag, existed: true };
	}
}

/** The doc alone — for readers with nothing to write back (the export, the runtime bundle). */
export async function loadSoundsDoc(clientKey: string, projectKey: string): Promise<SoundsDoc> {
	return (await loadSoundsDocWithEtag(clientKey, projectKey)).doc;
}

/**
 * Persist a project's sound library to R2 (validates + stamps `updatedAt`).
 *
 * `baseEtag` is the precondition: a string ⇒ `If-Match` (fail if it changed since the author loaded
 * it), `null` ⇒ `If-None-Match: *` (fail if someone created it meanwhile), `undefined` ⇒
 * unconditional last-writer-wins. Throws {@link ConflictError} when the precondition loses — the
 * endpoint MUST map that to a 409 via `json()`, never `error()`.
 *
 * A library is a worse thing to clobber than most docs here: the page loads the whole doc and PUTs
 * the whole doc, so an unguarded second save does not lose one field, it loses every sound the other
 * author added — while their FILES stay in `sounds/files/`, orphaned and invisible.
 */
export async function saveSoundsDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: SoundsDoc; etag: string | null }> {
	const next = normalizeSoundsDoc(doc);
	const stamped = { ...next, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		soundsDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag };
}

export { ConflictError };
