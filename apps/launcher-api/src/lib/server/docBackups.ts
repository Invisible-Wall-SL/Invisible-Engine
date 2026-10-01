import {
	docBackupId,
	docBackupKey,
	docBackupSavedAt,
	isDocBackupId,
	type DocBackupTarget,
} from './projectPaths';
import {
	ConflictError,
	copyObject,
	deleteObjects,
	getObjectText,
	headObject,
	listAllObjects,
	precondition,
	putObjectText,
} from './r2';

/**
 * Rolling backups for the whole-doc blobs — the "a save is no longer destructive" layer. One
 * implementation for every doc; which doc is a {@link DocBackupTarget} (`projectPaths.ts`), always
 * built from the caller's own `(client, project)`.
 *
 * WHY THIS EXISTS. The Scene Editor, Flow v2, Symbols and Game Config each PUT their ENTIRE doc,
 * two of them on an autosave (1.2 s / 0.8 s). The ETag CAS (`precondition(baseEtag)`) stops author
 * A clobbering author B, but it does nothing at all about author A clobbering author A: a bad
 * edit, a scaffold/reference load, or an accepted "overwrite theirs" is a normal, well-guarded,
 * completely unrecoverable write. This module preserves the PREVIOUS bytes before each such write
 * so there is something to go back to. Writes go through {@link putDocWithBackup}, which owns the
 * ordering below, so a doc that gains backups cannot get it wrong.
 *
 * ── THE WRITE ORDERING, and why the forever-409 landmine cannot recur ────────────────────────
 *
 * The backup is taken BEFORE the doc PUT. That is not a preference, it is the only option:
 * R2 object versioning is not enabled on this bucket, so the previous bytes exist only until
 * the PUT lands. A "copy after" would copy the new bytes and preserve nothing.
 *
 * A save that is ALREADY doomed takes no backup: when the stored object fails the save's own
 * precondition (it exists and `baseEtag` is `null`, or its ETag is not `baseEtag`), the PUT would
 * 409 and overwrite nothing, so this throws {@link ConflictError} before copying. Otherwise a run of
 * refused autosaves from a stale tab would each copy the CURRENT bytes, and retention — which
 * counts copies — would push genuinely older versions out of the history.
 *
 * That check is a HEAD, so a save landing between it and the PUT can still turn this one into a
 * lost CAS after its copy was taken — an orphan. `docs/design/multi-user-concurrency.md` records
 * how an orphan turned into a permanent 409 for the component snapshots, so state plainly why it
 * cannot here:
 *
 *  1. **Nothing recomputes a backup key.** The component scheme's `<id>.v<N>.json` is derived
 *     by reading the stored version and adding one, so EVERY later save re-derives the orphan's
 *     key, collides, and fails — forever, unforceably. A backup key is derived from the clock
 *     and from the ETag of the object being copied (see `docBackupId`). No later save can ever
 *     re-derive an earlier save's key, because no later save asks "what came before".
 *  2. **Backup writes carry NO precondition.** Even a key that did repeat could not fail:
 *     `copyObject` is unconditional. There is no 409 to inherit.
 *  3. **An orphan is inert, and it is not even wrong.** Its content is a faithful copy of a doc
 *     state that genuinely existed. Listing it is honest; restoring it restores real bytes. It
 *     costs one retention slot and is pruned like any other.
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
 * and the save would proceed to destroy the very bytes it could not prove existed. So the
 * decision goes through `headObject`, which returns `null` ONLY for a genuine 404 and THROWS on
 * anything else, and the throw propagates. The save then fails; the tool keeps its dirty doc
 * (`SaveState` never discards on failure) and retries.
 */

/**
 * How aggressively to preserve the previous bytes.
 *
 * - `'auto'` — the ordinary save: at most one backup per {@link COALESCE_MS} per doc.
 * - `'always'` — a DESTRUCTIVE save (a scaffold/kind/reference load being committed, or a
 *   restore replacing the live doc). These are exactly the writes an author wants to undo, and
 *   they are rare, so they never coalesce away.
 *
 * An UNCONDITIONAL write (`baseEtag: undefined` — the conflict banner's "overwrite theirs") is
 * always treated as `'always'`, whatever the caller asked: it replaces bytes the author has not
 * seen, typically another author's save, and it is rare. Deciding it here rather than in each
 * client means no tool can forget it.
 */
export type BackupMode = 'auto' | 'always';

