import {
	EDITOR_DOC_BACKUP_ID_RE,
	editorDocBackupId,
	editorDocBackupKey,
	editorDocBackupSavedAt,
	editorDocBackupsPrefix,
	editorDocKey,
} from './projectPaths';
import { copyObject, deleteObjects, getObjectText, headObject, listAllObjects } from './r2';

/**
 * Rolling backups for the Scene Editor doc — the "a save is no longer destructive" layer.
 *
 * WHY THIS EXISTS. `editorStorage.saveDoc` PUTs the whole `scenes.json` blob, and the editor
 * fires it 1.2 s after any panel edit. The ETag CAS (`precondition(baseEtag)`) stops author A
 * clobbering author B, but it does nothing at all about author A clobbering author A: a bad
 * edit, a scaffold/reference load, or an accepted "overwrite theirs" is a normal, well-guarded,
 * completely unrecoverable write. This module preserves the PREVIOUS bytes before each such
 * write so there is something to go back to.
 *
 * ── THE WRITE ORDERING, and why the forever-409 landmine cannot recur ────────────────────────
 *
 * The backup is taken BEFORE the doc PUT. That is not a preference, it is the only option:
 * R2 object versioning is not enabled on this bucket, so the previous bytes exist only until
 * the PUT lands. A "copy after" would copy the new bytes and preserve nothing.
 *
 * So a lost CAS (the PUT 409s) necessarily leaves a backup of bytes that were NOT overwritten —
 * an orphan. `docs/design/multi-user-concurrency.md` records exactly how an orphan turned into
 * a permanent 409 for the component snapshots, so state plainly why it cannot here:
 *
 *  1. **Nothing recomputes a backup key.** The component scheme's `<id>.v<N>.json` is derived
 *     by reading the stored version and adding one, so EVERY later save re-derives the orphan's
 *     key, collides, and fails — forever, unforceably. A backup key is derived from the clock
 *     and from the ETag of the object being copied (see `editorDocBackupId`). No later save can
 *     ever re-derive an earlier save's key, because no later save asks "what came before".
 *  2. **Backup writes carry NO precondition.** Even a key that did repeat could not fail:
 *     `copyObject` is unconditional. There is no 409 to inherit. (And a repeat can only happen
 *     for the same prior ETag inside the same millisecond, i.e. byte-identical content — an
 *     idempotent overwrite, not a collision.)
 *  3. **An orphan is inert, and it is not even wrong.** Its content is a faithful copy of a doc
 *     state that genuinely existed and, after a lost CAS, still IS the stored state. Listing it
 *     is honest; restoring it restores real bytes. It costs one retention slot and is pruned
 *     like any other.
 *  4. **A lost CAS loses nothing historically.** The save that won the race took its OWN backup
 *     of the same prior bytes first, so the chain has no hole in it.
 *
 * The retention prune runs AFTER a successful PUT, never before. Pruning is bookkeeping; it
 * must never be able to delete history on behalf of a write that then does not happen.
 *
 * ── FAIL LOUD ────────────────────────────────────────────────────────────────────────────────
 *
 * `componentStorage.readComponent` swallowed every read failure, so one transient R2 blip made
 * the save path believe a def was new and overwrite both it and its snapshot. The same swallow
 * here would be strictly worse: "the read failed" would read as "there is nothing to back up",
 * and the save would proceed to destroy the very bytes it could not prove existed. So
 * {@link backupBeforeOverwrite} distinguishes the two the only way that is sound — via
 * `headObject`, which returns `null` ONLY for a genuine 404 and THROWS on anything else — and
 * lets the throw propagate. The save then fails; the editor keeps its dirty doc (`SaveState`
 * never discards on failure) and retries on the next autosave tick.
 */

/**
 * How aggressively to preserve the previous bytes.
 *
 * - `'auto'` — the autosave path: at most one backup per {@link COALESCE_MS}.
 * - `'always'` — a DESTRUCTIVE save (a scaffold/kind/reference load being committed, or a
 *   restore replacing the live doc). These are exactly the writes an author wants to undo, and
 *   they are rare, so they never coalesce away.
 */
export type BackupMode = 'auto' | 'always';

/**
 * Coalescing window for autosaves. The editor's debounce is 1.2 s, so a busy hour is on the
 * order of a thousand saves; one server-side copy each would be a thousand objects per project
 * per hour in a SHARED bucket, and a `listAllObjects` + prune on each of them. At 5 minutes an
 * hour of continuous editing costs 12 copies and 12 listings — negligible next to the work the
 * request already does — while the recovery granularity stays finer than the in-tab undo stack
 * is long.
 *
 * What this trades away, stated honestly: up to 5 minutes of the most recent work is not in any
 * backup at the moment a bad save lands. That window is covered by the editor's own 80-step
 * undo history, which is exactly the horizon a live tab can still fix by itself; the backups are
 * for the damage undo cannot reach (a reload, a new session, a load that reset the history).
 */
const COALESCE_MS = 5 * 60_000;

/**
 * How many backups a project keeps.
 *
 * With {@link COALESCE_MS} at 5 minutes, 20 covers ~100 minutes of CONTINUOUS editing — but the
 * window is counted in saves, not wall clock, so a project touched in short bursts keeps roughly
 * the last 20 sessions, which is the case that actually matters (yesterday's layout, before the
 * scaffold load, before last week's restore). A scene doc is tens to a few hundred KB, so the
 * ceiling is a handful of MB per project: bounded by construction, which is the requirement in a
 * shared bucket, rather than bounded by anyone remembering to clean up.
 */
