import { error, json } from '@sveltejs/kit';
import { r2Slug, sharedRigKey } from '$lib/server/projectPaths';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from '$lib/server/r2';
import { saveRig } from '$lib/server/riggerLibrary';
import { irigDocProblem } from '$lib/server/riggerIrig';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { SharedRigStats } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Save one WHOLE rig (skeleton doc = bones + slots + skins + constraints + animations)
 * to the cross-project rig library (`_shared/rigs/`). The full entry (with the heavy
 * `skeleton`) is written to `_shared/rigs/<id>.json`; a lightweight catalog row is
 * upserted into Postgres. Gated by `rigger`; the id is path-guarded via `r2Slug`.
 *
 * The library is STUDIO-WIDE, so a name collision overwrites another project's rig. The write is
 * therefore conditional: the first attempt sends `baseEtag: null` (create only), and an existing
 * entry answers **409 `exists`** carrying its `etag` + who saved it. The client confirms, then
 * retries with that etag (`If-Match`) — so a second concurrent overwrite of the same entry is a
 * 409 `conflict`, not a silent last-writer-wins.
 *
 * Body: `{ id?, name, skeleton, sourceRig?, baseEtag: string | null }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'missing name');

	const skeleton = body.skeleton as Record<string, unknown> | undefined;
	if (!skeleton || typeof skeleton !== 'object' || Array.isArray(skeleton)) {
		throw error(400, 'body.skeleton is not an object');
	}
	const problem = irigDocProblem(skeleton);
	if (problem) throw error(422, `Not saved — the rig would not load: ${problem}.`);
	const baseEtag = writeBaseEtagJson(body);

	const id = r2Slug(typeof body.id === 'string' && body.id ? body.id : name);
	if (!id || id.includes('..') || id.includes('/')) throw error(400, 'bad id');

	const slots = Array.isArray(skeleton.slots) ? skeleton.slots : [];
	const skins = Array.isArray(skeleton.skins) ? skeleton.skins : [];
	const animations =
		skeleton.animations && typeof skeleton.animations === 'object'
			? Object.keys(skeleton.animations as Record<string, unknown>)
			: [];
	const stats: SharedRigStats = {
		bones: (skeleton.bones as unknown[]).length,
		slots: slots.length,
		skins: skins.length,
		animations,
	};

	// Force a valid Spine version on the stored skeleton so an applied rig always loads.
	const skelBlock = (skeleton.skeleton ?? {}) as Record<string, unknown>;
	skeleton.skeleton = {
		...skelBlock,
		spine: typeof skelBlock.spine === 'string' ? skelBlock.spine : '4.2',
	};

	const sourceRig = typeof body.sourceRig === 'string' && body.sourceRig ? body.sourceRig : null;
	const savedAt = new Date().toISOString();
	const source = { client: clientKey, project: projectKey, rig: sourceRig };

	const entry = { schemaVersion: 1, id, name, savedAt, source, stats, skeleton };
	// Blob BEFORE row: a failure here leaves no row and no blob; a failure after
	// leaves an orphaned blob (invisible) rather than a row pointing at nothing.
	let etag: string | null;
	try {
		etag = await putObjectText(
			sharedRigKey(id),
			JSON.stringify(entry),
			'application/json',
			precondition(baseEtag),
		);
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		return conflict(id, baseEtag === null ? 'exists' : 'conflict');
	}
	await saveRig({ id, name, savedAt, source, stats });

	return json({ ok: true, id, etag });
};

/** The 409 for a library name that is taken (`exists`) or changed under us (`conflict`). */
async function conflict(id: string, kind: 'exists' | 'conflict'): Promise<Response> {
	const current = await getObjectTextWithEtag(sharedRigKey(id));
	let existing: { name?: unknown; savedAt?: unknown; source?: { project?: unknown } } = {};
	try {
		existing = current ? JSON.parse(current.text) : {};
	} catch {
		/* a corrupt entry is still one worth confirming before overwriting */
	}
	const who =
		typeof existing.source?.project === 'string'
			? ` from project "${existing.source.project}"`
			: '';
	const when =
		typeof existing.savedAt === 'string'
			? ` (saved ${existing.savedAt.slice(0, 16).replace('T', ' ')} UTC)`
			: '';
	return json(
		{
			ok: false,
			error: kind,
			id,
			etag: current?.etag ?? null,
			message:
				kind === 'exists'
					? `The shared library already has a rig "${typeof existing.name === 'string' ? existing.name : id}"${who}${when}. ` +
						'Saving replaces it for every project.'
					: `Someone else just saved the library rig "${id}"${who}${when}. Nothing was overwritten.`,
		},
		{ status: 409 },
	);
}
