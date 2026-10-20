import type { CinematicDoc as LayoutCinematicDoc } from 'engine-layout';
import {
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
 * `If-Match` the ETag the promoter saw (`null` ⇒ create-only) and is the authority for every
 * version; a snapshot only ever copies the pointer's bytes for its version
 * ({@link promoteSharedCinematic}), so two promoters never silently replace each other's version.
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

/** The latest pointer exists but is not a shared timeline: promoting over it would guess a version. */
export class SharedPointerCorruptError extends Error {
	constructor(readonly id: string) {
		super(`The shared timeline "${id}" is unreadable in storage; repair it before promoting.`);
		this.name = 'SharedPointerCorruptError';
	}
}

/**
 * Make `<id>.v<version>.json` hold exactly `body`, the bytes the latest POINTER holds (or held)
 * for that version. The pointer is the authority for every version it has named: a snapshot only
 * ever copies it, so an existing snapshot with other bytes is a stray (a crash between a pointer
 * write and its snapshot, an old orphan) and is overwritten under its own ETag. A lost race on that
 * overwrite is retried once; whoever wins wrote the same bytes.
 */
async function ensureSnapshot(id: string, version: number, body: string): Promise<void> {
	const key = sharedCinematicVersionKey(id, version);
	for (let attempt = 0; attempt < 2; attempt++) {
		const existing = await getObjectTextWithEtag(key);
		if (existing?.text === body) return;
		try {
			await putObjectText(key, body, 'application/json', precondition(existing?.etag ?? null));
			return;
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
}

/** The highest `<id>.v<N>.json` in storage, for a pointer that was deleted (0 = none). */
async function highestSnapshot(id: string): Promise<number> {
	const prefix = `${SHARED_CINEMATICS_PREFIX}/${r2Slug(id)}.v`;
	let max = 0;
	for (const o of await listAllObjects(prefix)) {
		const m = /\.v(\d+)\.json$/.exec(o.key);
		if (m && o.key === `${prefix}${m[1]}.json`) max = Math.max(max, Number(m[1]));
	}
	return max;
}

/**
 * Promote `content` (already stripped of placement fields, `toSharedContent`) as the next version
 * of shared timeline `content.id`. `baseEtag` is the latest pointer's ETag the promoter saw
 * (`null` ⇒ no R2 copy yet).
 *
 * POINTER FIRST, so the pointer's conditional write is the ONLY race and its loser writes nothing:
 *  1. read the pointer; a stale `baseEtag` is a `ConflictError` before any write, and an
 *     unreadable pointer is refused (its version cannot be known);
 *  2. make the CURRENT version's snapshot hold the pointer's bytes (a crash may have left it
 *     missing), so moving the pointer on never leaves a pinned version unreadable;
 *  3. write the pointer at the next version, `If-Match` `baseEtag`;
 *  4. write that version's snapshot from the same bytes. Until it lands, `loadSharedCinematic`
 *     serves the version from the pointer, and the next promote's step 2 repairs it if it never
 *     does.
 * A snapshot is only ever written with bytes the pointer holds for that version, so a version a
 * link pins never changes. With no pointer (a new id, or one deleted), the next version follows the
 * highest snapshot left in storage, so a deleted pointer never reuses a pinned version number.
 */
export async function promoteSharedCinematic(
	content: SharedTimelineDoc,
	baseEtag: string | null,
): Promise<{ id: string; version: number; etag: string | null }> {
	const id = r2Slug(content.id);
	const current = await getObjectTextWithEtag(sharedCinematicKey(id));
	if ((current?.etag ?? null) !== baseEtag) throw new ConflictError(sharedCinematicKey(id));
	let base: number;
	if (current) {
		const latest = parseShared(current.text);
		if (!latest) throw new SharedPointerCorruptError(id);
		await ensureSnapshot(id, latest.version, current.text);
		base = latest.version;
	} else {
		base = await highestSnapshot(id);
	}
	const version = base + 1;
	const doc: SharedTimelineDoc = { ...content, id, version };
	delete doc.starter;
	const body = JSON.stringify(doc, null, '\t');
	const etag = await putObjectText(
		sharedCinematicKey(id),
		body,
		'application/json',
		precondition(baseEtag),
	);
	await ensureSnapshot(id, version, body);
	return { id, version, etag };
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
