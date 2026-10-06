import { error, json } from '@sveltejs/kit';
import { headObject } from '$lib/server/r2';
import { irigDocProblem } from '$lib/server/riggerIrig';
import { irigTarget, scopeMismatch, writeIrig } from '$lib/server/riggerIrigWrite';
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
 * The Rigger loads the skeleton through `/spine/file`, which the Spine AssetManager reads without
 * exposing headers — so the tab asks for the ETag HERE, BEFORE it loads the bytes. That order
 * fails safe: a save landing between the two leaves the tab holding an OLDER etag than its bytes,
 * which is a spurious 409 (a prompt), never a silent overwrite.
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
	const head = await headObject(target.key);
	// An object with no ETag (never seen from R2) leaves `etag` out entirely — the tab then refuses
	// to save rather than guessing a precondition that could only mis-fire.
	return json({ ok: true, projectKey, etag: head ? (head.etag ?? undefined) : null });
};

/**
 * Save a Rigger-edited skeleton to R2 as `<bundle>/<stem>.irig` (Spine 4.2 JSON under our
 * extension) WITHOUT clobbering the artist's source `.json`, then rebuild the project's
 * `skeletons.json` so the saved edit is listed + re-openable.
 *
 * Guarded like every authoring save (`docs/design/multi-user-concurrency.md`): the caller's
 * `baseEtag` makes the write conditional (a string → `If-Match`, `null` → `If-None-Match: *`), a
 * stale one answers 409 instead of overwriting; `force: true` is the author's explicit "overwrite
 * theirs" from the conflict prompt. The previous `.irig` is copied aside first (`riggerIrig.ts`)
 * so any overwrite — forced or not — can be undone from the rig's history.
 *
 * Body: `{ dir, stem, skeleton: <object|string>, projectKey, baseEtag: string|null } | {…, force: true}`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
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
	// A person's save is not Director's: drop the stamp a Director rebind left on the rig.
	const saved = JSON.stringify(stampSavedBy(doc as object, undefined));
	const res = await writeIrig(clientKey, projectKey, target, saved, baseEtag);
	if (!res.ok) return res.response;
	return json({
		ok: true,
		key: target.key,
		etag: res.etag,
		backupId: res.backupId,
		count: res.count,
	});
};
