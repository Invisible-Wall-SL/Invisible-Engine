import { eq, sql } from 'drizzle-orm';
import { getAppSetting } from './appSettings';
import { getDb, schema } from './db';
import type { SharedAnimationRefs, SharedRigStats } from './db/schema';
import { sharedAnimationsIndexKey, sharedRigsIndexKey } from './projectPaths';
import { getObjectText } from './r2';

/**
 * The cross-project rig + animation LIBRARY CATALOGS.
 *
 * These used to be two R2 blobs (`_shared/rigs/index.json`,
 * `_shared/animations/index.json`) that four endpoints read-modify-wrote with no
 * guard. Because the keys are GLOBAL — not scoped to a client or project — two
 * users on completely unrelated projects raced and silently dropped each other's
 * rows: the `<id>.json` payload wrote fine, only the catalog entry vanished, so it
 * surfaced as "my rig disappeared" rather than as a failed save. A project lease
 * can never fix that, which is why this is Phase 0 of
 * `docs/design/multi-user-concurrency.md`.
 *
 * Postgres removes the race structurally: an upsert of one row cannot clobber a
 * different row. The heavy bodies stay in R2 — only the catalog moved.
 *
 * ORDERING (deliberate — blob and row are still two non-atomic operations):
 * callers MUST write the blob BEFORE the row on save, and delete the row BEFORE
 * the blob on delete. Both orders fail toward an ORPHANED BLOB (invisible, and
 * garbage-collectable) instead of a DANGLING ROW (a 404 in the user's face when
 * they click a rig that no longer has a body).
 *
 * NOT fixed here (Phase 1's job): a SAME-id concurrent save still last-writer-wins
 * on both the blob and the row, and the two writers can interleave, leaving a row
 * whose `name`/`stats` describe a different skeleton than the blob. The `<id>.json`
 * writes stay unguarded until `If-Match` lands.
 */

/** The catalog row shape returned to the Rigger client. Unchanged from the blob era. */
export interface RigCatalogRow {
	id: string;
	name: string;
	savedAt: string;
	source: { client: string; project: string; rig: string | null };
	stats: SharedRigStats;
}

export interface AnimationCatalogRow {
	id: string;
	name: string;
	savedAt: string;
	source: { client: string; project: string; rig: string | null };
	refs: SharedAnimationRefs;
	duration: number;
}

export interface RigCatalogInput {
	id: string;
	name: string;
	/** ISO string — the SAME stamp written into the `<id>.json` blob, so the two agree. */
	savedAt: string;
	source: { client: string; project: string; rig: string | null };
	stats: SharedRigStats;
}

export interface AnimationCatalogInput {
	id: string;
	name: string;
	savedAt: string;
	source: { client: string; project: string; rig: string | null };
	refs: SharedAnimationRefs;
	duration: number;
}

const byName = (a: { name: string }, b: { name: string }) =>
	(a.name || '').localeCompare(b.name || '');

export async function listRigs(): Promise<RigCatalogRow[]> {
	await backfillBestEffort();
	const rows = await getDb().select().from(schema.sharedRigs);
	return rows
		.map((r) => ({
			id: r.id,
			name: r.name,
			savedAt: r.savedAt.toISOString(),
			source: { client: r.sourceClient, project: r.sourceProject, rig: r.sourceRig },
			stats: r.stats,
		}))
		.sort(byName);
}

/** Upsert one rig catalog row. Call AFTER the `<id>.json` blob is written. */
export async function saveRig(input: RigCatalogInput): Promise<void> {
	// No backfill needed: a concurrent in-flight import uses `onConflictDoNothing`,
	// so this fresher row always wins over the legacy one.
	const values = {
		id: input.id,
		name: input.name,
		savedAt: parseDate(input.savedAt),
		sourceClient: input.source.client,
		sourceProject: input.source.project,
		sourceRig: input.source.rig,
		stats: input.stats,
	};
	await getDb()
		.insert(schema.sharedRigs)
		.values(values)
		.onConflictDoUpdate({ target: schema.sharedRigs.id, set: values });
}

/**
 * Drop one rig catalog row. Call BEFORE deleting the `<id>.json` blob.
 *
 * Awaits the backfill and lets its failure PROPAGATE (unlike the list path, which
 * fails safe): deleting while the legacy import is still pending would delete a row
 * that does not exist yet, and the import would then re-create it — resurrecting the
 * rig as a DANGLING row pointing at an already-deleted blob. Failing the delete is
 * honest and the window is seconds-after-deploy; a silent resurrection is not.
 */
export async function deleteRig(id: string): Promise<void> {
	await backfillOnce();
	await getDb().delete(schema.sharedRigs).where(eq(schema.sharedRigs.id, id));
}

export async function listAnimations(): Promise<AnimationCatalogRow[]> {
	await backfillBestEffort();
	const rows = await getDb().select().from(schema.sharedAnimations);
	return rows
		.map((r) => ({
			id: r.id,
			name: r.name,
			savedAt: r.savedAt.toISOString(),
			source: { client: r.sourceClient, project: r.sourceProject, rig: r.sourceRig },
			refs: r.refs,
			duration: r.duration,
		}))
		.sort(byName);
}

