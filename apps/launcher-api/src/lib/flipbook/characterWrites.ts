/**
 * THE WRITES OF INVISIBLE FLIPBOOK'S CHARACTERS MODE: many clips made at once, one Bounds box put
 * on every clip of a character, and a copy of a misnamed clip under the right name. Each is a
 * run of ordinary clip saves through `/api/flipbook/save`, one per clip, and each save is
 * conditional (`docs/design/multi-user-concurrency.md`):
 *
 *  - a NEW clip is saved with `baseEtag: null`, which asserts no clip has that id; a clip that
 *    does is reported `exists` and left as it is. Nothing here ever sends `force`;
 *  - a SAVED clip is read fresh and saved back with only its box changed, against the ETag it was
 *    read at, under its edit lease: a clip someone else has open, or one saved in between, is
 *    reported `refused` and left as it is.
 *
 * One result per clip, in order. The transport is injected, so the gate runs these in Node.
 */
import type { FlipbookBounds, FlipbookClip } from 'engine-flipbook';

import { boundsDiffer, clipIdOf } from './characterSet';

export type ClipRead =
	{ clip: FlipbookClip; etag: string | null } | { status: number; message: string };
/** `error` is the endpoint's own code for a 409 (`conflict`, `scope-mismatch`). */
export type ClipSaved =
	{ id: string; etag: string | null } | { status: number; error?: string; message: string };
export type ClipLease = { held: true; release: () => void } | { held: false; by: string };

export interface ClipWrites {
	read: (id: string) => Promise<ClipRead>;
	save: (clip: FlipbookClip, baseEtag: string | null) => Promise<ClipSaved>;
	/** A saved clip's edit lease, taken for one write. */
	lease: (id: string) => Promise<ClipLease>;
}

export interface ClipWriteResult {
	id: string;
	outcome: 'created' | 'exists' | 'updated' | 'unchanged' | 'refused';
	/** Why, for `refused`. */
	note?: string;
}

/** What a run of writes changed, for the page around the mode: new clips for its list, and saved
 *  clips whose stored doc moved (the one open in Clips mode is read again). */
export interface CharacterWritten {
	created: { id: string; name: string; frames: number }[];
	updated: string[];
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function failure(
	res: Response,
	fallback: string,
): Promise<{ error?: string; message: string }> {
	const body = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
	return {
		...(typeof body.error === 'string' ? { error: body.error } : {}),
		message: typeof body.message === 'string' ? body.message : fallback,
	};
}

/** The read and the save over the tool's own endpoints, for the project the tab is in. */
export function fetchClipWrites(
	fetchFn: FetchLike,
	projectKey: string,
): Pick<ClipWrites, 'read' | 'save'> {
	return {
		read: async (id) => {
			const qs = new URLSearchParams({ id, project: projectKey });
			const res = await fetchFn(`/api/flipbook/clip?${qs}`);
			if (!res.ok) {
				const { message } = await failure(res, `Could not read it (HTTP ${res.status}).`);
				return { status: res.status, message };
			}
			const out = (await res.json()) as { clip: FlipbookClip; etag?: string | null };
			return { clip: out.clip, etag: out.etag ?? null };
		},
		save: async (clip, baseEtag) => {
			const res = await fetchFn('/api/flipbook/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ clip, projectKey, baseEtag }),
			});
			if (!res.ok)
				return {
					status: res.status,
					...(await failure(res, `Save failed (HTTP ${res.status}).`)),
				};
			const out = (await res.json()) as { id: string; etag?: string | null };
			return { id: out.id, etag: out.etag ?? null };
		},
	};
}

const refused = (id: string, note: string): ClipWriteResult => ({ id, outcome: 'refused', note });

/** Whether a failed save lost to a clip already stored under that id. */
const lostToStored = (saved: { status: number; error?: string }): boolean =>
	saved.status === 409 && saved.error !== 'scope-mismatch';

async function createClip(clip: FlipbookClip, writes: ClipWrites): Promise<ClipWriteResult> {
	if (clipIdOf(clip.id) !== clip.id)
		return refused(clip.id, 'Not a name a clip can be saved under (a-z, 0-9 and _, 60 at most).');
	const saved = await writes.save(clip, null);
	if ('status' in saved)
		return lostToStored(saved)
			? { id: clip.id, outcome: 'exists' }
			: refused(clip.id, saved.message);
	return saved.id === clip.id
		? { id: clip.id, outcome: 'created' }
		: refused(clip.id, `Saved as "${saved.id}", not under the name asked for.`);
}

/** Make each clip, never over one that is there. `step` is told after each. */
export async function createClips(
	clips: readonly FlipbookClip[],
	writes: ClipWrites,
	step?: (done: number) => void,
): Promise<ClipWriteResult[]> {
	const out: ClipWriteResult[] = [];
	for (const clip of clips) {
		out.push(await createClip(clip, writes));
		step?.(out.length);
	}
	return out;
}

/** A copy of a saved clip under `name`. The source is not touched: an id is fixed at a clip's
 *  first save, so the misnamed one is the author's to delete. */
export async function copyClipAs(
	sourceId: string,
	name: string,
	writes: ClipWrites,
): Promise<ClipWriteResult> {
	const read = await writes.read(sourceId);
	if ('status' in read) return refused(name, `"${sourceId}": ${read.message}`);
	return createClip({ ...read.clip, id: name, name }, writes);
}

/**
 * Put one Bounds box on each clip of `ids`. `leaveAlone` names a reason not to write a clip at
 * all (it is open in this tab with edits not yet saved).
 */
export async function applyBoundsToClips(
	ids: readonly string[],
	bounds: FlipbookBounds,
	writes: ClipWrites,
	{
		leaveAlone,
		step,
	}: { leaveAlone?: (id: string) => string | undefined; step?: (done: number) => void } = {},
): Promise<ClipWriteResult[]> {
	const out: ClipWriteResult[] = [];
	const apply = async (id: string): Promise<ClipWriteResult> => {
		const reason = leaveAlone?.(id);
		if (reason) return refused(id, reason);
		const lease = await writes.lease(id);
		if (!lease.held) return refused(id, `${lease.by} has it open.`);
		try {
			const read = await writes.read(id);
			if ('status' in read) return refused(id, read.message);
			if (read.clip.bounds && boundsDiffer(read.clip.bounds, bounds).length === 0)
				return { id, outcome: 'unchanged' };
			if (read.etag === null) return refused(id, 'Its stored version could not be read.');
			const saved = await writes.save({ ...read.clip, bounds: { ...bounds } }, read.etag);
			if (!('status' in saved)) return { id, outcome: 'updated' };
			return refused(
				id,
				lostToStored(saved) ? 'It was saved somewhere else just now. Apply again.' : saved.message,
			);
		} finally {
			lease.release();
		}
	};
	for (const id of ids) {
		out.push(await apply(id));
		step?.(out.length);
	}
	return out;
}
