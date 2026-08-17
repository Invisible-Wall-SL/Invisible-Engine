import { SUB, r2Slug } from './projectPaths';
import {
	deleteObject,
	getObjectTextWithEtag,
	listAllObjects,
	precondition,
	putObjectText,
} from './r2';

/**
 * R2 load/save for Invisible Cinematic documents (`.icin`), authored in `/rigger`'s Cinematic
 * mode. Plan: `docs/design/invisible-cinematic.md` · State: `docs/status/cinematic.md`.
 *
 * Layout: one object per cinematic at `<client>/<project>/cinematics/<id>.json`.
 *
 * **THERE IS DELIBERATELY NO INDEX BLOB.** The list comes from an R2 prefix listing, so adding
 * or deleting a cinematic never read-modify-writes a shared object. That whole class of bug is
 * what silently dropped rows from the Rigger's `_shared/{rigs,animations}/index.json` and
 * surfaced as "my rig vanished" — two users on unrelated work clobbering each other's catalog
 * entry. A listing costs one extra call and cannot race. See
 * `docs/design/multi-user-concurrency.md`.
 *
 * Writes are guarded by the caller's `baseEtag` precondition (Phase 1 of that design): a stale
 * one raises `ConflictError` → 409, rather than overwriting whoever saved first.
 */

/** One actor placed on the stage. */
export interface CinematicCast {
	actorId: string;
	rigId: string;
	rigName?: string;
	nodeId?: string | null;
	place: Record<string, number | boolean>;
	z?: number;
	visible?: boolean;
}

export interface CinematicDoc {
	schemaVersion: number;
	id: string;
	name: string;
	duration: number;
	fps: number;
	stage: { sceneId: string | null; cast: CinematicCast[] };
	tracks: Array<Record<string, unknown>>;
	markers: Array<Record<string, unknown>>;
}

export interface CinematicSummary {
	id: string;
	name: string;
	duration: number;
	actors: number;
	updatedAt: string | null;
}

/** R2 key for one cinematic. `id` is path-guarded by `r2Slug` at every entry point. */
export function cinematicKey(clientKey: string, projectKey: string, id: string): string {
	return `${SUB.cinematics(clientKey, projectKey)}/${r2Slug(id)}.json`;
}

/**
 * Structural check that `value` is a cinematic document. Deliberately shallow — it guards
 * against a malformed body overwriting a good stored doc, it does NOT validate the whole track
 * schema (the evaluator already treats unknown/al malformed strips as "skip", and a stricter
 * server-side schema would reject documents authored by a newer client).
 */
export function isCinematicDoc(value: unknown): value is CinematicDoc {
	if (!value || typeof value !== 'object') return false;
	const doc = value as Record<string, unknown>;
	const stage = doc.stage as Record<string, unknown> | undefined;
	return (
		typeof doc.id === 'string' &&
		typeof doc.name === 'string' &&
		typeof doc.duration === 'number' &&
		Number.isFinite(doc.duration) &&
		!!stage &&
		typeof stage === 'object' &&
		Array.isArray(stage.cast) &&
		Array.isArray(doc.tracks)
	);
}

/** Load one cinematic with the ETag its next save must match; `doc: null` when absent/malformed. */
export async function loadCinematic(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<{ doc: CinematicDoc | null; etag: string | null }> {
	const obj = await getObjectTextWithEtag(cinematicKey(clientKey, projectKey, id));
	if (!obj) return { doc: null, etag: null };
	try {
		const parsed = JSON.parse(obj.text) as unknown;
		// The etag is read off the object, never inferred from a successful parse: a MALFORMED
		// doc is an object that EXISTS, so its overwrite must be `ifMatch: <etag>`, never
		// `ifNoneMatch: '*'` (which would 412 forever).
		return { doc: isCinematicDoc(parsed) ? parsed : null, etag: obj.etag };
	} catch {
		return { doc: null, etag: obj.etag };
	}
}

export async function saveCinematic(
	clientKey: string,
	projectKey: string,
	doc: CinematicDoc,
	baseEtag: string | null | undefined,
): Promise<{ etag: string | null; id: string }> {
	const id = r2Slug(doc.id);
	const key = cinematicKey(clientKey, projectKey, id);
	// `putObjectText` returns the new ETag directly (not an object) and throws ConflictError when
	// the precondition fails — the caller turns that into a 409.
	const etag = await putObjectText(
		key,
		JSON.stringify({ ...doc, id }),
		'application/json',
		precondition(baseEtag),
	);
	return { etag, id };
}

/**
 * Every cinematic in the project, newest first. Reads each object because the summary needs the
 * name and actor count — fine at the scale of a project's cinematics (tens, not thousands), and
 * it keeps the truth in the documents rather than in a catalog that can drift from them.
 */
export async function listCinematics(
	clientKey: string,
	projectKey: string,
): Promise<CinematicSummary[]> {
	const prefix = `${SUB.cinematics(clientKey, projectKey)}/`;
	// `lastModified` comes from the LISTING, not from the object read — `getObjectTextWithEtag`
	// carries only text + etag, so reading it per object would silently report `null` for every
	// row and make the "newest first" sort a no-op.
	const listed = (await listAllObjects(prefix)).filter((o) => o.key.endsWith('.json'));
	const out: CinematicSummary[] = [];
	for (const entry of listed) {
		const obj = await getObjectTextWithEtag(entry.key);
		if (!obj) continue;
		try {
			const parsed = JSON.parse(obj.text) as unknown;
			if (!isCinematicDoc(parsed)) continue;
			out.push({
				id: parsed.id,
				name: parsed.name,
				duration: parsed.duration,
				actors: parsed.stage.cast.length,
				updatedAt: entry.lastModified ? new Date(entry.lastModified).toISOString() : null,
			});
		} catch {
			/* a corrupt object must not hide the healthy ones */
		}
	}
	out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
	return out;
}

export async function deleteCinematic(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<void> {
	await deleteObject(cinematicKey(clientKey, projectKey, id));
}