/** Upsert one animation catalog row. Call AFTER the `<id>.json` blob is written. */
export async function saveAnimation(input: AnimationCatalogInput): Promise<void> {
	const values = {
		id: input.id,
		name: input.name,
		savedAt: parseDate(input.savedAt),
		sourceClient: input.source.client,
		sourceProject: input.source.project,
		sourceRig: input.source.rig,
		refs: input.refs,
		duration: input.duration,
	};
	await getDb()
		.insert(schema.sharedAnimations)
		.values(values)
		.onConflictDoUpdate({ target: schema.sharedAnimations.id, set: values });
}

/** Drop one animation catalog row. Call BEFORE deleting the blob. See {@link deleteRig}. */
export async function deleteAnimation(id: string): Promise<void> {
	await backfillOnce();
	await getDb().delete(schema.sharedAnimations).where(eq(schema.sharedAnimations.id, id));
}

// ---------------------------------------------------------------------------
// One-shot backfill from the retired index blobs.
// ---------------------------------------------------------------------------

const BACKFILL_MARKER = 'riggerLibraryBackfilled';

/** Arbitrary constant keying the advisory lock that serializes the one-shot import. */
const BACKFILL_LOCK_ID = 8317231;

/**
 * Ceiling on each legacy-blob read. The S3 client is built with no `requestHandler`
 * (`r2.ts`), and smithy's `DEFAULT_REQUEST_TIMEOUT` is **0** — i.e. a hung R2 socket
 * never settles on its own. An unbounded read here would hang the list request.
 */
const BACKFILL_READ_TIMEOUT_MS = 10_000;

/** After a failed attempt, don't retry the import until this many ms have passed. */
const BACKFILL_RETRY_COOLDOWN_MS = 60_000;

/** Set once the marker is confirmed, to skip a DB round-trip per list thereafter. */
let backfilled = false;

/** Epoch ms before which a retry is suppressed (set after a failed attempt). */
let retryAfter = 0;

/**
 * Run the legacy import, tolerating failure — for the READ paths.
 *
 * The list endpoints must NEVER die because R2 is unhappy: `getObjectText` rethrows
 * everything except a 404, and `static/rigger/view.html` catches a failed list and
 * renders "No saved rigs yet" — so an unhandled throw here would make a transient R2
 * blip reproduce the exact "my rig vanished" symptom this whole phase exists to
 * remove, on a catalog that no longer even lives in R2. Fails safe, same as
 * `getDeployToken` in `appSettings.ts`. The marker stays unset, so a later list
 * retries the import.
 */
async function backfillBestEffort(): Promise<void> {
	try {
		await backfillOnce();
	} catch (err) {
		console.warn(
			'[riggerLibrary] legacy index backfill skipped (serving the Postgres catalog as-is):',
			err instanceof Error ? err.message : err,
		);
	}
}

/**
 * Import the legacy `_shared/{rigs,animations}/index.json` rows into Postgres,
 * exactly once, on first read after deploy. Lazy (not a manual script step) so the
 * library is never briefly EMPTY for users between the migration and someone
 * remembering to run a backfill.
 *
 * Gated on a marker row in `app_settings`, NOT on the tables being empty — an
 * empty-table check would RESURRECT every deleted rig the moment a user deleted the
 * last one. The marker is written even when the blobs are absent (a fresh install).
 *
 * The DB work runs in ONE transaction behind an advisory lock, re-checking the marker
 * INSIDE the lock — that re-check, not the blob read, is what closes the resurrection
 * race: once any importer commits the marker, every other importer discards whatever
 * it read and inserts nothing, so a delete can never be undone by a straggler.
 *
 * The R2 reads deliberately happen BEFORE the transaction opens. Holding a pooled
 * connection + a global advisory lock across R2 I/O would let one hung R2 socket
 * (which never times out — see {@link BACKFILL_READ_TIMEOUT_MS}) stall every DB query
 * in the app, including the session lookup behind the auth gate. A one-shot rig
 * import must not be able to take down login. Reading first costs nothing: a stale
 * read is discarded by the marker re-check.
 *
 * The legacy blobs are deliberately LEFT IN PLACE — the marker already prevents a
 * re-import, and they are the only record of what the catalog held at migration time.
 * Retiring them is a follow-up (see the design doc).
 */
