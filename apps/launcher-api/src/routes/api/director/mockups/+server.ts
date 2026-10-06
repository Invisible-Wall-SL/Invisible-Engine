import { error, json } from '@sveltejs/kit';
import { requireDirectorAccess, requireDirectorProjectScope } from '$lib/server/director/access';
import {
	FIDELITIES,
	MAX_MOCKUPS,
	MAX_MOCKUP_BYTES,
	MockupError,
	addMockup,
	confirmOwnership,
	loadMockupsDoc,
	ownershipRefusal,
	removeMockup,
	setFidelity,
	setMockupTag,
	type MockupsDoc,
} from '$lib/server/director/mockups';
import type { RequestHandler } from './$types';

/**
 * The Director mockups of one project (ADR-0005), for the New-game screen:
 *
 *   GET  /api/director/mockups?project=<key>[&client=<key>]   the doc, the limits, the start refusal
 *   POST /api/director/mockups?project=<key>[&client=<key>]  (multipart)
 *        action=upload   file=<png|jpg> tag=<screen> [styleOnly=1]    (one file per request)
 *        action=retag    id=<mockup id> tag=<screen> [styleOnly=1]     the ownership check stays
 *        action=confirm_ownership                                   records who and when, once (needs an image)
 *        action=fidelity fidelity=match|start
 *        action=remove   id=<mockup id>
 *
 * Session-gated on the `director` tool, then on the project the request names — the tool grant
 * alone is not a project grant. The project may be PENDING (`requireDirectorProjectScope`): the
 * New-game form uploads mockups and confirms their ownership under the key and client of the game
 * it is about to create, before `POST /api/director/runs` creates it — the run cannot be created
 * without the check (ADR-0005). Every limit (PNG/JPG only, 20 MB, 12 files) is enforced in
 * `mockups.ts`; this file only maps its refusals to responses. Files travel through the launcher
 * (`BODY_SIZE_LIMIT` is 32M in code), one file per request, so a refusal is about THE file and
 * nothing has half-landed.
 */

const NO_STORE = { 'cache-control': 'no-store' };

function answer(doc: MockupsDoc, pending: boolean, etag: string | null = null) {
	return json(
		{
			doc,
			etag,
			pending,
			limits: { maxBytes: MAX_MOCKUP_BYTES, maxFiles: MAX_MOCKUPS, fidelities: FIDELITIES },
			startRefusal: ownershipRefusal(doc),
		},
		{ headers: NO_STORE },
	);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const { clientKey, projectKey, pending } = await requireDirectorProjectScope(
		user,
		url.searchParams.get('project'),
		url.searchParams.get('client'),
	);
	const { doc, etag } = await loadMockupsDoc(clientKey, projectKey);
	return answer(doc, pending, etag);
};

export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const { clientKey, projectKey, pending } = await requireDirectorProjectScope(
		user,
		url.searchParams.get('project'),
		url.searchParams.get('client'),
	);
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw error(400, 'Expected a multipart form.');
	}
	const by = { uid: user.id, name: user.name ?? user.email };
	// A pending key's doc is re-checked as the caller's inside each write, on the doc the CAS writes.
	const owner = pending ? user.id : undefined;
	const action = form.get('action');
	try {
		switch (action) {
			case 'upload': {
				const files = form.getAll('file').filter((f): f is File => f instanceof File);
				if (files.length !== 1) throw error(400, 'Send exactly one file per request.');
				const styleOnly = ['1', 'true', 'on'].includes(String(form.get('styleOnly') ?? ''));
				const { doc } = await addMockup({
					client: clientKey,
					project: projectKey,
					bytes: new Uint8Array(await files[0].arrayBuffer()),
					tag: form.get('tag'),
					styleOnly,
					by,
					owner,
				});
				return answer(doc, pending);
			}
			case 'retag':
				return answer(
					await setMockupTag(
						clientKey,
						projectKey,
						String(form.get('id') ?? ''),
						form.get('tag'),
						['1', 'true', 'on'].includes(String(form.get('styleOnly') ?? '')),
						owner,
					),
					pending,
				);
			case 'confirm_ownership':
				return answer(await confirmOwnership(clientKey, projectKey, by, owner), pending);
			case 'fidelity':
				return answer(
					await setFidelity(clientKey, projectKey, form.get('fidelity'), owner),
					pending,
				);
			case 'remove':
				return answer(
					await removeMockup(clientKey, projectKey, String(form.get('id') ?? ''), owner),
					pending,
				);
			default:
				throw error(400, 'Unknown action.');
		}
	} catch (e) {
		if (e instanceof MockupError) {
			return json({ error: e.code, message: e.message }, { status: e.status, headers: NO_STORE });
		}
		throw e;
	}
};
