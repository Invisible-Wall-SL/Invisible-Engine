import { randomBytes } from 'node:crypto';
import { SUB } from '../projectPaths';
import {
	ConflictError,
	deleteObject,
	getObjectBytes,
	getObjectTextWithEtag,
	precondition,
	putObjectBytes,
	putObjectText,
} from '../r2';
import { MODEL_LONG_EDGE, imageDimensions } from './mockupPixels';

/**
 * Mockup storage for Invisible Director (ADR-0005 "Storage"). Everything lives under the project's
 * `director/` subtree, which NO shipped asset class reads: deploy serves `deploy/`, the puller
 * mirrors `deploy/`, the bake reads the editor doc, and the duplicate path skips it (repo rule 8 is
 * about asset classes a game needs; this is not one).
 *
 *   <C>/<P>/director/mockups.json           the doc: images, tags, fidelity, the ownership check
 *   <C>/<P>/director/mockups/<id>.<ext>     each original, written create-only
 *   <C>/<P>/director/crops/<runId>/<region>.png   the analyst's crops, per run
 *
 * The doc is an authored doc: every save is a compare-and-swap on its ETag, and the first save is a
 * create (`docs/design/multi-user-concurrency.md`). Two people uploading at once both go through
 * `updateDoc`, which re-reads and re-applies on a lost CAS, so the second never drops the first's
 * image and the 12-file limit holds across both.
 */

export const MAX_MOCKUP_BYTES = 20 * 1024 * 1024;
export const MAX_MOCKUPS = 12;
export { MODEL_LONG_EDGE };
export const MAX_TAG_LENGTH = 60;

export const MOCKUP_TYPES = { png: 'image/png', jpg: 'image/jpeg' } as const;
export type MockupExt = keyof typeof MOCKUP_TYPES;
export type MockupMediaType = (typeof MOCKUP_TYPES)[MockupExt];

export const FIDELITIES = ['match', 'start'] as const;
export type Fidelity = (typeof FIDELITIES)[number];

export interface Stamp {
	uid: string;
	name: string;
}

export interface MockupImage {
	id: string;
	/** The object's basename, `<id>.<ext>`. */
	file: string;
	mediaType: MockupMediaType;
	w: number;
	h: number;
	bytes: number;
	/** The screen this mockup shows (Base game, Hold and Win bonus, …); `style` when style-only. */
	tag: string;
	/** Contributes palette and mood only, never region matches. */
	styleOnly: boolean;
	uploadedBy: Stamp;
	uploadedAt: string;
}

export interface MockupsDoc {
	version: 1;
	fidelity: Fidelity;
	/**
	 * The owner's "these designs belong to us or to the client" for the images listed at the time;
	 * null until checked, and cleared again by every new upload, so no image is ever covered by a
	 * check made before it existed.
	 */
	ownershipConfirmed: { by: Stamp; at: string } | null;
	images: MockupImage[];
}

export const emptyMockupsDoc = (): MockupsDoc => ({
	version: 1,
	fidelity: 'match',
	ownershipConfirmed: null,
	images: [],
});

export const directorPrefix = SUB.director;
export const mockupsDocKey = (client: string, project: string) =>
	`${directorPrefix(client, project)}/mockups.json`;
export const mockupImageKey = (client: string, project: string, file: string) =>
	`${directorPrefix(client, project)}/mockups/${file}`;
export const cropsPrefix = (client: string, project: string, runId: string) =>
	`${directorPrefix(client, project)}/crops/${runId}/`;
export const cropKey = (client: string, project: string, runId: string, region: string) =>
	`${cropsPrefix(client, project, runId)}${region}.png`;

const UPLOAD_ID = /^[a-f0-9]{16}$/;
export const isUploadId = (value: string) => UPLOAD_ID.test(value);
/** A stored `file` is spliced into R2 keys, so only the shape `addMockup` writes is believed. */
const UPLOAD_FILE = /^[a-f0-9]{16}\.(png|jpg)$/;

/**
 * The file's real type, from its first bytes — never the browser's `File.type` or the name's
 * extension, either of which anyone can set. Null for anything but PNG and JPEG.
 */
export function sniffImage(bytes: Uint8Array): MockupExt | null {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpg';
	}
	return null;
}

/** A refusal the endpoints answer with `{ error: code, message }` at `status`. */
export class MockupError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 413 | 415,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'MockupError';
	}
}

/**
 * Why a run with these mockups cannot start, or null. SPEC §1.1: the ownership checkbox is
 * required whenever mockups are uploaded, and the run cannot be created without it. Pure, so the
 * worker's analysis and the launcher's start action can both ask it.
 */
export function ownershipRefusal(
	doc: Pick<MockupsDoc, 'images' | 'ownershipConfirmed'> | null,
): string | null {
	if (!doc || doc.images.length === 0 || doc.ownershipConfirmed) return null;
	return 'Confirm that these designs belong to us or to the client before the run starts.';
}