async function backfillOnce(): Promise<void> {
	if (backfilled) return;
	if (await getAppSetting(BACKFILL_MARKER)) {
		backfilled = true;
		return;
	}
	if (Date.now() < retryAfter) {
		throw new Error('rigger-library backfill is cooling down after a recent failure');
	}

	// OUTSIDE the transaction, and bounded — see the docstring.
	let rigs: RigInsert[];
	let animations: AnimationInsert[];
	try {
		rigs = parseLegacyRigs(await readLegacyBlob(sharedRigsIndexKey));
		animations = parseLegacyAnimations(await readLegacyBlob(sharedAnimationsIndexKey));
	} catch (err) {
		retryAfter = Date.now() + BACKFILL_RETRY_COOLDOWN_MS;
		throw err;
	}

	let importedRigs = 0;
	let importedAnimations = 0;
	await getDb().transaction(async (tx) => {
		// Serializes concurrent importers AND blocks deletes until the import commits.
		// `xact` scope → released automatically on commit/rollback. The `::bigint` cast
		// is belt-and-braces: the driver sends the param untyped and Postgres would
		// resolve it against the sole 1-arg overload anyway, but the cast makes the
		// intended type explicit rather than inferred.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${BACKFILL_LOCK_ID}::bigint)`);

		const [claimed] = await tx
			.select({ key: schema.appSettings.key })
			.from(schema.appSettings)
			.where(eq(schema.appSettings.key, BACKFILL_MARKER))
			.limit(1);
		if (claimed) return;

		if (rigs.length > 0) {
			const inserted = await tx
				.insert(schema.sharedRigs)
				.values(rigs)
				.onConflictDoNothing()
				.returning({ id: schema.sharedRigs.id });
			importedRigs = inserted.length;
		}
		if (animations.length > 0) {
			const inserted = await tx
				.insert(schema.sharedAnimations)
				.values(animations)
				.onConflictDoNothing()
				.returning({ id: schema.sharedAnimations.id });
			importedAnimations = inserted.length;
		}

		await tx
			.insert(schema.appSettings)
			.values({ key: BACKFILL_MARKER, value: new Date().toISOString() })
			.onConflictDoNothing();
	});
	backfilled = true;
	// Logged AFTER commit, with the rows actually inserted (not the rows parsed —
	// `onConflictDoNothing` skips any a live save already wrote). This line is the only
	// operational evidence the one-shot ran, so it must not overstate.
	console.log(
		`[riggerLibrary] legacy index backfill complete: imported ${importedRigs} rig(s), ` +
			`${importedAnimations} animation(s)`,
	);
}

/**
 * Read one legacy index blob with a hard ceiling. `getObjectText` inherits the S3
 * client's zero request timeout, so without this a hung R2 socket would hang the
 * caller forever rather than falling through to the Postgres catalog.
 */
async function readLegacyBlob(key: string): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			getObjectText(key),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`R2 read of ${key} exceeded ${BACKFILL_READ_TIMEOUT_MS}ms`)),
					BACKFILL_READ_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Coerce a `savedAt` to a Date, falling back to the epoch. Used on BOTH the legacy
 * import (rows predating any validation) and the live save path — an unvalidated
 * `new Date(str)` yields `Invalid Date`, which drizzle stringifies via `toISOString()`
 * and throws a bare `RangeError` 500 on. A visibly-wrong date beats a 500.
 */
function parseDate(v: unknown): Date {
	if (typeof v === 'string') {
		const d = new Date(v);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return new Date(0);
}

function parseSource(v: unknown): { client: string; project: string; rig: string | null } {
	const s = isRecord(v) ? v : {};
	return {
		client: typeof s.client === 'string' ? s.client : '',
		project: typeof s.project === 'string' ? s.project : '',
		rig: typeof s.rig === 'string' && s.rig ? s.rig : null,
	};
}

function asStrings(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Coerce to a finite, non-negative number (counts + durations); 0 otherwise. */
function asNumber(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

type RigInsert = typeof schema.sharedRigs.$inferInsert;
type AnimationInsert = typeof schema.sharedAnimations.$inferInsert;

function parseLegacyRigs(raw: string | null): RigInsert[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const list = isRecord(parsed) && Array.isArray(parsed.rigs) ? parsed.rigs : [];
	const out: RigInsert[] = [];
	for (const row of list) {
		if (!isRecord(row) || typeof row.id !== 'string' || !row.id) continue;
		const stats = isRecord(row.stats) ? row.stats : {};
		const source = parseSource(row.source);
		out.push({
			id: row.id,
			name: typeof row.name === 'string' ? row.name : row.id,
			savedAt: parseDate(row.savedAt),
			sourceClient: source.client,
			sourceProject: source.project,
			sourceRig: source.rig,
			stats: {
				bones: asNumber(stats.bones),
				slots: asNumber(stats.slots),
				skins: asNumber(stats.skins),
				animations: asStrings(stats.animations),
			},
		});
	}
	return out;
}

function parseLegacyAnimations(raw: string | null): AnimationInsert[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const list = isRecord(parsed) && Array.isArray(parsed.animations) ? parsed.animations : [];
	const out: AnimationInsert[] = [];
	for (const row of list) {
		if (!isRecord(row) || typeof row.id !== 'string' || !row.id) continue;
		const refs = isRecord(row.refs) ? row.refs : {};
		const source = parseSource(row.source);
		out.push({
			id: row.id,
			name: typeof row.name === 'string' ? row.name : row.id,
			savedAt: parseDate(row.savedAt),
			sourceClient: source.client,
			sourceProject: source.project,
			sourceRig: source.rig,
			refs: {
				bones: asStrings(refs.bones),
				slots: asStrings(refs.slots),
				events: asStrings(refs.events),
			},
			duration: asNumber(row.duration),
		});
	}
	return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