/**
 * Coalescing window for `'auto'` saves. The editor's debounce is 1.2 s and Flow v2's 0.8 s, so a
 * busy hour is on the order of a thousand saves; one server-side copy each would be a thousand
 * objects per project per hour in a SHARED bucket, and a `listAllObjects` + prune on each of them.
 * At 5 minutes an hour of continuous editing costs 12 copies and 12 listings — negligible next to
 * the work the request already does — while the recovery granularity stays finer than an in-tab
 * undo stack is long.
 *
 * What this trades away, stated honestly: up to 5 minutes of the most recent work is not in any
 * backup at the moment a bad save lands. That window is covered by the tools' own undo history,
 * which is exactly the horizon a live tab can still fix by itself; the backups are for the damage
 * undo cannot reach (a reload, a new session, a load that reset the history).
 */
const COALESCE_MS = 5 * 60_000;

/**
 * How many backups a doc keeps.
 *
 * With {@link COALESCE_MS} at 5 minutes, 20 covers ~100 minutes of CONTINUOUS editing — but the
 * window is counted in saves, not wall clock, so a doc touched in short bursts keeps roughly the
 * last 20 sessions, which is the case that actually matters (yesterday's layout, before the
 * scaffold load, before last week's restore). These docs are tens to a few hundred KB, so the
 * ceiling is a handful of MB per doc: bounded by construction, which is the requirement in a
 * shared bucket, rather than bounded by anyone remembering to clean up.
 */
const BACKUP_KEEP = 20;

/**
 * Per-process memo of when a doc was last backed up, keyed by the doc's R2 key.
 *
 * Deliberately in memory and deliberately not authoritative: consulting R2 to decide whether to
 * consult R2 would spend the round trip the coalescing exists to save. Every way it can be wrong
 * fails SAFE — a cold container, a redeploy, or a second Railway instance simply forgets and
 * takes an extra backup. It can never suppress one it has no record of.
 */
const lastBackupAtMs = new Map<string, number>();

/**
 * The ETag of the doc as this process last WROTE it. The window only coalesces over bytes this
 * process wrote itself: if another instance or build wrote the stored doc since (a rolling deploy,
 * a newer launcher whose values an older read then drops), those bytes are copied even inside the
 * window, or the save that replaces them would leave them nowhere.
 */
const lastPutEtag = new Map<string, string>();

/** One preserved copy of a doc, as the history endpoints report it. */
export interface DocBackup {
	/** The object's file stem — the opaque handle a client passes back to restore. */
	id: string;
	/** When the backed-up bytes were the live doc, parsed from the id (ISO 8601). */
	savedAt: string;
	/** Byte size of the preserved doc. */
	size: number;
}

/**
 * Write `text` over the target's doc under the caller's precondition, preserving what it
 * replaces. `baseEtag` follows `r2.precondition`: a string = CAS update, `null` = create
 * (`If-None-Match: *`), `undefined` = the author's explicit unconditional write. Returns the new
 * ETag; throws {@link ConflictError} when the precondition loses — including BEFORE any copy when
 * the stored object already fails it — and whatever R2 throws otherwise.
 *
 * The three steps are ordered, and the order is the load-bearing part of this function:
 *
 *  1. **Preserve the previous bytes.** First, because the old bytes cease to exist the instant
 *     the PUT lands. It may THROW, and then the save does not happen: a write that cannot prove
 *     what it is about to overwrite must not happen.
 *  2. **The guarded PUT.** If it 409s, step 1's copy (if any) is an inert orphan — see the top of
 *     this file.
 *  3. **Prune.** Only after the PUT succeeded, and only when step 1 actually wrote something, so
 *     retention can never delete history for a write that did not happen. Best-effort: a failed
 *     prune leaves extra objects, which is the harmless direction, and must not turn a landed
 *     save into an error the author sees.
 */
export async function putDocWithBackup(
	target: DocBackupTarget,
	text: string,
	baseEtag: string | null | undefined,
	mode: BackupMode,
	now = new Date(),
): Promise<string | null> {
	const effective = baseEtag === undefined ? 'always' : mode;
	const backupId = await backupBeforeOverwrite(target, effective, baseEtag, now);
	const etag = await putObjectText(target.docKey, text, 'application/json', precondition(baseEtag));
	if (etag) lastPutEtag.set(target.docKey, etag);
	else lastPutEtag.delete(target.docKey);
	if (backupId) {
		try {
			await pruneBackups(target);
		} catch (e) {
			console.error(`[doc-backups] prune of ${target.prefix} failed`, e);
		}
	}
	return etag;
}

/**
 * Copy the target's CURRENT doc aside, so the write that follows is undoable. Returns the backup
 * id, or `null` when there was provably nothing to preserve (no doc yet) or the `'auto'`
 * coalescing window suppressed it. Throws {@link ConflictError} when the stored object already
 * fails the save's precondition — see "A save that is ALREADY doomed" above.
 */