/**
 * Whether `uid` may act on a PENDING project's mockups: every image and the ownership check are
 * theirs, or the doc has no images. Until the project exists there is no project row to grant
 * access to, so the uploads say whose the key is: anyone else gets the same 403 as an
 * inaccessible project — a free key is not a licence to read, retag or claim another person's
 * unpublished art — and the key is anyone's again once its images are removed (the check goes
 * with the last image, and cannot be made without one, so a check alone never holds a key).
 *
 * The gate asks this before a request; every mutator asks it AGAIN inside `updateDoc`, on the
 * doc as the CAS will write it, so two first uploads that both passed the gate on an empty doc
 * cannot both land: the second re-reads, finds the first's image and is refused.
 */
export function pendingDocOwnedBy(doc: MockupsDoc, uid: string): boolean {
	return (
		doc.images.length === 0 ||
		(doc.images.every((img) => img.uploadedBy.uid === uid) &&
			(doc.ownershipConfirmed === null || doc.ownershipConfirmed.by.uid === uid))
	);
}

/** The mutators' re-check for a pending project (`owner` = the caller); a project that exists passes. */
function requireOwner(doc: MockupsDoc, owner: string | undefined, project: string): void {
	if (owner !== undefined && !pendingDocOwnedBy(doc, owner)) {
		throw new MockupError(403, 'forbidden', `You do not have access to the project "${project}".`);
	}
}

function readDoc(text: string): MockupsDoc {
	const raw = JSON.parse(text) as Partial<MockupsDoc>;
	const images = Array.isArray(raw.images) ? raw.images : [];
	return {
		version: 1,
		fidelity: (FIDELITIES as readonly string[]).includes(raw.fidelity ?? '')
			? (raw.fidelity as Fidelity)
			: 'match',
		ownershipConfirmed: raw.ownershipConfirmed ?? null,
		images: images.filter(
			(img): img is MockupImage =>
				typeof img === 'object' &&
				img !== null &&
				typeof img.id === 'string' &&
				isUploadId(img.id) &&
				typeof img.file === 'string' &&
				UPLOAD_FILE.test(img.file) &&
				img.file.startsWith(img.id),
		),
	};
}

export async function loadMockupsDoc(
	client: string,
	project: string,
): Promise<{ doc: MockupsDoc; etag: string | null }> {
	const got = await getObjectTextWithEtag(mockupsDocKey(client, project));
	if (!got) return { doc: emptyMockupsDoc(), etag: null };
	try {
		return { doc: readDoc(got.text), etag: got.etag };
	} catch {
		throw new MockupError(409, 'bad_doc', 'The mockups document is not valid JSON.');
	}
}

const CAS_ATTEMPTS = 3;

/**
 * Read, change and CAS-save the doc, re-reading on a lost race. `mutate` sees the CURRENT doc each
 * attempt, so a limit it checks holds against what others saved meanwhile, not what this caller
 * first read.
 */
async function updateDoc<T = void>(
	client: string,
	project: string,
	mutate: (doc: MockupsDoc) => T,
): Promise<{ doc: MockupsDoc; value: T }> {
	for (let attempt = 1; ; attempt++) {
		const { doc, etag } = await loadMockupsDoc(client, project);
		const value = mutate(doc);
		try {
			await putObjectText(
				mockupsDocKey(client, project),
				JSON.stringify(doc, null, '\t'),
				'application/json',
				precondition(etag),
			);
			return { doc, value };
		} catch (e) {
			if (!(e instanceof ConflictError) || attempt >= CAS_ATTEMPTS) throw e;
		}
	}
}

function cleanTag(tag: unknown, styleOnly: boolean): string {
	if (styleOnly) return 'style';
	const value = typeof tag === 'string' ? tag.trim() : '';
	if (!value) throw new MockupError(400, 'tag_required', 'Tag each mockup with its screen.');
	if (value.length > MAX_TAG_LENGTH) {
		throw new MockupError(400, 'tag_too_long', `A tag is at most ${MAX_TAG_LENGTH} characters.`);
	}
	return value;
}

export interface AddMockupInput {
	client: string;
	project: string;
	bytes: Uint8Array;
	tag: unknown;
	styleOnly: boolean;
	by: Stamp;
	/** The caller's uid while the project is pending: the write is theirs only if the doc is. */
	owner?: string;
}

/**
 * Store one mockup: validate it, write the original create-only, then record it in the doc. A
 * recording that fails (a 13th file that won another upload's race, a lost CAS three times) deletes
 * the object again, so nothing is left behind that the doc does not list.
 */
