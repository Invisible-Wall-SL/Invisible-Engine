import { error, json } from '@sveltejs/kit';
import {
	IRIG_BACKUP_ID_RE,
	irigDocProblem,
	listIrigBackups,
	readIrigBackup,
} from '$lib/server/riggerIrig';
import { irigTarget, scopeMismatch, writeIrig } from '$lib/server/riggerIrigWrite';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Version history for one rig's `.irig` — LIST its rolling backups (`riggerIrig.ts`) and RESTORE
 * one. Same gate + session-bound project as `/api/rigger/save`.
 */
const GATE = {
	tool: 'rigger',
	forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
} as const;

/** `?dir=<base64url>&stem=<stem>` → newest-first `{ id, savedAt, size }[]`. */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const target = irigTarget(
		clientKey,
		projectKey,
		url.searchParams.get('dir') ?? '',
		url.searchParams.get('stem') ?? '',
	);
	return json({ ok: true, projectKey, backups: await listIrigBackups(target.backupsPrefix) });
};

/**
 * Restore a backup over the live `.irig`. Body: `{ dir, stem, id, projectKey, baseEtag }` (or
 * `force: true`). It goes through the same `writeIrig` as a save, so the restore itself backs up
 * what it replaces (restoring the wrong version is undoable) and keeps the ETag CAS (a stale tab
 * loses to a concurrent author with a 409).
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return scopeMismatch(body.projectKey, projectKey);
	}

	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);
	const id = typeof body.id === 'string' ? body.id : '';
	if (!IRIG_BACKUP_ID_RE.test(id)) throw error(400, 'Not a backup id.');
	const baseEtag = writeBaseEtagJson(body);

	const raw = await readIrigBackup(target.backupsPrefix, id);
	if (raw === null) throw error(404, 'That backup no longer exists.');
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw error(422, 'That backup is corrupt and cannot be restored.');
	}
	const problem = irigDocProblem(parsed);
	if (problem) throw error(422, `That backup would not load (${problem}), so it was not restored.`);

	const res = await writeIrig(clientKey, projectKey, target, raw, baseEtag);
	if (!res.ok) return res.response;
	return json({ ok: true, id, etag: res.etag, backupId: res.backupId });
};