async function backupBeforeOverwrite(
	target: DocBackupTarget,
	mode: BackupMode,
	baseEtag: string | null | undefined,
	now: Date,
): Promise<string | null> {
	const { docKey } = target;
	// HEAD, not GET: the decision needs only existence + ETag, and the bytes never have to enter
	// this process. Crucially `headObject` returns null ONLY on a real 404 and rethrows anything
	// else, so `head === null` PROVES absence rather than merely failing to disprove it.
	const head = await headObject(docKey);
	if (!head) {
		// Provably nothing to preserve. Drop any memo so the first overwrite of the re-created doc is
		// backed up immediately instead of inheriting a stale window from the doc that used to be
		// here. (An update whose doc has vanished is refused by its own `If-Match` on the PUT.)
		lastBackupAtMs.delete(docKey);
		lastPutEtag.delete(docKey);
		return null;
	}
	if (baseEtag === null || (typeof baseEtag === 'string' && etagDiffers(head.etag, baseEtag))) {
		throw new ConflictError(docKey);
	}
	if (mode === 'auto') {
		const last = lastBackupAtMs.get(docKey) ?? 0;
		const ours = lastPutEtag.get(docKey);
		const wroteIt = ours !== undefined && head.etag !== null && !etagDiffers(head.etag, ours);
		if (wroteIt && now.getTime() - last < COALESCE_MS) return null;
	}
	const id = docBackupId(target.stem, now, head.etag);
	// Server-side copy: the bytes move inside R2 and never stream through the Node heap, so a save
	// costs one API call regardless of doc size (the get→put shape is what OOMs this container on
	// large objects — see `copyObject`).
	const copied = await copyObject(docKey, docBackupKey(target, id));
	// `false` means the source 404'd between the HEAD and the COPY — someone deleted the doc
	// mid-request. Nothing was lost (there are no bytes to lose), and the PUT that follows still
	// answers to its own precondition. Reporting "no backup" is therefore accurate, not a swallow.
	if (!copied) return null;
	// Only an `'auto'` copy opens the coalescing window. An `'always'` write (a restore, an
	// overwrite) REPLACES the doc with bytes of its own, and at the retention limit its prune can
	// delete the very backup it restored from — so if it opened the window, the next autosave
	// would skip its copy and the restored version would then exist nowhere.
	if (mode === 'auto') lastBackupAtMs.set(docKey, now.getTime());
	return id;
}

/**
 * Whether the stored ETag PROVABLY differs from the save's `baseEtag`. Both normally come off R2
 * verbatim (a GET/PUT/HEAD `ETag` header), so this only has to tolerate the quoting and the `W/`
 * weak prefix a header value may carry. It errs toward "same": a false "same" merely lets the PUT
 * decide (and at worst leaves an inert orphan), whereas a false "differs" would refuse a save R2
 * would have accepted — on every retry. A missing stored ETag proves nothing, so it is "same".
 */
function etagDiffers(stored: string | null, base: string): boolean {
	if (stored === null) return false;
	const norm = (t: string): string =>
		t
			.trim()
			.replace(/^W\//, '')
			.replace(/^"(.*)"$/, '$1');
	return norm(stored) !== norm(base);
}

/**
 * Newest-first list of a doc's preserved copies.
 *
 * Sorted by the id, which begins with a fixed-width UTC stamp, so lexicographic order IS
 * chronological order and nothing has to trust the copies' `LastModified`. Objects whose name
 * does not parse as a backup id of this target's stem are ignored rather than reported — the
 * prefix is ours, but a listing is not a place to throw.
 */
export async function listBackups(target: DocBackupTarget): Promise<DocBackup[]> {
	const objects = await listAllObjects(target.prefix);
	const backups: DocBackup[] = [];
	for (const obj of objects) {
		const id = obj.key.slice(target.prefix.length).replace(/\.json$/, '');
		const savedAt = docBackupSavedAt(target.stem, id);
		if (savedAt) backups.push({ id, savedAt, size: obj.size });
	}
	backups.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
	return backups;
}

/**
 * Read one backup's raw JSON text, or `null` when the id is malformed or the object is gone.
 *
 * The id is validated against the target's stem and the key is rebuilt from the target, which the
 * caller built from its own `(client, project)`; a client never supplies a key, so there is no
 * path to traverse out of the doc's own backup folder. Read failures other than 404 propagate.
 */
export async function readBackup(target: DocBackupTarget, id: string): Promise<string | null> {
	if (!isDocBackupId(target.stem, id)) return null;
	return getObjectText(docBackupKey(target, id));
}

/** Delete everything past the {@link BACKUP_KEEP} newest backups. */
async function pruneBackups(target: DocBackupTarget): Promise<void> {
	const stale = (await listBackups(target)).slice(BACKUP_KEEP);
	await deleteObjects(stale.map((b) => docBackupKey(target, b.id)));
}
