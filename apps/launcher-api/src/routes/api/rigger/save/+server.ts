import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import { saveRig, storedRig3d, type Resolution } from '$lib/server/rigger3d';
import { asIrigDocument, irigDocProblem } from '$lib/server/riggerIrig';
import { irigTarget, scopeMismatch } from '$lib/server/riggerIrigWrite';
import { stampSavedBy } from '$lib/server/savedBy';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

const GATE = {
	tool: 'rigger',
	forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
} as const;

/**
 * The precondition a later save of `<dir>/<stem>.irig` must carry: `{ projectKey, etag }`, where
 * `etag: null` means no `.irig` exists yet (the save will be a create).
 *
 * The Rigger loads the skeleton through `/rig-viewer/file`, which the rig AssetManager reads
 * without exposing headers — so the tab asks for the ETag HERE, BEFORE it loads the bytes. That
 * order fails safe: a save landing between the two leaves the tab holding an OLDER etag than its
 * bytes, which is a spurious 409 (a prompt), never a silent overwrite.
 *
 * `rig3d` is the rig's 3D data (`rig3d.json`, docs/design/rig-2p5d.md §3) when it has any: its
 * ETag and its document (or why it cannot be read), read in one go so the two always match, and
 * `torn` when it was written for another version of the `.irig` (a save will refuse it).
 *
 * Query: `?dir=<base64url bundle dir>&stem=<file stem>`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const target = irigTarget(
		clientKey,
		projectKey,
		url.searchParams.get('dir') ?? '',
		url.searchParams.get('stem') ?? '',
	);
	const { read, irig: head, owner, doc, problems, torn } = await storedRig3d(target);
	const rig3d =
		read && head && (owner === target.stem || owner === undefined)
			? { etag: read.etag, ...(doc ? { doc } : { problems }), ...(torn ? { torn } : {}) }
			: null;
	// An object with no ETag (never seen from R2) leaves `etag` out entirely — the tab then refuses
	// to save rather than guessing a precondition that could only mis-fire.
	return json({ ok: true, projectKey, etag: head ? (head.etag ?? undefined) : null, rig3d });
};

const RESOLUTIONS: ReadonlySet<string> = new Set<Resolution>(['rebake', 'detach']);

/**
 * Save a Rigger-edited skeleton to R2 as `<bundle>/<stem>.irig` WITHOUT clobbering the artist's
 * source `.json`, then rebuild the project's `skeletons.json` so the saved edit is listed +
 * re-openable. A 4.2 skeleton is saved as irig v1 (`asIrigDocument`): the first save of a rig opened
 * from its source `.json`, or from a 4.2 `.irig`, is where it is imported. One whose import would
 * change a value is saved as 4.2, as it always was.
 *
 * Guarded like every authoring save (`docs/design/multi-user-concurrency.md`): the caller's
 * `baseEtag` makes the write conditional (a string → `If-Match`, `null` → `If-None-Match: *`), a
 * stale one answers 409 instead of overwriting; `force: true` is the author's explicit "overwrite
 * theirs" from the conflict prompt. The previous `.irig` is copied aside first (`riggerIrig.ts`)
 * so any overwrite — forced or not — can be undone from the rig's history.
 *
 * A rig with 3D data is saved with it (`rigger3d.ts`): its 3D clips are baked into the `.irig`,
 * and a 2D edit of a baked part is refused unless `resolve` says what to do with that clip.
 *
 * Body: `{ dir, stem, skeleton: <object|string>, projectKey, baseEtag: string|null } | {…, force: true}`,
 * plus, from a client that edits 3D, `rig3d` (the whole `rig3d.json`) and `rig3dBaseEtag`, and
 * `resolve: { <clip>: 'rebake' | 'detach' }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);

	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');

	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return scopeMismatch(body.projectKey, projectKey);
	}

	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);

	let doc: unknown = body.skeleton;
	if (typeof doc === 'string') {
		try {
			doc = JSON.parse(doc);
		} catch {
			throw error(400, 'skeleton is not valid JSON');
		}
	}
	if (doc && typeof doc === 'object' && !Array.isArray(doc))
		doc = asIrigDocument(doc as Record<string, unknown>) ?? doc;
	const problem = irigDocProblem(doc);
	if (problem) {
		return json(
			{
				ok: false,
				error: 'invalid-skeleton',
				message: `Not saved — the rig would not load: ${problem}. The stored rig is unchanged.`,
			},
			{ status: 422 },
		);
	}

	const baseEtag = writeBaseEtagJson(body);
	const rig3d = body.rig3d;
	let rig3dBaseEtag: string | null | undefined;
	if (rig3d !== undefined && baseEtag !== undefined) {
		const v = body.rig3dBaseEtag;
		if (v !== null && typeof v !== 'string')
			throw error(400, 'This save did not send its rig3dBaseEtag precondition — reload the tool.');
		rig3dBaseEtag = v;
	}
	const resolve: Record<string, Resolution> = {};
	if (body.resolve !== undefined) {
		const r = body.resolve;
		if (typeof r !== 'object' || r === null || Array.isArray(r))
			throw error(400, 'resolve must map clips to "rebake" or "detach"');
		for (const [clip, how] of Object.entries(r)) {
			if (typeof how !== 'string' || !RESOLUTIONS.has(how))
				throw error(400, `resolve.${clip} must be "rebake" or "detach"`);
			resolve[clip] = how as Resolution;
		}
	}

	// A person's save is not Director's: drop the stamp a Director rebind left on the rig.
	const res = await saveRig(clientKey, projectKey, target, {
		doc: stampSavedBy(doc as Record<string, unknown>, undefined),
		baseEtag,
		...(rig3d === undefined ? {} : { rig3d, rig3dBaseEtag }),
		resolve,
	});
	if (!res.ok) return res.response;
	return json({
		ok: true,
		key: target.key,
		etag: res.etag,
		backupId: res.backupId,
		count: res.count,
		rig3dEtag: res.rig3dEtag,
		rebaked: res.rebaked,
		detached: res.detached,
		unmet: res.unmet,
	});
};
