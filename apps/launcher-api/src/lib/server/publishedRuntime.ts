/**
 * Published runtime snapshots — what a PLAYER boots.
 *
 * Publish assembles the project's runtime bundle ONCE and freezes it, together with the `deploy/`
 * files it points at, as an immutable snapshot. A player boot then reads that snapshot instead of
 * re-running every exporter (`runtimeBundle.ts`, ~20-26s for a real project), and an autosave made
 * after Publish — a half-finished edit, a flow the publish gate would now refuse — never reaches a
 * player until someone publishes it. Authoring boots (`ie_authoring=1`) keep the live assemble.
 *
 * R2 layout, under `<client>/<project>/published/`:
 *
 *   pointer.json            { version, current, snapshots[] }   — the ONLY mutable object
 *   <id>/runtime.json       the RuntimeBundle as assembled at publish (no `assetBase`/`name`)
 *   <id>/deploy/**          a server-side copy of `deploy/` taken under the same lock
 *
 * WHY A FULL COPY OF `deploy/` rather than content-hashed names. The assemble rewrites `deploy/` IN
 * PLACE: stems keep their names across exports (`editor-art/<stem>/<stem>.json`), and the `_pages/`
 * prune deletes every page the latest export did not claim. A snapshot that pointed into the live
 * tree would therefore change or lose files under a running game on the next authoring boot. The
 * alternatives were content-hashing every exporter's output (a rewrite of ~10 exporters, and atlas →
 * page references are RELATIVE, so every parent file would need re-pointing) or sharing `_pages/`
 * with a pin set the prune must respect (couples the exporters to this module; deleting a page that
 * is still referenced is the worst failure the prune has). A copy keeps the relative tree intact,
 * is correct by construction, and garbage-collects by deleting one prefix.
 *
 * Cost, measured 2026-09-29: a real project's `deploy/` is 130-200 MB in 240-430 objects. The copy
 * is server-side (`CopyObject` — no bytes through this process, one Class A op each), so a publish
 * costs ~430 ops and a few seconds; keeping {@link RETAINED_SNAPSHOTS} snapshots stores ≤1 GB per
 * project, i.e. cents per month at R2's storage price. Re-evaluate if projects grow 10×.
 *
 * Concurrency: staging runs inside `withDeployWrite` (see `publishGame.ts`), so within this process
 * a project's `deploy/` is never copied while another assemble rewrites it. The COMMIT runs later,
 * after the game is registered, so a publish that fails half-way never switches players. The pointer
 * is written with a CAS (a second launcher replica would not share the lock, and rollback does not
 * take it), and a snapshot folder is deleted only once a committed pointer no longer names it — an
 * unreferenced folder younger than {@link ORPHAN_AGE_MS} may be another publish's staged, not-yet-
 * committed snapshot, and is left alone.
 */
import type { RuntimeBundle } from './runtimeBundle';
import { mapWithConcurrency } from './concurrency';
import { SUB } from './projectPaths';
import {
	ConflictError,
	copyObject,
	deleteObjects,
	getObjectTextWithEtag,
	listAllKeys,
	listAllObjects,
	listObjects,
	precondition,
	putObjectText,
} from './r2';

/** Snapshots kept per project: the current one plus four to roll back to. */
export const RETAINED_SNAPSHOTS = 5;

/** Parallel `CopyObject`s while staging. Server-side copies, so this bounds request fan-out only. */
const COPY_CONCURRENCY = 16;

/**
 * An unreferenced snapshot folder is only swept once it is this old: younger, it may be a concurrent
 * publish's staged snapshot waiting for its commit (a publish takes ~30s end to end).
 */
const ORPHAN_AGE_MS = 60 * 60_000;

/** `20260929T101530Z-3fa9` — sortable by time, unique enough for one project's publishes. */
const SNAPSHOT_ID = /^\d{8}T\d{6}Z-[0-9a-f]{4}$/;

export function isSnapshotId(id: string): boolean {
	return SNAPSHOT_ID.test(id);
}

/** When a snapshot id was minted (its timestamp prefix), in epoch ms. */
function snapshotIdTime(id: string): number {
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(id);
	return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}

