import type { CinematicDoc as LayoutCinematicDoc } from 'engine-layout';
import {
	STARTER_PREFIX,
	STARTER_TIMELINES,
	linkOf,
	resolveLinked,
	starterTimeline,
	summarizeShared,
	type SharedTimelineDoc,
	type SharedTimelineSummary,
} from '$lib/timeline/sharedTimelines';
import { isCinematicDoc, type CinematicDoc } from './cinematicStorage';
import { r2Slug } from './projectPaths';
import {
	ConflictError,
	getObjectTextWithEtag,
	listAllObjects,
	precondition,
	putObjectText,
} from './r2';

/**
 * The shared timeline library (Rive plan Phase 9d): `_shared/cinematics/<id>.json` (the latest
 * version) plus one immutable `<id>.v<N>.json` per version, which is what a link pins. Mirrors the
 * shared component store (`_shared/editor-components/`, `componentStorage.ts`): a promote is a
 * versioned, conditional write to a GLOBAL key, gated on the `componentPublish` capability.
 * Built-in starters (`STARTER_TIMELINES`) answer for their ids at version 1.
 *
 * NO INDEX BLOB, like the project store (`cinematicStorage.ts`): the list is a prefix listing.
 *
 * Concurrency (`docs/design/multi-user-concurrency.md` Phase 1): the latest pointer is written
 * `If-Match` the ETag the promoter saw (`null` ⇒ create-only), and each snapshot is create-only, so
 * two promoters of the same id never silently replace each other's version.
 */

export const SHARED_CINEMATICS_PREFIX = '_shared/cinematics';

export const sharedCinematicKey = (id: string): string =>
	`${SHARED_CINEMATICS_PREFIX}/${r2Slug(id)}.json`;
export const sharedCinematicVersionKey = (id: string, version: number): string =>
	`${SHARED_CINEMATICS_PREFIX}/${r2Slug(id)}.v${version}.json`;

const VERSION_FILE = /\.v\d+\.json$/;

function parseShared(text: string): SharedTimelineDoc | null {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (!isCinematicDoc(parsed)) return null;
		const version = (parsed as { version?: unknown }).version;
		if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
		return parsed as unknown as SharedTimelineDoc;
	} catch {
		return null;
	}
}

/**
 * One shared timeline with the ETag of its latest pointer. `version` given ⇒ that version: its
 * snapshot, else the latest pointer when it is that version, else a starter's version 1. No
 * version ⇒ the latest (an R2 copy shadows a starter of the same id). `etag` is the latest
 * pointer's (`null` = no R2 copy), the precondition a promote of this id writes under.
 */
export async function loadSharedCinematic(
	id: string,
	version?: number,
): Promise<{ doc: SharedTimelineDoc | null; etag: string | null }> {
	const latestObj = await getObjectTextWithEtag(sharedCinematicKey(id));
	const latest = latestObj ? parseShared(latestObj.text) : null;
	const etag = latestObj?.etag ?? null;
	if (version === undefined) return { doc: latest ?? starterTimeline(id), etag };
	if (latest?.version === version) return { doc: latest, etag };
	const snap = await getObjectTextWithEtag(sharedCinematicVersionKey(id, version));
	const pinned = snap ? parseShared(snap.text) : null;
	if (pinned?.version === version) return { doc: pinned, etag };
	return { doc: starterTimeline(id, version), etag };
}

/** The latest version of a shared id (`null` = there is none), for the update badge. */
export async function latestSharedVersion(id: string): Promise<number | null> {
	const { doc } = await loadSharedCinematic(id);
	return doc?.version ?? null;
}

