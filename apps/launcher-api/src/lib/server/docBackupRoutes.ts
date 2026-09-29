import { error, json } from '@sveltejs/kit';
import { readBackup, type BackupMode } from './docBackups';
import { isDocBackupId, type DocBackupTarget } from './projectPaths';
import { ConflictError } from './r2';
import { writeBaseEtagJson } from './writeGuard';

/**
 * Request plumbing shared by the doc-history endpoints — `/api/editor/backups`,
 * `/api/flow-v2/backups`, `/api/editor/symbols/backups`, `/api/game-config/backups` — so the four
 * answer a restore identically and one client modal serves them all. Each route keeps its own
 * gate and project scoping; nothing here decides WHOSE doc is restored, only how the request is
 * read and how a failure is reported.
 *
 * Every restore goes through its doc's ordinary save with `backup: 'always'`, so restoring TAKES
 * A BACKUP of whatever it replaces (restoring the wrong version is itself undoable), and it keeps
 * the ETag CAS: `writeBaseEtagJson` makes the client state its precondition, so a restore issued
 * from a stale tab loses to the concurrent author with a 409 instead of getting a free
 * unconditional write for being a "restore".
 */

/**
 * The backup mode a SAVE body asks for: `backup: 'always'` marks a save the author will want
 * back (a wholesale swap being committed), anything else is the coalesced `'auto'`. Mirrors the
 * editor's `backup` form field, so a tab running an older bundle simply gets the ordinary
 * coalesced backup rather than none.
 */
export function requestedBackupMode(body: unknown): BackupMode {
	return isRecord(body) && body.backup === 'always' ? 'always' : 'auto';
}

/** A restore's JSON object body; 400 when it is not one. */
export async function restoreBody(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (!isRecord(body)) throw error(400, 'Invalid JSON body.');
	return body;
}

/**
 * The backup a restore names and the precondition it restores under. Body: `{ id, baseEtag:
 * string | null }` (or `{ id, force: true }` — the same "overwrite what's there now" a save
 * accepts). The id's SHAPE is checked against this target's own stem here as well as in
 * `readBackup`, so a malformed id — or one minted for a different doc — is a 400 the caller can
 * act on rather than an indistinguishable "that backup is gone" 404.
 */
export function restoreArgs(
	body: Record<string, unknown>,
	target: DocBackupTarget,
): { id: string; baseEtag: string | null | undefined } {
	const id = typeof body.id === 'string' ? body.id : '';
	if (!isDocBackupId(target.stem, id)) throw error(400, 'Not a backup id.');
	return { id, baseEtag: writeBaseEtagJson(body) };
}

/**
 * The parsed JSON of one backup. Absent means pruned (or never existed) → 404; unparseable → 422;
 * a read FAILURE → 502. "Your backup is gone" and "storage is down" must not look the same to the
 * author deciding whether to retry.
 */
export async function readBackupForRestore(target: DocBackupTarget, id: string): Promise<unknown> {
	let raw: string | null;
	try {
		raw = await readBackup(target, id);
	} catch (e) {
		console.error(`[doc-backups] reading ${target.prefix}${id} failed:`, e);
		throw error(502, 'Could not read that backup — storage is unavailable. Please retry.');
	}
	if (raw === null) throw error(404, 'That backup no longer exists.');
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw error(422, 'That backup is corrupt and cannot be restored.');
	}
}

/**
 * The answer to a restore whose write threw. A lost CAS is a 409 via `json`, never `error()` — a
 * thrown `error` surfaces as an opaque 502 and hides the cause
 * ([[gotcha_publish_502_flowv2_nodes_guard]]). Anything else is storage. `what` names the doc in
 * the author's terms ("this flow"). Callers map their own validation errors to 422 first.
 */
export function restoreWriteFailed(e: unknown, what: string): Response {
	if (e instanceof ConflictError) {
		return json(
			{
				ok: false,
				error: 'conflict',
				message:
					`Someone else saved ${what} while you were looking at its history. ` +
					'Nothing was restored — reload to get their version first.',
			},
			{ status: 409 },
		);
	}
	console.error(`[doc-backups] restoring ${what} failed:`, e);
	throw error(502, 'Could not restore that backup — storage is unavailable. Please retry.');
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