export function newSnapshotId(now = new Date()): string {
	const stamp = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');
	const rand = Math.floor(Math.random() * 0x10000)
		.toString(16)
		.padStart(4, '0');
	return `${stamp}-${rand}`;
}

export interface SnapshotMeta {
	id: string;
	/** ISO time the snapshot was assembled. */
	createdAt: string;
	/** Email of whoever published it, when known. */
	by: string | null;
	/** The flow gate's verdict on the flow this snapshot ships. */
	flow: 'absent' | 'valid' | 'overridden';
	/** The shared engine runtime the game was served from when this was published. */
	runtime: string;
	/** Objects + bytes copied from `deploy/`. */
	files: number;
	bytes: number;
}

export interface PublishedPointer {
	version: 1;
	/** The snapshot players boot. Always one of {@link snapshots}. */
	current: string;
	/** Newest first, at most {@link RETAINED_SNAPSHOTS}. */
	snapshots: SnapshotMeta[];
}

const publishedPrefix = (client: string, project: string) => `${SUB.published(client, project)}/`;
const pointerKey = (client: string, project: string) =>
	`${publishedPrefix(client, project)}pointer.json`;
const snapshotPrefix = (client: string, project: string, id: string) =>
	`${publishedPrefix(client, project)}${id}/`;

/** R2 key of one file inside a snapshot's frozen `deploy/` copy. */
export function snapshotDeployKey(
	client: string,
	project: string,
	id: string,
	rel: string,
): string {
	return `${snapshotPrefix(client, project, id)}deploy/${rel}`;
}

function parsePointer(text: string): PublishedPointer | null {
	try {
		const p = JSON.parse(text) as Partial<PublishedPointer>;
		if (typeof p.current !== 'string' || !Array.isArray(p.snapshots)) return null;
		return { version: 1, current: p.current, snapshots: p.snapshots };
	} catch {
		return null;
	}
}

async function readPointer(
	client: string,
	project: string,
): Promise<{ pointer: PublishedPointer | null; etag: string | null } | null> {
	const got = await getObjectTextWithEtag(pointerKey(client, project));
	if (!got) return null;
	return { pointer: parsePointer(got.text), etag: got.etag };
}

// ---------------------------------------------------------------------------------------------
// Read side (the player boot). Both caches are safe to hold for a long time: a snapshot is
// immutable by id, and the pointer is only ever changed by this module, which drops the entry.
// ---------------------------------------------------------------------------------------------

/**
 * How long the pointer is trusted without re-reading it. Publish and rollback in THIS process drop
 * the entry immediately; the TTL only bounds how long a second replica could lag behind them.
 */
const POINTER_TTL_MS = 30_000;
const pointerCache = new Map<string, { pointer: PublishedPointer | null; at: number }>();
/** Bumped by every pointer write, so a read that raced it cannot cache what it read before. */
const pointerGeneration = new Map<string, number>();

/** Parsed snapshot bundles, keyed `<client>/<project>/<id>`. ~200 KB each, so a small LRU. */
const MAX_CACHED_BUNDLES = 12;
const bundleCache = new Map<string, RuntimeBundle>();

const cacheKey = (client: string, project: string) => `${client}/${project}`;

/** The project's published pointer, or null when it has never been published as a snapshot. */
export async function currentPointer(
	client: string,
	project: string,
): Promise<PublishedPointer | null> {
	const key = cacheKey(client, project);
	const hit = pointerCache.get(key);
	if (hit && Date.now() - hit.at < POINTER_TTL_MS) return hit.pointer;
	const generation = pointerGeneration.get(key) ?? 0;
	const read = await readPointer(client, project);
	const pointer = read?.pointer ?? null;
	if ((pointerGeneration.get(key) ?? 0) === generation) {
		pointerCache.set(key, { pointer, at: Date.now() });
	}
	return pointer;
}

