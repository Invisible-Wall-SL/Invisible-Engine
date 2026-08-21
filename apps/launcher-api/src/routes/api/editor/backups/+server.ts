import { error, json } from '@sveltejs/kit';
import type { LayoutDoc } from 'engine-layout';
import { listBackups, readBackup } from '$lib/server/editorDocBackups';
import { normalizeDoc, saveDoc } from '$lib/server/editorStorage';
import { EDITOR_DOC_BACKUP_ID_RE } from '$lib/server/projectPaths';
import { ConflictError } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Version history for the Scene Editor doc — LIST the rolling backups
 * (`editorDocBackups.ts`) and RESTORE one.
 *
 * Scoped exactly like every other `/api/editor/*` endpoint: the shared
 * `toolScope.gate` helper does auth + the `editor` entitlement + resolves the
 * SESSION-BOUND active project. Session-bound is the right binding here even though the
 * editor page itself resolves `?project=`: the page SYNCS its explicit `?project=` into the
 * session on load (`resolveToolScope` → `setActiveProjectKey`), so by the time this route can
 * be called the two agree — and taking the project from a request param instead would hand a
 * client the ability to name which project's history it restores over.
 */
const GATE = {
	tool: 'editor',
	forbiddenMessage: 'Your role does not have access to Invisible Editor.',
} as const;

/** Newest-first `{ id, savedAt, size }` for the project's preserved editor docs. */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	return json({ ok: true, projectKey, backups: await listBackups(clientKey, projectKey) });
};

/**
 * Restore a backup over the live doc. Body: `{ id, baseEtag: string | null }` (or
 * `{ id, force: true }` — the same "overwrite what's there now" the save action accepts).
 *
 * Two properties this deliberately does NOT shortcut:
 *
 *  - **It goes through `saveDoc`,** so restoring TAKES A BACKUP of whatever it replaces, with
 *    `'always'` so the coalescing window can never suppress it. Restoring the wrong version is
 *    therefore itself undoable — otherwise version history would just move the unrecoverable
 *    act one step along, which is the failure this whole feature exists to remove.
 *  - **It keeps the ETag CAS.** `writeBaseEtagJson` requires the client to state the
 *    precondition, so a restore issued from a tab that has gone stale loses to the concurrent
 *    author and answers 409 — it does not get a free unconditional write for being a "restore".
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const id = isRecord(body) && typeof body.id === 'string' ? body.id : '';
	// Validate the SHAPE here as well as in `readBackup`, so a malformed id is a 400 the caller
	// can act on rather than an indistinguishable "that backup is gone" 404.
	if (!EDITOR_DOC_BACKUP_ID_RE.test(id)) throw error(400, 'Not a backup id.');
	const baseEtag = writeBaseEtagJson(body);

	const raw = await readBackup(clientKey, projectKey, id);
	// Absent means pruned (or never existed). Distinct from a read FAILURE, which `readBackup`
	// lets propagate to the 502 below — "your backup is gone" and "storage is down" must not
	// look the same to the author deciding whether to retry.
	if (raw === null) throw error(404, 'That backup no longer exists.');
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw error(422, 'That backup is corrupt and cannot be restored.');
	}
	// Re-normalize rather than trusting the stored bytes: a backup may predate a doc migration
	// (the `alwaysOnTop` backfill, the parametric-HUD rewrite), and `saveDoc` normalizes anyway
	// — doing it here means a restore of an old doc lands in exactly the shape a save of it
	// would, instead of round-tripping through a shape the editor no longer reads.
	const restored = normalizeDoc(parsed, projectKey);

	try {
		const { doc, etag } = await saveDoc(
			clientKey,
			projectKey,
			restored as LayoutDoc,
			baseEtag,
			'always',
		);
		return json({ ok: true, id, etag, updatedAt: doc.updatedAt });
	} catch (e) {
		if (e instanceof ConflictError) {
			// `json(..., 409)`, never `error()` — a thrown `error` surfaces as an opaque 502 and
			// hides the cause ([[gotcha_publish_502_flowv2_nodes_guard]]).
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this project while you were looking at its history. ' +
						'Nothing was restored — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		console.error('[editor] backup restore failed:', e);
		throw error(502, 'Could not restore that backup — storage is unavailable. Please retry.');
	}
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
