import { randomBytes } from 'node:crypto';
import { etagDiffers } from '../docBackups';
import { loadRenderableFonts } from '../fonts';
import {
	ConflictError,
	getObjectTextWithEtag,
	listAllKeys,
	precondition,
	putObjectText,
} from '../r2';
import { stampSavedBy } from '../savedBy';
import { baseOf } from './ops/docs';
import { fontRequestsRoot, type FontBakeRequest } from './ops/fonts';

/**
 * The owner's side of a Director font request (PLAN 4A): the bakes the Builder staged with
 * `fonts.bake_from_ttf` at `<C>/<P>/director/fonts/<folder>/request.json`, listed for the project,
 * and marked `done` once the owner has baked and saved the font in Invisible Font Maker. Director
 * never adds a font to the game itself: the mark is bookkeeping, and it is refused until a font
 * with that folder is in the project's catalog — the only proof the bake happened.
 *
 * Marking is idempotent by state: a request already done is answered as it is, with no write.
 */

export interface FontRequestEntry {
	folder: string;
	status: FontBakeRequest['status'];
	face: string;
	preset: string;
	bakeSize: number;
	sourceFile: string;
	sourceKey: string;
	/** The request's own key, for the Font Maker's "open this request" later. */
	requestKey: string;
	baseEtag: string;
	/** Which run and agent staged it. */
	requestedBy: { agent?: string; runId?: string; at?: string } | null;
	done: FontBakeRequest['done'] | null;
	/** Whether a font with this folder is in the project's catalog now. */
	inCatalog: boolean;
}

export class FontRequestError extends Error {
	constructor(
		readonly status: 404 | 409,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'FontRequestError';
	}
}

type Scope = { clientKey: string; projectKey: string };
const FOLDER = /^[a-z0-9][a-z0-9_-]{0,59}$/;

async function catalogFolders(scope: Scope): Promise<Set<string>> {
	const fonts = (await loadRenderableFonts(scope.clientKey, scope.projectKey)) ?? [];
	return new Set(fonts.flatMap(({ font }) => [font.id, font.folder]));
}

/** Who staged the request: recorded at the mark, before that the Builder's own `saved_by`. */
function requestedBy(doc: FontBakeRequest): FontRequestEntry['requestedBy'] {
	if (doc.requested) return doc.requested;
	if (!doc.saved_by?.agent) return null;
	return { agent: doc.saved_by.agent, runId: doc.saved_by.runId, at: doc.saved_by.at };
}

function entryOf(
	key: string,
	folder: string,
	doc: FontBakeRequest,
	etag: string | null,
	inCatalog: boolean,
): FontRequestEntry {
	return {
		folder,
		status: doc.status,
		face: doc.recipe.face,
		preset: doc.recipe.preset,
		bakeSize: doc.recipe.bakeSize,
		sourceFile: doc.sourceFile,
		sourceKey: doc.sourceKey,
		requestKey: key,
		baseEtag: baseOf(etag),
		requestedBy: requestedBy(doc),
		done: doc.done ?? null,
		inCatalog,
	};
}

async function readRequest(
	key: string,
): Promise<{ doc: FontBakeRequest; etag: string | null } | null> {
	const got = await getObjectTextWithEtag(key);
	if (!got) return null;
	try {
		const doc = JSON.parse(got.text) as FontBakeRequest;
		if (typeof doc.folder !== 'string' || typeof doc.recipe !== 'object') return null;
		return { doc, etag: got.etag };
	} catch {
		return null;
	}
}

/** A request's key under the root: `<folder>/request.json`, one level down, nothing deeper. */
const REQUEST_KEY = /^([a-z0-9][a-z0-9_-]{0,59})\/request\.json$/;

/**
 * Every staged request of the project, awaiting ones first, then by folder. The folder is the
 * KEY's, as the adapter wrote it; a doc's own `folder` field is data it could get wrong.
 */
export async function listFontRequests(scope: Scope): Promise<FontRequestEntry[]> {
	const root = fontRequestsRoot(scope);
	const folders = await catalogFolders(scope);
	const out: FontRequestEntry[] = [];
	for (const key of await listAllKeys(root)) {
		const folder = REQUEST_KEY.exec(key.slice(root.length))?.[1];
		if (!folder) continue;
		const got = await readRequest(key);
		if (got) out.push(entryOf(key, folder, got.doc, got.etag, folders.has(folder)));
	}
	return out.sort(
		(a, b) =>
			Number(a.status === 'done') - Number(b.status === 'done') || a.folder.localeCompare(b.folder),
	);
}

/**
 * Mark `folder`'s request done, once the font is in the catalog. `baseEtag` (from the listing)
 * makes the write conditional on the request as the owner saw it; without it the stored version
 * is the base, and a concurrent restage still loses at the CAS.
 */
export async function markFontRequestDone(
	scope: Scope,
	folder: string,
	by: { uid: string; name: string },
	baseEtag: string | null,
): Promise<FontRequestEntry> {
	if (!FOLDER.test(folder)) throw new FontRequestError(404, 'unknown_request', 'No such request.');
	const key = `${fontRequestsRoot(scope)}${folder}/request.json`;
	const got = await readRequest(key);
	if (!got) throw new FontRequestError(404, 'unknown_request', 'No such request.');
	if (baseEtag !== null && etagDiffers(got.etag, baseEtag)) throw new ConflictError(key);
	const folders = await catalogFolders(scope);
	if (got.doc.status === 'done')
		return entryOf(key, folder, got.doc, got.etag, folders.has(folder));
	if (!folders.has(folder)) {
		throw new FontRequestError(
			409,
			'not_baked',
			`Bake and save "${folder}" in Invisible Font Maker first; it is not in the project's fonts yet.`,
		);
	}
	const done: FontBakeRequest = {
		...got.doc,
		status: 'done',
		done: { by, at: new Date().toISOString() },
		requested: requestedBy(got.doc) ?? undefined,
	};
	const stamped = stampSavedBy(done, {
		uid: by.uid,
		name: by.name,
		tool: 'director',
		at: done.done!.at,
		rev: randomBytes(6).toString('hex'),
	});
	const etag = await putObjectText(
		key,
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(got.etag),
	);
	return entryOf(key, folder, stamped, etag, true);
}
