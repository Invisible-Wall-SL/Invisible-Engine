import { error, json } from '@sveltejs/kit';
import { rig3dDocProblems } from '$lib/rig3d';
import { jsonObjectOrNull } from '$lib/server/http';
import {
	IRIG_BACKUP_ID_RE,
	irigDocProblem,
	listIrigBackups,
	readIrigBackup,
	readSidecarBackup,
} from '$lib/server/riggerIrig';
import {
	irigTarget,
	readSidecar,
	scopeMismatch,
	sidecarOwner,
	writeIrig,
	type SidecarPlans,
} from '$lib/server/riggerIrigWrite';
import { RIG_SIDECARS } from '$lib/rigSidecars';
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

/** `?dir=<base64url>&stem=<stem>` → newest-first `{ id, savedAt, size, rig3d, controls }[]`. */
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
 *
 * A backup restores the rig as it was then, its sidecars included (its 3D data, `rig3d.json`, and its
 * controls, `controls.json`): each copy kept with it is put back, and a backup from before the rig had
 * one removes the rig's current one (which the restore's own backup keeps). They are written
 * together, as a save writes them; never over another rig's.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = await jsonObjectOrNull(request);
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

	const rig3d = await readSidecarBackup(target.backupsPrefix, id, 'rig3d');
	const controls = await readSidecarBackup(target.backupsPrefix, id, 'controls');
	if (rig3d !== null) {
		let side: unknown;
		try {
			side = JSON.parse(rig3d);
		} catch {
			side = undefined;
		}
		const problems = rig3dDocProblems(side);
		if (problems.length)
			throw error(
				422,
				`That backup's 3D data is corrupt (${problems[0]}), so it was not restored.`,
			);
	}
	const copies = { rig3d, controls };
	const plans: SidecarPlans = {};
	for (const { kind, what } of RIG_SIDECARS) {
		const read = await readSidecar(target, kind);
		const owner = read ? sidecarOwner(read.text) : undefined;
		const copy = copies[kind];
		if (copy !== null && read && owner !== undefined && owner !== target.stem)
			return json(
				{
					ok: false,
					error: `${kind}-other-rig`,
					message: `Not restored — the ${what} in this folder now ${kind === 'controls' ? 'belong' : 'belongs'} to rig "${owner}", not "${target.stem}". The stored rig is unchanged.`,
				},
				{ status: 409 },
			);
		const ours = owner === target.stem;
		const next = copy !== null ? copy : ours ? null : undefined;
		plans[kind] = { read, ours, ...(next === undefined ? {} : { next }) };
	}

	const res = await writeIrig(clientKey, projectKey, target, raw, baseEtag, plans);
	if (!res.ok) return res.response;
	return json({
		ok: true,
		id,
		etag: res.etag,
		backupId: res.backupId,
		rig3dEtag: res.rig3dEtag,
		controlsEtag: res.controlsEtag,
	});
};