export async function addMockup(input: AddMockupInput): Promise<{ doc: MockupsDoc; id: string }> {
	const { client, project, bytes, by } = input;
	const tag = cleanTag(input.tag, input.styleOnly);
	if (bytes.length === 0) throw new MockupError(400, 'empty_file', 'The file is empty.');
	if (bytes.length > MAX_MOCKUP_BYTES) {
		throw new MockupError(413, 'too_large', 'A mockup is at most 20 MB.');
	}
	const ext = sniffImage(bytes);
	if (!ext) throw new MockupError(415, 'not_an_image', 'Only PNG and JPG mockups are accepted.');

	const { doc: current } = await loadMockupsDoc(client, project);
	if (current.images.length >= MAX_MOCKUPS) {
		throw new MockupError(409, 'too_many', `At most ${MAX_MOCKUPS} mockups per project.`);
	}

	const { w, h } = await imageDimensions(bytes);
	const id = randomBytes(8).toString('hex');
	const file = `${id}.${ext}`;
	const image: MockupImage = {
		id,
		file,
		mediaType: MOCKUP_TYPES[ext],
		w,
		h,
		bytes: bytes.length,
		tag,
		styleOnly: input.styleOnly,
		uploadedBy: by,
		uploadedAt: new Date().toISOString(),
	};
	const key = mockupImageKey(client, project, file);
	await putObjectBytes(key, bytes, image.mediaType, { ifNoneMatch: '*' });
	try {
		const { doc } = await updateDoc(client, project, (d) => {
			requireOwner(d, input.owner, project);
			if (d.images.length >= MAX_MOCKUPS) {
				throw new MockupError(409, 'too_many', `At most ${MAX_MOCKUPS} mockups per project.`);
			}
			d.images.push(image);
			d.ownershipConfirmed = null;
		});
		return { doc, id };
	} catch (e) {
		await deleteObject(key).catch(() => undefined);
		throw e;
	}
}

/** Remove an image; the ownership check goes with the last one, so an empty doc holds nothing. */
export async function removeMockup(
	client: string,
	project: string,
	id: string,
	owner?: string,
): Promise<MockupsDoc> {
	if (!isUploadId(id)) throw new MockupError(404, 'unknown_mockup', 'No such mockup.');
	const { doc, value: removed } = await updateDoc(client, project, (d) => {
		requireOwner(d, owner, project);
		const at = d.images.findIndex((img) => img.id === id);
		if (at < 0) throw new MockupError(404, 'unknown_mockup', 'No such mockup.');
		const [gone] = d.images.splice(at, 1);
		if (d.images.length === 0) d.ownershipConfirmed = null;
		return gone;
	});
	await deleteObject(mockupImageKey(client, project, removed.file)).catch(() => undefined);
	return doc;
}

/** Re-tag a listed image. The ownership check stays: the images are the same. */
export async function setMockupTag(
	client: string,
	project: string,
	id: string,
	tag: unknown,
	styleOnly: boolean,
	owner?: string,
): Promise<MockupsDoc> {
	if (!isUploadId(id)) throw new MockupError(404, 'unknown_mockup', 'No such mockup.');
	const clean = cleanTag(tag, styleOnly);
	const { doc } = await updateDoc(client, project, (d) => {
		requireOwner(d, owner, project);
		const image = d.images.find((img) => img.id === id);
		if (!image) throw new MockupError(404, 'unknown_mockup', 'No such mockup.');
		image.tag = clean;
		image.styleOnly = styleOnly;
	});
	return doc;
}

/**
 * Record the ownership check once; a second confirmation keeps the first's name and time. There
 * must be an image to confirm: a check on an empty doc would say nothing and, on a pending key,
 * would hold it.
 */
export async function confirmOwnership(
	client: string,
	project: string,
	by: Stamp,
	owner?: string,
): Promise<MockupsDoc> {
	const { doc } = await updateDoc(client, project, (d) => {
		requireOwner(d, owner, project);
		if (d.images.length === 0) {
			throw new MockupError(
				400,
				'nothing_to_confirm',
				'Upload a mockup first; there is nothing to confirm.',
			);
		}
		d.ownershipConfirmed ??= { by, at: new Date().toISOString() };
	});
	return doc;
}

export async function setFidelity(
	client: string,
	project: string,
	fidelity: unknown,
	owner?: string,
): Promise<MockupsDoc> {
	if (!(FIDELITIES as readonly unknown[]).includes(fidelity)) {
		throw new MockupError(400, 'bad_fidelity', `Fidelity is one of ${FIDELITIES.join(', ')}.`);
	}
	const { doc } = await updateDoc(client, project, (d) => {
		requireOwner(d, owner, project);
		d.fidelity = fidelity as Fidelity;
	});
	return doc;
}

/** One original's bytes, or null when the doc lists it but the object is gone. */
export async function readMockup(
	client: string,
	project: string,
	image: MockupImage,
): Promise<Uint8Array<ArrayBuffer> | null> {
	const got = await getObjectBytes(mockupImageKey(client, project, image.file));
	return got?.body ?? null;
}