/** Every shared timeline: the R2 copies, then the starters no copy shadows. */
export async function listSharedCinematics(): Promise<SharedTimelineSummary[]> {
	const listed = (await listAllObjects(`${SHARED_CINEMATICS_PREFIX}/`)).filter(
		(o) => o.key.endsWith('.json') && !VERSION_FILE.test(o.key),
	);
	const out: SharedTimelineSummary[] = [];
	for (const entry of listed) {
		const obj = await getObjectTextWithEtag(entry.key);
		const doc = obj ? parseShared(obj.text) : null;
		if (!doc) continue; // a corrupt object must not hide the healthy ones
		out.push(
			summarizeShared(doc, entry.lastModified ? new Date(entry.lastModified).toISOString() : null),
		);
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	for (const s of STARTER_TIMELINES) {
		if (!out.some((row) => row.id === s.id)) out.push(summarizeShared(s, null));
	}
	return out;
}

/** The snapshot a promote wanted to create already holds another author's version. */
export class SharedVersionTakenError extends Error {
	constructor(
		readonly id: string,
		readonly version: number,
	) {
		super(`Version ${version} of shared timeline "${id}" was just written by someone else.`);
		this.name = 'SharedVersionTakenError';
	}
}

/**
 * Promote `content` (already stripped of placement fields, `toSharedContent`) as the next version
 * of shared timeline `content.id`. `baseEtag` is the latest pointer's ETag the promoter saw
 * (`null` ⇒ the id must not exist in R2 yet); a stale one throws `ConflictError` before anything is
 * written. Order: the immutable snapshot first (create-only), then the pointer `If-Match` — so the
 * pointer never names a version that has no snapshot.
 *
 * A snapshot that already exists at the new version is another author's only if the pointer has
 * reached it; otherwise it is an orphan of a promote whose pointer write lost, which no link can
 * pin (links pin what the pointer names), and it is overwritten under its own ETag.
 */
export async function promoteSharedCinematic(
	content: SharedTimelineDoc,
	baseEtag: string | null,
): Promise<{ version: number; etag: string | null }> {
	const id = r2Slug(content.id);
	const current = await getObjectTextWithEtag(sharedCinematicKey(id));
	const currentEtag = current?.etag ?? null;
	if (currentEtag !== baseEtag) throw new ConflictError(sharedCinematicKey(id));
	const latest = current ? parseShared(current.text) : null;
	const base = latest?.version ?? (id.startsWith(STARTER_PREFIX) ? 1 : 0);
	const version = base + 1;
	const doc: SharedTimelineDoc = { ...content, id, version };
	delete doc.starter;
	const body = JSON.stringify(doc, null, '\t');

	const snapKey = sharedCinematicVersionKey(id, version);
	try {
		await putObjectText(snapKey, body, 'application/json', { ifNoneMatch: '*' });
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		const existing = await getObjectTextWithEtag(snapKey);
		const pointer = await getObjectTextWithEtag(sharedCinematicKey(id));
		const reached = (pointer ? parseShared(pointer.text)?.version : undefined) ?? 0;
		if (!existing || reached >= version) throw new SharedVersionTakenError(id, version);
		if (existing.text !== body) {
			try {
				await putObjectText(snapKey, body, 'application/json', precondition(existing.etag));
			} catch (err) {
				if (err instanceof ConflictError) throw new SharedVersionTakenError(id, version);
				throw err;
			}
		}
	}
	const etag = await putObjectText(
		sharedCinematicKey(id),
		body,
		'application/json',
		precondition(baseEtag),
	);
	return { version, etag };
}

/**
 * A project timeline as it plays: a link resolved against its pinned shared version, anything else
 * as stored. `null` when a link's shared version cannot be found (deleted from R2, a typo'd id) —
 * the caller skips it rather than shipping an empty timeline.
 */
export async function resolveProjectCinematic(doc: CinematicDoc): Promise<CinematicDoc | null> {
	const link = linkOf(doc);
	if (!link) return doc;
	const { doc: shared } = await loadSharedCinematic(link.id, link.version);
	if (!shared) return null;
	return resolveLinked(doc as unknown as LayoutCinematicDoc, shared) as unknown as CinematicDoc;
}