const BACKUP_KEEP = 20;

/**
 * Per-process memo of when this project's doc was last backed up, keyed by the doc's R2 key.
 *
 * Deliberately in memory and deliberately not authoritative: consulting R2 to decide whether to
 * consult R2 would spend the round trip the coalescing exists to save. Every way it can be wrong
 * fails SAFE — a cold container, a redeploy, or a second Railway instance simply forgets and
 * takes an extra backup. It can never suppress one it has no record of.
 */
const lastBackupAtMs = new Map<string, number>();

/** One preserved copy of a project's editor doc, as the history endpoint reports it. */
export interface EditorDocBackup {
	/** The object's file stem — the opaque handle a client passes back to restore. */
	id: string;
	/** When the backed-up bytes were the live doc, parsed from the id (ISO 8601). */
	savedAt: string;
	/** Byte size of the preserved doc. */
	size: number;
}

/**
 * Copy the project's CURRENT `scenes.json` aside, so the write that follows is undoable.
 * Returns the backup id, or `null` when there was provably nothing to preserve (no doc yet) or
 * the autosave coalescing window suppressed it.
 *
 * MUST be called before the doc PUT and MUST be awaited — see the ordering argument at the top
 * of this file. Throws whatever R2 throws: a save that cannot prove what it is about to
 * overwrite must not happen.
 */
export async function backupBeforeOverwrite(
	clientKey: string,
	projectKey: string,
	mode: BackupMode,
	now = new Date(),
): Promise<string | null> {
	const docKey = editorDocKey(clientKey, projectKey);
	// HEAD, not GET: the decision needs only existence + ETag, and the bytes never have to enter
	// this process. Crucially `headObject` returns null ONLY on a real 404 and rethrows anything
	// else, so `head === null` PROVES absence rather than merely failing to disprove it.
	const head = await headObject(docKey);
	if (!head) {
		// Provably a create. Drop any memo so the first overwrite of the re-created doc is backed
		// up immediately instead of inheriting a stale window from the doc that used to be here.
		lastBackupAtMs.delete(docKey);
		return null;
	}
	if (mode === 'auto') {
		const last = lastBackupAtMs.get(docKey) ?? 0;
		if (now.getTime() - last < COALESCE_MS) return null;
	}
	const id = editorDocBackupId(now, head.etag);
	// Server-side copy: the bytes move inside R2 and never stream through the Node heap, so an
	// autosave costs one API call regardless of doc size (the get→put shape is what OOMs this
	// container on large objects — see `copyObject`).
	const copied = await copyObject(docKey, editorDocBackupKey(clientKey, projectKey, id));
	// `false` means the source 404'd between the HEAD and the COPY — someone deleted the doc
	// mid-request. Nothing was lost (there are no bytes to lose), and the PUT that follows still
	// answers to its own precondition: an `ifMatch` save will 412 → 409 as it should. Reporting
	// "no backup" is therefore accurate, not a swallow.
	if (!copied) return null;
	lastBackupAtMs.set(docKey, now.getTime());
	return id;
}

/**
 * Newest-first list of a project's preserved docs.
 *
 * Sorted by the id, which begins with a fixed-width UTC stamp, so lexicographic order IS
 * chronological order and nothing has to trust the copies' `LastModified`. Objects whose name
 * does not parse as a backup id are ignored rather than reported — the prefix is ours, but a
 * listing is not a place to throw.
 */
export async function listBackups(
	clientKey: string,
	projectKey: string,
): Promise<EditorDocBackup[]> {
	const prefix = editorDocBackupsPrefix(clientKey, projectKey);
	const objects = await listAllObjects(prefix);
	const backups: EditorDocBackup[] = [];
	for (const obj of objects) {
		const id = obj.key.slice(prefix.length).replace(/\.json$/, '');
		const savedAt = editorDocBackupSavedAt(id);
		if (savedAt) backups.push({ id, savedAt, size: obj.size });
	}
	backups.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
	return backups;
}

/**
 * Read one backup's raw JSON text, or `null` when the id is malformed or the object is gone.
 *
 * The id is validated against {@link EDITOR_DOC_BACKUP_ID_RE} and the key is rebuilt from the
 * CALLER's `(client, project)`; a client never supplies a key, so there is no path to traverse
 * out of the project's own prefix. Read failures other than 404 propagate.
 */
export async function readBackup(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<string | null> {
	if (!EDITOR_DOC_BACKUP_ID_RE.test(id)) return null;
	return getObjectText(editorDocBackupKey(clientKey, projectKey, id));
}

/**
 * Delete everything past the {@link BACKUP_KEEP} newest backups. Returns the ids removed.
 *
 * Call only AFTER the doc PUT succeeded: a prune on behalf of a write that then 409s would be
 * the one way this feature could itself destroy history. Best-effort by design — a prune that
 * fails leaves extra objects, which is the harmless direction, so callers swallow its error
 * rather than failing a save that already landed.
 */
export async function pruneBackups(clientKey: string, projectKey: string): Promise<string[]> {
	const backups = await listBackups(clientKey, projectKey);
	const stale = backups.slice(BACKUP_KEEP);
	if (stale.length === 0) return [];
	await deleteObjects(stale.map((b) => editorDocBackupKey(clientKey, projectKey, b.id)));
	return stale.map((b) => b.id);
}