/** A snapshot's frozen bundle, or null when its `runtime.json` is gone. */
export async function readSnapshotBundle(
	client: string,
	project: string,
	id: string,
): Promise<RuntimeBundle | null> {
	const key = `${cacheKey(client, project)}/${id}`;
	const hit = bundleCache.get(key);
	if (hit) {
		// Re-insert so eviction is least-recently-USED, not least-recently-stored.
		bundleCache.delete(key);
		bundleCache.set(key, hit);
		return hit;
	}
	const got = await getObjectTextWithEtag(`${snapshotPrefix(client, project, id)}runtime.json`);
	if (!got) return null;
	let bundle: RuntimeBundle;
	try {
		bundle = JSON.parse(got.text) as RuntimeBundle;
	} catch {
		return null;
	}
	bundleCache.set(key, bundle);
	while (bundleCache.size > MAX_CACHED_BUNDLES) {
		const oldest = bundleCache.keys().next();
		if (oldest.done) break;
		bundleCache.delete(oldest.value);
	}
	return bundle;
}

// ---------------------------------------------------------------------------------------------
// Write side (Publish, rollback). Only staging needs `withDeployWrite(projectKey)`; the pointer
// writes are CAS-guarded on their own.
// ---------------------------------------------------------------------------------------------

async function deletePrefix(prefix: string): Promise<void> {
	await deleteObjects(await listAllKeys(prefix));
}

/** Drop a staged snapshot that will never be committed (its publish failed after staging). */
export async function discardSnapshot(client: string, project: string, id: string): Promise<void> {
	await deletePrefix(snapshotPrefix(client, project, id));
}

/**
 * Freeze `bundle` + the current `deploy/` tree as a new, NOT YET LIVE snapshot. The caller must
 * have assembled `bundle` under the same `withDeployWrite` it holds now, so the copy is of exactly
 * the tree that assemble wrote. On failure the partial copy is removed and the error rethrown.
 */
export async function stageSnapshot(
	client: string,
	project: string,
	bundle: RuntimeBundle,
	meta: Pick<SnapshotMeta, 'by' | 'flow' | 'runtime'>,
): Promise<SnapshotMeta> {
	const id = newSnapshotId();
	const deployPrefix = `${SUB.deploy(client, project)}/`;
	const prefix = snapshotPrefix(client, project, id);
	try {
		const objects = (await listAllObjects(deployPrefix)).filter((o) => !o.key.endsWith('/'));
		await mapWithConcurrency(objects, COPY_CONCURRENCY, async (o) => {
			const rel = o.key.slice(deployPrefix.length);
			// Listed a moment ago, gone now: something rewrote deploy/ outside the lock. Freezing the
			// hole would ship it to every player until the next publish, so fail loudly instead.
			if (!(await copyObject(o.key, `${prefix}deploy/${rel}`))) {
				throw new Error(`deploy/${rel} vanished while being snapshotted — publish again`);
			}
		});
		// Written LAST: a snapshot without its `runtime.json` is never served, so a crash mid-copy
		// leaves an orphan for the next commit to sweep, never a half-populated live snapshot.
		await putObjectText(`${prefix}runtime.json`, JSON.stringify(bundle), 'application/json');
		return {
			id,
			createdAt: new Date().toISOString(),
			...meta,
			files: objects.length,
			bytes: objects.reduce((sum, o) => sum + o.size, 0),
		};
	} catch (e) {
		await deletePrefix(prefix).catch(() => undefined);
		throw e;
	}
}

/**
 * The retention rule, pure so it can be checked offline: newest first, capped at
 * {@link RETAINED_SNAPSHOTS}, and never dropping `current` — a game rolled back to an old snapshot
 * keeps it even when newer ones would otherwise push it out.
 */
export function retain(snapshots: SnapshotMeta[], current: string): SnapshotMeta[] {
	const sorted = [...snapshots].sort((a, b) => b.id.localeCompare(a.id));
	const kept = sorted.slice(0, RETAINED_SNAPSHOTS);
	if (!kept.some((s) => s.id === current)) {
		const cur = sorted.find((s) => s.id === current);
		if (cur) kept.splice(RETAINED_SNAPSHOTS - 1, 1, cur);
	}
	return kept;
}

/**
 * CAS-update the pointer with `change`, retrying on a lost race. Returns the committed pointer and
 * the snapshots it no longer references.
 */
async function updatePointer(
	client: string,
	project: string,
	change: (prev: PublishedPointer | null) => PublishedPointer,
): Promise<{ pointer: PublishedPointer; dropped: SnapshotMeta[] }> {
	for (let attempt = 0; ; attempt++) {
		const read = await readPointer(client, project);
		const prev = read?.pointer ?? null;
		const next = change(prev);
		next.snapshots = retain(next.snapshots, next.current);
		try {
			// A corrupt pointer is overwritten deliberately (CAS on its etag); an absent one is created.
			await putObjectText(
				pointerKey(client, project),
				JSON.stringify(next, null, '\t'),
				'application/json',
				precondition(read ? read.etag : null),
			);
		} catch (e) {
			if (e instanceof ConflictError && attempt < 4) continue;
			throw e;
		}
		const key = cacheKey(client, project);
		pointerGeneration.set(key, (pointerGeneration.get(key) ?? 0) + 1);
		pointerCache.delete(key);
		if (read && !prev) {
			console.warn(`[published] ${project}: pointer.json was unreadable — rewritten, history lost`);
		}
		const keptIds = new Set(next.snapshots.map((s) => s.id));
		return { pointer: next, dropped: (prev?.snapshots ?? []).filter((s) => !keptIds.has(s.id)) };
	}
}

/**
 * Remove snapshot folders the pointer no longer references: the ones retention just dropped, plus
 * orphans (a crashed or failed stage) older than {@link ORPHAN_AGE_MS}. Runs after the pointer
 * commit, so it can never delete the snapshot players are on. Best effort: a leftover folder costs
 * storage, not correctness.
 */
async function sweep(
	client: string,
	project: string,
	pointer: PublishedPointer,
	dropped: SnapshotMeta[],
): Promise<void> {
	const keep = new Set(pointer.snapshots.map((s) => s.id));
	const droppedIds = new Set(dropped.map((s) => s.id));
	const { prefixes } = await listObjects(publishedPrefix(client, project));
	const stale = prefixes.filter((p) => {
		const id = p.slice(publishedPrefix(client, project).length).replace(/\/$/, '');
		if (!isSnapshotId(id) || keep.has(id)) return false;
		return droppedIds.has(id) || Date.now() - snapshotIdTime(id) > ORPHAN_AGE_MS;
	});
	for (const p of stale) await deletePrefix(p);
}

/** Make a staged snapshot the one players boot, then garbage-collect beyond retention. */
export async function commitSnapshot(
	client: string,
	project: string,
	meta: SnapshotMeta,
): Promise<PublishedPointer> {
	const { pointer, dropped } = await updatePointer(client, project, (prev) => ({
		version: 1,
		current: meta.id,
		snapshots: [meta, ...(prev?.snapshots ?? [])],
	}));
	await sweep(client, project, pointer, dropped).catch((e) =>
		console.warn(`[published] ${project}: snapshot sweep failed (storage only):`, e),
	);
	return pointer;
}

export class UnknownSnapshotError extends Error {
	constructor(id: string) {
		super(`Snapshot ${id} is not one of this game's retained published versions.`);
		this.name = 'UnknownSnapshotError';
	}
}

/** A rollback the caller's `guard` refused — e.g. a non-owner reviving a flow-override version. */
export class RollbackRefusedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RollbackRefusedError';
	}
}

/**
 * Point players back at a retained snapshot. A pure pointer flip: nothing is assembled or copied,
 * so it takes effect on the next boot and can itself be undone the same way. `guard` sees the
 * target's metadata inside the CAS loop and returns a refusal message, or null to proceed.
 */
export async function rollbackSnapshot(
	client: string,
	project: string,
	id: string,
	guard: (target: SnapshotMeta) => string | null = () => null,
): Promise<PublishedPointer> {
	const { pointer } = await updatePointer(client, project, (prev) => {
		const target = prev?.snapshots.find((s) => s.id === id);
		if (!prev || !target) throw new UnknownSnapshotError(id);
		const refusal = guard(target);
		if (refusal) throw new RollbackRefusedError(refusal);
		return { ...prev, current: id };
	});
	return pointer;
}
